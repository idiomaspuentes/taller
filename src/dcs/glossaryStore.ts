import { createOrUpdateContents, DcsApiError } from "@ip-lms/dcs-client";
import type { AlignmentGroup } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { groupDraftBranches, readRaw } from "./afinacionLoad";
import { readRepoFile } from "./afinacionStore";
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { dcsConfig } from "./config";
import { closePull, createPull, ensureBranchFrom, getDefaultBranch, getPullByBranches, listOpenPulls, mergePull } from "./pulls";
import { ensureContentRepo } from "./repoFile";
import { bookUsfmName } from "../prep/discover";
import {
  changeNeedsAgreement,
  GLOSSARY_FILES,
  glossaryFileFor,
  parseGlossary,
  serializeGlossary,
  upsertGlossaryEntry,
  type GlossaryEntry,
  type GlossaryFile,
} from "../domain/glossary";
import { defaultScriptureRepo } from "../domain/scriptureTarget";
import { DEFAULT_SOURCE_PACKAGE, type SourcePackage } from "../domain/sourcePackage";
import { tryParseUsjWithAlignments, verseFromSid, verseTextsFromUsj } from "../domain/usfmAst";

/**
 * The glossary lives beside the other resources of the language, in `<lang>_tg` of the content organization: it is
 * content, not management. A new entry or a change to a proposal is a commit; a change to what a team agreed is a
 * pull request, where the team that maintains it approves it.
 */

export const glossaryRepoName = (lang: string): string => `${lang.trim().toLowerCase().replace(/_gl$/, "") || "es-419"}_tg`;

export type Glossary = {
  owner: string;
  repo: string;
  /** False when the repository does not exist yet: it is created with the first entry. */
  exists: boolean;
  entries: GlossaryEntry[];
};

const isMissing = (err: unknown): boolean => err instanceof DcsApiError && err.status === 404;
const isConflict = (err: unknown): boolean => err instanceof DcsApiError && (err.status === 409 || err.status === 422);

export async function loadGlossary(session: GtSession, owner: string, lang: string): Promise<Glossary> {
  const repo = glossaryRepoName(lang);
  const config = dcsConfig(session.host);
  let branch: string;
  try {
    branch = await getDefaultBranch(config, owner, repo, session.token);
  } catch (err) {
    if (isMissing(err)) return { owner, repo, exists: false, entries: [] };
    throw err;
  }
  const files = await Promise.all(GLOSSARY_FILES.map((file) => readRepoFile(session, { owner, repo, branch }, file).catch(() => null)));
  return { owner, repo, exists: true, entries: files.flatMap((file) => (file ? parseGlossary(file.text) : [])) };
}

const MANIFEST = (lang: string) => `dublin_core:
  conformsto: 'rc0.2'
  format: 'text/tsv'
  identifier: 'tg'
  language:
    identifier: '${lang}'
  subject: 'TSV Translation Glossary'
  title: 'Glosario de traducción'
  type: 'help'
  rights: 'CC BY-SA 4.0'
projects:
  - { identifier: 'grc', path: './tg_grc.tsv', title: 'Griego' }
  - { identifier: 'hbo', path: './tg_hbo.tsv', title: 'Hebreo y arameo' }
  - { identifier: 'en', path: './tg_en.tsv', title: 'Inglés, sin lema todavía' }
`;

/** Entries of one file as they are now on a branch, with the file's version. */
async function readFile(session: GtSession, owner: string, repo: string, branch: string, file: GlossaryFile) {
  const hit = await readRepoFile(session, { owner, repo, branch }, file);
  return { entries: hit ? parseGlossary(hit.text) : [], sha: hit?.sha };
}

// Writes to the glossary go one after another: two entries saved in a row must not race for the same file.
let turn: Promise<unknown> = Promise.resolve();

export type GlossarySaveResult = { status: "saved" } | { status: "proposed"; pullUrl: string };

/**
 * Save an entry. A new one, or a change to a proposal, is written at once. A change to an agreed entry becomes a
 * proposal for the team: a branch with the change and a pull request.
 */
export function saveGlossaryEntry(params: { session: GtSession; owner: string; lang: string; entry: GlossaryEntry; before?: GlossaryEntry; reason?: string }): Promise<GlossarySaveResult> {
  const next = turn.catch(() => undefined).then(() => saveNow(params));
  turn = next;
  return next;
}

