import type { AlignmentMap } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { groupDraftBranches, readRaw } from "./afinacionLoad";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import type { CheckTarget } from "./checkStore";
import { loadPmConfig } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import { parseNoteRows } from "../domain/afinacionNotes";
import { parseTermRows } from "../domain/afinacionWords";
import { helpsTsvFilename, resolveHelpsTarget } from "../domain/helpsTarget";
import type { LevelBook } from "../domain/levels";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import type { AssignmentsDoc, ProjectTask, TaskStep } from "../domain/types";
import { tryParseUsjWithAlignments, verseTextsFromUsj, type VerseTextMap } from "../domain/usfmAst";
import { portionRange } from "../domain/usfmEdit";
import { parseTsvTable } from "../prep/tsv";

/** What a checklist goes over: the notes of a passage, its questions, or its key terms. */
export type ChecklistKind = "notas" | "preguntas" | "palabras";
/** The text each item is checked against. */
export type ChecklistText = "tpl" | "tps";

export type ChecklistItem = {
  id: string;
  chapter: number;
  verse: number;
  /** What the item is about, in a few words (the quoted phrase, the term, the question). */
  title: string;
  body: string;
  /** Original-language quote and occurrence, to find the words it points at in the aligned text. */
  quote?: string;
  occurrence?: number;
  /** A support article the item links to. */
  supportRef?: string;
};

export type ChecklistTextData = { verses: VerseTextMap; alignments?: AlignmentMap; branch?: string };

export type ChecklistData = {
  book: string;
  chapter: number;
  kind: ChecklistKind;
  items: ChecklistItem[];
  /** True when the items were read from the source language because the translated ones were not found. */
  fromSource: boolean;
  texts: Partial<Record<ChecklistText, ChecklistTextData>>;
  /** Where the answers are kept. */
  target: CheckTarget;
  levelBook: LevelBook;
  board: AssignmentsDoc | null;
  task: ProjectTask | null;
  step: TaskStep | null;
};

const WHOLE_CHAPTER = (chapter: number) => ({ chapter, from: 1, to: 200 });

async function loadText(session: GtSession, ctx: SolverLaunchContext, resource: ChecklistText, board: AssignmentsDoc | null, pmConfig: typeof DEFAULT_PM_CONFIG): Promise<ChecklistTextData | undefined> {
  const target = resolveScriptureTarget({ ...ctx, resource }, pmConfig);
  if ("error" in target) return undefined;
  // The text as the team has it now: the group draft of the tasks that work on it, or the published branch.
  const tasks = (board?.teams ?? []).filter((task) => task.rules.some((rule) => rule.resource === resource));
  const branches = [...tasks.flatMap((task) => groupDraftBranches(target.book, task.id)), undefined];
  const found = await tryReadExistingBookUsfm({ session, owner: target.owner, repo: target.repo, filepath: target.filepath, branches });
  if (!found) return undefined;
  const parsed = tryParseUsjWithAlignments(found.text);
  if (!parsed) return undefined;
  return { verses: verseTextsFromUsj(parsed.usj, WHOLE_CHAPTER(ctx.chapter)) ?? {}, alignments: parsed.alignments, branch: found.branch };
}

/** The texts of a unit, and where its review documents are kept: what a screen needs to show a unit to its reviewers. */
export async function loadUnitTexts(params: { session: GtSession; ctx: SolverLaunchContext; texts: ChecklistText[] }): Promise<Omit<ChecklistData, "kind" | "items" | "fromSource">> {
  const { session, ctx } = params;
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  if (!book || !ctx.chapter) throw new Error("Falta el libro o el capítulo en la tarea.");
  const [pmConfig, board] = await Promise.all([
    ctx.pmOrg ? loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG) : Promise.resolve(DEFAULT_PM_CONFIG),
    loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg).catch(() => null),
  ]);
  const task = board?.teams.find((t) => t.id === ctx.taskId) ?? null;
  const step = task?.steps?.find((s) => s.id === ctx.stepId) ?? null;
  const home = resolveScriptureTarget({ ...ctx, resource: params.texts[0] ?? "tpl" }, pmConfig);
  if ("error" in home) throw new Error(home.error);
  const texts: ChecklistData["texts"] = {};
  await Promise.all(
    params.texts.map(async (resource) => {
      const text = await loadText(session, ctx, resource, board, pmConfig);
      if (text) texts[resource] = text;
    }),
  );
  return { book, chapter: ctx.chapter, texts, target: { owner: home.owner, repo: home.repo }, levelBook: pmConfig, board, task, step };
}

