/**
 * What a reviewer is shown: the passage piece by piece, with what changed, never a file diff.
 *
 *   npm run verify:review-items
 */
import assert from "node:assert/strict";
import { articleItems, diffWords, parseRefComment, refComment, reviewItems } from "../src/domain/reviewItems";

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

console.log(`\nverify-review-items: ${passed} checks passed.`);
