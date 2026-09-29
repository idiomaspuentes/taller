import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Article, InventoryDoc, Portion, TaskResource } from "../domain/types";
import { KIND_LABEL, REMAINING, STATUS_LABEL } from "../domain/types";
import { articleLabel } from "../domain/assignment";
import { displayRef, groupPortionsByChapter, tasksByChapter, verseRangeLabel } from "../domain/chapters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown } from "lucide-react";

const PREVIEW = 12;

type Props = {
  open: boolean;
  onClose: () => void;
  inventory: InventoryDoc;
  /** Open focused on pending articles when that’s why the manager is exploring. */
  focusPending?: boolean;
};

type ExplorerMode = "pending" | "catalog";

function statusTone(status: string): string {
  if (status === "translated") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "english" || status === "incomplete" || status === "missing") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "";
}

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

function groupPendingByKind(articles: Article[]): { kind: string; label: string; rows: Article[] }[] {
  const order = ["Translation Academy", "Translation Words"];
  const map = new Map<string, Article[]>();
  for (const article of articles) {
    const list = map.get(article.kind) ?? [];
    list.push(article);
    map.set(article.kind, list);
  }
  const groups: { kind: string; label: string; rows: Article[] }[] = [];
  for (const kind of order) {
    const rows = map.get(kind);
    if (rows?.length) groups.push({ kind, label: kindLabel(kind), rows });
    map.delete(kind);
  }
  for (const [kind, rows] of map) {
    groups.push({ kind, label: kindLabel(kind), rows });
  }
  return groups;
}

