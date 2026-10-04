import { tallerConfig } from "../../taller.config";
import es from "../i18n/locales/es.json";
import pt from "../i18n/locales/pt.json";
import { BOOKS, bookLabel } from "./books";
import { parseChatEvent } from "./chatEvent";
import { localizeThread } from "./threadNames";

/**
 * What a notice says, wherever it is shown: on a lock screen with the app closed (the push Worker), in a browser
 * notification with the app in another tab, and in the list of «Avisos». One place names a subtarea and words each
 * kind of notice, in the language of whoever reads it, so the same subtarea is not called three different things.
 *
 * It depends only on data (the texts of the interface, the books, the process packages): the push Worker, which is
 * built apart from the app, imports this file as it is.
 */

export type NoticeLang = "es" | "pt";

export function noticeLang(value: unknown): NoticeLang {
  return value === "pt" ? "pt" : "es";
}

const TEXT: Record<NoticeLang, Record<string, string>> = { es, pt };

/** A text of the interface in a given language (not the one the app is showing), with its `{markers}` filled. */
export function say(lang: NoticeLang, key: string, vars: Record<string, string | number> = {}): string {
  let out = TEXT[lang][key] ?? TEXT.es[key] ?? key;
  for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
  return out;
}

type Named = { name?: string; names?: Partial<Record<string, string>> };

/** The names a process gives its phases, tasks and steps, from the longest: «Revisar la alineación» before «Alinear». */
function processNames(lang: NoticeLang): [string, string][] {
  const pairs = new Map<string, string>();
  for (const pack of tallerConfig.processes) {
    for (const [from, to] of Object.entries(pack.glossary?.[lang] ?? {})) pairs.set(from, String(to));
    for (const workflow of (pack.workflows ?? []) as { phases?: Named[]; tasks?: (Named & { steps?: Named[] })[] }[]) {
      for (const row of [...(workflow.phases ?? []), ...(workflow.tasks ?? []), ...(workflow.tasks ?? []).flatMap((task) => task.steps ?? [])]) {
        if (row.name && row.names?.[lang]) pairs.set(row.name, row.names[lang]!);
      }
    }
  }
  return [...pairs].sort((a, b) => b[0].length - a[0].length);
}

const NAMES: Partial<Record<NoticeLang, [string, string][]>> = {};

/** The name of a phase, a task or a step, written in Spanish in a subtarea, in the reader's language. */
export function processName(text: string, lang: NoticeLang): string {
  if (lang === "es" || !text) return text;
  const pairs = (NAMES[lang] ??= processNames(lang));
  const exact = pairs.find(([from]) => from === text);
  if (exact) return exact[1];
  let out = text;
  for (const [from, to] of pairs) if (out.includes(from)) out = out.split(from).join(to);
  return out;
}

export type NoticeIssue = {
  number?: number;
  title?: string;
  body?: string | null;
  milestone?: { title?: string } | null;
  labels?: { name?: string }[];
};

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const CODES = new Set(BOOKS.map((book) => book.code));

/**
 * A subtarea as a notice names it, for somebody reading with several books under way: «3 Juan 1:5–8 · Alinear TPL ·
 * Afinación». Its title alone («3JN 1:5–8 · TPL») gives the book as a code and does not say what is to be done; the
 * subtarea carries both: the book in its milestone and labels, the task and the phase in its body.
 */
