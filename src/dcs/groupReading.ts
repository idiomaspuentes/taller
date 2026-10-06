import type { GtSession } from "./auth";
import { groupDraftBranches } from "./afinacionLoad";
import { loadDecisionFiles, type RepoTarget } from "./afinacionStore";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { listProjectIssues, loadPmConfig } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import { passagesOf, readingItemId, type PassageRange, type ReadingText } from "../domain/groupReading";
import type { LevelBook } from "../domain/levels";
import { issueTaskId } from "../domain/myTasks";
import { loadEnglishScriptureChapterUsfm } from "../domain/referenceResources";
import { mergeDecisionFiles, type ReviewDecision } from "../domain/reviewRound";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import { chapterFromIssue, refFromIssueTitle, type SolverLaunchContext } from "../domain/solverLaunch";
import { SCOPE_LABEL, type ProjectTask, type ScopeKey } from "../domain/types";
import { tryParseUsj, verseTextsFromUsj, type VerseTextMap } from "../domain/usfmAst";
import { parseRefRange } from "../domain/usfmEdit";

const WHOLE_CHAPTER = (chapter: number) => ({ chapter, from: 1, to: 200 });

/** One of the texts read together: where its group draft lives, and its chapter as it is there now. */
export type GroupReadingText = ReadingText & {
  name: string;
  /** The task that translates it, whose deliveries make up the group's draft. */
  taskId: string;
  /** Absent while nobody has delivered anything of the book: there is no group draft yet. */
  draft: (RepoTarget & { filepath: string }) | null;
};

export type GroupReadingData = {
  book: string;
  chapter: number;
  task: ProjectTask | null;
  passages: PassageRange[];
  texts: GroupReadingText[];
  /** The source texts, to read the translation against. */
  sources: { short: string; verses: VerseTextMap }[];
  decisions: ReviewDecision[];
  /** Who translated each verse of each text (by item id): they answer, but never count as an independent reader. */
  authorsByItem: Record<string, string[]>;
  levelBook: LevelBook;
  /** The team whose levels count: this task's, or without one, the team that translated what is read. */
  teamName?: string;
};

/**
 * Everything the group review of a stretch shows. Which texts are read comes from the plan: the tasks this one
 * waits for, each with the resource it translates.
 */
export async function loadGroupReading(session: GtSession, ctx: SolverLaunchContext): Promise<GroupReadingData> {
  const chapter = ctx.chapter;
  const [board, pmConfig, all] = await Promise.all([
    loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg),
    loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG),
    listProjectIssues(session, ctx.pmOrg, ctx.projectId)
      .then((found) => found.issues)
      .catch(() => []),
  ]);
  const task = board?.teams.find((row) => row.id === ctx.taskId) ?? null;
  const awaited = (task?.waitsFor ?? []).flatMap((rule) => (rule.taskId && !rule.source ? (board?.teams.filter((row) => row.id === rule.taskId) ?? []) : []));

  const texts: GroupReadingText[] = [];
  const authorsByItem: Record<string, string[]> = {};
  const decisionFiles = [];
  let book = (ctx.book || ctx.projectId).toUpperCase();
  for (const source of awaited) {
    const resource = source.rules[0]?.resource;
    if (!resource || texts.some((text) => text.resource === resource)) continue;
    const target = resolveScriptureTarget({ ...ctx, resource }, pmConfig);
    if ("error" in target) continue;
    book = target.book;
    const found = await tryReadExistingBookUsfm({ session, owner: target.owner, repo: target.repo, filepath: target.filepath, branches: groupDraftBranches(target.book, source.id) }).catch(() => null);
    const usj = found?.branch ? tryParseUsj(found.text) : null;
    const draft = found?.branch ? { owner: target.owner, repo: target.repo, branch: found.branch, filepath: target.filepath } : null;
    const pending: PassageRange[] = [];
    texts.push({
      resource,
      pending,
      name: board?.settings?.resourceNames?.[resource as ScopeKey]?.name || SCOPE_LABEL[resource as ScopeKey] || resource.toUpperCase(),
      taskId: source.id,
      draft,
      verses: (usj && verseTextsFromUsj(usj, WHOLE_CHAPTER(chapter))) || {},
    });
    if (draft) decisionFiles.push(...(await loadDecisionFiles(session, draft, target.book).catch(() => [])));
    for (const issue of all) {
      if (issueTaskId(issue) !== source.id || chapterFromIssue(issue) !== chapter) continue;
      const who = issue.assignee?.login || issue.assignees?.[0]?.login;
      const range = parseRefRange(refFromIssueTitle(issue.title ?? ""));
      if (range && issue.state !== "closed") pending.push({ from: range.from, to: range.to });
      if (!who || !range) continue;
      for (let verse = range.from; verse <= range.to; verse++) authorsByItem[readingItemId(resource, chapter, verse)] = [who];
    }
  }

  const loaded = await Promise.all((["ult", "ust"] as const).map((kind) => loadEnglishScriptureChapterUsfm(session, kind, book, chapter).catch(() => null)));
  const sources = loaded.flatMap((pane) => {
    const usj = pane ? tryParseUsj(pane.usfm) : null;
    const verses = usj ? verseTextsFromUsj(usj, WHOLE_CHAPTER(chapter)) : null;
    return pane && verses ? [{ short: pane.meta.short, verses }] : [];
  });
  const lastVerse = Math.max(0, ...sources.flatMap((source) => Object.keys(source.verses).map(Number)), ...texts.flatMap((text) => Object.keys(text.verses).map(Number)));

  return {
    book,
    chapter,
    task,
    passages: passagesOf(ctx.itemIds, chapter, lastVerse),
    texts,
    sources,
    decisions: mergeDecisionFiles(decisionFiles),
    authorsByItem,
    levelBook: pmConfig,
    teamName: task?.orgTeamName || awaited.find((row) => row.orgTeamName)?.orgTeamName,
  };
}
