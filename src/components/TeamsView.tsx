import { useEffect, useMemo, useState } from "react";
import type { DcsOrg } from "@ip-lms/dcs-client";
import type {
  ArticleFilter,
  AssignmentGrain,
  AssignmentsDoc,
  BundleGrain,
  InventoryDoc,
  Person,
  ScopeKey,
  ScopeRule,
  Team,
  TeamPreset,
} from "../domain/types";
import {
  BUNDLE_GRAIN_LABEL,
  BUNDLE_GRAINS,
  GRAIN_LABEL,
  articleFilterLabel,
  citesArticlesFromPortions,
  displayResourceGrain,
  filtersForResource,
  grainsForResource,
  isArticleResource,
  SCOPE_KEYS,
  SCOPE_LABEL,
} from "../domain/types";
import {
  articlesInGrain,
  bundleEnabled,
  overlappingTeams,
  ruleItemCount,
  resolvedRuleGrain,
  scopeFromRules,
  scopeRuleLabel,
  tasksInScope,
  teamRules,
  uid,
} from "../domain/assignment";
import { groupPortionsByChapter, portionKey } from "../domain/chapters";
import { loadTeamPresets, mergePeople, saveTeamPresets } from "../domain/store";
import type { GtSession } from "../dcs/auth";
import { listPmOrgMembers } from "../dcs/persist";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";

type Props = {
  board: AssignmentsDoc;
  inventory: InventoryDoc | null;
  onChange: (next: AssignmentsDoc) => void;
  session: GtSession | null;
  pmOrg: string;
  orgs: DcsOrg[];
  onPmOrgChange: (org: string) => void;
};

type ResourceDraft = {
  articleFilter: ArticleFilter;
  grain: AssignmentGrain;
  stayInChapter: boolean;
  includeDuplicates: boolean;
  chapter: string;
  portionIds: string[];
  itemIds: string;
};

type ScopeDraft = Partial<Record<ScopeKey, ResourceDraft>>;

function defaultGrainFor(resource: ScopeKey): AssignmentGrain {
  return isArticleResource(resource) ? "portionRefs" : "item";
}

function defaultDraft(resource: ScopeKey): ResourceDraft {
  const grain = defaultGrainFor(resource);
  const portionRefs = citesArticlesFromPortions(grain) || grain === "portionRefs";
  return {
    articleFilter: resource === "academia" && portionRefs ? "all" : "pending",
    grain,
    stayInChapter: grain === "portionRefs",
    includeDuplicates: isArticleResource(resource) && grain === "portionRefs",
    chapter: "",
    portionIds: [],
    itemIds: "",
  };
}

