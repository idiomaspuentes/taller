import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { HelpChangedError, applyProposal, checkedSteps, loadTaskAnswers, readProposedWords, sendProposal, type CheckedStep } from "../dcs/checkProposals";
import { loadUnitItems, loadUnitTexts, type ChecklistItem, type ChecklistKind, type ChecklistText, type ChecklistTextData } from "../dcs/checklistLoad";
import { loadTermTitles } from "../dcs/afinacionLoad";
import { termLabel } from "../domain/afinacionWords";
import { bookLabel } from "../domain/books";
import { alignedGatewayQuoteForHelpQuote } from "../domain/helpQuoteMatch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { QuoteVerse } from "./QuoteVerse";
import { originalTokens } from "../domain/quoteFromSelection";
import { appendCheckAnswers } from "../dcs/checkStore";
import { deliverSharedSubtask } from "../dcs/deliverShared";
import { loadPmConfig } from "../dcs/issues";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { agreeStepFromTool, stepAgreement, type StepAgreement } from "../dcs/roundClose";
import { explainError } from "../dcs/userError";
import { uid } from "../domain/assignment";
import { appliedWords, byPlaceAndHelp, loadTrialChecks, othersNeeded, proposalAnswer, proposalDone, proposalFit, proposalHelp, proposalKeeping, proposalSaying, proposalWords, proposalsOf, proposalsSettled, readable, saveTrialChecks, type ProposalPayload, type ProposalView } from "../domain/checkProposal";

import type { CheckAnswer } from "../domain/checklist";
import { localized, stepPurpose } from "../domain/processes";
import { ownerLabel } from "../domain/resourceOwner";
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
import { LoadingState } from "./LoadingState";

type Props = {
  ctxEncoded: string;
  onClose: () => void;
  announce: (msg: string) => void;
};

type Loaded = { board: AssignmentsDoc | null; task: ProjectTask | null; step: TaskStep | null; pmConfig: PmConfig; steps: CheckedStep[] };
/** A proposal, with the list of the step it was made in: what is said of it is added there. */
type Listed = ProposalView & { stepKey: string };

const unsettledState = (view: ProposalView) => view.state === "open" || view.state === "agreed";

/**
 * The proposals about one help, read together: the team's version and another answered to it, or two people's.
 * One at a time, as the proposals of a chapter are read in Afinación: a list of forty cards was scrolled through,
 * and which help had two versions to choose between could not be told but by reading every card (16 October).
 */
type HelpGroup = { key: string; views: Listed[]; where: string; resource: string; itemId: string; rowId?: string };
type Filter = "pending" | "shared" | "all";
const livePart = (group: HelpGroup) => group.views.filter(unsettledState);
const inFilter = (group: HelpGroup, filter: Filter) => (filter === "all" ? true : filter === "pending" ? livePart(group).length > 0 : livePart(group).length > 1);
/** The kinds of help a list goes over and whose words (quote, occurrence) are read to mark them in the verse. */
const ITEM_KINDS: ChecklistKind[] = ["notas", "palabras", "preguntas"];

