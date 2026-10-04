/**
 * The rules a team gives itself as it works: anybody adds one and it counts at once; it waits in the coordinator's
 * list until they keep it, correct it or remove it.
 *
 *   npm run verify:team-rules
 */
import assert from "node:assert/strict";
import { setActiveScope } from "../src/domain/scope";
import { activeRules, addRule, emptyTeamRules, normalizeTeamRules, pendingRules, reviewRule, teamRulesPath } from "../src/domain/teamRules";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const at = "2026-10-04T10:00:00.000Z";
const add = (doc: ReturnType<typeof emptyTeamRules>, id: string, text: string, by = "bea", coordinator = false) => addRule(doc, { id, text, by, at, coordinator });

test("una regla nueva vale de inmediato para el equipo y queda pendiente para quien coordina", () => {
  const doc = add(emptyTeamRules("pm-traductores-tpl"), "r1", "  «Elder» aquí siempre es   «anciano».  ");
  assert.deepEqual(activeRules(doc).map((r) => [r.text, r.by]), [["«Elder» aquí siempre es «anciano».", "bea"]], "se guarda limpia, con quién la agregó");
  assert.deepEqual(pendingRules(doc).map((r) => r.id), ["r1"]);
});

test("la que agrega quien coordina no espera a nadie, y la misma frase no se agrega dos veces", () => {
  const doc = add(emptyTeamRules("pm-traductores-tpl"), "r1", "Los nombres de lugares, como en la Reina-Valera.", "ana", true);
  assert.deepEqual(pendingRules(doc), []);
  assert.equal(activeRules(doc).length, 1);
  assert.equal(add(doc, "r2", "los nombres de lugares, como en la reina-valera."), doc, "ya estaba");
  assert.equal(add(doc, "r3", "   "), doc, "una regla vacía no se agrega");
});

test("quien coordina la deja, la corrige o la quita; quitada ya no vale pero queda registrada", () => {
  let doc = add(add(add(emptyTeamRules("pm-traductores-tpl"), "r1", "Regla uno"), "r2", "Regla dos"), "r3", "Regla tres");
  doc = reviewRule(doc, "r1", "ana", { keep: true });
  doc = reviewRule(doc, "r2", "ana", { keep: true, text: "Regla dos, mejor dicha" });
  doc = reviewRule(doc, "r3", "ana", { keep: false });
  assert.deepEqual(activeRules(doc).map((r) => r.text), ["Regla uno", "Regla dos, mejor dicha"]);
  assert.deepEqual(pendingRules(doc), [], "nada más espera a quien coordina");
  assert.deepEqual(doc.rules.find((r) => r.id === "r3")?.removedBy, "ana");
  assert.equal(doc.rules.find((r) => r.id === "r2")?.by, "bea", "corregirla no cambia de quién fue la idea");
});

test("al leer el archivo no se pierde nada y lo que está mal escrito se deja fuera", () => {
  const doc = reviewRule(add(emptyTeamRules("pm-traductores-tpl"), "r1", "Regla uno"), "r1", "ana", { keep: true });
  assert.deepEqual(normalizeTeamRules(JSON.parse(JSON.stringify(doc)), "pm-traductores-tpl"), doc);
  assert.deepEqual(normalizeTeamRules({ rules: [{ id: "x" }, null, { id: "y", text: "vale" }, { id: "y", text: "repetida" }] }, "t").rules.map((r) => r.id), ["y"]);
  assert.deepEqual(normalizeTeamRules("basura", "t").rules, []);
});

test("las reglas de cada equipo están en su archivo, dentro del espacio de trabajo", () => {
  setActiveScope("");
  assert.equal(teamRulesPath("pm-Traductores TPL"), "reglas/pm-traductores-tpl.json");
  setActiveScope("espacio-b");
  assert.equal(teamRulesPath("pm-traductores-tpl"), "espacio-b/reglas/pm-traductores-tpl.json", "otro espacio de la misma organización no las ve");
  setActiveScope("");
});

console.log(`\nverify-team-rules: ${passed} checks passed.`);
