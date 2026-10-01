import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AssignmentsDoc, AssignmentState, InventoryDoc, ItemType, Team } from "../domain/types";
import {
  DISTRIBUTE_POLICY_LABEL,
  DISTRIBUTE_UNIT_LABEL,
  GRAIN_LABEL,
  KIND_LABEL,
  STATE_LABEL,
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
  resolveDistributePolicy,
  resolveDistributeUnit,
  resolvedRuleGrain,
  scopeRuleLabel,
  showsNoteRows,
  showsPortionRows,
  taskItemId,
  tasksInScope,
  teamGrain,
  teamPhaseLabel,
  teamRules,
  unassignKeys,
} from "../domain/assignment";
import { displayRef, groupPortionsByChapter, taskKindLabel, verseRangeLabel } from "../domain/chapters";
import { ChevronDown } from "lucide-react";
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
import { useT, type MessageKey } from "../i18n/messages";
import { localizeScope } from "../domain/scopeNames";
import { useUiLanguage } from "../i18n/language";

type PipelineFilter = AssignmentState | "all";
type ItemTab = "lotes" | "tareas" | "porciones" | "articulos";

type Props = {
  inventory: InventoryDoc;
  board: AssignmentsDoc;
  onChange: (next: AssignmentsDoc) => void;
  announce: (msg: string) => void;
  onGoTareas: () => void;
};

function itemState(asg: ReturnType<typeof assignmentFor>): AssignmentState {
  if (!asg || asg.state === "sin asignar" || !asg.personId) return "sin asignar";
  return asg.state;
}

function issueRefFromAsg(asg: { note?: string } | null | undefined): string | undefined {
  const note = asg?.note?.trim();
  return note?.startsWith("#") ? note : undefined;
}

function defaultItemTab(team: Team | undefined): ItemTab {
  if (!team) return "porciones";
  if (team.bundle?.enabled) return "lotes";
  if (showsNoteRows(team)) return "tareas";
  if (showsPortionRows(team)) return "porciones";
  return "articulos";
}

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function stateClass(state: AssignmentState): string {
  if (state === "sin asignar") return "assign-state assign-state--sin-asignar";
  if (state === "en curso") return "assign-state assign-state--en-curso";
  if (state === "hecho") return "assign-state assign-state--hecho";
  return "assign-state assign-state--asignado";
}

function matchesPerson(
  asg: ReturnType<typeof assignmentFor>,
  filter: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "__unassigned__") {
    return !asg || !asg.personId || asg.state === "sin asignar";
  }
  return asg?.personId === filter;
}

const PRIMARY_PIPELINE: PipelineFilter[] = ["all", "sin asignar", "asignado"];
const SECONDARY_PIPELINE: AssignmentState[] = ["en curso", "hecho"];

