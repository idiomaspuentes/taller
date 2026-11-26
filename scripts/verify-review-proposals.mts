/**
 * A reviewer's proposal of other words is a comment of the review with a marker of its own: written and read back,
 * compared with the text of the piece to know whether it was used, and kept out of what can be changed once used.
 */
import assert from "node:assert/strict";
import { refComment } from "../src/domain/commentPlace";
import { pieceTextAt } from "../src/domain/pieceTextAt";
import { canEditComment, openComments, reviewCommentsFrom } from "../src/domain/reviewComments";
import {
  formatProposal,
  parseProposal,
  proposalUsed,
  samePiece,
  sameShape,
  withoutProposalMarker,
  type PieceText,
  type Proposal,
} from "../src/domain/reviewProposals";
import { replaceLineWords, proposalInto } from "../src/domain/proposalInto";
import { extractDraftVerses } from "../src/domain/usfmAst";
import { boxTextWithProposal, usfmFromBoxes, verseBoxText } from "../src/domain/verseBoxes";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const AUTHOR = "abelper8";
const REVIEWER = "Elisha";

const said = (id: number, login: string, body: string) => ({
  id,
  body,
  user: { login },
  created_at: `2026-11-25T10:0${id}:00Z`,
  updated_at: `2026-11-25T10:0${id}:00Z`,
});

const p: Proposal = {
  over: { text: "En el año tercero hizo un banquete" },
  words: { text: "En el tercer año de su reinado hizo un banquete" },
  why: "Suena más natural.",
};

test("una propuesta escrita y leída da los mismos datos", () => {
  const body = formatProposal("EST", "1:3", p, "Propongo: «En el tercer año de su reinado hizo un banquete»");
  assert.deepEqual(parseProposal(body), { ...p, ref: "1:3" });
  const [row] = reviewCommentsFrom([said(1, REVIEWER, body)], AUTHOR);
  assert.equal(row!.ref, "1:3");
  assert.deepEqual(row!.proposal, p);
  assert.ok(!row!.text.includes("<!--"), "el marcador no se lee como texto");
  assert.ok(row!.text.startsWith("Propongo:"));
  assert.equal(withoutProposalMarker(body).includes("taller-proposal"), false);
});

test("un comentario de antes se lee igual", () => {
  const [row] = reviewCommentsFrom([said(1, REVIEWER, refComment("EST", "1:2", "Falta «el»."))], AUTHOR);
  assert.equal(row!.proposal, undefined);
  assert.equal(row!.text, "Falta «el».");
  assert.equal(row!.ref, "1:2");
});

test("una pregunta propone pregunta y respuesta juntas", () => {
  const q: Proposal = { over: { text: "¿Quién?", secondary: "Él." }, words: { text: "¿Quién fue?", secondary: "Fue él." } };
  const parsed = parseProposal(formatProposal("EST", "1:3 §ab12", q, "Propongo: «¿Quién fue?»\n«Fue él.»"));
  assert.equal(parsed?.words.secondary, "Fue él.");
  assert.equal(parsed?.over.secondary, "Él.");
  assert.equal(parsed?.why, undefined);
});

test("un marcador roto o ajeno no es una propuesta", () => {
  assert.equal(parseProposal("**EST 1:3** — hola"), null);
  assert.equal(parseProposal("<!-- taller-proposal ###no -->"), null);
  assert.equal(parseProposal("<!-- taller-proposal e30 -->"), null);
});

test("usada si el texto dice lo propuesto, aunque cambien espacios y comillas", () => {
  const q: Proposal = { over: { text: "x" }, words: { text: "dijo: «ven»" } };
  assert.equal(proposalUsed(q, { text: 'dijo:  "ven"' }), true);
  assert.equal(proposalUsed(q, { text: "dijo: «vete»" }), false);
  assert.equal(proposalUsed(q, undefined), false);
});

const rows = () => reviewCommentsFrom([said(1, REVIEWER, formatProposal("EST", "1:3", p, "Propongo: «…»"))], AUTHOR);

test("una propuesta usada no cuenta como abierta; retocada sí; con la pieza borrada sí", () => {
  const used = (): PieceText => ({ text: p.words.text });
  const touched = (): PieceText => ({ text: `${p.words.text} y más` });
  assert.equal(openComments(rows(), AUTHOR, used).length, 0, "usada");
  assert.equal(openComments(rows(), AUTHOR, () => touched()).length, 1, "retocada");
  assert.equal(openComments(rows(), AUTHOR, () => undefined).length, 1, "la pieza ya no está");
  assert.equal(openComments(rows(), AUTHOR).length, 1, "sin texto con qué comparar cuenta como hoy");
});

test("con el paso cerrado no se compara", () => {
  assert.equal(openComments(rows(), AUTHOR, undefined, true).length, 0);
  assert.equal(openComments(rows(), AUTHOR, () => ({ text: "otra cosa" }), true).length, 0);
});

