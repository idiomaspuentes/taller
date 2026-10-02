import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession } from "../dcs/auth";
import { commentOnIssue, loadPmConfig } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import { loadFamiliarizeSeen, markFamiliarizeSeen } from "../domain/familiarizeCache";
import { fuenteItem } from "../domain/familiarizeItems";
import {
  englishScriptureKindRef,
  loadEnglishScriptureKindUsfm,
  loadIntroNotes,
  loadNotesForRange,
  type EnglishScriptureRef,
  type NotesLoadResult,
  type ReferenceHelpRow,
} from "../domain/referenceResources";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { localizeName } from "../domain/templateNames";
import { localizeThread } from "../domain/threadNames";
import { extractDraftVerses, type VerseTextMap } from "../domain/usfmAst";
import { portionRange, type RefRange } from "../domain/usfmEdit";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { StudyNotesPanel } from "./StudyNotesPanel";
import { UsfmReferencePane } from "./UsfmReferencePane";

type Props = {
  ctxEncoded: string;
  onClose: () => void;
};

type ScripturePane = { usfm: string; verses: VerseTextMap; meta: EnglishScriptureRef | null };
const EMPTY_SCRIPTURE: ScripturePane = { usfm: "", verses: {}, meta: null };
const EMPTY_NOTES: NotesLoadResult = { notes: [], source: "none", owner: "", repo: "", filepath: "", label: "Notas" };

/** What there is to read before working on a passage, in the order it is read. */
type SectionId = "book" | "chapter" | "passage" | "notes";
const SECTION_TITLE: Record<SectionId, MessageKey> = { book: "fa.bookIntro", chapter: "fa.chapterIntro", passage: "fa.passage", notes: "fa.notesTitle" };

/**
 * One source text. With `chapter`, the whole chapter is shown and the passage in hand stands out inside it: what
 * comes before and after is there to be read, in a quieter tone.
 */
function Text({ title, range, chapter, pane }: { title: string; range: RefRange; chapter: RefRange | null; pane: ScripturePane }) {
  const t = useT();
  const hasText = Boolean(pane.usfm.trim() || Object.keys(pane.verses).length);
  const label = pane.meta?.label || title;
  const part = (r: RefRange) => <UsfmReferencePane usfm={pane.usfm} range={r} label={label} fallbackVerses={pane.usfm ? extractDraftVerses(pane.usfm, r).verses : pane.verses} />;
  return (
    <div className="fam-text">
      <p className="fam-text__title">{label}</p>
      {!hasText ? (
        <p className="pe-hint">{t("fa.loadFailed").replace("{what}", pane.meta?.short || title)}</p>
      ) : chapter ? (
        <>
          {range.from > chapter.from ? <div className="fam-text__around">{part({ chapter: range.chapter, from: chapter.from, to: range.from - 1 })}</div> : null}
          <div className="fam-text__passage" aria-label={t("fa.yourPassage")}>
            <p className="fam-text__mark">{t("fa.yourPassage")}</p>
            {part(range)}
          </div>
          {chapter.to > range.to ? <div className="fam-text__around">{part({ chapter: range.chapter, from: range.to + 1, to: chapter.to })}</div> : null}
        </>
      ) : (
        part(range)
      )}
    </div>
  );
}

/**
 * «Estudiar»: what a person reads before working on a passage, as a guided reading. The introductions, the passage in
 * its two source texts side by side, and the notes of each verse are sections read in order; each one is marked as
 * read at its end, and when all are, «Terminé de estudiar» completes the step. A doubt can be sent to the team from
 * here. The marks are kept on the device, so a reading that was interrupted is picked up where it was left.
 */
