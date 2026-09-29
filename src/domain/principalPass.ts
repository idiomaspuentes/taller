/**
 * «Pasar al borrador principal»: a gestor moves a finished task's verses
 * from its borrador grupal (task trunk) into the borrador principal (repo
 * default branch). Not a release. Pure: the DCS writer lives in
 * `dcs/principalPass.ts`.
 *
 * Splice rules (same engine as Cerrar, `patchTrunkByVerse`): only the task's
 * ranges change; empty loses to filled; the same occupied verse with two
 * different non-empty texts aborts the whole pass (no last-wins). A review
 * task (`ProjectTask.reviewsPrincipal`) instead replaces those verses, only
 * the ones the gestor confirmed.
 */

import type { DcsIssue } from "@ip-lms/dcs-client";
import type { PrincipalPassMark, ProjectSettings } from "./types";
import { parseChatEvent } from "./chatEvent";
import { verseChoiceDecisionId } from "./conflictChoice";
import { verseConflictData } from "./verseConflictEvent";
import { parseVerseConflictsComment } from "./verseConflicts";
import { listVerseSpans, normalizeVerseText, parseRefRange, type RefRange } from "./usfmEdit";
import { mergeIntoTrunkWithRetry } from "./trunkMerge";
import { patchTrunkByVerse } from "./usfmTrunkPatch";
import { verseSlotsOf } from "./usfmVerseMerge";
import { parseWorkOrderMarker } from "./workOrder";
import { refFromIssueTitle } from "./solverLaunch";
import { DEFAULT_PM_NAMESPACE, parsePmFacetValue, pmFacetLabel } from "./roles";

export const PRINCIPAL_PASS_ACTION = "Pasar al borrador principal";

const SCRIPTURE_RESOURCES = new Set(["tpl", "tps"]);

type Slot = { chapter: number; from: number; to: number; text: string };

function overlaps(a: RefRange, b: RefRange): boolean {
  return a.chapter === b.chapter && a.from <= b.to && b.from <= a.to;
}

export function rangeLabel(range: RefRange): string {
  return range.to > range.from ? `${range.chapter}:${range.from}–${range.to}` : `${range.chapter}:${range.from}`;
}

function issueTaskId(issue: DcsIssue, namespaceId: string): string | null {
  for (const label of issue.labels ?? []) {
    const value = parsePmFacetValue(label.name, "tarea", namespaceId);
    if (value) return value;
  }
  return parseWorkOrderMarker(issue.body)?.teamId ?? null;
}

export function issueHasOpenDecision(issue: DcsIssue, namespaceId: string = DEFAULT_PM_NAMESPACE): boolean {
  const name = pmFacetLabel("estado", "conflicto", namespaceId);
  return (issue.labels ?? []).some((label) => label.name === name);
}

/** PM issues of one task in one book (same matching as the pass gate). */
export function issuesOfTask(params: {
  issues: DcsIssue[];
  taskId: string;
  book: string;
  namespaceId?: string;
}): DcsIssue[] {
  const namespaceId = params.namespaceId ?? DEFAULT_PM_NAMESPACE;
  const book = params.book.trim().toUpperCase();
  return params.issues.filter((issue) => {
    if (issueTaskId(issue, namespaceId) !== params.taskId) return false;
    const marker = parseWorkOrderMarker(issue.body);
    const issueBook = (marker?.book || issue.milestone?.title || "").trim().toUpperCase();
    return !book || !issueBook || issueBook === book;
  });
}

export function isScriptureIssue(issue: DcsIssue): boolean {
  return SCRIPTURE_RESOURCES.has((parseWorkOrderMarker(issue.body)?.resource ?? "").toLowerCase());
}

/** One scripture resource of the task: the repo file to splice and its ranges. */
export type PrincipalPassTarget = {
  resource: string;
  book: string;
  ranges: RefRange[];
  issues: number[];
};

export type PrincipalPassGate = {
  /** Worker-facing reason the control is disabled; null = enabled. */
  blockReason: string | null;
  targets: PrincipalPassTarget[];
  total: number;
  closed: number;
};

