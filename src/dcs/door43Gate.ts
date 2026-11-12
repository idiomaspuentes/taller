/**
 * How many requests go to Door43 at the same time. Door43 speaks HTTP/2, so the browser puts no limit of its own: on
 * 6 November 2026, opening «Mis tareas» with Nehemías sent 77 requests at once, and Door43, answering one page in
 * under a second when asked alone, took up to 27 s for each. Here they wait their turn, a few at a time, and a write
 * (taking a subtarea, saving, «Terminé») goes before the lists waiting, so it never stands behind 25 pages of a book.
 */

/** Requests to Door43 at the same time. */
export const DOOR43_AT_ONCE = 6;

export type Gate = { run<T>(method: string, task: () => Promise<T>): Promise<T> };

const isWrite = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

export function createGate(max: number): Gate {
  let running = 0;
  const waiting: { write: boolean; go: () => void }[] = [];
  const next = () => {
    if (running >= max || !waiting.length) return;
    const at = waiting.findIndex((w) => w.write);
    const [turn] = waiting.splice(at >= 0 ? at : 0, 1);
    running++;
    turn!.go();
  };
  return {
    run<T>(method: string, task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({
          write: isWrite(method),
          go: () => {
            task().then(resolve, reject).finally(() => {
              running--;
              next();
            });
          },
        });
        next();
      });
    },
  };
}

/** Writes to Door43 finished since the page opened: what was read before one of them may no longer be so. */
let writes = 0;
export const door43Writes = (): number => writes;

const isDoor43 = (url: string): boolean => {
  try {
    const { hostname: host, pathname } = new URL(url);
    // The mock Door43 (scripts/mock-door43) too: without it, a write made there did not cut short what was read
    // before, and the tests against the mock saw a list older than the app would (12 November 2026).
    const mock = (host === "localhost" || host === "127.0.0.1") && pathname.startsWith("/api/v1/");
    return mock || host === "door43.org" || host.endsWith(".door43.org");
  } catch {
    return false;
  }
};

/** `fetch` with the requests to Door43 passed through the gate; anything else goes straight through. */
export function gatedFetch(inner: typeof fetch, gate: Gate): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isDoor43(url)) return inner(input, init);
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    return gate.run(method, () => inner(input, init)).finally(() => {
      if (isWrite(method)) writes++;
    });
  }) as typeof fetch;
}

let installed = false;
/** Puts the gate in front of every request of the page. Once. */
export function installDoor43Gate(max: number = DOOR43_AT_ONCE): void {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  globalThis.fetch = gatedFetch(globalThis.fetch.bind(globalThis), createGate(max));
}
