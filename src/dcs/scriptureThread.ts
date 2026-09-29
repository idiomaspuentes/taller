/**
 * Scripture mini-app hooks for the generic conversation: cite provider
 * (and, from slice 5, the `verse-conflict` event type). The thread view
 * never imports this module; `src/conversationTypes.ts` registers it.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { readRepoFile } from "./repoFile";
import { registerCiteProvider } from "../domain/chatEvents/cites";
import { registerChatEventType } from "../domain/chatEvents/registry";
import { verseConflictType } from "../domain/chatEvents/verseConflict";
import type { ConflictPrepared } from "../domain/conflictChoice";
import { verseConflictData } from "../domain/verseConflictEvent";
import { prepareVerseChoice, runVerseChoice } from "./verseChoice";
import { archiveRefName, bookCodeFromWorkHead, parsePortionPrMarker } from "../domain/portionPr";
import { scriptureCiteTargets } from "../domain/scriptureCites";
import { bookCodeFromIssueTitle, refFromIssueTitle } from "../domain/solverLaunch";
import { bookUsfmName } from "../prep/discover";

async function readFirst(
  session: GtSession,
  owner: string,
  repo: string,
  filepath: string,
  refs: string[],
): Promise<string | null> {
  for (const branch of refs) {
    try {
      return (await readRepoFile({ session, owner, repo, filepath, branch })).text;
    } catch {
      /* try the next ref */
    }
  }
  return null;
}

registerChatEventType<ConflictPrepared>({
  ...verseConflictType,
  async prepare(event, env) {
    const session = env.session as GtSession | undefined;
    const data = verseConflictData(event);
    if (!session || !data) throw new Error("Sin sesión no se puede comprobar el versículo.");
    return prepareVerseChoice(session, data);
  },
  async run(optionId, event, env) {
    const session = env.session as GtSession | undefined;
    const pmOrg = typeof env.pmOrg === "string" ? env.pmOrg : "";
    const data = verseConflictData(event);
    if (!session || !pmOrg || !data || !event.decision) throw new Error("No se puede decidir sin sesión.");
    if (optionId !== "tronco" && optionId !== "desplazado") throw new Error("Opción desconocida.");
    return runVerseChoice({
      session,
      pmOrg,
      data,
      decisionId: event.decision.id,
      option: optionId,
      threadIssue: Number(env.issueNumber) || 0,
      remainingDecisions: Array.isArray(env.remainingDecisions) ? (env.remainingDecisions as string[]) : [],
      lang: typeof env.lang === "string" ? env.lang : undefined,
      projectId: typeof env.projectId === "string" ? env.projectId : undefined,
    });
  },
});

registerCiteProvider({
  id: "scripture-verses",
  async load(issue: DcsIssue, env) {
    const session = env.session as GtSession | undefined;
    const marker = parsePortionPrMarker(issue.body);
    if (!session || !marker) return [];
    const book = bookCodeFromIssueTitle(issue.title) || bookCodeFromWorkHead(marker.head).toUpperCase();
    if (!book) return [];
    const usfm = await readFirst(session, marker.owner, marker.repo, bookUsfmName(book), [
      marker.head,
      archiveRefName(book, issue.number),
      marker.base,
    ]);
    return usfm ? scriptureCiteTargets(usfm, book, refFromIssueTitle(issue.title)) : [];
  },
});
