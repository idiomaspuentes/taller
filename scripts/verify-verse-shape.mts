/**
 * A verse is shown in the shape its marks give it: the lines of a poem, each as deep as its mark says. What is
 * shown before a verse is saved has to be what saving writes, or the page would promise a poem and the file hold
 * prose. Run: npm run verify:verse-shape
 */
import assert from "node:assert/strict";
import { applyVerseEdits, listVerseSpans, skeletonUsfmFromSource, verseLeads } from "../src/domain/usfmEdit";
import { fieldLines, joinLine, lineOfOffset, linesText, setLine, splitLine, typedLines } from "../src/domain/verseLines";
import { chapterShape, expectedLines, lineShapes, shownLines, typedOffset } from "../src/domain/verseShape";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** Jonah 2 of a source text: prose, a psalm in lines of two depths, an empty line between stanzas, a bridge. */
const source = [
  "\\id JON EN_ULT",
  "\\usfm 3.0",
  "\\mt1 Jonah",
  "",
  "\\ts\\*",
  "\\c 2",
  "\\p",
  "\\v 1 And Jonah prayed.",
  "\\v 2 And he said,",
  "\\q1 “I cried out to Yahweh from my distress,",
  "\\q2 from the belly of Sheol I cried out.",
  "",
  "\\ts\\*",
  "\\q1",
  "\\v 3 Now you had cast me to the deep;",
  "\\q2 all your billows passed over me.",
  "\\b",
  "\\q1",
  "\\v 4-5 But I said.",
  "\\m",
  "\\v 6 Then Yahweh spoke.",
  "",
].join("\n");

/** The same chapter of a team, written already. */
const team = [
  "\\id JON",
  "\\c 2",
  "\\cl Capítulo 2",
  "\\nb",
  "\\v 1 Y Jonás oró.",
  "\\v 2 Y él dijo:",
  "\\q Clamé a Jehová;",
  "\\q2 desde el vientre clamé.",
  "\\s1 El abismo",
  "\\q",
  "\\v 3 Ahora me echaste;",
  "\\q2 todas tus ondas.",
  "\\b",
  "\\q",
  "\\v 4 Yo dije.",
  "\\p",
  "\\v 5 Entonces Jehová habló.",
  "\\c 3",
  "\\v 1 Y la palabra vino.",
  "",
].join("\n");

const marks = (lines: { marker: string; opens: boolean; gap: boolean }[]) => lines.map((line) => `${line.gap ? "_ " : ""}${line.marker}${line.opens ? "*" : ""}`).join(" ");

test("cada versículo sabe en qué párrafo o renglón empieza, si es el que lo abre, y las marcas de sus renglones", () => {
  const shape = chapterShape(team, 2);
  assert.deepEqual(shape[1], { marker: "nb", opens: true, gap: false, leads: [""], to: 1 });
  assert.deepEqual(shape[2], { marker: "nb", opens: false, gap: false, leads: ["", "\\q", "\\q2"], to: 2 }, "sigue en el párrafo de 2:1");
  assert.deepEqual(shape[3], { marker: "q", opens: true, gap: false, leads: ["", "\\q2"], to: 3 }, "el título que hay antes no es su marca");
  assert.deepEqual(shape[4], { marker: "q", opens: true, gap: true, leads: [""], to: 4 }, "con una línea vacía antes");
  assert.deepEqual(shape[5], { marker: "p", opens: true, gap: false, leads: [""], to: 5 });
  assert.deepEqual(chapterShape(team, 3)[1], { marker: "p", opens: false, gap: false, leads: [""], to: 1 }, "un capítulo no hereda el párrafo del anterior");
  assert.deepEqual(chapterShape(source, 2)[4], { marker: "q1", opens: true, gap: true, leads: [""], to: 5 }, "dos versículos en uno, por el primero");
});

