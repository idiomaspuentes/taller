/** A chapter in several texts side by side: one row per verse, whatever each text does with its verses. */
import assert from "node:assert/strict";
import { chapterRows, chaptersOf, MAX_PARALLEL, shownAtStart, toggleShown, type ParallelCell } from "../src/domain/parallelChapter";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}
const show = (cell: ParallelCell) => (cell.kind === "text" ? (cell.to ? `${cell.text} [hasta ${cell.to}]` : cell.text) : cell.kind === "joined" ? `(en ${cell.from})` : "—");

test("cada versículo es una fila, y cada texto dice lo suyo en ella aunque sea más largo", () => {
  const tpl = { id: "tpl", book: { "1:1": "Y sucedió en los días de Asuero", "1:2": "en aquellos días", "2:1": "Después de estas cosas" } };
  const ult = { id: "ult", book: { "1:1": "Now it happened in the days of Ahasuerus, the Ahasuerus who reigned from India to Cush", "1:2": "In those days" } };
  const rows = chapterRows([tpl, ult], 1);
  assert.deepEqual(rows.map((r) => r.verse), [1, 2]);
  assert.deepEqual(rows[0]!.cells.map(show), ["Y sucedió en los días de Asuero", "Now it happened in the days of Ahasuerus, the Ahasuerus who reigned from India to Cush"]);
  assert.deepEqual(chaptersOf([tpl, ult]), [1, 2]);
});

test("un texto que une dos versículos los muestra en la fila del primero, y la fila del segundo dice dónde están", () => {
  const tps = { id: "tps", book: { "1:4": "Durante seis meses mostró su riqueza y su gloria", "1:6": "Había cortinas" }, joined: { "1:4": 5 } };
  const orig = { id: "orig", book: { "1:4": "בְּהַרְאֹתוֹ", "1:5": "וּבִמְלוֹאת", "1:6": "חוּר" } };
  const rows = chapterRows([orig, tps], 1);
  assert.deepEqual(rows.map((r) => `${r.verse}: ${r.cells.map(show).join(" | ")}`), [
    "4: בְּהַרְאֹתוֹ | Durante seis meses mostró su riqueza y su gloria [hasta 5]",
    "5: וּבִמְלוֹאת | (en 4)",
    "6: חוּר | Había cortinas",
  ]);
});

test("un versículo que un texto no tiene se dice que falta, y las filas no se corren", () => {
  const draft = { id: "draft", book: { "3:1": "uno", "3:3": "tres" } };
  const ust = { id: "ust", book: { "3:1": "one", "3:2": "two", "3:3": "three" } };
  assert.deepEqual(chapterRows([draft, ust], 3).map((r) => r.cells.map(show).join(" | ")), ["uno | one", "— | two", "tres | three"]);
});

test("al tocar un texto se agrega o se quita; siempre queda uno, y no pasan de cuatro", () => {
  const order = ["orig", "ult", "ust", "draft", "other"];
  assert.deepEqual(toggleShown(["draft"], "orig", order), ["orig", "draft"], "en el orden de la pantalla");
  assert.deepEqual(toggleShown(["orig", "draft"], "orig", order), ["draft"]);
  assert.deepEqual(toggleShown(["draft"], "draft", order), ["draft"], "el último no se quita");
  const four = ["orig", "ult", "ust", "draft"];
  assert.equal(four.length, MAX_PARALLEL);
  assert.deepEqual(toggleShown(four, "other", order), four, "un quinto no entra: primero se quita otro");
});

test("al abrir, se ven los textos de la última vez, con el que se estaba leyendo entre ellos", () => {
  const order = ["orig", "ult", "ust", "draft"];
  assert.deepEqual(shownAtStart(["draft", "orig"], order), ["orig", "draft"]);
  assert.deepEqual(shownAtStart(["orig", "draft"], order, "ust"), ["orig", "ust", "draft"]);
  assert.deepEqual(shownAtStart(["orig", "ult", "ust", "draft"], order, "own"), ["orig", "ult", "ust", "draft"], "uno que la pantalla no tiene no cuenta");
  assert.deepEqual(shownAtStart(["other", "tpl"], order), ["orig"], "de otra pantalla no queda nada: el primero");
  assert.deepEqual(shownAtStart(null, order, "ult"), ["ult"]);
});

console.log(`\nverify-parallel-chapter: ${passed} checks passed.`);
