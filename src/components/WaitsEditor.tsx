import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AssignmentsDoc, WaitRule, WaitScope } from "../domain/types";
import { WAIT_SCOPE_LABEL, waitWouldLoop } from "../domain/waits";

type Props = {
  board: Pick<AssignmentsDoc, "teams" | "phases">;
  /** The task being edited; `null` for a task not saved yet. */
  taskId: string | null;
  value: WaitRule[];
  onChange: (next: WaitRule[]) => void;
};

function targetName(rule: WaitRule, board: Props["board"]): string | null {
  if (rule.taskId) return board.teams.find((t) => t.id === rule.taskId)?.name ?? null;
  return board.phases.find((p) => p.id === rule.phaseId)?.name ?? null;
}

const SCOPES: WaitScope[] = ["portion", "chapter", "all"];

/**
 * «Esperar a»: pick what must be closed before this task can start.
 * Closed by default; opens with «+ Esperar a otra tarea».
 */
export function WaitsEditor({ board, taskId, value, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState<WaitScope>("portion");
  const [error, setError] = useState("");

  const visible = value.filter((rule) => targetName(rule, board));
  const others = board.teams.filter((t) => t.id !== taskId);

  function add() {
    if (!target) return;
    const rule: WaitRule = target.startsWith("t:")
      ? { taskId: target.slice(2), scope }
      : { phaseId: target.slice(2), scope };
    if (taskId && waitWouldLoop(board, taskId, rule)) {
      setError("Eso haría que dos tareas se esperen entre sí. Elige otra.");
      return;
    }
    const dup = value.some(
      (r) => r.taskId === rule.taskId && r.phaseId === rule.phaseId && r.scope === rule.scope,
    );
    if (!dup) onChange([...value, rule]);
    setTarget("");
    setError("");
    setAdding(false);
  }

  return (
    <div className="grid gap-1.5">
      <Label>Esperar a</Label>
      {visible.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Lo que esta tarea espera">
          {visible.map((rule) => (
            <li
              key={`${rule.taskId ?? ""}${rule.phaseId ?? ""}${rule.scope}`}
              className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pl-2.5 pr-1 text-xs"
            >
              <span>
                {rule.taskId ? "" : "Fase "}
                {targetName(rule, board)} · {WAIT_SCOPE_LABEL[rule.scope]}
              </span>
              <button
                type="button"
                className="rounded-full px-1.5 text-muted-foreground hover:text-foreground"
                aria-label={`Quitar espera a ${targetName(rule, board)}`}
                onClick={() => onChange(value.filter((r) => r !== rule))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="grid gap-2 rounded-md border p-2">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="w-full" aria-label="Qué espera">
              <SelectValue placeholder="Elige una tarea o una fase" />
            </SelectTrigger>
            <SelectContent>
              {others.map((t) => (
                <SelectItem key={`t:${t.id}`} value={`t:${t.id}`}>
                  Tarea · {t.name}
                </SelectItem>
              ))}
              {board.phases.map((p) => (
                <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>
                  Fase · {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scope} onValueChange={(v) => setScope(v as WaitScope)}>
            <SelectTrigger className="w-full" aria-label="Cuánto espera">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s} value={s}>
                  Espera {WAIT_SCOPE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            La tarea aparece como «Esperando» hasta que lo que elijas esté cerrado.
          </p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={!target} onClick={add}>
              Añadir espera
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setAdding(true)}
        >
          + Esperar a otra tarea
        </button>
      )}
    </div>
  );
}
