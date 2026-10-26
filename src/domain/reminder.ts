/**
 * A daily reminder: on a day the person has not opened Taller, at the hour they chose, one notice says how many
 * tasks wait for them. Its reason is the peoples waiting for these resources to translate the Bible into their
 * language, never a streak to keep or a count to beat (Abel, 18 October 2026): no days in a row are counted.
 *
 * The push Worker cannot see anyone's tasks (it holds no Door43 account, and should not). So the app tells it what
 * it knows each time «Mis tareas» is read: how many tasks are the person's to do and how many are free to take, the
 * time zone of the device and the reminder hour. The Worker keeps that, with the day they came in, and on the hour
 * reminds those who have not come in today. What it says is what the app saw last; a task assigned since was
 * already announced by its own notice.
 *
 * Pure: shared by the app and the Worker.
 */

/** What the app tells the Worker each time it has read the person's tasks. */
export type ReminderReport = {
  /** Tasks that are the person's to do now (decide, in progress, to start, reviews). */
  mine: number;
  /** Subtareas free for their team to take. */
  free: number;
  /** The device's time zone (`America/Bogota`): the day and the hour are the person's. */
  tz: string;
  /** The hour of the day to be reminded at, 0–23, and whether to be reminded at all. */
  hour: number;
  on: boolean;
};

/** What the Worker keeps of a person. */
export type ReminderState = ReminderReport & {
  /** The last day (in their zone, `2026-10-18`) they opened the app. */
  seenDay: string;
  /** The last day a reminder was sent: never two in one day. */
  sentDay?: string;
  /** When the app last reported. */
  at: number;
};

export const DEFAULT_REMINDER = { on: true, hour: 19 } as const;

/** Whether a time zone is one the clock knows. */
export function validZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(now: number, tz: string): { day: string; hour: number; weekend: boolean } {
  const zone = validZone(tz) ? tz : "UTC";
  const got = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  return { day: `${got.year}-${got.month}-${got.day}`, hour: Number(got.hour) % 24, weekend: got.weekday === "Sat" || got.weekday === "Sun" };
}

/** Whether it is Saturday or Sunday for the person, in their zone. */
export const weekendIn = (now: number, tz: string): boolean => parts(now, tz).weekend;

/** The day it is for the person (`2026-10-18`), in their zone. */
export const dayIn = (now: number, tz: string): string => parts(now, tz).day;
/** The hour it is for the person, 0–23. */
export const hourIn = (now: number, tz: string): number => parts(now, tz).hour;

/** A report as the Worker accepts it, or null: counts within reason, a known zone, an hour of the day. */
export function cleanReport(raw: unknown): ReminderReport | null {
  const r = raw as Partial<ReminderReport> | null;
  if (!r || typeof r !== "object") return null;
  const count = (n: unknown) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(999, Math.floor(Number(n)))) : NaN);
  const mine = count(r.mine), free = count(r.free), hour = Number(r.hour);
  if (Number.isNaN(mine) || Number.isNaN(free) || !validZone(r.tz) || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { mine, free, tz: r.tz, hour, on: r.on !== false };
}

/** The person opened the app and reported: today is a day they came in. */
export function seen(prev: ReminderState | null, report: ReminderReport, now: number): ReminderState {
  return { ...report, seenDay: dayIn(now, report.tz), ...(prev?.sentDay ? { sentDay: prev.sentDay } : {}), at: now };
}

/**
 * Whether to remind the person now: they want it, it is a weekday and their hour or later that day, they have not
 * come in today nor been reminded today, and something waits for them. Later that day: the round runs every half
 * hour and sends a few notices a run, so whoever did not fit in their hour is reminded in the runs after it.
 * Saturday and Sunday are theirs (Abel, 18 October 2026): no reminder then, whatever waits. A report older than two weeks is not trusted: the counts may be long gone.
 */
export function reminderDue(state: ReminderState, now: number): boolean {
  if (!state.on || state.mine + state.free === 0) return false;
  if (now - state.at > 14 * 24 * 3600 * 1000) return false;
  const { day, hour, weekend } = parts(now, state.tz);
  if (weekend) return false;
  return hour >= state.hour && state.seenDay !== day && state.sentDay !== day;
}
