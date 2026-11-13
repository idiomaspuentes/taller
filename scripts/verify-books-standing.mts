/**
 * Every book of a space and how far it is, including the work done before Taller: the books finished elsewhere
 * (Titus, published), the ones brought in the middle (Ephesians, Esther) and the ones begun here (Nehemiah). What was
 * done elsewhere is listed in a record of the plan repository (`fuera-de-taller.json`), never as subtareas.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { chaptersOf } from "../src/domain/bookChapters";
import { bookStanding, orderBooks, planWithTeams, spaceBooks } from "../src/domain/bookStanding";
import { chaptersDoneElsewhere, doneElsewherePath, normalizeDoneElsewhere } from "../src/domain/doneElsewhere";
import { setActiveScope } from "../src/domain/scope";
import { mergeProjectsIndex } from "../src/domain/store";
import { emptyTaskProgress, encodeTaskProgressMarker, markStepDone, withStepWork, type TaskProgressMarker } from "../src/domain/taskProgress";
import type { AssignmentsDoc, ProjectTask } from "../src/domain/types";
import { percentOf } from "../src/domain/workProgress";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const rule = { resource: "tpl" as const, articleFilter: "pending" as const };
const task = (id: string, phaseId: string, steps: string[], orgTeamName?: string): ProjectTask =>
  ({ id, name: id, description: "", phaseId, memberIds: [], scope: ["tpl"], rules: [rule], steps: steps.map((step) => ({ id: step, name: step })), ...(orgTeamName ? { orgTeamName } : {}) }) as ProjectTask;
const plan: Pick<AssignmentsDoc, "teams" | "phases"> = {
  phases: [{ id: "f1", name: "Traducción", slug: "t", order: 0 }, { id: "f2", name: "Afinación", slug: "a", order: 1 }],
  teams: [task("tpl", "f1", ["borrador", "pares"], "pm-tpl"), task("tps", "f1", ["borrador"], "pm-tps"), task("articulos", "f1", ["borrador"], "pm-ayudas"), task("alinear", "f2", ["alinear"], "pm-tpl")],
};

let n = 0;
function issue(taskId: string, chapter: number, o: { closed?: boolean; marker?: TaskProgressMarker; label?: boolean } = {}): DcsIssue {
  n++;
  const portion = `EPH-${String(chapter).padStart(2, "0")}-01`;
  const order = JSON.stringify({ schema: "gateway-work-order-1", key: `${taskId}|${portion}|${n}`, book: "EPH", teamId: taskId, resource: "tpl", portionIds: [portion], itemIds: [] });
  return {
    id: n, number: n, title: `EPH · ${taskId}`, state: o.closed ? "closed" : "open",
    body: `<!-- gateway-work-order ${order} -->\n${o.marker ? encodeTaskProgressMarker(o.marker) : ""}`,
    labels: [{ name: `pm/tarea:${taskId}` }, ...(o.label === false ? [] : [{ name: `pm/cap:${chapter}` }])],
  } as unknown as DcsIssue;
}
const done = (ids: string[], brought = false): TaskProgressMarker => {
  const marker = ids.reduce((m, id) => markStepDone(m, id), emptyTaskProgress());
  return brought ? { ...marker, brought: { from: "translationCore", at: "2026-10-15T00:00:00Z" } } : marker;
};

test("cada libro sabe cuántos capítulos tiene, con la numeración de los textos puente", () => {
  assert.deepEqual(["TIT", "EPH", "NEH", "EST", "EZR", "PSA", "MAL", "JOL"].map(chaptersOf), [3, 6, 13, 10, 10, 150, 4, 3]);
  assert.equal(chaptersOf("tit"), 3, "sin importar mayúsculas");
  assert.equal(chaptersOf("XYZ"), 0, "un libro que no existe no tiene capítulos");
});

test("el registro guarda, por libro, de dónde vino el trabajo y qué capítulos de cada tarea se hicieron", () => {
  const doc = normalizeDoneElsewhere({
    schema: "taller-fuera-1",
    process: "fcr-base",
    books: {
      tit: { from: "publicado", at: "2026-08-11", tasks: "todo" },
      EPH: { from: "translationCore", tasks: { tpl: "todo", tps: [3, 1, 2, 2, "x", 0, -1], vacia: [], rara: 7 } },
      "": { from: "x", tasks: "todo" },
      MAL: "todo",
    },
  });
  assert.deepEqual(Object.keys(doc.books), ["TIT", "EPH"], "en mayúsculas, y sin lo que no es un libro con su tarea");
  assert.equal(doc.process, "fcr-base");
  assert.equal(doc.books.TIT!.tasks, "todo");
  assert.deepEqual(doc.books.EPH!.tasks, { tpl: "todo", tps: [1, 2, 3] }, "los capítulos en orden, una vez cada uno, solo números de capítulo");
  assert.deepEqual(normalizeDoneElsewhere(null).books, {}, "sin registro, ningún libro");
  assert.deepEqual(normalizeDoneElsewhere({ schema: "otro", books: { TIT: { from: "x", tasks: "todo" } } }).books, {}, "otro formato no se lee como este");
});

test("los capítulos hechos fuera de una tarea: todos, los que dice, o ninguno", () => {
  const doc = normalizeDoneElsewhere({ schema: "taller-fuera-1", books: { TIT: { from: "publicado", tasks: "todo" }, EPH: { from: "tc", tasks: { tpl: "todo", tps: [1, 2, 9] } } } });
  assert.deepEqual([...chaptersDoneElsewhere(doc.books.TIT, "alinear", 3)], [1, 2, 3]);
  assert.deepEqual([...chaptersDoneElsewhere(doc.books.EPH, "tpl", 6)], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...chaptersDoneElsewhere(doc.books.EPH, "tps", 6)], [1, 2], "un capítulo que el libro no tiene no cuenta");
  assert.deepEqual([...chaptersDoneElsewhere(doc.books.EPH, "alinear", 6)], []);
  assert.deepEqual([...chaptersDoneElsewhere(undefined, "tpl", 6)], []);
});

test("el registro vive junto al índice de proyectos del espacio", () => {
  setActiveScope("");
  assert.equal(doneElsewherePath("ES-419"), "es-419/fuera-de-taller.json");
  setActiveScope("pt");
  assert.equal(doneElsewherePath("pt-br"), "pt/pt-br/fuera-de-taller.json", "en un espacio con alcance, bajo su carpeta");
  setActiveScope("");
});

test("un libro publicado antes de Taller está entero, y todo hecho antes", () => {
  const doc = normalizeDoneElsewhere({ schema: "taller-fuera-1", books: { TIT: { from: "publicado", tasks: "todo" } } });
  const tit = bookStanding({ book: "TIT", plan, issues: [], elsewhere: doc.books.TIT });
  assert.equal(tit.fraction, 1);
  assert.equal(tit.before, 1);
  assert.equal(tit.started, false, "en Taller no se ha hecho nada");
  assert.deepEqual(tit.phases.map((phase) => [phase.phaseId, phase.fraction, phase.tasks.length]), [["f1", 1, 3], ["f2", 1, 1]], "todas las tareas del proceso, por fase");
});

test("un libro migrado a medias va por lo que dice el registro: cada tarea vale lo mismo, cada capítulo también", () => {
  const doc = normalizeDoneElsewhere({ schema: "taller-fuera-1", books: { EPH: { from: "translationCore", tasks: { tpl: "todo", tps: [1, 2, 3] } } } });
  const eph = bookStanding({ book: "EPH", plan, issues: [], elsewhere: doc.books.EPH });
  const of = (id: string) => eph.phases.flatMap((phase) => phase.tasks).find((row) => row.taskId === id)!;
  assert.deepEqual([of("tpl").fraction, of("tps").fraction, of("articulos").fraction, of("alinear").fraction], [1, 0.5, 0, 0]);
  assert.equal(eph.fraction, 1.5 / 4);
  assert.equal(eph.before, eph.fraction, "todo lo hecho fue antes de Taller");
  assert.equal(percentOf(eph.phases[0]!.fraction), 50);
});

test("un capítulo del registro no se cuenta otra vez por sus subtareas, y los demás van por las subtareas", () => {
  const doc = normalizeDoneElsewhere({ schema: "taller-fuera-1", books: { EPH: { from: "tc", tasks: { tpl: [1, 2] } } } });
  const issues = [
    issue("tpl", 1, { marker: withStepWork(emptyTaskProgress(), "borrador", { done: 1, total: 4 }) }),
    issue("tpl", 3, { closed: true, marker: done(["borrador", "pares"]) }),
    issue("tpl", 4, { marker: done(["borrador"]) }),
    issue("tpl", 4),
  ];
  const tpl = bookStanding({ book: "EPH", plan, issues, elsewhere: doc.books.EPH }).phases[0]!.tasks.find((row) => row.taskId === "tpl")!;
  // Chapters 1–2 from the record (the open subtarea of 1 does not count again), 3 closed, 4 half of one subtarea of two.
  assert.equal(tpl.chapters, 4);
  assert.equal(tpl.fraction, (1 + 1 + 1 + 0.25) / 4);
  assert.equal(tpl.before, 2 / 4, "lo hecho antes son los dos capítulos del registro");
});

test("el capítulo de una subtarea sale de su etiqueta, o de su porción cuando no la tiene", () => {
  const elsewhere = normalizeDoneElsewhere({ schema: "taller-fuera-1", books: { EPH: { from: "tc", tasks: { tpl: [2] } } } }).books.EPH;
  const tpl = bookStanding({ book: "EPH", plan, issues: [issue("tpl", 2, { label: false })], elsewhere }).phases[0]!.tasks.find((row) => row.taskId === "tpl")!;
  // Read as chapter 2, the subtarea is the work of that chapter, which the record already has done: one chapter, done.
  assert.deepEqual([tpl.chapters, tpl.fraction], [1, 1]);
});

test("en un libro que ya se trabaja en Taller, una tarea sin ninguna subtarea no tenía nada que hacer: no cuenta como 0 %", () => {
  // Esther, 13 November: its 173 words and articles were translated before, so «Traducir Palabras» and «Traducir
  // Academia» laid out nothing, and «Libros» said 0 % of the translation of both.
  const issues = [issue("tpl", 1, { closed: true, marker: done(["borrador", "pares"]) })];
  const book = bookStanding({ book: "EPH", plan, issues });
  const articles = book.phases[0]!.tasks.find((r) => r.taskId === "articulos")!;
  assert.deepEqual([articles.nothing, articles.chapters], [true, 0]);
  const tpl = book.phases[0]!.tasks.find((r) => r.taskId === "tpl")!;
  const tps = book.phases[0]!.tasks.find((r) => r.taskId === "tps")!;
  assert.equal(tps.nothing, true, "lo mismo cualquier tarea que el plan no repartió");
  assert.equal(book.phases[0]!.fraction, tpl.fraction, "la fase va por las tareas que tienen trabajo");
  const fresh = bookStanding({ book: "EPH", plan, issues: [] }).phases[0]!.tasks.find((r) => r.taskId === "articulos")!;
  assert.deepEqual([fresh.nothing, fresh.fraction, fresh.chapters], [undefined, 0, 6], "en un libro que aún no se trabaja aquí, todo está por hacer");
  const allNothing = bookStanding({ book: "EPH", plan: { ...plan, teams: plan.teams.filter((t) => t.id !== "tpl") }, issues: [issue("alinear", 1)] });
  assert.equal(allNothing.phases.find((p) => p.phaseId === "f1")!.nothing, true, "una fase sin nada que hacer lo dice, en vez de 0 %");
});

test("una tarea que no trabaja todos los capítulos (artículos) se mide por los capítulos que tienen subtareas", () => {
  const issues = [issue("articulos", 1, { closed: true, marker: done(["borrador"]) }), issue("articulos", 5)];
  const row = bookStanding({ book: "EPH", plan, issues }).phases[0]!.tasks.find((r) => r.taskId === "articulos")!;
  assert.equal(row.chapters, 2, "los capítulos sin artículos no son trabajo que falta");
  assert.equal(row.fraction, 0.5);
});

test("lo traído de translationCore como subtareas cerradas (Ester, Esdras) cuenta como hecho antes de Taller", () => {
  const issues = [issue("tpl", 1, { closed: true, marker: done(["borrador", "pares"], true) }), issue("tpl", 2, { closed: true, marker: done(["borrador", "pares"]) })];
  const row = bookStanding({ book: "EPH", plan, issues }).phases[0]!.tasks.find((r) => r.taskId === "tpl")!;
  assert.equal(row.fraction, 1);
  assert.equal(row.before, 0.5);
});

test("quien coordina un equipo ve solo las tareas de su equipo", () => {
  const doc = normalizeDoneElsewhere({ schema: "taller-fuera-1", books: { EPH: { from: "tc", tasks: { tpl: "todo" } } } });
  const mine = bookStanding({ book: "EPH", plan, issues: [], elsewhere: doc.books.EPH, teams: ["PM-TPL"] });
  assert.deepEqual(mine.phases.flatMap((phase) => phase.tasks.map((row) => row.taskId)), ["tpl", "alinear"]);
  assert.equal(mine.fraction, 0.5);
  assert.equal(bookStanding({ book: "EPH", plan, issues: [], teams: ["pm-otro"] }).phases.length, 0, "sin tareas de su equipo, nada que mostrar");
});

test("un libro sin proyecto en Taller toma las tareas del proceso, con el equipo que tienen en los proyectos del espacio", () => {
  const process = { phases: plan.phases, teams: plan.teams.map((row) => ({ ...row, orgTeamName: undefined })) as ProjectTask[] };
  const withTeams = planWithTeams(process, [plan]);
  assert.deepEqual(withTeams.teams.map((row) => row.orgTeamName), ["pm-tpl", "pm-tps", "pm-ayudas", "pm-tpl"]);
  assert.equal(planWithTeams(process, []).teams[0]!.orgTeamName, undefined);
});

test("los libros salen: los que se trabajan en Taller (en su orden), los que esperan migrar, los pausados y al final los terminados", () => {
  const row = (book: string, fraction: number, started: boolean) => ({ book, fraction, started });
  const books = [row("TIT", 1, false), row("NEH", 0.02, true), row("EPH", 0.4, false), row("EST", 0.6, true), row("RUT", 1, false), row("EZR", 0.5, true), row("PHM", 0.1, false)];
  assert.deepEqual(orderBooks(books, { projectOrder: ["EST", "EZR", "NEH"], paused: ["EPH"] }).map((r) => r.book), ["EST", "EZR", "NEH", "PHM", "EPH", "RUT", "TIT"]);
});

test("guardar el índice de proyectos agrega el libro nuevo a lo que ya había en Door43, sin borrar los demás", () => {
  const remote = [{ projectId: "EZR", title: "Esdras", kind: "book" as const, books: ["EZR"] }, { projectId: "EST", title: "Ester", kind: "book" as const, books: ["EST"] }];
  const merged = mergeProjectsIndex(remote, [{ projectId: "neh", title: "Nehemías", kind: "book", books: ["NEH"] }, { projectId: "EST", title: "Ester (nuevo)", kind: "book", books: ["EST"] }]);
  assert.deepEqual(merged.map((e) => e.projectId), ["EST", "EZR", "NEH"]);
  assert.equal(merged.find((e) => e.projectId === "EST")!.title, "Ester (nuevo)", "lo que se guarda ahora gana");
});

test("los libros del espacio: los de Taller con su plan, y los del registro con el proceso; quien coordina, solo donde su equipo tiene tareas", () => {
  const board = (book: string) => ({ ...plan, book, books: [book], kind: "book" as const });
  const projects = [
    { projectId: "NEH", title: "Nehemías", board: board("NEH"), issues: [issue("tps", 1, { closed: true, marker: done(["borrador"]) }), issue("tps", 2), issue("tpl", 1)] },
    { projectId: "EST", title: "Ester", board: board("EST"), issues: [] },
    { projectId: "JUD-TEMA", title: "Tema", board: { ...plan, book: "JUD", books: ["JUD", "JON"], kind: "thematic" as const }, issues: [] },
  ];
  const doneElsewhere = normalizeDoneElsewhere({ schema: "taller-fuera-1", books: { TIT: { from: "publicado", tasks: "todo" }, EST: { from: "tc", tasks: { tpl: "todo" } }, EPH: { from: "tc", tasks: { tps: [1] } } } });
  const process = { phases: plan.phases, teams: plan.teams.map((row) => ({ ...row, orgTeamName: undefined })) as ProjectTask[] };
  const all = spaceBooks({ projects, doneElsewhere, process, priority: { projectOrder: ["NEH", "EST"], paused: ["EPH"] } });
  assert.deepEqual(all.map((row) => row.book), ["NEH", "EST", "EPH", "TIT"], "un proyecto de varios libros no es un libro");
  assert.equal(all.find((row) => row.book === "EST")!.standing.fraction, 1 / 4, "Ester tiene proyecto y también lo hecho antes");
  assert.equal(all.find((row) => row.book === "EPH")!.paused, true);
  assert.equal(all.find((row) => row.book === "TIT")!.projectId, undefined);
  assert.deepEqual(spaceBooks({ projects, doneElsewhere, priority: { projectOrder: [], paused: [] } }).map((row) => row.book), ["NEH", "EST"], "sin el proceso, solo los libros que tienen proyecto");
  const tps = spaceBooks({ projects, doneElsewhere, process, teams: ["pm-tps"], priority: { projectOrder: [], paused: [] } });
  assert.deepEqual(tps.map((row) => [row.book, row.issues.length]), [["NEH", 2], ["EST", 0], ["EPH", 0], ["TIT", 0]], "Nehemías se trabaja en Taller aunque solo se cuenten las del TPS");
  assert.equal(tps.find((row) => row.book === "EST")!.standing.fraction, 0, "lo del TPL no es del equipo del TPS");
});

test("un capítulo cerrado solo para guardar porciones terminadas en Taller no es trabajo de antes de Taller", () => {
  const record = { ...done(["borrador", "pares"]), brought: { from: "porciones", at: "2026-11-13T21:58:00Z" } };
  const issues = [issue("tpl", 1, { closed: true, marker: done(["borrador", "pares"]) })];
  const gathered = issue("tpl", 1, { closed: true, marker: record });
  const row = bookStanding({ book: "EPH", plan, issues: [...issues, { ...gathered, body: gathered.body!.replace(/"portionIds":\["[^"]+"\]/, '"portionIds":["EPH-01-01","EPH-01-02"]') } as DcsIssue] }).phases[0]!.tasks.find((r) => r.taskId === "tpl")!;
  assert.deepEqual([row.fraction, row.before], [1, 0], "terminado en Taller, por su porción");
});

console.log(`\nverify-books-standing: ${passed} checks passed.`);
