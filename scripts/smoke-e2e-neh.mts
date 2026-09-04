/**
 * Full end-to-end live smoke test: fetch real NEH source files from Door43,
 * run the TS prep + status port, and sanity-check the result against the
 * bundled public/data/neh-status.json snapshot. Manual-only (network, real
 * org content) — not part of the offline test suite.
 */
import { readFileSync } from "node:fs";
import { runPrep } from "../src/prep/index.ts";
import { runStatus } from "../src/status/index.ts";

const RAW = (repo: string, path: string) => `https://git.door43.org/unfoldingWord/${repo}/raw/branch/master/${path}`;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

console.log("Fetching NEH source files from Door43…");
const [ult, tn, tq, twl] = await Promise.all([
  fetchText(RAW("en_ult", "16-NEH.usfm")),
  fetchText(RAW("en_tn", "tn_NEH.tsv")),
  fetchText(RAW("en_tq", "tq_NEH.tsv")),
  fetchText(RAW("en_twl", "twl_NEH.tsv")),
]);
console.log(`  ult ${ult.length}B, tn ${tn.length}B, tq ${tq.length}B, twl ${twl.length}B`);

console.time("prep");
const prep = runPrep({
  book: "NEH",
  ultText: ult,
  ultPath: "16-NEH.usfm",
  tn: { path: "tn_NEH.tsv", text: tn },
  tq: { path: "tq_NEH.tsv", text: tq },
  twl: { path: "twl_NEH.tsv", text: twl },
});
console.timeEnd("prep");
console.log(
  `  portions=${(prep.counts as Record<string, number>).portions} notas=${(prep.counts as Record<string, number>).notas} ` +
    `preguntas=${(prep.counts as Record<string, number>).preguntas} palabras=${(prep.counts as Record<string, number>).palabras} ` +
    `academia=${(prep.counts as Record<string, number>).academia} warnings=${(prep.counts as Record<string, number>).warnings}`,
);

console.time("status");
const status = await runStatus({
  prep,
  org: "es-419_gl",
  taRepo: "es-419_ta",
  twRepo: "es-419_tw",
  onProgress: (msg) => console.log(`  ${msg}`),
});
console.timeEnd("status");

const counts = status.counts as { total: Record<string, number> };
console.log("status counts:", JSON.stringify(counts.total));

const snapshot = JSON.parse(readFileSync(new URL("../public/data/neh-status.json", import.meta.url), "utf-8"));
console.log("\n--- compare against bundled snapshot ---");
console.log("snapshot portions:", snapshot.portions?.length, "vs ours:", (status.portions as unknown[])?.length);
console.log("snapshot counts.total:", JSON.stringify(snapshot.counts?.total));

const ourArticles = new Map((status.articles as { id: string; status: string }[]).map((a) => [a.id, a.status]));
const snapArticles = new Map((snapshot.articles as { id: string; status: string }[]).map((a: { id: string; status: string }) => [a.id, a.status]));
let agree = 0;
let disagree = 0;
const disagreements: { id: string; snapshot: string; ours: string }[] = [];
for (const [id, snapStatus] of snapArticles) {
  const ourStatus = ourArticles.get(id);
  if (ourStatus === undefined) continue;
  if (ourStatus === snapStatus) agree += 1;
  else {
    disagree += 1;
    if (disagreements.length < 10) disagreements.push({ id, snapshot: snapStatus, ours: ourStatus });
  }
}
console.log(`\narticle status agreement vs snapshot: ${agree} agree, ${disagree} disagree (out of ${snapArticles.size} in snapshot)`);
if (disagreements.length) console.log("sample disagreements (expected: DCS content may have changed since the snapshot):", disagreements);

console.log("\nE2E smoke test finished without throwing.");
