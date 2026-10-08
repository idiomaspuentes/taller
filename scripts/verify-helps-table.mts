/**
 * The tables of the helps (notes, questions) are read as Door43 writes them and written a row at a time: whoever
 * saves one row leaves every other line of the file as it was.
 * Run: npm run verify:helps-table
 */
import assert from "node:assert/strict";
import { applyHelpsTsvEdits, helpsRowField, mergeTsvRows } from "../src/domain/helpsDraft";
import { parseTsvTable, tsvCell } from "../src/prep/tsv";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const HEAD = "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote";
// Rows as the notes the team has published write them: a quote is a character, a cell may end with a space, an
// introduction keeps its line breaks written out.
const ROWS = [
  'front:intro\tm2jl\t\t\t\t0\t# Introducción a Ester\\n\\n## Parte 1 \\n\\nEl rey dijo "sí".',
  "1:1\trtc9\t\trc://*/ta/man/translate/figs-metaphor\tπίστιν \t1\t Primera de 1:1, con un espacio delante",
  '1:1\txyz8\t\t\tἐπίγνωσιν\t1\t"Gracia" es un don, no un pago.',
  '1:3\tabc1\t\t\tλόγον\t1\tUna comilla que no se cierra: "así',
  '1:4\tq001\t\t\t\t1\t"Empieza con una comilla y no la cierra',
  "2:1\tdef2\t\t\tλάλει\t1\tLa de 2:1 ",
];
const file = `${[HEAD, ...ROWS].join("\n")}\n`;
const noteOf = (text: string, id: string) => helpsRowField(text, id, "Note");
/** The lines of `after` that are not the same line of `before`. */
const changedLines = (before: string, after: string) => {
  const was = before.split("\n");
  return after.split("\n").filter((line, index) => line !== was[index]);
};

test("una comilla es una letra del texto: la celda que empieza con una la conserva, y la que no la cierra no se lleva las filas siguientes", () => {
  const { headers, rows } = parseTsvTable(file);
  assert.deepEqual(headers, HEAD.split("\t"));
  assert.equal(rows.length, ROWS.length);
  assert.equal(rows[2]!.Note, '"Gracia" es un don, no un pago.');
  assert.equal(rows[3]!.Note, 'Una comilla que no se cierra: "así');
  assert.equal(rows[4]!.Note, '"Empieza con una comilla y no la cierra');
  assert.equal(rows[5]!.ID, "def2", "la fila de después sigue siendo una fila");
  assert.equal(rows[0]!.Note, '# Introducción a Ester\\n\\n## Parte 1 \\n\\nEl rey dijo "sí".');
});

test("un archivo con comas se sigue leyendo como CSV", () => {
  const { rows } = parseTsvTable('Reference,ID,Note\n1:1,a1,"Dice ""sí"", y sigue"\n');
  assert.equal(rows[0]!.Note, 'Dice "sí", y sigue');
});

test("guardar una fila cambia esa línea y ninguna otra", () => {
  const saved = applyHelpsTsvEdits(file, [{ id: "def2", fields: { Note: "La de 2:1, corregida" } }]);
  assert.deepEqual(changedLines(file, saved), ["2:1\tdef2\t\t\tλάλει\t1\tLa de 2:1, corregida"]);
  assert.equal(saved.split("\n").length, file.split("\n").length);
});

test("de la fila que se guarda solo cambia la celda que cambió: las demás conservan sus espacios", () => {
  const saved = applyHelpsTsvEdits(file, [{ id: "rtc9", fields: { Note: "Primera de 1:1, corregida" } }]);
  assert.deepEqual(changedLines(file, saved), ["1:1\trtc9\t\trc://*/ta/man/translate/figs-metaphor\tπίστιν \t1\tPrimera de 1:1, corregida"]);
});

test("guardar el pasaje sin haber cambiado nada deja el archivo igual, byte por byte", () => {
  const asRead = parseTsvTable(file).rows.map((row) => ({ id: row.ID!, fields: { Note: row.Note! } }));
  assert.equal(applyHelpsTsvEdits(file, asRead), file);
  const crlf = file.replace(/\n/g, "\r\n");
  assert.equal(applyHelpsTsvEdits(crlf, asRead), crlf);
  const noEnd = file.replace(/\n$/, "");
  assert.equal(applyHelpsTsvEdits(noEnd, asRead), noEnd);
});

