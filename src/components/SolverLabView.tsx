import { useEffect, useMemo, useState } from "react";
import type { GtSession } from "../dcs/auth";
import { listPmProjects, loadAssignmentsFromDcs } from "../dcs/persist";
import { BOOKS, bookName } from "../domain/books";
import type { LanguageOption } from "../domain/languages";
import { localized, shippedStepTool } from "../domain/processes";
import {
  buildLabSolverLaunchContext,
  defaultResourceForSolver,
  isProtectedContentOrg,
  labWriteDecision,
  openLabSolver,
  opensForTrial,
  solverNeedsRealIssue,
  trialLaunchContext,
} from "../domain/solverLab";
import {
  resolveSolverLaunchUrl,
  solverLaunchBlockReason,
} from "../domain/solverLaunch";
import { DEFAULT_SOLVERS_CATALOG, findSolverApp, isUrlSolver } from "../domain/solvers";
import { SCOPE_KEYS, SCOPE_LABEL, type AssignmentsDoc, type ProjectIndexEntry, type ProjectTask, type ScopeKey, type TaskStep } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LanguagePicker } from "./LanguagePicker";

type Props = {
  username: string;
  lang: string;
  languages?: LanguageOption[];
  announce: (msg: string) => void;
  /** Who is signed in, and the organizations of the workspace: what the steps of its projects are read with. */
  session?: GtSession;
  pmOrg?: string;
  contentOrg?: string;
};

const QUICK_BOOKS = ["NEH", "TIT"] as const;

