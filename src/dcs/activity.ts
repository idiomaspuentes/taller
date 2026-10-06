import { useEffect, useState } from "react";
import { request } from "@ip-lms/dcs-client";
import type { HeatSlot } from "../domain/activity";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";

/**
 * When each person worked, as Door43 counts it (see `domain/activity`): one small answer per person (some 3 KB for
 * a year of work), asked once per visit however many screens show it.
 */

const asked = new Map<string, Promise<HeatSlot[]>>();

export function loadHeatmap(session: GtSession, login: string): Promise<HeatSlot[]> {
  const key = `${session.host}|${login}`.toLowerCase();
  let found = asked.get(key);
  if (!found) {
    found = request<HeatSlot[]>(dcsConfig(session.host), { path: `/users/${encodeURIComponent(login)}/heatmap`, token: session.token }).then((rows) => (Array.isArray(rows) ? rows : []));
    // Not kept when it failed: the next screen asks again.
    found.catch(() => asked.delete(key));
    asked.set(key, found);
  }
  return found;
}

/** The stretches of each person, by login in lower case. Absent while it is being read; `null` when it could not be. */
export function useHeatmaps(session: GtSession | null | undefined, logins: string[]): Record<string, HeatSlot[] | null | undefined> {
  const [found, setFound] = useState<Record<string, HeatSlot[] | null>>({});
  const wanted = [...new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean))].sort().join("|");
  useEffect(() => {
    if (!session?.token || !wanted) return;
    let live = true;
    for (const login of wanted.split("|")) {
      loadHeatmap(session, login)
        .then((slots) => live && setFound((prev) => ({ ...prev, [login]: slots })))
        .catch(() => live && setFound((prev) => ({ ...prev, [login]: null })));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, session?.host, wanted]);
  return found;
}
