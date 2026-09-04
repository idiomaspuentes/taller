import { useRef, useState, type ReactNode } from "react";
import type { InventoryDoc, Portion, TaskResource } from "../domain/types";
import { KIND_LABEL, REMAINING, STATUS_LABEL } from "../domain/types";
import { articleLabel } from "../domain/assignment";
import { displayRef, groupPortionsByChapter, tasksByChapter } from "../domain/chapters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

const PREVIEW = 8;

type Props = {
  inventory: InventoryDoc | null;
  jobMessage: string;
  generating: boolean;
  onGenerate: () => void;
  onLoadFile: (file: File) => void;
  onLoadSnapshot: () => void;
};

function statusTone(status: string): string {
  if (status === "translated") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "english" || status === "incomplete" || status === "missing") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "";
}

export function InventoryView({
  inventory,
  jobMessage,
  generating,
  onGenerate,
  onLoadFile,
  onLoadSnapshot,
}: Props) {
  const [showAllArticles, setShowAllArticles] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const total = inventory?.counts?.total;
  const pending = inventory?.articles.filter((a) => REMAINING.has(a.status)) ?? [];
  const notas = inventory?.portions.reduce((n, p) => n + (p.notasItems.length || p.notas), 0) ?? 0;
  const preguntas =
    inventory?.portions.reduce((n, p) => n + (p.preguntasItems.length || p.preguntas), 0) ?? 0;
  const visiblePending = showAllArticles ? pending : pending.slice(0, PREVIEW);
  const chapters = inventory ? groupPortionsByChapter(inventory.portions) : [];
  const book = inventory?.book ?? "";

  return (
    <div className="grid gap-3">
      <Card size="sm">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Inventario</CardTitle>
            <CardDescription>
              Genera el libro o carga un JSON. El tablero de asignación usa este inventario.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" disabled={generating} onClick={onGenerate}>
              {generating ? "Generando…" : "Generar"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
              Cargar JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              hidden
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onLoadFile(file);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="secondary" onClick={onLoadSnapshot}>
              Instantánea NEH
            </Button>
          </div>
        </CardHeader>
        {(generating || jobMessage) && (
          <CardContent>
            <p className="text-xs text-primary">{jobMessage || "Encolando…"}</p>
          </CardContent>
        )}
      </Card>

      {!inventory ? (
        <Card size="sm" className="border-dashed">
          <CardHeader>
            <CardTitle>Sin inventario en esta sesión</CardTitle>
            <CardDescription>
              Genera con el worker, carga un JSON o usa la instantánea de Nehemías para empezar a
              asignar.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={inventory.portions.length} label="Porciones" />
            <Stat value={notas} label="Notas" />
            <Stat value={preguntas} label="Preguntas" />
            <Stat value={pending.length} label="Pendientes" warn />
          </div>
          <p className="text-xs text-muted-foreground">
            {inventory.book}
            {inventory.generated_at
              ? ` · ${new Date(inventory.generated_at).toLocaleString("es")}`
              : ""}
            {` · ${total?.articles ?? inventory.articles.length} artículos`}
            {total?.translated != null ? ` · ${total.translated} traducidos` : ""}
          </p>
          {inventory.preguntas_sin_asignar ? (
            <p className="rounded-lg border bg-card px-3 py-2 text-xs text-foreground">
              {inventory.preguntas_sin_asignar} preguntas cruzan dos porciones (sin asignar al corte).
            </p>
          ) : null}

          <Drill title="Porciones" count={inventory.portions.length} defaultOpen>
            <div className="max-h-80 overflow-auto">
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

          <Drill title="Artículos pendientes" count={pending.length}>
            <div className="max-h-80 overflow-auto">
              {visiblePending.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-0">
                  <div>
                    <div className="font-medium">{articleLabel(a)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <Badge variant="outline">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                      <Badge variant="outline" className={statusTone(a.status)}>
                        {STATUS_LABEL[a.status]}
                      </Badge>
                      <span>{a.parent ? `padre: ${a.parent}` : a.path}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!pending.length ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">No hay artículos pendientes.</p>
              ) : null}
            </div>
            {pending.length > PREVIEW ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="mx-2 mb-1"
                onClick={() => setShowAllArticles((v) => !v)}
              >
                {showAllArticles ? "Mostrar menos" : `Ver todos (${pending.length})`}
              </Button>
            ) : null}
          </Drill>
        </>
      )}
    </div>
  );
}

function PortionRow({ portion }: { portion: Portion }) {
  const acad = portion.academia.length;
  const pal = portion.palabras.length;
  return (
    <div className="border-b px-3 py-2 last:border-0">
      <div className="font-medium">{portion.ref}</div>
      <div className="text-xs text-muted-foreground">
        Notas {portion.notasItems.length || portion.notas} · Preguntas{" "}
        {portion.preguntasItems.length || portion.preguntas}
        {acad ? ` · Academia ${acad}` : ""}
        {pal ? ` · Palabras ${pal}` : ""}
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
      <div className="max-h-80 overflow-auto">
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
                      {portion.ref}
                    </div>
                    {items.map((task) => (
                      <div key={task.id} className="flex flex-wrap items-baseline gap-2 px-3 py-1.5">
                        <code className="text-xs">{task.id}</code>
                        <span className="text-sm">{displayRef(book, task.ref)}</span>
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

function Stat({ value, label, warn }: { value: number; label: string; warn?: boolean }) {
  return (
    <Card size="sm">
      <CardContent>
        <strong className={cn("block text-2xl font-semibold tracking-tight", warn && "text-amber-700")}>
          {value}
        </strong>
        <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
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
    <Collapsible defaultOpen={defaultOpen} className="rounded-xl bg-card ring-1 ring-foreground/10">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform [[data-state=closed]_&]:-rotate-90" />
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
        <ChevronDown className="size-3 text-muted-foreground transition-transform [[data-state=closed]_&]:-rotate-90" />
        <span className="font-medium">Capítulo {chapter}</span>
        <span className="text-xs text-muted-foreground">
          {count} {unit}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
