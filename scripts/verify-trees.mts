/** How a sentence is put together: how MACULA's trees are reduced, written, read back and matched to our text. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS } from "../src/domain/books";
import { hebrewToOurs } from "../src/domain/parallels";
import { layoutSideways, layoutTree } from "../src/domain/treeLayout";
import { alignedWordsOfVerse, verseIsAligned } from "../src/domain/alignedWords";
import { clauseKind, encodeTree, fitWords, isLeaf, leavesOf, normalizeTreeFile, parseLowfat, reduceSentence, sentenceFits, sentencesAt, sentenceShape, wordsLeftOut, type TreeNode } from "../src/domain/syntaxTree";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** A tree as one line, to compare: «*[v(1:1.1) s(1:1.2 1:1.3)]». */
const line = (node: TreeNode): string => `${node.role}${node.clause ? "*" : ""}[${node.kids.map((kid) => (isLeaf(kid) ? `${kid.chapter}:${kid.verse}.${kid.word}${kid.piece ? `«${kid.piece}»` : ""}` : line(kid))).join(" ")}]`;

// Jonah 1:1 as MACULA has it, cut short: «and» joined to the verb, a subject of two nouns, «to say» as a
// preposition joined to a clause of one verb.
const HEBREW = `<chapter><sentence id="JON 1:1"><p>…</p>
<wg>
  <w class="cj" ref="JON 1:1!1">וַֽ</w>
  <wg class="cl" rule="V-S-PP">
    <w role="v" class="verb" ref="JON 1:1!1">יְהִי֙</w>
    <wg role="s" class="np" rule="NPofNP"><w class="noun" ref="JON 1:1!2">דְּבַר</w><w class="noun" ref="JON 1:1!3">יְהוָ֔ה</w></wg>
    <wg role="pp" class="pp"><w class="prep" ref="JON 1:1!8">לֵ</w><wg class="cl"><w role="v" class="verb" ref="JON 1:1!8">אמֹֽר</w></wg></wg>
  </wg>
</wg></sentence>
<sentence id="JON 2:6"><wg class="cl">
  <w role="v" class="verb" ref="JON 2:6!1">אֲפָפ֤וּ</w>
  <w role="o" class="pron" ref="JON 2:6!1">נִי</w>
  <wg role="s" class="np"><w class="noun" ref="JON 2:6!2">מַ֨יִם֙</w></wg>
  <wg role="err__note of the tool" class="pp"><w class="prep" ref="JON 2:6!3">עַד</w></wg>
</wg></sentence></chapter>`;

const GREEK = `<book><sentence><wg class="cl">
  <wg role="s" class="np"><w class="noun" ref="TIT 1:1!1">Παῦλος</w>
    <wg type="group"><w class="conj" ref="TIT 1:1!3">δὲ</w><w class="noun" ref="TIT 1:1!2">ἀπόστολος</w></wg></wg>
  <wg role="adv" class="pp"><w class="prep" ref="TIT 1:2!1">ἐπ’</w><w class="noun" ref="TIT 1:2!2">ἐλπίδι</w></wg>
</wg></sentence></book>`;

test("de un árbol de MACULA queda lo que tiene función, y los grupos de en medio dan sus palabras", () => {
  const [first] = parseLowfat(HEBREW);
  assert.equal(line(reduceSentence(first!)!), "*[&[1:1.1«וַ»] *[v[1:1.1«יְהִי»] s[1:1.2 1:1.3] pp[v*[1:1.8]]]]", "el «y» pegado al verbo se muestra como lo que une; «para decir» es una parte con preposición, y dentro la oración de un solo verbo");
});

test("las palabras de una parte van en el orden del texto, aunque el árbol las haya movido", () => {
  const tree = reduceSentence(parseLowfat(GREEK)[0]!)!;
  assert.equal(line(tree), "*[s[1:1.1 1:1.2 &[1:1.3]] adv[1:2.1 1:2.2]]", "el «δὲ» que el árbol pone antes de su palabra queda después, como en el texto");
  assert.deepEqual(leavesOf(tree).map((leaf) => leaf.word), [1, 2, 3, 1, 2]);
});

