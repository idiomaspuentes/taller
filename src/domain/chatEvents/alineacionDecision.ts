/**
 * Render side of a team decision about an alignment: the card with the proposal or the
 * objection, the votes (one system line each) and the closing. Pure; reading the votes and
 * writing is attached by `src/dcs/alignmentDecisionThread.ts`.
 */
import type { PersonLevel } from "../levels";
import type { ChatEvent } from "../chatEvent";
import {
  OPTION_LABEL,
  latestVotes,
  optionsFor,
  tallyDecision,
  type DecisionKind,
  type DecisionOptionId,
  type DecisionOutcome,
  type DecisionThresholds,
  type DecisionVote,
} from "../alignmentDecision";
import type { AlignmentGroup } from "@usfm-tools/types";
import { boxesOf, changedBoxKeys, objectedBoxKeys, sameText, wordDiff, type DecisionView } from "../verseEditView";
import { registerChatEventType, type ChatEventType, type DecisionOption, type DecisionPanel } from "./registry";

export const DECISION_EVENT = "alineacion-decision";
export const VOTE_EVENT = "alineacion-voto";
export const CLOSE_EVENT = "alineacion-cierre";
export const CONSENSUS_EVENT = "alineacion-consenso";
export const WITHDRAW_EVENT = "alineacion-retiro";
export const EDIT_EVENT = "alineacion-edicion";

export type DecisionEventData = {
  id: string;
  kind: DecisionKind;
  book: string;
  chapter: number;
  verse: number;
  by: string;
  note: string;
  baseHash: string;
  /** Where the proposal file lives in the text repository. */
  path: string;
  /** The links now and the links proposed, as readable lines (for whoever reads the issue on Door43). */
  before: string[];
  after: string[];
  /** The same links as data, so the card can draw the boxes. */
  groupsBefore: AlignmentGroup[];
  groupsAfter: AlignmentGroup[];
  /** The words of the verse (original with glosses, draft before and after). */
  view: DecisionView;
  /** The verse text before and after; equal unless the proposal edits the draft. */
  oldText: string;
  newText: string;
  /** Objections: the words of the original it is about. */
  words: string[];
  deadline: string;
  thresholds: DecisionThresholds;
  aligners: string[];
  /** The people of the team that has the task: they are told when the decision opens and when it is applied. */
  tell: string[];
  draft: { owner: string; repo: string; branch: string; filepath: string };
  source: { id: string; layerDir: string };
  parentIssue: number;
  /**
   * A proposal that is talked over is worded again: each wording is a card of its own in the conversation, of the
   * same decision, and only the newest keeps its buttons (see `group`). `version` counts them from 1; `since` is
   * when this one was written, as its writer's clock had it (which votes count is told by when the conversation
   * got the card, see `readDecisionThread`); `history` are the wordings before it, so that the team can go back
   * to one of them.
   */
  version?: number;
  since?: string;
  history?: ProposalVersion[];
  /** A suggestion from outside the organization (`outsideSuggestion.ts`): the issue its author is answered in. */
  outside?: { owner: string; repo: string; number: number; by: string };
};

/** A wording a proposal had: which one, whose, and what it said. */
export type ProposalVersion = { n: number; by: string; text: string };

/**
 * Who is told of a step of a decision: whoever proposed it, whoever aligned the verse and the team that has the
 * task, each once, and not the person who has just done the step.
 */
export function toldOf(data: Pick<DecisionEventData, "by" | "aligners" | "tell">, except: string): string[] {
  const out: string[] = [];
  for (const login of [data.by, ...data.aligners, ...(data.tell ?? [])]) {
    const key = login.trim().toLowerCase();
    if (key && key !== except.trim().toLowerCase() && !out.some((have) => have.toLowerCase() === key)) out.push(login.trim());
  }
  return out;
}

export function decisionId(data: Pick<DecisionEventData, "id">): string {
  return `ad:${data.id}`;
}

