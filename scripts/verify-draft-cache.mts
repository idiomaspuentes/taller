/**
 * What a person types is kept on their device until it is saved. A kept draft belongs to what it was typed for: the
 * server, the subtarea, the person, the text and the passage. Subtarea numbers repeat (a server replaced by a copy
 * of another, a new mock on the same address), and the draft of one thing must never be read, saved or written
 * over as the draft of another.
 *
 *   npm run verify:draft-cache
 */
import assert from "node:assert/strict";
import { discardKeptDraft, draftLaunch, loadDraftCache, passageLabel, saveDraftCache, type DraftLaunch } from "../src/domain/draftCache";
import { loadHelpsDraftCache, saveHelpsDraftCache } from "../src/domain/helpsDraftCache";
import {
  bookBranchName,
  branchBelonging,
  draftReadBranchNames,
  legacyTaskBranchName,
  legacyWorkBranchName,
  nestedPortionPrBranchName,
  portionPrBranchName,
  workBranchParamsFromCtx,
} from "../src/domain/portionPr";
import { buildLabSolverLaunchContext } from "../src/domain/solverLab";
import { SOLVER_LAUNCH_SCHEMA, type SolverLaunchContext } from "../src/domain/solverLaunch";

let passed = 0;
function test(name: string, fn: () => void) {
  store.clear();
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** The storage of a browser, as far as the drafts use it. */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
};

const QA = "https://qa.door43.org";
const PRODUCTION = "https://git.door43.org";

/** Subtarea #3 of `es-419_gl`: Jonah 2:1–10, the literal text, Ana's. */
function launchOf(over: Partial<SolverLaunchContext> = {}): SolverLaunchContext {
  return {
    schema: SOLVER_LAUNCH_SCHEMA,
    lang: "es-419",
    pmOrg: "es-419_gl",
    contentOrg: "es-419_gl",
    projectId: "JON",
    taskId: "tpl",
    taskName: "Traducir TPL",
    book: "JON",
    chapter: 2,
    resource: "tpl",
    phaseSlug: "traduccion",
    ref: "2:1–10",
    portionIds: [],
    itemIds: [],
    workOrderKey: "",
    issueNumber: 3,
    issueUrl: "",
    username: "ana",
    ...over,
  };
}

const kept = (ctx: SolverLaunchContext, host = QA, also: string[] = []): DraftLaunch => draftLaunch(ctx, host, workBranchParamsFromCtx(ctx), also);

const jonah = launchOf();
const jude = launchOf({ projectId: "JUD", book: "JUD", chapter: 1, ref: "1:4–8" });
const jonahBranch = portionPrBranchName(workBranchParamsFromCtx(jonah));
const judeBranch = portionPrBranchName(workBranchParamsFromCtx(jude));

/** Verses `from`–`to`, each with a text that says whose it is. */
function verses(from: number, to: number, of: string): Record<string, string> {
  const rows: Record<string, string> = {};
  for (let verse = from; verse <= to; verse++) rows[String(verse)] = `${of} ${verse}`;
  return rows;
}

/** An entry as the app kept it before drafts said what they were of: under the organization and the number alone. */
function keepAsBefore(kind: "tas-draft" | "tas-helps-draft", entry: object, pmOrg = "es-419_gl", issueNumber = 3): string {
  const key = `${kind}:${pmOrg}:${issueNumber}`;
  store.set(key, JSON.stringify(entry));
  return key;
}

// ── The text of Scripture ────────────────────────────────────────────────

test("lo que se escribe vuelve a su pasaje, con la rama en la que se guardaba", () => {
  assert.equal(saveDraftCache(kept(jonah), { verses: verses(1, 10, "Jonás"), savedAt: 5, branch: jonahBranch }), true);
  const found = loadDraftCache(kept(jonah));
  assert.deepEqual(found.own?.verses, verses(1, 10, "Jonás"));
  assert.equal(found.own?.branch, jonahBranch);
  assert.equal(found.own?.savedAt, 5);
  assert.deepEqual(found.aside, []);
});

