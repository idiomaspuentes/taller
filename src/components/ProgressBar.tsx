import { percentOf, type WorkTally } from "../domain/workProgress";
import { useT } from "../i18n/messages";

type Props = {
  /** Between 0 and 1: how far the whole is. */
  value: number;
  /** What the bar is of, for whoever does not see it («Avance: 58 %»). */
  label: string;
  /** The parts the whole is made of, each between 0 and 1: the steps of a subtarea, drawn one after another. */
  segments?: number[];
};

const width = (part: number) => `${Math.round(Math.min(1, Math.max(0, part)) * 100)}%`;

/** How far a piece of work is: a step, a subtarea, a tarea, a project. One bar for all of them, so they read alike. */
export function ProgressBar({ value, label, segments }: Props) {
  const parts = segments?.length ? segments : [value];
  return (
    <span className="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentOf(value)} aria-label={label}>
      {parts.map((part, index) => (
        <i key={index}>
          <b style={{ width: width(part) }} />
        </i>
      ))}
    </span>
  );
}

/** A tarea, a phase or a project: its bar, how many of its subtareas are finished, and the percentage. */
export function WorkLine({ tally }: { tally: WorkTally }) {
  const t = useT();
  const percent = percentOf(tally.fraction);
  return (
    <div className="work-line">
      <ProgressBar value={tally.fraction} label={t("pg.label").replace("{n}", String(percent))} />
      <span className="work-line__count">
        {t(tally.total === 1 ? "pg.ofSubtask" : "pg.ofSubtasks").replace("{done}", String(tally.done)).replace("{total}", String(tally.total))} · <strong>{t("pg.percent").replace("{n}", String(percent))}</strong>
      </span>
    </div>
  );
}
