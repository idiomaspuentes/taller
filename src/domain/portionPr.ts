import { bookName } from "./books";
import { slugifyPhase } from "./phaseSlug";
import type { TaskStep } from "./types";
import { closesInItsTool, stepClaimMode } from "./stepClaim";
import { branchNames, isWorkWord, LEGACY_WORK_WORD } from "./branchNames";

export const PORTION_PR_SCHEMA = "gateway-portion-pr-1" as const;

/** One DCS PR per subtarea (portion × task). Linked from the PM issue body. */
export type PortionPrMarker = {
  schema: typeof PORTION_PR_SCHEMA;
  owner: string;
  repo: string;
  number: number;
  htmlUrl: string;
  head: string;
  base: string;
  issueNumber: number;
};

const MARKER_RE = /<!--\s*gateway-portion-pr\s+(\{[\s\S]*?\})\s*-->/g;

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "x"
  );
}

function bookCode(book: string): string {
  return slug(book) || "book";
}

/**
 * The group draft of a translation task: `borrador/neh/tpl-draft`. Its first word is its own, so no other branch
 * can stand in its way. Phase is a board grouping only — it does not appear in the name. Language and resource
 * live on the repo (`es-419_gl/es-419_glt`), not here.
 */
export function bookBranchName(book: string, taskId?: string): string {
  return `${branchNames().draft}/${legacyTaskBranchName(book, taskId)}`;
}

/** The group draft as it was named before (`neh/tpl-draft`). Reused when it exists, never created. */
export function legacyTaskBranchName(book: string, taskId?: string): string {
  const raw = (taskId ?? "").trim();
  return `${bookCode(book)}/${raw ? slug(raw) : "tarea"}`;
}

/** Where the group draft of a task can be, the name of today first and then the ones of older books. */
export function groupDraftBranchNames(book: string, taskId?: string): string[] {
  return [bookBranchName(book, taskId), legacyTaskBranchName(book, taskId), taskTrunkBranchName(book, taskId)];
}

/** Book-only leftover (`neh`). Reuse when it already holds a valid book USFM. */
export function bookOnlyBranchName(book: string): string {
  return bookCode(book);
}

/**
 * The name older books fell back to when a branch `neh` stood in the way of `neh/{taskId}`
 * (`t/neh/6f1e771e-2f2d-4987-b516-6455a751405a`). Reused when it exists, never created.
 */
export function taskTrunkBranchName(book: string, taskId?: string): string {
  return `t/${legacyTaskBranchName(book, taskId)}`;
}

/** Pre-phase scheme. Reuse when this ref already exists so we do not orphan it. */
export function legacyBookBranchName(book: string): string {
  return `book/${bookCode(book)}`;
}

/** Older `{phaseSlug}/{book}` refs. Reuse when present; never create as the new default. */
export function legacyPhaseBookBranchName(book: string, phaseSlug?: string): string {
  const phase = slugifyPhase(phaseSlug);
  return phase ? `${phase}/${bookCode(book)}` : "";
}

/** Older resource-mapped prefixes this app used to create. Reuse if present. */
export function compatBookBranchNames(book: string): string[] {
  return [
    legacyPhaseBookBranchName(book, "afinacion"),
    legacyPhaseBookBranchName(book, "armonizacion"),
  ].filter(Boolean);
}

export function bookBranchLabel(book: string, phaseName?: string): string {
  const label = phaseName?.trim() || "Fase";
  return `${label} · ${bookName(book)}`;
}

export type PortionBranchNameParams = {
  book: string;
  username: string;
  taskId: string;
  issueNumber: number;
};

function workUserIssueSuffix(params: PortionBranchNameParams): string {
  const n = Math.floor(Number(params.issueNumber));
  const user = slug(params.username) || "anon";
  const issue = Number.isFinite(n) && n > 0 ? n : 0;
  return `${user}/${issue}`;
}

/**
 * Unique work branch per person/subtarea. Lives under its own word, so it is never a Git child of a group draft.
 * Example: `trabajo/neh/tpl-draft/ana/41`.
 */
export function portionPrBranchName(params: PortionBranchNameParams): string {
  return `${branchNames().work}/${legacyTaskBranchName(params.book, params.taskId)}/${workUserIssueSuffix(params)}`;
}

/** The work branches of before the names could be read (`w/neh/tpl-draft/ana/41`). Recognised, never created. */
export function legacyWorkBranchName(params: PortionBranchNameParams): string {
  return `${LEGACY_WORK_WORD}/${legacyTaskBranchName(params.book, params.taskId)}/${workUserIssueSuffix(params)}`;
}

/**
 * Older nested scheme (`neh/tpl-draft/ana/41`). Kept for Recreate/ownership
 * of leftover refs; never create this as a new work or book branch.
 */
