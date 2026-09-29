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
 * Steps inside a project shell.
 * `inventario` prepares source material (for book-shaped projects: ULT/helps).
 * The project id in the URL is separate and is not always a book.
 */
export type StepId = "inventario" | "tareas" | "asignar" | "entregar";

export const STEPS: { id: StepId; n: number; label: string; short: string }[] = [
  { id: "inventario", n: 1, label: "Inventario", short: "Inventario" },
  { id: "tareas", n: 2, label: "Fases y tareas", short: "Fases" },
  { id: "asignar", n: 3, label: "Asignar", short: "Asignar" },
  { id: "entregar", n: 4, label: "Entregar", short: "Entregar" },
];

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

export function stepStatus(
  id: StepId,
  view: StepId,
  setupDone: boolean,
  hasInventory: boolean,
  hasTeams: boolean,
): StepStatus {
  if (!stepEnabled(id, setupDone, hasInventory)) return "locked";
  if (id === view) return "current";
  if (id === "inventario" && hasInventory) return "done";
  if (id === "tareas" && hasTeams) return "done";
  const order = STEPS.findIndex((s) => s.id === id);
  const current = STEPS.findIndex((s) => s.id === view);
  if (order >= 0 && current >= 0 && order < current) return "done";
  return "todo";
}

type Props = {
  view: StepId;
  setupDone: boolean;
  hasInventory: boolean;
  hasTeams?: boolean;
  onChange: (id: StepId) => void;
};

function optionLabel(
  step: (typeof STEPS)[number],
  status: StepStatus,
): string {
  const mark = status === "done" ? "✓ " : `${step.n} · `;
  return `${mark}${step.label}`;
}

/**
 * Project step switcher: rail on wider screens, one native select on narrow.
 */
export function StepNav({
  view,
  setupDone,
  hasInventory,
  hasTeams = false,
  onChange,
}: Props) {
  const index = STEPS.findIndex((s) => s.id === view) + 1;

  function go(id: StepId) {
    if (stepEnabled(id, setupDone, hasInventory)) onChange(id);
  }

  return (
    <nav aria-label="Pasos del proyecto" className="app-step-nav">
      <ol className="app-step-nav__rail">
        {STEPS.map((step) => {
          const status = stepStatus(step.id, view, setupDone, hasInventory, hasTeams);
          return (
            <li key={step.id} className="app-step-nav__item">
              <button
                type="button"
                className={cn("app-step-nav__step", `app-step-nav__step--${status}`)}
                disabled={status === "locked"}
                aria-current={status === "current" ? "step" : undefined}
                onClick={() => go(step.id)}
              >
                <span className="app-step-nav__marker" aria-hidden>
                  {status === "done" ? (
                    <Check className="app-step-nav__check" strokeWidth={2.5} />
                  ) : (
                    step.n
                  )}
                </span>
                <span className="app-step-nav__label app-step-nav__label--short">
                  {step.short}
                </span>
                <span className="app-step-nav__label app-step-nav__label--full">
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="app-step-nav__mobile">
        <Select value={view} onValueChange={(id) => go(id as StepId)}>
          <SelectTrigger
            className="app-step-nav__trigger"
            size="sm"
            aria-label="Paso del proyecto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {STEPS.map((step) => {
              const status = stepStatus(
                step.id,
                view,
                setupDone,
                hasInventory,
                hasTeams,
              );
              return (
                <SelectItem
                  key={step.id}
                  value={step.id}
                  disabled={status === "locked"}
                >
                  {optionLabel(step, status)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <span className="app-step-nav__progress" aria-hidden>
          {index}/{STEPS.length}
        </span>
      </div>
    </nav>
  );
}
