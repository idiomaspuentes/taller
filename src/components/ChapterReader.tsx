import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { loadChapterTexts, type ChapterText } from "../dcs/afinacionLoad";
import { chapterRows, chaptersOf, MAX_PARALLEL, shownAtStart, toggleShown, type ParallelCell } from "../domain/parallelChapter";
import type { SourcePackage } from "../domain/sourcePackage";
import { useT } from "../i18n/messages";
import { LoadingState } from "./LoadingState";
import { useWide } from "./useWide";

type Props = {
  session: GtSession;
  book: string;
  pkg?: SourcePackage;
  /** The group's draft being worked on, and what to call it («Borrador TPL»). */
  draft?: { owner: string; repo: string; branch: string; filepath: string };
  draftLabel?: string;
  /** The texts, when the screen has them already: nothing is read again. */
  texts?: ChapterText[];
  /** The text it opens in: the one the person was reading. */
  initial?: ChapterText["id"];
  /** Where the work in hand is: its chapter opens first, and its verses stand out. */
  chapter: number;
  from: number;
  to?: number;
  /** How a verse of a text reads, where the screen shows it otherwise (the original's words, to be touched). */
  renderVerse?: (text: ChapterText, key: string, body: string) => ReactNode;
};

/** The texts last read side by side, on this device: a convenience, so nothing is lost if it cannot be kept. */
const KEPT = "taller-chapter-texts";
function readKept(): unknown {
  try {
    return JSON.parse(localStorage.getItem(KEPT) ?? "null");
  } catch {
    return null;
  }
}
function keep(ids: string[]) {
  try {
    localStorage.setItem(KEPT, JSON.stringify(ids));
  } catch {
    /* a private window keeps nothing: the chapter opens as it does the first time */
  }
}

const isHebrew = (text: ChapterText) => text.id === "orig" && Object.values(text.book).slice(0, 3).some((body) => /[֐-׿]/.test(body));

/**
 * Whole chapters to read the work in hand in its place: the original by default, the two English texts, and the
 * group's draft as it is now. Any chapter of the book can be read; the one in hand opens first.
 *
 * On a computer several texts can be read side by side, up to four, one row per verse: each text is touched to put
 * it beside the others or to take it away, and what was chosen is there the next time. On a phone the columns
 * would be a few words wide: one text at a time, as before.
 */