export function nestedPortionPrBranchName(params: PortionBranchNameParams): string {
  return `${legacyTaskBranchName(params.book, params.taskId)}/${workUserIssueSuffix(params)}`;
}

/** Pre-phase task branches (`tas/neh/ana/tpl-draft/41`). Accept if a PR already uses them. */
export function legacyPortionPrBranchName(params: PortionBranchNameParams): string {
  const n = Math.floor(Number(params.issueNumber));
  const user = slug(params.username) || "anon";
  const issue = Number.isFinite(n) && n > 0 ? n : 0;
  return `tas/${bookCode(params.book)}/${user}/${slug(params.taskId)}/${issue}`;
}

export function normalizeGitRefName(name: string): string {
  return name.trim().replace(/^\/+|\/+$/g, "");
}

/** True when `child` sits under `parent` as `parent/...` (illegal if `parent` is already a branch). */
export function isGitRefDescendant(child: string, parent: string): boolean {
  const c = normalizeGitRefName(child);
  const p = normalizeGitRefName(parent);
  return Boolean(p) && c !== p && c.startsWith(`${p}/`);
}

export function gitRefParentNames(ref: string): string[] {
  const parts = normalizeGitRefName(ref).split("/").filter(Boolean);
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    parents.push(parts.slice(0, i).join("/"));
  }
  return parents;
}

/**
 * If a caller still passes the nested work path, remap it so we never
 * POST `libro/tarea/usuario/issue` under an existing trunk.
 */
export function canonicalWorkBranchName(
  params: PortionBranchNameParams,
  trunk: string,
  requested?: string,
): string {
  const preferred = portionPrBranchName(params);
  const name = normalizeGitRefName(requested || "");
  if (!name || name === normalizeGitRefName(trunk) || isGitRefDescendant(name, trunk) || name === nestedPortionPrBranchName(params)) {
    return preferred;
  }
  return name;
}

export function ownedWorkBranchNames(params: PortionBranchNameParams): string[] {
  return [...new Set([
    portionPrBranchName(params),
    legacyWorkBranchName(params),
    nestedPortionPrBranchName(params),
    legacyPortionPrBranchName(params),
  ])];
}

/**
 * Where the text a person works on is looked for, first hit first: their own branch (as this device last knew
 * it, and under every name it has had), then the draft of the group, then what is published (`undefined`, the
 * default branch).
 *
 * The branch this device remembered went second, and with nothing remembered that place was empty, which reads
 * as the default branch. A subtarea opened for the first time has no branch of its own yet, so the editor showed
 * the published book while the branch was being cut from the group's draft: whoever wrote there was writing
 * over what was published, not over what the team had.
 */
export function draftReadBranchNames(params: PortionBranchNameParams & { remembered?: string }): Array<string | undefined> {
  const remembered = normalizeGitRefName(params.remembered || "");
  return [
    portionPrBranchName(params),
    ...(remembered ? [remembered] : []),
    ...ownedWorkBranchNames(params),
    ...groupDraftBranchNames(params.book, params.taskId),
    bookOnlyBranchName(params.book),
    undefined,
  ];
}

export function portionPrBranchFromCtx(ctx: {
  book?: string;
  projectId?: string;
  username?: string;
  taskId: string;
  issueNumber: number;
}): string {
  return portionPrBranchName({
    book: ctx.book || ctx.projectId || "book",
    username: ctx.username || "",
    taskId: ctx.taskId,
    issueNumber: ctx.issueNumber,
  });
}

/** Current or leftover work-branch spelling for this user/task/issue. */
export function isOwnedWorkBranch(branch: string, params: PortionBranchNameParams): boolean {
  const name = normalizeGitRefName(branch);
  if (!name) return false;
  return ownedWorkBranchNames(params).includes(name);
}

/**
 * Stored PR head is the current work ref, or a remapped leftover
 * (`trabajo/…` ↔ `w/…` ↔ nested ↔ `tas/…`) of the same user/task/issue.
 */
export function portionPrHeadMatchesWork(
  head: string | undefined,
  workBranch: string,
  params?: PortionBranchNameParams,
): boolean {
  const stored = normalizeGitRefName(head || "");
  const current = normalizeGitRefName(workBranch);
  if (!stored || !current) return false;
  if (stored === current) return true;
  if (!params) return false;
  return isOwnedWorkBranch(stored, params) && isOwnedWorkBranch(current, params);
}

/** Book code from a work ref (`trabajo/neh/...`, `w/neh/...`, `neh/...`, or `tas/neh/...`). */
export function bookCodeFromWorkHead(head: string): string {
  const parts = normalizeGitRefName(head).split("/").filter(Boolean);
  if (isWorkWord(parts[0]) && parts[1]) return parts[1];
  if (parts[0] === "tas" && parts[1]) return parts[1];
  return parts[0] || "";
}