test("dos partes de una misma palabra dicen cada una su pedazo; el hebreo pasa a nuestra numeración", () => {
  const toOurs = hebrewToOurs({ "JON 1:17": "JON 2:1", "JON 2:1-10": "JON 2:2-11" });
  const tree = reduceSentence(parseLowfat(HEBREW)[1]!, toOurs)!;
  assert.equal(line(tree), "*[v[2:5.1«אֲפָפוּ»] o[2:5.1«נִי»] s[2:5.2] 2:5.3]", "«me rodearon»: el verbo y su objeto; lo que no es una función (una nota de la herramienta) no se toma por una");
});

// 1 Reyes 13:3, cut short: «en el día aquel» writes the article the preposition swallowed as a word with nothing
// in it, which nothing closes; what follows it is still of the group it was in, and the object is of the clause.
const SWALLOWED = `<chapter><sentence><wg class="cl">
  <w role="v" class="verb" ref="1KI 13:3!1">נָתַן֩</w>
  <wg role="pp" class="pp"><w class="prep" ref="1KI 13:3!2">בַּ</w>
    <wg class="np"><w class="art" ref="1KI 13:3!2"
        />
      <wg class="np"><w class="noun" ref="1KI 13:3!2">יּ֨וֹם</w><wg class="adjp"><w class="art" ref="1KI 13:3!3">הַ</w><w class="pron" ref="1KI 13:3!3">ה֤וּא</w></wg></wg>
    </wg>
  </wg>
  <w role="o" class="noun" ref="1KI 13:3!4">מוֹפֵת֙</w>
</wg></sentence></chapter>`;

test("el artículo que una preposición se tragó no desordena lo que sigue", () => {
  assert.equal(line(reduceSentence(parseLowfat(SWALLOWED)[0]!)!), "*[v[13:3.1] pp[13:3.2 13:3.3] o[13:3.4]]", "«aquel» sigue en su parte, y el objeto es de la oración y no de «en el día»");
});

test("cada palabra del análisis se halla en nuestro texto por sus letras", () => {
  assert.deepEqual(fitWords(["Παῦλος", "δοῦλος", "Θεοῦ"], ["Παῦλος", "δοῦλος", "Θεοῦ"]), [0, 1, 2]);
  assert.deepEqual(fitWords(["בְּרֵאשִׁ֖ית", "בָּרָ֣א"], ["בְּ⁠רֵאשִׁ֖ית", "בָּרָ֣א"]), [0, 1], "los acentos y la marca que parte la palabra no la hacen otra");
  // Hechos 2:7: nuestro texto tiene una palabra que el otro no.
  assert.deepEqual(fitWords(["ἐξίσταντο", "δὲ", "καὶ", "ἐθαύμαζον"], ["ἐξίσταντο", "δὲ", "ἅπαντες", "καὶ", "ἐθαύμαζον"]), [0, 1, 3, 4], "las que siguen a la que sobra aquí van un lugar más allá");
  // Lucas 24:46: el otro texto tiene palabras que el nuestro no.
  assert.deepEqual(fitWords(["καὶ", "εἶπεν", "αὐτοῖς", "ὅτι", "οὕτως"], ["καὶ", "ὅτι", "οὕτως"]), [0, null, null, 1, 2], "la que no está aquí no tiene lugar");
  // Hechos 2:34: un nombre escrito de otro modo, entre palabras iguales, es la misma palabra.
  assert.deepEqual(fitWords(["οὐ", "γὰρ", "Δαυὶδ", "ἀνέβη"], ["οὐ", "γὰρ", "Δαυεὶδ", "ἀνέβη"]), [0, 1, 2, 3]);
  // Lucas 5:36: «μήγε» allá, «μή γε» aquí; 1 Crónicas 9:4: dos palabras allá, una aquí.
  assert.deepEqual(fitWords(["εἰ", "δὲ", "μήγε", "καὶ"], ["εἰ", "δὲ", "μή", "γε", "καὶ"]), [0, 1, 2, 4], "la palabra de allá es la primera de las dos de aquí");
  assert.deepEqual(fitWords(["בֶן", "בָּנִ֔י", "מִן", "בְּנֵי"], ["בֶן", "בני⁠מן", "בְּנֵי"]), [0, 1, 1, 2], "las dos de allá son la misma de aquí");
  // El título de un salmo es del primer versículo en el hebreo, y de ninguno en nuestro texto.
  assert.deepEqual(fitWords(["מִזְמ֥וֹר", "לְדָוִ֑ד", "יְהוָ֥ה", "רֹ֝עִ֗י"], ["יְהוָ֥ה", "רֹ֝עִ֗⁠י"]), [null, null, 0, 1]);
  assert.deepEqual(fitWords(["א"], []), [null]);
});

