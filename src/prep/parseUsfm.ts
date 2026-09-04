/**
 * Port of idiomas-puentes-docs/scripts/fcr_prep/parse_usfm.py.
 * Parse ULT USFM: chapters, verses, and translator-section (\ts) markers.
 */

export type UsfmEventKind = "ts" | "chapter" | "verse";

export type UsfmEvent = {
  kind: UsfmEventKind;
  chapter: number;
  verses: number[];
  raw: string;
  textPreview: string;
  tsSid: string;
  offset: number;
};

const ID_RE = /\\id\s+([A-Z0-9]{2,3})\b/i;
// Global marker matcher: \name[-suffix][*]
const MARKER_RE = /\\([A-Za-z][A-Za-z0-9]*)(-[A-Za-z0-9]+)?(\*)?/g;

function stripAlignment(text: string): string {
  let out = text;
  out = out.replace(/\\zaln-s\s+\|[^\\]*\*/g, "");
  out = out.replace(/\\zaln-e\*/g, "");
  out = out.replace(/\\w\s+([^\\|]+)\|[^\\]*\\w\*/g, "$1");
  out = out.replace(/\\w\s+([^\\*]+)\\w\*/g, "$1");
  out = out.replace(/\\[a-zA-Z0-9-]+\*?/g, " ");
  out = out.replace(/\s+/g, " ");
  return out.trim().replace(/^[ ,;.]+|[ ,;.]+$/g, "");
}

function tsSid(raw: string): string {
  const match = raw.match(/sid=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

function expandVerse(start: string, end: string | null): number[] {
  const first = parseInt(start, 10);
  let last = end ? parseInt(end, 10) : first;
  if (last < first) last = first;
  const out: number[] = [];
  for (let n = first; n <= last; n++) out.push(n);
  return out;
}

export function detectBookCode(usfm: string, fallback = ""): string {
  const match = usfm.match(ID_RE);
  if (match) return match[1].toUpperCase();
  return fallback.toUpperCase();
}

export function parseUsfmEvents(usfm: string): UsfmEvent[] {
  const events: UsfmEvent[] = [];
  let currentChapter = 0;

  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(usfm)) !== null) {
    const name = match[1].toLowerCase();
    const suffix = match[2] || "";
    const full = name + suffix;
    const start = match.index;

    if (name === "ts") {
      const rawEnd = start + 80;
      const raw = usfm.slice(start, rawEnd).split("\n", 1)[0];
      events.push({
        kind: "ts",
        chapter: currentChapter,
        verses: [],
        raw: raw.trim(),
        textPreview: "",
        tsSid: tsSid(raw),
        offset: start,
      });
      continue;
    }

    if (full === "c") {
      const rest = usfm.slice(MARKER_RE.lastIndex, MARKER_RE.lastIndex + 12);
      const num = rest.match(/^\s+(\d+)/);
      if (!num) continue;
      currentChapter = parseInt(num[1], 10);
      events.push({
        kind: "chapter",
        chapter: currentChapter,
        verses: [],
        raw: "",
        textPreview: "",
        tsSid: "",
        offset: start,
      });
      continue;
    }

    if (full === "v") {
      const rest = usfm.slice(MARKER_RE.lastIndex, MARKER_RE.lastIndex + 20);
      const verseMatch = rest.match(/^\s+(\d+)(?:-(\d+))?([a-z])?/i);
      if (!verseMatch) continue;
      const numbers = expandVerse(verseMatch[1], verseMatch[2] ?? null);
      const chunk = usfm.slice(start, start + 400);
      const nextBreakSource = chunk.slice(2);
      const nextBreak = nextBreakSource.match(/\\(v|c|ts)\b/);
      const excerpt = nextBreak
        ? chunk.slice(0, (nextBreak.index ?? 0) + 2)
        : chunk;
      events.push({
        kind: "verse",
        chapter: currentChapter,
        verses: numbers,
        raw: verseMatch[0].trim(),
        textPreview: stripAlignment(excerpt).slice(0, 160),
        tsSid: "",
        offset: start,
      });
    }
  }

  return events;
}
