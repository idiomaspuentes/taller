import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

type Props = {
  /** Where «back» leads, in words («Plantillas», «Proyectos»). */
  back?: { label: string; onClick: () => void };
  /** What is being edited, above its name («Plantilla», «Proyecto nuevo»). */
  kind: string;
  /** The name: a text, or an input to change it. */
  title: ReactNode;
  /** A short state beside the kind («sin guardar», «todavía no se ha creado»). */
  status?: { text: string; tone?: "warn" | "ok" | "quiet" };
  /** Buttons at the top right. */
  actions?: ReactNode;
  /** The steps of a flow with several screens, under the title. */
  steps?: ReactNode;
  /** What stands in the way of saving, in words. */
  problems?: string[];
  problemsTitle?: string;
  /** A bar that stays at the bottom while there is something to confirm. */
  footer?: ReactNode;
  children: ReactNode;
};

/** The frame every screen that edits a plan shares: where you are, what it is called, its state and its actions. */
export function PlanFrame({ back, kind, title, status, actions, steps, problems, problemsTitle, footer, children }: Props) {
  return (
    <div className="pf">
      <header className="pf-head">
        {back ? (
          <button type="button" className="pf-back" onClick={back.onClick}>
            <ArrowLeft size={16} aria-hidden /> {back.label}
          </button>
        ) : null}
        <div className="pf-head__row">
          <div className="pf-head__name">
            <p className="pf-kind">
              {kind}
              {status ? (
                <span className="pf-status" data-tone={status.tone ?? "quiet"}>
                  {status.text}
                </span>
              ) : null}
            </p>
            <div className="pf-title">{title}</div>
          </div>
          {actions ? <div className="pf-actions">{actions}</div> : null}
        </div>
        {steps}
      </header>
      {problems?.length ? (
        <div className="pf-problems" role="alert">
          {problemsTitle ? <p>{problemsTitle}</p> : null}
          <ul>
            {problems.slice(0, 6).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
            {problems.length > 6 ? <li>…</li> : null}
          </ul>
        </div>
      ) : null}
      {children}
      {footer ? <div className="pf-footer">{footer}</div> : null}
    </div>
  );
}
