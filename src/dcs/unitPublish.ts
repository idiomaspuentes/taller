import { knownBranches, onlyExisting } from "./branchList";
import { createOrUpdateContents, DcsApiError, getContents } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { groupDraftBranches, readRaw } from "./afinacionLoad";
import { readRepoFile } from "./afinacionStore";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { loadPersonDocs, savePersonDoc, type CheckTarget } from "./checkStore";
import { dcsConfig } from "./config";
import { loadPmConfig } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import { branchExists, createPull, deleteGitRef, ensureBranchFrom, getBranchSha, getDefaultBranch, getPullByBranches, mergePull } from "./pulls";
import { readTeamHelps } from "./teamHelps";
import { alignedVersesOf } from "./glossaryStore";
import { departuresFrom, type GlossaryEntry, type RenderingCount } from "../domain/glossary";
import { bookUsfmName } from "../prep/discover";
import { resolveHelpsTarget } from "../domain/helpsTarget";
import type { LevelBook } from "../domain/levels";
import { DEFAULT_PM_CONFIG, resolveResourceRepo } from "../domain/roles";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import type { AssignmentsDoc, ProjectTask, ScopeKey, TaskStep } from "../domain/types";
import {
  articleFingerprints,
  articlesOfUnit,
  checkUnitArticles,
  checkAgainstEndorsement,
  checkUnitTable,
  checkUnitText,
  publishUnitTsv,
  publishUnitUsfm,
  tableFingerprints,
  textFingerprints,
  unitSlug,
  validationBranchName,
  type UnitFileKind,
  type UnitFingerprints,
  type UnitProblem,
} from "../domain/unitPublish";
import { listVerseSpans, portionRange, type RefRange } from "../domain/usfmEdit";

/**
 * Door43 side of taking one unit to the published branch: read what the team has and what is published, put the unit
 * on its validation branch with a request left open, keep what a committee endorsed, and merge that request once it
 * did (so a protected branch only needs someone with permission to confirm it). The release comes after.
 */

/** The resources a unit is made of, and how each is kept. A process names which of them its task publishes. */
const UNIT_FILES: Record<string, { kind: UnitFileKind; source?: "ult" | "ust"; content?: string[]; quoted?: boolean }> = {
  tpl: { kind: "usfm", source: "ult" },
  tps: { kind: "usfm", source: "ust" },
  notas: { kind: "tsv", content: ["Note"], quoted: true },
  preguntas: { kind: "tsv", content: ["Question", "Response"] },
  // Articles belong to the whole language: the unit carries the ones its notes and key terms link to.
  academia: { kind: "articles" },
  palabras: { kind: "articles" },
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
  /** The articles the unit links to, as the team has them and as they are published (articles only). */
  articles?: UnitArticle[];
};

