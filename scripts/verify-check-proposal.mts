/**
 * A change proposed while checking a help: how a proposal stands as the team answers it, what is asked of another
 * team when it is not the team's to change, and the old words read beside the new.
 */
import assert from "node:assert/strict";
import { PROPOSAL_FREE, diffExcerpt, proposalAnswer, proposalAsk, proposalDone, proposalSaying, proposalsOf, proposalsSettled, trialChecksKey, withoutWithdrawn, wordDiff, type ProposalPayload } from "../src/domain/checkProposal";
import { summarizeChecklist, type CheckAnswer } from "../src/domain/checklist";
import { setActiveScope } from "../src/domain/scope";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const at = (minute: number) => `2026-10-07T10:${String(minute).padStart(2, "0")}:00Z`;
const note: ProposalPayload = { id: "p1", resource: "notas", rowId: "ek3q", where: "1:1", before: "Traducción alternativa: [Yo, Judas, escribo esta carta]", after: "Traducción alternativa: [De parte de Judas,]" };
const made = (proposal: ProposalPayload = note, by = "abigail", minute = 0, questionId = "encaja"): CheckAnswer => proposalAnswer({ itemId: "ek3q", questionId, by, at: at(minute), reason: "La alternativa no encaja en la frase que reemplaza", proposal });
const ours = (resource: string) => resource === "notas" || resource === "academia";

test("un «no» resuelto con una propuesta deja la ayuda comprobada, y va a la lista de lo que el equipo acuerda", () => {
  const summary = summarizeChecklist({ items: [{ id: "ek3q", verseKey: "1:1" }], questions: [{ id: "encaja", text: "¿Encaja?" }], answers: [made()] });
  assert.equal(summary.complete, true);
  assert.equal(summary.changed.length, 1);
  assert.equal(summary.open.length, 0);
});

test("una propuesta está por acordar hasta que la apoyan las personas que hacen falta, contando a quien la hizo", () => {
  const [open] = proposalsOf([made()], 2, ours);
  assert.equal(open!.state, "open");
  assert.deepEqual(open!.inFavour, ["abigail"]);
  assert.equal(open!.reason, "La alternativa no encaja en la frase que reemplaza");
  const [agreed] = proposalsOf([made(), proposalSaying("p1", "Marcos", at(5), true)], 2, ours);
  assert.equal(agreed!.state, "agreed");
  assert.deepEqual(agreed!.inFavour, ["abigail", "Marcos"]);
  // Somebody who was for it and thought again is no longer counted.
  const [again] = proposalsOf([made(), proposalSaying("p1", "Marcos", at(5), true), proposalSaying("p1", "marcos", at(6), false)], 2, ours);
  assert.equal(again!.state, "open");
  // Whoever made it saying «de acuerdo» adds nobody.
  assert.equal(proposalsOf([made(), proposalSaying("p1", "Abigail", at(5), true)], 2, ours)[0]!.state, "open");
  assert.equal(proposalsOf([made()], 1, ours)[0]!.state, "agreed", "con una sola persona basta quien la hizo");
});

test("acordada no es hecha: lo es cuando se aplicó a la ayuda del equipo, o se envió al equipo que la mantiene", () => {
  const agreed = [made(), proposalSaying("p1", "marcos", at(5), true)];
  assert.equal(proposalsSettled(proposalsOf(agreed, 2, ours)), false, "falta aplicarla");
  const [applied] = proposalsOf([...agreed, proposalDone("p1", "marcos", at(6))], 2, ours);
  assert.equal(applied!.state, "applied");
  const text: ProposalPayload = { id: "p2", resource: "tpl", where: "1:3", before: "nuestra salvación común", after: "la salvación que compartimos" };
  const sent = proposalsOf([made(text, "abigail", 1), proposalSaying("p2", "marcos", at(5), true), proposalDone("p2", "marcos", at(6), "#151")], 2, ours);
  assert.equal(sent[0]!.state, "sent", "el TPL no es de este equipo: se le pide a quien lo mantiene");
  assert.equal(sent[0]!.sentAs, "#151");
  assert.equal(proposalsSettled(sent), true);
});

