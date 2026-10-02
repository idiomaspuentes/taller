import { getRawContent } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { dcsConfig } from "../dcs/config";
import { bookUsfmName } from "../prep/discover";
import { parseVerseRef, twPathFromRc } from "../prep/inventory";
import { parseTsvTable } from "../prep/tsv";
import {
  tsvRowInPortion,
  tsvRowsToDraftItems,
  type HelpsDraftItem,
} from "./helpsDraft";
import { helpsMarkdownPath, helpsTsvFilename } from "./helpsTarget";
import { DEFAULT_PM_CONFIG, resolveResourceRepo, type PmConfig } from "./roles";
import type { SolverLaunchContext } from "./solverLaunch";
import type { RefRange } from "./usfmEdit";

export type EnglishScriptureKind = "ult" | "ust";

export type EnglishScriptureRef = {
  owner: string;
  repo: string;
  filepath: string;
  label: string;
  short: string;
};

export type ReferenceHelpRow = {
  kind: "nota" | "pregunta" | "palabra";
  id: string;
  ref: string;
  title: string;
  body: string;
  /** TN Quote / TWL OrigWords — used to underline the matching ULT/UST span. */
  quote?: string;
  occurrence?: number;
  chapter?: number;
  verse?: number;
};

export type ReferenceHelpsLoad = {
  items: ReferenceHelpRow[];
  failed: boolean;
};

export type NotesLoadResult = {
  notes: ReferenceHelpRow[];
  /** `gl` = content-org `{lang}_tn`; `en` = unfoldingWord/en_tn fallback; `none` = nothing loaded. */
  source: "gl" | "en" | "none";
  owner: string;
  repo: string;
  filepath: string;
  label: string;
};

/** unfoldingWord English ULT or UST — same book USFM name as the scripture target. */
export function englishScriptureKindRef(
  kind: EnglishScriptureKind,
  book: string,
): EnglishScriptureRef {
  const ust = kind === "ust";
  return {
    owner: "unfoldingWord",
    repo: ust ? "en_ust" : "en_ult",
    filepath: bookUsfmName(book),
    label: ust ? "UST (inglés)" : "ULT (inglés)",
    short: ust ? "UST" : "ULT",
  };
}

/** ULT when drafting TPL; UST when drafting TPS. Helps and unknown stay ULT. */
export function primaryEnglishKind(resource?: string): EnglishScriptureKind {
  return resource?.trim().toLowerCase() === "tps" ? "ust" : "ult";
}

/** The other English source — UST beside TPL, ULT beside TPS. */
export function companionEnglishKind(kind: EnglishScriptureKind): EnglishScriptureKind {
  return kind === "ust" ? "ult" : "ust";
}

/** English ULT for TPL, UST for TPS — same book file as the draft target. */
export function englishScriptureRef(resource: string, book: string): EnglishScriptureRef {
  return englishScriptureKindRef(primaryEnglishKind(resource), book);
}

async function loadUsfmFromRef(
  session: GtSession,
  meta: EnglishScriptureRef,
): Promise<{ usfm: string; meta: EnglishScriptureRef } | null> {
  try {
    const usfm = await getRawContent(
      dcsConfig(session.host),
      meta.owner,
      meta.repo,
      meta.filepath,
      { token: session.token },
    );
    return usfm.trim() ? { usfm, meta } : null;
  } catch {
    return null;
  }
}

export async function loadEnglishScriptureKindUsfm(
  session: GtSession,
  kind: EnglishScriptureKind,
  book: string,
): Promise<{ usfm: string; meta: EnglishScriptureRef } | null> {
  return loadUsfmFromRef(session, englishScriptureKindRef(kind, book));
}

export async function loadEnglishScriptureUsfm(
  session: GtSession,
  resource: string,
  book: string,
): Promise<{ usfm: string; meta: EnglishScriptureRef } | null> {
  return loadUsfmFromRef(session, englishScriptureRef(resource, book));
}

async function loadTsvFromRepo(
  session: GtSession,
  owner: string,
  repo: string,
  filepath: string,
): Promise<Record<string, string>[]> {
  const text = await getRawContent(
    dcsConfig(session.host),
    owner,
    repo,
    filepath,
    { token: session.token },
  );
  return parseTsvTable(text).rows;
}

