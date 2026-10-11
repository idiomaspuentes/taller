import { spanOfSid } from "../domain/joinedVerses";
import { tokenizeDocument, tokenizeOriginalDocument, type OriginalWordToken, type WordToken } from "@usfm-tools/editor-core";
import { parseUsfmToUsj } from "@usfm-tools/usfm-readonly-react";
import type { AlignmentGroup } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { readRaw, groupDraftBranches, verseRangeOf } from "./afinacionLoad";
import { alignmentOfDraft, type AlignmentSourceRef } from "./alignmentStore";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { loadPmConfig } from "./issues";
import type { LevelBook, PersonLevel } from "../domain/levels";
import { DEFAULT_PM_CONFIG, type PmConfig } from "../domain/roles";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { DEFAULT_SOURCE_PACKAGE, originalTextRef, type SourcePackage } from "../domain/sourcePackage";
import { tryParseUsj, tryParseUsjWithAlignments, verseTextsFromUsj } from "../domain/usfmAst";
import { glossesFor } from "../domain/alignmentGloss";
import { bookUsfmName } from "../prep/discover";

export type AlignmentVerse = {
  /** The verse; the first of them when the draft writes several as one (`\v 4-5`). */
  verse: number;
  /** The last of the verses written as one, when they are several. */
  to?: number;
  /** Words of the original text, as the alignment editor reads them. */
  original: OriginalWordToken[];
  /** Words of the draft. */
  draft: WordToken[];
  /** The draft text of the verse, as plain text. */
  text: string;
  /** English gloss of each word of the original (same order), from the aligned ULT or UST; empty when unknown. */
  gloss: string[];
  /** The verse in English (ULT for the TPL, UST for the TPS), for reference. */
  reference: string;
  groups: AlignmentGroup[];
};

export type AlineacionData = {
  book: string;
  chapter: number;
  resource: "tpl" | "tps";
  draft: { owner: string; repo: string; branch: string; filepath: string };
  originalLabel: string;
  originalRtl: boolean;
  /** "ULT" or "UST". */
  referenceLabel: string;
  source: AlignmentSourceRef;
  verses: AlignmentVerse[];
  /** The chapter has a title with words (a psalm's, its verse 0), which is not offered either. */
  titleLeftOut: boolean;
  /** General levels; the views count with the levels of the task's team (`levelBook`). */
  levels: Record<string, PersonLevel>;
  levelBook: LevelBook;
};

function verseNumber(sid: string, chapter: number): number | null {
  const m = /(\d+):(\d+)\s*$/.exec(sid);
  return m && Number(m[1]) === chapter ? Number(m[2]) : null;
}

/**
 * The words of several verses of the original as those of one: in their order, each counted among all of them
 * (the second «καὶ» of the two verses is the second, whatever it was in its own), which is how a verse written
 * as one with others keeps its links.
 */
export function originalWordsAsOne(verses: OriginalWordToken[][]): OriginalWordToken[] {
  const all = verses.flat();
  const total = new Map<string, number>();
  for (const word of all) total.set(word.surface, (total.get(word.surface) ?? 0) + 1);
  const seen = new Map<string, number>();
  return all.map((word, index) => {
    const occurrence = (seen.get(word.surface) ?? 0) + 1;
    seen.set(word.surface, occurrence);
    return { ...word, index, occurrence, occurrences: total.get(word.surface)! };
  });
}

