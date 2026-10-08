/**
 * Saving the alignment of a verse against a fake Door43
 * held in memory (nothing leaves the machine): one decisions file per person,
 * retries when a file moved meanwhile, and corrections that keep alignment.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { GtSession } from "../src/dcs/auth";
import { alignmentLayerPath, saveVerseAlignment } from "../src/dcs/alignmentStore";
import type { OriginalWordToken, WordToken } from "@usfm-tools/editor-core";
import { addSourcesToBox } from "@usfm-ast/alignment-box-model";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

// ---- a tiny Door43: files by branch and path, with the sha rules of the contents API ----
const files = new Map<string, { text: string; sha: string }>();
let counter = 0;
const key = (branch: string, path: string) => `${branch}::${path}`;
const put = (branch: string, path: string, text: string) => files.set(key(branch, path), { text, sha: `sha${++counter}` });
/** Run once, right before the next write, to simulate somebody else writing first. */
let beforeNextWrite: (() => void) | null = null;
let writes = 0;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const m = /\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(url.pathname);
  if (!m) return json({ message: "not found" }, 404);
  const path = decodeURIComponent(m[3]!);
  const branch = url.searchParams.get("ref") ?? "main";
  const method = init?.method ?? "GET";
  if (method === "GET") {
    const hit = files.get(key(branch, path));
    if (hit) {
      return json({ name: path.split("/").pop(), path, sha: hit.sha, size: hit.text.length, type: "file", content: Buffer.from(hit.text, "utf-8").toString("base64"), encoding: "base64" });
    }
    const prefix = `${branch}::${path}/`;
    const inDir = [...files.entries()].filter(([k]) => k.startsWith(prefix));
    if (inDir.length) {
      return json(inDir.map(([k, v]) => ({ name: k.slice(prefix.length), path: k.slice(`${branch}::`.length), sha: v.sha, size: v.text.length, type: "file" })));
    }
    return json({ message: "not found" }, 404);
  }
  const body = JSON.parse(String(init?.body ?? "{}")) as { content: string; sha?: string; branch?: string };
  const target = key(body.branch ?? "main", path);
  if (beforeNextWrite) {
    const run = beforeNextWrite;
    beforeNextWrite = null;
    run();
  }
  const current = files.get(target);
  if (current && body.sha !== current.sha) return json({ message: "sha mismatch" }, 409);
  if (!current && body.sha) return json({ message: "not found" }, 404);
  writes++;
  files.set(target, { text: Buffer.from(body.content, "base64").toString("utf-8"), sha: `sha${++counter}` });
  return json({ content: { sha: files.get(target)!.sha }, commit: { sha: "c", message: "m" } });
}) as typeof fetch;

const session = (username: string) => ({ host: "http://fake.local", token: "t", username }) as unknown as GtSession;
const target = { owner: "es-419_gl", repo: "es-419_glt", branch: "tit/tpl" };
const source = { id: "unfoldingword/el-x-koine_ugnt", layerDir: "el-x-koine_ugnt" };
const draftPath = "57-TIT.usfm";
const BS = String.fromCharCode(92);
const draft = ["id TIT", "c 1", "p", "v 1 Pablo siervo de Dios", "v 2 en esperanza", ""].map((l) => (l ? BS + l : l)).join(String.fromCharCode(10));
const has = (text: string, part: string) => text.includes(part.split("@").join(BS));
const words = (text: string) => [...text.matchAll(new RegExp(BS + BS + "w ([^|]+)" + BS + "|", "g"))].map((m) => m[1]);

const src = (index: number, surface: string) => ({ verseSid: "TIT 1:1", surface, strong: "G" + index, lemma: surface, occurrence: 1, occurrences: 1, index }) as OriginalWordToken;
const tw = (index: number, surface: string) => ({ verseSid: "TIT 1:1", surface, occurrence: 1, occurrences: 1, index }) as WordToken;
const s1 = [src(0, "Παῦλος"), src(1, "δοῦλος")];
const t1 = [tw(0, "Pablo"), tw(1, "siervo")];
const s2 = [src(0, "ἐλπίδι")];
const t2 = [tw(0, "esperanza")];
const groups1 = addSourcesToBox(s1, t1, addSourcesToBox(s1, t1, [], "u0", [0]), "u1", [1]);
const groups2 = addSourcesToBox(s2, t2, [], "u0", [0]);
const layer = () => JSON.parse(files.get(key("tit/tpl", alignmentLayerPath(source, "TIT")))!.text);
const draftNow = () => files.get(key("tit/tpl", draftPath))!.text;

