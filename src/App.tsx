import { useCallback, useEffect, useState } from "react";
import type { DcsOrg } from "@ip-lms/dcs-client";
import { defaultContentOrg } from "./domain/books";
import type { AssignmentsDoc, InventoryDoc } from "./domain/types";
import {
  emptyAssignments,
  isInventoryDoc,
  loadContext,
  loadLocalAssignments,
  normalizeAssignmentsDoc,
  normalizeInventory,
  persistSessionInventory,
  restoreSessionInventory,
  saveContext,
  saveLocalAssignments,
} from "./domain/store";
import { loadSession, signOut, type GtSession } from "./dcs/auth";
import { PRODUCTION_HOST } from "./dcs/config";
import {
  listUserOrgs,
  loadAssignmentsFromDcs,
  loadInventoryFromDcs,
  loadTeamsFromDcs,
} from "./dcs/persist";
import { checkWorker, pollJob, startJob } from "./worker/client";
import { SignInModal } from "./components/SignIn";
import { ContextView } from "./components/ContextView";
import { InventoryView } from "./components/InventoryView";
import { TeamsView } from "./components/TeamsView";
import { AssignView } from "./components/AssignView";
import { PublishView } from "./components/PublishView";
import { StepNav, stepEnabled, type StepId } from "./components/StepNav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CONTEXT_CONFIRMED_KEY = "gt-context-confirmed";

function hostShort(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host.replace(/^https?:\/\//, "");
  }
}

