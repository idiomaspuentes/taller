import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { loadChapterTexts, type ChapterText } from "../dcs/afinacionLoad";
import type { SourcePackage } from "../domain/sourcePackage";
import { useT } from "../i18n/messages";

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
};

/**
 * Whole chapters to read the work in hand in its place: the original by default, the two English texts, and the
 * group's draft as it is now. Any chapter of the book can be read; the one in hand opens first.
 */
export function ChapterReader({ session, book, pkg, draft, draftLabel, texts: given, initial, chapter, from, to }: Props) {
  const t = useT();
  const [read, setTexts] = useState<ChapterText[] | null>(null);
  const texts = given ?? read;
  const [shown, setShown] = useState<ChapterText["id"]>(initial ?? "orig");
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

  if (!texts) return <p className="af-hint">{t("cr.loading")}</p>;
  const text = texts.find((row) => row.id === shown) ?? texts[0];
  if (!text) return <p className="af-hint">{t("cr.none")}</p>;
  const chapters = [...new Set(Object.keys(text.book).map((key) => Number(key.split(":")[0])))].sort((a, b) => a - b);
  const verses = Object.entries(text.book)
    .filter(([key]) => Number(key.split(":")[0]) === reading)
    .sort(([a], [b]) => Number(a.split(":")[1]) - Number(b.split(":")[1]));
  const hebrew = text.id === "orig" && /[\u0590-\u05FF]/.test(verses[0]?.[1] ?? "");
  return (
    <section className="af-chapter">
      <div className="af-ref__bar">
        <div className="af-ref__texts" role="tablist" aria-label={t("af.readAgainst")}>
          {texts.map((row) => (
            <button key={row.id} type="button" role="tab" aria-selected={text.id === row.id} onClick={() => setShown(row.id)}>
              {row.label}
            </button>
          ))}
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
      {text.id === "draft" ? <p className="af-hint">{t("af.draftSoFar")}</p> : null}
      {/* Hebrew is read from the right, its verse numbers on that side: it was laid out as Greek, from the left. */}
      <div className={text.id === "orig" ? "af-chapter__text af-orig" : "af-chapter__text"} lang={text.id === "orig" ? (hebrew ? "hbo" : "grc") : undefined} dir={hebrew ? "rtl" : undefined}>
        {verses.map(([key, body]) => {
          const verse = Number(key.split(":")[1]);
          const here = reading === chapter && verse >= from && verse <= (to ?? from);
          return (
            <p key={key} className="hs-v" data-here={here ? "true" : undefined}>
              <sup>{verse}</sup> {body}
            </p>
          );
        })}
      </div>
    </section>
  );
}
