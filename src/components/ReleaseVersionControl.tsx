import { useEffect, useState } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { AssignmentsDoc, ReleaseProfile } from "../domain/types";
import type { GtSession } from "../dcs/auth";
import type { PassDecisionComment } from "../domain/principalPass";
import { loadPassDecisionComments } from "../dcs/principalPass";
import {
  RELEASE_ACTION,
  defaultReleaseProfile,
  releaseGate,
  releaseIdentity,
  releaseNameBlock,
  releaseToast,
  withNameDraft,
  withNameDrafts,
} from "../domain/release";
import { runPublishVersion } from "../dcs/release";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  session: GtSession | null;
  pmOrg: string;
  board: AssignmentsDoc;
  onChange: (next: AssignmentsDoc) => void;
  /** null while the project's subtareas load. */
  issues: { issues: DcsIssue[]; namespaceId: string } | null;
  issuesError: string;
  onDone: () => void;
  announce: (msg: string) => void;
};

/** Gestor-only: version profiles (required phases) + «Publicar versión». */
export function ReleaseVersionControl({
  session,
  pmOrg,
  board,
  onChange,
  issues,
  issuesError,
  onDone,
  announce,
}: Props) {
  const profiles = board.settings?.releaseProfiles ?? [];
  const phases = [...board.phases].sort((a, b) => a.order - b.order);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{
    profile: ReleaseProfile;
    phaseNames: string[];
    identity: { tag: string; name: string };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decisions, setDecisions] = useState<PassDecisionComment[] | null>(null);
  const [decisionsError, setDecisionsError] = useState("");
  const marks = board.settings?.principalPasses;
  useEffect(() => {
    if (!session || !issues) return;
    let cancelled = false;
    setDecisions(null);
    setDecisionsError("");
    loadPassDecisionComments({ session, pmOrg, issues: issues.issues, namespaceId: issues.namespaceId, marks })
      .then((rows) => {
        if (!cancelled) setDecisions(rows);
      })
      .catch((err) => {
        if (!cancelled) setDecisionsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg, issues, marks]);

  function saveProfiles(next: ReleaseProfile[]) {
    const named = withNameDrafts(next, nameDrafts);
    const { releaseProfiles: _old, ...rest } = board.settings ?? {};
    onChange({ ...board, settings: named.length ? { ...rest, releaseProfiles: named } : rest });
  }

  useEffect(() => {
    setNameDrafts((drafts) => {
      const settled = Object.keys(drafts).filter(
        (id) => drafts[id].trim() === profiles.find((p) => p.id === id)?.name,
      );
      if (!settled.length) return drafts;
      const next = { ...drafts };
      for (const id of settled) delete next[id];
      return next;
    });
  }, [profiles]);

  function updateProfile(id: string, patch: Partial<ReleaseProfile>) {
    saveProfiles(profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function commitName(profile: ReleaseProfile) {
    if (withNameDraft(profile, nameDrafts[profile.id]) !== profile) updateProfile(profile.id, {});
  }

  function togglePhase(profile: ReleaseProfile, phaseId: string, on: boolean) {
    const ids = new Set(profile.requiredPhaseIds);
    if (on) ids.add(phaseId);
    else ids.delete(phaseId);
    updateProfile(profile.id, { requiredPhaseIds: phases.map((p) => p.id).filter((id) => ids.has(id)) });
  }

  async function run() {
    if (!confirm || !session) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await runPublishVersion({
        session,
        pmOrg,
        board: {
          ...board,
          settings: {
            ...board.settings,
            releaseProfiles: profiles.map((p) => (p.id === confirm.profile.id ? confirm.profile : p)),
          },
        },
        profileId: confirm.profile.id,
        identity: confirm.identity,
      });
      announce(releaseToast(outcome, confirm.identity.name));
      setConfirm(null);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hub-panel">
      <div className="grid gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Versiones publicadas</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Una versión publicada sale del borrador principal. Elige qué fases tienen que estar
            listas; las demás pueden seguir abiertas.
          </p>
        </div>

        {profiles.map((stored) => {
          const draft = nameDrafts[stored.id];
          const profile = withNameDraft(stored, draft);
          const nameBlock = releaseNameBlock(stored, draft);
          const gate = releaseGate({
            profile,
            phases: board.phases,
            tasks: board.teams,
            issues: issues?.issues ?? [],
            book: board.book,
            namespaceId: issues?.namespaceId,
            principalPasses: marks,
            decisions: decisions ?? undefined,
          });
          const reason = !session
            ? "Inicia sesión para publicar."
            : nameBlock
              ? nameBlock
              : !profile.requiredPhaseIds.length || !board.teams.length
              ? gate.blockReason
              : issuesError ||
                decisionsError ||
                (issues && decisions ? gate.blockReason : "Comprobando subtareas…");
          const reasonId = `release-reason-${profile.id}`;
          return (
            <div key={profile.id} className="grid gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid min-w-[12rem] flex-1 gap-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`release-name-${profile.id}`}>
                    Nombre de la versión
                  </label>
                  <Input
                    id={`release-name-${profile.id}`}
                    value={draft ?? stored.name}
                    onChange={(e) => setNameDrafts((d) => ({ ...d, [stored.id]: e.target.value }))}
                    onBlur={() => commitName(stored)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitName(stored);
                    }}
                    className="h-8"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => saveProfiles(profiles.filter((p) => p.id !== profile.id))}
                >
                  Quitar
                </Button>
              </div>
              <div className="grid gap-1" role="group" aria-labelledby={`release-phases-${profile.id}`}>
                <p id={`release-phases-${profile.id}`} className="text-xs text-muted-foreground">
                  Fases que deben estar listas
                </p>
                {phases.map((phase) => (
                  <label key={phase.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={profile.requiredPhaseIds.includes(phase.id)}
                      onCheckedChange={(checked) => togglePhase(stored, phase.id, Boolean(checked))}
                    />
                    {phase.name}
                  </label>
                ))}
              </div>
              <div className="grid gap-1">
                <Button
                  type="button"
                  size="sm"
                  className="w-fit"
                  disabled={Boolean(reason) || busy}
                  aria-describedby={reason ? reasonId : undefined}
                  onClick={() => {
                    setError("");
                    commitName(stored);
                    setConfirm({ profile, phaseNames: gate.phaseNames, identity: releaseIdentity(profile) });
                  }}
                >
                  {RELEASE_ACTION}
                </Button>
                {reason ? (
                  <p id={reasonId} className="phases-task__note">
                    {reason}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={!phases.length}
          onClick={() =>
            saveProfiles([
              ...profiles,
              profiles.length
                ? { ...defaultReleaseProfile(board.phases), name: `Versión ${profiles.length + 1}` }
                : defaultReleaseProfile(board.phases),
            ])
          }
        >
          + Nueva versión
        </Button>
      </div>

      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!busy && !open) setConfirm(null);
        }}
      >
        <DialogContent className="max-w-md" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{RELEASE_ACTION}</DialogTitle>
            <DialogDescription>
              Se publica la versión «{confirm?.identity.name}» a partir del borrador principal.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Fases incluidas: {confirm?.phaseNames.join(", ")}. No se cambia ningún texto ni el
            borrador grupal.
          </p>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={busy} onClick={() => void run()}>
              {busy ? "Publicando…" : RELEASE_ACTION}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
