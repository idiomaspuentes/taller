/** Verses a draft writes as one (`\v 4-5`): how they are named, found in a book and shown. */
import assert from "node:assert/strict";
import { spanLabel, spanOfSid, spanOfVerse } from "../src/domain/joinedVerses";

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

console.log(`\nverify-joined-verses: ${passed} checks passed.`);
