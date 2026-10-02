import { getRawContent } from "@ip-lms/dcs-client";
import type { AlignmentMap } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { dcsConfig } from "./config";
import { loadPmConfig } from "./issues";
import { readTeamHelps } from "./teamHelps";
import { parseTsvTable } from "../prep/tsv";
import { attachPhrases, parseNoteRows, type NoteItem } from "../domain/afinacionNotes";
import { parseArticleTitle, parseTermRows, termArticlePath, type PreferredTerms, type TermItem } from "../domain/afinacionWords";
import { loadPreferredTerms } from "./afinacionStore";
import { collectVerseTextsFromContent } from "@usfm-tools/usj-core";
import { bookUsfmName } from "../prep/discover";
import { helpsTsvFilename } from "../domain/helpsTarget";
import { bookOnlyBranchName, bookBranchName, taskTrunkBranchName } from "../domain/portionPr";
import { DEFAULT_PM_CONFIG, type PmConfig } from "../domain/roles";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { DEFAULT_SOURCE_PACKAGE, originalTextRef, type SourcePackage } from "../domain/sourcePackage";
import { tryParseUsj, tryParseUsjWithAlignments, verseTextsFromUsj, type VerseTextMap } from "../domain/usfmAst";
import type { UsjDocument } from "@usfm-tools/usj-core";
import type { LevelBook, PersonLevel } from "../domain/levels";
import type { AssignmentsDoc } from "../domain/types";

export type AfinacionStep = "notas" | "palabras";

/** Plain text of every verse of a book, by `"chapter:verse"`. */
export type BookVerseMap = Record<string, string>;

export type AfinacionNotesData = {
  step: AfinacionStep;
  book: string;
  chapter: number;
  resource: "tpl" | "tps";
  /** Where the group draft lives: corrections and checkings are written here. */
  draft: { owner: string; repo: string; branch: string; filepath: string };
  draftVerses: VerseTextMap;
  /** The aligned English text beside the draft (ULT for the TPL, UST for the TPS). */
  gatewayLabel: string;
  gatewayVerses: VerseTextMap;
  gatewayAlignments?: AlignmentMap;
  originalLabel: string;
  originalVerses: VerseTextMap;
  /** The items of the step for this chapter: notes, or uses of key terms. */
  items: NoteItem[];
  /** Words step: every use of a key term in the whole book, to compare how each was rendered. */
  termUses: TermItem[];
  /** Words step: the translation the team chose for each term. */
  preferredTerms: PreferredTerms;
  /** The draft and the aligned English text of the whole book, to show the other uses of a term. */
  bookDraft: BookVerseMap;
  bookGateway: BookVerseMap;
  /** General levels; the views count with the levels of the task's team (`levelBook`). */
  levels: Record<string, PersonLevel>;
  levelBook: LevelBook;
  notesSource: string;
  /** The package the step read from. */
  sourcePackage: SourcePackage;
};

function bookVerses(usj: UsjDocument | null): BookVerseMap {
  const out: BookVerseMap = {};
  if (!usj) return out;
  try {
    for (const [sid, text] of Object.entries(collectVerseTextsFromContent(usj.content))) {
      const m = /(\d+):(\d+)\s*$/.exec(sid);
      if (m) out[`${m[1]}:${m[2]}`] = text;
    }
  } catch {
    /* an unreadable book just has no other uses to compare */
  }
  return out;
}

const WHOLE_CHAPTER = (chapter: number) => ({ chapter, from: 1, to: 200 });

export async function readRaw(session: GtSession, owner: string, repo: string, filepath: string): Promise<string | null> {
  try {
    return await getRawContent(dcsConfig(session.host), owner, repo, filepath, { token: session.token });
  } catch {
    return null;
  }
}

/** Reads the article of every distinct term, a dozen at a time, after the screen is already up; a term without a readable article keeps its slug. */
export async function loadTermTitles(session: GtSession, pkg: SourcePackage, uses: TermItem[]): Promise<Record<string, string>> {
  const terms = [...new Map(uses.map((u) => [u.termSlug, u.termKind])).entries()];
  const titles: Record<string, string> = {};
  for (let i = 0; i < terms.length; i += 12) {
    await Promise.all(
      terms.slice(i, i + 12).map(async ([slug, kind]) => {
        const md = await readRaw(session, pkg.owner, pkg.tw, termArticlePath(kind, slug));
        const title = md ? parseArticleTitle(md) : null;
        if (title) titles[slug] = title;
      }),
    );
  }
  return titles;
}

/** Branches where the group draft of the task being reviewed can live, most specific first. */
export function groupDraftBranches(book: string, sourceTaskId: string): string[] {
  return [bookBranchName(book, sourceTaskId), taskTrunkBranchName(book, sourceTaskId), bookOnlyBranchName(book)];
}

/**
 * Everything the «Revisar notas» step shows for one chapter. `sourceTaskId` is
 * the task whose group draft is reviewed (the one this Afinación waits for).
 */
