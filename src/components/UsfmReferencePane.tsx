import { Component, useMemo, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { UsfmReadonlyView } from "@usfm-tools/usfm-readonly-react";
import "@usfm-tools/usfm-readonly-react/styles.css";
import { sliceUsjToRange, tryParseUsj, type VerseTextMap } from "../domain/usfmAst";
import type { RefRange } from "../domain/usfmEdit";
import { cn } from "@/lib/utils";

export type QuoteHighlight = {
  verse: number;
  tokenIndices: number[];
  /** Clicked/focused (stronger) vs hover-only. */
  active?: boolean;
};

type Props = {
  usfm: string;
  range: RefRange;
  label: string;
  activeVerse?: number;
  fallbackVerses?: VerseTextMap;
  className?: string;
  highlight?: QuoteHighlight | null;
  /** The words some help of the passage is about, by verse: underlined, so it is seen that touching them gives something. */
  linked?: Record<number, number[]>;
  /** Those words as the phrases each help is about: the line under a phrase runs on from word to word. */
  phrases?: Record<number, number[][]>;
  onWordClick?: (info: {
    verse: number;
    wordIndex: number;
    word: string;
    gatewayTokenIndex?: number;
  }) => void;
};

type BoundaryState = { failed: boolean };

class ReadonlyBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* keep the textarea / plain fallback visible */
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PlainVerses({
  range,
  verses,
}: {
  range: RefRange;
  verses: VerseTextMap;
}) {
  const rows: ReactNode[] = [];
  for (let v = range.from; v <= range.to; v++) {
    rows.push(
      <p key={v} className="scripture-editor__src-verse">
        <span className="scripture-editor__src-num" title={`${range.chapter}:${v}`}>
          {v}
        </span>{" "}
        <span className="scripture-editor__src-text">{verses[v] || "—"}</span>
      </p>,
    );
  }
  return <div className="scripture-editor__src">{rows}</div>;
}

export function UsfmReferencePane({
  usfm,
  range,
  label,
  activeVerse,
  fallbackVerses,
  className,
  highlight,
  linked,
  phrases,
  onWordClick,
}: Props) {
  const usj = useMemo(() => {
    const parsed = tryParseUsj(usfm);
    return parsed ? sliceUsjToRange(parsed, range) : null;
  }, [usfm, range]);

  const plain = fallbackVerses ? (
    <PlainVerses range={range} verses={fallbackVerses} />
  ) : (
    <p className="text-sm text-muted-foreground">No hay texto de referencia.</p>
  );

  if (!usfm.trim() && fallbackVerses) return plain;
  if (!usj) return plain;

  return (
    <ReadonlyBoundary fallback={plain}>
      <UsfmReadonlyView
        usj={usj}
        chapter={range.chapter}
        stripAlignment
        aria-label={label}
        className={cn("scripture-editor__usfm-ro", className)}
        proseMirrorClassName=""
        onWordClick={
          onWordClick
            ? (payload) => {
                const verse = Number(payload.verseNum);
                if (!Number.isFinite(verse)) return;
                onWordClick({
                  verse,
                  wordIndex: payload.wordIndexInVerse,
                  word: payload.word || payload.surface,
                  gatewayTokenIndex: payload.gatewayTokenIndex,
                });
              }
            : undefined
        }
        getWordDecoration={(info) => {
          const verse = Number(info.verseNum);
          const tokenIdx =
            info.gatewayTokenIndex ?? Math.max(0, info.wordIndexInVerse - 1);
          const quoteHit =
            highlight &&
            Number.isFinite(verse) &&
            verse === highlight.verse &&
            highlight.tokenIndices.includes(tokenIdx);
          const verseHit = Boolean(activeVerse && Number.isFinite(verse) && verse === activeVerse);
          const linkHit = Boolean(Number.isFinite(verse) && linked?.[verse]?.includes(tokenIdx));
          // The next word is of the same phrase: the line goes on under the space between the two.
          const runsOn = linkHit && Boolean(phrases?.[verse]?.some((phrase) => phrase.includes(tokenIdx) && phrase.includes(tokenIdx + 1)));
          if (!quoteHit && !verseHit && !linkHit) return;
          const className = [
            linkHit ? "usfm-ro-link" : "",
            runsOn ? "usfm-ro-link--on" : "",
            verseHit ? "usfm-ro-hl" : "",
            quoteHit ? "usfm-ro-ul" : "",
            quoteHit && highlight?.active ? "usfm-ro-hl" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return {
            className,
            style: verseHit && !quoteHit ? ({ background: "transparent" } as CSSProperties) : undefined,
          };
        }}
      />
    </ReadonlyBoundary>
  );
}
