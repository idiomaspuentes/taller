/**
 * «Publicar versión»: a gestor cuts a Door43 release («versión publicada»)
 * of the content repos from the borrador principal (default branch tip).
 * Not a task step and not «Pasar al borrador principal». Pure: the DCS
 * writer lives in `dcs/release.ts`.
 *
 * Readiness of a required phase: every scripture task (TPL/TPS) must pass
 * `principalPassGate` AND carry a current «pasado al borrador principal»
 * mark (`settings.principalPasses`); closed subtareas alone are not enough.
 * Tasks with other resources (Notas, Preguntas, Academia, Palabras) count as
 * ready when all their PM issues are closed and none carries an open
 * decision; they have no principal-file splice.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { Phase, PrincipalPassMark, ProjectTask, ReleaseProfile } from "./types";
import { isScriptureResource } from "./types";
import {
  findPrincipalPassMark,
  issueHasOpenDecision,
  issuesOfTask,
  isScriptureIssue,
  principalPassGate,
  principalPassMarkIsCurrent,
  type PassDecisionComment,
} from "./principalPass";
import { teamRules, uid } from "./assignment";
import { DEFAULT_PM_NAMESPACE } from "./roles";

export const RELEASE_ACTION = "Publicar versión";
export const DEFAULT_RELEASE_PROFILE_NAME = "Traducción";

export function defaultReleaseProfile(phases: Phase[]): ReleaseProfile {
  const first = [...phases].sort((a, b) => a.order - b.order)[0];
  return { id: uid(), name: DEFAULT_RELEASE_PROFILE_NAME, requiredPhaseIds: first ? [first.id] : [] };
}

/**
 * The profile as the gestor sees it: the name field's unsaved text counts
 * before any other control on the card saves or publishes. An empty draft
 * leaves the stored name (see `releaseNameBlock`).
 */
export function withNameDraft(profile: ReleaseProfile, draft: string | undefined): ReleaseProfile {
  const name = draft?.trim();
  return name && name !== profile.name ? { ...profile, name } : profile;
}

/** `withNameDraft` for every profile about to be saved. */
export function withNameDrafts(
  profiles: ReleaseProfile[],
  drafts: Record<string, string | undefined>,
): ReleaseProfile[] {
  return profiles.map((p) => withNameDraft(p, drafts[p.id]));
}

/** Block reason when the name field is empty; null = named. */
export function releaseNameBlock(profile: ReleaseProfile, draft: string | undefined): string | null {
  return (draft ?? profile.name).trim() ? null : "Escribe un nombre para la versión.";
}

export type TaskReleaseBlock = {
  /** «not-passed»: subtareas are done but the text is not in the borrador principal. */
  kind: "not-passed" | "unfinished";
  reason: string;
};

