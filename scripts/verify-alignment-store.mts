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

console.log(`\nverify-alignment-store: ${passed} checks passed.`);