export async function loadAfinacionNotes(params: {
  session: GtSession;
  ctx: SolverLaunchContext;
  step?: AfinacionStep;
  sourceTaskId: string;
  pkg?: SourcePackage;
  pmConfig?: PmConfig;
  /** The project's plan: with it, each note is shown as the team translated it, when it already has. */
  board?: AssignmentsDoc | null;
}): Promise<AfinacionNotesData> {
  const { session, ctx } = params;
  const pkg = params.pkg ?? DEFAULT_SOURCE_PACKAGE;
  const step: AfinacionStep = params.step ?? "notas";
  const pmConfig = params.pmConfig ?? (ctx.pmOrg ? await loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG) : DEFAULT_PM_CONFIG);
  const target = resolveScriptureTarget({ ...ctx, resource: ctx.resource }, pmConfig);
  if ("error" in target) throw new Error(target.error);
  const resource: "tpl" | "tps" = target.resource === "tps" ? "tps" : "tpl";
  const chapter = ctx.chapter;
  if (!chapter) throw new Error("Falta el capítulo en la tarea.");

  const found = await tryReadExistingBookUsfm({
    session,
    owner: target.owner,
    repo: target.repo,
    filepath: target.filepath,
    branches: groupDraftBranches(target.book, params.sourceTaskId),
  });
  if (!found?.branch) {
    throw new Error("Todavía no hay borrador grupal de este libro. Se crea cuando alguien cierra una tarea de traducción.");
  }
  const draftUsj = tryParseUsj(found.text);
  const draftVerses = (draftUsj && verseTextsFromUsj(draftUsj, WHOLE_CHAPTER(chapter))) || {};

  const gatewayKind = resource === "tps" ? "UST" : "ULT";
  const [gatewayUsfm, originalRaw, tnRaw] = await Promise.all([
    readRaw(session, pkg.owner, resource === "tps" ? pkg.ust : pkg.ult, bookUsfmName(target.book)),
    (() => {
      const ref = originalTextRef(target.book);
      return readRaw(session, ref.owner, ref.repo, ref.filepath);
    })(),
    step === "palabras"
      ? readRaw(session, pkg.owner, pkg.twl, `twl_${target.book}.tsv`)
      : readRaw(session, pkg.owner, pkg.tn, helpsTsvFilename("notas", target.book)),
  ]);
  const sourceRepo = step === "palabras" ? pkg.twl : pkg.tn;
  if (!tnRaw) {
    throw new Error(
      `No se pudo leer ${step === "palabras" ? "la lista de palabras clave" : "las notas"} de ${pkg.owner}/${sourceRepo}. Revisa el paquete fuente del proyecto.`,
    );
  }

  const gateway = gatewayUsfm ? tryParseUsjWithAlignments(gatewayUsfm) : null;
  const gatewayVerses = (gateway && verseTextsFromUsj(gateway.usj, WHOLE_CHAPTER(chapter))) || {};
  const originalUsj = originalRaw ? tryParseUsj(originalRaw) : null;
  const originalVerses = (originalUsj && verseTextsFromUsj(originalUsj, WHOLE_CHAPTER(chapter))) || {};

  const tsvRows = parseTsvTable(tnRaw).rows;
  const termUses = step === "palabras" ? parseTermRows(tsvRows) : [];
  let rawItems = step === "palabras" ? termUses.filter((u) => u.chapter === chapter) : parseNoteRows(tsvRows, chapter);
  if (step === "notas" && params.board) {
    // Which notes there are, and what each points at, comes from the source package; the wording shown is the
    // team's own translation of that note (same id) once it exists.
    const own = await readTeamHelps({ session, ctx, pmConfig, board: params.board, kind: "notas" }).catch(() => null);
    if (own) {
      const worded = new Map(parseNoteRows(parseTsvTable(own.text).rows, chapter).map((note) => [note.id, note.note]));
      rawItems = (rawItems as NoteItem[]).map((note) => (worded.get(note.id)?.trim() ? { ...note, note: worded.get(note.id)! } : note));
    }
  }
  const items = attachPhrases(rawItems, {
    book: target.book,
    verseTexts: gatewayVerses,
    alignments: gateway?.alignments,
  });

  const draftTarget = { owner: target.owner, repo: target.repo, branch: found.branch };
  const preferredTerms = step === "palabras" ? await loadPreferredTerms(session, draftTarget).catch(() => ({})) : {};

  return {
    step,
    book: target.book,
    chapter,
    resource,
    draft: { owner: target.owner, repo: target.repo, branch: found.branch, filepath: target.filepath },
    draftVerses,
    gatewayLabel: gatewayKind,
    gatewayVerses,
    gatewayAlignments: gateway?.alignments,
    originalLabel: originalTextRef(target.book).label,
    originalVerses,
    items,
    termUses,
    preferredTerms,
    bookDraft: bookVerses(draftUsj),
    bookGateway: bookVerses(gateway?.usj ?? null),
    levels: pmConfig.levels,
    levelBook: pmConfig,
    notesSource: `${pkg.owner}/${sourceRepo}`,
    sourcePackage: pkg,
  };
}
