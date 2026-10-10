/**
 * Render side of a team decision about an alignment: the card with the proposal or the
 * objection, the votes (one system line each) and the closing. Pure; reading the votes and
 * writing is attached by `src/dcs/alignmentDecisionThread.ts`.
 */
import type { PersonLevel } from "../levels";
import type { ChatEvent } from "../chatEvent";
import {
  OPTION_LABEL,
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
};

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

export function buildVoteEvent(params: { issue: number; data: DecisionEventData; by: string; option: DecisionOptionId }): Omit<ChatEvent, "schema"> {
  return {
    type: VOTE_EVENT,
    emitter: "afinacion",
    issue: params.issue,
    summary: `@${params.by} votó: ${OPTION_LABEL[params.option]}`,
    data: { decisionId: decisionId(params.data), option: params.option, by: params.by },
  };
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

export function voteData(event: ChatEvent): { decisionId: string; option: DecisionOptionId; by: string } | null {
  const d = event.data as { decisionId?: string; option?: DecisionOptionId; by?: string } | undefined;
  if (event.type !== VOTE_EVENT || !d?.decisionId || !d.option || !d.by) return null;
  return { decisionId: d.decisionId, option: d.option, by: d.by };
}

/** What the card needs to know about the thread: the votes so far and, if it is over, how it ended. */
export type DecisionPrepared = {
  votes: DecisionVote[];
  levels: Record<string, PersonLevel>;
  closed?: ChatEvent;
  /** ISO time the votes were read, so the card can tell if the deadline has passed. */
  now: string;
};

/** Everything the thread says about one decision. */
export function readDecisionThread(events: Array<{ event: ChatEvent; at: string }>, id: string): { votes: DecisionVote[]; closed?: ChatEvent } {
  const votes: DecisionVote[] = [];
  let closed: ChatEvent | undefined;
  for (const { event, at } of events) {
    const v = voteData(event);
    if (v && v.decisionId === id) votes.push({ by: v.by, option: v.option, at });
    const c = closeData(event);
    if (c && c.decisionId === id) closed = event;
  }
  return { votes, closed };
}

/** Plain text of who backs what, for the confirmation before closing. */
export function voteSummary(d: DecisionEventData, prepared: DecisionPrepared): string {
  const t = tallyOf(d, prepared);
  const { yes, no } = optionsFor(d.kind);
  const line = (id: DecisionOptionId) => `${OPTION_LABEL[id]}: ${t.counts[id].people.length ? t.counts[id].people.map((p) => `@${p}`).join(", ") : "nadie"}`;
  return `${line(yes)}. ${line(no)}.`;
}

export function tallyOf(d: DecisionEventData, prepared: DecisionPrepared) {
  return tallyDecision({
    kind: d.kind,
    votes: prepared.votes,
    proposer: d.by,
    authors: d.aligners,
    levels: prepared.levels,
    thresholds: d.thresholds,
    deadline: d.deadline,
    now: new Date(prepared.now),
  });
}

const SHORT: Record<DecisionOptionId, string> = { aceptar: "aceptar", rechazar: "rechazar", cambiar: "cambiarla", mantener: "mantenerla" };

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
    const panels: DecisionPanel[] = [{ label: `Lo que dice @${d.by}`, text: d.note }];
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
        panels.push({ label: "Alineación ahora", text: d.before.join("\n") }, { label: "Alineación propuesta", text: d.after.join("\n"), tag: "propuesta" });
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
    const mine = prepared?.votes.filter((v) => v.by.trim().toLowerCase() === me).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
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
        primary: id === yes && !winner,
        blockReason: reason,
        busyLabel: "Guardando tu voto…",
      };
    };
    const out: DecisionOption[] = [];
    if (winner && prepared) {
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
    if (prepared && !prepared.closed && tally?.state === "plazo" && ctx.viewer.canManage) {
      for (const id of [yes, no]) {
        out.push({
          id: `coord:${id}`,
          label: `Decidir yo: ${SHORT[id]}`,
          blockReason: null,
          confirm: `Pasó el plazo sin consenso. Vas a decidir ${SHORT[id]} en nombre del equipo.`,
          busyLabel: "Cerrando la decisión…",
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
registerChatEventType({ type: CONSENSUS_EVENT, render: "system", valid: (e) => consensusData(e) !== null, title: (e) => e.summary });
registerChatEventType({ type: CLOSE_EVENT, render: "system", valid: (e) => closeData(e) !== null, title: (e) => e.summary, resolves: (e) => closeData(e)?.decisionId ?? null });
