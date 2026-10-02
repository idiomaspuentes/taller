import { useEffect, useMemo, useState } from "react";
import type { DcsTeam } from "@ip-lms/dcs-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { issueAssigneeLogins, reassignIssue, unclaimIssue } from "../dcs/issues";
import { listPmOrgTeams, saveProjectToDcs } from "../dcs/persist";
import { saveProjectChanges, useProjectWork, workChanged } from "../dcs/projectPlan";
import { readBook } from "../dcs/startBook";
import { explainError } from "../dcs/userError";
import { displayOrgTeamName, orgTeamLabel } from "../domain/roles";
import type { AssignmentsDoc, InventoryDoc } from "../domain/types";
import { publishableWorkOrders, type WorkOrder } from "../domain/workOrder";
import { useT } from "../i18n/messages";
import { WorkPreview } from "./WorkPreview";

type Props = {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  /** Absent: the book has not been read yet, and reading it is the first thing offered. */
  inventory: InventoryDoc | null;
  onSaved: (board: AssignmentsDoc) => void;
  /** A new reading of the book: the app takes it as the one in hand. */
  onInventory: (inventory: InventoryDoc) => void;
  onOpenThread: (issue: number) => void;
  announce: (msg: string) => void;
};

/**
 * «Subtareas» of a project under way: every subtarea the project lays out and how each one stands in Door43. From
 * here a subtarea is handed to somebody or freed, one is added by hand, a long chapter is split, the book is read
 * again, and what the plan has and Door43 does not is created.
 */
