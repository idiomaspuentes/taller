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

console.log(`\n${passed} pruebas pasaron`);
