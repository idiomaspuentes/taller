/** The notes of a chapter become the items of the «Revisar notas» step. */
import assert from "node:assert/strict";
import type { AlignmentMap } from "@usfm-tools/types";
import {
  attachPhrases,
  categoryFromSupportRef,
  categoryLabel,
  groupByCategory,
  parseNoteRows,
  sortByVerse,
} from "../src/domain/afinacionNotes";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const row = (o: Record<string, string>) => ({ Reference: "", ID: "", Tags: "", SupportReference: "", Quote: "", Occurrence: "1", Note: "", ...o });
const rows = [
  row({ Reference: "front:intro", ID: "i0", Note: "Introducción al libro" }),
  row({ Reference: "1:intro", ID: "i1", Note: "Introducción al capítulo" }),
  row({ Reference: "1:2", ID: "b2", SupportReference: "rc://*/ta/man/translate/figs-abstractnouns", Quote: "ἐλπίδι", Note: "Si su idioma no usa un sustantivo abstracto…" }),
  row({ Reference: "1:1", ID: "a1", SupportReference: "rc://*/ta/man/translate/figs-metaphor", Quote: "δοῦλος", Note: "Pablo habla como si…\nSegunda línea" }),
  row({ Reference: "1:3", ID: "c3", SupportReference: "rc://*/ta/man/translate/figs-metaphor", Quote: "λόγον", Occurrence: "2", Note: "Metáfora de la palabra" }),
  row({ Reference: "1:4", ID: "d4", Note: "Información general del versículo" }),
  row({ Reference: "2:1", ID: "e1", SupportReference: "rc://*/ta/man/translate/figs-idiom", Quote: "x", Note: "Otro capítulo" }),
  row({ Reference: "1:5", ID: "", SupportReference: "rc://*/ta/man/translate/figs-idiom", Note: "Sin id" }),
];

test("solo entran las notas del capítulo con versículo e id; se omiten introducciones", () => {
  const items = parseNoteRows(rows, 1);
  assert.deepEqual(items.map((i) => i.id).sort(), ["a1", "b2", "c3", "d4"]);
  assert.equal(parseNoteRows(rows, 2).length, 1);
});

test("la categoría sale de la referencia de apoyo y se dice en español", () => {
  assert.equal(categoryFromSupportRef("rc://*/ta/man/translate/figs-metaphor"), "figs-metaphor");
  assert.equal(categoryFromSupportRef("rc://*/ta/man/translate/figs-metaphor/"), "figs-metaphor");
  assert.equal(categoryFromSupportRef(""), "");
  assert.equal(categoryLabel("figs-metaphor"), "Metáfora");
  assert.equal(categoryLabel(""), "Información general");
  assert.equal(categoryLabel("figs-algo-nuevo"), "Algo nuevo", "categoría desconocida: se lee bien igual");
  assert.equal(categoryLabel("figs-123person"), "Primera, segunda y tercera persona");
  assert.equal(categoryLabel("figs-yousingular"), "«Tú» singular");
});

test("el texto de la nota recupera sus saltos de línea y la ocurrencia por omisión es 1", () => {
  const a1 = parseNoteRows(rows, 1).find((i) => i.id === "a1")!;
  assert.equal(a1.note, "Pablo habla como si…\nSegunda línea");
  assert.equal(a1.occurrence, 1);
  assert.equal(parseNoteRows(rows, 1).find((i) => i.id === "c3")!.occurrence, 2);
});

test("la cita del original se lleva a la frase del texto alineado", () => {
  const alignments: AlignmentMap = {
    "TIT 1:2": [
      {
        sources: [{ strong: "G1680", lemma: "ἐλπίς", content: "ἐλπίδι", occurrence: 1, occurrences: 1 }],
        targets: [{ word: "hope", occurrence: 1, occurrences: 1 }],
      },
    ],
  };
  const items = attachPhrases(parseNoteRows(rows, 1), {
    book: "TIT",
    verseTexts: { 2: "with the certain hope of eternal life" },
    alignments,
  });
  const b2 = items.find((i) => i.id === "b2")!;
  assert.equal(b2.phrase, "hope");
  assert.deepEqual(b2.phraseTokens, [3]);
  assert.equal(items.find((i) => i.id === "a1")!.phrase, undefined, "sin texto alineado del versículo no hay frase");
});

test("orden por versículo y grupos por categoría en orden de aparición", () => {
  const items = parseNoteRows(rows, 1);
  assert.deepEqual(sortByVerse(items).map((i) => i.id), ["a1", "b2", "c3", "d4"]);
  const groups = groupByCategory(items);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [
    ["Metáfora", ["a1", "c3"]],
    ["Sustantivos abstractos", ["b2"]],
    ["Información general", ["d4"]],
  ]);
});

{
  const { articlePathOf, articleName } = await import("../src/domain/afinacionNotes");
  assert.equal(articlePathOf("rc://*/ta/man/translate/figs-metaphor"), "translate/figs-metaphor");
  assert.equal(articlePathOf("rc://en/ta/man/checking/acceptable/"), "checking/acceptable");
  assert.equal(articlePathOf("figs-activepassive"), "translate/figs-activepassive");
  assert.equal(articlePathOf(""), "");
  const metaphor = { category: "figs-metaphor", categoryLabel: "Metáfora" };
  const same = (label: string) => label;
  assert.equal(articleName(metaphor, { title: "La metáfora", own: true }, same), "La metáfora", "el título que el equipo le dio en su Academia");
  assert.equal(articleName(metaphor, { title: "Metaphor" }, same), "Metáfora", "sin traducir, el nombre conocido y no el inglés");
  assert.equal(articleName({ category: "figs-newthing", categoryLabel: "Newthing" }, { title: "A New Thing" }, same), "A New Thing", "un artículo que la app no conoce lleva su título");
  console.log("ok  cada nota lleva al artículo de la Academia que nombra su figura");
}

console.log(`\nverify-afinacion-notes: ${passed} checks passed.`);