await test("alinear un versículo escribe las marcas en el borrador y la capa de alineación", async () => {
  put("tit/tpl", draftPath, draft);
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 1, groups: groups1, source });
  assert.ok(has(draftNow(), "@zaln-s") && draftNow().includes("Παῦλος"));
  assert.ok(words(draftNow()).includes("Pablo"));
  assert.ok(has(draftNow(), "@v 2 en esperanza"), "el otro versículo sigue sin marcas");
  assert.deepEqual(Object.keys(layer().verses), ["TIT 1:1"]);
  assert.equal(layer().verses["TIT 1:1"][0].sources[0].content, "Παῦλος");
});

await test("alinear otro versículo no toca el primero", async () => {
  await saveVerseAlignment({ session: session("bea"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 2, groups: groups2, source });
  assert.deepEqual(Object.keys(layer().verses).sort(), ["TIT 1:1", "TIT 1:2"]);
  assert.ok(words(draftNow()).includes("Pablo"));
  assert.ok(words(draftNow()).includes("esperanza"));
});

await test("dejar un versículo sin uniones quita sus marcas y lo saca de la capa", async () => {
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 1, groups: [], source });
  assert.deepEqual(Object.keys(layer().verses), ["TIT 1:2"]);
  assert.ok(!words(draftNow()).includes("Pablo"));
  assert.ok(words(draftNow()).includes("esperanza"));
});

await test("si otra persona alineó mientras tanto, se guarda sobre lo último sin perderlo", async () => {
  put("tit/tpl", draftPath, draft);
  files.delete(key("tit/tpl", alignmentLayerPath(source, "TIT")));
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 2, groups: groups2, source });
  beforeNextWrite = async () => {};
  let once = true;
  beforeNextWrite = () => {
    if (!once) return;
    once = false;
    const cur = files.get(key("tit/tpl", draftPath))!.text;
    put("tit/tpl", draftPath, cur.replace("Dios", "Dios y Salvador"));
  };
  await saveVerseAlignment({ session: session("bea"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 1, groups: groups1, source });
  assert.match(draftNow(), /Salvador/, "el cambio de la otra persona quedó");
  assert.ok(words(draftNow()).includes("Pablo"));
  assert.ok(words(draftNow()).includes("esperanza"));
});

await test("una palabra con puntuación se guarda sin ella y el texto no cambia", async () => {
  put("tit/tpl", draftPath, [BS + "id TIT", BS + "c 1", BS + "p", BS + "v 1 Pablo, siervo de Dios."].join(String.fromCharCode(10)) + String.fromCharCode(10));
  files.delete(key("tit/tpl", alignmentLayerPath(source, "TIT")));
  const sp = [src(0, "Παῦλος"), src(1, "Θεοῦ")];
  const tp = [tw(0, "Pablo,"), tw(1, "siervo"), tw(2, "de"), tw(3, "Dios.")];
  const groups = addSourcesToBox(sp, tp, addSourcesToBox(sp, tp, [], "u0", [0]), "u1", [1, 2, 3]);
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 1, groups, source });
  const text = draftNow();
  assert.ok(words(text).includes("Pablo") && words(text).includes("Dios"), "las palabras van sin puntuación");
  assert.ok(!text.includes("Dios.|") && !text.includes("Pablo,|"), "la puntuación no queda dentro de la marca");
  assert.ok(!text.includes(".."), "el punto final no se duplica");
  assert.equal(layer().verses["TIT 1:1"][1].targets.map((t: { word: string }) => t.word).join(" "), "siervo de Dios");
});

// ---------------------------------------------------------------- the format of the rest of the book

