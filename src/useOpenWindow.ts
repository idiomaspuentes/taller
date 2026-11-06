import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GtSession } from "./dcs/auth";
import { stepSeated } from "./dcs/roundClose";
import { openWindowFor, sayOpenDate, type OpenWindow } from "./domain/openWindow";
import { getUiLanguage, useUiLanguage } from "./i18n/language";
import { tNow, useT, type MessageKey } from "./i18n/messages";
import { useNow } from "./useNow";

/**
 * The open window of a step for a screen that reviews item by item: who is seated on it, and the clock, which
 * wakes at the earliest window still ahead so no line keeps saying «hasta…» about a time that has passed. The screen
 * says every item's `openUntil` to `wakeAt` (from an effect, since they depend on `open`); the wake-up time is kept
 * in state so the summary, which depends on the time, does not feed the clock it is read with.
 */
export function useOpenWindow(params: {
  session: GtSession | null | undefined;
  pmOrg?: string;
  issueNumber?: number;
  step: { id: string; openHours?: number } | undefined;
}): { open: OpenWindow | undefined; wakeAt: (times: (string | undefined)[]) => void } {
  const { session, pmOrg, issueNumber, step } = params;
  const [seated, setSeated] = useState<string[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const nowRef = useRef(0);
  const earliest = times.filter((at) => at > nowRef.current).sort((a, b) => a - b)[0];
  const now = useNow(earliest === undefined ? undefined : new Date(earliest).toISOString());
  nowRef.current = now;
  const hasWindow = Boolean(step?.openHours && step.openHours > 0);

  useEffect(() => {
    if (!session || !pmOrg || !issueNumber || !step || !hasWindow) return setSeated([]);
    let cancelled = false;
    void stepSeated({ session, pmOrg, issueNumber, stepId: step.id })
      .then((who) => !cancelled && setSeated(who))
      .catch(() => !cancelled && setSeated([]));
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg, issueNumber, step?.id, hasWindow]);

  const wakeAt = useCallback((list: (string | undefined)[]) => {
    const next = list.map((iso) => (iso === undefined ? NaN : Date.parse(iso))).filter(Number.isFinite).sort((a, b) => a - b);
    setTimes((prev) => (prev.length === next.length && prev.every((at, i) => at === next[i]) ? prev : next));
  }, []);

  const open = useMemo(() => openWindowFor(step, seated, now), [step, seated, now]);
  return { open, wakeAt };
}

/** The date phrase of a message (`{date}`) in the language of the interface. */
export function useSayUntil(): (key: MessageKey, iso: string) => string {
  const t = useT();
  const language = useUiLanguage();
  return useCallback((key, iso) => t(key).replace("{date}", sayOpenDate(iso, language, t("round.dateAt"))), [t, language]);
}

/** The same outside a render, for what is sent to others (the language of whoever sends it). */
export function sayUntilNow(key: MessageKey, iso: string): string {
  return tNow(key).replace("{date}", sayOpenDate(iso, getUiLanguage(), tNow("round.dateAt")));
}
