/**
 * Port of the file-discovery half of scripts/worker.py's `fetch_package` /
 * `_download_companion`. Downloads a book's ULT (+ UST/TN/TQ/TWL, all
 * optional past the ULT) straight from Door43 — raw content there sends
 * Access-Control-Allow-Origin: *, so this runs from a Worker with no proxy.
 */

import { USFM_BOOK_NUM, bookUsfmName } from "./discover";

const DOOR43_RAW = (repo: string, branch: string, path: string) =>
  `https://git.door43.org/unfoldingWord/${repo}/raw/branch/${branch}/${path}`;

type CompanionKind = "ult" | "ust" | "tn" | "tq" | "twl";

const COMPANION_REPOS: Record<CompanionKind, string> = {
  ult: "en_ult",
  ust: "en_ust",
  tn: "en_tn",
  tq: "en_tq",
  twl: "en_twl",
};

// First 39 books in insertion order are the Old Testament (matches
// discover.ts / Python's USFM_BOOK_NUM ordering: GEN..MAL, then MAT..REV).
const OT_BOOKS = new Set(Object.keys(USFM_BOOK_NUM).slice(0, 39));

function bookPaths(book: string): Record<CompanionKind, string> {
  const usfm = bookUsfmName(book);
  return {
    ult: usfm,
    ust: usfm.endsWith(".usfm") ? usfm.replace(/\.usfm$/, ".ust.usfm") : `${book}.ust.usfm`,
    tn: `tn_${book}.tsv`,
    tq: `tq_${book}.tsv`,
    twl: `twl_${book}.tsv`,
  };
}

async function tryDownload(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function downloadCompanion(kind: CompanionKind, book: string): Promise<string | null> {
  const names = bookPaths(book);
  const filename = names[kind];
  const repo = COMPANION_REPOS[kind];
  const bookLower = book.toLowerCase();
  const num = USFM_BOOK_NUM[book];
  const candidates = [filename];
  if ((kind === "ult" || kind === "ust") && num) candidates.push(`${num}-${book}.usfm`);
  if (kind === "ust" && num) candidates.push(`${num}-${book}.ust.usfm`);
  candidates.push(`${book}/${filename}`, `${bookLower}/${filename}`);
  const testament = OT_BOOKS.has(book) ? "ot" : "nt";
  candidates.push(`${testament}/${bookLower}/${filename}`);

  for (const branch of ["master", "main"]) {
    for (const path of candidates) {
      const body = await tryDownload(DOOR43_RAW(repo, branch, path));
      if (body) return body;
    }
  }
  return null;
}

export type BookFiles = {
  ult: string;
  ust: string | null;
  tn: string | null;
  tq: string | null;
  twl: string | null;
};

export async function fetchBookFiles(book: string, onProgress?: (message: string) => void): Promise<BookFiles> {
  onProgress?.("Descargando ULT y compañeros…");
  const ult = await downloadCompanion("ult", book);
  if (!ult) {
    throw new Error(`No se pudo descargar el ULT de ${book}. Usa Cargar JSON o la instantánea NEH.`);
  }
  const [ust, tn, tq, twl] = await Promise.all([
    downloadCompanion("ust", book),
    downloadCompanion("tn", book),
    downloadCompanion("tq", book),
    downloadCompanion("twl", book),
  ]);
  return { ult, ust, tn, tq, twl };
}
