import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  applyGroupReviewPreset,
  applyPairReviewPreset,
  clearStepClaimPolicy,
} from "../domain/stepPresets";
import type { StepClaimMode, TaskStep } from "../domain/types";

type Props = {
  step: TaskStep;
  steps: TaskStep[];
  stepIndex: number;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onChange: (next: TaskStep) => void;
  canManage?: boolean;
};

function hasClaimPolicy(step: TaskStep): boolean {
  return step.claimMode === "exclusive" || step.claimMode === "pool";
}

/** Progressive claim settings shared by Plantillas and Fases y tareas. */
export function StepClaimPolicyPanel({
  step,
  steps,
  stepIndex,
  expanded,
  onExpandedChange,
  onChange,
  canManage = true,
}: Props) {
  const active = hasClaimPolicy(step);
  const showPanel = expanded || active;

  if (!canManage) {
    if (!active) return null;
    return (
      <p className="text-xs text-muted-foreground">
        {step.claimMode === "exclusive"
          ? "Uno del equipo"
          : `Cupo ${step.minAssignees ?? 2}–${step.maxAssignees ?? step.minAssignees ?? 2}`}
      </p>
    );
  }

  if (!showPanel) {
    return (
      <div className="wf-step__claim">
        <button
          type="button"
          className="wf-step__tool-add"
          onClick={() => onExpandedChange(true)}
        >
          + Quién puede tomarlo
        </button>
      </div>
    );
  }

  return (
    <div className="wf-step__claim">
      <div className="wf-step__claim-panel">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              const draftId = steps.find(
                (s) => s.id !== step.id && (s.claimMode ?? "none") === "none",
              )?.id;
              onChange(applyPairReviewPreset(step, draftId));
            }}
          >
            Preset pares
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              const priors = steps
                .filter((s) => s.id !== step.id)
                .slice(0, stepIndex)
                .map((s) => s.id);
              onChange(applyGroupReviewPreset(step, priors));
            }}
          >
            Preset grupal
          </button>
          {active && !expanded ? null : (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => onExpandedChange(false)}
            >
              Ocultar
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Quién puede tomarlo
          </span>
          <Select
            value={step.claimMode ?? "none"}
            onValueChange={(v) => {
              const mode = v as StepClaimMode;
              if (mode === "none") {
                onChange(clearStepClaimPolicy(step));
                return;
              }
              if (mode === "exclusive") {
                onChange({
                  ...step,
                  claimMode: "exclusive",
                  minAssignees: undefined,
                  maxAssignees: undefined,
                });
                return;
              }
              onChange({
                ...step,
                claimMode: "pool",
                minAssignees: step.minAssignees ?? 2,
                maxAssignees: step.maxAssignees ?? step.minAssignees ?? 2,
              });
            }}
          >
            <SelectTrigger className="h-8 w-[13rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Cualquiera (casilla libre)</SelectItem>
              <SelectItem value="exclusive">Uno del equipo</SelectItem>
              <SelectItem value="pool">Varios (cupo)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {step.claimMode === "pool" ? (
          <div className="flex flex-wrap gap-2">
            <label className="grid gap-0.5 text-xs">
              <span className="text-muted-foreground">Mín.</span>
              <Input
                type="number"
                min={1}
                className="h-8 w-16"
                value={step.minAssignees ?? 2}
                onChange={(e) => {
                  const min = Math.max(1, Number(e.target.value) || 1);
                  const max = Math.max(min, step.maxAssignees ?? min);
                  onChange({ ...step, minAssignees: min, maxAssignees: max });
                }}
              />
            </label>
            <label className="grid gap-0.5 text-xs">
              <span className="text-muted-foreground">Máx.</span>
              <Input
                type="number"
                min={step.minAssignees ?? 1}
                className="h-8 w-16"
                value={step.maxAssignees ?? step.minAssignees ?? 2}
                onChange={(e) => {
                  const min = step.minAssignees ?? 2;
                  const max = Math.max(min, Number(e.target.value) || min);
                  onChange({ ...step, maxAssignees: max });
                }}
              />
            </label>
          </div>
        ) : null}
        {step.claimMode === "exclusive" ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={Boolean(step.includeAuthorInApproval)}
              onChange={(e) =>
                onChange({
                  ...step,
                  includeAuthorInApproval: e.target.checked || undefined,
                })
              }
            />
            Incluir a quien hizo el paso previo
          </label>
        ) : null}
        {active ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={Boolean(step.excludeIssueAssignee)}
              onChange={(e) =>
                onChange({
                  ...step,
                  excludeIssueAssignee: e.target.checked || undefined,
                })
              }
            />
            Excluir al asignado de la subtarea
          </label>
        ) : null}
        {active && steps.length > 1 ? (
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">
              Excluir quienes participaron en
            </span>
            <div className="flex flex-wrap gap-1.5">
              {steps
                .filter((s) => s.id !== step.id)
                .map((prior) => {
                  const on = (step.excludePriorStepIds ?? []).includes(prior.id);
                  return (
                    <button
                      key={prior.id}
                      type="button"
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs",
                        on
                          ? "border-foreground/40 bg-muted"
                          : "border-dashed text-muted-foreground",
                      )}
                      onClick={() => {
                        const cur = step.excludePriorStepIds ?? [];
                        onChange({
                          ...step,
                          excludePriorStepIds: on
                            ? cur.filter((id) => id !== prior.id)
                            : [...cur, prior.id],
                        });
                      }}
                    >
                      {prior.name}
                    </button>
                  );
                })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
