/**
 * A change proposed while checking a help: how a proposal stands as the team answers it, what is asked of another
 * team when it is not the team's to change, the old words read beside the new, and whether a new version still
 * fits the help it was written from.
 */
import assert from "node:assert/strict";
import { PROPOSAL_FREE, appliedWords, byPlaceAndHelp, diffExcerpt, othersNeeded, proposalAnswer, proposalAsk, proposalDone, proposalFit, proposalHelp, proposalKeeping, readable, proposalSaying, proposalWords, proposalsOf, proposalsSettled, versionsOf, proposalDecided, disputeStalled, sameWording, sharedHelp, trialChecksKey, withoutWithdrawn, wordDiff, type ProposalPayload } from "../src/domain/checkProposal";
import { summarizeChecklist, type CheckAnswer } from "../src/domain/checklist";
import { adjustmentDeclined, proposalMark } from "../src/domain/singleProposal";
import { correctionTitle } from "../src/domain/corrections";
import { applyHelpsTsvEdits, freshRowId } from "../src/domain/helpsDraft";
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

test("sin acuerdo no hay cambio: con tantas personas por dejarlo como está como hacían falta para acordarlo, no se acepta", () => {
  const keeps = (who: string, minute: number, keep = true) => proposalKeeping("p1", who, at(minute), keep);
  // Where three have to agree, it takes two besides the author either way.
  const [one] = proposalsOf([made(), keeps("marcos", 3)], 3, ours);
  assert.equal(one!.state, "open", "una sola persona no decide por un equipo que pide tres");
  assert.deepEqual([one!.inFavour, one!.against], [["abigail"], ["marcos"]]);
  assert.equal(proposalsSettled([one!]), false);
  const [two] = proposalsOf([made(), keeps("marcos", 3), keeps("Dina", 4)], 3, ours);
  assert.equal(two!.state, "rejected");
  assert.equal(proposalsSettled([two!]), true, "ya no detiene el paso");
  // Where two have to agree, the other person is the one who decides: a team of two was left with no way out.
  assert.equal(othersNeeded(2), 1);
  const [pair] = proposalsOf([made(), keeps("marcos", 3)], 2, ours);
  assert.deepEqual([pair!.state, pair!.against], ["rejected", ["marcos"]]);
  // The «no» it answered stays settled: the team looked at it and left the help as it was.
  assert.equal(summarizeChecklist({ items: [{ id: "ek3q", verseKey: "1:1" }], questions: [{ id: "encaja", text: "¿Encaja?" }], answers: withoutWithdrawn([made(), keeps("marcos", 3)]) }).complete, true);
  // Whoever thinks again is counted where they stand last: for it, against it, or neither.
  assert.equal(proposalsOf([made(), keeps("marcos", 3), keeps("marcos", 5, false)], 2, ours)[0]!.state, "open", "se deshace, y vuelve a estar por resolver");
  const [turned] = proposalsOf([made(), keeps("marcos", 3), proposalSaying("p1", "marcos", at(6), true)], 2, ours);
  assert.deepEqual([turned!.state, turned!.inFavour, turned!.against], ["agreed", ["abigail", "marcos"], []]);
  const [back] = proposalsOf([made(), proposalSaying("p1", "marcos", at(3), true), keeps("marcos", 6), keeps("dina", 7)], 3, ours);
  assert.deepEqual([back!.state, back!.inFavour], ["rejected", ["abigail"]], "quien estaba de acuerdo y cambió de parecer ya no cuenta a favor");
  // Its author does not vote against their own: they take it back.
  assert.equal(proposalsOf([made(), keeps("abigail", 3)], 2, ours)[0]!.state, "open");
  // What was carried out is not undone by saying so afterwards.
  assert.equal(proposalsOf([made(), proposalSaying("p1", "marcos", at(3), true), proposalDone("p1", "marcos", at(4)), keeps("dina", 5), keeps("eva", 6)], 2, ours)[0]!.state, "applied");
});

test("una versión se muestra como se lee: sin las marcas con que está escrita", () => {
  const written = "**Fe** es un sustantivo abstracto. (Ver: [[rc://*/ta/man/translate/figs-abstractnouns]])\\n\\nMira [Mateo 24:31](../../mat/24/31.md). Traducción alternativa: [para fortalecer la fe]";
  assert.equal(readable(written), "Fe es un sustantivo abstracto.\nMira Mateo 24:31. Traducción alternativa: [para fortalecer la fe]");
  assert.equal(readable("Dice (como en 1:3: «gracia») algo."), "Dice (como en 1:3: «gracia») algo.", "un paréntesis con palabras se queda");
  assert.equal(readable("sin marcas"), "sin marcas");
  // What is put in and taken out is still told word by word.
  const pieces = wordDiff(readable("**Fe** se refiere al creer o al confiar."), readable("**Fe** se refiere al confiar."));
  assert.deepEqual(pieces.filter((piece) => piece.kind !== "same").map((piece) => [piece.kind, piece.text.trim()]), [["gone", "creer o al"]]);
});

