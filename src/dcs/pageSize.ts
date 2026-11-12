import { dcsConfig } from "./config";

/**
 * How many subtareas to ask for in one page. Door43 gives up to 500 (`max_response_items`, read on 12 November 2026)
 * and Taller asked for 50: a book of 1.200 subtareas was 24 pages, each one a search and a check of who may read it on
 * the server. In pages of 500 it is three.
 *
 * Each server says its own limit (`GET /api/v1/settings/api`, no sign-in needed). Asking for more than it gives would
 * be dangerous: a page reads as the last one when it comes shorter than asked, so a server that gave 50 when 500 were
 * asked would seem to have only 50 subtareas. When the limit cannot be read, 50, as always.
 */
export const SAFE_PAGE = 50;
/** No more than this even where the server allows it: one page of 500 already takes Door43 a few seconds. */
export const BIGGEST_PAGE = 500;

const asked = new Map<string, Promise<number>>();

export function pageSizeFor(host: string, fetcher: typeof fetch = (...args) => fetch(...args)): Promise<number> {
  let size = asked.get(host);
  if (!size) {
    size = fetcher(`${dcsConfig(host).host}/api/v1/settings/api`)
      .then((res) => (res.ok ? res.json() : null))
      .then((settings: { max_response_items?: unknown } | null) => {
        const most = Number(settings?.max_response_items);
        return Number.isInteger(most) && most >= SAFE_PAGE ? Math.min(most, BIGGEST_PAGE) : SAFE_PAGE;
      })
      .catch(() => SAFE_PAGE);
    asked.set(host, size);
  }
  return size;
}

/** Forget what each server said (a check starts afresh). */
export function forgetPageSizes(): void {
  asked.clear();
}
