import { noticeToClose } from "./domain/noticeTarget";

/**
 * Notices shown by the service worker stay on the phone until tapped. Once the person has seen
 * the thing inside the app, the matching notice is closed too: by its tag, or, with `issues`, by
 * the subtarea it opens (see `noticeTarget.ts`). Best effort.
 */
export async function clearNotices(tags: string[], issues: number[] = []): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || (tags.length === 0 && issues.length === 0)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    for (const n of await reg.getNotifications()) if (noticeToClose(n, tags, issues)) n.close();
  } catch {
    /* nothing to close */
  }
}

/** The notices of one subtarea: those tagged with it and those that open it. */
export const clearTaskNotices = (issue: number): Promise<void> => clearNotices([`subtarea-${issue}`], [issue]);
