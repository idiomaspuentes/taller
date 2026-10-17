/**
 * Every page of a listing, asked a few at a time. One after another, the 210 open subtareas of Esdras took five
 * round trips of 0.7 s each before «Mis tareas» could show anything (17 October). The first page goes alone, since
 * most listings fit in it; when it comes full the next ones are asked together, a window at a time, and nothing past
 * the first page that comes short is kept.
 */
export async function allPages<T>(fetchPage: (page: number) => Promise<T[]>, opts: { limit: number; maxPages: number; window?: number }): Promise<T[]> {
  const { limit, maxPages } = opts;
  const window = Math.max(1, opts.window ?? 4);
  const first = await fetchPage(1);
  const out = [...first];
  if (first.length < limit) return out;
  for (let start = 2; start <= maxPages; start += window) {
    const pages = Array.from({ length: Math.min(window, maxPages - start + 1) }, (_, i) => start + i);
    const batches = await Promise.all(pages.map((page) => fetchPage(page)));
    for (const batch of batches) {
      out.push(...batch);
      if (batch.length < limit) return out;
    }
  }
  return out;
}
