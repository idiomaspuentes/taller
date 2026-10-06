import { useEffect, useState } from "react";
import type { GtSession } from "../dcs/auth";
import type { RepoTarget } from "../dcs/afinacionStore";
import { loadCorrections, onCorrectionSaved } from "../dcs/correctionLog";
import { CORRECTION_REASONS, correctionsOfVerse, type Correction, type CorrectionReason } from "../domain/correctionLog";
import { diffWords } from "../domain/reviewItems";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";

const LABEL: Record<CorrectionReason, MessageKey> = {
  spelling: "fx.rSpelling",
  punctuation: "fx.rPunctuation",
  wordChoice: "fx.rWordChoice",
  meaning: "fx.rMeaning",
  grammar: "fx.rGrammar",
  other: "fx.rOther",
};

type Translate = ReturnType<typeof useT>;

/** The reasons as they are read, in the order they are offered. */
export function reasonNames(reasons: CorrectionReason[], t: Translate): string[] {
  return CORRECTION_REASONS.filter((reason) => reasons.includes(reason)).map((reason) => t(LABEL[reason]));
}

/** The reason as one line, for whoever reads the change later: the kinds chosen, then what the person wrote. */
export function reasonLine(reasons: CorrectionReason[], note: string, t: Translate): string {
  return [reasonNames(reasons, t).join(", "), note.trim()].filter(Boolean).join(": ");
}

/** The usual reasons to change a verse, one tap each, so the reason does not have to be typed every time. */
export function CorrectionReasons({ value, onChange }: { value: CorrectionReason[]; onChange: (next: CorrectionReason[]) => void }) {
  const t = useT();
  return (
    <div className="fx-reasons" role="group" aria-label={t("fx.reasons")}>
      {CORRECTION_REASONS.map((reason) => (
        <button key={reason} type="button" aria-pressed={value.includes(reason)} onClick={() => onChange(value.includes(reason) ? value.filter((id) => id !== reason) : [...value, reason])}>
          {t(LABEL[reason])}
        </button>
      ))}
    </div>
  );
}

/**
 * What was corrected in a verse before: who, when, why, and what changed, word by word. Nothing is shown of a verse
 * nobody corrected. Read once per visit for the whole book, and added to when a correction is saved from here.
 */
export function VerseCorrections({ session, target, book, chapter, verse }: { session: GtSession | null | undefined; target: RepoTarget | null | undefined; book: string; chapter: number; verse: number }) {
  const t = useT();
  const language = useUiLanguage();
  const [all, setAll] = useState<Correction[]>([]);
  const key = target ? `${target.owner}/${target.repo}@${target.branch}:${book}` : "";
  useEffect(() => {
    if (!session?.token || !target || !book) return;
    let live = true;
    const read = () =>
      void loadCorrections(session, target, book)
        .then((found) => live && setAll(found))
        .catch(() => undefined);
    read();
    const off = onCorrectionSaved(read);
    return () => {
      live = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, key]);

  const mine = correctionsOfVerse(all, chapter, verse);
  if (!mine.length) return null;
  const day = (iso: string) => (Number.isNaN(Date.parse(iso)) ? "" : new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short" }));
  return (
    <details className="fix-log">
      <summary>{mine.length === 1 ? t("cx.once") : t("cx.times").replace("{n}", String(mine.length))}</summary>
      <ol>
        {mine.map((row) => (
          <li key={`${row.by}-${row.at}`}>
            <p className="fix-log__who">
              <strong>@{row.by}</strong> · {day(row.at)} · {reasonLine(row.reasons, row.note ?? "", t) || t("cx.noReason")}
            </p>
            <p className="al-diff">{diffWords(row.before, row.after).map((part, index) => (part.kind === "same" ? part.text : part.kind === "added" ? <ins key={index}>{part.text}</ins> : <del key={index}>{part.text}</del>))}</p>
            {row.from?.label ? <p className="fix-log__from">{t("cx.from").replace("{label}", row.from.label)}</p> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