test("un versículo unido conserva su clave, y lo que no es un versículo se descarta", () => {
  const launch = kept(launchOf({ ref: "2:9–12" }));
  saveDraftCache(launch, { verses: { "9": "a", "10-11": "b", "12": "", x: "no" }, savedAt: 1 });
  assert.deepEqual(loadDraftCache(launch).own?.verses, { "9": "a", "10-11": "b", "12": "" });
});

test("el mismo número en otro servidor: no recibe el borrador ni lo pisa", () => {
  saveDraftCache(kept(jonah, QA), { verses: verses(1, 10, "QA"), savedAt: 1, branch: jonahBranch });
  const there = loadDraftCache(kept(jonah, PRODUCTION));
  assert.equal(there.own, null);
  assert.deepEqual(there.aside, [], "lo de otro servidor no es de esta subtarea: no se enseña");
  saveDraftCache(kept(jonah, PRODUCTION), { verses: verses(1, 10, "Producción"), savedAt: 2, branch: jonahBranch });
  assert.deepEqual(loadDraftCache(kept(jonah, QA)).own?.verses, verses(1, 10, "QA"), "cada servidor conserva el suyo");
  assert.deepEqual(loadDraftCache(kept(jonah, PRODUCTION)).own?.verses, verses(1, 10, "Producción"));
  assert.deepEqual(loadDraftCache(kept(jonah, `${QA}/`)).own?.verses, verses(1, 10, "QA"), "la barra final de la dirección no hace otro servidor");
});

test("el mismo número con otro libro: ni sus versículos ni su rama", () => {
  // What was seen: #3 was Jude 1:4–8 on one mock and Jonah 2:1–10 on the next.
  saveDraftCache(kept(jude), { verses: verses(4, 8, "Judas"), savedAt: 1, branch: judeBranch });
  const found = loadDraftCache(kept(jonah));
  assert.equal(found.own, null);
  assert.deepEqual(found.aside, [], "otro libro no es la misma subtarea");
  const read = draftReadBranchNames({ ...workBranchParamsFromCtx(jonah), remembered: found.own?.branch });
  assert.ok(!read.includes(judeBranch), "la rama de Judas no se lee ni se escribe");
  saveDraftCache(kept(jonah), { verses: verses(1, 10, "Jonás"), savedAt: 2, branch: jonahBranch });
  assert.deepEqual(loadDraftCache(kept(jude)).own?.verses, verses(4, 8, "Judas"), "lo de Judas sigue donde estaba");
});

test("el mismo número con otro recurso, otra organización de contenido u otro idioma: tampoco", () => {
  saveDraftCache(kept(jonah), { verses: verses(1, 10, "TPL"), savedAt: 1, branch: jonahBranch });
  for (const other of [launchOf({ resource: "tps" }), launchOf({ contentOrg: "pt-br_gl" }), launchOf({ lang: "pt-br" })]) {
    const found = loadDraftCache(kept(other));
    assert.equal(found.own, null);
    assert.deepEqual(found.aside, []);
  }
});

test("el mismo número con otro pasaje del mismo libro: no se pone, se enseña aparte y no se borra", () => {
  const before = launchOf({ chapter: 1, ref: "1:4–8" });
  saveDraftCache(kept(before), { verses: verses(4, 8, "Jonás 1"), savedAt: 7, branch: jonahBranch });
  const found = loadDraftCache(kept(jonah));
  assert.equal(found.own, null, "los versículos 4–8 del capítulo 1 no son los del capítulo 2");
  assert.equal(found.aside.length, 1);
  assert.deepEqual(found.aside[0]!.entry.verses, verses(4, 8, "Jonás 1"));
  assert.equal(found.aside[0]!.entry.place?.book, "JON");
  assert.equal(passageLabel(found.aside[0]!.entry.place!.passage), "1:4–8");
  // Writing in the passage of today does not take it away.
  saveDraftCache(kept(jonah), { verses: verses(1, 10, "Jonás 2"), savedAt: 8, branch: jonahBranch });
  const after = loadDraftCache(kept(jonah));
  assert.deepEqual(after.own?.verses, verses(1, 10, "Jonás 2"));
  assert.equal(after.aside.length, 1, "sigue aparte hasta que la persona lo descarte");
  assert.deepEqual(loadDraftCache(kept(before)).own?.verses, verses(4, 8, "Jonás 1"), "y vuelve entero si se abre su pasaje");
  discardKeptDraft(after.aside[0]!.key);
  assert.deepEqual(loadDraftCache(kept(jonah)).aside, []);
  assert.deepEqual(loadDraftCache(kept(jonah)).own?.verses, verses(1, 10, "Jonás 2"), "descartar lo apartado no toca el borrador");
});

