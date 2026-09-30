import type { AlignmentGroup } from "@usfm-tools/types";
import { countsForMinimum, type PersonLevel } from "./levels";

/**
 * A proposal to change the alignment of a verse, or an objection to it, becomes a
 * decision of the whole team: a subtarea (an issue) where people talk in comments and
 * vote with one click. This module is the pure part: the records, the options, who
 * counts and when the team has decided. Nothing here touches Door43.
 *
 * - Proposal: carries the alignment the proposer wants. Options: aceptar / rechazar.
 * - Objection: carries no alignment, only the words it is about. Options: cambiar / mantener.
 */

export type DecisionKind = "proposal" | "objection";
export type DecisionOptionId = "aceptar" | "rechazar" | "cambiar" | "mantener";
export type DecisionOutcome = "aceptada" | "rechazada" | "realinear" | "mantenida" | "caducada";

export const PROPOSAL_SCHEMA = "gateway-alignment-proposal-1";
export const RESULT_SCHEMA = "gateway-alignment-result-1";

/** Days the team has to decide before whoever coordinates may close it. */
export const DECISION_DAYS = 3;

/** The proposal or the objection as the proposer saves it in the text repository. */
export type ProposalFile = {
  schema: typeof PROPOSAL_SCHEMA;
  id: string;
  kind: DecisionKind;
  book: string;
  chapter: number;
  verse: number;
  by: string;
  createdAt: string;
  /** Hash of the alignment this was made on; if the alignment changes, the proposal no longer applies. */
  baseHash: string;
  note: string;
  /** The subtarea where the team decides (its issue number). */
  issue?: number;
  /** Proposals that edit the text of the draft: the verse as it was and as it is proposed. */
  oldText?: string;
  newText?: string;
  /** Proposals only: the alignment the proposer wants (over the new text, if it changes). */
  proposed?: AlignmentGroup[];
  /** Objections only: the words of the original it is about, as «word#occurrence». */
  words?: string[];
};

/** What the team decided, written once when the decision closes. */
export type ResultFile = {
  schema: typeof RESULT_SCHEMA;
  id: string;
  kind: DecisionKind;
  book: string;
  chapter: number;
  verse: number;
  outcome: DecisionOutcome;
  /** Who closed it and how. */
  by: string;
  how: "consenso" | "coordinacion";
  at: string;
  /** The proposer, so whoever reads the result knows whose open answer it settles. */
  proposer: string;
  baseHash: string;
  /** The subtarea where it was decided. */
  issue?: number;
  /** Hash of the verse after an accepted proposal; it is what the new «terminado» is worth. */
  newHash?: string;
  note?: string;
};

export function newDecisionId(login: string, now: Date = new Date()): string {
  const clean = login.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "x";
  return `${clean}-${now.getTime().toString(36)}`;
}

function pad(book: string): string {
  return book.trim().toUpperCase();
}

export function proposalPath(book: string, chapter: number, verse: number, id: string): string {
  return `checkings/proposals/${pad(book)}.${chapter}-${verse}.${id}.proposal.json`;
}

export function resultPath(book: string, chapter: number, verse: number, id: string): string {
  return `checkings/proposals/${pad(book)}.${chapter}-${verse}.${id}.result.json`;
}

export const PROPOSALS_DIR = "checkings/proposals";

/** `NEH.1-1.ana-lx3k.proposal.json` → its parts, or null for any other file. */
export function parseProposalFilename(name: string): { book: string; chapter: number; verse: number; id: string; part: "proposal" | "result" } | null {
  const m = /^([A-Z0-9]{3})\.(\d+)-(\d+)\.([a-z0-9-]+)\.(proposal|result)\.json$/.exec(name);
  return m ? { book: m[1]!, chapter: Number(m[2]), verse: Number(m[3]), id: m[4]!, part: m[5] as "proposal" | "result" } : null;
}

export function optionsFor(kind: DecisionKind): { yes: DecisionOptionId; no: DecisionOptionId } {
  return kind === "proposal" ? { yes: "aceptar", no: "rechazar" } : { yes: "cambiar", no: "mantener" };
}

export const OPTION_LABEL: Record<DecisionOptionId, string> = {
  aceptar: "Aceptar la propuesta",
  rechazar: "Rechazar la propuesta",
  cambiar: "Hay que cambiar la alineación",
  mantener: "Mantener la alineación",
};

export type DecisionVote = { by: string; option: DecisionOptionId; at: string };

