/**
 * Round-trip: legacy schema-1 → normalize → persist schema-2 → normalize.
 * Plus ScriptureScope chapter matching.
 * Run: npx tsx scripts/verify-assignments-persist.mts
 */
import {
  emptyAssignments,
  normalizeAssignmentsDoc,
  toPersistDoc,
} from "../src/domain/store.ts";
import {
  filterPortionsByScriptureScope,
  portionsMatchingGrain,
} from "../src/domain/assignment.ts";
import type { Portion, Team } from "../src/domain/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const legacy = {
  schema: "gateway-assignments-1",
  book: "NEH",
  lang: "es-419",
  contentOrg: "es-419_gl",
  pmOrg: "es-419_gl",
  people: [{ id: "p1", name: "Ana" }],
  teams: [
    {
      id: "t1",
      name: "Traducir TPL",
      description: "Fase borrador",
      memberIds: ["p1"],
      scope: ["tpl"],
      rules: [{ resource: "tpl", articleFilter: "pending" }],
    },
  ],
  assignments: [],
};

const loaded = normalizeAssignmentsDoc(legacy, {
  book: "NEH",
  lang: "es-419",
  contentOrg: "es-419_gl",
  pmOrg: "es-419_gl",
});

assert(loaded.schema === "gateway-assignments-2", "bump to schema 2 in memory");
assert(loaded.projectId === "NEH", "projectId from legacy book");
assert(loaded.books.length === 1 && loaded.books[0] === "NEH", "books inferred");
assert(loaded.kind === "book", "kind book");
assert(loaded.phases.length >= 1, "expected synthesized phases");
assert(loaded.teams.length === 1, "expected one task");
assert(loaded.teams[0].phaseId, "task needs phaseId");

const wire = toPersistDoc(loaded);
assert(wire.schema === "gateway-assignments-2", "wire schema 2");
assert(wire.projectId === "NEH", "wire.projectId");
assert(wire.book === "NEH", "legacy book mirror");
assert(Array.isArray(wire.books) && wire.books[0] === "NEH", "wire.books");
assert(wire.kind === "book", "wire.kind");
assert(Array.isArray(wire.phases) && wire.phases.length, "wire.phases");
assert(Array.isArray(wire.tasks) && wire.tasks.length === 1, "wire.tasks");
assert(!("teams" in wire) || (wire as { teams?: unknown }).teams == null, "no teams mirror on write");

const reloaded = normalizeAssignmentsDoc(wire, {
  book: "NEH",
  lang: "es-419",
  contentOrg: "es-419_gl",
  pmOrg: "es-419_gl",
});
assert(reloaded.teams[0].name === "Traducir TPL", "name preserved from tasks");
assert(reloaded.phases.some((p) => p.id === reloaded.teams[0].phaseId), "phase link");
assert(reloaded.projectId === "NEH", "projectId round-trip");
assert(reloaded.phases.every((p) => p.slug), "legacy phases get a derived slug");
assert(wire.phases.every((p) => p.slug), "persist writes slug through");

const unnamed = normalizeAssignmentsDoc(
  {
    schema: "gateway-assignments-2",
    projectId: "NEH",
    book: "NEH",
    title: "Nehemías",
    kind: "book",
    books: ["NEH"],
    lang: "es-419",
    contentOrg: "o",
    pmOrg: "p",
    people: [],
    phases: [{ id: "phase-default", name: "Fase 1", order: 0 }],
    teams: [],
    assignments: [],
  },
  { book: "NEH", lang: "es-419", contentOrg: "o", pmOrg: "p" },
);
assert(unnamed.phases[0].slug === "fase-1", "missing slug derived from name");
const unnamedWire = toPersistDoc(unnamed);
assert(unnamedWire.phases[0].slug === "fase-1", "derived slug persisted");

const customPhase = normalizeAssignmentsDoc(
  {
    ...unnamed,
    phases: [{ id: "p-rev", name: "Revisión", slug: "revision", order: 0 }],
  },
  { book: "NEH", lang: "es-419", contentOrg: "o", pmOrg: "p" },
);
assert(customPhase.phases[0].slug === "revision", "explicit slug kept");