test("un cambio solo de comillas o espacios no es una propuesta", () => {
  assert.equal(samePiece({ text: "«a» b" }, { text: "“a”  b" }), true);
  assert.equal(samePiece({ text: "a b" }, { text: "a c" }), false);
  assert.equal(samePiece({ text: "a", secondary: "b" }, { text: "a" }), false);
});

test("la forma cambió si cambió el número de líneas", () => {
  const poem: Proposal = { over: { text: "a\nb" }, words: { text: "uno\ndos" } };
  assert.equal(sameShape(poem, { text: "uno\ndos" }), true);
  assert.equal(sameShape(poem, { text: "uno\ndos\ntres" }), false);
});

test("una propuesta usada no se cambia ni se borra", () => {
  const all = rows();
  assert.equal(canEditComment(all[0]!, all, REVIEWER, { reviewOpen: true }), true);
  assert.equal(canEditComment(all[0]!, all, REVIEWER, { reviewOpen: true, used: true }), false);
});

test("el texto actual de cada pieza sale en la forma de la caja, por su lugar", () => {
  const usfm = "\\c 1\n\\p\n\\v 1 Uno.\n\\v 2 Dos.\n";
  const tsv = "Reference\tID\tQuote\tOccurrence\tNote\n1:2\tab12\tx\t1\tNota de prueba\n";
  const at = pieceTextAt({ files: [{ filename: "17-EST.usfm", text: usfm }, { filename: "tn_EST.tsv", text: tsv }], range: { chapter: 1, from: 1, to: 2 } });
  assert.deepEqual(at("1:2"), { text: "Dos." });
  assert.deepEqual(at("1:2 §ab12"), { text: "Nota de prueba" });
  assert.equal(at("1:9"), undefined, "una pieza que ya no está no se encuentra");
});

const POEM = [
  "\\id JON",
  "\\c 2",
  "\\p",
  "\\v 2 Y él dijo:",
  "\\q1 Clamé a \\nd Jehová\\nd* desde mi angustia\\f + \\fr 2:2 \\ft Otra lectura: aflicción.\\f*",
  "\\q2 y él me respondió;",
  "\\q2 desde el vientre del Seol clamé.",
  "\\v 3 Ahora me echaste a lo profundo.",
  "",
].join("\n");

test("usar una propuesta en un versículo de poesía con nota cambia solo las palabras, por el camino del editor: quedan las marcas de línea, la nota y lo marcado", () => {
  // The boxes as the editor holds them when the file is opened, and the box text it compares with.
  const boxes = extractDraftVerses(POEM, { chapter: 2, from: 2, to: 3 }).slots;
  const verse2 = boxes.find((row) => row.from === 2)!;
  assert.equal(verseBoxText(verse2).text, "Y él dijo:\nClamé a Jehová desde mi angustia\ny él me respondió;\ndesde el vientre del Seol clamé.");
  const proposal: Proposal = { over: verseBoxText(verse2), words: { text: "Y él dijo:\nClamé a Jehová desde mi aflicción\ny él me contestó;\ndesde el vientre del Seol clamé." } };
  // What «Usar estas palabras» puts in the box (as updateVerse does), and the file the editor writes from the boxes.
  const text = boxTextWithProposal(verse2, proposal)!;
  assert.equal(text, proposal.words.text);
  const saved = usfmFromBoxes(POEM, 2, boxes.map((row) => (row === verse2 ? { ...row, text } : row)), {}).usfm;
  assert.equal(saved, POEM.replace("angustia", "aflicción").replace("respondió", "contestó"), "solo cambiaron dos palabras: las marcas, la nota y lo marcado siguen");
  const after = extractDraftVerses(saved, { chapter: 2, from: 2, to: 3 }).slots.find((row) => row.from === 2)!;
  assert.equal(proposalUsed(proposal, verseBoxText(after)), true, "la caja ya dice lo propuesto");
});

test("usar una propuesta conserva la sangría y las líneas vacías de la caja, y no se ofrece si cambió el número de líneas", () => {
  assert.equal(replaceLineWords("  uno dos\n\n tres ", "UNO\nTRES"), "  UNO\n\n TRES ");
  assert.equal(replaceLineWords("uno\ndos", "solo una"), null);
  const poem: Proposal = { over: { text: "a\nb" }, words: { text: "uno\ndos" } };
  assert.equal(proposalInto({ text: "a\nb\nc" }, poem), null, "una línea de más: a mano");
  assert.equal(proposalInto({ text: "a b" }, poem), null, "unidas en una: a mano");
});

test("usar una pregunta cambia la pregunta y la respuesta, cada una en su caja", () => {
  const q: Proposal = { over: { text: "¿Qué?", secondary: "Nada." }, words: { text: "¿Qué pasó?", secondary: "Nada pasó." } };
  assert.deepEqual(proposalInto({ text: "¿Qué?", secondary: "Nada." }, q), { text: "¿Qué pasó?", secondary: "Nada pasó." });
  assert.equal(proposalInto({ text: "¿Qué?" }, q), null);
});

console.log(`\n${passed} pruebas pasaron`);
