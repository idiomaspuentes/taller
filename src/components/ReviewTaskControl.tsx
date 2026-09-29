import { useEffect, useMemo, useState } from "react";
import type { AssignmentsDoc, InventoryDoc, Team } from "../domain/types";
import { SCOPE_LABEL } from "../domain/types";
import type { GtSession } from "../dcs/auth";
import { DEFAULT_PM_CONFIG, displayOrgTeamName, type PmConfig } from "../domain/roles";
import {
  REVIEW_CANDIDATES_FALLBACK_NOTE,
  REVIEW_CREATE_ACTION,
  parseReviewRef,
  resolveReviewCandidates,
  reviewResources,
  reviewWorkOrders,
  type OrgTeamAccess,
  type ReviewCandidate,
} from "../domain/reviewTask";
import { tryReadOrgTeamAccess } from "../domain/teamEligibility";
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
 * its verses, assigned to one person who may edit the resource in DCS (org
 * team access), whether or not they are an integrante of a task. Does not
 * publish the rest of the plan.
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

  /** `undefined` while reading DCS; `null` when it could not be read. */
  const [access, setAccess] = useState<OrgTeamAccess[] | null | undefined>(undefined);

  useEffect(() => {
    if (!session || !pmOrg) return;
    let cancelled = false;
    void loadPmConfig(session, pmOrg).then((config) => {
      if (!cancelled) setPmConfig(config);
    });
    setAccess(undefined);
    void tryReadOrgTeamAccess(session, pmOrg).then((rows) => {
      if (!cancelled) setAccess(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg]);

  const projectBooks = board.books?.length ? board.books : [board.book];
  const scope = parseReviewRef(team.reviewRef, projectBooks);
  const resources = reviewResources(team);
  const resourceNames = resources.map((r) => SCOPE_LABEL[r]).join(" y ");
  const loading = Boolean(session && pmOrg) && access === undefined;
  const { candidates, source } = useMemo(
    () => resolveReviewCandidates(board, team, access ?? null, pmConfig),
    [board, team, access, pmConfig],
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
    (loading ? `Buscando quién puede editar ${resourceNames || "este recurso"}…` : null) ||
    (!candidates.length
      ? source === "permisos"
        ? `Nadie en la organización puede editar ${resourceNames || "este recurso"} todavía. Pide a un gestor que dé acceso a un equipo.`
        : `Nadie en este proyecto puede editar ${resourceNames || "este recurso"} todavía. Añade integrantes a una tarea de ${resourceNames || "ese recurso"}.`
      : null) ||
    (!assigneeOk ? "Elige quién hace la revisión." : null);

  function pickAssignee(id: string) {
    setMessage("");
    const picked = candidates.find((c) => c.person.id === id)?.person;
    const known = board.people.some((p) => p.id.toLowerCase() === id.toLowerCase());
    onChange({
      ...board,
      people: picked && !known ? [...board.people, picked] : board.people,
      teams: board.teams.map((t) => (t.id === team.id ? { ...t, reviewAssigneeId: id } : t)),
    });
  }

  function candidateDetail(c: ReviewCandidate): string {
    if (c.teams?.length) {
      return c.teams.map((name) => displayOrgTeamName(name, pmConfig.teamPrefix)).join(", ");
    }
    return c.via.map((v) => (v.phaseName ? `${v.taskName} (${v.phaseName})` : v.taskName)).join(", ");
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
                  {c.person.name} · {candidateDetail(c)}
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
      {session && pmOrg && access === null ? (
        <p className="phases-task__note">{REVIEW_CANDIDATES_FALLBACK_NOTE}</p>
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
