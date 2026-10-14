/**
 * Conversation hooks for the team decision about an alignment: what the card reads
 * before it offers its options (the votes so far) and what pressing one does (a vote,
 * and the closing if the team has now decided). `src/conversationTypes.ts` imports it.
 */
import type { GtSession } from "./auth";
import { closeAlignmentDecision, editProposal, postVote, postWithdrawal, readDecisionVotes, rewordProposal } from "./alignmentDecisionStore";
import { loadPmConfig } from "./issues";
import { decisionLevels, latestVotes, optionsFor } from "../domain/alignmentDecision";
import { issueTaskId } from "../domain/myTasks";
import { loadAssignmentsFromDcs } from "./persist";
import { getPmIssue } from "./portionPr";
import { formatChatEvent } from "../domain/chatEvent";
import {
  alineacionDecisionData,
  alineacionDecisionType,
  buildConsensusEvent,
  editsText,
  mayEdit,
  mayReword,
  decisionId,
  tallyOf,
  type DecisionPrepared,
} from "../domain/chatEvents/alineacionDecision";
import { commentToItem } from "../domain/conversation";
import { PM_REPO_NAME } from "../domain/types";
import { createIssueComment } from "@ip-lms/dcs-client";
import { dcsConfig } from "./config";
import { registerChatEventType } from "../domain/chatEvents/registry";
import { askRedoAfterCorrection, redoSaid } from "./redoAfterCorrection";
import { tasksToRedoAfter } from "../domain/processes";
import { teamKey } from "../domain/levels";
import { correctedRef, type TextCorrected } from "../domain/redoAfterCorrection";
import { parseWorkOrderMarker } from "../domain/workOrder";
import { tNow } from "../i18n/messages";
import type { DecisionEventData } from "../domain/chatEvents/alineacionDecision";
import type { ThreadItem } from "../domain/conversation";

function envOf(env: Record<string, unknown>) {
  const session = env.session as GtSession | undefined;
  const pmOrg = typeof env.pmOrg === "string" ? env.pmOrg : "";
  const threadIssue = Number(env.issueNumber) || 0;
  if (!session || !pmOrg || !threadIssue) throw new Error("Sin sesión no se puede votar.");
  return { session, pmOrg, threadIssue };
}

/** The levels of the team that has the task of this decision's subtarea (see `decisionLevels`). */
async function teamLevelsOf(env: Record<string, unknown>) {
  const { session, pmOrg, threadIssue } = envOf(env);
  const config = await loadPmConfig(session, pmOrg).catch(() => null);
  if (!config) return {};
  const lang = typeof env.lang === "string" ? env.lang : "";
  const projectId = typeof env.projectId === "string" ? env.projectId : "";
  const contentOrg = typeof env.contentOrg === "string" ? env.contentOrg : "";
  if (!lang || !projectId || !contentOrg) return decisionLevels(config, undefined);
  const [issue, board] = await Promise.all([getPmIssue(session, pmOrg, threadIssue).catch(() => null), loadAssignmentsFromDcs(session, pmOrg, lang, projectId, contentOrg)]);
  const team = issue ? board?.teams.find((task) => task.id === issueTaskId(issue))?.orgTeamName : undefined;
  return decisionLevels(config, team);
}

/**
 * The people of the team that has the text of a decision in its hands: those of the first phase, among the tasks
 * that look at that text again when it is corrected, that the plan has. When the proposal was made from that same
 * team they are the people it already tells; from another team (a reading of an earlier phase, a later one), they
 * are the other team the proposal concerns. Nobody when the plan cannot be read: the proposal's own team is left.
 */
async function textOwners(env: Record<string, unknown>, data: DecisionEventData): Promise<string[]> {
  try {
    const { session, pmOrg } = envOf(env);
    const lang = typeof env.lang === "string" ? env.lang : "";
    const projectId = typeof env.projectId === "string" ? env.projectId : "";
    const contentOrg = typeof env.contentOrg === "string" ? env.contentOrg : "";
    if (!lang || !projectId || !contentOrg || !data.parentIssue) return [];
    const [config, board, parent] = await Promise.all([loadPmConfig(session, pmOrg), loadAssignmentsFromDcs(session, pmOrg, lang, projectId, contentOrg), getPmIssue(session, pmOrg, data.parentIssue)]);
    const resource = parseWorkOrderMarker(parent.body ?? "")?.resource;
    if (!board || !resource) return [];
    const named = new Set(tasksToRedoAfter(resource));
    const order = new Map(board.phases.map((phase) => [phase.id, phase.order]));
    const tasks = board.teams.filter((row) => named.has(row.id)).sort((a, b) => (order.get(a.phaseId) ?? 0) - (order.get(b.phaseId) ?? 0));
    const first = tasks[0]?.phaseId;
    const holders = tasks.filter((row) => row.phaseId === first);
    const teams = new Set(holders.map((row) => teamKey(row.orgTeamName)).filter(Boolean));
    // Whoever is looking is of that team when Door43 says so, or when the plan lists them in one of its tasks.
    const me = session.username.trim().toLowerCase();
    const mine = (session.teams ?? []).some((team) => team.organization?.name === pmOrg && teams.has(teamKey(team.name))) || holders.some((row) => (row.memberIds ?? []).some((id) => id.toLowerCase() === me));
    // A team with no levels of its own is read by the levels of everybody: that names nobody in particular.
    return [...new Set([...[...teams].flatMap((team) => Object.keys(config.teamLevels?.[team] ?? {})), ...(mine ? [session.username] : [])])];
  } catch {
    return [];
  }
}

