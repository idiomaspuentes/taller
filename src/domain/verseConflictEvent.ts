/**
 * `verse-conflict` chat event (plan §6.3, §7.3): one decision per conflicting
 * range, posted on the closer's subtarea (`side: "entrante"`) and, when the
 * other author is known, on theirs (`side: "desplazado"`) with an @mention.
 * Texts are normalized (display only): never written back to USFM.
 */
import { formatChatEvent, type ChatEvent } from "./chatEvent";
import type { VerseConflict } from "./usfmVerseMerge";
import type { VerseConflictsPayload } from "./verseConflicts";

export const VERSE_CONFLICT_TYPE = "verse-conflict";

export type VerseConflictSide = "entrante" | "desplazado";

/** Keep what the trunk has now, or restore the text that was displaced. */
export type VerseConflictOptionId = "tronco" | "desplazado";

export type VerseConflictData = {
  pr: { owner: string; repo: string; number: number };
  bookRef: string;
  book: string;
  usfmPath: string;
  range: { chapter: number; from: number; to: number; kind: "texto" | "estructura"; kept: "ultimo" | "tronco" };
  /** Subtarea whose Cerrar produced the conflict. */
  conflictIssue: number;
  closer: string;
  otherIssue: number | null;
  otherLogin: string | null;
  side: VerseConflictSide;
  texts: { entrante: string; tronco: string };
  trunkSha?: string;
};

export function rangeLabel(range: { chapter: number; from: number; to: number }): string {
  return range.to > range.from ? `${range.chapter}:${range.from}–${range.to}` : `${range.chapter}:${range.from}`;
}

/** Verse text in a Door43 comment must not open an HTML comment or notify anyone. */
function safeQuote(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim() || "(vacío)";
  return clean.replace(/<!--/g, "<!‐‐").replace(/@(?=[A-Za-z0-9])/g, "@\u200b");
}

/** True when the viewer's side of the conflict is the text now in the trunk. */
function ownInTrunk(data: Pick<VerseConflictData, "side" | "range">): boolean {
  return data.side === "entrante" ? data.range.kept === "ultimo" : data.range.kept === "tronco";
}

