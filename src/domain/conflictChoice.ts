/**
 * Deciding a `verse-conflict` (plan §7): keep what the trunk has, or put the
 * displaced text back. Pure. Writes reuse `patchTrunkByVerse` with the
 * current trunk as ancestor so only the range changes; the source is a real
 * USFM file (trunk blob before Cerrar, or the archived work), never the
 * normalized text stored in the event.
 */
import { formatChatEvent, type ChatEvent } from "./chatEvent";
import type { DecisionViewer } from "./chatEvents/registry";
import { listVerseSpans, type VerseSpan } from "./usfmEdit";
import { patchTrunkByVerse } from "./usfmTrunkPatch";
import { verseSlotsOf } from "./usfmVerseMerge";
import {
  rangeLabel,
  verseConflictOptionLabels,
  type VerseConflictData,
  type VerseConflictOptionId,
} from "./verseConflictEvent";

export const VERSE_CHOICE_TYPE = "verse-choice";

type Range = { chapter: number; from: number; to: number };

/** What `prepare` found before painting the buttons. */
export type ConflictPrepared = {
  /** Current trunk text of the range (normalized, " / " between slots); null = trunk not readable. */
  trunkText: string | null;
  trunkError?: string;
  /** Why the displaced text cannot be restored (no source), or null. */
  sourceReason: string | null;
};

