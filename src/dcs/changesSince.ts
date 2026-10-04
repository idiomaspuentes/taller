import type { DcsIssue } from "@ip-lms/dcs-client";
import { draftTaskId } from "../domain/branchNames";
import { changesBetween, phaseCompare } from "../domain/changesSince";
import { helpsTsvFilename } from "../domain/helpsTarget";
import { issueTaskId } from "../domain/myTasks";
import { phaseTagName } from "../domain/phaseMarks";
import { ensurePhaseSlug } from "../domain/phaseSlug";
import { archiveRefName, groupDraftBranchNames } from "../domain/portionPr";
import type { ReviewItem } from "../domain/reviewItems";
import { resolveResourceRepo } from "../domain/roles";
import { refFromIssueTitle } from "../domain/solverLaunch";
import { SCOPE_KEYS, type AssignmentsDoc, type ScopeKey } from "../domain/types";
import { parseRefRange } from "../domain/usfmEdit";
import { parseWorkOrderMarker } from "../domain/workOrder";
import { bookUsfmName } from "../prep/discover";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { loadPmConfig } from "./issues";
import { getArchiveSha, getBranchSha, getDefaultBranch, getTagSha } from "./pulls";
import { readRepoFile } from "./repoFile";

type Where = { session: GtSession; pmOrg: string; lang: string; contentOrg: string; board: AssignmentsDoc };

/** One resource's file for a book, and the group draft that holds it. */
type Place = { resource: string; owner: string; repo: string; filepath: string; draftTaskId: string };

async function placesOf(where: Where, book: string, resources: string[]): Promise<Place[]> {
  const owner = (where.contentOrg || where.board.contentOrg || "").trim();
  if (!owner) return [];
  const pmConfig = await loadPmConfig(where.session, where.pmOrg);
  const places: Place[] = [];
  for (const raw of new Set(resources.map((resource) => resource.toLowerCase()))) {
    if (!(SCOPE_KEYS as string[]).includes(raw)) continue;
    // Articles are a file each, not a file of the book: they are not compared here.
    const filepath = raw === "tpl" || raw === "tps" ? bookUsfmName(book) : raw === "notas" || raw === "preguntas" ? helpsTsvFilename(raw, book) : "";
    const repo = resolveResourceRepo(raw as ScopeKey, where.lang, pmConfig);
    const source = draftTaskId(where.board.teams, raw);
    if (filepath && repo && source) places.push({ resource: raw, owner, repo, filepath, draftTaskId: source });
  }
  return places;
}

async function draftTip(where: Where, place: Place, book: string): Promise<string | null> {
  const config = dcsConfig(where.session.host);
  for (const branch of groupDraftBranchNames(book, place.draftTaskId)) {
    const tip = await getBranchSha(config, place.owner, place.repo, branch, where.session.token);
    if (tip) return tip;
  }
  return null;
}

const readAt = (where: Where, place: Place, ref: string) =>
  readRepoFile({ session: where.session, owner: place.owner, repo: place.repo, filepath: place.filepath, branch: ref })
    .then((file) => file.text)
    .catch(() => "");

export type ResourceChanges = {
  resource: string;
  /** `closed`/`open`: compared; `waiting`: an earlier phase is still open; `none`: nothing to compare with yet. */
  status: "closed" | "open" | "waiting" | "none";
  items: ReviewItem[];
};

/**
 * What changed in the passage of a delivered subtarea since it was delivered: from its archive tag to the group
 * draft of today. `null` when the subtarea left no archive (it is open, or it is of a kind that is not compared).
 */
export async function loadSubtaskChanges(params: Where & { issue: DcsIssue }): Promise<ResourceChanges[] | null> {
  const { issue, board, session } = params;
  const task = board.teams.find((row) => row.id === issueTaskId(issue));
  const book = (parseWorkOrderMarker(issue.body)?.book || board.book || "").toUpperCase();
  if (!task || !book) return null;
  const config = dcsConfig(session.host);
  const range = parseRefRange(refFromIssueTitle(issue.title));
  const out: ResourceChanges[] = [];
  for (const place of await placesOf(params, book, task.rules.map((rule) => rule.resource))) {
    const archived = await getArchiveSha(config, place.owner, place.repo, archiveRefName(book, issue.number), session.token);
    if (!archived) continue;
    const tip = await draftTip(params, place, book);
    if (!tip) continue;
    const [before, now] = await Promise.all([readAt(params, place, archived), readAt(params, place, tip)]);
    out.push({ resource: place.resource, status: "open", items: changesBetween({ filename: place.filepath, before, now, range }) });
  }
  return out.length ? out : null;
}

/**
 * What a phase changed in a book, resource by resource: from the mark of the phase before it (or what is published)
 * to its own mark, or to the draft of today while it is open.
 */
export async function loadPhaseChanges(params: Where & { book: string; phaseId: string }): Promise<ResourceChanges[]> {
  const { board, session, phaseId } = params;
  const book = params.book.toUpperCase();
  const config = dcsConfig(session.host);
  const phases = [...board.phases].sort((a, b) => a.order - b.order);
  const resourcesOf = (id: string) => board.teams.filter((task) => task.phaseId === id).flatMap((task) => task.rules.map((rule) => rule.resource.toLowerCase()));
  const out: ResourceChanges[] = [];
  for (const place of await placesOf(params, book, resourcesOf(phaseId))) {
    // Only the phases that work on this resource leave a mark in its repository.
    const working = phases.filter((phase) => resourcesOf(phase.id).includes(place.resource));
    const at = working.findIndex((phase) => phase.id === phaseId);
    const marks = await Promise.all(working.slice(0, at + 1).map((phase) => getTagSha(config, place.owner, place.repo, phaseTagName(book, ensurePhaseSlug(phase)), session.token).catch(() => null)));
    const plan = phaseCompare(marks.map(Boolean), at);
    if (plan.status === "waiting") {
      out.push({ resource: place.resource, status: "waiting", items: [] });
      continue;
    }
    const nowRef = plan.status === "closed" ? marks[plan.nowMark]! : await draftTip(params, place, book);
    if (!nowRef) {
      out.push({ resource: place.resource, status: "none", items: [] });
      continue;
    }
    const beforeRef = plan.beforeMark === null ? await getDefaultBranch(config, place.owner, place.repo, session.token) : marks[plan.beforeMark]!;
    const [before, now] = await Promise.all([readAt(params, place, beforeRef), readAt(params, place, nowRef)]);
    out.push({ resource: place.resource, status: plan.status, items: changesBetween({ filename: place.filepath, before, now }) });
  }
  return out;
}
