import { createOrUpdateContents, getContents, getRawContent } from "@ip-lms/dcs-client";
import { stripAlignmentFromUsfm } from "@usfm-tools/editor-core";
import type { GtSession } from "./auth";
import { appendMyDecisions, loadDecisionFiles, readRepoFile, type RepoTarget } from "./afinacionStore";
import { dcsConfig } from "./config";
import { ensureBranchFromDefault } from "./pulls";
import { mergeDecisionFiles } from "../domain/reviewRound";
import { decisionsFromTcChecks, tcProgressByChapter, type TcCheck, type TcImportLeftOut, type TcTool } from "../domain/tcImport";
import { tryParseUsj, verseTextsFromUsj } from "../domain/usfmAst";

/**
 * Bringing a team that worked in translationCore to this app: the text of its project becomes the group draft of
 * the book, and what it checked there becomes the answers kept beside that draft (see `domain/tcImport`).
 *
 * A translationCore project is a repository of its own (`es-419_tps_ezr_book`), usually in the account of whoever
 * uploads it and often in another Door43 than the one written to, so it is read by its own host and without a
 * session: those repositories are public. Nothing is ever written there.
 */

export type TcSource = {
  host: string;
  owner: string;
  repo: string;
  /** The book as translationCore names its folders (`ezr`). */
  book: string;
  /** The aligned text of the project. By default the file named after the repository, which translationCore writes on upload. */
  usfmPath?: string;
};

export type TcProject = { usfm: string; checks: Record<TcTool, TcCheck[]> };

const TOOLS: TcTool[] = ["translationNotes", "translationWords"];

async function threeTimes<T>(read: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await read();
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw last;
}

/**
 * The text and every check of a project. A file that cannot be read stops the reading: read with some files
 * missing, a book that had been checked whole looked four fifths done, and nothing said why.
 */
export async function readTcProject(source: TcSource, tools: TcTool[] = TOOLS): Promise<TcProject> {
  const config = dcsConfig(source.host);
  const book = source.book.trim().toLowerCase();
  const usfm = await threeTimes(() => getRawContent(config, source.owner, source.repo, source.usfmPath ?? `${source.repo}.usfm`));
  const checks: Record<TcTool, TcCheck[]> = { translationNotes: [], translationWords: [] };
  for (const tool of tools) {
    const listing = await threeTimes(() => getContents(config, source.owner, source.repo, `.apps/translationCore/index/${tool}/${book}`));
    const files = (Array.isArray(listing) ? listing : []).filter((entry) => entry.type === "file" && entry.name.endsWith(".json"));
    for (let i = 0; i < files.length; i += 20) {
      const texts = await Promise.all(files.slice(i, i + 20).map((file) => threeTimes(() => getRawContent(config, source.owner, source.repo, file.path))));
      for (const text of texts) {
        const rows = JSON.parse(text) as unknown;
        if (Array.isArray(rows)) checks[tool].push(...(rows as TcCheck[]));
      }
    }
  }
  return { usfm, checks };
}

export type TcImported = {
  /** Whether the draft was written now: `false` when it already said the same, or had a text of its own. */
  text: "written" | "same" | "kept";
  decisions: number;
  alreadyThere: number;
  leftOut: TcImportLeftOut[];
  /** How far each chapter is for each tool, as the team would say it. */
  progress: Record<TcTool, Record<number, { done: number; total: number }>>;
};

/**
 * Write a project onto the group draft of a text. Done twice, it writes nothing the second time: the draft already
 * says the same and the answers are already there, so it can be tried, and run again the day the team moves.
 *
 * A draft that already has another text of the book is left as it is unless `replaceText`: somebody may have worked
 * on it here since.
 */
export async function importTcProject(params: {
  session: GtSession;
  project: TcProject;
  /** The group draft: `es-419_glt`, `borrador/ezr/tpl`, `15-EZR.usfm`. */
  target: RepoTarget & { filepath: string };
  book: string;
  /** Which checks are brought as done (a tool the team is to do again here is left out). */
  tools: TcTool[];
  /** The alignment was not made by the people who align: only the text is brought, to be aligned here. */
  withoutAlignment?: boolean;
  replaceText?: boolean;
  /** What each answer says about where it came from. */
  note: string;
  sessionId: string;
  stageId: string;
  /** Read and count only: what would be written. */
  dryRun?: boolean;
}): Promise<TcImported> {
  const { session, project, target } = params;
  const config = dcsConfig(session.host);
  const usfm = params.withoutAlignment ? stripAlignmentFromUsfm(project.usfm) : project.usfm;
  const usj = tryParseUsj(usfm);
  if (!usj) throw new Error("No se pudo leer el texto del proyecto de translationCore.");

  let text: TcImported["text"] = "same";
  const current = await readRepoFile(session, target, target.filepath).catch(() => null);
  if (!current || !current.text.trim()) text = "written";
  else if (current.text !== usfm) text = params.replaceText ? "written" : "kept";
  if (text === "written" && !params.dryRun) {
    await ensureBranchFromDefault(config, target.owner, target.repo, target.branch, session.token);
    const there = await readRepoFile(session, target, target.filepath).catch(() => null);
    await createOrUpdateContents(config, target.owner, target.repo, target.filepath, {
      content: usfm,
      message: `Taller: texto traído de translationCore (${params.book.toUpperCase()})`,
      sha: there?.sha,
      branch: target.branch,
      token: session.token,
    });
  }

  // The answers are given on the text the draft has: when it kept its own, on that one.
  const draftUsj = text === "kept" && current ? tryParseUsj(current.text) ?? usj : usj;
  const chapters = new Map<number, Record<number, string>>();
  const verseText = (chapter: number, verse: number) => {
    if (!chapters.has(chapter)) chapters.set(chapter, verseTextsFromUsj(draftUsj, { chapter, from: 1, to: 200 }) ?? {});
    return chapters.get(chapter)![verse];
  };
  const had = params.dryRun && text === "written" ? [] : mergeDecisionFiles(await loadDecisionFiles(session, target, params.book).catch(() => []));
  const me = session.username.trim().toLowerCase();
  const mine = new Set(had.filter((d) => d.reviewer.trim().toLowerCase() === me).map((d) => `${d.itemId}\u0000${d.textHash ?? ""}`));

  const progress = { translationNotes: {}, translationWords: {} } as TcImported["progress"];
  const leftOut: TcImportLeftOut[] = [];
  const fresh = [];
  let alreadyThere = 0;
  for (const tool of params.tools) {
    const result = decisionsFromTcChecks({ checks: project.checks[tool], tool, verseText, reviewer: session.username, timestamp: new Date().toISOString(), sessionId: params.sessionId, stageId: params.stageId, note: params.note, final: true });
    progress[tool] = tcProgressByChapter(result);
    leftOut.push(...result.leftOut);
    for (const decision of result.decisions) {
      if (mine.has(`${decision.itemId}\u0000${decision.textHash ?? ""}`)) alreadyThere++;
      else fresh.push(decision);
    }
  }
  if (fresh.length && !params.dryRun) await appendMyDecisions(session, target, params.book, fresh);
  return { text, decisions: fresh.length, alreadyThere, leftOut, progress };
}