/** The group draft a work ref was started from: `borrador/neh/task` for `trabajo/neh/task/…`, `neh/task` for an old `w/neh/task/…`. */
export function bookTrunkFromWorkHead(head: string): string {
  const parts = normalizeGitRefName(head).split("/").filter(Boolean);
  if (parts[0] === branchNames().work && parts.length >= 3) return `${branchNames().draft}/${parts[1]}/${parts[2]}`;
  if (parts[0] === LEGACY_WORK_WORD && parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  if (parts[0] === "t" && parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  if (parts[0] !== "tas" && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return "";
}

/** User slug encoded in a work ref (`trabajo/neh/task/ana/41`, `w/neh/task/ana/41`, `neh/task/ana/41`, `tas/neh/ana/task/41`). */
export function workUserFromHead(head: string): string {
  const parts = normalizeGitRefName(head).split("/").filter(Boolean);
  if (isWorkWord(parts[0]) && parts.length >= 5) return parts[3]!;
  if (parts[0] === "tas" && parts.length >= 5) return parts[2]!;
  if (parts.length >= 4) return parts[2]!;
  return "";
}

/** Real DCS login behind the work ref's user slug; the slug itself if none matches. */
export function translatorLoginFromHead(head: string, candidates: (string | undefined)[]): string {
  const user = workUserFromHead(head);
  const logins = candidates.map((c) => (c ?? "").trim()).filter(Boolean);
  return logins.find((login) => slug(login) === user) || user || logins[0] || "";
}

/**
 * Keeps the work-branch tip reachable after the work branch is deleted. Lives under its own word, never under a
 * group draft or a work branch. Example: `archivo/neh/41`.
 */
export function archiveRefName(book: string, issueNumber: number): string {
  const n = Math.floor(Number(issueNumber));
  return `${branchNames().archive}/${bookCode(book)}/${Number.isFinite(n) && n > 0 ? n : 0}`;
}

export function isArchiveRefName(name: string): boolean {
  const parts = normalizeGitRefName(name).split("/");
  return parts.length === 3 && parts[0] === branchNames().archive && /^[a-z0-9-]+$/.test(parts[1]!) && /^[1-9]\d*$/.test(parts[2]!);
}

export type ArchiveRefAction = "noop" | "create" | "update";

export function planArchiveRef(currentSha: string | null | undefined, targetSha: string): ArchiveRefAction {
  const current = (currentSha ?? "").trim().toLowerCase();
  if (!current) return "create";
  return current === targetSha.trim().toLowerCase() ? "noop" : "update";
}

/**
 * How to make `name` a branch the branch and contents APIs can see.
 * A git ref the branch API does not list is a ghost: rebuild it from the
 * commit it already points at so saved text survives. Otherwise branch
 * from the first source with a commit (borrador grupal, then principal).
 */
export type BranchEnsureStep =
  | { kind: "exists" }
  | { kind: "repair"; sha: string }
  | { kind: "create"; sha: string; from: string }
  | { kind: "no-source" };

export function planBranchEnsure(params: {
  gitRefSha: string | null | undefined;
  branchApi: boolean;
  sources: Array<{ name: string; sha: string | null | undefined }>;
}): BranchEnsureStep {
  if (params.branchApi) return { kind: "exists" };
  const own = params.gitRefSha?.trim();
  if (own) return { kind: "repair", sha: own };
  for (const source of params.sources) {
    const sha = source.sha?.trim();
    if (sha) return { kind: "create", sha, from: source.name };
  }
  return { kind: "no-source" };
}

/** Contents API commit message for the Cerrar trunk write. */
export function trunkMergeCommitMessage(params: {
  issueNumber: number;
  verses: string;
  translator: string;
  pullNumber: number;
  workBranch: string;
  workSha: string;
  archiveRef?: string;
}): string {
  const who = params.translator ? `@${params.translator.replace(/^@/, "")}` : "—";
  return [
    `TAS: fusionar versículos ${params.verses} de #${params.issueNumber} (${who})`,
    "",
    `Traductor: ${who}`,
    `Subtarea: #${params.issueNumber}`,
    `Versículos: ${params.verses}`,
    `PR: #${params.pullNumber}`,
    `Rama de trabajo: ${params.workBranch} @ ${params.workSha}`,
    ...(params.archiveRef ? [`Archivo: ${params.archiveRef}`] : []),
  ].join("\n");
}

/** Shared book-level leftovers — Recreate must not delete these refs. */
export function isSharedBookTrunk(branch: string, book: string, phaseSlug?: string): boolean {
  const name = normalizeGitRefName(branch);
  return [
    bookOnlyBranchName(book),
    ...compatBookBranchNames(book),
    legacyBookBranchName(book),
    legacyPhaseBookBranchName(book, phaseSlug),
  ].filter(Boolean).includes(name);
}

export function parsePortionPrMarker(body: string | undefined): PortionPrMarker | null {
  if (!body) return null;
  MARKER_RE.lastIndex = 0;
  const match = MARKER_RE.exec(body);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<PortionPrMarker>;
    const number = Number(parsed.number);
    const issueNumber = Number(parsed.issueNumber);
    if (
      parsed.schema !== PORTION_PR_SCHEMA ||
      !parsed.owner ||
      !parsed.repo ||
      !parsed.head ||
      !parsed.base ||
      !Number.isFinite(number) ||
      number < 1
    ) {
      return null;
    }
    return {
      schema: PORTION_PR_SCHEMA,
      owner: String(parsed.owner).trim(),
      repo: String(parsed.repo).trim(),
      number,
      htmlUrl: String(parsed.htmlUrl ?? "").trim(),
      head: String(parsed.head).trim(),
      base: String(parsed.base).trim(),
      issueNumber: Number.isFinite(issueNumber) ? issueNumber : 0,
    };
  } catch {
    return null;
  }
}

export function encodePortionPrMarker(marker: PortionPrMarker): string {
  return `<!-- gateway-portion-pr ${JSON.stringify({
    schema: PORTION_PR_SCHEMA,
    owner: marker.owner,
    repo: marker.repo,
    number: marker.number,
    htmlUrl: marker.htmlUrl,
    head: marker.head,
    base: marker.base,
    issueNumber: marker.issueNumber,
  })} -->`;
}

export function upsertPortionPrInBody(
  body: string | undefined,
  marker: PortionPrMarker,
): string {
  const encoded = encodePortionPrMarker(marker);
  const text = body ?? "";
  MARKER_RE.lastIndex = 0;
  if (MARKER_RE.test(text)) {
    MARKER_RE.lastIndex = 0;
    return text.replace(MARKER_RE, encoded);
  }
  const trimmed = text.trimEnd();
  return trimmed ? `${trimmed}\n\n${encoded}\n` : `${encoded}\n`;
}

/** Drop the portion-PR stamp after this subtarea closes or abandons its PR. */
export function removePortionPrFromBody(body: string | undefined): string {
  if (!body) return "";
  MARKER_RE.lastIndex = 0;
  return body.replace(MARKER_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** Completing this free step (typically Borrador) unlocks an exclusive/pool review next. */
export function stepCompletesDraftForReview(
  steps: TaskStep[],
  stepId: string,
): boolean {
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return false;
  if (stepClaimMode(steps[idx]) !== "none") return false;
  const next = steps[idx + 1];
  if (!next) return false;
  const mode = stepClaimMode(next);
  return mode === "exclusive" || mode === "pool";
}

export function stepNeedsOpenPortionPr(step: TaskStep): boolean {
  // A step closed inside its own tool (a consensus round, a checklist) works on the shared draft: there is no
  // personal draft to review, so no pull request either.
  if (closesInItsTool(step)) return false;
  const mode = stepClaimMode(step);
  return mode === "exclusive" || mode === "pool";
}

/** Review comment posted when TAS Aprobar hits a linked PR. */
export function portionPrApprovalReviewBody(params: {
  stepName: string;
  issueNumber: number;
}): string {
  const name = params.stepName.trim() || "paso";
  const n = Math.floor(Number(params.issueNumber));
  const issue = Number.isFinite(n) && n > 0 ? ` · subtarea #${n}` : "";
  return `Aprobado en TAS: «${name}»${issue}`;
}

/** Gitea may create the review as PENDING; those still need submit. */
export function pullReviewNeedsSubmit(state: string | undefined): boolean {
  const s = (state ?? "").trim().toLowerCase();
  return !s || s === "pending";
}

/**
 * How Cerrar landed the subtarea: `verses` (USFM on the trunk), `merged`
 * (Gitea merge now), `already` (PR was Git-merged before), `closed` (PR
 * closed by hand without merge and not USFM), `none` (no PR marker).
 */
export type PortionMergeStatus = "verses" | "merged" | "already" | "closed" | "none";

/** Scripture tasks close the PM issue only when their USFM reached the trunk. */
export function closeIssueBlockReason(
  resource: string | undefined,
  status: PortionMergeStatus,
): string | null {
  const r = (resource ?? "").toLowerCase();
  if (r !== "tpl" && r !== "tps") return null;
  if (status === "none") {
    return "La subtarea no tiene revisión abierta: sus versículos no llegaron al borrador grupal. No se cerró.";
  }
  if (status === "closed") {
    return "La revisión de la subtarea se cerró sin guardarse en el borrador grupal y el borrador ya no tiene el archivo. Reábrela en Door43 y vuelve a pulsar Cerrar. No se cerró.";
  }
  return null;
}
