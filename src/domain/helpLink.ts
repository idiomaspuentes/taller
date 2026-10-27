/**
 * A short link to one help of a checklist, to send to the team (27 October). The link a tool opens on carries the
 * whole launch context, with the login of whoever opened it, and no help: sent on WhatsApp it was long, and it left
 * the person on the list. This one names the subtarea, the step and the help; the app builds the rest for whoever
 * opens it (see `resolveHelpLink`).
 */
export type HelpLink = { org: string; project: string; issue: number; step: string; item: string };

const SLUG = /^[\w.-]+$/;
/** An id of a help, or of a verse's stop («verse:1:19»). */
const ITEM = /^[\w.-]+(:[\w.:-]+)?$/;

export function helpLinkHash(link: HelpLink): string {
  return `#/n/${[link.org, link.project, String(link.issue), link.step, link.item].map((part) => encodeURIComponent(part).replace(/%3A/gi, ":")).join("/")}`;
}

/** The parts after `n/`, already decoded; `null` for anything that is not such a link. */
export function parseHelpLink(parts: string[]): HelpLink | null {
  if (parts.length !== 5) return null;
  const [org, project, issueRaw, step, item] = parts as [string, string, string, string, string];
  const issue = Number(issueRaw);
  if (!/^\d+$/.test(issueRaw) || !issue) return null;
  if (![org, project, step].every((part) => SLUG.test(part)) || !ITEM.test(item)) return null;
  return { org, project, issue, step, item };
}