export function BookExplorerDialog({ open, onClose, inventory, focusPending = false }: Props) {
  const pending = useMemo(
    () => inventory.articles.filter((a) => REMAINING.has(a.status)),
    [inventory.articles],
  );
  const preferPending = focusPending && pending.length > 0;
  const [mode, setMode] = useState<ExplorerMode>(preferPending ? "pending" : "catalog");
  const [showAllPending, setShowAllPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(preferPending ? "pending" : "catalog");
    setShowAllPending(false);
  }, [open, preferPending, inventory.book]);

  const notas = inventory.portions.reduce((n, p) => n + (p.notasItems.length || p.notas), 0);
  const preguntas = inventory.portions.reduce(
    (n, p) => n + (p.preguntasItems.length || p.preguntas),
    0,
  );
  const chapters = groupPortionsByChapter(inventory.portions);
  const book = inventory.book;
  const pendingGroups = useMemo(() => groupPendingByKind(pending), [pending]);
  const visibleCount = showAllPending ? pending.length : Math.min(PREVIEW, pending.length);
  let shown = 0;

  const pendingTitle =
    pending.length === 1
      ? `1 pendiente · ${inventory.book}`
      : `${pending.length} pendientes · ${inventory.book}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="explorer-dialog max-h-[85vh] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {mode === "pending" && preferPending ? pendingTitle : `Explorar ${inventory.book}`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Consulta del inventario. No modifica datos.
          </DialogDescription>
        </DialogHeader>

        <div className="explorer-dialog__body">
          {mode === "pending" && preferPending ? (
            <>
              <div className="explorer-pending">
                {!pending.length ? (
                  <p className="px-1 py-2 text-sm text-muted-foreground">
                    No hay artículos pendientes.
                  </p>
                ) : (
                  pendingGroups.map((group) => {
                    const rows: Article[] = [];
                    for (const article of group.rows) {
                      if (shown >= visibleCount) break;
                      rows.push(article);
                      shown += 1;
                    }
                    if (!rows.length) return null;
                    return (
                      <section key={group.kind} className="explorer-pending__group">
                        <h3 className="explorer-pending__eyebrow">
                          {group.label}
                          <span className="explorer-pending__count">{group.rows.length}</span>
                        </h3>
                        <ul className="explorer-pending__list">
                          {rows.map((article) => (
                            <li key={article.id} className="explorer-pending__item">
                              <div className="explorer-pending__title">{articleLabel(article)}</div>
                              <div className="explorer-pending__meta">
                                <Badge
                                  variant="outline"
                                  className={statusTone(article.status)}
                                >
                                  {STATUS_LABEL[article.status]}
                                </Badge>
                                <span
                                  className="explorer-pending__path"
                                  title={article.parent ? `padre: ${article.parent}` : article.path}
                                >
                                  {article.parent || article.path}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })
                )}
                {pending.length > PREVIEW ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="px-0"
                    onClick={() => setShowAllPending((v) => !v)}
                  >
                    {showAllPending ? "Mostrar menos" : `Ver todos (${pending.length})`}
                  </Button>
                ) : null}
              </div>
              <div className="explorer-dialog__footer">
                <Button type="button" size="sm" variant="outline" onClick={() => setMode("catalog")}>
                  Ver porciones y ayudas
                </Button>
                <span className="explorer-dialog__note">Solo lectura</span>
              </div>
            </>
          ) : (
            <>
              {preferPending ? (
                <div className="explorer-dialog__footer explorer-dialog__footer--top">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setMode("pending")}>
                    Volver a pendientes ({pending.length})
                  </Button>
                </div>
              ) : null}
              <div className="explorer-catalog">
                <Drill title="Porciones" count={inventory.portions.length} defaultOpen>
                  {inventory.preguntas_sin_asignar ? (
                    <p className="explorer-catalog__note">
                      {inventory.preguntas_sin_asignar} preguntas cruzan dos porciones (sin asignar
                      al corte).
                    </p>
                  ) : null}
                  <div>
                    {chapters.map((group, index) => (
                      <ChapterBlock
                        key={group.chapter}
                        chapter={group.chapter}
                        count={group.portions.length}
                        unit="porciones"
                        defaultOpen={index === 0}
                      >
                        {group.portions.map((portion) => (
                          <PortionRow key={portion.id || portion.ref} portion={portion} />
                        ))}
                      </ChapterBlock>
                    ))}
                  </div>
                </Drill>

                <TaskDrill
                  title="Notas"
                  resource="notas"
                  count={notas}
                  book={book}
                  portions={inventory.portions}
                  defaultOpen
                />
                <TaskDrill
                  title="Preguntas"
                  resource="preguntas"
                  count={preguntas}
                  book={book}
                  portions={inventory.portions}
                />

                {!preferPending ? (
                  <Drill title="Artículos pendientes" count={pending.length}>
                    <PendingFlatList
                      groups={pendingGroups}
                      preview={PREVIEW}
                      showAll={showAllPending}
                      onToggleShowAll={() => setShowAllPending((v) => !v)}
                    />
                  </Drill>
                ) : null}
              </div>
              <p className="explorer-dialog__note explorer-dialog__note--end">Solo lectura</p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PendingFlatList({
  groups,
  preview,
  showAll,
  onToggleShowAll,
}: {
  groups: { kind: string; label: string; rows: Article[] }[];
  preview: number;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const limit = showAll ? total : Math.min(preview, total);
  let shown = 0;
  return (
    <div className="explorer-pending explorer-pending--nested">
      {!total ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">No hay artículos pendientes.</p>
      ) : (
        groups.map((group) => {
          const rows: Article[] = [];
          for (const article of group.rows) {
            if (shown >= limit) break;
            rows.push(article);
            shown += 1;
          }
          if (!rows.length) return null;
          return (
            <section key={group.kind} className="explorer-pending__group">
              <h3 className="explorer-pending__eyebrow">
                {group.label}
                <span className="explorer-pending__count">{group.rows.length}</span>
              </h3>
              <ul className="explorer-pending__list">
                {rows.map((article) => (
                  <li key={article.id} className="explorer-pending__item">
                    <div className="explorer-pending__title">{articleLabel(article)}</div>
                    <div className="explorer-pending__meta">
                      <Badge variant="outline" className={statusTone(article.status)}>
                        {STATUS_LABEL[article.status]}
                      </Badge>
                      <span
                        className="explorer-pending__path"
                        title={article.parent ? `padre: ${article.parent}` : article.path}
                      >
                        {article.parent || article.path}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {total > preview ? (
        <Button type="button" variant="link" size="sm" className="mx-2 mb-1" onClick={onToggleShowAll}>
          {showAll ? "Mostrar menos" : `Ver todos (${total})`}
        </Button>
      ) : null}
    </div>
  );
}

function PortionRow({ portion }: { portion: Portion }) {
  const acad = portion.academia.length;
  const pal = portion.palabras.length;
  const range = verseRangeLabel(portion.ref) || portion.ref;
  return (
    <div className="border-b px-3 py-2 last:border-0">
      <div className="text-sm font-semibold tracking-tight">{range}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        TPL {portion.tpl || 0} · TPS {portion.tps || 0} · Notas{" "}
        {portion.notasItems.length || portion.notas} · Preguntas{" "}
        {portion.preguntasItems.length || portion.preguntas}
        {acad ? ` · Academia ${acad}` : ""}
        {pal ? ` · Palabras ${pal}` : ""}
        {portion.id && portion.id !== portion.ref ? (
          <span className="ml-1.5 font-mono opacity-70">{portion.id}</span>
        ) : null}
      </div>
    </div>
  );
}

function TaskDrill({
  title,
  resource,
  count,
  book,
  portions,
  defaultOpen,
}: {
  title: string;
  resource: TaskResource;
  count: number;
  book: string;
  portions: Portion[];
  defaultOpen?: boolean;
}) {
  const groups = tasksByChapter(portions, resource);
  const hasItems = portions.some((portion) =>
    resource === "notas" ? portion.notasItems.length : portion.preguntasItems.length,
  );
  return (
    <Drill title={title} count={count} defaultOpen={defaultOpen}>
      <div>
        {!hasItems ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            Este inventario solo trae el conteo. Regenera el libro o carga un JSON con{" "}
            {resource}_items (id + referencia).
          </p>
        ) : (
          groups.map((group, index) => (
            <ChapterBlock
              key={group.chapter}
              chapter={group.chapter}
              count={group.portions.length}
              unit="porciones"
              defaultOpen={index === 0}
            >
              {group.portions.map((portion) => {
                const items = resource === "notas" ? portion.notasItems : portion.preguntasItems;
                return (
                  <div key={portion.id || portion.ref} className="border-b last:border-0">
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      {verseRangeLabel(portion.ref) || portion.ref}
                    </div>
                    {items.map((task) => (
                      <div
                        key={task.id}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5"
                      >
                        <span className="text-sm font-semibold tracking-tight">
                          {verseRangeLabel(task.ref) || displayRef(book, task.ref)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground opacity-70">
                          {task.id}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </ChapterBlock>
          ))
        )}
      </div>
    </Drill>
  );
}

function Drill({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border border-border bg-surface">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
        <ChevronDown className="size-3.5 text-muted-foreground chevron" />
        {title}
        <Badge variant="secondary">{count}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ChapterBlock({
  chapter,
  count,
  unit,
  defaultOpen,
  children,
}: {
  chapter: number;
  count: number;
  unit: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b last:border-0">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <ChevronDown className="size-3 text-muted-foreground chevron" />
        <span className="font-medium">Capítulo {chapter}</span>
        <span className="text-xs text-muted-foreground">
          {count} {unit}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
