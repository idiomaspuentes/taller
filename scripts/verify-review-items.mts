/**
 * What a reviewer is shown: the passage piece by piece, with what changed, never a file diff.
 *
 *   npm run verify:review-items
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { articleItems, diffWords, introItems, parseRefComment, refComment, reviewItems } from "../src/domain/reviewItems";
import { introPieceRef, pieceRef } from "../src/domain/articleBlocks";
import { commentPlace, placedMessage, plainLine } from "../src/domain/commentPlace";
import { commentNotice, placedLine } from "../src/domain/noticeText";
import { canResolveComment, glossaryComment, openComments, resolutionComment, reviewCommentsFrom, isBareRequest, type ReviewComment } from "../src/domain/reviewComments";
import { localizeThread } from "../src/domain/threadNames";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const range = { chapter: 1, from: 1, to: 3 };
const aligned = String.raw`\id 3JN
\c 1
\p
\v 1 \zaln-s |x-strong="G35880" x-content="ὁ"\*\w El|x-occurrence="1" x-occurrences="1"\w*\zaln-e\* \zaln-s |x-strong="G42450"\*\w anciano|x-occurrence="1" x-occurrences="1"\w*\zaln-e\* \w a|x-occurrence="1"\w* \w Gayo|x-occurrence="1"\w*
\v 2 Amado, oro por ti.
\v 3
\v 4 Fuera del pasaje.
`;
const draft = String.raw`\id 3JN
\c 1
\p
\v 1 El anciano al amado Gayo
\v 2 Amado, oro por ti.
\v 3 Me alegré mucho.
\v 4 Otro texto.
`;

test("se revisa el pasaje versículo por versículo, en texto limpio: sin marcas de alineación ni el resto del libro", () => {
  const items = reviewItems({ filename: "65-3JN.usfm", now: draft, before: aligned, range });
  assert.deepEqual(items.map((item) => [item.ref, item.state]), [["1:1", "changed"], ["1:2", "same"], ["1:3", "new"]]);
  assert.equal(items[0]!.before, "El anciano a Gayo");
  assert.ok(!items.some((item) => /zaln|x-strong|\\w/.test(item.now + item.before)));
});

test("un versículo sin escribir se dice vacío, y uno que ya no está, quitado", () => {
  const items = reviewItems({ filename: "65-3JN.usfm", now: "\\c 1\n\\v 1\n\\v 2\n", before: "\\c 1\n\\v 1 Antes\n\\v 2\n", range });
  assert.deepEqual(items.map((item) => item.state), ["removed", "empty"]);
});

test("lo que cambió se marca por palabras", () => {
  const parts = diffWords("El anciano a Gayo", "El anciano al amado Gayo");
  assert.deepEqual(parts.filter((part) => part.kind !== "same").map((part) => [part.kind, part.text.trim()]), [["removed", "a"], ["added", "al amado"]]);
  assert.equal(parts.filter((part) => part.kind !== "removed").map((part) => part.text).join(""), "El anciano al amado Gayo");
  assert.deepEqual(diffWords("", "Nuevo"), [{ text: "Nuevo", kind: "added" }]);
});

test("en una ayuda se revisan las filas del pasaje: las nuevas, las cambiadas y las quitadas", () => {
  const head = "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote";
  const before = [head, "front:intro\tabcd\t\t\t\t0\tIntro", "1:1\ta001\t\t\tὁ πρεσβύτερος\t1\tNota vieja", "1:2\ta002\t\t\tx\t1\tSe quita", "1:9\ta009\t\t\tx\t1\tFuera"].join("\n");
  const now = [head, "front:intro\tabcd\t\t\t\t0\tIntro", "1:1\ta001\t\t\tὁ πρεσβύτερος\t1\tNota nueva", "1:3\ta003\t\t\ty\t1\tRecién escrita", "1:9\ta009\t\t\tx\t1\tFuera cambiada"].join("\n");
  const items = reviewItems({ filename: "tn_3JN.tsv", now, before, range });
  assert.deepEqual(items.map((item) => [item.key, item.ref, item.state]), [["a001", "1:1", "changed"], ["a002", "1:2", "removed"], ["a003", "1:3", "new"]]);
  assert.deepEqual(reviewItems({ filename: "manifest.yaml", now: "a", before: "b", range }), []);
  // What the row says is told apart from the columns that place it: nobody reviews an address, a line of Greek and a number.
  assert.deepEqual(items[0]!.help, { text: "Nota nueva", before: "Nota vieja", quote: "ὁ πρεσβύτερος", occurrence: 1 });
  assert.deepEqual(items[1]!.help, { text: "", before: "Se quita", quote: "x", occurrence: 1 }, "de la que se quitó queda lo que decía");
  assert.deepEqual(items[2]!.help, { text: "Recién escrita", before: "", quote: "y", occurrence: 1 });
});

test("de una pregunta se revisa la pregunta y su respuesta", () => {
  const head = "Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse";
  const before = [head, "1:1\tq001\t\t\t\tWho wrote this letter?\tThe elder wrote it."].join("\n");
  const now = [head, "1:1\tq001\t\t\t\t¿Quién escribió esta carta?\tLa escribió el anciano."].join("\n");
  const [item] = reviewItems({ filename: "tq_3JN.tsv", now, before, range });
  assert.deepEqual(item!.help, { text: "¿Quién escribió esta carta?", before: "Who wrote this letter?", secondary: "La escribió el anciano.", beforeSecondary: "The elder wrote it." });
  assert.equal(item!.state, "changed");
});

test("un comentario sobre un versículo dice cuál, y se vuelve a encontrar junto a él", () => {
  const body = refComment("3jn", "1:2", " ¿«amado» o «querido»? ");
  assert.equal(body, "**3JN 1:2** — ¿«amado» o «querido»?");
  assert.deepEqual(parseRefComment(body), { ref: "1:2", text: "¿«amado» o «querido»?" });
  assert.deepEqual(parseRefComment("Buen trabajo"), { ref: "", text: "Buen trabajo" });
});

test("un borrador de artículos se revisa artículo por artículo, nombrado por su título", () => {
  const items = articleItems([
    { filename: "translate/figs-metaphor/01.md", now: "### Descripción\n\nUna metáfora es…", before: "### Description\n\nA metaphor is…" },
    { filename: "translate/figs-metaphor/title.md", now: "Metáfora", before: "" },
    { filename: "bible/kt/love.md", now: "# amor, amar\n\nIgual.", before: "# amor, amar\n\nIgual." },
    { filename: "tn_3JN.tsv", now: "x", before: "" },
  ]);
  assert.deepEqual(items.map((item) => [item.ref, item.state]), [["Descripción", "changed"], ["figs-metaphor (title)", "new"], ["amor, amar", "same"]]);
  assert.deepEqual(parseRefComment(refComment("3jn", "amor, amar", "Falta el segundo sentido.")), { ref: "amor, amar", text: "Falta el segundo sentido." });
});

test("la introducción que un borrador de notas tradujo se revisa con él, como el texto largo que es", () => {
  const head = "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote";
  const file = (book: string, one: string, two: string) => [head, `front:intro\tbk01\t\t\t\t0\t${book}`, `1:intro\tch01\t\t\t\t0\t${one}`, `2:intro\tch02\t\t\t\t0\t${two}`, "1:1\ta001\t\t\tx\t1\tNota"].join("\n");
  const before = file("# Introduction\\n\\nJude wrote this letter.", "# Jude 1 General Notes", "# Chapter 2");
  const now = file("# Introducción\\n\\nJudas escribió esta carta.", "# Jude 1 General Notes", "# Capítulo 2");
  // The book's was translated; chapter 1's was not, and nobody says it is of this passage; chapter 2's is of another chapter.
  assert.deepEqual(introItems(now, before, 1), [{ key: "bk01", chapter: undefined, now: "# Introducción\n\nJudas escribió esta carta.", before: "# Introduction\n\nJude wrote this letter." }]);
  // The plan gave chapter 1's to this passage: it is seen although the draft left it as it was.
  assert.deepEqual(introItems(now, before, 1, (id) => id === "ch01").map((row) => [row.key, row.chapter, row.now === row.before]), [["bk01", undefined, false], ["ch01", 1, true]]);
  assert.deepEqual(introItems(before, before, 1), [], "un borrador que no tocó ninguna no trae ninguna");
  assert.deepEqual(introItems("Reference\tID\tQuestion\tResponse\n1:1\tq1\t¿Quién?\tJudas", "", 1), [], "las preguntas no tienen introducciones");
});

test("un comentario sobre un párrafo de una introducción dice de cuál, y se vuelve a encontrar", () => {
  assert.equal(introPieceRef(undefined, 2), "intro ¶3");
  assert.equal(introPieceRef(1, 0), "1:intro ¶1");
  for (const ref of [introPieceRef(undefined, 2), introPieceRef(1, 0)]) {
    assert.deepEqual(parseRefComment(refComment("jud", ref, "Falta una frase.")), { ref, text: "Falta una frase." }, ref);
  }
});

test("de un comentario se saca el lugar del que habla, para decirlo con palabras y no con su dirección", () => {
  assert.deepEqual(commentPlace("1:3"), { kind: "verse", ref: "1:3" });
  assert.deepEqual(commentPlace("1:3-4"), { kind: "verse", ref: "1:3–4" });
  assert.deepEqual(commentPlace(pieceRef("translate/figs-pastforfuture/01.md", 1)), { kind: "paragraph", article: "figs-pastforfuture", index: 1 });
  assert.deepEqual(commentPlace(pieceRef("translate/figs-pastforfuture/title.md", 0)), { kind: "title", article: "figs-pastforfuture" });
  assert.deepEqual(commentPlace(pieceRef("translate/figs-pastforfuture/sub-title.md", 0)), { kind: "subtitle", article: "figs-pastforfuture" });
  assert.deepEqual(commentPlace(introPieceRef(undefined, 2)), { kind: "intro", index: 2 });
  assert.deepEqual(commentPlace(introPieceRef(1, 0)), { kind: "intro", chapter: 1, index: 0 });
  assert.equal(commentPlace("amor, amar"), null, "un comentario antiguo, nombrado por un título, no dice un lugar");

  const written = refComment("jud", pieceRef("translate/figs-pastforfuture/01.md", 1), "figura retorica o literaria?");
  assert.deepEqual(placedMessage(written), { ref: "figs-pastforfuture ¶2", place: { kind: "paragraph", article: "figs-pastforfuture", index: 1 }, text: "figura retorica o literaria?" });
  // The line under a task shows the message without its marks: the place is still told.
  assert.deepEqual(placedMessage("JUD figs-pastforfuture ¶2 — figura retorica o literaria?")?.place, { kind: "paragraph", article: "figs-pastforfuture", index: 1 });
  assert.equal(placedMessage("Buen trabajo"), null);
  assert.equal(placedMessage("JUD es corto — y directo"), null, "la frase de alguien no es un lugar");
  assert.equal(placedMessage("@valeska Pido cambios: revisa la introducción"), null);
});

test("un párrafo se cita en una línea de palabras, sin las marcas de su formato", () => {
  assert.equal(plainLine("### Descripción"), "Descripción");
  assert.equal(plainLine("> **Booz** dijo: «El Señor sea con ustedes». (Rut 2:4)"), "Booz dijo: «El Señor sea con ustedes». (Rut 2:4)");
  assert.equal(plainLine("*   Ver [[rc://*/ta/man/translate/figs-idiom]] y [la nota](../01/03.md)."), "Ver figs-idiom y la nota.");
  assert.equal(plainLine("1. Uno\n2. Dos"), "Uno Dos");
});

