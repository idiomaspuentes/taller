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
import { useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeScope } from "../domain/scopeNames";
import { bookLabel, isBookProjectId } from "../domain/books";
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
  /** File name or folder for «json» and «dcs»; for «issues» it is built from the counts when shown. */
  detail: string;
  created?: number;
  updated?: number;
  closed?: number;
  openCount?: number;
  enabledSelfAssign?: boolean;
};

function previewSummary(preview: PublishPreview, t: (key: MessageKey) => string): string {
  const parts = [
    t("pb.create").replace("{n}", String(preview.created)),
    t("pb.update").replace("{n}", String(preview.updated)),
    t("pb.close").replace("{n}", String(preview.closed)),
  ];
  return parts.join(" · ");
}

function deliveredDetail(d: Delivered, t: (key: MessageKey) => string): string {
  if (d.kind !== "issues") return d.detail;
  return (
    t("pb.detail").replace("{created}", String(d.created ?? 0)).replace("{updated}", String(d.updated ?? 0)) +
    (d.closed ? t("pb.detailRemoved").replace("{n}", String(d.closed)) : "")
  );
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
  const t = useT();
  const language = useUiLanguage();
  const n = (key: MessageKey, count: number) => t(key).replace("{n}", String(count));
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
  const projectTitle =
    board.kind === "book" && isBookProjectId(projectId) ? bookLabel(projectId, language) : board.title || projectId;
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
    announce(t("pb.downloaded"));
  }

  async function saveRemote() {
    setMoreOpen(false);
    if (!session) {
      setError(t("pb.signInToSave"));
      return;
    }
    if (!pmOrg) {
      setError(t("pb.pickOrg"));
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
      announce(t("pb.savedIn").replace("{path}", path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Fetch dry-run counts, then open confirm dialog. */
  async function requestPublish() {
    if (!session || !pmOrg || !inventory) {
      setError(t("pb.needAll"));
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
      setError(t("pb.needAll"));
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
            t("pb.progress")
              .replace("{done}", String(p.done))
              .replace("{total}", String(p.total))
              .replace("{current}", localizeScope(p.current ?? "", language))
              .replace("{created}", String(p.created))
              .replace("{updated}", String(p.updated)),
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
        detail: "",
        created: result.created,
        updated: result.updated,
        closed: result.closed,
        openCount: openOrderCount,
        enabledSelfAssign,
      });
      announce(
        t("pb.published").replace("{created}", String(result.created)).replace("{updated}", String(result.updated)) +
          (result.closed ? t("pb.publishedRemoved").replace("{n}", String(result.closed)) : "") +
          (enabledSelfAssign ? t("pb.selfAssignOn") : ""),
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
      setError(t("pb.signInToSync"));
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
      announce(n("pb.syncedFrom", issues.length));
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
        announce(t("pb.imported"));
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
          <h1 className="hub-title">{t("pb.title")}</h1>
          <p className="hub-lede">
            {t("pb.lede")}<strong>{projectTitle}</strong>
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
                ? t("pb.publishing")
                : previewing
                  ? t("pb.calculating")
                  : `${t("pb.publish")}${orderCount ? ` (${orderCount})` : ""}`}
            </Button>
          ) : (
            <Button type="button" onClick={download}>
              {t("pb.download")}
            </Button>
          )}
          {canSave ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void syncFromIssues()}
            >
              {t("pb.refresh")}
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
              {t("pb.more")}
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
                    {t("pb.saveOnly")}
                  </button>
                ) : null}
                {canSave ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="phases-menu__item"
                    onClick={download}
                  >
                    {t("pb.download")}
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
                  {t("pb.import")}
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
          <span className="hub-empty-panel__kicker">{t("pb.publishedKicker")}</span>
          <h2 className="hub-empty-panel__title">
            {(delivered.created ?? 0) + (delivered.updated ?? 0) > 0
              ? t("pb.subtasksPublished")
              : t("pb.nothingNew")}
          </h2>
          <p className="hub-empty-panel__body">
            {t("pb.createdUpdated").replace("{c}", String(delivered.created ?? 0)).replace("{u}", String(delivered.updated ?? 0))}
            {delivered.closed ? t("pb.orphansClosed") : ""}
            {delivered.openCount ? n("pb.unassignedAvailable", delivered.openCount) : ""}
            {delivered.enabledSelfAssign ? t("pb.selfAssignEnabled") : t("pb.existingUpdated")}
          </p>
          <div className="hub-empty-panel__actions">
            {onGoToMyTasks ? (
              <Button type="button" size="sm" onClick={onGoToMyTasks}>
                {t("pb.goMyTasks")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void syncFromIssues()}
            >
              {t("pb.refreshPlan")}
            </Button>
          </div>
        </div>
      ) : lastPublish ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t("pb.alreadyPublished")}</Badge>
            <span className="text-sm">
              {t("pb.lastPublishLine")
                .replace("{when}", new Date(lastPublish.at).toLocaleString(language))
                .replace("{c}", String(lastPublish.created))
                .replace("{u}", String(lastPublish.updated))}
            </span>
            {onGoToMyTasks ? (
              <Button type="button" size="sm" variant="outline" onClick={onGoToMyTasks}>
                {t("pb.myTasks")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : delivered ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {delivered.kind === "dcs" ? t("pb.planSaved") : t("pb.downloadedBadge")}
            </Badge>
            <span className="text-sm">{delivered.detail}</span>
          </AlertDescription>
        </Alert>
      ) : null}

      {!canSave ? (
        <p className="hub-hint">
          {session
            ? t("pb.hintSession")
            : t("pb.hintNoSession")}
        </p>
      ) : null}

      {needsSelfAssignHint ? (
        <Alert>
          <AlertDescription>
            {openOrderCount === 1 ? t("pb.selfAssignHintOne") : n("pb.selfAssignHint", openOrderCount)}
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
            {helpOpen ? t("tv.hideHelp") : t("tv.howItWorks")}
          </button>
          {helpOpen ? (
            <p className="hub-hint">
              {t("pb.help")}
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
          <span className="hub-empty-panel__kicker">{t("pb.inventoryKicker")}</span>
          <h2 className="hub-empty-panel__title">{t("pb.missingInventory")}</h2>
          <p className="hub-empty-panel__body">
            {t("pb.missingInventoryBody")}
          </p>
        </div>
      ) : !board.teams.length ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">{t("pb.phasesKicker")}</span>
          <h2 className="hub-empty-panel__title">{t("pb.noPhases")}</h2>
          <p className="hub-empty-panel__body">
            {t("pb.noPhasesBody")}
          </p>
        </div>
      ) : orderCount === 0 ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">{t("pb.emptyKicker")}</span>
          <h2 className="hub-empty-panel__title">{t("pb.nothingToPublish")}</h2>
          <p className="hub-empty-panel__body">
            {t("pb.nothingToPublishBody")}
          </p>
        </div>
      ) : (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("pb.summary")}</CardTitle>
            <CardDescription>
              {publishedIssues
                ? t("pb.lastPublication").replace("{d}", delivered ? deliveredDetail(delivered, t) : "")
                : lastPublish
                  ? t("pb.editAndRepublish")
                  : t("pb.confirmQueue")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat value={orderCount} label={t("pb.statSubtasks")} />
              <Stat value={assignedOrderCount} label={t("pb.statWithPerson")} />
              <Stat value={openOrderCount} label={t("pb.statUnassigned")} />
            </div>

            {byPerson.length ? (
              <>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("pb.loadByPerson")}
                </h3>
                <div className="grid gap-1.5">
                  {byPerson.map(({ person, count }) => (
                    <div key={person.id} className="flex items-center justify-between gap-3">
                      <div>
                        <strong className="font-medium">{person.name}</strong>
                        <div className="text-xs text-muted-foreground">{n("pb.nItems", count)}</div>
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
                  {t("pb.byPhase")}
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
              {preview?.existingOpen || lastPublish ? t("pb.confirmRepublish") : t("pb.confirmPublish")}
            </DialogTitle>
            <DialogDescription>
              {preview
                ? (preview.totalOrders === 1 ? t("pb.planOfOne") : t("pb.planOf").replace("{n}", String(preview.totalOrders))).replace("{title}", projectTitle)
                : t("pb.computing")}
            </DialogDescription>
          </DialogHeader>

          {preview ? (
            <div className="grid gap-3">
              <p className="text-sm font-medium tabular-nums text-foreground">
                {previewSummary(preview, t)}
              </p>
              <ul className="grid gap-1.5 text-sm text-muted-foreground">
                <li>
                  {boldCount(t(preview.created === 1 ? "pb.createOne" : "pb.createMany"), preview.created)}
                </li>
                <li>
                  {boldCount(t(preview.updated === 1 ? "pb.updateOne" : "pb.updateMany"), preview.updated)}
                </li>
                <li>
                  {boldCount(t(preview.closed === 1 ? "pb.closeOne" : "pb.closeMany"), preview.closed)}
                </li>
              </ul>
              {preview.scopeChanged ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t("pb.scopeChanged")}
                  </AlertDescription>
                </Alert>
              ) : preview.existingOpen > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {preview.existingOpen === 1 ? t("pb.existingOpenOne") : n("pb.existingOpen", preview.existingOpen)}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("pb.firstPublish")}
                </p>
              )}
              {openOrderCount > 0 && !selfAssignOn ? (
                <p className="text-sm text-muted-foreground">
                  {t("pb.willEnableSelf")}
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
              {t("pb.cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy || !preview || preview.totalOrders === 0}
              onClick={() => void publish()}
            >
              {busy ? t("pb.publishing") : t("pb.confirmAndPublish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** «{n} crear subtarea nueva» with the number in bold. */
function boldCount(template: string, count: number) {
  const [before, after] = template.split("{n}");
  return (
    <>
      {before}
      <strong className="text-foreground">{count}</strong>
      {after}
    </>
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
