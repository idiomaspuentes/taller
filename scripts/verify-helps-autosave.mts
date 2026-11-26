/**
 * The helps editor saves by itself on the person's own draft, a moment after the last key, and never on the team's
 * draft. After a failure it waits for another key, the connection or «Reintentar»: it does not knock on Door43 every
 * few seconds.
 *
 *   npm run verify:helps-autosave
 */
import assert from "node:assert/strict";
import { DcsApiError } from "@ip-lms/dcs-client";
import { AUTOSAVE_DELAY_MS, autosaveDue, blankOnlyWhenMissing, composeOnBranch, type AutosaveState } from "../src/domain/helpsAutosave";
import { tsvRowsToDraftItems } from "../src/domain/helpsDraft";
import { BootstrapError, writeRefusedStatus } from "../src/dcs/repoFile";
import { parseTsvTable } from "../src/prep/tsv";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** Ana typed a note on her own draft, and nothing else is going on. */
const typed: AutosaveState = {
  shared: false,
  hasSession: true,
  dirty: true,
  saving: false,
  finishing: false,
  openingPr: false,
  busy: false,
  hasItems: true,
  confirming: false,
  blocked: false,
  failedSinceEdit: false,
};

test("se guarda solo con algo por guardar en el borrador propio", () => {
  assert.equal(autosaveDue(typed), true);
  assert.equal(AUTOSAVE_DELAY_MS, 3500, "como el editor del texto");
  assert.equal(autosaveDue({ ...typed, dirty: false }), false, "sin nada por guardar, nada");
  assert.equal(autosaveDue({ ...typed, hasItems: false }), false, "sin ayudas en pantalla, nada");
});

test("el borrador del equipo nunca se guarda solo", () => {
  assert.equal(autosaveDue({ ...typed, shared: true }), false);
});

test("sin sesión, guardando, terminando, abriendo la revisión, con la pregunta de entregar abierta o bloqueado, no", () => {
  const not: Partial<AutosaveState>[] = [
    { hasSession: false },
    { saving: true },
    { finishing: true },
    { openingPr: true },
    { busy: true },
    { confirming: true },
    { blocked: true },
  ];
  for (const over of not) assert.equal(autosaveDue({ ...typed, ...over }), false, JSON.stringify(over));
});

test("tras un fallo no se reintenta hasta otra tecla o hasta que vuelva la red", () => {
  assert.equal(autosaveDue({ ...typed, failedSinceEdit: true }), false);
});

// ── Never a write without the sha read on the same branch ──

const HEAD = ["Reference", "ID", "Tags", "SupportReference", "Quote", "Occurrence", "Note"].join("\t");
const row = (ref: string, id: string, note: string) => [ref, id, "", "", "Quote", "1", note].join("\t");
const tn = (one: string, two: string) => [HEAD, row("1:1", "abc1", one), row("2:1", "xy9z", two), ""].join("\n");
const passage = (text: string) => tsvRowsToDraftItems("notas", "tn_NEH.tsv", parseTsvTable(text).rows.filter((r) => r.Reference.startsWith("1:")));
const noteOf = (text: string, id: string) => parseTsvTable(text).rows.find((r) => r.ID === id)?.Note;
const edits = [{ id: "abc1", fields: { Note: "Nota de ana" } }];

test("un archivo que no está en la rama se crea, y solo se crea", () => {
  const made = composeOnBranch({ kind: "tsv", onBranch: null, base: tn("inglés", "inglés"), edits, passage });
  assert.ok(!("conflict" in made));
  assert.equal(made.mustCreate, true);
  assert.equal(made.sha, undefined);
  assert.equal(noteOf(made.content, "abc1"), "Nota de ana");
  const article = composeOnBranch({ kind: "markdown", onBranch: null, base: "", text: "# Metáfora" });
  assert.ok(!("conflict" in article) && article.mustCreate === true && article.content === "# Metáfora\n");
});

test("notas con el pasaje igual en la rama: se escriben sobre ella y las filas de otro pasaje se conservan", () => {
  const onBranch = { text: tn("inglés", "Nota del grupo dos"), sha: "sha-rama" };
  const made = composeOnBranch({ kind: "tsv", onBranch, base: tn("inglés", "inglés"), edits, passage });
  assert.ok(!("conflict" in made));
  assert.equal(made.sha, "sha-rama", "con el sha leído en la rama");
  assert.equal(made.mustCreate, undefined);
  assert.equal(noteOf(made.content, "abc1"), "Nota de ana");
  assert.equal(noteOf(made.content, "xy9z"), "Nota del grupo dos");
});

test("notas con el pasaje distinto en la rama: es un conflicto y no se escribe", () => {
  const onBranch = { text: tn("lo que otra pestaña guardó", "inglés"), sha: "sha-rama" };
  assert.deepEqual(composeOnBranch({ kind: "tsv", onBranch, base: tn("inglés", "inglés"), edits, passage }), { conflict: true });
});

test("un artículo igual en la rama se escribe sobre ella; distinto, es un conflicto", () => {
  const same = composeOnBranch({ kind: "markdown", onBranch: { text: "# Antes\n", sha: "s1" }, base: "# Antes\n", text: "# Después" });
  assert.ok(!("conflict" in same) && same.sha === "s1" && same.content === "# Después\n");
  assert.deepEqual(composeOnBranch({ kind: "markdown", onBranch: { text: "# Otro\n", sha: "s1" }, base: "# Antes\n", text: "# Después" }), { conflict: true });
});

test("el rechazo de Door43 se reconoce por su estado, venga como venga envuelto", () => {
  const refused = new DcsApiError("sha does not match", 409);
  assert.equal(writeRefusedStatus(refused), 409);
  assert.equal(writeRefusedStatus(new BootstrapError("no se pudo", "file-create", 422, refused)), 422);
  assert.equal(writeRefusedStatus(new BootstrapError("no se pudo", "file-create", undefined, refused)), 409, "o el de su causa");
  assert.equal(writeRefusedStatus(new Error("No se pudo guardar", { cause: refused })), 409, "un Error sin estado lleva el original en cause");
  assert.equal(writeRefusedStatus(new Error("sin red")), undefined);
});

test("un artículo que no se lee queda vacío solo si no existe", () => {
  assert.equal(blankOnlyWhenMissing(new DcsApiError("not found", 404)), true);
  assert.equal(blankOnlyWhenMissing(new DcsApiError("server", 500)), false);
  assert.equal(blankOnlyWhenMissing(new TypeError("Failed to fetch")), false);
});

console.log(`\nverify-helps-autosave: ${passed} checks passed.`);
