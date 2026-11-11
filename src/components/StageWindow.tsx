import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * A window that says what is done here before it is done, in big type: on entering a task of tuning, and at each
 * stage of its first point (Estudiar, Marcar, Decidir). The tuning team is made of older people who fear that a touch
 * may spoil the work (Abel, 11 November): each window says what to do and whether anything is kept, and has one
 * obvious way on. Closing it is going on.
 */
export function StageWindow({
  open,
  title,
  text,
  steps,
  safe,
  go,
  onGo,
  show,
  onShow,
}: {
  open: boolean;
  title: ReactNode;
  /** What to do here, one sentence or two. */
  text?: string;
  /** What the task has, in order («Estudie…», «Marque…», «Decida…»). */
  steps?: string[];
  /** Whether anything is kept here: what takes the fear away. */
  safe: string;
  go: string;
  onGo: () => void;
  /** The walk of the stage, step by step. */
  show?: string;
  onShow?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onGo()}>
      <DialogContent className="task-intro stage-window" data-state={open ? "open" : "closed"} aria-describedby={undefined}>
        <DialogTitle className="task-intro__title">{title}</DialogTitle>
        {text ? <p className="task-intro__text">{text}</p> : null}
        {steps?.length ? (
          <ol className="task-intro__list">
            {steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        ) : null}
        <p className="stage-window__safe">{safe}</p>
        <div className="task-intro__actions">
          <Button type="button" size="lg" onClick={onGo}>
            {go}
          </Button>
          {show && onShow ? (
            <Button type="button" size="lg" variant="outline" onClick={onShow}>
              {show}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