/** Everything the alignment step shows for one chapter: original words, draft words, and the links made so far. */
export async function loadAlineacion(params: {
  session: GtSession;
  ctx: SolverLaunchContext;
  sourceTaskId: string;
  pmConfig?: PmConfig;
  /** Where the English text comes from (the project's source package). */
  pkg?: SourcePackage;
}): Promise<AlineacionData> {
  const { session, ctx } = params;
  const pmConfig = params.pmConfig ?? (ctx.pmOrg ? await loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG) : DEFAULT_PM_CONFIG);
  const target = resolveScriptureTarget({ ...ctx, resource: ctx.resource }, pmConfig);
  if ("error" in target) throw new Error(target.error);
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
  const ref = originalTextRef(target.book);
  const pkg = params.pkg ?? DEFAULT_SOURCE_PACKAGE;
  const resource: "tpl" | "tps" = target.resource === "tps" ? "tps" : "tpl";
  const [originalRaw, gatewayRaw] = await Promise.all([
    readRaw(session, ref.owner, ref.repo, ref.filepath),
    readRaw(session, pkg.owner, resource === "tps" ? pkg.ust : pkg.ult, bookUsfmName(target.book)),
  ]);
  if (!originalRaw) throw new Error(`No se pudo leer el texto original (${ref.label}) de ${ref.owner}/${ref.repo}.`);

  const source: AlignmentSourceRef = { id: `${ref.owner}/${ref.repo}`, layerDir: ref.repo };
  const draftUsj = tryParseUsj(found.text);
  if (!draftUsj) throw new Error("No se pudo leer el borrador grupal de este libro.");
  const draftTokens = tokenizeDocument(draftUsj);
  const draftTexts = verseTextsFromUsj(draftUsj, { chapter, from: 1, to: 200 }) || {};
  const originalTokens = tokenizeOriginalDocument(parseUsfmToUsj(originalRaw, { stripAlignment: false }) as { content?: unknown[] });
  const saved = alignmentOfDraft(found.text, target.book, source).verses;
  // The English text is only a help: if it cannot be read the screen works without it.
  const gateway = gatewayRaw ? tryParseUsjWithAlignments(gatewayRaw) : null;
  const gatewayVerses = (gateway && verseTextsFromUsj(gateway.usj, { chapter, from: 1, to: 200 })) || {};

  const verses: AlignmentVerse[] = [];
  // A subtarea of a passage aligns the verses of its passage.
  const covered = verseRangeOf(params.ctx);
  for (const [sid, tokens] of Object.entries(draftTokens)) {
    // A verse the draft writes as one with others (`\v 4-5`) is one verse here too, against the words of all of
    // them in the original.
    const span = spanOfSid(sid, chapter);
    // Verse 0 is the title of a psalm: it keeps its alignment when the book is saved, and is not aligned here.
    if (!span || span.from < 1) continue;
    if (covered && (span.to < covered.from || span.from > covered.to)) continue;
    const numbers = Array.from({ length: span.to - span.from + 1 }, (_, i) => span.from + i);
    const perVerse = numbers.map((verse) => {
      const originalSid = Object.keys(originalTokens).find((k) => verseNumber(k, chapter) === verse);
      const original = originalSid ? originalTokens[originalSid]! : [];
      const gatewayKey = gateway ? Object.keys(gateway.alignments).find((k) => verseNumber(k, chapter) === verse) : undefined;
      // The English word of each is found in its own verse, where the English text links it.
      return { original, gloss: gatewayKey ? glossesFor(original, gateway!.alignments[gatewayKey]!) : original.map(() => "") };
    });
    const one = numbers.length === 1;
    const key = Object.keys(saved).find((k) => {
      const other = spanOfSid(k, chapter);
      return other && other.from === span.from && other.to === span.to;
    });
    verses.push({
      verse: span.from,
      ...(one ? {} : { to: span.to }),
      original: one ? perVerse[0]!.original : originalWordsAsOne(perVerse.map((each) => each.original)),
      draft: tokens,
      text: draftTexts[span.from] ?? tokens.map((t) => t.surface).join(" "),
      gloss: perVerse.some((each) => each.gloss.some(Boolean)) ? perVerse.flatMap((each) => each.gloss) : [],
      reference: numbers.map((verse) => gatewayVerses[verse] ?? "").filter(Boolean).join(" "),
      groups: key ? saved[key]! : [],
    });
  }
  verses.sort((a, b) => a.verse - b.verse);

  return {
    book: target.book,
    chapter,
    resource,
    draft: { owner: target.owner, repo: target.repo, branch: found.branch, filepath: target.filepath },
    originalLabel: ref.label,
    originalRtl: ref.repo === "hbo_uhb",
    referenceLabel: resource === "tps" ? "UST" : "ULT",
    source,
    verses,
    titleLeftOut: (!covered || covered.from <= 1) && Object.entries(draftTokens).some(([sid, tokens]) => verseNumber(sid, chapter) === 0 && tokens.length > 0),
    levels: pmConfig.levels,
    levelBook: pmConfig,
  };
}