test("una nota que falta se agrega en su versículo, una sola vez, con un id que el archivo no tiene", () => {
  const file = ["Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote", "front:intro\tm2jl\t\t\t\t0\tIntroducción", "1:1\trtc9\t\t\tπίστιν\t1\tPrimera de 1:1", "1:1\txyz8\t\t\tἐπίγνωσιν\t1\tSegunda de 1:1", "1:3\tabc1\t\t\tλόγον\t1\tLa de 1:3", "2:1\tdef2\t\t\tλάλει\t1\tLa de 2:1"].join("\n");
  const added = applyHelpsTsvEdits(file, [{ id: "nv01", fields: { Note: "Una nota nueva de 1:1" }, addAt: "1:1" }]);
  const rows = added.split("\n").filter(Boolean).map((line) => line.split("\t"));
  assert.deepEqual(rows.map((row) => row[1]), ["ID", "m2jl", "rtc9", "xyz8", "nv01", "abc1", "def2"], "tras la última de su versículo");
  assert.deepEqual(rows[4], ["1:1", "nv01", "", "", "", "0", "Una nota nueva de 1:1"], "sin cita todavía: se marca después, en el texto");
  assert.equal(applyHelpsTsvEdits(added, [{ id: "nv01", fields: { Note: "Una nota nueva de 1:1" }, addAt: "1:1" }]), added, "aplicada otra vez no se agrega otra");
  // A verse with no note of its own yet: after the notes of the verses before it.
  assert.deepEqual(applyHelpsTsvEdits(file, [{ id: "nv02", fields: { Note: "De 1:2" }, addAt: "1:2" }]).split("\n").filter(Boolean).map((line) => line.split("\t")[1]), ["ID", "m2jl", "rtc9", "xyz8", "nv02", "abc1", "def2"]);
  // The other rows are what they were.
  assert.deepEqual(added.split("\n").filter((line) => line && !line.includes("nv01")), file.split("\n"));
  // An id like the ones a file has, and none of them.
  let turn = 0;
  const taken = ["aaaa"];
  const id = freshRowId(taken, () => (turn++ < 4 ? 0 : 0.5));
  assert.match(id, /^[a-z][a-z0-9]{3}$/);
  assert.notEqual(id, "aaaa", "el primero que salió ya estaba: se saca otro");
});

test("la otra mitad de una nota dividida se agrega al lado de la primera, no al final de su versículo", () => {
  const file = ["Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote", "1:1\trtc9\t\t\tπίστιν\t1\tPrimera de 1:1", "1:1\txyz8\t\t\tἐπίγνωσιν\t1\tSegunda de 1:1", "1:3\tabc1\t\t\tλόγον\t1\tLa de 1:3"].join("\n");
  const edits = [{ id: "rtc9", fields: { Note: "Primera, ya sin su otra mitad" } }, { id: "nv03", fields: { Note: "La otra mitad", Quote: "ἐκλεκτῶν", Occurrence: "1" }, addAt: "1:1", addAfter: "rtc9" }];
  const parted = applyHelpsTsvEdits(file, edits);
  const rows = parted.split("\n").filter(Boolean).map((line) => line.split("\t"));
  assert.deepEqual(rows.map((row) => row[1]), ["ID", "rtc9", "nv03", "xyz8", "abc1"]);
  assert.deepEqual(rows[1], ["1:1", "rtc9", "", "", "πίστιν", "1", "Primera, ya sin su otra mitad"], "la que estaba conserva su cita");
  assert.deepEqual(rows[2], ["1:1", "nv03", "", "", "ἐκλεκτῶν", "1", "La otra mitad"]);
  assert.equal(applyHelpsTsvEdits(parted, edits), parted, "aplicada otra vez no cambia nada");
  // Beside a row the file does not have: where a new note of that verse goes.
  assert.deepEqual(applyHelpsTsvEdits(file, [{ id: "nv04", fields: { Note: "Suelta" }, addAt: "1:1", addAfter: "zzzz" }]).split("\n").filter(Boolean).map((line) => line.split("\t")[1]), ["ID", "rtc9", "xyz8", "nv04", "abc1"]);
});

