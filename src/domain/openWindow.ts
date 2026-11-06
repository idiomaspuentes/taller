/**
 * How long an agreed item stays open for the rest of the step. Reaching the minimum protects the decision, but it
 * should not leave out whoever comes an hour later to give their view: the item stays open `hours` from the answer
 * that made it agreed, unless everybody seated on the step already answered it or the team's final decision settled
 * it. Pure, and knows no process: the hours come from the step (`openHours`), the time from whoever looks.
 */

export type OpenWindow = {
  /** Hours an agreed item stays open, from the step's `openHours`. */
  hours: number;
  /** Logins seated on the step; empty means not known, and then the whole window is waited. */
  seated: string[];
  /** Time of whoever looks, in milliseconds. */
  now: number;
};

const HOUR = 3_600_000;
const login = (who: string) => who.trim().toLowerCase();

/** The window of a step, or `undefined` when the step keeps nothing open (no `openHours`, or 0). */
export function openWindowFor(step: { openHours?: number } | undefined, seated: string[], now: number): OpenWindow | undefined {
  const hours = step?.openHours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) return undefined;
  return { hours, seated, now };
}

/**
 * Until when an agreed item stays open, as an ISO time; `undefined` when it is closed: the window ran out, the team's
 * final decision settled it, or there is nobody left to wait for.
 */
export function openUntilOf(p: { agreedAt?: string; window?: OpenWindow; answered: string[]; decided?: boolean }): string | undefined {
  if (!p.agreedAt || !p.window || p.decided) return undefined;
  const until = Date.parse(p.agreedAt) + p.window.hours * HOUR;
  if (!Number.isFinite(until) || until <= p.window.now) return undefined;
  const seated = p.window.seated.map(login).filter(Boolean);
  if (seated.length) {
    const answered = new Set(p.answered.map(login));
    if (seated.every((who) => answered.has(who))) return undefined;
  }
  return new Date(until).toISOString();
}

/** The latest of some times (ISO), as given; `undefined` when there is none. */
export function latestOf(dates: (string | undefined)[]): string | undefined {
  let latest: string | undefined;
  for (const date of dates) {
    if (date === undefined || !Number.isFinite(Date.parse(date))) continue;
    if (latest === undefined || Date.parse(date) > Date.parse(latest)) latest = date;
  }
  return latest;
}

/**
 * A time said as a day and an hour in the language of the interface: `{day}` and `{time}` in `pattern`. The day is
 * short, «el jueves 12 a las 10:00»: it is never more than a few days ahead, and the month made it a long line.
 */
export function sayOpenDate(iso: string, language: string, pattern: string): string {
  const date = new Date(iso);
  const long = date.toLocaleDateString(language, { weekday: "long", day: "numeric" });
  // Spanish reads «lunes 9», without the comma Intl puts after the weekday («lunes, 9»).
  const day = language.toLowerCase().startsWith("es") ? long.replace(/^(\p{L}+),\s*/u, "$1 ") : long;
  const time = date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  return pattern.replace(/\{day\}/g, day).replace(/\{time\}/g, time);
}
