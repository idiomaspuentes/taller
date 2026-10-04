import { readRaw } from "../dcs/afinacionLoad";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { tsvRowId, type HelpsDraftItem } from "../domain/helpsDraft";
import { helpsTsvFilename, type HelpsTarget } from "../domain/helpsTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage, sourcePackageLang } from "../domain/sourcePackage";
import { parseTsvTable } from "../prep/tsv";
import { useEffect, useState } from "react";
import type { AlignmentMap } from "@usfm-tools/types";
import type { GtSession } from "../dcs/auth";
import { wordSpans } from "../domain/afinacionSelection";
import { alignedGatewayQuoteForHelpQuote } from "../domain/helpQuoteMatch";
import { loadEnglishScriptureKindUsfm } from "../domain/referenceResources";
import { tryParseUsjWithAlignments, verseTextsFromUsj, type VerseTextMap } from "../domain/usfmAst";
import { useT } from "../i18n/messages";

/** One of the source texts a help is translated beside: its chapter, and how its words are tied to the original. */
export type HelpSource = { short: string; verses: VerseTextMap; alignments?: AlignmentMap };

/** The literal and the simple source texts of the chapter, read once for the whole editor. */
export function useHelpSources(session: GtSession | undefined, book: string, chapter: number, wanted: boolean): HelpSource[] {
  const [sources, setSources] = useState<HelpSource[]>([]);
  useEffect(() => {
    if (!session?.token || !book || !chapter || !wanted) return;
    let alive = true;
    void Promise.all(
      (["ult", "ust"] as const).map(async (kind) => {
        const loaded = await loadEnglishScriptureKindUsfm(session, kind, book).catch(() => null);
        const parsed = loaded ? tryParseUsjWithAlignments(loaded.usfm) : null;
        const verses = parsed ? verseTextsFromUsj(parsed.usj, { chapter, from: 1, to: 200 }) : null;
        return loaded && parsed && verses ? { short: loaded.meta.short, verses, alignments: parsed.alignments } : null;
      }),
    ).then((found) => alive && setSources(found.flatMap((row) => (row ? [row] : []))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, session?.host, book, chapter, wanted]);
  return sources;
}

function Marked({ text, marked }: { text: string; marked: number[] }) {
  return (
    <>
      {wordSpans(text).map((word) => (
        <span key={word.index}>{marked.includes(word.index) ? <mark className="hs-mark">{word.text}</mark> : word.text} </span>
      ))}
    </>
  );
}

/**
 * What a note is about, as whoever translates it reads it: the phrase in each source text (found from the note's
 * quote of the original through the alignment), and the verse around it one tap away. The quote in the original
 * language says nothing to a translator of the note, and is not shown.
 */
export function NoteQuote({ sources, book, chapter, verse, quote, occurrence }: { sources: HelpSource[]; book: string; chapter: number; verse: number; quote: string; occurrence: number }) {
  const t = useT();
  const hits = sources.map((source) => {
    const text = source.verses[verse] ?? "";
    const hit = text && quote ? alignedGatewayQuoteForHelpQuote({ verseText: text, quote, occurrence, alignments: source.alignments, book, chapter, verse }) : { gatewayText: null, tokenIndices: [] as number[] };
    return { source, text, hit };
  });
  if (!hits.length) return <p className="hs-wait">{t("hs.loading")}</p>;
  return (
    <div className="hs-quote">
      <dl className="hs-phrases">
        {hits.map(({ source, hit }) => (
          <div key={source.short}>
            <dt>{source.short}</dt>
            <dd>{hit.gatewayText ? `«${hit.gatewayText}»` : <span className="hs-none">{t(quote ? "hs.notFound" : "hs.wholeVerse")}</span>}</dd>
          </div>
        ))}
      </dl>
      <details className="hs-verse">
        <summary>{t("hs.seeVerse").replace("{ref}", `${chapter}:${verse}`)}</summary>
        {hits.map(({ source, text, hit }) =>
          text ? (
            <p key={source.short}>
              <b>{source.short}</b> <Marked text={text} marked={hit.tokenIndices} />
            </p>
          ) : null,
        )}
      </details>
    </div>
  );
}

/** The source texts of the whole chapter, to read the help in its place: one text at a time, each in full. */
export function ChapterSources({ sources, chapter, from, to }: { sources: HelpSource[]; chapter: number; from?: number; to?: number }) {
  const t = useT();
  const [shown, setShown] = useState(0);
  if (!sources.length) return <p className="hs-wait">{t("hs.loading")}</p>;
  const source = sources[Math.min(shown, sources.length - 1)]!;
  const verses = Object.keys(source.verses)
    .map(Number)
    .sort((a, b) => a - b);
  return (
    <div className="hs-chapter">
      {sources.length > 1 ? (
        <div className="mde-kinds" role="tablist" aria-label={t("hs.whichText")}>
          {sources.map((row, index) => (
            <button key={row.short} type="button" role="tab" className="mde-kind" aria-selected={index === shown} onClick={() => setShown(index)}>
              {row.short}
            </button>
          ))}
        </div>
      ) : null}
      {from ? <p className="hs-wait">{t("hs.passageMarked").replace("{ref}", `${chapter}:${from}${to && to > from ? `–${to}` : ""}`)}</p> : null}
      <div className="hs-chapter__text">
        {verses.map((verse) => (
          // The verses of the passage in hand stand out; the rest of the chapter is there to read around them.
          <p key={verse} className="hs-v" data-here={from && verse >= from && verse <= (to ?? from) ? "true" : undefined}>
            <sup>{verse}</sup> {source.verses[verse]}
          </p>
        ))}
      </div>
    </div>
  );
}

export type SourceHelp = { text: string; secondary?: string };

/**
 * Each help as the source package has it (the English note, question or article being translated), by the id of
 * the item in hand. A table file is read once for all its rows; an article, each from its own file.
 */
export function useSourceHelps(session: GtSession | undefined, ctx: SolverLaunchContext | null, target: HelpsTarget | null, items: HelpsDraftItem[]): { helps: Record<string, SourceHelp>; lang: string; loaded: boolean } {
  const [helps, setHelps] = useState<Record<string, SourceHelp>>({});
  const [lang, setLang] = useState("");
  /** The paths the source was last read for: until they are the ones in hand, it is still being read. */
  const [readFor, setReadFor] = useState<string | null>(null);
  const paths = items.map((item) => item.filepath).join("|");
  useEffect(() => {
    if (!session?.token || !ctx || !target || !items.length) return;
    let alive = true;
    void (async () => {
      const board = await loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg).catch(() => null);
      const pkg = resolveSourcePackage(board?.settings);
      if (alive) setLang(sourcePackageLang(pkg));
      const out: Record<string, SourceHelp> = {};
      if (target.kind === "tsv") {
        const questions = target.resource === "preguntas";
        // The questions repository sits beside the notes one: `en_tn` → `en_tq`.
        const raw = await readRaw(session, pkg.owner, questions ? pkg.tn.replace(/_tn$/, "_tq") : pkg.tn, helpsTsvFilename(questions ? "preguntas" : "notas", target.book));
        for (const row of raw ? parseTsvTable(raw).rows : []) {
          const id = tsvRowId(row);
          if (id) out[id] = questions ? { text: row.Question || "", secondary: row.Response || "" } : { text: row.Note || "" };
        }
      } else {
        const repo = target.resource === "academia" ? pkg.ta : pkg.tw;
        await Promise.all(
          items.map(async (item) => {
            const raw = await readRaw(session, pkg.owner, repo, item.filepath);
            if (raw?.trim()) out[item.id] = { text: raw };
          }),
        );
      }
      if (alive) {
        setHelps(out);
        setReadFor(paths);
      }
    })().catch(() => alive && setReadFor(paths));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, session?.host, ctx?.projectId, target?.resource, target?.kind, paths]);
  return { helps, lang, loaded: readFor === paths };
}