function overlaps(a: Range, b: Range): boolean {
  return a.chapter === b.chapter && a.from <= b.to && b.from <= a.to;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Same shape as the candidate texts of the conflict payload. */
export function rangeText(usfm: string, range: Range): string {
  return verseSlotsOf(usfm)
    .filter((slot) => overlaps(slot, range))
    .map((slot) => collapse(slot.text))
    .filter(Boolean)
    .join(" / ");
}

export function keptText(data: VerseConflictData): string {
  return data.range.kept === "ultimo" ? data.texts.entrante : data.texts.tronco;
}

export function displacedText(data: VerseConflictData): string {
  return data.range.kept === "ultimo" ? data.texts.tronco : data.texts.entrante;
}

/** `range.kept` once the option is applied. */
export function keptAfterChoice(data: VerseConflictData, option: VerseConflictOptionId): VerseConflictData["range"]["kept"] {
  if (option === "tronco") return data.range.kept;
  return data.range.kept === "ultimo" ? "tronco" : "ultimo";
}

/**
 * `range.kept` after a `verse-choice`. Older choices carry no `kept`; their
 * `choice` is relative to the conflict as posted.
 */
export function keptAfterDecision(data: VerseConflictData, resolution: ChatEvent): VerseConflictData["range"]["kept"] {
  const kept = resolution.data?.kept;
  if (kept === "ultimo" || kept === "tronco") return kept;
  const choice = resolution.data?.choice ?? resolution.decision?.chosen;
  return choice === "tronco" || choice === "desplazado" ? keptAfterChoice(data, choice) : data.range.kept;
}

/** Login whose version the option leaves in the trunk (null when unknown). */
export function versionOwner(data: VerseConflictData, option: VerseConflictOptionId): string | null {
  const closerWins = (data.range.kept === "ultimo") === (option === "tronco");
  return closerWins ? data.closer || null : data.otherLogin;
}

function canDecide(viewer: DecisionViewer): boolean {
  if (viewer.canManage) return true;
  const me = viewer.username.toLowerCase();
  return Boolean(me) && viewer.assignees.some((login) => login.toLowerCase() === me);
}

/** Block reason when the range was edited after the conflict; the card pairs it with an editor link. */
export function verseChangedReason(range: Range): string {
  return `El versículo ${rangeLabel(range)} cambió después del conflicto. Ábrelo en el editor.`;
}

/**
 * `null` = enabled, otherwise the reason shown inside the card (§7.4, §7.5).
 * Evaluated when painting and again right before writing.
 */
export function choiceBlockReason(params: {
  data: VerseConflictData;
  option: VerseConflictOptionId;
  viewer: DecisionViewer;
  prepared?: ConflictPrepared;
  prepareError?: string;
}): string | null {
  const { data, option, viewer, prepared } = params;
  if (!canDecide(viewer)) {
    const who = viewer.assignees.map((l) => `@${l}`).join(" o ");
    return who ? `Solo ${who} o un gestor puede decidir.` : "Solo quien tiene la subtarea o un gestor puede decidir.";
  }
  if (params.prepareError) return params.prepareError;
  if (!prepared) return "Comprobando el versículo…";
  if (prepared.trunkText === null) {
    return prepared.trunkError || "No se encontró el borrador grupal. No se puede decidir desde aquí.";
  }
  if (collapse(prepared.trunkText) !== collapse(keptText(data))) {
    if (option === "desplazado" && collapse(prepared.trunkText) === collapse(displacedText(data))) {
      return "Esa versión ya está en el borrador grupal.";
    }
    return verseChangedReason(data.range);
  }
  if (option === "desplazado" && prepared.sourceReason) return prepared.sourceReason;
  return null;
}

/** Why there is no source to restore the displaced text, or null. */
export function sourceBlockReason(data: VerseConflictData): string | null {
  if (data.range.kept === "ultimo") {
    if (data.trunkSha || data.otherIssue) return null;
    return "No se sabe de dónde recuperar la otra versión (falta la subtarea que la escribió).";
  }
  return null;
}

/** Text lines of a verse (trailing paragraph / heading markers belong to the next one). */
function verseBody(span: VerseSpan): string {
  const lines = span.rawBody.replace(/\r/g, "").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  const markerOnly = /^\s*\\(?:p|m|pi\d?|q\d?|qm\d?|nb|li\d?|pc|mi|b)\s*$/;
  const heading = /^\s*\\(?:s\d?|ms\d?|mr|r|d|sp|cl|cd|rem)\b/;
  while (lines.length > 1 && (markerOnly.test(lines[lines.length - 1]!) || heading.test(lines[lines.length - 1]!) || !lines[lines.length - 1]!.trim())) {
    lines.pop();
  }
  return lines.join("\n").trim();
}

function spansIn(usfm: string, range: Range): VerseSpan[] {
  return listVerseSpans(usfm).filter((s) => overlaps({ chapter: s.chapter, from: s.verse, to: s.verseTo }, range));
}

function spansOut(usfm: string, range: Range): string[] {
  return listVerseSpans(usfm)
    .filter((s) => !overlaps({ chapter: s.chapter, from: s.verse, to: s.verseTo }, range))
    .map((s) => `${s.chapter}:${s.verse}-${s.verseTo}${s.segment ?? ""}\u0000${verseBody(s)}`);
}

export type ChoicePatch =
  | { ok: true; usfm: string; changed: boolean }
  | { ok: false; reason: string };

/**
 * Trunk with the range taken from `source` (a real USFM file). Refuses when
 * the source is not the displaced text, when the copy would lose footnotes
 * or other markup (the patch falls back to normalized text for multi-line
 * verses), or when anything outside the range would change.
 */
export function computeChoicePatch(params: {
  trunk: string;
  source: string;
  range: Range;
  expectedSourceText: string;
}): ChoicePatch {
  const { trunk, source, range } = params;
  if (collapse(rangeText(source, range)) !== collapse(params.expectedSourceText)) {
    return { ok: false, reason: `La otra versión de ${rangeLabel(range)} ya no está donde se guardó. Ábrelo en el editor.` };
  }
  const result = patchTrunkByVerse(trunk, [source], { ancestor: trunk, scope: range });
  if (result.usfm === trunk) return { ok: true, usfm: trunk, changed: false };
  const want = spansIn(source, range).map(verseBody);
  const got = spansIn(result.usfm, range).map(verseBody);
  if (want.length !== got.length || want.some((body, i) => body !== got[i])) {
    return {
      ok: false,
      reason: `El versículo ${rangeLabel(range)} tiene notas o formato que no se pueden copiar solos. Ábrelo en el editor.`,
    };
  }
  const outBefore = spansOut(trunk, range);
  const outAfter = spansOut(result.usfm, range);
  if (outBefore.length !== outAfter.length || outBefore.some((row, i) => row !== outAfter[i])) {
    return { ok: false, reason: `Elegir ${rangeLabel(range)} cambiaría otros versículos. No se escribió nada.` };
  }
  return { ok: true, usfm: result.usfm, changed: true };
}

export function trunkChoiceCommitMessage(params: {
  data: VerseConflictData;
  option: VerseConflictOptionId;
  by: string;
  source: string;
}): string {
  const { data, option } = params;
  const owner = versionOwner(data, option);
  const keptIssue = owner && owner === data.closer ? data.conflictIssue : data.otherIssue;
  const at = (login: string | null) => (login ? `@${login}` : "—");
  return [
    `TAS: elegir versión de ${rangeLabel(data.range)} en #${data.conflictIssue} (${at(params.by)}) — quedó ${
      keptIssue ? `#${keptIssue} ` : ""
    }(${at(owner)})`,
    "",
    `Decidió: ${at(params.by)}`,
    `Archivo: ${data.usfmPath}`,
    `Fuente: ${params.source}`,
  ].join("\n");
}

export type VerseChoicePost = { issue: number; body: string; event: ChatEvent };

/** `verse-choice` for both threads; each mentions its own assignee unless they decided. */
export function buildVerseChoicePosts(params: {
  data: VerseConflictData;
  decisionId: string;
  option: VerseConflictOptionId;
  by: string;
  wrote: boolean;
  commit?: string;
}): VerseChoicePost[] {
  const { data, option, by } = params;
  const owner = versionOwner(data, option);
  const ref = `${data.book} ${rangeLabel(data.range)}`.trim();
  const threads: Array<{ issue: number; login: string | null }> = [
    { issue: data.conflictIssue, login: data.closer || null },
    ...(data.otherIssue ? [{ issue: data.otherIssue, login: data.otherLogin }] : []),
  ];
  const label = verseConflictOptionLabels({ ...data, side: "entrante" })[option];
  return threads.map(({ issue, login }) => {
    const mention = login && login.toLowerCase() !== by.toLowerCase() ? login : null;
    const sentence = `Resuelto por ${by}: en ${ref} quedó ${owner ? `la versión de ${owner}` : "la otra versión"}.`;
    const summary = mention ? `@${mention}: ${sentence}` : sentence;
    const event: ChatEvent = {
      schema: "tas-chat-event-1",
      type: VERSE_CHOICE_TYPE,
      emitter: "tas",
      issue,
      summary,
      ...(mention ? { mentions: [mention] } : {}),
      decision: { id: params.decisionId, options: [{ id: option, label }], state: "resuelta", chosen: option, by },
      data: {
        decisionId: params.decisionId,
        range: data.range,
        choice: option,
        kept: keptAfterChoice(data, option),
        owner,
        bookRef: data.bookRef,
        wrote: params.wrote,
        ...(params.commit ? { commit: params.commit } : {}),
        by,
      },
    };
    const { schema: _schema, ...rest } = event;
    return { issue, body: formatChatEvent(rest), event };
  });
}

/** Subtareas a verse choice touches: the closer's and, when known, the displaced author's. */
export function verseChoiceIssues(data: Pick<VerseConflictData, "conflictIssue" | "otherIssue">): number[] {
  return [data.conflictIssue, ...(data.otherIssue ? [data.otherIssue] : [])];
}

export function verseChoiceDecisionId(event: ChatEvent): string | null {
  if (event.type !== VERSE_CHOICE_TYPE) return null;
  const id = event.data?.decisionId;
  return typeof id === "string" && id ? id : null;
}

/** Collapsed card line, e.g. "Resuelto por @ana: quedó la versión de @bob". */
export function verseChoiceTitle(event: ChatEvent): string {
  const by = typeof event.data?.by === "string" ? event.data.by : event.decision?.by;
  const owner = typeof event.data?.owner === "string" ? event.data.owner : null;
  if (!by) return event.summary;
  return `Resuelto por @${by}: quedó ${owner ? `la versión de @${owner}` : "la otra versión"}`;
}
