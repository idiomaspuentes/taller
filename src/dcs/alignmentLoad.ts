import { tokenizeDocument, tokenizeOriginalDocument, type OriginalWordToken, type WordToken } from "@usfm-tools/editor-core";
import { parseUsfmToUsj } from "@usfm-tools/usfm-readonly-react";
import type { AlignmentGroup } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { readRaw, groupDraftBranches } from "./afinacionLoad";
import { alignmentOfDraft, type AlignmentSourceRef } from "./alignmentStore";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { loadPmConfig } from "./issues";
import type { PersonLevel } from "../domain/levels";
import { DEFAULT_PM_CONFIG, type PmConfig } from "../domain/roles";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { originalTextRef } from "../domain/sourcePackage";
import { tryParseUsj } from "../domain/usfmAst";

export type AlignmentVerse = {
  verse: number;
  /** Words of the original text, as the alignment editor reads them. */
  original: OriginalWordToken[];
  /** Words of the draft. */
  draft: WordToken[];
  groups: AlignmentGroup[];
};

export type AlineacionData = {
  book: string;
  chapter: number;
  resource: "tpl" | "tps";
  draft: { owner: string; repo: string; branch: string; filepath: string };
  originalLabel: string;
  originalRtl: boolean;
  source: AlignmentSourceRef;
  verses: AlignmentVerse[];
  levels: Record<string, PersonLevel>;
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
  const originalRaw = await readRaw(session, ref.owner, ref.repo, ref.filepath);
  if (!originalRaw) throw new Error(`No se pudo leer el texto original (${ref.label}) de ${ref.owner}/${ref.repo}.`);

  const source: AlignmentSourceRef = { id: `${ref.owner}/${ref.repo}`, layerDir: ref.repo };
  const draftUsj = tryParseUsj(found.text);
  if (!draftUsj) throw new Error("No se pudo leer el borrador grupal de este libro.");
  const draftTokens = tokenizeDocument(draftUsj);
  const originalTokens = tokenizeOriginalDocument(parseUsfmToUsj(originalRaw, { stripAlignment: false }) as { content?: unknown[] });
  const saved = alignmentOfDraft(found.text, target.book, source).verses;

  const verses: AlignmentVerse[] = [];
  for (const [sid, tokens] of Object.entries(draftTokens)) {
    const verse = verseNumber(sid, chapter);
    if (verse === null) continue;
    const originalSid = Object.keys(originalTokens).find((k) => verseNumber(k, chapter) === verse);
    const original = originalSid ? originalTokens[originalSid]! : [];
    const key = Object.keys(saved).find((k) => verseNumber(k, chapter) === verse);
    verses.push({ verse, original, draft: tokens, groups: key ? saved[key]! : [] });
  }
  verses.sort((a, b) => a.verse - b.verse);

  return {
    book: target.book,
    chapter,
    resource: target.resource === "tps" ? "tps" : "tpl",
    draft: { owner: target.owner, repo: target.repo, branch: found.branch, filepath: target.filepath },
    originalLabel: ref.label,
    originalRtl: ref.repo === "hbo_uhb",
    source,
    verses,
    levels: pmConfig.levels,
  };
}
