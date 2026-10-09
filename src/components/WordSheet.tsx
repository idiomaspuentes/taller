import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LexiconRepo, Workspace } from "../config/types";
import type { GtSession } from "../dcs/auth";
import { lexiconRepos, loadLexiconEntry, loadLexiconField, reportLexiconEntry } from "../dcs/lexicon";
import { explainError } from "../dcs/userError";
import { glossOfWord, lexiconReport, otherWordsOfField, sensesOfWord, strongCode, strongParts, type FieldWord, type LexiconField, type LexiconFile, type LexiconSense, type StrongPart } from "../domain/lexicon";
import { loadReferents } from "../dcs/referents";
import { referentsOf, type ReferentTarget } from "../domain/referents";
import { describeMorph, type MorphLabel } from "../domain/morphology";
import { useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";

/**
 * A word of the original as the text tags it. `occurrence` says which one it is among the words of its verse
 * that are written with the same letters, from 0: a verse may say «él» of two people.
 */
export type SheetWord = { surface: string; lemma: string; strong: string; morph?: string; occurrence?: number };

type Found = { part: StrongPart; file: LexiconFile | null; repo: LexiconRepo | undefined };

/** How the app's readers write a word's number: the texts add a digit to the Greek ones. */
const asTagged = (strong: string) => (strong.startsWith("G") ? `${strong}0` : strong);

/**
 * The other words of the field of meaning a sense is filed under: what else the original could have said, and
 * says elsewhere. Read when it is opened; each word opens its own entry.
 */
function FieldWords({ sense, strong, load, onOpen }: { sense: LexiconSense; strong: string; load: (code: string) => Promise<LexiconField | null>; onOpen: (word: FieldWord) => void }) {
  const t = useT();
  const [field, setField] = useState<LexiconField | null | undefined>(undefined);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!asked || !sense.domainCode) return;
    let alive = true;
    void load(sense.domainCode).then((found) => {
      if (alive) setField(found);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, sense.domainCode]);
  if (!sense.domainCode) return null;
  const others = field ? otherWordsOfField(field, strong) : [];
  const hebrew = strong.includes("H");
  return (
    <details className="ws-more ws-field" onToggle={(e) => (e.currentTarget.open ? setAsked(true) : undefined)}>
      <summary>{t("lx.field").replace("{name}", (sense.domain ?? "").split(" · ").pop() ?? "")}</summary>
      {field === undefined ? <p className="af-hint">{t("lx.fieldLoading")}</p> : null}
      {field === null || (field && !others.length) ? <p className="af-hint">{t("lx.fieldNone")}</p> : null}
      {others.length ? (
        <ul className="ws-field__words">
          {others.map((word) => (
            <li key={word.strong}>
              <button type="button" className="ws-field__word" onClick={() => onOpen(word)}>
                <span lang={hebrew ? "hbo" : "grc"}>{word.lemma}</span>
                {word.gloss ? <span className="ws-field__gloss">{word.gloss}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

/** A word another one points to: how it is written, what it means, and where it is when it is in another verse. */
function TargetWord({ target, at, session, workspace, onOpen }: { target: ReferentTarget; at: { book: string; chapter: number; verse: number }; session: GtSession | null; workspace: Workspace | undefined; onOpen: () => void }) {
  const [gloss, setGloss] = useState("");
  const hebrew = target.strong.startsWith("H");
  useEffect(() => {
    setGloss("");
    const part = strongParts(target.strong)[0];
    if (!part || !session) return;
    let alive = true;
    void loadLexiconEntry(session, lexiconRepos(workspace, part.kind), part.number).then((entry) => {
      if (alive && entry) setGloss(glossOfWord(entry.file, { book: at.book, chapter: target.chapter, verse: target.verse }, part.letter));
    });
    return () => {
      alive = false;
    };
  }, [target.strong, target.chapter, target.verse, at.book, session, workspace]);
  const elsewhere = target.chapter !== at.chapter || target.verse !== at.verse;
  return (
    <button type="button" className="ws-field__word" disabled={!target.strong} onClick={onOpen}>
      <span lang={hebrew ? "hbo" : "grc"}>{target.text}</span>
      {gloss || elsewhere ? <span className="ws-field__gloss">{[gloss, elsewhere ? `${target.chapter}:${target.verse}` : ""].filter(Boolean).join(" · ")}</span> : null}
    </button>
  );
}

/**
 * Who the word is about: what a pronoun stands for, and who a verb speaks of when its sentence does not name
 * them. Nothing is shown for a word that points to no other.
 */
function Referents({ word, at, session, workspace, onOpen }: { word: SheetWord; at: { book: string; chapter: number; verse: number }; session: GtSession | null; workspace: Workspace | undefined; onOpen: (target: ReferentTarget) => void }) {
  const t = useT();
  const [targets, setTargets] = useState<ReferentTarget[]>([]);
  useEffect(() => {
    setTargets([]);
    if (!at.book || !at.chapter) return;
    let alive = true;
    void loadReferents(at.book).then((file) => {
      if (alive) setTargets(referentsOf(file, at, word.surface, word.occurrence));
    });
    return () => {
      alive = false;
    };
  }, [at.book, at.chapter, at.verse, word.surface, word.occurrence]);
  if (!targets.length) return null;
  // A word of Hebrew may be a verb and its object in one: each piece under its own question.
  const groups = new Map<string, ReferentTarget[]>();
  for (const target of targets) groups.set(`${target.kind}|${target.piece ?? ""}`, [...(groups.get(`${target.kind}|${target.piece ?? ""}`) ?? []), target]);
  return (
    <section className="ws-refs">
      {[...groups.values()].map((group) => {
        const first = group[0]!;
        return (
          <div key={`${first.kind}|${first.piece ?? ""}`} className="ws-refs__group">
            <p className="af-lbl">{first.kind === "subject" ? t("lx.subject") : first.piece ? t("lx.refersPiece").replace("{piece}", first.piece) : t("lx.refers")}</p>
            <ul className="ws-field__words">
              {group.map((target, i) => (
                <li key={i}>
                  <TargetWord target={target} at={at} session={session} workspace={workspace} onOpen={() => onOpen(target)} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="ws-meta">{t("lx.refCredit")}</p>
    </section>
  );
}

function Sense({ sense, field }: { sense: LexiconSense; field?: Omit<Parameters<typeof FieldWords>[0], "sense"> }) {
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
      {field ? <FieldWords sense={sense} {...field} /> : null}
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
  word: asked,
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
  /** A word of the same field that was opened from the sheet, in place of the one the text was touched at. */
  const [other, setOther] = useState<SheetWord | null>(null);
  useEffect(() => setOther(null), [asked]);
  const word = asked ? (other ?? asked) : null;
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
  // The grammar of this very form, from the text; the lexicon's part of speech only when the text gives none.
  const say = (labels: MorphLabel[]) => labels.map((label) => ("key" in label ? t(`mo.${label.key}` as MessageKey) : label.text)).join(", ");
  const morph = describeMorph(word?.morph).map(say).filter(Boolean);

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
            </header>
            {other && asked ? (
              <button type="button" className="af-link" onClick={() => setOther(null)}>
                {t("lx.back").replace("{word}", asked.surface)}
              </button>
            ) : null}
            <dl className="ws-facts">
              {word.lemma ? (
                <div>
                  <dt>{t("lx.lemma")}</dt>
                  <dd lang={hebrew ? "hbo" : "grc"}>{word.lemma}</dd>
                </div>
              ) : null}
              {morph.length || pos ? (
                <div>
                  <dt>{t("lx.morph")}</dt>
                  <dd>{morph.length ? morph.join(" + ") : pos}</dd>
                </div>
              ) : null}
              {parts.length ? (
                <div>
                  <dt>{t("lx.strong")}</dt>
                  <dd>{parts.map(strongCode).join(" · ")}</dd>
                </div>
              ) : null}
            </dl>

            {/* Only of the word the text was touched at: one opened from here is not read in its verse. */}
            {!other ? <Referents word={word} at={at} session={session} workspace={workspace} onOpen={(target) => setOther({ surface: target.text, lemma: target.text, strong: asTagged(target.strong) })} /> : null}

            {found === null ? <p className="af-hint">{t("lx.loading")}</p> : null}
            {found !== null && !found.some((row) => row.file) ? <p className="af-hint">{t("lx.none")}</p> : null}

            {(found ?? []).map(({ part, file, repo }) => {
              if (!file) return null;
              // A word opened from its field is not of the verse in hand: all its senses are shown.
              const senses = sensesOfWord(file, other ? { book: "", chapter: 0, verse: 0 } : at, part.letter);
              const field = session && repo ? { strong: word.strong, load: (code: string) => loadLexiconField(session, repo, code), onOpen: (next: FieldWord) => setOther({ surface: next.lemma, lemma: next.lemma, strong: asTagged(next.strong) }) } : undefined;
              const pending = senses.entries.some((e) => e.review === "pending");
              return (
                <section key={`${part.kind}-${part.number}`} className="ws-part">
                  {senses.entries.length ? (
                    <>
                      {senses.byVerse ? <p className="af-lbl">{t("lx.here")}</p> : senses.here.length > 1 ? <p className="af-lbl">{t("lx.senses").replace("{n}", String(senses.here.length))}</p> : null}
                      <ul className="ws-senses">
                        {senses.here.map((sense, i) => (
                          <Sense key={i} sense={sense} field={field} />
                        ))}
                      </ul>
                      {senses.other.length ? (
                        <details className="ws-more">
                          <summary>{t("lx.others").replace("{n}", String(senses.other.length))}</summary>
                          <ul className="ws-senses">
                            {senses.other.map((sense, i) => (
                              <Sense key={i} sense={sense} field={field} />
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
