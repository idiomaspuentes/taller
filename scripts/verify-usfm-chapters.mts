/**
 * A book's USFM cut by chapter: what is kept on the device and read by a tool is the chapter it works on, as a text
 * that stands alone.
 */
import assert from "node:assert/strict";
import { chapterUsfm, splitUsfmChapters } from "../src/domain/usfmChapters";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const book = [
  "\\id TIT EN_ULT en_English_ltr",
  "\\usfm 3.0",
  "\\h Titus",
  "\\mt Titus",
  "",
  "\\c 1",
  "\\p",
  "\\v 1 \\zaln-s |x-strong=\"G39720\" x-lemma=\"Παῦλος\"\\*\\w Paul|x-occurrence=\"1\" x-occurrences=\"1\"\\w*\\zaln-e\\*, a servant",
  "\\v 2 in hope",
  "\\c 2",
  "\\p",
  "\\v 1 But you, speak",
  "  \\c 3",
  "\\v 1 Remind them",
  "",
].join("\n");

test("un libro se corta por capítulos, y lo que hay antes del primero es su encabezado", () => {
  const parts = splitUsfmChapters(book);
  assert.deepEqual(Object.keys(parts.chapters).map(Number), [1, 2, 3]);
  assert.equal(parts.header, "\\id TIT EN_ULT en_English_ltr\n\\usfm 3.0\n\\h Titus\n\\mt Titus\n\n");
  assert.match(parts.chapters[1]!, /^\\c 1\n\\p\n\\v 1 .*servant\n\\v 2 in hope\n$/s);
  assert.equal(parts.chapters[2], "\\c 2\n\\p\n\\v 1 But you, speak\n");
  assert.equal(parts.chapters[3], "  \\c 3\n\\v 1 Remind them\n", "un capítulo con sangría también cuenta");
  // Nothing is lost or repeated: the pieces put back together are the book.
  assert.equal(parts.header + Object.values(parts.chapters).join(""), book);
});

test("un capítulo se lee solo: lleva el encabezado del libro, para que sus versículos sigan llamándose por él", () => {
  const parts = splitUsfmChapters(book);
  const second = chapterUsfm(parts, 2)!;
  assert.equal(second, "\\id TIT EN_ULT en_English_ltr\n\\usfm 3.0\n\\h Titus\n\\mt Titus\n\\c 2\n\\p\n\\v 1 But you, speak\n");
  assert.ok(!second.includes("\\c 1") && !second.includes("\\c 3"), "nada de los otros capítulos");
  assert.ok(chapterUsfm(parts, 1)!.includes("x-strong=\"G39720\""), "la alineación va con su capítulo");
  assert.equal(chapterUsfm(parts, 9), null, "un capítulo que el libro no tiene");
});

test("un texto sin capítulos marcados queda entero", () => {
  const parts = splitUsfmChapters("\\id FRT\n\\mt Portada\n");
  assert.deepEqual(parts.chapters, {});
  assert.equal(parts.header, "\\id FRT\n\\mt Portada\n");
  assert.equal(chapterUsfm(parts, 1), null);
  assert.deepEqual(splitUsfmChapters(""), { header: "", chapters: {} });
  // A word that only starts like the marker («\\ca», «\\cl») is not a chapter.
  assert.deepEqual(Object.keys(splitUsfmChapters("\\id PSA\n\\cl Salmo\n\\c 1\n\\ca 2\\ca*\n\\v 1 x\n").chapters), ["1"]);
});

console.log(`\nverify-usfm-chapters: ${passed} checks passed.`);
