/**
 * Port of idiomas-puentes-docs/scripts/fcr_prep/chunks.py.
 * Turn USFM events into chapter-scoped porciones.
 *
 * A porción is the verses between one \ts (or \ts\* / \ts-s) and the next,
 * never crossing a chapter boundary unless the USFM itself has no \c break.
 * Books or chapters without \ts fall back to the whole chapter as one porción.
 */

import { Portion, type PortionSource } from "./models";
import type { UsfmEvent } from "./parseUsfm";

function unique(verses: number[]): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const verse of verses) {
    if (!seen.has(verse)) {
      seen.add(verse);
      ordered.push(verse);
    }
  }
  return ordered;
}

function flush(
  book: string,
  chapter: number,
  index: number,
  verses: number[],
  source: PortionSource,
  tsSid: string,
  portions: Portion[],
): number {
  const ordered = unique(verses);
  if (chapter <= 0 || !ordered.length) return index;
  portions.push(new Portion({ book, chapter, index, verses: ordered, source, tsSid }));
  return index + 1;
}

/** Where the portions of a chapter start, by chapter: the verses whoever prepares the book chose instead of the source's own cuts. */
export type PortionStarts = Record<number, number[]>;

/**
 * The portions of the chapters named in `starts`, cut again at those verses. The verses of a chapter stay the same
 * and in the same order; only where one portion ends and the next begins changes. Other chapters are left alone.
 */
export function regroupPortions(portions: Portion[], starts: PortionStarts | undefined): Portion[] {
  if (!starts || !Object.keys(starts).length) return portions;
  const out: Portion[] = [];
  const done = new Set<number>();
  for (const portion of portions) {
    const cuts = starts[portion.chapter];
    if (!cuts?.length) {
      out.push(portion);
      continue;
    }
    if (done.has(portion.chapter)) continue;
    done.add(portion.chapter);
    const own = portions.filter((row) => row.chapter === portion.chapter);
    const verses = own.flatMap((row) => row.verses);
    const at = new Set(cuts);
    let group: number[] = [];
    let index = 1;
    const close = () => {
      if (!group.length) return;
      out.push(new Portion({ book: portion.book, chapter: portion.chapter, index, verses: group, source: own[0]!.source, tsSid: "" }));
      index += 1;
      group = [];
    };
    for (const verse of verses) {
      if (at.has(verse)) close();
      group.push(verse);
    }
    close();
  }
  return out;
}

export function splitPortions(
  book: string,
  events: UsfmEvent[],
  options: { chapterFilter?: number | null; starts?: PortionStarts } = {},
): { portions: Portion[]; warnings: string[] } {
  const chapterFilter = options.chapterFilter ?? null;
  const portions: Portion[] = [];
  let warnings: string[] = [];

  let chapter = 0;
  let index = 1;
  let verses: number[] = [];
  let source: PortionSource = "capitulo_sin_ts";
  let tsSid = "";
  let tsInChapter = false;
  let lastWasTs = false;
  let sawAnyTs = false;

  function warnIfChapterLackedTs(closedChapter: number): void {
    if (closedChapter > 0 && !tsInChapter) {
      warnings.push(
        `${book} ${closedChapter}: no hay marcadores \\ts; ` +
          "se usa el capítulo entero como una porción.",
      );
    }
  }

  for (const event of events) {
    if (event.kind === "ts") {
      sawAnyTs = true;
      lastWasTs = true;
      if (verses.length) {
        index = flush(book, chapter, index, verses, source, tsSid, portions);
        verses = [];
      }
      source = "ts";
      tsSid = event.tsSid;
      if (chapter > 0) tsInChapter = true;
      continue;
    }

    if (event.kind === "chapter") {
      if (verses.length) {
        index = flush(book, chapter, index, verses, source, tsSid, portions);
        verses = [];
      }
      if (event.chapter !== chapter) {
        warnIfChapterLackedTs(chapter);
        chapter = event.chapter;
        index = 1;
        // \ts immediately before \c belongs to the new chapter (ULT).
        tsInChapter = lastWasTs;
        if (!lastWasTs) {
          source = "capitulo_sin_ts";
          tsSid = "";
        }
      }
      lastWasTs = false;
      continue;
    }

    if (event.kind === "verse") {
      lastWasTs = false;
      if (event.chapter && event.chapter !== chapter) {
        if (verses.length) {
          index = flush(book, chapter, index, verses, source, tsSid, portions);
          verses = [];
        }
        warnIfChapterLackedTs(chapter);
        chapter = event.chapter;
        index = 1;
      }
      verses.push(...event.verses);
    }
  }

  if (verses.length) {
    flush(book, chapter, index, verses, source, tsSid, portions);
  }
  warnIfChapterLackedTs(chapter);

  if (!sawAnyTs) {
    warnings.push(`${book}: el archivo ULT no tiene \\ts / \\ts\\*; cada capítulo queda como una sola porción.`);
  }

  // Verses before the first \ts in a chapter that later has \ts
  // are a prefix portion, not a "whole chapter without \ts".
  const byChapter = new Map<number, Portion[]>();
  for (const portion of portions) {
    const list = byChapter.get(portion.chapter) ?? [];
    list.push(portion);
    byChapter.set(portion.chapter, list);
  }
  for (const group of byChapter.values()) {
    if (group.some((p) => p.source === "ts")) {
      for (const portion of group) {
        if (portion.source === "capitulo_sin_ts") portion.source = "antes_del_ts";
      }
    }
  }

  let finalPortions = regroupPortions(portions, options.starts);
  if (chapterFilter !== null) {
    finalPortions = finalPortions.filter((p) => p.chapter === chapterFilter);
    const prefix = `${book} ${chapterFilter}:`;
    warnings = warnings.filter(
      (w) => w.startsWith(prefix) || (w.startsWith(`${book}:`) && w.includes("no tiene")),
    );
    if (!finalPortions.length) {
      warnings.push(`No hay porciones en el capítulo ${chapterFilter}.`);
    }
  }

  return { portions: finalPortions, warnings };
}
