import { BOOKS } from "./books";
import { tasksToRedoAfter } from "./processes";
import type { AssignmentsDoc, ProjectTask } from "./types";

/**
 * Changes to the text suggested from outside the organization: by translators who use these resources, or people
 * who study the text with them. Anybody with a Door43 account can open an issue in the public repository of the
 * text; a form there asks for the verse, how it would read and why. Whoever coordinates takes each one to the team
 * that has the text, where it is a proposal like any other, or says why it does not go ahead. The person is
 * answered in their own issue, when it is taken and when it is decided.
 */

/** The label the form puts on what it opens: what tells a suggestion from the other issues of the repository. */
export const SUGGESTION_LABEL = "sugerencia";
/** The label a suggestion gets once it is taken to the team: it leaves the list of those to look at. */
export const TAKEN_LABEL = "en-taller";
/** Where Door43 reads the form from, in the default branch of the repository. */
export const SUGGESTION_TEMPLATE_PATH = ".gitea/ISSUE_TEMPLATE/sugerencia.yaml";

/** The questions of the form, as their headings come in the issue it opens. */
export const SUGGESTION_FIELDS = {
  ref: "¿Qué versículo?",
  text: "¿Cómo quedaría el versículo?",
  why: "¿Por qué?",
} as const;

const yamlText = (text: string) => JSON.stringify(text);

/** The form, written in the repository of a text («TPL», «TPS») so that whoever opens an issue there gets it. */
export function suggestionTemplate(textName: string): string {
  return [
    `name: ${yamlText(`Sugerir un cambio al ${textName}`)}`,
    `about: ${yamlText("Propón otra forma de decir un versículo. El equipo de traducción la estudia y te responde aquí.")}`,
    `title: ${yamlText("Sugerencia: ")}`,
    "labels:",
    `  - ${SUGGESTION_LABEL}`,
    "body:",
    "  - type: markdown",
    "    attributes:",
    `      value: ${yamlText("Gracias por ayudar. Una sugerencia por versículo: el equipo la estudia con el texto original y te responde en esta misma página.")}`,
    "  - type: input",
    "    id: referencia",
    "    attributes:",
    `      label: ${yamlText(SUGGESTION_FIELDS.ref)}`,
    `      description: ${yamlText("Libro, capítulo y versículo.")}`,
    `      placeholder: ${yamlText("Esdras 3:3")}`,
    "    validations:",
    "      required: true",
    "  - type: textarea",
    "    id: propuesta",
    "    attributes:",
    `      label: ${yamlText(SUGGESTION_FIELDS.text)}`,
    `      description: ${yamlText("El versículo entero, como lo propones.")}`,
    "    validations:",
    "      required: true",
    "  - type: textarea",
    "    id: porque",
    "    attributes:",
    `      label: ${yamlText(SUGGESTION_FIELDS.why)}`,
    `      description: ${yamlText("Qué dice el original, qué se entiende mal, o lo que te hizo pensar en el cambio.")}`,
    "    validations:",
    "      required: true",
    "",
  ].join("\n");
}

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * A place as a person writes it: «Esdras 3:3», «esdras 3,3», «Esd 3:3», «EZR 3:3». The name of the book or its code,
 * or the start of the name when only one book starts that way.
 */
export function parseReference(text: string): { book: string; chapter: number; verse: number } | null {
  const at = /^\s*((?:[1-3]\s*)?[^\d\s][^\d]*?)\s*(\d+)\s*[:.,]\s*(\d+)/.exec(plain(text));
  if (!at) return null;
  const name = at[1]!.replace(/\s+/g, " ").replace(/\.$/, "").trim();
  const exact = BOOKS.find((book) => plain(book.name) === name || book.code.toLowerCase() === name.replace(/\s/g, ""));
  const starts = name.length >= 3 ? BOOKS.filter((book) => plain(book.name).startsWith(name)) : [];
  const book = exact ?? (starts.length === 1 ? starts[0] : undefined);
  return book ? { book: book.code, chapter: Number(at[2]), verse: Number(at[3]) } : null;
}

export type OutsideSuggestion = {
  /** Where it came from. */
  owner: string;
  repo: string;
  number: number;
  url: string;
  by: string;
  at: string;
  title: string;
  /** The text it is about («tpl», «tps»), from its repository. */
  resource: string;
  ref: { book: string; chapter: number; verse: number } | null;
  /** The verse as proposed; empty when it could not be read. */
  text: string;
  why: string;
};

/** What a form answer says under each heading; an issue written by hand is read whole as its reason. */
export function readSuggestionBody(body: string, title = ""): Pick<OutsideSuggestion, "ref" | "text" | "why"> {
  const sections = new Map<string, string>();
  const parts = body.replace(/\r/g, "").split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split("\n");
    const value = rest.join("\n").trim();
    sections.set(plain(head ?? ""), /^_no response_$/i.test(value) ? "" : value);
  }
  const field = (heading: string) => sections.get(plain(heading)) ?? "";
  if (!sections.size) {
    return { ref: parseReference(title.replace(/^sugerencia\s*:?\s*/i, "")) ?? parseReference(body), text: "", why: body.trim() };
  }
  return {
    ref: parseReference(field(SUGGESTION_FIELDS.ref)) ?? parseReference(title.replace(/^sugerencia\s*:?\s*/i, "")),
    text: field(SUGGESTION_FIELDS.text).replace(/\s+/g, " ").trim(),
    why: field(SUGGESTION_FIELDS.why),
  };
}

/**
 * The task a suggestion goes to: the one that has the text in its hands, the first of those the process has look at
 * it again when it is corrected (`redoAfter`), as the plan orders them.
 */
export function textHolder(board: Pick<AssignmentsDoc, "teams" | "phases">, resource: string, named: string[] = tasksToRedoAfter(resource)): ProjectTask | undefined {
  const order = new Map(board.phases.map((phase) => [phase.id, phase.order]));
  const wanted = new Set(named);
  return board.teams.filter((task) => wanted.has(task.id)).sort((a, b) => (order.get(a.phaseId) ?? 0) - (order.get(b.phaseId) ?? 0))[0];
}

/** What a decision says of a suggestion from outside: who made it, where, and why. */
export function suggestionNote(s: Pick<OutsideSuggestion, "by" | "repo" | "number" | "url" | "why">): string {
  return [`Sugerencia de ${s.by} desde Door43 (${s.repo}#${s.number}): ${s.url}`, s.why.trim()].filter(Boolean).join("\n\n");
}

/** What the person is told when their suggestion is taken to the team. */
export function takenComment(ref: string): string {
  return `Gracias. Tu sugerencia para ${ref} pasó al equipo de traducción, que la decide con su texto original y las demás traducciones. Te avisamos aquí lo que se decida.`;
}

/** What the person is told when it does not go ahead, with the reason whoever looked at it gave. */
export function refusedComment(reason: string): string {
  return `Gracias por tu sugerencia. No la llevamos al equipo de traducción: ${reason.trim()}`;
}

/** What the person is told when the team has decided. */
export function decidedComment(outcome: string, ref: string, text: string): string {
  if (outcome === "aceptada") return `El equipo aceptó tu sugerencia. ${ref} queda así:\n\n> ${text}\n\nGracias por ayudar.`;
  if (outcome === "caducada") return `El versículo ${ref} cambió mientras el equipo decidía tu sugerencia, y ya no se aplica tal como estaba. Si todavía hace falta, puedes sugerirla de nuevo sobre el texto de ahora.`;
  return `El equipo decidió dejar ${ref} como está. Gracias por tu sugerencia.`;
}
