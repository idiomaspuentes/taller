/**
 * The names of the branches and tags the app keeps in a content repository. Each kind lives under its own word
 * (`borrador/jud/tpl`, `trabajo/jud/tpl/ana/160`), so no name can sit under another (Git refuses `jud/tpl` when a
 * branch `jud` exists) and whoever opens the repository in Door43 can read what each one is.
 *
 * The words come from `taller.config.ts` (`branchNames`, and each workspace may give its own). The app creates with
 * these and still reads the names it used before (`jud/tpl`, `t/jud/tpl`, `w/…`), which it never creates again.
 */
import { tallerConfig } from "../../taller.config";
import type { BranchNames } from "../config/types";

export const DEFAULT_BRANCH_NAMES: BranchNames = {
  draft: "borrador",
  work: "trabajo",
  archive: "archivo",
  phase: "fase",
  validation: "validacion",
};

const KINDS = Object.keys(DEFAULT_BRANCH_NAMES) as (keyof BranchNames)[];

/** A word of a branch name: lowercase letters, digits and dashes, never a slash. */
export const BRANCH_WORD_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** The work branches of before the names could be read. Still recognised, never created. */
export const LEGACY_WORK_WORD = "w";

/** The organization's words over the defaults, and a workspace's over those. */
export function mergeBranchNames(...layers: (Partial<BranchNames> | undefined)[]): BranchNames {
  const out = { ...DEFAULT_BRANCH_NAMES };
  for (const layer of layers) {
    for (const kind of KINDS) {
      const word = layer?.[kind];
      if (typeof word === "string" && word.trim()) out[kind] = word.trim();
    }
  }
  return out;
}

/** What is wrong with a set of words, in Spanish for whoever edits the configuration; empty when it is fine. */
export function branchNameProblems(names: BranchNames): string[] {
  const problems: string[] = [];
  for (const kind of KINDS) {
    const word = names[kind];
    if (!BRANCH_WORD_PATTERN.test(word)) problems.push(`branchNames.${kind} («${word}»): solo minúsculas, números y guion, sin barras.`);
    // A work branch of before would be taken for one of today's.
    if (word === LEGACY_WORK_WORD || word === "t" || word === "tas") problems.push(`branchNames.${kind} («${word}»): ese nombre lo usaban las ramas antiguas.`);
  }
  const seen = new Map<string, string>();
  for (const kind of KINDS) {
    const other = seen.get(names[kind]);
    if (other) problems.push(`branchNames.${kind} y branchNames.${other} son iguales («${names[kind]}»): cada uno necesita el suyo.`);
    else seen.set(names[kind], kind);
  }
  return problems;
}

function checked(names: BranchNames): BranchNames {
  const problems = branchNameProblems(names);
  if (problems.length) throw new Error(`taller.config.ts: ${problems.join(" ")}`);
  return names;
}

let active: BranchNames | null = null;

/** Set once, when the workspace is chosen (like its scope): the words of that workspace. */
export function setWorkspaceBranchNames(own: Partial<BranchNames> | undefined | null): void {
  active = checked(mergeBranchNames(tallerConfig.branchNames, own ?? undefined));
}

export function branchNames(): BranchNames {
  if (!active) active = checked(mergeBranchNames(tallerConfig.branchNames));
  return active;
}

/** Whether the first word of a ref says it is somebody's work branch, today's or an old one. */
export function isWorkWord(word: string | undefined): boolean {
  return Boolean(word) && (word === branchNames().work || word === LEGACY_WORK_WORD);
}

type TaskWithResources = { id: string; rules: { resource: string }[] };

/**
 * The task that writes the text of a resource: the first task of the plan with it (its translation). Its group
 * draft is what every later task of that resource reads and corrects, however many tasks stand between.
 */
export function draftTaskId(teams: TaskWithResources[], resource: string): string | undefined {
  return teams.find((task) => task.rules.some((rule) => rule.resource === resource))?.id;
}

/**
 * The tasks whose group draft may hold the team's text of a resource, in the order to look for it: the task that
 * translates it first, since its draft is the one every later task corrects. The others follow, latest first, for
 * a book from before that rule, where a later task kept a draft of its own.
 *
 * They were looked for latest first only. A draft that a later task should never have had (the helps editor opened
 * from a harmonization started one, copied from the source) was then read instead of what the team had translated.
 */
export function draftReadOrder(teams: TaskWithResources[] | undefined, resource: string): string[] {
  const ids = (teams ?? []).filter((task) => task.rules.some((rule) => rule.resource === resource)).map((task) => task.id);
  return ids.length ? [ids[0]!, ...ids.slice(1).reverse()] : [];
}

/**
 * Whether a task has a group draft of its own, with personal work branches and a review to land on it: only the
 * translation task of a resource. Every other task of that resource (a group reading, refining, aligning,
 * harmonizing, validating) works on that draft, and must never start a draft or a review of its own.
 */
export function taskHasOwnDraft(teams: TaskWithResources[] | undefined, taskId: string | undefined): boolean {
  const task = teams?.find((row) => row.id === taskId);
  if (!task || !teams) return false;
  return task.rules.some((rule) => draftTaskId(teams, rule.resource) === task.id);
}