test("donde se muestra un comentario fuera de su herramienta, el lugar se dice con palabras", () => {
  const body = refComment("jud", pieceRef("translate/figs-pastforfuture/01.md", 1), "figura retorica o literaria?");
  assert.equal(placedLine(body, "es"), "Párrafo 2 — figura retorica o literaria?");
  assert.equal(placedLine(body, "pt"), "Parágrafo 2 — figura retorica o literaria?");
  assert.equal(placedLine(refComment("jud", pieceRef("translate/figs-pastforfuture/title.md", 0), "Falta."), "es"), "Título — Falta.");
  assert.equal(placedLine(refComment("jud", introPieceRef(undefined, 8), "Falta."), "es"), "Introducción al libro · párrafo 9 — Falta.");
  assert.equal(placedLine(refComment("jud", introPieceRef(1, 0), "Falta."), "es"), "Introducción al capítulo 1 · párrafo 1 — Falta.");
  assert.equal(placedLine(refComment("jud", "1:3", "¿«amados»?"), "es"), "1:3 — ¿«amados»?");
  assert.equal(placedLine("Buen trabajo", "es"), "Buen trabajo");
  // The notice on a phone's lock screen: who said it and about what, without the address or its marks.
  const notice = commentNotice({ issue: { number: 263, title: "JUD Predictive Past · Academia" }, body, author: "abelper8", mentioned: false }, "es");
  assert.equal(notice.body, "abelper8: Párrafo 2 — figura retorica o literaria?");
});

