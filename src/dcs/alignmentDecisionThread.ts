/**
 * Conversation hooks for the team decision about an alignment: what the card reads
 * before it offers its options (the votes so far) and what pressing one does (a vote,
 * and the closing if the team has now decided). `src/conversationTypes.ts` imports it.
 */
import type { GtSession } from "./auth";
import { closeAlignmentDecision, postVote, readDecisionVotes } from "./alignmentDecisionStore";
import { loadPmConfig } from "./issues";
import { decisionLevels, optionsFor, type DecisionOptionId } from "../domain/alignmentDecision";
import { issueTaskId } from "../domain/myTasks";
import { loadAssignmentsFromDcs } from "./persist";
import { getPmIssue } from "./portionPr";
import { formatChatEvent } from "../domain/chatEvent";
import {
  alineacionDecisionData,
  alineacionDecisionType,
  buildConsensusEvent,
  decisionId,
  tallyOf,
  type DecisionPrepared,
} from "../domain/chatEvents/alineacionDecision";
import { commentToItem } from "../domain/conversation";
import { PM_REPO_NAME } from "../domain/types";
import { createIssueComment } from "@ip-lms/dcs-client";
import { dcsConfig } from "./config";
import { registerChatEventType } from "../domain/chatEvents/registry";

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

registerChatEventType<DecisionPrepared>({
  ...alineacionDecisionType,
  async prepare(event, env) {
    const { session, pmOrg, threadIssue } = envOf(env);
    const data = alineacionDecisionData(event);
    if (!data) throw new Error("La decisión no es válida.");
    const [thread, levels] = await Promise.all([readDecisionVotes(session, pmOrg, threadIssue, decisionId(data)), teamLevelsOf(env).catch(() => ({}))]);
    return { votes: thread.votes, levels, closed: thread.closed, now: new Date().toISOString() };
  },
  async run(optionId, event, env) {
    const { session, pmOrg, threadIssue } = envOf(env);
    const data = alineacionDecisionData(event);
    if (!data) throw new Error("La decisión no es válida.");
    const id = decisionId(data);
    const before = await readDecisionVotes(session, pmOrg, threadIssue, id);
    if (before.closed) throw new Error("Esta decisión ya se cerró.");

    const levels = await teamLevelsOf(env).catch(() => ({}));
    const tallyNow = (votes: typeof before.votes) => tallyOf(data, { votes, levels, now: new Date().toISOString() });

    // Whoever coordinates may close it past the deadline.
    if (optionId.startsWith("coord:")) {
      if (!session.canManage) throw new Error("Solo quien coordina puede decidir por el equipo.");
      const option = optionId.slice("coord:".length) as DecisionOptionId;
      const closed = await closeAlignmentDecision({ session, pmOrg, threadIssue, data, option, how: "coordinacion" });
      return closed.items;
    }

    // Closing is always a person's decision: they confirm that the consensus is real.
    if (optionId === "confirmar") {
      const winner = tallyNow(before.votes).winner;
      if (!winner) throw new Error("Ya no hay consenso: alguien cambió su voto. Mira los votos de nuevo.");
      const closed = await closeAlignmentDecision({ session, pmOrg, threadIssue, data, option: winner, how: "consenso" });
      return closed.items;
    }

    const { yes, no } = optionsFor(data.kind);
    if (optionId !== yes && optionId !== no) throw new Error("Opción desconocida.");
    if (session.username.toLowerCase() === data.by.toLowerCase()) throw new Error("Es tu propuesta: ya cuenta a favor.");

    const hadConsensus = Boolean(tallyNow(before.votes).winner);
    const vote = await postVote(session, pmOrg, threadIssue, data, optionId);
    const after = await readDecisionVotes(session, pmOrg, threadIssue, id);
    const tally = tallyNow(after.votes);
    // The votes only record; when they first reach consensus the people concerned are told to confirm it.
    if (!tally.winner || hadConsensus) return [vote];
    const notice = buildConsensusEvent({ issue: threadIssue, data, winner: tally.winner, people: tally.counts[tally.winner].people });
    const comment = await createIssueComment(dcsConfig(session.host), pmOrg, PM_REPO_NAME, threadIssue, formatChatEvent(notice), session.token);
    return [vote, commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME })];
  },
});