test("lo que la persona escribe se guarda como lo escribió: con sus comillas, y un salto de línea escrito con sus dos letras", () => {
  for (const typed of ['Dice "gracia" aquí.', '"Gracia" es un don.', 'Termina con comilla"', '"']) {
    const saved = applyHelpsTsvEdits(file, [{ id: "def2", fields: { Note: typed } }]);
    assert.equal(saved.split("\n")[6], `2:1\tdef2\t\t\tλάλει\t1\t${typed}`);
    assert.equal(noteOf(saved, "def2"), typed, "y se lee como se escribió");
    assert.equal(changedLines(file, saved).length, 1);
  }
  assert.equal(tsvCell("Primera línea.\n\nSegunda línea."), "Primera línea.\\n\\nSegunda línea.");
  assert.equal(tsvCell("Con\r\nfin de línea de Windows"), "Con\\nfin de línea de Windows");
  assert.equal(tsvCell("una\ttabulación"), "una tabulación", "una tabulación partiría la fila en una celda de más");
  const broken = applyHelpsTsvEdits(file, [{ id: "def2", fields: { Note: "Dos\nrenglones\ty una tabulación" } }]);
  assert.equal(broken.split("\n").length, file.split("\n").length, "la fila sigue en una línea");
  assert.equal(broken.split("\n")[6]!.split("\t").length, 7, "y con sus siete celdas");
});

test("un archivo con fin de línea de Windows, una línea vacía en medio o sin fin de línea al final se queda como estaba", () => {
  const odd = `${[HEAD, ROWS[0], ROWS[1], "", ROWS[2], ROWS[5]].join("\r\n")}`;
  const saved = applyHelpsTsvEdits(odd, [{ id: "xyz8", fields: { Note: "La gracia es un don." } }]);
  assert.deepEqual(saved.split("\r\n"), [HEAD, ROWS[0], ROWS[1], "", "1:1\txyz8\t\t\tἐπίγνωσιν\t1\tLa gracia es un don.", ROWS[5]]);
  assert.ok(!saved.endsWith("\n"), "no gana un fin de línea que no tenía");
  assert.ok(!/[^\r]\n/.test(saved), "ni una línea con otro fin de línea");
});

test("una fila con menos celdas que columnas recibe la suya en su columna", () => {
  const short = `${HEAD}\n3:1\tshrt\n3:2\tfull\t\t\t\t1\tCompleta\n`;
  const saved = applyHelpsTsvEdits(short, [{ id: "shrt", fields: { Note: "Ahora dice algo" } }]);
  assert.deepEqual(saved.split("\n")[1]!.split("\t"), ["3:1", "shrt", "", "", "", "", "Ahora dice algo"]);
  assert.equal(saved.split("\n")[2], "3:2\tfull\t\t\t\t1\tCompleta");
});

test("una fila nueva es una línea más: las otras no cambian, y el archivo termina como terminaba", () => {
  const added = applyHelpsTsvEdits(file, [{ id: "nv01", fields: { Note: 'Nueva, con "comillas"' }, addAt: "1:1" }]);
  assert.deepEqual(added.split("\n"), [HEAD, ROWS[0], ROWS[1], ROWS[2], '1:1\tnv01\t\t\t\t0\tNueva, con "comillas"', ROWS[3], ROWS[4], ROWS[5], ""]);
  const noEnd = file.replace(/\n$/, "");
  const last = applyHelpsTsvEdits(noEnd, [{ id: "nv02", fields: { Note: "La última" }, addAt: "9:9" }]);
  assert.deepEqual(last.split("\n"), [HEAD, ...ROWS, "9:9\tnv02\t\t\t\t0\tLa última"]);
  const crlf = file.replace(/\n/g, "\r\n");
  assert.ok(!/[^\r]\n/.test(applyHelpsTsvEdits(crlf, [{ id: "nv03", fields: { Note: "Con su fin de línea" }, addAt: "1:3" }])));
});

test("guardar todas las filas de un libro grande no tarda: cada fila se mira una vez", () => {
  const big = `${[HEAD, ...Array.from({ length: 8000 }, (_, n) => `${1 + Math.floor(n / 50)}:${1 + (n % 50)}\tr${n}\t\t\t\t1\tNota ${n} con "comillas"`)].join("\n")}\n`;
  const asRead = parseTsvTable(big).rows.map((row) => ({ id: row.ID!, fields: { Note: row.Note! } }));
  const started = Date.now();
  assert.equal(applyHelpsTsvEdits(big, asRead), big);
  assert.equal(mergeTsvRows(big, big, big), big);
  assert.ok(Date.now() - started < 3000, `tardó ${Date.now() - started} ms`);
});

