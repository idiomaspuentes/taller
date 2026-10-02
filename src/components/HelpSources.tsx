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

/** The source texts of the whole chapter, to read the note in its place: one text at a time on a phone. */
export function ChapterSources({ sources, chapter, from, to }: { sources: HelpSource[]; chapter: number; from?: number; to?: number }) {
  const t = useT();
  const [shown, setShown] = useState(0);
  if (!sources.length) return null;
  const source = sources[Math.min(shown, sources.length - 1)]!;
  const verses = Object.keys(source.verses)
    .map(Number)
    .sort((a, b) => a - b);
  return (
    <details className="hs-chapter">
      <summary>{t("hs.chapter").replace("{n}", String(chapter)).replace("{texts}", sources.map((row) => row.short).join(" · "))}</summary>
      {sources.length > 1 ? (
        <div className="mde-kinds" role="tablist">
          {sources.map((row, index) => (
            <button key={row.short} type="button" role="tab" className="mde-kind" aria-selected={index === shown} onClick={() => setShown(index)}>
              {row.short}
            </button>
          ))}
        </div>
      ) : null}
      <div className="hs-chapter__text">
        {verses.map((verse) => (
          // The verses of the passage in hand stand out; the rest of the chapter is there to read around them.
          <span key={verse} className="hs-v" data-here={from && verse >= from && verse <= (to ?? from) ? "true" : undefined}>
            <sup>{verse}</sup> {source.verses[verse]}{" "}
          </span>
        ))}
      </div>
    </details>
  );
}
