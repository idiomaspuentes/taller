import { applyGroupReviewPreset, applyPairReviewPreset } from "../domain/stepPresets";
import { stepWho, withStepSeats, withStepWho, type StepWho } from "../domain/plan";
import type { TaskStep } from "../domain/types";
import { useT } from "../i18n/messages";

type Props = {
  step: TaskStep;
  /** The steps of the same task, in order: a step can only leave out who did an earlier one. */
  steps: TaskStep[];
  nameOf: (step: TaskStep) => string;
  onChange: (next: TaskStep) => void;
  disabled?: boolean;
};

const WHO: StepWho[] = ["owner", "one", "several"];

/** Who does a step, read back as one sentence: what the person filling this in checks their choices against. */
export function stepWhoSentence(step: TaskStep, steps: TaskStep[], nameOf: (step: TaskStep) => string, t: ReturnType<typeof useT>): string {
  const who = stepWho(step);
  if (who === "owner") return t("pe.sOwner");
  const prior = (step.excludePriorStepIds ?? [])
    .map((id) => steps.find((row) => row.id === id))
    .filter((row): row is TaskStep => Boolean(row))
    .map((row) => `«${nameOf(row)}»`);
  const not = [step.excludeIssueAssignee ? t("pe.sNotOwner") : "", prior.length ? t("pe.sNotPrior").replace("{steps}", prior.join(t("pe.sOr"))) : ""].filter(Boolean);
  const except = not.length ? t("pe.sThat").replace("{what}", not.join(t("pe.sAnd"))) : "";
  const min = step.minAssignees ?? 2;
  const max = step.maxAssignees ?? min;
  const base =
    who === "one"
      ? t("pe.sOne")
      : min === max
        ? t("pe.sSeveral").replace("{n}", String(min))
        : t("pe.sRange").replace("{min}", String(min)).replace("{max}", String(max));
  const tail = [
    who === "one" && step.includeAuthorInApproval ? t("pe.sAuthorToo") : "",
    who === "several" && step.minIndependent ? t("pe.sIndependent").replace("{n}", String(step.minIndependent)) : "",
  ].filter(Boolean);
  return [`${base}${except}.`, ...tail].join(" ");
}

/**
 * «Quién lo hace»: the choices a process has for seating people on a step, asked in the order a person would say
 * them (who, how many, who cannot) and read back as a sentence. The same settings the engine always had.
 */
export function StepWhoEditor({ step, steps, nameOf, onChange, disabled }: Props) {
  const t = useT();
  const who = stepWho(step);
  const at = steps.findIndex((row) => row.id === step.id);
  const earlier = at > 0 ? steps.slice(0, at) : [];
  const excluded = new Set(step.excludePriorStepIds ?? []);
  // A step everybody does once for the chapter (studying it) is not work somebody is the author of.
  const work = earlier.filter((row) => row.scope !== "chapter-once");
  const min = step.minAssignees ?? 2;
  const max = step.maxAssignees ?? min;

  function togglePrior(id: string) {
    const next = earlier.map((row) => row.id).filter((row) => (row === id ? !excluded.has(row) : excluded.has(row)));
    onChange({ ...step, excludePriorStepIds: next.length ? next : undefined });
  }

  return (
    <div className="pe-who">
      <div className="pe-seg" role="radiogroup" aria-label={t("pe.who")}>
        {WHO.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={who === id} className="pe-seg__opt" disabled={disabled} onClick={() => onChange(withStepWho(step, id))}>
            {t(id === "owner" ? "pe.whoOwner" : id === "one" ? "pe.whoOne" : "pe.whoSeveral")}
          </button>
        ))}
      </div>

      {who === "several" ? (
        <div className="pe-inline">
          <span>{t("pe.between")}</span>
          <input className="af-input pe-num" type="number" min={1} max={20} value={min} disabled={disabled} aria-label={t("pe.minPeople")} onChange={(e) => onChange(withStepSeats(step, Number(e.target.value), Math.max(Number(e.target.value), max)))} />
          <span>{t("pe.and")}</span>
          <input className="af-input pe-num" type="number" min={min} max={20} value={max} disabled={disabled} aria-label={t("pe.maxPeople")} onChange={(e) => onChange(withStepSeats(step, min, Number(e.target.value)))} />
          <span>{t("pe.people")}</span>
        </div>
      ) : null}

      {who !== "owner" ? (
        <div className="pe-who__not">
          <span className="pe-label">{t("pe.cannot")}</span>
          <div className="pe-chips">
            <button type="button" className="pe-chip" aria-pressed={Boolean(step.excludeIssueAssignee)} disabled={disabled} onClick={() => onChange({ ...step, excludeIssueAssignee: step.excludeIssueAssignee ? undefined : true })}>
              {t("pe.notOwner")}
            </button>
            {earlier.map((row) => (
              <button key={row.id} type="button" className="pe-chip" aria-pressed={excluded.has(row.id)} disabled={disabled} onClick={() => togglePrior(row.id)}>
                {t("pe.notWhoDid").replace("{step}", nameOf(row))}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {who === "one" ? (
        <label className="pe-check">
          <input type="checkbox" checked={Boolean(step.includeAuthorInApproval)} disabled={disabled} onChange={(e) => onChange({ ...step, includeAuthorInApproval: e.target.checked ? true : undefined })} />
          <span>{t("pe.authorToo")}</span>
        </label>
      ) : null}

      {who === "several" ? (
        <div className="pe-inline">
          <span>{t("pe.independentA")}</span>
          <input
            className="af-input pe-num"
            type="number"
            min={0}
            max={min}
            value={step.minIndependent ?? 0}
            disabled={disabled}
            aria-label={t("pe.independentAria")}
            onChange={(e) => onChange({ ...step, minIndependent: Math.min(min, Math.max(0, Math.floor(Number(e.target.value)) || 0)) || undefined })}
          />
          <span>{t("pe.independentB")}</span>
        </div>
      ) : null}

      {!disabled && at > 0 ? (
        <div className="pe-presets">
          <span>{t("pe.presets")}</span>
          <button type="button" onClick={() => onChange({ ...applyPairReviewPreset(step, work.at(-1)?.id), closing: step.closing === "self" ? "approval" : step.closing })}>
            {t("pe.presetPair")}
          </button>
          <button type="button" onClick={() => onChange({ ...applyGroupReviewPreset(step, work.map((row) => row.id)), closing: step.closing === "self" ? "approval" : step.closing })}>
            {t("pe.presetGroup")}
          </button>
        </div>
      ) : null}

      <p className="pe-readback">{stepWhoSentence(step, steps, nameOf, t)}</p>
    </div>
  );
}