function otherName(data: VerseConflictData, at: boolean): string {
  const login = data.side === "entrante" ? data.otherLogin : data.closer;
  const issue = data.side === "entrante" ? data.otherIssue : data.conflictIssue;
  if (!login) return "otra subtarea";
  return `${at ? "@" : ""}${login}${issue ? ` (#${issue})` : ""}`;
}

function otherShort(data: VerseConflictData, at: boolean): string {
  const login = data.side === "entrante" ? data.otherLogin : data.closer;
  return login ? `${at ? "@" : ""}${login}` : "la otra";
}

/** Card title in TAS (@names are fine here: this text is never posted). */
export function verseConflictTitle(data: VerseConflictData): string {
  return conflictSentence(data, true);
}

function conflictSentence(data: VerseConflictData, at: boolean): string {
  const ref = `${data.book} ${rangeLabel(data.range)}`.trim();
  if (data.side === "entrante") {
    return data.range.kept === "ultimo"
      ? `El versículo ${ref} también lo escribió ${otherName(data, at)}. Quedó tu versión.`
      : `El versículo ${ref} ya tenía la versión de ${otherName(data, at)} y quedó esa.`;
  }
  return data.range.kept === "ultimo"
    ? `${otherName(data, at)} cerró ${ref} y su versión reemplazó la tuya.`
    : `${otherName(data, at)} cerró ${ref} con otra versión; quedó la tuya.`;
}

/** True when the thread's own text is the one in the trunk (`data.range.kept` as it stands now). */
export function conflictOwnInTrunk(data: Pick<VerseConflictData, "side" | "range">): boolean {
  return ownInTrunk(data);
}

/** Same conflict with `kept` set to what the trunk holds after a decision. */
export function withKept(data: VerseConflictData, kept: VerseConflictData["range"]["kept"]): VerseConflictData {
  return { ...data, range: { ...data.range, kept } };
}

/** Line under a decided card; names the version the trunk kept. */
export function decidedConflictSentence(data: VerseConflictData): string {
  const ref = `${data.book} ${rangeLabel(data.range)}`.trim();
  if (ownInTrunk(data)) return `En ${ref} quedó tu versión.`;
  const login = data.side === "entrante" ? data.otherLogin : data.closer;
  return `En ${ref} quedó ${login ? `la versión de ${otherName(data, true)}` : "la otra versión"}.`;
}

export function verseConflictPanels(data: VerseConflictData): Array<{ label: string; text: string; tag?: string }> {
  const mineText = data.side === "entrante" ? data.texts.entrante : data.texts.tronco;
  const theirsText = data.side === "entrante" ? data.texts.tronco : data.texts.entrante;
  const inTrunk = ownInTrunk(data);
  const theirsLabel =
    data.side === "entrante" && !data.otherLogin ? "Borrador grupal anterior" : `Versión de ${otherShort(data, true)}`;
  return [
    { label: "Tu versión", text: mineText, ...(inTrunk ? { tag: "grupal" } : {}) },
    { label: theirsLabel, text: theirsText, ...(!inTrunk ? { tag: "grupal" } : {}) },
  ];
}

export function verseConflictOptionLabels(data: VerseConflictData): Record<VerseConflictOptionId, string> {
  const inTrunk = ownInTrunk(data);
  return {
    tronco: inTrunk ? "Quedarme con esta" : `Mantener la de ${otherShort(data, true)}`,
    desplazado: inTrunk ? "Volver a la otra" : "Volver a la mía",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validated `data` of a `verse-conflict` event, or null (never trust the marker). */
export function verseConflictData(event: ChatEvent): VerseConflictData | null {
  if (event.type !== VERSE_CONFLICT_TYPE || !isRecord(event.data)) return null;
  const d = event.data;
  const pr = isRecord(d.pr) ? d.pr : null;
  const range = isRecord(d.range) ? d.range : null;
  const texts = isRecord(d.texts) ? d.texts : null;
  if (!pr || !range || !texts) return null;
  const chapter = Number(range.chapter);
  const from = Number(range.from);
  const to = Number(range.to);
  const conflictIssue = Number(d.conflictIssue);
  const side = d.side === "entrante" || d.side === "desplazado" ? d.side : null;
  const kept = range.kept === "ultimo" || range.kept === "tronco" ? range.kept : null;
  if (!chapter || !from || to < from || !conflictIssue || !side || !kept) return null;
  if (typeof d.bookRef !== "string" || !d.bookRef || typeof pr.owner !== "string" || typeof pr.repo !== "string") {
    return null;
  }
  const otherIssue = Number(d.otherIssue) || null;
  return {
    pr: { owner: pr.owner, repo: pr.repo, number: Number(pr.number) || 0 },
    bookRef: d.bookRef,
    book: typeof d.book === "string" ? d.book : "",
    usfmPath: typeof d.usfmPath === "string" ? d.usfmPath : "",
    range: { chapter, from, to, kind: range.kind === "estructura" ? "estructura" : "texto", kept },
    conflictIssue,
    closer: typeof d.closer === "string" ? d.closer : "",
    otherIssue,
    otherLogin: typeof d.otherLogin === "string" && d.otherLogin ? d.otherLogin : null,
    side,
    texts: {
      entrante: typeof texts.entrante === "string" ? texts.entrante : "",
      tronco: typeof texts.tronco === "string" ? texts.tronco : "",
    },
    ...(typeof d.trunkSha === "string" && d.trunkSha ? { trunkSha: d.trunkSha } : {}),
  };
}

function candidateText(conflict: VerseConflict, source: "tronco" | "entrante"): string {
  return conflict.candidates
    .filter((c) => c.source === source)
    .map((c) => c.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" / ");
}

export type VerseConflictPost = { issue: number; body: string; event: ChatEvent };

/**
 * Comments to post after Cerrar: per range, one on the closer's subtarea and,
 * if the other author is known, one on theirs mentioning only them.
 */
export function buildVerseConflictPosts(params: {
  payload: Pick<VerseConflictsPayload, "issue" | "bookRef" | "trunkSha" | "conflicts">;
  closer: string;
  pr: { owner: string; repo: string; number: number };
  book: string;
  usfmPath: string;
  /** Per conflict index: who wrote the trunk text, when it could be deduced. */
  others: Array<{ otherIssue: number; otherLogin: string | null } | null>;
  /** Makes the decision id unique per Cerrar (e.g. the trunk blob SHA). */
  stamp: string;
}): VerseConflictPost[] {
  const posts: VerseConflictPost[] = [];
  const issue = params.payload.issue;
  params.payload.conflicts.forEach((conflict, index) => {
    const other = params.others[index] ?? null;
    const base: Omit<VerseConflictData, "side"> = {
      pr: params.pr,
      bookRef: params.payload.bookRef,
      book: params.book.toUpperCase(),
      usfmPath: params.usfmPath,
      range: { chapter: conflict.chapter, from: conflict.from, to: conflict.to, kind: conflict.kind, kept: conflict.kept },
      conflictIssue: issue,
      closer: params.closer,
      otherIssue: other?.otherIssue ?? null,
      otherLogin: other?.otherLogin ?? null,
      texts: { entrante: candidateText(conflict, "entrante"), tronco: candidateText(conflict, "tronco") },
      ...(params.payload.trunkSha ? { trunkSha: params.payload.trunkSha } : {}),
    };
    const decisionId = `${issue}:${conflict.chapter}:${conflict.from}-${conflict.to}:${params.stamp}`;
    const sides: VerseConflictSide[] = other?.otherIssue ? ["entrante", "desplazado"] : ["entrante"];
    for (const side of sides) {
      const data: VerseConflictData = { ...base, side };
      const labels = verseConflictOptionLabels(data);
      const mention = side === "desplazado" && data.otherLogin ? data.otherLogin : null;
      // Only the displaced author is mentioned, only on their own subtarea.
      const summary = mention ? `@${mention}: ${conflictSentence(data, false)}` : conflictSentence(data, false);
      const [mine, theirs] = verseConflictPanels(data);
      const theirsLabel = theirs!.label.replace(/@/g, "");
      const visible = [summary, "", `> ${mine!.label}: ${safeQuote(mine!.text)}`, ">", `> ${theirsLabel}: ${safeQuote(theirs!.text)}`].join(
        "\n",
      );
      const event: ChatEvent = {
        schema: "tas-chat-event-1",
        type: VERSE_CONFLICT_TYPE,
        emitter: "tas",
        issue: side === "entrante" ? issue : other!.otherIssue,
        summary,
        ...(mention ? { mentions: [mention] } : {}),
        decision: {
          id: decisionId,
          options: [
            { id: "tronco", label: labels.tronco },
            { id: "desplazado", label: labels.desplazado },
          ],
          state: "pendiente",
        },
        data: data as unknown as Record<string, unknown>,
      };
      const { schema: _schema, ...rest } = event;
      posts.push({ issue: event.issue, body: formatChatEvent(rest, { visible }), event });
    }
  });
  return posts;
}
