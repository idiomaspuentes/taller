import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { saveProjectChanges, useProjectWork, workChanged } from "../dcs/projectPlan";
import { explainError } from "../dcs/userError";
import type { AssignmentsDoc, InventoryDoc } from "../domain/types";
import { publishableWorkOrders } from "../domain/workOrder";
import { useT } from "../i18n/messages";
import { WorkPreview } from "./WorkPreview";

type Props = {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  inventory: InventoryDoc;
  onSaved: (board: AssignmentsDoc) => void;
  announce: (msg: string) => void;
};

/**
 * «Subtareas» of a project under way: every subtarea the project lays out and how each one stands in Door43. A
 * subtarea is added by hand here, a long chapter is split, and what the plan has and Door43 does not is created.
 */
export function ProjectWorkView({ session, pmOrg, board, inventory, onSaved, announce }: Props) {
  const t = useT();
  const [edited, setEditedDoc] = useState<AssignmentsDoc>(board);
  const [dirty, setDirty] = useState(false);
  /** A change made here: kept apart from the project in hand until it is saved. */
  const setEdited = (next: AssignmentsDoc) => {
    setEditedDoc(next);
    setDirty(true);
  };
  const reset = (next: AssignmentsDoc) => {
    setEditedDoc(next);
    setDirty(false);
  };
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const work = useProjectWork(session, pmOrg, board.projectId);

  // The project in hand changed (another one was opened, or this one was read again): what is shown follows it,
  // unless something is being changed here.
  useEffect(() => {
    if (!dirty) setEditedDoc(board);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const orders = useMemo(() => publishableWorkOrders(edited, inventory), [edited, inventory]);
  const missing = work.loaded ? orders.filter((order) => !work.issueOf(order)).length : 0;
  const relays = dirty ? workChanged(board, edited, inventory) : false;

  async function save(force: boolean) {
    setBusy(t("wf.saving"));
    setError("");
    try {
      // What the plan has and Door43 lacks is laid out even when nothing was changed here.
      const saved = await saveProjectChanges({ session, pmOrg, before: board, after: edited, inventory, relay: force, onProgress: (done, total) => setBusy(`${t("pp.updatingWork")} · ${done} / ${total}`) });
      reset(saved.board);
      onSaved(saved.board);
      await work.reload();
      announce([t("pp.saved"), saved.created ? t(saved.created === 1 ? "pp.createdOne" : "pp.createdMany").replace("{n}", String(saved.created)) : "", saved.closed ? t(saved.closed === 1 ? "pp.closedOne" : "pp.closedMany").replace("{n}", String(saved.closed)) : ""].filter(Boolean).join(" "));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="pf">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("pw.title")}</h1>
          <p className="hub-lede">{t("pw.lede")}</p>
        </div>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!dirty && missing ? (
        <div className="af-stale" role="status">
          <p style={{ margin: 0 }}>{t(missing === 1 ? "pw.missingOne" : "pw.missingMany").replace("{n}", String(missing))}</p>
          <Button type="button" size="sm" className="mt-2" disabled={Boolean(busy)} onClick={() => void save(true)}>
            {busy || t("pw.createMissing")}
          </Button>
        </div>
      ) : null}

      <WorkPreview
        board={edited}
        inventory={inventory}
        busy={Boolean(busy)}
        onSettings={(settings) => setEdited({ ...edited, settings })}
        stateOf={(order) => {
          const issue = work.issueOf(order);
          if (!issue) return work.loaded ? { label: t("pw.toCreate"), tone: "open" } : undefined;
          if (issue.state === "closed") return { label: t("pw.done"), tone: "done" };
          const who = issue.assignees?.[0]?.login ?? issue.assignee?.login;
          return who ? { label: `@${who}`, tone: "taken" } : { label: t("pw.free"), tone: "open" };
        }}
      />

      {dirty ? (
        <div className="pf-footer">
          <div className="pp-impact">
            <p>
              <b>{busy || t("pp.unsaved")}</b>
            </p>
            {!busy && relays ? <p>{t("pp.relays")}</p> : null}
          </div>
          <div className="pf-footer__actions">
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => reset(board)}>
              {t("pp.discard")}
            </Button>
            <Button type="button" disabled={Boolean(busy)} onClick={() => void save(false)}>
              {t("pp.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