test("un versículo ya escrito se muestra con la forma que tiene en el libro", () => {
  const shape = chapterShape(team, 2);
  assert.equal(marks(shownLines("Y Jonás oró.", shape[1])), "nb*");
  assert.deepEqual(shownLines("Y él dijo:\nClamé a Jehová;\ndesde el vientre clamé.", shape[2]), [
    { marker: "nb", text: "Y él dijo:", opens: false, gap: false },
    { marker: "q", text: "Clamé a Jehová;", opens: true, gap: false },
    { marker: "q2", text: "desde el vientre clamé.", opens: true, gap: false },
  ]);
  assert.equal(marks(shownLines("Ahora me echaste;\ntodas tus ondas.", shape[3])), "q* q2*");
  assert.equal(marks(shownLines("Yo dije.", shape[4])), "_ q*", "la línea vacía entre estrofas");
  // A line more than the verse has takes the mark of the one before it; a line less, the marks of those that are left.
  assert.equal(marks(shownLines("uno\ndos\ntres\ncuatro", shape[2])), "nb q* q2* q2*");
  assert.equal(marks(shownLines("uno\ndos", shape[2])), "nb q*");
  assert.deepEqual(shownLines("  \n ", shape[2]), [], "un versículo vacío no tiene renglones que mostrar");
});

test("un versículo de prosa es un renglón, se escriba como se escriba", () => {
  const shape = chapterShape(team, 2);
  assert.deepEqual(shownLines("Entonces\nJehová habló.", shape[5]), [{ marker: "p", text: "Entonces Jehová habló.", opens: true, gap: false }]);
  assert.deepEqual(shownLines("Suelto", undefined), [{ marker: "p", text: "Suelto", opens: false, gap: false }], "sin libro todavía");
});

test("en un libro que empieza, los renglones toman la forma que el original tiene en ese versículo", () => {
  const book = skeletonUsfmFromSource("JON", source, "Jonás");
  const shape = chapterShape(book, 2);
  const leads = verseLeads(source, 2);
  assert.deepEqual([shape[1]!.marker, shape[2]!.marker, shape[3]!.marker, shape[6]!.marker], ["p", "p", "q1", "m"]);
  assert.equal(marks(shownLines("Y dijo,\n«Clamé a Jehová desde mi angustia,\ndesde el vientre del Seol clamé.", shape[2], leads[2])), "p q1* q2*", "como el original: una línea de prosa y dos renglones del salmo");
  assert.equal(marks(shownLines("Ahora me echaste;\ntodas tus olas.", shape[3], leads[3])), "q1* q2*");
  assert.equal(marks(shownLines("Ahora me echaste; todas tus olas.", shape[3], leads[3])), "q1*", "en una sola línea, el renglón que abre el versículo");
  assert.equal(marks(shownLines("Pero yo dije.", shape[4])), "_ q1*");
});

test("lo que se muestra antes de guardar es lo que se guarda", () => {
  /** The marks a verse has in a file, read from its lines: the mark alone on the line before `\v`, and those of its own lines. */
  const written = (usfm: string, verse: number) => {
    const span = listVerseSpans(usfm).find((s) => s.chapter === 2 && s.verse === verse)!;
    const before = usfm.slice(0, span.start).split("\n").filter(Boolean).pop() ?? "";
    const opening = /^\\(q\d?|p|m|nb)$/.exec(before)?.[1];
    const lines = span.rawBody.replace(/^\\v \S+ ?/, "").split("\n").filter((line) => line.trim());
    const own = lines.filter((line) => !/^\\(ts\\\*|s\d|b$|p$|m$|q\d?$|c )/.test(line)).map((line) => /^\\(q\d?|p|m|nb) /.exec(line)?.[1] ?? "");
    return [opening ? `${opening}*` : "(sigue)", ...own.slice(1).map((mark) => `${mark}*`)].join(" ");
  };
  const book = skeletonUsfmFromSource("JON", source, "Jonás");
  const leads = verseLeads(source, 2);
  const cases: [number, string][] = [
    [2, "Y dijo,\n«Clamé a Jehová desde mi angustia,\ndesde el vientre del Seol clamé."],
    [2, "Y dijo: «Clamé a Jehová»."],
    [3, "Ahora me echaste;\ntodas tus olas."],
    [3, "Ahora me echaste;\ntodas tus olas;\ny tus ondas."],
    [1, "Y Jonás oró\na su Dios."],
    [6, "Entonces Jehová habló."],
  ];
  for (const [verse, text] of cases) {
    const shown = shownLines(text, chapterShape(book, 2)[verse], leads[verse] ?? []);
    const saved = applyVerseEdits(book, 2, [{ from: verse, to: verse, text, leads: leads[verse] }]);
    const said = marks(shown).replace(/^(p|nb)$/, "(sigue)").replace(/^(p|nb) /, "(sigue) ");
    assert.equal(written(saved, verse), verse === 1 ? "p*" : said, `2:${verse} «${text.replace(/\n/g, " / ")}»`);
    // And once saved it is shown the same from the file alone, with nothing of the source at hand.
    assert.equal(marks(shownLines(text, chapterShape(saved, 2)[verse])), marks(shown), `2:${verse}, leído del archivo`);
  }
});

