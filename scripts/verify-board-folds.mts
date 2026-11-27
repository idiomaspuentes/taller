/**
 * The groups of «Mis tareas» the person opened or closed stay that way when the person comes back (#81): kept per
 * person, server, organization and space, and an unreadable or foreign copy counts as untouched.
 */
import assert from "node:assert/strict";
import { boardFoldsKey, foldsFrom, keepFolds, keptFolds, type Folds } from "../src/domain/boardFolds";
import { setActiveScope } from "../src/domain/scope";

let passed = 0;
function test(name: string, fn: () => void) {
  setActiveScope("");
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** A stand-in for `localStorage`. */
const memory = () => {
  const items = new Map<string, string>();
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
};

const where = { host: "https://qa.door43.org", username: "Ana", pmOrg: "es-419_gl" };

test("un grupo cerrado sigue cerrado al volver a la pantalla", () => {
  const store = memory();
  const key = boardFoldsKey(where);
  keepFolds(key, new Map([["take", false], ["more", true]]) as Folds, store);
  const back = keptFolds(key, store);
  assert.equal(back.get("take"), false);
  assert.equal(back.get("more"), true);
  assert.equal(back.has("mine"), false, "lo que no tocó sigue lo que decide el tablero");
});

test("cada persona, servidor, organización y espacio tiene lo suyo", () => {
  const base = boardFoldsKey(where);
  assert.equal(boardFoldsKey({ ...where, username: "ana" }), base, "el nombre de usuario no distingue mayúsculas");
  assert.notEqual(boardFoldsKey({ ...where, username: "bea" }), base);
  assert.notEqual(boardFoldsKey({ ...where, host: "https://git.door43.org" }), base);
  assert.notEqual(boardFoldsKey({ ...where, pmOrg: "pt-br_gl" }), base);
  setActiveScope("pt");
  assert.notEqual(boardFoldsKey(where), base, "otro espacio de trabajo, otra clave");
  assert.ok(boardFoldsKey(where).startsWith("taller-mis-tareas-grupos:pt:"));
});

test("lo guardado que no se entiende cuenta como nada tocado", () => {
  assert.equal(foldsFrom(null).size, 0);
  assert.equal(foldsFrom("no es json").size, 0);
  assert.equal(foldsFrom("[true]").size, 0);
  assert.equal(foldsFrom("null").size, 0);
  const odd = foldsFrom(JSON.stringify({ take: "sí", otro: true, more: false }));
  assert.deepEqual([...odd], [["more", false]], "solo grupos que existen y valores sí/no");
});

test("sin clave o sin almacenamiento no se guarda ni se lee nada", () => {
  const store = memory();
  keepFolds(undefined, new Map([["take", false]]) as Folds, store);
  assert.equal(store.items.size, 0);
  assert.equal(keptFolds(undefined, store).size, 0);
  assert.equal(keptFolds("x", null).size, 0);
  keepFolds("x", new Map([["take", false]]) as Folds, null);
});

test("un almacenamiento lleno o bloqueado no rompe la pantalla", () => {
  const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); } };
  keepFolds("x", new Map([["take", false]]) as Folds, broken);
  assert.equal(keptFolds("x", broken).size, 0);
});

console.log(`\nverify-board-folds: ${passed} checks passed.`);
