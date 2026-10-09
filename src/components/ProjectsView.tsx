import { rememberTemplateUsed, usualTemplate } from "../lastTemplate";
import { useEffect, useMemo, useState } from "react";
import type { NextBookHint } from "../domain/startBook";
import { localizeName } from "../domain/templateNames";
import { BOOKS, bookLabel, bookName, isBookProjectId, normalizeProjectId } from "../domain/books";
import { useT } from "../i18n/messages";
import { StartBookPanel } from "./StartBookPanel";
import { PhaseTeamsPanel } from "./PhaseTeamsPanel";
import { useUiLanguage } from "../i18n/language";
import { languageDisplayName, type LanguageOption } from "../domain/languages";
import type { ProjectIndexEntry, ProjectKind } from "../domain/types";
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
export type ProjectTemplateOption = { id: string; name: string; description?: string; phases?: number; tasks?: number; /** A walkthrough of a process, for a test server. */ trial?: boolean };
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
  onAdjustBook?: StartBookProps["onAdjust"];
  /** A project being prepared on this device and not created yet. */
  draft?: { projectId: string; onContinue: () => void; onDiscard: () => void };
  /** One team per phase: offered after starting a book, and here while the open project still has tasks without one. */
  phaseTeams?: StartBookProps["phaseTeams"];
  pendingTeams?: { board: Parameters<typeof PhaseTeamsPanel>[0]["board"]; onSaved: Parameters<typeof PhaseTeamsPanel>[0]["onSaved"] };
  onOpenStep?: (projectId: string, step: "subtareas" | "tareas") => void;
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
  onAdjustBook,
  draft,
  phaseTeams,
  pendingTeams,
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
  // The usual template is the one this person started their last book with; before any, the first of the list.
  const chosenWorkflow = workflowId || usualTemplate(templates);
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
    rememberTemplateUsed(workflow);
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

      {canManage && !creating && phaseTeams && pendingTeams ? (
        <PhaseTeamsPanel key={pendingTeams.board.projectId} board={pendingTeams.board} {...phaseTeams} onSaved={pendingTeams.onSaved} />
      ) : null}

      {canManage && creating === "book" && onStartBook ? (
        <>
          <StartBookPanel
            templates={templates.map((row) => ({ id: row.id, name: row.name, description: row.description, phases: row.phases ?? 0, tasks: row.tasks ?? 0, trial: row.trial }))}
            taken={[...projects.filter((p) => p.kind === "book").map((p) => p.projectId), ...(draft ? [draft.projectId] : [])]}
            onStart={onStartBook}
            onAdjust={onAdjustBook}
            onOpen={(id, step) => onOpenStep?.(id, step)}
            onGoToTasks={() => onGoToTasks?.()}
            onCancel={() => setCreating(null)}
            phaseTeams={phaseTeams}
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

      {canManage && draft && !creating ? (
        <div className="hub-draft">
          <div>
            <p className="hub-draft__kind">{t("dp.cardKind")}</p>
            <p className="hub-draft__name">{isBookProjectId(draft.projectId) ? bookLabel(draft.projectId, language) : draft.projectId}</p>
            <p className="hub-draft__hint">{t("dp.cardHint")}</p>
          </div>
          <div className="pf-footer__actions">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                if (window.confirm(t("dp.confirmDiscard"))) draft.onDiscard();
              }}
            >
              {t("dp.discard")}
            </Button>
            <Button type="button" size="sm" onClick={draft.onContinue}>
              {t("dp.continue")}
            </Button>
          </div>
        </div>
      ) : null}

      {!list.length ? (
        <div className="hub-empty">
          {t("pj.none")}
          {canManage ? t("pj.noneManage") : ""}
        </div>
      ) : (
        <ul className="tp-list">
          {list.map((project) => {
            const isBook = project.kind === "book" && isBookProjectId(project.projectId);
            return (
              <li key={project.projectId}>
                <button type="button" className="tp-card pj-card" data-current={project.projectId === currentProjectId ? "true" : undefined} onClick={() => onOpenProject(project.projectId)} disabled={!canManage}>
                  <span className="tp-card__name">{isBook ? bookLabel(project.projectId, language) : project.title}</span>
                  <span className="tp-card__meta">
                    {project.kind === "book" ? t("pj.kindBook") : `${t("pj.kindThematic")} · ${project.books.length ? project.books.join(", ") : t("pj.noBooks")}`}
                    {project.updated_at ? ` · ${t("pj.updated").replace("{date}", new Date(project.updated_at).toLocaleDateString(language))}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
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
