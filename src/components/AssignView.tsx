import { useEffect, useMemo, useState } from "react";
import type { AssignmentsDoc, AssignmentState, InventoryDoc, ItemType, Team } from "../domain/types";
import {
  BUNDLE_GRAIN_LABEL,
  GRAIN_LABEL,
  KIND_LABEL,
  STATE_LABEL,
  STATUS_LABEL,
  citesArticlesFromPortions,
} from "../domain/types";
import {
  articleAssignmentId,
  articleLabel,
  articlesInGrain,
  assignToPerson,
  assignmentFor,
  autoAssign,
  bundleAssignmentState,
  bundleEnabled,
  bundleKey,
  bundleSummary,
  bundlesInScope,
  itemKey,
  portionInScope,
  portionsMatchingGrain,
  resolvedRuleGrain,
  scopeRuleLabel,
  showsNoteRows,
  showsPortionRows,
  taskItemId,
  tasksInScope,
  teamGrain,
  teamPhaseLabel,
  teamRules,
} from "../domain/assignment";
import { displayRef, groupPortionsByChapter } from "../domain/chapters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type PipelineFilter = AssignmentState | "all";
type ItemTab = "lotes" | "tareas" | "porciones" | "articulos";

const PIPELINE: PipelineFilter[] = ["sin asignar", "asignado", "en curso", "hecho", "all"];

type Props = {
  inventory: InventoryDoc;
  board: AssignmentsDoc;
  onChange: (next: AssignmentsDoc) => void;
  announce: (msg: string) => void;
  onGoEquipos: () => void;
};

function itemState(asg: ReturnType<typeof assignmentFor>): AssignmentState {
  if (!asg || asg.state === "sin asignar" || !asg.personId) return "sin asignar";
  return asg.state;
}

function defaultItemTab(team: Team | undefined): ItemTab {
  if (!team) return "porciones";
  if (team.bundle?.enabled) return "lotes";
  if (showsNoteRows(team)) return "tareas";
  if (showsPortionRows(team)) return "porciones";
  return "articulos";
}

