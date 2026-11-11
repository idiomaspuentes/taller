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
  sub,
  text,
  lead,
  steps,
  team,
  safe,
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
  /** What the list of steps is («Cada frase se revisa en tres pasos:»). */
  lead?: string;
  /** The steps, in order: their name and what is done in each. */
  steps?: { name: string; text: string }[];
  /** That the person does not decide alone. */
  team?: string;
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
        <header className="stage-window__head">
          <DialogTitle className="task-intro__title">{title}</DialogTitle>
          {sub ? <p className="stage-window__sub">{sub}</p> : null}
        </header>
        {text ? <p className="task-intro__text">{text}</p> : null}
        {steps?.length ? (
          <section className="task-intro__group">
            {lead ? <p className="task-intro__label">{lead}</p> : null}
            <ol className="task-intro__list">
              {steps.map((step) => (
                <li key={step.name}>
                  <b>{step.name}:</b> {step.text}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <section className="task-intro__group">
          {team ? <p className="stage-window__team">{team}</p> : null}
          <p className="stage-window__safe">{safe}</p>
        </section>
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