test("un pasaje más ancho o más angosto es otro pasaje", () => {
  saveDraftCache(kept(launchOf({ ref: "2:1–5" })), { verses: verses(1, 5, "antes"), savedAt: 1, branch: jonahBranch });
  const found = loadDraftCache(kept(jonah));
  assert.equal(found.own, null);
  assert.equal(found.aside.length, 1, "puede ser la misma subtarea con el pasaje cambiado: se enseña");
});

test("un borrador apartado sin nada escrito no se enseña", () => {
  saveDraftCache(kept(launchOf({ chapter: 1, ref: "1:4–8" })), { verses: { "4": "", "5": "  " }, savedAt: 1 });
  assert.deepEqual(loadDraftCache(kept(jonah)).aside, []);
});

test("otra persona en el mismo navegador: ni lo ve ni lo pisa", () => {
  saveDraftCache(kept(jonah), { verses: verses(1, 10, "Ana"), savedAt: 1, branch: jonahBranch });
  const bea = launchOf({ username: "bea" });
  const found = loadDraftCache(kept(bea));
  assert.equal(found.own, null);
  assert.deepEqual(found.aside, []);
  saveDraftCache(kept(bea), { verses: verses(1, 10, "Bea"), savedAt: 2 });
  assert.deepEqual(loadDraftCache(kept(jonah)).own?.verses, verses(1, 10, "Ana"));
});

test("una rama recordada que no es de la subtarea no se usa, aunque el borrador sí sea suyo", () => {
  // Typed before the person's branch was cut: the editor still had the branch it had read from, the group's draft.
  saveDraftCache(kept(jonah), { verses: verses(1, 10, "Jonás"), savedAt: 1, branch: bookBranchName("JON", "tpl") });
  const found = loadDraftCache(kept(jonah));
  assert.deepEqual(found.own?.verses, verses(1, 10, "Jonás"));
  assert.equal(found.own?.branch, undefined, "se guardará en la rama propia de la subtarea");
});

test("sin subtarea no se guarda nada; el laboratorio guarda por su pasaje", () => {
  assert.equal(saveDraftCache(kept(launchOf({ pmOrg: "", taskId: "tpl", issueNumber: 0 })), { verses: verses(1, 10, "x"), savedAt: 1 }), false);
  assert.equal(store.size, 0);
  const lab = (ref: string) => kept(buildLabSolverLaunchContext({ username: "ana", lang: "es-419", book: "JON", chapter: 2, verseFrom: Number(ref.split("-")[0]), verseTo: Number(ref.split("-")[1]), resource: "tpl" }));
  saveDraftCache(lab("1-10"), { verses: verses(1, 10, "prueba"), savedAt: 1 });
  assert.deepEqual(loadDraftCache(lab("1-10")).own?.verses, verses(1, 10, "prueba"));
  assert.equal(loadDraftCache(lab("1-5")).own, null);
});

// ── Entries from before drafts said what they were of ────────────────────

test("una entrada de antes con la rama de otro libro: no se restaura, su rama no se usa y queda donde estaba", () => {
  // Exactly what was on the device: the verses 4–8 of Jude and its branch, under the number alone.
  const key = keepAsBefore("tas-draft", { verses: verses(4, 8, "Judas"), savedAt: 1, branch: judeBranch });
  const found = loadDraftCache(kept(jonah));
  assert.equal(found.own, null, "Jonás 2:4–8 no recibe Judas 1:4–8");
  assert.deepEqual(found.aside, [], "es de otro libro: no puede ser de esta subtarea");
  saveDraftCache(kept(jonah), { verses: verses(1, 10, "Jonás"), savedAt: 2, branch: jonahBranch });
  assert.ok(store.has(key), "no se borra: es de quien abra Judas con ese número");
  assert.deepEqual(loadDraftCache(kept(jude)).own?.verses, verses(4, 8, "Judas"));
});