function asData(value: unknown): DecisionEventData | null {
  const d = value as Partial<DecisionEventData> | undefined;
  if (!d || typeof d !== "object") return null;
  if (!d.id || (d.kind !== "proposal" && d.kind !== "objection") || !d.book || !d.chapter || !d.verse || !d.by || !d.baseHash || !d.path) return null;
  if (!d.draft?.owner || !d.draft.repo || !d.draft.branch || !d.draft.filepath || !d.source?.id) return null;
  return {
    id: String(d.id),
    kind: d.kind,
    book: String(d.book),
    chapter: Number(d.chapter),
    verse: Number(d.verse),
    by: String(d.by),
    note: String(d.note ?? ""),
    baseHash: String(d.baseHash),
    path: String(d.path),
    before: Array.isArray(d.before) ? d.before.map(String) : [],
    after: Array.isArray(d.after) ? d.after.map(String) : [],
    groupsBefore: Array.isArray(d.groupsBefore) ? d.groupsBefore : [],
    groupsAfter: Array.isArray(d.groupsAfter) ? d.groupsAfter : [],
    view: d.view && Array.isArray(d.view.original) ? d.view : { rtl: false, original: [], draftBefore: [], draftAfter: [] },
    oldText: String(d.oldText ?? ""),
    newText: String(d.newText ?? ""),
    words: Array.isArray(d.words) ? d.words.map(String) : [],
    deadline: String(d.deadline ?? ""),
    thresholds: { minAgree: Number(d.thresholds?.minAgree) || 2, minIndependent: Number(d.thresholds?.minIndependent) || 1 },
    aligners: Array.isArray(d.aligners) ? d.aligners.map(String) : [],
    tell: Array.isArray(d.tell) ? d.tell.map(String) : [],
    draft: { owner: d.draft.owner, repo: d.draft.repo, branch: d.draft.branch, filepath: d.draft.filepath },
    source: { id: d.source.id, layerDir: String(d.source.layerDir ?? "") },
    parentIssue: Number(d.parentIssue) || 0,
    ...(Number(d.version) > 1 ? { version: Number(d.version) } : {}),
    ...(typeof d.since === "string" && d.since ? { since: d.since } : {}),
    ...(Array.isArray(d.history) && d.history.length
      ? { history: d.history.filter((row) => row && Number(row.n) > 0 && typeof row.text === "string").map((row) => ({ n: Number(row.n), by: String(row.by ?? ""), text: String(row.text) })) }
      : {}),
    ...(d.outside?.owner && d.outside.repo && Number(d.outside.number) > 0
      ? { outside: { owner: String(d.outside.owner), repo: String(d.outside.repo), number: Number(d.outside.number), by: String(d.outside.by ?? "") } }
      : {}),
  };
}

/** Which wording of the proposal a card is: 1 for the one it was opened with. */
export const versionOf = (d: Pick<DecisionEventData, "version">): number => d.version ?? 1;

/** Every wording the proposal has had, the one in hand last. */
export function versionsOf(d: Pick<DecisionEventData, "version" | "history" | "by" | "newText">): ProposalVersion[] {
  return [...(d.history ?? []), { n: versionOf(d), by: d.by, text: d.newText }];
}

/**
 * Whoever may word a proposal again, or go back to an earlier wording: anybody of the two teams it concerns. The
 * team it was proposed from (`tell`, with whoever proposed and whoever aligned the verse), and the team that has
 * the text in its hands (`owners`), which is another one when the proposal comes from outside it and the same
 * when a team proposes about its own text. And whoever coordinates.
 */
export function mayReword(d: Pick<DecisionEventData, "by" | "aligners" | "tell" | "history">, viewer: { username: string; canManage: boolean }, owners: string[] = []): boolean {
  const me = viewer.username.trim().toLowerCase();
  return viewer.canManage || [d.by, ...d.aligners, ...(d.tell ?? []), ...(d.history ?? []).map((row) => row.by), ...owners].some((login) => login.trim().toLowerCase() === me);
}

/**
 * The proposal worded again: the card of the next version. The verse it starts from is the same; what it would
 * say, and the links that follow from it, are new. Whoever writes it backs it, the others vote again, and the
 * days to decide count from now. `links` gives the alignment the new wording would leave.
 */
export function rewordedData(d: DecisionEventData, params: { by: string; text: string; note: string; now: Date; deadline: string; links: { groups: AlignmentGroup[]; lines: string[]; draft: DecisionView["draftAfter"] } }): DecisionEventData {
  const told = [...(d.tell ?? []), d.by].filter((login, at, all) => all.findIndex((other) => other.toLowerCase() === login.toLowerCase()) === at);
  return {
    ...d,
    by: params.by,
    note: params.note,
    newText: params.text,
    groupsAfter: params.links.groups,
    after: params.links.lines,
    view: { ...d.view, draftAfter: params.links.draft },
    deadline: params.deadline,
    tell: told,
    version: versionOf(d) + 1,
    since: params.now.toISOString(),
    history: versionsOf(d),
  };
}


