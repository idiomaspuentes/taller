import { Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Screens inside a project shell. The URL keeps one id per screen; the header
 * groups them into four stages (Preparar, Repartir, Avance, Publicar).
 * `inventario` prepares source material (for book-shaped projects: ULT/helps).
 * The project id in the URL is separate and is not always a book.
 */
export type StepId = "inventario" | "tareas" | "asignar" | "entregar" | "avance" | "publicar";

export type StageId = "preparar" | "repartir" | "avance" | "publicar";

export const STEPS: { id: StepId; label: string }[] = [
  { id: "inventario", label: "Libro" },
  { id: "tareas", label: "Fases y tareas" },
  { id: "asignar", label: "Asignar personas" },
  { id: "entregar", label: "Crear subtareas" },
  { id: "avance", label: "Avance" },
  { id: "publicar", label: "Publicar versión" },
];

export const STAGES: { id: StageId; n: number; label: string; steps: StepId[] }[] = [
  { id: "preparar", n: 1, label: "Preparar", steps: ["inventario", "tareas"] },
  { id: "repartir", n: 2, label: "Repartir", steps: ["asignar", "entregar"] },
  { id: "avance", n: 3, label: "Avance", steps: ["avance"] },
  { id: "publicar", n: 4, label: "Publicar", steps: ["publicar"] },
];

export function stageOf(step: StepId): (typeof STAGES)[number] {
  return STAGES.find((s) => s.steps.includes(step)) ?? STAGES[0]!;
}

export function stepEnabled(
  id: StepId,
  setupDone: boolean,
  hasInventory: boolean,
): boolean {
  if (!setupDone) return false;
  if (id === "inventario" || id === "tareas") return true;
  return hasInventory;
}

export type StepStatus = "locked" | "current" | "done" | "todo";

function stageStatus(
  stage: (typeof STAGES)[number],
  view: StepId,
  setupDone: boolean,
  hasInventory: boolean,
  hasTeams: boolean,
): StepStatus {
  if (!stage.steps.some((id) => stepEnabled(id, setupDone, hasInventory))) return "locked";
  const currentStage = stageOf(view);
  if (currentStage.id === stage.id) return "current";
  if (stage.n < currentStage.n) return "done";
  if (stage.id === "preparar" && hasInventory && hasTeams) return "done";
  return "todo";
}

type Props = {
  view: StepId;
  setupDone: boolean;
  hasInventory: boolean;
  hasTeams?: boolean;
  onChange: (id: StepId) => void;
};

function optionLabel(stage: (typeof STAGES)[number], status: StepStatus): string {
  const mark = status === "done" ? "✓ " : `${stage.n} · `;
  return `${mark}${stage.label}`;
}

/**
 * Project stage switcher: rail on wider screens, one native select on narrow.
 */
export function StepNav({
  view,
  setupDone,
  hasInventory,
  hasTeams = false,
  onChange,
}: Props) {
  const current = stageOf(view);

  function goStage(id: StageId) {
    const stage = STAGES.find((s) => s.id === id);
    if (!stage) return;
    if (stage.id === current.id) return;
    const target = stage.steps.find((step) => stepEnabled(step, setupDone, hasInventory));
    if (target) onChange(target);
  }

  return (
    <nav aria-label="Etapas del proyecto" className="app-step-nav">
      <ol className="app-step-nav__rail">
        {STAGES.map((stage) => {
          const status = stageStatus(stage, view, setupDone, hasInventory, hasTeams);
          return (
            <li key={stage.id} className="app-step-nav__item">
              <button
                type="button"
                className={cn("app-step-nav__step", `app-step-nav__step--${status}`)}
                disabled={status === "locked"}
                aria-current={status === "current" ? "step" : undefined}
                onClick={() => goStage(stage.id)}
              >
                <span className="app-step-nav__marker" aria-hidden>
                  {status === "done" ? (
                    <Check className="app-step-nav__check" strokeWidth={2.5} />
                  ) : (
                    stage.n
                  )}
                </span>
                <span className="app-step-nav__label app-step-nav__label--short">
                  {stage.label}
                </span>
                <span className="app-step-nav__label app-step-nav__label--full">
                  {stage.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="app-step-nav__mobile">
        <Select value={current.id} onValueChange={(id) => goStage(id as StageId)}>
          <SelectTrigger
            className="app-step-nav__trigger"
            size="sm"
            aria-label="Etapa del proyecto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {STAGES.map((stage) => {
              const status = stageStatus(stage, view, setupDone, hasInventory, hasTeams);
              return (
                <SelectItem key={stage.id} value={stage.id} disabled={status === "locked"}>
                  {optionLabel(stage, status)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <span className="app-step-nav__progress" aria-hidden>
          {current.n}/{STAGES.length}
        </span>
      </div>
    </nav>
  );
}

/** Second level: the screens inside the current stage. Renders nothing for single-screen stages. */
export function SubStepTabs({
  view,
  setupDone,
  hasInventory,
  onChange,
}: Omit<Props, "hasTeams">) {
  const stage = stageOf(view);
  if (stage.steps.length < 2) return null;
  return (
    <div className="substep-tabs" role="tablist" aria-label={stage.label}>
      {stage.steps.map((id) => {
        const step = STEPS.find((s) => s.id === id)!;
        const enabled = stepEnabled(id, setupDone, hasInventory);
        return (
          <button
            key={id}
            type="button"
            role="tab"
            className="substep-tabs__tab"
            aria-selected={id === view}
            disabled={!enabled}
            onClick={() => onChange(id)}
          >
            {step.label}
          </button>
        );
      })}
    </div>
  );
}
