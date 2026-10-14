import { addIssueLabels, createIssueComment, createLabel, createOrUpdateContents, editIssue, listLabels, listRepoIssues, type DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { draftTaskId, groupDraftBranches } from "./afinacionLoad";
import { readRepoFile } from "./afinacionStore";
import { openTextProposal } from "./alignmentDecisionStore";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { loadPmConfig, pmFacetLabel } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import { getDefaultBranch } from "./pulls";
import { bookName } from "../domain/books";
import { issueProjectId } from "../domain/myTasks";
import {
  refusedComment,
  readSuggestionBody,
  suggestionNote,
  suggestionTemplate,
  SUGGESTION_LABEL,
  SUGGESTION_TEMPLATE_PATH,
  TAKEN_LABEL,
  takenComment,
  textHolder,
  type OutsideSuggestion,
} from "../domain/outsideSuggestion";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { PM_REPO_NAME } from "../domain/types";
import { tryParseUsj, verseTextsFromUsj } from "../domain/usfmAst";

/** A repository where suggestions are received: the text it holds, and whether its form is there. */
export type IntakeRepo = { resource: "tpl" | "tps"; owner: string; repo: string; name: string; ready: boolean };

type Place = { session: GtSession; pmOrg: string; lang: string; contentOrg: string };

const RESOURCES: ("tpl" | "tps")[] = ["tpl", "tps"];

const targetOf = (place: Place, resource: string, book = "GEN", pmConfig?: Parameters<typeof resolveScriptureTarget>[1]) =>
  resolveScriptureTarget({ lang: place.lang, contentOrg: place.contentOrg, book, resource } as SolverLaunchContext, pmConfig);

/** The repositories of the texts, and whether each can receive suggestions already. */
export async function intakeRepos(place: Place): Promise<IntakeRepo[]> {
  const { session } = place;
  const pmConfig = await loadPmConfig(session, place.pmOrg).catch(() => undefined);
  const out: IntakeRepo[] = [];
  for (const resource of RESOURCES) {
    const target = targetOf(place, resource, "GEN", pmConfig);
    if ("error" in target) continue;
    const branch = await getDefaultBranch(dcsConfig(session.host), target.owner, target.repo, session.token).catch(() => "");
    const form = branch ? await readRepoFile(session, { owner: target.owner, repo: target.repo, branch }, SUGGESTION_TEMPLATE_PATH).catch(() => null) : null;
    out.push({ resource, owner: target.owner, repo: target.repo, name: resource.toUpperCase(), ready: Boolean(form) });
  }
  return out;
}

/**
 * Makes a repository able to receive suggestions: its two labels, and the form in its default branch. Written to the
 * published repository: whoever does it is asked first, on the screen.
 */
export async function prepareIntake(session: GtSession, repo: IntakeRepo): Promise<void> {
  const config = dcsConfig(session.host);
  const labels = await listLabels(config, repo.owner, repo.repo, { token: session.token, limit: 100 });
  const wanted = [
    { name: SUGGESTION_LABEL, color: "1d76db", description: "Sugerencia de cambio al texto, para el equipo de traducción" },
    { name: TAKEN_LABEL, color: "0e8a16", description: "La sugerencia pasó al equipo en Taller" },
  ];
  for (const label of wanted) {
    if (!labels.some((have) => have.name === label.name)) await createLabel(config, repo.owner, repo.repo, { token: session.token, ...label });
  }
  const branch = await getDefaultBranch(config, repo.owner, repo.repo, session.token);
  const content = suggestionTemplate(repo.name);
  const there = await readRepoFile(session, { owner: repo.owner, repo: repo.repo, branch }, SUGGESTION_TEMPLATE_PATH).catch(() => null);
  if (there?.text === content) return;
  await createOrUpdateContents(config, repo.owner, repo.repo, SUGGESTION_TEMPLATE_PATH, { content, message: "Formulario para sugerir cambios al texto", branch, sha: there?.sha, token: session.token });
}

/** The suggestions not looked at yet: open, with the form's label, and not taken to the team. */
export async function listSuggestions(session: GtSession, repos: IntakeRepo[]): Promise<OutsideSuggestion[]> {
  const out: OutsideSuggestion[] = [];
  for (const repo of repos) {
    const issues: DcsIssue[] = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await listRepoIssues(dcsConfig(session.host), repo.owner, repo.repo, { token: session.token, state: "open", labels: [SUGGESTION_LABEL], type: "issues", page, limit: 50 }).catch(() => [] as DcsIssue[]);
      const fresh = batch.filter((issue) => !issues.some((have) => have.number === issue.number));
      issues.push(...fresh);
      if (batch.length < 50 || !fresh.length) break;
    }
    for (const issue of issues) {
      const names = (issue.labels ?? []).map((label) => label.name);
      // A server that ignores the filter answers every issue: only the form's are suggestions.
      if (!names.includes(SUGGESTION_LABEL) || names.includes(TAKEN_LABEL)) continue;
      out.push({
        owner: repo.owner,
        repo: repo.repo,
        number: issue.number,
        url: issue.html_url ?? "",
        by: issue.user?.login ?? "",
        at: issue.created_at ?? "",
        title: issue.title ?? "",
        resource: repo.resource,
        ...readSuggestionBody(issue.body ?? "", issue.title ?? ""),
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export type SuggestionPlace = {
  book: string;
  chapter: number;
  verse: number;
};

/** The verse as the team has it now, for the suggestion to be read against; `null` when it cannot be. */
export async function verseNow(place: Place, resource: string, at: SuggestionPlace): Promise<{ text: string; draft: { owner: string; repo: string; branch: string; filepath: string } } | null> {
  const { session } = place;
  const board = await loadAssignmentsFromDcs(session, place.pmOrg, place.lang, at.book, place.contentOrg);
  if (!board) return null;
  const target = targetOf(place, resource, at.book);
  if ("error" in target) return null;
  const found = await tryReadExistingBookUsfm({ session, owner: target.owner, repo: target.repo, filepath: target.filepath, branches: groupDraftBranches(at.book, draftTaskId(board.teams, resource) ?? "") }).catch(() => null);
  if (!found?.branch) return null;
  const usj = tryParseUsj(found.text);
  const text = usj ? (verseTextsFromUsj(usj, { chapter: at.chapter, from: at.verse, to: at.verse }) ?? {})[at.verse] : undefined;
  return text ? { text, draft: { owner: target.owner, repo: target.repo, branch: found.branch, filepath: target.filepath } } : null;
}

/**
 * Takes a suggestion to the team that has the text: a proposal like any other, made by whoever takes it, that says
 * whose it is and where it came from. Its author is told in their issue, and told again when it is decided.
 * Returns the number of the decision.
 */
export async function takeSuggestion(params: Place & { suggestion: OutsideSuggestion; at: SuggestionPlace; text: string }): Promise<number> {
  const { session, pmOrg, suggestion, at } = params;
  const board = await loadAssignmentsFromDcs(session, pmOrg, params.lang, at.book, params.contentOrg);
  if (!board) throw new Error(`${bookName(at.book)} todavía no es un proyecto de Taller.`);
  const task = textHolder(board, suggestion.resource);
  if (!task) throw new Error("El plan de este libro no tiene una tarea que revise este texto.");
  const now = await verseNow(params, suggestion.resource, at);
  if (!now) throw new Error(`No se encontró ${bookName(at.book)} ${at.chapter}:${at.verse} en el borrador del equipo.`);
  const config = dcsConfig(session.host);
  const pmConfig = await loadPmConfig(session, pmOrg);
  // The subtarea of that task in the chapter: what is decided there is told in it, and the tasks to review again are
  // found from its text.
  const near = await listRepoIssues(config, pmOrg, PM_REPO_NAME, { token: session.token, state: "all", type: "issues", labels: [pmFacetLabel("tarea", task.id, pmConfig.namespaceId), pmFacetLabel("cap", at.chapter, pmConfig.namespaceId)], limit: 50 });
  const ofBook = near.filter((issue) => issueProjectId(issue).toUpperCase() === at.book && !/· Decidir/.test(issue.title ?? ""));
  const covers = (issue: DcsIssue) => {
    const range = / (\d+):(\d+)(?:[–-](\d+))?/.exec(issue.title ?? "");
    return range ? Number(range[1]) === at.chapter && Number(range[2]) <= at.verse && at.verse <= Number(range[3] ?? range[2]) : false;
  };
  const parent = ofBook.find(covers) ?? ofBook[0];
  if (!parent) throw new Error("No se encontró la subtarea de ese capítulo en el plan.");
  const step = (task.steps ?? []).find((row) => row.closing === "consensus") ?? task.steps?.[0];
  const opened = await openTextProposal({
    session,
    pmOrg,
    task: { projectId: board.projectId || at.book, taskId: task.id, taskName: task.name, resource: suggestion.resource === "tps" ? "tps" : "tpl", parentIssue: parent.number },
    target: { owner: now.draft.owner, repo: now.draft.repo, branch: now.draft.branch },
    draftFilepath: now.draft.filepath,
    book: at.book,
    chapter: at.chapter,
    verse: at.verse,
    oldText: now.text,
    newText: params.text,
    note: suggestionNote(suggestion),
    tell: task.memberIds ?? [],
    thresholds: { minAgree: step?.minAgree ?? step?.minAssignees ?? 3, minIndependent: step?.minIndependent ?? 2 },
    outside: { owner: suggestion.owner, repo: suggestion.repo, number: suggestion.number, by: suggestion.by },
  });
  await createIssueComment(config, suggestion.owner, suggestion.repo, suggestion.number, takenComment(`${bookName(at.book)} ${at.chapter}:${at.verse}`), session.token).catch(() => undefined);
  await addIssueLabels(config, suggestion.owner, suggestion.repo, suggestion.number, [TAKEN_LABEL], session.token).catch(() => undefined);
  return opened.issue.number;
}

/** A suggestion that does not go ahead: its author is told why, and it is closed. */
export async function refuseSuggestion(session: GtSession, suggestion: OutsideSuggestion, reason: string): Promise<void> {
  const config = dcsConfig(session.host);
  await createIssueComment(config, suggestion.owner, suggestion.repo, suggestion.number, refusedComment(reason), session.token);
  await editIssue(config, suggestion.owner, suggestion.repo, suggestion.number, { token: session.token, state: "closed" });
}
