/**
 * Reading and writing the checking data of a Afinación against a fake Door43
 * held in memory (nothing leaves the machine): one decisions file per person,
 * retries when a file moved meanwhile, and corrections that keep alignment.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { GtSession } from "../src/dcs/auth";
import { appendMyDecision, loadDecisionFiles, loadPreferredTerms, savePreferredTerm, saveCorrection } from "../src/dcs/afinacionStore";
import { mergeDecisionFiles, type ReviewDecision } from "../src/domain/reviewRound";

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
const decision = (reviewer: string, itemId: string, status: string, at: number): ReviewDecision =>
  ({
    itemId, reviewer, status, textHash: "h1",
    ref: { start: { chapter: 1, verse: 2 } }, sessionId: "s1", stageId: "afinacion",
    timestamp: new Date(Date.UTC(2026, 9, 1, 12, at)).toISOString(),
  }) as ReviewDecision;

await test("sin carpeta de decisiones no hay respuestas", async () => {
  assert.deepEqual(await loadDecisionFiles(session("ana"), target, "TIT"), []);
});

await test("cada persona escribe su propio archivo y se leen todos juntos", async () => {
  await appendMyDecision(session("ana"), target, "TIT", decision("ana", "n1", "approved", 1));
  await appendMyDecision(session("bea"), target, "TIT", decision("bea", "n1", "rejected", 2));
  await appendMyDecision(session("ana"), target, "TIT", decision("ana", "n2", "approved", 3));
  assert.ok(files.has(key("tit/tpl", "checkings/decisions/TIT.ana.decisions.json")));
  assert.ok(files.has(key("tit/tpl", "checkings/decisions/TIT.bea.decisions.json")));
  const loaded = await loadDecisionFiles(session("bea"), target, "TIT");
  assert.equal(loaded.length, 2);
  assert.deepEqual(mergeDecisionFiles(loaded).map((d) => `${d.reviewer}:${d.itemId}`), ["ana:n1", "bea:n1", "ana:n2"]);
  const beaFile = JSON.parse(files.get(key("tit/tpl", "checkings/decisions/TIT.bea.decisions.json"))!.text);
  assert.equal(beaFile.decisions.length, 1, "Bea no toca el archivo de Ana ni al revés");
});

await test("solo se leen los archivos del libro pedido", async () => {
  put("tit/tpl", "checkings/decisions/NEH.ana.decisions.json", JSON.stringify({ book: "NEH", decisions: [decision("ana", "x", "approved", 9)] }));
  assert.equal((await loadDecisionFiles(session("ana"), target, "TIT")).length, 2);
  assert.equal((await loadDecisionFiles(session("ana"), target, "NEH")).length, 1);
});

await test("si el archivo cambió mientras se guardaba, se vuelve a leer y se reintenta sin perder nada", async () => {
  const path = "checkings/decisions/TIT.ana.decisions.json";
  beforeNextWrite = () => {
    const now = JSON.parse(files.get(key("tit/tpl", path))!.text);
    now.decisions.push(decision("ana", "otro", "approved", 20));
    put("tit/tpl", path, JSON.stringify(now));
  };
  await appendMyDecision(session("ana"), target, "TIT", decision("ana", "n3", "revise", 21));
  const saved = JSON.parse(files.get(key("tit/tpl", path))!.text);
  assert.deepEqual(saved.decisions.map((d: ReviewDecision) => d.itemId), ["n1", "n2", "otro", "n3"]);
});

// ---- corrections on the group draft ----
const z = (strong: string, content: string, word: string) =>
  String.raw`\zaln-s |x-strong="${strong}" x-lemma="${content}" x-morph="Gr,N,,,,,NMS," x-occurrence="1" x-occurrences="1" x-content="${content}"\*\w ${word}|x-occurrence="1" x-occurrences="1"\w*\zaln-e\*`;
const draft = ["\\id TIT", "\\c 1", "\\p", `\\v 1 ${z("G1", "Παῦλος", "Pablo")} ${z("G2", "δοῦλος", "siervo")}`, `\\v 2 ${z("G3", "ἐλπίδι", "esperanza")}`, ""].join("\n");
const draftPath = "57-TIT.usfm";
/** The aligned words of a verse, on however many lines it is written (a group to a line). */
const wordsOf = (usfm: string, verse: number) =>
  [...(new RegExp(`\\\\v ${verse} ([\\s\\S]*?)(?=\\\\v \\d|\\\\c \\d|$)`).exec(usfm)?.[1] ?? "").matchAll(/\\w ([^|\\]+)\|/g)].map((x) => x[1]);