test("una entrada de antes de esta subtarea se restaura, con su rama, y pasa a su nombre de ahora al guardar", () => {
  const key = keepAsBefore("tas-draft", { verses: verses(1, 10, "Jonás"), savedAt: 1, branch: jonahBranch });
  const found = loadDraftCache(kept(jonah));
  assert.deepEqual(found.own?.verses, verses(1, 10, "Jonás"));
  assert.equal(found.own?.branch, jonahBranch);
  assert.deepEqual(found.aside, []);
  assert.ok(store.has(key), "leer no mueve nada");
  saveDraftCache(kept(jonah), { verses: { ...verses(1, 10, "Jonás"), "1": "corregido" }, savedAt: 2, branch: jonahBranch });
  assert.ok(!store.has(key), "ya no queda bajo el número solo, donde otra subtarea la encontraría");
  assert.equal(loadDraftCache(kept(jonah)).own?.verses["1"], "corregido");
});

test("la rama de una entrada de antes vale con cualquiera de los nombres que tuvo la rama de la subtarea", () => {
  const params = workBranchParamsFromCtx(jonah);
  for (const branch of [legacyWorkBranchName(params), nestedPortionPrBranchName(params)]) {
    store.clear();
    keepAsBefore("tas-draft", { verses: verses(1, 10, "Jonás"), savedAt: 1, branch });
    const found = loadDraftCache(kept(jonah));
    assert.deepEqual(found.own?.verses, verses(1, 10, "Jonás"), branch);
    assert.equal(found.own?.branch, branch);
  }
});

test("una entrada de antes con la rama de la subtarea y otros versículos: no se pone, se enseña aparte", () => {
  // The same book, task, person and number, and another passage: its verses 4–8 are not the 4–8 of this one.
  const key = keepAsBefore("tas-draft", { verses: verses(4, 8, "Jonás 1"), savedAt: 1, branch: jonahBranch });
  const found = loadDraftCache(kept(jonah));
  assert.equal(found.own, null);
  assert.deepEqual(found.aside.map((draft) => draft.key), [key]);
  saveDraftCache(kept(jonah), { verses: verses(1, 10, "Jonás 2"), savedAt: 2, branch: jonahBranch });
  assert.ok(store.has(key), "escribir aquí no la borra");
  discardKeptDraft(key);
  assert.ok(!store.has(key));
});

test("una entrada de antes cuya rama no dice de quién es: no se pone, se enseña aparte", () => {
  for (const branch of [undefined, bookBranchName("JON", "tpl"), legacyTaskBranchName("JON", "tpl"), "jon"]) {
    store.clear();
    const key = keepAsBefore("tas-draft", { verses: verses(1, 10, "Jonás"), savedAt: 1, branch });
    const found = loadDraftCache(kept(jonah));
    assert.equal(found.own, null, String(branch));
    assert.deepEqual(found.aside.map((draft) => draft.key), [key], String(branch));
  }
});

test("una entrada de antes de otra persona, o de otra tarea del libro, queda para quien sea", () => {
  const key = keepAsBefore("tas-draft", { verses: verses(1, 10, "Bea"), savedAt: 1, branch: portionPrBranchName({ ...workBranchParamsFromCtx(jonah), username: "bea" }) });
  const ana = loadDraftCache(kept(jonah));
  assert.equal(ana.own, null);
  assert.deepEqual(ana.aside, [], "lo de Bea no se le enseña a Ana");
  saveDraftCache(kept(jonah), { verses: verses(1, 10, "Ana"), savedAt: 2, branch: jonahBranch });
  assert.ok(store.has(key));
  assert.deepEqual(loadDraftCache(kept(launchOf({ username: "bea" }))).own?.verses, verses(1, 10, "Bea"), "Bea lo encuentra al entrar");
});

