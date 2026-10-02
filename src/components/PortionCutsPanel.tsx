import { useMemo, useState } from "react";
import { Link2, Scissors, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupPortionsByChapter } from "../domain/chapters";
import { cutAt, joinWithNext, startsOf, withPortionStarts, withoutPortionStarts } from "../domain/extraWork";
import type { Portion, ProjectSettings } from "../domain/types";
import { useT } from "../i18n/messages";

type Props = {
  book: string;
  portions: Portion[];
  settings: ProjectSettings | undefined;
  /** The settings with the new cuts: the host reads the book again with them. */
  onApply: (settings: ProjectSettings) => void;
  busy?: boolean;
};

function sameList(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Where the portions of the book are cut. The source gives its own cuts; whoever prepares the project can join two
 * portions or cut one in two before creating it. Changes are shown at once and only read again from the book (to
 * count what falls in each portion) when they are applied.
 */
export function PortionCutsPanel({ book, portions, settings, onApply, busy }: Props) {
  const t = useT();
  const chapters = useMemo(() => groupPortionsByChapter(portions), [portions]);
  const [open, setOpen] = useState<number | null>(chapters.length === 1 ? chapters[0]!.chapter : null);
  /** Cuts changed here and not applied yet, by chapter. */
  const [pending, setPending] = useState<Record<number, number[]>>({});
  const [cutting, setCutting] = useState<{ chapter: number; index: number; verse: number } | null>(null);
  const chosen = settings?.portionStarts?.[book.toUpperCase()] ?? {};
  const changed = Object.keys(pending).length;

  function apply() {
    let next = settings;
    for (const [chapter, starts] of Object.entries(pending)) next = withPortionStarts(next, book, Number(chapter), starts);
    setPending({});
    setCutting(null);
    onApply(next ?? {});
  }

  return (
    <div className="pc">
      <ul className="pc-list">
        {chapters.map((chapter) => {
          const verses = chapter.portions.flatMap((portion) => portion.verses);
          const read = startsOf(chapter.portions);
          const starts = pending[chapter.chapter] ?? read;
          const groups = starts.map((start, index) => verses.filter((verse) => verse >= start && (index === starts.length - 1 || verse < starts[index + 1]!)));
          const isOpen = open === chapter.chapter;
          const byHand = Boolean(chosen[String(chapter.chapter)]) || Boolean(pending[chapter.chapter]);
          const set = (next: number[]) => setPending((prev) => (sameList(next, read) ? Object.fromEntries(Object.entries(prev).filter(([key]) => Number(key) !== chapter.chapter)) : { ...prev, [chapter.chapter]: next }));
          return (
            <li key={chapter.chapter} className="pc-chapter" data-open={isOpen ? "true" : undefined}>
              <button type="button" className="pc-chapter__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : chapter.chapter)}>
                <span className="pc-chapter__name">{t("ho.chapter").replace("{n}", String(chapter.chapter))}</span>
                <span className="pc-chapter__state">
                  {t(groups.length === 1 ? "pc.portionsOne" : "pc.portionsMany").replace("{n}", String(groups.length))}
                  {byHand ? ` · ${t(pending[chapter.chapter] ? "pc.notApplied" : "pc.byHand")}` : ""}
                </span>
              </button>
              {isOpen ? (
                <div className="pc-chapter__body">
                  <ol className="pc-portions">
                    {groups.map((group, index) => {
                      const from = group[0];
                      const to = group[group.length - 1];
                      const isCutting = cutting?.chapter === chapter.chapter && cutting.index === index;
                      return (
                        <li key={from} className="pc-portion">
                          <div className="pc-portion__row">
                            <span className="pc-portion__ref">{from === to ? `${chapter.chapter}:${from}` : `${chapter.chapter}:${from}–${to}`}</span>
                            <span className="pc-portion__size">{t(group.length === 1 ? "pc.versesOne" : "pc.versesMany").replace("{n}", String(group.length))}</span>
                            {group.length > 1 ? (
                              <button type="button" className="pc-act" disabled={busy} aria-expanded={isCutting} onClick={() => setCutting(isCutting ? null : { chapter: chapter.chapter, index, verse: group[Math.ceil(group.length / 2)]! })}>
                                <Scissors size={14} aria-hidden /> {t("pc.cut")}
                              </button>
                            ) : null}
                          </div>
                          {isCutting && cutting ? (
                            <div className="pc-cut">
                              <label>
                                {t("pc.secondStartsAt")}{" "}
                                <select className="af-input pe-auto" value={cutting.verse} onChange={(e) => setCutting({ ...cutting, verse: Number(e.target.value) })}>
                                  {group.slice(1).map((verse) => (
                                    <option key={verse} value={verse}>
                                      {chapter.chapter}:{verse}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  set(cutAt(starts, cutting.verse));
                                  setCutting(null);
                                }}
                              >
                                {t("pc.cutHere")}
                              </Button>
                            </div>
                          ) : null}
                          {index < groups.length - 1 ? (
                            <button type="button" className="pc-join" disabled={busy} onClick={() => set(joinWithNext(starts, index))}>
                              <Link2 size={14} aria-hidden /> {t("pc.join")}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  {chosen[String(chapter.chapter)] && !pending[chapter.chapter] ? (
                    <button type="button" className="pe-link" disabled={busy} onClick={() => onApply(withoutPortionStarts(settings, book, chapter.chapter))}>
                      <Undo2 size={14} aria-hidden /> {t("pc.reset")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {changed ? (
        <div className="pc-apply">
          <p>{t("pc.applyHint")}</p>
          <div className="pf-footer__actions">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setPending({})}>
              {t("pc.discard")}
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={apply}>
              {t("pc.apply")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