test("lo que se ve de paso, sin ser respuesta a una pregunta del paso, también es una propuesta", () => {
  const free = made({ ...note, id: "p4" }, "dina", 2, PROPOSAL_FREE);
  const summary = summarizeChecklist({ items: [{ id: "ek3q", verseKey: "1:1" }], questions: [{ id: "encaja", text: "¿Encaja?" }], answers: [free] });
  assert.equal(summary.complete, false, "no responde ninguna pregunta: la ayuda sigue por comprobar");
  assert.equal(proposalsOf([free], 2, ours).length, 1);
});

test("a otro equipo se le pide con el motivo y la nueva versión, y con el lugar", () => {
  const text: ProposalPayload = { id: "p2", resource: "tps", where: "1:3", before: "Dios nos salvó", after: "Dios nos  salvó\na todos" };
  const view = proposalsOf([proposalAnswer({ itemId: "x", questionId: "coincide", by: "dina", at: at(0), reason: "No coincide con lo que dice la nota", proposal: text })], 2, ours)[0]!;
  assert.deepEqual(proposalAsk(view), { about: "tps", where: "1:3", text: "No coincide con lo que dice la nota → «Dios nos salvó a todos»", by: "dina" });
  const comment = proposalsOf([proposalAnswer({ itemId: "x", questionId: "coincide", by: "dina", at: at(0), reason: "Aquí «santos» confunde", proposal: { id: "p5", resource: "tpl", where: "1:3" } })], 2, ours)[0]!;
  assert.equal(proposalAsk(comment).text, "Aquí «santos» confunde", "solo un comentario: no inventa una versión");
  // The reason is the person's to give or not: without one, what it answered «no» to is said in its place.
  const bare = proposalsOf([proposalAnswer({ itemId: "x", questionId: "coincide", by: "dina", at: at(0), reason: "", proposal: text })], 2, ours)[0]!;
  assert.equal(proposalAsk(bare, "No se cumple: ¿Coincide con el TPS?").text, "No se cumple: ¿Coincide con el TPS? → «Dios nos salvó a todos»");
  assert.equal(proposalAsk(view, "No se cumple: ¿Coincide con el TPS?").text, "No coincide con lo que dice la nota → «Dios nos salvó a todos»", "con un motivo, la pregunta queda para la conversación");
  // A whole verse with a word changed: the subtarea is named by the change, and its name is not cut before it.
  const verse = "Yo, Pablo, te escribo esta carta, Tito. Soy servidor de Dios y apóstol de Jesús el Mesías. Dios me envió a enseñar al pueblo que él ha escogido como suyo para que confíe más en él. Trabajo para ayudar a su pueblo a saber lo que es verdad, para que puedan vivir de forma que agrade a Dios,";
  const long = proposalsOf([proposalAnswer({ itemId: "x", questionId: "coincide", by: "dina", at: at(0), reason: "La nota dice «confiar en Jesús» y el TPS dice «en él».", proposal: { id: "p6", resource: "tps", where: "1:1", before: verse, after: verse.replace("más en él.", "más en Jesús.") } })], 2, ours)[0]!;
  const asked = proposalAsk(long, "No se cumple: Cuando la nota menciona el TPS, ¿coincide con lo que el TPS dice?");
  assert.equal(asked.text, "La nota dice «confiar en Jesús» y el TPS dice «en él». «… más en él. Trabajo para …» → «… más en Jesús. Trabajo para …»");
  assert.equal(correctionTitle(asked), `Corrección 1:1: ${asked.text}`, "cabe entera en el nombre de la subtarea");
});

