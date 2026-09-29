import { useMemo, useState } from "react";
import { BOOKS, bookName, isBookProjectId, normalizeProjectId } from "../domain/books";
import { languageDisplayName, type LanguageOption } from "../domain/languages";
import type { ProjectIndexEntry, ProjectKind } from "../domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CreateProjectInput = {
  projectId: string;
  title: string;
  kind: ProjectKind;
  books: string[];
  /** Custom name for the first phase; empty → "Fase 1". */
  firstPhaseName?: string;
};

type Props = {
  lang: string;
  languages?: LanguageOption[];
  projects: ProjectIndexEntry[];
  currentProjectId: string;
  canManage: boolean;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (input: CreateProjectInput) => void;
};

function slugifyThematic(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function ProjectsView({
  lang,
  languages,
  projects,
  currentProjectId,
  canManage,
  onOpenProject,
  onCreateProject,
}: Props) {
  const [kind, setKind] = useState<ProjectKind>("book");
  const [bookCode, setBookCode] = useState("NEH");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [selectedBooks, setSelectedBooks] = useState<string[]>(["GEN", "EXO"]);
  const [firstPhaseName, setFirstPhaseName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const list = useMemo(() => {
    if (projects.length) return projects;
    if (currentProjectId) {
      return [
        {
          projectId: currentProjectId,
          title: bookName(currentProjectId) || currentProjectId,
          kind: (isBookProjectId(currentProjectId) ? "book" : "thematic") as ProjectKind,
          books: isBookProjectId(currentProjectId) ? [currentProjectId] : [],
        },
      ];
    }
    return [];
  }, [projects, currentProjectId]);

  function toggleBook(code: string) {
    setSelectedBooks((prev) =>
      prev.includes(code) ? prev.filter((b) => b !== code) : [...prev, code],
    );
  }

  function submitCreate() {
    const phaseName = firstPhaseName.trim() || undefined;
    if (kind === "book") {
      const id = normalizeProjectId(bookCode);
      onCreateProject({
        projectId: id,
        title: bookName(id),
        kind: "book",
        books: [id],
        firstPhaseName: phaseName,
      });
      setCreateOpen(false);
      setFirstPhaseName("");
      return;
    }
    const id = normalizeProjectId(slug.trim() || slugifyThematic(title));
    if (!id || !title.trim() || selectedBooks.length < 1) return;
    onCreateProject({
      projectId: id,
      title: title.trim(),
      kind: "thematic",
      books: selectedBooks.map(normalizeProjectId),
      firstPhaseName: phaseName,
    });
    setCreateOpen(false);
    setFirstPhaseName("");
  }

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">Proyectos</h1>
          <p className="hub-lede">
            Tablero de proyectos en {languageDisplayName(lang, languages)}
            {canManage
              ? ". Abre uno para inventariar, definir fases y asignar trabajo."
              : "."}
          </p>
        </div>
        {canManage && !createOpen ? (
          <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
            Nuevo proyecto
          </Button>
        ) : null}
      </div>

      {!list.length ? (
        <div className="hub-empty">
          Aún no hay proyectos.
          {canManage ? " Usa «Nuevo proyecto» para empezar." : ""}
        </div>
      ) : (
        <div className="hub-board" role="list">
          {list.map((project) => {
            const booksLabel =
              project.kind === "book"
                ? project.projectId
                : project.books.length
                  ? project.books.join(", ")
                  : "sin libros";
            return (
              <button
                key={project.projectId}
                type="button"
                role="listitem"
                className="hub-row"
                data-current={project.projectId === currentProjectId ? "true" : "false"}
                onClick={() => onOpenProject(project.projectId)}
                disabled={!canManage}
              >
                <span
                  className="hub-row-strip"
                  data-kind={project.kind}
                  aria-hidden
                />
                <span className="hub-row-body">
                  <span className="hub-row-title">{project.title}</span>
                  <span className="hub-row-meta">
                    <Badge variant="outline">
                      {project.kind === "book" ? "Libro" : "Temático"}
                    </Badge>
                    <span className="font-mono">{project.projectId}</span>
                    <span>{booksLabel}</span>
                  </span>
                </span>
                {canManage ? (
                  <span className="text-xs text-muted-foreground">Abrir →</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {canManage && createOpen ? (
        <div className="hub-panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Crear proyecto</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
          </div>
          <div className="grid gap-1.5">
            <Label>Tipo</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v === "thematic" ? "thematic" : "book")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="book">Libro (id = código UBS)</SelectItem>
                <SelectItem value="thematic">Temático (slug + varios libros)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "book" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="create-book">Libro</Label>
              <Select value={bookCode} onValueChange={setBookCode}>
                <SelectTrigger id="create-book" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {BOOKS.map((b) => (
                    <SelectItem key={b.code} value={b.code}>
                      {b.code} — {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="create-title">Título</Label>
                <Input
                  id="create-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (!slug) setSlug(slugifyThematic(e.target.value));
                  }}
                  placeholder="Pentateuco ronda 1"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="create-slug">Id (slug)</Label>
                <Input
                  id="create-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="pentateuco-r1"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Libros</Label>
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {BOOKS.slice(0, 39).map((b) => (
                    <Button
                      key={b.code}
                      type="button"
                      size="sm"
                      variant={selectedBooks.includes(b.code) ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => toggleBook(b.code)}
                    >
                      {b.code}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="create-phase">Etiqueta de la primera fase</Label>
            <Input
              id="create-phase"
              value={firstPhaseName}
              onChange={(e) => setFirstPhaseName(e.target.value)}
              placeholder="Fase 1"
            />
            <p className="text-xs text-muted-foreground">
              Nombre visible al agrupar tareas (p. ej. Borrador, Revisión). Puedes crear más fases
              después.
            </p>
          </div>
          <div>
            <Button type="button" onClick={submitCreate}>
              Crear y abrir
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
