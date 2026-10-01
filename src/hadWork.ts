import { useEffect, useState } from "react";
import { scopeKey } from "./domain/scope";

/**
 * Whether this person has ever had work on this device: it tells "you are all caught up" apart from
 * "nothing has reached you yet", which deserve different words.
 */
export const hadWorkKey = (host: string, username: string, pmOrg: string, scope: string = scopeKey()) =>
  `taller-had-work:${host.replace(/\/$/, "")}:${username.toLowerCase()}:${pmOrg.toLowerCase()}:${scope || "-"}`;

type Store = Pick<Storage, "getItem" | "setItem">;

export function hadWork(key: string, store?: Store): boolean {
  try {
    return (store ?? localStorage).getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markHadWork(key: string, store?: Store): void {
  try {
    (store ?? localStorage).setItem(key, "1");
  } catch {
    /* blocked storage: it is learned again next time */
  }
}

/** True once work has been seen; `seenWork` is whether the current screen has any. */
export function useHadWork(key: string, loaded: boolean, seenWork: boolean): boolean {
  const [had, setHad] = useState(() => hadWork(key));
  useEffect(() => setHad(hadWork(key)), [key]);
  useEffect(() => {
    if (loaded && seenWork && !had) {
      markHadWork(key);
      setHad(true);
    }
  }, [key, loaded, seenWork, had]);
  return had;
}