/** Merge touching/overlapping ranges per chapter so each splice has one scope. */
export function mergeRanges(ranges: RefRange[]): RefRange[] {
  const sorted = [...ranges].sort((a, b) => a.chapter - b.chapter || a.from - b.from);
  const out: RefRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.chapter === r.chapter && r.from <= last.to + 1) {
      last.to = Math.max(last.to, r.to);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * Completion rule: every PM issue of this book + task is closed (at least
 * one exists). Open decision: any of them still carries `pm/estado:conflicto`.
 * Ranges come from issue titles; one that does not parse blocks the pass.
 */
export function principalPassGate(params: {
  issues: DcsIssue[];
  taskId: string;
  book: string;
  namespaceId?: string;
}): PrincipalPassGate {
  const namespaceId = params.namespaceId ?? DEFAULT_PM_NAMESPACE;
  const book = params.book.trim().toUpperCase();
  const scripture = issuesOfTask({ ...params, namespaceId }).filter(isScriptureIssue);
  const total = scripture.length;
  const closed = scripture.filter((issue) => issue.state === "closed").length;
  const base = { targets: [] as PrincipalPassTarget[], total, closed };

  if (!total) {
    return { ...base, blockReason: "Esta tarea no tiene subtareas de texto bíblico publicadas." };
  }
  if (closed < total) {
    const left = total - closed;
    return {
      ...base,
      blockReason: `${left === 1 ? "Falta 1 subtarea" : `Faltan ${left} subtareas`} por terminar (${closed} de ${total} listas).`,
    };
  }
  const deciding = scripture.filter((issue) => issueHasOpenDecision(issue, namespaceId));
  if (deciding.length) {
    return {
      ...base,
      blockReason: `Hay decisiones de versículo sin resolver en ${deciding
        .map((issue) => `#${issue.number}`)
        .join(", ")}. Resuélvelas primero.`,
    };
  }

  const byResource = new Map<string, PrincipalPassTarget>();
  for (const issue of scripture) {
    const marker = parseWorkOrderMarker(issue.body)!;
    const resource = marker.resource.toLowerCase();
    const range = parseRefRange(refFromIssueTitle(issue.title));
    if (!range) {
      return {
        ...base,
        blockReason: `No se pudo leer el rango de versículos de #${issue.number} («${refFromIssueTitle(issue.title)}»). Corrige el título de la subtarea.`,
      };
    }
    const target = byResource.get(resource) ?? {
      resource,
      book: (marker.book || book).toUpperCase(),
      ranges: [],
      issues: [],
    };
    target.ranges.push(range);
    target.issues.push(issue.number);
    byResource.set(resource, target);
  }
  const targets = [...byResource.values()].map((t) => ({ ...t, ranges: mergeRanges(t.ranges) }));
  return { ...base, targets, blockReason: null };
}

export type PrincipalPassResult =
  /** `replaced`: verses whose principal text the review replaced (only with `replace`). */
  | { status: "write"; usfm: string; verses: RefRange[]; replaced?: RefRange[] }
  | { status: "same" }
  | { status: "empty" }
  | { status: "differ"; verses: RefRange[] }
  | { status: "error"; reason: string };

function slotsIn(slots: Slot[], ranges: RefRange[]): Slot[] {
  return slots.filter((slot) => ranges.some((r) => overlaps(slot, r)));
}

function outsideKey(usfm: string, ranges: RefRange[]): string[] {
  return listVerseSpans(usfm)
    .filter((s) => !ranges.some((r) => overlaps({ chapter: s.chapter, from: s.verse, to: s.verseTo }, r)))
    .map((s) => `${s.chapter}:${s.verse}-${s.verseTo}${s.segment ?? ""}\u0000${normalizeVerseText(s.rawBody)}`);
}

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})( |$)/m;

/**
 * Splice the grupal text of `ranges` into `principal`. `write` carries the
 * new principal text; `same` means both already agree on the range; `differ`
 * lists verses where both have different non-empty text (nothing to write).
 *
 * With `replace` (review task), differing verses do not abort: the grupal
 * text wins inside the ranges and `write.replaced` lists them. Same patch,
 * so bytes outside the changed verses are kept.
 */
