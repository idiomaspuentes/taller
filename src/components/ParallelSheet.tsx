import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Workspace } from "../config/types";
import type { OriginalWord } from "../dcs/afinacionLoad";
import type { GtSession } from "../dcs/auth";
import { loadParallelTexts, type ParallelText, type ParallelTexts } from "../dcs/parallels";
import { bookLabel } from "../domain/books";
import { formatParallelRef, parallelLabel, versesOfRef, type ParallelRef } from "../domain/parallels";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { OriginalWords } from "./OriginalWords";
import { UsfmReferencePane } from "./UsfmReferencePane";
import { WordSheet } from "./WordSheet";

/** A text of the passage in its lines, a run of verses at a time (a reference may skip some). */
function Lines({ text, passage, label }: { text: ParallelText; passage: ParallelRef; label: string }) {
  return (
    <>
      {passage.spans.map((span) => (
        <UsfmReferencePane key={span.from} usfm={text.usfm} range={{ chapter: passage.chapter, from: span.from, to: span.to }} label={label} fallbackVerses={text.verses} />
      ))}
    </>
  );
}

/**
 * The passages parallel to a verse, one at a time: in the original, with each word opening what it means, in the
 * ULT, and in the team's own text when it has that book. What tells the same thing elsewhere is read before
 * deciding how to say it here.
 */
export function ParallelSheet({
  at,
  refs,
  session,
  workspace,
  team,
  onClose,
}: {
  /** The verse whose parallels are shown, or `null` while the sheet is closed. */
  at: { book: string; chapter: number; verse: number } | null;
  refs: ParallelRef[];
  session: GtSession | null;
  workspace: Workspace | undefined;
  /** Where the team keeps the text it is translating: its version of the passage is read from there. */
  team?: { owner: string; repo: string };
  onClose: () => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const name = (code: string) => bookLabel(code, language);
  const [chosen, setChosen] = useState(0);
  const [texts, setTexts] = useState<ParallelTexts | null>(null);
  const [word, setWord] = useState<{ word: OriginalWord; verse: number } | null>(null);
  const passage = at ? (refs[chosen] ?? refs[0]) : undefined;
  const key = passage ? formatParallelRef(passage) : "";

  useEffect(() => setChosen(0), [at?.book, at?.chapter, at?.verse]);
  useEffect(() => {
    setTexts(null);
    if (!passage || !session) return;
    let alive = true;
    void loadParallelTexts(session, passage, team).then((loaded) => {
      if (alive) setTexts(loaded);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, session, team?.owner, team?.repo]);

  return (
    <>
      <Dialog open={Boolean(at)} onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="fix-sheet help-sheet pp-sheet" aria-label={t("pp.title")}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{t("pp.title")}</DialogTitle>
            {at ? <p className="ws-meta">{t("pp.of").replace("{ref}", `${name(at.book)} ${at.chapter}:${at.verse}`.replace(/ /g, " "))}</p> : null}
          </header>
          <div className="fx-body pp-body">
            {refs.length > 1 ? (
              <div className="pp-refs" role="tablist" aria-label={t("pp.title")}>
                {refs.map((ref, i) => (
                  <button key={formatParallelRef(ref)} type="button" role="tab" className="pp-ref" aria-selected={i === chosen} onClick={() => setChosen(i)}>
                    {parallelLabel(ref, name)}
                  </button>
                ))}
              </div>
            ) : null}
            {passage ? (
              <section className="pp-passage" aria-label={parallelLabel(passage, name)}>
                <h3 className="pp-passage__ref">{parallelLabel(passage, name)}</h3>
                {!texts ? <p className="af-hint">{t("pp.loading")}</p> : null}
                {texts && !texts.original && !texts.ult && !texts.team ? <p className="af-hint">{t("pp.none")}</p> : null}
                {texts?.team ? (
                  <div className="pp-text">
                    <p className="af-lbl">{t("pp.team")}</p>
                    <Lines text={texts.team} passage={passage} label={t("pp.team")} />
                  </div>
                ) : null}
                {texts?.ult ? (
                  <div className="pp-text">
                    <p className="af-lbl">{t("pp.ult")}</p>
                    <Lines text={texts.ult} passage={passage} label={t("pp.ult")} />
                  </div>
                ) : null}
                {texts?.original ? (
                  <div className="pp-text">
                    <p className="af-lbl">{t("pp.original")}</p>
                    {versesOfRef(passage).map((verse) => (
                      <p key={verse} className="pp-original">
                        <sup>{verse}</sup>{" "}
                        <OriginalWords text={texts.original!.verses[verse] ?? ""} words={texts.original!.words[`${passage.chapter}:${verse}`]} onOpen={(found) => setWord({ word: found, verse })} />
                      </p>
                    ))}
                    <p className="af-hint">{t("pp.touch")}</p>
                  </div>
                ) : null}
              </section>
            ) : null}
            <p className="pp-credit">{t("pp.credit")}</p>
          </div>
        </DialogContent>
      </Dialog>
      <WordSheet word={word?.word ?? null} at={{ book: passage?.book ?? "", chapter: passage?.chapter ?? 0, verse: word?.verse ?? 0 }} session={session} workspace={workspace} onClose={() => setWord(null)} />
    </>
  );
}