export function alineacionDecisionData(event: ChatEvent): DecisionEventData | null {
  return event.type === DECISION_EVENT ? asData(event.data) : null;
}

export function refLabel(d: Pick<DecisionEventData, "book" | "chapter" | "verse">): string {
  return `${d.book} ${d.chapter}:${d.verse}`;
}

/** The proposal edits the text of the draft, not only the alignment. */
export function editsText(d: Pick<DecisionEventData, "kind" | "oldText" | "newText">): boolean {
  return d.kind === "proposal" && d.newText.trim() !== "" && !sameText(d.oldText, d.newText);
}

export function decisionTitle(d: DecisionEventData): string {
  if (d.kind === "objection") return `Objeción de @${d.by} en ${refLabel(d)}`;
  if (versionOf(d) > 1) return `Versión ${versionOf(d)} de la propuesta para ${refLabel(d)}, de @${d.by}`;
  return editsText(d) ? `Propuesta de @${d.by} para cambiar el texto de ${refLabel(d)}` : `Propuesta de @${d.by} para ${refLabel(d)}`;
}

/** The card that opens the decision. `issue` is the decision's own subtarea. */
export function buildDecisionEvent(data: DecisionEventData, issue: number): Omit<ChatEvent, "schema"> {
  const { yes, no } = optionsFor(data.kind);
  return {
    type: DECISION_EVENT,
    emitter: "afinacion",
    issue,
    summary: `${decisionTitle(data)}. Vota en esta tarea; se decide con el equipo antes del ${data.deadline.slice(0, 10)}.`,
    // Opening a proposal tells the whole team, not only whoever aligned: they are the ones to answer it.
    mentions: toldOf(data, data.by),
    decision: {
      id: decisionId(data),
      state: "pendiente",
      options: [
        { id: yes, label: OPTION_LABEL[yes] },
        { id: no, label: OPTION_LABEL[no] },
      ],
    },
    data: data as unknown as Record<string, unknown>,
  };
}

export function buildVoteEvent(params: { issue: number; data: DecisionEventData; by: string; option: DecisionOptionId; reason?: string }): Omit<ChatEvent, "schema"> {
  const reason = params.reason?.replace(/\s+/g, " ").trim();
  return {
    type: VOTE_EVENT,
    emitter: "afinacion",
    issue: params.issue,
    // A no says why: it is what the conversation goes on from, and what another wording answers.
    summary: `@${params.by} votó: ${OPTION_LABEL[params.option]}${reason ? `. «${reason}»` : ""}`,
    ...(reason ? { mentions: [params.data.by] } : {}),
    data: { decisionId: decisionId(params.data), option: params.option, by: params.by, ...(reason ? { reason } : {}) },
  };
}

/**
 * A vote against withdrawn by another habilitada of the team, because whoever cast it is not there to withdraw it.
 * It says why, and the person is told: the vote is theirs, and they may cast it again.
 */
export function buildWithdrawEvent(params: { issue: number; data: DecisionEventData; of: string; by: string; reason: string }): Omit<ChatEvent, "schema"> {
  const reason = params.reason.replace(/\s+/g, " ").trim();
  return {
    type: WITHDRAW_EVENT,
    emitter: "afinacion",
    issue: params.issue,
    summary: `@${params.by} retiró el voto en contra de @${params.of}. «${reason}»`,
    mentions: [params.of],
    data: { decisionId: decisionId(params.data), of: params.of, by: params.by, reason },
  };
}

/** Whoever proposed put their proposal right before anybody voted: a line of the conversation, not something said. */
export function buildEditEvent(params: { issue: number; data: DecisionEventData; by: string }): Omit<ChatEvent, "schema"> {
  return {
    type: EDIT_EVENT,
    emitter: "afinacion",
    issue: params.issue,
    summary: `@${params.by} editó su propuesta antes de que nadie votara.`,
    data: { decisionId: decisionId(params.data), by: params.by },
  };
}