/** Why one task is not ready yet; null = ready. */
export function taskReleaseBlock(params: {
  task: ProjectTask;
  issues: DcsIssue[];
  book: string;
  namespaceId?: string;
  principalPasses?: PrincipalPassMark[];
  /** Verse-decision comments of the subtareas (see `principalPassMarkIsCurrent`). */
  decisions?: PassDecisionComment[];
}): TaskReleaseBlock | null {
  const { task, issues, book } = params;
  const namespaceId = params.namespaceId ?? DEFAULT_PM_NAMESPACE;
  const resources = teamRules(task).map((r) => r.resource);
  const hasScripture = resources.some(isScriptureResource);
  const hasOther = resources.some((r) => !isScriptureResource(r));
  const unfinished = (reason: string): TaskReleaseBlock => ({ kind: "unfinished", reason });

  if (hasScripture) {
    const gate = principalPassGate({ issues, taskId: task.id, book, namespaceId });
    if (gate.blockReason) return unfinished(gate.blockReason);
  }
  if (hasOther || !hasScripture) {
    const other = issuesOfTask({ issues, taskId: task.id, book, namespaceId }).filter(
      (issue) => !isScriptureIssue(issue),
    );
    if (!other.length && !hasScripture) return unfinished("Esta tarea no tiene subtareas publicadas.");
    const open = other.filter((issue) => issue.state !== "closed").length;
    if (open) {
      return unfinished(`${open === 1 ? "Falta 1 subtarea" : `Faltan ${open} subtareas`} por terminar.`);
    }
    const deciding = other.filter((issue) => issueHasOpenDecision(issue, namespaceId));
    if (deciding.length) {
      return unfinished(`Hay decisiones sin resolver en ${deciding.map((i) => `#${i.number}`).join(", ")}.`);
    }
  }
  if (hasScripture) {
    const mark = findPrincipalPassMark({ principalPasses: params.principalPasses }, task.id, book);
    if (!principalPassMarkIsCurrent({ mark, issues, namespaceId, decisions: params.decisions })) {
      return {
        kind: "not-passed",
        reason: `${task.name} todavía no está en el borrador principal.`,
      };
    }
  }
  return null;
}

export type ReleaseGate = {
  /** Gestor-facing reason the button is disabled; null = enabled. */
  blockReason: string | null;
  /** Names of the required phases, in board order. */
  phaseNames: string[];
};

export function releaseGate(params: {
  profile: ReleaseProfile | null | undefined;
  phases: Phase[];
  tasks: ProjectTask[];
  issues: DcsIssue[];
  book: string;
  namespaceId?: string;
  /** `settings.principalPasses` of the project. */
  principalPasses?: PrincipalPassMark[];
  /** Verse-decision comments of the subtareas; a decision newer than a pass voids that mark. */
  decisions?: PassDecisionComment[];
}): ReleaseGate {
  const { profile, tasks, issues, book, namespaceId, principalPasses, decisions } = params;
  if (!profile) return { blockReason: "Crea primero una versión y elige sus fases.", phaseNames: [] };
  const required = new Set(profile.requiredPhaseIds);
  const phases = [...params.phases].sort((a, b) => a.order - b.order).filter((p) => required.has(p.id));
  const phaseNames = phases.map((p) => p.name);
  if (!required.size) {
    return { blockReason: `Elige al menos una fase para «${profile.name}».`, phaseNames };
  }
  if (phases.length < required.size) {
    return {
      blockReason: `Una fase elegida para «${profile.name}» ya no existe. Revisa las fases de esta versión.`,
      phaseNames,
    };
  }
  for (const phase of phases) {
    const phaseTasks = tasks.filter((t) => t.phaseId === phase.id);
    if (!phaseTasks.length) {
      return { blockReason: `«${phase.name}» todavía no tiene tareas.`, phaseNames };
    }
    for (const task of phaseTasks) {
      const why = taskReleaseBlock({ task, issues, book, namespaceId, principalPasses, decisions });
      if (why) {
        return {
          blockReason:
            why.kind === "not-passed" ? why.reason : `«${phase.name}» no está lista. ${task.name}: ${why.reason}`,
          phaseNames,
        };
      }
    }
  }
  return { blockReason: null, phaseNames };
}

/** Content resources the release covers: those used by tasks of the required phases. */
export function releaseResources(profile: ReleaseProfile, tasks: ProjectTask[]): string[] {
  const required = new Set(profile.requiredPhaseIds);
  const out = new Set<string>();
  for (const task of tasks) {
    if (!required.has(task.phaseId)) continue;
    for (const rule of teamRules(task)) out.add(rule.resource);
  }
  return [...out];
}

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "version"
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export type ReleaseIdentity = { tag: string; name: string };

/**
 * Tag + visible name of a profile's version on a date. `number` 1 is the
 * day's first version (no suffix); 2, 3… are extra versions the same day.
 */
export function releaseIdentity(profile: ReleaseProfile, now: Date = new Date(), number = 1): ReleaseIdentity {
  const ymd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const label = now.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
  const tag = `${slug(profile.name)}-${ymd}`;
  const name = `${profile.name.trim()} · ${label}`;
  return number > 1 ? { tag: `${tag}-${number}`, name: `${name} · ${number}` } : { tag, name };
}

/** Number of a same-day version tag (1 = unsuffixed), or null if the tag is another day / profile. */
function sameDayNumber(tag: string, baseTag: string): number | null {
  if (tag === baseTag) return 1;
  if (!tag.startsWith(`${baseTag}-`)) return null;
  const rest = tag.slice(baseTag.length + 1);
  return /^\d+$/.test(rest) && Number(rest) >= 2 ? Number(rest) : null;
}

/**
 * The version to create next: the day's first one if no repo has it yet,
 * otherwise one number above the highest found on any repo, so the same
 * number is free on all of them and earlier versions are never reused.
 */
export function nextReleaseIdentity(
  profile: ReleaseProfile,
  tagsByRepo: string[][],
  now: Date = new Date(),
): ReleaseIdentity {
  const baseTag = releaseIdentity(profile, now).tag;
  let highest = 0;
  for (const tags of tagsByRepo) {
    for (const tag of tags) highest = Math.max(highest, sameDayNumber(tag, baseTag) ?? 0);
  }
  return releaseIdentity(profile, now, highest + 1);
}

/** `nextReleaseIdentity` from the repos' current tags. */
export async function resolveReleaseIdentity(
  writer: Pick<ReleaseWriter, "listTags">,
  params: { repos: string[]; profile: ReleaseProfile; now?: Date },
): Promise<ReleaseIdentity> {
  const tagsByRepo = await Promise.all(params.repos.map((repo) => writer.listTags(repo)));
  return nextReleaseIdentity(params.profile, tagsByRepo, params.now);
}

export function releaseBody(params: { profileName: string; phaseNames: string[]; by: string }): string {
  return [
    `Versión «${params.profileName}» publicada desde el borrador principal.`,
    "",
    `Fases incluidas: ${params.phaseNames.join(", ")}.`,
    `Publicada por: @${params.by.replace(/^@/, "")}`,
  ].join("\n");
}

export type ReleaseWriter = {
  /** Existing release tags of the repo. */
  listTags(repo: string): Promise<string[]>;
  /** Tip of the borrador principal (commit id) to cut the version from. */
  principalTip(repo: string): Promise<string>;
  create(repo: string, release: { tag: string; name: string; body: string; target: string }): Promise<void>;
};

export type ReleaseOutcome = { created: string[]; existing: string[] };

/**
 * Create the release in every repo that does not have the tag yet. Repos
 * where it exists are reported, never recreated.
 */
export async function publishVersion(
  writer: ReleaseWriter,
  params: { repos: string[]; tag: string; name: string; body: string },
): Promise<ReleaseOutcome> {
  const outcome: ReleaseOutcome = { created: [], existing: [] };
  for (const repo of params.repos) {
    const tags = await writer.listTags(repo);
    if (tags.includes(params.tag)) {
      outcome.existing.push(repo);
      continue;
    }
    const target = await writer.principalTip(repo);
    await writer.create(repo, { tag: params.tag, name: params.name, body: params.body, target });
    outcome.created.push(repo);
  }
  return outcome;
}

export function releaseToast(outcome: ReleaseOutcome, name: string): string {
  if (!outcome.created.length) return `La versión «${name}» ya existe. No se publicó otra.`;
  if (outcome.existing.length) return `Versión «${name}» publicada (en parte ya existía).`;
  return `Versión «${name}» publicada.`;
}
