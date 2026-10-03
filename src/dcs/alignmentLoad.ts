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
  verse: number;
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
  /** General levels; the views count with the levels of the task's team (`levelBook`). */
  levels: Record<string, PersonLevel>;
  levelBook: LevelBook;
};

function verseNumber(sid: string, chapter: number): number | null {
  const m = /(\d+):(\d+)\s*$/.exec(sid);
  return m && Number(m[1]) === chapter ? Number(m[2]) : null;
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
    const verse = verseNumber(sid, chapter);
    if (verse === null) continue;
    if (covered && (verse < covered.from || verse > covered.to)) continue;
    const originalSid = Object.keys(originalTokens).find((k) => verseNumber(k, chapter) === verse);
    const original = originalSid ? originalTokens[originalSid]! : [];
    const key = Object.keys(saved).find((k) => verseNumber(k, chapter) === verse);
    const gatewayKey = gateway ? Object.keys(gateway.alignments).find((k) => verseNumber(k, chapter) === verse) : undefined;
    verses.push({
      verse,
      original,
      draft: tokens,
      text: draftTexts[verse] ?? tokens.map((t) => t.surface).join(" "),
      gloss: gatewayKey ? glossesFor(original, gateway!.alignments[gatewayKey]!) : [],
      reference: gatewayVerses[verse] ?? "",
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
    levels: pmConfig.levels,
    levelBook: pmConfig,
  };
}