function readContextConfirmed(): boolean {
  try {
    return localStorage.getItem(CONTEXT_CONFIRMED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeContextConfirmed(): void {
  try {
    localStorage.setItem(CONTEXT_CONFIRMED_KEY, "1");
  } catch {
    /* quota */
  }
}

function initialStep(hasInventory: boolean): StepId {
  const confirmed = readContextConfirmed() || hasInventory;
  if (!confirmed) return "contexto";
  if (hasInventory) return "asignar";
  return "inventario";
}

export function App() {
  const saved = loadContext();
  const [host, setHost] = useState(saved?.host || PRODUCTION_HOST);
  const [lang, setLang] = useState(saved?.lang || "es-419");
  const [contentOrg, setContentOrg] = useState(saved?.contentOrg || defaultContentOrg("es-419"));
  const [pmOrg, setPmOrg] = useState(saved?.pmOrg || "");
  const [book, setBook] = useState(saved?.book || "NEH");
  const [session, setSession] = useState<GtSession | null>(() => loadSession() ?? null);
  const [orgs, setOrgs] = useState<DcsOrg[]>([]);
  const [inventory, setInventory] = useState<InventoryDoc | null>(() => restoreSessionInventory());
  const [board, setBoard] = useState<AssignmentsDoc>(() =>
    loadLocalAssignments(
      saved?.lang || "es-419",
      saved?.book || "NEH",
      saved?.contentOrg || defaultContentOrg("es-419"),
      saved?.pmOrg || "",
    ),
  );
  const [view, setView] = useState<StepId>(() => initialStep(Boolean(restoreSessionInventory())));
  const [contextConfirmed, setContextConfirmed] = useState(
    () => readContextConfirmed() || Boolean(restoreSessionInventory()),
  );
  const [workerOnline, setWorkerOnline] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [jobMessage, setJobMessage] = useState("");
  const [live, setLive] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);

  const announce = useCallback((msg: string) => setLive(msg), []);

  useEffect(() => {
    if (!live) return;
    const id = window.setTimeout(() => setLive(""), 4500);
    return () => window.clearTimeout(id);
  }, [live]);

  useEffect(() => {
    saveContext({ lang, contentOrg, pmOrg, book, host });
  }, [lang, contentOrg, pmOrg, book, host]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    void checkWorker().then(setWorkerOnline);
    const id = window.setInterval(() => {
      void checkWorker().then(setWorkerOnline);
    }, 8000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!session) {
      setOrgs([]);
      return;
    }
    void listUserOrgs(session)
      .then((list) => {
        setOrgs(list);
        if (!pmOrg && list.length) setPmOrg(list[0].name);
      })
      .catch(() => setOrgs([]));
  }, [session, pmOrg]);

  function goTo(id: StepId) {
    if (stepEnabled(id, contextConfirmed, Boolean(inventory))) setView(id);
  }

  function confirmContext() {
    writeContextConfirmed();
    setContextConfirmed(true);
    const ready = inventory && inventory.book === book;
    setView(ready ? "asignar" : "inventario");
  }

  function applyInventory(doc: InventoryDoc, land: StepId = "asignar") {
    const normalized = normalizeInventory({
      ...doc,
      lang: doc.lang || lang,
      contentOrg: doc.contentOrg || contentOrg,
    });
    setInventory(normalized);
    persistSessionInventory(normalized);
    if (normalized.book !== book) setBook(normalized.book);
    const nextBoard = loadLocalAssignments(lang, normalized.book, contentOrg, pmOrg);
    setBoard({
      ...nextBoard,
      book: normalized.book,
      lang,
      contentOrg,
      pmOrg,
    });
    if (!contextConfirmed) {
      writeContextConfirmed();
      setContextConfirmed(true);
    }
    setView(land);
    announce(
      `Inventario ${normalized.book}: ${normalized.portions.length} porciones, ${normalized.articles.length} artículos.`,
    );
  }

  function updateBoard(next: AssignmentsDoc) {
    const doc = {
      ...next,
      book,
      lang,
      contentOrg,
      pmOrg,
    };
    setBoard(doc);
    saveLocalAssignments(doc);
  }

  async function generate() {
    setGenerating(true);
    setJobMessage("Encolando…");
    try {
      const online = await checkWorker();
      setWorkerOnline(online);
      if (!online) {
        throw new Error("Worker no disponible. Arranca `npm run worker` o carga un JSON.");
      }
      const { id } = await startJob({ book, lang, contentOrg });
      const result = await pollJob(id, (job) => {
        setJobMessage(job.message || job.step || job.status);
      });
      applyInventory(result, result.articles.length ? "asignar" : "inventario");
      setJobMessage("Listo.");
    } catch (err) {
      setJobMessage("");
      announce(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  function onLoadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        if (!isInventoryDoc(parsed)) throw new Error("JSON de inventario inválido.");
        applyInventory(normalizeInventory(parsed));
      } catch (err) {
        announce(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
  }

  async function onLoadSnapshot() {
    try {
      const res = await fetch("/data/neh-status.json");
      if (!res.ok) throw new Error("No se encontró la instantánea NEH.");
      const parsed: unknown = await res.json();
      if (!isInventoryDoc(parsed)) throw new Error("Instantánea inválida.");
      applyInventory(normalizeInventory(parsed));
    } catch (err) {
      announce(err instanceof Error ? err.message : String(err));
    }
  }

  async function openFromDcs() {
    if (!session || !pmOrg) {
      announce("Inicia sesión y elige la organización PM en Contexto.");
      return;
    }
    try {
      const inv = await loadInventoryFromDcs(session, pmOrg, lang, book);
      const asg = await loadAssignmentsFromDcs(session, pmOrg, lang, book, contentOrg);
      const teams = await loadTeamsFromDcs(session, pmOrg, lang);
      if (inv) applyInventory(inv, "asignar");
      if (asg || teams) {
        const base = asg ?? emptyAssignments(book, lang, contentOrg, pmOrg);
        const merged = normalizeAssignmentsDoc(
          {
            ...base,
            people: asg?.people?.length ? asg.people : teams?.people ?? base.people,
            teams: asg?.teams?.length ? asg.teams : teams?.teams ?? base.teams,
            assignments: asg?.assignments ?? [],
          },
          { book, lang, contentOrg, pmOrg },
        );
        updateBoard(merged);
        if (!inv) setView("asignar");
        announce(`Cargado desde ${pmOrg}/gateway-tasks.`);
      } else if (!inv) {
        announce("No hay datos guardados para este libro en DCS.");
      }
    } catch (err) {
      announce(err instanceof Error ? err.message : String(err));
    }
  }

  function onBookChange(next: string) {
    const code = next.toUpperCase();
    setBook(code);
    const cached = restoreSessionInventory();
    if (cached && cached.book === code) {
      applyInventory(cached, view === "asignar" ? "asignar" : "inventario");
      return;
    }
    setInventory(null);
    setBoard(loadLocalAssignments(lang, code, contentOrg, pmOrg));
  }

  function onLangChange(next: string) {
    setLang(next);
    setContentOrg(defaultContentOrg(next));
    setBoard(loadLocalAssignments(next, book, defaultContentOrg(next), pmOrg));
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2.5 px-3 py-2.5 sm:px-4">
          <div className="font-heading text-base font-semibold tracking-tight">Gateway Tasks</div>
          {contextConfirmed ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full font-normal"
              title="Editar contexto"
              onClick={() => goTo("contexto")}
            >
              {lang} · {book}
            </Button>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              title={workerOnline ? "Worker en 127.0.0.1:8765" : "Worker no disponible"}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  workerOnline ? "bg-emerald-500" : "bg-red-400",
                )}
              />
              Worker
            </Badge>
            <Badge
              variant="outline"
              title={session ? `${session.username} · ${hostShort(session.host)}` : "Sin sesión DCS"}
            >
              <i className={cn("size-1.5 rounded-full", session ? "bg-emerald-500" : "bg-red-400")} />
              DCS
            </Badge>
            {session ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="Cerrar sesión"
                  onClick={() => {
                    signOut();
                    setSession(null);
                  }}
                >
                  {session.username}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void openFromDcs()}>
                  Abrir DCS
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setSignInOpen(true)}>
                Iniciar sesión
              </Button>
            )}
          </div>
          <div className="basis-full">
            <StepNav
              view={view}
              contextConfirmed={contextConfirmed}
              hasInventory={Boolean(inventory)}
              onChange={goTo}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-4 sm:px-4">
        <div className="sr-only" aria-live="polite">
          {live}
        </div>
        {live ? (
          <Alert className="mb-3">
            <AlertDescription>{live}</AlertDescription>
          </Alert>
        ) : null}

        {view === "contexto" ? (
          <ContextView
            lang={lang}
            contentOrg={contentOrg}
            pmOrg={pmOrg}
            book={book}
            orgs={orgs}
            session={session}
            onLangChange={onLangChange}
            onContentOrgChange={setContentOrg}
            onPmOrgChange={setPmOrg}
            onBookChange={onBookChange}
            onContinue={confirmContext}
            onSignIn={() => setSignInOpen(true)}
          />
        ) : null}

        {view === "inventario" ? (
          <InventoryView
            inventory={inventory}
            jobMessage={jobMessage}
            generating={generating}
            onGenerate={() => void generate()}
            onLoadFile={onLoadFile}
            onLoadSnapshot={() => void onLoadSnapshot()}
          />
        ) : null}

        {view === "equipos" ? (
          <TeamsView
            board={board}
            inventory={inventory}
            onChange={updateBoard}
            session={session}
            pmOrg={pmOrg}
            orgs={orgs}
            onPmOrgChange={setPmOrg}
            announce={announce}
          />
        ) : null}

        {view === "asignar" ? (
          inventory ? (
            <AssignView
              inventory={inventory}
              board={board}
              onChange={updateBoard}
              announce={announce}
              onGoEquipos={() => goTo("equipos")}
            />
          ) : (
            <Alert>
              <AlertDescription>
                El tablero de asignación necesita porciones y artículos del libro.
              </AlertDescription>
            </Alert>
          )
        ) : null}

        {view === "publicar" ? (
          <PublishView
            board={board}
            inventory={inventory}
            session={session}
            pmOrg={pmOrg}
            onImported={updateBoard}
            announce={announce}
          />
        ) : null}
      </main>

      <SignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        host={host}
        onHostChange={setHost}
        onSession={(s) => setSession(s)}
      />
    </div>
  );
}
