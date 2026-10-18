/**
 * The daily reminder (see `src/domain/reminder.ts`): what each person's app last reported, kept one key per person,
 * and the round that reminds those whose hour it is and who have not come in today.
 *
 * The free plan allows 50 calls to other services in one run of the Worker (each KV read or write, each notice sent)
 * and 10 ms of processor. A round that went through the whole team at 19:00 in one run would be cut off past about
 * ten people, and those left at the end not reminded that day. So:
 * - what the round needs to know of each person travels as the key's metadata, and the list of keys alone says who
 *   is due: nobody is read to find out;
 * - each notice is encrypted and signed, about 3 ms of processor (measured on 18 October 2026): a run sends three at
 *   most, counted by device, not by person;
 * - the round runs every two minutes (wrangler.toml), thirty runs an hour: thirty people with two devices each (one a
 *   run), ninety with one, at the same hour. Those left wait for the next run, still within their hour.
 *
 * Costs on the free plan: one write each time the app reports something new (a new day, other counts, another
 * hour); 720 lists of the keys a day (of 1 000); per reminder, one read and one write, and one notice per device.
 */
import { reminderNotice } from "../../src/domain/noticeText";
import { dayIn, reminderDue, seen, type ReminderReport, type ReminderState } from "../../src/domain/reminder";
import type { Notice } from "./webhook";

export const reminderKey = (host: string, login: string) => `r:${host}:${login.toLowerCase()}`;

/** What is kept: the state, and whose it is (a key cannot be split back: a host has colons of its own). */
export type Kept = ReminderState & { host: string; login: string };

/** Notices sent in one run, at most (one per device): what 10 ms of processor allows. */
export const NOTICES_PER_RUN = 3;
/** Calls to other services one run allows itself, of the 50 the free plan gives it: some room is left over. */
export const CALL_BUDGET = 40;

async function read(kv: KVNamespace, key: string): Promise<Kept | null> {
  try {
    return JSON.parse((await kv.get(key)) ?? "null") as Kept | null;
  } catch {
    return null;
  }
}

/** Kept twice: as the value, and as the key's metadata the round reads in the list (well under its 1 024 bytes). */
async function keep(kv: KVNamespace, key: string, kept: Kept): Promise<void> {
  await kv.put(key, JSON.stringify(kept), { metadata: kept });
}

/** The app reported: the person came in today. Returns their state as it is now. */
export async function reportSeen(kv: KVNamespace, host: string, login: string, report: ReminderReport, now: number): Promise<ReminderState> {
  const key = reminderKey(host, login);
  const prev = await read(kv, key);
  const state = seen(prev, report, now);
  await keep(kv, key, { ...state, host, login });
  return state;
}

/** The notice of a person's reminder: it opens «Mis tareas», and a new one takes the place of yesterday's. */
export function reminderOf(kept: Kept, appUrl: string): Notice {
  const words = (lang: "es" | "pt") => reminderNotice({ mine: kept.mine, free: kept.free }, lang);
  return { login: kept.login, url: `${appUrl}/#/mis-tareas`, tag: "recordatorio", words, ...words("es") };
}

/** A person's devices, as the round sees them: how many, and how to tell them (what that took besides sending). */
export type Reach = { devices: number; send: (notice: Notice) => Promise<{ sent: number; calls: number }> };

export type RoundResult = { due: number; reminded: number; forgotten: number; calls: number; left: number };

/**
 * One run of the round: the people due, from the list of keys, reminded until `NOTICES_PER_RUN` notices or the budget
 * of calls is reached; the rest are counted as `left` for the next run. Someone with more devices than that is still
 * reminded when they are the first of the run, so nobody waits for ever. Someone with no device left (they turned
 * the notices off everywhere) is forgotten, so the round does not look at them again.
 */
export async function remindDue(kv: KVNamespace, now: number, appUrl: string, reach: (host: string, login: string) => Promise<Reach>): Promise<RoundResult> {
  const result: RoundResult = { due: 0, reminded: 0, forgotten: 0, calls: 0, left: 0 };
  let notices = 0;
  let cursor: string | undefined;
  do {
    const page = await kv.list<Kept>({ prefix: "r:", cursor });
    result.calls++;
    for (const { name, metadata } of page.keys) {
      // A key kept before its state travelled as metadata is read once, and kept with it from then on.
      let kept: Kept | null | undefined = metadata;
      if (!kept) {
        if (result.calls + 1 > CALL_BUDGET) continue;
        kept = await read(kv, name);
        result.calls++;
      }
      if (!kept || !reminderDue(kept, now)) continue;
      result.due++;
      // One reminder costs a read of the devices, a notice per device and a write.
      if (notices >= NOTICES_PER_RUN || result.calls + 4 > CALL_BUDGET) {
        result.left++;
        continue;
      }
      const to = await reach(kept.host, kept.login);
      result.calls++;
      if (to.devices === 0) {
        await kv.delete(name);
        result.calls++;
        result.forgotten++;
        continue;
      }
      if (notices > 0 && notices + to.devices > NOTICES_PER_RUN) {
        result.left++;
        continue;
      }
      const done = await to.send(reminderOf(kept, appUrl));
      notices += to.devices;
      result.calls += to.devices + done.calls;
      if (done.sent > 0) result.reminded++;
      // Marked even when no device took it: a device that failed is not asked again every run of the hour.
      await keep(kv, name, { ...kept, sentDay: dayIn(now, kept.tz) });
      result.calls++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && result.calls < CALL_BUDGET);
  return result;
}
