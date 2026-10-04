/**
 * The template this person last started a book with, kept on their device: it is the one offered first next time.
 * The list of templates puts the organization's saved ones first, so without this an old saved template kept being
 * offered for every new book.
 */
const KEY = "taller-last-template";

export function lastTemplateUsed(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberTemplateUsed(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(KEY, id);
  } catch {
    /* blocked storage: the first of the list is offered next time */
  }
}

/** The template to offer first: the last one used when it is still there, else the first of the list. */
export function usualTemplate(templates: { id: string }[]): string {
  const last = lastTemplateUsed();
  return (templates.some((template) => template.id === last) ? last : "") || templates[0]?.id || "";
}