function parseIds(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function draftFromTeam(team: Team): ScopeDraft {
  const draft: ScopeDraft = {};
  for (const rule of teamRules(team)) {
    const grain = displayResourceGrain(rule.grain ?? team.grain ?? defaultGrainFor(rule.resource));
    draft[rule.resource] = {
      articleFilter: rule.articleFilter,
      grain,
      stayInChapter:
        typeof rule.stayInChapter === "boolean"
          ? rule.stayInChapter
          : grain === "portionRefs" ||
            team.grain === "chapter" ||
            team.grain === "portionsInChapter",
      includeDuplicates:
        typeof rule.includeDuplicates === "boolean"
          ? rule.includeDuplicates
          : isArticleResource(rule.resource) &&
            (grain === "portionRefs" ||
              team.grain === "chapter" ||
              team.grain === "portionsInChapter"),
      chapter: String(rule.chapter ?? team.grainChapter ?? ""),
      portionIds: rule.portionIds?.length
        ? [...rule.portionIds]
        : team.grainPortionIds
          ? [...team.grainPortionIds]
          : [],
      itemIds: (rule.itemIds ?? (rule.resource === "notas" || rule.resource === "preguntas"
        ? team.grainItemIds
        : undefined) ?? []).join(" "),
    };
  }
  return draft;
}

function rulesFromDraft(draft: ScopeDraft, hideGeo: boolean): ScopeRule[] {
  return SCOPE_KEYS.filter((key) => draft[key] != null).map((resource) => {
    const row = draft[resource] as ResourceDraft;
    const ids = parseIds(row.itemIds);
    const chapterNum = Number(row.chapter);
    return {
      resource,
      articleFilter: row.articleFilter,
      grain: row.grain,
      stayInChapter: row.stayInChapter,
      includeDuplicates: isArticleResource(resource) ? row.includeDuplicates : undefined,
      chapter: hideGeo || !row.stayInChapter || !(chapterNum > 0) ? undefined : chapterNum,
      portionIds: hideGeo || !row.portionIds.length ? undefined : [...row.portionIds],
      itemIds: ids.length ? ids : undefined,
    };
  });
}

function peopleById(people: Person[]): Map<string, Person> {
  return new Map(people.map((row) => [row.id, row]));
}

function needsGeoPickers(draft: ResourceDraft): boolean {
  return draft.grain === "portionRefs" || draft.stayInChapter || draft.grain === "portion";
}

export function TeamsView({ board, inventory, onChange, session, pmOrg, orgs, onPmOrgChange }: Props) {
  const [personName, setPersonName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<ScopeDraft>({});
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(() => board.teams.length === 0);
  const [descOpen, setDescOpen] = useState(false);
  const [addManualOpen, setAddManualOpen] = useState(false);
  const [scopeHelpOpen, setScopeHelpOpen] = useState(false);
  const [bundleHelpOpen, setBundleHelpOpen] = useState(false);
  const [presets, setPresets] = useState<TeamPreset[]>(() => loadTeamPresets());
  const [bundleOn, setBundleOn] = useState(false);
  const [bundleGrain, setBundleGrain] = useState<BundleGrain>("portion");
  const [bundleChapter, setBundleChapter] = useState("");
  const [bundlePortionIds, setBundlePortionIds] = useState<string[]>([]);
  const [roster, setRoster] = useState<Person[]>([]);
  const [rosterError, setRosterError] = useState("");
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterQuery, setRosterQuery] = useState("");

  useEffect(() => {
    if (!session || !pmOrg) {
      setRosterLoading(false);
      if (!session) setRosterError("");
      return;
    }
    let cancelled = false;
    setRosterLoading(true);
    setRosterError("");
    void listPmOrgMembers(session, pmOrg)
      .then((people) => {
        if (cancelled) return;
        setRoster(people);
      })
      .catch(() => {
        if (cancelled) return;
        setRosterError(
          `No se pudieron cargar los integrantes de ${pmOrg}. Se mantienen las personas locales.`,
        );
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg]);

  const rosterMap = useMemo(() => peopleById(roster), [roster]);
  const localMap = useMemo(() => peopleById(board.people), [board.people]);

  const selectable = useMemo(() => {
    const merged = mergePeople(board.people, roster);
    const q = rosterQuery.trim().toLocaleLowerCase("es");
    if (!q) return merged;
    return merged.filter(
      (p) =>
        p.name.toLocaleLowerCase("es").includes(q) || p.id.toLocaleLowerCase("es").includes(q),
    );
  }, [board.people, roster, rosterQuery]);

  function addPerson() {
    const name = personName.trim();
    if (!name) return;
    if (board.people.some((p) => p.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) {
      return;
    }
    const person: Person = { id: uid(), name };
    onChange({ ...board, people: [...board.people, person] });
    setPersonName("");
  }

  function removePerson(id: string) {
    onChange({
      ...board,
      people: board.people.filter((p) => p.id !== id),
      teams: board.teams.map((t) => ({
        ...t,
        memberIds: t.memberIds.filter((m) => m !== id),
      })),
      assignments: board.assignments.filter((a) => a.personId !== id),
    });
    setMemberIds((prev) => prev.filter((m) => m !== id));
  }

  function toggleMember(person: Person) {
    setMemberIds((prev) =>
      prev.includes(person.id) ? prev.filter((m) => m !== person.id) : [...prev, person.id],
    );
  }

  function toggleResource(resource: ScopeKey) {
    setDraft((prev) => {
      if (prev[resource] != null) {
        const next = { ...prev };
        delete next[resource];
        return next;
      }
      return { ...prev, [resource]: defaultDraft(resource) };
    });
  }

  function patchResource(resource: ScopeKey, patch: Partial<ResourceDraft>) {
    setDraft((prev) => {
      const current = prev[resource];
      if (!current) return prev;
      const next = { ...current, ...patch };
      if (patch.grain) {
        const portionRefs = patch.grain === "portionRefs";
        if (portionRefs) {
          next.stayInChapter = true;
          if (isArticleResource(resource)) {
            next.includeDuplicates = true;
            if (current.articleFilter === "pending") next.articleFilter = "all";
          }
        } else if (patch.grain === "item") {
          next.includeDuplicates = false;
        }
      }
      return { ...prev, [resource]: next };
    });
  }

  function resetForm() {
    setTeamName("");
    setDescription("");
    setMemberIds([]);
    setDraft({});
    setEditingId(null);
    setBundleOn(false);
    setBundleGrain("portion");
    setBundleChapter("");
    setBundlePortionIds([]);
    setFormOpen(false);
    setDescOpen(false);
  }

  function applyPreset(preset: TeamPreset) {
    const next: ScopeDraft = {};
    for (const rule of preset.rules) {
      const grain = rule.grain ?? defaultGrainFor(rule.resource);
      next[rule.resource] = {
        articleFilter: rule.articleFilter,
        grain,
        stayInChapter: rule.stayInChapter ?? grain === "portionRefs",
        includeDuplicates: rule.includeDuplicates ?? false,
        chapter: "",
        portionIds: [],
        itemIds: "",
      };
    }
    setDraft(next);
    setBundleOn(Boolean(preset.bundle?.enabled));
    setBundleGrain(preset.bundle?.grain ?? "portion");
    setBundleChapter("");
    setBundlePortionIds([]);
    setTeamName(preset.name);
    setDescription(preset.description ?? "");
    setDescOpen(Boolean(preset.description?.trim()));
    setFormOpen(true);
  }

  function saveAsPreset() {
    const name = teamName.trim();
    const cleanRules = rulesFromDraft(draft, true).map((rule) => ({
      ...rule,
      itemIds: undefined,
    }));
    if (!name || !cleanRules.length) return;
    const preset: TeamPreset = {
      id: uid(),
      name,
      description: description.trim() || undefined,
      rules: cleanRules,
      bundle: { enabled: bundleOn, grain: bundleGrain },
    };
    setPresets((prev) => {
      const withoutSameName = prev.filter(
        (p) => p.name.toLocaleLowerCase("es") !== name.toLocaleLowerCase("es"),
      );
      const next = [...withoutSameName, preset];
      saveTeamPresets(next);
      return next;
    });
  }

  function removePreset(id: string) {
    setPresets((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveTeamPresets(next);
      return next;
    });
  }

  const addedResources = SCOPE_KEYS.filter((key) => draft[key] != null);
  const availableResources = SCOPE_KEYS.filter((key) => draft[key] == null);
  const rules = rulesFromDraft(draft, bundleOn);
  const chapterNum = Number(bundleChapter);
  const draftTeam: Team = {
    id: editingId || "draft",
    name: teamName || "borrador",
    description,
    memberIds,
    rules,
    scope: scopeFromRules(rules),
    bundle: bundleOn
      ? {
          enabled: true,
          grain: bundleGrain,
          chapter: chapterNum > 0 ? chapterNum : undefined,
          portionIds: bundlePortionIds.length ? bundlePortionIds : undefined,
        }
      : { enabled: false, grain: bundleGrain },
  };
  const draftNotes = inventory ? tasksInScope(draftTeam, inventory.portions).length : 0;
  const draftCited = inventory
    ? articlesInGrain(draftTeam, inventory.portions, inventory.articles)
    : [];
  const draftCitedRepeat = draftCited.filter((row) => !row.firstSeenInBook).length;
  const inventoryChapters = inventory ? groupPortionsByChapter(inventory.portions) : [];

  function chapterPortionsFor(chapter: string) {
    const num = Number(chapter);
    if (!inventory || !(num > 0)) return [];
    return inventory.portions.filter((portion) => portion.chapter === num);
  }

  function saveTeam() {
    const name = teamName.trim();
    const cleanRules = rulesFromDraft(draft, bundleOn);
    if (!name || !cleanRules.length) return;
    const selectedPeople = memberIds
      .map((id) => rosterMap.get(id) ?? localMap.get(id))
      .filter((row): row is Person => Boolean(row));
    const people = mergePeople(board.people, selectedPeople);
    const bundleChapterNum = Number(bundleChapter);
    const teamFields: Omit<Team, "id"> = {
      name,
      description: description.trim(),
      memberIds: [...memberIds],
      rules: cleanRules,
      scope: scopeFromRules(cleanRules),
      bundle: {
        enabled: bundleOn,
        grain: bundleGrain,
        chapter: bundleOn && bundleChapterNum > 0 ? bundleChapterNum : undefined,
        portionIds: bundleOn && bundlePortionIds.length ? [...bundlePortionIds] : undefined,
      },
    };
    if (editingId) {
      onChange({
        ...board,
        people,
        teams: board.teams.map((t) =>
          t.id === editingId
            ? {
                ...t,
                ...teamFields,
                grain: undefined,
                grainChapter: undefined,
                grainPortionIds: undefined,
                grainItemIds: undefined,
              }
            : t,
        ),
      });
    } else {
      const team: Team = { id: uid(), ...teamFields };
      onChange({
        ...board,
        people,
        teams: [...board.teams, team],
        activeTeamId: board.activeTeamId || team.id,
      });
    }
    resetForm();
  }

  function startEdit(team: Team) {
    setFormOpen(true);
    setEditingId(team.id);
    setTeamName(team.name);
    setDescription(team.description ?? "");
    setDescOpen(Boolean(team.description?.trim()));
    setMemberIds([...team.memberIds]);
    setDraft(draftFromTeam(team));
    setBundleOn(Boolean(team.bundle?.enabled));
    setBundleGrain(team.bundle?.grain ?? "portion");
    setBundleChapter(team.bundle?.chapter ? String(team.bundle.chapter) : team.grainChapter ? String(team.grainChapter) : "");
    setBundlePortionIds(
      team.bundle?.portionIds?.length
        ? [...team.bundle.portionIds]
        : team.grainPortionIds
          ? [...team.grainPortionIds]
          : [],
    );
  }

  function removeTeam(id: string) {
    onChange({
      ...board,
      teams: board.teams.filter((t) => t.id !== id),
      activeTeamId: board.activeTeamId === id ? "" : board.activeTeamId,
      assignments: board.assignments.filter((a) => a.teamId !== id),
    });
    if (editingId === id) resetForm();
  }

  return (
    <div className="grid gap-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Integrantes</CardTitle>
          <CardDescription>
            {session
              ? "Elige personas de la organización PM. Dos equipos pueden compartir los mismos artículos: son fases distintas (p. ej. borrador y revisión)."
              : "Sin sesión DCS: añade personas a mano. Con sesión, el listado sale de la organización PM."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {session && !pmOrg ? (
            <div className="grid gap-1.5">
              <Label htmlFor="equipos-org">Organización PM</Label>
              {orgs.length ? (
                <Select value={pmOrg || "__none__"} onValueChange={(v) => onPmOrgChange(v === "__none__" ? "" : v)}>
                  <SelectTrigger id="equipos-org" className="w-full" aria-label="Organización PM">
                    <SelectValue placeholder="Elige la organización" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="__none__">— elige org —</SelectItem>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={o.name}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Elige la organización PM en Contexto para cargar el roster.
                </p>
              )}
            </div>
          ) : null}

          {session && pmOrg ? (
            <p className="text-xs text-muted-foreground">
              Roster de <strong>{pmOrg}</strong>
              {rosterLoading ? " · cargando…" : roster.length ? ` · ${roster.length} personas` : ""}
            </p>
          ) : null}

          {rosterError ? (
            <Alert variant="destructive">
              <AlertDescription>{rosterError}</AlertDescription>
            </Alert>
          ) : null}

          {session && pmOrg && !rosterLoading && !rosterError && !roster.length ? (
            <p className="text-sm text-muted-foreground">
              Esta organización no devolvió integrantes. Puedes añadir personas a mano.
            </p>
          ) : null}

          {selectable.length > 6 || roster.length > 6 ? (
            <Input
              value={rosterQuery}
              onChange={(e) => setRosterQuery(e.target.value)}
              placeholder="Buscar integrante…"
              aria-label="Buscar integrante"
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            {selectable.map((p) => (
              <Label
                key={p.id}
                className={cn(
                  "rounded-full border px-2 py-1 text-xs font-normal",
                  memberIds.includes(p.id) && "border-primary bg-primary/5",
                )}
              >
                <Checkbox
                  checked={memberIds.includes(p.id)}
                  onCheckedChange={() => toggleMember(p)}
                />
                {p.name}
                {rosterMap.has(p.id) && p.name !== p.id ? (
                  <span className="text-muted-foreground">@{p.id}</span>
                ) : null}
              </Label>
            ))}
            {!selectable.length && !rosterLoading ? (
              <span className="text-sm text-muted-foreground">
                {rosterQuery ? "Ningún integrante coincide." : "Sin personas todavía"}
              </span>
            ) : null}
          </div>

          {!session || addManualOpen ? (
            <div className="grid gap-1.5 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="local-person">
                  {session ? "Añadir a mano" : "Añadir a mano (local / sin sesión)"}
                </Label>
                {session ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setAddManualOpen(false)}
                  >
                    Ocultar
                  </button>
                ) : null}
              </div>
              <div className="flex gap-1.5">
                <Input
                  id="local-person"
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder="Nombre"
                  aria-label="Nombre de la persona"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPerson();
                    }
                  }}
                />
                <Button type="button" onClick={addPerson} disabled={!personName.trim()}>
                  Añadir
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="justify-self-start border-t pt-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setAddManualOpen(true)}
            >
              + Añadir persona a mano
            </button>
          )}
          <div className="grid gap-1.5">
            {board.people.filter((p) => !rosterMap.has(p.id)).length ? (
              <div className="max-h-40 overflow-auto">
                {board.people
                  .filter((p) => !rosterMap.has(p.id))
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0"
                    >
                      <strong className="font-medium">{p.name}</strong>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removePerson(p.id)}>
                        Quitar
                      </Button>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {formOpen ? (
      <Card size="sm">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{editingId ? "Editar equipo" : "Nuevo equipo"}</CardTitle>
          <Badge variant="secondary">{board.teams.length}</Badge>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!editingId && presets.length ? (
            <div className="grid gap-1.5 rounded-lg border border-dashed p-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Empezar desde un preset
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pl-2.5 pr-1 text-xs"
                  >
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => applyPreset(preset)}
                      title={preset.rules.map((r) => scopeRuleLabel(r, r.grain)).join(" · ")}
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Eliminar preset ${preset.name}`}
                      className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                      onClick={() => removePreset(preset.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="team-name">Nombre</Label>
            <Input
              id="team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="p. ej. Preparación mixta"
              aria-label="Nombre del equipo"
            />
          </div>
          {descOpen ? (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="team-desc">Descripción (fase)</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setDescription("");
                    setDescOpen(false);
                  }}
                >
                  Quitar
                </button>
              </div>
              <textarea
                id="team-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="p. ej. Fase 1 · Borrador"
                aria-label="Descripción del equipo"
                rows={2}
                autoFocus
                className="min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              />
            </div>
          ) : (
            <button
              type="button"
              className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setDescOpen(true)}
            >
              + Añadir descripción de fase
            </button>
          )}

          <div className="grid gap-2">
            <Collapsible open={scopeHelpOpen} onOpenChange={setScopeHelpOpen}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Alcance y grano por recurso
                </h3>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    ¿Cómo funciona?
                    <ChevronDown
                      className={cn("size-3 transition-transform", scopeHelpOpen && "rotate-180")}
                    />
                  </button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <p className="pt-1 text-xs text-muted-foreground">
                  Cada recurso tiene su filtro y su grano. Academia en <strong>ítems / lista</strong> es
                  el catálogo del libro (un artículo). <strong>Por referencias en porciones</strong> usa
                  las citas de cada porción, una fila por cita si incluyes duplicados. Notas y Preguntas
                  pueden ser ítems, porciones o los ítems de esas porciones. Nunca se muestra TWL.
                </p>
              </CollapsibleContent>
            </Collapsible>
            {availableResources.length ? (
              <div className="flex flex-wrap gap-1.5">
                {availableResources.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => toggleResource(key)}
                  >
                    + {SCOPE_LABEL[key]}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="grid gap-2">
              {addedResources.map((key) => {
                const row = draft[key] as ResourceDraft;
                const filter = row.articleFilter;
                const grain = row.grain;
                const options = filtersForResource(key);
                const matchCount = inventory
                  ? ruleItemCount(
                      {
                        resource: key,
                        articleFilter: filter,
                        grain,
                        stayInChapter: row.stayInChapter,
                        includeDuplicates: row.includeDuplicates,
                        chapter: bundleOn
                          ? chapterNum > 0
                            ? chapterNum
                            : undefined
                          : row.stayInChapter && Number(row.chapter) > 0
                            ? Number(row.chapter)
                            : undefined,
                        portionIds: bundleOn
                          ? bundlePortionIds.length
                            ? bundlePortionIds
                            : undefined
                          : row.portionIds.length
                            ? row.portionIds
                            : undefined,
                      },
                      inventory.portions,
                      inventory.articles,
                      draftTeam,
                    )
                  : null;
                const geoChapter = bundleOn ? bundleChapter : row.chapter ?? "";
                const geoPortions = chapterPortionsFor(geoChapter);
                return (
                  <div key={key} className="grid gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-24 text-sm font-medium">{SCOPE_LABEL[key]}</span>
                      <div className="ml-auto flex items-center gap-2">
                        {matchCount != null ? (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {matchCount} {matchCount === 1 ? "ítem" : "ítems"}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Quitar ${SCOPE_LABEL[key]}`}
                          className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                          onClick={() => toggleResource(key)}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-2">
                        <Select
                          value={filter}
                          onValueChange={(value) =>
                            patchResource(key, { articleFilter: value as ArticleFilter })
                          }
                        >
                          <SelectTrigger
                            className="w-full min-w-0"
                            size="sm"
                            aria-label={`Filtro de ${SCOPE_LABEL[key]}`}
                          >
                            <SelectValue>{articleFilterLabel(key, filter, grain)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent position="popper">
                            {options.map((value) => (
                              <SelectItem key={value} value={value}>
                                {articleFilterLabel(key, value, grain)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={grain}
                          onValueChange={(value) =>
                            patchResource(key, { grain: value as AssignmentGrain })
                          }
                        >
                          <SelectTrigger
                            className="w-full min-w-0"
                            size="sm"
                            aria-label={`Grano de ${SCOPE_LABEL[key]}`}
                          >
                            <SelectValue>{GRAIN_LABEL[grain]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent position="popper">
                            {grainsForResource(key).map((value) => (
                              <SelectItem key={value} value={value}>
                                {GRAIN_LABEL[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {grain === "item" && isArticleResource(key) ? (
                          <p className="text-xs text-muted-foreground">
                            Lista = catálogo de {SCOPE_LABEL[key]} del libro (un artículo, aunque se
                            cite varias veces).
                          </p>
                        ) : null}
                        {grain === "portionRefs" && isArticleResource(key) ? (
                          <p className="text-xs text-muted-foreground">
                            {filter === "pending"
                              ? `Citas de ${SCOPE_LABEL[key]} en las porciones. Pendientes oculta los ya traducidos; elige Todos para incluirlos.`
                              : `Citas de ${SCOPE_LABEL[key]} en las porciones, incluidos traducidos. Con duplicados, una fila por porción que cita.`}
                          </p>
                        ) : null}
                        {grain === "portionRefs" && !isArticleResource(key) ? (
                          <p className="text-xs text-muted-foreground">
                            Cada nota o pregunta de las porciones elegidas es un ítem.
                          </p>
                        ) : null}
                        <Label className="font-normal text-xs">
                          <Checkbox
                            checked={row.stayInChapter}
                            onCheckedChange={(checked) =>
                              patchResource(key, { stayInChapter: checked === true })
                            }
                            disabled={bundleOn}
                          />
                          No cruzar capítulos
                        </Label>
                        {isArticleResource(key) && grain === "portionRefs" ? (
                          <Label className="font-normal text-xs">
                            <Checkbox
                              checked={row.includeDuplicates}
                              onCheckedChange={(checked) =>
                                patchResource(key, { includeDuplicates: checked === true })
                              }
                            />
                            Incluir duplicados (Ya citado)
                          </Label>
                        ) : null}
                        {!bundleOn && needsGeoPickers(row) ? (
                          <>
                            <div className="grid gap-1.5">
                              <Label htmlFor={`rule-chapter-${key}`}>Capítulo</Label>
                              <Select
                                value={row.chapter || "__none__"}
                                onValueChange={(v) =>
                                  patchResource(key, {
                                    chapter: v === "__none__" ? "" : v,
                                    portionIds: [],
                                  })
                                }
                              >
                                <SelectTrigger
                                  id={`rule-chapter-${key}`}
                                  className="w-full"
                                  aria-label={`Capítulo de ${SCOPE_LABEL[key]}`}
                                >
                                  <SelectValue placeholder="Elige capítulo" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectItem value="__none__">
                                    {row.stayInChapter
                                      ? "— capítulo (recomendado) —"
                                      : "— todo el libro —"}
                                  </SelectItem>
                                  {inventoryChapters.map((group) => (
                                    <SelectItem key={group.chapter} value={String(group.chapter)}>
                                      Capítulo {group.chapter} · {group.portions.length} porciones
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {geoPortions.length ? (
                              <div className="grid gap-1.5">
                                <Label>Porciones del capítulo</Label>
                                <div className="max-h-40 overflow-auto rounded-lg border p-2">
                                  {geoPortions.map((portion, index) => {
                                    const portionId = portionKey(portion);
                                    return (
                                      <Label
                                        key={portionId}
                                        className="flex items-center gap-2 py-1 font-normal"
                                      >
                                        <Checkbox
                                          checked={row.portionIds.includes(portionId)}
                                          onCheckedChange={() =>
                                            patchResource(key, {
                                              portionIds: row.portionIds.includes(portionId)
                                                ? row.portionIds.filter((id) => id !== portionId)
                                                : [...row.portionIds, portionId],
                                            })
                                          }
                                        />
                                        <span>
                                          {index + 1}. {portion.ref}
                                        </span>
                                      </Label>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {key === "notas" || key === "preguntas" ? (
                          <div className="grid gap-1.5">
                            <Label htmlFor={`rule-ids-${key}`}>IDs explícitos (opcional)</Label>
                            <Input
                              id={`rule-ids-${key}`}
                              value={row.itemIds}
                              onChange={(e) => patchResource(key, { itemIds: e.target.value })}
                              placeholder="p. ej. bi9h abc1 qd3e"
                              aria-label={`IDs explícitos de ${SCOPE_LABEL[key]}`}
                            />
                          </div>
                        ) : null}
                      </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border p-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="font-medium">
                <Checkbox
                  checked={bundleOn}
                  onCheckedChange={(checked) => setBundleOn(checked === true)}
                />
                Asignar juntos
              </Label>
              <Collapsible open={bundleHelpOpen} onOpenChange={setBundleHelpOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    ¿Qué es esto?
                    <ChevronDown
                      className={cn("size-3 transition-transform", bundleHelpOpen && "rotate-180")}
                    />
                  </button>
                </CollapsibleTrigger>
              </Collapsible>
            </div>
            <Collapsible open={bundleHelpOpen} onOpenChange={setBundleHelpOpen}>
              <CollapsibleContent>
                <p className="text-xs text-muted-foreground">
                  La misma persona recibe todos los recursos listados para esa unidad: una porción, las
                  porciones elegidas de un capítulo, o un capítulo entero. Autoasignar reparte lotes, no
                  notas y academia por separado.
                </p>
              </CollapsibleContent>
            </Collapsible>
            {bundleOn ? (
              <div className="grid gap-2">
                <Select
                  value={bundleGrain}
                  onValueChange={(value) => {
                    setBundleGrain(value as BundleGrain);
                    if (value === "chapter") setBundlePortionIds([]);
                  }}
                >
                  <SelectTrigger className="w-full" aria-label="Grano compartido">
                    <SelectValue>{BUNDLE_GRAIN_LABEL[bundleGrain]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {BUNDLE_GRAINS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {BUNDLE_GRAIN_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid gap-1.5">
                  <Label htmlFor="bundle-chapter">Capítulo</Label>
                  <Select
                    value={bundleChapter || "__none__"}
                    onValueChange={(v) => {
                      setBundleChapter(v === "__none__" ? "" : v);
                      setBundlePortionIds([]);
                    }}
                  >
                    <SelectTrigger id="bundle-chapter" className="w-full" aria-label="Capítulo del lote">
                      <SelectValue placeholder="Elige capítulo" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="__none__">— capítulo —</SelectItem>
                      {inventoryChapters.map((group) => (
                        <SelectItem key={group.chapter} value={String(group.chapter)}>
                          Capítulo {group.chapter} · {group.portions.length} porciones
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {bundleGrain !== "chapter" && chapterPortionsFor(bundleChapter).length ? (
                  <div className="grid gap-1.5">
                    <Label>Porciones del capítulo</Label>
                    <div className="max-h-40 overflow-auto rounded-lg border p-2">
                      {chapterPortionsFor(bundleChapter).map((portion, index) => {
                        const portionId = portionKey(portion);
                        return (
                          <Label key={portionId} className="flex items-center gap-2 py-1 font-normal">
                            <Checkbox
                              checked={bundlePortionIds.includes(portionId)}
                              onCheckedChange={() =>
                                setBundlePortionIds((prev) =>
                                  prev.includes(portionId)
                                    ? prev.filter((id) => id !== portionId)
                                    : [...prev, portionId],
                                )
                              }
                            />
                            <span>
                              {index + 1}. {portion.ref}
                            </span>
                          </Label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {inventory && (draft.notas != null || draft.academia != null) ? (
            <p className="text-xs text-muted-foreground">
              {draft.notas != null
                ? `${draftNotes} ${draftNotes === 1 ? "nota" : "notas"}`
                : null}
              {draft.notas != null && draft.academia != null ? " · " : null}
              {draft.academia != null
                ? `${draftCited.filter((row) => row.kind === "Translation Academy").length} Academia${
                    draftCitedRepeat
                      ? ` · ${draftCitedRepeat} ya citada${draftCitedRepeat === 1 ? "" : "s"}`
                      : ""
                  }`
                : null}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            <Button type="button" onClick={saveTeam} disabled={!teamName.trim() || !rules.length}>
              {editingId ? "Guardar cambios" : "Crear equipo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={saveAsPreset}
              disabled={!teamName.trim() || !rules.length}
              title="Guarda el alcance y grano de este equipo para reusarlo en otro libro, sin los integrantes ni las porciones específicas"
            >
              Guardar como preset
            </Button>
            <Button type="button" variant="secondary" onClick={resetForm}>
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="justify-self-start rounded-full"
          onClick={() => setFormOpen(true)}
        >
          + Nuevo equipo
        </Button>
      )}

      <div className="grid gap-2">
        {board.teams.map((team) => {
          const phases = overlappingTeams(team, board.teams);
          const members = team.memberIds
            .map((id) => localMap.get(id))
            .filter((row): row is Person => Boolean(row));
          return (
            <div
              key={team.id}
              className={cn(
                "rounded-lg border p-2.5",
                board.activeTeamId === team.id && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <strong className="font-medium">{team.name}</strong>
                <div className="flex flex-wrap gap-1">
                  {board.activeTeamId === team.id ? <Badge>Activo</Badge> : null}
                  {phases.length ? <Badge variant="secondary">Fase compartida</Badge> : null}
                  {bundleEnabled(team) ? <Badge variant="secondary">Juntos</Badge> : null}
                </div>
              </div>
              {team.description?.trim() ? (
                <p className="mb-2 text-sm text-muted-foreground">{team.description.trim()}</p>
              ) : (
                <p className="mb-2 text-xs text-muted-foreground">Sin descripción de fase.</p>
              )}
              <div className="mb-2 flex flex-wrap items-center gap-1">
                {bundleEnabled(team) && team.bundle ? (
                  <Badge variant="outline">{BUNDLE_GRAIN_LABEL[team.bundle.grain]}</Badge>
                ) : team.grain ? (
                  <Badge variant="outline">{GRAIN_LABEL[team.grain]}</Badge>
                ) : null}
                {teamRules(team).map((rule) => (
                  <Badge key={`${rule.resource}-${rule.articleFilter}`} variant="outline">
                    {scopeRuleLabel(rule, resolvedRuleGrain(team, rule))}
                  </Badge>
                ))}
                <span className="text-xs text-muted-foreground">
                  {members.length} integrante{members.length === 1 ? "" : "s"}
                </span>
              </div>
              {phases.length ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  Mismo recurso que{" "}
                  {phases.map((p) => (p.description.trim() ? `${p.name} (${p.description.trim()})` : p.name)).join(", ")}
                  . Cada fase tiene su propia cola.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onChange({ ...board, activeTeamId: team.id })}
                >
                  Usar en Asignar
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(team)}>
                  Editar
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeTeam(team.id)}>
                  Eliminar
                </Button>
              </div>
            </div>
          );
        })}
        {!board.teams.length ? (
          <Card size="sm" className="border-dashed">
            <CardHeader>
              <CardTitle>Sin equipos</CardTitle>
              <CardDescription>
                Crea un equipo mezclando recursos con grano propio (p. ej. Academia por citas +
                Notas por ítems). Marca Asignar juntos si la misma persona debe llevar ambos en
                cada porción o capítulo.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