// ── What a branch name says ──────────────────────────────────────────────

test("el nombre de una rama dice si es de la subtarea, de otra, o no lo dice", () => {
  const params = workBranchParamsFromCtx(jonah);
  assert.equal(branchBelonging(jonahBranch, params), "own");
  assert.equal(branchBelonging(` /${jonahBranch}/ `, params), "own");
  assert.equal(branchBelonging(legacyWorkBranchName(params), params), "own");
  assert.equal(branchBelonging(judeBranch, params), "other", "otro libro");
  assert.equal(branchBelonging(bookBranchName("JUD", "tpl"), params), "other", "el borrador del grupo de otro libro");
  assert.equal(branchBelonging("afinacion/jud", params), "other", "un nombre antiguo, de fase y libro");
  assert.equal(branchBelonging(portionPrBranchName({ ...params, username: "bea" }), params), "other", "otra persona");
  assert.equal(branchBelonging(portionPrBranchName({ ...params, taskId: "tps" }), params), "unknown", "otra tarea del mismo libro");
  assert.equal(branchBelonging(portionPrBranchName({ ...params, issueNumber: 9 }), params), "unknown", "otro número");
  assert.equal(branchBelonging(bookBranchName("JON", "tpl"), params), "unknown", "el borrador del grupo");
  assert.equal(branchBelonging("afinacion/jon", params), "unknown");
  assert.equal(branchBelonging("", params), "unknown");
  assert.equal(branchBelonging(undefined, params), "unknown");
  assert.equal(branchBelonging(bookBranchName("JON", "notas"), params, [bookBranchName("JON", "notas")]), "own", "una rama más en la que esta tarea escribe");
});

// ── The helps ────────────────────────────────────────────────────────────

const notes = launchOf({ taskId: "notas", taskName: "Traducir notas", resource: "notas" });
const notesBranch = portionPrBranchName(workBranchParamsFromCtx(notes));
const texts = (of: string) => ({ abc1: `${of} uno`, xy9z: `${of} dos` });

test("ayudas: lo que se escribe vuelve a su pasaje, con las respuestas y la rama", () => {
  saveHelpsDraftCache(kept(notes), { texts: texts("nota"), secondary: { abc1: "respuesta" }, savedAt: 4, branch: notesBranch });
  const found = loadHelpsDraftCache(kept(notes));
  assert.deepEqual(found.own?.texts, texts("nota"));
  assert.deepEqual(found.own?.secondary, { abc1: "respuesta" });
  assert.equal(found.own?.branch, notesBranch);
  assert.deepEqual(found.aside, []);
});

test("ayudas: no se mezclan con el texto bíblico de la misma subtarea", () => {
  saveDraftCache(kept(notes), { verses: verses(1, 10, "texto"), savedAt: 1 });
  assert.equal(loadHelpsDraftCache(kept(notes)).own, null);
});

test("ayudas: el mismo número en otro servidor o con otro libro no recibe el borrador ni lo pisa", () => {
  saveHelpsDraftCache(kept(notes), { texts: texts("QA"), savedAt: 1, branch: notesBranch });
  const judeNotes = launchOf({ taskId: "notas", resource: "notas", projectId: "JUD", book: "JUD", chapter: 1, ref: "1:4–8" });
  for (const other of [kept(notes, PRODUCTION), kept(judeNotes)]) {
    const found = loadHelpsDraftCache(other);
    assert.equal(found.own, null);
    assert.deepEqual(found.aside, []);
    saveHelpsDraftCache(other, { texts: texts("otro"), savedAt: 2 });
  }
  assert.deepEqual(loadHelpsDraftCache(kept(notes)).own?.texts, texts("QA"));
});

