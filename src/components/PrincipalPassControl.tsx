import { useState } from "react";
import type { AssignmentsDoc, PrincipalPassMark, Team } from "../domain/types";
import type { GtSession } from "../dcs/auth";
import {
  PRINCIPAL_PASS_ACTION,
  principalReviewConfirmText,
  rangeLabel,
  type PrincipalPassGate,
  type PrincipalReviewPreview,
} from "../domain/principalPass";
import { loadPrincipalReviewPreview, principalPassToast, runPrincipalPass } from "../dcs/principalPass";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  team: Team;
  /** null while the project's subtareas load. */
  gate: PrincipalPassGate | null;
  gateError: string;
  /** Called only after a fully successful pass; the caller saves the mark in project settings. */
  onPassed: (mark: PrincipalPassMark) => void;
  onDone: () => void;
  announce: (msg: string) => void;
};

/** Gestor-only: move a finished task's borrador grupal into the borrador principal. */
export function PrincipalPassControl({
  session,
  pmOrg,
  board,
  team,
  gate,
  gateError,
  onPassed,
  onDone,
  announce,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Review task: null while the verses to replace are read. */
  const [preview, setPreview] = useState<PrincipalReviewPreview[] | null>(null);

  const review = Boolean(team.reviewsPrincipal);
  const reason = gateError || (gate ? gate.blockReason : "Comprobando subtareas…");
  const verses = gate?.targets.map((t) => `${t.book} ${t.ranges.map(rangeLabel).join(", ")}`).join("; ") ?? "";
  const passParams = {
    session,
    pmOrg,
    lang: board.lang,
    contentOrg: board.contentOrg,
    board,
    taskId: team.id,
  };

  async function open() {
    setError("");
    setPreview(null);
    setConfirmOpen(true);
    if (!review) return;
    setBusy(true);
    try {
      setPreview(await loadPrincipalReviewPreview(passParams));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      const result = await runPrincipalPass({ ...passParams, confirmedReplace: preview ?? undefined });
      onPassed(result.mark);
      setConfirmOpen(false);
      announce(principalPassToast(result));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (review) {
        setPreview(null);
        try {
          setPreview(await loadPrincipalReviewPreview(passParams));
        } catch {
          /* the first error stays on screen */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={Boolean(reason) || busy}
          aria-describedby={reason ? `principal-pass-${team.id}` : undefined}
          onClick={() => void open()}
        >
          {PRINCIPAL_PASS_ACTION}
        </Button>
        {reason ? (
          <p id={`principal-pass-${team.id}`} className="phases-task__note">
            {reason}
          </p>
        ) : null}
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!busy) setConfirmOpen(open);
        }}
      >
        <DialogContent className="max-w-md" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{PRINCIPAL_PASS_ACTION}</DialogTitle>
            <DialogDescription>
              {review
                ? preview
                  ? principalReviewConfirmText({
                      taskName: team.name,
                      replaced: preview.map((row) => ({ book: row.book, verses: row.replaced })),
                    })
                  : error
                    ? "No se pudo comprobar qué versículos cambia la revisión."
                    : "Comprobando qué versículos cambia la revisión…"
                : `El texto de «${team.name}»${verses ? ` (${verses})` : ""} entra en el borrador principal. Esto no publica una versión.`}
            </DialogDescription>
          </DialogHeader>
          {review ? (
            <p className="text-sm text-muted-foreground">
              Solo cambian los versículos de esta revisión{verses ? ` (${verses})` : ""}. Los versículos
              vacíos del borrador principal se completan con el texto de la revisión.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Solo cambian los versículos de esta tarea. Si un versículo ya tiene otro texto en el
              borrador principal, no se cambia nada y verás cuáles hay que resolver.
            </p>
          )}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={busy || (review && !preview)} onClick={() => void run()}>
              {busy && (!review || preview) ? "Pasando…" : PRINCIPAL_PASS_ACTION}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
