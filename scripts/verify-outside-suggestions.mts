/**
 * Suggestions to the text from outside the organization: the form in Door43, what is read from what it opens, the
 * team it goes to, and the answers its author gets.
 *
 *   npm run verify:outside-suggestions
 */
import assert from "node:assert/strict";
import { alineacionDecisionData, buildDecisionEvent, type DecisionEventData } from "../src/domain/chatEvents/alineacionDecision";
import { decidedComment, parseReference, readSuggestionBody, refusedComment, suggestionNote, suggestionTemplate, SUGGESTION_FIELDS, SUGGESTION_LABEL, textHolder } from "../src/domain/outsideSuggestion";
import type { AssignmentsDoc } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("un versículo se lee como lo escribe una persona: con el nombre, el código o el comienzo del nombre", () => {
  assert.deepEqual(parseReference("Esdras 3:3"), { book: "EZR", chapter: 3, verse: 3 });
  assert.deepEqual(parseReference("esdras 3,3"), { book: "EZR", chapter: 3, verse: 3 });
  assert.deepEqual(parseReference("EZR 10:44"), { book: "EZR", chapter: 10, verse: 44 });
  assert.deepEqual(parseReference("Esd 2.1"), { book: "EZR", chapter: 2, verse: 1 });
  assert.deepEqual(parseReference("Nehemias 7:6"), { book: "NEH", chapter: 7, verse: 6 }, "sin tilde también");
  assert.deepEqual(parseReference("1 Reyes 2:3"), { book: "1KI", chapter: 2, verse: 3 });
  assert.equal(parseReference("Es 3:3"), null, "un comienzo que no dice un solo libro no se adivina");
  assert.equal(parseReference("el capítulo tres"), null);
});

test("lo que abre el formulario se lee por sus preguntas; uno escrito a mano se lee entero como su porqué", () => {
  const body = `### ${SUGGESTION_FIELDS.ref}\n\nEsdras 3:3\n\n### ${SUGGESTION_FIELDS.text}\n\nEntonces pusieron el altar\nsobre sus bases.\n\n### ${SUGGESTION_FIELDS.why}\n\nEl hebreo dice «sobre sus bases».`;
  assert.deepEqual(readSuggestionBody(body), { ref: { book: "EZR", chapter: 3, verse: 3 }, text: "Entonces pusieron el altar sobre sus bases.", why: "El hebreo dice «sobre sus bases»." });
  const empty = readSuggestionBody(`### ${SUGGESTION_FIELDS.ref}\n\nEsdras 3:3\n\n### ${SUGGESTION_FIELDS.text}\n\n_No response_\n\n### ${SUGGESTION_FIELDS.why}\n\nporque sí`);
  assert.equal(empty.text, "", "lo que el formulario dejó en blanco no es el versículo");
  const byHand = readSuggestionBody("En 3:3 creo que debería decir «sobre sus bases».", "Sugerencia: Esdras 3:3");
  assert.deepEqual(byHand.ref, { book: "EZR", chapter: 3, verse: 3 }, "el versículo, del título");
  assert.equal(byHand.text, "");
  assert.match(byHand.why, /sobre sus bases/);
});

test("el formulario pide las tres cosas que se leen, y pone la etiqueta que separa las sugerencias", () => {
  const yaml = suggestionTemplate("TPL");
  assert.match(yaml, /^name: "Sugerir un cambio al TPL"/);
  assert.match(yaml, new RegExp(`labels:\\n  - ${SUGGESTION_LABEL}`));
  for (const heading of Object.values(SUGGESTION_FIELDS)) assert.ok(yaml.includes(JSON.stringify(heading)), heading);
  assert.equal((yaml.match(/required: true/g) ?? []).length, 3);
});

test("una sugerencia va a la tarea que tiene el texto: la primera, en el orden del plan, de las que lo revisan otra vez", () => {
  const board = {
    phases: [{ id: "armonizacion", order: 2 }, { id: "afinacion", order: 1 }],
    teams: [
      { id: "armonizar", phaseId: "armonizacion" },
      { id: "desafios", phaseId: "afinacion" },
      { id: "traducir", phaseId: "traduccion" },
    ],
  } as unknown as AssignmentsDoc;
  assert.equal(textHolder(board, "tpl", ["armonizar", "desafios"])?.id, "desafios");
  assert.equal(textHolder(board, "tpl", []), undefined);
});

test("la propuesta dice de quién es y de dónde vino; quien la sugirió recibe la respuesta de lo que se decida", () => {
  const note = suggestionNote({ by: "lucia", repo: "es-419_glt", number: 12, url: "https://door43.org/es-419_gl/es-419_glt/issues/12", why: "El hebreo dice «sobre sus bases»." });
  assert.match(note, /^Sugerencia de lucia desde Door43 \(es-419_glt#12\): https:/);
  assert.match(note, /sobre sus bases/);
  assert.match(decidedComment("aceptada", "Esdras 3:3", "Entonces pusieron el altar sobre sus bases."), /aceptó tu sugerencia.*\n\n> Entonces/s);
  assert.match(decidedComment("rechazada", "Esdras 3:3", ""), /dejar Esdras 3:3 como está/);
  assert.match(decidedComment("caducada", "Esdras 3:3", ""), /cambió mientras/);
  assert.equal(refusedComment("  ya se cambió así  "), "Gracias por tu sugerencia. No la llevamos al equipo de traducción: ya se cambió así");
});

test("la decisión guarda el issue de quien la sugirió, también al leerse de nuevo de su conversación", () => {
  const data = {
    id: "x1", kind: "proposal", book: "EZR", chapter: 3, verse: 3, by: "abel", note: "n", baseHash: "h", path: "p", before: [], after: [], groupsBefore: [], groupsAfter: [],
    view: { rtl: true, original: [], draftBefore: [], draftAfter: [] }, oldText: "a", newText: "b", words: [], deadline: "2026-10-17", thresholds: { minAgree: 3, minIndependent: 2 }, aligners: [], tell: [],
    draft: { owner: "o", repo: "r", branch: "b", filepath: "f" }, source: { id: "s", layerDir: "s" }, parentIssue: 9,
    outside: { owner: "es-419_gl", repo: "es-419_glt", number: 12, by: "lucia" },
  } as DecisionEventData;
  const read = alineacionDecisionData(buildDecisionEvent(data, 40));
  assert.deepEqual(read?.outside, { owner: "es-419_gl", repo: "es-419_glt", number: 12, by: "lucia" });
  const { outside: _gone, ...without } = data;
  assert.equal(alineacionDecisionData(buildDecisionEvent(without as DecisionEventData, 40))?.outside, undefined);
});

console.log(`\n${passed} pruebas de las sugerencias de fuera pasaron.`);