export function SolverLabView({ username, lang: workspaceLang, languages, announce, session, pmOrg: workspacePmOrg = "", contentOrg: workspaceContentOrg = "" }: Props) {
  const t = useT();
  const language = useUiLanguage();
  /**
   * The steps of a project, each to be opened to try. The tools below open with a made-up portion and no task, and
   * a screen that works by the step it is opened for (its questions, its texts) had nothing to show that way.
   */
  const [projects, setProjects] = useState<ProjectIndexEntry[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [tryBoard, setTryBoard] = useState<AssignmentsDoc | null>(null);
  const [tryChapter, setTryChapter] = useState("1");
  const [tryBusy, setTryBusy] = useState(false);
  useEffect(() => {
    if (!session?.token || !workspacePmOrg) return;
    let live = true;
    void listPmProjects(session, workspacePmOrg, workspaceLang || "es-419")
      .catch(() => [])
      .then((list) => {
        if (!live) return;
        setProjects(list);
        setProjectId((was) => was || list[0]?.projectId || "");
      });
    return () => {
      live = false;
    };
  }, [session?.token, workspacePmOrg, workspaceLang]);
  useEffect(() => {
    if (!session?.token || !projectId) return setTryBoard(null);
    let live = true;
    setTryBusy(true);
    void loadAssignmentsFromDcs(session, workspacePmOrg, workspaceLang || "es-419", projectId, workspaceContentOrg)
      .catch(() => null)
      .then((board) => {
        if (!live) return;
        setTryBoard(board);
        setTryBusy(false);
      });
    return () => {
      live = false;
    };
  }, [session?.token, projectId, workspacePmOrg, workspaceContentOrg, workspaceLang]);

  /** The tool of a step: the project's, or the one the process gives that step now (see `shippedStepTool`). */
  const toolOf = (task: ProjectTask, step: TaskStep) => findSolverApp(DEFAULT_SOLVERS_CATALOG, step.solverAppId || shippedStepTool(task.id, step.id));

  function tryStep(task: ProjectTask, step: TaskStep) {
    const tool = toolOf(task, step);
    if (!tool || !opensForTrial(tool)) return;
    const base = buildLabSolverLaunchContext({ username, lang: workspaceLang || "es-419", book: projectId, chapter: Number(tryChapter) || 1, verseFrom: 1, verseTo: 1, resource: task.rules[0]?.resource ?? "tpl", contentOrg: workspaceContentOrg, pmOrg: workspacePmOrg });
    const url = resolveSolverLaunchUrl(tool, trialLaunchContext({ base, task, step, chapter: Number(tryChapter) || 1 }));
    if (url) openLabSolver(tool, url);
  }

  const [solverId, setSolverId] = useState(DEFAULT_SOLVERS_CATALOG.solvers[0]?.id ?? "");
  const [lang, setLang] = useState(workspaceLang || "es-419");
  const [book, setBook] = useState("NEH");
  const [chapter, setChapter] = useState("1");
  const [verseFrom, setVerseFrom] = useState("10");
  const [verseTo, setVerseTo] = useState("11");
  const [resource, setResource] = useState("tpl");
  const [contentOrg, setContentOrg] = useState("");
  const [pmOrg, setPmOrg] = useState("");
  const [allowWrite, setAllowWrite] = useState(false);
  const [unsafeWrite, setUnsafeWrite] = useState(false);
  const [error, setError] = useState("");

  const app = useMemo(
    () => DEFAULT_SOLVERS_CATALOG.solvers.find((s) => s.id === solverId),
    [solverId],
  );

  const ctx = useMemo(
    () =>
      buildLabSolverLaunchContext({
        username,
        lang,
        book,
        chapter: Number(chapter) || 0,
        verseFrom: Number(verseFrom) || 1,
        verseTo: Number(verseTo) || Number(verseFrom) || 1,
        resource,
        contentOrg,
        pmOrg,
        allowWrite,
        unsafeWrite,
      }),
    [username, lang, book, chapter, verseFrom, verseTo, resource, contentOrg, pmOrg, allowWrite, unsafeWrite],
  );

  const write = labWriteDecision(ctx);
  const protectedOrg = isProtectedContentOrg(contentOrg);
  const launchUrl = app ? resolveSolverLaunchUrl(app, ctx) : "";
  const launchBlock = app ? solverLaunchBlockReason(app, ctx) : "Elige una herramienta.";
  const needsIssue = app ? solverNeedsRealIssue(app) : false;

  function pickSolver(id: string) {
    setSolverId(id);
    const next = DEFAULT_SOLVERS_CATALOG.solvers.find((s) => s.id === id);
    if (next) setResource(defaultResourceForSolver(next));
    setError("");
  }

  function open() {
    if (!app) {
      setError("Elige una herramienta.");
      return;
    }
    if (needsIssue) {
      setError(
        "La revisión en pares o grupal necesita una subtarea real (issue). El laboratorio no crea issues.",
      );
      return;
    }
    const reason = solverLaunchBlockReason(app, ctx);
    if (reason) {
      setError(reason);
      return;
    }
    const url = resolveSolverLaunchUrl(app, ctx);
    if (!url) {
      setError("No se pudo armar la URL de lanzamiento.");
      return;
    }
    setError("");
    openLabSolver(app, url);
    announce(
      isUrlSolver(app)
        ? `Abriendo estudio: ${ctx.book} ${ctx.ref}`
        : `Abriendo «${app.name}» en modo laboratorio (${ctx.book} ${ctx.ref}).`,
    );
  }

  return (
    <div className="solver-lab">
      <header className="solver-lab__head">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Prueba de herramientas
          </p>
          <h1 className="solver-lab__title">Laboratorio</h1>
          <p className="text-sm text-muted-foreground">
            Abre TPL, TPS, ayudas o Estudiar con un contexto de lanzamiento. No se
            crea ninguna subtarea, issue ni orden de trabajo.
          </p>
        </div>
        <Badge variant="outline">Sin Entregar</Badge>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("lab.tryTitle")}</CardTitle>
          <CardDescription>{t("lab.tryLede")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!session?.token ? (
            <p className="text-sm text-muted-foreground">{t("lab.tryNoSession")}</p>
          ) : projects && !projects.length ? (
            <p className="text-sm text-muted-foreground">{t("lab.tryNoProjects")}</p>
          ) : (
            <div className="solver-lab__try">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="lab-try-project">{t("lab.tryProject")}</Label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger id="lab-try-project" className="w-full" aria-label={t("lab.tryProject")}>
                      <SelectValue placeholder={t("lab.tryProject")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects ?? []).map((project) => (
                        <SelectItem key={project.projectId} value={project.projectId}>
                          {project.title || project.projectId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="lab-try-chapter">{t("lab.tryChapter")}</Label>
                  <Input id="lab-try-chapter" inputMode="numeric" value={tryChapter} onChange={(e) => setTryChapter(e.target.value)} />
                </div>
              </div>
              {tryBusy || !projects ? <p className="text-sm text-muted-foreground">{t("lab.tryLoading")}</p> : null}
              {tryBoard ? (
                <ul className="solver-lab__tasks">
                  {tryBoard.teams
                    .filter((task) => task.steps?.length)
                    .map((task) => (
                      <li key={task.id}>
                        <b>{localized(task.name, task.names, language)}</b>
                        <ul className="solver-lab__steps">
                          {task.steps!.map((step) => {
                            const tool = toolOf(task, step);
                            const name = localized(step.name, step.names, language);
                            return (
                              <li key={step.id}>
                                {tool && opensForTrial(tool) ? (
                                  <button type="button" className="btn" data-variant="outline" data-size="default" onClick={() => tryStep(task, step)}>
                                    {name}
                                  </button>
                                ) : (
                                  <span className="solver-lab__off">
                                    {name} · {t(tool ? "lab.tryWrites" : "lab.tryNoScreen")}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conflicto de versículo</CardTitle>
          <CardDescription>
            Tarea ficticia (NEH 1:10–11 · TPL) donde dos personas escribieron 1:10 distinto. Todo
            ocurre en este navegador: sin inventario, sin issues y sin escribir en Door43.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a className="btn" data-size="default" data-variant="default" href="#/mis-tareas/prueba">
            Probar un conflicto
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Herramienta</CardTitle>
          <CardDescription>
            Mismo catálogo que Mis tareas. Familiarizar abre TranslationCore Study
            (solo lectura).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChoiceGroup
            name="solver-lab-app"
            label="Solver"
            value={solverId}
            onChange={pickSolver}
            options={DEFAULT_SOLVERS_CATALOG.solvers.map((solver) => ({
              value: solver.id,
              label: solver.name,
              description: solver.description || solver.id,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Porción</CardTitle>
          <CardDescription>
            Libro, capítulo y versículos — p. ej. Nehemías 1:10–11.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="lab-lang">Lengua</Label>
              <LanguagePicker
                id="lab-lang"
                value={lang}
                onChange={setLang}
                languages={languages}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lab-book">Libro</Label>
              <Select value={book} onValueChange={setBook}>
                <SelectTrigger id="lab-book" className="w-full" aria-label="Libro">
                  <SelectValue placeholder="Libro" />
                </SelectTrigger>
                <SelectContent>
                  {QUICK_BOOKS.map((code) => (
                    <SelectItem key={`quick-${code}`} value={code}>
                      {bookName(code)} ({code})
                    </SelectItem>
                  ))}
                  {BOOKS.filter((b) => !QUICK_BOOKS.includes(b.code as (typeof QUICK_BOOKS)[number])).map(
                    (b) => (
                      <SelectItem key={b.code} value={b.code}>
                        {b.name} ({b.code})
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lab-chapter">Capítulo</Label>
              <Input
                id="lab-chapter"
                inputMode="numeric"
                value={chapter}
                onChange={(e) => setChapter(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lab-from">Versículo desde</Label>
              <Input
                id="lab-from"
                inputMode="numeric"
                value={verseFrom}
                onChange={(e) => setVerseFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lab-to">Versículo hasta</Label>
              <Input
                id="lab-to"
                inputMode="numeric"
                value={verseTo}
                onChange={(e) => setVerseTo(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="lab-resource">Recurso</Label>
              <Select value={resource} onValueChange={setResource}>
                <SelectTrigger id="lab-resource" className="w-full" aria-label="Recurso">
                  <SelectValue placeholder="Recurso" />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {SCOPE_LABEL[key as ScopeKey]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Destino DCS (opcional)</CardTitle>
          <CardDescription>
            Vacío = solo borrador local / USFM de prueba. No se usa{" "}
            <code>es-419_gl</code> por defecto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="lab-content-org">Org de contenido</Label>
              <Input
                id="lab-content-org"
                value={contentOrg}
                onChange={(e) => setContentOrg(e.target.value.trim())}
                placeholder="org de prueba, no es-419_gl"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lab-pm-org">Org PM</Label>
              <Input
                id="lab-pm-org"
                value={pmOrg}
                onChange={(e) => setPmOrg(e.target.value.trim())}
                placeholder="opcional"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <Checkbox
              checked={allowWrite}
              onCheckedChange={setAllowWrite}
              aria-label="Permitir escritura DCS"
            />
            <span>
              Permitir guardar borradores en Door43 (solo org de prueba).
            </span>
          </label>
          {allowWrite && protectedOrg ? (
            <label className="mt-2 flex items-start gap-2 text-sm text-destructive">
              <Checkbox
                checked={unsafeWrite}
                onCheckedChange={setUnsafeWrite}
                aria-label="Escritura insegura en org de producción"
              />
              <span>
                Escritura insegura: «{contentOrg}» parece de producción. No
                guardes borradores en el GL real salvo que lo confirmes.
              </span>
            </label>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">{writeReason(write)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lanzamiento</CardTitle>
          <CardDescription>
            {ctx.book} {ctx.ref} · {(ctx.resource || "—").toUpperCase()}
            {username ? ` · @${username}` : " · sin sesión"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {needsIssue ? (
            <Alert variant="destructive">
              <AlertDescription>
                Esta herramienta exige un issue de subtarea. El laboratorio no lo
                crea.
              </AlertDescription>
            </Alert>
          ) : launchBlock ? (
            <p className="text-sm text-muted-foreground">{launchBlock}</p>
          ) : (
            <p className="solver-lab__url" title={launchUrl}>
              {launchUrl}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            disabled={!app || needsIssue || Boolean(launchBlock)}
            onClick={open}
          >
            Abrir
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function writeReason(write: ReturnType<typeof labWriteDecision>): string {
  if (write.mode === "dcs") {
    return "Escritura DCS permitida para esta org de prueba (o confirmada como insegura).";
  }
  return write.reason;
}