const sameWords = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/**
 * The team accepted a proposal that changes the text, and it is in the draft: the tasks that had delivered their
 * work on that verse are asked to look at it again, and the conversation of the decision says which. A proposal
 * that changes links alone asks nothing: the alignment is the work in hand. What cannot be asked is said too, so
 * that the correction is not left with nobody knowing that its reviews stand on another text.
 */
async function redoAfterAccepted(env: Record<string, unknown>, data: DecisionEventData, outcome: string): Promise<ThreadItem[]> {
  if (outcome !== "aceptada" || sameWords(data.oldText ?? "", data.newText ?? "")) return [];
  const { session, pmOrg, threadIssue } = envOf(env);
  const lang = typeof env.lang === "string" ? env.lang : "";
  const projectId = typeof env.projectId === "string" ? env.projectId : "";
  const contentOrg = typeof env.contentOrg === "string" ? env.contentOrg : "";
  const ref = correctedRef({ chapter: data.chapter, from: data.verse, to: data.verse });
  let said = "";
  try {
    if (!lang || !projectId || !contentOrg) throw new Error(tNow("redo.noProject"));
    // Which text it is: the one the subtarea the proposal was made from works on.
    const parent = data.parentIssue ? await getPmIssue(session, pmOrg, data.parentIssue) : null;
    const resource = parent ? parseWorkOrderMarker(parent.body ?? "")?.resource : undefined;
    if (!resource) throw new Error(tNow("redo.noProject"));
    const corrected: TextCorrected = { resource, chapter: data.chapter, from: data.verse, to: data.verse, decision: threadIssue, by: session.username };
    said = redoSaid(ref, await askRedoAfterCorrection({ session, pmOrg, lang, projectId, contentOrg, corrected }), tNow);
  } catch (err) {
    said = tNow("redo.failed").replace("{ref}", ref).replace("{why}", err instanceof Error ? err.message : String(err));
  }
  if (!said) return [];
  const comment = await createIssueComment(dcsConfig(session.host), pmOrg, PM_REPO_NAME, threadIssue, said, session.token).catch(() => null);
  return comment ? [commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME })] : [];
}

