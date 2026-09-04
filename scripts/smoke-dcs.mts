/**
 * One-off live smoke test of DcsClient against the real git.door43.org —
 * not part of the offline test suite (network + real org content can
 * change), just a manual sanity check that fetch()/zip parsing actually
 * work against the live API, not only the local fixtures.
 */
import { DcsClient, englishTarget, makeTarget } from "../src/status/dcs.ts";
import { normalizeAcademia, normalizePalabras } from "../src/status/collect.ts";

const target = makeTarget({ org: "es-419_gl", taRepo: "es-419_ta", twRepo: "es-419_tw" });
const enTarget = englishTarget();

console.log("--- contents mode, es-419_ta figs-metaphor ---");
const contentsClient = new DcsClient(target, { mode: "contents" });
const r1 = await contentsClient.fetchArticle(normalizeAcademia("figs-metaphor"));
console.log({ found: r1.found, path: r1.path, files: r1.files.map(([p]) => p), fetchMode: r1.fetchMode });

console.log("\n--- contents mode, es-419_tw god ---");
const r2 = await contentsClient.fetchArticle(normalizePalabras("god"));
console.log({ found: r2.found, path: r2.path, files: r2.files.map(([p]) => p) });

console.log("\n--- archive mode, es-419_ta (zip download) ---");
const archiveClient = new DcsClient(target, { mode: "archive" });
const r3 = await archiveClient.fetchArticle(normalizeAcademia("figs-metaphor"));
console.log({ found: r3.found, path: r3.path, files: r3.files.map(([p]) => p), fetchMode: r3.fetchMode });
const r4 = await archiveClient.fetchArticle(normalizeAcademia("figs-explicit"));
console.log("second lookup reuses cached tree:", { found: r4.found, path: r4.path });

console.log("\n--- subject resolution ---");
console.log("TA subject:", await archiveClient.subjectFor("Academia"));

console.log("\n--- english reference (contents mode) ---");
const enClient = new DcsClient(enTarget, { mode: "contents" });
const r5 = await enClient.fetchArticle(normalizeAcademia("figs-metaphor"));
console.log({ found: r5.found, path: r5.path, files: r5.files.map(([p]) => p) });

console.log("\n--- nonexistent article ---");
const r6 = await contentsClient.fetchArticle(normalizeAcademia("no-such-article-xyz"));
console.log({ found: r6.found });

console.log("\nSmoke test finished without throwing.");
