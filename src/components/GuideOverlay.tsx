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
/** How long a step of a walk waits for what it points at before the guide goes on without it. */
const WAIT_MS = 30_000;

type Rect = { top: number; left: number; width: number; height: number };

/** Something else is open over the screen (a question, a sheet): the guide waits for it to close. */
const somethingOpen = () => Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));

/**
 * The guide on screen. A step to read («Mire») dims the screen, lights what it is about and says it beside it, with
 * its button; nothing under it can be touched. A step to touch («Toque») lets the finger through only where it is
 * lit, and goes on by itself when that is touched. A step of work («Haga») steps aside: a short line that covers
 * nothing, and what is being worked on outlined, until the work is done. A step of a walk whose turn has come
 * before what it points at shows nothing yet: the screen is moving on to it.
 */
export function GuideOverlay() {
  const t = useT();
  const run = useGuideRun();
  const step = run ? run.steps[run.index] : null;
  const kind = step?.kind ?? "look";
  const stepKey = step ? `${step.id}|${step.target ?? ""}|${kind}` : "";
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

  // Each step brings what it points at into view, and follows it while the screen moves under it. A step of a walk
  // may come before what it points at: it is brought into view as soon as it appears.
  useEffect(() => {
    setError("");
    setBusy(false);
    setRect(null);
    if (!step) return;
    let shown = false;
    const measure = () => {
      const element = step.target ? guideTarget(step.target) : null;
      if (element && !shown) {
        shown = true;
        element.scrollIntoView({ block: kind === "do" ? "nearest" : "center", inline: "nearest" });
      }
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
    // Only a step to read takes the focus: one of work leaves it where the person is typing.
    if (kind === "look") primary.current?.focus({ preventScroll: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The sentence goes under what it points at, or above when there is no room below; on a wide screen, beside what
  // is too tall for either (the column of sources); else at the foot of the screen, or, for a line beside some work,
  // at its top, away from the buttons at the foot. On a phone it takes the width of the screen.
  useLayoutEffect(() => {
    if (!step || !bubble.current) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(380, vw - EDGE * 2);
    const height = bubble.current.offsetHeight;
    if (!rect) {
      setPlace({ top: kind === "do" ? EDGE / 2 : Math.max(EDGE, (vh - height) / 2), left: (vw - width) / 2, width });
      return;
    }
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(center - width / 2, EDGE), vw - width - EDGE);
    const below = rect.top + rect.height + PAD + GAP;
    const above = rect.top - PAD - GAP - height;
    // A line beside some work goes over it first: under it are the buttons that finish the work.
    if (kind === "do" && above >= EDGE) return setPlace({ top: above, left, width });
    if (below + height <= vh - EDGE) return setPlace({ top: below, left, width });
    if (above >= EDGE) return setPlace({ top: above, left, width });
    const beside = Math.min(Math.max(rect.top, EDGE), vh - height - EDGE);
    if (vw - (rect.left + rect.width) - PAD - GAP >= width + EDGE) return setPlace({ top: beside, left: rect.left + rect.width + PAD + GAP, width });
    if (rect.left - PAD - GAP >= width + EDGE) return setPlace({ top: beside, left: rect.left - PAD - GAP - width, width });
    setPlace({ top: kind === "do" ? EDGE / 2 : vh - height - EDGE, left, width });
  }, [step, rect, error, busy, kind]);

  // The screen went somewhere the step cannot point at (a verse that is not this person's): the guide goes on.
  const waiting = Boolean(step?.flow && step.target && !rect);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => guide.next(), WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, stepKey]);

  useEffect(() => {
    if (!step) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") guide.skip();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!run || !step) return null;
  // What has not had its turn yet is not on screen while a step is said (see `GuideStep.hide`).
  const hidden = step.hide?.length ? <style>{`${step.hide.map((name) => `[data-guide="${name}"]`).join(", ")} { visibility: hidden !important; }`}</style> : null;
  // Its turn came before what it points at: the screen is on its way to it.
  if (step.flow && step.target && !rect) return hidden;

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
  const hole = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null;
  const nextLabel = step.ok ?? (run.flow ? t("guide.done") : last ? t("guide.done") : t("guide.next"));

  return (
    <div className="guide" data-kind={kind} data-lit={rect ? "true" : undefined}>
      {hidden}
      {hole ? <div className={kind === "do" ? "guide__ring" : "guide__hole"} aria-hidden style={hole} /> : null}
      {/* Everything around what is lit is held: a step to read lets only it be scrolled (a long note), and a step
          to touch lets the touch land only there. With nothing lit, the whole screen is held. */}
      {kind === "look" && !hole ? <div className="guide__block guide__block--all" /> : null}
      {kind !== "do" && hole ? (
        <>
          <div className="guide__block" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className="guide__block" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div className="guide__block" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className="guide__block" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
        </>
      ) : null}
      <section
        ref={bubble}
        className="guide__bubble"
        role={kind === "look" ? "dialog" : "status"}
        aria-modal={kind === "look" ? "true" : undefined}
        aria-labelledby="guide-text"
        style={place ? { top: place.top, left: place.left, width: place.width } : { visibility: "hidden" }}
      >
        {run.flow ? null : <p className="guide__count">{t("guide.count").replace("{n}", String(run.index + 1)).replace("{total}", String(run.steps.length))}</p>}
        {step.title ? <h2 className="guide__title">{step.title}</h2> : null}
        <p id="guide-text" className="guide__text">
          {step.text}
        </p>
        {step.sub ? <p className="guide__sub">{step.sub}</p> : null}
        {step.action ? (
          <Button type="button" variant="outline" className="guide__action" disabled={busy} onClick={() => void doAction()}>
            {busy ? t("guide.working") : step.action.label}
          </Button>
        ) : null}
        {error ? <p className="guide__error">{error}</p> : null}
        <div className="guide__actions">
          {last && !run.flow ? <span /> : (
            <button type="button" className="guide__skip" onClick={() => guide.skip()}>
              {t("guide.skip")}
            </button>
          )}
          {/* A step to touch or to do goes on by itself, when it is done: its only button is to leave the guide. */}
          {kind === "look" ? (
            // The shared Button does not pass a ref on (React 18): the same look, by hand, to give it the focus.
            <button ref={primary} type="button" className="btn guide__next" data-variant="default" data-size="default" onClick={() => guide.next()}>
              {nextLabel}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
