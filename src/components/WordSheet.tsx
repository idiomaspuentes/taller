import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LexiconRepo, Workspace } from "../config/types";
import type { GtSession } from "../dcs/auth";
import { lexiconRepos, loadLexiconEntry, reportLexiconEntry } from "../dcs/lexicon";
import { explainError } from "../dcs/userError";
import { lexiconReport, sensesOfWord, strongCode, strongParts, type LexiconFile, type LexiconSense, type StrongPart } from "../domain/lexicon";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";

/** A word of the original as the text tags it. */
export type SheetWord = { surface: string; lemma: string; strong: string };

type Found = { part: StrongPart; file: LexiconFile | null; repo: LexiconRepo | undefined };

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
 * Whoever sees something wrong in an entry says so from here, and it reaches the people who keep the lexicon.
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
  /** The report being written about the entry; `null` while nobody is writing one. */
  const [report, setReport] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ number: number; url: string } | null>(null);
  const [error, setError] = useState("");
  const strong = word?.strong ?? "";

  useEffect(() => {
    let alive = true;
    setFound(null);
    setReport(null);
    setSent(null);
    setError("");
    if (!strong || !session) {
      setFound([]);
      return;
    }
    void Promise.all(
      strongParts(strong).map(async (part) => {
        const repos = lexiconRepos(workspace, part.kind);
        const entry = await loadLexiconEntry(session, repos, part.number);
        // With no entry, a report (the word is missing) goes to the first lexicon the workspace reads.
        return { part, file: entry?.file ?? null, repo: entry?.repo ?? repos[0] };
      }),
    ).then((rows) => {
      if (alive) setFound(rows);
    });
    return () => {
      alive = false;
    };
  }, [strong, session, workspace]);

  const parts = strongParts(strong);
  const hebrew = parts[0]?.kind === "hebrew";
  const main = found?.find((row) => row.file) ?? found?.[0];
  const mainSenses = main?.file ? sensesOfWord(main.file, at, main.part.letter) : undefined;
  const pos = mainSenses?.entries[0]?.pos?.join(", ");
  const credit = workspace?.lexicons?.credit?.[language];

  async function send() {
    if (!word || !session || !main?.repo || !report?.trim()) return;
    setSending(true);
    setError("");
    try {
      const shown = mainSenses?.here[0];
      const issue = lexiconReport({
        text: report,
        surface: word.surface,
        lemma: word.lemma,
        part: main.part,
        at,
        shown: shown ? [shown.glosses?.join(", "), shown.definition].filter(Boolean).join(" — ") : "",
        username: session.username,
        labels: { word: t("lx.rWord"), lemma: t("lx.lemma"), entry: t("lx.rEntry"), verse: t("lx.rVerse"), shown: t("lx.rShown"), missing: t("lx.rMissing"), from: t("lx.rFrom") },
      });
      setSent(await reportLexiconEntry(session, main.repo, issue));
      setReport(null);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={Boolean(word)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="word-sheet" aria-label={t("lx.aria")}>
        {word ? (
          <>
            <header className="ws-head">
              <DialogTitle className="ws-word" lang={hebrew ? "hbo" : "grc"} dir={hebrew ? "rtl" : undefined}>
                {word.surface}
              </DialogTitle>
              <p className="ws-meta">{[word.lemma && word.lemma !== word.surface ? `${t("lx.lemma")} ${word.lemma}` : "", pos, parts.map(strongCode).join(" · ")].filter(Boolean).join(" · ")}</p>
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

            {report !== null ? (
              <div className="ws-report" role="group" aria-label={t("lx.report")}>
                <label className="af-lbl" htmlFor="ws-report-text">
                  {t("lx.reportAsk")}
                </label>
                <textarea id="ws-report-text" className="af-textarea" rows={3} value={report} autoFocus onChange={(e) => setReport(e.target.value)} />
                <p className="ws-meta">{t("lx.reportHint")}</p>
                {error ? (
                  <p className="ws-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="af-row-buttons">
                  <Button type="button" size="sm" disabled={sending || !report.trim()} onClick={() => void send()}>
                    {sending ? t("lx.reportSending") : t("lx.reportSend")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={() => setReport(null)}>
                    {t("af.cancel")}
                  </Button>
                </div>
              </div>
            ) : sent ? (
              <p className="ws-sent" role="status">
                {t("lx.reportSent")}{" "}
                <a href={sent.url} target="_blank" rel="noreferrer">
                  {t("lx.reportSee").replace("{n}", String(sent.number))}
                </a>
              </p>
            ) : found !== null && session && main?.repo ? (
              <button type="button" className="af-link ws-report-open" onClick={() => setReport("")}>
                {t("lx.report")}
              </button>
            ) : null}

            {credit && found?.some((row) => row.file) ? <p className="ws-credit">{credit}</p> : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