test("una palabra que nuestro texto no tiene se deja fuera, con la parte que no tenía más", () => {
  const [first] = parseLowfat(HEBREW);
  // Sin el sujeto («la palabra de Yahweh»), y con «para decir» en el cuarto lugar.
  const tree = reduceSentence(first!, (_book, place) => (place.word === 2 || place.word === 3 ? null : { chapter: 1, verse: 1, word: place.word === 8 ? 4 : place.word }))!;
  assert.equal(line(tree), "*[&[1:1.1«וַ»] *[v[1:1.1«יְהִי»] pp[v*[1:1.4]]]]");
  assert.equal(reduceSentence(first!, () => null), null, "sin ninguna palabra no queda oración");
});

test("las palabras de un versículo que no están en ninguna oración se saben decir", () => {
  // Un versículo de cinco palabras: el análisis no trae la tercera ni la última.
  const file = normalizeTreeFile({ sentences: [["*", ["v", 1001001], ["s", 1001002, 1001004]], ["*", ["v", 1002001]]], words: { "1:1": 5 } })!;
  assert.equal(sentenceFits(file, file.sentences[0]!, () => 5), true, "el versículo cuenta lo que el archivo dice, no su última palabra con oración");
  assert.equal(sentenceFits(file, file.sentences[0]!, () => 4), false);
  assert.deepEqual(wordsLeftOut(file, file.sentences[0]!), [{ chapter: 1, verse: 1, word: 3 }, { chapter: 1, verse: 1, word: 5 }]);
  assert.deepEqual(wordsLeftOut(file, file.sentences[1]!), []);
  // Una cuenta menor que la última palabra no se cree.
  assert.equal(sentenceFits(normalizeTreeFile({ sentences: [["*", ["v", 1001003]]], words: { "1:1": 2 } })!, file.sentences[0]!, () => 3), true);
});

test("lo que se escribe se vuelve a leer igual, y un versículo da su oración", () => {
  const trees = parseLowfat(HEBREW).map((raw) => reduceSentence(raw)!);
  const file = normalizeTreeFile(JSON.parse(JSON.stringify({ sentences: trees.map(encodeTree) })))!;
  assert.deepEqual(file.sentences.map((sentence) => line(sentence.root)), trees.map(line));
  assert.deepEqual(sentencesAt(file, { chapter: 2, verse: 6 }).map((sentence) => sentence.verses), [[{ chapter: 2, verse: 6 }]]);
  assert.deepEqual(sentencesAt(file, { chapter: 3, verse: 1 }), []);
  assert.equal(normalizeTreeFile({ sentences: [] }), null);
  assert.equal(normalizeTreeFile("<!doctype html>"), null);
});

test("una oración se muestra solo si cada versículo suyo tiene aquí las mismas palabras que allá", () => {
  const file = normalizeTreeFile({ sentences: parseLowfat(GREEK).map((raw) => encodeTree(reduceSentence(raw)!)) })!;
  const [sentence] = file.sentences;
  assert.deepEqual(sentence!.verses, [{ chapter: 1, verse: 1 }, { chapter: 1, verse: 2 }], "una oración puede cruzar versículos");
  assert.equal(sentenceFits(file, sentence!, (verse) => (verse.verse === 1 ? 3 : 2)), true);
  assert.equal(sentenceFits(file, sentence!, (verse) => (verse.verse === 1 ? 3 : 3)), false, "con una palabra de más, el tercer lugar ya no es la tercera palabra");
  assert.equal(sentenceFits(file, sentence!, () => undefined), false);
});

