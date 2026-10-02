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
import { waitWouldLoop } from "../domain/waits";
import { useT, type MessageKey } from "../i18n/messages";

type Props = {
  board: Pick<AssignmentsDoc, "teams" | "phases">;
  /** The task being edited; `null` for a task not saved yet. */
  taskId: string | null;
  /** The phase of that task: it is not offered, since a task cannot wait for its own phase. */
  phaseId?: string;
  value: WaitRule[];
  onChange: (next: WaitRule[]) => void;
};

function targetName(rule: WaitRule, board: Props["board"]): string | null {
  if (rule.taskId) return board.teams.find((t) => t.id === rule.taskId)?.name ?? null;
  return board.phases.find((p) => p.id === rule.phaseId)?.name ?? null;
}

const SCOPES: WaitScope[] = ["portion", "chapter", "all"];
const SCOPE_KEY: Record<WaitScope, MessageKey> = {
  portion: "wa.scopePortion",
  chapter: "wa.scopeChapter",
  all: "wa.scopeAll",
};

/**
 * «Esperar a»: pick what must be closed before this task can start.
 * Closed by default; opens with «+ Esperar a otra tarea».
 */
export function WaitsEditor({ board, taskId, phaseId, value, onChange }: Props) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState<WaitScope>("portion");
  const [error, setError] = useState("");

  /** A wait on the source project names a task of that project, by its id there. */
  const [sourceTask, setSourceTask] = useState("");
  const visible = value.filter((rule) => rule.source || targetName(rule, board));
  const nameOf = (rule: WaitRule) => (rule.source ? t("wa.sourceName").replace("{task}", rule.taskId ?? "") : targetName(rule, board) ?? "");
  const others = board.teams.filter((t) => t.id !== taskId);

  function add() {
    if (!target) return;
    if (target === "source" && !sourceTask.trim()) return;
    const rule: WaitRule =
      target === "source"
        ? // Passages are numbered by each project: across projects the chapter is what can be compared.
          { taskId: sourceTask.trim(), scope: scope === "all" ? "all" : "chapter", source: true }
        : target.startsWith("t:")
          ? { taskId: target.slice(2), scope }
          : { phaseId: target.slice(2), scope };
    if (taskId && waitWouldLoop(board, taskId, rule)) {
      setError(t("wa.loopError"));
      return;
    }
    const dup = value.some(
      (r) => r.taskId === rule.taskId && r.phaseId === rule.phaseId && r.scope === rule.scope && Boolean(r.source) === Boolean(rule.source),
    );
    if (!dup) onChange([...value, rule]);
    setTarget("");
    setError("");
    setAdding(false);
  }

  return (
    <div className="grid gap-1.5">
      <Label>{t("wa.label")}</Label>
      {visible.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("wa.listAria")}>
          {visible.map((rule) => (
            <li
              key={`${rule.source ? "s" : ""}${rule.taskId ?? ""}${rule.phaseId ?? ""}${rule.scope}`}
              className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pl-2.5 pr-1 text-xs"
            >
              <span>
                {rule.taskId ? "" : t("wa.phasePrefix")}
                {nameOf(rule)} · {t(SCOPE_KEY[rule.scope])}
              </span>
              <button
                type="button"
                className="rounded-full px-1.5 text-muted-foreground hover:text-foreground"
                aria-label={t("wa.removeAria").replace("{name}", nameOf(rule))}
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
            <SelectTrigger className="w-full" aria-label={t("wa.whatAria")}>
              <SelectValue placeholder={t("wa.pickTarget")} />
            </SelectTrigger>
            <SelectContent>
              {others.map((task) => (
                <SelectItem key={`t:${task.id}`} value={`t:${task.id}`}>
                  {t("wa.task").replace("{name}", task.name)}
                </SelectItem>
              ))}
              {board.phases.filter((p) => p.id !== phaseId).map((p) => (
                <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>
                  {t("wa.phase").replace("{name}", p.name)}
                </SelectItem>
              ))}
              <SelectItem value="source">{t("wa.source")}</SelectItem>
            </SelectContent>
          </Select>
          {target === "source" ? (
            <label className="grid gap-1 text-xs">
              <span>{t("wa.sourceTask")}</span>
              <input className="af-input" value={sourceTask} placeholder="publicar" onChange={(e) => setSourceTask(e.target.value)} />
              <span className="text-muted-foreground">{t("wa.sourceHelp")}</span>
            </label>
          ) : null}
          <Select value={scope} onValueChange={(v) => setScope(v as WaitScope)}>
            <SelectTrigger className="w-full" aria-label={t("wa.howMuchAria")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t("wa.waits").replace("{what}", t(SCOPE_KEY[s]))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("wa.help")}
          </p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={!target} onClick={add}>
              {t("wa.add")}
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
              {t("wa.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setAdding(true)}
        >
          {t("wa.addLink")}
        </button>
      )}
    </div>
  );
}