test("dos versículos unidos aquí y sin guardar todavía son prosa, como se guardarán", () => {
  const shape = chapterShape(team, 2);
  // The row joins 2:2 and 2:3; the book still has them apart, so the lines of 2:2 are not those of the row.
  const joined = shape[2]!.to === 3 ? shape[2] : { ...shape[2]!, leads: [] };
  assert.deepEqual(shownLines("Y él dijo que clamó\ny fue echado.", joined), [{ marker: "nb", text: "Y él dijo que clamó y fue echado.", opens: false, gap: false }]);
  const saved = applyVerseEdits(team, 2, [{ from: 2, to: 3, text: "Y él dijo que clamó\ny fue echado." }]);
  assert.ok(saved.includes("\\v 2-3 Y él dijo que clamó y fue echado.\n"));
});

test("tocar el versículo mostrado pone el cursor en ese lugar del texto como se escribió", () => {
  const typed = "Y dijo,\n«Clamé a Jehová,\ndesde el vientre clamé.";
  assert.equal(typedOffset(typed, 3, 0, 2), 2);
  assert.equal(typed.slice(typedOffset(typed, 3, 1, 7)), "a Jehová,\ndesde el vientre clamé.", "en el segundo renglón, ante «a»");
  assert.equal(typed.slice(typedOffset(typed, 3, 2, 9)), "vientre clamé.");
  assert.equal(typedOffset(typed, 3, 2, 999), typed.length, "más allá del renglón, su final");
  assert.equal(typedOffset(typed, 3, 9, 0), typed.indexOf("desde"), "un renglón que no hay, el último");
  // Spaces at the start of a line and empty lines are not shown: they are not counted either.
  const loose = "  Y dijo,\n\n   «Clamé.";
  assert.equal(loose.slice(typedOffset(loose, 2, 1, 1)), "Clamé.");
  // A verse of prose typed in two lines is shown as one, joined by a space.
  const prose = "Y Jonás oró\na su Dios.";
  assert.equal(prose.slice(typedOffset(prose, 1, 0, 12)), "a su Dios.");
  assert.equal(prose.slice(typedOffset(prose, 1, 0, 8)), "oró\na su Dios.");
  assert.equal(typedOffset(prose, 1, 0, 999), prose.length);
  assert.equal(typedOffset("", 0, 0, 3), 0);
});

// ---------------------------------------------------------------- a verse of a poem, a field to a line

test("un versículo de un poema se escribe en tantos campos como renglones tiene su original, con su forma", () => {
  const book = skeletonUsfmFromSource("JON", source, "Jonás");
  const shape = chapterShape(book, 2);
  const leads = verseLeads(source, 2);
  assert.equal(expectedLines(shape[2], leads[2]), 3, "una línea de prosa y dos renglones");
  assert.equal(expectedLines(shape[3], leads[3]), 2);
  assert.equal(expectedLines(shape[1], leads[1]), 1, "un versículo de prosa es un cuadro");
  assert.equal(expectedLines(chapterShape(team, 2)[2]), 3, "y uno ya escrito, los que tiene en el libro");
  assert.equal(marks(lineShapes(3, shape[2], leads[2])!), "p q1* q2*", "los campos, antes de escribir nada, como los renglones del original");
  assert.equal(marks(lineShapes(4, shape[3], leads[3])!), "q1* q2* q2* q2*", "un renglón de más, como el anterior");
  assert.equal(lineShapes(2, shape[1], leads[1]), null, "la prosa no tiene renglones");
  // The fields: the lines written, and those of the source that are still to be written.
  assert.deepEqual(fieldLines("", 2), ["", ""]);
  assert.deepEqual(fieldLines("uno", 2), ["uno", ""]);
  assert.deepEqual(fieldLines("uno\ndos\ntres", 2), ["uno", "dos", "tres"]);
  assert.deepEqual(fieldLines("uno\ndos", 2, 1), ["uno", "dos", ""], "uno más, pedido con «Otro renglón»");
  assert.deepEqual(fieldLines("\ndos", 2), ["", "dos"], "un renglón dejado para después sigue en su sitio");
});