test("un comentario queda abierto hasta que quien lo dejó lo da por resuelto, y mientras tanto sostiene la revisión", () => {
  const said = (id: number, login: string, body: string) => ({ id, body, created_at: `2026-10-05T00:0${id}:00Z`, user: { login } });
  const first = said(1, "bob", refComment("jud", "figs-pastforfuture ¶2", "figura retorica o literaria?"));
  const answer = said(2, "alice", refComment("jud", "figs-pastforfuture ¶2", "Lo cambié a «literaria»."));
  const general = said(3, "bob", "@alice Pido cambios: revisa también el título.");
  const rows = [first, answer, general];
  const open = (list: typeof rows) => openComments(reviewCommentsFrom(list, "alice"), "alice").map((row) => row.id);
  assert.deepEqual(open(rows), [1, 3], "lo que dijo quien revisa está abierto; lo que responde la autora no sostiene nada");

  const [comment] = reviewCommentsFrom(rows, "alice");
  assert.equal(canResolveComment(comment!, "bob", { draftAuthor: "alice" }), true, "lo resuelve quien lo dejó");
  assert.equal(canResolveComment(comment!, "alice", { draftAuthor: "alice" }), false, "nunca la autora del borrador");
  assert.equal(canResolveComment(comment!, "carol", { draftAuthor: "alice" }), false, "ni otra persona cualquiera");
  assert.equal(canResolveComment(comment!, "carol", { draftAuthor: "alice", canManage: true }), true, "sí quien coordina, por si quien lo dejó ya no está");

  const resolved = [...rows, said(4, "bob", resolutionComment(comment!, 263))];
  assert.deepEqual(open(resolved), [3]);
  assert.deepEqual(reviewCommentsFrom(resolved, "alice")[0]!.resolved, { by: "bob", at: "2026-10-05T00:04:00Z" });
  assert.equal(reviewCommentsFrom(resolved, "alice").length, 3, "dar por resuelto no es un comentario más de la lista");
  // Opened again by the same hand: the last word says how it stands.
  assert.deepEqual(open([...resolved, said(5, "bob", resolutionComment(comment!, 263, true))]), [1, 3]);
  // The author of the draft does not close what was said about it, whatever they write on the review.
  assert.deepEqual(open([...rows, said(4, "alice", resolutionComment(comment!, 263))]), [1, 3]);
  assert.equal(localizeThread("Comentario resuelto: figura retorica o literaria?", "pt"), "Comentário resolvido: figura retorica o literaria?");
});