export function subtaskName(issue: NoticeIssue, lang: NoticeLang = "es"): string {
  const title = (issue.title ?? "").trim();
  const code = [issue.milestone?.title, issue.labels?.find((l) => l.name?.startsWith("pm/libro:"))?.name?.slice("pm/libro:".length), /^([A-Z0-9]{3})\s/i.exec(title)?.[1]]
    .map((c) => (c ?? "").toUpperCase())
    .find((c) => CODES.has(c));
  const field = (label: string) => new RegExp(`^- ${label}: \\*\\*(.+?)\\*\\*`, "m").exec(issue.body ?? "")?.[1]?.trim() ?? "";
  const task = field("Tarea");
  const phase = field("Fase");
  // The title without the book's code; and without the resource at its end when the task's name already says it.
  let rest = code ? title.replace(new RegExp(`^${code}\\s+`, "i"), "") : title;
  const tail = / · ([^·]+)$/.exec(rest)?.[1];
  if (tail && task && task.toLowerCase().includes(tail.toLowerCase())) rest = rest.slice(0, -(tail.length + 3));
  // A subtarea named after its task («Leer la carta completa en voz alta») is not told twice.
  // «3 Juan 1:5–8» reads as one reference; a subtarea that is not a passage is set apart from its book.
  const place = [code ? bookLabel(code, lang) : "", processName(rest, lang)].filter(Boolean).join(/^\d/.test(rest) ? " " : " · ");
  const parts = [place, task && !rest.toLowerCase().includes(task.toLowerCase()) ? processName(task, lang) : "", processName(phase, lang)];
  return shorten(parts.filter(Boolean).join(" · ") || say(lang, "nt.subtask", { n: issue.number ?? "?" }), 90);
}

/** The part of a comment people read: no quotes, no hidden marks, one line. */
export function readableLine(body: string, max = 140): string {
  const first =
    body
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith(">")) ?? "";
  return shorten(first, max);
}

export type NoticeWords = { title: string; body: string; grouped?: string };

/**
 * A comment on a subtarea, as a notice. What a person wrote is told as theirs («ana: …»). What the app wrote for
 * somebody (a delivery, a closing, a step) is news about the subtarea, in the reader's language and without a name
 * in front, since nobody «said» it. A card that asks for a decision says so.
 */
export function commentNotice(params: { issue: NoticeIssue; body: string; author: string; mentioned: boolean; name?: string }, lang: NoticeLang): NoticeWords {
  const name = params.name ?? subtaskName(params.issue, lang);
  const grouped = say(lang, "nt.grouped", { name });
  const event = parseChatEvent(params.body);
  if (event?.decision && event.decision.state !== "resuelta") {
    return { title: say(lang, "nt.decisionTitle"), body: `${name} · ${shorten(localizeThread(event.summary, lang), 120)}`, grouped };
  }
  if (event) {
    return { title: say(lang, params.mentioned ? "nt.mentionTitle" : "nt.eventTitle", { name }), body: shorten(localizeThread(event.summary, lang), 140), grouped };
  }
  return {
    title: say(lang, params.mentioned ? "nt.mentionTitle" : "nt.commentTitle", { name }),
    body: `${params.author || say(lang, "nt.someone")}: ${readableLine(params.body)}`.trim(),
    grouped,
  };
}

/** The kinds of notice the app asks the Worker to send, because Door43 does not announce them by itself. */
export type AskedKind = "free" | "your-turn" | "step-turn" | "step-free" | "decision";

/** `step`: the name of the step, for the kinds about one. `count`: several subtareas told at once. */
export function askedNotice(kind: AskedKind, params: { name: string; step?: string; count?: number }, lang: NoticeLang): NoticeWords {
  const step = processName(params.step ?? "", lang);
  switch (kind) {
    case "free":
      return (params.count ?? 1) > 1
        ? { title: say(lang, "nt.freeMany", { n: params.count! }), body: params.name, grouped: say(lang, "nt.freeGrouped") }
        : { title: say(lang, "nt.freeTitle"), body: params.name, grouped: say(lang, "nt.freeGrouped") };
    case "your-turn":
      return { title: say(lang, "nt.turnTitle"), body: params.name, grouped: say(lang, "nt.turnGrouped") };
    case "step-turn":
      return { title: say(lang, "nt.stepTurnTitle", { step }), body: params.name };
    case "step-free":
      return { title: say(lang, "nt.stepFreeTitle", { step }), body: params.name };
    case "decision":
      return { title: say(lang, "nt.decisionTitle"), body: params.name };
  }
}
