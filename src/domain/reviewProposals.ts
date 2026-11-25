/**
 * A reviewer's proposal of other words for a piece of a draft (a verse, a row of a help, a paragraph), kept as data.
 *
 * It is written on the review like any comment: the place and a visible sentence first, so Door43 and older versions
 * of the app read it as a normal comment, and after a blank line a marker of its own with what was proposed. The
 * marker is `<!-- taller-proposal BASE64URL(JSON) -->`. It never starts with `tas:` or `gateway-`: those are read as
 * messages of the app and would vanish from the conversation. Pure.
 *
 * Every text here is in the form of the author's editor box (what she sees and types), so that what was proposed and
 * what her box says can be compared.
 */
import { refComment } from "./commentPlace";
import { decodeBase64Url, encodeBase64Url } from "./markerCodec";

/** A text in the form of an editor box; `secondary` is the second box of a piece (the answer of a question). */
export type PieceText = { text: string; secondary?: string };
export type Proposal = {
  /** How the piece stood when the proposal was written. */
  over: PieceText;
  /** What is proposed. */
  words: PieceText;
  why?: string;
};

export const PROPOSAL_SCHEMA = "taller-proposal-1";

const MARKER = /<!--\s*taller-proposal\s+([A-Za-z0-9_-]+)\s*-->/;
const MARKER_ALL = /<!--\s*taller-proposal\s+[A-Za-z0-9_-]+\s*-->/g;

function piece(value: unknown): PieceText | null {
  if (!value || typeof value !== "object") return null;
  const { text, secondary } = value as { text?: unknown; secondary?: unknown };
  if (typeof text !== "string" || (secondary !== undefined && typeof secondary !== "string")) return null;
  return secondary !== undefined ? { text, secondary } : { text };
}

/**
 * The whole body of the comment that proposes `proposal` for the piece at `ref`. `visible` is the sentence that is
 * read («Propongo: «…»»), already in the language of the screen.
 */
export function formatProposal(book: string, ref: string, proposal: Proposal, visible: string): string {
  const why = proposal.why?.trim();
  const data = { schema: PROPOSAL_SCHEMA, ref, over: proposal.over, words: proposal.words, ...(why ? { why } : {}) };
  const marker = `<!-- taller-proposal ${encodeBase64Url(JSON.stringify(data))} -->`;
  return `${refComment(book, ref, visible)}${why ? `\n${why}` : ""}\n\n${marker}`;
}

/** The proposal a comment body carries, with the place it is about; `null` when it carries none (or it is unreadable). */
export function parseProposal(body: string): (Proposal & { ref: string }) | null {
  const encoded = MARKER.exec(body ?? "")?.[1];
  if (!encoded) return null;
  try {
    const data = JSON.parse(decodeBase64Url(encoded)) as { schema?: unknown; ref?: unknown; over?: unknown; words?: unknown; why?: unknown };
    const over = piece(data.over);
    const words = piece(data.words);
    if (data.schema !== PROPOSAL_SCHEMA || typeof data.ref !== "string" || !over || !words) return null;
    const why = typeof data.why === "string" && data.why.trim() ? data.why : undefined;
    return { ref: data.ref, over, words, ...(why ? { why } : {}) };
  } catch {
    return null;
  }
}

/** A comment's words without the marker of a proposal. */
export function withoutProposalMarker(text: string): string {
  return text.replace(MARKER_ALL, "").trim();
}

const QUOTES = /[«»“”‘’"']/g;
const flat = (text: string) => text.replace(QUOTES, "").replace(/\s+/g, "");

/** Whether two texts say the same words: white space and quotation marks (« » “ ” ‘ ’ " ') do not count. */
export function sameWords(a: string, b: string): boolean {
  return flat(a) === flat(b);
}

export function samePiece(a: PieceText, b: PieceText): boolean {
  return sameWords(a.text, b.text) && sameWords(a.secondary ?? "", b.secondary ?? "");
}

/** Whether the piece, as it stands now, says what was proposed. A piece that is no longer there uses nothing. */
export function proposalUsed(proposal: Proposal, now: PieceText | undefined): boolean {
  return Boolean(now) && samePiece(proposal.words, now!);
}

const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** Whether the piece has the same number of lines as the proposal in each part: only then can it be used whole. */
export function sameShape(proposal: Proposal, now: PieceText): boolean {
  return (
    lines(proposal.words.text).length === lines(now.text).length &&
    lines(proposal.words.secondary ?? "").length === lines(now.secondary ?? "").length
  );
}