export function withdrawData(event: ChatEvent): { decisionId: string; of: string; by: string } | null {
  const d = event.data as { decisionId?: string; of?: string; by?: string } | undefined;
  if (event.type !== WITHDRAW_EVENT || !d?.decisionId || !d.of || !d.by) return null;
  return { decisionId: d.decisionId, of: d.of, by: d.by };
}

/** Posted once when the votes reach consensus: nothing closes until a person confirms it. */
export function buildConsensusEvent(params: { issue: number; data: DecisionEventData; winner: DecisionOptionId; people: string[] }): Omit<ChatEvent, "schema"> {
  const mentions = [params.data.by, ...params.data.aligners].filter((l, i, all) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i);
  return {
    type: CONSENSUS_EVENT,
    emitter: "afinacion",
    issue: params.issue,
    summary: `Hay consenso: ${OPTION_LABEL[params.winner]} (${params.people.map((p) => `@${p}`).join(", ")}). ${mentions.map((m) => `@${m}`).join(" ")}: falta que una persona lo confirme para cerrar la decisión.`,
    mentions,
    data: { decisionId: decisionId(params.data), winner: params.winner },
  };
}

export function consensusData(event: ChatEvent): { decisionId: string; winner: DecisionOptionId } | null {
  const d = event.data as { decisionId?: string; winner?: DecisionOptionId } | undefined;
  if (event.type !== CONSENSUS_EVENT || !d?.decisionId || !d.winner) return null;
  return { decisionId: d.decisionId, winner: d.winner };
}

export type CloseData = { decisionId: string; outcome: DecisionOutcome; how: "consenso" | "coordinacion"; by: string };

const CLOSE_TEXT: Record<DecisionOutcome, string> = {
  aceptada: "Se aceptó la propuesta y la alineación quedó cambiada.",
  rechazada: "Se rechazó la propuesta; la alineación sigue igual.",
  realinear: "La objeción prospera: hay que ajustar la alineación.",
  mantenida: "La objeción no prospera; la alineación se mantiene.",
  caducada: "La alineación cambió mientras se decidía, así que la propuesta ya no aplica.",
};

export function buildCloseEvent(params: { issue: number; data: DecisionEventData; outcome: DecisionOutcome; how: "consenso" | "coordinacion"; by: string; aligners?: string[] }): Omit<ChatEvent, "schema"> {
  const who = params.how === "consenso" ? `Decidido por el equipo; @${params.by} confirmó el consenso` : `Decidido por @${params.by}, quien coordina`;
  const ask = params.outcome === "realinear" && params.aligners?.length ? ` ${params.aligners.map((a) => `@${a}`).join(" ")} por favor ajústenla.` : "";
  return {
    type: CLOSE_EVENT,
    emitter: "afinacion",
    issue: params.issue,
    summary: `${who}. ${CLOSE_TEXT[params.outcome]}${ask}`,
    // Applying a decision changes the draft under everybody: all of them are told, whoever confirms it apart.
    mentions: toldOf({ ...params.data, aligners: params.aligners ?? params.data.aligners }, params.by),
    data: { decisionId: decisionId(params.data), outcome: params.outcome, how: params.how, by: params.by } satisfies CloseData,
  };
}

export function closeData(event: ChatEvent): CloseData | null {
  const d = event.data as Partial<CloseData> | undefined;
  if (event.type !== CLOSE_EVENT || !d?.decisionId || !d.outcome) return null;
  return { decisionId: String(d.decisionId), outcome: d.outcome, how: d.how === "coordinacion" ? "coordinacion" : "consenso", by: String(d.by ?? "") };
}

export function voteData(event: ChatEvent): { decisionId: string; option: DecisionOptionId; by: string; reason?: string } | null {
  const d = event.data as { decisionId?: string; option?: DecisionOptionId; by?: string; reason?: string } | undefined;
  if (event.type !== VOTE_EVENT || !d?.decisionId || !d.option || !d.by) return null;
  return { decisionId: d.decisionId, option: d.option, by: d.by, ...(d.reason ? { reason: String(d.reason) } : {}) };
}

/** What the card needs to know about the thread: the votes so far and, if it is over, how it ended. */
export type DecisionPrepared = {
  votes: DecisionVote[];
  /** When the conversation got the wording now being decided, if the proposal was worded again: votes before it do not count. */
  since?: string;
  /** The people of the team that has the text in its hands, who may word the proposal again as its own team may. */
  owners?: string[];
  levels: Record<string, PersonLevel>;
  closed?: ChatEvent;
  /** ISO time the votes were read, so the card can tell if the deadline has passed. */
  now: string;
};

