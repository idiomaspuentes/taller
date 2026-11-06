import { useEffect, useState } from "react";

// Development only: `?mockHoursAhead=N` moves the clock forward, to see an open window run out against the mock.
const aheadMs = (() => {
  if (!import.meta.env.DEV || typeof window === "undefined") return 0;
  const hours = Number(new URLSearchParams(window.location.search).get("mockHoursAhead"));
  return Number.isFinite(hours) ? hours * 3_600_000 : 0;
})();

const MAX_DELAY = 2 ** 31 - 1;

/**
 * The time now, painted again a second after `nextAt` (an ISO time), so a screen that says «open until…» changes by
 * itself when the time comes instead of waiting for the next touch.
 */
export function useNow(nextAt?: string): number {
  // Kept in state so a memo that depends on it is not recomputed on every paint.
  const [now, setNow] = useState(() => Date.now() + aheadMs);
  useEffect(() => {
    setNow(Date.now() + aheadMs);
    if (!nextAt) return;
    const at = Date.parse(nextAt);
    if (!Number.isFinite(at)) return;
    const delay = at - (Date.now() + aheadMs) + 1000;
    if (delay <= 0) return;
    const timer = setTimeout(() => setNow(Date.now() + aheadMs), Math.min(delay, MAX_DELAY));
    return () => clearTimeout(timer);
  }, [nextAt]);
  return now;
}
