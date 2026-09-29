import { useEffect, useMemo, useState } from "react";
import type { AssignmentsDoc, InventoryDoc, Team } from "../domain/types";
import { SCOPE_LABEL } from "../domain/types";
import type { GtSession } from "../dcs/auth";
import { DEFAULT_PM_CONFIG, type PmConfig } from "../domain/roles";
import {
  REVIEW_CREATE_ACTION,
  parseReviewRef,
  reviewAssigneeCandidates,
  reviewResources,
  reviewWorkOrders,
} from "../domain/reviewTask";
import { createReviewIssues, loadPmConfig, reviewIssuesToast } from "../dcs/issues";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  session: GtSession | null;
  pmOrg: string;
  board: AssignmentsDoc;
  team: Team;
  inventory: InventoryDoc | null;
  onChange: (next: AssignmentsDoc) => void;
  onCreated: () => void;
  announce: (msg: string) => void;
};

/**
 * Gestor: save the project plan, then create ONLY this review's subtarea for
 * its verses, assigned to one person who may already edit the resource in any
 * phase. Does not publish the rest of the plan.
 */
export function ReviewTaskControl({
  session,
  pmOrg,
  board,
  team,
  inventory,
  onChange,
  onCreated,
  announce,
}: Props) {
  const [pmConfig, setPmConfig] = useState<PmConfig>(DEFAULT_PM_CONFIG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session || !pmOrg) return;
    let cancelled = false;
    void loadPmConfig(session, pmOrg).then((config) => {
      if (!cancelled) setPmConfig(config);
    });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg]);

  const projectBooks = board.books?.length ? board.books : [board.book];
  const scope = parseReviewRef(team.reviewRef, projectBooks);
  const resources = reviewResources(team);
  const resourceNames = resources.map((r) => SCOPE_LABEL[r]).join(" y ");
  const candidates = useMemo(
    () => reviewAssigneeCandidates(board, team, pmConfig),
    [board, team, pmConfig],
  );
  const assigneeId = team.reviewAssigneeId ?? "";
  const assigneeOk = candidates.some((c) => c.person.id === assigneeId);

  if (!team.reviewRef?.trim()) {
    return (
      <p className="phases-task__note">
        Sin versículos: esta revisión cubre porciones completas. Para crear solo un versículo o un
        rango, escríbelo en Editar.
      </p>
    );
  }

  const planReason = reviewWorkOrders(board, team, inventory).reason;
  const blockReason =
    planReason ||
    (!session || !pmOrg ? "Inicia sesión y elige la organización para crear la revisión." : null) ||
    (!candidates.length
      ? `Nadie en este proyecto puede editar ${resourceNames || "este recurso"} todavía. Añade integrantes a una tarea de ${resourceNames || "ese recurso"}.`
      : null) ||
    (!assigneeOk ? "Elige quién hace la revisión." : null);

  function pickAssignee(id: string) {
    setMessage("");
    onChange({
      ...board,
      teams: board.teams.map((t) => (t.id === team.id ? { ...t, reviewAssigneeId: id } : t)),
    });
  }

  async function create() {
    if (!session || !pmOrg) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await createReviewIssues({ session, org: pmOrg, board, task: team, inventory });
      const text = reviewIssuesToast(result);
      setMessage(text);
      announce(text);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const selectId = `review-assignee-${team.id}`;
  return (
    <div className="grid gap-1.5">
      <p className="phases-task__note">
        {scope.ok ? `Revisión de ${scope.display}${resourceNames ? ` · ${resourceNames}` : ""}` : scope.reason}
      </p>
      {candidates.length ? (
        <div className="grid gap-1">
          <Label htmlFor={selectId} className="text-xs">
            Quién revisa
          </Label>
          <Select value={assigneeOk ? assigneeId : ""} onValueChange={pickAssignee}>
            <SelectTrigger id={selectId} className="w-full max-w-sm" aria-label="Quién revisa">
              <SelectValue placeholder="Elige una persona" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.person.id} value={c.person.id}>
                  {c.person.name} ·{" "}
                  {c.via
                    .map((v) => (v.phaseName ? `${v.taskName} (${v.phaseName})` : v.taskName))
                    .join(", ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {assigneeId && !assigneeOk ? (
            <p className="phases-task__note">
              La persona elegida antes ya no puede editar {resourceNames} en este proyecto. Elige otra.
            </p>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={Boolean(blockReason) || busy}
        aria-describedby={blockReason ? `review-create-${team.id}` : undefined}
        onClick={() => void create()}
      >
        {busy ? "Creando…" : REVIEW_CREATE_ACTION}
      </Button>
      {blockReason ? (
        <p id={`review-create-${team.id}`} className="phases-task__note">
          {blockReason}
        </p>
      ) : (
        <p className="phases-task__note">
          Guarda el plan del proyecto y crea solo la subtarea de esta revisión. No cambia las demás
          subtareas ni publica una versión.
        </p>
      )}
      {message ? <p className="phases-task__note">{message}</p> : null}
      {error ? <p className="phases-task__note text-destructive">{error}</p> : null}
    </div>
  );
}
