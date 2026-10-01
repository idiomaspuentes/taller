import { useCallback, useEffect, useState } from "react";
import { loadSession, type GtSession } from "../dcs/auth";
import {
  commentOnPortionPr,
  ensurePortionPr,
  getPmIssue,
  loadLinkedPull,
  loadLinkedPullFiles,
} from "../dcs/portionPr";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { getPullDiff, type DcsPull, type DcsPullFile } from "../dcs/pulls";
import { dcsConfig } from "../dcs/config";
import {
  decodeSolverLaunchContext,
  type SolverLaunchContext,
} from "../domain/solverLaunch";
import { parsePortionPrMarker, translatorLoginFromHead, type PortionPrMarker } from "../domain/portionPr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  ctxEncoded: string;
  mode: "pair" | "group";
  onClose: () => void;
  announce: (msg: string) => void;
};

export function PortionReviewView({ ctxEncoded, mode, onClose, announce }: Props) {
  const [session, setSession] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [marker, setMarker] = useState<PortionPrMarker | null>(null);
  const [pull, setPull] = useState<DcsPull | null>(null);
  const [files, setFiles] = useState<DcsPullFile[]>([]);
  const [diff, setDiff] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError("Contexto de lanzamiento inválido o incompleto.");
      return;
    }
    setCtx(decoded);
    const sess = loadSession();
    setSession(sess);
    if (!sess?.token) {
      setError("La reseña requiere conexión e inicio de sesión en Taller.");
      return;
    }
    if (!decoded.issueNumber) {
      setError("Falta el número de subtarea en el contexto.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const issue = await getPmIssue(sess, decoded.pmOrg, decoded.issueNumber);
      let linked = parsePortionPrMarker(issue.body);
      if (!linked) {
        setMarker(null);
        setPull(null);
        setFiles([]);
        setDiff("");
        return;
      }
      setMarker(linked);
      const [nextPull, nextFiles, nextDiff] = await Promise.all([
        loadLinkedPull(sess, linked),
        loadLinkedPullFiles(sess, linked),
        getPullDiff(
          dcsConfig(sess.host),
          linked.owner,
          linked.repo,
          linked.number,
          sess.token,
        ).catch(() => ""),
      ]);
      setPull(nextPull);
      setFiles(nextFiles);
      setDiff(nextDiff);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPr() {
    if (!session || !ctx) return;
    setActing(true);
    setError("");
    try {
      const issue = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
      const board = await loadAssignmentsFromDcs(
        session,
        ctx.pmOrg,
        ctx.lang,
        ctx.projectId,
        ctx.contentOrg,
      );
      if (!board) throw new Error("No se encontró el plan del proyecto.");
      const result = await ensurePortionPr({
        session,
        pmOrg: ctx.pmOrg,
        lang: ctx.lang,
        contentOrg: ctx.contentOrg,
        board,
        issue,
      });
      setMarker(result.marker);
      announce(
        result.created
          ? "Revisión abierta"
          : "La revisión ya estaba abierta",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }

  async function sendComment() {
    if (!session || !marker) return;
    const body = comment.trim();
    if (!body) return;
    setActing(true);
    setError("");
    try {
      await commentOnPortionPr(session, marker, body);
      setComment("");
      announce("Comentario enviado");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }

  const modeLabel = mode === "group" ? "Revisión grupal" : "Revisión en pares";
  const draftOwner = marker ? translatorLoginFromHead(marker.head, [session?.username]) : "";
  const draftLabel =
    !draftOwner || draftOwner.toLowerCase() === session?.username.toLowerCase()
      ? "tu borrador"
      : `el borrador de @${draftOwner}`;

  return (
    <div className="scripture-editor">
      <header className="scripture-editor__head">
        <div className="min-w-0">
          <p className="scripture-editor__kicker">{modeLabel} · en línea</p>
          <h1 className="scripture-editor__title">
            {ctx ? `${ctx.book} ${ctx.ref}` : modeLabel}
          </h1>
          <p className="scripture-editor__meta">
            {ctx?.taskName ? `${ctx.taskName} · ` : ""}
            {marker ? `Revisión de ${draftLabel}` : "Sin revisión todavía"}
            {pull?.merged ? " · guardado en el borrador grupal" : ""}
            {ctx?.issueNumber ? ` · subtarea #${ctx.issueNumber}` : ""}
          </p>
        </div>
        <div className="scripture-editor__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          {marker?.htmlUrl ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open(marker.htmlUrl, "_blank", "noopener,noreferrer")}
            >
              Abrir en Door43
            </Button>
          ) : (
            <Button
              type="button"
              disabled={acting || !session}
              onClick={() => void openPr()}
            >
              {acting ? "Abriendo…" : "Abrir la revisión de esta subtarea"}
            </Button>
          )}
        </div>
      </header>

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">Cargando la revisión…</p>
      ) : (
        <div className="scripture-editor__body">
          <p className="text-sm text-muted-foreground">
            Una revisión por subtarea. Comenta los cambios aquí; Tomar / Aprobar
            siguen en Mis tareas. Nada se guarda en el borrador grupal al
            terminar pares — solo al Cerrar (Entrega).
          </p>

          {!marker ? (
            <p className="text-sm text-muted-foreground">
              Esta subtarea aún no tiene revisión. Ábrela cuando el borrador esté
              guardado, o márcalo hecho en Mis tareas.
            </p>
          ) : null}

          {files.length ? (
            <ul className="portion-review__files">
              {files.map((f) => (
                <li key={f.filename}>
                  <code>{f.filename}</code>
                  {f.status ? <span> · {f.status}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {diff ? (
            <pre className="portion-review__diff">{diff}</pre>
          ) : marker ? (
            <p className="text-sm text-muted-foreground">
              Sin cambios todavía ({draftLabel} puede coincidir con el borrador grupal).
            </p>
          ) : null}

          {marker ? (
            <div className="portion-review__comment">
              <Input
                placeholder="Comentario sobre estos cambios…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendComment();
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={acting || !comment.trim()}
                onClick={() => void sendComment()}
              >
                Enviar
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
