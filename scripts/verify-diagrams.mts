/** The diagrams a team makes its own: how boxes are moved, and how what the team leaves takes the place of the app's. */
import assert from "node:assert/strict";
import { diagramSentences, diagramsPath, dissolveBox, emptyDiagramDoc, flatSentence, nodeAt, normalizeDiagramDoc, sentenceKey, sentencesShown, setBoxKind, withDiagram, wrapKids } from "../src/domain/diagrams";
import { setActiveScope } from "../src/domain/scope";
import { encodeTree, isLeaf, normalizeTreeFile, sentenceShape, type TreeNode } from "../src/domain/syntaxTree";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const line = (node: TreeNode): string => `${node.role}${node.clause ? "*" : ""}[${node.kids.map((kid) => (isLeaf(kid) ? String(kid.word) : line(kid))).join(" ")}]`;
const who = { by: "ana", at: "2026-10-09T12:00:00.000Z" };

test("un versículo sin diagrama empieza como sus palabras sueltas, y se arma metiéndolas en cajas", () => {
  let root = flatSentence([{ chapter: 2, verse: 5, words: 5 }]);
  assert.equal(line(root), "*[1 2 3 4 5]");
  root = wrapKids(root, [], 0, 0, { role: "v", clause: false });
  root = wrapKids(root, [], 2, 1, { role: "s", clause: false });
  assert.equal(line(root), "*[v[1] s[2 3] 4 5]", "de la segunda a la tercera, se elijan en el orden que se elijan");
  root = wrapKids(root, [], 2, 3, { role: "adv", clause: false });
  assert.equal(line(root), "*[v[1] s[2 3] adv[4 5]]");
  assert.deepEqual(sentenceShape(root), { clauses: 1, subordinate: 0, joined: 0 });
});

test("una caja se mete en otra, se le dice qué es, y se quita dejando lo que tenía", () => {
  let root: TreeNode = normalizeTreeFile({ sentences: [["*", ["v", 1001001], ["o", 1001002, 1001003, 1001004]]] })!.sentences[0]!.root;
  // «dijo [que vendría pronto]»: dentro del objeto, el verbo y su circunstancia; y el objeto es una oración.
  root = wrapKids(root, [1], 1, 1, { role: "v", clause: false });
  root = wrapKids(root, [1], 2, 2, { role: "adv", clause: false });
  root = setBoxKind(root, [1], { role: "o", clause: true });
  assert.equal(line(root), "*[v[1] o*[2 v[3] adv[4]]]");
  assert.deepEqual(sentenceShape(root), { clauses: 2, subordinate: 1, joined: 0 }, "ahora es una oración compleja");
  assert.equal((nodeAt(root, [1, 1]) as TreeNode).role, "v");
  root = setBoxKind(root, [1, 2], { role: "pp", clause: false });
  root = dissolveBox(root, [1, 1]);
  assert.equal(line(root), "*[v[1] o*[2 3 pp[4]]]");
  assert.equal(line(dissolveBox(root, [])), line(root), "la oración entera no se quita");
  assert.equal(setBoxKind(root, [], { role: "s", clause: false }).clause, true, "ni deja de ser una oración");
  assert.equal(line(wrapKids(root, [0, 0], 0, 0, { role: "s", clause: false })), line(root), "una palabra no es una caja donde meter otras");
});

test("lo que el equipo deja se guarda por la primera palabra de la oración, con quién lo dejó, y se puede quitar", () => {
  const root = wrapKids(flatSentence([{ chapter: 2, verse: 5, words: 3 }]), [], 0, 0, { role: "v", clause: false });
  assert.equal(sentenceKey(root), "2005001");
  let doc = withDiagram(emptyDiagramDoc("jon", 2), sentenceKey(root), root, who);
  assert.deepEqual(doc.sentences["2005001"], encodeTree(root));
  // Lo que se escribe en Door43 se vuelve a leer igual.
  doc = normalizeDiagramDoc(JSON.parse(JSON.stringify(doc)), "JON", 2);
  const [kept] = diagramSentences(doc);
  assert.equal(line(kept!.root), "*[v[1] 2 3]");
  assert.deepEqual(kept!.by, who);
  // Corregirlo otra vez lo reemplaza; quitarlo deja el archivo sin él.
  doc = withDiagram(doc, "2005001", wrapKids(root, [], 1, 2, { role: "s", clause: false }), { by: "bea", at: "" });
  assert.equal(Object.keys(doc.sentences).length, 1);
  assert.equal(diagramSentences(doc)[0]!.by!.by, "bea");
  assert.deepEqual(withDiagram(doc, "2005001", null, who).sentences, {});
});

test("un archivo con algo que no es un diagrama no rompe nada: se toma lo que se puede leer", () => {
  const doc = normalizeDiagramDoc({ sentences: { "2005001": ["*", 2005001, 2005002], x: ["*", 1], "2006001": "nada", "2007001": [] }, by: { "2005001": { by: "ana" }, "2006001": { by: "ana" } } }, "JON", 2);
  assert.deepEqual(Object.keys(doc.sentences), ["2005001"]);
  assert.deepEqual(doc.by, { "2005001": { by: "ana", at: "" } });
  assert.deepEqual(normalizeDiagramDoc("<!doctype html>", "JON", 2).sentences, {});
});

test("en un versículo se muestra el diagrama del equipo en lugar del de la app que comparte sus palabras", () => {
  const shipped = normalizeTreeFile({ sentences: [["*", ["v", 2005001], 2005002], ["*", ["v", 2005003]], ["*", ["v", 2006001]]] })!.sentences;
  const team = diagramSentences(withDiagram(emptyDiagramDoc("JON", 2), "2005001", normalizeTreeFile({ sentences: [["*", ["s", 2005001], ["v", 2005002]]] })!.sentences[0]!.root, who));
  const at5 = shipped.filter((sentence) => sentence.verses.some((verse) => verse.verse === 5));
  assert.deepEqual(sentencesShown(at5, team, { chapter: 2, verse: 5 }).map((sentence) => line(sentence.root)), ["*[s[1] v[2]]", "*[v[3]]"], "la otra oración del versículo, que el equipo no tocó, sigue siendo la de la app");
  assert.deepEqual(sentencesShown([shipped[2]!], team, { chapter: 2, verse: 6 }).map((sentence) => line(sentence.root)), ["*[v[1]]"], "el diagrama de otro versículo no aparece aquí");
});

test("el archivo de un capítulo está en la carpeta del espacio del equipo", () => {
  setActiveScope(undefined);
  assert.equal(diagramsPath("jon", 2), "diagramas/JON/2.json");
  setActiveScope("espacio-b");
  assert.equal(diagramsPath("JON", 2), "espacio-b/diagramas/JON/2.json", "otro espacio de la misma organización tiene los suyos");
  setActiveScope(undefined);
});

console.log(`\nverify-diagrams: ${passed} checks passed.`);
