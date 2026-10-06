import { useEffect, useState } from "react";
import type { GtSession } from "./dcs/auth";
import { loadGlossary } from "./dcs/glossaryStore";
import { upsertGlossaryEntry, type GlossaryEntry } from "./domain/glossary";

/**
 * The glossary of a language, read once and shared by every place that says its decisions beside the work: the
 * verse being written, the verse being reviewed, the comment a decision is made from. It is read again when the
 * person comes back to the app: the glossary's own screen opens in another tab, and what was decided there has to be
 * here on return.
 */

const entries = new Map<string, GlossaryEntry[]>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

type Where = { session: GtSession; owner: string; lang: string };
const keyOf = (where: Where): string => `${where.session.host}|${where.owner.toLowerCase()}|${where.lang.toLowerCase()}`;

function read(where: Where): void {
  const key = keyOf(where);
  if (loading.has(key)) return;
  loading.add(key);
  void loadGlossary(where.session, where.owner, where.lang)
    .then((glossary) => {
      entries.set(key, glossary.entries);
      changed();
    })
    .catch(() => undefined)
    .finally(() => loading.delete(key));
}

/** The entries of the glossary of a language; none while they are being read, or when nobody is signed in. */
export function useGlossaryEntries(session: GtSession | null | undefined, owner: string | undefined, lang: string | undefined): GlossaryEntry[] {
  const [, tick] = useState(0);
  const token = session?.token;
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  useEffect(() => {
    if (!session || !owner || !lang) return;
    const where = { session, owner, lang };
    if (!entries.has(keyOf(where))) read(where);
    const back = () => document.visibilityState === "visible" && read(where);
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [token, session?.host, owner, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  return session && owner && lang ? (entries.get(keyOf({ session, owner, lang })) ?? []) : [];
}

/** An entry was saved from this tab: every place that shows the glossary has it at once. */
export function glossaryEntrySaved(session: GtSession, owner: string, lang: string, entry: GlossaryEntry): void {
  const key = keyOf({ session, owner, lang });
  const known = entries.get(key);
  // Not read yet: the place that asks for it first reads it whole. Kept as this one entry it would pass for the glossary.
  if (!known) return;
  entries.set(key, upsertGlossaryEntry(known, entry));
  changed();
}
