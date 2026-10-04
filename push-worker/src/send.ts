import { buildPushPayload, type PushMessage } from "@block65/webcrypto-web-push";
import type { FetchFn } from "./env";
import { noticeLang, say } from "../../src/domain/noticeText";
import type { Notice } from "./webhook";
import type { StoredSubscription } from "./store";

export type Vapid = { subject: string; publicKey: string; privateKey: string };

/** The result of sending one push: `gone` means the device unsubscribed and must be forgotten. */
export type SendResult = "sent" | "gone" | "failed";

/** What the service worker of the app receives and shows. */
export function payloadOf(notice: Notice, language?: string): PushMessage {
  const lang = noticeLang(language);
  const words = notice.words(lang);
  return {
    // The summary lines are what the device shows when too many notices pile up: they travel with each notice,
    // since the service worker that shows them knows no language.
    data: { title: words.title, body: words.body, url: notice.url, tag: notice.tag, grouped: words.grouped, summaryTitle: say(lang, "nt.summaryTitle"), summaryBody: say(lang, "nt.summaryBody") },
    options: { ttl: 24 * 3600, urgency: "normal", topic: notice.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "-") },
  };
}

export async function sendPush(fetchFn: FetchFn, sub: StoredSubscription, notice: Notice, vapid: Vapid, language?: string): Promise<SendResult> {
  try {
    const request = await buildPushPayload(payloadOf(notice, language), sub, vapid);
    const res = await fetchFn(sub.endpoint, { method: request.method, headers: request.headers, body: request.body });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