test("la versión de antes y la nueva se leen como un solo texto, con lo quitado y lo puesto", () => {
  const show = (before: string, after: string) => wordDiff(before, after).map((piece) => `${piece.kind === "same" ? "" : piece.kind === "gone" ? "-" : "+"}${piece.text}`).join("|");
  assert.equal(show("Traducción alternativa: [Yo, Judas, escribo esta carta]", "Traducción alternativa: [De parte de Judas,]"), "Traducción alternativa: |-[Yo, Judas, escribo esta carta] |+[De parte de Judas,]");
  assert.equal(show("a los amados en Dios", "a los que Dios ama"), "a los |-amados en |+que |Dios |+ama");
  assert.equal(show("igual", "igual"), "igual");
  assert.equal(show("", "nuevo texto"), "+nuevo texto");
  assert.equal(show("se quita todo", ""), "-se quita todo");
  // What stays before words taken out from the end keeps the space that parted it from them.
  assert.equal(show("Queda esto. Y esto se va.", "Queda esto."), "Queda esto. |-Y esto se va.");
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

test("una sola propuesta puede responder a varias preguntas que no se cumplen: es una propuesta, y cada pregunta queda resuelta", () => {
  const payload = { id: "pr-varias", resource: "notas", where: "1:1", rowId: "ek3q", field: "Note", before: "antes", after: "después" };
  const at = "2026-10-20T10:00:00Z";
  const two = [
    proposalAnswer({ itemId: "ek3q", questionId: "sentido", by: "ana", at, reason: "¿Tiene sentido? · ¿Es útil?", proposal: payload }),
    proposalAnswer({ itemId: "ek3q", questionId: "util", by: "ana", at, reason: "¿Tiene sentido? · ¿Es útil?", proposal: payload }),
  ];
  assert.equal(proposalsOf(two, 2).length, 1, "una propuesta, no dos");
  const summary = summarizeChecklist({ items: [{ id: "ek3q", verseKey: "1:1" }], questions: [{ id: "sentido", text: "¿Tiene sentido?" }, { id: "util", text: "¿Es útil?" }], answers: two });
  assert.equal(summary.complete, true, "las dos preguntas quedan resueltas por la propuesta");
  // Taken back, it no longer answers either.
  assert.equal(summarizeChecklist({ items: [{ id: "ek3q", verseKey: "1:1" }], questions: [{ id: "sentido", text: "¿Tiene sentido?" }, { id: "util", text: "¿Es útil?" }], answers: withoutWithdrawn([...two, proposalSaying("pr-varias", "ana", "2026-10-20T11:00:00Z", false)]) }).complete, false);
});

test("una propuesta que el equipo ajusta es una sola, en versiones: cada ajuste reemplaza al anterior, sea de quien sea", () => {
  const p = (id: string, after: string, replaces?: string) => ({ id, resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after, ...(replaces ? { replaces } : {}) });
  const v1 = proposalAnswer({ itemId: "n1", questionId: "sentido", by: "carla", at: "2026-10-21T10:00:00Z", reason: "", proposal: p("pr-1", "b") });
  const v2 = proposalAnswer({ itemId: "n1", questionId: "sentido", by: "ana", at: "2026-10-21T10:10:00Z", reason: "mejor así", proposal: p("pr-2", "c", "pr-1") });
  const views = proposalsOf([v1, v2, proposalSaying("pr-1", "bea", "2026-10-21T10:05:00Z", true)], 3);
  assert.equal(views.find((view) => view.proposal.id === "pr-1")!.state, "replaced");
  assert.equal(views.find((view) => view.proposal.id === "pr-2")!.state, "open");
  assert.deepEqual(views.find((view) => view.proposal.id === "pr-2")!.inFavour, ["ana"], "quien apoyó la versión 1 confirma la 2");
  assert.deepEqual(versionsOf(views, "pr-2").map((view) => view.proposal.id), ["pr-1", "pr-2"]);
  // Its author takes the adjustment back: the version before is the proposal again.
  const back = proposalsOf([v1, v2, proposalSaying("pr-2", "ana", "2026-10-21T10:20:00Z", false)], 3);
  assert.equal(back.find((view) => view.proposal.id === "pr-1")!.state, "open");
  assert.equal(back.find((view) => view.proposal.id === "pr-2")!.state, "withdrawn");
});

test("por acuerdo de todos: no gana quien tiene más a favor; con alguien en contra la propuesta sigue en conversación", () => {
  const p = { id: "pr-c", resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after: "b" };
  const made = proposalAnswer({ itemId: "n1", questionId: "sentido", by: "ana", at: "2026-10-21T10:00:00Z", reason: "", proposal: p });
  const rule = { consensus: true };
  const one = (rows: CheckAnswer[]) => proposalsOf([made, ...rows], 3, () => true, rule)[0]!;
  // Two for it and one against: by majority it would be agreed; by agreement of all it is not.
  const split = one([proposalSaying("pr-c", "bea", "2026-10-21T10:05:00Z", true), proposalKeeping("pr-c", "carla", "2026-10-21T10:06:00Z", true)]);
  assert.equal(split.state, "open");
  assert.equal(split.disputedSince, "2026-10-21T10:06:00Z", "el desacuerdo empieza cuando hay alguien de cada lado");
  assert.equal(proposalsOf([made, proposalSaying("pr-c", "bea", "2026-10-21T10:05:00Z", true), proposalKeeping("pr-c", "carla", "2026-10-21T10:06:00Z", true)], 3)[0]!.state, "open", "sin la regla, con 2 de 3 tampoco basta");
  // Carla comes round: everybody agrees.
  const agreed = one([proposalSaying("pr-c", "bea", "2026-10-21T10:05:00Z", true), proposalKeeping("pr-c", "carla", "2026-10-21T10:06:00Z", true), proposalSaying("pr-c", "carla", "2026-10-21T11:00:00Z", true)]);
  assert.equal(agreed.state, "agreed");
  assert.equal(agreed.disputedSince, undefined);
  // Two would rather leave it as it is, its author still for it: not left aside until the author comes round too.
  const two = [proposalKeeping("pr-c", "bea", "2026-10-21T10:05:00Z", true), proposalKeeping("pr-c", "carla", "2026-10-21T10:06:00Z", true)];
  assert.equal(one(two).state, "open");
  assert.equal(proposalsOf([made, ...two], 3)[0]!.state, "rejected", "por mayoría sí se dejaba");
  const yielded = one([...two, proposalKeeping("pr-c", "ana", "2026-10-21T12:00:00Z", true)]);
  assert.equal(yielded.state, "rejected");
  assert.deepEqual(yielded.inFavour, []);
});

test("si el equipo no se pone de acuerdo en días, decide quien coordina el equipo, y nadie más", () => {
  const p = { id: "pr-d", resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after: "b" };
  const rows = [
    proposalAnswer({ itemId: "n1", questionId: "sentido", by: "ana", at: "2026-10-17T10:00:00Z", reason: "", proposal: p }),
    proposalSaying("pr-d", "bea", "2026-10-17T10:05:00Z", true),
    proposalKeeping("pr-d", "carla", "2026-10-17T10:06:00Z", true),
  ];
  const rule = { consensus: true, decides: (login: string) => login === "tito" };
  const open = proposalsOf(rows, 3, () => true, rule)[0]!;
  assert.equal(disputeStalled(open, Date.parse("2026-10-19T10:00:00Z")), false, "dos días: todavía conversan");
  assert.equal(disputeStalled(open, Date.parse("2026-10-21T10:00:00Z")), true, "más de tres días");
  assert.equal(proposalsOf([...rows, proposalDecided("pr-d", "bea", "2026-10-21T10:00:00Z", true)], 3, () => true, rule)[0]!.state, "open", "quien no coordina no decide");
  const decided = proposalsOf([...rows, proposalDecided("pr-d", "tito", "2026-10-21T10:00:00Z", false)], 3, () => true, rule)[0]!;
  assert.equal(decided.state, "rejected");
  assert.equal(decided.decidedBy, "tito");
  assert.equal(proposalsOf([...rows, proposalDecided("pr-d", "tito", "2026-10-21T10:00:00Z", true)], 3, () => true, rule)[0]!.state, "agreed");
});

test("por acuerdo de todos, cada propuesta es una opción: otra puede partir de la nota como está, y gana la que eligen todos", () => {
  const p = (id: string, after: string, replaces?: string) => ({ id, resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after, ...(replaces ? { replaces } : {}) });
  const rule = { consensus: true };
  const rows = [
    proposalAnswer({ itemId: "n1", questionId: "sentido", by: "ana", at: "2026-10-21T10:00:00Z", reason: "", proposal: p("pr-a", "un cambio grande") }),
    proposalAnswer({ itemId: "n1", questionId: "sentido", by: "carla", at: "2026-10-21T10:10:00Z", reason: "más sencillo", proposal: p("pr-b", "un cambio chico") }),
    proposalKeeping("pr-a", "bea", "2026-10-21T10:20:00Z", true),
  ];
  const three = proposalsOf(rows, 3, () => true, rule);
  const a = three.find((view) => view.proposal.id === "pr-a")!;
  assert.equal(a.state, "open");
  assert.deepEqual(a.choices, { ana: "pr-a", carla: "pr-b", bea: "keep" });
  assert.equal(a.disputedSince, "2026-10-21T10:10:00Z", "dos opciones elegidas desde que carla propuso la suya");
  // Bea and Ana come to Carla's: it is agreed, and Ana's is left aside.
  const met = proposalsOf([...rows, proposalSaying("pr-b", "bea", "2026-10-21T11:00:00Z", true), proposalSaying("pr-b", "ana", "2026-10-21T11:05:00Z", true)], 3, () => true, rule);
  assert.equal(met.find((view) => view.proposal.id === "pr-b")!.state, "agreed");
  assert.equal(met.find((view) => view.proposal.id === "pr-a")!.state, "rejected");
  assert.deepEqual(met.find((view) => view.proposal.id === "pr-b")!.inFavour.sort(), ["ana", "bea", "carla"]);
});

test("editar una opción la mejora sin quitarle quien la eligió, que ve que cambió", () => {
  const p = (id: string, after: string, replaces?: string) => ({ id, resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after, ...(replaces ? { replaces } : {}) });
  const rows = [
    proposalAnswer({ itemId: "n1", questionId: "sentido", by: "ana", at: "2026-10-21T10:00:00Z", reason: "", proposal: p("pr-a", "b") }),
    proposalSaying("pr-a", "bea", "2026-10-21T10:05:00Z", true),
    proposalAnswer({ itemId: "n1", questionId: "sentido", by: "carla", at: "2026-10-21T10:10:00Z", reason: "mejor así", proposal: p("pr-a2", "c", "pr-a") }),
  ];
  const head = proposalsOf(rows, 3, () => true, { consensus: true }).find((view) => view.proposal.id === "pr-a2")!;
  assert.equal(head.option, "pr-a", "la opción conserva su id");
  assert.equal(head.state, "open", "ana y bea la eligieron antes de la edición: tienen que verla de nuevo");
  assert.deepEqual(head.staleFor?.sort(), ["ana", "bea"]);
  assert.deepEqual(head.choices, { ana: "pr-a", bea: "pr-a", carla: "pr-a" }, "siguen eligiéndola");
  const seen = proposalsOf([...rows, proposalSaying("pr-a2", "ana", "2026-10-21T11:00:00Z", true), proposalSaying("pr-a2", "bea", "2026-10-21T11:01:00Z", true)], 3, () => true, { consensus: true });
  assert.equal(seen.find((view) => view.proposal.id === "pr-a2")!.state, "agreed");
});

// ---------------------------------------------------------------- one proposal per note, with adjustments (27 October)

const P = (id: string, after: string, extra: Partial<ProposalPayload> = {}): ProposalPayload => ({ id, resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after, ...extra });
const wrote = (who: string, time: string, proposal: ProposalPayload, questionId = "sentido") => proposalAnswer({ itemId: "n1", questionId, by: who, at: time, reason: "", proposal });
const T = (hhmm: string, day = "28") => `2026-10-${day}T${hhmm}:00Z`;
const single = { consensus: true, decides: (login: string) => login === "tito" };
const pick = (views: ReturnType<typeof proposalsOf>, id: string) => views.find((one) => one.proposal.id === id)!;
const adjusting = (who: string, time: string, id: string, after: string, of = "pr-a") => wrote(who, time, P(id, after, { suggests: of }));

test("una propuesta nueva sobre una nota que ya tiene propuesta se lee como ajuste a ella", () => {
  const views = proposalsOf([wrote("ana", T("10:00"), P("pr-a", "b")), wrote("carla", T("10:10"), P("pr-b", "c"))], 3, () => true, single);
  assert.equal(pick(views, "pr-b").adjusts, "pr-a");
  assert.equal(pick(views, "pr-b").adjustment, "pending");
  assert.deepEqual(pick(views, "pr-a").choices, { ana: "pr-a" }, "quien sugiere un ajuste no elige nada con él");
  assert.equal(pick(views, "pr-a").adjusts, undefined);
});

test("dos propuestas de antes de SINGLE_PROPOSAL_FROM siguen siendo dos opciones", () => {
  const views = proposalsOf([wrote("ana", T("10:00", "21"), P("pr-a", "b")), wrote("carla", T("10:10", "21"), P("pr-b", "c"))], 3, () => true, single);
  assert.equal(pick(views, "pr-b").adjusts, undefined);
  assert.equal(pick(views, "pr-a").choices?.carla, "pr-b");
});

test("un ajuste aceptado: la propuesta toma su texto, «ajustada por», y el ajuste ya no espera", () => {
  const rows = [wrote("ana", T("10:00"), P("pr-a", "b")), adjusting("bea", T("10:10"), "aj-1", "c"), wrote("ana", T("10:20"), P("pr-a2", "c", { replaces: "pr-a", accepts: "aj-1", adjustedBy: "bea" }))];
  const views = proposalsOf(rows, 3, () => true, single);
  assert.equal(pick(views, "pr-a2").option, "pr-a");
  assert.equal(pick(views, "pr-a2").state, "open");
  assert.equal(pick(views, "aj-1").adjustment, "accepted");
  assert.equal(pick(views, "aj-1").state, "replaced");
});

test("un ajuste no aceptado por la autora queda a la vista y la propuesta no cambia", () => {
  const rows = [wrote("ana", T("10:00"), P("pr-a", "b")), adjusting("bea", T("10:10"), "aj-1", "c")];
  const declined = proposalsOf([...rows, adjustmentDeclined("aj-1", "ana", T("10:20"), "prefiero la mía")], 3, () => true, single);
  assert.equal(pick(declined, "aj-1").adjustment, "declined");
  assert.equal(pick(declined, "aj-1").declinedBy, "ana");
  assert.equal(pick(declined, "pr-a").state, "open");
  const notHers = proposalsOf([...rows, adjustmentDeclined("aj-1", "carla", T("10:20"))], 3, () => true, single);
  assert.equal(pick(notHers, "aj-1").adjustment, "pending", "solo la autora (o quien coordina) lo acepta o no");
});

test("quien coordina puede aceptar o no un ajuste por la autora", () => {
  const rows = [wrote("ana", T("10:00"), P("pr-a", "b")), adjusting("bea", T("10:10"), "aj-1", "c")];
  assert.equal(pick(proposalsOf([...rows, adjustmentDeclined("aj-1", "tito", T("10:20"))], 3, () => true, single), "aj-1").adjustment, "declined");
  const accepted = proposalsOf([...rows, wrote("tito", T("10:20"), P("pr-a2", "c", { replaces: "pr-a", accepts: "aj-1", adjustedBy: "bea" }))], 3, () => true, single);
  assert.equal(pick(accepted, "aj-1").adjustment, "accepted");
});

test("dos ajustes sobre la misma versión: al aceptar uno, el otro queda escrito sobre otra versión", () => {
  const base = [wrote("ana", T("10:00"), P("pr-a", "b")), adjusting("bea", T("10:10"), "aj-1", "c")];
  const accept = wrote("ana", T("10:20"), P("pr-a2", "c", { replaces: "pr-a", accepts: "aj-1", adjustedBy: "bea" }));
  assert.equal(pick(proposalsOf([...base, adjusting("carla", T("10:15"), "aj-2", "d"), accept], 3, () => true, single), "aj-2").adjustment, "stale");
  assert.equal(pick(proposalsOf([...base, adjusting("carla", T("10:15"), "aj-2", "c"), accept], 3, () => true, single), "aj-2").adjustment, "accepted", "si ya dice lo mismo, no hay nada que escribir de nuevo");
});

test("la autora retira su propuesta: el primer ajuste pendiente pasa a ser la propuesta", () => {
  const views = proposalsOf([wrote("ana", T("10:00"), P("pr-a", "b")), adjusting("bea", T("10:10"), "aj-1", "c"), adjusting("carla", T("10:20"), "aj-2", "d"), proposalSaying("pr-a", "ana", T("10:30"), false)], 3, () => true, single);
  assert.equal(pick(views, "aj-1").adjusts, undefined);
  assert.equal(pick(views, "aj-1").adjustment, undefined);
  assert.equal(pick(views, "aj-2").adjusts, "aj-1");
});

test("cuando la nota se acuerda, los ajustes que esperaban dejan de esperar", () => {
  const views = proposalsOf([wrote("ana", T("10:00"), P("pr-a", "b")), adjusting("bea", T("10:10"), "aj-1", "c"), proposalSaying("pr-a", "bea", T("10:20"), true), proposalSaying("pr-a", "carla", T("10:30"), true)], 3, () => true, single);
  assert.equal(pick(views, "pr-a").state, "agreed");
  assert.equal(pick(views, "aj-1").state, "rejected");
});

test("un ajuste no es otra opción de la pregunta de la nota, ni la deja abierta cuando la nota se acuerda", () => {
  const items = [{ id: "n1", verseKey: "1:1" }];
  const questions = [{ id: "sentido", text: "¿Tiene sentido?" }];
  const slot = (answers: CheckAnswer[]) => summarizeChecklist({ items, questions, answers, agreement: { people: 3, proposals: proposalsOf(answers, 3, () => true, single) } }).items[0]!.slots!.sentido!;
  const waiting = [wrote("ana", T("10:00"), P("pr-a", "b")), adjusting("bea", T("10:10"), "aj-1", "c")];
  assert.deepEqual(slot(waiting).open.map((view) => view.proposal.id), ["pr-a"]);
  const agreed = slot([...waiting, proposalSaying("pr-a", "bea", T("10:20"), true), proposalSaying("pr-a", "carla", T("10:30"), true)]);
  assert.equal(agreed.settled, true);
  assert.equal(agreed.open.length, 0);
});

// ---------------------------------------------------------------- a proposal checked with the step's questions (27 October)

const checked = { ...single, questionsOf: () => ["tpl", "tps", "acad"] };
const proposed = (after = "b") => wrote("ana", T("10:00"), P("pr-a", after), "tpl");
const marksBy = (who: string, version: string, minute: number, questionIds = ["tpl", "tps", "acad"]) => questionIds.map((qid, i) => proposalMark(version, qid, who, T(`11:${String(minute + i).padStart(2, "0")}`), "yes"));
const head = (rows: CheckAnswer[], id = "pr-a", rule: Parameters<typeof proposalsOf>[3] = checked) => pick(proposalsOf(rows, 3, () => true, rule), id);

test("con «Sí» en todas las preguntas de la propuesta, la persona la elige; con una sin marcar, no", () => {
  assert.equal(head([proposed(), ...marksBy("bea", "pr-a", 0, ["tpl", "tps"])]).choices?.bea, undefined);
  assert.equal(head([proposed(), ...marksBy("bea", "pr-a", 0)]).choices?.bea, "pr-a");
});

test("quien propone: la pregunta donde nació cuenta como «Sí» suyo y las demás las tiene que marcar", () => {
  assert.equal(head([proposed()]).choices?.ana, undefined);
  assert.deepEqual(head([proposed()]).origin, ["tpl"]);
  assert.equal(head([proposed(), ...marksBy("ana", "pr-a", 0, ["tps", "acad"])]).choices?.ana, "pr-a");
});

test("un «No» sin resolver impide que la propuesta se acuerde aunque tres la elijan", () => {
  const all = [proposed(), ...marksBy("ana", "pr-a", 0, ["tps", "acad"]), ...marksBy("bea", "pr-a", 10), ...marksBy("carla", "pr-a", 20)];
  assert.equal(head(all).state, "agreed");
  const no = [...all, proposalMark("pr-a", "tps", "bea", T("11:30"), "no", "la nota ya no explica la figura")];
  assert.equal(head(no).state, "open");
  assert.deepEqual(head(no).noBy, ["bea"]);
  assert.ok(head(no).disputedSince, "un «No» es un desacuerdo: corre el plazo para quien coordina");
  assert.equal(head(no).marks?.bea?.tps, "no");
  assert.equal(head([...no, proposalMark("pr-a", "tps", "bea", T("11:40"), "yes")]).state, "agreed");
});

test("al cambiar el texto, las marcas de los demás quedan viejas; las de la autora en su propia edición, no", () => {
  const rows = [proposed(), ...marksBy("ana", "pr-a", 0, ["tps", "acad"]), ...marksBy("bea", "pr-a", 10), wrote("ana", T("12:00"), P("pr-a2", "c", { replaces: "pr-a" }), "tpl")];
  const now = head(rows, "pr-a2");
  assert.ok(now.staleFor?.includes("bea"));
  assert.equal(now.marks?.bea, undefined);
  assert.equal(now.choices?.ana, "pr-a");
  assert.ok(!now.staleFor?.includes("ana"));
});

test("al aceptar un ajuste, se piden de nuevo las marcas de todos, salvo la pregunta donde nació", () => {
  const rows = [proposed(), ...marksBy("ana", "pr-a", 0, ["tps", "acad"]), adjusting("bea", T("11:10"), "aj-1", "c"), wrote("ana", T("12:00"), P("pr-a2", "c", { replaces: "pr-a", accepts: "aj-1", adjustedBy: "bea" }), "tpl")];
  const now = head(rows, "pr-a2");
  assert.equal(now.marks?.ana, undefined);
  assert.equal(now.choices?.ana, undefined);
  assert.equal(head([...rows, ...marksBy("ana", "pr-a2", 30, ["tps", "acad"])], "pr-a2").choices?.ana, "pr-a");
});

test("un «de acuerdo» antiguo cuenta como «Sí» en todas las preguntas", () => {
  assert.equal(head([proposed(), proposalSaying("pr-a", "bea", T("10:30"), true)]).choices?.bea, "pr-a");
});

test("una pregunta que no aplica al texto de la propuesta no se pide", () => {
  const rule = { ...single, questionsOf: (view: { proposal: ProposalPayload }) => (view.proposal.after?.includes("[[") ? ["tpl", "acad"] : ["tpl"]) };
  assert.equal(head([proposed(), ...marksBy("bea", "pr-a", 0, ["tpl"])], "pr-a", rule).choices?.bea, "pr-a");
  assert.equal(head([proposed("ver [[rc://x]]"), ...marksBy("bea", "pr-a", 0, ["tpl"])], "pr-a", rule).choices?.bea, undefined);
});

console.log(`\nverify-check-proposal: ${passed} checks passed.`);
