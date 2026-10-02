import { createOrUpdateContents, DcsApiError } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { groupDraftBranches, readRaw } from "./afinacionLoad";
import { readRepoFile } from "./afinacionStore";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { loadPersonDocs, savePersonDoc, type CheckTarget } from "./checkStore";
import { dcsConfig } from "./config";
import { loadPmConfig } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import { createPull, deleteGitRef, ensureBranchFrom, getBranchSha, getDefaultBranch, getPullByBranches, mergePull } from "./pulls";
import { readTeamHelps } from "./teamHelps";
import { bookUsfmName } from "../prep/discover";
import { resolveHelpsTarget } from "../domain/helpsTarget";
import type { LevelBook } from "../domain/levels";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import type { AssignmentsDoc, ProjectTask, TaskStep } from "../domain/types";
import {
  checkAgainstEndorsement,
  checkUnitTable,
  checkUnitText,
  publishUnitTsv,
  publishUnitUsfm,
  tableFingerprints,
  textFingerprints,
  unitSlug,
  type UnitFileKind,
  type UnitFingerprints,
  type UnitProblem,
} from "../domain/unitPublish";
import { listVerseSpans, portionRange, type RefRange } from "../domain/usfmEdit";

/**
 * Door43 side of publishing one unit: read what the team has and what is published, keep what a committee endorsed,
 * and put the unit on the published branch through a pull request (so a protected branch only needs someone with
 * permission to confirm it).
 */

/** The resources a unit is made of, and how each is kept. A process names which of them its task publishes. */
const UNIT_FILES: Record<string, { kind: UnitFileKind; source?: "ult" | "ust"; content?: string[]; quoted?: boolean }> = {
  tpl: { kind: "usfm", source: "ult" },
  tps: { kind: "usfm", source: "ust" },
  notas: { kind: "tsv", content: ["Note"], quoted: true },
  preguntas: { kind: "tsv", content: ["Question", "Response"] },
};

export const isUnitResource = (resource: string): boolean => resource in UNIT_FILES;

export type UnitResource = {
  resource: string;
  kind: UnitFileKind;
  owner: string;
  repo: string;
  filepath: string;
  /** The team's version: the group draft of the work on it. */
  draft: { text: string; branch?: string } | null;
  defaultBranch: string;
  published: { text: string; sha: string } | null;
  /** Verses the source text has in this unit (texts only): what the draft must cover. */
  expectedVerses: number[];
};

export type UnitToPublish = {
  book: string;
  chapter: number;
  range: RefRange;
  resources: UnitResource[];
  /** Where review documents are kept (the endorsement record among them). */
  store: CheckTarget;
  levelBook: LevelBook;
  board: AssignmentsDoc | null;
  task: ProjectTask | null;
  step: TaskStep | null;
};

const WHOLE = (chapter: number): RefRange => ({ chapter, from: 1, to: 200 });