test("un comentario del que salió una entrada del glosario lo dice a todos, lo guarde quien lo guarde", () => {
  const said = (id: number, login: string, body: string) => ({ id, body, user: { login }, created_at: `2026-10-06T00:0${id}:00Z` });
  const rows = [said(1, "bob", refComment("JUD", "1:1", "En el TPS decimos «Mesías», no «Cristo».")), said(2, "bob", refComment("JUD", "1:2", "Falta una coma."))];
  const [first] = reviewCommentsFrom(rows, "alice");
  const event = glossaryComment(first!, 13, "«Messiah» → «Mesías»", "me01");
  const after = reviewCommentsFrom([...rows, said(3, "bob", event)], "alice");
  assert.deepEqual(after.map((row) => row.glossary), ["me01", undefined]);
  assert.equal(after.length, 2, "decirlo no es un comentario más de la lista");
  assert.deepEqual(openComments(after, "alice").map((row) => row.id), [1, 2], "guardar la decisión no da el comentario por resuelto");
  // The author of the draft may be who keeps it: it counts the same.
  assert.equal(reviewCommentsFrom([...rows, said(3, "alice", event)], "alice")[0]!.glossary, "me01");
  assert.equal(localizeThread("En el glosario: «Messiah» → «Mesías»", "pt"), "No glossário: «Messiah» → «Mesías»");
});

test("el mensaje que la revisión escribe sola al pedir cambios no es un comentario por resolver", () => {
  // The sentences are the app's own, in both languages: if one is reworded, this says so.
  const es = JSON.parse(readFileSync(new URL("../src/i18n/locales/es.json", import.meta.url), "utf8")) as Record<string, string>;
  const pt = JSON.parse(readFileSync(new URL("../src/i18n/locales/pt.json", import.meta.url), "utf8")) as Record<string, string>;
  const said = (lang: Record<string, string>, n: number) => `@alice ${lang["rv.changesAsked"]} ${lang[n === 1 ? "rv.changesAutoOne" : "rv.changesAutoMany"]!.replace("{n}", String(n))}`;
  const row = (id: number, text: string, ref = ""): ReviewComment => ({ id, by: "bob", ref, text, at: "2026-10-06T10:00:00Z" });
  const all = [row(1, "Falta una frase.", "1:3"), row(2, said(es, 1)), row(3, said(es, 4)), row(4, said(pt, 1)), row(5, said(pt, 3)), row(6, `@alice ${es["rv.changesAsked"]} revisa la puntuación de todo el pasaje.`)];
  assert.deepEqual(openComments(all, "alice").map((c) => c.id), [1, 6], "lo que alguien escribió al pedir cambios sí se atiende");
  assert.equal(isBareRequest(row(7, said(es, 2), "1:3")), false, "puesto en un versículo, es un comentario de ese versículo");
});

console.log(`\nverify-review-items: ${passed} checks passed.`);
