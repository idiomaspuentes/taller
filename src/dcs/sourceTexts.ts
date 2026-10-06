import { apiBase, getRawContent, request } from "@ip-lms/dcs-client";
import { chapterUsfm, splitUsfmChapters, type UsfmChapters } from "../domain/usfmChapters";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";

/**
 * The source texts, kept on the device by chapter.
 *
 * Every tool that shows a passage read the whole book of each English text from Door43 when it opened, and parsed
 * it whole: twice over (the literal and the simplified), in the editor, again in the review, again for the notes.
 * For Jude that is 93 KB a text. For Matthew it is 3.6 MB a text, 5.1 MB as the contents API sends it, to show
 * twelve verses on a phone. And since the glossary is found through the alignment, every tool now needs it.
 *
 * A book is read once and kept cut by chapter (IndexedDB): the next tool to open, and the next day's, reads the one
 * chapter it works on from the device, with no network at all. Whether the book changed in Door43 is asked once per
 * visit, after the chapter is already on screen, with one small request for the whole resource (the list of its
 * files, each with the hash of its content); a book that changed is read again, for the next time it is opened.
 * Without a network the kept chapter is what there is, which is also what lets a passage be read offline.
 *
 * What is kept is the text as Door43 gave it, not what was parsed from it: a chapter parses in a moment, and a kept
 * text needs no format of ours to be kept in step with.
 */

export type SourceFile = { owner: string; repo: string; filepath: string };

const DB = "taller-sources";
const FILES = "files";
const CHAPTERS = "chapters";
/** How many books stay on the device: the least recently opened go first. A team works on a handful at a time. */
const KEEP_FILES = 12;
const KEEP_IN_MEMORY = 24;
const DAY = 24 * 60 * 60 * 1000;

type FileRow = { key: string; stamp: string; chapters: number[]; savedAt: number; usedAt: number };
type ChapterRow = { key: string; file: string; usfm: string };

const fileKey = (host: string, file: SourceFile): string => `${host.replace(/\/$/, "")}|${file.owner}/${file.repo}|${file.filepath}`.toLowerCase();
const chapterKey = (key: string, chapter: number): string => `${key}|${chapter}`;

// ---------------------------------------------------------------- the store on the device

let opening: Promise<IDBDatabase | null> | null = null;

/** The store, or null where there is none (a private window, a test): then nothing is kept and everything is read. */
function store(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const asked = indexedDB.open(DB, 1);
      asked.onupgradeneeded = () => {
        asked.result.createObjectStore(FILES, { keyPath: "key" });
        asked.result.createObjectStore(CHAPTERS, { keyPath: "key" }).createIndex("file", "file");
      };
      asked.onsuccess = () => resolve(asked.result);
      asked.onerror = () => resolve(null);
      asked.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

const settled = <T>(asked: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    asked.onsuccess = () => resolve(asked.result);
    asked.onerror = () => reject(asked.error);
  });
const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

async function keptChapter(key: string): Promise<string | null> {
  const db = await store();
  if (!db) return null;
  const row = await settled<ChapterRow | undefined>(db.transaction(CHAPTERS).objectStore(CHAPTERS).get(key)).catch(() => undefined);
  return row?.usfm ?? null;
}

async function keptFile(key: string): Promise<FileRow | null> {
  const db = await store();
  if (!db) return null;
  return (await settled<FileRow | undefined>(db.transaction(FILES).objectStore(FILES).get(key)).catch(() => undefined)) ?? null;
}

async function dropChapters(tx: IDBTransaction, file: string): Promise<void> {
  const keys = await settled(tx.objectStore(CHAPTERS).index("file").getAllKeys(file));
  for (const key of keys) tx.objectStore(CHAPTERS).delete(key);
}

/** Keep a book, cut by chapter, in place of what was kept of it; and let go of the books opened longest ago. */
async function keep(key: string, parts: UsfmChapters, stamp: string): Promise<void> {
  const db = await store();
  if (!db) return;
  const numbers = Object.keys(parts.chapters).map(Number);
  const now = Date.now();
  const tx = db.transaction([FILES, CHAPTERS], "readwrite");
  await dropChapters(tx, key);
  for (const chapter of numbers) tx.objectStore(CHAPTERS).put({ key: chapterKey(key, chapter), file: key, usfm: chapterUsfm(parts, chapter) ?? "" } satisfies ChapterRow);
  tx.objectStore(FILES).put({ key, stamp, chapters: numbers, savedAt: now, usedAt: now } satisfies FileRow);
  const all = await settled<FileRow[]>(tx.objectStore(FILES).getAll());
  const extra = all.filter((row) => row.key !== key).sort((a, b) => b.usedAt - a.usedAt).slice(KEEP_FILES - 1);
  for (const row of extra) {
    await dropChapters(tx, row.key);
    tx.objectStore(FILES).delete(row.key);
  }
  await finished(tx);
}

