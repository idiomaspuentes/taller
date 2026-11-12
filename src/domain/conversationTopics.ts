/**
 * The messages of a tuning task gathered by the point they are about (a note of a verse and the words it marks),
 * so that what was said of one point is read together. In the conversation of EZR 4:11–13 the answers to two notes
 * of 4:11, one of 4:12 and one of 4:13 came one after the other by date, and a reply could not be told from the
 * point it answered (12 November).
 *
 * Pure. A message is about a point when the tuning tool wrote it: its place (`**EZR 4:11** — …`) and, at its head,
 * the note and the words. Both ways the tool has written that head are read: on a line of its own since 12 November
 * («Nota «Marcas de cita», en «Esto es…»»), and before it on the same line («Quote Markings · «Esto es…». Tengo una
 * observación: …»). Any other message stays where it is.
 */
import { placedMessage, withoutNamed, type CommentPlace } from "./commentPlace";

export type MessageTopic = {
  /** The name of the note, when it is about a note. */
  title?: string;
  /** The words of the draft it is about. */
  phrase?: string;
  /** What the person said, without the head and without the people named. */
  body: string;
};

// The head on its own line: «Nota «X», en «Y»», «Nota «X»», «En «Y»», and their Portuguese.
const HEAD_NOTE = /^Nota «(.+?)»(?:, (?:en|em) «([\s\S]+?)»)?\s*$/;
const HEAD_WORDS = /^(?:En|Em) «([\s\S]+?)»\s*$/;
// The head before the answer, as it was written until 12 November.
const STANCES = "Tengo una observación|Propongo un cambio|Decisión del equipo|Tenho uma observação|Proponho uma mudança|Decisão da equipe";
const OLD_NOTE_WORDS = new RegExp(`^(.+?) · «([\\s\\S]+?)»\\. (${STANCES}):? ([\\s\\S]*)$`);
const OLD_WORDS = new RegExp(`^«([\\s\\S]+?)»\\. (${STANCES}):? ([\\s\\S]*)$`);
const OLD_NOTE = new RegExp(`^([^.\\n]+?)\\. (${STANCES}):? ([\\s\\S]*)$`);

/** An observation said nothing the words did not; a proposal or a decision is said as such. */
const oldBody = (stance: string, rest: string) => (/observa/i.test(stance) ? rest.trim() : `${stance}: ${rest.trim()}`);

/** The point a message of the tuning tool is about, from what it says after its place; `null` for any other. */
export function topicOf(placedText: string): MessageTopic | null {
  const text = withoutNamed(placedText.trim());
  const [head, ...rest] = text.split(/\n{2,}/);
  const after = rest.join("\n\n").trim();
  if (head && after) {
    const note = HEAD_NOTE.exec(head);
    if (note) return { title: note[1]!.trim(), ...(note[2] ? { phrase: note[2].trim() } : {}), body: after };
    const words = HEAD_WORDS.exec(head);
    if (words) return { phrase: words[1]!.trim(), body: after };
  }
  const both = OLD_NOTE_WORDS.exec(text);
  if (both) return { title: both[1]!.trim(), phrase: both[2]!.trim(), body: oldBody(both[3]!, both[4]!) };
  const words = OLD_WORDS.exec(text);
  if (words) return { phrase: words[1]!.trim(), body: oldBody(words[2]!, words[3]!) };
  const note = OLD_NOTE.exec(text);
  if (note) return { title: note[1]!.trim(), body: oldBody(note[2]!, note[3]!) };
  return null;
}

/**
 * Whether what was said is only an agreement with somebody before («Estoy de acuerdo con @ana.», «De acuerdo con
 * ustedes»): the card says it in one line, with whoever else agreed.
 */
export function isAgreement(body: string): boolean {
  return /^(?:estoy |estou )?(?:totalmente )?(?:de acuerdo|de acordo)(?: (?:con|com) (?:@[\w-]+(?:,? (?:y |e )?@[\w-]+)*|ustedes|vocês|todos|todas))?\.?$/i.test(body.trim());
}

type Item = { key: string; text: string; createdAt?: string; kind?: string };

export type TopicEntry<T> = { item: T; body: string; agree: boolean };

export type TopicRow<T> =
  | { kind: "item"; item: T }
  | { kind: "topic"; key: string; ref: string; place: CommentPlace; title?: string; phrase?: string; entries: TopicEntry<T>[] };

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The timeline with the messages of each point gathered in one card, which stands where its latest message is: a
 * reply to an old point comes down to the end, where the conversation is read, and is not lost above. A message
 * about a verse without a point of its own («la decisión se cerró») joins the latest point of that verse said before
 * it. What is about no point stays as it was, in its place.
 */
export function groupTopics<T extends Item>(items: T[]): TopicRow<T>[] {
  type Topic = Extract<TopicRow<T>, { kind: "topic" }> & { last: number };
  const topics = new Map<string, Topic>();
  const byRef = new Map<string, Topic>();
  const loose: Array<{ at: number; item: T }> = [];
  items.forEach((item, at) => {
    const placed = item.kind === "humano" ? placedMessage(item.text) : null;
    const topic = placed ? topicOf(placed.text) : null;
    if (placed && topic) {
      const key = `${placed.ref}|${norm(topic.title)}|${norm(topic.phrase)}`;
      let row = topics.get(key);
      if (!row) {
        row = { kind: "topic", key: `topic:${item.key}`, ref: placed.ref, place: placed.place, ...(topic.title ? { title: topic.title } : {}), ...(topic.phrase ? { phrase: topic.phrase } : {}), entries: [], last: at };
        topics.set(key, row);
      }
      row.entries.push({ item, body: topic.body, agree: isAgreement(topic.body) });
      row.last = at;
      byRef.set(placed.ref, row);
      return;
    }
    const joins = placed ? byRef.get(placed.ref) : undefined;
    if (placed && joins) {
      joins.entries.push({ item, body: withoutNamed(placed.text), agree: false });
      joins.last = at;
      return;
    }
    loose.push({ at, item });
  });
  if (!topics.size) return items.map((item) => ({ kind: "item", item }));
  const rows: Array<{ at: number; row: TopicRow<T> }> = [
    ...loose.map(({ at, item }) => ({ at, row: { kind: "item", item } as TopicRow<T> })),
    ...[...topics.values()].map(({ last, ...row }) => ({ at: last, row: row as TopicRow<T> })),
  ];
  return rows.sort((a, b) => a.at - b.at).map(({ row }) => row);
}
