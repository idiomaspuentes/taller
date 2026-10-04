/**
 * «Qué cambió»: which verses of a text and which rows of a help are different between two states, cut to a passage,
 * and what a phase is compared with.
 *
 *   npm run verify:changes-since
 */
import assert from "node:assert/strict";
import { changesBetween, comparable, phaseCompare } from "../src/domain/changesSince";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const delivered = String.raw`\id JUD
\c 1
\p
\v 1 Judas, siervo de Jesucristo y hermano de Jacobo.
\v 2 Que la misericordia y la paz les sean multiplicadas.
\v 3 Amados, tenía gran deseo de escribirles.
\v 4
\c 2
\v 1 Un versículo de otro capítulo.
`;
const today = String.raw`\id JUD
\c 1
\p
\v 1 Judas, siervo de Jesucristo y hermano de Santiago.
\v 2 Que la misericordia y la paz les sean multiplicadas.
\v 3 Amados, tenía gran deseo de escribirles.
\v 4 Porque algunos hombres han entrado encubiertamente.
\c 2
\v 1 Un versículo de otro capítulo, corregido.
`;

test("de un texto se dicen los versículos que cambiaron, con el antes y el después", () => {
  const changed = changesBetween({ filename: "66-JUD.usfm", before: delivered, now: today });
  assert.deepEqual(changed.map((item) => [item.ref, item.state]), [["1:1", "changed"], ["1:4", "new"], ["2:1", "changed"]]);
  assert.equal(changed[0]!.before, "Judas, siervo de Jesucristo y hermano de Jacobo.");
  assert.equal(changed[0]!.now, "Judas, siervo de Jesucristo y hermano de Santiago.");
  assert.deepEqual(changesBetween({ filename: "66-JUD.usfm", before: today, now: today }), [], "dos estados iguales: nada");
});

test("recortado a la porción de una subtarea, lo de fuera no aparece", () => {
  const inPassage = changesBetween({ filename: "66-JUD.usfm", before: delivered, now: today, range: { chapter: 1, from: 1, to: 2 } });
  assert.deepEqual(inPassage.map((item) => item.ref), ["1:1"], "ni 1:4 ni 2:1 son de 1:1–2");
  assert.deepEqual(changesBetween({ filename: "66-JUD.usfm", before: delivered, now: today, range: { chapter: 1, from: 2, to: 3 } }), []);
});

test("alinear un versículo no es cambiarlo: se compara por sus palabras", () => {
  const aligned = today.replace(
    String.raw`\v 2 Que la misericordia y la paz les sean multiplicadas.`,
    String.raw`\v 2 \zaln-s |x-strong="G1656" x-content="ἔλεος"\*\w Que|x-occurrence="1" x-occurrences="1"\w* \w la|x-occurrence="1" x-occurrences="2"\w* \w misericordia|x-occurrence="1" x-occurrences="1"\w*\zaln-e\* y la paz les sean multiplicadas.`,
  );
  const changed = changesBetween({ filename: "66-JUD.usfm", before: today, now: aligned });
  assert.deepEqual(changed, [], "las marcas de alineación no cuentan");
  const reworded = aligned.replace("misericordia|", "compasión|").replace(String.raw`\w misericordia`, String.raw`\w compasión`);
  const again = changesBetween({ filename: "66-JUD.usfm", before: today, now: reworded });
  assert.deepEqual(again.map((item) => item.ref), ["1:2"], "pero una palabra cambiada dentro de la alineación sí");
  assert.ok(!again[0]!.now.includes("zaln") && again[0]!.now.includes("compasión"), "y se muestra sin las marcas");
});

const rows = (r: string[][]) => ["Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote", ...r.map((row) => row.join("\t"))].join("\n");
const notesBefore = rows([
  ["front:intro", "aa00", "", "", "", "0", "Introducción"],
  ["1:1", "ab12", "", "rc://*/ta/man/translate/translate-names", "Ἰούδας", "1", "**Judas** es el nombre de un hombre."],
  ["1:2", "cd34", "", "", "ἔλεος", "1", "Una nota que se quitará."],
  ["2:1", "ef56", "", "", "", "1", "De otro capítulo."],
]);
const notesNow = rows([
  ["front:intro", "aa00", "", "", "", "0", "Introducción"],
  ["1:1", "ab12", "", "rc://*/ta/man/translate/translate-names", "Ἰούδας", "1", "**Judas** es el nombre de un hombre, hermano de Santiago."],
  ["1:2", "gh78", "", "", "εἰρήνη", "1", "Una nota nueva."],
  ["2:1", "ef56", "", "", "", "1", "De otro capítulo."],
]);

test("de una ayuda se dicen las filas que cambiaron, las nuevas y las que se quitaron, por su ID", () => {
  const changed = changesBetween({ filename: "tn_JUD.tsv", before: notesBefore, now: notesNow });
  assert.deepEqual(changed.map((item) => [item.key, item.ref, item.state]), [["ab12", "1:1", "changed"], ["gh78", "1:2", "new"], ["cd34", "1:2", "removed"]]);
  assert.deepEqual(changesBetween({ filename: "tn_JUD.tsv", before: notesBefore, now: notesNow, range: { chapter: 1, from: 1, to: 1 } }).map((item) => item.key), ["ab12"], "recortado a 1:1");
  assert.deepEqual(changesBetween({ filename: "tn_JUD.tsv", before: notesNow, now: notesNow }), []);
});

test("un artículo no se compara por piezas, y se dice", () => {
  assert.ok(comparable("66-JUD.usfm") && comparable("tq_JUD.tsv"));
  assert.ok(!comparable("translate/figs-metaphor/01.md"));
  assert.deepEqual(changesBetween({ filename: "translate/figs-metaphor/01.md", before: "a", now: "b" }), []);
});

test("una fase cerrada se compara con la marca anterior; abierta, con el borrador de hoy; y espera si la anterior no cerró", () => {
  assert.deepEqual(phaseCompare([true], 0), { status: "closed", beforeMark: null, nowMark: 0 }, "la primera, cerrada: de lo publicado a su marca");
  assert.deepEqual(phaseCompare([false], 0), { status: "open", beforeMark: null }, "la primera, abierta: de lo publicado al borrador");
  assert.deepEqual(phaseCompare([true, true], 1), { status: "closed", beforeMark: 0, nowMark: 1 });
  assert.deepEqual(phaseCompare([true, false], 1), { status: "open", beforeMark: 0 }, "la segunda abierta: desde la marca de la primera");
  assert.deepEqual(phaseCompare([false, false], 1), { status: "waiting" }, "las dos abiertas: no se puede separar lo de la segunda");
  assert.deepEqual(phaseCompare([true, false, false], 2), { status: "waiting" });
  assert.deepEqual(phaseCompare([false, true], 1), { status: "closed", beforeMark: null, nowMark: 1 }, "si a la anterior le falta su marca, se compara con lo publicado");
});

console.log(`\nverify-changes-since: ${passed} checks passed.`);