async function touch(row: FileRow): Promise<void> {
  const db = await store();
  if (!db) return;
  const tx = db.transaction(FILES, "readwrite");
  tx.objectStore(FILES).put({ ...row, usedAt: Date.now() } satisfies FileRow);
  await finished(tx).catch(() => undefined);
}

// ---------------------------------------------------------------- what Door43 has

const stamps = new Map<string, Promise<Map<string, string> | null>>();

/**
 * The files of a resource as they are now in Door43, each with the hash of its content: one small request tells of
 * every book of the resource whether it changed. Null when it cannot be asked (no network, a server without it).
 */
export function stampsOf(session: GtSession, file: Pick<SourceFile, "owner" | "repo">): Promise<Map<string, string> | null> {
  const key = `${session.host}|${file.owner}/${file.repo}`.toLowerCase();
  let asked = stamps.get(key);
  if (!asked) {
    const config = dcsConfig(session.host);
    const repo = `/repos/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}`;
    type Tree = { tree?: { path?: string; sha?: string }[] };
    const tree = (branch: string) => request<Tree>(config, { path: `${repo}/git/trees/${encodeURIComponent(branch)}`, token: session.token });
    asked = tree("master")
      .catch(async () => tree((await request<{ default_branch?: string }>(config, { path: repo, token: session.token })).default_branch || "main"))
      .then((found) => new Map((found.tree ?? []).flatMap((entry) => (entry.path && entry.sha ? [[entry.path, entry.sha] as const] : []))))
      .catch(() => null);
    stamps.set(key, asked);
  }
  return asked;
}

/** The book as Door43 has it. The raw file is asked first: the contents API sends it in base64, 40% heavier. */
async function download(session: GtSession, file: SourceFile): Promise<string | null> {
  const config = dcsConfig(session.host);
  try {
    const answer = await fetch(`${apiBase(config)}/repos/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}/raw/${file.filepath}`, {
      headers: session.token ? { Authorization: `token ${session.token}` } : {},
    });
    if (answer.ok) {
      const text = await answer.text();
      if (text.trim()) return text;
    }
  } catch {
    /* another way to ask follows */
  }
  try {
    return await getRawContent(config, file.owner, file.repo, file.filepath, { token: session.token });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- reading a chapter

const memory = new Map<string, string>();
const reading = new Map<string, Promise<UsfmChapters | null>>();
const checked = new Set<string>();

function remember(key: string, usfm: string): void {
  memory.delete(key);
  memory.set(key, usfm);
  if (memory.size > KEEP_IN_MEMORY) memory.delete(memory.keys().next().value as string);
}

function forget(key: string): void {
  for (const kept of [...memory.keys()]) if (kept.startsWith(`${key}|`)) memory.delete(kept);
}

/** The whole book, read once however many parts of a screen ask for it at the same moment. */
function readBook(session: GtSession, file: SourceFile, key: string): Promise<UsfmChapters | null> {
  let asked = reading.get(key);
  if (!asked) {
    asked = download(session, file)
      .then((text) => (text ? splitUsfmChapters(text) : null))
      .finally(() => reading.delete(key));
    reading.set(key, asked);
  }
  return asked;
}

/**
 * Whether a kept book is still what Door43 has: asked once per visit, after its chapter was already given. A book
 * that changed is read again and kept, for the next time it is opened. When Door43 cannot say, a day is enough.
 */
async function checkLater(session: GtSession, file: SourceFile, key: string): Promise<void> {
  if (checked.has(key)) return;
  checked.add(key);
  const row = await keptFile(key);
  if (!row) return;
  void touch(row);
  const now = (await stampsOf(session, file))?.get(file.filepath);
  if (now ? now === row.stamp : Date.now() - row.savedAt < DAY) return;
  const parts = await readBook(session, file, key);
  if (!parts) return;
  await keep(key, parts, now ?? "").catch(() => undefined);
  forget(key);
}

/**
 * One chapter of a source text, as a USFM that stands alone (the book's heading and the chapter). From the device
 * when the book is kept there; read from Door43, and kept, when it is not. Null when it cannot be read, or the book
 * has no such chapter.
 */
export async function loadSourceChapter(session: GtSession, file: SourceFile, chapter: number): Promise<string | null> {
  const key = fileKey(session.host, file);
  const wanted = chapterKey(key, chapter);
  const kept = memory.get(wanted) ?? (await keptChapter(wanted));
  if (kept) {
    remember(wanted, kept);
    void checkLater(session, file, key).catch(() => undefined);
    return kept;
  }
  const parts = await readBook(session, file, key);
  if (!parts) return null;
  checked.add(key);
  void stampsOf(session, file)
    .then((now) => keep(key, parts, now?.get(file.filepath) ?? ""))
    .catch(() => undefined);
  // A text with no chapters marked is given whole: there is nothing to cut it by.
  const usfm = Object.keys(parts.chapters).length ? chapterUsfm(parts, chapter) : parts.header;
  if (usfm) remember(wanted, usfm);
  return usfm;
}