export function FamiliarizeView({ ctxEncoded, onClose }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [range, setRange] = useState<RefRange | null>(null);
  const [ult, setUlt] = useState<ScripturePane>(EMPTY_SCRIPTURE);
  const [ust, setUst] = useState<ScripturePane>(EMPTY_SCRIPTURE);
  const [notes, setNotes] = useState<NotesLoadResult>(EMPTY_NOTES);
  const [intros, setIntros] = useState<{ book: string; chapter: string; translated?: { book: boolean; chapter: boolean } }>({ book: "", chapter: "" });
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<SectionId | null>(null);
  /** The whole chapter is read, with the passage marked in it; the person can narrow it to the passage alone. */
  const [wholeChapter, setWholeChapter] = useState(true);
  const [done, setDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [doubt, setDoubt] = useState("");
  const [doubtSent, setDoubtSent] = useState(false);
  const [sending, setSending] = useState(false);
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError(tNow("se.badContext"));
      return;
    }
    setCtx(decoded);
    setSeen(loadFamiliarizeSeen(decoded.username, decoded.lang));
    const refRange = portionRange(decoded.ref, decoded.chapter);
    if (!refRange) {
      setError(tNow("fa.badRef").replace("{ref}", decoded.ref));
      return;
    }
    setRange(refRange);
    const sess = loadSession();
    if (!sess?.token) {
      setLoggedIn(false);
      return;
    }
    setLoggedIn(true);
    setBusy(true);
    setError("");
    try {
      const pmConfig = decoded.pmOrg ? await loadPmConfig(sess, decoded.pmOrg).catch(() => DEFAULT_PM_CONFIG) : DEFAULT_PM_CONFIG;
      const [ultLoaded, ustLoaded, notesLoaded, introsLoaded, already] = await Promise.all([
        loadEnglishScriptureKindUsfm(sess, "ult", decoded.book),
        loadEnglishScriptureKindUsfm(sess, "ust", decoded.book),
        loadNotesForRange(sess, decoded, refRange, pmConfig),
        loadIntroNotes(sess, decoded.book, refRange.chapter, { contentOrg: decoded.contentOrg, lang: decoded.lang, pmConfig }),
        decoded.stepId && decoded.issueNumber ? stepIsDone({ session: sess, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId }).catch(() => false) : Promise.resolve(false),
      ]);
      setIntros(introsLoaded);
      setDone(already);
      const pane = (loaded: Awaited<ReturnType<typeof loadEnglishScriptureKindUsfm>>, kind: "ult" | "ust"): ScripturePane =>
        loaded ? { usfm: loaded.usfm, verses: extractDraftVerses(loaded.usfm, refRange).verses, meta: loaded.meta } : { ...EMPTY_SCRIPTURE, meta: englishScriptureKindRef(kind, decoded.book) };
      setUlt(pane(ultLoaded, "ult"));
      setUst(pane(ustLoaded, "ust"));
      setNotes(notesLoaded);
      if (!ultLoaded && !ustLoaded && notesLoaded.source === "none") setError(tNow("fa.nothingLoaded"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded]);

  useEffect(() => {
    void load();
  }, [load]);

  const base = ctx ? fuenteItem(ctx).id : "";
  /** The introductions are of the book and of the chapter: read once, they are read for every passage of them. */
  const markId = useCallback(
    (id: SectionId) => (ctx && range ? (id === "book" ? `fuente:${ctx.book}:intro`.toLowerCase() : id === "chapter" ? `fuente:${ctx.book}:${range.chapter}:intro`.toLowerCase() : `${base}#${id}`) : ""),
    [ctx, range, base],
  );
  const sections = useMemo<SectionId[]>(() => [...(intros.book ? (["book"] as const) : []), ...(intros.chapter ? (["chapter"] as const) : []), "passage", ...(notes.notes.length ? (["notes"] as const) : [])], [intros, notes.notes.length]);
  const isRead = (id: SectionId) => seen.has(markId(id));
  const readCount = sections.filter(isRead).length;
  const allRead = readCount === sections.length;

  // The first section still to read opens by itself once everything is loaded.
  useEffect(() => {
    if (busy || !ctx || !range) return;
    setOpen((current) => current ?? sections.find((id) => !seen.has(markId(id))) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, sections.join(",")]);

  function read(id: SectionId) {
    if (!ctx?.username || !ctx.lang) return;
    const next = new Set(markFamiliarizeSeen(ctx.username, ctx.lang, markId(id)));
    setSeen(next);
    const following = sections.slice(sections.indexOf(id) + 1).find((row) => !next.has(markId(row))) ?? null;
    setOpen(following);
    if (following) window.requestAnimationFrame(() => refs.current[following]?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  async function finish() {
    const sess = loadSession();
    if (!ctx || !sess?.token) return;
    setFinishing(true);
    setError("");
    try {
      // The mark the rest of the app looks at: this passage was studied.
      markFamiliarizeSeen(ctx.username, ctx.lang, base);
      if (ctx.stepId && ctx.issueNumber) await completeStepFromTool({ session: sess, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      onClose();
    } catch (err) {
      setError(explainError(err));
      setFinishing(false);
    }
  }

  async function sendDoubt() {
    const sess = loadSession();
    const text = doubt.trim();
    if (!ctx?.issueNumber || !sess?.token || !text) return;
    setSending(true);
    setError("");
    try {
      await commentOnIssue(sess, ctx.pmOrg, ctx.issueNumber, t("fa.doubtComment").replace("{ref}", `${ctx.book} ${ctx.ref}`).replace("{text}", text));
      setDoubt("");
      setDoubtSent(true);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSending(false);
    }
  }

  /** The verses the chapter has, to show it whole around the passage. */
  const chapterRange = useMemo<RefRange | null>(() => {
    if (!range) return null;
    const all = extractDraftVerses(ult.usfm || ust.usfm, { chapter: range.chapter, from: 1, to: 200 }).verses;
    const last = Math.max(range.to, ...Object.keys(all).map(Number).filter((n) => Number.isFinite(n)));
    return { chapter: range.chapter, from: 1, to: last };
  }, [range, ult.usfm, ust.usfm]);
  const hasAround = Boolean(range && chapterRange && (chapterRange.to > range.to || range.from > chapterRange.from));

  const byVerse = useMemo(() => {
    const groups = new Map<string, ReferenceHelpRow[]>();
    for (const note of notes.notes) {
      const key = note.verse ? String(note.verse) : note.ref || "";
      groups.set(key, [...(groups.get(key) ?? []), note]);
    }
    return [...groups];
  }, [notes.notes]);

  function body(id: SectionId) {
    if (!range) return null;
    if (id === "book" || id === "chapter") {
      return (
        <>
          {intros.translated && !intros.translated[id] ? <p className="pe-hint">{t("fa.introEnglish")}</p> : null}
          <HelpMarkdownView content={intros[id]} />
        </>
      );
    }
    if (id === "passage") {
      return (
        <>
          <p className="pe-hint">{t(hasAround && wholeChapter ? "fa.chapterHint" : "fa.passageHint")}</p>
          {hasAround ? (
            <div className="pe-seg fam-scope" role="radiogroup" aria-label={t("fa.scope")}>
              <button type="button" role="radio" aria-checked={wholeChapter} className="pe-seg__opt" onClick={() => setWholeChapter(true)}>
                {t("fa.wholeChapter").replace("{n}", String(range.chapter))}
              </button>
              <button type="button" role="radio" aria-checked={!wholeChapter} className="pe-seg__opt" onClick={() => setWholeChapter(false)}>
                {t("fa.onlyPassage")}
              </button>
            </div>
          ) : null}
          <div className="fam-texts">
            <Text title={t("se.ultEnglish")} range={range} chapter={hasAround && wholeChapter ? chapterRange : null} pane={ult} />
            <Text title={t("se.ustEnglish")} range={range} chapter={hasAround && wholeChapter ? chapterRange : null} pane={ust} />
          </div>
        </>
      );
    }
    return (
      <>
        {notes.source === "en" ? <p className="pe-hint">{t("fa.enFallback")}</p> : null}
        {byVerse.map(([verse, rows]) => (
          <div key={verse} className="fam-verse">
            <p className="fam-verse__ref">{/^\d+$/.test(verse) ? `${range.chapter}:${verse}` : verse}</p>
            <ul className="fam-notes">
              {rows.map((note) => (
                <li key={note.id}>
                  <p className="fam-notes__quote">{note.title}</p>
                  {note.body && note.body !== note.title ? (
                    <div className="fam-notes__body">
                      <HelpMarkdownView content={note.body} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </>
    );
  }

  const title = (id: SectionId) => (id === "chapter" && range ? t("fa.chapterIntro").replace("{n}", String(range.chapter)) : id === "notes" ? `${t("fa.notesTitle")} (${notes.notes.length})` : t(SECTION_TITLE[id]));
  const passageName = ctx ? `${bookLabel(ctx.book, language)} ${ctx.ref}` : t("fa.title");

  return (
    <div className="scripture-editor fam">
      <header className="scripture-editor__head">
        <div className="min-w-0">
          <p className="scripture-editor__kicker">{t("fa.kicker")}</p>
          <h1 className="scripture-editor__title">{passageName}</h1>
          <p className="scripture-editor__meta">
            {ctx?.taskName ? localizeName(ctx.taskName, language) : ""}
            {sections.length && !busy ? ` · ${t("fa.progress").replace("{done}", String(readCount)).replace("{total}", String(sections.length))}` : ""}
          </p>
        </div>
        <div className="scripture-editor__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("se.close")}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{localizeThread(error, language)}</AlertDescription>
        </Alert>
      ) : null}
      {!loggedIn && ctx ? (
        <Alert className="mx-4 mt-3">
          <AlertDescription>{t("fa.loginAll")}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">{t("fa.loading")}</p>
      ) : loggedIn && range ? (
        <div className="fam__body" aria-label={t("fa.readAria")}>
          {done ? <p className="fam__done">{t("fa.alreadyDone")}</p> : <p className="fam__lede">{t("fa.lede")}</p>}
          <ol className="fam__sections">
            {sections.map((id, index) => {
              const isOpen = open === id;
              const readIt = isRead(id);
              return (
                <li
                  key={id}
                  className="fam-section"
                  data-read={readIt ? "true" : undefined}
                  ref={(node) => {
                    refs.current[id] = node;
                  }}
                >
                  <button type="button" className="fam-section__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                    <span className="fam-section__n" aria-hidden>
                      {readIt ? <Check size={14} /> : index + 1}
                    </span>
                    <span className="fam-section__title">{title(id)}</span>
                    <span className="fam-section__state">{readIt ? t("fa.read") : ""}</span>
                    {isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                  </button>
                  {isOpen ? (
                    <div className="fam-section__body">
                      {body(id)}
                      {!readIt ? (
                        <Button type="button" className="justify-self-start" onClick={() => read(id)}>
                          <Check size={16} aria-hidden /> {t(sections.slice(index + 1).some((row) => !isRead(row)) ? "fa.readNext" : "fa.readLast")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {ctx?.projectId && ctx.pmOrg && loadSession() ? (
            <section className="fam-notes-box">
              <h2 className="fam-notes-box__title">{t("sn.title")}</h2>
              <p className="pe-hint">{t("sn.lede")}</p>
              <StudyNotesPanel session={loadSession()!} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={ctx.book} chapter={range.chapter} from={range.from} to={range.to} />
            </section>
          ) : null}

          {ctx?.issueNumber ? (
            <section className="fam-doubt">
              <label className="pe-label" htmlFor="fam-doubt">
                {t("fa.doubtTitle")}
              </label>
              <p className="pe-hint">{t("fa.doubtHint")}</p>
              <textarea id="fam-doubt" className="af-textarea" rows={3} value={doubt} placeholder={t("fa.doubtPlaceholder")} onChange={(e) => setDoubt(e.target.value)} />
              <div className="fam-doubt__row">
                <Button type="button" size="sm" variant="outline" disabled={sending || !doubt.trim()} onClick={() => void sendDoubt()}>
                  {sending ? t("wf.saving") : t("fa.doubtSend")}
                </Button>
                {doubtSent ? <span className="af-saved">{t("fa.doubtSent")}</span> : null}
              </div>
            </section>
          ) : null}

          <div className="fam__finish">
            <p>{done ? t("fa.alreadyDone") : allRead ? t("fa.readyToFinish") : t("fa.leftToRead").replace("{n}", String(sections.length - readCount))}</p>
            {done ? (
              <Button type="button" onClick={onClose}>
                {t("fa.back")}
              </Button>
            ) : (
              <Button type="button" disabled={!allRead || finishing} onClick={() => void finish()}>
                {finishing ? t("wf.saving") : t("fa.finish")}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
