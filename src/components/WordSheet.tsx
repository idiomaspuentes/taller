import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Workspace } from "../config/types";
import type { GtSession } from "../dcs/auth";
import { lexiconRepos, loadLexiconEntry } from "../dcs/lexicon";
import { sensesOfWord, strongParts, type LexiconFile, type LexiconSense, type StrongPart } from "../domain/lexicon";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";

/** A word of the original as the text tags it. */
export type SheetWord = { surface: string; lemma: string; strong: string };

type Found = { part: StrongPart; file: LexiconFile | null };

function Sense({ sense }: { sense: LexiconSense }) {
  const t = useT();
  const english = sense.lang === "en" || sense.definitionLang === "en";
  return (
    <li className="ws-sense">
      {sense.glosses?.length ? <p className="ws-glosses">{sense.glosses.join(", ")}</p> : null}
      {sense.definition ? (
        <p className="ws-def" lang={english ? "en" : undefined}>
          {sense.definition}
          {english ? <span className="ws-tag"> {t("lx.inEnglish")}</span> : null}
        </p>
      ) : null}
      {sense.domain ? <p className="ws-meta">{sense.domain}</p> : null}
      {sense.comments ? (
        <p className="ws-note">
          <strong>{t("lx.comments")}</strong> {sense.comments}
        </p>
      ) : null}
      {sense.etymology ? (
        <p className="ws-meta">
          <strong>{t("lx.origin")}</strong> {sense.etymology}
        </p>
      ) : null}
    </li>
  );
}

/**
 * What a word of the original means, over the tool: the sense the lexicon gives for the verse in hand first, the
 * word's other senses one tap away. A sheet from the bottom on a phone, where the thumb is; a dialog on a desk.
 */
export function WordSheet({
  word,
  at,
  session,
  workspace,
  onClose,
  onSeparate,
}: {
  /** The word to show, or `null` while the sheet is closed. */
  word: SheetWord | null;
  at: { book: string; chapter: number; verse: number };
  session: GtSession | null;
  workspace: Workspace | undefined;
  onClose: () => void;
  /** Given when the word shares its box with others and can be taken out of it. */
  onSeparate?: () => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const [found, setFound] = useState<Found[] | null>(null);
  const strong = word?.strong ?? "";

  useEffect(() => {
    let alive = true;
    setFound(null);
    if (!strong || !session) {
      setFound([]);
      return;
    }
    const parts = strongParts(strong);
    void Promise.all(parts.map(async (part) => ({ part, file: await loadLexiconEntry(session, lexiconRepos(workspace, part.kind), part.number) }))).then((rows) => {
      if (alive) setFound(rows);
    });
    return () => {
      alive = false;
    };
  }, [strong, session, workspace]);

  const parts = strongParts(strong);
  const hebrew = parts[0]?.kind === "hebrew";
  const first = found?.find((row) => row.file)?.file;
  const firstEntries = first && found ? sensesOfWord(first, at, found.find((row) => row.file)?.part.letter).entries : [];
  const pos = firstEntries[0]?.pos?.join(", ");
  const credit = workspace?.lexicons?.credit?.[language];

  return (
    <Dialog open={Boolean(word)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="word-sheet" aria-label={t("lx.aria")}>
        {word ? (
          <>
            <header className="ws-head">
              <DialogTitle className="ws-word" lang={hebrew ? "hbo" : "grc"} dir={hebrew ? "rtl" : undefined}>
                {word.surface}
              </DialogTitle>
              <p className="ws-meta">
                {[word.lemma && word.lemma !== word.surface ? `${t("lx.lemma")} ${word.lemma}` : "", pos, parts.map((p) => `${p.kind === "greek" ? "G" : "H"}${p.number}${p.letter}`).join(" · ")].filter(Boolean).join(" · ")}
              </p>
            </header>

            {found === null ? <p className="af-hint">{t("lx.loading")}</p> : null}
            {found !== null && !found.some((row) => row.file) ? <p className="af-hint">{t("lx.none")}</p> : null}

            {(found ?? []).map(({ part, file }) => {
              if (!file) return null;
              const senses = sensesOfWord(file, at, part.letter);
              const pending = senses.entries.some((e) => e.review === "pending");
              return (
                <section key={`${part.kind}-${part.number}`} className="ws-part">
                  {senses.entries.length ? (
                    <>
                      {senses.byVerse ? <p className="af-lbl">{t("lx.here")}</p> : senses.here.length > 1 ? <p className="af-lbl">{t("lx.senses").replace("{n}", String(senses.here.length))}</p> : null}
                      <ul className="ws-senses">
                        {senses.here.map((sense, i) => (
                          <Sense key={i} sense={sense} />
                        ))}
                      </ul>
                      {senses.other.length ? (
                        <details className="ws-more">
                          <summary>{t("lx.others").replace("{n}", String(senses.other.length))}</summary>
                          <ul className="ws-senses">
                            {senses.other.map((sense, i) => (
                              <Sense key={i} sense={sense} />
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </>
                  ) : (
                    // A plain Door43 lexicon: a gloss and a line, no senses.
                    <ul className="ws-senses">
                      <Sense sense={{ glosses: file.brief ? [file.brief] : [], definition: file.long }} />
                    </ul>
                  )}
                  {pending ? <p className="ws-meta">{t("lx.pending")}</p> : null}
                </section>
              );
            })}

            {onSeparate ? (
              <Button type="button" size="sm" variant="outline" onClick={onSeparate}>
                {t("lx.separate")}
              </Button>
            ) : null}
            {credit && found?.some((row) => row.file) ? <p className="ws-credit">{credit}</p> : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
