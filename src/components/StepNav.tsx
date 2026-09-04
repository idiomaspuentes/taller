import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type StepId = "contexto" | "inventario" | "equipos" | "asignar" | "publicar";

export const STEPS: { id: StepId; n: number; label: string }[] = [
  { id: "contexto", n: 1, label: "Contexto" },
  { id: "inventario", n: 2, label: "Inventario" },
  { id: "equipos", n: 3, label: "Equipos" },
  { id: "asignar", n: 4, label: "Asignar" },
  { id: "publicar", n: 5, label: "Publicar" },
];

export function stepEnabled(
  id: StepId,
  contextConfirmed: boolean,
  hasInventory: boolean,
): boolean {
  if (id === "contexto") return true;
  if (id === "inventario" || id === "equipos") return contextConfirmed;
  return contextConfirmed && hasInventory;
}

type Props = {
  view: StepId;
  contextConfirmed: boolean;
  hasInventory: boolean;
  onChange: (id: StepId) => void;
};

export function StepNav({ view, contextConfirmed, hasInventory, onChange }: Props) {
  const current = STEPS.find((s) => s.id === view) ?? STEPS[0];

  return (
    <nav aria-label="Pasos" className="flex min-w-0 flex-1 items-center">
      <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1 sm:flex">
        {STEPS.map((step) => {
          const enabled = stepEnabled(step.id, contextConfirmed, hasInventory);
          const active = view === step.id;
          return (
            <Button
              key={step.id}
              type="button"
              size="sm"
              variant={active ? "default" : "ghost"}
              disabled={!enabled}
              aria-current={active ? "step" : undefined}
              onClick={() => onChange(step.id)}
              className={cn("rounded-full", !active && enabled && "text-foreground")}
            >
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full text-[0.65rem] font-semibold",
                  active ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground",
                )}
              >
                {step.n}
              </span>
              {step.label}
            </Button>
          );
        })}
      </div>

      <div className="flex w-full min-w-0 flex-1 items-center gap-2 sm:hidden">
        <div className="flex gap-1">
          {STEPS.map((step) => {
            const enabled = stepEnabled(step.id, contextConfirmed, hasInventory);
            const active = view === step.id;
            return (
              <button
                key={step.id}
                type="button"
                disabled={!enabled}
                aria-label={`${step.n} · ${step.label}`}
                aria-current={active ? "step" : undefined}
                onClick={() => onChange(step.id)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[0.65rem] font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : enabled
                      ? "bg-muted text-foreground"
                      : "bg-muted/60 text-muted-foreground",
                )}
              >
                {step.n}
              </button>
            );
          })}
        </div>
        <Select
          value={view}
          onValueChange={(id) => {
            if (stepEnabled(id as StepId, contextConfirmed, hasInventory)) {
              onChange(id as StepId);
            }
          }}
        >
          <SelectTrigger className="min-w-0 flex-1" size="sm" aria-label="Paso">
            <SelectValue>{current.n} · {current.label}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {STEPS.map((step) => (
              <SelectItem
                key={step.id}
                value={step.id}
                disabled={!stepEnabled(step.id, contextConfirmed, hasInventory)}
              >
                {step.n} · {step.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </nav>
  );
}
