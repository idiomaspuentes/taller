import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { helpsAddressOf } from "../config";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Columns2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { HelpChangedError, applyProposal, checkedSteps, loadTaskAnswers, readProposedWords, sendProposal, type CheckedStep } from "../dcs/checkProposals";
import { loadUnitItems, loadUnitTexts, type ChecklistItem, type ChecklistKind, type ChecklistText, type ChecklistTextData } from "../dcs/checklistLoad";
import { loadTermTitles } from "../dcs/afinacionLoad";
import { termLabel } from "../domain/afinacionWords";
import { bookLabel } from "../domain/books";
import { alignedGatewayQuoteForHelpQuote, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { verseIsAligned } from "../domain/checklistReady";
import { freshRowId } from "../domain/helpsDraft";
import { verseFromSid } from "../domain/usfmAst";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { QuoteVerse } from "./QuoteVerse";
import { TextChangeView, saveLayout, savedLayout } from "./TextChangeView";
import { originalTokens, quoteFromSelection } from "../domain/quoteFromSelection";
import { appendCheckAnswers } from "../dcs/checkStore";
import { deliverSharedSubtask } from "../dcs/deliverShared";
import { loadPmConfig } from "../dcs/issues";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { agreeStepFromTool, stepAgreement, withdrawStepAgreementFromTool, type StepAgreement } from "../dcs/roundClose";
import { explainError } from "../dcs/userError";
import { uid } from "../domain/assignment";
import { appliedWords, byPlaceAndHelp, loadTrialChecks, proposalAnswer, proposalDone, proposalFit, proposalHelp, proposalKeeping, proposalSaying, proposalWords, proposalsOf, readable, saveTrialChecks, type ProposalPayload, type ProposalView } from "../domain/checkProposal";

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
/**
 * The versions still chosen among: until the team closes the step a vote can be changed, so one that has its
 * agreement, or that enough people would rather leave aside, is still an option (16 October). A vote was final:
 * the second «de acuerdo» wrote the version at once, and nobody could take it back.
 */
const candidateState = (view: ProposalView) => view.state === "open" || view.state === "agreed" || view.state === "rejected";
const livePart = (group: HelpGroup) => group.views.filter(candidateState);
/** A help is decided when none of its versions waits for more votes: one has its agreement, or all are left aside. */
const decidedGroup = (group: HelpGroup) => !livePart(group).some((view) => view.state === "open");
const inFilter = (group: HelpGroup, filter: Filter) => (filter === "all" ? true : filter === "pending" ? !decidedGroup(group) : livePart(group).length > 1);
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
  /** The versions whose changes are open against what the help says today. */
  const [diffOpen, setDiffOpen] = useState<Record<string, boolean>>({});
  /** The reasons read whole: a long one shows its first lines. */
  const [whyOpen, setWhyOpen] = useState<Record<string, boolean>>({});
  /**
   * A change read in one text, or its two versions apart (side by side where there is room): the same choice as in
   * the proposals of Afinación, kept for every proposal and every screen.
   */
  const [apart, setApart] = useState(() => savedLayout() !== "together");
  /** The text the verse is read in. */
  const [textTab, setTextTab] = useState<ChecklistText>("tpl");
  /** Writing another version beside the others, not in the place of one. */
  const [alongside, setAlongside] = useState(false);
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

  /**
   * A comment on a help of the team's own names no words to write: as it is it cannot be agreed on, only written
   * out (or left as it is). Agreed on, the step closed with nothing written and a message nobody understood.
   */
  const asksWords = (view: ProposalView) => ours(view.proposal.resource) && !view.proposal.after && !view.proposal.split;
  const listed = useMemo<Listed[]>(
    () =>
      byPlaceAndHelp(
        (data?.steps ?? []).flatMap((step) =>
          proposalsOf(answers[step.key] ?? [], needed, ours).map((view) => ({ ...view, stepKey: step.key, ...(!stepDone && view.state === "agreed" && asksWords(view) ? { state: "open" as const } : {}) })),
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, data, needed, stepDone],
  );
  /** The proposals by the help they are about, in the order they are read. */
  const groups = useMemo<HelpGroup[]>(() => {
    const out: HelpGroup[] = [];
    const byKey = new Map<string, HelpGroup>();
    // A version written in answer to another stays with it, though it is about another row: a comment written
    // out as a new note went off to a help of its own, and the comment's said «se acordó dejarla como está».
    const byId = new Map(listed.map((view) => [view.proposal.id, view]));
    const keyOf = (view: Listed, seen = new Set<string>()): string => {
      const was = view.proposal.replaces ? byId.get(view.proposal.replaces) : undefined;
      if (was && !seen.has(was.proposal.id)) return keyOf(was, seen.add(view.proposal.id));
      return proposalHelp(view.proposal) || view.proposal.id;
    };
    for (const view of listed) {
      const key = keyOf(view);
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
  /** What still waits for votes: the step can be closed once nothing does. */
  const undecided = listed.filter((view) => view.state === "open");

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
  const withdraw = (view: Listed) => act(() => add(view.stepKey, [proposalSaying(view.proposal.id, me, new Date().toISOString(), false)]));
  const markDone = (view: Listed) => act(() => add(view.stepKey, [proposalDone(view.proposal.id, me, new Date().toISOString())]));

  /**
   * Another version of the same thing, in answer to a proposal: it takes its place, and is the one to agree on. It
   * is written from the help as it is now, when that is known: from the words of the proposal it answers, one
   * that could not be applied because the help had changed was answered with another that could not either.
   */
  // A help proposed as new has no words yet but the ones proposed: another version of it starts from nothing too.
  const answerFrom = answering ? (answering.proposal.add ? "" : (wordsNow(answering.proposal) ?? answering.proposal.before)) : undefined;
  /**
   * A comment of the team's own about a note nobody could tell (the sheet did not say which, or it is a new one):
   * written out it is a new note of its verse, with the words it is about marked as in the list. Written as a
   * version of the comment, it was one more comment.
   */
  const asNewNote = answering && asksWords(answering) && answering.proposal.resource === "notas" && !answering.proposal.rowId ? answering : null;
  const newNoteId = useMemo(() => freshRowId(Object.keys(helpItems)), [helpItems, asNewNote?.proposal.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const noteVerse = (() => {
    if (!asNewNote || !ctx) return null;
    const [chapter, verse] = asNewNote.proposal.where.split(":").map(Number);
    const text = (["tpl", "tps"] as ChecklistText[]).map((resource) => unitTexts?.[resource]).find(Boolean);
    if (!verse || chapter !== ctx.chapter || !text || !original || !verseIsAligned(text.alignments, chapter, verse)) return null;
    const sid = Object.keys(text.alignments ?? {}).find((key) => verseFromSid(key, chapter) === verse);
    return { words: tokenizeVersePlainText(text.verses[verse] ?? ""), groups: sid ? text.alignments![sid]! : [], original: originalTokens(original, chapter, verse) };
  })();
  /** The words of the original under the words marked, and how those read: what the new note quotes. */
  const quotedBy = (marked: number[] | undefined): Pick<ProposalPayload, "fields" | "about"> => {
    if (!noteVerse || !marked?.length) return {};
    const found = quoteFromSelection({ verseTokens: noteVerse.words, selected: marked, groups: noteVerse.groups, original: noteVerse.original });
    const about = marked.map((index) => noteVerse.words[index]).join(" ");
    return found ? { fields: { Quote: found.quote, Occurrence: String(found.occurrence) }, about } : { about };
  };
  // The words a comment moved in from the sheet proposes, to start from: «… Propone: «…»».
  const proposedInComment = asNewNote ? /Propone: «([\s\S]*)»\s*$/.exec(asNewNote.reason)?.[1] : undefined;

  const answerWith = (draft: ProposalDraft) =>
    act(async () => {
      if (!answering) return;
      const was = answering.proposal;
      if (asNewNote && draft.after) {
        const proposal: ProposalPayload = { ...was, id: `pr-${uid()}`, replaces: was.id, add: true, rowId: newNoteId, field: "Note", after: draft.after, ...quotedBy(draft.marked) };
        await add(answering.stepKey, [proposalAnswer({ itemId: answering.itemId, questionId: answering.questionId, by: me, at: new Date().toISOString(), reason: draft.reason, proposal })]);
        setAnswering(null);
        return announce(t("ck.proposed"));
      }
      // Answering one that parts a note in two: still in two, with its new note as rewritten, or in one again.
      // Written beside the others («Escribir otra versión»), it is one more to choose from; in answer to one, it
      // takes its place.
      const proposal = { ...was, id: `pr-${uid()}`, ...(alongside ? { replaces: undefined } : { replaces: was.id }), ...(answerFrom !== undefined && !was.add ? { before: answerFrom } : {}), ...(draft.after ? { after: draft.after } : { after: undefined }), split: draft.split && was.split ? { ...was.split, after: draft.split.after } : undefined };
      await add(answering.stepKey, [proposalAnswer({ itemId: answering.itemId, questionId: answering.questionId, by: me, at: new Date().toISOString(), reason: draft.reason, proposal })]);
      setAnswering(null);
      setAlongside(false);
      announce(t("ck.proposed"));
    });
  const answerTargets: ProposalTarget[] = asNewNote
    ? [{ id: "same", label: t("pr.targetNewNote").replace("{ref}", asNewNote.proposal.where), resource: "notas", rowId: newNoteId, field: "Note", text: "", format: "note", add: true, ...(noteVerse?.words.length ? { words: noteVerse.words } : {}) }]
    : answering
    ? [{ id: "same", label: `${answering.proposal.where} · ${nameOf(answering.proposal.resource)}`, resource: answering.proposal.resource, text: answerFrom, commentOnly: answerFrom === undefined, ...(answering.proposal.add ? { add: true } : {}), ...(answering.proposal.split ? { split: { rowId: answering.proposal.split.rowId } } : {}), ...(answering.proposal.path ? { format: "markdown" as const } : answering.proposal.rowId && (answering.proposal.field ?? "Note") === "Note" ? { format: "note" as const } : {}), ...(ours(answering.proposal.resource) ? {} : { team: teamOf(answering.proposal.resource) }) }]
    : [];
  // A version the help no longer fits is not what the next one starts from: that one starts from the help.
  const answerStart = asNewNote ? proposedInComment : answering && changedTo(answering) === undefined ? answering.proposal.after : undefined;

  /**
   * My agreement on the step, and with it the step itself when it is everybody's. Closing the last step of a
   * subtarea delivers it, as the rounds of review do: nobody is left to find «Entregar» on their list.
   */
  async function agreeOnStep(mine: boolean) {
    if (!session || !ctx || !data?.step) return;
    if (trying || !ctx.pmOrg || !ctx.issueNumber) return announce(t("ag.tryApprove"));
    await act(async () => {
      const now = await agreeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, steps: data.task?.steps ?? [], step: data.step!, settled: undecided.length === 0, mine });
      setStanding(now);
      if (now.done) {
        // With the whole team's agreement, what was agreed is written, all of it at once: «Con todo el equipo de
        // acuerdo, se aplica». A version the help no longer fits is left agreed, with its way to apply it again.
        let failed = 0;
        for (const view of listed.filter((row) => row.state === "agreed")) {
          try {
            await carryOut(view);
          } catch {
            failed++;
          }
        }
        if (failed) announce(t("ag.applyFailed").replace("{n}", String(failed)));
        const delivered = data.board ? await deliverSharedSubtask({ session, pmOrg: ctx.pmOrg, lang: ctx.lang, contentOrg: ctx.contentOrg, board: data.board, issueNumber: ctx.issueNumber }).catch(() => false) : false;
        return announce(t(delivered ? "ag.closedDelivered" : "ag.closed"));
      }
      if (!mine) return;
      announce(t(!now.open ? "ag.locked" : now.agreed.some((who) => who.toLowerCase() === me.toLowerCase()) ? "ag.approved" : "ag.cannot"));
    });
  }
  /** My agreement on the step taken back, while it is open: as a vote can be (16 October). */
  async function takeBackAgreement() {
    if (!session || !ctx || !data?.step || trying || !ctx.pmOrg || !ctx.issueNumber) return;
    await act(async () => {
      const now = await withdrawStepAgreementFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, steps: data.task?.steps ?? [], step: data.step! });
      setStanding(now);
      announce(t(now.done ? "ag.unapproveLate" : "ag.unapproved"));
    });
  }
  // Everybody had agreed and something was still to be resolved: the step closes when the last of it is, once.
  const closedLate = useRef(false);
  useEffect(() => {
    if (closedLate.current || trying || saving || !standing || standing.done || !standing.open || !standing.complete || undecided.length) return;
    closedLate.current = true;
    void agreeOnStep(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standing, undecided.length, saving]);

  /** What the foot says: what is left to resolve, or whose agreement is given and whose is missing. */
  const footSays = () => {
    if (undecided.length) return t(undecided.length === 1 ? "ag.pendingOne" : "ag.pending").replace("{n}", String(undecided.length));
    if (!standing) return t("ag.allSettled");
    if (!standing.open) return t("ag.locked");
    const names = (list: string[]) => list.map((who) => `@${who}`).join(", ");
    // Nobody seated is missing, and the step takes more people than have sat down: how many more.
    const more = Math.max(1, standing.needed - standing.agreed.length);
    if (approved) return `${t("ag.youAgreed")} ${standing.missing.length ? t("ag.missingWho").replace("{who}", names(standing.missing)) : more > 1 ? t("ag.missingOthers").replace("{n}", String(more)) : t("ag.missingOther")}`;
    // The last agreement writes what was agreed, and there is no taking it back: said before it is given.
    const seatedMe = standing.seated.some(isMe);
    const others = standing.missing.filter((who) => !isMe(who));
    if (!others.length && standing.seated.length + (seatedMe ? 0 : 1) >= standing.needed) return t("ag.lastOne");
    return standing.agreed.length ? `${t("ag.allSettled")} ${t("ag.agreedBy").replace("{who}", names(standing.agreed))}` : t("ag.allSettled");
  };

  const stepName = data?.step ? localized(data.step.name, data.step.names, language) : t("ag.title");
  const isMe = (who: string) => who.toLowerCase() === me.toLowerCase();

  const rule = data?.task && data.step ? stepPurpose(data.task.id, data.step, language).criterion : undefined;
  const bookCode = (ctx?.book || ctx?.projectId || "").toUpperCase();
  const textOrder = (["tpl", "tps"] as ChecklistText[]).filter((resource) => unitTexts?.[resource]);
  const shownText = textOrder.includes(textTab) ? textTab : textOrder[0];

  /**
   * Where I stand on a help: the version I am for (mine while it stands, or one I said I agree with), «keep» when
   * I would rather leave it as it is for every version, nothing when I have said nothing yet.
   */
  const standOf = (group: HelpGroup): string | undefined => {
    const live = livePart(group);
    const forOne = live.find((view) => (isMe(view.by) && !trying) || view.inFavour.some((who) => isMe(who) && !isMe(view.by)));
    if (forOne) return forOne.proposal.id;
    const others = live.filter((view) => !isMe(view.by));
    if (others.length && others.every((view) => view.against.some(isMe))) return "keep";
    return undefined;
  };
  /** Whether a help still waits for what I say of it: once nothing does, the way on is tinted stronger. */
  const waitsOnMe = (group: HelpGroup) => !stepDone && !decidedGroup(group) && standOf(group) === undefined;
  const leftToMe = groups.filter(waitsOnMe).length;
  const settledGroups = groups.filter(decidedGroup).length;

  /**
   * What I say of a help, as one choice among its versions and leaving it as it is: for the one chosen, for leaving
   * the others as they are (so they are resolved too, and do not hold the step), my own taken back if I chose
   * another. Each version had its buttons, and two versions of one note read as two things to do (16 October).
   */
  const decide = (group: HelpGroup, pick: string) =>
    act(async () => {
      const now = new Date().toISOString();
      const byStep = new Map<string, CheckAnswer[]>();
      const put = (view: Listed, row: CheckAnswer) => byStep.set(view.stepKey, [...(byStep.get(view.stepKey) ?? []), row]);
      let chosen: Listed | undefined;
      for (const view of livePart(group)) {
        const author = isMe(view.by) && !trying;
        const voter = voterFor(view);
        const keeper = keeperFor(view);
        const isFor = view.inFavour.some((who) => who.toLowerCase() === voter.toLowerCase());
        const isAgainst = view.against.some((who) => who.toLowerCase() === keeper.toLowerCase());
        if (view.proposal.id === pick) {
          chosen = view;
          if (isAgainst) put(view, proposalKeeping(view.proposal.id, keeper, now, false));
          if (!isFor) put(view, proposalSaying(view.proposal.id, voter, now, true));
        } else if (author) {
          put(view, proposalSaying(view.proposal.id, me, now, false));
        } else {
          if (isFor) put(view, proposalSaying(view.proposal.id, voter, now, false));
          if (!isAgainst) put(view, proposalKeeping(view.proposal.id, keeper, now, true));
        }
      }
      for (const [stepKey, rows] of byStep) await add(stepKey, rows);
      // A vote writes nothing: with enough of the team for one version there is agreement, applied when the step
      // closes, and until then any vote can change.
      const reached = chosen ? new Set([...chosen.inFavour.map((who) => who.toLowerCase()), voterFor(chosen).toLowerCase()]).size >= needed : false;
      announce(t(reached ? "ag.agreedNow" : "ag.saved"));
    });

  /** My vote on a help taken back: for the one I voted, and against the others, said no more. */
  const clearVote = (group: HelpGroup) =>
    act(async () => {
      const now = new Date().toISOString();
      for (const view of livePart(group)) {
        const voter = voterFor(view);
        const keeper = keeperFor(view);
        const rows: CheckAnswer[] = [];
        if (!isMe(view.by) || trying) {
          if (view.inFavour.some((who) => who.toLowerCase() === voter.toLowerCase())) rows.push(proposalSaying(view.proposal.id, voter, now, false));
        }
        if (view.against.some((who) => who.toLowerCase() === keeper.toLowerCase())) rows.push(proposalKeeping(view.proposal.id, keeper, now, false));
        if (rows.length) await add(view.stepKey, rows);
      }
      announce(t("ag.saved"));
    });

  /**
   * How an option is voted: a button of its own, as in the proposals of Afinación. A circle to mark and a button
   * under all of them read as a form: once marked, it could not be seen that it was one option among others, nor
   * how to take it back (16 October).
   */
  const voteFor = (group: HelpGroup, id: string, own: boolean, label: string) => {
    if (stepDone) return null;
    const stand = standOf(group);
    if (own) return <p className="ag-own">{t("ag.ownVersion")}</p>;
    if (stand === id) {
      return (
        <div className="ag-vote">
          <span className="ag-voted">
            <Check aria-hidden className="size-4" /> {t("ag.yourVote")}
          </span>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void clearVote(group)}>
            {t("ag.unvote")}
          </Button>
        </div>
      );
    }
    return (
      <div className="ag-vote">
        <Button type="button" variant="outline" disabled={saving} onClick={() => void decide(group, id)}>
          {stand ? t("ag.voteChange") : label}
        </Button>
      </div>
    );
  };

  /** What a version is called: whose it is, and what kind of change. */
  const titleOf = (view: Listed): string => {
    const who = isMe(view.by) ? "" : view.by;
    if (view.proposal.split) return who ? t("ag.optSplit").replace("{who}", who) : t("ag.optSplitMine");
    if (view.proposal.add) return who ? t("ag.optNew").replace("{who}", who) : t("ag.optNewMine");
    if (!view.proposal.after) return who ? t("ag.optComment").replace("{who}", who) : t("ag.optCommentMine");
    return who ? t("ag.optBy").replace("{who}", who) : t("ag.optMine");
  };
  /** Who is for a version, and how many more it takes: «Apoyan: @ana · falta 1 persona». */
  const backingOf = (view: Listed): string => {
    const names = view.inFavour.map((who) => (who.includes(" ") ? who : `@${who}`)).join(", ");
    const missing = Math.max(0, needed - view.inFavour.length);
    const more = view.state === "agreed" || !missing ? t("ag.ready") : t(missing === 1 ? "ag.missingOne" : "ag.missingMany").replace("{n}", String(missing));
    return `${t("ag.backing").replace("{who}", names || "—")} · ${more}`;
  };
  /** The reason, without what the migration wrote of a review nobody signed: the team reads it as a verdict. */
  const reasonOf = (view: Listed): string => view.reason.replace(/\s*Revisión previa \([^)]*\):[\s\S]*$/, "").trim();

  /** A version as it would read, with what it changes a touch away. */
  const versionText = (view: Listed) => {
    const after = view.proposal.after ?? "";
    if (view.proposal.split) {
      // Each note with the words it is about, when they were said: the half that stays may quote other words now.
      const about = (words?: string) => (words ? <span className="ag-opt__about">{t("ag.about").replace("{words}", words)}</span> : null);
      return (
        <>
          <p className="ag-opt__text">
            {about(view.proposal.about)}
            {readable(after)}
          </p>
          <p className="ag-opt__text ag-opt__text--new">
            <span className="af-lbl">{t("pr.newNoteLbl")}</span> {about(view.proposal.split.about)}
            {readable(view.proposal.split.after)}
          </p>
        </>
      );
    }
    if (!view.proposal.after) return <p className="ag-opt__text">{reasonOf(view)}</p>;
    // An article is pages long: what changes in it is what is read; the whole of it a touch away.
    if (view.proposal.path) {
      return (
        <p className="ag-opt__text ag-diff">
          <ProposalDiff before={view.proposal.before ?? ""} after={after} plain />
        </p>
      );
    }
    return <p className="ag-opt__text">{readable(after.replace(/\\n/g, "\n"))}</p>;
  };

  /** One version of the help, to choose: as it would read, why, and who is for it. */
  const option = (group: HelpGroup, view: Listed) => {
    const live = candidateState(view) && !stepDone;
    const changed = live ? changedTo(view) : undefined;
    const stale = changed !== undefined;
    const mineToWrite = ours(view.proposal.resource);
    const why = reasonOf(view);
    const open = diffOpen[view.proposal.id] ?? false;
    return (
      <li key={view.proposal.id} className="ag-opt" data-picked={(live && standOf(group) === view.proposal.id && !isMe(view.by)) || undefined} data-state={view.state}>
        <div className="ag-opt__head">
          <b>{titleOf(view)}</b>
          {live && asksWords(view) ? null : <span className="ag-opt__who">{live ? backingOf(view) : t(PROPOSAL_STATE_KEY[view.state]).replace("{team}", teamOf(view.proposal.resource))}</span>}
        </div>
        {versionText(view)}
        {view.proposal.after && why ? (
          // Three lines of it, and the rest a touch away: a reason of five lines made its version twice as tall.
          <p className="ag-opt__why" data-clamped={why.length > 180 && !whyOpen[view.proposal.id] ? "true" : undefined}>
            <b>{t("ag.why")}</b> {why}
          </p>
        ) : null}
        {view.proposal.after && why.length > 180 ? (
          <button type="button" className="af-link ag-why-more" aria-expanded={Boolean(whyOpen[view.proposal.id])} onClick={() => setWhyOpen((prev) => ({ ...prev, [view.proposal.id]: !prev[view.proposal.id] }))}>
            {t(whyOpen[view.proposal.id] ? "ag.whyLess" : "ag.whyMore")}
          </button>
        ) : null}
        {failedOf(view) ? <p className="ag-opt__why">{failedOf(view)}</p> : null}
        {live && view.against.length ? <p className="ag-against">{t("ag.notBacking").replace("{who}", view.against.map((who) => (who.includes(" ") ? who : `@${who}`)).join(", "))}</p> : null}
        {stale ? (
          <div className="ag-stale" role="status">
            <p>
              <b>{t("ag.staleTitle")}</b> {t("ag.staleNext")}
            </p>
          </div>
        ) : null}
        <div className="ag-opt__links">
          {view.proposal.after && !view.proposal.split ? (
            <button type="button" className="af-link" aria-expanded={open} onClick={() => setDiffOpen((prev) => ({ ...prev, [view.proposal.id]: !open }))}>
              {t(view.proposal.path ? (open ? "ag.hideWhole" : "ag.wholeArticle") : open ? "ag.hideChange" : "ag.showChange")}
            </button>
          ) : null}
          {view.state === "agreed" && stepDone && !stale && (view.proposal.after || !mineToWrite) ? (
            // Agreed and not carried out when the step closed: the write failed.
            <button type="button" className="af-link" disabled={saving} onClick={() => void act(() => carryOut(view))}>
              {mineToWrite ? t("ag.apply") : t("ag.send").replace("{team}", teamOf(view.proposal.resource))}
            </button>
          ) : null}
          {view.state === "agreed" && stepDone && mineToWrite && !view.proposal.after ? (
            <button type="button" className="af-link" disabled={saving} onClick={() => void markDone(view)}>
              {t("ag.done")}
            </button>
          ) : null}
          {live && isMe(view.by) ? (
            <button type="button" className="af-link" disabled={saving} onClick={() => void withdraw(view)}>
              {t("ag.withdraw")}
            </button>
          ) : null}
        </div>
        {open && view.proposal.after ? (
          // What goes in red and what comes in green, in one text or the two apart, as the proposals of Afinación.
          <TextChangeView
            before={readable(view.proposal.before ?? "")}
            after={readable(view.proposal.after)}
            lines
            layout={apart ? "sides" : "together"}
            labels={{ now: t("ag.today"), proposed: titleOf(view) }}
            corner={
              <button type="button" className="pl-apart" aria-pressed={apart} aria-label={t(apart ? "tc.joinedAria" : "tc.apartAria")} title={t(apart ? "tc.joinedAria" : "tc.apartAria")} onClick={() => {
                saveLayout(apart ? "together" : "sides");
                setApart(!apart);
              }}>
                <Columns2 aria-hidden className="size-5" />
              </button>
            }
          />
        ) : null}
        {live && asksWords(view) ? (
          // Written out, the version takes the comment's place and is the one voted on.
          <div className="ag-vote ag-vote--words">
            <p className="af-hint">{t("ag.commentNeedsWords")}</p>
            <Button type="button" variant="outline" disabled={saving} onClick={() => {
              setAlongside(false);
              setAnswering(view);
            }}>
              {t("ag.writeFromComment")}
            </Button>
          </div>
        ) : live && !stale ? (
          voteFor(group, view.proposal.id, isMe(view.by) && !trying, t(view.proposal.after ? "ag.vote" : "ag.voteComment"))
        ) : null}
      </li>
    );
  };

  /** The help in view: what it says today, how it could read, and the one thing to do with it. */
  const helpSection = (group: HelpGroup) => {
    const live = stepDone ? [] : livePart(group);
    const settled = group.views.filter((view) => !live.includes(view));
    const agreedOn = live.find((view) => view.state === "agreed");
    const keptBy = live.length > 0 && live.every((view) => view.state === "rejected");
    const first = live[0] ?? group.views[0]!;
    const article = Boolean(first.proposal.path);
    const today = first.proposal.add ? undefined : (wordsNow(first.proposal) ?? first.proposal.before);
    const stand = standOf(group);
    // Who would rather leave it as it is: against every version, not only the ones they did not vote for.
    const keepers = live.length ? [...new Set(live[0]!.against)].filter((who) => live.every((view) => view.against.some((other) => other.toLowerCase() === who.toLowerCase()))) : [];
    const mineAmong = live.some((view) => isMe(view.by)) && !trying;
    const term = helpOf(group)?.title;
    // What the help is, said in the question itself: «¿Cómo debe quedar el artículo «rey»?».
    const question = article
      ? term && (group.resource === "palabras" || helpOf(group)?.supportRef)
        ? t("ag.questionTerm").replace("{term}", termLabel(term, termTitles))
        : t("ag.questionArticle")
      : group.resource === "notas"
        ? t("ag.questionNote")
        : !ours(group.resource)
          ? t("ag.questionText").replace("{name}", nameOf(group.resource)).replace("{ref}", group.where)
          : t("ag.questionOther");
    // What another team keeps (the TPL, for the team of afinación) is not decided by the rule of these helps, and
    // is not written here: what is agreed is asked of that team (20 October). The rule of the notes was said over
    // a change to the TPL, and nothing said where it would go.
    const elsewhere = !ours(group.resource) ? teamOf(group.resource) : "";
    return (
      <section className="ag-help" aria-label={`${kindLabel(group)} · ${group.where}`}>
        {live.length ? (
          <>
            {today !== undefined && !article ? (
              <div className="ag-today">
                <p className="af-lbl">{t("ag.today")}</p>
                <p className="ag-today__text">{readable(today.replace(/\\n/g, "\n"))}</p>
              </div>
            ) : first.proposal.add ? (
              <p className="af-hint">{t("ag.todayNew")}</p>
            ) : null}
            {/* The decision, one group: the question, the rule it is decided by, the options and the button. */}
            <div className="ag-decision">
            <h2 className="ag-question">{question}</h2>
            {elsewhere ? <p className="af-criterion af-criterion--hint">{t("ag.otherTeam").replace("{team}", elsewhere)}</p> : rule ? <p className="af-criterion af-criterion--hint">{rule}</p> : null}
            {mineAmong ? <p className="af-hint">{t("ag.choiceMine")}</p> : null}
            {agreedOn || keptBy ? (
              // Agreed is not yet written: said, with when it is and that votes can still change.
              <div className="ag-agreement" role="status">
                <p className="ag-agreement__what">{agreedOn ? t("ag.agreedOn").replace("{what}", titleOf(agreedOn)) : t(article ? "ag.agreedKeepArticle" : "ag.agreedKeep")}</p>
                <p className="ag-agreement__when">{t("ag.agreedWhen")}</p>
              </div>
            ) : null}
            <ul className="ag-opts" aria-label={question}>
              {live.map((view) => option(group, view))}
              <li className="ag-opt ag-opt--keep" data-picked={stand === "keep" || undefined}>
                <div className="ag-opt__head">
                  <b>{t(article ? "ag.optKeepArticle" : "ag.optKeep")}</b>
                  {keepers.length ? <span className="ag-opt__who">{t("ag.keepers").replace("{who}", keepers.map((who) => (who.includes(" ") ? who : `@${who}`)).join(", "))}</span> : null}
                </div>
                {voteFor(group, "keep", false, t(article ? "ag.voteKeepArticle" : "ag.voteKeep"))}
              </li>
            </ul>
            {!stepDone ? (
              <div className="ag-decide">
                <button type="button" className="af-link ag-write" disabled={saving} onClick={() => {
                  const from = live.find((view) => view.proposal.id === stand) ?? first;
                  setAlongside(true);
                  setAnswering(from);
                }}>
                  {t("ag.writeOther")}
                </button>
              </div>
            ) : null}
            </div>
          </>
        ) : (
          // What was agreed, said: «resolved» alone did not say which version it is now.
          <p className="ag-resolved">
            {(() => {
              const won = settled.find((view) => view.state === "applied" || view.state === "sent");
              const pending = settled.find((view) => view.state === "agreed");
              // A comment agreed on names no words to write: somebody writes the version and says it is done.
              return won ? t("ag.resolvedTo").replace("{what}", titleOf(won)) : pending ? t(pending.proposal.after ? "ag.agreedNotApplied" : "ag.agreedNeedsVersion").replace("{what}", titleOf(pending)) : t("ag.resolvedKept");
            })()}
          </p>
        )}
        {settled.length ? (
          <details className="ag-settled">
            <summary>{t("ag.settledTitle").replace("{n}", String(settled.length))}</summary>
            <ul className="ag-opts">{settled.map((view) => option(group, view))}</ul>
          </details>
        ) : null}
      </section>
    );
  };

  /** The verse the help in view is about, in one text at a time, with the help's words marked and its quote said. */
  const verseDock = (group: HelpGroup) => {
    const [chapter, verse] = group.where.split(":").map(Number);
    const item = helpOf(group);
    const ofUnit = Boolean(verse) && chapter === ctx?.chapter;
    const text = shownText ? unitTexts?.[shownText] : undefined;
    const line = ofUnit && text ? (text.verses[verse!] ?? "") : "";
    // The help's quote is in the original: its words in this text come from the alignment.
    const hit = item?.quote && line ? alignedGatewayQuoteForHelpQuote({ verseText: line, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: text?.alignments, book: bookCode, chapter: chapter!, verse: verse!, ...(original ? { original: originalTokens(original, chapter!, verse!) } : {}) }) : null;
    return (
      <section className="af-dock ag-dock" aria-label={t("ck.textsAria")}>
        <div className="af-dock__bar ag-dock__bar">
          <strong>
            {bookLabel(bookCode, language)} {group.where}
          </strong>
          {textOrder.length > 1 ? (
            // One text at a time: the two whole took a phone's first screen, and the help came under them.
            <span className="ag-tabs" role="tablist" aria-label={t("ck.textsAria")}>
              {textOrder.map((resource) => (
                <button key={resource} type="button" role="tab" aria-selected={resource === shownText} onClick={() => setTextTab(resource)}>
                  {nameOf(resource)}
                </button>
              ))}
            </span>
          ) : null}
        </div>
        {unitTexts === null ? <LoadingState shape="text" label={t("ag.readingTexts")} lines={2} /> : null}
        {line ? (
          <div className="af-row">
            <QuoteVerse text={line} marked={hit?.tokenIndices ?? []} />
            {item?.quote ? (
              <span className="ck-quote" data-found={hit?.gatewayText ? "true" : "false"}>
                {hit?.gatewayText ? t("ck.quoteIs").replace("{quote}", hit.gatewayText) : t("ck.quoteMissing").replace("{text}", nameOf(shownText!))}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  };

  const filters: Filter[] = ["pending", "shared", "all"];
  const filterLabel = (f: Filter) => t(f === "pending" ? "ag.filterPending" : f === "shared" ? "ag.filterShared" : "ag.filterAll").replace("{n}", String(counts[f]));
  const filterShort = t(shownFilter === "pending" ? "ag.posPending" : shownFilter === "shared" ? "ag.posShared" : "ag.posAll");

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
            current ? (
              <>
                {/* Where one is, and the way to the help before and after: the same line as the proposals of Afinación.
                    Which helps are gone through is chosen in the list, behind the middle of it. */}
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
                    <span>
                      {t("pl.posShort").replace("{n}", String(index + 1)).replace("{total}", String(walk.length))} {filterShort}
                    </span>
                    <ChevronDown aria-hidden className="size-4" />
                  </button>
                  {index + 1 < walk.length ? (
                    // Once nothing here waits on me, the way on is tinted stronger, without looking like the thing to decide.
                    <Button type="button" variant="outline" className="pl-pos__step" data-go={waitsOnMe(current) ? undefined : "true"} aria-label={t("pl.nextTo").replace("{ref}", walk[index + 1]!.where)} onClick={() => go(index + 1)}>
                      <ChevronRight aria-hidden className="size-5" />
                    </Button>
                  ) : (
                    <span className="pl-pos__step" aria-hidden />
                  )}
                </nav>
                {verseDock(current)}
                {helpSection(current)}
              </>
            ) : (
              <p className="hub-hint">{t("ag.filterEmpty")}</p>
            )
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
          {/* The foot says how it goes; agreeing to the step is offered once nothing is left to resolve. A filled button
              that could not be touched until the last of 84 was the loudest thing on the screen. */}
          <div className="ck-go ag-foot-bar" data-on>
            {stepDone ? (
              <>
                <p className="ag-foot" role="status">
                  {t("ag.closedFinal")}
                </p>
                <Button type="button" size="lg" variant="outline" onClick={onClose}>
                  {t("fa.back")}
                </Button>
              </>
            ) : undecided.length ? (
              <p className="ag-foot" role="status">
                {t(leftToMe ? "ag.footLeft" : "ag.footLeftNone").replace("{n}", String(leftToMe)).replace("{m}", String(settledGroups)).replace("{t}", String(groups.length))}
              </p>
            ) : (
              <>
                <p className="ag-foot" role="status">
                  {footSays()}
                </p>
                {approved ? (
                  <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void takeBackAgreement()}>
                    {t("ag.unapprove")}
                  </Button>
                ) : (
                  <Button type="button" size="lg" disabled={saving || standing?.open === false} onClick={() => void agreeOnStep(true)}>
                    {t("ag.approve")}
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      ) : null}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="word-sheet pl-sheet ag-sheet" aria-describedby={undefined}>
          <DialogTitle className="ns-title">{t("ag.listTitle")}</DialogTitle>
          {/* Which helps to go through: what is left, the ones with more than one version to choose between, or all. */}
          <div className="pr-chips ag-filters" role="group" aria-label={t("ag.listTitle")}>
            {filters.map((f) => (
              <button key={f} type="button" aria-pressed={shownFilter === f} disabled={!counts[f] && shownFilter !== f} onClick={() => pick(f)}>
                {filterLabel(f)}
              </button>
            ))}
          </div>
          {shown.length ? (
            <ol className="pl-list">
              {shown.map((group) => (
                <li key={group.key}>
                  <button type="button" className="pl-list__row" aria-current={group.key === current?.key ? "step" : undefined} data-state={livePart(group).length ? "open" : "decided"} onClick={() => choose(group)}>
                    <span className="pl-list__ref">{group.where}</span>
                    <span className="pl-list__state">
                      {kindLabel(group)} · {t(!livePart(group).length ? "ag.rowSettled" : waitsOnMe(group) ? "ag.rowYours" : "ag.rowPending")}
                    </span>
                    {livePart(group).length > 1 ? <span className="pl-list__new">{t("ag.rowMany").replace("{n}", String(livePart(group).length))}</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hub-hint">{t("ag.filterEmpty")}</p>
          )}
        </DialogContent>
      </Dialog>
      <ProposalSheet open={Boolean(answering)} onClose={() => { setAnswering(null); setAlongside(false); }} targets={answerTargets} book={ctx?.book} failed={answering && !alongside ? askedOf(answering) || undefined : undefined} rule={rule} reason={alongside ? "" : (answering?.reason ?? "")} startFrom={answerStart} startSplit={answering?.proposal.split?.after} saving={saving} address={helpsAddressOf(ctx?.pmOrg)} onSend={(draft) => void answerWith(draft)} />
    </div>
  );
}