/** Everything the thread says about one decision. */
export function readDecisionThread(events: Array<{ event: ChatEvent; at: string }>, id: string): { votes: DecisionVote[]; closed?: ChatEvent; since?: string } {
  const votes: DecisionVote[] = [];
  let closed: ChatEvent | undefined;
  let since: string | undefined;
  for (const { event, at } of events) {
    const card = alineacionDecisionData(event);
    if (card && decisionId(card) === id && versionOf(card) > 1) since = at;
    const v = voteData(event);
    if (v && v.decisionId === id) votes.push({ by: v.by, option: v.option, at });
    const w = withdrawData(event);
    if (w && w.decisionId === id) votes.push({ by: w.of, option: "retirado", at, withdrawnBy: w.by });
    const c = closeData(event);
    if (c && c.decisionId === id) closed = event;
  }
  return { votes, closed, ...(since ? { since } : {}) };
}

/** Plain text of who backs what, for the confirmation before closing. */
export function voteSummary(d: DecisionEventData, prepared: DecisionPrepared): string {
  const t = tallyOf(d, prepared);
  const { yes, no } = optionsFor(d.kind);
  const line = (id: DecisionOptionId) => `${OPTION_LABEL[id]}: ${t.counts[id].people.length ? t.counts[id].people.map((p) => `@${p}`).join(", ") : "nadie"}`;
  return `${line(yes)}. ${line(no)}.`;
}

/**
 * Whether a person may edit a proposal in place: it is theirs (the wording in hand is), it changes the text, and
 * nobody has voted on that wording, nor had a vote withdrawn. With a vote given, it is worded again instead.
 */
export function mayEdit(d: Pick<DecisionEventData, "by" | "kind" | "oldText" | "newText">, username: string, prepared: Pick<DecisionPrepared, "votes" | "since" | "closed">): boolean {
  if (prepared.closed || d.kind !== "proposal" || !editsText(d)) return false;
  if (d.by.trim().toLowerCase() !== username.trim().toLowerCase()) return false;
  const since = prepared.since ? Date.parse(prepared.since) : NaN;
  return !prepared.votes.some((vote) => !Number.isFinite(since) || Date.parse(vote.at) > since);
}

/**
 * Whether a decision still waits for this person's vote on the wording now decided: not theirs (their own counts
 * for it), not closed, and no vote of theirs since it was worded. A vote of theirs withdrawn by the team waits again.
 * The screen that reads it makes the way on its filled button once nothing waits.
 */