export type UnitArticle = { path: string; text: string; published: { text: string; sha: string } | null };

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
  // Which articles the unit links to is read once: from the team's notes and from the list of key terms.
  let linked: ReturnType<typeof articlesOfUnit> | null = null;
  const linkedArticles = async () => {
    if (linked) return linked;
    const [notes, terms] = await Promise.all([
      readTeamHelps({ session, ctx, pmConfig, board, kind: "notas" }).catch(() => null),
      readRaw(session, pkg.owner, pkg.twl, `twl_${book}.tsv`),
    ]);
    linked = articlesOfUnit({ notesTsv: notes?.text ?? null, termsTsv: terms, range });
    return linked;
  };
  for (const resource of params.resources.filter(isUnitResource)) {
    const spec = UNIT_FILES[resource]!;
    let owner = "";
    let repo = "";
    let filepath = "";
    let draft: UnitResource["draft"] = null;
    let expectedVerses: number[] = [];
    if (spec.kind === "articles") {
      owner = (ctx.contentOrg || "").trim();
      repo = resolveResourceRepo(resource as ScopeKey, ctx.lang, pmConfig) ?? "";
      if (!owner || !repo) continue;
      const defaultBranch = await getDefaultBranch(config, owner, repo, session.token).catch(() => "");
      if (!defaultBranch) continue;
      // The team's articles are on the group draft of the work on them; with no such branch there is nothing new.
      const tasks = (board?.teams ?? []).filter((t) => t.rules.some((rule) => rule.resource === resource)).reverse();
      let branch: string | undefined;
      const names = await knownBranches(config, owner, repo, session.token);
      for (const candidate of onlyExisting([...new Set(tasks.flatMap((t) => groupDraftBranches(book, t.id)))], names)) {
        if (await branchExists(config, owner, repo, candidate, session.token).catch(() => false)) {
          branch = candidate;
          break;
        }
      }
      const articles: UnitArticle[] = [];
      if (branch) {
        const wanted = (await linkedArticles())[resource as "academia" | "palabras"];
        // An Academia article is a folder of files; a Palabras article is one file.
        const paths = (
          await Promise.all(
            wanted.map(async (path) => {
              if (/\.md$/.test(path)) return [path];
              const listing = await getContents(config, owner, repo, path, { ref: branch, token: session.token }).catch(() => null);
              return Array.isArray(listing) ? listing.filter((entry) => entry.type === "file").map((entry) => entry.path) : [];
            }),
          )
        ).flat();
        for (const path of paths) {
          const mine = await readRepoFile(session, { owner, repo, branch }, path).catch(() => null);
          if (!mine) continue;
          articles.push({ path, text: mine.text, published: await readRepoFile(session, { owner, repo, branch: defaultBranch }, path).catch(() => null) });
        }
      }
      resources.push({ resource, kind: "articles", owner, repo, filepath: "", draft: branch ? { text: "", branch } : null, defaultBranch, published: null, expectedVerses: [], articles });
      continue;
    }
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
    out[r.resource] = r.kind === "articles" ? articleFingerprints(r.articles ?? []) : r.kind === "usfm" ? textFingerprints(r.draft?.text ?? null, unit.range) : tableFingerprints(r.draft?.text ?? null, unit.range);
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
    if (r.kind === "articles") {
      problems.push(...checkUnitArticles(r.resource, r.articles ?? []));
    } else if (r.kind === "usfm") {
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

export type UnitFileChange = { path: string; content: string };

/** The texts of the book as they are published once the unit is in: what the glossary's index is made from. */
export function publishedTextsOf(unit: UnitToPublish): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of unit.resources) {
    if (r.kind !== "usfm") continue;
    const text = unitChanges(unit, r)?.[0]?.content ?? r.published?.text;
    if (text) out[r.resource] = text;
  }
  return out;
}

/**
 * What publishing would write for a resource: the published file with the unit in it, or each article that differs
 * from the published one. `null` when the team has no version of the resource; empty when it is already published.
 */
export function unitChanges(unit: UnitToPublish, r: UnitResource): UnitFileChange[] | null {
  if (!r.draft) return null;
  if (r.kind === "articles") return (r.articles ?? []).filter((a) => a.text !== a.published?.text).map((a) => ({ path: a.path, content: a.text }));
  const next = r.kind === "usfm" ? publishUnitUsfm(r.published?.text ?? null, r.draft.text, unit.range) : publishUnitTsv(r.published?.text ?? null, r.draft.text, unit.range);
  return r.published && next === r.published.text ? [] : [{ path: r.filepath, content: next }];
}

export type StageOutcome = {
  resource: string;
  /** `staged`: it is on the validation branch, with its request open. `unchanged`: the published branch already
   * says the same. `nothing`: the team has no version of this resource. `direct`: the repository is empty, so
   * there is no branch to start from and the unit will be written straight when it is published. */
  status: "staged" | "unchanged" | "nothing" | "direct";
  pullUrl?: string;
};

const stageMessage = (unit: UnitToPublish, note: string) => `Taller: ${unit.book} ${unitSlug(unit.range)} a validación · ${note}`;

/**
 * Put the unit where the committee validates it: for each resource, the validation branch of the unit (started from
 * the published one, with the unit in it) and a request towards the published branch, left open. Done again after a
 * correction, it only writes what differs, and the open request shows it. Nothing reaches the published branch.
 */