/** Everything about one unit: per resource, the team's version and the published one. */
export async function loadUnitToPublish(params: { session: GtSession; ctx: SolverLaunchContext; resources: string[] }): Promise<UnitToPublish> {
  const { session, ctx } = params;
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  if (!book || !ctx.chapter) throw new Error("Falta el libro o el capítulo en la tarea.");
  // The unit as its subtarea names it («2:1–15»); a bare chapter means all of it.
  const range = portionRange(ctx.ref || "", ctx.chapter) ?? WHOLE(ctx.chapter);
  const [pmConfig, board] = await Promise.all([
    ctx.pmOrg ? loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG) : Promise.resolve(DEFAULT_PM_CONFIG),
    loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg).catch(() => null),
  ]);
  const task = board?.teams.find((t) => t.id === ctx.taskId) ?? null;
  const step = task?.steps?.find((s) => s.id === ctx.stepId) ?? null;
  const pkg = resolveSourcePackage(board?.settings);
  const config = dcsConfig(session.host);

  const resources: UnitResource[] = [];
  let store: CheckTarget | null = null;
  for (const resource of params.resources.filter(isUnitResource)) {
    const spec = UNIT_FILES[resource]!;
    let owner = "";
    let repo = "";
    let filepath = "";
    let draft: UnitResource["draft"] = null;
    let expectedVerses: number[] = [];
    if (spec.kind === "usfm") {
      const target = resolveScriptureTarget({ ...ctx, resource }, pmConfig);
      if ("error" in target) continue;
      ({ owner, repo, filepath } = target);
      // The text as the team has it now: the group draft of the tasks that work on it.
      const tasks = (board?.teams ?? []).filter((t) => t.rules.some((rule) => rule.resource === resource));
      const found = await tryReadExistingBookUsfm({ session, owner, repo, filepath, branches: tasks.flatMap((t) => groupDraftBranches(book, t.id)) });
      draft = found ? { text: found.text, branch: found.branch } : null;
      const source = spec.source ? await readRaw(session, pkg.owner, pkg[spec.source], bookUsfmName(book)) : null;
      expectedVerses = source ? [...new Set(listVerseSpans(source).filter((span) => span.chapter === range.chapter).flatMap((span) => Array.from({ length: span.verseTo - span.verse + 1 }, (_, i) => span.verse + i)))] : [];
      store ??= { owner, repo };
    } else {
      const target = resolveHelpsTarget({ ...ctx, resource }, pmConfig);
      if ("error" in target || !target.filepath) continue;
      ({ owner, repo } = target);
      filepath = target.filepath;
      const own = await readTeamHelps({ session, ctx, pmConfig, board, kind: target.resource });
      // What is only on the published branch is not a draft of the team: there is nothing new to publish.
      draft = own?.branch ? own : null;
    }
    const defaultBranch = await getDefaultBranch(config, owner, repo, session.token).catch(() => "master");
    const published = await readRepoFile(session, { owner, repo, branch: defaultBranch }, filepath).catch(() => null);
    resources.push({ resource, kind: spec.kind, owner, repo, filepath, draft, defaultBranch, published, expectedVerses });
  }
  if (!store) {
    const home = resolveScriptureTarget({ ...ctx, resource: "tpl" }, pmConfig);
    if ("error" in home) throw new Error(home.error);
    store = { owner: home.owner, repo: home.repo };
  }
  return { book, chapter: ctx.chapter, range, resources, store, levelBook: pmConfig, board, task, step };
}

/** What each resource of the unit holds now, piece by piece. */
export function unitFingerprints(unit: UnitToPublish): UnitFingerprints {
  const out: UnitFingerprints = {};
  for (const r of unit.resources) {
    out[r.resource] = r.kind === "usfm" ? textFingerprints(r.draft?.text ?? null, unit.range) : tableFingerprints(r.draft?.text ?? null, unit.range);
  }
  return out;
}

type EndorsementRecord = { by: string; at: string; issue?: number; fingerprints: UnitFingerprints };
const endorsementKey = (unit: Pick<UnitToPublish, "book" | "range">) => `${unit.book}.aval-unidad.${unitSlug(unit.range)}`;

/** A committee endorsed the unit as it is now: keep what it was, so publishing can tell if it changed afterwards. */
export async function recordEndorsement(session: GtSession, unit: UnitToPublish, issue?: number): Promise<void> {
  const record: EndorsementRecord = { by: session.username, at: new Date().toISOString(), issue, fingerprints: unitFingerprints(unit) };
  await savePersonDoc(session, unit.store, endorsementKey(unit), record);
}

