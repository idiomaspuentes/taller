import { useCallback, useState } from "react";

/** Whether this person has already put away the first-steps card. Kept per person and server on this device. */
export const onboardingKey = (host: string, username: string) => `taller-onboarding-done:${host.replace(/\/$/, "")}:${username.toLowerCase()}`;

type Store = Pick<Storage, "getItem" | "setItem">;

export function onboardingDone(key: string, store?: Store): boolean {
  try {
    return (store ?? localStorage).getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingDone(key: string, store?: Store): void {
  try {
    (store ?? localStorage).setItem(key, "1");
  } catch {
    /* blocked storage: it shows again next time */
  }
}

/** Show the first-steps card until the person hides it. */
export function useOnboarding(session: { host: string; username: string } | null) {
  const key = session ? onboardingKey(session.host, session.username) : "";
  const [done, setDone] = useState(() => (key ? onboardingDone(key) : true));
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    // Another person signed in on this device.
    setLastKey(key);
    setDone(key ? onboardingDone(key) : true);
  }
  const hide = useCallback(() => {
    if (key) markOnboardingDone(key);
    setDone(true);
  }, [key]);
  return { visible: Boolean(session) && !done, hide };
}
