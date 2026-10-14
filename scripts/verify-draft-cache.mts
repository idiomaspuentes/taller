/**
 * What a person types is kept on their device until it is saved. A kept draft belongs to what it was typed for: the
 * server, the subtarea, the person, the text and the passage. Subtarea numbers repeat (a server replaced by a copy
 * of another, a new mock on the same address), and the draft of one thing must never be read, saved or written
 * over as the draft of another.
 *
 * And it is put back only when something in it did not reach Door43 and Door43 still has what it was typed over:
 * a draft that was saved is never put back over a text somebody changed since, and one that was not saved is
 * shown apart when the text changed under it, neither put in nor dropped.
 *
 *   npm run verify:draft-cache
 */
import assert from "node:assert/strict";
import {
  discardKeptDraft,
  draftCacheLostItsBranch,
  draftCacheOpening,
  draftLaunch,
  keptStanding,
  loadDraftCache,
  passageLabel,
  rebaseDraftCache,
  saveDraftCache,
  type DraftLaunch,
  type ReadNow,
} from "../src/domain/draftCache";
import { helpsDraftCacheOpening, loadHelpsDraftCache, rebaseHelpsDraftCache, saveHelpsDraftCache } from "../src/domain/helpsDraftCache";
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
  assert.equal(found.aside[0]!.why, "unsure", "se dice que no se sabe si es de este pasaje");
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

