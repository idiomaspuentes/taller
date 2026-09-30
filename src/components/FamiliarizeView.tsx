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
  loadNotesForRange,
  type EnglishScriptureRef,
  type NotesLoadResult,
} from "../domain/referenceResources";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UsfmReferencePane } from "./UsfmReferencePane";

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
  return (
    <Button
      type="button"
      size="sm"
      variant={seen ? "secondary" : "outline"}
      onClick={onToggle}
    >
      {seen ? "Ya visto" : "Marcar visto"}
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
          No se pudo cargar {pane.meta?.short || title} para esta porción.
        </p>
      )}
    </section>
  );
}

export function FamiliarizeView({ ctxEncoded, onClose }: Props) {
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [range, setRange] = useState<RefRange | null>(null);
  const [ult, setUlt] = useState<ScripturePane>(EMPTY_SCRIPTURE);
  const [ust, setUst] = useState<ScripturePane>(EMPTY_SCRIPTURE);
  const [notes, setNotes] = useState<NotesLoadResult>(EMPTY_NOTES);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError("Contexto de lanzamiento inválido o incompleto.");
      return;
    }
    setCtx(decoded);
    setSeen(loadFamiliarizeSeen(decoded.username, decoded.lang));

    const refRange = portionRange(decoded.ref, decoded.chapter);
    if (!refRange) {
      setError(`No se pudo interpretar la referencia «${decoded.ref}».`);
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

      const [ultLoaded, ustLoaded, notesLoaded] = await Promise.all([
        loadEnglishScriptureKindUsfm(sess, "ult", decoded.book),
        loadEnglishScriptureKindUsfm(sess, "ust", decoded.book),
        loadNotesForRange(sess, decoded, refRange, pmConfig),
      ]);

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
        setError("No se pudieron cargar ULT, UST ni las notas. Revisa tu sesión.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          <p className="scripture-editor__kicker">Familiarizar · solo lectura</p>
          <h1 className="scripture-editor__title">
            {ctx ? `${ctx.book} ${ctx.ref}` : "Familiarizar"}
          </h1>
          <p className="scripture-editor__meta">
            {ctx?.taskName ? `${ctx.taskName} · ` : ""}
            {ctx?.resource ? ctx.resource.toUpperCase() : ""}
            {ctx?.issueNumber ? ` · #${ctx.issueNumber}` : ""}
            {" · ULT · UST · notas"}
          </p>
        </div>
        <div className="scripture-editor__actions">
          {fuente ? (
            <VistoToggle seen={alreadySeen} onToggle={toggleSeen} />
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!loggedIn && ctx ? (
        <Alert className="mx-4 mt-3">
          <AlertDescription>
            Inicia sesión para leer ULT, UST y las notas.
          </AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">Cargando ULT, UST y notas…</p>
      ) : (
        <div
          className="scripture-editor__workspace"
          aria-label="Lectura de la porción"
        >
          <ScriptureCard
            kicker="Literal"
            title="ULT (inglés)"
            range={range}
            pane={ult}
            loggedIn={loggedIn}
            loginHint="Inicia sesión para leer el ULT inglés."
          />
          <ScriptureCard
            kicker="Simple"
            title="UST (inglés)"
            range={range}
            pane={ust}
            loggedIn={loggedIn}
            loginHint="Inicia sesión para leer el UST inglés."
          />
          <section className="scripture-editor__ref-card">
            <p className="scripture-editor__kicker">Notas</p>
            <h2 className="scripture-editor__ref-title">
              {notes.label || "Notas de traducción"}
            </h2>
            {notes.source === "en" ? (
              <p className="text-xs text-muted-foreground">
                Se muestra en_tn porque no hay notas GL en este rango.
              </p>
            ) : null}
            {!loggedIn ? (
              <p className="text-sm text-muted-foreground">
                Inicia sesión para leer las notas TN de esta porción.
              </p>
            ) : notes.notes.length ? (
              <ul className="scripture-editor__help-list">
                {notes.notes.map((item) => (
                  <li key={item.id} className="scripture-editor__help-item">
                    <div className="scripture-editor__help-meta">
                      <Badge variant="outline">Nota</Badge>
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
                No hay notas TN para este rango.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