export function ProjectWorkView({ session, pmOrg, board, inventory, onSaved, onInventory, onOpenThread, announce }: Props) {
  const t = useT();
  const [edited, setEditedDoc] = useState<AssignmentsDoc>(board);
  const [dirty, setDirty] = useState(false);
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
  const [teams, setTeams] = useState<DcsTeam[]>([]);
  const [pick, setPick] = useState("");
  const work = useProjectWork(session, pmOrg, board.projectId);
  const oneBook = (board.books?.length ?? 1) <= 1;

  useEffect(() => {
    if (!dirty) setEditedDoc(board);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  useEffect(() => {
    let alive = true;
    listPmOrgTeams(session, pmOrg)
      .then((rows) => alive && setTeams(rows))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, pmOrg]);

  const orders = useMemo(() => (inventory ? publishableWorkOrders(edited, inventory) : []), [edited, inventory]);
  const missing = work.loaded ? orders.filter((order) => !work.issueOf(order)).length : 0;
  const relays = dirty && inventory ? workChanged(board, edited, inventory) : false;

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy("");
    }
  }

  const save = (force: boolean) =>
    run(t("wf.saving"), async () => {
      // What the plan has and Door43 lacks is laid out even when nothing was changed here.
      const saved = await saveProjectChanges({ session, pmOrg, before: board, after: edited, inventory, relay: force, onProgress: (done, total) => setBusy(`${t("pp.updatingWork")} · ${done} / ${total}`) });
      reset(saved.board);
      onSaved(saved.board);
      await work.reload();
      announce([t("pp.saved"), saved.created ? t(saved.created === 1 ? "pp.createdOne" : "pp.createdMany").replace("{n}", String(saved.created)) : "", saved.closed ? t(saved.closed === 1 ? "pp.closedOne" : "pp.closedMany").replace("{n}", String(saved.closed)) : ""].filter(Boolean).join(" "));
    });

  const read = () =>
    run(t("sb.stageReading"), async () => {
      const book = (board.books?.[0] || board.book).toUpperCase();
      const next = await readBook({ book, lang: board.lang, contentOrg: board.contentOrg, settings: board.settings }, (message) => setBusy(message));
      await saveProjectToDcs({ session, org: pmOrg, lang: board.lang, book: board.projectId, assignments: board, inventory: next });
      onInventory(next);
      announce(t("pw.bookRead"));
    });

  /** Who may be handed a subtarea: the people of its task's team. */
  function panel(order: WorkOrder, close: () => void) {
    const issue = work.issueOf(order);
    if (!issue) return <p className="pe-hint">{t("pw.notYet")}</p>;
    const task = board.teams.find((row) => row.id === order.teamId);
    const people = [...new Set(task?.memberIds ?? [])].sort((a, b) => a.localeCompare(b, "es"));
    const has = issueAssigneeLogins(issue);
    const closed = issue.state === "closed";
    const after = async () => {
      await work.reload();
      setPick("");
      close();
    };
    return (
      <div className="pw-order">
        <p className="pw-order__state">
          <b>{order.label}</b> · {closed ? t("pw.done") : has.length ? t("pw.has").replace("{who}", has.map((login) => `@${login}`).join(", ")) : t("pw.nobody")}
        </p>
        {!closed ? (
          <div className="pw-order__row">
            <select className="af-input" value={pick} aria-label={t("pw.giveTo")} disabled={Boolean(busy)} onChange={(e) => setPick(e.target.value)}>
              <option value="">{people.length ? t("pw.giveTo") : t("pw.noPeople")}</option>
              {people
                .filter((login) => !has.includes(login))
                .map((login) => (
                  <option key={login} value={login}>
                    {board.people.find((person) => person.id === login)?.name ?? login}
                  </option>
                ))}
            </select>
            <Button type="button" size="sm" disabled={Boolean(busy) || !pick} onClick={() => void run(t("wf.saving"), async () => (await reassignIssue(session, pmOrg, issue, pick, `${task?.name ?? ""} · ${order.label}`), await after()))}>
              {t("pw.give")}
            </Button>
            {has.length ? (
              <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run(t("wf.saving"), async () => (await unclaimIssue(session, pmOrg, issue.number), await after()))}>
                {t("pw.release")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <button type="button" className="pe-link" onClick={() => onOpenThread(issue.number)}>
          {t("pw.openThread")}
        </button>
      </div>
    );
  }

  return (
    <div className="pf">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("pw.title")}</h1>
          <p className="hub-lede">{t("pw.lede")}</p>
        </div>
        {inventory && oneBook ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={Boolean(busy) || dirty}
            onClick={() => {
              if (window.confirm(t("pw.confirmRead"))) void read();
            }}
          >
            {t("pw.readAgain")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!inventory ? (
        <div className="hub-panel">
          <p style={{ margin: 0 }}>{t(oneBook ? "pw.needsBook" : "pw.needsBooks")}</p>
          {oneBook ? (
            <Button type="button" className="justify-self-start" disabled={Boolean(busy)} onClick={() => void read()}>
              {busy || t("pw.readBook")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {!dirty && missing ? (
            <div className="af-stale" role="status">
              <p style={{ margin: 0 }}>{t(missing === 1 ? "pw.missingOne" : "pw.missingMany").replace("{n}", String(missing))}</p>
              <Button type="button" size="sm" className="mt-2" disabled={Boolean(busy)} onClick={() => void save(true)}>
                {busy || t("pw.createMissing")}
              </Button>
            </div>
          ) : null}
          {busy && !dirty && !missing ? <p className="pe-hint" role="status">{busy}</p> : null}

          <WorkPreview
            board={edited}
            inventory={inventory}
            busy={Boolean(busy)}
            onSettings={(settings) => setEdited({ ...edited, settings })}
            teamName={(name) => {
              const team = teams.find((row) => row.name === name);
              return team ? orgTeamLabel(team) : displayOrgTeamName(name);
            }}
            orderPanel={dirty ? undefined : panel}
            stateOf={(order) => {
              const issue = work.issueOf(order);
              if (!issue) return work.loaded ? { label: t("pw.toCreate"), tone: "open" } : undefined;
              if (issue.state === "closed") return { label: t("pw.done"), tone: "done" };
              const who = issueAssigneeLogins(issue)[0];
              return who ? { label: `@${who}`, tone: "taken" } : { label: t("pw.free"), tone: "open" };
            }}
          />
        </>
      )}

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