test("una entrada de antes de esta subtarea es su borrador, con su rama, y pasa a su nombre de ahora al guardar", () => {
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

// ── A kept draft and what Door43 has now ─────────────────────────────────

/** What Door43 has of the passage, as an editor says it to the draft it found on the device. */
function door43Has(now: Record<string, string>, draft?: Record<string, string>): ReadNow {
  const same = Boolean(draft) && JSON.stringify(Object.entries(draft!).sort()) === JSON.stringify(Object.entries(now).sort());
  return { now, same, blank: Object.values(now).every((text) => !text.trim()) };
}

/** Ana opens Jonah 2:1–10 and Door43 answers `now`: what becomes of the draft kept for it. */
function openJonah(now: Record<string, string>) {
  const own = loadDraftCache(kept(jonah)).own;
  return draftCacheOpening(kept(jonah), own).answered(door43Has(now, own?.verses));
}

const asSaved = verses(1, 10, "guardado");
const reviewed = { ...asSaved, "3": "corregido en la revisión" };
/** The passage as Door43 has it before anybody wrote in it. */
const unwritten = Object.fromEntries(Object.keys(asSaved).map((row) => [row, ""]));

test("un borrador que ya se guardó no vuelve sobre un texto que cambió después", () => {
  // What was seen: the text saved, a correction merged into the passage, and the editor put the older text back
  // as work to be saved, and saved it by itself over the correction.
  saveDraftCache(kept(jonah), { verses: asSaved, savedAt: 1, branch: jonahBranch, unsaved: false, typedOver: asSaved });
  const answer = openJonah(reviewed);
  assert.equal(answer.standing, "saved", "Door43 tiene eso mismo o algo más nuevo: se muestra lo de Door43");
  assert.equal(answer.aside, null, "no hay nada de la persona que perder: no se avisa");
  assert.deepEqual(loadDraftCache(kept(jonah)).aside, []);
});

test("un borrador igual a lo que dice Door43 no es trabajo por guardar, se haya guardado o no", () => {
  for (const unsaved of [true, false, undefined]) {
    store.clear();
    saveDraftCache(kept(jonah), { verses: asSaved, savedAt: 1, unsaved });
    assert.equal(openJonah(asSaved).standing, "same", String(unsaved));
  }
});

test("lo que no se guardó vuelve mientras Door43 tenga el texto sobre el que se escribió", () => {
  const typed = { ...asSaved, "5": "escrito y sin guardar" };
  saveDraftCache(kept(jonah), { verses: typed, savedAt: 2, branch: jonahBranch, unsaved: true, typedOver: asSaved });
  const answer = openJonah(asSaved);
  assert.equal(answer.standing, "restore");
  assert.equal(answer.aside, null);
  assert.deepEqual(loadDraftCache(kept(jonah)).own?.verses, typed, "sigue bajo su nombre");
});

test("lo que no se guardó, sobre un texto que cambió: ni se pone ni se borra, queda aparte", () => {
  const typed = { ...asSaved, "5": "escrito y sin guardar" };
  saveDraftCache(kept(jonah), { verses: typed, savedAt: 2, branch: jonahBranch, unsaved: true, typedOver: asSaved });
  const answer = openJonah(reviewed);
  assert.equal(answer.standing, "aside", "puesto en el editor se guardaría sobre la corrección");
  assert.deepEqual(answer.aside?.entry.verses, typed);
  assert.equal(answer.aside?.why, "changed");
  // Under a name of its own: what is written from now on is not kept over it.
  assert.equal(loadDraftCache(kept(jonah)).own, null);
  saveDraftCache(kept(jonah), { verses: { ...reviewed, "7": "lo que se escribe hoy" }, savedAt: 3, branch: jonahBranch, unsaved: true, typedOver: reviewed });
  const next = loadDraftCache(kept(jonah));
  assert.equal(next.own?.verses["7"], "lo que se escribe hoy");
  assert.equal(next.aside.length, 1, "sigue aparte al volver a abrir, hasta que la persona lo descarte");
  assert.deepEqual(next.aside[0]!.entry.verses, typed);
  assert.equal(next.aside[0]!.why, "changed", "se dice que es de este pasaje y que el texto cambió");
  assert.equal(passageLabel(next.aside[0]!.entry.place!.passage), "2:1–10");
  discardKeptDraft(next.aside[0]!.key);
  assert.deepEqual(loadDraftCache(kept(jonah)).aside, []);
  assert.equal(loadDraftCache(kept(jonah)).own?.verses["7"], "lo que se escribe hoy", "descartar lo apartado no toca el borrador");
});

test("unir o separar versículos es cambiar el pasaje: se compara entero, no versículo por versículo", () => {
  const joined = { ...verses(1, 8, "guardado"), "9-10": "guardado 9 guardado 10" };
  saveDraftCache(kept(jonah), { verses: { ...asSaved, "5": "sin guardar" }, savedAt: 2, unsaved: true, typedOver: asSaved });
  assert.equal(openJonah(joined).standing, "aside", "otra persona unió 9 y 10: el pasaje ya no es el mismo");
});

test("una entrada de antes de saber si se guardó: si dice otra cosa que Door43, queda aparte y nunca se pone encima", () => {
  // It may be work that never reached Door43, or a text saved long ago that somebody corrected since.
  saveDraftCache(kept(jonah), { verses: asSaved, savedAt: 1, branch: jonahBranch });
  assert.equal(openJonah(asSaved).standing, "same", "igual a Door43: no pasa nada");
  const answer = openJonah(reviewed);
  assert.equal(answer.standing, "aside");
  assert.deepEqual(answer.aside?.entry.verses, asSaved);
  assert.equal(loadDraftCache(kept(jonah)).own, null);
});

test("una entrada de antes guardada con el número solo: igual, y deja libre ese nombre", () => {
  const key = keepAsBefore("tas-draft", { verses: asSaved, savedAt: 1, branch: jonahBranch });
  const answer = openJonah(reviewed);
  assert.equal(answer.standing, "aside");
  assert.ok(!store.has(key), "ya no queda bajo el número solo");
  const next = loadDraftCache(kept(jonah));
  assert.equal(next.own, null);
  assert.deepEqual(next.aside.map((draft) => draft.entry.verses), [asSaved]);
});

test("sobre un pasaje sin nada escrito en Door43 no hay nada que pisar: lo no guardado vuelve", () => {
  // Typed with no connection, before anything was read; from before drafts said whether they were saved; and
  // typed over a text that is no longer there.
  for (const entry of [{ unsaved: true }, {}, { unsaved: true, typedOver: reviewed }]) {
    store.clear();
    saveDraftCache(kept(jonah), { verses: asSaved, savedAt: 1, ...entry });
    assert.equal(openJonah(unwritten).standing, "restore", JSON.stringify(Object.keys(entry)));
  }
  store.clear();
  saveDraftCache(kept(jonah), { verses: asSaved, savedAt: 1, unsaved: false, typedOver: asSaved });
  assert.equal(openJonah(unwritten).standing, "saved", "lo que ya se guardó no vuelve ni así: alguien rehízo el borrador");
});

test("lo escrito sin haber leído nada de Door43 no se pone sobre un texto que sí hay", () => {
  saveDraftCache(kept(jonah), { verses: { ...unwritten, "1": "escrito sin conexión" }, savedAt: 1, unsaved: true });
  assert.equal(openJonah(asSaved).standing, "aside", "los demás versículos vacíos borrarían los de Door43");
});

test("Door43 responde dos veces: lo apartado con la primera respuesta vuelve si la segunda es su texto", () => {
  // The group's draft may answer before the person's own branch, which is what the draft was typed over.
  const mine = { ...asSaved, "2": "mi rama" };
  const typed = { ...mine, "5": "sin guardar" };
  saveDraftCache(kept(jonah), { verses: typed, savedAt: 2, branch: jonahBranch, unsaved: true, typedOver: mine });
  const own = loadDraftCache(kept(jonah)).own;
  const opening = draftCacheOpening(kept(jonah), own);
  assert.equal(opening.answered(door43Has(asSaved, own?.verses)).standing, "aside", "el borrador del grupo no es su texto");
  assert.equal(loadDraftCache(kept(jonah)).aside.length, 1);
  const second = opening.answered(door43Has(mine, own?.verses));
  assert.equal(second.standing, "restore");
  assert.equal(second.aside, null);
  const after = loadDraftCache(kept(jonah));
  assert.deepEqual(after.own?.verses, typed, "otra vez bajo su nombre");
  assert.equal(after.own?.unsaved, true);
  assert.deepEqual(after.aside, [], "y ya no se enseña aparte");
});

test("Door43 responde dos veces con un texto que cambió: se aparta una sola vez", () => {
  saveDraftCache(kept(jonah), { verses: { ...asSaved, "5": "sin guardar" }, savedAt: 2, unsaved: true, typedOver: asSaved });
  const own = loadDraftCache(kept(jonah)).own;
  const opening = draftCacheOpening(kept(jonah), own);
  const first = opening.answered(door43Has(reviewed, own?.verses));
  const second = opening.answered(door43Has({ ...reviewed, "4": "otra corrección" }, own?.verses));
  assert.equal(second.aside?.key, first.aside?.key);
  assert.equal(loadDraftCache(kept(jonah)).aside.length, 1);
});

test("lo que se escribió antes de que Door43 respondiera no se va con lo apartado", () => {
  saveDraftCache(kept(jonah), { verses: { ...asSaved, "5": "sin guardar" }, savedAt: 2, unsaved: true, typedOver: asSaved });
  const own = loadDraftCache(kept(jonah)).own;
  const opening = draftCacheOpening(kept(jonah), own);
  // A verse written while the passage was still being read is kept at once, under the draft's own name.
  saveDraftCache(kept(jonah), { verses: { ...asSaved, "5": "sin guardar", "6": "escrito al abrir" }, savedAt: 3, unsaved: true, typedOver: asSaved });
  const answer = opening.answered(door43Has(reviewed, own?.verses));
  assert.equal(answer.standing, "aside");
  assert.equal(answer.aside?.entry.verses["6"], asSaved["6"], "aparte queda el borrador como estaba al abrir");
  assert.equal(loadDraftCache(kept(jonah)).own?.verses["6"], "escrito al abrir", "y lo recién escrito sigue en su sitio");
});

test("guardar mientras se escribe: lo escrito durante el guardado sigue en el dispositivo y sigue sin guardar", () => {
  // The save began with verse 5; verse 6 was written while it was on its way, and kept at once.
  const whileSaving = { ...asSaved, "5": "lo que se guardó", "6": "escrito durante el guardado" };
  saveDraftCache(kept(jonah), { verses: whileSaving, savedAt: 3, branch: bookBranchName("JON", "tpl"), unsaved: true, typedOver: asSaved });
  const written = { ...asSaved, "5": "lo que se guardó" };
  assert.equal(rebaseDraftCache(kept(jonah), { branch: jonahBranch, typedOver: written }), true);
  const after = loadDraftCache(kept(jonah)).own;
  assert.deepEqual(after?.verses, whileSaving, "no se vuelve al texto con el que empezó el guardado");
  assert.equal(after?.unsaved, true);
  assert.equal(after?.branch, jonahBranch, "la rama en la que se guardó");
  assert.equal(after?.savedAt, 3);
  // Closed right then: Door43 has what the save wrote, and the verse written meanwhile comes back.
  assert.equal(openJonah(written).standing, "restore");
  assert.equal(rebaseDraftCache(kept(jude), { typedOver: {} }), false, "sin borrador no hay nada que anotar");
});

test("rehacer el borrador borra la rama donde se guardó: lo guardado en el dispositivo vuelve a ser lo único que hay", () => {
  // «Rehacer mi borrador» deletes the person's branch and cuts it again from the group's draft.
  saveDraftCache(kept(jonah), { verses: asSaved, savedAt: 1, branch: jonahBranch, unsaved: false, typedOver: asSaved });
  assert.equal(openJonah(reviewed).standing, "saved", "antes de rehacer, Door43 lo tiene");
  assert.equal(draftCacheLostItsBranch(kept(jonah)), true);
  const after = loadDraftCache(kept(jonah)).own;
  assert.equal(after?.unsaved, true);
  assert.deepEqual(after?.verses, asSaved, "lo que dice no cambia");
  assert.equal(openJonah(unwritten).standing, "restore", "el borrador nuevo no tiene nada en el pasaje: vuelve");
  const answer = openJonah(reviewed);
  assert.equal(answer.standing, "aside", "el borrador nuevo tiene otro texto: no se pisa ni se pierde");
  assert.deepEqual(answer.aside?.entry.verses, asSaved);
  assert.equal(draftCacheLostItsBranch(kept(jude)), false, "sin borrador no hay nada que marcar");
});

test("una entrada de antes no cambia al rehacer el borrador: sigue sin saberse si se guardó", () => {
  saveDraftCache(kept(jonah), { verses: asSaved, savedAt: 1, branch: jonahBranch });
  draftCacheLostItsBranch(kept(jonah));
  assert.equal(loadDraftCache(kept(jonah)).own?.unsaved, undefined);
});

test("un borrador sin nada escrito no vacía el pasaje ni se enseña aparte", () => {
  // Kept when a verse was touched and cleared, or before anything was read.
  for (const entry of [{ unsaved: true, typedOver: unwritten }, { unsaved: true }, {}]) {
    store.clear();
    saveDraftCache(kept(jonah), { verses: unwritten, savedAt: 1, ...entry });
    const answer = openJonah(asSaved);
    assert.equal(answer.standing, "none", JSON.stringify(Object.keys(entry)));
    assert.equal(answer.aside, null);
  }
});

test("lo que se dice de un borrador frente a Door43, caso por caso", () => {
  const now = { "1": "a" };
  const read = (over: Partial<ReadNow> = {}): ReadNow => ({ now, same: false, blank: false, ...over });
  assert.equal(keptStanding({ savedAt: 1, unsaved: true }, read({ same: true })), "same");
  assert.equal(keptStanding({ savedAt: 1, unsaved: false }, read()), "saved");
  assert.equal(keptStanding({ savedAt: 1, unsaved: false }, read({ blank: true })), "saved");
  assert.equal(keptStanding({ savedAt: 1, unsaved: true, typedOver: { "1": "a" } }, read()), "restore");
  assert.equal(keptStanding({ savedAt: 1, unsaved: true, typedOver: { "1": "b" } }, read()), "aside");
  assert.equal(keptStanding({ savedAt: 1, unsaved: true, typedOver: { "1": "a", "2": "" } }, read()), "aside", "un versículo más es otro pasaje");
  assert.equal(keptStanding({ savedAt: 1, unsaved: true }, read()), "aside");
  assert.equal(keptStanding({ savedAt: 1, typedOver: { "1": "a" } }, read()), "aside", "sin saber si se guardó no se pone encima");
  assert.equal(keptStanding({ savedAt: 1 }, read({ blank: true })), "restore");
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

test("ayudas: una entrada de antes de esta subtarea es su borrador y pasa a su nombre de ahora al guardar", () => {
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

/** What each help says in Door43, as the helps editor tells it: its text and, for a question, its answer. */
const said = (of: Record<string, string>, answers: Record<string, string> = {}) =>
  Object.fromEntries(Object.entries(of).map(([id, text]) => [id, JSON.stringify([text, answers[id] ?? ""])]));

/** Ana opens the notes of Jonah 2:1–10 and Door43 answers `now`: what becomes of the draft kept for them. */
function openNotes(now: Record<string, string>) {
  const own = loadHelpsDraftCache(kept(notes)).own;
  const same = Boolean(own) && Object.entries(now).every(([id, text]) => !(id in own!.texts) || text === own!.texts[id]);
  return helpsDraftCacheOpening(kept(notes), own).answered({ now: said(now), same, blank: Object.values(now).every((text) => !text.trim()) });
}

const teamNotes = texts("nota del equipo");
const corrected = { ...teamNotes, xy9z: "corregida por quien revisa" };

test("ayudas: lo que ya se guardó no vuelve sobre una nota que alguien cambió después", () => {
  saveHelpsDraftCache(kept(notes), { texts: teamNotes, savedAt: 1, branch: notesBranch, unsaved: false, typedOver: said(teamNotes) });
  const answer = openNotes(corrected);
  assert.equal(answer.standing, "saved");
  assert.equal(answer.aside, null);
});

test("ayudas: lo que no se guardó vuelve mientras Door43 tenga las notas sobre las que se escribió", () => {
  const typed = { ...teamNotes, abc1: "sin guardar" };
  saveHelpsDraftCache(kept(notes), { texts: typed, savedAt: 2, branch: notesBranch, unsaved: true, typedOver: said(teamNotes) });
  assert.equal(openNotes(teamNotes).standing, "restore");
  assert.deepEqual(loadHelpsDraftCache(kept(notes)).own?.texts, typed);
});

test("ayudas: lo que no se guardó, sobre notas que cambiaron, queda aparte", () => {
  const typed = { ...teamNotes, abc1: "sin guardar" };
  saveHelpsDraftCache(kept(notes), { texts: typed, savedAt: 2, branch: notesBranch, unsaved: true, typedOver: said(teamNotes) });
  const answer = openNotes(corrected);
  assert.equal(answer.standing, "aside", "guardar las notas del pasaje escribiría la de antes sobre la corregida");
  assert.deepEqual(answer.aside?.entry.texts, typed);
  const next = loadHelpsDraftCache(kept(notes));
  assert.equal(next.own, null);
  assert.equal(next.aside.length, 1);
  assert.equal(next.aside[0]!.why, "changed");
  saveHelpsDraftCache(kept(notes), { texts: { ...corrected, abc1: "hoy" }, savedAt: 3, unsaved: true, typedOver: said(corrected) });
  assert.equal(loadHelpsDraftCache(kept(notes)).aside.length, 1, "lo que se escribe después no lo pisa");
});

test("ayudas: una nota que alguien agregó o quitó también es un cambio", () => {
  saveHelpsDraftCache(kept(notes), { texts: { ...teamNotes, abc1: "sin guardar" }, savedAt: 2, unsaved: true, typedOver: said(teamNotes) });
  assert.equal(openNotes({ ...teamNotes, nv01: "una nota nueva" }).standing, "aside");
});

test("ayudas: una respuesta que cambió también es un cambio", () => {
  const questions = launchOf({ taskId: "preguntas", resource: "preguntas" });
  const asked = { q1: "¿Qué hizo Jonás?" };
  saveHelpsDraftCache(kept(questions), { texts: { q1: "¿Qué hizo?" }, secondary: { q1: "Oró" }, savedAt: 2, unsaved: true, typedOver: said(asked, { q1: "Oró" }) });
  const own = loadHelpsDraftCache(kept(questions)).own;
  const answered = (response: string) => helpsDraftCacheOpening(kept(questions), own).answered({ now: said(asked, { q1: response }), same: false, blank: false }).standing;
  assert.equal(answered("Oró"), "restore");
  assert.equal(answered("Oró al Señor"), "aside");
});

test("ayudas: una entrada de antes que dice otra cosa que Door43 queda aparte; sobre un artículo aún sin escribir, vuelve", () => {
  saveHelpsDraftCache(kept(notes), { texts: teamNotes, savedAt: 1, branch: notesBranch });
  assert.equal(openNotes(teamNotes).standing, "same");
  assert.equal(openNotes(corrected).standing, "aside");
  store.clear();
  // An article that is not in Door43 yet reads as nothing: what was written for it has nothing to write over.
  const article = kept(launchOf({ taskId: "academia", resource: "academia", chapter: 0, ref: "figs-metaphor" }));
  saveHelpsDraftCache(article, { texts: { "translate/figs-metaphor": "Metáfora" }, savedAt: 1 });
  const own = loadHelpsDraftCache(article).own;
  assert.equal(helpsDraftCacheOpening(article, own).answered({ now: said({ "translate/figs-metaphor": "" }), same: false, blank: true }).standing, "restore");
});

test("ayudas: lo escrito durante el guardado sigue en el dispositivo y sigue sin guardar", () => {
  const whileSaving = { abc1: "lo que se guardó", xy9z: "escrito durante el guardado" };
  saveHelpsDraftCache(kept(notes), { texts: whileSaving, savedAt: 3, branch: notesBranch, unsaved: true, typedOver: said(teamNotes) });
  const written = { ...teamNotes, abc1: "lo que se guardó" };
  assert.equal(rebaseHelpsDraftCache(kept(notes), { branch: notesBranch, typedOver: said(written) }), true);
  const after = loadHelpsDraftCache(kept(notes)).own;
  assert.deepEqual(after?.texts, whileSaving);
  assert.equal(after?.unsaved, true);
  assert.equal(openNotes(written).standing, "restore", "al volver, lo escrito durante el guardado sigue ahí");
});

test("los pasajes se muestran como se escriben", () => {
  assert.equal(passageLabel("2:1-10"), "2:1–10");
  assert.equal(passageLabel("2:5-5"), "2:5");
  assert.equal(passageLabel("0:figs-metaphor"), "figs-metaphor");
});

console.log(`\nverify-draft-cache: ${passed} checks passed.`);