const { existsSync, readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { extractAlignmentDocumentFromUsfm } = await import("@usfm-tools/editor-core");
const { applyVerseEdits, chunkStarts, listVerseSpans, skeletonUsfmFromSource, verseLeads, verseParts } = await import("../src/domain/usfmEdit");

const NL = String.fromCharCode(10);
const mark = (line: string) => (line ? BS + line : line);
/** The verse of a book, from its number to the end of its text. */
const bodyOf = (usfm: string, chapter: number, verse: number) => {
  const span = listVerseSpans(usfm).find((s) => s.chapter === chapter && s.verse === verse)!;
  return usfm.slice(span.start, verseParts(usfm, span).textEnd);
};
/** The book without that verse. */
const restOf = (usfm: string, chapter: number, verse: number) => {
  const span = listVerseSpans(usfm).find((s) => s.chapter === chapter && s.verse === verse)!;
  return usfm.slice(0, span.start) + usfm.slice(verseParts(usfm, span).textEnd);
};
const group = (content: string, ...targets: string[]) => ({
  sources: [{ strong: "H0001", lemma: content, morph: "He,Ncmsa", content, occurrence: 1, occurrences: 1 }],
  targets: targets.map((word) => ({ word, occurrence: 1, occurrences: 1 })),
});
const jon = { owner: "es-419_gl", repo: "es-419_glt", branch: "borrador/jon/tpl" };
const jonPath = "32-JON.usfm";
const align = async (chapter: number, verse: number, groups: unknown[], book = "JON") => {
  await saveVerseAlignment({ session: session("ana"), target: jon, filepath: jonPath, book, chapter, verse, groups: groups as never, source });
  return files.get(key(jon.branch, jonPath))!.text;
};

/** Jonah 2 of a source: a chunk mark before the chapter and before 2:3, a psalm in lines of two depths. */
const ult = ["id JON EN_ULT", "usfm 3.0", "mt1 Jonah", "", "ts" + BS + "*", "c 2", "p", "v 1 And Jonah prayed.", "v 2 And he said,", "q1 “I cried out to Yahweh,", "q2 from the belly of Sheol.", "", "ts" + BS + "*", "q1", "v 3 Now you had cast me;", "q2 all your waves.", "b", "q1", "v 4 But I said,", "q2 yet I might look.", "m", "v 5 Then Yahweh spoke.", ""].map(mark).join(NL);

await test("alinear un versículo de un libro que se está traduciendo no cambia nada más: ni trozos, ni renglones, ni versículos vacíos", async () => {
  // As the app leaves a book that is begun here: the shape of its source, some verses written, the rest empty.
  const leads = verseLeads(ult, 2);
  let book = skeletonUsfmFromSource("JON", ult, "Jonás");
  book = applyVerseEdits(book, 2, [
    { from: 1, to: 1, text: "Y Jonás oró a Jehová su Dios." },
    { from: 2, to: 2, text: "Y dijo:" + NL + "«Clamé a Jehová desde mi angustia," + NL + "desde el vientre del Seol clamé.", leads: leads[2] },
    { from: 4, to: 4, text: "Yo dije: He sido expulsado;" + NL + "pero volveré a mirar.", leads: leads[4] },
  ]);
  // With a footnote and a marked word.
  book = book.replace("desde mi angustia,", "desde mi angustia," + BS + "f + " + BS + "fr 2:2 " + BS + "ft Nota de prueba." + BS + "f*").replace("He sido expulsado", "He sido " + BS + "add expulsado" + BS + "add*");
  put(jon.branch, jonPath, book);

  const one = await align(2, 1, [group("יונה", "Jonás"), group("פלל", "oró")]);
  assert.equal(restOf(one, 2, 1), restOf(book, 2, 1), "alinear 2:1: el resto del libro, byte por byte");
  assert.ok(has(bodyOf(one, 2, 1), "@w Jonás|") && has(bodyOf(one, 2, 1), "@w oró|"));

  const two = await align(2, 2, [group("קראתי", "Clamé"), group("צרה", "angustia"), group("שאול", "Seol")]);
  assert.equal(restOf(two, 2, 2), restOf(one, 2, 2), "alinear 2:2: el resto, byte por byte");
  const span = listVerseSpans(two).find((s) => s.chapter === 2 && s.verse === 2)!;
  assert.deepEqual(verseParts(two, span).lines.map((line) => line.lead.split(BS).join("@")), ["", "@q1", "@q2"], "el versículo alineado sigue en sus tres renglones");
  assert.equal(span.text, listVerseSpans(one).find((s) => s.chapter === 2 && s.verse === 2)!.text, "y dice lo mismo");
  assert.ok(has(bodyOf(two, 2, 2), "@f + @fr 2:2 @ft Nota de prueba.@f*"), "con su nota al pie");

  const three = await align(2, 4, [group("נגרשתי", "expulsado")]);
  assert.equal(restOf(three, 2, 4), restOf(two, 2, 4));
  assert.ok(/\\add\s+\\zaln-s[^\n]*\\w expulsado\|[^\n]*\\zaln-e\\\*\\add\*/.test(bodyOf(three, 2, 4)), "la palabra marcada sigue marcada, y alineada dentro de su marca");

  // From the first state to the last, what is not one of the three verses did not move.
  assert.deepEqual(chunkStarts(three), chunkStarts(book), "las marcas de trozo, ante los mismos versículos");
  assert.equal(three.slice(0, three.indexOf(BS + "c 2")), book.slice(0, book.indexOf(BS + "c 2")), "lo que el libro dice de sí mismo");
  for (const verse of [3, 5]) assert.equal(bodyOf(three, 2, verse), bodyOf(book, 2, verse), `2:${verse}, vacío, sigue vacío en su sitio`);
  assert.deepEqual(Object.keys(extractAlignmentDocumentFromUsfm(three, { id: "JON" }, { id: "x" }).verses).sort(), ["JON 2:1", "JON 2:2", "JON 2:4"]);

  // Aligned again with nothing different, nothing is written differently; cleared, the verse is as it was written.
  assert.equal(await align(2, 4, [group("נגרשתי", "expulsado")]), three);
  const cleared = await align(2, 1, []);
  assert.equal(bodyOf(cleared, 2, 1), bodyOf(book, 2, 1), "sin uniones, 2:1 vuelve a ser su texto");
  assert.equal(restOf(cleared, 2, 1), restOf(three, 2, 1));
});

const fixtures = fileURLToPath(new URL("../../usfm-ast/packages/usfm-parser/tests/fixtures/usfm/", import.meta.url));
const real: [string, string, string, number, number][] = [
  ["el Judas del ULT", "jud.ult-aligned.usfm", "JUD", 1, 3],
  ["el Jonás de un equipo, hecho con translationCore", "jon.tpl-aligned.usfm", "JON", 2, 2],
  ["tres salmos del ULT", "psa.ult-aligned.usfm", "PSA", 3, 3],
];
for (const [name, file, code, chapter, verse] of real) {
  if (!existsSync(fixtures + file)) {
    console.log(`--  ${name}: no está el archivo de prueba de usfm-ast; no se ejecutó.`);
    continue;
  }
  await test(`${name}: alinear un versículo deja cada otra línea del libro como estaba`, async () => {
    const before = readFileSync(fixtures + file, "utf8").split(String.fromCharCode(13)).join("");
    put(jon.branch, jonPath, before);
    const groups = extractAlignmentDocumentFromUsfm(before, { id: code }, { id: "x" }).verses[`${code} ${chapter}:${verse}`]!;
    assert.ok(groups.length > 3, "el versículo tiene uniones");
    // One union less: what somebody does when they take a word out of a box.
    const after = await align(chapter, verse, groups.slice(1), code);
    assert.equal(restOf(after, chapter, verse), restOf(before, chapter, verse), "el resto del libro, byte por byte");
    assert.notEqual(bodyOf(after, chapter, verse), bodyOf(before, chapter, verse), "y el versículo sí cambió");
    const now = extractAlignmentDocumentFromUsfm(after, { id: code }, { id: "x" }).verses;
    const was = extractAlignmentDocumentFromUsfm(before, { id: code }, { id: "x" }).verses;
    assert.equal(now[`${code} ${chapter}:${verse}`]!.length, groups.length - 1);
    for (const sid of Object.keys(was)) if (sid !== `${code} ${chapter}:${verse}`) assert.deepEqual(now[sid], was[sid], `la alineación de ${sid}`);
    const span = (usfm: string) => listVerseSpans(usfm).find((s) => s.chapter === chapter && s.verse === verse)!;
    assert.equal(span(after).text, span(before).text, "el versículo dice lo mismo");
    assert.deepEqual(verseParts(after, span(after)).lines.map((line) => line.lead), verseParts(before, span(before)).lines.map((line) => line.lead), "en los mismos renglones");
  });
}

console.log(`\nverify-alignment-store: ${passed} checks passed.`);
