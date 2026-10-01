/**
 * Notices shown by the service worker stay on the phone until tapped. Once the person has seen
 * the thing inside the app, the matching notice is closed too. Best effort.
 */
export async function clearNotices(tags: string[]): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || tags.length === 0) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    for (const n of await reg.getNotifications()) if (tags.includes(n.tag)) n.close();
  } catch {
    /* nothing to close */
  }
}