// ---------------------------------------------------------------- the questions
const QHEAD = "Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse";
const questions = `${[
  QHEAD,
  '9:13\trj91\t\t\t\t¿Qué ocurrió con los cuerpos de los diez hijos de Amán?\t"Que los diez hijos de Amán cuelguen del palo". Y el rey ordenó que así se hiciera.',
  "9:14\tab12\t\t\t\t¿Qué ordenó el rey? \tQue se hiciera así. ",
].join("\n")}\n`;

test("en las preguntas, corregir una fila deja igual la respuesta de otra que empieza con una comilla", () => {
  assert.equal(helpsRowField(questions, "rj91", "Response"), '"Que los diez hijos de Amán cuelguen del palo". Y el rey ordenó que así se hiciera.');
  const saved = applyHelpsTsvEdits(questions, [{ id: "ab12", fields: { Question: "¿Qué ordenó el rey?", Response: "Que se hiciera así, y se hizo." } }]);
  assert.deepEqual(changedLines(questions, saved), ["9:14\tab12\t\t\t\t¿Qué ordenó el rey? \tQue se hiciera así, y se hizo."]);
});

// ---------------------------------------------------------------- the delivery of a passage's rows
test("la entrega pone en el archivo del grupo la línea que el borrador tiene, y deja las demás como están", () => {
  const source = file;
  const trunk = applyHelpsTsvEdits(file, [{ id: "rtc9", fields: { Note: "Lo que otro pasaje ya entregó" } }]);
  const work = applyHelpsTsvEdits(source, [{ id: "def2", fields: { Note: 'La de 2:1, "traducida"' } }, { id: "nv09", fields: { Note: "Una que faltaba" }, addAt: "2:1" }]);
  const merged = mergeTsvRows(trunk, work, source);
  assert.deepEqual(merged.split("\n"), [HEAD, ROWS[0], "1:1\trtc9\t\trc://*/ta/man/translate/figs-metaphor\tπίστιν \t1\tLo que otro pasaje ya entregó", ROWS[2], ROWS[3], ROWS[4], '2:1\tdef2\t\t\tλάλει\t1\tLa de 2:1, "traducida"', "2:1\tnv09\t\t\t\t0\tUna que faltaba", ""]);
  assert.equal(mergeTsvRows(merged, work, source), merged, "entregar dos veces no cambia nada");
});

test("sin nada que entregar, el archivo del grupo es el mismo, con sus fines de línea", () => {
  const trunk = file.replace(/\n/g, "\r\n");
  assert.equal(mergeTsvRows(trunk, file, file), trunk);
  // A row the draft has as the group does, written with other spaces, is not a change.
  const spaced = file.replace("La de 2:1 ", "La de 2:1");
  assert.equal(mergeTsvRows(trunk, spaced, file), trunk);
});

test("un borrador con las columnas en otro orden entrega su fila en las columnas del grupo", () => {
  const T = (rows: string[][]) => `${rows.map((row) => row.join("\t")).join("\n")}\n`;
  const trunk = T([["Reference", "ID", "Note"], ["1:1", "a1", 'Dice "uno"'], ["1:2", "a2", "dos"]]);
  const source = T([["ID", "Reference", "Note"], ["a1", "1:1", 'Dice "uno"'], ["a2", "1:2", "dos"]]);
  const work = T([["ID", "Reference", "Note"], ["a1", "1:1", 'Dice "uno"'], ["a2", "1:2", 'dos, "corregida"']]);
  assert.equal(mergeTsvRows(trunk, work, source), T([["Reference", "ID", "Note"], ["1:1", "a1", 'Dice "uno"'], ["1:2", "a2", 'dos, "corregida"']]));
});

test("una fila que el borrador agregó entra tras la que seguía, también en un archivo sin fin de línea al final", () => {
  const trunk = `${HEAD}\n${ROWS[1]}\n${ROWS[5]}`;
  const work = `${HEAD}\n${ROWS[1]}\n${ROWS[5]}\n2:2\tnv10\t\t\t\t1\tLa nueva\n`;
  assert.equal(mergeTsvRows(trunk, work, trunk), `${HEAD}\n${ROWS[1]}\n${ROWS[5]}\n2:2\tnv10\t\t\t\t1\tLa nueva`);
});

console.log(`\nverify-helps-table: ${passed} checks passed.`);
