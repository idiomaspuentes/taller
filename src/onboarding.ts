/**
 * Whether this person put away the old card of first steps (install, notices, tasks). It is gone: the guide says
 * the same, and whoever saw the card is not asked about installing and the notices again (`TasksGuide`).
 */
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
