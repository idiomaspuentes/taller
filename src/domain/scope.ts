/**
 * The "scope" of a workspace: what keeps its projects and tasks apart from another workspace's when both live in
 * the SAME Door43 organization (and even in the same language). A workspace without a scope owns the plain,
 * unprefixed names, exactly as before spaces existed, so existing data keeps working.
 *
 * With a scope, everything the space writes or reads is marked:
 *  - issues carry the label `pm/espacio:<scope>` and are only listed when they carry it (an unscoped space
 *    only lists issues without any such label);
 *  - milestones are titled `<scope>/<project>`;
 *  - files in the plan repository live under `<scope>/…`;
 *  - the copies kept in this browser are keyed by it.
 *
 * It is set once, when the workspace is chosen; changing workspace reloads the page.
 */
import { DEFAULT_PM_NAMESPACE } from "./roles";

const SCOPE_FACET = "espacio";

/** Letters, digits and dashes: it ends up in label names, milestone titles and file paths. */
export const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

let active = "";

export function setActiveScope(id: string | undefined | null): void {
  active = (id ?? "").trim().toLowerCase();
}

export function activeScope(): string {
  return active;
}

/** Prefix for paths inside the plan repository: `pt/` or nothing. */
export const scopeFolder = (scope: string = active): string => (scope ? `${scope}/` : "");

/** Prefix for keys of copies kept in this browser: `pt:` or nothing. */
export const scopeKey = (scope: string = active): string => (scope ? `${scope}:` : "");

/** The label every issue of a scoped space carries. */
export const scopeLabelName = (scope: string = active, namespaceId: string = DEFAULT_PM_NAMESPACE): string =>
  `${namespaceId}/${SCOPE_FACET}:${scope}`;

type Labeled = { labels?: { name: string }[] };

/**
 * Whether an issue belongs to a space. A scoped space wants its own label; an unscoped one wants issues that carry
 * no scope label at all, so scoped issues never show up in it.
 */
export function issueInScope(issue: Labeled, scope: string = active): boolean {
  const names = (issue.labels ?? []).map((l) => l.name);
  if (scope) return names.includes(scopeLabelName(scope)) || names.some((n) => n.endsWith(`/${SCOPE_FACET}:${scope}`));
  return !names.some((n) => n.includes(`/${SCOPE_FACET}:`));
}

/** The milestone title of a project: `<scope>/NEH` in a scoped space, plain `NEH` otherwise. */
export const scopedMilestone = (projectId: string, scope: string = active): string => (scope ? `${scope}/${projectId}` : projectId);

/** The project a milestone title stands for, whatever the scope prefix. */
export function projectFromMilestone(title: string | undefined | null): string {
  const clean = (title ?? "").trim();
  const slash = clean.lastIndexOf("/");
  return slash >= 0 ? clean.slice(slash + 1) : clean;
}