test("ayudas: el mismo número con otro pasaje, u otro artículo, no se pone: se enseña aparte", () => {
  saveHelpsDraftCache(kept(launchOf({ taskId: "notas", resource: "notas", chapter: 1, ref: "1:4–8" })), { texts: texts("capítulo 1"), savedAt: 1, branch: notesBranch });
  const found = loadHelpsDraftCache(kept(notes));
  assert.equal(found.own, null);
  assert.equal(found.aside.length, 1);
  assert.deepEqual(found.aside[0]!.entry.texts, texts("capítulo 1"));

  store.clear();
  const article = (ref: string) => kept(launchOf({ taskId: "academia", resource: "academia", chapter: 0, ref }));
  saveHelpsDraftCache(article("figs-metaphor"), { texts: { "translate/figs-metaphor": "Metáfora" }, savedAt: 1 });
  assert.deepEqual(loadHelpsDraftCache(article("figs-metaphor")).own?.texts, { "translate/figs-metaphor": "Metáfora" });
  const other = loadHelpsDraftCache(article("figs-simile"));
  assert.equal(other.own, null);
  assert.equal(passageLabel(other.aside[0]!.entry.place!.passage), "figs-metaphor");
});

test("ayudas: una entrada de antes con la rama de otro libro no se restaura y queda donde estaba", () => {
  const key = keepAsBefore("tas-helps-draft", { texts: texts("Judas"), savedAt: 1, branch: portionPrBranchName({ ...workBranchParamsFromCtx(notes), book: "JUD" }) });
  const found = loadHelpsDraftCache(kept(notes));
  assert.equal(found.own, null);
  assert.deepEqual(found.aside, []);
  saveHelpsDraftCache(kept(notes), { texts: texts("Jonás"), savedAt: 2, branch: notesBranch });
  assert.ok(store.has(key));
});

test("ayudas: una entrada de antes de esta subtarea se restaura y pasa a su nombre de ahora al guardar", () => {
  const key = keepAsBefore("tas-helps-draft", { texts: texts("nota"), secondary: { abc1: "r" }, savedAt: 1, branch: notesBranch });
  const found = loadHelpsDraftCache(kept(notes));
  assert.deepEqual(found.own?.texts, texts("nota"));
  assert.deepEqual(found.own?.secondary, { abc1: "r" });
  assert.equal(found.own?.branch, notesBranch);
  saveHelpsDraftCache(kept(notes), { texts: texts("nota corregida"), savedAt: 2, branch: notesBranch });
  assert.ok(!store.has(key));
  assert.deepEqual(loadHelpsDraftCache(kept(notes)).own?.texts, texts("nota corregida"));
});

test("ayudas: quien corrige las del equipo recordó el borrador del grupo; vale solo para la tarea que escribe en él", () => {
  // A task that harmonizes has no branch of its own: what it kept before remembered the team's draft.
  const harmonize = launchOf({ taskId: "armonizar-notas", resource: "notas" });
  const teamDraft = bookBranchName("JON", "notas");
  const key = keepAsBefore("tas-helps-draft", { texts: texts("corrección"), savedAt: 1, branch: teamDraft });
  const unknown = loadHelpsDraftCache(kept(harmonize));
  assert.equal(unknown.own, null, "sin saber que escribe en el borrador del grupo, esa rama no dice de quién es");
  assert.deepEqual(unknown.aside.map((draft) => draft.key), [key]);
  const found = loadHelpsDraftCache(kept(harmonize, QA, [teamDraft]));
  assert.deepEqual(found.own?.texts, texts("corrección"));
  assert.equal(found.own?.branch, undefined, "donde escribir lo dice el plan, no lo recordado");
  assert.deepEqual(found.aside, []);
  saveHelpsDraftCache(kept(harmonize, QA, [teamDraft]), { texts: texts("corrección"), savedAt: 2, branch: teamDraft });
  assert.ok(!store.has(key));
  assert.equal(loadHelpsDraftCache(kept(harmonize, QA, [bookBranchName("JUD", "notas")])).own?.texts.abc1, "corrección uno", "ya bajo su nombre, es de este pasaje sin mirar la rama");
});

test("los pasajes se muestran como se escriben", () => {
  assert.equal(passageLabel("2:1-10"), "2:1–10");
  assert.equal(passageLabel("2:5-5"), "2:5");
  assert.equal(passageLabel("0:figs-metaphor"), "figs-metaphor");
});

console.log(`\nverify-draft-cache: ${passed} checks passed.`);
