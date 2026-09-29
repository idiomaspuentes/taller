import { useEffect, useRef, useState } from "react";
import type { AssignmentsDoc, InventoryDoc } from "../domain/types";
import { loadByPerson } from "../domain/assignment";
import { publishableWorkOrders } from "../domain/workOrder";
import { normalizeAssignmentsDoc, projectAllowsSelfAssign, toExportDoc } from "../domain/store";
import type { GtSession } from "../dcs/auth";
import { saveProjectToDcs } from "../dcs/persist";
import {
  previewPublishWorkOrders,
  publishWorkOrders,
  pullIssues,
  type PublishPreview,
} from "../dcs/issues";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  board: AssignmentsDoc;
  inventory: InventoryDoc | null;
  session: GtSession | null;
  pmOrg: string;
  onImported: (doc: AssignmentsDoc) => void;
  onGoToMyTasks?: () => void;
  announce: (msg: string) => void;
};

type Delivered = {
  kind: "json" | "dcs" | "issues";
  at: number;
  detail: string;
  created?: number;
  updated?: number;
  openCount?: number;
  enabledSelfAssign?: boolean;
};

function previewSummary(preview: PublishPreview): string {
  const parts = [
    `${preview.created} crear`,
    `${preview.updated} actualizar`,
    `${preview.closed} cerrar`,
  ];
  return parts.join(" · ");
}