// Legacy teams-only doc still loads.
const fromTeamsOnly = normalizeAssignmentsDoc(
  {
    schema: "gateway-assignments-1",
    book: "TIT",
    lang: "es-419",
    contentOrg: "o",
    pmOrg: "p",
    people: [],
    teams: [
      {
        id: "legacy",
        name: "Solo teams",
        description: "",
        memberIds: [],
        scope: ["tpl"],
        rules: [{ resource: "tpl", articleFilter: "pending" }],
      },
    ],
    assignments: [],
  },
  { book: "TIT", lang: "es-419", contentOrg: "o", pmOrg: "p" },
);
assert(fromTeamsOnly.teams[0].id === "legacy", "dual-read teams when no tasks");

// Prefer tasks when both differ in length.
const preferTasks = normalizeAssignmentsDoc(
  {
    ...emptyAssignments("TIT", "es-419", "o", "p"),
    teams: [
      {
        id: "old",
        name: "Viejo",
        description: "",
        phaseId: "phase-default",
        memberIds: [],
        scope: [],
        rules: [],
      },
    ],
    tasks: [
      {
        id: "new",
        name: "Nuevo",
        description: "",
        phaseId: "phase-default",
        memberIds: [],
        scope: ["tpl"],
        rules: [{ resource: "tpl", articleFilter: "pending" }],
      },
    ],
  },
  { book: "TIT", lang: "es-419", contentOrg: "o", pmOrg: "p" },
);
assert(preferTasks.teams[0].id === "new", "prefer non-empty tasks over teams");

// ScriptureScope: chapters 1–3 only
const portions: Portion[] = [1, 2, 3, 4, 5].map((chapter) => ({
  id: `p${chapter}`,
  ref: `${chapter}:1`,
  chapter,
  book: "NEH",
  verses: [1],
  tpl: 1,
  tps: 0,
  notas: 0,
  preguntas: 0,
  tplItems: [{ id: `tpl-p${chapter}`, ref: `${chapter}:1`, chapter, portionId: `p${chapter}`, resource: "tpl" as const }],
  tpsItems: [],
  notasItems: [],
  preguntasItems: [],
  academia: [],
  palabras: [],
}));

const scoped = filterPortionsByScriptureScope(portions, {
  mode: "chapters",
  book: "NEH",
  chapters: [1, 2, 3],
});
assert(scoped.length === 3, "chapters 1-3");
assert(scoped.every((p) => p.chapter <= 3), "no chapter > 3");

const team: Team = {
  id: "t-scope",
  name: "Caps 1-3",
  description: "",
  phaseId: "phase-default",
  memberIds: [],
  scope: ["tpl"],
  rules: [{ resource: "tpl", articleFilter: "pending", grain: "portion" }],
  scriptureScope: { mode: "chapters", book: "NEH", chapters: [1, 2, 3] },
};
const grain = portionsMatchingGrain(team, portions, {
  projectBooks: ["NEH"],
  fallbackBook: "NEH",
});
assert(grain.length === 3, "portionsMatchingGrain respects scriptureScope");

// Thematic project meta
const thematic = normalizeAssignmentsDoc(
  {
    schema: "gateway-assignments-2",
    projectId: "pentateuco-r1",
    title: "Pentateuco ronda 1",
    kind: "thematic",
    books: ["GEN", "EXO"],
    lang: "es-419",
    contentOrg: "o",
    pmOrg: "p",
    people: [],
    phases: [],
    tasks: [],
    teams: [],
    assignments: [],
  },
  { book: "pentateuco-r1", lang: "es-419", contentOrg: "o", pmOrg: "p" },
);
assert(thematic.kind === "thematic", "thematic kind");
assert(thematic.books.join(",") === "GEN,EXO", "thematic books");
const thematicWire = toPersistDoc(thematic);
assert(thematicWire.projectId === "pentateuco-r1", "thematic projectId");
assert(thematicWire.book === "pentateuco-r1", "mirror book = projectId");

console.log("verify-assignments-persist: ok");
