import { useEffect, useMemo, useState } from "react";
import { DcsApiError } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { dcsConfig } from "../dcs/config";
import { resolveBookBranchName } from "../dcs/bookBootstrap";
import { getBranchSha, getDefaultBranch } from "../dcs/pulls";
import {
  deleteGhostTrunkRef,
  probeTrunkRef,
  readFileAtSha,
  recreateTrunkFromDefault,
  recreateWorkRefFromSha,
  type RefRepairTarget,
} from "../dcs/refRepair";
import {
  bookBranchName,
  bookOnlyBranchName,
  portionPrBranchName,
  taskTrunkBranchName,
} from "../domain/portionPr";
import {
  ghostRefDeleteBlock,
  isWorkRefName,
  recreateTrunkBlock,
  recreateWorkRefBlock,
  usfmVerseText,
  workRefRecreateSource,
  type RefRepairContext,
  type TrunkRefProbe,
} from "../domain/qaAdmin";
import { bookUsfmName } from "../prep/discover";
import { QaTestScenarioSection } from "./QaTestScenarioSection";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: GtSession;
  defaultOwner: string;
  defaultRepo: string;
  defaultBook: string;
  defaultPmOrg: string;
};

type Confirm = { kind: "delete" | "recreate" | "recreateWork"; ref: string } | null;

/** Commit a ghost ref pointed at, kept after the ref is deleted. */
type GhostCommit = { ref: string; sha: string; verse: string | null };

function errorText(err: unknown): string {
  if (err instanceof DcsApiError) return `${err.message} (HTTP ${err.status})`;
  return err instanceof Error ? err.message : String(err);
}

function seen(value: boolean): string {
  return value ? "sí" : "no (404)";
}