export function AssignView({ inventory, board, onChange, announce, onGoTareas }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const loc = (text: string) => localizeScope(text, language);
  const n = (key: MessageKey, count: number) => t(key).replace("{n}", String(count));
  const team = board.teams.find((t) => t.id === board.activeTeamId) ?? board.teams[0];
  const [tab, setTab] = useState<ItemTab>(() => defaultItemTab(team));
  const [pipeline, setPipeline] = useState<PipelineFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigneeId, setAssigneeId] = useState("");
  const [chapter, setChapter] = useState("all");
  const [search, setSearch] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set());
  const [personFilter, setPersonFilter] = useState("all"); // "all" | "__unassigned__" | personId
  const [moreStates, setMoreStates] = useState(false);

  const teamId = team?.id;
  const bundled = team ? bundleEnabled(team) : false;

  useEffect(() => {
    setSelected(new Set());
    setAssigneeId("");
    setPipeline("all");
    setCollapsedChapters(new Set());
    setPersonFilter("all");
    setMoreStates(false);
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

  const scopeCtx = useMemo(
    () => ({
      projectBooks: board.books?.length ? board.books : [board.book],
      fallbackBook: board.books?.[0] || board.book,
    }),
    [board.books, board.book],
  );

  const grainPortions = useMemo(
    () => (team ? portionsMatchingGrain(team, inventory.portions, scopeCtx) : inventory.portions),
    [inventory.portions, team, scopeCtx],
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
    return tasksInScope(team, inventory.portions, scopeCtx).filter((task) => {
      if (chapter !== "all" && String(task.chapter) !== chapter) return false;
      if (!q) return true;
      return (
        task.id.toLowerCase().includes(q) ||
        task.ref.toLowerCase().includes(q) ||
        displayRef(inventory.book, task.ref).toLowerCase().includes(q)
      );
    });
  }, [inventory.portions, inventory.book, team, chapter, search, scopeCtx]);

  const scopedArticles = useMemo(() => {
    if (!team) return [];
    const q = search.trim().toLowerCase();
    return articlesInGrain(team, inventory.portions, inventory.articles, scopeCtx).filter((a) => {
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
  }, [inventory.articles, inventory.portions, team, search, chapter, scopeCtx]);

  const scopedBundles = useMemo(() => {
    if (!team || !bundled) return [];
    const q = search.trim().toLowerCase();
    return bundlesInScope(team, inventory.portions, inventory.articles, scopeCtx).filter((bundle) => {
      if (chapter !== "all" && String(bundle.chapter) !== chapter) return false;
      if (!q) return true;
      return (
        bundle.label.toLowerCase().includes(q) ||
        bundle.portionRefs.some((ref) => ref.toLowerCase().includes(q))
      );
    });
  }, [team, bundled, inventory.portions, inventory.articles, chapter, search, scopeCtx]);

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

  const personOptions = useMemo(() => {
    const map = new Map<string, string>();
    const addAsg = (asg: ReturnType<typeof assignmentFor>) => {
      if (!asg?.personId) return;
      const name =
        asg.person ||
        board.people.find((p) => p.id === asg.personId)?.name ||
        asg.personId;
      map.set(asg.personId, name);
    };
    if (bundled) {
      for (const bundle of scopedBundles) {
        const first = bundle.items
          .map((item) => assignmentFor(board.assignments, item.type, item.id, teamId))
          .find((row) => row?.personId);
        addAsg(first);
      }
    } else {
      if (team && showsNoteRows(team)) {
        for (const task of scopedTasks) {
          addAsg(
            assignmentFor(
              board.assignments,
              "tarea",
              taskItemId(task.resource, task.id),
              teamId,
            ),
          );
        }
      }
      if (team && showsPortionRows(team)) {
        for (const p of scopedPortions) {
          addAsg(assignmentFor(board.assignments, "porcion", p.ref, teamId));
        }
      }
      for (const a of scopedArticles) {
        addAsg(
          assignmentFor(board.assignments, "articulo", articleAssignmentId(a), teamId),
        );
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [
    bundled,
    scopedBundles,
    scopedTasks,
    scopedPortions,
    scopedArticles,
    board.assignments,
    board.people,
    teamId,
    team,
  ]);

  const tasks = scopedTasks.filter((task) => {
    const asg = assignmentFor(
      board.assignments,
      "tarea",
      taskItemId(task.resource, task.id),
      teamId,
    );
    const state = itemState(asg);
    if (!(pipeline === "all" || state === pipeline)) return false;
    return matchesPerson(asg, personFilter);
  });

  const portions = scopedPortions.filter((p) => {
    const asg = assignmentFor(board.assignments, "porcion", p.ref, teamId);
    const state = itemState(asg);
    if (!(pipeline === "all" || state === pipeline)) return false;
    return matchesPerson(asg, personFilter);
  });

  const articles = scopedArticles.filter((a) => {
    const asg = assignmentFor(
      board.assignments,
      "articulo",
      articleAssignmentId(a),
      teamId,
    );
    const state = itemState(asg);
    if (!(pipeline === "all" || state === pipeline)) return false;
    return matchesPerson(asg, personFilter);
  });

  const lotes = scopedBundles.filter((bundle) => {
    const state = bundleAssignmentState(bundle, board.assignments, teamId ?? "");
    if (!(pipeline === "all" || state === pipeline)) return false;
    const first = bundle.items
      .map((item) => assignmentFor(board.assignments, item.type, item.id, teamId))
      .find((row) => row?.personId);
    if (personFilter === "all") return true;
    if (personFilter === "__unassigned__") {
      return state === "sin asignar" || !first?.personId;
    }
    return first?.personId === personFilter;
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

  const loteGroups = useMemo(() => {
    const byChapter = new Map<number, typeof lotes>();
    for (const bundle of lotes) {
      const list = byChapter.get(bundle.chapter) ?? [];
      list.push(bundle);
      byChapter.set(bundle.chapter, list);
    }
    return [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ch, rows]) => ({
        chapter: ch,
        bundles: rows,
      }));
  }, [lotes]);

  const visibleKeys = useMemo(() => {
    if (bundled) return lotes.map((bundle) => bundleKey(bundle.id));
    if (tab === "tareas") {
      return tasks.map((task) => itemKey("tarea", taskItemId(task.resource, task.id)));
    }
    if (tab === "porciones") {
      return portions.map((p) => itemKey("porcion", p.ref));
    }
    return articles.map((a) => itemKey("articulo", articleAssignmentId(a)));
  }, [bundled, lotes, tab, tasks, portions, articles]);

  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));

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

  function selectKeys(keys: string[], mode: "replace" | "add" = "replace") {
    setSelected((prev) => {
      if (mode === "replace") return new Set(keys);
      const next = new Set(prev);
      for (const key of keys) next.add(key);
      return next;
    });
  }

  function toggleSelectVisible() {
    if (allVisibleSelected) setSelected(new Set());
    else selectKeys(visibleKeys, "replace");
  }

  function keysForChapter(ch: number): string[] {
    if (bundled) {
      return lotes
        .filter((bundle) => bundle.chapter === ch)
        .map((bundle) => bundleKey(bundle.id));
    }
    if (tab === "tareas") {
      return tasks
        .filter((task) => task.chapter === ch)
        .map((task) => itemKey("tarea", taskItemId(task.resource, task.id)));
    }
    if (tab === "porciones") {
      return portions
        .filter((p) => p.chapter === ch)
        .map((p) => itemKey("porcion", p.ref));
    }
    return [];
  }

  function chapterFullySelected(ch: number): boolean {
    const keys = keysForChapter(ch);
    return keys.length > 0 && keys.every((key) => selected.has(key));
  }

  function toggleSelectChapter(ch: number) {
    const keys = keysForChapter(ch);
    if (!keys.length) return;
    if (chapterFullySelected(ch)) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const key of keys) next.delete(key);
        return next;
      });
    } else {
      selectKeys(keys, "add");
    }
  }

  function toggleChapterCollapsed(ch: number) {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  }

  function doAssign() {
    if (!team) {
      announce(t("as.pickActive"));
      return;
    }
    const person = board.people.find((p) => p.id === assigneeId) ?? members[0];
    if (!person) {
      announce(t("as.pickPerson"));
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
      t("as.assigned").replace("{n}", String(result.added)).replace("{name}", person.name) +
        (result.skipped ? n("as.outOfScope", result.skipped) : ""),
    );
  }

  function doUnassign() {
    if (!team) {
      announce(t("as.pickActive"));
      return;
    }
    if (!selected.size) {
      announce(t("as.selectToRelease"));
      return;
    }
    const result = unassignKeys(
      board.assignments,
      [...selected],
      team,
      inventory.portions,
      inventory.articles,
    );
    onChange({ ...board, assignments: result.assignments, activeTeamId: team.id });
    setSelected(new Set());
    if (result.removed) setPipeline("sin asignar");
    announce(
      result.removed
        ? result.removed === 1
          ? t("as.releasedOne")
          : n("as.releasedMany", result.removed)
        : t("as.nothingToRelease"),
    );
  }

  function doAuto() {
    if (!team) {
      announce(t("as.createFirst"));
      return;
    }
    const result = autoAssign(
      board.assignments,
      team,
      board.people,
      inventory.portions,
      inventory.articles,
      scopeCtx,
    );
    onChange({ ...board, assignments: result.assignments, activeTeamId: team.id });
    if (result.assigned) setPipeline("asignado");
    announce(loc(result.message));
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
      ? t("as.emptyLotsUn")
      : t("as.emptyLots")
    : tab === "tareas"
      ? pipeline === "sin asignar"
        ? t("as.emptyJobsUn")
        : t("as.emptyJobs")
      : tab === "porciones"
        ? pipeline === "sin asignar"
          ? t("as.emptyPortionsUn")
          : t("as.emptyPortions")
        : pipeline === "sin asignar"
          ? t("as.emptyArtsUn")
          : t("as.emptyArts");

  const grain = team ? teamGrain(team) : undefined;
  const citedRepeat = scopedArticles.filter((row) => !row.firstSeenInBook).length;
  const citesArticles = team
    ? teamRules(team).some((rule) => citesArticlesFromPortions(resolvedRuleGrain(team, rule)))
    : false;
  const noteTab = team ? showsNoteRows(team) : false;
  const portionTab = team ? showsPortionRows(team) : false;
  const ruleCount = team ? teamRules(team).length : 0;

  const availableTabs = useMemo(() => {
    const tabs: ItemTab[] = [];
    if (noteTab) tabs.push("tareas");
    if (portionTab) tabs.push("porciones");
    if (articles.length > 0) tabs.push("articulos");
    return tabs;
  }, [noteTab, portionTab, articles.length]);

  useEffect(() => {
    if (bundled) return;
    if (availableTabs.length === 0) return;
    if (!availableTabs.includes(tab)) {
      setTab(availableTabs[0]);
    }
  }, [bundled, availableTabs, tab]);

  const showTipo = useMemo(() => {
    const kinds = new Set<string>();
    if (bundled) {
      for (const bundle of lotes) kinds.add(bundleSummary(bundle));
    } else if (tab === "tareas") {
      for (const task of tasks) kinds.add(taskKindLabel(task.resource));
    } else if (tab === "porciones") {
      for (const p of portions) kinds.add(`TPL ${p.tpl || 0} · TPS ${p.tps || 0}`);
    } else {
      for (const a of articles) kinds.add(KIND_LABEL[a.kind] ?? a.kind);
    }
    return kinds.size > 1;
  }, [bundled, tab, lotes, tasks, portions, articles]);

  const visibleChapterIds = useMemo(() => {
    if (bundled) return loteGroups.map((g) => g.chapter);
    if (tab === "tareas") return taskGroups.map((g) => g.chapter);
    if (tab === "porciones") {
      return groupPortionsByChapter(portions).map((g) => g.chapter);
    }
    return [] as number[];
  }, [bundled, loteGroups, tab, taskGroups, portions]);

  const collapseKey = `${teamId}|${chapter}|${pipeline}|${personFilter}|${tab}|${bundled}`;
  const chapterIdsKey = visibleChapterIds.join(",");

  useEffect(() => {
    if (chapter !== "all" || listCount <= 20) {
      setCollapsedChapters(new Set());
      return;
    }
    setCollapsedChapters(new Set(visibleChapterIds));
    // Re-auto-collapse only when filters/tab change (collapseKey) or chapter set identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listCount/visibleChapterIds read from latest render for that key
  }, [collapseKey, chapterIdsKey]);

  const tabLabel = (id: ItemTab): string => {
    if (id === "tareas") return n("as.tabJobs", tasks.length);
    if (id === "porciones") return n("as.tabPortions", portions.length);
    return n("as.tabArticles", articles.length);
  };

  return (
    <div
      className={cn("assign-view", selected.size > 0 && "pb-24")}
      data-assign-step="true"
      data-assign-bulk={selected.size > 0 ? "true" : undefined}
    >
      {!team ? (
        <Card size="sm" className="border-dashed">
          <CardHeader>
            <CardTitle>{t("as.noActiveTitle")}</CardTitle>
            <CardDescription>
              {t("as.noActiveBody")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="secondary" onClick={onGoTareas}>
              {t("as.goTasks")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="assign-chrome">
            <div className="assign-chrome__top">
              <div className="assign-chrome__identity">
                {board.teams.length === 1 ? (
                  <h1 className="assign-chrome__title">{teamPhaseLabel(team)}</h1>
                ) : (
                  <Select
                    value={team.id}
                    onValueChange={(id) => onChange({ ...board, activeTeamId: id })}
                  >
                    <SelectTrigger className="w-auto max-w-full" aria-label={t("as.activeTaskAria")}>
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
                )}
                <button
                  type="button"
                  className="assign-chrome__scope"
                  onClick={() => setScopeOpen((v) => !v)}
                  aria-expanded={scopeOpen}
                >
                  {n(bundled ? "as.scopeTogether" : "as.scope", ruleCount)}
                </button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={doAuto}
                disabled={!members.length || resolveDistributePolicy(team) === "manual"}
                title={
                  !members.length
                    ? t("as.addMembersFirst")
                    : resolveDistributePolicy(team) === "manual"
                      ? t("as.manualMode")
                      : undefined
                }
              >
                {t("tv.autoAssign")}
              </Button>
            </div>

            {scopeOpen ? (
              <div className="assign-chrome__scope-panel">
                {bundled ? <Badge variant="outline">{t("tv.together")}</Badge> : null}
                <Badge variant="outline">
                  {loc(DISTRIBUTE_UNIT_LABEL[resolveDistributeUnit(team)])}
                </Badge>
                <Badge variant="outline">
                  {loc(DISTRIBUTE_POLICY_LABEL[resolveDistributePolicy(team)])}
                </Badge>
                {!bundled && grain ? (
                  <Badge variant="outline">{loc(GRAIN_LABEL[grain])}</Badge>
                ) : null}
                {teamRules(team).map((rule) => (
                  <Badge key={`${rule.resource}-${rule.articleFilter}`} variant="outline">
                    {loc(scopeRuleLabel(rule, resolvedRuleGrain(team, rule)))}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="assign-chrome__tools">
              <Select value={chapter} onValueChange={setChapter}>
                <SelectTrigger className="w-auto" aria-label={t("tv.chapter")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="all">{t("as.allChapters")}</SelectItem>
                  {chapters.map((c) => (
                    <SelectItem key={c} value={String(c)}>
                      {n("as.chapterN", c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={personFilter} onValueChange={setPersonFilter}>
                <SelectTrigger className="w-auto" aria-label={t("td.person")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="all">{t("as.allPeople")}</SelectItem>
                  <SelectItem value="__unassigned__">{loc("Sin asignar")}</SelectItem>
                  {personOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("mt.searchPlaceholder")}
                aria-label={t("as.searchAria")}
                className="assign-chrome__search"
              />
              <div className="assign-chrome__status" role="tablist" aria-label={t("as.queueAria")}>
                {PRIMARY_PIPELINE.map((id) => {
                  const count =
                    id === "all"
                      ? queueCounts["sin asignar"] +
                        queueCounts.asignado +
                        queueCounts["en curso"] +
                        queueCounts.hecho
                      : queueCounts[id];
                  const label = loc(id === "all" ? "Todos" : STATE_LABEL[id]);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={pipeline === id}
                      className={cn(
                        "assign-status-chip",
                        pipeline === id && "assign-status-chip--active",
                      )}
                      onClick={() => setPipeline(id)}
                    >
                      {label}
                      <span className="assign-status-chip__n">{count}</span>
                    </button>
                  );
                })}
                {SECONDARY_PIPELINE.map((id) => {
                  if (!moreStates && pipeline !== id) return null;
                  const count = queueCounts[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={pipeline === id}
                      className={cn(
                        "assign-status-chip",
                        pipeline === id && "assign-status-chip--active",
                      )}
                      onClick={() => setPipeline(id)}
                    >
                      {loc(STATE_LABEL[id])}
                      <span className="assign-status-chip__n">{count}</span>
                    </button>
                  );
                })}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="assign-status-more"
                  onClick={() => setMoreStates((v) => !v)}
                  aria-expanded={moreStates}
                >
                  {moreStates ? t("as.less") : t("as.more")}
                </Button>
              </div>
            </div>
          </div>

          <div className="assign-board">
            <div className="assign-board__toolbar">
              <div className="assign-board__select-all">
                {listCount > 0 ? (
                  <>
                    <Checkbox
                      checked={allVisibleSelected}
                      indeterminate={
                        !allVisibleSelected &&
                        visibleKeys.some((key) => selected.has(key))
                      }
                      onCheckedChange={() => toggleSelectVisible()}
                      aria-label={
                        allVisibleSelected
                          ? t("as.unselectVisible")
                          : t("as.selectVisible")
                      }
                    />
                    <span className="assign-board__select-label">
                      {selected.size > 0
                        ? selected.size === 1
                          ? t("as.nSelectedOne")
                          : n("as.nSelected", selected.size)
                        : chapter !== "all"
                          ? n("as.chapterN", Number(chapter))
                          : listCount === 1
                            ? t("as.nVisibleOne")
                            : n("as.nVisible", listCount)}
                    </span>
                  </>
                ) : (
                  <span className="assign-board__select-label">{t("as.noItems")}</span>
                )}
              </div>
              {bundled ? (
                <p className="text-sm font-medium text-foreground">{t("as.lots")}</p>
              ) : availableTabs.length > 1 ? (
                <Tabs value={tab} onValueChange={(v) => setTab(v as ItemTab)}>
                  <TabsList className="flex-wrap">
                    {availableTabs.map((id) => (
                      <TabsTrigger key={id} value={id}>
                        {tabLabel(id)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : availableTabs.length === 1 ? (
                <p className="text-sm text-muted-foreground">{tabLabel(availableTabs[0])}</p>
              ) : null}
            </div>

            {listCount > 0 ? (
              <div
                className={cn("assign-board__cols", !showTipo && "assign-board__cols--no-tipo")}
                aria-hidden
              >
                <span />
                <span>{t("as.colName")}</span>
                {showTipo ? <span>{t("as.colType")}</span> : null}
                <span>{t("as.colPerson")}</span>
                <span>{t("as.colState")}</span>
              </div>
            ) : null}

            {bundled
              ? loteGroups.map((group) => {
                  const keys = keysForChapter(group.chapter);
                  const all = chapterFullySelected(group.chapter);
                  const some = !all && keys.some((key) => selected.has(key));
                  const collapsed = collapsedChapters.has(group.chapter);
                  return (
                    <section key={group.chapter} className="assign-group">
                      <AssignGroupHead
                        t={t}
                        chapter={group.chapter}
                        count={group.bundles.length}
                        allSelected={all}
                        someSelected={some}
                        collapsed={collapsed}
                        onToggleSelect={() => toggleSelectChapter(group.chapter)}
                        onToggleCollapse={() => toggleChapterCollapsed(group.chapter)}
                      />
                      {!collapsed
                        ? group.bundles.map((bundle) => {
                            const key = bundleKey(bundle.id);
                            const state = bundleAssignmentState(
                              bundle,
                              board.assignments,
                              teamId ?? "",
                            );
                            const first = bundle.items
                              .map((item) =>
                                assignmentFor(board.assignments, item.type, item.id, teamId),
                              )
                              .find((row) => row?.person);
                            const issueAsg = bundle.items
                              .map((item) =>
                                assignmentFor(board.assignments, item.type, item.id, teamId),
                              )
                              .find((row) => issueRefFromAsg(row));
                            const rangeTitle =
                              bundle.portionRefs.length === 1
                                ? verseRangeLabel(bundle.portionRefs[0])
                                : bundle.portionRefs.length <= 3
                                  ? bundle.portionRefs.map(verseRangeLabel).join(" · ")
                                  : `${verseRangeLabel(bundle.portionRefs[0])} … ${verseRangeLabel(bundle.portionRefs[bundle.portionRefs.length - 1])}`;
                            return (
                              <AssignRow
                                key={bundle.id}
                                selected={selected.has(key)}
                                onToggle={() => toggleBundle(bundle.id)}
                                title={rangeTitle || n("as.chapterN", bundle.chapter)}
                                kind={loc(bundleSummary(bundle))}
                                showTipo={showTipo}
                                person={first?.person}
                                state={state}
                                issueRef={issueRefFromAsg(issueAsg)}
                              />
                            );
                          })
                        : null}
                    </section>
                  );
                })
              : tab === "tareas"
                ? taskGroups.map((group) => {
                    const keys = keysForChapter(group.chapter);
                    const all = chapterFullySelected(group.chapter);
                    const some = !all && keys.some((key) => selected.has(key));
                    const collapsed = collapsedChapters.has(group.chapter);
                    return (
                      <section key={group.chapter} className="assign-group">
                        <AssignGroupHead
                          t={t}
                          chapter={group.chapter}
                          count={group.tasks.length}
                          allSelected={all}
                          someSelected={some}
                          collapsed={collapsed}
                          onToggleSelect={() => toggleSelectChapter(group.chapter)}
                          onToggleCollapse={() => toggleChapterCollapsed(group.chapter)}
                        />
                        {!collapsed
                          ? group.tasks.map((task) => {
                              const itemId = taskItemId(task.resource, task.id);
                              const key = itemKey("tarea", itemId);
                              const asg = assignmentFor(
                                board.assignments,
                                "tarea",
                                itemId,
                                teamId,
                              );
                              const range =
                                verseRangeLabel(task.ref) ||
                                displayRef(inventory.book, task.ref);
                              return (
                                <AssignRow
                                  key={key}
                                  selected={selected.has(key)}
                                  onToggle={() => toggle("tarea", itemId)}
                                  title={range}
                                  kind={loc(taskKindLabel(task.resource))}
                                  showTipo={showTipo}
                                  person={asg?.person}
                                  state={itemState(asg)}
                                  issueRef={issueRefFromAsg(asg)}
                                  titleAttr={task.id}
                                />
                              );
                            })
                          : null}
                      </section>
                    );
                  })
                : tab === "porciones"
                  ? groupPortionsByChapter(portions).map((group) => {
                      const keys = keysForChapter(group.chapter);
                      const all = chapterFullySelected(group.chapter);
                      const some = !all && keys.some((key) => selected.has(key));
                      const collapsed = collapsedChapters.has(group.chapter);
                      return (
                        <section key={group.chapter} className="assign-group">
                          <AssignGroupHead
                            t={t}
                            chapter={group.chapter}
                            count={group.portions.length}
                            allSelected={all}
                            someSelected={some}
                            collapsed={collapsed}
                            onToggleSelect={() => toggleSelectChapter(group.chapter)}
                            onToggleCollapse={() => toggleChapterCollapsed(group.chapter)}
                          />
                          {!collapsed
                            ? group.portions.map((p) => {
                                const key = itemKey("porcion", p.ref);
                                const asg = assignmentFor(
                                  board.assignments,
                                  "porcion",
                                  p.ref,
                                  teamId,
                                );
                                return (
                                  <AssignRow
                                    key={p.ref}
                                    selected={selected.has(key)}
                                    onToggle={() => toggle("porcion", p.ref)}
                                    title={verseRangeLabel(p.ref) || p.ref}
                                    kind={`TPL ${p.tpl || 0} · TPS ${p.tps || 0}`}
                                    showTipo={showTipo}
                                    person={asg?.person}
                                    state={itemState(asg)}
                                    issueRef={issueRefFromAsg(asg)}
                                    titleAttr={p.id !== p.ref ? p.id : undefined}
                                  />
                                );
                              })
                            : null}
                        </section>
                      );
                    })
                  : (
                      <>
                        {citesArticles ? (
                          <p className="border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                            {t("as.citedHead")}
                            {citedRepeat
                              ? n(citedRepeat === 1 ? "as.citedRepeatOne" : "as.citedRepeatMany", citedRepeat)
                              : t("as.citedDot")}
                            {t("as.stillAssignable")}
                          </p>
                        ) : null}
                        {articles.map((a) => {
                          const itemId = articleAssignmentId(a);
                          const key = itemKey("articulo", itemId);
                          const asg = assignmentFor(
                            board.assignments,
                            "articulo",
                            itemId,
                            teamId,
                          );
                          return (
                            <AssignRow
                              key={itemId}
                              selected={selected.has(key)}
                              onToggle={() => toggle("articulo", itemId)}
                              title={articleLabel(a)}
                              kind={loc(KIND_LABEL[a.kind] ?? a.kind)}
                              showTipo={showTipo}
                              person={asg?.person}
                              state={itemState(asg)}
                              issueRef={issueRefFromAsg(asg)}
                              titleAttr={a.id}
                              extra={
                                !a.firstSeenInBook ? (
                                  <Badge variant="secondary" title={t("as.alreadyCitedTitle")}>
                                    {t("as.alreadyCited")}
                                  </Badge>
                                ) : a.portionRef ? (
                                  <span className="text-xs text-muted-foreground">
                                    {verseRangeLabel(a.portionRef) || a.portionRef}
                                  </span>
                                ) : null
                              }
                            />
                          );
                        })}
                      </>
                    )}

            {!listCount ? (
              <div className="px-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">{emptyHint}</p>
                {pipeline !== "all" ? (
                  <Button type="button" variant="link" onClick={() => setPipeline("all")}>
                    {t("as.seeAll")}
                  </Button>
                ) : !members.length ? (
                  <Button type="button" variant="secondary" className="mt-2" onClick={onGoTareas}>
                    {t("as.addMembers")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {selected.size > 0 ? (
            <div className="assign-bulk-bar" role="toolbar" aria-label={t("as.bulkAria")}>
              <span className="assign-bulk-bar__count">
                <strong>{selected.size}</strong> {t(selected.size === 1 ? "as.nSelectedOne" : "as.nSelected").replace(/\{n\}|^1/, "").trim()}
              </span>
              <Select
                value={assigneeId || "__none__"}
                onValueChange={(v) => setAssigneeId(v === "__none__" ? "" : v)}
                disabled={!members.length}
              >
                <SelectTrigger className="w-auto" aria-label={t("td.person")}>
                  <SelectValue placeholder={members.length ? t("td.person") : t("as.noMembers")} />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="__none__">
                    {members.length ? t("td.person") : t("as.noMembers")}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" disabled={!members.length} onClick={doAssign}>
                {t("tv.assign")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={doUnassign}>
                {t("as.release")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                {t("as.clear")}
              </Button>
            </div>
          ) : null}
        </>
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

function AssignGroupHead({
  t,
  chapter,
  count,
  allSelected,
  someSelected,
  collapsed,
  onToggleSelect,
  onToggleCollapse,
}: {
  t: (key: MessageKey) => string;
  chapter: number;
  count: number;
  allSelected: boolean;
  someSelected: boolean;
  collapsed: boolean;
  onToggleSelect: () => void;
  onToggleCollapse: () => void;
}) {
  return (
    <div
      className="assign-group__head"
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      onClick={onToggleCollapse}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleCollapse();
        }
      }}
    >
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected}
        onCheckedChange={() => onToggleSelect()}
        onClick={(e) => e.stopPropagation()}
        aria-label={t("as.selectChapterAria").replace("{n}", String(chapter))}
      />
      <ChevronDown
        className={cn(
          "assign-group__chevron",
          collapsed && "assign-group__chevron--collapsed",
        )}
        aria-hidden
      />
      <span className="assign-group__title">{t("as.chapterN").replace("{n}", String(chapter))}</span>
      <span className="assign-group__count">{count}</span>
    </div>
  );
}

function AssignPerson({ name }: { name?: string }) {
  if (!name) {
    return <span className="assign-person assign-person--empty">—</span>;
  }
  return (
    <span className="assign-person">
      <span className="assign-person__avatar">{personInitials(name)}</span>
      <span className="assign-person__name">{name}</span>
    </span>
  );
}

function AssignState({ state, issueRef }: { state: AssignmentState; issueRef?: string }) {
  const t = useT();
  const language = useUiLanguage();
  return (
    <span
      className={stateClass(state)}
      title={issueRef ? t("as.subtaskTitle").replace("{ref}", issueRef) : undefined}
    >
      <span className="assign-state__dot" aria-hidden />
      {localizeScope(STATE_LABEL[state], language)}
      {issueRef ? <span className="assign-state__issue">{issueRef}</span> : null}
    </span>
  );
}

function AssignRow({
  selected,
  onToggle,
  title,
  kind,
  showTipo = true,
  person,
  state,
  issueRef,
  titleAttr,
  extra,
}: {
  selected: boolean;
  onToggle: () => void;
  title: string;
  kind?: string;
  showTipo?: boolean;
  person?: string;
  state: AssignmentState;
  issueRef?: string;
  titleAttr?: string;
  extra?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "assign-row",
        selected && "assign-row--selected",
        !showTipo && "assign-row--no-tipo",
      )}
    >
      <Checkbox checked={selected} onCheckedChange={() => onToggle()} />
      <div className="assign-row__main" title={titleAttr}>
        <span className="assign-row__title">{title}</span>
        {showTipo && kind ? <span className="assign-row__kind">{kind}</span> : null}
        {extra}
        <div className="assign-row__mobile-meta">
          <AssignPerson name={person} />
          <AssignState state={state} issueRef={issueRef} />
        </div>
      </div>
      {showTipo ? (
        <div className="assign-row__kind-col">
          {kind ? <span className="assign-row__kind">{kind}</span> : null}
        </div>
      ) : null}
      <div className="assign-row__person-col">
        <AssignPerson name={person} />
      </div>
      <div className="assign-row__state-col">
        <AssignState state={state} issueRef={issueRef} />
      </div>
    </label>
  );
}