export function computePrincipalPass(params: {
  principal: string;
  grupal: string;
  ranges: RefRange[];
  replace?: boolean;
}): PrincipalPassResult {
  const { principal, grupal } = params;
  const ranges = mergeRanges(params.ranges);
  if (!ranges.length) return { status: "error", reason: "La tarea no tiene rango de versículos." };

  const incoming = slotsIn(verseSlotsOf(grupal), ranges).filter((s) => s.text);
  if (!incoming.length) return { status: "empty" };
  const current = verseSlotsOf(principal).filter((s) => s.text);

  const differ: RefRange[] = [];
  for (const g of incoming) {
    for (const p of current) {
      if (!overlaps(p, g)) continue;
      if (p.from === g.from && p.to === g.to && p.text === g.text) continue;
      differ.push({ chapter: g.chapter, from: Math.min(p.from, g.from), to: Math.max(p.to, g.to) });
    }
  }
  const replaced = mergeRanges(differ);
  if (replaced.length && !params.replace) return { status: "differ", verses: replaced };

  let usfm = principal;
  for (const scope of ranges) {
    // With the principal as ancestor only grupal slots that differ from it compete, so they win.
    const patch = patchTrunkByVerse(usfm, [grupal], replaced.length ? { scope, ancestor: usfm } : { scope });
    if (patch.conflicts.length) {
      return {
        status: "differ",
        verses: mergeRanges(patch.conflicts.map((c) => ({ chapter: c.chapter, from: c.from, to: c.to }))),
      };
    }
    usfm = patch.usfm;
  }
  if (usfm === principal) return { status: "same" };

  const before = outsideKey(principal, ranges);
  const after = outsideKey(usfm, ranges);
  if (before.length !== after.length || before.some((row, i) => row !== after[i])) {
    return { status: "error", reason: "El paso cambiaría versículos fuera de la tarea. No se escribió nada." };
  }
  if (CONFLICT_MARKER.test(usfm) && !CONFLICT_MARKER.test(principal)) {
    return { status: "error", reason: "El resultado tendría marcas de conflicto. No se escribió nada." };
  }
  return { status: "write", usfm, verses: ranges, ...(replaced.length ? { replaced } : {}) };
}

function covers(outer: RefRange[], inner: RefRange[]): boolean {
  return inner.every((v) => outer.some((o) => o.chapter === v.chapter && o.from <= v.from && v.to <= o.to));
}

/**
 * The review would now replace verses the gestor did not confirm (the
 * borrador principal or the borrador grupal changed after the confirm dialog).
 */
export function principalReviewUnconfirmedMessage(verses: RefRange[], book: string): string {
  const list = verses.map(rangeLabel).join(", ");
  return `${book ? `${book} ` : ""}${list}: el texto cambió desde que confirmaste la revisión. Vuelve a pulsar «${PRINCIPAL_PASS_ACTION}» para ver qué versículos se reemplazan. No se cambió el borrador principal.`;
}

/** Throws a Spanish error when the pass cannot go ahead with what the gestor confirmed. */
function checkPassResult(
  result: PrincipalPassResult,
  target: { book: string; ranges: RefRange[] },
  confirmed: RefRange[] | undefined,
): void {
  if (result.status === "differ") throw new Error(principalPassDifferMessage(result.verses, target.book));
  if (result.status === "empty") {
    throw new Error(
      `El borrador grupal no tiene texto en ${target.ranges.map(rangeLabel).join(", ")}. No se cambió el borrador principal.`,
    );
  }
  if (result.status === "error") throw new Error(result.reason);
  if (result.status === "write" && result.replaced && !covers(confirmed ?? [], result.replaced)) {
    throw new Error(principalReviewUnconfirmedMessage(result.replaced, target.book));
  }
}

/** What a review pass would replace in one file, read before the confirm dialog. */
export type PrincipalReviewPreview = { label: string; book: string; resource: string; replaced: RefRange[] };

/**
 * Read-only: the verses a review task would replace in each file. Throws the
 * same Spanish errors as the pass when a file cannot be passed at all.
 */
export async function previewPrincipalReview(jobs: PrincipalPassJob[]): Promise<PrincipalReviewPreview[]> {
  const out: PrincipalReviewPreview[] = [];
  for (const { io, target, label } of jobs) {
    const [principal, grupal] = await Promise.all([io.readPrincipal(), io.readGrupal()]);
    const result = computePrincipalPass({ principal: principal.text, grupal, ranges: target.ranges, replace: true });
    const replaced = result.status === "write" ? (result.replaced ?? []) : [];
    checkPassResult(result, target, replaced);
    out.push({ label, book: target.book, resource: target.resource, replaced });
  }
  return out;
}

/**
 * Confirm sentence for a review pass: names the verses, says the review
 * replaces them in the borrador principal and that no version is published.
 */
