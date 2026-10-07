/**
 * A change proposed while checking a help: how a proposal stands as the team answers it, what is asked of another
 * team when it is not the team's to change, the old words read beside the new, and whether a new version still
 * fits the help it was written from.
 */
import assert from "node:assert/strict";
import { PROPOSAL_FREE, appliedWords, byPlaceAndHelp, diffExcerpt, proposalAnswer, proposalAsk, proposalDone, proposalFit, proposalHelp, proposalKeeping, proposalSaying, proposalWords, proposalsOf, proposalsSettled, sameWording, sharedHelp, trialChecksKey, withoutWithdrawn, wordDiff, type ProposalPayload } from "../src/domain/checkProposal";
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

test("quien prefiere dejarlo como está lo dice, y con las personas que hacen falta la propuesta no se acepta", () => {
  const keeps = (who: string, minute: number, keep = true) => proposalKeeping("p1", who, at(minute), keep);
  const [one] = proposalsOf([made(), keeps("marcos", 3)], 2, ours);
  assert.equal(one!.state, "open", "una sola persona no decide por el equipo");
  assert.deepEqual([one!.inFavour, one!.against], [["abigail"], ["marcos"]]);
  assert.equal(proposalsSettled([one!]), false);
  const [two] = proposalsOf([made(), keeps("marcos", 3), keeps("Dina", 4)], 2, ours);
  assert.equal(two!.state, "rejected");
  assert.equal(proposalsSettled([two!]), true, "ya no detiene el paso");
  // The «no» it answered stays settled: the team looked at it and left the help as it was.
  assert.equal(summarizeChecklist({ items: [{ id: "ek3q", verseKey: "1:1" }], questions: [{ id: "encaja", text: "¿Encaja?" }], answers: withoutWithdrawn([made(), keeps("marcos", 3), keeps("dina", 4)]) }).complete, true);
  // Whoever thinks again is counted where they stand last: for it, against it, or neither.
  assert.equal(proposalsOf([made(), keeps("marcos", 3), keeps("dina", 4), keeps("dina", 5, false)], 2, ours)[0]!.state, "open");
  const [turned] = proposalsOf([made(), keeps("marcos", 3), proposalSaying("p1", "marcos", at(6), true)], 2, ours);
  assert.deepEqual([turned!.state, turned!.inFavour, turned!.against], ["agreed", ["abigail", "marcos"], []]);
  const [back] = proposalsOf([made(), proposalSaying("p1", "marcos", at(3), true), keeps("marcos", 6), keeps("dina", 7)], 2, ours);
  assert.deepEqual([back!.state, back!.inFavour], ["rejected", ["abigail"]], "quien estaba de acuerdo y cambió de parecer ya no cuenta a favor");
  // Its author does not vote against their own: they take it back.
  assert.equal(proposalsOf([made(), keeps("abigail", 3), keeps("marcos", 4)], 2, ours)[0]!.state, "open");
  // What was carried out is not undone by saying so afterwards.
  assert.equal(proposalsOf([made(), proposalSaying("p1", "marcos", at(3), true), proposalDone("p1", "marcos", at(4)), keeps("dina", 5), keeps("eva", 6)], 2, ours)[0]!.state, "applied");
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

test("una nueva versión solo cabe sobre las palabras de las que se escribió: si la ayuda dice otra cosa, cambió", () => {
  assert.equal(proposalFit(note, note.before!), "fits");
  // As the file keeps it: line ends written «\n», spaces at the ends, two spaces where there was one.
  const paragraphs: ProposalPayload = { ...note, before: "Primer párrafo.\n\nSegundo párrafo.", after: "Primer párrafo.\n\nOtro segundo párrafo." };
  assert.equal(proposalFit(paragraphs, " Primer párrafo.\\n\\nSegundo  párrafo.\r\n"), "fits", "los espacios y los saltos de línea no hacen otra versión");
  assert.equal(sameWording("a  b\n", "a b"), true);
  assert.equal(sameWording("a b", "a c"), false);
  // Another proposal for the same note was applied first.
  assert.equal(proposalFit(note, "Traducción alternativa: [Yo, Judas,]"), "changed");
  assert.equal(proposalFit(note, ""), "changed", "la nota quedó vacía: tampoco es de la que se escribió");
  // Applied already (saying so failed, or two people applied it at once): nothing to write, and no refusal.
  assert.equal(proposalFit(note, `${note.after}\n`), "done");
  // A proposal that only parts a paragraph in two says the same as before: it is still to be written.
  assert.equal(proposalFit({ before: "Uno. Dos.", after: "Uno.\n\nDos." }, "Uno. Dos."), "fits");
  assert.equal(proposalFit({ after: "Sin saber de dónde salió." }, "Cualquier cosa"), "fits", "sin las palabras de antes no hay con qué comparar");
});

test("las propuestas por resolver sobre la misma ayuda se señalan, y se leen una tras otra", () => {
  const second: ProposalPayload = { ...note, id: "p6", after: "Traducción alternativa: [Judas escribe]" };
  const third: ProposalPayload = { ...note, id: "p7", after: "Traducción alternativa: [Les escribe Judas]" };
  const otherNote: ProposalPayload = { id: "p8", resource: "notas", rowId: "zz99", where: "1:1", before: "Otra nota.", after: "Otra nota, cambiada." };
  const text: ProposalPayload = { id: "p9", resource: "tpl", where: "1:1", before: "…", after: "…" };
  assert.equal(proposalHelp(note), "notas:ek3q");
  assert.equal(proposalHelp({ id: "a", resource: "academia", path: "translate/figs-metaphor/01.md", where: "1:1" }), "academia:translate/figs-metaphor/01.md");
  assert.equal(proposalHelp(text), "", "un versículo del texto no es una ayuda del equipo");
  // Made in this order: the note, another note of the verse, the text, and the same note again from another list.
  const rows = [made(note, "abigail", 0), made(otherNote, "marcos", 1), made(text, "dina", 2), made(second, "marcos", 3)];
  const views = proposalsOf(rows, 2, ours);
  assert.deepEqual([...sharedHelp(views)], [["p1", 1], ["p6", 1]]);
  assert.deepEqual(byPlaceAndHelp(views).map((view) => view.proposal.id), ["p1", "p6", "p8", "p9"], "las dos de la misma nota, juntas");
  assert.deepEqual([...sharedHelp(proposalsOf([...rows, made(third, "dina", 4)], 2, ours)).values()], [2, 2, 2]);
  // One applied, taken back or answered is no longer one to choose among.
  const applied = proposalsOf([...rows, proposalSaying("p1", "marcos", at(5), true), proposalDone("p1", "marcos", at(6))], 2, ours);
  assert.equal(sharedHelp(applied).size, 0);
  const answered = proposalsOf([made(note), made({ ...second, replaces: "p1" }, "marcos", 3)], 2, ours);
  assert.equal(sharedHelp(answered).size, 0, "una versión y la que la reemplaza no son dos por resolver");
  // The question and the answer of one row are one help, and two different stretches of words.
  const question: ProposalPayload = { id: "q1", resource: "preguntas", rowId: "ab12", field: "Question", where: "1:2" };
  assert.equal(proposalHelp(question), proposalHelp({ ...question, id: "q2", field: "Response" }));
  assert.notEqual(proposalWords(question), proposalWords({ ...question, id: "q2", field: "Response" }));
  assert.equal(proposalWords(note), "notas:ek3q:Note");
});

test("de prueba, donde nada se escribe, una ayuda dice lo que dejó la última propuesta aplicada", () => {
  const applied = proposalsOf([made(), proposalSaying("p1", "marcos", at(5), true), proposalDone("p1", "marcos", at(6)), made({ ...note, id: "p6", after: "Otra." }, "dina", 7)], 2, ours);
  const words = appliedWords(applied);
  assert.deepEqual(words, { "notas:ek3q:Note": note.after });
  // The one still to resolve was written from the note as it was: against what the trial left, it changed.
  assert.equal(proposalFit(applied[1]!.proposal, words[proposalWords(applied[1]!.proposal)]!), "changed");
});

test("lo que se responde de prueba se guarda aparte por espacio de trabajo", () => {
  setActiveScope("");
  assert.equal(trialChecksKey("JUD.tarea.paso"), "gt-trial-checks:JUD.tarea.paso");
  setActiveScope("pt");
  assert.equal(trialChecksKey("JUD.tarea.paso"), "gt-trial-checks:pt:JUD.tarea.paso");
  setActiveScope("");
});

console.log(`\nverify-check-proposal: ${passed} checks passed.`);
