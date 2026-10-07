import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { applyProposal, checkedSteps, loadTaskAnswers, sendProposal, type CheckedStep } from "../dcs/checkProposals";
import { appendCheckAnswers } from "../dcs/checkStore";
import { deliverSharedSubtask } from "../dcs/deliverShared";
import { loadPmConfig } from "../dcs/issues";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { agreeStepFromTool, stepAgreement, type StepAgreement } from "../dcs/roundClose";
import { explainError } from "../dcs/userError";
import { uid } from "../domain/assignment";
import { loadTrialChecks, proposalAnswer, proposalDone, proposalSaying, proposalsOf, proposalsSettled, saveTrialChecks, type ProposalView } from "../domain/checkProposal";
import type { CheckAnswer } from "../domain/checklist";
import { localized } from "../domain/processes";
import { ownerTaskOf } from "../domain/resourceOwner";
import { scopeLabel } from "../domain/resourceNames";
import { DEFAULT_PM_CONFIG, type PmConfig } from "../domain/roles";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { stepMinAssignees } from "../domain/stepClaim";
import type { AssignmentsDoc, ProjectTask, TaskStep } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT } from "../i18n/messages";
import { PROPOSAL_STATE_KEY, ProposalDiff, ProposalSheet, type ProposalDraft, type ProposalTarget } from "./ProposalSheet";
import { StepAsk } from "./StepAsk";
import { ToolHeader } from "./ToolHeader";
import { toolHeading } from "./toolHeading";

type Props = {
  ctxEncoded: string;
  onClose: () => void;
  announce: (msg: string) => void;
};

type Loaded = { board: AssignmentsDoc | null; task: ProjectTask | null; step: TaskStep | null; pmConfig: PmConfig; steps: CheckedStep[] };
/** A proposal, with the list of the step it was made in: what is said of it is added there. */
type Listed = ProposalView & { stepKey: string };

const placeOf = (where: string) => {
  const [chapter, verse] = where.split(":").map(Number);
  return (chapter || 0) * 1000 + (verse || 0);
};

/**
 * The team agrees on what it proposed to change. Every proposal of the task, from all its lists, with the words as
 * they were and as they would be, who proposed it and why. Whoever is for one says so; with enough of the team for
 * it, the new version is written where the team keeps that help, or asked of the team that maintains it when it
 * is not this one's. The step had no screen: it was approved from the card of the task, over a line that said
 * something had changed.
 */