test("quien la hizo puede retirarla, y otra versión la reemplaza", () => {
  const [withdrawn] = proposalsOf([made(), proposalSaying("p1", "marcos", at(3), true), proposalSaying("p1", "abigail", at(5), false)], 2, ours);
  assert.equal(withdrawn!.state, "withdrawn");
  assert.deepEqual(withdrawn!.inFavour, []);
  const other: ProposalPayload = { ...note, id: "p3", after: "Traducción alternativa: [Yo, Judas,]", replaces: "p1" };
  const views = proposalsOf([made(), made(other, "marcos", 4)], 2, ours);
  assert.deepEqual(views.map((view) => `${view.proposal.id}:${view.state}`), ["p1:replaced", "p3:open"]);
  assert.equal(proposalsSettled(views), false, "la nueva versión sigue por acordar");
  assert.equal(proposalsSettled(proposalsOf([made(), proposalSaying("p1", "abigail", at(5), false)], 2, ours)), true);
  // Taken back, it no longer settles its «no»: the help is to be checked again.
  const questions = [{ id: "encaja", text: "¿Encaja?" }];
  const items = [{ id: "ek3q", verseKey: "1:1" }];
  const taken = [made(), proposalSaying("p1", "abigail", at(5), false)];
  assert.equal(summarizeChecklist({ items, questions, answers: withoutWithdrawn(taken) }).complete, false);
  assert.equal(summarizeChecklist({ items, questions, answers: withoutWithdrawn([made()]) }).complete, true);
});

test("lo que se ve de paso, sin ser respuesta a una pregunta del paso, también es una propuesta", () => {
  const free = made({ ...note, id: "p4" }, "dina", 2, PROPOSAL_FREE);
  const summary = summarizeChecklist({ items: [{ id: "ek3q", verseKey: "1:1" }], questions: [{ id: "encaja", text: "¿Encaja?" }], answers: [free] });
  assert.equal(summary.complete, false, "no responde ninguna pregunta: la ayuda sigue por comprobar");
  assert.equal(proposalsOf([free], 2, ours).length, 1);
});

test("a otro equipo se le pide con el motivo y la nueva versión, y con el lugar", () => {
  const text: ProposalPayload = { id: "p2", resource: "tps", where: "1:3", before: "…", after: "Dios nos  salvó\na todos" };
  const view = proposalsOf([proposalAnswer({ itemId: "x", questionId: "coincide", by: "dina", at: at(0), reason: "No coincide con lo que dice la nota", proposal: text })], 2, ours)[0]!;
  assert.deepEqual(proposalAsk(view), { about: "tps", where: "1:3", text: "No coincide con lo que dice la nota → «Dios nos salvó a todos»", by: "dina" });
  const comment = proposalsOf([proposalAnswer({ itemId: "x", questionId: "coincide", by: "dina", at: at(0), reason: "Aquí «santos» confunde", proposal: { id: "p5", resource: "tpl", where: "1:3" } })], 2, ours)[0]!;
  assert.equal(proposalAsk(comment).text, "Aquí «santos» confunde", "solo un comentario: no inventa una versión");
});

test("la versión de antes y la nueva se leen como un solo texto, con lo quitado y lo puesto", () => {
  const show = (before: string, after: string) => wordDiff(before, after).map((piece) => `${piece.kind === "same" ? "" : piece.kind === "gone" ? "-" : "+"}${piece.text}`).join("|");
  assert.equal(show("Traducción alternativa: [Yo, Judas, escribo esta carta]", "Traducción alternativa: [De parte de Judas,]"), "Traducción alternativa: |-[Yo, Judas, escribo esta carta] |+[De parte de Judas,]");
  assert.equal(show("a los amados en Dios", "a los que Dios ama"), "a los |-amados en |+que |Dios |+ama");
  assert.equal(show("igual", "igual"), "igual");
  assert.equal(show("", "nuevo texto"), "+nuevo texto");
  assert.equal(show("se quita todo", ""), "-se quita todo");
  // Read short, what changed is in sight with a few words on each side of it.
  const long = "En esta cultura, quienes escribían cartas daban primero su propio nombre y se referían a sí mismos en tercera persona. Traducción alternativa: [De parte de Judas,] y nada más que decir sobre esto aquí.";
  const short = diffExcerpt(wordDiff(long, long.replace("[De parte de Judas,]", "[Yo, Judas,]")), 3).map((piece) => `${piece.kind === "same" ? "" : piece.kind === "gone" ? "-" : "+"}${piece.text}`).join("|");
  assert.equal(short, "… persona. Traducción alternativa: |-[De parte de |+[Yo, |Judas,] y nada …");
  assert.deepEqual(diffExcerpt(wordDiff(long, long), 3), wordDiff(long, long), "sin cambios no se corta nada");
  // The words put back together read as the new version.
  const pieces = wordDiff("uno dos tres cuatro", "uno dos y medio cuatro");
  assert.equal(pieces.filter((piece) => piece.kind !== "gone").map((piece) => piece.text).join(""), "uno dos y medio cuatro");
});

test("lo que se responde de prueba se guarda aparte por espacio de trabajo", () => {
  setActiveScope("");
  assert.equal(trialChecksKey("JUD.tarea.paso"), "gt-trial-checks:JUD.tarea.paso");
  setActiveScope("pt");
  assert.equal(trialChecksKey("JUD.tarea.paso"), "gt-trial-checks:pt:JUD.tarea.paso");
  setActiveScope("");
});

console.log(`\nverify-check-proposal: ${passed} checks passed.`);