export function principalReviewConfirmText(params: {
  taskName: string;
  replaced: { book: string; verses: RefRange[] }[];
}): string {
  const rows = params.replaced.filter((r) => r.verses.length);
  const name = params.taskName.trim() ? `«${params.taskName.trim()}»` : "Esta revisión";
  if (!rows.length) {
    return `${name} no reemplaza ningún versículo con otro texto: solo completa los vacíos del borrador principal. Esto no publica una versión.`;
  }
  const count = rows.reduce((n, r) => n + r.verses.length, 0);
  const list = rows.map((r) => `${r.book} ${r.verses.map(rangeLabel).join(", ")}`).join("; ");
  return `${name} reemplaza en el borrador principal ${count === 1 ? "el versículo" : "los versículos"} ${list} con el texto de la revisión. Los versículos fuera de esta revisión no cambian. Esto no publica una versión.`;
}

export type PrincipalPassIo = {
  /** `serverAt`: Door43 committer date of the file's last commit on the borrador principal. */
  readPrincipal(): Promise<{ text: string; sha?: string; serverAt?: string }>;
  readGrupal(): Promise<string>;
  /** `serverAt`: Door43 committer date of the commit this write created. */
  write(text: string, sha: string | undefined): Promise<{ serverAt?: string } | void>;
  isShaConflict(err: unknown): boolean;
};

/** `serverAt`: server time of the write, or of the principal read that already matched. */
export type PrincipalPassOutcome = {
  status: "written" | "already";
  verses: RefRange[];
  /** Verses whose principal text a review replaced. */
  replaced?: RefRange[];
  serverAt?: string;
};

/**
 * Read principal + grupal, splice, write with SHA retry (one parent, no
 * merge commit). Throws a Spanish error on `differ`/`empty`/`error`; the
 * principal is never written in those cases.
 *
 * `confirmedReplace` (review task only): verses the gestor confirmed the
 * review may replace. Differing verses then do not abort; any differing
 * verse outside that list throws before writing.
 */
export async function passIntoPrincipal(
  io: PrincipalPassIo,
  target: { book: string; ranges: RefRange[] },
  confirmedReplace?: RefRange[],
): Promise<PrincipalPassOutcome> {
  const ranges = mergeRanges(target.ranges);
  const replace = confirmedReplace !== undefined;
  let verses = ranges;
  let replaced: RefRange[] | undefined;
  let readAt: string | undefined;
  let writtenAt: string | undefined;
  const { wrote } = await mergeIntoTrunkWithRetry(
    {
      read: async () => {
        const file = await io.readPrincipal();
        readAt = file.serverAt;
        return file;
      },
      write: async (text, sha) => {
        writtenAt = (await io.write(text, sha))?.serverAt;
      },
      isShaConflict: io.isShaConflict,
      exhaustedMessage:
        "El borrador principal cambió mientras se guardaba. Vuelve a pulsar «Pasar al borrador principal».",
    },
    async (principal) => {
      const grupal = await io.readGrupal();
      const result = computePrincipalPass({ principal, grupal, ranges, replace });
      checkPassResult(result, { book: target.book, ranges }, confirmedReplace);
      if (result.status !== "write") return { usfm: principal, conflicts: [], warnings: [] };
      verses = result.verses;
      replaced = result.replaced;
      return { usfm: result.usfm, conflicts: [], warnings: [] };
    },
  );
  const serverAt = wrote ? writtenAt : readAt;
  return {
    status: wrote ? "written" : "already",
    verses,
    ...(wrote && replaced ? { replaced } : {}),
    ...(serverAt ? { serverAt } : {}),
  };
}

export const PRINCIPAL_PASS_NO_SERVER_TIME =
  "Door43 no devolvió la hora del cambio en el borrador principal. Vuelve a pulsar «Pasar al borrador principal».";

export const PRINCIPAL_PASS_NO_DECISION_TIME =
  "No se pudo leer la fecha de una decisión de versículo de esta tarea. No se marcó como pasada; vuelve a pulsar «Pasar al borrador principal».";

function serverMs(iso: string | undefined): number {
  return iso ? Date.parse(iso) : NaN;
}

export type PrincipalPassJob = {
  io: PrincipalPassIo;
  target: PrincipalPassTarget;
  label: string;
  /** Commit id of the last successful `io.write`, if the writer knows it. */
  lastCommit?: () => string | undefined;
  /** Review task only: verses the gestor confirmed may be replaced (see `passIntoPrincipal`). */
  confirmedReplace?: RefRange[];
};

