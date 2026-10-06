/**
 * The texts of the helps in hand that are worked piece by piece (see `articleBlocks`): each is read as the source has
 * it, in grey, until it is translated, and written in a box that opens empty under its source. An article is one
 * text, and so is a note; a question is two, the question and its answer.
 *
 * A note or a question used to be a box already holding its source: the team's table starts as a copy of the
 * source's, so translating one began with clearing a paragraph in another language, a letter at a time on a phone,
 * and nothing said which were still to do. Pure: `HelpsEditorView` shows the texts.
 */
import { articleRows, rowsPossible, translatedWords, vocabularyOf } from "./articleBlocks";
import { noteFromTsv } from "./helpMarkup";
import type { HelpsDraftItem } from "./helpsDraft";

export type HelpText = {
  /** Its name among the pieces of the screen: the id of its help, or that of the answer of a question. */
  id: string;
  item: HelpsDraftItem;
  /** Which text of the help it is: a question has its answer too. */
  field: "text" | "secondary";
  /** As the source package has it, its line breaks real. */
  source: string;
  /** As the team has it, its line breaks real. */
  value: string;
};

export const answerTextId = (itemId: string): string => `${itemId}~r`;

type SourceOf = Record<string, { text: string; secondary?: string } | undefined>;

/**
 * The texts worked by pieces, as they follow one another on the screen. A help with no source, or whose text would
 * not come back the same from its pieces, is left out: it is edited whole, in a box. So is an article while whoever
 * translates it has asked to see it whole (`articlesWhole`). An answer goes by pieces only with its question.
 */
export function helpTexts(items: HelpsDraftItem[], sources: SourceOf, opts: { articlesWhole?: boolean } = {}): HelpText[] {
  const out: HelpText[] = [];
  const add = (id: string, item: HelpsDraftItem, field: HelpText["field"], source: string, value: string): boolean => {
    if (!source.trim() || !rowsPossible(source, value)) return false;
    out.push({ id, item, field, source, value });
    return true;
  };
  for (const item of items) {
    const from = sources[item.id];
    if (item.kind === "markdown") {
      if (!opts.articlesWhole) add(item.id, item, "text", from?.text ?? "", item.text);
      continue;
    }
    // A table file keeps the line breaks of a text written out.
    const asked = add(item.id, item, "text", noteFromTsv(from?.text ?? ""), noteFromTsv(item.text));
    if (asked && item.secondary !== undefined) add(answerTextId(item.id), item, "secondary", noteFromTsv(from?.secondary ?? ""), noteFromTsv(item.secondary));
  }
  return out;
}

/**
 * The words the team's own translated sentences use, over all the texts of a screen: what tells a word both
 * languages write alike from one left in the source language (see `writtenAlike`). Taken from them all because a
 * text may be a single piece (the title of an Academy article is a file of its own, an answer is a word): what
 * shows the word to be the team's is then in the text beside it.
 */
export function knownWords(texts: Pick<HelpText, "source" | "value">[]): Set<string> {
  const known = new Set<string>();
  for (const text of texts) {
    const rows = articleRows(text.source, text.value);
    if (rows) for (const word of translatedWords(rows, vocabularyOf(text.source))) known.add(word);
  }
  return known;
}

type Count = { done: number; total: number };

/**
 * How much there is to translate and how much is left, in what whoever translates counts by: the paragraphs of an
 * article (`piece`), or the notes and the questions of a passage (`help`). A question with only its answer left is
 * one question left, and an introduction of many paragraphs is one note.
 */
export function helpsLeft(texts: Pick<HelpText, "id" | "item">[], counts: Record<string, Count | undefined>, by: "piece" | "help"): { left: number; total: number } {
  const of = (id: string) => counts[id] ?? { done: 0, total: 0 };
  if (by === "piece") return texts.reduce((sum, text) => ({ left: sum.left + of(text.id).total - of(text.id).done, total: sum.total + of(text.id).total }), { left: 0, total: 0 });
  const helps = new Map<string, Count>();
  for (const text of texts) {
    const was = helps.get(text.item.id) ?? { done: 0, total: 0 };
    helps.set(text.item.id, { done: was.done + of(text.id).done, total: was.total + of(text.id).total });
  }
  const counted = [...helps.values()].filter((help) => help.total > 0);
  return { left: counted.filter((help) => help.done < help.total).length, total: counted.length };
}