registerChatEventType<DecisionPrepared>({
  ...alineacionDecisionType,
  async prepare(event, env) {
    const { session, pmOrg, threadIssue } = envOf(env);
    const data = alineacionDecisionData(event);
    if (!data) throw new Error("La decisión no es válida.");
    const [thread, levels, owners] = await Promise.all([readDecisionVotes(session, pmOrg, threadIssue, decisionId(data)), teamLevelsOf(env).catch(() => ({})), editsText(data) ? textOwners(env, data) : Promise.resolve([])]);
    return { votes: thread.votes, levels, closed: thread.closed, since: thread.since, owners, now: new Date().toISOString() };
  },
  async run(optionId, event, env) {
    const { session, pmOrg, threadIssue } = envOf(env);
    const data = alineacionDecisionData(event);
    if (!data) throw new Error("La decisión no es válida.");
    const id = decisionId(data);
    const before = await readDecisionVotes(session, pmOrg, threadIssue, id);
    if (before.closed) throw new Error("Esta decisión ya se cerró.");

    const levels = await teamLevelsOf(env).catch(() => ({}));
    const tallyNow = (votes: typeof before.votes) => tallyOf(data, { votes, levels, since: before.since, now: new Date().toISOString() });

    // Closing is always a person's decision: they confirm that the consensus is real. Nobody closes it for the
    // team without it, not even past the deadline: then the approvals asked for are fewer, but they are still asked.
    const enabled = (levels as Record<string, string>)[session.username.trim().toLowerCase()] === "habilitada";
    if (optionId === "confirmar") {
      if (!enabled) throw new Error("Solo una persona habilitada del equipo puede cerrar la decisión.");
      const winner = tallyNow(before.votes).winner;
      if (!winner) throw new Error("Ya no hay consenso: alguien cambió su voto. Mira los votos de nuevo.");
      const closed = await closeAlignmentDecision({ session, pmOrg, threadIssue, data, option: winner, how: "consenso" });
      return [...closed.items, ...(await redoAfterAccepted(env, data, closed.outcome))];
    }

    const said = typeof env.input === "string" ? env.input.trim() : "";
    // A vote against stays until whoever cast it withdraws it; when they are not there, a habilitada of the team may.
    if (optionId.startsWith("retirar:")) {
      const of = optionId.slice("retirar:".length);
      if (!enabled) throw new Error("Solo una persona habilitada del equipo puede retirar el voto de otra.");
      if (of.toLowerCase() === session.username.toLowerCase()) throw new Error("Es tu voto: vota de nuevo para cambiarlo.");
      if (!said) throw new Error("Di por qué lo retiras.");
      const { no } = optionsFor(data.kind);
      const counted = before.since ? before.votes.filter((v) => Date.parse(v.at) > Date.parse(before.since!)) : before.votes;
      const theirs = latestVotes(counted).find((v) => v.by.toLowerCase() === of.toLowerCase());
      if (theirs?.option !== no) throw new Error(`@${of} ya no tiene un voto en contra.`);
      const hadConsensus = Boolean(tallyNow(before.votes).winner);
      const withdrawn = await postWithdrawal(session, pmOrg, threadIssue, data, of, said);
      const after = await readDecisionVotes(session, pmOrg, threadIssue, id);
      const tally = tallyNow(after.votes);
      if (!tally.winner || hadConsensus) return [withdrawn];
      const notice = buildConsensusEvent({ issue: threadIssue, data, winner: tally.winner, people: tally.counts[tally.winner].people });
      const comment = await createIssueComment(dcsConfig(session.host), pmOrg, PM_REPO_NAME, threadIssue, formatChatEvent(notice), session.token);
      return [withdrawn, commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME })];
    }
    // Its author puts it right before anybody votes; once somebody has, it is worded again instead.
    if (optionId === "editar") {
      if (!mayEdit(data, session.username, { votes: before.votes, since: before.since, closed: before.closed })) {
        throw new Error("Ya hay votos sobre esta versión: para cambiarla, propón otra versión.");
      }
      const commentId = Number(env.cardCommentId) || 0;
      if (!commentId) throw new Error("No se encontró la tarjeta de la propuesta.");
      return editProposal({ session, pmOrg, threadIssue, commentId, data, text: said, note: typeof env.input2 === "string" ? env.input2 : data.note });
    }
    // Another wording, or one the proposal had before: the next version, in this same conversation.
    if (optionId === "version" || optionId.startsWith("volver:")) {
      if (!mayReword(data, { username: session.username, canManage: Boolean(session.canManage) }, await textOwners(env, data))) throw new Error("Solo los dos equipos de esta propuesta pueden escribirla de otra forma.");
      const back = optionId.startsWith("volver:") ? (data.history ?? []).find((row) => row.n === Number(optionId.slice("volver:".length))) : undefined;
      if (optionId !== "version" && !back) throw new Error("Esa versión ya no está en la conversación.");
      return [await rewordProposal({ session, pmOrg, threadIssue, data, text: back ? back.text : said, note: back ? `Vuelve a la versión ${back.n}, de @${back.by}.` : "" })];
    }

    const { yes, no } = optionsFor(data.kind);
    if (optionId !== yes && optionId !== no) throw new Error("Opción desconocida.");
    if (session.username.toLowerCase() === data.by.toLowerCase()) throw new Error("Es tu propuesta: ya cuenta a favor.");
    if (optionId === no && data.kind === "proposal" && !said) throw new Error("Di por qué no, para que se pueda escribir de otra forma.");

    const hadConsensus = Boolean(tallyNow(before.votes).winner);
    const vote = await postVote(session, pmOrg, threadIssue, data, optionId, optionId === no ? said : undefined);
    const after = await readDecisionVotes(session, pmOrg, threadIssue, id);
    const tally = tallyNow(after.votes);
    // The votes only record; when they first reach consensus the people concerned are told to confirm it.
    if (!tally.winner || hadConsensus) return [vote];
    const notice = buildConsensusEvent({ issue: threadIssue, data, winner: tally.winner, people: tally.counts[tally.winner].people });
    const comment = await createIssueComment(dcsConfig(session.host), pmOrg, PM_REPO_NAME, threadIssue, formatChatEvent(notice), session.token);
    return [vote, commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME })];
  },
});