export type PrincipalPassRun = {
  written: string[];
  already: string[];
  /** Review task: verses whose principal text was replaced, e.g. «NEH 2:10». */
  replaced?: string[];
  /** Set only when every target was written or already agreed. */
  mark: PrincipalPassMark;
};

/**
 * Pass every scripture target of one task. With several targets, all are
 * checked first so one differing file blocks the whole task. Any failure
 * throws and yields no mark; `already` counts only because this same call
 * read both texts and found them identical and non-empty on the range.
 * The mark's time is the latest Door43 server time among the targets; a
 * target without one throws (no browser clock stands in).
 *
 * When a target did not need a write, its file time predates the verse
 * decisions that led here, so the mark's time is raised to the newest
 * verse-decision comment of the task (`loadDecisions`, server `created_at`
 * of comments since the oldest unchanged file time). An unreadable comment
 * date throws: no mark.
 */
export async function passTaskIntoPrincipal(
  jobs: PrincipalPassJob[],
  ctx: {
    taskId: string;
    book: string;
    by: string;
    issues: DcsIssue[];
    namespaceId?: string;
    loadDecisions?: (since: string) => Promise<PassDecisionComment[]>;
  },
): Promise<PrincipalPassRun> {
  if (!jobs.length) throw new Error("Esta tarea no tiene texto bíblico que pasar.");
  if (jobs.length > 1) {
    for (const { io, target, confirmedReplace } of jobs) {
      const [principal, grupal] = await Promise.all([io.readPrincipal(), io.readGrupal()]);
      const check = computePrincipalPass({
        principal: principal.text,
        grupal,
        ranges: target.ranges,
        replace: confirmedReplace !== undefined,
      });
      checkPassResult(check, target, confirmedReplace);
    }
  }
  const written: string[] = [];
  const already: string[] = [];
  const replaced: string[] = [];
  const commits: string[] = [];
  let serverAt: string | undefined;
  let unchangedSince: string | undefined;
  for (const job of jobs) {
    const outcome = await passIntoPrincipal(job.io, job.target, job.confirmedReplace);
    const t = serverMs(outcome.serverAt);
    if (!Number.isFinite(t)) throw new Error(PRINCIPAL_PASS_NO_SERVER_TIME);
    if (!serverAt || t > serverMs(serverAt)) serverAt = outcome.serverAt!;
    if (outcome.status === "written") {
      written.push(job.label);
      if (outcome.replaced?.length) replaced.push(`${job.target.book} ${outcome.replaced.map(rangeLabel).join(", ")}`);
      const commit = job.lastCommit?.();
      if (commit) commits.push(commit);
    } else {
      already.push(job.label);
      if (!unchangedSince || t < serverMs(unchangedSince)) unchangedSince = outcome.serverAt!;
    }
  }
  const scripture = issuesOfTask({ issues: ctx.issues, taskId: ctx.taskId, book: ctx.book, namespaceId: ctx.namespaceId })
    .filter(isScriptureIssue);
  if (unchangedSince && ctx.loadDecisions) {
    const own = new Set(scripture.map((i) => i.number));
    for (const c of await ctx.loadDecisions(unchangedSince)) {
      if (!own.has(c.issue) || !isVerseDecisionComment(c.body)) continue;
      const t = Date.parse(c.createdAt);
      if (!Number.isFinite(t)) throw new Error(PRINCIPAL_PASS_NO_DECISION_TIME);
      if (t > serverMs(serverAt)) serverAt = c.createdAt;
    }
  }
  const closedThrough = latestClosedAt(scripture);
  const mark: PrincipalPassMark = {
    book: ctx.book.trim().toUpperCase(),
    taskId: ctx.taskId,
    at: serverAt!,
    serverAt: serverAt!,
    by: ctx.by.replace(/^@/, ""),
    issues: scripture.map((i) => i.number).sort((a, b) => a - b),
    ...(closedThrough ? { closedThrough } : {}),
    ...(commits.length ? { commits } : {}),
  };
  return { written, already, ...(replaced.length ? { replaced } : {}), mark };
}