test("de una oración se dice si es simple, compuesta o compleja, y de cada oración suya cómo está en ella", () => {
  const leaf = (word: number) => ({ chapter: 1, verse: 1, word });
  const part = (role: string, ...kids: (TreeNode | ReturnType<typeof leaf>)[]): TreeNode => ({ role: role.replace("*", ""), clause: role.endsWith("*"), kids });
  const simple = part("*", part("v", leaf(1)), part("s", leaf(2)));
  assert.deepEqual(sentenceShape(simple), { clauses: 1, subordinate: 0, joined: 0 });
  // «Se levantó y bajó»: dos oraciones lado a lado, y lo que las une.
  const first = part("*", part("v", leaf(1)));
  const second = part("*", part("v", leaf(3)));
  const compound = part("*", first, part("&", leaf(2)), second);
  assert.deepEqual(sentenceShape(compound), { clauses: 2, subordinate: 0, joined: 2 }, "la oración que solo las reúne no es una más");
  assert.equal(clauseKind(first, compound), "joined");
  assert.equal(clauseKind(compound, undefined), "main");
  // «Dijo que vendría al barco que salía»: una oración hace de objeto; otra, dentro de una parte, la describe.
  const describes = part("*", part("v", leaf(6)));
  const object = part("o*", part("v", leaf(3)), part("adv", leaf(4), leaf(5), describes));
  const complex = part("*", part("v", leaf(1)), object);
  assert.deepEqual(sentenceShape(complex), { clauses: 3, subordinate: 2, joined: 0 });
  assert.equal(clauseKind(object, complex), "as");
  assert.equal(clauseKind(describes, object.kids[1] as TreeNode), "describes");
  // Un infinitivo solo («para decir») es un verbo, no una oración más.
  assert.deepEqual(sentenceShape(part("*", part("v", leaf(1)), part("pp", part("v*", leaf(2))))), { clauses: 1, subordinate: 0, joined: 0 });
});

test("dibujada como árbol: las palabras en fila en el orden del texto, cada parte sobre lo suyo, y ningún nombre encima de otro", () => {
  const leaf = (word: number) => ({ chapter: 1, verse: 1, word });
  const part = (role: string, ...kids: (TreeNode | ReturnType<typeof leaf>)[]): TreeNode => ({ role: role.replace("*", ""), clause: role.endsWith("*"), kids });
  // Un verbo de una palabra, un sujeto de dos, y una parte de nombre largo sobre una sola palabra.
  const root = part("*", part("v", leaf(1)), part("s", leaf(2), leaf(3)), part("pp", leaf(4)));
  const sizes = { labelWidth: (node: TreeNode) => (node.role === "pp" ? 120 : 50), leafWidth: () => 60, gap: 6 };
  const tree = layoutTree(root, sizes);
  assert.deepEqual(tree.leaves.map((placed) => placed.leaf.word), [1, 2, 3, 4]);
  assert.deepEqual(tree.leaves.map((placed) => placed.x), [30, 96, 162, 258], "la cuarta palabra queda en medio del sitio que pide el nombre largo de su parte");
  assert.equal(tree.width, 60 + 6 + 126 + 6 + 120);
  assert.equal(tree.depth, 1);
  const at = (role: string) => tree.nodes.find((placed) => placed.node.role === role)!;
  assert.equal(at("s").x, (96 + 162) / 2, "el sujeto, sobre el medio de sus dos palabras");
  assert.equal(at("").x, (at("v").x + at("pp").x) / 2, "la oración, sobre el medio de sus partes");
  const row = tree.nodes.filter((placed) => placed.depth === 1).sort((a, b) => a.x - b.x);
  for (let i = 1; i < row.length; i++) assert.equal(row[i - 1]!.x + row[i - 1]!.width / 2 <= row[i]!.x - row[i]!.width / 2, true, "dos nombres vecinos no se pisan");
  assert.equal(tree.branches.length, 3 + 4, "una rama a cada parte y una a cada palabra");
  // El hebreo se lee desde la derecha: la primera palabra queda a la derecha.
  const rtl = layoutTree(root, { ...sizes, rtl: true });
  assert.deepEqual(rtl.leaves.map((placed) => placed.x), [tree.width - 30, tree.width - 96, tree.width - 162, tree.width - 258]);
  // Las oraciones unidas se cuentan, para llamarlas «Oración 1», «Oración 2».
  const joined = layoutTree(part("*", part("*", part("v", leaf(1))), part("&", leaf(2)), part("*", part("v", leaf(3)))), sizes);
  assert.deepEqual(joined.nodes.filter((placed) => placed.depth === 1 && placed.node.clause).map((placed) => placed.nth), [1, 2]);
});

