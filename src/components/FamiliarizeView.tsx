import { useCallback, useEffect, useState } from "react";
import { loadSession } from "../dcs/auth";
import { loadPmConfig } from "../dcs/issues";
import {
  loadFamiliarizeSeen,
  markFamiliarizeSeen,
  unmarkFamiliarizeSeen,
} from "../domain/familiarizeCache";
import { fuenteItem } from "../domain/familiarizeItems";
import {
  decodeSolverLaunchContext,
  type SolverLaunchContext,
} from "../domain/solverLaunch";
import { portionRange, type RefRange } from "../domain/usfmEdit";
import { extractDraftVerses, type VerseTextMap } from "../domain/usfmAst";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import {
  englishScriptureKindRef,
  loadEnglishScriptureKindUsfm,
  loadIntroNotes,
  loadNotesForRange,
  type EnglishScriptureRef,
  type NotesLoadResult,
} from "../domain/referenceResources";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UsfmReferencePane } from "./UsfmReferencePane";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { tNow, useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { localizeName } from "../domain/templateNames";
import { explainError } from "../dcs/userError";

type Props = {
  ctxEncoded: string;
  onClose: () => void;
};

type ScripturePane = {
  usfm: string;
  verses: VerseTextMap;
  meta: EnglishScriptureRef | null;
};

const EMPTY_SCRIPTURE: ScripturePane = { usfm: "", verses: {}, meta: null };

const EMPTY_NOTES: NotesLoadResult = {
  notes: [],
  source: "none",
  owner: "",
  repo: "",
  filepath: "",
  label: "Notas",
};

function VistoToggle({
  seen,
  onToggle,
}: {
  seen: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <Button
      type="button"
      size="sm"
      variant={seen ? "secondary" : "outline"}
      onClick={onToggle}
    >
      {seen ? t("fa.seen") : t("fa.markSeen")}
    </Button>
  );
}

function ScriptureCard({
  kicker,
  title,
  range,
  pane,
  loggedIn,
  loginHint,
}: {
  kicker: string;
  title: string;
  range: RefRange | null;
  pane: ScripturePane;
  loggedIn: boolean;
  loginHint: string;
}) {
  const t = useT();
  const hasText = Boolean(pane.usfm.trim() || Object.keys(pane.verses).length);
  return (
    <section className="scripture-editor__ref-card">
      <p className="scripture-editor__kicker">{kicker}</p>
      <h2 className="scripture-editor__ref-title">{pane.meta?.label || title}</h2>
      {!loggedIn ? (
        <p className="text-sm text-muted-foreground">{loginHint}</p>
      ) : hasText && range ? (
        <UsfmReferencePane
          usfm={pane.usfm}
          range={range}
          label={pane.meta?.label || title}
          fallbackVerses={pane.verses}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("fa.loadFailed").replace("{what}", pane.meta?.short || title)}
        </p>
      )}
    </section>
  );
}