await test("corregir un versículo lo escribe en el borrador grupal y conserva las palabras que no cambiaron", async () => {
  put("tit/tpl", draftPath, draft);
  const res = await saveCorrection({ session: session("carla"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 1, text: "Pablo, esclavo", reason: "siervo → esclavo" });
  const now = files.get(key("tit/tpl", draftPath))!.text;
  assert.match(now, /esclavo/);
  assert.deepEqual(wordsOf(now, 1), ["Pablo"]);
  assert.deepEqual(wordsOf(now, 2), ["esperanza"], "los demás versículos no se tocan");
  assert.deepEqual(res.reducedVerses, [1]);
});

await test("si el borrador cambió mientras se corregía, se corrige sobre lo último", async () => {
  put("tit/tpl", draftPath, draft);
  beforeNextWrite = () => {
    const cur = files.get(key("tit/tpl", draftPath))!.text;
    put("tit/tpl", draftPath, cur.replace("esperanza", "confianza"));
  };
  await saveCorrection({ session: session("carla"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 1, text: "Pablo, esclavo", reason: "" });
  const now = files.get(key("tit/tpl", draftPath))!.text;
  assert.match(now, /esclavo/, "la corrección quedó");
  assert.match(now, /confianza/, "lo que escribió la otra persona no se perdió");
});

await test("una corrección que no cambia nada no escribe", async () => {
  put("tit/tpl", draftPath, draft);
  const before = writes;
  await saveCorrection({ session: session("carla"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 2, text: "esperanza", reason: "" });
  assert.equal(writes, before);
});

await test("reescribir un versículo por completo avisa que se perdió su alineación", async () => {
  put("tit/tpl", draftPath, draft);
  const res = await saveCorrection({ session: session("carla"), target, filepath: draftPath, book: "TIT", chapter: 1, verse: 2, text: "otra cosa distinta", reason: "" });
  assert.deepEqual(res.clearedVerses, [2]);
  assert.deepEqual(wordsOf(files.get(key("tit/tpl", draftPath))!.text, 1), ["Pablo", "siervo"]);
});

await test("la traducción preferida de un término se guarda y se lee, y una persona no pisa lo de otra", async () => {
  assert.deepEqual(await loadPreferredTerms(session("ana"), target), {});
  await savePreferredTerm({ session: session("ana"), target, slug: "god", text: "Dios" });
  beforeNextWrite = () => {
    const path = "checkings/preferred-terms.json";
    const now = JSON.parse(files.get(key("tit/tpl", path))!.text);
    now.terms.lord = { text: "Señor", by: "bea", at: "2026-10-01" };
    put("tit/tpl", path, JSON.stringify(now));
  };
  const saved = await savePreferredTerm({ session: session("carla"), target, slug: "sin", text: "pecado" });
  assert.deepEqual(Object.keys(saved).sort(), ["god", "lord", "sin"]);
  const cleared = await savePreferredTerm({ session: session("ana"), target, slug: "god", text: "" });
  assert.deepEqual(Object.keys(cleared).sort(), ["lord", "sin"]);
  assert.equal((await loadPreferredTerms(session("ana"), target)).sin?.by, "carla");
});

console.log(`\nverify-afinacion-store: ${passed} checks passed.`);