test("girado, para un teléfono: cada parte un paso más adentro, las palabras una bajo otra en el orden del texto, y crece hacia abajo", () => {
  const leaf = (word: number) => ({ chapter: 1, verse: 1, word });
  const part = (role: string, ...kids: (TreeNode | ReturnType<typeof leaf>)[]): TreeNode => ({ role: role.replace("*", ""), clause: role.endsWith("*"), kids });
  const root = part("*", part("v", leaf(1)), part("s", leaf(2), leaf(3)), part("pp", part("v*", leaf(4))));
  const tree = layoutSideways(root, { node: 30, leaf: 50 });
  assert.deepEqual(tree.leaves.map((placed) => placed.leaf.word), [1, 2, 3, 4]);
  assert.deepEqual(tree.nodes.map((placed) => [placed.node.role, placed.depth, placed.y]), [["", 0, 15], ["v", 1, 45], ["s", 1, 125], ["pp", 1, 255], ["v", 2, 285]], "cada nombre en su renglón, sobre lo suyo");
  assert.deepEqual(tree.leaves.map((placed) => placed.y), [85, 165, 215, 325]);
  assert.equal(tree.height, 5 * 30 + 4 * 50);
  assert.equal(tree.depth, 2);
  const trunk = tree.branches.find((branch) => branch.depth === 0)!;
  assert.deepEqual([trunk.from, trunk.to, trunk.twigs.map((twig) => twig.y)], [15, 255, [45, 125, 255]], "la línea baja de la oración hasta su última parte, con un ramal a cada una");
  // Una parte de una sola palabra la lleva en su mismo renglón cuando el nombre le deja sitio.
  const tight = layoutSideways(root, { node: 30, leaf: 50, beside: (node) => node.role === "v" });
  assert.deepEqual(tight.nodes.map((placed) => placed.y), [15, 55, 95, 225, 265]);
  assert.deepEqual(tight.leaves.map((placed) => placed.y), [55, 135, 185, 265], "el verbo y su palabra, a la misma altura");
  assert.equal(tight.height, 30 + 50 + 30 + 100 + 30 + 50);
});

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "trees");