export function waitsOnVote(d: Pick<DecisionEventData, "by">, username: string, prepared: Pick<DecisionPrepared, "votes" | "since" | "closed">): boolean {
  const me = username.trim().toLowerCase();
  if (!me || prepared.closed || d.by.trim().toLowerCase() === me) return false;
  const since = prepared.since ? Date.parse(prepared.since) : NaN;
  const last = prepared.votes.filter((vote) => vote.by.trim().toLowerCase() === me && !(Number.isFinite(since) && Date.parse(vote.at) <= since)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return !last || last.option === "retirado";
}

export function tallyOf(d: DecisionEventData, prepared: DecisionPrepared) {
  // A vote is for the wording it was given on: those from before this one was written do not count.
  const since = prepared.since ? Date.parse(prepared.since) : NaN;
  return tallyDecision({
    kind: d.kind,
    votes: Number.isFinite(since) ? prepared.votes.filter((vote) => Date.parse(vote.at) > since) : prepared.votes,
    proposer: d.by,
    authors: d.aligners,
    levels: prepared.levels,
    thresholds: d.thresholds,
    deadline: d.deadline,
    now: new Date(prepared.now),
  });
}


export const alineacionDecisionType: ChatEventType<DecisionPrepared> = {
  type: DECISION_EVENT,
  render: "decision",
  valid: (event) => alineacionDecisionData(event) !== null,
  title(event) {
    const d = alineacionDecisionData(event);
    return d ? decisionTitle(d) : event.summary;
  },
  panels(event): DecisionPanel[] {
    const d = alineacionDecisionData(event);
    if (!d) return [];
    const sid = `${d.book} ${d.chapter}:${d.verse}`;
    // What the proposer says, change by change when it was written that way (`changesNote`).
    const panels: DecisionPanel[] = [{ label: `Lo que dice @${d.by}`, text: d.note, custom: { kind: "reasons", data: { note: d.note } } }];
    const hasBoxes = d.view.original.length > 0;
    const boxes = (draft: DecisionView["draftBefore"], groups: AlignmentGroup[]) => boxesOf(d.view, draft, groups, sid);
    if (d.kind === "proposal") {
      if (editsText(d)) {
        panels.push({
          label: "Texto del versículo",
          text: `${d.oldText} → ${d.newText}`,
          tag: "cambia",
          custom: { kind: "diff", data: { pieces: wordDiff(d.oldText, d.newText) } },
        });
      }
      if (hasBoxes) {
        const before = boxes(d.view.draftBefore, d.groupsBefore);
        const after = boxes(d.view.draftAfter, d.groupsAfter);
        panels.push(
          { label: "Alineación ahora", text: d.before.join("\n"), custom: { kind: "cajas", data: { view: d.view, draft: "before", groups: d.groupsBefore, sid } } },
          {
            label: "Alineación propuesta",
            text: d.after.join("\n"),
            tag: "lo que cambia va resaltado",
            custom: { kind: "cajas", data: { view: d.view, draft: "after", groups: d.groupsAfter, sid, highlight: { tone: "changed", keys: [...changedBoxKeys(before, after)] } } },
          },
        );
      } else {
        // Without the boxes the links are lines of words: who decides a change of wording reads them only if they
        // want. Open, they took 358 px of a phone between the change and the buttons.
        const fold = editsText(d) ? { fold: true as const } : {};
        panels.push({ label: "Alineación ahora", text: d.before.join("\n"), ...fold }, { label: "Alineación propuesta", text: d.after.join("\n"), tag: "propuesta", ...fold });
      }
    } else if (hasBoxes) {
      const now = boxes(d.view.draftBefore, d.groupsBefore);
      panels.push({
        label: "Alineación ahora",
        text: d.before.join("\n"),
        tag: d.words.length ? "lo objetado va en amarillo" : undefined,
        custom: { kind: "cajas", data: { view: d.view, draft: "before", groups: d.groupsBefore, sid, highlight: { tone: "objected", keys: [...objectedBoxKeys(now, d.words)] } } },
      });
    } else {
      if (d.words.length) panels.push({ label: "Palabras señaladas", text: d.words.join(" · ") });
      panels.push({ label: "Alineación ahora", text: d.before.join("\n") });
    }
    // A change of wording is read as on the proposal screen: what changes, then why.
    const change = panels.findIndex((panel) => panel.custom?.kind === "diff");
    if (change > 0) panels.unshift(...panels.splice(change, 1));
    return panels;
  },
  group: (event) => event.decision?.id ?? null,
  options(event, ctx): DecisionOption[] {
    const d = alineacionDecisionData(event);
    if (!d) return [];
    const { yes, no } = optionsFor(d.kind);
    const prepared = ctx.prepared;
    const me = ctx.viewer.username.trim().toLowerCase();
    const tally = prepared ? tallyOf(d, prepared) : null;
    const since = prepared?.since ? Date.parse(prepared.since) : NaN;
    const mine = prepared?.votes.filter((v) => v.by.trim().toLowerCase() === me && !(Number.isFinite(since) && Date.parse(v.at) <= since)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    const reason = ctx.prepareError
      ? `No se pudieron leer los votos: ${ctx.prepareError}`
      : !prepared
        ? "Comprobando los votos…"
        : prepared.closed
          ? "Esta decisión ya se cerró."
          : me === d.by.trim().toLowerCase()
            ? "Es tuya: ya cuenta a favor."
            : null;
    const winner = prepared && !prepared.closed ? tally?.winner : undefined;
    const make = (id: DecisionOptionId): DecisionOption => {
      const n = tally?.counts[id].people.length ?? 0;
      return {
        id,
        label: `${OPTION_LABEL[id]}${n ? ` (${n})` : ""}${mine?.option === id ? " ✓" : ""}`,
        // One filled button: once this person voted, or when it is theirs, the screen's way on is the filled one.
        primary: id === yes && !winner && !mine && me !== d.by.trim().toLowerCase(),
        blockReason: reason,
        busyLabel: "Guardando tu voto…",
        // A no to a proposal says why, so that whoever proposed knows what to word again.
        ...(id === no && d.kind === "proposal" ? { input: { label: "¿Por qué no? Di qué cambiarías" } } : {}),
      };
    };
    const out: DecisionOption[] = [];
    // Closing, and withdrawing a vote against for someone who is not there, are for the habilitadas of the team.
    const enabled = prepared ? prepared.levels[me] === "habilitada" : false;
    if (winner && prepared && enabled) {
      // Nothing is applied by the votes alone: a person confirms the consensus first, seeing who backs what.
      const applies = d.kind === "proposal" && winner === "aceptar" ? " Se aplicará la alineación propuesta." : d.kind === "objection" && winner === "cambiar" ? " Se le pedirá a quien alineó que la ajuste." : "";
      out.push({
        id: "confirmar",
        label: "Confirmar el consenso y cerrar",
        primary: true,
        blockReason: null,
        confirm: `Hay consenso en «${OPTION_LABEL[winner]}». ${voteSummary(d, prepared)}${applies} ¿Confirmas que el equipo está de acuerdo y se cierra?`,
        busyLabel: "Cerrando la decisión…",
      });
    }
    out.push(make(yes), make(no));
    if (prepared && !prepared.closed && enabled) {
      const counted = Number.isFinite(since) ? prepared.votes.filter((v) => Date.parse(v.at) > since) : prepared.votes;
      for (const vote of latestVotes(counted)) {
        if (vote.option !== no || vote.by.trim().toLowerCase() === me) continue;
        out.push({
          id: `retirar:${vote.by}`,
          label: `Retirar el voto en contra de @${vote.by}`,
          blockReason: null,
          busyLabel: "Retirando el voto…",
          input: { label: `¿Por qué lo retiras? Por ejemplo, @${vote.by} no está disponible` },
          confirm: `El voto en contra de @${vote.by} dejará de contar, y se le avisará. Hazlo solo si no está para retirarlo.`,
        });
      }
    }
    // Whoever made it puts it right while nobody has voted on it: the wording and the reason, in place.
    if (prepared && !prepared.closed && mayEdit(d, ctx.viewer.username, prepared)) {
      out.push({
        id: "editar",
        label: "Editar mi propuesta",
        blockReason: null,
        busyLabel: "Guardando la propuesta…",
        input: { label: "El versículo como lo propones", initial: d.newText, verse: true, second: { label: "Por qué lo propones", initial: d.note } },
      });
    }
    // A proposal that changes the text is talked over until it is decided: anybody of the two teams words it
    // again, and the team may go back to a wording it had.
    if (prepared && !prepared.closed && editsText(d) && mayReword(d, ctx.viewer, prepared.owners)) {
      out.push({ id: "version", label: "Proponer otra versión", blockReason: null, busyLabel: "Guardando la versión…", input: { label: "El versículo como lo propones ahora", initial: d.newText } });
      for (const before of d.history ?? []) {
        if (sameText(before.text, d.newText)) continue;
        out.push({
          id: `volver:${before.n}`,
          label: `Volver a la versión ${before.n}`,
          blockReason: null,
          confirm: `La versión ${before.n}, de @${before.by}, decía: «${before.text}». Se propone de nuevo y los votos empiezan otra vez.`,
          busyLabel: "Guardando la versión…",
        });
      }
    }
    return out;
  },
  decided(event, resolution) {
    const c = closeData(resolution);
    return c ? { event, title: resolution.summary, options: [] } : null;
  },
  resolves(event) {
    return closeData(event)?.decisionId ?? null;
  },
};

registerChatEventType(alineacionDecisionType);
registerChatEventType({ type: VOTE_EVENT, render: "system", valid: (e) => voteData(e) !== null, title: (e) => e.summary });
registerChatEventType({ type: EDIT_EVENT, render: "system", title: (e) => e.summary });
registerChatEventType({ type: WITHDRAW_EVENT, render: "system", valid: (e) => withdrawData(e) !== null, title: (e) => e.summary });
registerChatEventType({ type: CONSENSUS_EVENT, render: "system", valid: (e) => consensusData(e) !== null, title: (e) => e.summary });
registerChatEventType({ type: CLOSE_EVENT, render: "system", valid: (e) => closeData(e) !== null, title: (e) => e.summary, resolves: (e) => closeData(e)?.decisionId ?? null });