export function AssignView({ inventory, board, onChange, announce, onGoEquipos }: Props) {
  const team = board.teams.find((t) => t.id === board.activeTeamId) ?? board.teams[0];
  const [tab, setTab] = useState<ItemTab>(() => defaultItemTab(team));
  const [pipeline, setPipeline] = useState<PipelineFilter>("sin asignar");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigneeId, setAssigneeId] = useState("");
  const [chapter, setChapter] = useState("all");
  const [search, setSearch] = useState("");

  const teamId = team?.id;
  const bundled = team ? bundleEnabled(team) : false;

  useEffect(() => {
    setSelected(new Set());
    setAssigneeId("");
    setPipeline("sin asignar");
    const current = board.teams.find((t) => t.id === teamId);
    if (!current) return;
    setTab(defaultItemTab(current));
    const geoChapter = current.bundle?.chapter ?? current.grainChapter;
    if (geoChapter) setChapter(String(geoChapter));
    else setChapter("all");
  }, [teamId, board.teams]);

  const members = team
    ? team.memberIds
        .map((id) => board.people.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
    : [];

  const grainPortions = useMemo(
    () => (team ? portionsMatchingGrain(team, inventory.portions) : inventory.portions),
    [inventory.portions, team],
  );

  const chapters = useMemo(() => {
    const set = new Set(grainPortions.map((p) => p.chapter));
    return [...set].sort((a, b) => a - b);
  }, [grainPortions]);

  const scopedPortions = useMemo(() => {
    return grainPortions.filter((p) => {
      if (!team || !portionInScope(p, team)) return false;
      if (chapter !== "all" && String(p.chapter) !== chapter) return false;
      if (search && !p.ref.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [grainPortions, team, chapter, search]);

  const scopedTasks = useMemo(() => {
    if (!team) return [];
    const q = search.trim().toLowerCase();
    return tasksInScope(team, inventory.portions).filter((task) => {
      if (chapter !== "all" && String(task.chapter) !== chapter) return false;
      if (!q) return true;
      return (
        task.id.toLowerCase().includes(q) ||
        task.ref.toLowerCase().includes(q) ||
        displayRef(inventory.book, task.ref).toLowerCase().includes(q)
      );
    });
  }, [inventory.portions, inventory.book, team, chapter, search]);

  const scopedArticles = useMemo(() => {
    if (!team) return [];
    const q = search.trim().toLowerCase();
    return articlesInGrain(team, inventory.portions, inventory.articles).filter((a) => {
      if (chapter !== "all" && a.portionRef) {
        const portion = inventory.portions.find(
          (row) => row.ref === a.portionRef || portionKeyMatch(row, a.portionId),
        );
        if (portion && String(portion.chapter) !== chapter) return false;
      }
      if (!q) return true;
      const label = articleLabel(a).toLowerCase();
      const portion = (a.portionRef ?? a.portionId ?? "").toLowerCase();
      return label.includes(q) || a.id.toLowerCase().includes(q) || portion.includes(q);
    });
  }, [inventory.articles, inventory.portions, team, search, chapter]);

  const scopedBundles = useMemo(() => {
    if (!team || !bundled) return [];
    const q = search.trim().toLowerCase();
    return bundlesInScope(team, inventory.portions, inventory.articles).filter((bundle) => {
      if (chapter !== "all" && String(bundle.chapter) !== chapter) return false;
      if (!q) return true;
      return (
        bundle.label.toLowerCase().includes(q) ||
        bundle.portionRefs.some((ref) => ref.toLowerCase().includes(q))
      );
    });
  }, [team, bundled, inventory.portions, inventory.articles, chapter, search]);

  const queueCounts = useMemo(() => {
    const counts: Record<AssignmentState, number> = {
      "sin asignar": 0,
      asignado: 0,
      "en curso": 0,
      hecho: 0,
    };
    if (bundled) {
      for (const bundle of scopedBundles) {
        counts[bundleAssignmentState(bundle, board.assignments, teamId ?? "")] += 1;
      }
      return counts;
    }
    if (team && showsNoteRows(team)) {
      for (const task of scopedTasks) {
        counts[
          itemState(
            assignmentFor(board.assignments, "tarea", taskItemId(task.resource, task.id), teamId),
          )
        ] += 1;
      }
    } else {
      for (const p of scopedPortions) {
        counts[itemState(assignmentFor(board.assignments, "porcion", p.ref, teamId))] += 1;
      }
    }
    for (const a of scopedArticles) {
      counts[itemState(assignmentFor(board.assignments, "articulo", articleAssignmentId(a), teamId))] += 1;
    }
    return counts;
  }, [
    bundled,
    scopedBundles,
    scopedTasks,
    scopedPortions,
    scopedArticles,
    board.assignments,
    teamId,
    team,
  ]);

  const tasks = scopedTasks.filter((task) => {
    const state = itemState(
      assignmentFor(board.assignments, "tarea", taskItemId(task.resource, task.id), teamId),
    );
    return pipeline === "all" || state === pipeline;
  });

  const portions = scopedPortions.filter((p) => {
    const state = itemState(assignmentFor(board.assignments, "porcion", p.ref, teamId));
    if (pipeline === "all") return true;
    return state === pipeline;
  });

  const articles = scopedArticles.filter((a) => {
    const state = itemState(
      assignmentFor(board.assignments, "articulo", articleAssignmentId(a), teamId),
    );
    if (pipeline === "all") return true;
    return state === pipeline;
  });

  const lotes = scopedBundles.filter((bundle) => {
    const state = bundleAssignmentState(bundle, board.assignments, teamId ?? "");
    return pipeline === "all" || state === pipeline;
  });

  const taskGroups = useMemo(() => {
    const byChapter = new Map<number, typeof tasks>();
    for (const task of tasks) {
      const list = byChapter.get(task.chapter) ?? [];
      list.push(task);
      byChapter.set(task.chapter, list);
    }
    return [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ch, rows]) => ({
        chapter: ch,
        tasks: rows,
      }));
  }, [tasks]);

  function toggle(type: ItemType, id: string) {
    const key = itemKey(type, id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleBundle(id: string) {
    const key = bundleKey(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function doAssign() {
    if (!team) {
      announce("Elige un equipo activo.");
      return;
    }
    const person = board.people.find((p) => p.id === assigneeId) ?? members[0];
    if (!person) {
      announce("Elige una persona del equipo.");
      return;
    }
    const result = assignToPerson(
      board.assignments,
      [...selected],
      person,
      team,
      inventory.portions,
      inventory.articles,
    );
    onChange({ ...board, assignments: result.assignments, activeTeamId: team.id });
    setSelected(new Set());
    announce(
      `${result.added} asignados a ${person.name}.${result.skipped ? ` ${result.skipped} fuera de alcance.` : ""}`,
    );
  }

  function doAuto() {
    if (!team) {
      announce("Crea personas y un equipo con alcance antes de autoasignar.");
      return;
    }
    const result = autoAssign(
      board.assignments,
      team,
      board.people,
      inventory.portions,
      inventory.articles,
    );
    onChange({ ...board, assignments: result.assignments, activeTeamId: team.id });
    if (result.assigned) setPipeline("asignado");
    announce(result.message);
  }

  const listCount = bundled
    ? lotes.length
    : tab === "tareas"
      ? tasks.length
      : tab === "porciones"
        ? portions.length
        : articles.length;
  const emptyHint = bundled
    ? pipeline === "sin asignar"
      ? "No hay lotes sin asignar para este equipo y filtro."
      : "No hay lotes en este estado."
    : tab === "tareas"
      ? pipeline === "sin asignar"
        ? "El backlog de notas y preguntas está vacío para este equipo y filtro."
        : "No hay notas o preguntas en este estado."
      : tab === "porciones"
        ? pipeline === "sin asignar"
          ? "El backlog de porciones está vacío para este equipo y filtro."
          : "No hay porciones en este estado."
        : pipeline === "sin asignar"
          ? "El backlog de artículos está vacío para este equipo y filtro."
          : "No hay artículos en este estado.";

  const grain = team ? teamGrain(team) : undefined;
  const citedRepeat = scopedArticles.filter((row) => !row.firstSeenInBook).length;
  const citesArticles = team
    ? teamRules(team).some((rule) => citesArticlesFromPortions(resolvedRuleGrain(team, rule)))
    : false;
  const noteTab = team ? showsNoteRows(team) : false;
  const portionTab = team ? showsPortionRows(team) : false;

  return (
    <div className="grid gap-3">
      <Card size="sm">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Asignar</CardTitle>
            <CardDescription>
              {bundled
                ? "Asignar juntos: cada lote agrupa los recursos del equipo para esa porción o capítulo. Autoasignar reparte lotes."
                : "Cola de la unión de reglas de este equipo. Cada recurso usa su propio grano. Autoasignar puede partir notas y academia entre personas."}
            </CardDescription>
          </div>
          <Button
            type="button"
            onClick={doAuto}
            disabled={!team || !members.length}
            title={
              !team
                ? "Crea un equipo con alcance en Equipos primero."
                : !members.length
                  ? "Añade integrantes al equipo en Equipos primero."
                  : undefined
            }
          >
            Autoasignar
          </Button>
        </CardHeader>
        {team ? (
          <CardContent className="grid gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={team.id}
                onValueChange={(id) => onChange({ ...board, activeTeamId: id })}
              >
                <SelectTrigger className="w-auto max-w-full" aria-label="Equipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {board.teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {teamPhaseLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {team.description?.trim() ? (
                <span className="max-w-full text-sm text-muted-foreground">{team.description.trim()}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1">
              {bundled && team.bundle ? (
                <Badge variant="outline">Juntos · {BUNDLE_GRAIN_LABEL[team.bundle.grain]}</Badge>
              ) : grain ? (
                <Badge variant="outline">{GRAIN_LABEL[grain]}</Badge>
              ) : null}
              {teamRules(team).map((rule) => (
                <Badge key={`${rule.resource}-${rule.articleFilter}`} variant="outline">
                  {scopeRuleLabel(rule, resolvedRuleGrain(team, rule))}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={chapter} onValueChange={setChapter}>
                <SelectTrigger className="w-auto" aria-label="Capítulo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="all">Cap. todos</SelectItem>
                  {chapters.map((c) => (
                    <SelectItem key={c} value={String(c)}>
                      Cap. {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar…"
                aria-label="Buscar"
                className="min-w-32 flex-1"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Cola">
              {PIPELINE.map((id) => {
                const count =
                  id === "all"
                    ? queueCounts["sin asignar"] +
                      queueCounts.asignado +
                      queueCounts["en curso"] +
                      queueCounts.hecho
                    : queueCounts[id];
                const label = id === "all" ? "Todos" : STATE_LABEL[id];
                return (
                  <Button
                    key={id}
                    type="button"
                    role="tab"
                    size="sm"
                    variant={pipeline === id ? "default" : "outline"}
                    aria-selected={pipeline === id}
                    className="rounded-full"
                    onClick={() => setPipeline(id)}
                  >
                    {label}
                    <strong>{count}</strong>
                  </Button>
                );
              })}
            </div>
          </CardContent>
        ) : null}
      </Card>

      {!team ? (
        <Card size="sm" className="border-dashed">
          <CardHeader>
            <CardTitle>No hay equipo activo</CardTitle>
            <CardDescription>
              Crea un equipo con alcance mixto, grano por recurso y fase. El backlog es la unión de esas reglas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="secondary" onClick={onGoEquipos}>
              Ir a Equipos
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card size="sm">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            {bundled ? (
              <p className="text-sm font-medium">Lotes {lotes.length}</p>
            ) : (
              <Tabs value={tab} onValueChange={(v) => setTab(v as ItemTab)}>
                <TabsList className="flex-wrap">
                  {noteTab ? (
                    <TabsTrigger value="tareas">Notas / preguntas {tasks.length}</TabsTrigger>
                  ) : null}
                  {portionTab ? (
                    <TabsTrigger value="porciones">Porciones {portions.length}</TabsTrigger>
                  ) : null}
                  <TabsTrigger value="articulos">Artículos {articles.length}</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{selected.size} sel.</span>
              <Select
                value={assigneeId || "__none__"}
                onValueChange={(v) => setAssigneeId(v === "__none__" ? "" : v)}
                disabled={!members.length}
              >
                <SelectTrigger className="w-auto" aria-label="Persona">
                  <SelectValue placeholder={members.length ? "Persona" : "Sin integrantes"} />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="__none__">
                    {members.length ? "Persona" : "Sin integrantes"}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" disabled={!selected.size || !members.length} onClick={doAssign}>
                Asignar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-auto">
              {bundled
                ? lotes.map((bundle) => {
                    const key = bundleKey(bundle.id);
                    const state = bundleAssignmentState(bundle, board.assignments, teamId ?? "");
                    const first = bundle.items
                      .map((item) => assignmentFor(board.assignments, item.type, item.id, teamId))
                      .find((row) => row?.person);
                    return (
                      <label
                        key={bundle.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-0",
                          selected.has(key) && "bg-primary/5",
                        )}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(key)}
                          onCheckedChange={() => toggleBundle(bundle.id)}
                        />
                        <div className="min-w-0">
                          <strong className="font-medium">{bundleSummary(bundle)}</strong>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                            <span>Cap. {bundle.chapter}</span>
                            {first?.person ? (
                              <>
                                <Badge variant="secondary">{first.person}</Badge>
                                <Badge variant="outline">{STATE_LABEL[state]}</Badge>
                              </>
                            ) : (
                              <Badge variant="outline">{STATE_LABEL[state]}</Badge>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })
                : tab === "tareas"
                  ? taskGroups.map((group) => (
                      <div key={group.chapter} className="border-b last:border-0">
                        <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium">
                          Capítulo {group.chapter} · {group.tasks.length}{" "}
                          {group.tasks.length === 1 ? "ítem" : "ítems"}
                        </div>
                        {group.tasks.map((task) => {
                          const itemId = taskItemId(task.resource, task.id);
                          const key = itemKey("tarea", itemId);
                          const asg = assignmentFor(board.assignments, "tarea", itemId, teamId);
                          const portion = inventory.portions.find(
                            (row) => row.id === task.portionId || row.ref === task.portionId,
                          );
                          return (
                            <label
                              key={key}
                              className={cn(
                                "flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-0",
                                selected.has(key) && "bg-primary/5",
                              )}
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={selected.has(key)}
                                onCheckedChange={() => toggle("tarea", itemId)}
                              />
                              <div>
                                <strong className="font-medium font-mono text-sm">{task.id}</strong>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                  <span>{displayRef(inventory.book, task.ref)}</span>
                                  {portion ? <span>· {portion.ref}</span> : null}
                                  <Badge variant="outline">
                                    {task.resource === "notas" ? "Nota" : "Pregunta"}
                                  </Badge>
                                  {asg?.person ? (
                                    <>
                                      <Badge variant="secondary">{asg.person}</Badge>
                                      <Badge variant="outline">{STATE_LABEL[asg.state]}</Badge>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ))
                  : tab === "porciones"
                    ? groupPortionsByChapter(portions).map((group) => (
                        <div key={group.chapter} className="border-b last:border-0">
                          <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium">
                            Capítulo {group.chapter} · {group.portions.length} porciones
                          </div>
                          {group.portions.map((p) => {
                            const key = itemKey("porcion", p.ref);
                            const asg = assignmentFor(board.assignments, "porcion", p.ref, teamId);
                            return (
                              <label
                                key={p.ref}
                                className={cn(
                                  "flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-0",
                                  selected.has(key) && "bg-primary/5",
                                )}
                              >
                                <Checkbox
                                  className="mt-0.5"
                                  checked={selected.has(key)}
                                  onCheckedChange={() => toggle("porcion", p.ref)}
                                />
                                <div>
                                  <strong className="font-medium">{p.ref}</strong>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                    <span>
                                      Notas {p.notasItems.length || p.notas} · Preguntas{" "}
                                      {p.preguntasItems.length || p.preguntas}
                                    </span>
                                    {asg?.person ? (
                                      <>
                                        <Badge variant="secondary">{asg.person}</Badge>
                                        <Badge variant="outline">{STATE_LABEL[asg.state]}</Badge>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      ))
                    : (
                        <>
                          {citesArticles ? (
                            <p className="border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                              Artículos citados en las porciones de este equipo
                              {citedRepeat
                                ? ` · ${citedRepeat} ya citado${citedRepeat === 1 ? "" : "s"} en el libro. `
                                : ". "}
                              Siguen asignables.
                            </p>
                          ) : null}
                          {articles.map((a) => {
                            const itemId = articleAssignmentId(a);
                            const key = itemKey("articulo", itemId);
                            const asg = assignmentFor(board.assignments, "articulo", itemId, teamId);
                            return (
                              <label
                                key={itemId}
                                className={cn(
                                  "flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-0",
                                  selected.has(key) && "bg-primary/5",
                                )}
                              >
                                <Checkbox
                                  className="mt-0.5"
                                  checked={selected.has(key)}
                                  onCheckedChange={() => toggle("articulo", itemId)}
                                />
                                <div>
                                  <strong className="font-medium">{articleLabel(a)}</strong>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                    {a.portionRef ? (
                                      <Badge variant="outline">{a.portionRef}</Badge>
                                    ) : null}
                                    <Badge variant="outline">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                                    <Badge variant="outline">{STATUS_LABEL[a.status]}</Badge>
                                    {!a.firstSeenInBook ? (
                                      <Badge
                                        variant="secondary"
                                        title="No es la primera referencia de este artículo en el libro"
                                      >
                                        Ya citado
                                      </Badge>
                                    ) : null}
                                    {asg?.person ? (
                                      <Badge variant="secondary">{asg.person}</Badge>
                                    ) : null}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </>
                      )}
              {!listCount ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground">{emptyHint}</p>
                  {pipeline !== "sin asignar" ? (
                    <Button type="button" variant="link" onClick={() => setPipeline("sin asignar")}>
                      Ver backlog
                    </Button>
                  ) : !members.length ? (
                    <Button type="button" variant="secondary" className="mt-2" onClick={onGoEquipos}>
                      Añadir integrantes
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function portionKeyMatch(
  row: { id: string; ref: string },
  portionId?: string,
): boolean {
  if (!portionId) return false;
  return row.id === portionId || row.ref === portionId;
}
