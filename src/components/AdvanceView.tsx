import { useEffect, useState } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { listProjectIssues } from "../dcs/issues";
import { teamRules } from "../domain/assignment";
import {
  dropStalePrincipalPasses,
  principalPassGate,
  recordPrincipalPass,
} from "../domain/principalPass";
import type { AssignmentsDoc, InventoryDoc, Phase, Team } from "../domain/types";
import { scopeLabel } from "../domain/resourceNames";
import { PrincipalPassControl } from "./PrincipalPassControl";
import { ReleaseVersionControl } from "./ReleaseVersionControl";
import { ReviewTaskControl } from "./ReviewTaskControl";

type Props = {
  /** "tareas": per-task actions (Avance). "version": publish a version (Publicar). */
  section: "tareas" | "version";
  board: AssignmentsDoc;
  inventory: InventoryDoc | null;
  onChange: (next: AssignmentsDoc) => void;
  session: GtSession | null;
  pmOrg: string;
  announce: (msg: string) => void;
  onGoTareas: () => void;
};

/**
 * Avance: what a manager does after the work is handed out — pass a task's
 * text to the borrador principal, create a review, publish a version.
 * The controls are the same ones that used to sit inside Fases y tareas.
 */
export function AdvanceView({ section, board, inventory, onChange, session, pmOrg, announce, onGoTareas }: Props) {
  const [passIssues, setPassIssues] = useState<{ issues: DcsIssue[]; namespaceId: string } | null>(null);
  const [passError, setPassError] = useState("");
  const [passReload, setPassReload] = useState(0);
  const projectId = board.projectId || board.book;
  const hasTasks = board.teams.length > 0;

  useEffect(() => {
    if (!session || !pmOrg || !projectId || !hasTasks) return;
    let cancelled = false;
    setPassIssues(null);
    setPassError("");
    listProjectIssues(session, pmOrg, projectId)
      .then((res) => {
        if (!cancelled) setPassIssues(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setPassError(`No se pudieron leer las subtareas: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg, projectId, hasTasks, passReload]);

  useEffect(() => {
    if (!passIssues) return;
    const next = dropStalePrincipalPasses(board.settings, passIssues.issues, passIssues.namespaceId);
    if (next !== board.settings) onChange({ ...board, settings: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passIssues, board.settings]);

  const phases: Phase[] = [...board.phases].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"),
  );
  const reload = () => setPassReload((n) => n + 1);

  if (!hasTasks) {
    return (
      <div className="hub-empty-panel hub">
        <h2 className="hub-empty-panel__title">Aún no hay tareas</h2>
        <p className="text-sm text-muted-foreground">
          Crea las tareas del proyecto para poder seguir su avance.
        </p>
        <button type="button" className="btn" data-variant="default" data-size="default" onClick={onGoTareas}>
          Ir a Fases y tareas
        </button>
      </div>
    );
  }

  function taskRow(team: Team) {
    const rules = teamRules(team);
    const canPass = Boolean(session && pmOrg && rules.some((r) => r.resource === "tpl" || r.resource === "tps"));
    const controls = canPass || team.reviewsPrincipal;
    return (
      <div key={team.id} className="advance-task">
        <div className="advance-task__head">
          <h3 className="advance-task__title">{team.name}</h3>
          <p className="advance-task__meta">
            {rules.map((rule) => scopeLabel(rule.resource, board.settings?.resourceNames)).join(" · ") || "Sin recursos"}
          </p>
        </div>
        {controls ? (
          <div className="advance-task__controls">
            {canPass && session ? (
              <PrincipalPassControl
                session={session}
                pmOrg={pmOrg}
                board={board}
                team={team}
                gate={
                  passIssues
                    ? principalPassGate({
                        issues: passIssues.issues,
                        taskId: team.id,
                        book: board.book,
                        namespaceId: passIssues.namespaceId,
                      })
                    : null
                }
                gateError={passError}
                onPassed={(mark) => onChange({ ...board, settings: recordPrincipalPass(board.settings, mark) })}
                onDone={reload}
                announce={announce}
              />
            ) : null}
            {team.reviewsPrincipal ? (
              <ReviewTaskControl
                session={session}
                pmOrg={pmOrg}
                board={board}
                team={team}
                inventory={inventory}
                onChange={onChange}
                onCreated={reload}
                announce={announce}
              />
            ) : null}
          </div>
        ) : (
          <p className="advance-task__note">Sin acciones de avance para esta tarea.</p>
        )}
      </div>
    );
  }

  return (
    <div className="hub advance-view">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{section === "tareas" ? "Avance" : "Publicar versión"}</h1>
          <p className="hub-lede">
            {section === "tareas"
              ? "Pasa el texto de cada tarea al borrador principal y crea revisiones cuando haga falta."
              : "Publica una versión desde el borrador principal cuando las fases del perfil estén listas."}
          </p>
        </div>
      </div>

      {section === "tareas" ? (
      <section className="advance-section" aria-labelledby="advance-tasks">
        <h2 id="advance-tasks" className="advance-section__title">
          Tareas
        </h2>
        {phases.map((phase) => {
          const tasks = board.teams.filter((t) => t.phaseId === phase.id);
          if (!tasks.length) return null;
          return (
            <div key={phase.id} className="advance-phase">
              <p className="advance-phase__name">{phase.name}</p>
              <div className="advance-phase__tasks">{tasks.map(taskRow)}</div>
            </div>
          );
        })}
      </section>
      ) : null}

      {section === "version" && phases.length ? (
        <section className="advance-section" aria-label="Publicar versión">
          <ReleaseVersionControl
            session={session}
            pmOrg={pmOrg}
            board={board}
            onChange={onChange}
            issues={passIssues}
            issuesError={passError}
            onDone={reload}
            announce={announce}
          />
        </section>
      ) : null}
    </div>
  );
}
