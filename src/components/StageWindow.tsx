import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * A window that says what is done here before it is done, in big type and short: on entering a task of tuning, and
 * at each step of its first point (Estudiar, Marcar, Decidir). The tuning team is made of older people who fear that
 * a touch may spoil the work (Abel, 11 November). The window does not say it is safe: it says what to do, in a
 * sentence or two, with one obvious way on. Closing it is going on.
 */
export function StageWindow({
  open,
  title,
  sub,
  text,
  steps,
  go,
  onGo,
  show,
  onShow,
}: {
  open: boolean;
  title: ReactNode;
  /** Where this is, small under the title («Nehemías 1 · TPL»). */
  sub?: string;
  /** What to do here, or what the task is about. */
  text?: string;
  /** The steps of the task, in order, as chips («Estudiar › Marcar › Decidir»). */
  steps?: string[];
  go: string;
  onGo: () => void;
  /** The walk of the step, button by button. */
  show?: string;
  onShow?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onGo()}>
      <DialogContent className="task-intro stage-window" data-state={open ? "open" : "closed"} aria-describedby={undefined}>
        <header className="stage-window__head">
          <DialogTitle className="task-intro__title">{title}</DialogTitle>
          {sub ? <p className="stage-window__sub">{sub}</p> : null}
        </header>
        {text ? <p className="task-intro__text">{text}</p> : null}
        {steps?.length ? (
          <ol className="stage-window__steps">
            {steps.map((step, at) => (
              <li key={step}>
                <span className="stage-window__n">{at + 1}</span> {step}
                {at < steps.length - 1 ? <ChevronRight size={16} aria-hidden className="stage-window__to" /> : null}
              </li>
            ))}
          </ol>
        ) : null}
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