export async function stageUnit(params: { session: GtSession; unit: UnitToPublish; note: string }): Promise<StageOutcome[]> {
  const { session, unit } = params;
  const config = dcsConfig(session.host);
  const head = validationBranchName(unit.book, unit.range);
  const outcomes: StageOutcome[] = [];
  for (const r of unit.resources) {
    const changes = unitChanges(unit, r);
    if (changes === null) {
      outcomes.push({ resource: r.resource, status: "nothing" });
      continue;
    }
    let pull = await getPullByBranches(config, r.owner, r.repo, r.defaultBranch, head, session.token).catch(() => null);
    if (pull && pull.state !== "open") pull = null;
    if (!changes.length && !pull) {
      outcomes.push({ resource: r.resource, status: "unchanged" });
      continue;
    }
    if (!(await getBranchSha(config, r.owner, r.repo, r.defaultBranch, session.token))) {
      outcomes.push({ resource: r.resource, status: "direct" });
      continue;
    }
    const message = stageMessage(unit, params.note);
    if (!pull) {
      // A branch left from an earlier round is behind the published one: start again from where that is now.
      await deleteGitRef(config, r.owner, r.repo, head, session.token).catch(() => undefined);
      await ensureBranchFrom(config, r.owner, r.repo, head, session.token, r.defaultBranch);
    }
    for (const change of changes) {
      const onHead = await readRepoFile(session, { owner: r.owner, repo: r.repo, branch: head }, change.path);
      if (!onHead || onHead.text !== change.content) {
        await createOrUpdateContents(config, r.owner, r.repo, change.path, { content: change.content, message, sha: onHead?.sha, branch: head, token: session.token });
      }
    }
    pull ??= await createPull(config, r.owner, r.repo, { title: message, body: `Unidad lista para validar, preparada desde Taller.\n\n${params.note}`, head, base: r.defaultBranch, token: session.token });
    outcomes.push({ resource: r.resource, status: "staged", pullUrl: pull.html_url });
  }
  return outcomes;
}

/**
 * Publish the unit, once endorsed: the validation branch of each resource is merged into the published one. The
 * unit is staged again first, so what is merged is what the team has now. When the merge is refused (a protected
 * branch), the request stays open for whoever may confirm it.
 */
export async function publishUnit(params: { session: GtSession; unit: UnitToPublish; note: string }): Promise<PublishOutcome[]> {
  const { session, unit } = params;
  const config = dcsConfig(session.host);
  const head = validationBranchName(unit.book, unit.range);
  const staged = await stageUnit(params);
  const outcomes: PublishOutcome[] = [];
  for (const r of unit.resources) {
    const stage = staged.find((row) => row.resource === r.resource);
    if (!stage || stage.status === "nothing") {
      outcomes.push({ resource: r.resource, status: "nothing" });
      continue;
    }
    if (stage.status === "unchanged") {
      outcomes.push({ resource: r.resource, status: "unchanged" });
      continue;
    }
    const message = `Taller: publicar ${unit.book} ${unitSlug(unit.range)} · ${params.note}`;
    if (stage.status === "direct") {
      // An empty repository has no branch to start from: the first file goes straight to the published branch.
      for (const change of unitChanges(unit, r) ?? []) await createOrUpdateContents(config, r.owner, r.repo, change.path, { content: change.content, message, branch: r.defaultBranch, token: session.token });
      outcomes.push({ resource: r.resource, status: "published" });
      continue;
    }
    const pull = await getPullByBranches(config, r.owner, r.repo, r.defaultBranch, head, session.token);
    if (!pull) throw new Error(`No se encontró la solicitud de «${head}» en ${r.owner}/${r.repo}.`);
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

export type GlossaryNotice = { resource: string; entry: GlossaryEntry; found: RenderingCount[] };

/**
 * Where the texts of the unit use a wording an agreed glossary entry does not allow. It is a notice for whoever
 * publishes, not a check: wordings vary for good reasons, and the committee already endorsed the unit.
 */
export function glossaryNotices(unit: UnitToPublish, entries: GlossaryEntry[]): GlossaryNotice[] {
  const out: GlossaryNotice[] = [];
  for (const r of unit.resources) {
    if (r.kind !== "usfm" || !r.draft) continue;
    const all = alignedVersesOf(r.draft.text, unit.book);
    const mine = Object.fromEntries(
      Object.entries(all).filter(([ref]) => {
        const match = /(\d+):(\d+)$/.exec(ref);
        return Boolean(match) && Number(match![1]) === unit.range.chapter && Number(match![2]) >= unit.range.from && Number(match![2]) <= unit.range.to;
      }),
    );
    for (const entry of entries) {
      if (entry.status !== "agreed" || !(entry.scope === "all" || entry.scope === r.resource)) continue;
      const found = departuresFrom(entry, mine);
      if (found.length) out.push({ resource: r.resource, entry, found });
    }
  }
  return out;
}