export async function loadChecklist(params: { session: GtSession; ctx: SolverLaunchContext; kind: ChecklistKind; texts: ChecklistText[] }): Promise<ChecklistData> {
  const { session, ctx, kind } = params;
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  const chapter = ctx.chapter;
  if (!book || !chapter) throw new Error("Falta el libro o el capítulo en la tarea.");
  const [pmConfig, board] = await Promise.all([
    ctx.pmOrg ? loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG) : Promise.resolve(DEFAULT_PM_CONFIG),
    loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg).catch(() => null),
  ]);
  const task = board?.teams.find((t) => t.id === ctx.taskId) ?? null;
  const step = task?.steps?.find((s) => s.id === ctx.stepId) ?? null;
  const pkg = resolveSourcePackage(board?.settings);

  // The helps live in the content organization; the list of key terms comes with the source package.
  const helps = resolveHelpsTarget({ ...ctx, resource: kind === "palabras" ? "palabras" : kind }, pmConfig);
  if ("error" in helps) throw new Error(helps.error);
  let raw: string | null = null;
  let fromSource = false;
  if (kind === "palabras") {
    raw = await readRaw(session, pkg.owner, pkg.twl, `twl_${book}.tsv`);
  } else {
    raw = helps.filepath ? await readRaw(session, helps.owner, helps.repo, helps.filepath) : null;
    if (!raw && kind === "notas") {
      raw = await readRaw(session, pkg.owner, pkg.tn, helpsTsvFilename("notas", book));
      fromSource = Boolean(raw);
    }
  }
  if (!raw) throw new Error(`No se pudo leer ${kind === "palabras" ? "la lista de palabras clave" : kind === "notas" ? "las notas" : "las preguntas"} de este libro.`);
  const rows = parseTsvTable(raw).rows;

  const range = portionRange(ctx.ref || "", chapter);
  // A stretch of a split chapter covers some verses only; a whole chapter (a bare «2») covers them all.
  const whole = !/:/.test(ctx.ref || "");
  const inRange = (verse: number) => whole || !range || (verse >= range.from && verse <= range.to);

  let items: ChecklistItem[] = [];
  if (kind === "notas") {
    items = parseNoteRows(rows, chapter).map((note) => ({ id: note.id, chapter: note.chapter, verse: note.verse, title: "", body: note.note, quote: note.quote, occurrence: note.occurrence, supportRef: note.supportRef }));
  } else if (kind === "palabras") {
    items = parseTermRows(rows, chapter).map((term) => ({ id: term.id, chapter: term.chapter, verse: term.verse, title: term.termSlug, body: "", quote: term.quote, occurrence: term.occurrence, supportRef: `${term.termKind}/${term.termSlug}` }));
  } else {
    for (const row of rows) {
      const match = /^(\d+):(\d+)/.exec((row.Reference ?? row.reference ?? "").trim());
      const id = (row.ID ?? row.Id ?? row.id ?? "").trim();
      if (!match || !id || Number(match[1]) !== chapter) continue;
      items.push({ id, chapter, verse: Number(match[2]), title: (row.Question ?? row.question ?? "").trim(), body: (row.Response ?? row.response ?? "").trim() });
    }
  }
  items = items.filter((item) => inRange(item.verse)).sort((a, b) => a.verse - b.verse);

  const texts: ChecklistData["texts"] = {};
  await Promise.all(
    params.texts.map(async (resource) => {
      const text = await loadText(session, ctx, resource, board, pmConfig);
      if (text) texts[resource] = text;
    }),
  );

  return { book, chapter, kind, items, fromSource, texts, target: { owner: helps.owner, repo: helps.repo }, levelBook: pmConfig, board, task, step };
}
