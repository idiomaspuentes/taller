import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { guide, guideTarget, useGuideRun } from "../guide";
import { useT } from "../i18n/messages";
import { explainError } from "../dcs/userError";

/** How long a screen is left to settle (its lists, its verses) before its guide starts by itself. */
const SETTLE_MS = 700;
const GAP = 12;
const EDGE = 16;
const PAD = 6;

type Rect = { top: number; left: number; width: number; height: number };

/** Something else is open over the screen (a question, a sheet): the guide waits for it to close. */
const somethingOpen = () => Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));

/**
 * The guide on screen: the rest of the screen dimmed, what to touch lit, and a short sentence beside it with
 * «Siguiente» and «Saltar la guía». It starts by itself on a screen with something not seen yet, once the screen has
 * settled. Nothing under it can be touched while it is open: it is a few steps, and a touch that opened a task in the
 * middle of it would leave the person in another screen with half a guide.
 */
export function GuideOverlay() {
  const t = useT();
  const run = useGuideRun();
  const step = run ? run.steps[run.index] : null;
  const [rect, setRect] = useState<Rect | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bubble = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  // Starts by itself when the screen on view has something not seen yet.
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      window.clearTimeout(timer);
      if (guide.run()) return;
      const attempt = () => {
        if (guide.run()) return;
        if (somethingOpen()) timer = window.setTimeout(attempt, 1500);
        else guide.autoStart();
      };
      timer = window.setTimeout(attempt, SETTLE_MS);
    };
    check();
    const off = guide.subscribe(check);
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  // Each step brings what it points at into view, and follows it while the screen moves under it.
  useEffect(() => {
    setError("");
    setBusy(false);
    if (!step) return;
    const target = step.target ? guideTarget(step.target) : null;
    target?.scrollIntoView({ block: "center", inline: "nearest" });
    const measure = () => {
      const element = step.target ? guideTarget(step.target) : null;
      const box = element?.getBoundingClientRect();
      setRect((prev) => {
        if (!box) return null;
        const next = { top: box.top, left: box.left, width: box.width, height: box.height };
        return prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next;
      });
    };
    measure();
    const timer = window.setInterval(measure, 300);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    primary.current?.focus({ preventScroll: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // The sentence goes under what it points at, or above when there is no room below; on a wide screen, beside what
  // is too tall for either (the column of sources); else at the foot of the screen. On a phone it takes the width of
  // the screen.
  useLayoutEffect(() => {
    if (!step || !bubble.current) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(380, vw - EDGE * 2);
    const height = bubble.current.offsetHeight;
    if (!rect) {
      setPlace({ top: Math.max(EDGE, (vh - height) / 2), left: (vw - width) / 2, width });
      return;
    }
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(center - width / 2, EDGE), vw - width - EDGE);
    const below = rect.top + rect.height + PAD + GAP;
    const above = rect.top - PAD - GAP - height;
    if (below + height <= vh - EDGE) return setPlace({ top: below, left, width });
    if (above >= EDGE) return setPlace({ top: above, left, width });
    const beside = Math.min(Math.max(rect.top, EDGE), vh - height - EDGE);
    if (vw - (rect.left + rect.width) - PAD - GAP >= width + EDGE) return setPlace({ top: beside, left: rect.left + rect.width + PAD + GAP, width });
    if (rect.left - PAD - GAP >= width + EDGE) return setPlace({ top: beside, left: rect.left - PAD - GAP - width, width });
    setPlace({ top: vh - height - EDGE, left, width });
  }, [step, rect, error, busy]);

  useEffect(() => {
    if (!step) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") guide.skip();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [step]);

  if (!run || !step) return null;
  const last = run.index === run.steps.length - 1;
  const doAction = async () => {
    if (!step.action) return;
    setBusy(true);
    setError("");
    try {
      await step.action.run();
      guide.next();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="guide" data-lit={rect ? "true" : undefined}>
      {rect ? (
        <div
          className="guide__hole"
          aria-hidden
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      ) : null}
      <section
        ref={bubble}
        className="guide__bubble"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-text"
        style={place ? { top: place.top, left: place.left, width: place.width } : { visibility: "hidden" }}
      >
        <p className="guide__count">{t("guide.count").replace("{n}", String(run.index + 1)).replace("{total}", String(run.steps.length))}</p>
        {step.title ? <h2 className="guide__title">{step.title}</h2> : null}
        <p id="guide-text" className="guide__text">
          {step.text}
        </p>
        {step.action ? (
          <Button type="button" variant="outline" className="guide__action" disabled={busy} onClick={() => void doAction()}>
            {busy ? t("guide.working") : step.action.label}
          </Button>
        ) : null}
        {error ? <p className="guide__error">{error}</p> : null}
        <div className="guide__actions">
          {last ? <span /> : (
            <button type="button" className="guide__skip" onClick={() => guide.skip()}>
              {t("guide.skip")}
            </button>
          )}
          {/* The shared Button does not pass a ref on (React 18): the same look, by hand, to give it the focus. */}
          <button ref={primary} type="button" className="btn guide__next" data-variant="default" data-size="default" onClick={() => guide.next()}>
            {last ? t("guide.done") : t("guide.next")}
          </button>
        </div>
      </section>
    </div>
  );
}