async function saveNow(params: { session: GtSession; owner: string; lang: string; entry: GlossaryEntry; before?: GlossaryEntry; reason?: string }): Promise<GlossarySaveResult> {
  const { session, owner, entry } = params;
  const repo = glossaryRepoName(params.lang);
  const config = dcsConfig(session.host);
  const { created } = await ensureContentRepo(session, owner, repo);
  const base = await getDefaultBranch(config, owner, repo, session.token);
  if (created) {
    await createOrUpdateContents(config, owner, repo, "manifest.yaml", { content: MANIFEST(params.lang), message: "Taller: glosario de traducción", branch: base, token: session.token }).catch(() => undefined);
  }
  const file = glossaryFileFor(entry.strong);
  const moved = params.before && glossaryFileFor(params.before.strong) !== file ? glossaryFileFor(params.before.strong) : null;
  const propose = changeNeedsAgreement(params.before, entry);
  let branch = base;
  if (propose) {
    branch = `glosario/${entry.id}-${session.username.toLowerCase()}`;
    await ensureBranchFrom(config, owner, repo, branch, session.token, base);
  }
  const message = `Glosario: ${params.before ? "cambiar" : "agregar"} «${entry.lemma}» → ${entry.rendering || "—"}${params.reason ? ` · ${params.reason}` : ""}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const current = await readFile(session, owner, repo, branch, file);
    try {
      await createOrUpdateContents(config, owner, repo, file, { content: serializeGlossary(upsertGlossaryEntry(current.entries, entry)), message, sha: current.sha, branch, token: session.token });
      break;
    } catch (err) {
      if (!isConflict(err) || attempt === 4) throw err;
    }
  }
  if (moved) {
    // The entry was tied to another word of the original: it leaves the file it was in.
    const old = await readFile(session, owner, repo, branch, moved);
    if (old.sha) await createOrUpdateContents(config, owner, repo, moved, { content: serializeGlossary(old.entries.filter((e) => e.id !== entry.id)), message, sha: old.sha, branch, token: session.token });
  }
  if (!propose) return { status: "saved" };
  const pull = (await getPullByBranches(config, owner, repo, base, branch, session.token)) ?? (await createPull(config, owner, repo, { title: message, body: params.reason || "Cambio a una decisión acordada, propuesto desde Taller.", head: branch, base, token: session.token }));
  return { status: "proposed", pullUrl: pull.html_url };
}

// ---------------------------------------------------------------- changes proposed to agreed entries

export type GlossaryChange = {
  /** The pull request that carries the change. */
  number: number;
  url: string;
  by: string;
  /** The entry as the team agreed it, and as the proposal leaves it. */
  before: GlossaryEntry;
  after: GlossaryEntry;
};

/** Changes to agreed entries that wait for the team: the open pull requests made from this screen. */
export async function loadGlossaryChanges(session: GtSession, glossary: Glossary): Promise<GlossaryChange[]> {
  if (!glossary.exists) return [];
  const config = dcsConfig(session.host);
  const pulls = await listOpenPulls(config, glossary.owner, glossary.repo, session.token).catch(() => []);
  const out: GlossaryChange[] = [];
  for (const pull of pulls) {
    const head = pull.head?.ref ?? "";
    const id = /^glosario\/([a-z0-9]+)-/.exec(head)?.[1];
    const before = id ? glossary.entries.find((entry) => entry.id === id) : undefined;
    if (!id || !before) continue;
    const files = await Promise.all(GLOSSARY_FILES.map((file) => readRepoFile(session, { owner: glossary.owner, repo: glossary.repo, branch: head }, file).catch(() => null)));
    const after = files.flatMap((file) => (file ? parseGlossary(file.text) : [])).find((entry) => entry.id === id);
    if (after) out.push({ number: pull.number, url: pull.html_url, by: pull.user?.login ?? "", before, after });
  }
  return out;
}

/** The team settles a proposed change: it becomes the agreed entry, or it is dropped. */
export async function settleGlossaryChange(session: GtSession, glossary: Glossary, change: GlossaryChange, accept: boolean): Promise<void> {
  const config = dcsConfig(session.host);
  if (accept) await mergePull(config, glossary.owner, glossary.repo, change.number, session.token, `Glosario: «${change.after.lemma}» → ${change.after.rendering}`);
  else await closePull(config, glossary.owner, glossary.repo, change.number, session.token);
}

// ---------------------------------------------------------------- the passage a glossary is opened from

export type PassageVerse = {
  ref: string;
  verse: number;
  /** The English verse, word by word, as it reads. */
  words: { text: string; occurrence: number }[];
  groups: AlignmentGroup[];
};

export type PassageContext = {
  book: string;
  chapter: number;
  verses: PassageVerse[];
  /** The team's aligned literal text of the whole book, by verse reference: how each word was translated before. */
  teamVerses: Record<string, AlignmentGroup[]>;
};

/**
 * What a passage needs to show its glossary: the aligned English text (to tap a word and reach the original under
 * it) and the team's aligned text of the book (to see how each word was translated before).
 */
export async function loadPassageContext(params: { session: GtSession; owner: string; lang: string; book: string; chapter: number; from: number; to: number; pkg?: SourcePackage }): Promise<PassageContext> {
  const { session, chapter } = params;
  const book = params.book.toUpperCase();
  const pkg = params.pkg ?? DEFAULT_SOURCE_PACKAGE;
  const range = { chapter, from: params.from, to: params.to };
  const english = await readRaw(session, pkg.owner, pkg.ult, bookUsfmName(book));
  const parsed = english ? tryParseUsjWithAlignments(english) : null;
  const texts = (parsed && verseTextsFromUsj(parsed.usj, range)) || {};
  const verses: PassageVerse[] = Object.keys(texts).map(Number).sort((a, b) => a - b).map((verse) => {
    const key = parsed ? Object.keys(parsed.alignments).find((sid) => verseFromSid(sid, chapter) === verse) : undefined;
    const seen = new Map<string, number>();
    const words = (texts[verse] ?? "").split(/\s+/).filter(Boolean).map((text) => {
      const plain = text.replace(/[^\p{L}\p{N}\p{M}]/gu, "").toLowerCase();
      const occurrence = (seen.get(plain) ?? 0) + 1;
      seen.set(plain, occurrence);
      return { text, occurrence };
    });
    return { ref: `${book} ${chapter}:${verse}`, verse, words, groups: key ? parsed!.alignments[key]! : [] };
  });

  const teamVerses: Record<string, AlignmentGroup[]> = {};
  const repo = defaultScriptureRepo("tpl", params.lang);
  if (repo) {
    const found = await tryReadExistingBookUsfm({ session, owner: params.owner, repo, filepath: bookUsfmName(book), branches: [...groupDraftBranches(book, "tpl"), undefined] }).catch(() => null);
    const team = found ? tryParseUsjWithAlignments(found.text) : null;
    for (const [sid, groups] of Object.entries(team?.alignments ?? {})) {
      const match = /(\d+):(\d+)/.exec(sid);
      if (match) teamVerses[`${book} ${match[1]}:${match[2]}`] = groups;
    }
  }
  return { book, chapter, verses, teamVerses };
}