/** The latest endorsement of the unit, or `null` when it has none. */
export async function loadEndorsement(session: GtSession, unit: UnitToPublish): Promise<EndorsementRecord | null> {
  const docs = await loadPersonDocs<EndorsementRecord>(session, unit.store, endorsementKey(unit));
  return docs.map((row) => row.doc).filter((doc) => doc?.fingerprints).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

/** Everything that stops the unit from being published. Empty = ready. */
export function unitProblems(unit: UnitToPublish, params: { aligned: string[]; endorsement: UnitFingerprints | null; needsEndorsement: boolean }): UnitProblem[] {
  const problems: UnitProblem[] = [];
  for (const r of unit.resources) {
    const spec = UNIT_FILES[r.resource]!;
    if (r.kind === "usfm") {
      problems.push(...checkUnitText({ resource: r.resource, usfm: r.draft?.text ?? null, range: unit.range, expectedVerses: r.expectedVerses, aligned: params.aligned.includes(r.resource) }));
    } else if (r.draft) {
      // A helps table the team did not work on has nothing to publish, and nothing to check.
      problems.push(...checkUnitTable({ resource: r.resource, tsv: r.draft.text, range: unit.range, content: spec.content ?? [], quoted: Boolean(spec.quoted) }));
    }
  }
  if (params.needsEndorsement) problems.push(...checkAgainstEndorsement(unitFingerprints(unit), params.endorsement));
  return problems;
}

export type PublishOutcome = {
  resource: string;
  /** `published`: it is on the published branch now. `unchanged`: it already was. `waiting`: the pull request is open
   * and somebody with permission must confirm it. `nothing`: the team has no version of this resource. */
  status: "published" | "unchanged" | "waiting" | "nothing";
  pullUrl?: string;
  reason?: string;
};

/** The published file as it would be with the unit in it. */
export function withUnit(unit: UnitToPublish, r: UnitResource): string | null {
  if (!r.draft) return null;
  return r.kind === "usfm" ? publishUnitUsfm(r.published?.text ?? null, r.draft.text, unit.range) : publishUnitTsv(r.published?.text ?? null, r.draft.text, unit.range);
}

/**
 * Publish the unit: for each resource, a branch from the published one with the unit in it, a pull request, and its
 * merge. When the merge is refused (a protected branch), the pull request stays open for whoever may confirm it.
 */
export async function publishUnit(params: { session: GtSession; unit: UnitToPublish; note: string }): Promise<PublishOutcome[]> {
  const { session, unit } = params;
  const config = dcsConfig(session.host);
  const outcomes: PublishOutcome[] = [];
  for (const r of unit.resources) {
    const next = withUnit(unit, r);
    if (next === null) {
      outcomes.push({ resource: r.resource, status: "nothing" });
      continue;
    }
    if (r.published && next === r.published.text) {
      outcomes.push({ resource: r.resource, status: "unchanged" });
      continue;
    }
    const message = `Taller: publicar ${unit.book} ${unitSlug(unit.range)} · ${params.note}`;
    // An empty repository has no branch to start from: the first file goes straight to the published branch.
    if (!(await getBranchSha(config, r.owner, r.repo, r.defaultBranch, session.token))) {
      await createOrUpdateContents(config, r.owner, r.repo, r.filepath, { content: next, message, branch: r.defaultBranch, token: session.token });
      outcomes.push({ resource: r.resource, status: "published" });
      continue;
    }
    const head = `publicar/${unit.book.toLowerCase()}-${unitSlug(unit.range)}`;
    let pull = await getPullByBranches(config, r.owner, r.repo, r.defaultBranch, head, session.token);
    if (!pull || pull.state !== "open") {
      // A branch left from an earlier publication is behind the published one: start again from where it is now.
      await deleteGitRef(config, r.owner, r.repo, head, session.token).catch(() => undefined);
      await ensureBranchFrom(config, r.owner, r.repo, head, session.token, r.defaultBranch);
      pull = null;
    }
    const onHead = await readRepoFile(session, { owner: r.owner, repo: r.repo, branch: head }, r.filepath);
    if (!onHead || onHead.text !== next) {
      await createOrUpdateContents(config, r.owner, r.repo, r.filepath, { content: next, message, sha: onHead?.sha, branch: head, token: session.token });
    }
    pull ??= await createPull(config, r.owner, r.repo, { title: message, body: `Unidad avalada, publicada desde Taller.\n\n${params.note}`, head, base: r.defaultBranch, token: session.token });
    try {
      await mergePull(config, r.owner, r.repo, pull.number, session.token, message);
      await deleteGitRef(config, r.owner, r.repo, head, session.token).catch(() => undefined);
      outcomes.push({ resource: r.resource, status: "published", pullUrl: pull.html_url });
    } catch (err) {
      const refused = err instanceof DcsApiError && [403, 405, 409, 422].includes(err.status);
      if (!refused) throw err;
      outcomes.push({ resource: r.resource, status: "waiting", pullUrl: pull.html_url, reason: err.message });
    }
  }
  return outcomes;
}
