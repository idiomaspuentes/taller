import type { WorkPath } from "../domain/workPath";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { fill, phaseLabel, stepLabel } from "./cardWords";

/**
 * Where on its way a piece of work is: one segment per step of its path in the phase (done, now, still to come), and
 * the words «Ahora: Borrador · Sigue: Revisión en pares». The segments are decoration; the words are what is read,
 * on the screen and by a screen reader. They are measured in `em`, so they grow with the letter.
 */
export function PathBar({ path }: { path: WorkPath }) {
  const t = useT();
  const language = useUiLanguage();
  const now = path.now ? fill(t("tc.path.now"), { step: stepLabel(path.now, language) }) : "";
  const nextName = path.next ? (path.next.kind === "step" ? stepLabel(path.next.step, language) : phaseLabel(path.next.phase, language)) : "";
  const next = nextName ? fill(t("tc.path.next"), { next: nextName }) : "";
  const words = [now, next].filter(Boolean).join(" · ");
  return (
    <div className="task-card__path">
      <span className="task-card__path-bar" aria-hidden>
        {path.segments.map((segment, at) => (
          <span key={`${segment.taskId}:${segment.step.id}:${at}`} className="task-card__path-seg" data-state={segment.state} />
        ))}
      </span>
      {words ? <span className="task-card__path-text">{words}</span> : null}
    </div>
  );
}
