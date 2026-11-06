/** Verses a draft writes as one (`\v 4-5`): how they are named, found in a book and shown. */
import assert from "node:assert/strict";
import { joinDraftRows, spanLabel, spanOfSid, spanOfVerse, splitDraftRow, type DraftJoins } from "../src/domain/joinedVerses";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("el nombre de un versículo dice qué versículos son: uno, o los que el borrador escribe como uno solo", () => {
  assert.deepEqual(spanOfSid("JUD 1:4-5", 1), { from: 4, to: 5 });
  assert.deepEqual(spanOfSid("JUD 1:12–13", 1), { from: 12, to: 13 }, "con guion o con raya");
  assert.deepEqual(spanOfSid("JUD 1:6", 1), { from: 6, to: 6 });
  assert.equal(spanOfSid("JUD 2:1-2", 1), null, "los de otro capítulo no");
  assert.equal(spanOfSid("JUD", 1), null);
});

test("en un libro, un versículo se halla con los que está escrito, por cualquiera de sus números", () => {
  const BS = String.fromCharCode(92);
  const book = ["id JUD", "c 1", "p", "v 3 Amados.", "v 4-5 Algunos entraron; quiero recordarles.", "v 6 Y a los ángeles.", "c 2", "v 4 Otro."].map((line) => BS + line).join("\n");
  assert.deepEqual(spanOfVerse(book, 1, 4), { from: 4, to: 5 });
  assert.deepEqual(spanOfVerse(book, 1, 5), { from: 4, to: 5 });
  assert.deepEqual(spanOfVerse(book, 1, 6), { from: 6, to: 6 });
  assert.deepEqual(spanOfVerse(book, 2, 4), { from: 4, to: 4 }, "el 4 de otro capítulo es él solo");
  assert.deepEqual(spanOfVerse(book, 1, 9), { from: 9, to: 9 }, "uno que el libro no tiene, también");
});

test("se muestran como «4–5»", () => {
  assert.equal(spanLabel({ verse: 4, to: 5 }), "4–5");
  assert.equal(spanLabel({ verse: 4 }), "4");
  assert.equal(spanLabel({ from: 12, to: 13 }), "12–13");
  assert.equal(spanLabel({ from: 6, to: 6 }), "6");
});

test("unir dos versículos y separarlos sin tocar nada devuelve a cada uno su texto", () => {
  const joins: DraftJoins = new Map();
  const joined = joinDraftRows({ from: 6, to: 6, text: "Linos de algodón." }, { from: 7, to: 7, text: "Y el servicio de bebidas." }, joins);
  assert.deepEqual(joined, { from: 6, to: 7, text: "Linos de algodón. Y el servicio de bebidas." });
  assert.deepEqual(splitDraftRow(joined, joins), [
    { from: 6, to: 6, text: "Linos de algodón." },
    { from: 7, to: 7, text: "Y el servicio de bebidas." },
  ]);
});

test("un versículo vacío vuelve vacío, y el otro con su texto", () => {
  const joins: DraftJoins = new Map();
  const joined = joinDraftRows({ from: 6, to: 6, text: "Linos de algodón." }, { from: 7, to: 7, text: "" }, joins);
  assert.equal(joined.text, "Linos de algodón.");
  assert.deepEqual(splitDraftRow(joined, joins), [
    { from: 6, to: 6, text: "Linos de algodón." },
    { from: 7, to: 7, text: "" },
  ]);
});

test("uniones seguidas (6 con 7, luego con 8) se deshacen en los tres versículos", () => {
  const joins: DraftJoins = new Map();
  const six7 = joinDraftRows({ from: 6, to: 6, text: "Seis." }, { from: 7, to: 7, text: "Siete." }, joins);
  const six8 = joinDraftRows(six7, { from: 8, to: 8, text: "Ocho." }, joins);
  assert.deepEqual(splitDraftRow(six8, joins), [
    { from: 6, to: 6, text: "Seis." },
    { from: 7, to: 7, text: "Siete." },
    { from: 8, to: 8, text: "Ocho." },
  ]);
});

test("si el texto unido se cambió después, no se sabe qué va dónde: todo queda en el primero, como antes", () => {
  const joins: DraftJoins = new Map();
  const joined = joinDraftRows({ from: 6, to: 6, text: "Seis." }, { from: 7, to: 7, text: "Siete." }, joins);
  const edited = { ...joined, text: "Seis y siete, reescritos." };
  assert.deepEqual(splitDraftRow(edited, joins), [
    { from: 6, to: 6, text: "Seis y siete, reescritos." },
    { from: 7, to: 7, text: "" },
  ]);
});

test("un puente que ya venía en el archivo se separa como siempre: el texto en el primero", () => {
  assert.deepEqual(splitDraftRow({ from: 4, to: 5, text: "Algunos entraron." }, new Map()), [
    { from: 4, to: 4, text: "Algunos entraron." },
    { from: 5, to: 5, text: "" },
  ]);
});

test("lo recordado de una unión se olvida al deshacerla", () => {
  const joins: DraftJoins = new Map();
  const joined = joinDraftRows({ from: 6, to: 6, text: "Seis." }, { from: 7, to: 7, text: "Siete." }, joins);
  splitDraftRow(joined, joins);
  assert.equal(joins.size, 0);
});

console.log(`\nverify-joined-verses: ${passed} checks passed.`);