function closedTime(issue: DcsIssue): number {
  const t = issue.closed_at ? Date.parse(issue.closed_at) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function latestClosedAt(issues: DcsIssue[]): string | undefined {
  let best: DcsIssue | undefined;
  for (const issue of issues) {
    const t = closedTime(issue);
    if (Number.isFinite(t) && (!best || t > closedTime(best))) best = issue;
  }
  return best?.closed_at;
}

export function findPrincipalPassMark(
  settings: ProjectSettings | undefined,
  taskId: string,
  book: string,
): PrincipalPassMark | undefined {
  const code = book.trim().toUpperCase();
  return settings?.principalPasses?.find((m) => m.taskId === taskId && m.book === code);
}

/** A comment on a subtarea (PM issue, or its PR mapped to the PM issue number). */
export type PassDecisionComment = { issue: number; createdAt: string; body: string };

/**
 * Verse conflict opened or verse choice recorded: the `verse-conflict` /
 * `verse-choice` chat events on the PM issues, or the `tas:verse-conflicts`
 * comment Cerrar leaves on the PR.
 */
export function isVerseDecisionComment(body: string | null | undefined): boolean {
  if (parseVerseConflictsComment(body)) return true;
  const event = parseChatEvent(body);
  return Boolean(event && (verseConflictData(event) || verseChoiceDecisionId(event)));
}

/**
 * Verse decisions on the task's scripture subtareas written after the pass,
 * comparing the comment's server `created_at` with the mark's `serverAt`.
 * A missing or unreadable time on either side counts as newer (fail closed).
 */
export function verseDecisionsAfterPass(params: {
  mark: PrincipalPassMark;
  issues: DcsIssue[];
  comments: PassDecisionComment[];
  namespaceId?: string;
}): PassDecisionComment[] {
  const { mark } = params;
  const passAt = serverMs(mark.serverAt);
  const own = new Set(
    issuesOfTask({ issues: params.issues, taskId: mark.taskId, book: mark.book, namespaceId: params.namespaceId })
      .filter(isScriptureIssue)
      .map((issue) => issue.number),
  );
  for (const n of mark.issues) own.add(n);
  return params.comments.filter((c) => {
    if (!own.has(c.issue) || !isVerseDecisionComment(c.body)) return false;
    const t = Date.parse(c.createdAt);
    return !Number.isFinite(passAt) || !Number.isFinite(t) || t > passAt;
  });
}

/**
 * Still valid: the task's scripture subtareas are all closed, none has an
 * open decision, every one was covered by the pass and none was closed
 * again after it. With `decisions` (the subtareas' comments), a verse
 * conflict or verse choice newer than the pass also makes it stale, even
 * when the conflict label is already gone. A mark without a server time
 * (saved before `serverAt` existed) never counts: pass again.
 */
export function principalPassMarkIsCurrent(params: {
  mark: PrincipalPassMark | undefined;
  issues: DcsIssue[];
  namespaceId?: string;
  decisions?: PassDecisionComment[];
}): boolean {
  const { mark } = params;
  if (!mark || !Number.isFinite(serverMs(mark.serverAt))) return false;
  const namespaceId = params.namespaceId ?? DEFAULT_PM_NAMESPACE;
  const scripture = issuesOfTask({ issues: params.issues, taskId: mark.taskId, book: mark.book, namespaceId })
    .filter(isScriptureIssue);
  if (!scripture.length) return false;
  const covered = new Set(mark.issues);
  const limit = mark.closedThrough ? Date.parse(mark.closedThrough) : NaN;
  const closedOk = scripture.every((issue) => {
    if (issue.state !== "closed" || issueHasOpenDecision(issue, namespaceId)) return false;
    if (!covered.has(issue.number)) return false;
    const t = closedTime(issue);
    return !Number.isFinite(limit) || !Number.isFinite(t) || t <= limit;
  });
  if (!closedOk || !params.decisions) return closedOk;
  return !verseDecisionsAfterPass({ mark, issues: params.issues, comments: params.decisions, namespaceId }).length;
}

/**
 * Drop marks touched by a verse conflict or verse choice: marks covering one
 * of `issues`, or belonging to one of `taskIds`. Same object when nothing changes.
 */
export function dropPrincipalPassesFor(
  settings: ProjectSettings | undefined,
  touched: { issues: number[]; taskIds?: string[] },
): ProjectSettings | undefined {
  const marks = settings?.principalPasses;
  if (!marks?.length) return settings;
  const issues = new Set(touched.issues.filter((n) => n > 0));
  const tasks = new Set((touched.taskIds ?? []).filter(Boolean));
  const keep = marks.filter((m) => !tasks.has(m.taskId) && !m.issues.some((n) => issues.has(n)));
  if (keep.length === marks.length) return settings;
  const { principalPasses: _old, ...rest } = settings!;
  return keep.length ? { ...rest, principalPasses: keep } : rest;
}

/** Storage of the project plan (`assignments` JSON) for the clear below. */
export type PassMarkStore = {
  /** null = no plan file. */
  read(): Promise<{ text: string; sha?: string } | null>;
  write(text: string, sha: string | undefined): Promise<void>;
  isShaConflict(err: unknown): boolean;
};

/**
 * Remove the touched marks from the stored plan without rewriting anything
 * else. Returns true when a mark was removed. Retries on a stale file version.
 */
export async function clearStoredPrincipalPasses(
  store: PassMarkStore,
  touched: { issues: number[]; taskIds?: string[] },
  attempts = 3,
): Promise<boolean> {
  for (let i = 1; ; i++) {
    const file = await store.read();
    if (!file) return false;
    let doc: { settings?: ProjectSettings } & Record<string, unknown>;
    try {
      doc = JSON.parse(file.text);
    } catch {
      return false;
    }
    const next = dropPrincipalPassesFor(doc.settings, touched);
    if (next === doc.settings) return false;
    try {
      await store.write(`${JSON.stringify({ ...doc, settings: next }, null, 2)}\n`, file.sha);
      return true;
    } catch (err) {
      if (i >= attempts || !store.isShaConflict(err)) throw err;
    }
  }
}

/** Replace this book + task's mark (one per task). */
export function recordPrincipalPass(
  settings: ProjectSettings | undefined,
  mark: PrincipalPassMark,
): ProjectSettings {
  const rest = (settings?.principalPasses ?? []).filter((m) => !(m.taskId === mark.taskId && m.book === mark.book));
  return { ...settings, principalPasses: [...rest, mark] };
}

/**
 * Drop marks the loaded subtareas prove stale (open subtarea, open decision,
 * new or re-closed subtarea) and marks without a server time. Returns the
 * same object when nothing changes.
 * A task with no subtareas in the list keeps its mark (nothing to judge).
 */
export function dropStalePrincipalPasses(
  settings: ProjectSettings | undefined,
  issues: DcsIssue[],
  namespaceId?: string,
): ProjectSettings | undefined {
  const marks = settings?.principalPasses;
  if (!marks?.length) return settings;
  const keep = marks.filter((mark) => {
    const has = issuesOfTask({ issues, taskId: mark.taskId, book: mark.book, namespaceId }).some(isScriptureIssue);
    return !has || principalPassMarkIsCurrent({ mark, issues, namespaceId });
  });
  if (keep.length === marks.length) return settings;
  const { principalPasses: _old, ...rest } = settings!;
  return keep.length ? { ...rest, principalPasses: keep } : rest;
}

export function principalPassDifferMessage(verses: RefRange[], book: string): string {
  const list = verses.map(rangeLabel).join(", ");
  const n = verses.length;
  return `${book ? `${book} ` : ""}${list}: ${
    n === 1 ? "ese versículo tiene" : "esos versículos tienen"
  } un texto distinto en el borrador grupal y en el borrador principal. Resuélvelo primero; no se cambió el borrador principal.`;
}

/** Audit detail for the principal branch; never shown in the UI. */
export function principalPassCommitMessage(params: {
  book: string;
  resource: string;
  taskName: string;
  taskId: string;
  verses: RefRange[];
  by: string;
  issues: number[];
  grupalRef: string;
  grupalSha?: string;
}): string {
  const verses = params.verses.map(rangeLabel).join(", ");
  return [
    `TAS: pasar ${params.book} ${verses} al borrador principal (@${params.by.replace(/^@/, "")})`,
    "",
    `Gestor: @${params.by.replace(/^@/, "")}`,
    `Tarea: ${params.taskName || params.taskId} (${params.taskId})`,
    `Recurso: ${params.resource}`,
    `Versículos: ${verses}`,
    `Subtareas: ${params.issues.map((n) => `#${n}`).join(", ")}`,
    `Borrador grupal: ${params.grupalRef}${params.grupalSha ? ` @ ${params.grupalSha}` : ""}`,
  ].join("\n");
}