test("Enter empieza un renglón y Retroceso al inicio lo une al anterior", () => {
  const lines = ["Yo dije: He sido expulsado;", "pero volveré a mirar."];
  assert.deepEqual(splitLine(["Yo dije: He sido expulsado; pero volveré a mirar.", ""], 0, 27), { lines, place: { line: 1, offset: 0 } }, "lo que sigue al cursor pasa al renglón vacío que había");
  assert.deepEqual(splitLine(["uno dos", "tres"], 0, 4), { lines: ["uno", "dos", "tres"], place: { line: 1, offset: 0 } }, "o a uno nuevo, si el siguiente ya dice algo");
  assert.deepEqual(splitLine(["uno", ""], 0, 3), { lines: ["uno", ""], place: { line: 1, offset: 0 } }, "al final de un renglón, el cursor baja al vacío");
  assert.deepEqual(splitLine(["uno"], 0, 3), { lines: ["uno", ""], place: { line: 1, offset: 0 } });
  assert.deepEqual(splitLine(["uno dos tres"], 0, 4, 7), { lines: ["uno", "tres"], place: { line: 1, offset: 0 } }, "lo seleccionado se reemplaza por el corte");
  assert.deepEqual(joinLine(lines, 1), { lines: ["Yo dije: He sido expulsado; pero volveré a mirar."], place: { line: 0, offset: 28 } }, "con un espacio entre los dos, y el cursor en la unión");
  assert.deepEqual(joinLine(["uno", ""], 1), { lines: ["uno"], place: { line: 0, offset: 3 } });
  assert.deepEqual(joinLine(["", "dos"], 1), { lines: ["dos"], place: { line: 0, offset: 0 } });
  assert.deepEqual(joinLine(lines, 0).lines, lines, "el primer renglón no tiene a cuál unirse");
});

test("lo que se pega con saltos de línea se reparte en renglones, y los vacíos del final no son texto", () => {
  assert.deepEqual(setLine(["", ""], 0, "uno\ndos\ntres"), { lines: ["uno", "dos", "tres", ""], place: { line: 2, offset: 4 } });
  assert.deepEqual(setLine(["uno", "dos"], 1, "dos y más").lines, ["uno", "dos y más"]);
  assert.equal(linesText(["uno", "dos", "", ""]), "uno\ndos", "un versículo que nadie cambió no difiere de sí mismo por un salto de línea");
  assert.equal(linesText(["", "dos"]), "\ndos");
  assert.equal(linesText(["", ""]), "");
  assert.deepEqual(typedLines("uno\r\ndos"), ["uno", "dos"]);
  // Tocar el versículo mostrado lleva al campo de ese renglón.
  const typed = "Y dijo,\n«Clamé a Jehová,\ndesde el vientre clamé.";
  assert.deepEqual(lineOfOffset(typed, typedOffset(typed, 3, 1, 7)), { line: 1, offset: 7 });
  assert.deepEqual(lineOfOffset(typed, typedOffset(typed, 3, 2, 999)), { line: 2, offset: 23 });
  assert.deepEqual(lineOfOffset("\ndos", typedOffset("\ndos", 1, 0, 2)), { line: 1, offset: 2 }, "con un renglón vacío antes");
  assert.deepEqual(lineOfOffset("", 0), { line: 0, offset: 0 });
});

console.log(`\nverify-verse-shape: ${passed} checks passed.`);