test("los archivos que la app sirve: los 66 libros, y Jonás 1:1 y Tito 1:5 como se esperan", () => {
  assert.equal(existsSync(path.join(OUT, "index.json")), true, "falta public/trees: npm run trees:build");
  const index = JSON.parse(readFileSync(path.join(OUT, "index.json"), "utf8")) as { books: string[]; license: string };
  assert.match(index.license, /CC BY/);
  assert.deepEqual([...index.books].sort(), BOOKS.map((book) => book.code).sort());
  const read = (book: string) => normalizeTreeFile(JSON.parse(readFileSync(path.join(OUT, `${book}.json`), "utf8")))!;
  const jonah = read("JON");
  assert.equal(line(sentencesAt(jonah, { chapter: 1, verse: 1 })[0]!.root), "*[&[1:1.1«וַ»] *[v[1:1.1«יְהִי»] s[1:1.2 1:1.3] pp[1:1.4 1:1.5 1:1.6 1:1.7] pp[v*[1:1.8]]]]");
  assert.deepEqual(sentenceShape(sentencesAt(jonah, { chapter: 1, verse: 1 })[0]!.root), { clauses: 1, subordinate: 0, joined: 0 }, "Jonás 1:1 es una oración simple");
  assert.equal(sentenceShape(sentencesAt(jonah, { chapter: 1, verse: 3 })[0]!.root).joined > 1, true, "Jonás 1:3 son varias oraciones unidas: se levantó, bajó, halló, pagó…");
  assert.equal(sentenceShape(sentencesAt(read("TIT"), { chapter: 1, verse: 1 })[0]!.root).subordinate > 0, true, "Tito 1:1–4 tiene oraciones que dependen de otra");
  assert.equal(sentencesAt(jonah, { chapter: 1, verse: 17 }).length > 0, true, "Jonás 2:1 del hebreo es nuestro 1:17");
  assert.equal(sentencesAt(jonah, { chapter: 2, verse: 11 }).length, 0);
  assert.equal(sentencesAt(read("TIT"), { chapter: 1, verse: 5 }).length, 1);
  for (const book of ["JON", "TIT", "PSA"]) for (const sentence of read(book).sentences) for (const leaf of leavesOf(sentence.root)) assert.equal(leaf.verse > 0 && leaf.word > 0, true, `${book} ${leaf.chapter}:${leaf.verse}`);
  // Hechos 24:6: nuestro texto sigue con palabras que el análisis no trae; el versículo dice cuántas tiene.
  const acts = read("ACT");
  const [paul] = sentencesAt(acts, { chapter: 24, verse: 6 });
  assert.equal(wordsLeftOut(acts, paul!).filter((leaf) => leaf.verse === 6).length, 7);
  assert.equal(sentenceFits(acts, paul!, (verse) => acts.counts.get(`${verse.chapter}:${verse.verse}`)), true);
  // Salmo 4:1: el título es un versículo en la Biblia hebrea y ninguno en nuestro texto; sus cuatro palabras no
  // se cuentan con las diez del versículo.
  assert.equal(read("PSA").counts.get("4:1"), 10);
  assert.equal(read("PSA").held.get("4:1")?.size, 10);
  // 1 Reyes 13:3: «aquel» (la tercera palabra) está en su oración.
  assert.equal(read("1KI").held.get("13:3")?.has(3), true);
});

test("bajo cada palabra del original, las palabras de la traducción alineadas con ella en ese versículo", () => {
  const src = (content: string, occurrence = 1) => ({ content, occurrence, occurrences: 1, strong: "", lemma: "" });
  const tgt = (word: string) => ({ word, occurrence: 1, occurrences: 1 });
  // Esdras 3:10, abreviado: «y los constructores pusieron los cimientos del templo»; וְ sin alinear.
  const groups = [
    { sources: [src("יִסְּדוּ")], targets: [tgt("pusieron"), tgt("los"), tgt("cimientos")] },
    { sources: [src("הַ⁠בֹּנִים")], targets: [tgt("los"), tgt("constructores")] },
    { sources: [src("אֶת"), src("הֵיכַל")], targets: [tgt("del"), tgt("templo")] },
    { sources: [src("יְהוָה", 2)], targets: [tgt("Jehová")] },
  ];
  const words = ["וְ", "יִסְּדוּ", "הַבֹּנִים", "אֶת", "הֵיכַל", "יְהוָה", "יְהוָה"].map((surface) => ({ surface }));
  assert.deepEqual(alignedWordsOfVerse(groups as never, words), ["", "pusieron los cimientos", "los constructores", "del templo", "del templo", "", "Jehová"]);
  assert.equal(verseIsAligned(groups as never), true);
  assert.equal(verseIsAligned([{ sources: [src("וְ")], targets: [] }] as never), false, "sin palabras de la traducción no está alineado");
  assert.deepEqual(alignedWordsOfVerse(undefined, words.slice(0, 2)), ["", ""]);
});

console.log(`\nverify-trees: ${passed} checks passed.`);