export function FamiliarizeView({ ctxEncoded, onClose }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [range, setRange] = useState<RefRange | null>(null);
  const [ult, setUlt] = useState<ScripturePane>(EMPTY_SCRIPTURE);
  const [ust, setUst] = useState<ScripturePane>(EMPTY_SCRIPTURE);
  const [notes, setNotes] = useState<NotesLoadResult>(EMPTY_NOTES);
  const [intros, setIntros] = useState<{ book: string; chapter: string }>({ book: "", chapter: "" });
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      setUlt(EMPTY_SCRIPTURE);
      setUst(EMPTY_SCRIPTURE);
      setNotes(EMPTY_NOTES);
      setError("");
      return;
    }

    setLoggedIn(true);
    setBusy(true);
    setError("");
    try {
      let pmConfig = DEFAULT_PM_CONFIG;
      if (decoded.pmOrg) {
        try {
          pmConfig = await loadPmConfig(sess, decoded.pmOrg);
        } catch {
          pmConfig = DEFAULT_PM_CONFIG;
        }
      }

      const [ultLoaded, ustLoaded, notesLoaded, introsLoaded] = await Promise.all([
        loadEnglishScriptureKindUsfm(sess, "ult", decoded.book),
        loadEnglishScriptureKindUsfm(sess, "ust", decoded.book),
        loadNotesForRange(sess, decoded, refRange, pmConfig),
        loadIntroNotes(sess, decoded.book, refRange.chapter),
      ]);
      setIntros(introsLoaded);

      setUlt(
        ultLoaded
          ? {
              usfm: ultLoaded.usfm,
              verses: extractDraftVerses(ultLoaded.usfm, refRange).verses,
              meta: ultLoaded.meta,
            }
          : { ...EMPTY_SCRIPTURE, meta: englishScriptureKindRef("ult", decoded.book) },
      );
      setUst(
        ustLoaded
          ? {
              usfm: ustLoaded.usfm,
              verses: extractDraftVerses(ustLoaded.usfm, refRange).verses,
              meta: ustLoaded.meta,
            }
          : { ...EMPTY_SCRIPTURE, meta: englishScriptureKindRef("ust", decoded.book) },
      );
      setNotes(notesLoaded);

      if (!ultLoaded && !ustLoaded && notesLoaded.source === "none") {
        setError(tNow("fa.nothingLoaded"));
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded]);

  useEffect(() => {
    void load();
  }, [load]);

  const fuente = ctx ? fuenteItem(ctx) : null;
  const alreadySeen = Boolean(fuente && seen.has(fuente.id));

  function toggleSeen() {
    if (!ctx?.username || !ctx.lang || !fuente) return;
    const next = seen.has(fuente.id)
      ? unmarkFamiliarizeSeen(ctx.username, ctx.lang, fuente.id)
      : markFamiliarizeSeen(ctx.username, ctx.lang, fuente.id);
    setSeen(new Set(next));
  }

  return (
    <div className="scripture-editor scripture-editor--familiarize">
      <header className="scripture-editor__head">
        <div className="min-w-0">
          <p className="scripture-editor__kicker">{t("fa.kicker")}</p>
          <h1 className="scripture-editor__title">
            {ctx ? `${ctx.book} ${ctx.ref}` : t("fa.title")}
          </h1>
          <p className="scripture-editor__meta">
            {ctx?.taskName ? `${localizeName(ctx.taskName, language)} · ` : ""}
            {ctx?.resourceName || (ctx?.resource ? ctx.resource.toUpperCase() : "")}
            {ctx?.issueNumber ? ` · #${ctx.issueNumber}` : ""}
            {t("fa.metaTail")}
          </p>
        </div>
        <div className="scripture-editor__actions">
          {fuente ? (
            <VistoToggle seen={alreadySeen} onToggle={toggleSeen} />
          ) : null}
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
          <AlertDescription>
            {t("fa.loginAll")}
          </AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">{t("fa.loading")}</p>
      ) : (
        <div
          className="scripture-editor__workspace"
          aria-label={t("fa.readAria")}
        >
          {intros.book || intros.chapter ? (
            <section className="scripture-editor__ref-card">
              <p className="scripture-editor__kicker">{t("fa.introsTitle")}</p>
              <p className="scripture-editor__hint">{t("fa.introsLede")}</p>
              {intros.book ? (
                <details className="fam-intro">
                  <summary>{t("fa.bookIntro")}</summary>
                  <HelpMarkdownView content={intros.book} />
                </details>
              ) : null}
              {intros.chapter && range ? (
                <details className="fam-intro" open>
                  <summary>{t("fa.chapterIntro").replace("{n}", String(range.chapter))}</summary>
                  <HelpMarkdownView content={intros.chapter} />
                </details>
              ) : null}
              {ctx && range ? (
                <a
                  className="fam-intro__link"
                  href={`https://study.translationcore.com/read/en/bible/chapter/${encodeURIComponent(`${ctx.book.toLowerCase()} ${range.chapter}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("fa.readChapter")}
                </a>
              ) : null}
            </section>
          ) : null}
          <ScriptureCard
            kicker={t("fa.literal")}
            title={t("se.ultEnglish")}
            range={range}
            pane={ult}
            loggedIn={loggedIn}
            loginHint={t("fa.loginUlt")}
          />
          <ScriptureCard
            kicker={t("fa.simple")}
            title={t("se.ustEnglish")}
            range={range}
            pane={ust}
            loggedIn={loggedIn}
            loginHint={t("fa.loginUst")}
          />
          <section className="scripture-editor__ref-card">
            <p className="scripture-editor__kicker">{t("fa.notes")}</p>
            <h2 className="scripture-editor__ref-title">
              {notes.label ? localizeThread(notes.label, language) : t("fa.notesTitle")}
            </h2>
            {notes.source === "en" ? (
              <p className="text-xs text-muted-foreground">
                {t("fa.enFallback")}
              </p>
            ) : null}
            {!loggedIn ? (
              <p className="text-sm text-muted-foreground">
                {t("fa.loginNotes")}
              </p>
            ) : notes.notes.length ? (
              <ul className="scripture-editor__help-list">
                {notes.notes.map((item) => (
                  <li key={item.id} className="scripture-editor__help-item">
                    <div className="scripture-editor__help-meta">
                      <Badge variant="outline">{t("se.kindNote")}</Badge>
                      {item.ref ? (
                        <span className="text-xs text-muted-foreground">{item.ref}</span>
                      ) : null}
                    </div>
                    <p className="scripture-editor__help-title">{item.title}</p>
                    {item.body && item.body !== item.title ? (
                      <p className="scripture-editor__help-body">{item.body}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("fa.noNotes")}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