/**
 * The team agrees on what it proposed to change. Every proposal of the task, from all its lists, with the words as
 * they were and as they would be, who proposed it and why. Whoever is for one says so; with enough of the team for
 * it, the new version is written where the team keeps that help, or asked of the team that maintains it when it
 * is not this one's. The step had no screen: it was approved from the card of the task, over a line that said
 * something had changed.
 *
 * A new version is written only over the words it was proposed from. The lists of a task go over the same helps,
 * so two proposals can be about one: they are read together, and once one is applied the other says that the help
 * changed and is written again from what it says now.
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
  /** What the helps of the team with a proposal to resolve say now, by `proposalWords`. */
  const [read, setRead] = useState<Record<string, string>>({});
  /**
   * The verses of the unit in the texts its helps are checked against, with their alignment: the words of the help
   * are marked in them, as in the list where it was proposed. Read when the screen opens: behind «Ver entera» the
   * verse came without the words the note is about, and without its quote in Spanish (16 October).
   */
  const [unitTexts, setUnitTexts] = useState<Partial<Record<ChecklistText, ChecklistTextData>> | null>(null);
  /** The book in the original: the quote of a help is found in it, word and occurrence, not guessed from the alignment. */
  const [original, setOriginal] = useState<string | null>(null);
  /** The helps of the unit, by id: what a proposal is about, to find its words in the verse. */
  const [helpItems, setHelpItems] = useState<Record<string, ChecklistItem>>({});
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter | null>(null);
  const [at, setAt] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  // Scrolled past where the line sits: only its arrows stay, in the margins, as in the proposals of Afinación.
  const [stuck, setStuck] = useState(false);
  const mark = useRef<HTMLDivElement>(null);

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
      // The verse and the helps of the unit, beside the proposals: what each is about is marked in the verse.
      const texts = [...new Set(steps.flatMap((row) => row.texts))] as ChecklistText[];
      void (texts.length ? loadUnitTexts({ session, ctx: decoded, texts, original: true }).then((unit) => {
        setOriginal(unit.original ?? null);
        setUnitTexts(unit.texts);
      }) : Promise.resolve(setUnitTexts({}))).catch(() => setUnitTexts({}));
      const kinds = ITEM_KINDS.filter((kind) => task?.rules.some((rule) => rule.resource === kind));
      void Promise.all(kinds.map((kind) => loadUnitItems({ session, ctx: decoded, kind, pmConfig, board }).catch(() => null)))
        .then((found) => {
          const items = found.flatMap((row) => row?.items ?? []);
          setHelpItems(Object.fromEntries(items.map((item) => [item.id, item])));
          const terms = items.filter((item) => item.supportRef && !item.body).map((item) => ({ termSlug: item.title, termKind: item.supportRef!.split("/")[0] as never }));
          if (terms.length) void loadTermTitles(session, resolveSourcePackage(board?.settings), terms, decoded).then(setTermTitles).catch(() => undefined);
        });
      // A trial reads what the trials of the lists left in this tab; nothing of the project's.
      const lab = decoded.lab && !decoded.labAllowWrite;
      const kept = lab ? steps.map((row) => ({ step: row, answers: loadTrialChecks(row.key) })) : await loadTaskAnswers(session, steps);
      setAnswers(Object.fromEntries(kept.map((row) => [row.step.key, row.answers])));
      // What those helps say now: a proposal written from other words says so on its card, before anybody agrees.
      const own = (resource: string) => Boolean(task?.rules.some((rule) => rule.resource === resource));
      const pending = kept.flatMap((row) => proposalsOf(row.answers, 1, own)).filter((view) => unsettledState(view) && own(view.proposal.resource));
      setRead(pending.length ? await readProposedWords({ session, ctx: decoded, pmConfig, board, proposals: pending.map((view) => view.proposal) }).catch(() => ({})) : {});
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
  const teamOf = (resource: string) => ownerLabel(resource, data?.board, data?.task, language);
  const nameOf = (resource: string) => scopeLabel(resource, data?.board?.settings?.resourceNames, language);
  /** The question a proposal answered «no» to, as its list asks it; and that said as what it is («No se cumple: …»). */
  const askedOf = (view: Listed): string => {
    const question = data?.steps.find((step) => step.key === view.stepKey)?.questions.find((row) => row.id === view.questionId);
    return question ? localized(question.text, question.texts, language) : "";
  };
  const failedOf = (view: Listed): string => (askedOf(view) ? t("pr.failed").replace("{q}", askedOf(view)) : "");

  const listed = useMemo<Listed[]>(
    () => byPlaceAndHelp((data?.steps ?? []).flatMap((step) => proposalsOf(answers[step.key] ?? [], needed, ours).map((view) => ({ ...view, stepKey: step.key })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, data, needed],
  );
  /** The proposals by the help they are about, in the order they are read. */
  const groups = useMemo<HelpGroup[]>(() => {
    const out: HelpGroup[] = [];
    const byKey = new Map<string, HelpGroup>();
    for (const view of listed) {
      const key = proposalHelp(view.proposal) || view.proposal.id;
      const group = byKey.get(key);
      if (group) group.views.push(view);
      else {
        const made: HelpGroup = { key, views: [view], where: view.proposal.where, resource: view.proposal.resource, itemId: view.itemId, ...(view.proposal.rowId ? { rowId: view.proposal.rowId } : {}) };
        byKey.set(key, made);
        out.push(made);
      }
    }
    return out;
  }, [listed]);
  /** A trial writes nothing: there a help says what the last proposal the trial applied to it put in. */
  const words = useMemo(() => (trying ? { ...read, ...appliedWords(listed) } : read), [trying, read, listed]);
  const wordsNow = (proposal: ProposalPayload): string | undefined => words[proposalWords(proposal)];
  /** What a help of the team says now, when it is no longer what a new version to resolve was written from. */
  const changedTo = (view: Listed): string | undefined => {
    const now = unsettledState(view) && ours(view.proposal.resource) && view.proposal.after ? wordsNow(view.proposal) : undefined;
    return now !== undefined && proposalFit(view.proposal, now) === "changed" ? now : undefined;
  };
  /** What was changed by hand, in lists answered before there were proposals: said, with nothing to agree on. */
  const byHand = useMemo(
    () => (data?.steps ?? []).flatMap((step) => (answers[step.key] ?? []).filter((row) => row.value === "no" && (row.outcome === "fixed" || row.outcome === "created") && row.note)),
    [answers, data],
  );
  const unsettled = listed.filter(unsettledState);

  // What is gone through: what is left to resolve while there is something, then all of it.
  const counts = { pending: groups.filter((group) => inFilter(group, "pending")).length, shared: groups.filter((group) => inFilter(group, "shared")).length, all: groups.length };
  const shownFilter: Filter = filter ?? (counts.pending ? "pending" : "all");
  const shown = groups.filter((group) => inFilter(group, shownFilter));
  // A group that leaves the filter as it is resolved stays in view: it went away under the finger that resolved it.
  const [pinned, setPinned] = useState<string | null>(null);
  const walk = pinned && !shown.some((group) => group.key === pinned) && groups.some((group) => group.key === pinned) ? [...shown, groups.find((group) => group.key === pinned)!].sort((a, b) => groups.indexOf(a) - groups.indexOf(b)) : shown;
  const index = Math.max(0, Math.min(walk.length - 1, at));
  const current = walk[index];
  useEffect(() => {
    if (current) setPinned(current.key);
    // The next one is read from its verse.
    document.querySelector(".ag")?.scrollIntoView({ block: "start" });
  }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (to: number) => setAt(Math.max(0, Math.min(walk.length - 1, to)));
  const hasLine = Boolean(current);
  useEffect(() => {
    const node = mark.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(([entry]) => setStuck(Boolean(entry) && !entry!.isIntersecting && entry!.boundingClientRect.top < window.innerHeight / 2));
    watch.observe(node);
    return () => watch.disconnect();
  }, [hasLine]);
  const pick = (next: Filter) => {
    setFilter(next);
    setPinned(null);
    setAt(0);
  };
  const choose = (group: HelpGroup) => {
    const inShown = shown.indexOf(group);
    if (inShown < 0) {
      setFilter("all");
      setAt(groups.indexOf(group));
    } else setAt(inShown);
    setPinned(group.key);
    setListOpen(false);
  };
  /** The help a group is about, as the list has it: its words in the original, to mark them in the verse. */
  // A term is «w:» and the id of its row in the list; proposals moved in from a sheet named it by the row alone.
  const helpOf = (group: HelpGroup): ChecklistItem | undefined => helpItems[group.rowId ?? ""] ?? helpItems[group.itemId] ?? helpItems[`w:${group.itemId}`];
  const kindLabel = (group: HelpGroup): string => {
    const item = helpOf(group);
    if (group.resource === "palabras" || (item?.supportRef && !item.body && item.title)) return `${t("ck.kindTerm")}${item?.title ? ` · ${termLabel(item.title, termTitles)}` : ""}`;
    if (group.resource === "preguntas") return t("ck.kindQuestion");
    return nameOf(group.resource);
  };

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
      const key = proposalWords(view.proposal);
      try {
        await applyProposal({ session, ctx, pmConfig: data.pmConfig, board: data.board, proposal: view.proposal });
      } catch (err) {
        // The help changed after this screen read it: nothing was written, and the card says what to do.
        if (!(err instanceof HelpChangedError)) throw err;
        const { current } = err;
        setRead((prev) => ({ ...prev, [key]: current }));
        return announce(t("ag.stale"));
      }
      // The other proposals for that help are now read against what this one left.
      setRead((prev) => ({ ...prev, [key]: view.proposal.after ?? "" }));
      await add(view.stepKey, [proposalDone(view.proposal.id, me, now)]);
      return announce(t("ag.applied"));
    }
    if (!data.board || !data.task) throw new Error(t("ag.noOwner"));
    const sentAs = await sendProposal({ session, ctx, board: data.board, task: data.task, view, failed: failedOf(view) || undefined });
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
  /** The same for leaving things as they are, which takes as many people: in a trial, each touch is one more of them. */
  const keeperFor = (view: Listed) => (trying && view.by.toLowerCase() === me.toLowerCase() ? `${t("ag.tryOther")}${view.against.length ? ` ${view.against.length + 1}` : ""}` : me);
  const agree = (view: Listed) =>
    act(async () => {
      const voter = voterFor(view);
      await add(view.stepKey, [proposalSaying(view.proposal.id, voter, new Date().toISOString(), true)]);
      const inFavour = new Set([...view.inFavour.map((who) => who.toLowerCase()), voter.toLowerCase()]);
      if (inFavour.size >= needed) await carryOut(view);
      else announce(t("ag.saved"));
    });
  /** I would rather leave it as it is. With enough of the team saying so the proposal is not accepted, and no longer holds the step. */
  const keepAsIs = (view: Listed) =>
    act(async () => {
      const keeper = keeperFor(view);
      await add(view.stepKey, [proposalKeeping(view.proposal.id, keeper, new Date().toISOString(), true)]);
      const against = new Set([...view.against.map((who) => who.toLowerCase()), keeper.toLowerCase()]);
      announce(t(against.size >= othersNeeded(needed) ? "ag.rejected" : "ag.saved"));
    });
  /** One touch leaves a proposal aside: whoever gave it by mistake takes it back, and the proposal is to be resolved again. */
  const keepNoMore = (view: Listed) =>
    act(async () => {
      const mine = view.against.filter((who) => isMe(who) || (trying && who.startsWith(t("ag.tryOther"))));
      await add(view.stepKey, mine.map((who) => proposalKeeping(view.proposal.id, who, new Date().toISOString(), false)));
      announce(t("ag.saved"));
    });
  const withdraw = (view: Listed) => act(() => add(view.stepKey, [proposalSaying(view.proposal.id, me, new Date().toISOString(), false)]));
  const markDone = (view: Listed) => act(() => add(view.stepKey, [proposalDone(view.proposal.id, me, new Date().toISOString())]));

  /**
   * Another version of the same thing, in answer to a proposal: it takes its place, and is the one to agree on. It
   * is written from the help as it is now, when that is known: from the words of the proposal it answers, one
   * that could not be applied because the help had changed was answered with another that could not either.
   */
  // A help proposed as new has no words yet but the ones proposed: another version of it starts from nothing too.
  const answerFrom = answering ? (answering.proposal.add ? "" : (wordsNow(answering.proposal) ?? answering.proposal.before)) : undefined;
  const answerWith = (draft: ProposalDraft) =>
    act(async () => {
      if (!answering) return;
      const was = answering.proposal;
      // Answering one that parts a note in two: still in two, with its new note as rewritten, or in one again.
      const proposal = { ...was, id: `pr-${uid()}`, replaces: was.id, ...(answerFrom !== undefined && !was.add ? { before: answerFrom } : {}), ...(draft.after ? { after: draft.after } : { after: undefined }), split: draft.split && was.split ? { ...was.split, after: draft.split.after } : undefined };
      await add(answering.stepKey, [proposalAnswer({ itemId: answering.itemId, questionId: answering.questionId, by: me, at: new Date().toISOString(), reason: draft.reason, proposal })]);
      setAnswering(null);
      announce(t("ck.proposed"));
    });
  const answerTargets: ProposalTarget[] = answering
    ? [{ id: "same", label: `${answering.proposal.where} · ${nameOf(answering.proposal.resource)}`, resource: answering.proposal.resource, text: answerFrom, commentOnly: answerFrom === undefined, ...(answering.proposal.add ? { add: true } : {}), ...(answering.proposal.split ? { split: { rowId: answering.proposal.split.rowId } } : {}), ...(answering.proposal.path ? { format: "markdown" as const } : answering.proposal.rowId && (answering.proposal.field ?? "Note") === "Note" ? { format: "note" as const } : {}), ...(ours(answering.proposal.resource) ? {} : { team: teamOf(answering.proposal.resource) }) }]
    : [];
  // A version the help no longer fits is not what the next one starts from: that one starts from the help.
  const answerStart = answering && changedTo(answering) === undefined ? answering.proposal.after : undefined;

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

  const rule = data?.task && data.step ? stepPurpose(data.task.id, data.step, language).criterion : undefined;
  const bookCode = (ctx?.book || ctx?.projectId || "").toUpperCase();
  const textOrder = (["tpl", "tps"] as ChecklistText[]).filter((resource) => unitTexts?.[resource]);
  /** Whether a proposal still waits for what I say of it: once nothing does, the way on is tinted stronger. */
  const waitsOnMe = (view: Listed) => unsettledState(view) && view.state === "open" && !isMe(view.by) && !view.inFavour.some(isMe) && !view.against.some(isMe);

  /** One proposal, with what it changes, why, how it stands and what can be done with it. */
  const card = (view: Listed, n: number, total: number) => {
    const mine = ours(view.proposal.resource);
    const forIt = view.inFavour.some((who) => who.toLowerCase() === voterFor(view).toLowerCase());
    const keeps = view.against.some(isMe);
    // Its author is for it and takes it back; anybody else is for it or for leaving things as they are.
    const mayKeep = view.state === "open" && !keeps && (trying || !isMe(view.by));
    const live = unsettledState(view) && !stepDone;
    const changed = live ? changedTo(view) : undefined;
    const stale = changed !== undefined;
    return (
      <li key={view.proposal.id} className="ag-card" data-state={view.state}>
        <p className="ag-card__head">
          {total > 1 ? <b>{t("ag.cardOf").replace("{n}", String(n)).replace("{total}", String(total))}</b> : null}
          {total > 1 ? " · " : ""}
          {view.proposal.add ? `${t("ag.newNote")} · ` : view.proposal.split ? `${t("ag.split")} · ` : ""}
          {t("ag.by").replace("{who}", view.by)}
        </p>
        {view.proposal.split ? (
          // Parted in two: each note as it would read.
          <>
            <p className="ag-whole">
              <span className="af-lbl">{t("ag.splitKeeps")}</span> {readable(view.proposal.after ?? "")}
            </p>
            <p className="ag-whole ag-new">
              <span className="af-lbl">{t("pr.newNoteLbl")}</span> {readable(view.proposal.split.after)}
            </p>
          </>
        ) : view.proposal.after && view.proposal.path ? (
          // An article is pages long: what changes, with the words around it; the whole of it a touch away.
          <>
            <p className="ag-diff">
              <ProposalDiff before={view.proposal.before ?? ""} after={view.proposal.after} plain />
            </p>
            <details className="ag-more">
              <summary>{t("ag.wholeArticle")}</summary>
              <p className="ag-diff ag-whole">
                <ProposalDiff before={view.proposal.before ?? ""} after={view.proposal.after} whole plain />
              </p>
            </details>
          </>
        ) : view.proposal.after ? (
          // A note is read whole, what goes out struck and what comes in marked: it is what is agreed on.
          <p className="ag-diff ag-whole">
            <ProposalDiff before={view.proposal.before ?? ""} after={view.proposal.after} whole plain />
          </p>
        ) : (
          <p className="ag-comment">{view.reason}</p>
        )}
        {(view.proposal.about ?? view.proposal.split?.about) ? <p className="af-hint ag-reason">{t("ag.about").replace("{words}", view.proposal.about ?? view.proposal.split?.about ?? "")}</p> : null}
        {failedOf(view) ? <p className="af-hint ag-reason">{failedOf(view)}</p> : null}
        {view.proposal.after && view.reason && !failedOf(view).includes(view.reason) ? <p className="ag-reason ag-reason--said">{view.reason}</p> : null}
        <p className="ag-card__state">
          <b>{t(PROPOSAL_STATE_KEY[view.state]).replace("{team}", teamOf(view.proposal.resource))}</b>
          {view.sentAs ? ` · ${view.sentAs}` : ""}
          {view.state === "open" ? ` · ${t("ag.inFavour").replace("{n}", String(view.inFavour.length)).replace("{of}", String(needed))}` : ""}
        </p>
        {(live || view.state === "rejected") && view.against.length ? (
          <p className="ag-against">{t(view.against.length === 1 ? "ag.keepsWho" : "ag.keepsWhoMany").replace("{who}", view.against.map((who) => (who.includes(" ") ? who : `@${who}`)).join(", "))}</p>
        ) : null}
        {view.state === "agreed" && mine && !view.proposal.after ? <p className="af-hint">{t("ag.needsVersion")}</p> : null}
        {stale ? (
          <div className="ag-stale" role="status">
            <p>
              <b>{t("ag.staleTitle")}</b> {t("ag.staleNext")}
            </p>
            {changed.trim() ? (
              <p className="ag-diff">
                <b>{t("ag.staleNow")}</b> <ProposalDiff before={view.proposal.before ?? ""} after={changed} plain />
              </p>
            ) : null}
          </div>
        ) : null}
        {view.state === "rejected" && !stepDone && (view.against.some(isMe) || trying) ? (
          <div className="ag-card__buttons">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void keepNoMore(view)}>
              {t("ag.keepUndo")}
            </Button>
          </div>
        ) : null}
        {live ? (
          <div className="ag-card__buttons">
            {view.state === "open" && !forIt && !stale ? (
              <Button type="button" disabled={saving} onClick={() => void agree(view)}>
                {t("ag.agree")}
              </Button>
            ) : null}
            {mayKeep ? (
              <Button type="button" variant="outline" disabled={saving} onClick={() => void keepAsIs(view)}>
                {t("ag.keep")}
              </Button>
            ) : null}
            {view.state === "agreed" && !stale && (view.proposal.after || !mine) ? (
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
            {/* Written from words that are no longer there, another proposal is the one thing left to do with it. */}
            <Button type="button" variant={stale ? "default" : "ghost"} disabled={saving} onClick={() => setAnswering(view)}>
              {t(view.state === "agreed" && mine && !view.proposal.after ? "pr.newVersion" : "ag.other")}
            </Button>
            {isMe(view.by) ? (
              <Button type="button" variant="ghost" disabled={saving} onClick={() => void withdraw(view)}>
                {t("ag.withdraw")}
              </Button>
            ) : null}
            {view.state === "open" && forIt && !isMe(view.by) ? <span className="ag-mine">{t("ag.youAgree")}</span> : null}
            {view.state === "open" && keeps ? <span className="ag-mine">{t("ag.youKeep")}</span> : null}
          </div>
        ) : null}
      </li>
    );
  };

  /** The verse the help in view is about, in each text, with the words of the help marked and its quote said. */
  const verseDock = (group: HelpGroup) => {
    const [chapter, verse] = group.where.split(":").map(Number);
    const item = helpOf(group);
    const ofUnit = Boolean(verse) && chapter === ctx?.chapter;
    return (
      <section className="af-dock ag-dock" aria-label={t("ck.textsAria")}>
        <div className="af-dock__bar">
          <strong>
            {bookLabel(bookCode, language)} {group.where}
          </strong>
        </div>
        {unitTexts === null ? <LoadingState shape="text" label={t("ag.readingTexts")} lines={2} /> : null}
        {ofUnit
          ? textOrder.map((resource) => {
              const text = unitTexts?.[resource];
              const line = text?.verses[verse!] ?? "";
              if (!line) return null;
              // The help's quote is in the original: its words in this text come from the alignment.
              const hit = item?.quote ? alignedGatewayQuoteForHelpQuote({ verseText: line, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: text?.alignments, book: bookCode, chapter: chapter!, verse: verse!, ...(original ? { original: originalTokens(original, chapter!, verse!) } : {}) }) : null;
              return (
                <div key={resource} className="af-row">
                  <span className="af-lbl">{nameOf(resource)}</span>
                  <QuoteVerse text={line} marked={hit?.tokenIndices ?? []} />
                  {item?.quote ? (
                    <span className="ck-quote" data-found={hit?.gatewayText ? "true" : "false"}>
                      {hit?.gatewayText ? t("ck.quoteIs").replace("{quote}", hit.gatewayText) : t("ck.quoteMissing").replace("{text}", nameOf(resource))}
                    </span>
                  ) : null}
                </div>
              );
            })
          : null}
      </section>
    );
  };

  const filters: Filter[] = ["pending", "shared", "all"];
  const filterLabel = (f: Filter) => t(f === "pending" ? "ag.filterPending" : f === "shared" ? "ag.filterShared" : "ag.filterAll").replace("{n}", String(counts[f]));

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
      {busy ? <LoadingState shape="tool" label={t("ag.loading")} /> : null}
      {trying ? (
        <p className="ck-trying" role="status">
          {t("ck.trying")}
        </p>
      ) : null}
      {data && !busy ? (
        <>
          {groups.length ? (
            <>
              {/* Which helps to go through: what is left, the ones with more than one version to choose between, or all. */}
              <div className="pr-chips ag-filters" role="group" aria-label={t("ag.listTitle")}>
                {filters.map((f) => (
                  <button key={f} type="button" aria-pressed={shownFilter === f} disabled={!counts[f] && shownFilter !== f} onClick={() => pick(f)}>
                    {filterLabel(f)}
                  </button>
                ))}
              </div>
              {current ? (
                <>
                  {/* Where one is, and the way to the help before and after: the same line as the proposals of Afinación. */}
                  <div ref={mark} className="pl-pos-mark ag-pos-mark" aria-hidden />
                  <nav className="pl-pos ag-pos" data-stuck={stuck ? "true" : undefined} aria-label={t("ag.listTitle")}>
                    {index > 0 ? (
                      <Button type="button" variant="outline" className="pl-pos__step" aria-label={t("pl.prevTo").replace("{ref}", walk[index - 1]!.where)} onClick={() => go(index - 1)}>
                        <ChevronLeft aria-hidden className="size-5" />
                      </Button>
                    ) : (
                      <span className="pl-pos__step" aria-hidden />
                    )}
                    <button type="button" className="pl-pos__at" aria-haspopup="dialog" aria-label={t("ag.listOpen")} onClick={() => setListOpen(true)}>
                      <strong>{current.where}</strong>
                      <span>{t("pl.posShort").replace("{n}", String(index + 1)).replace("{total}", String(walk.length))}</span>
                      <ChevronDown aria-hidden className="size-4" />
                    </button>
                    {index + 1 < walk.length ? (
                      // Once nothing here waits on me, the way on is tinted stronger, without looking like the thing to decide.
                      <Button type="button" variant="outline" className="pl-pos__step" data-go={current.views.some(waitsOnMe) ? undefined : "true"} aria-label={t("pl.nextTo").replace("{ref}", walk[index + 1]!.where)} onClick={() => go(index + 1)}>
                        <ChevronRight aria-hidden className="size-5" />
                      </Button>
                    ) : (
                      <span className="pl-pos__step" aria-hidden />
                    )}
                  </nav>
                  {verseDock(current)}
                  <section className="ag-help" aria-label={`${kindLabel(current)} · ${current.where}`}>
                    <div className="af-card__top">
                      <span className="af-chip">{kindLabel(current)}</span>
                    </div>
                    {livePart(current).length > 1 ? <p className="ag-shared">{t("ag.manyHere").replace("{n}", String(livePart(current).length))}</p> : null}
                    {/* The rule of the track, small, before what is agreed on: the helps explain without softening. */}
                    {rule && livePart(current).length ? <p className="af-criterion af-criterion--hint">{rule}</p> : null}
                    <ul className="ag-list">{current.views.map((view, n) => card(view, n + 1, current.views.length))}</ul>
                  </section>
                </>
              ) : (
                <p className="hub-hint">{t("ag.filterEmpty")}</p>
              )}
            </>
          ) : !byHand.length ? (
            <p className="hub-hint">{t("ag.none")}</p>
          ) : null}
          {byHand.length ? (
            <ul className="ag-list">
              {byHand.map((row) => (
                <li key={`${row.itemId}-${row.questionId}-${row.at}`} className="ag-card" data-state="applied">
                  <p className="ag-card__head">{t("ag.legacy").replace("{who}", row.by)}</p>
                  <p className="ag-comment">{row.note}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="af-hint ag-lede">{t(othersNeeded(needed) === 1 ? "ag.ledeOne" : "ag.lede").replace("{n}", String(needed)).replace("{m}", String(othersNeeded(needed)))}</p>
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
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="word-sheet pl-sheet ag-sheet" aria-describedby={undefined}>
          <DialogTitle className="ns-title">
            {t("ag.listTitle")} · {filterLabel(shownFilter)}
          </DialogTitle>
          {shown.length ? (
            <ol className="pl-list">
              {shown.map((group) => (
                <li key={group.key}>
                  <button type="button" className="pl-list__row" aria-current={group.key === current?.key ? "step" : undefined} data-state={livePart(group).length ? "open" : "decided"} onClick={() => choose(group)}>
                    <span className="pl-list__ref">{group.where}</span>
                    <span className="pl-list__state">
                      {kindLabel(group)} · {t(livePart(group).length ? "ag.rowPending" : "ag.rowSettled")}
                    </span>
                    {group.views.length > 1 ? <span className="pl-list__new">{t("ag.rowMany").replace("{n}", String(group.views.length))}</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hub-hint">{t("ag.filterEmpty")}</p>
          )}
        </DialogContent>
      </Dialog>
      <ProposalSheet open={Boolean(answering)} onClose={() => setAnswering(null)} targets={answerTargets} book={ctx?.book} failed={answering ? askedOf(answering) || undefined : undefined} rule={rule} reason={answering?.reason ?? ""} startFrom={answerStart} startSplit={answering?.proposal.split?.after} saving={saving} onSend={(draft) => void answerWith(draft)} />
    </div>
  );
}
