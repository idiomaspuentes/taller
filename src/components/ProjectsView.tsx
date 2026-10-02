import { useEffect, useMemo, useState } from "react";
import type { NextBookHint } from "../domain/startBook";
import { localizeName } from "../domain/templateNames";
import { BOOKS, bookLabel, bookName, isBookProjectId, normalizeProjectId } from "../domain/books";
import { useT } from "../i18n/messages";
import { StartBookPanel } from "./StartBookPanel";
import { useUiLanguage } from "../i18n/language";
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
  /** The template the project starts from (its phases, tasks and steps); empty = start blank. */
  workflowId?: string;
};

/** A template to start a project from. */
export type ProjectTemplateOption = { id: string; name: string; description?: string; phases?: number; tasks?: number };
type StartBookProps = Parameters<typeof StartBookPanel>[0];

type Props = {
  lang: string;
  languages?: LanguageOption[];
  projects: ProjectIndexEntry[];
  currentProjectId: string;
  canManage: boolean;
  /** Templates a project can start from: the ones shipped with the app and the organization's own. */
  templates: ProjectTemplateOption[];
  onOpenProject: (projectId: string) => void;
  onCreateProject: (input: CreateProjectInput) => void;
  /** Start a book in one action (process, reading the book, saving, subtareas). Absent when not signed in. */
  onStartBook?: StartBookProps["onStart"];
  onOpenStep?: (projectId: string, step: "inventario" | "tareas") => void;
  onGoToTasks?: () => void;
  /** Whether it is time to start the next book (the first phase of the newest one is nearly done). */
  loadNextBookHint?: () => Promise<NextBookHint | null>;
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
  templates,
  onOpenProject,
  onCreateProject,
  onStartBook,
  onOpenStep,
  onGoToTasks,
  loadNextBookHint,
}: Props) {
  const [hint, setHint] = useState<NextBookHint | null>(null);
  const projectCount = projects.length;
  useEffect(() => {
    let live = true;
    if (!loadNextBookHint) return;
    void loadNextBookHint()
      .then((found) => live && setHint(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectCount]);
  /** `book`: start a book (the usual way). `other`: a project of several books, set up by hand. */
  const [creating, setCreating] = useState<"book" | "other" | null>(null);
  const t = useT();
  const language = useUiLanguage();
  const [kind, setKind] = useState<ProjectKind>("book");
  const [bookCode, setBookCode] = useState("NEH");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [selectedBooks, setSelectedBooks] = useState<string[]>(["GEN", "EXO"]);
  const [workflowId, setWorkflowId] = useState("");
  // The first template is the usual one; the person can still start blank.
  const chosenWorkflow = workflowId || templates[0]?.id || "";
  const BLANK = "__blank__";
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
    const workflow = chosenWorkflow === BLANK ? undefined : chosenWorkflow || undefined;
    if (kind === "book") {
      const id = normalizeProjectId(bookCode);
      onCreateProject({
        projectId: id,
        title: bookName(id),
        kind: "book",
        books: [id],
        workflowId: workflow,
      });
      setCreateOpen(false);
      return;
    }
    const id = normalizeProjectId(slug.trim() || slugifyThematic(title));
    if (!id || !title.trim() || selectedBooks.length < 1) return;
    onCreateProject({
      projectId: id,
      title: title.trim(),
      kind: "thematic",
      books: selectedBooks.map(normalizeProjectId),
      workflowId: workflow,
    });
    setCreateOpen(false);
  }

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("pj.title")}</h1>
          <p className="hub-lede">
            {t("pj.ledeIn").replace("{lang}", languageDisplayName(lang, languages))}
            {canManage ? t("pj.ledeManage") : "."}
          </p>
        </div>
        {canManage && !createOpen && !creating ? (
          <Button
            type="button"
            onClick={() => {
              if (onStartBook) setCreating("book");
              else setCreateOpen(true);
            }}
          >
            {onStartBook ? t("sb.title") : t("pj.new")}
          </Button>
        ) : null}
      </div>

      {canManage && hint && !creating && onStartBook ? (
        <div className="af-stale" role="status">
          <p style={{ margin: 0 }}>
            {t("sb.nextBook")
              .replace("{phase}", localizeName(hint.phase, language))
              .replace("{book}", isBookProjectId(hint.projectId) ? bookLabel(hint.projectId, language) : hint.projectId)
              .replace("{done}", String(hint.done))
              .replace("{total}", String(hint.total))}
          </p>
          <Button type="button" size="sm" className="mt-2" onClick={() => setCreating("book")}>
            {t("sb.nextBookDo")}
          </Button>
        </div>
      ) : null}

      {canManage && creating === "book" && onStartBook ? (
        <>
          <StartBookPanel
            templates={templates.map((row) => ({ id: row.id, name: row.name, description: row.description, phases: row.phases ?? 0, tasks: row.tasks ?? 0 }))}
            taken={projects.filter((p) => p.kind === "book").map((p) => p.projectId)}
            onStart={onStartBook}
            onOpen={(id, step) => onOpenStep?.(id, step)}
            onGoToTasks={() => onGoToTasks?.()}
            onCancel={() => setCreating(null)}
          />
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => {
              setCreating(null);
              setKind("thematic");
              setCreateOpen(true);
            }}
          >
            {t("sb.otherKind")}
          </button>
        </>
      ) : null}

      {!list.length ? (
        <div className="hub-empty">
          {t("pj.none")}
          {canManage ? t("pj.noneManage") : ""}
        </div>
      ) : (
        <div className="hub-board" role="list">
          {list.map((project) => {
            const booksLabel =
              project.kind === "book"
                ? project.projectId
                : project.books.length
                  ? project.books.join(", ")
                  : t("pj.noBooks");
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
                  <span className="hub-row-title">{project.kind === "book" && isBookProjectId(project.projectId) ? bookLabel(project.projectId, language) : project.title}</span>
                  <span className="hub-row-meta">
                    <Badge variant="outline">
                      {project.kind === "book" ? t("pj.kindBook") : t("pj.kindThematic")}
                    </Badge>
                    <span className="font-mono">{project.projectId}</span>
                    <span>{booksLabel}</span>
                  </span>
                </span>
                {canManage ? (
                  <span className="text-xs text-muted-foreground">{t("pj.open")}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {canManage && createOpen ? (
        <div className="hub-panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("pj.createTitle")}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              {t("pj.cancel")}
            </Button>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("pj.type")}</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v === "thematic" ? "thematic" : "book")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="book">{t("pj.typeBook")}</SelectItem>
                <SelectItem value="thematic">{t("pj.typeThematic")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "book" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="create-book">{t("pj.book")}</Label>
              <Select value={bookCode} onValueChange={setBookCode}>
                <SelectTrigger id="create-book" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {BOOKS.map((b) => (
                    <SelectItem key={b.code} value={b.code}>
                      {b.code} — {bookLabel(b.code, language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="create-title">{t("pj.titleLabel")}</Label>
                <Input
                  id="create-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (!slug) setSlug(slugifyThematic(e.target.value));
                  }}
                  placeholder={t("pj.titlePlaceholder")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="create-slug">{t("pj.slug")}</Label>
                <Input
                  id="create-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="pentateuco-r1"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("pj.books")}</Label>
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
            <Label htmlFor="create-template">{t("pj.template")}</Label>
            <Select value={chosenWorkflow || BLANK} onValueChange={setWorkflowId}>
              <SelectTrigger id="create-template" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
                <SelectItem value={BLANK}>{t("pj.templateBlank")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {templates.find((template) => template.id === chosenWorkflow)?.description || t("pj.templateHelp")}
            </p>
          </div>
          <div>
            <Button type="button" onClick={submitCreate}>
              {t("pj.createOpen")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