export function ChapterReader({ session, book, pkg, draft, draftLabel, texts: given, initial, chapter, from, to, renderVerse }: Props) {
  const t = useT();
  const wide = useWide();
  const [read, setTexts] = useState<ChapterText[] | null>(null);
  const texts = given ?? read;
  const order = useMemo(() => (texts ?? []).map((row) => row.id as string), [texts]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [one, setOne] = useState<ChapterText["id"]>(initial ?? "orig");
  const [reading, setReading] = useState(chapter);

  useEffect(() => {
    if (given || !pkg || !draft) return;
    let alive = true;
    void loadChapterTexts({ session, book, pkg, draft, draftLabel: draftLabel ?? "" })
      .then((rows) => alive && setTexts(rows))
      .catch(() => alive && setTexts([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, book, draft?.owner, draft?.repo, draft?.branch, Boolean(given)]);

  if (!texts) return <LoadingState shape="text" label={t("cr.loading")} lines={8} />;
  if (!texts.length) return <p className="af-hint">{t("cr.none")}</p>;

  const side = wide ? (chosen ?? shownAtStart(readKept(), order, initial)) : [texts.some((row) => row.id === one) ? one : texts[0]!.id];
  const shown = texts.filter((row) => side.includes(row.id));
  const touch = (id: string) => {
    if (!wide) return setOne(id as ChapterText["id"]);
    const next = toggleShown(side, id, order);
    setChosen(next);
    keep(next);
  };
  const chapters = chaptersOf(texts);
  const here = (verse: number) => reading === chapter && verse >= from && verse <= (to ?? from);
  const full = wide && side.length >= MAX_PARALLEL;

  return (
    <section className="af-chapter" data-parallel={shown.length > 1 ? "true" : undefined}>
      <div className="af-ref__bar">
        <div className="af-ref__texts" role={wide ? "group" : "tablist"} aria-label={t(wide ? "cr.sideLabel" : "af.readAgainst")}>
          {texts.map((row) => {
            const on = side.includes(row.id);
            return wide ? (
              <button key={row.id} type="button" aria-pressed={on} disabled={!on && full} onClick={() => touch(row.id)}>
                {row.label}
              </button>
            ) : (
              <button key={row.id} type="button" role="tab" aria-selected={on} onClick={() => touch(row.id)}>
                {row.label}
              </button>
            );
          })}
        </div>
        <label className="af-pick">
          <span className="sr-only">{t("af.chapterPick")}</span>
          <select value={reading} onChange={(e) => setReading(Number(e.target.value))}>
            {(chapters.length ? chapters : [chapter]).map((n) => (
              <option key={n} value={n}>
                {t("af.chapterN").replace("{n}", String(n))}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden />
        </label>
      </div>
      {wide && shown.length === 1 ? <p className="af-hint">{t("cr.sideHint")}</p> : null}
      {shown.some((row) => row.id === "draft") ? <p className="af-hint">{t("af.draftSoFar")}</p> : null}
      {shown.length === 1 ? <OneText text={shown[0]!} reading={reading} here={here} renderVerse={renderVerse} /> : <SideBySide texts={shown} reading={reading} here={here} renderVerse={renderVerse} />}
    </section>
  );
}

function OneText({ text, reading, here, renderVerse }: { text: ChapterText; reading: number; here: (verse: number) => boolean; renderVerse?: Props["renderVerse"] }) {
  const t = useT();
  const rows = chapterRows([text], reading);
  const hebrew = isHebrew(text);
  return (
    // Hebrew is read from the right, its verse numbers on that side: it was laid out as Greek, from the left.
    <div className={text.id === "orig" ? "af-chapter__text af-orig" : "af-chapter__text"} lang={text.id === "orig" ? (hebrew ? "hbo" : "grc") : undefined} dir={hebrew ? "rtl" : undefined}>
      {rows.map((row) => {
        const cell = row.cells[0]!;
        // A verse inside a joined one is already read with it: it has no line of its own here.
        if (cell.kind !== "text") return null;
        const key = `${reading}:${row.verse}`;
        return (
          <p key={key} className="hs-v" data-here={here(row.verse) ? "true" : undefined}>
            <sup>{cell.to ? `${row.verse}–${cell.to}` : row.verse}</sup> {renderVerse ? renderVerse(text, key, cell.text) : cell.text}
            {cell.to ? <span className="sr-only">{t("cr.joinedUpTo").replace("{n}", String(cell.to))}</span> : null}
          </p>
        );
      })}
    </div>
  );
}

/** Several texts in columns, a row for each verse: the row is as tall as the longest of them. */
function SideBySide({ texts, reading, here, renderVerse }: { texts: ChapterText[]; reading: number; here: (verse: number) => boolean; renderVerse?: Props["renderVerse"] }) {
  const t = useT();
  const rows = chapterRows(texts, reading);
  const hebrew = texts.map(isHebrew);
  const cellOf = (text: ChapterText, index: number, verse: number, cell: ParallelCell) => {
    const orig = text.id === "orig";
    const attrs = { role: "cell", className: "crp__cell", "data-orig": orig ? "true" : undefined, lang: orig ? (hebrew[index] ? "hbo" : "grc") : undefined, dir: hebrew[index] ? ("rtl" as const) : undefined };
    if (cell.kind === "joined") return <div key={text.id} {...attrs} data-empty="true">{t("cr.joinedWith").replace("{n}", String(cell.from))}</div>;
    if (cell.kind === "missing") return (
      <div key={text.id} {...attrs} data-empty="true">
        <span aria-hidden>—</span>
        <span className="sr-only">{t("cr.missing")}</span>
      </div>
    );
    const key = `${reading}:${verse}`;
    return (
      <div key={text.id} {...attrs}>
        {cell.to ? <span className="crp__span">{`${verse}–${cell.to}`}</span> : null}
        {renderVerse ? renderVerse(text, key, cell.text) : cell.text}
      </div>
    );
  };
  return (
    <div className="crp" role="table" aria-label={t("cr.sideLabel")} style={{ ["--crp-n" as string]: texts.length }}>
      <div className="crp__row crp__row--head" role="row">
        <span className="crp__num" role="columnheader">
          <span className="sr-only">{t("cr.verse")}</span>
        </span>
        {texts.map((text) => (
          <span key={text.id} className="crp__head" role="columnheader">
            {text.label}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.verse} className="crp__row" role="row" data-here={here(row.verse) ? "true" : undefined}>
          <span className="crp__num" role="rowheader">
            {row.verse}
          </span>
          {row.cells.map((cell, index) => cellOf(texts[index]!, index, row.verse, cell))}
        </div>
      ))}
    </div>
  );
}