export function ProposalsView({ ctxEncoded, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  /** The answers of each list of the task, by the key they are kept under. */
  const [answers, setAnswers] = useState<Record<string, CheckAnswer[]>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /** The agreement on the step as the subtarea has it: who sat down for it, and who of them agreed. */
  const [standing, setStanding] = useState<StepAgreement | null>(null);
  /** The proposal being answered with another version. */
  const [answering, setAnswering] = useState<Listed | null>(null);

  const trying = Boolean(ctx?.lab && !ctx.labAllowWrite);
  const me = session?.username ?? "";
  const stepDone = Boolean(standing?.done);
  const approved = Boolean(standing?.agreed.some((who) => who.toLowerCase() === me.toLowerCase()));

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) return setError(tNow("af.badLink"));
    setCtx(decoded);
    if (!session?.token) return setError(tNow("af.expired"));
    setBusy(true);
    setError("");
    try {
      const [pmConfig, board] = await Promise.all([
        decoded.pmOrg ? loadPmConfig(session, decoded.pmOrg).catch(() => DEFAULT_PM_CONFIG) : Promise.resolve(DEFAULT_PM_CONFIG),
        loadAssignmentsFromDcs(session, decoded.pmOrg, decoded.lang, decoded.projectId, decoded.contentOrg).catch(() => null),
      ]);
      const task = board?.teams.find((row) => row.id === decoded.taskId) ?? null;
      const step = task?.steps?.find((row) => row.id === decoded.stepId) ?? null;
      const steps = checkedSteps(decoded, task, pmConfig);
      setData({ board, task, step, pmConfig, steps });
      // A trial reads what the trials of the lists left in this tab; nothing of the project's.
      const lab = decoded.lab && !decoded.labAllowWrite;
      const read = lab ? steps.map((row) => ({ step: row, answers: loadTrialChecks(row.key) })) : await loadTaskAnswers(session, steps);
      setAnswers(Object.fromEntries(read.map((row) => [row.step.key, row.answers])));
      if (!lab && decoded.pmOrg && decoded.issueNumber && step) {
        setStanding(await stepAgreement({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, steps: task?.steps ?? [], step }).catch(() => null));
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session]);
  useEffect(() => {
    void load();
  }, [load]);

  const needed = data?.step ? stepMinAssignees(data.step) : 2;
  const ours = (resource: string) => Boolean(data?.task?.rules.some((rule) => rule.resource === resource));
  const teamOf = (resource: string) => {
    const owner = ownerTaskOf(resource, data?.board, data?.task);
    return owner ? owner.orgTeamName || localized(owner.name, owner.names, language) : "";
  };
  const nameOf = (resource: string) => scopeLabel(resource, data?.board?.settings?.resourceNames, language);

  const listed = useMemo<Listed[]>(
    () =>
      (data?.steps ?? [])
        .flatMap((step) => proposalsOf(answers[step.key] ?? [], needed, ours).map((view) => ({ ...view, stepKey: step.key })))
        .sort((a, b) => placeOf(a.proposal.where) - placeOf(b.proposal.where) || a.at.localeCompare(b.at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, data, needed],
  );
  /** What was changed by hand, in lists answered before there were proposals: said, with nothing to agree on. */
  const byHand = useMemo(
    () => (data?.steps ?? []).flatMap((step) => (answers[step.key] ?? []).filter((row) => row.value === "no" && (row.outcome === "fixed" || row.outcome === "created") && row.note)),
    [answers, data],
  );
  const unsettled = listed.filter((view) => view.state === "open" || view.state === "agreed");

  /** Rows added to my file of a list: there they are read by everybody who opens the list or this screen. */
  async function add(stepKey: string, rows: CheckAnswer[]) {
    const step = data?.steps.find((row) => row.key === stepKey);
    if (!step || !session) return;
    if (trying) saveTrialChecks(stepKey, [...(answers[stepKey] ?? []), ...rows]);
    else await appendCheckAnswers(session, step.target, stepKey, rows);
    setAnswers((prev) => ({ ...prev, [stepKey]: [...(prev[stepKey] ?? []), ...rows] }));
  }

  /** A proposal with enough of the team for it is carried out: written, or asked of whoever maintains what it changes. */
  async function carryOut(view: Listed) {
    if (!session || !ctx || !data) return;
    const mine = ours(view.proposal.resource);
    // A comment on a help of the team's own names no words to write: somebody writes the version, or says it is done.
    if (mine && !view.proposal.after) return;
    const now = new Date().toISOString();
    if (trying) {
      await add(view.stepKey, [proposalDone(view.proposal.id, me, now)]);
      return announce(mine ? t("ag.applied") : t("ag.sent").replace("{team}", teamOf(view.proposal.resource)));
    }
    if (mine) {
      await applyProposal({ session, ctx, pmConfig: data.pmConfig, board: data.board, proposal: view.proposal });
      await add(view.stepKey, [proposalDone(view.proposal.id, me, now)]);
      return announce(t("ag.applied"));
    }
    if (!data.board || !data.task) throw new Error(t("ag.noOwner"));
    const sentAs = await sendProposal({ session, ctx, board: data.board, task: data.task, view });
    await add(view.stepKey, [proposalDone(view.proposal.id, me, now, sentAs)]);
    announce(t("ag.sent").replace("{team}", teamOf(view.proposal.resource)));
  }

  async function act(job: () => Promise<void>) {
    setSaving(true);
    setError("");
    try {
      await job();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Who is counted as agreeing. Trying the screen alone, one's own proposal could never be agreed on (it takes
   * somebody else): there, agreeing with it counts as another person of the team, and the trial goes all the way.
   */
  const voterFor = (view: Listed) => (trying && view.by.toLowerCase() === me.toLowerCase() ? t("ag.tryOther") : me);
  const agree = (view: Listed) =>
    act(async () => {
      const voter = voterFor(view);
      await add(view.stepKey, [proposalSaying(view.proposal.id, voter, new Date().toISOString(), true)]);
      const inFavour = new Set([...view.inFavour.map((who) => who.toLowerCase()), voter.toLowerCase()]);
      if (inFavour.size >= needed) await carryOut(view);
      else announce(t("ag.saved"));
    });
  const withdraw = (view: Listed) => act(() => add(view.stepKey, [proposalSaying(view.proposal.id, me, new Date().toISOString(), false)]));
  const markDone = (view: Listed) => act(() => add(view.stepKey, [proposalDone(view.proposal.id, me, new Date().toISOString())]));

  /** Another version of the same thing, in answer to a proposal: it takes its place, and is the one to agree on. */
  const answerWith = (draft: ProposalDraft) =>
    act(async () => {
      if (!answering) return;
      const was = answering.proposal;
      const proposal = { ...was, id: `pr-${uid()}`, replaces: was.id, ...(draft.after ? { after: draft.after } : { after: undefined }) };
      await add(answering.stepKey, [proposalAnswer({ itemId: answering.itemId, questionId: answering.questionId, by: me, at: new Date().toISOString(), reason: draft.reason, proposal })]);
      setAnswering(null);
      announce(t("ck.proposed"));
    });
  const answerTargets: ProposalTarget[] = answering
    ? [{ id: "same", label: `${answering.proposal.where} · ${nameOf(answering.proposal.resource)}`, resource: answering.proposal.resource, text: answering.proposal.before, commentOnly: answering.proposal.before === undefined, ...(ours(answering.proposal.resource) ? {} : { team: teamOf(answering.proposal.resource) }) }]
    : [];

  /**
   * My agreement on the step, and with it the step itself when it is everybody's. Closing the last step of a
   * subtarea delivers it, as the rounds of review do: nobody is left to find «Entregar» on their list.
   */
  async function agreeOnStep(mine: boolean) {
    if (!session || !ctx || !data?.step) return;
    if (trying || !ctx.pmOrg || !ctx.issueNumber) return announce(t("ag.tryApprove"));
    await act(async () => {
      const now = await agreeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, steps: data.task?.steps ?? [], step: data.step!, settled: proposalsSettled(listed), mine });
      setStanding(now);
      if (now.done) {
        const delivered = data.board ? await deliverSharedSubtask({ session, pmOrg: ctx.pmOrg, lang: ctx.lang, contentOrg: ctx.contentOrg, board: data.board, issueNumber: ctx.issueNumber }).catch(() => false) : false;
        return announce(t(delivered ? "ag.closedDelivered" : "ag.closed"));
      }
      if (!mine) return;
      announce(t(!now.open ? "ag.locked" : now.agreed.some((who) => who.toLowerCase() === me.toLowerCase()) ? "ag.approved" : "ag.cannot"));
    });
  }
  // Everybody had agreed and something was still to be resolved: the step closes when the last of it is, once.
  const closedLate = useRef(false);
  useEffect(() => {
    if (closedLate.current || trying || saving || !standing || standing.done || !standing.open || !standing.complete || unsettled.length) return;
    closedLate.current = true;
    void agreeOnStep(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standing, unsettled.length, saving]);

  /** What the foot says: what is left to resolve, or whose agreement is given and whose is missing. */
  const footSays = () => {
    if (unsettled.length) return t(unsettled.length === 1 ? "ag.pendingOne" : "ag.pending").replace("{n}", String(unsettled.length));
    if (!standing) return t("ag.allSettled");
    if (!standing.open) return t("ag.locked");
    const names = (list: string[]) => list.map((who) => `@${who}`).join(", ");
    if (approved) return `${t("ag.youAgreed")} ${standing.missing.length ? t("ag.missingWho").replace("{who}", names(standing.missing)) : t("ag.missingOther")}`;
    return standing.agreed.length ? `${t("ag.allSettled")} ${t("ag.agreedBy").replace("{who}", names(standing.agreed))}` : t("ag.allSettled");
  };

  const stepName = data?.step ? localized(data.step.name, data.step.names, language) : t("ag.title");
  const isMe = (who: string) => who.toLowerCase() === me.toLowerCase();

  return (
    <div className="af ck ag">
      <ToolHeader title={toolHeading(ctx, language, stepName).title} onBack={onClose} meta={toolHeading(ctx, language, stepName).where} />
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx} />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("ag.loading")}</p> : null}
      {trying ? (
        <p className="ck-trying" role="status">
          {t("ck.trying")}
        </p>
      ) : null}
      {data && !busy ? (
        <>
          <p className="af-hint">{t("ag.lede").replace("{n}", String(needed))}</p>
          {listed.length ? (
            <p className="ag-count" role="status">
              {t(listed.length === 1 ? "ag.countOne" : "ag.count").replace("{n}", String(listed.length)).replace("{open}", String(unsettled.length))}
            </p>
          ) : !byHand.length ? (
            <p className="hub-hint">{t("ag.none")}</p>
          ) : null}
          <ul className="ag-list">
            {listed.map((view) => {
              const mine = ours(view.proposal.resource);
              const forIt = view.inFavour.some((who) => who.toLowerCase() === voterFor(view).toLowerCase());
              const live = (view.state === "open" || view.state === "agreed") && !stepDone;
              return (
                <li key={view.proposal.id} className="ag-card" data-state={view.state}>
                  <p className="ag-card__head">
                    <b>{view.proposal.where}</b> · {nameOf(view.proposal.resource)} · {t("ag.by").replace("{who}", view.by)}
                  </p>
                  {view.proposal.after ? (
                    <p className="ag-diff">
                      <ProposalDiff before={view.proposal.before ?? ""} after={view.proposal.after} />
                    </p>
                  ) : (
                    <p className="ag-comment">{view.reason}</p>
                  )}
                  {view.proposal.after && view.reason ? <p className="af-hint ag-reason">{view.reason}</p> : null}
                  <p className="ag-card__state">
                    <b>{t(PROPOSAL_STATE_KEY[view.state]).replace("{team}", teamOf(view.proposal.resource))}</b>
                    {view.sentAs ? ` · ${view.sentAs}` : ""}
                    {view.state === "open" ? ` · ${t("ag.inFavour").replace("{n}", String(view.inFavour.length)).replace("{of}", String(needed))}` : ""}
                  </p>
                  {view.state === "agreed" && mine && !view.proposal.after ? <p className="af-hint">{t("ag.needsVersion")}</p> : null}
                  {live ? (
                    <div className="ag-card__buttons">
                      {view.state === "open" && !forIt ? (
                        <Button type="button" disabled={saving} onClick={() => void agree(view)}>
                          {t("ag.agree")}
                        </Button>
                      ) : null}
                      {view.state === "agreed" && (view.proposal.after || !mine) ? (
                        // Agreed and not carried out: the write failed, or the last to agree could not make it.
                        <Button type="button" disabled={saving} onClick={() => void act(() => carryOut(view))}>
                          {mine ? t("ag.apply") : t("ag.send").replace("{team}", teamOf(view.proposal.resource))}
                        </Button>
                      ) : null}
                      {view.state === "agreed" && mine && !view.proposal.after ? (
                        <Button type="button" variant="outline" disabled={saving} onClick={() => void markDone(view)}>
                          {t("ag.done")}
                        </Button>
                      ) : null}
                      <Button type="button" variant="outline" disabled={saving} onClick={() => setAnswering(view)}>
                        {t(view.state === "agreed" && mine && !view.proposal.after ? "pr.newVersion" : "ag.other")}
                      </Button>
                      {isMe(view.by) ? (
                        <Button type="button" variant="ghost" disabled={saving} onClick={() => void withdraw(view)}>
                          {t("ag.withdraw")}
                        </Button>
                      ) : null}
                      {view.state === "open" && forIt && !isMe(view.by) ? <span className="ag-mine">{t("ag.youAgree")}</span> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
            {byHand.map((row) => (
              <li key={`${row.itemId}-${row.questionId}-${row.at}`} className="ag-card" data-state="applied">
                <p className="ag-card__head">{t("ag.legacy").replace("{who}", row.by)}</p>
                <p className="ag-comment">{row.note}</p>
              </li>
            ))}
          </ul>
          <div className="ck-go" data-on>
            {stepDone ? (
              <Button type="button" size="lg" variant="outline" onClick={onClose}>
                {t("fa.back")}
              </Button>
            ) : (
              <>
                <p className="ag-foot" role="status">
                  {footSays()}
                </p>
                <Button type="button" size="lg" disabled={saving || !proposalsSettled(listed) || approved || standing?.open === false} onClick={() => void agreeOnStep(true)}>
                  {t("ag.approve")}
                </Button>
              </>
            )}
          </div>
        </>
      ) : null}
      <ProposalSheet open={Boolean(answering)} onClose={() => setAnswering(null)} targets={answerTargets} reason={answering?.reason ?? ""} startFrom={answering?.proposal.after} saving={saving} onSend={(draft) => void answerWith(draft)} />
    </div>
  );
}
