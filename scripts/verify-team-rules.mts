/**
 * The rules a team gives itself as it works: anybody adds one and it counts at once; it waits in the coordinator's
 * list until they keep it, correct it or remove it.
 *
 *   npm run verify:team-rules
 */
import assert from "node:assert/strict";
import { isAppTeam, teamUsage } from "../src/domain/roles";
import { itemChecks, stepWideChecks } from "../src/domain/stepChecks";
import { setActiveScope } from "../src/domain/scope";
import { activeRules, addRule, emptyTeamRules, normalizeTeamRules, pendingRules, reviewRule, ruleMadeFrom, ruleText, teamRulesPath } from "../src/domain/teamRules";

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

test("una regla se lee en el idioma de cada quien cuando alguien la dijo en él; corregirla en su idioma la cambia", () => {
  let doc = addRule(emptyTeamRules("pm-traductores-tpl"), { id: "r1", text: "«Elder» es «anciano».", by: "bea", at, coordinator: false, lang: "es" });
  doc = reviewRule(doc, "r1", "ana", { keep: true, text: "«Elder» é «ancião».", lang: "pt" });
  const rule = activeRules(doc)[0]!;
  assert.deepEqual([ruleText(rule, "es"), ruleText(rule, "pt")], ["«Elder» es «anciano».", "«Elder» é «ancião»."], "decirla en portugués no borra la original");
  doc = reviewRule(doc, "r1", "ana", { keep: true, text: "«Elder» siempre es «anciano».", lang: "es" });
  assert.deepEqual([ruleText(activeRules(doc)[0]!, "es"), ruleText(activeRules(doc)[0]!, "pt")], ["«Elder» siempre es «anciano».", "«Elder» é «ancião»."]);
  // A rule kept long ago can still be corrected or removed.
  assert.deepEqual(activeRules(reviewRule(doc, "r1", "ana", { keep: false })), []);
});

test("una regla puede decir qué palabras de la fuente la piden, y quien coordina se las pone, cambia o quita", () => {
  let doc = addRule(emptyTeamRules("pm-traductores-tpl"), { id: "r1", text: "«Elder» es «anciano».", by: "bea", at, coordinator: false, when: [" Elder ", "elders", "ELDER"] });
  assert.deepEqual(activeRules(doc)[0]!.when, ["elder", "elders"], "limpias y sin repetir");
  assert.deepEqual(itemChecks(activeRules(doc), "The elders of the city came.").map((r) => r.id), ["r1"]);
  assert.deepEqual(itemChecks(activeRules(doc), "Grace and peace."), [], "donde la fuente no la pide, no aparece");
  doc = reviewRule(doc, "r1", "ana", { keep: true });
  assert.deepEqual(activeRules(doc)[0]!.when, ["elder", "elders"], "dejarla no toca sus palabras");
  doc = reviewRule(doc, "r1", "ana", { keep: true, when: ["presbyter"] });
  assert.deepEqual(activeRules(doc)[0]!.when, ["presbyter"]);
  doc = reviewRule(doc, "r1", "ana", { keep: true, when: [] });
  assert.equal(activeRules(doc)[0]!.when, undefined, "sin palabras, aparece siempre");
  assert.deepEqual(stepWideChecks(activeRules(doc)).map((r) => r.id), ["r1"]);
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

test("los equipos de la app son los que creó o los que su configuración nombra, no cualquiera donde esté la persona", () => {
  const config = { teamPrefix: "pm-", managerTeam: "managers", teamLevels: { "revisores-externos": { ana: "habilitada" } }, coordinators: { "comite": ["bea"] } };
  assert.equal(isAppTeam("pm-traductores-tpl", config), true, "lo creó la app");
  assert.equal(isAppTeam("Revisores-Externos", config), true, "tiene niveles");
  assert.equal(isAppTeam("comite", config), true, "tiene quien lo coordine");
  assert.equal(isAppTeam("managers", config), true, "el equipo de quienes administran");
  assert.equal(isAppTeam("Owners", config), false);
  assert.equal(isAppTeam("translators", config), false);
});

test("un equipo está en uso cuando alguna tarea lo tiene, en un proyecto o en las tareas con que empieza uno nuevo", () => {
  const use = teamUsage([
    { projectId: "", tasks: [{ orgTeamName: "pm-traductores-tpl" }, { orgTeamName: "pm-traductores-tps" }, {}] },
    { projectId: "Hageo", tasks: [{ orgTeamName: "PM-Traductores-TPL" }, { orgTeamName: "pm-traductores-tpl" }] },
  ]);
  assert.deepEqual(use.get("pm-traductores-tpl"), { tasks: 3, projects: ["", "Hageo"] });
  assert.deepEqual(use.get("pm-traductores-tps"), { tasks: 1, projects: [""] });
  assert.equal(use.get("pm-traductores-de-ayudas"), undefined, "sin tareas: se puede renombrar o quitar sin romper nada");
});

test("un comentario de una revisión se guarda como regla, con las palabras de la fuente que la piden, y una sola vez", () => {
  // What a reviewer said about one verse, kept for every verse that says the same.
  const said = { id: "r1", text: "Escribimos «Jacobo», no «Santiago».", by: "bea", at, coordinator: false, when: ["james"], from: "4821" };
  const doc = addRule(emptyTeamRules("pm-traductores-tpl"), said);
  assert.equal(ruleMadeFrom(doc, "4821")?.text, "Escribimos «Jacobo», no «Santiago».");
  assert.equal(ruleMadeFrom(doc, "9999"), undefined);
  assert.equal(ruleMadeFrom(null, "4821"), undefined);
  // It is said at the verse that has the word, and nowhere else.
  assert.deepEqual(itemChecks(activeRules(doc), "Jude, a servant of Jesus Christ and a brother of James").map((r) => r.id), ["r1"]);
  assert.deepEqual(itemChecks(activeRules(doc), "May mercy and peace and love be multiplied to you."), []);
  // The same comment does not make a second rule, however it is worded the second time.
  assert.equal(addRule(doc, { ...said, id: "r2", text: "Jacobo, siempre." }), doc);
  // Read back from its file it still says where it came from; taken out, the comment may make another.
  assert.equal(normalizeTeamRules(JSON.parse(JSON.stringify(doc)), "pm-traductores-tpl").rules[0]!.from, "4821");
  const removed = reviewRule(doc, "r1", "ana", { keep: false });
  assert.equal(ruleMadeFrom(removed, "4821"), undefined);
  assert.equal(activeRules(addRule(removed, { ...said, id: "r3" })).length, 1);
});

console.log(`\nverify-team-rules: ${passed} checks passed.`);