async function loadEnglishTsv(
  session: GtSession,
  repo: "en_tn" | "en_tq",
  filepath: string,
): Promise<Record<string, string>[]> {
  return loadTsvFromRepo(session, "unfoldingWord", repo, filepath);
}

function normalizeHelpText(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function firstMarkdownHeading(md: string): string {
  const heading = /^#+\s+(.+)$/m.exec(normalizeHelpText(md));
  return heading?.[1]?.trim() || "";
}

export function looksLikeMarkdown(text: string): boolean {
  const normalized = normalizeHelpText(text);
  return /(^|\n)\s*#{1,6}\s/.test(normalized) || /\n\n/.test(normalized) || /^\s*[-*]\s/m.test(normalized);
}

function rowQuote(row: Record<string, string>): string {
  return (row.Quote || row.OrigWords || row.origWords || "").trim();
}

function rowOccurrence(row: Record<string, string>): number {
  const raw = row.Occurrence || row.occurrence || "";
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > 0 ? n : 1;
}

function notesFromTsvRows(
  filepath: string,
  rows: Record<string, string>[],
): ReferenceHelpRow[] {
  return tsvRowsToDraftItems("notas", filepath, rows).map((item, index) => {
    const row = rows[index] ?? {};
    const quote = rowQuote(row);
    const note = normalizeHelpText(item.text).trim();
    const parsed = parseVerseRef(row.Reference || row.reference || item.meta);
    const heading = firstMarkdownHeading(note);
    const title =
      quote && !looksLikeMarkdown(quote)
        ? quote
        : heading || (looksLikeMarkdown(note) ? "" : item.label);
    return {
      kind: "nota" as const,
      id: item.id,
      ref: item.meta,
      title,
      body: note,
      quote,
      occurrence: rowOccurrence(row),
      chapter: parsed?.chapter,
      verse: parsed?.verses[0],
    };
  });
}

async function tryNotesFromRepo(
  session: GtSession,
  owner: string,
  repo: string,
  filepath: string,
  portionCtx: Pick<SolverLaunchContext, "ref" | "chapter">,
): Promise<ReferenceHelpRow[] | null> {
  try {
    const rows = await loadTsvFromRepo(session, owner, repo, filepath);
    const filtered = rows.filter((row) => tsvRowInPortion(row, portionCtx));
    if (!filtered.length) return null;
    return notesFromTsvRows(filepath, filtered);
  } catch {
    return null;
  }
}

/**
 * TN for the verse range: language/content-org `{lang}_tn` when it has rows,
 * otherwise English `unfoldingWord/en_tn`.
 */
export async function loadNotesForRange(
  session: GtSession,
  ctx: Pick<SolverLaunchContext, "ref" | "chapter" | "book" | "lang" | "contentOrg">,
  range: RefRange,
  pmConfig: PmConfig = DEFAULT_PM_CONFIG,
): Promise<NotesLoadResult> {
  const book = (ctx.book || "").toUpperCase();
  const filepath = book ? helpsTsvFilename("notas", book) : "";
  const empty = (source: NotesLoadResult["source"], owner: string, repo: string): NotesLoadResult => ({
    notes: [],
    source,
    owner,
    repo,
    filepath,
    label: filepath ? `Notas · ${owner}/${repo}` : "Notas",
  });
  if (!book || !filepath) return empty("none", "", "");

  const portionCtx = { ref: ctx.ref, chapter: range.chapter };
  const glOwner = (ctx.contentOrg || "").trim();
  const glRepo = resolveResourceRepo("notas", ctx.lang, pmConfig);
  const skipGl =
    !glOwner ||
    !glRepo ||
    (glOwner.toLowerCase() === "unfoldingword" && glRepo === "en_tn");

  if (!skipGl) {
    const glNotes = await tryNotesFromRepo(session, glOwner, glRepo, filepath, portionCtx);
    if (glNotes?.length) {
      return {
        notes: glNotes,
        source: "gl",
        owner: glOwner,
        repo: glRepo,
        filepath,
        label: `Notas · ${glOwner}/${glRepo}`,
      };
    }
  }

  const enNotes = await tryNotesFromRepo(
    session,
    "unfoldingWord",
    "en_tn",
    filepath,
    portionCtx,
  );
  if (enNotes?.length) {
    return {
      notes: enNotes,
      source: "en",
      owner: "unfoldingWord",
      repo: "en_tn",
      filepath,
      label: skipGl
        ? "Notas · unfoldingWord/en_tn"
        : "Notas (inglés) · aún no hay TN en el idioma",
    };
  }

  return empty("none", "unfoldingWord", "en_tn");
}

function toHelpRows(
  kind: "nota" | "pregunta",
  items: HelpsDraftItem[],
): ReferenceHelpRow[] {
  return items.map((item) => {
    const body =
      kind === "pregunta"
        ? (item.secondary || item.text).trim()
        : item.text.trim();
    const parsed = parseVerseRef(item.meta);
    return {
      kind,
      id: item.id,
      ref: item.meta,
      title: looksLikeMarkdown(item.label) ? firstMarkdownHeading(item.label) : item.label,
      body,
      chapter: parsed?.chapter,
      verse: parsed?.verses[0],
    };
  });
}

function wordTitleFromPath(path: string): string {
  const slug = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return slug.replace(/[-_]/g, " ");
}

function splitMarkdownArticle(md: string, fallbackPath: string): { title: string; body: string } {
  const text = md.replace(/\r\n/g, "\n").trim();
  const heading = /^#\s+(.+)$/m.exec(text);
  const title = heading?.[1]?.trim() || wordTitleFromPath(fallbackPath);
  const body = heading
    ? text.slice(heading.index! + heading[0].length).trim()
    : text;
  return { title, body };
}

/** English TQ for the verse range (best-effort). */
export async function loadEnglishQuestionsForRange(
  session: GtSession,
  ctx: Pick<SolverLaunchContext, "ref" | "chapter" | "book">,
  range: RefRange,
): Promise<ReferenceHelpsLoad> {
  const book = (ctx.book || "").toUpperCase();
  if (!book) return { items: [], failed: false };
  const portionCtx = { ref: ctx.ref, chapter: range.chapter };
  try {
    const rows = await loadEnglishTsv(session, "en_tq", helpsTsvFilename("preguntas", book));
    const filtered = rows.filter((row) => tsvRowInPortion(row, portionCtx));
    return {
      items: toHelpRows("pregunta", tsvRowsToDraftItems("preguntas", "", filtered)),
      failed: false,
    };
  } catch {
    return { items: [], failed: true };
  }
}

/** English TWL + TW articles for the verse range (best-effort). */
export async function loadEnglishWordsForRange(
  session: GtSession,
  ctx: Pick<SolverLaunchContext, "ref" | "chapter" | "book">,
  range: RefRange,
): Promise<ReferenceHelpsLoad> {
  const book = (ctx.book || "").toUpperCase();
  if (!book) return { items: [], failed: false };
  const portionCtx = { ref: ctx.ref, chapter: range.chapter };
  let rows: Record<string, string>[];
  try {
    rows = await loadTsvFromRepo(session, "unfoldingWord", "en_twl", `twl_${book}.tsv`);
  } catch {
    return { items: [], failed: true };
  }
  const filtered = rows.filter((row) => tsvRowInPortion(row, portionCtx));
  const links: {
    id: string;
    ref: string;
    path: string;
    quote: string;
    occurrence: number;
    chapter?: number;
    verse?: number;
  }[] = [];
  const articleByPath = new Map<string, Promise<{ title: string; body: string }>>();
  for (const row of filtered) {
    const path = twPathFromRc(row.TWLink || row.twlink || "");
    if (!path) continue;
    const parsed = parseVerseRef(row.Reference || row.reference || "");
    links.push({
      id: row.ID || `${path}-${links.length}`,
      ref: (row.Reference || row.reference || "").trim(),
      path,
      quote: rowQuote(row),
      occurrence: rowOccurrence(row),
      chapter: parsed?.chapter,
      verse: parsed?.verses[0],
    });
  }
  if (!links.length) return { items: [], failed: false };

  const loadArticle = (path: string) => {
    const cached = articleByPath.get(path);
    if (cached) return cached;
    const mdPath = helpsMarkdownPath("palabras", { path });
    const pending = (async () => {
      try {
        const text = await getRawContent(
          dcsConfig(session.host),
          "unfoldingWord",
          "en_tw",
          mdPath,
          { token: session.token },
        );
        return splitMarkdownArticle(text, path);
      } catch {
        return { title: wordTitleFromPath(path), body: "No se pudo cargar el artículo." };
      }
    })();
    articleByPath.set(path, pending);
    return pending;
  };

  const items = await Promise.all(
    links.map(async (link): Promise<ReferenceHelpRow> => {
      const article = await loadArticle(link.path);
      return {
        kind: "palabra",
        id: link.id,
        ref: link.ref,
        title: article.title,
        body: article.body,
        quote: link.quote,
        occurrence: link.occurrence,
        chapter: link.chapter,
        verse: link.verse,
      };
    }),
  );
  return { items, failed: false };
}

/**
 * The introductions a person reads before working on a passage: the note that introduces the book and the one that
 * introduces the chapter (rows `front:intro` and `N:intro` of the notes). Empty text when the notes have none.
 */
export async function loadIntroNotes(
  session: GtSession,
  book: string,
  chapter: number,
  /** The team's own notes, read first: an introduction already translated is the one to study from. */
  own?: { contentOrg?: string; lang?: string; pmConfig?: PmConfig },
): Promise<{ book: string; chapter: string; translated: { book: boolean; chapter: boolean } }> {
  const code = (book || "").toUpperCase();
  if (!code) return { book: "", chapter: "", translated: { book: false, chapter: false } };
  const file = helpsTsvFilename("notas", code);
  const glOwner = (own?.contentOrg || "").trim();
  const glRepo = own?.lang ? resolveResourceRepo("notas", own.lang, own.pmConfig ?? DEFAULT_PM_CONFIG) : "";
  const skipGl = !glOwner || !glRepo || (glOwner.toLowerCase() === "unfoldingword" && glRepo === "en_tn");
  const [mine, english] = await Promise.all([
    skipGl ? Promise.resolve([] as Record<string, string>[]) : loadTsvFromRepo(session, glOwner, glRepo, file).catch(() => [] as Record<string, string>[]),
    loadEnglishTsv(session, "en_tn", file).catch(() => [] as Record<string, string>[]),
  ]);
  const noteAt = (rows: Record<string, string>[], reference: string) => {
    const row = rows.find((r) => (r.Reference || r.reference || "").trim().toLowerCase() === reference);
    return row ? normalizeHelpText(row.Note || row.note || row.OccurrenceNote || "").trim() : "";
  };
  const pick = (reference: string) => {
    const own = noteAt(mine, reference);
    return { text: own || noteAt(english, reference), translated: Boolean(own) };
  };
  const ofBook = pick("front:intro");
  const ofChapter = pick(`${chapter}:intro`);
  return { book: ofBook.text, chapter: ofChapter.text, translated: { book: ofBook.translated, chapter: ofChapter.translated } };
}

/** Compact English TN/TQ for the same verse range (best-effort). */
export async function loadEnglishHelpsForRange(
  session: GtSession,
  ctx: Pick<SolverLaunchContext, "ref" | "chapter" | "book">,
  range: RefRange,
): Promise<ReferenceHelpRow[]> {
  const book = (ctx.book || "").toUpperCase();
  if (!book) return [];
  const portionCtx = { ref: ctx.ref, chapter: range.chapter };
  const [notes, questions] = await Promise.all([
    loadEnglishTsv(session, "en_tn", helpsTsvFilename("notas", book))
      .then((rows) => {
        const filtered = rows.filter((row) => {
          const ref = (row.Reference || row.reference || "").trim();
          if (/:intro$/i.test(ref)) return false;
          return tsvRowInPortion(row, portionCtx);
        });
        return toHelpRows("nota", tsvRowsToDraftItems("notas", "", filtered));
      })
      .catch(() => [] as ReferenceHelpRow[]),
    loadEnglishQuestionsForRange(session, ctx, range).then((loaded) => loaded.items),
  ]);
  return [...notes, ...questions];
}
