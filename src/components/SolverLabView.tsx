import { useMemo, useState } from "react";
import { BOOKS, bookName } from "../domain/books";
import type { LanguageOption } from "../domain/languages";
import {
  buildLabSolverLaunchContext,
  defaultResourceForSolver,
  isProtectedContentOrg,
  labWriteDecision,
  openLabSolver,
  solverNeedsRealIssue,
} from "../domain/solverLab";
import {
  resolveSolverLaunchUrl,
  solverLaunchBlockReason,
} from "../domain/solverLaunch";
import { DEFAULT_SOLVERS_CATALOG, isUrlSolver } from "../domain/solvers";
import { SCOPE_KEYS, SCOPE_LABEL, type ScopeKey } from "../domain/types";
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
};

const QUICK_BOOKS = ["NEH", "TIT"] as const;

export function SolverLabView({ username, lang: workspaceLang, languages, announce }: Props) {
  const [solverId, setSolverId] = useState("tpl-translate");
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
