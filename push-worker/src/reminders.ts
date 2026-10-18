/**
 * The daily reminder (see `src/domain/reminder.ts`): what each person's app last reported, kept one key per person,
 * and the hourly round that reminds those whose hour it is and who have not come in today.
 *
 * Costs on the free plan: one write each time the app reports something new (a new day, other counts, another
 * hour), one list of the keys an hour (24 of the 1 000 a day) and one read per person; a write only when a
 * reminder goes out.
 */
import { reminderNotice } from "../../src/domain/noticeText";
import { dayIn, reminderDue, seen, type ReminderReport, type ReminderState } from "../../src/domain/reminder";
import type { Notice } from "./webhook";

export const reminderKey = (host: string, login: string) => `r:${host}:${login.toLowerCase()}`;

/** What is kept: the state, and whose it is (a key cannot be split back: a host has colons of its own). */
type Kept = ReminderState & { host: string; login: string };

async function read(kv: KVNamespace, key: string): Promise<Kept | null> {
  try {
    return JSON.parse((await kv.get(key)) ?? "null") as Kept | null;
  } catch {
    return null;
  }
}

/** The app reported: the person came in today. Returns their state as it is now. */
export async function reportSeen(kv: KVNamespace, host: string, login: string, report: ReminderReport, now: number): Promise<ReminderState> {
  const key = reminderKey(host, login);
  const prev = await read(kv, key);
  const state = seen(prev, report, now);
  await kv.put(key, JSON.stringify({ ...state, host, login }));
  return state;
}

/** The notice of a person's reminder: it opens «Mis tareas», and a new one takes the place of yesterday's. */
export function reminderOf(kept: Kept, appUrl: string): Notice {
  const words = (lang: "es" | "pt") => reminderNotice({ mine: kept.mine, free: kept.free }, lang);
  return { login: kept.login, url: `${appUrl}/#/mis-tareas`, tag: "recordatorio", words, ...words("es") };
}

/**
 * The hourly round: every person whose reminder is due is told on each of their devices. Someone with no device
 * left (they turned the notices off everywhere) is forgotten, so the round does not read them again.
 */
export async function remindDue(
  kv: KVNamespace,
  now: number,
  appUrl: string,
  send: (notice: Notice, host: string) => Promise<number>,
  hasDevices: (host: string, login: string) => Promise<boolean>,
): Promise<{ looked: number; reminded: number }> {
  let cursor: string | undefined;
  let looked = 0, reminded = 0;
  do {
    const page = await kv.list({ prefix: "r:", cursor });
    for (const { name } of page.keys) {
      const kept = await read(kv, name);
      looked++;
      if (!kept || !reminderDue(kept, now)) continue;
      if (!(await hasDevices(kept.host, kept.login))) {
        await kv.delete(name);
        continue;
      }
      if ((await send(reminderOf(kept, appUrl), kept.host)) > 0) reminded++;
      // Marked even when no device took it: a device that failed is not asked again every hour of the day.
      await kv.put(name, JSON.stringify({ ...kept, sentDay: dayIn(now, kept.tz) }));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { looked, reminded };
}
