/**
 * Things kept in this device that are too big for `localStorage`: the subtareas of each book and the list «Mis
 * tareas» showed last. One book of 1.200 subtareas is about 2,5 million characters, and `localStorage` holds about 5 MB
 * in Safari (two bytes a character): a second book did not fit, the write failed without a word, and every start read
 * every book whole again (9 November 2026). IndexedDB has no such limit.
 *
 * Where there is no IndexedDB (a private window, a test), nothing is kept: every read gives nothing back, and the app
 * reads from Door43 as it would the first time.
 */
export type DeviceStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

const DB = "taller-kept";
const KV = "kv";

let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const asked = indexedDB.open(DB, 1);
      asked.onupgradeneeded = () => asked.result.createObjectStore(KV);
      asked.onsuccess = () => resolve(asked.result);
      asked.onerror = () => resolve(null);
      asked.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, act: (kv: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return database().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const asked = act(db.transaction(KV, mode).objectStore(KV));
          asked.onsuccess = () => resolve(asked.result as T);
          asked.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** The device's store. A failed write is not an error: next time that thing is read from Door43 again. */
export const deviceStore: DeviceStore = {
  get: <T>(key: string) => run<T>("readonly", (kv) => kv.get(key)),
  set: (key, value) => run<void>("readwrite", (kv) => kv.put(value, key)).then(() => undefined),
  delete: (key) => run<void>("readwrite", (kv) => kv.delete(key)).then(() => undefined),
};

/** A store in memory, for tests: values are copied in and out, as IndexedDB does. */
export function memoryStore(): DeviceStore & { keys(): string[] } {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (map.has(key) ? (structuredClone(map.get(key)) as T) : undefined),
    set: async (key, value) => void map.set(key, structuredClone(value)),
    delete: async (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}