/** Each person's newest vote. */
export function latestVotes(votes: DecisionVote[]): DecisionVote[] {
  const byPerson = new Map<string, DecisionVote>();
  for (const v of votes) {
    const key = v.by.trim().toLowerCase();
    const prev = byPerson.get(key);
    if (!prev || Date.parse(v.at) >= Date.parse(prev.at)) byPerson.set(key, v);
  }
  return [...byPerson.values()];
}

export type DecisionThresholds = { minAgree: number; minIndependent: number };

export type OptionCount = {
  /** Habilitadas for this option, counting the proposer's own support and the author's. */
  agree: number;
  /** Of those, the ones who neither proposed nor aligned. */
  independent: number;
  /** Everyone who voted for it, habilitada or not. */
  people: string[];
};

export type DecisionTally = {
  counts: Record<DecisionOptionId, OptionCount>;
  /** The option that has consensus, if any. */
  winner?: DecisionOptionId;
  state: "abierta" | "decidida" | "plazo";
};

function blank(): OptionCount {
  return { agree: 0, independent: 0, people: [] };
}

/**
 * The team has decided when one option has the minimum of habilitadas, with the minimum
 * of independent ones, and nobody else backs the other option. The proposer supports
 * their own proposal (or objection) without voting. Past the deadline with no consensus
 * the decision waits for whoever coordinates.
 */
export function tallyDecision(params: {
  kind: DecisionKind;
  votes: DecisionVote[];
  proposer: string;
  /** Logins who aligned the verse: they count, but never as independent. */
  authors: string[];
  levels: Record<string, PersonLevel>;
  thresholds: DecisionThresholds;
  deadline: string;
  now: Date;
}): DecisionTally {
  const { yes, no } = optionsFor(params.kind);
  const proposer = params.proposer.trim().toLowerCase();
  const authors = new Set(params.authors.map((a) => a.trim().toLowerCase()));
  const counts: Record<DecisionOptionId, OptionCount> = { aceptar: blank(), rechazar: blank(), cambiar: blank(), mantener: blank() };

  const add = (option: DecisionOptionId, who: string) => {
    const key = who.trim().toLowerCase();
    const c = counts[option];
    if (!c.people.includes(who)) c.people.push(who);
    if (!countsForMinimum(params.levels[key])) return;
    c.agree++;
    if (key !== proposer && !authors.has(key)) c.independent++;
  };

  add(yes, params.proposer);
  for (const v of latestVotes(params.votes)) {
    if (v.by.trim().toLowerCase() === proposer) continue;
    if (v.option === yes || v.option === no) add(v.option, v.by);
  }

  const { minAgree, minIndependent } = params.thresholds;
  const othersForYes = counts[yes].people.filter((p) => p.trim().toLowerCase() !== proposer).length;
  const won = (option: DecisionOptionId, other: number) =>
    counts[option].agree >= minAgree && counts[option].independent >= minIndependent && other === 0;
  let winner: DecisionOptionId | undefined;
  if (won(yes, counts[no].people.length)) winner = yes;
  else if (won(no, othersForYes)) winner = no;

  const late = Number.isFinite(Date.parse(params.deadline)) && params.now.getTime() >= Date.parse(params.deadline);
  return { counts, ...(winner ? { winner } : {}), state: winner ? "decidida" : late ? "plazo" : "abierta" };
}

/** What each option means for the verse. */
export function outcomeOf(kind: DecisionKind, option: DecisionOptionId): DecisionOutcome {
  if (kind === "proposal") return option === "aceptar" ? "aceptada" : "rechazada";
  return option === "cambiar" ? "realinear" : "mantenida";
}

export function deadlineFrom(createdAt: Date, days: number = DECISION_DAYS): string {
  return new Date(createdAt.getTime() + days * 86_400_000).toISOString();
}

/** People left to ask: habilitadas of the team who have not voted and did not propose. */
export function waitingOn(params: { team: string[]; levels: Record<string, PersonLevel>; votes: DecisionVote[]; proposer: string }): string[] {
  const voted = new Set(latestVotes(params.votes).map((v) => v.by.trim().toLowerCase()));
  const proposer = params.proposer.trim().toLowerCase();
  return params.team.filter((login) => {
    const key = login.trim().toLowerCase();
    return key !== proposer && !voted.has(key) && countsForMinimum(params.levels[key]);
  });
}

/**
 * Open answers settled by the team: a «revise» or «rejected» answer made when the proposal
 * or objection was sent stops blocking the verse once the team decided not to change it.
 * Answers to a decision that ended with a change still go stale by themselves, because the
 * alignment hash changes.
 */
export function settledProposalIds(results: ResultFile[]): Set<string> {
  return new Set(results.filter((r) => r.outcome === "rechazada" || r.outcome === "mantenida" || r.outcome === "caducada").map((r) => r.id));
}