export function PublishView({
  board,
  inventory,
  session,
  pmOrg,
  onImported,
  onGoToMyTasks,
  announce,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delivered, setDelivered] = useState<Delivered | null>(null);
  const [progress, setProgress] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const projectId = board.projectId || board.book;
  const byPerson = loadByPerson(board.assignments, board.people);
  const publishOrders = inventory ? publishableWorkOrders(board, inventory) : [];
  const orderCount = publishOrders.length;
  const assignedOrderCount = publishOrders.filter((order) => order.assignee).length;
  const openOrderCount = orderCount - assignedOrderCount;
  const ordersByTeam = board.teams
    .map((team) => ({
      team,
      count: publishOrders.filter((order) => order.teamId === team.id).length,
    }))
    .filter((row) => row.count > 0);
  const selfAssignOn = projectAllowsSelfAssign(board);
  const canSave = Boolean(session && pmOrg);
  const canPublish = Boolean(canSave && inventory && orderCount > 0);
  const publishedIssues = delivered?.kind === "issues";
  const lastPublish = board.settings?.lastPublish;
  const needsSelfAssignHint =
    canSave && openOrderCount > 0 && !selfAssignOn && !publishedIssues && !lastPublish;

  useEffect(() => {
    if (!moreOpen) return;
    function onDocClick(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [moreOpen]);

  function download() {
    setMoreOpen(false);
    const doc = toExportDoc(board);
    const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gateway-${board.lang}-${projectId}-asignaciones.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDelivered({
      kind: "json",
      at: Date.now(),
      detail: `gateway-${board.lang}-${projectId}-asignaciones.json`,
    });
    announce("Plan descargado.");
  }

  async function saveRemote() {
    setMoreOpen(false);
    if (!session) {
      setError("Inicia sesión para guardar en DCS.");
      return;
    }
    if (!pmOrg) {
      setError("Elige la organización PM en el espacio de trabajo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveProjectToDcs({
        session,
        org: pmOrg,
        lang: board.lang,
        book: projectId,
        assignments: board,
        inventory,
      });
      const path = `${pmOrg}/gateway-tasks/${board.lang}/${projectId}/`;
      setDelivered({ kind: "dcs", at: Date.now(), detail: path });
      announce(`Guardado en ${path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Fetch dry-run counts, then open confirm dialog. */
  async function requestPublish() {
    if (!session || !pmOrg || !inventory) {
      setError("Necesitas sesión, organización PM e inventario para publicar.");
      return;
    }
    setPreviewing(true);
    setError("");
    try {
      const next = await previewPublishWorkOrders({
        session,
        org: pmOrg,
        board,
        inventory,
      });
      setPreview(next);
      setConfirmOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  }

  /** Saves the plan and publishes subtareas — one deliver action. */
  async function publish() {
    if (!session || !pmOrg || !inventory) {
      setError("Necesitas sesión, organización PM e inventario para publicar.");
      return;
    }
    setConfirmOpen(false);
    setBusy(true);
    setError("");
    setProgress("");
    setDelivered(null);
    try {
      let nextBoard = board;
      let enabledSelfAssign = false;
      if (openOrderCount > 0 && !projectAllowsSelfAssign(board)) {
        nextBoard = {
          ...board,
          settings: { ...board.settings, allowSelfAssign: true },
        };
        enabledSelfAssign = true;
      }

      const result = await publishWorkOrders({
        session,
        org: pmOrg,
        board: nextBoard,
        inventory,
        onProgress: (p) =>
          setProgress(
            `${p.done}/${p.total} · ${p.current ?? ""} (${p.created} nuevos, ${p.updated} actualizados)`,
          ),
      });

      nextBoard = {
        ...nextBoard,
        settings: {
          ...nextBoard.settings,
          lastPublish: {
            at: new Date().toISOString(),
            created: result.created,
            updated: result.updated,
          },
        },
      };
      onImported(nextBoard);

      await saveProjectToDcs({
        session,
        org: pmOrg,
        lang: nextBoard.lang,
        book: projectId,
        assignments: nextBoard,
        inventory,
      });

      setDelivered({
        kind: "issues",
        at: Date.now(),
        detail:
          `${result.created} creados, ${result.updated} actualizados` +
          (result.closed ? `, ${result.closed} retirados` : ""),
        created: result.created,
        updated: result.updated,
        openCount: openOrderCount,
        enabledSelfAssign,
      });
      announce(
        `Publicado: ${result.created} nuevos, ${result.updated} actualizados` +
          (result.closed ? `, ${result.closed} retirados` : "") +
          (enabledSelfAssign ? " · autoasignación activada" : ""),
      );
      requestAnimationFrame(() => {
        successRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress("");
      setPreview(null);
    }
  }

  async function syncFromIssues() {
    if (!session || !pmOrg) {
      setError("Inicia sesión para sincronizar desde issues.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { assignments, issues } = await pullIssues({
        session,
        org: pmOrg,
        book: projectId,
        board,
      });
      onImported({ ...board, assignments });
      announce(`Sincronizado desde ${issues.length} issues.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function importFile(file: File) {
    setMoreOpen(false);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        const normalized = normalizeAssignmentsDoc(parsed, {
          book: board.book,
          lang: board.lang,
          contentOrg: board.contentOrg,
          pmOrg: board.pmOrg || pmOrg,
        });
        onImported(normalized);
        setDelivered(null);
        announce("Asignaciones importadas.");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">Entregar</h1>
          <p className="hub-lede">
            Publica subtareas en DCS · <strong>{board.title || projectId}</strong>
            {session && pmOrg ? (
              <>
                {" "}
                · <span className="font-mono">{pmOrg}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canSave ? (
            <Button
              type="button"
              disabled={busy || previewing || !canPublish}
              onClick={() => void requestPublish()}
            >
              {busy
                ? "Publicando…"
                : previewing
                  ? "Calculando…"
                  : `Publicar${orderCount ? ` (${orderCount})` : ""}`}
            </Button>
          ) : (
            <Button type="button" onClick={download}>
              Descargar
            </Button>
          )}
          {canSave ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void syncFromIssues()}
            >
              Sincronizar
            </Button>
          ) : null}
          <div className="phases-create" ref={moreRef}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              disabled={busy}
              onClick={() => setMoreOpen((v) => !v)}
            >
              Más
            </Button>
            {moreOpen ? (
              <div className="phases-menu phases-menu--end" role="menu">
                {canSave ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="phases-menu__item"
                    onClick={() => void saveRemote()}
                  >
                    Solo guardar plan
                  </button>
                ) : null}
                {canSave ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="phases-menu__item"
                    onClick={download}
                  >
                    Descargar
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="phases-menu__item"
                  onClick={() => {
                    setMoreOpen(false);
                    fileRef.current?.click();
                  }}
                >
                  Importar
                </button>
              </div>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {progress ? (
        <Alert>
          <AlertDescription>{progress}</AlertDescription>
        </Alert>
      ) : null}

      {delivered?.kind === "issues" ? (
        <div className="hub-empty-panel" ref={successRef} data-publish-success="true">
          <span className="hub-empty-panel__kicker">Publicado</span>
          <h2 className="hub-empty-panel__title">
            {(delivered.created ?? 0) + (delivered.updated ?? 0) > 0
              ? "Subtareas en DCS"
              : "Nada nuevo que publicar"}
          </h2>
          <p className="hub-empty-panel__body">
            {delivered.created ?? 0} creadas · {delivered.updated ?? 0} actualizadas
            {delivered.detail.includes("retirados")
              ? ` · huérfanas cerradas`
              : ""}
            {delivered.openCount
              ? ` · ${delivered.openCount} sin asignar (Disponibles en Mis tareas)`
              : ""}
            {delivered.enabledSelfAssign
              ? ". Se activó la autoasignación del proyecto para que el equipo pueda Tomar."
              : ". Las subtareas que ya existían se actualizan; las que ya no están en el plan se cierran."}
          </p>
          <div className="hub-empty-panel__actions">
            {onGoToMyTasks ? (
              <Button type="button" size="sm" onClick={onGoToMyTasks}>
                Ir a Mis tareas
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void syncFromIssues()}
            >
              Sincronizar plan
            </Button>
          </div>
        </div>
      ) : lastPublish ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Ya publicado</Badge>
            <span className="text-sm">
              {new Date(lastPublish.at).toLocaleString("es")} · {lastPublish.created} creadas,{" "}
              {lastPublish.updated} actualizadas. Publicar de nuevo actualiza las mismas subtareas y
              cierra las que ya no están en el plan.
            </span>
            {onGoToMyTasks ? (
              <Button type="button" size="sm" variant="outline" onClick={onGoToMyTasks}>
                Mis tareas
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : delivered ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {delivered.kind === "dcs" ? "Plan guardado" : "Descargado"}
            </Badge>
            <span className="text-sm">{delivered.detail}</span>
          </AlertDescription>
        </Alert>
      ) : null}

      {!canSave ? (
        <p className="hub-hint">
          {session
            ? "Elige la organización PM en el espacio de trabajo para publicar."
            : "Descarga el plan ahora. Para publicar, inicia sesión desde el espacio de trabajo."}
        </p>
      ) : null}

      {needsSelfAssignHint ? (
        <Alert>
          <AlertDescription>
            Hay {openOrderCount} subtareas sin asignar. Activa «Permitir autoasignación» en Fases y
            tareas para que los trabajadores puedan Tomarlas en Mis tareas.
          </AlertDescription>
        </Alert>
      ) : null}

      {canSave ? (
        <div className="grid gap-1.5">
          <button
            type="button"
            className="w-fit text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setHelpOpen((v) => !v)}
          >
            {helpOpen ? "Ocultar ayuda" : "¿Cómo funciona?"}
          </button>
          {helpOpen ? (
            <p className="hub-hint">
              Publicar guarda el plan y crea o actualiza las subtareas en DCS. Antes de aplicar verás
              cuántas se crean, actualizan o cierran (si el alcance cambió). Puedes publicar sin
              asignar personas: salen libres para Tomar si la autoasignación está activa. Usa Más →
              Solo guardar plan si aún no quieres crear issues. Sincronizar trae el estado desde DCS.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!inventory ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">Inventario</span>
          <h2 className="hub-empty-panel__title">Falta el inventario</h2>
          <p className="hub-empty-panel__body">
            Completa Inventario antes de publicar subtareas.
          </p>
        </div>
      ) : !board.teams.length ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">Fases</span>
          <h2 className="hub-empty-panel__title">Sin fases todavía</h2>
          <p className="hub-empty-panel__body">
            Define al menos una tarea en Fases y tareas para generar la cola de subtareas.
          </p>
        </div>
      ) : orderCount === 0 ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">Vacío</span>
          <h2 className="hub-empty-panel__title">Nada que publicar</h2>
          <p className="hub-empty-panel__body">
            Las fases no tienen alcance con ítems en el inventario. Ajusta el alcance o vuelve a
            Inventario.
          </p>
        </div>
      ) : (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Resumen</CardTitle>
            <CardDescription>
              {publishedIssues
                ? `Última publicación: ${delivered?.detail}.`
                : lastPublish
                  ? "Edita asignaciones y vuelve a publicar para actualizar subtareas existentes."
                  : "Confirma la cola antes de publicar."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat value={orderCount} label="Subtareas" />
              <Stat value={assignedOrderCount} label="Con persona" />
              <Stat value={openOrderCount} label="Sin asignar" />
            </div>

            {byPerson.length ? (
              <>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Carga por persona
                </h3>
                <div className="grid gap-1.5">
                  {byPerson.map(({ person, count }) => (
                    <div key={person.id} className="flex items-center justify-between gap-3">
                      <div>
                        <strong className="font-medium">{person.name}</strong>
                        <div className="text-xs text-muted-foreground">{count} ítems</div>
                      </div>
                      <span
                        className="block h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-full bg-primary"
                          style={{
                            width: `${Math.min(
                              100,
                              (count / Math.max(1, board.assignments.length)) * 100,
                            )}%`,
                          }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {ordersByTeam.length ? (
              <>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Por fase
                </h3>
                <div className="grid gap-1.5">
                  {ordersByTeam.map(({ team, count }) => (
                    <div
                      key={team.id}
                      className="flex items-baseline justify-between gap-3 border-b border-border/70 py-1.5 last:border-0"
                    >
                      <div className="min-w-0">
                        <strong className="font-medium">{team.name}</strong>
                        {team.description?.trim() ? (
                          <p className="truncate text-sm text-muted-foreground">
                            {team.description.trim()}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setConfirmOpen(open);
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-w-md" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {preview?.existingOpen || lastPublish ? "Confirmar republicación" : "Confirmar publicación"}
            </DialogTitle>
            <DialogDescription>
              {preview
                ? `Plan de ${board.title || projectId}: ${preview.totalOrders} subtareas en total.`
                : "Calculando impacto…"}
            </DialogDescription>
          </DialogHeader>

          {preview ? (
            <div className="grid gap-3">
              <p className="text-sm font-medium tabular-nums text-foreground">
                {previewSummary(preview)}
              </p>
              <ul className="grid gap-1.5 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">{preview.created}</strong> crear
                  {preview.created === 1 ? " subtarea nueva" : " subtareas nuevas"}
                </li>
                <li>
                  <strong className="text-foreground">{preview.updated}</strong> actualizar
                  {preview.updated === 1 ? " existente" : " existentes"} (misma clave)
                </li>
                <li>
                  <strong className="text-foreground">{preview.closed}</strong> cerrar
                  {preview.closed === 1 ? " huérfana" : " huérfanas"} (ya no están en el plan)
                </li>
              </ul>
              {preview.scopeChanged ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    El alcance cambió: se cerrarán subtareas abiertas que ya no coinciden con el
                    plan. El historial queda en DCS; no se borran.
                  </AlertDescription>
                </Alert>
              ) : preview.existingOpen > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Hay {preview.existingOpen} subtareas abiertas en este proyecto. Se reutilizan las
                  que coinciden; no se vacía el proyecto.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Primera publicación de esta cola (o no hay subtareas abiertas con marcador).
                </p>
              )}
              {openOrderCount > 0 && !selfAssignOn ? (
                <p className="text-sm text-muted-foreground">
                  Se activará la autoasignación para que el equipo pueda Tomar lo libre.
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                setPreview(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={busy || !preview || preview.totalOrders === 0}
              onClick={() => void publish()}
            >
              {busy ? "Publicando…" : "Confirmar y publicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2.5 py-2">
      <strong className="block text-xl font-semibold tracking-tight">{value}</strong>
      <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}
