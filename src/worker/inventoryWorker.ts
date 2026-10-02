/**
 * Browser Web Worker: generates a book inventory (prep + article status)
 * entirely client-side. Replaces the old local Python process
 * (scripts/worker.py, retired) — runs runPrep + runStatus off the main
 * thread so downloading/parsing/classifying a full book doesn't block the UI.
 */

import { runPrep } from "../prep";
import { fetchBookFiles } from "../prep/fetchBook";
import { runStatus } from "../status";
import type { GenerateRequest, WorkerResponse } from "./protocol";

// The project's tsconfig only carries the DOM lib (needed by the rest of
// the app), which declares `self` as `Window` — not the worker globals.
// Rather than pull in `lib: ["webworker"]` project-wide (it conflicts with
// DOM's own `self`/`postMessage` types), declare just the shape this file
// actually uses.
interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

/** Port of scripts/worker.py's `_default_repos`. */
function defaultRepos(lang: string, contentOrg: string): { org: string; taRepo: string; twRepo: string } {
  const base = (lang || "es-419").trim().toLowerCase().replace(/_gl$/, "");
  const org = (contentOrg || `${base}_gl`).trim();
  return { org, taRepo: `${base}_ta`, twRepo: `${base}_tw` };
}

ctx.onmessage = async (event) => {
  const { requestId, book, lang, contentOrg, portionStarts } = event.data;
  const onProgress = (message: string) => ctx.postMessage({ type: "progress", requestId, message });
  try {
    const files = await fetchBookFiles(book, onProgress);
    onProgress("Preparando porciones…");
    const prep = runPrep({
      book,
      ultText: files.ult,
      ultPath: book,
      tn: files.tn ? { path: `tn_${book}.tsv`, text: files.tn } : null,
      tq: files.tq ? { path: `tq_${book}.tsv`, text: files.tq } : null,
      twl: files.twl ? { path: `twl_${book}.tsv`, text: files.twl } : null,
      hasUst: Boolean(files.ust),
      portionStarts,
    });

    onProgress("Revisando artículos…");
    const { org, taRepo, twRepo } = defaultRepos(lang, contentOrg);
    const result = await runStatus({ prep, org, taRepo, twRepo, onProgress });

    ctx.postMessage({ type: "result", requestId, result });
  } catch (err) {
    ctx.postMessage({ type: "error", requestId, message: err instanceof Error ? err.message : String(err) });
  }
};