export function QaAdminDialog({
  open,
  onOpenChange,
  session,
  defaultOwner,
  defaultRepo,
  defaultBook,
  defaultPmOrg,
}: Props) {
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [owner, setOwner] = useState(defaultOwner);
  const [repo, setRepo] = useState(defaultRepo);
  const [book, setBook] = useState(defaultBook);
  const [taskId, setTaskId] = useState("");
  const [workUser, setWorkUser] = useState("");
  const [workIssue, setWorkIssue] = useState("");
  const [refName, setRefName] = useState("");
  const [editorRef, setEditorRef] = useState<string | null>(null);
  const [trunkSha, setTrunkSha] = useState<string | null>(null);
  const [ghost, setGhost] = useState<GhostCommit | null>(null);
  const [ctx, setCtx] = useState<RefRepairContext | null>(null);
  const [probe, setProbe] = useState<TrunkRefProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [typed, setTyped] = useState("");

  const filepath = bookUsfmName(book || "NEH");
  const workRef = useMemo(() => {
    const issue = Number(workIssue);
    if (!workUser.trim() || !Number.isInteger(issue) || issue <= 0) return "";
    return portionPrBranchName({ book, username: workUser, taskId, issueNumber: issue });
  }, [book, taskId, workUser, workIssue]);
  const candidates = useMemo(() => {
    const list = [
      taskTrunkBranchName(book, taskId),
      bookBranchName(book, taskId),
      bookOnlyBranchName(book),
      ...(workRef ? [workRef] : []),
    ];
    return [...new Set(list)];
  }, [book, taskId, workRef]);
  const isWork = isWorkRefName(refName);
  const ghostForRef = ghost && ghost.ref === refName ? ghost : null;
  const workSource = isWork
    ? workRefRecreateSource({ ghostSha: ghostForRef?.sha, trunkSha })
    : null;

  useEffect(() => {
    if (!candidates.includes(refName)) setRefName(candidates[0] ?? "");
    setProbe(null);
    setEditorRef(null);
    setTrunkSha(null);
  }, [candidates, refName]);

  useEffect(() => {
    if (!open) return;
    setOwner((prev) => prev || defaultOwner);
    setRepo((prev) => prev || defaultRepo);
    setBook((prev) => prev || defaultBook);
  }, [open, defaultOwner, defaultRepo, defaultBook]);

  const target: RefRepairTarget = { session, owner: owner.trim(), repo: repo.trim(), filepath };

  async function inspect(name = refName) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const config = dcsConfig(session.host);
      const [defaultBranch, resolved, row] = await Promise.all([
        getDefaultBranch(config, target.owner, target.repo, session.token),
        resolveBookBranchName({
          session,
          owner: target.owner,
          repo: target.repo,
          book,
          taskId,
          filepath,
        }),
        probeTrunkRef(target, name),
      ]);
      setCtx({ defaultBranch, bookOnlyBranch: bookOnlyBranchName(book) });
      setEditorRef(resolved.bookBranch);
      setProbe(row);
      if (isWorkRefName(name)) {
        setTrunkSha(
          await getBranchSha(config, target.owner, target.repo, resolved.bookBranch, session.token),
        );
        if (row.gitRefSha) await rememberGhost(name, row.gitRefSha);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function rememberGhost(ref: string, sha: string) {
    const text = await readFileAtSha(target, sha);
    setGhost({ ref, sha, verse: text ? usfmVerseText(text, 1, 1) : null });
  }

  async function runConfirmed() {
    if (!confirm || !ctx) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (confirm.kind === "delete") {
        const { before, after } = await deleteGhostTrunkRef(target, confirm.ref, ctx, typed);
        if (isWorkRefName(confirm.ref) && before.gitRefSha && ghost?.sha !== before.gitRefSha) {
          await rememberGhost(confirm.ref, before.gitRefSha);
        }
        setProbe(after);
        setNotice(
          after.gitRefSha
            ? `DCS aceptó el DELETE pero la ref «${confirm.ref}» sigue existiendo.`
            : `Ref fantasma «${confirm.ref}» borrada (apuntaba a ${before.gitRefSha?.slice(0, 12) ?? "—"}).`,
        );
      } else if (confirm.kind === "recreateWork") {
        if (!workSource) throw new Error("Falta el SHA de origen.");
        const after = await recreateWorkRefFromSha(target, confirm.ref, ctx, workSource.sha);
        setProbe(after);
        const from = workSource.origin === "ghost" ? "commit que ya tenía la ref" : "punta del tronco";
        setNotice(
          after.branchApi && after.fileApi
            ? `Rama «${confirm.ref}» creada desde ${workSource.sha.slice(0, 12)} (${from}); ${filepath} visible.`
            : `Rama «${confirm.ref}» creada, pero ramas: ${seen(after.branchApi)}, archivo: ${seen(after.fileApi)}.`,
        );
      } else {
        const after = await recreateTrunkFromDefault(target, confirm.ref, ctx);
        setProbe(after);
        setNotice(
          after.branchApi && after.fileApi
            ? `Rama «${confirm.ref}» creada desde «${ctx.defaultBranch}»; ${filepath} visible.`
            : `Rama «${confirm.ref}» creada, pero ramas: ${seen(after.branchApi)}, archivo: ${seen(after.fileApi)}.`,
        );
      }
      setConfirm(null);
      setTyped("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const deleteBlock = probe && ctx ? ghostRefDeleteBlock(probe, ctx, probe.name) : "Comprueba primero.";
  const recreateBlock = !probe || !ctx
    ? "Comprueba primero."
    : isWork
      ? recreateWorkRefBlock(probe, ctx, workSource?.sha)
      : recreateTrunkBlock(probe, ctx);
  const confirmBlock =
    confirm?.kind === "delete" && probe && ctx
      ? ghostRefDeleteBlock(probe, ctx, typed)
      : confirm?.kind === "recreate" && probe && ctx
        ? recreateTrunkBlock(probe, ctx)
        : confirm?.kind === "recreateWork" && probe && ctx
          ? recreateWorkRefBlock(probe, ctx, workSource?.sha)
          : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => !busy && !scenarioBusy && !confirm && onOpenChange(next)}
      >
        <DialogContent className="max-w-lg qa-admin" showCloseButton={!busy && !scenarioBusy}>
          <DialogHeader>
            <DialogTitle>Administración (QA)</DialogTitle>
            <DialogDescription>
              Reparar refs git del tronco o de trabajo (w/…) y preparar una prueba de conflicto en{" "}
              {session.host}. Solo fuera de producción.
            </DialogDescription>
          </DialogHeader>

          <div className="qa-admin__grid">
            <Label htmlFor="qa-owner">Organización</Label>
            <Input id="qa-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
            <Label htmlFor="qa-repo">Repositorio</Label>
            <Input id="qa-repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <Label htmlFor="qa-book">Libro</Label>
            <Input
              id="qa-book"
              value={book}
              onChange={(e) => setBook(e.target.value.toUpperCase())}
            />
            <Label htmlFor="qa-task">Id de tarea</Label>
            <Input
              id="qa-task"
              value={taskId}
              placeholder="6f1e771e-2f2d-…"
              onChange={(e) => setTaskId(e.target.value.trim())}
            />
            <Label htmlFor="qa-work-user">Usuario (ref w/)</Label>
            <Input
              id="qa-work-user"
              value={workUser}
              placeholder="opcional"
              onChange={(e) => setWorkUser(e.target.value.trim())}
            />
            <Label htmlFor="qa-work-issue">Issue (ref w/)</Label>
            <Input
              id="qa-work-issue"
              value={workIssue}
              inputMode="numeric"
              placeholder="opcional"
              onChange={(e) => setWorkIssue(e.target.value.trim())}
            />
            <Label htmlFor="qa-ref">Ref</Label>
            <Select value={refName} onValueChange={setRefName}>
              <SelectTrigger id="qa-ref" aria-label="Ref a reparar">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="qa-admin__actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !owner.trim() || !repo.trim() || !refName}
              onClick={() => void inspect()}
            >
              {busy ? "Comprobando…" : "1. Comprobar ref"}
            </Button>
          </div>

          {probe ? (
            <dl className="qa-admin__probe">
              <dt>Tronco que usa el editor</dt>
              <dd><code>{editorRef ?? "—"}</code></dd>
              <dt>Ref comprobada</dt>
              <dd><code>{probe.name}</code></dd>
              <dt>Ref git</dt>
              <dd>{probe.gitRefSha ? <code>{probe.gitRefSha.slice(0, 12)}</code> : "no existe"}</dd>
              <dt>API de ramas</dt>
              <dd>{seen(probe.branchApi)}</dd>
              <dt>API de archivos ({filepath})</dt>
              <dd>{seen(probe.fileApi)}</dd>
              <dt>Rama por defecto</dt>
              <dd><code>{ctx?.defaultBranch ?? "—"}</code></dd>
              {isWork ? (
                <>
                  <dt>Punta del tronco</dt>
                  <dd>{trunkSha ? <code>{trunkSha.slice(0, 12)}</code> : "—"}</dd>
                  <dt>Commit guardado de la ref</dt>
                  <dd>{ghostForRef ? <code>{ghostForRef.sha}</code> : "—"}</dd>
                  <dt>1:1 en ese commit</dt>
                  <dd>{ghostForRef ? ghostForRef.verse ?? "(no se pudo leer)" : "—"}</dd>
                  <dt>Origen al recrear</dt>
                  <dd>
                    {workSource
                      ? `${workSource.sha.slice(0, 12)} (${workSource.origin === "ghost" ? "commit que ya tenía la ref" : "punta del tronco"})`
                      : "—"}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}

          <div className="qa-admin__actions">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy || Boolean(deleteBlock)}
              title={deleteBlock ?? undefined}
              onClick={() => {
                setTyped("");
                setConfirm({ kind: "delete", ref: refName });
              }}
            >
              2. Borrar ref fantasma
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || Boolean(recreateBlock)}
              title={recreateBlock ?? undefined}
              onClick={() => setConfirm({ kind: isWork ? "recreateWork" : "recreate", ref: refName })}
            >
              {isWork
                ? `3. Crear rama desde ${workSource?.sha.slice(0, 12) ?? "SHA"}`
                : `3. Crear rama desde ${ctx?.defaultBranch ?? "master"}`}
            </Button>
          </div>
          {probe && (deleteBlock || recreateBlock) ? (
            <p className="qa-admin__hint">
              {deleteBlock ? `Borrar: ${deleteBlock}` : null}
              {deleteBlock && recreateBlock ? " · " : null}
              {recreateBlock ? `Crear: ${recreateBlock}` : null}
            </p>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          <p className="qa-admin__hint">
            Para rehacer la rama de trabajo y el archivo de una subtarea usa
            «Rehacer mi borrador» en el editor de Escritura.
          </p>

          <QaTestScenarioSection
            session={session}
            defaultPmOrg={defaultPmOrg}
            owner={owner}
            repo={repo}
            book={book}
            onBusyChange={setScenarioBusy}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={open && Boolean(confirm)}
        onOpenChange={(next) => {
          if (busy) return;
          if (!next) {
            setConfirm(null);
            setTyped("");
          }
        }}
      >
        <DialogContent className="max-w-md" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "delete"
                ? "Borrar ref fantasma"
                : confirm?.kind === "recreateWork"
                  ? "Crear rama de trabajo"
                  : "Crear rama del tronco"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "delete" ? (
                <>
                  Se enviará <code>DELETE git/refs/heads/{confirm.ref}</code> a {owner}/{repo}.
                  Solo si la API de ramas y la de archivos siguen dando 404.
                  {isWorkRefName(confirm.ref) && ghostForRef
                    ? ` El commit ${ghostForRef.sha.slice(0, 12)} queda anotado para recrearla.`
                    : null}
                </>
              ) : confirm?.kind === "recreateWork" ? (
                <>
                  Se enviará <code>POST /branches</code> con <code>new_branch_name={confirm.ref}</code> y{" "}
                  <code>old_ref_name={workSource?.sha ?? "—"}</code> (
                  {workSource?.origin === "ghost" ? "commit que ya tenía la ref" : "punta del tronco"}) a{" "}
                  {owner}/{repo}.
                </>
              ) : confirm ? (
                <>
                  Se enviará <code>POST /branches</code> con <code>new_branch_name={confirm.ref}</code> y{" "}
                  <code>old_ref_name={ctx?.defaultBranch}</code> a {owner}/{repo}.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <p className="qa-admin__ref"><code>{confirm?.ref}</code></p>
          {confirm?.kind === "delete" ? (
            <div className="qa-admin__grid">
              <Label htmlFor="qa-confirm">Escribe la ref</Label>
              <Input
                id="qa-confirm"
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          ) : null}
          {confirmBlock && confirm?.kind === "delete" && typed ? (
            <p className="qa-admin__hint">{confirmBlock}</p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                setTyped("");
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={confirm?.kind === "delete" ? "destructive" : "default"}
              disabled={busy || Boolean(confirmBlock)}
              onClick={() => void runConfirmed()}
            >
              {busy ? "Enviando…" : confirm?.kind === "delete" ? "Borrar ref" : "Crear rama"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
