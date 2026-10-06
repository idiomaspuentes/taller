import { useEffect, useState } from "react";
import { loadSession } from "./dcs/auth";
import { currentShas } from "./dcs/sourceVersions";
import { stampKey, type SourceStamp } from "./domain/sourceVersions";

/**
 * What the noted sources are today in Door43, asked once per visit and shared by every card that shows a step's
 * sources: a board of thirty subtareas of one book asks about its two texts once (see `dcs/sourceVersions`).
 */

const today: Record<string, string | undefined> = {};
const asked = new Set<string>();
const listeners = new Set<() => void>();

/** The hash each noted file has today, by `stampKey`; a file not answered for yet is absent. */
export function useSourcesNow(noted: SourceStamp[]): Record<string, string | undefined> {
  const [, tick] = useState(0);
  const wanted = [...new Set(noted.map(stampKey))].sort().join("|");
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  useEffect(() => {
    const session = loadSession();
    const fresh = noted.filter((stamp) => !asked.has(stampKey(stamp)));
    if (!session?.token || !fresh.length) return;
    fresh.forEach((stamp) => asked.add(stampKey(stamp)));
    void currentShas(session, fresh)
      .then((found) => {
        Object.assign(today, found);
        listeners.forEach((fn) => fn());
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return today;
}
