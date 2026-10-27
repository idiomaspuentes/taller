import { toolHeading } from "./toolHeading";
import { helpsAddressOf } from "../config";
import { ToolHeader } from "./ToolHeader";
import { StepAsk } from "./StepAsk";
import { HelpMessages } from "./HelpMessages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { HelpVersions } from "./HelpVersions";
import { articlePathOf, categoryFromSupportRef, categoryLabel } from "../domain/afinacionNotes";
import { localizeAfinacion } from "../domain/afinacionNames";
import { missingWork, verseIsAligned, verseList, type MissingWork } from "../domain/checklistReady";
import { articleMessageKey, termMessageKey } from "../domain/studyNotes";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, Circle, Clock3, Info, List, Maximize2, MessageCircle, Pencil, Plus, Share2, X } from "lucide-react";
import { articleLead } from "../domain/articleSections";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChapterPair } from "./ChapterReader";
import { bookLabel } from "../domain/books";
import { MoreMenu } from "./MoreMenu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { appendCheckAnswers, loadCheckAnswers } from "../dcs/checkStore";
import { chapterTextOf, loadArticleBody, loadTermTitles, type ChapterText } from "../dcs/afinacionLoad";
import { resolveSourcePackage, sourcePackageLang } from "../domain/sourcePackage";
import { articleBody, termArticlePath, termLabel, type TermKind } from "../domain/afinacionWords";
import { loadChecklist, type ChecklistData, type ChecklistItem, type ChecklistKind, type ChecklistText } from "../dcs/checklistLoad";
import { commentOnIssue } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { goOnAfterStep } from "../dcs/nextStep";
import { useStepWork } from "../dcs/stepWork";
import { freshRowId } from "../domain/helpsDraft";
import { asksOf, consultReply, groupInView, groupsOf, questionsFor, summarizeChecklist, withVerseStops, type CheckAnswer, type CheckItem, type CheckOutcome, type ThreadLine } from "../domain/checklist";
import { DISPUTE_DAYS, disputeStalled, ITEM_SAYS, KEEP_OPTION, itemSaying, versionsOf as chainOf, PROPOSAL_DECIDED, PROPOSAL_FREE, PROPOSAL_KEEPS, PROPOSAL_SAYS, proposalDecided, loadTrialChecks, proposalAnswer, proposalDone, proposalKeeping, proposalSaying, proposalsOf, readable, saveTrialChecks, withoutWithdrawn, type ProposalPayload, type ProposalView } from "../domain/checkProposal";
import { NoteConversation, OPEN_TALK, type TalkLine, type TalkStatus } from "./NoteConversation";
import { NoteOptions, type HelpOption, type OptionMessage } from "./NoteOptions";
import type { ProposalCheckGroup } from "./ProposalCheck";
import { adjustmentDeclined, proposalMark } from "../domain/singleProposal";
import { agreementRows, noteSituation, type NoteSituation } from "../domain/noteSituation";
import { NoteAnswer } from "./NoteAnswer";
import { NoteThread, THREAD_BOX } from "./NoteThread";
import { noteTimeline } from "../domain/noteTimeline";
import { SituationLine } from "./SituationLine";
import { ProposalCard } from "./ProposalCard";
import { AdjustmentList } from "./AdjustmentList";
import { applyProposal, sendProposal as askOwnersFor } from "../dcs/checkProposals";
import { shareTurnFromTool } from "../dcs/roundClose";
import { uid } from "../domain/assignment";
import { ownerLabel } from "../domain/resourceOwner";
import { PROPOSAL_STATE_KEY, ProposalDiff, ProposalSheet, type ProposalDraft, type ProposalTarget } from "./ProposalSheet";
import { listIssueComments } from "@ip-lms/dcs-client";
import { dcsConfig } from "../dcs/config";
import { PM_REPO_NAME } from "../domain/types";
import { alignedGatewayQuoteForHelpQuote, helpQuoteInTexts, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { coordinatorsOf, isCoordinatorOf } from "../domain/levels";
import { localized, questionText, stepPurpose } from "../domain/processes";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { textFingerprint } from "../domain/reviewRound";
import { closesInItsTool, stepMinAssignees } from "../domain/stepClaim";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { scopeLabel } from "../domain/resourceNames";
import { originalTokens, quoteFromSelection, quoteUnits, toggleQuoteWord, wholeQuoteWords } from "../domain/quoteFromSelection";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { verseFromSid } from "../domain/usfmAst";
import { readTeamArticle, saveNoteQuote, type TeamArticle } from "../dcs/teamHelps";
import { explainError } from "../dcs/userError";
import { LoadingState } from "./LoadingState";
import { ChapterHelpsList } from "./ChapterHelpsList";
import { usePresence } from "./usePresence";
import { peersOn, presenceRoom, type Peer } from "../domain/presence";
import { nextNeeding, rosterOf, sectionsOf } from "../domain/chapterRoster";
import { helpLinkHash } from "../domain/helpLink";
import { QuoteVerse as Verse } from "./QuoteVerse";

type Props = {
  ctxEncoded: string;
  /** What the checklist goes over, and the text each item is checked against: the process says it per step. */
  kind: ChecklistKind;
  texts: ChecklistText[];
  /** Go over only the items that link to a support article. */
  onlyLinked?: boolean;
  /** The help to open on, instead of the list: a link sent by the team (see `helpLink.ts`). */
  openItem?: string;
  onClose: () => void;
  announce: (msg: string) => void;
};

const OUTCOME_KEY: Record<CheckOutcome, MessageKey> = { fixed: "ck.fixed", created: "ck.created", consult: "ck.consult", proposal: "ck.proposal" };
const excerpt = (text: string) => (text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text);
/**
 * How a question stands, as its mark says it: answered «yes», a «no» with nothing done about it yet, or a «no»
 * that something settles (a change proposed, or made, or an answer from whoever was asked). The two kinds of «no»
 * had one mark, a cross: a step where a change had been proposed read as one that had gone wrong.
 */
type Mark = "none" | "yes" | "no" | "change" | "wait";
/**
 * How an answer is marked. A consultation not answered yet (an article waiting to be translated) is «waiting», not
 * a fault: it was an X in red, the same as a «no» left without a change (20 October).
 */
const markOf = (answer: CheckAnswer | undefined): Mark =>
  !answer ? "none" : answer.value === "yes" ? "yes" : answer.outcome === "proposal" || answer.outcome === "fixed" || answer.outcome === "created" || (answer.outcome === "consult" && answer.resolved) ? "change" : answer.outcome === "consult" ? "wait" : "no";
const verseKeyOf = (item: Pick<ChecklistItem, "chapter" | "verse">) => `${item.chapter}:${item.verse}`;

/**
 * A step that closes by a checklist: every item of the passage, with the yes/no questions the process declares for
 * the step. The screen knows how to show notes, questions and terms beside a text; which questions are asked, and of
 * what, comes from the template.
 */
export function ChecklistView({ ctxEncoded, kind, texts, onlyLinked, openItem, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<ChecklistData | null>(null);
  const [answers, setAnswers] = useState<CheckAnswer[]>([]);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [closing, setSaving] = useState(false);
  /** Answers on their way to Door43. */
  const [writing, setWriting] = useState(0);
  const saving = closing || writing > 0;
  const [error, setError] = useState("");
  const [stepDone, setStepDone] = useState(false);
  /**
   * A change being proposed: the question that was answered «no» (or none: something seen in passing), and the
   * reason it starts with. `onlyVerse`: the question is about the verse as a whole, not about the help in view.
   */
  const [proposing, setProposing] = useState<{
    answerItemId: string;
    questionId: string;
    reason: string;
    onlyVerse?: boolean;
    /** Opened to propose a note that is missing. */
    newNote?: boolean;
    /** The other questions that failed, which the same proposal answers. */
    others?: { answerItemId: string; questionId: string }[];
    /** Opened to adjust a proposal: the version adjusted, which the new one replaces, whoever made it (21 October). */
    adjust?: ProposalView;
    /** An adjustment written over another version, written again over the one in force: the one it takes the place of. */
    rewrites?: string;
  } | null>(null);
  /** «Hay algo que cambiar» was touched: what is wrong is chosen among the questions of the step in view. */
  const [choosing, setChoosing] = useState(false);
  /**
   * Writing to the team instead of answering (Abel, 26 October): a doubt about a point, or a «no» with no change in
   * mind yet. Answering was only «it is right» or a proposal, and a proposal had to be thought up to go on.
   */
  const [commenting, setCommenting] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  /**
   * The chapter around the help, opened from a text's box as in afinación (20 October): the texts of the step side
   * by side, the original a touch away, with the verse in view standing out and what the help quotes marked.
   */
  const [chapterOpen, setChapterOpen] = useState(false);
  /** Which help of the verse is in view at its stop, going over them one at a time (27 October). */
  const [verseNoteAt, setVerseNoteAt] = useState(0);
  const [pairShown, setPairShown] = useState<string[]>([]);
  /** What was marked as failing, while choosing: one or several questions of the step, or something else. */
  const [failing, setFailing] = useState<string[]>([]);
  /** Fixing the quote of the note in view: the words marked in the text so far. */
  const [picking, setPicking] = useState<number[] | null>(null);

  const textsKey = texts.join(",");
  /** A note's quote is fixed on the first text of the step, the one its quote is read against. */
  const canPick = (resource: ChecklistText) => kind === "notas" && resource === texts[0] && Boolean(data?.original) && !data?.fromSource && (firstGroup || Boolean(picking));
  /** What the project's process calls each text. */
  const textLabel = (resource: ChecklistText) => scopeLabel(resource, data?.board?.settings?.resourceNames, language);
  const storeKey = ctx ? `${(ctx.book || ctx.projectId).toUpperCase()}.${ctx.issueNumber || ctx.taskId}.${ctx.stepId || "paso"}` : "";
  /**
   * Opened to try it (see `trialLaunchContext`): what is answered stays on this screen. Opened that way it wrote
   * every answer to the project all the same, under the name of the task, where no subtarea would ever read it.
   */
  const trying = Boolean(ctx?.lab && !ctx.labAllowWrite);

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) return setError(tNow("af.badLink"));
    setCtx(decoded);
    if (!session?.token) return setError(tNow("af.expired"));
    setBusy(true);
    setError("");
    try {
      const loaded = await loadChecklist({ session, ctx: decoded, kind, texts: textsKey.split(",").filter(Boolean) as ChecklistText[], onlyLinked });
      setData(loaded);
      const key = `${(decoded.book || decoded.projectId).toUpperCase()}.${decoded.issueNumber || decoded.taskId}.${decoded.stepId || "paso"}`;
      // A trial keeps its answers in this tab (see `loadTrialChecks`), so the agreement can be tried after it.
      setAnswers(decoded.lab && !decoded.labAllowWrite ? loadTrialChecks(key) : await loadCheckAnswers(session, loaded.target, key));
      if (decoded.pmOrg && decoded.issueNumber && decoded.stepId) {
        setStepDone(await stepIsDone({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId }).catch(() => false));
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session, kind, textsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const questions = data?.step?.checklist ?? [];
  /** The walk: every help, and a stop for each verse after its last help (see `withVerseStops`). */
  const checkItems: CheckItem[] = useMemo(
    () => withVerseStops((data?.items ?? []).map((item) => ({ id: item.id, verseKey: verseKeyOf(item), text: item.body, linked: Boolean(item.supportRef), ...(kind === "notas" && item.supportRef ? { article: articlePathOf(item.supportRef) } : {}) })), data?.step?.checklist ?? []),
    [data],
  );
  // What each verse reads now in the texts on screen: an answer given before a change of the text is checked again.
  const hashes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of data?.items ?? []) out[verseKeyOf(row)] = textFingerprint(texts.map((x) => data?.texts[x]?.verses[row.verse] ?? "").join("|"));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, textsKey]);
  /**
   * A list the team decides together (21 October): its step is shared, and each question of an item is settled when
   * `people` of them say it is right, or when what one proposed is decided by as many. It was one person's word.
   */
  const people = data?.step?.claimMode === "pool" && data.step.closing === "checklist" ? stepMinAssignees(data.step) : 0;
  const me = session?.username ?? "";
  const isMe = (by: string) => by.trim().toLowerCase() === me.trim().toLowerCase();
  /**
   * How many of the team have to be for a proposal, its author among them: as many as decide the list, when the
   * team decides it together; else what the step where the team agrees asks for. And whether the team maintains a
   * resource; what it does not is asked of whoever does.
   */
  const agreement = data?.task?.steps?.find((step) => step.closing === "consensus");
  const needed = people || (agreement ? stepMinAssignees(agreement) : 2);
  const ours = (resource: string) => Boolean(data?.task?.rules.some((rule) => rule.resource === resource));
  const teamOf = (resource: string) => ownerLabel(resource, data?.board, data?.task, language);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  /**
   * Decided together, a proposal takes everybody's agreement (21 October): nobody wins by having more for it. Whoever
   * coordinates the team settles one the team could not agree on in some days.
   */
  const decides = (login: string) => Boolean(data?.task && isCoordinatorOf(data.levelBook, data.task.orgTeamName, login));
  /**
   * The questions a proposal is checked with (27 October): the step's, asked once per help, that apply to what the
   * proposal says. Whether the note links an article is the note's: a proposal of its words does not change it.
   */
  const questionsOfProposal = (view: ProposalView): string[] => {
    // A change of a text, or of an article, is not a version of the help: it is chosen with a touch, as before.
    if (view.proposal.resource !== kind) return [];
    const help = data?.items.find((row) => row.id === view.proposal.rowId);
    return questions.filter((q) => (q.per ?? "item") === "item" && asksOf(q, { ...(view.proposal.after !== undefined ? { text: view.proposal.after } : {}), ...(help ? { linked: Boolean(help.supportRef) } : {}) })).map((q) => q.id);
  };
  const proposals = useMemo(() => proposalsOf(answers, needed, ours, people ? { consensus: true, decides, questionsOf: questionsOfProposal } : {}), [answers, needed, data?.task, people, data?.levelBook, questions]);
  const summary = useMemo(
    () => summarizeChecklist({ items: checkItems, questions, answers: withoutWithdrawn(answers), currentHashes: hashes, ...(people ? { agreement: { people, proposals, me } } : {}) }),
    [checkItems, questions, answers, hashes, people, proposals, me],
  );
  const tallyOf = (id: string) => summary.items.find((row) => row.itemId === id);
  /** Decided together: what this person said gives the others something to say again (a first review, a proposal). */
  const reopenOthers = () => {
    if (!people || trying || !session || !ctx?.pmOrg || !ctx.issueNumber || !data?.step || !data.task) return;
    void shareTurnFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, steps: data.task.steps ?? [], step: data.step, reopen: true }).catch(() => undefined);
  };
  /**
   * Decided together: whether this person has nothing left to say for now, kept in the subtarea so that «Mis
   * tareas» shows their card waiting for the others, and asking them again once something comes up for them.
   */
  const nothingForMe = Boolean(people) && !summary.complete && !summary.items.some((row) => row.turn === "mine" || row.turn === "new");
  const keptTurn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!people || trying || !session || !ctx?.pmOrg || !ctx.issueNumber || !data?.step || !data.task || stepDone) return;
    if (keptTurn.current === nothingForMe) return;
    keptTurn.current = nothingForMe;
    void shareTurnFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, steps: data.task.steps ?? [], step: data.step, waiting: nothingForMe }).catch(() => {
      keptTurn.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nothingForMe, people, trying, ctx?.issueNumber, stepDone]);
  /**
   * The next item to go to: decided together, what is this person's turn, then where people are still missing,
   * counting who is on each item now (see `nextNeeding`); else the next one not done.
   */
  const nextOf = (order: CheckItem[]) => {
    if (!people) return order.find((row) => tallyOf(row.id)?.state !== "ok");
    const byId = new Map(roster.map((row) => [row.itemId, row]));
    const rows = order.map((row) => byId.get(row.id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const found = nextNeeding(rows, { me, needed: people, present: presentOn });
    return found ? order.find((row) => row.id === found) : undefined;
  };
  useStepWork(session, ctx, summary.done, checkItems.length, { on: !stepDone && !closing });
  // What was said in the conversation of the subtarea, read while a consultation waits: its answer is shown here.
  const [thread, setThread] = useState<ThreadLine[]>([]);
  const consulting = summary.consulting.length;
  useEffect(() => {
    if (!consulting || !session || !ctx?.pmOrg || !ctx.issueNumber) return;
    let alive = true;
    void listIssueComments(dcsConfig(session.host), ctx.pmOrg, PM_REPO_NAME, ctx.issueNumber, session.token)
      .then((rows) => alive && setThread(rows.map((row) => ({ by: row.user?.login ?? "", at: row.created_at ?? "", body: row.body ?? "" }))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulting, session?.token, ctx?.pmOrg, ctx?.issueNumber]);
  const replyTo = (answer: CheckAnswer | undefined) => (answer?.outcome === "consult" && !answer.resolved ? consultReply(answer, thread) : null);
  /** Where the walk is: a help, or the stop of a verse. */
  const entry = checkItems[Math.min(position, Math.max(checkItems.length - 1, 0))];
  /** The stop of a verse in view, where its questions are answered with every help of it read. */
  const verseStop = entry?.stop ? entry : undefined;
  /** The help in view; at a verse's stop, its first help, which places what is proposed there in that verse. */
  const item = entry ? data?.items.find((row) => (verseStop ? verseKeyOf(row) === verseStop.verseKey : row.id === entry.id)) : undefined;
  const tally = entry ? summary.items.find((row) => row.itemId === entry.id) : undefined;
  /**
   * The questions of the help in view. A list that checks a help against several things (two texts, its article)
   * asks them a group at a time: what the group is read against is put on screen, its few questions are answered,
   * and the next group follows. They were a list for each, and every note of a unit was read three times.
   */
  const rowsHere = entry ? questionsFor(entry, checkItems, questions) : [];
  /**
   * Whether a question needs nothing more of this person: decided together, they said something of it or it is
   * settled; else anybody answered it.
   */
  const said = (questionId: string) => {
    if (!people) return Boolean(tally?.answers[questionId]);
    const slot = tally?.slots?.[questionId];
    return Boolean(slot?.settled || slot?.voices.some(isMe));
  };
  /** How a question is marked: decided together, settled, in a conversation, waiting for others after this person spoke, or new. */
  const markHere = (questionId: string): Mark => {
    if (!people) return markOf(tally?.answers[questionId]);
    const slot = tally?.slots?.[questionId];
    const answer = tally?.answers[questionId];
    if (answer?.outcome === "consult" && !answer.resolved) return "wait";
    return !slot ? "none" : slot.settled ? "yes" : slot.open.length ? "change" : slot.voices.some(isMe) ? "wait" : "none";
  };
  const groups = groupsOf(rowsHere);
  // A verse's stop asks its questions together, against both texts.
  const grouped = !verseStop && groups.length > 1;
  /** The group somebody asked for, of the help it was asked for: another help starts at what it has left. */
  const [asked, setAsked] = useState<{ itemId: string; about: string } | null>(null);
  const group = groupInView(groups, said, asked && asked.itemId === item?.id ? asked.about : undefined);
  const rowsShown = grouped ? (group?.rows ?? []) : rowsHere;
  const pendingHere = rowsShown.filter(({ question }) => !said(question.id));
  /** Who already said that what is on screen is right: what this person is asked to agree with. */
  const othersSaid = people ? [...new Set(rowsShown.flatMap(({ question }) => tally?.slots?.[question.id]?.yesBy ?? []).filter((who) => !isMe(who)))] : [];
  /** The proposals on what is on screen still to be decided, of which this person has not said anything yet. */
  const openHere = people ? [...new Map(rowsShown.flatMap(({ question }) => tally?.slots?.[question.id]?.open ?? []).filter((view) => !isMe(view.by) && !view.inFavour.some(isMe) && !view.against.some(isMe) && !view.choices?.[me.trim().toLowerCase()]).map((view) => [view.proposal.id, view])).values()] : [];
  /**
   * The one proposal in play on what is on screen, when some are for it and some would rather leave things as they
   * are: what this person is asked then depends on which side they are on, or whether they coordinate the team.
   */
  const inPlay = people ? [...new Map(rowsShown.flatMap(({ question }) => tally?.slots?.[question.id]?.open ?? []).map((view) => [view.proposal.id, view])).values()] : [];
  // Decided as options (`choices`), a disagreement is read in the options themselves.
  const disputeHere = inPlay.length === 1 && !inPlay[0]!.choices && inPlay[0]!.inFavour.length && inPlay[0]!.against.length ? inPlay[0]! : undefined;
  const myStand = !disputeHere ? "none" : disputeHere.against.some(isMe) ? "against" : disputeHere.inFavour.some(isMe) ? "for" : "none";
  const decideHere = disputeHere && !stepDone && decides(me) && disputeStalled(disputeHere) ? disputeHere : undefined;
  /** Another group of this help has something left to answer. */
  const pendingElsewhere = grouped && groups.some((other) => other !== group && other.rows.some((row) => !said(row.question.id)));
  /** The texts on screen: up to the one the group is read against; all of them when the list is not asked in groups. */
  const aboutText = texts.indexOf((group?.about ?? "") as ChecklistText);
  const textsShown = !grouped ? texts : aboutText >= 0 ? texts.slice(0, aboutText + 1) : texts.slice(0, 1);
  /** The group is read against the article of the help, not against a text. */
  const aboutArticle = grouped && aboutText < 0 && Boolean(group?.about);
  /**
   * The first group, or a list that has none. What is only of use while the help is first read against its text
   * (which words it is about, said in a line; fixing its quote) is left out of the groups that follow: with it,
   * and with the article, a second text or the article open left no room for the note itself on a phone, and the
   * question was whether the note explains what was on screen.
   */
  const firstGroup = !grouped || group === groups[0];
  // A key term is shown by the name the team gives it (the title of its article), not by its code in English.
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});
  /** Those names have been read (or could not be): until then a term has no name to show but its code in English. */
  const [titlesRead, setTitlesRead] = useState(false);
  useEffect(() => {
    const sess = loadSession();
    if (!sess?.token || !ctx || data?.kind !== "palabras" || !data.items.length) return;
    let cancelled = false;
    const uses = data.items.flatMap((row) => {
      const [termKind, ...slug] = (row.supportRef ?? "").split("/");
      return termKind && slug.length ? [{ termKind: termKind as TermKind, termSlug: slug.join("/") }] : [];
    });
    // Where the team has no article of its own yet, the source's title (in its language) beats the code it is filed under.
    void loadTermTitles(sess, resolveSourcePackage(data.board?.settings), uses, ctx)
      .then((titles) => !cancelled && setTermTitles(titles))
      .catch(() => undefined)
      .then(() => !cancelled && setTitlesRead(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.kind, data?.items]);
  // A message about a key term names the term (it holds for every use of it); about a note or a question, that row.
  const [termKind, ...termSlug] = (item?.supportRef ?? "").split("/");
  // The article of the term in view. The checklist asks whether its definition is right for this verse, and showed
  // only its title: whoever checked had to know the article, or go and find it. Read once per term, as it comes up.
  const [articles, setArticles] = useState<Record<string, string | null>>({});
  // The article of the item opens on the section the step is about, when the process names one.
  const focusHeads = (rowsShown.find((row) => row.question.articleFocus?.length)?.question.articleFocus ?? data?.step?.articleFocus ?? []).join("\u0000");
  const shownArticle = `${position}|${Object.keys(articles).length}|${group?.about ?? ""}`;
  useEffect(() => {
    const box = document.querySelector<HTMLElement>(".ck-article");
    // A group with no section of its own reads the article from its beginning.
    if (!focusHeads) {
      if (box && grouped) box.scrollTop = 0;
      return;
    }
    const wanted = focusHeads.split("\u0000").map((head) => head.toLowerCase());
    const head = box ? [...box.querySelectorAll<HTMLElement>("h1, h2, h3, h4")].find((el) => wanted.includes((el.textContent ?? "").trim().toLowerCase())) : undefined;
    if (box && head) box.scrollTop = head.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 4;
  }, [focusHeads, shownArticle]);
  const slug = kind === "palabras" && termKind ? termSlug.join("/") : "";
  // The Academy article a note points to. Its checklist asks whether the article teaches the difficulty of the
  // note and whether it is published in this language, and showed its name alone: neither could be answered here.
  const articlePath = kind === "notas" && item?.supportRef ? articlePathOf(item.supportRef) : "";
  const [academy, setAcademy] = useState<Record<string, TeamArticle | null>>({});
  /** The article as the source has it, to compare the team's with (20 October). */
  const [academySource, setAcademySource] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!articlePath || !session?.token || !ctx || !data || articlePath in academy) return;
    let cancelled = false;
    const pkg = resolveSourcePackage(data.board?.settings);
    void Promise.all([
      readTeamArticle({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, pkg, resource: "academia", path: articlePath }).catch(() => null),
      loadArticleBody(session, ctx, pkg, articlePath, { teamFirst: false }).catch(() => null),
    ]).then(([article, source]) => {
      if (cancelled) return;
      setAcademy((prev) => ({ ...prev, [articlePath]: article }));
      setAcademySource((prev) => ({ ...prev, [articlePath]: source }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articlePath, session?.token, ctx?.issueNumber, data]);
  useEffect(() => {
    if (!slug || !session?.token || !ctx || !data || slug in articles) return;
    let cancelled = false;
    // As the team has it now: an article it translated for this book is on its draft, not published yet.
    void readTeamArticle({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, pkg: resolveSourcePackage(data.board?.settings), resource: "palabras", path: termArticlePath(termKind as TermKind, slug) })
      .catch(() => null)
      .then((article) => !cancelled && setArticles((prev) => ({ ...prev, [slug]: article?.text?.trim() ? article.text : null })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, Boolean(data)]);
  // On to another group, or to another help: the screen is placed so that the help starts right under the text and
  // its questions clear the bar at the foot. The text a group is read against had come on screen above, and its
  // questions were left under the bar (the first at 788 px of 812); in the group after, the note itself was under
  // the two texts. The first help opened is left where it is, under the name of the step and how far it has come.
  const checksRef = useRef<HTMLUListElement>(null);
  const shownFor = useRef("");
  const groupKey = `${group?.about ?? ""}|${aboutArticle ? Object.keys(academy).length : 0}`;
  useEffect(() => {
    const was = shownFor.current;
    shownFor.current = item?.id ?? "";
    const list = checksRef.current;
    // The screen scrolls inside itself (`.af`), not in the window.
    const screen = list?.closest<HTMLElement>(".af");
    if (!grouped || !item || !list || !screen || !was) return;
    // The steps, the heading and what is checked, in sight from the top: what the step asks is read first, and
    // then the help and its texts under it (20 October). Only up: a screen already at its top stays.
    const card = screen.querySelector<HTMLElement>(".af-card");
    const place = () => {
      const anchor = screen.querySelector<HTMLElement>(".ck-steps--top") ?? screen.querySelector<HTMLElement>(".ck-heading");
      if (!anchor) return;
      const by = anchor.getBoundingClientRect().top - screen.getBoundingClientRect().top - 8;
      if (by < -1) screen.scrollBy({ top: by });
    };
    place();
    if (!card) return;
    // What the group brings may take its size a moment later (an article is laid out after it is put in: the
    // questions were placed, and then pushed 226 px down, under the bar). The place is taken again as the card
    // changes, for a few seconds or until the person moves the screen themselves.
    const changes = new MutationObserver(place);
    changes.observe(card, { childList: true, subtree: true, characterData: true });
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    sizes?.observe(card);
    const moved = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const stop = () => {
      changes.disconnect();
      sizes?.disconnect();
      window.clearTimeout(timer);
      for (const name of moved) screen.removeEventListener(name, stop);
    };
    const timer = window.setTimeout(stop, 4000);
    for (const name of moved) screen.addEventListener(name, stop, { passive: true });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, item?.id]);
  const messageKey = kind === "palabras" && termKind && termSlug.length ? termMessageKey(termKind, termSlug.join("/")) : (item?.id ?? "");
  const closesHere = Boolean(data?.step && closesInItsTool(data.step) && ctx?.issueNumber);

  // What this checklist needs done before it: the helps translated and each text aligned. What is missing is said,
  // and its team told, instead of checking against half-done work.
  const missing = useMemo<MissingWork[]>(
    () => (data ? missingWork({ helps: kind, fromSource: data.fromSource, chapter: data.chapter, verses: data.items.map((row) => row.verse), texts: texts.map((resource) => ({ resource, ...data.texts[resource] })) }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, kind, textsKey],
  );
  /** The tasks, among those this one waits for, that work on a resource: whose work a missing piece is. */
  const awaitedFor = (resource: string) => {
    if (!data?.board || !data.task) return [];
    const awaited = (data.task.waitsFor ?? []).flatMap((rule) => (rule.taskId ? data.board!.teams.filter((task) => task.id === rule.taskId) : data.board!.teams.filter((task) => task.phaseId === rule.phaseId)));
    return awaited.filter((task) => task.rules.some((rule) => rule.resource === resource));
  };
  /** The coordinators of the teams whose work a missing piece is. */
  const ownersOf = (resource: string) => [...new Set(awaitedFor(resource).flatMap((task) => coordinatorsOf(data!.levelBook, task.orgTeamName)))];
  /**
   * The article of the note in view reached harmonizing untranslated: the team that translates articles did not
   * finish it. It cannot be checked, and this part of the help waits for it (20 October): the team is told, once per
   * article, and the step stays «waiting for an answer» until it comes.
   */
  /** The helps of the verse in view, in their order: which of them this is, of how many. */
  const helpsOfVerse = useMemo(() => (item && !verseStop ? checkItems.filter((row) => !row.stop && row.verseKey === verseKeyOf(item)).map((row) => row.id) : []), [checkItems, item, verseStop]);
  /**
   * What to check is ticked, one point at a time, before «Sí, cumple» can be said (Abel, 26 October): the list was
   * read, or not, and the answer given for all of it at once. The ticks are this person's way through the list,
   * kept on this device only for the help in view; what is saved is still the answer.
   */
  const [marks, setMarks] = useState<Map<string, "yes" | "no">>(() => new Map());
  const tickKey = (questionId: string) => `${item?.id ?? ""}\u0000${questionId}`;
  const pointMark = (questionId: string) => marks.get(tickKey(questionId));
  const isTicked = (questionId: string) => marks.has(tickKey(questionId));
  /** «Sí» or «No» for a point; the same touched again takes it back. */
  const setMark = (questionId: string, value: "yes" | "no") =>
    setMarks((now) => {
      const next = new Map(now);
      const key = tickKey(questionId);
      if (next.get(key) === value) next.delete(key);
      else next.set(key, value);
      return next;
    });
  /** Every point still to be answered on screen was answered «sí» or «no». */
  const allTicked = pendingHere.every(({ question }) => isTicked(question.id));
  /** The points answered «no»: what the proposal is for. */
  const failingHere = pendingHere.filter(({ question }) => pointMark(question.id) === "no").map(({ question }) => question.id);
  // The last point ticked, the answer comes into view: it is the card under the list, not a bar at the foot.
  const tickedAll = pendingHere.length > 0 && allTicked;
  useEffect(() => {
    if (tickedAll) window.setTimeout(() => document.querySelector(".ck-go")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
  }, [tickedAll]);
  /** The article in view was checked already in this task: what is asked once per article is answered. */
  const articleRows = rowsShown.filter(({ question }) => question.per === "article");
  /**
   * Who already said the article is right, asked once per article: then it is a card with what it teaches and the
   * whole of it a touch away. Said by somebody else, it was told as «Ya revisaste» (21 October).
   */
  const articleBy = people ? [...new Set(articleRows.flatMap(({ question }) => tally?.slots?.[question.id]?.yesBy ?? []))] : articleRows.every(({ question }) => tally?.answers[question.id]) ? articleRows.flatMap(({ question }) => (tally?.answers[question.id]?.by ? [tally.answers[question.id]!.by] : [])) : [];
  const articleSeen = articleRows.length > 0 && articleBy.length > 0;
  const [articleOpen, setArticleOpen] = useState(false);
  /**
   * Another note of the verse, read in a sheet over this one (Abel, 26 October): going to its task to see what it
   * says and marks lost the thread of the note being checked.
   */
  const [peek, setPeek] = useState<{ chapter: number; verse: number; notes: string[]; linked?: boolean; at?: number } | null>(null);
  const articleInSource = Boolean(!verseStop && aboutArticle && articlePath && academy[articlePath]?.where === "source");
  const articleTitle = articlePath ? academy[articlePath]?.title || localizeAfinacion(categoryLabel(categoryFromSupportRef(item?.supportRef ?? "")), language) : "";
  const articleTask = awaitedFor("academia")[0];
  const articleNote = t("ck.articleUntranslatedNote").replace("{title}", articleTitle);
  const articleToldKey = `taller.ck-article-told.${storeKey}.${articlePath}`;
  const articleTold = (() => {
    if (!articleInSource) return false;
    if (answers.some((row) => row.outcome === "consult" && row.note === articleNote)) return true;
    try {
      return window.localStorage.getItem(articleToldKey) === "1";
    } catch {
      return false;
    }
  })();
  /** Leaves this part of the help waiting for the article, telling its team the first time. */
  async function waitForArticle() {
    if (!item || !pendingHere.length) return;
    await save(pendingHere.map(({ question, answerItemId }) => stamp(answerItemId, question.id, "no", { outcome: "consult", note: articleNote })), t("ck.articleWaiting"));
    if (!articleTold && !trying && session && ctx?.pmOrg && ctx.issueNumber) {
      const who = ownersOf("academia").map((login) => `@${login}`).join(" ");
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, t("ck.articleUntranslatedComment").replace("{who}", who).replace("{title}", articleTitle).replace("{where}", `${data?.book ?? ""} ${item.chapter}:${item.verse}`).trim()).catch(() => undefined);
    }
    try {
      window.localStorage.setItem(articleToldKey, "1");
    } catch {
      /* told all the same */
    }
    setAsked(null);
    nextPending();
  }
  const missingText = (row: MissingWork) =>
    row.kind === "helps"
      ? t("ck.missHelps").replace("{what}", scopeLabel(row.resource, data?.board?.settings?.resourceNames, language))
      : t(row.kind === "text" ? (row.verses.length === 1 ? "ck.missTextOne" : "ck.missText") : row.verses.length === 1 ? "ck.missAlignmentOne" : "ck.missAlignment").replace("{text}", scopeLabel(row.resource, data?.board?.settings?.resourceNames, language)).replace("{verses}", verseList(row.verses));
  const missingKey = `taller.ck-told.${storeKey}.${missing.map((row) => `${row.kind}:${row.resource}:${"verses" in row ? row.verses.join(",") : ""}`).join("|")}`;
  const [told, setTold] = useState(false);
  useEffect(() => {
    try {
      setTold(Boolean(missing.length) && window.localStorage.getItem(missingKey) === "1");
    } catch {
      setTold(false);
    }
  }, [missingKey, missing.length]);

  /** Tell the teams whose work is missing, in the conversation of this subtarea: each coordinator is named with what is theirs. */
  async function tellMissing() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !data || !missing.length) return;
    setSaving(true);
    setError("");
    try {
      const lines = missing.map((row) => `- ${ownersOf(row.resource).map((login) => `@${login}`).join(" ")} ${missingText(row)}`.replace("-  ", "- "));
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, `${t("ck.missComment").replace("{where}", `${data.book} ${ctx.ref || data.chapter}`)}\n${lines.join("\n")}`);
      try {
        window.localStorage.setItem(missingKey, "1");
      } catch {
        /* told all the same */
      }
      setTold(true);
      announce(t("ck.missTold"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * An answer shows at once and is written behind: the person goes on to the next question without waiting for
   * Door43. If the write fails the answer is taken back and the error is said.
   */
  async function save(next: CheckAnswer[], said: string) {
    if (!session || !data) return;
    if (trying) {
      setAnswers((prev) => {
        const all = [...prev, ...next];
        saveTrialChecks(storeKey, all);
        return all;
      });
      announce(t("ck.tryKept"));
      return;
    }
    setAnswers((prev) => [...prev, ...next]);
    setWriting((n) => n + 1);
    setError("");
    try {
      await appendCheckAnswers(session, data.target, storeKey, next);
      announce(said);
      for (const itemId of new Set(next.map((row) => row.itemId))) tellOthers({ type: "taller:answered", item: itemId });
    } catch (err) {
      setAnswers((prev) => prev.filter((row) => !next.includes(row)));
      setError(explainError(err));
    } finally {
      setWriting((n) => n - 1);
    }
  }

  const stamp = (answerItemId: string, questionId: string, value: "yes" | "no", extra: Partial<CheckAnswer> = {}): CheckAnswer => ({
    itemId: answerItemId,
    questionId,
    value,
    by: session?.username ?? "",
    at: new Date().toISOString(),
    textHash: hashes[answerItemId.startsWith("verse:") ? answerItemId.slice("verse:".length) : (checkItems.find((row) => row.id === answerItemId)?.verseKey ?? "")],
    ...extra,
  });


  const isMine = (by: string) => by.toLowerCase() === (session?.username ?? "").toLowerCase();
  /** The new versions still to be settled of something, oldest first. */
  const versionsOf = (target: Pick<ProposalTarget, "resource" | "rowId" | "path" | "field">, where: string) =>
    proposals.filter((view) => (view.state === "open" || view.state === "agreed") && Boolean(view.proposal.after) && view.proposal.resource === target.resource && view.proposal.rowId === target.rowId && view.proposal.path === target.path && view.proposal.field === target.field && (Boolean(target.rowId || target.path) || view.proposal.where === where));
  /**
   * The new version still to be settled of something that another starts from: this person's own, the latest, or
   * else the latest of anybody. Over one's own it takes its place: two versions of one note cannot both be written,
   * the second would undo the first. Over somebody else's it goes beside it, and the team chooses: it took its
   * place, and a counterproposal answered with «Hacer otro cambio» hid the version it answered (20 October).
   */
  const priorOf = (target: Pick<ProposalTarget, "resource" | "rowId" | "path" | "field">, where: string) => {
    const all = versionsOf(target, where);
    return [...all].reverse().find((view) => isMine(view.by)) ?? all[all.length - 1];
  };
  const helpKey = item && kind !== "palabras" ? { resource: kind, rowId: item.id, field: kind === "notas" ? "Note" : "Response" } : undefined;
  /** What is proposed for the help in view itself: read with it, since the next group checks the help as it would be. */
  const proposedHelp = helpKey ? priorOf(helpKey, "") : undefined;
  /** Every version proposed for it, when there is more than one: all of them are read, each with whose it is. */
  const helpVersions = helpKey ? versionsOf(helpKey, "") : [];
  /**
   * The versions proposed for the article of the term in view, each with whose it is. None was shown in this
   * step: the team's proposals for the articles and the answers to them were seen only in «Acuerdo del equipo»
   * (20 October).
   */
  const termVersions = kind === "palabras" && slug && termKind ? versionsOf({ resource: "palabras", path: termArticlePath(termKind as TermKind, slug) }, "") : [];

  /** The id a note proposed as new would have, the same while its sheet is open: none of the notes of the unit has it. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const newRowId = useMemo(() => freshRowId((data?.items ?? []).map((row) => row.id)), [proposing]);

  /** What a proposal about the help in view can be about: the help, its article, and the texts it is checked against. */
  const targets = useMemo<ProposalTarget[]>(() => {
    if (!item || !data) return [];
    const where = `${item.chapter}:${item.verse}`;
    const whose = (resource: string) => (ours(resource) ? {} : { team: teamOf(resource) });
    // A note that is missing is proposed as what it is, a new note of that verse, written out: it could only be
    // said to be missing, and the editor the list sent people to has no way to add one.
    // The words it is about are marked in the first text, when that verse is aligned: the words of the original
    // under them are what a note quotes.
    const first = data.texts[texts[0]!];
    const markable = Boolean(data.original) && !data.fromSource && verseIsAligned(first?.alignments, item.chapter, item.verse) ? tokenizeVersePlainText(first?.verses[item.verse] ?? "") : [];
    // Which of those words go together in a quote: those tied to the same words of the original.
    const sid = Object.keys(first?.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const units = markable.length ? quoteUnits(markable, sid ? first!.alignments![sid]! : []) : [];
    // The words a quote is, in that text: what each half of a note parted in two starts from. Over a change
    // already proposed for the note, the quotes it gave them: another change is made over that one.
    const quoteAt = (quote: string | undefined, occurrence: number | string | undefined) =>
      markable.length && quote ? (alignedGatewayQuoteForHelpQuote({ verseText: first?.verses[item.verse] ?? "", quote, occurrence: Number(occurrence ?? 1) || 1, alignments: first?.alignments, book: data.book, chapter: item.chapter, verse: item.verse, ...(data.original ? { original: originalTokens(data.original, item.chapter, item.verse) } : {}) }).tokenIndices ?? []) : [];
    const before = proposedHelp?.proposal;
    const quoted = before?.fields?.Quote ? quoteAt(before.fields.Quote, before.fields.Occurrence) : quoteAt(item.quote, item.occurrence);
    const halfQuoted = before?.split?.fields?.Quote ? quoteAt(before.split.fields.Quote, before.split.fields.Occurrence) : quoted;
    const fresh: ProposalTarget[] = kind === "notas" && ours(kind) ? [{ id: "new", label: t("pr.targetNewNote").replace("{ref}", where), resource: kind, rowId: newRowId, field: "Note", text: "", format: "note" as const, add: true, ...(markable.length ? { words: markable, units } : {}) }] : [];
    const help: ProposalTarget[] = proposing?.onlyVerse
      ? [...fresh, { id: "verse", label: t("pr.targetVerse").replace("{what}", scopeLabel(kind, data.board?.settings?.resourceNames, language)).replace("{ref}", where), resource: kind, commentOnly: true, ...whose(kind) }]
      : kind === "notas"
        ? // A note of the team can be parted in two as well: what is taken out of it becomes a new note beside it.
          [{ id: "help", label: t("pr.targetNote"), resource: kind, rowId: item.id, field: "Note", text: item.body, format: "note" as const, ...(ours(kind) ? { split: { rowId: before?.split?.rowId ?? newRowId, ...(markable.length ? { words: markable, units, ...(quoted.length ? { marked: quoted } : {}), ...(halfQuoted.length ? { newMarked: halfQuoted } : {}) } : {}) } } : {}), ...whose(kind) }]
        : kind === "preguntas"
          ? [
              { id: "answer", label: t("pr.targetAnswer"), resource: kind, rowId: item.id, field: "Response", text: item.body, ...whose(kind) },
              { id: "question", label: t("pr.targetQuestion"), resource: kind, rowId: item.id, field: "Question", text: item.title, ...whose(kind) },
            ]
          : [];
    const article: ProposalTarget[] = proposing?.onlyVerse
      ? []
      : articlePath
        ? [{ id: "article", label: t("pr.targetArticle"), resource: "academia", path: `${articlePath}/01.md`, text: academy[articlePath]?.text ?? undefined, format: "markdown" as const, ...whose("academia") }]
        : slug
          ? [{ id: "article", label: t("pr.targetArticle"), resource: kind, path: termArticlePath(termKind as TermKind, slug), text: articles[slug] ?? undefined, format: "markdown" as const, ...whose(kind) }]
          : [];
    const read = texts.map<ProposalTarget>((resource) => ({ id: resource, label: t("pr.targetText").replace("{name}", textLabel(resource)), resource, text: data.texts[resource]?.verses[item.verse], ...whose(resource) }));
    // A step, or a group, that goes over the articles starts from the article.
    // A note that is missing is always one of the things to propose, last of them, and first when that is what
    // the sheet was opened for. It was offered only from the question that asks for it and from «Proponer un
    // cambio», and nobody knew it was there.
    const also = proposing?.onlyVerse ? [] : fresh;
    const offered = [...(onlyLinked || aboutArticle ? [...article, ...help] : [...help, ...article]), ...read];
    return (proposing?.newNote ? [...also, ...offered] : [...offered, ...also]).map((target) => {
      // Decided together, a new proposal is another option: from the help as it is (21 October).
      const prior = target.commentOnly || people ? undefined : priorOf(target, where);
      return prior ? { ...target, start: prior.proposal.after, ...(isMine(prior.by) ? {} : { startBy: prior.by }) } : target;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, data, proposing?.onlyVerse, proposing?.newNote, newRowId, academy, articles, articlePath, slug, textsKey, language, proposals, aboutArticle, proposedHelp]);

  /** The words of the original under the words marked for a new note, and how those read: what the note quotes. */
  function quotedBy(words: string[] | undefined, marked: number[] | undefined): Pick<ProposalPayload, "fields" | "about"> {
    if (!data || !item || !marked?.length || !words) return {};
    const text = data.texts[texts[0]!];
    const sid = Object.keys(text?.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const found = quoteFromSelection({ verseTokens: words, selected: marked, groups: sid ? text!.alignments![sid]! : [], original: originalTokens(data.original ?? "", item.chapter, item.verse) });
    const about = marked.map((index) => words[index]).join(" ");
    return found ? { fields: { Quote: found.quote, Occurrence: String(found.occurrence) }, about } : { about };
  }

  /** The quote of the half of a note that stays, when it is not the one the note has: only then is it written. */
  /** The new notes after the first, each with an id no note of the book has, and the words it is about. */
  function moreParts(more: { after: string; marked?: number[] }[], first: string, words: string[] | undefined) {
    const taken = [...(data?.items ?? []).map((row) => row.id), first];
    return more.map((one) => {
      const rowId = freshRowId(taken);
      taken.push(rowId);
      return { rowId, after: one.after, ...quotedBy(words, one.marked) };
    });
  }
  function keptQuote(found: Pick<ProposalPayload, "fields" | "about">): Pick<ProposalPayload, "fields" | "about"> {
    const same = found.fields?.Quote === item?.quote && Number(found.fields?.Occurrence ?? 1) === (item?.occurrence ?? 1);
    return found.fields && !same ? found : {};
  }

  async function sendProposal(draft: ProposalDraft) {
    if (!proposing || !item || !session) return;
    const payload: ProposalPayload = {
      id: `pr-${uid()}`,
      resource: draft.target.resource,
      where: `${item.chapter}:${item.verse}`,
      ...(draft.target.field ? { field: draft.target.field } : {}),
      ...(draft.target.path ? { path: draft.target.path } : {}),
      ...(draft.target.rowId ? { rowId: draft.target.rowId } : {}),
      ...(draft.target.text !== undefined && !draft.target.add ? { before: draft.target.text } : {}),
      ...(draft.after ? { after: draft.after } : {}),
      ...(draft.target.add ? { add: true as const, ...quotedBy(draft.target.words, draft.marked) } : {}),
      ...(draft.split && draft.target.split ? { split: { rowId: draft.target.split.rowId, after: draft.split.after, ...quotedBy(draft.target.split.words, draft.split.marked), ...(draft.split.more?.length ? { more: moreParts(draft.split.more, draft.target.split.rowId, draft.target.split.words) } : {}) } } : {}),
      // The note that stays may be about other words than before, once part of what it said went to the other.
      ...(draft.split && draft.target.split && draft.keepMarked ? keptQuote(quotedBy(draft.target.split.words, draft.keepMarked)) : {}),
      // It takes the place only of one's own version: written over somebody else's, it goes beside it.
      // An adjustment replaces the version it adjusts, whoever made it: the proposal is one, in versions. Else a new
      // version takes the place only of one's own.
      // Decided together, one proposal per note (27 October): what somebody else writes over it is an adjustment its
      // author accepts or not, not another version of it.
      ...(proposing.adjust && people && !isMe(authorOfOption(proposing.adjust))
        ? { suggests: proposing.adjust.proposal.id, ...(proposing.rewrites ? { replaces: proposing.rewrites } : {}) }
        : proposing.adjust ? { replaces: proposing.adjust.proposal.id } : draft.after && draft.target.start && !draft.target.startBy ? { replaces: priorOf(draft.target, `${item.chapter}:${item.verse}`)?.proposal.id } : {}),
    };
    // The proposal answers each question marked as failing: the first carries it, the others the same one.
    const answered = [{ answerItemId: proposing.answerItemId, questionId: proposing.questionId }, ...(proposing.others ?? [])].map((row) => {
      const base = stamp(row.answerItemId, row.questionId, "no");
      return proposalAnswer({ itemId: base.itemId, questionId: base.questionId, by: base.by, at: base.at, reason: draft.reason, proposal: payload, textHash: base.textHash });
    });
    await save(answered, draft.target.team ? t("ck.proposedOther").replace("{team}", draft.target.team) : t("ck.proposed"));
    reopenOthers();
    setProposing(null);
  }

  /** Whoever made a proposal takes it back: its «no» is unanswered again. */
  /**
   * Adjusting a proposal: a new version of it, from its words, answering the questions it answered (21 October). The
   * team goes on adjusting one proposal until three agree on a version, instead of piling up proposals that compete.
   */
  const adjustProposal = (view: ProposalView, more: { answerItemId: string; questionId: string }[] = [], rewrites?: string) => {
    const [first, ...others] = slotsOfProposal(view);
    for (const one of more) if (!(one.answerItemId === first!.answerItemId && one.questionId === first!.questionId) && !others.some((o) => o.answerItemId === one.answerItemId && o.questionId === one.questionId)) others.push(one);
    setProposing({ answerItemId: first!.answerItemId, questionId: first!.questionId, reason: "", others, adjust: view, ...(rewrites ? { rewrites } : {}) });
  };
  /** The questions a version answers, the first one first: a new version of it answers the same. */
  const slotsOfProposal = (view: ProposalView) => {
    const rows = answers.filter((row) => row.outcome === "proposal" && row.proposal?.id === view.proposal.id);
    return (rows.length ? rows : [{ itemId: view.itemId, questionId: view.questionId }]).map((row) => ({ answerItemId: row.itemId, questionId: row.questionId }));
  };
  /** Who made the proposal a version belongs to: its first version's author. */
  const authorOfOption = (view: ProposalView) => chainOf(proposals, view.proposal.id)[0]?.by ?? view.by;
  /**
   * The author of a proposal takes an adjustment (27 October): a version of theirs with its words, which says whose
   * it was. Whoever coordinates may take it for them once the author has not answered in days, or settle a dispute
   * with it (`decide`).
   */
  const acceptAdjustment = async (adjustment: ProposalView, head: ProposalView, decide = false) => {
    const now = new Date().toISOString();
    const { suggests: _written, replaces: _rewritten, ...words } = adjustment.proposal;
    const payload: ProposalPayload = { ...words, id: `pr-${uid()}`, replaces: head.proposal.id, accepts: adjustment.proposal.id, adjustedBy: adjustment.by, ...(head.proposal.before !== undefined ? { before: head.proposal.before } : {}) };
    const rows = slotsOfProposal(head).map((slot) => {
      const base = stamp(slot.answerItemId, slot.questionId, "no");
      return proposalAnswer({ itemId: base.itemId, questionId: base.questionId, by: base.by, at: now, reason: adjustment.reason, proposal: payload, ...(base.textHash ? { textHash: base.textHash } : {}) });
    });
    await save(decide ? [...rows, proposalDecided(payload.id, me, now, true)] : rows, t("ck.saved"));
    reopenOthers();
  };
  /**
   * Taking back a proposal (or an adjustment) from its list of options takes back every version of it its writer made:
   * the last one alone gave back the one before, and with it an adjustment it had taken disappeared.
   */
  const withdrawWhole = (id: string) => {
    const now = new Date().toISOString();
    const mine = chainOf(proposals, id).filter((view) => isMe(view.by) && view.state !== "withdrawn");
    return save((mine.length ? mine.map((view) => view.proposal.id) : [id]).map((one) => proposalSaying(one, me, now, false)), t("ck.withdrawn"));
  };
  const declineAdjustment = (adjustment: ProposalView) => save([adjustmentDeclined(adjustment.proposal.id, me, new Date().toISOString())], t("ck.saved"));
  /** What this person says of a proposal of somebody else: for it, or that they would rather leave things as they are. */
  const voteFor = (proposalId: string) => save([proposalSaying(proposalId, me, new Date().toISOString(), true)], t("ck.saved"));
  const voteKeep = (proposalId: string) => save([proposalKeeping(proposalId, me, new Date().toISOString(), true)], t("ck.saved"));
  /**
   * What the team agreed on, written when the list closes: into the team's help, or asked of the team that keeps it
   * (the TPL, of afinación). Decided together there is no step after this one where it was done.
   */
  async function carryOut(view: ProposalView) {
    if (!session || !ctx || !data) return;
    const mine = ours(view.proposal.resource);
    if (mine && !view.proposal.after) return;
    const now = new Date().toISOString();
    if (trying) return save([proposalDone(view.proposal.id, me, now)], t("ck.tryKept"));
    if (mine) {
      await applyProposal({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, proposal: view.proposal });
      return save([proposalDone(view.proposal.id, me, now)], t("ag.applied"));
    }
    if (!data.board || !data.task) return;
    const sentAs = await askOwnersFor({ session, ctx, board: data.board, task: data.task, view });
    return save([proposalDone(view.proposal.id, me, now, sentAs)], t("ag.sent").replace("{team}", teamOf(view.proposal.resource)));
  }
  const withdraw = (proposalId: string) => save([proposalSaying(proposalId, session?.username ?? "", new Date().toISOString(), false)], t("ck.withdrawn"));
  /** The conversation is open: what to answer of the proposal is in it, and the bar at the foot steps aside. */
  const [talkOpen, setTalkOpen] = useState(false);
  /** This person was for a version before this one: the proposal changed since they agreed. */
  const agreedBefore = (view: ProposalView) => chainOf(proposals, view.proposal.id).slice(0, -1).some((one) => one.inFavour.some(isMe));
  /** Whoever coordinates the team settles a proposal the team could not agree on. */
  const decide = (proposalId: string, apply: boolean) => save([proposalDecided(proposalId, me, new Date().toISOString(), apply)], t("ck.saved"));
  /** The box of the conversation, to answer whoever disagrees: in view, the keyboard up. */
  const answerInTalk = () => {
    window.dispatchEvent(new Event(OPEN_TALK));
    window.setTimeout(() => {
      const box = document.getElementById("ck-talk-box") as HTMLTextAreaElement | null;
      box?.scrollIntoView({ block: "center" });
      box?.focus();
    }, 50);
  };

  /** The verse of the text a quote is marked in, in words, and the groups of its alignment. */
  const pickVerse = useMemo(() => {
    const text = data && item ? data.texts[texts[0]!] : undefined;
    if (!text || !item) return null;
    const sid = Object.keys(text.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const tokens = tokenizeVersePlainText(text.verses[item.verse] ?? "");
    const groups = sid ? text.alignments![sid]! : [];
    return { tokens, groups, units: quoteUnits(tokens, groups) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, item?.id, textsKey]);
  /** The quote the words marked would be, said while they are marked: what is saved is seen before. */
  const pickedQuote = picking?.length && pickVerse && data && item ? quoteFromSelection({ verseTokens: pickVerse.tokens, selected: picking, groups: pickVerse.groups, original: originalTokens(data.original ?? "", item.chapter, item.verse) }) : null;

  /** The quote of the note in view becomes the words of the original under the words marked in the text. */
  async function saveQuote(resource: ChecklistText) {
    if (!session || !ctx || !data || !item || !picking?.length) return;
    const text = data.texts[resource];
    const sid = Object.keys(text?.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const found = quoteFromSelection({
      verseTokens: tokenizeVersePlainText(text?.verses[item.verse] ?? ""),
      selected: picking,
      groups: sid ? text!.alignments![sid]! : [],
      original: originalTokens(data.original ?? "", item.chapter, item.verse),
    });
    if (!found) return setError(t("ck.quoteNotAligned"));
    if (trying) {
      setData({ ...data, items: data.items.map((row) => (row.id === item.id ? { ...row, quote: found.quote, occurrence: found.occurrence } : row)) });
      setPicking(null);
      announce(t("ck.tryKept"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveNoteQuote({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, noteId: item.id, quote: found.quote, occurrence: found.occurrence });
      setData({ ...data, items: data.items.map((row) => (row.id === item.id ? { ...row, quote: found.quote, occurrence: found.occurrence } : row)) });
      setPicking(null);
      announce(t("ck.quoteSaved"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  async function closeStep() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !ctx.stepId) return;
    setSaving(true);
    try {
      if (people) for (const view of proposals.filter((row) => row.state === "agreed")) await carryOut(view);
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      setStepDone(true);
      announce(t("ck.stepClosed"));
      // On to what follows, as the other tools do: the next list of the same task when it is this person's, or
      // their tasks. The screen stayed on a list with every answer given, «Paso cerrado», and nothing to press.
      await goOnAfterStep(session, ctx, onClose);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  const jump = (itemId: string) => {
    const at = checkItems.findIndex((row) => row.id === itemId);
    if (at >= 0) setPosition(at);
  };

  const nextPending = () => {
    if (!data) return;
    // What this help has left, in another group, comes before the next help.
    if (pendingElsewhere) return setAsked(null);
    const order = [...checkItems.slice(position + 1), ...checkItems.slice(0, position + 1)];
    const found = nextOf(order);
    if (found) jump(found.id);
  };
  /**
   * Nothing wrong in what is asked of the help in view: every question on screen still to be answered is «yes»,
   * and on to its next group, or to the next help. It was a touch for each question: 1,274 answers in one task of
   * the run, nearly all of them «yes».
   */
  const allGood = () => {
    if (!data || !item) return;
    // Not before every point was ticked: the list is brought into view instead.
    if (!allTicked) {
      document.querySelector(".ck-guide")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    // The first to look at something gives the others their turn on it.
    const first = people && pendingHere.some(({ question }) => !tally?.slots?.[question.id]?.voices.length);
    if (pendingHere.length) void save(pendingHere.map(({ question, answerItemId }) => stamp(answerItemId, question.id, "yes")), t("ck.saved")).then(() => first && reopenOthers());
    setAsked(null);
    if (pendingElsewhere) return;
    const order = [...checkItems.slice(position + 1), ...checkItems.slice(0, position)];
    const found = nextOf(order);
    if (found) jump(found.id);
  };
  const labelOf = (itemId: string) => {
    const stop = checkItems.find((row) => row.id === itemId && row.stop);
    if (stop) return `${stop.verseKey} · ${t("ck.kindVerse")}`;
    const found = data?.items.find((row) => row.id === itemId);
    return found ? `${found.chapter}:${found.verse}${found.title ? ` · ${found.title}` : ""}` : itemId;
  };

  /**
   * The list of the chapter's helps (26 October): a subtask that covers a whole chapter opens on it, with its
   * sections, and it is a touch away from any help.
   */
  const [listOpen, setListOpen] = useState(false);
  const [nothingLeft, setNothingLeft] = useState(false);
  const sections = useMemo(() => (data ? sectionsOf(ctx?.portionIds ?? [], data.chapter, data.portions) : []), [data, ctx?.portionIds]);
  /**
   * Why each help is this person's turn, in a line under it in the list (27 October): what somebody did that waits for
   * them, read from the situation of the help (see `noteSituation`) over all its questions.
   */
  const reasons = useMemo(() => {
    const out = new Map<string, string>();
    if (!people) return out;
    const name = (login: string) => data?.board?.people?.find((person) => person.id.toLowerCase() === login.toLowerCase())?.name ?? login;
    for (const row of summary.items) {
      if (row.turn !== "mine") continue;
      const help = checkItems.find((one) => one.id === row.itemId);
      if (!help || help.stop) continue;
      const options = proposals.filter((view) => !view.adjusts && (view.state === "open" || view.state === "agreed") && (view.proposal.rowId === help.id || view.itemId === help.id));
      const stepRows = questionsFor(help, checkItems, questions).map(({ question, answerItemId }) => ({ answerItemId, questionId: question.id }));
      const s = noteSituation({ me, itemId: help.id, stepRows, answers, options });
      const wrote = answers.some((one) => one.questionId === ITEM_SAYS && one.itemId === help.id && isMe(one.by));
      const pending = s.kind === "ownProposal" ? proposals.find((view) => view.adjusts === (s.head.option ?? s.head.proposal.id) && view.adjustment === "pending") : undefined;
      const text =
        s.kind === "asked"
          ? t(wrote ? "ck.whyAnswered" : "ck.whyAsked").replace("{who}", name(s.by))
          : s.kind === "proposal"
            ? t("ck.whyProposal").replace("{who}", name(s.author))
            : s.kind === "ownProposal"
              ? pending
                ? t("ck.whyAdjustment").replace("{who}", name(pending.by))
                : s.doubts.length
                  ? t("ck.whyDoubt").replace("{who}", name(s.doubts[0]!))
                  : ""
              : s.kind === "confirm"
                ? t("ck.whyReviewed").replace("{who}", name(s.by[0]!))
                : "";
      if (text) out.set(help.id, text);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, summary, checkItems, proposals, answers, questions, me, language]);
  const roster = useMemo(() => rosterOf({ items: checkItems, summary, sections, me, reasons }), [checkItems, summary, sections, me, reasons]);
  const openedList = useRef(false);
  useEffect(() => {
    if (!data || openedList.current) return;
    openedList.current = true;
    // A link to one help opens on it; one that is not in this list any more opens on the list, as any other.
    if (openItem && checkItems.some((row) => row.id === openItem)) return jump(openItem);
    if (sections.length > 1) setListOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sections.length]);

  /**
   * The help in view, to send to the team (27 October): a short link that opens on it for whoever opens it. On a
   * phone, the share sheet (WhatsApp and the rest); elsewhere it is copied.
   */
  const [linkCopied, setLinkCopied] = useState(false);
  const canShare = Boolean(ctx?.pmOrg && ctx.issueNumber && ctx.stepId && !trying);
  const shareHelp = async () => {
    if (!ctx || !data || !entry || !item) return;
    const url = `${window.location.origin}${window.location.pathname}${helpLinkHash({ org: ctx.pmOrg, project: ctx.projectId || ctx.book, issue: ctx.issueNumber, step: ctx.stepId ?? "", item: entry.id })}`;
    const where = `${bookLabel(data.book, language)} ${item.chapter}:${item.verse}`;
    const title = verseStop ? where : `${where} · ${entry.id}`;
    const text = noteQuote ? `${title} · «${noteQuote}»` : title;
    const phone = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (phone && typeof navigator.share === "function") {
      // Closing the sheet without choosing is not an error to show.
      await navigator.share({ title, text, url }).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setLinkCopied(true);
      announce(t("ck.linkCopied"));
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      window.prompt(t("ck.linkCopyBy"), url);
    }
  };
  /** What each help is about, as the list shows it: the words a note quotes in the first text, a term, a question. */
  const rosterWords = useMemo(() => {
    const out = new Map<string, string>();
    if (!listOpen || !data) return out;
    const first = data.texts[texts[0]!];
    for (const row of data.items) {
      if (kind === "notas") {
        const verse = first?.verses[row.verse] ?? "";
        out.set(row.id, row.quote && verse ? (alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: row.quote, occurrence: row.occurrence ?? 1, alignments: first?.alignments, book: data.book, chapter: row.chapter, verse: row.verse, ...(data.original ? { original: originalTokens(data.original, row.chapter, row.verse) } : {}) }).gatewayText ?? "") : "");
      } else out.set(row.id, kind === "palabras" ? (titlesRead ? termLabel(row.title, termTitles) : "") : row.title);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listOpen, data, textsKey, titlesRead, termTitles]);
  const rosterLabel = (itemId: string) => (checkItems.find((row) => row.id === itemId)?.stop ? t("ck.listWholeVerse") : rosterWords.get(itemId) || "…");
  const openFromList = (itemId: string) => {
    setNothingLeft(false);
    setListOpen(false);
    jump(itemId);
  };
  /** «Seguir donde hace falta»: what is this person's turn, then where people are still missing (see `nextNeeding`). */
  const goWhereNeeded = () => {
    const found = nextNeeding(roster, { me, needed: people || 1, present: presentOn });
    if (found) return openFromList(found);
    setNothingLeft(true);
    setListOpen(true);
  };

  /**
   * Who else is in this subtask now, and on which help (26 October): the room is the one its answers are kept under.
   * Where this person is, and whether they are writing to the team, is said to the others; when one of them
   * answers, the answers are read again, so the list and the help change without reloading.
   */
  const room = data && session && storeKey && !trying ? presenceRoom({ host: session.host, owner: data.target.owner, repo: data.target.repo, key: storeKey }) : null;
  const focusHere = !listOpen && entry ? { item: entry.id, doing: proposing || commenting ? ("writing" as const) : ("viewing" as const) } : null;
  const reread = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readAgain = () => {
    if (!session || !data || reread.current) return;
      // Several answers in a row are read once.
      reread.current = setTimeout(() => {
        reread.current = null;
        void loadCheckAnswers(session, data.target, storeKey)
          .then((loaded) =>
            setAnswers((prev) => {
              const keyOf = (row: CheckAnswer) => `${row.itemId}|${row.questionId}|${row.by}|${row.at}`;
              const known = new Set(loaded.map(keyOf));
              // What this person wrote and the read did not bring yet stays.
              return [...loaded, ...prev.filter((row) => !known.has(keyOf(row)))];
            }),
          )
          .catch(() => undefined);
      }, 1000);
  };
  const { peers, announce: tellOthers } = usePresence({ room, session: session ?? null, focus: focusHere, onEvent: readAgain, onRejoin: readAgain });
  const namesOf = (rows: Peer[]) => {
    const names = rows.map((peer) => peer.name || peer.login);
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} ${t("ck.andMore").replace("{n}", String(names.length - 2))}`;
  };
  const kindWord = t(kind === "notas" ? "ck.kindNote" : kind === "preguntas" ? "ck.kindQuestion" : "ck.kindTerm").toLowerCase();
  const onThis = entry && !listOpen ? peersOn(peers, entry.id) : [];
  /** Who is on each item now, by login: «Seguir» counts them among the people an item has. */
  const presentOn: Record<string, string[]> = {};
  for (const peer of peers) if (peer.focus) (presentOn[peer.focus.item] ??= []).push(peer.login);
  const writingHere = onThis.filter((peer) => peer.focus?.doing === "writing");

  const stepName = data?.step ? localized(data.step.name, data.step.names, language) : t("ck.title");
  useEffect(() => setChoosing(false), [item?.id, group?.about]);
  useEffect(() => setCommenting(false), [item?.id, group?.about]);
  useEffect(() => setFailing([]), [choosing, item?.id, group?.about]);
  /**
   * The proposal for what was marked as failing: one, answering every question marked (20 October). It was one
   * question at a time, chosen from a list of buttons, when a note can fail two or three of them at once.
   */
  const proposeFailing = (ids: string[] = failing) => {
    if (!item) return;
    const rows = rowsShown.filter(({ question }) => ids.includes(question.id));
    setChoosing(false);
    if (!rows.length) return setProposing({ answerItemId: verseStop?.id ?? item.id, questionId: PROPOSAL_FREE, reason: "" });
    if (grouped) setAsked({ itemId: item.id, about: group?.about ?? "" });
    const [first, ...rest] = rows;
    setProposing({
      answerItemId: first!.answerItemId,
      questionId: first!.question.id,
      reason: rows.map(({ question }) => questionText(question, language, ctx?.lang)).join(" · "),
      onlyVerse: rows.every(({ question }) => question.per === "verse"),
      others: rest.map(({ question, answerItemId }) => ({ answerItemId, questionId: question.id })),
    });
  };
  /**
   * What the step in view asks, said once as its heading and once as the question over the answer: «Comprueba la
   * nota frente al TPL», «¿Está bien la nota frente al TPL?». The screen said «Ester 1:1» and a list of questions,
   * each to be ticked or refused, and what was being checked against what was left to work out (19 October).
   */
  const what = t(kind === "notas" ? "ck.whatNote" : kind === "preguntas" ? "ck.whatQuestion" : "ck.whatTerm");
  const against = grouped && !aboutArticle && group?.about ? textLabel(group.about as ChecklistText) : "";
  const stepWords = (plain: MessageKey, withText: MessageKey, ofArticle: MessageKey) => {
    const said = (aboutArticle ? t(ofArticle) : against ? t(withText).replace("{text}", against) : t(plain)).replace("{what}", what);
    // «A nota está bem…?»: a sentence that starts with what is checked takes its capital, after any «¿».
    return said.replace(/^(¿?)(\p{Ll})/u, (_, mark: string, first: string) => mark + first.toUpperCase());
  };
  /** What a verse's helps are called, in the plural. */
  const whats = t(kind === "notas" ? "ck.whatsNote" : kind === "preguntas" ? "ck.whatsQuestion" : "ck.whatsTerm");
  const heading = verseStop ? t("ck.verseHead").replace("{whats}", whats) : stepWords("ck.head", "ck.headAgainst", "ck.headArticle");
  const asking = verseStop ? t("ck.verseAsk") : stepWords("ck.ask", "ck.askAgainst", "ck.askArticle");
  /** What to do in the step, in a line under its heading (Abel, 21 October): compare, then go over what to check. */
  const howTo = verseStop ? t("ck.verseHint").replace("{whats}", whats) : stepWords("ck.hint", "ck.hintAgainst", "ck.hintArticle");
  /** The texts the chapter is read in: those of the step, as loaded, and the original when there is one. */
  const chapterTexts = useMemo<{ key: string; text: ChapterText }[]>(() => {
    if (!chapterOpen || !data) return [];
    const own = texts.flatMap((resource, index) => {
      const verses = data.texts[resource]?.verses;
      if (!verses) return [];
      const book = Object.fromEntries(Object.entries(verses).map(([verse, body]) => [`${data.chapter}:${verse}`, body]));
      return [{ key: resource as string, text: { id: index === 0 ? ("draft" as const) : ("other" as const), label: textLabel(resource), book } }];
    });
    let orig: { key: string; text: ChapterText }[] = [];
    try {
      orig = data.original ? [{ key: "orig", text: chapterTextOf("orig", t("af.tabOriginal"), data.original) }] : [];
    } catch {
      /* an original that cannot be read: the chapter is read in the texts of the step */
    }
    return [...orig, ...own];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterOpen, data, textsKey, language]);

  /** The conversation of the help in view, decided together (see `NoteConversation`). */
  const talk = useMemo((): { lines: TalkLine[]; status: TalkStatus } | null => {
    if (!people || !item || verseStop || !tally?.slots) return null;
    const label = (about: string) => (about ? scopeLabel(about, data?.board?.settings?.resourceNames, language) : t("ck.talkAll"));
    const slotIds = new Set(rowsHere.map((row) => `${row.answerItemId}\u0000${row.question.id}`));
    // Each person's last answer to each question of the help.
    const last = new Map<string, CheckAnswer>();
    for (const answer of [...answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      if (!slotIds.has(`${answer.itemId}\u0000${answer.questionId}`)) continue;
      // An answer given on a text that changed since does not count, here as in the list.
      const now = hashes?.[verseKeyOf(item)];
      if (now && answer.textHash && answer.textHash !== now) continue;
      const key = `${answer.itemId}\u0000${answer.questionId}\u0000${answer.by.trim().toLowerCase()}`;
      if (answer.cleared) last.delete(key);
      else last.set(key, answer);
    }
    const byPerson = new Map<string, { by: string; at: string; yes: Set<string> }>();
    for (const answer of last.values()) {
      if (answer.value !== "yes") continue;
      const one = byPerson.get(answer.by.trim().toLowerCase()) ?? { by: answer.by, at: answer.at, yes: new Set<string>() };
      one.yes.add(answer.questionId);
      if (answer.at > one.at) one.at = answer.at;
      byPerson.set(answer.by.trim().toLowerCase(), one);
    }
    const lines: TalkLine[] = [];
    for (const one of byPerson.values()) {
      const steps = groups.filter((row) => row.rows.every((r) => one.yes.has(r.question.id))).map((row) => label(row.about));
      if (steps.length) lines.push({ kind: "fine", by: one.by, at: one.at, steps });
    }
    // What each person wrote of the help, in its conversation.
    for (const answer of answers) if (answer.questionId === ITEM_SAYS && answer.itemId === item.id && answer.note) lines.push({ kind: "comment", by: answer.by, at: answer.at, text: answer.note });
    // Every version of a proposal is said in it, the replaced ones too: what each adjustment changed is the conversation.
    const made = proposals.filter((view) => view.state !== "withdrawn" && (slotIds.has(`${view.itemId}\u0000${view.questionId}`) || view.proposal.rowId === item.id));
    for (const view of made) {
      const chain = chainOf(proposals, view.proposal.id);
      lines.push({ kind: "proposal", at: view.at, view, version: chain.length, ...(chain.length > 1 ? { previous: chain[chain.length - 2] } : {}) });
    }
    // Who came to be for a version or to rather leave things as they are, when they said it: the last of each person.
    const madeIds = new Map(made.map((view) => [view.proposal.id, view]));
    const sides = new Map<string, { by: string; at: string; stand: "for" | "against"; id: string } | null>();
    for (const row of [...answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      const view = madeIds.get(row.itemId);
      if (!view || (row.questionId !== PROPOSAL_SAYS && row.questionId !== PROPOSAL_KEEPS)) continue;
      if (row.questionId === PROPOSAL_SAYS && row.by.trim().toLowerCase() === view.by.trim().toLowerCase()) continue;
      const key = `${row.itemId}\u0000${row.by.trim().toLowerCase()}`;
      sides.set(key, row.value === "yes" ? { by: row.by, at: row.at, stand: row.questionId === PROPOSAL_SAYS ? "for" : "against", id: row.itemId } : null);
    }
    for (const side of sides.values()) if (side) lines.push({ kind: "stand", by: side.by, at: side.at, stand: side.stand, version: chainOf(proposals, side.id).length });
    for (const view of made) {
      if (!view.decidedBy) continue;
      const row = answers.filter((one) => one.itemId === view.proposal.id && one.questionId === PROPOSAL_DECIDED && one.by === view.decidedBy).pop();
      if (row) lines.push({ kind: "decided", by: row.by, at: row.at, apply: row.value === "yes" });
    }
    lines.sort((a, b) => a.at.localeCompare(b.at));
    const open = made.filter((view) => view.state === "open").length;
    const change = made.find((view) => view.state === "agreed" || view.state === "applied" || view.state === "sent");
    const settledBy = made.find((view) => view.decidedBy)?.decidedBy;
    const disputed = made.filter((view) => view.state === "open" && view.inFavour.length && view.against.length);
    const status: TalkStatus =
      tally.state === "ok"
        ? { kind: "settled", ...(change ? { change: change.by } : {}), ...(settledBy ? { decidedBy: settledBy } : {}) }
        : disputed.length
          ? { kind: "disputed", against: [...new Set(disputed.flatMap((view) => view.against))], inFavour: [...new Set(disputed.flatMap((view) => view.inFavour))], stalled: disputed.some((view) => disputeStalled(view)) }
          : open ? { kind: "open", proposals: open } : { kind: "counting", steps: groups.map((row) => ({ label: label(row.about), agree: Math.min(...row.rows.map((r) => tally.slots?.[r.question.id]?.yesBy.length ?? 0)) })), people };
    return { lines, status };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, item?.id, verseStop, tally, answers, proposals, rowsHere.length, groups.length, language]);

  /** The words of the first text the note in view quotes, when they are found there through the alignment. */
  const noteQuote = useMemo(() => {
    if (kind !== "notas" || !item?.quote || verseStop || !data) return "";
    const first = data.texts[texts[0]!];
    const verse = first?.verses[item.verse] ?? "";
    if (!verse) return "";
    return alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: first?.alignments, book: data.book, chapter: item.chapter, verse: item.verse, ...(data.original ? { original: originalTokens(data.original, item.chapter, item.verse) } : {}) }).gatewayText ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, item?.id, item?.quote, item?.occurrence, verseStop, data, textsKey]);

  /**
   * The other notes of the verse whose quote shares words of the original with this one, with those words as the
   * first text says them (Abel, 26 October): read one at a time, a note about «realeza» seemed to leave «se sentaba
   * sobre el trono» unexplained, when the note before it explains it.
   */
  const crossNotes = useMemo(() => {
    if (kind !== "notas" || !item?.quote || verseStop || !data) return [];
    const wordsOf = (quote: string) => new Set(quote.split(/[\s&]+/).map((word) => word.replace(/[\u0591-\u05AF\u05BD\u05C0\u05C3\u2060]/g, "")).filter(Boolean));
    const mine = wordsOf(item.quote);
    const first = data.texts[texts[0]!];
    const verse = first?.verses[item.verse] ?? "";
    return data.items
      .filter((other) => other.id !== item.id && other.chapter === item.chapter && other.verse === item.verse && other.quote && [...wordsOf(other.quote)].some((word) => mine.has(word)))
      .map((other) => ({
        id: other.id,
        words: verse ? (alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: other.quote!, occurrence: other.occurrence ?? 1, alignments: first?.alignments, book: data.book, chapter: other.chapter, verse: other.verse, ...(data.original ? { original: originalTokens(data.original, other.chapter, other.verse) } : {}) }).gatewayText ?? "") : "",
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, item?.id, verseStop, data, textsKey]);

  /**
   * A verse the note sends to («Vea cómo tradujo este término en [1:10](../01/10.md)»), read in a sheet over it with
   * the notes there about the same words of the original: whether the TPL says it the same way is asked of it.
   */
  const openLinkedVerse = useCallback(
    (href: string, linkKind: "rc" | "relative" | "unknown") => {
      if (linkKind !== "relative" || !item || !data) return;
      const match = /^(?:\.\.\/0*(\d+)|\.)\/0*(\d+)\.md$/.exec(href.trim());
      if (!match) return;
      const chapter = match[1] ? Number(match[1]) : item.chapter;
      const verse = Number(match[2]);
      const wordsOf = (quote: string) => new Set(quote.split(/[\s&]+/).map((word) => word.replace(/[\u0591-\u05AF\u05BD\u05C0\u05C3\u2060]/g, "")).filter(Boolean));
      const mine = wordsOf(item.quote ?? "");
      const notes = (data.bookNotes ?? data.items).filter((other) => other.chapter === chapter && other.verse === verse && other.quote && [...wordsOf(other.quote)].some((word) => mine.has(word)));
      setPeek({ chapter, verse, notes: notes.map((other) => other.id), linked: true });
    },
    [item, data],
  );

  /** What this person is asked of the proposal in play: in the bar, or at the end of the open conversation. */
  const turnAsk =
    disputeHere && myStand !== "none" && !decideHere
      ? myStand === "against"
        ? t("ck.disputeAgainst")
        : t(disputeHere.against.length > 1 ? "ck.disputeForMany" : "ck.disputeFor").replace("{who}", disputeHere.against.map((who) => `@${who}`).join(", "))
      : openHere.length === 1 && !decideHere
        ? agreedBefore(openHere[0]!)
          ? t("ck.staleAsk").replace("{n}", String(chainOf(proposals, openHere[0]!.proposal.id).length))
          : t("ck.proposalAsk").replace("{who}", `@${openHere[0]!.by}`)
        : undefined;
  /**
   * The options for the help in view, decided together: each proposal made for it, with its versions, and what each
   * person chose; the messages said of each option (an old one, of none, goes to the option in play when it was said).
   */
  const optionsHere = useMemo(() => {
    if (!people || !item || verseStop) return null;
    const slotIds = new Set(rowsHere.map((row) => `${row.answerItemId}\u0000${row.question.id}`));
    const here = proposals.filter((view) => view.state !== "withdrawn" && (slotIds.has(`${view.itemId}\u0000${view.questionId}`) || view.proposal.rowId === item.id));
    const heads = here.filter((view) => view.state !== "replaced" && !view.adjusts);
    if (!heads.length) return null;
    // The adjustments of each option still to answer, and those its author did not accept, under it (27 October).
    const adjustments = here.filter((view) => view.adjusts && (view.adjustment === "declined" || (view.state === "open" && (view.adjustment === "pending" || view.adjustment === "stale"))));
    const options: HelpOption[] = heads.map((head) => {
      const id = head.option ?? head.proposal.id;
      const under = adjustments.filter((view) => view.adjusts === id);
      return { id, versions: chainOf(proposals, head.proposal.id).filter((view) => view.state !== "withdrawn"), ...(under.length ? { adjustments: under } : {}) };
    });
    const won = heads.find((view) => view.state === "agreed" || view.state === "applied" || view.state === "sent");
    const winner = won ? (won.option ?? won.proposal.id) : heads.every((view) => view.state === "rejected") ? KEEP_OPTION : undefined;
    const firsts = options.map((option) => ({ id: option.id, at: option.versions[0]?.at ?? "" }));
    const messages: OptionMessage[] = answers
      .filter((row) => row.questionId === ITEM_SAYS && row.itemId === item.id && row.note)
      .map((row) => ({ by: row.by, at: row.at, text: row.note!, about: row.about ?? ([...firsts].filter((one) => one.at <= row.at).sort((a, b) => b.at.localeCompare(a.at))[0]?.id ?? KEEP_OPTION) }));
    return { heads, options, choices: heads.find((view) => view.choices)?.choices ?? {}, winner, decidedBy: heads.find((view) => view.decidedBy)?.decidedBy, stalled: heads.some((view) => disputeStalled(view)), messages };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, item?.id, verseStop, proposals, answers, rowsHere.length]);
  /**
   * Where the step in view stands for this person, decided together (Abel, 27 October; see `noteSituation`): whether
   * they open it, or collaborate on a review, a proposal or a question somebody left. Two or more proposals from
   * before one proposal per note are chosen among as before (`options`).
   */
  const stepKey = rowsShown.map(({ question, answerItemId }) => `${answerItemId}:${question.id}`).join("|");
  const situation = useMemo(() => {
    if (!people || !item || verseStop) return null;
    const live = (optionsHere?.heads ?? []).filter((view) => view.state === "open" || view.state === "agreed");
    return noteSituation({ me, itemId: item.id, stepRows: rowsShown.map(({ question, answerItemId }) => ({ answerItemId, questionId: question.id })), answers, options: live });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, item?.id, verseStop, answers, optionsHere, stepKey, me]);
  const collab = situation && situation.kind !== "options" ? situation : null;
  /** A person by the name the project knows them by. */
  const personName = (login: string) => data?.board?.people?.find((person) => person.id.toLowerCase() === login.toLowerCase())?.name ?? login;
  const peopleNames = (list: string[]) => {
    const all = list.map(personName);
    return all.length < 2 ? (all[0] ?? "") : t("ck.sitAnd").replace("{a}", all.slice(0, -1).join(", ")).replace("{b}", all[all.length - 1]!);
  };
  /** This person wrote on the note before: what somebody asked now answers them. */
  const wroteHere = Boolean(item && answers.some((row) => row.questionId === ITEM_SAYS && row.itemId === item.id && isMe(row.by)));
  /** The title of the step, said to a person: undefined keeps the step's own, null leaves it out (a question comes first). */
  const collabHeading: string | null | undefined = !collab
    ? undefined
    : collab.kind === "confirm"
      ? t("ck.headConfirm").replace("{who}", peopleNames(collab.by))
      : collab.kind === "proposal"
        ? aboutArticle
          ? t("ck.headProposalArticle").replace("{who}", personName(collab.author))
          : t("ck.headProposal").replace("{who}", personName(collab.author)).replace("{text}", against || textLabel(texts[0]!))
        : collab.kind === "ownProposal"
          ? aboutArticle
            ? t("ck.headOwnArticle")
            : t("ck.headOwn").replace("{text}", against || textLabel(texts[0]!))
          : collab.kind === "asked"
            ? null
            : undefined;
  /** What the others said of a question, beside it (27 October): «✓ Ana: sí». It was «@ana · 1/3». */
  const othersOn = (questionId: string): { by: string; value: "yes" | "no" }[] => {
    if (!collab) return [];
    // With a proposal on the note (asked something about it too), what is said of the proposal.
    const head = collab.kind === "proposal" || collab.kind === "ownProposal" || collab.kind === "asked" ? collab.head : undefined;
    if (head) {
      const option = head.option ?? head.proposal.id;
      const author = collab.kind === "proposal" ? collab.author : collab.kind === "asked" ? (collab.author ?? head.by) : me;
      const out = new Map<string, "yes" | "no">();
      for (const [who, marks] of Object.entries(head.marks ?? {})) if (marks[questionId]) out.set(who, marks[questionId]!);
      // A choice from before checking by questions (or the question the author proposed it from) says «yes» to it.
      for (const [who, chose] of Object.entries(head.choices ?? {})) if (chose === option && !out.has(who)) out.set(who, "yes");
      if (head.origin?.includes(questionId) && !out.has(author.toLowerCase())) out.set(author.toLowerCase(), "yes");
      return [...out].filter(([who]) => !isMe(who)).map(([by, value]) => ({ by, value }));
    }
    return (tally?.slots?.[questionId]?.yesBy ?? []).filter((who) => !isMe(who)).map((by) => ({ by, value: "yes" as const }));
  };
  const saidLine = (questionId: string): ReactNode => {
    if (!people || tally?.agreedApart) return null;
    // Decided together, what each person said is said by name, in every situation; the count is in the line above.
    if (collab) {
      const said = othersOn(questionId);
      return said.length ? (
        <span className="ck-said ck-said--who">
          {said.map((one) => (
            <span key={one.by} data-v={one.value}>
              {one.value === "yes" ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />} {t(one.value === "yes" ? "ck.saidBy" : "ck.saidNoBy").replace("{who}", personName(one.by))}
            </span>
          ))}
        </span>
      ) : null;
    }
    const yesBy = tally?.slots?.[questionId]?.yesBy ?? [];
    return yesBy.length ? (
      <span className="ck-said">
        <Check size={13} aria-hidden /> {yesBy.map((who) => (isMe(who) ? t("ck.talkYou") : `@${who}`)).join(", ")} · {Math.min(yesBy.length, people)}/{people}
      </span>
    ) : null;
  };
  /** With a proposal, the note is read as it would leave it, with what others suggest changing of it under it. */
  const proposalShown = (() => {
    // Asked something about a note with a proposal, what is read is still the proposal.
    const reviewed = collab && (collab.kind === "proposal" || collab.kind === "ownProposal") ? { head: collab.head, author: collab.kind === "proposal" ? collab.author : me } : collab?.kind === "asked" && collab.head ? { head: collab.head, author: collab.author ?? collab.head.by } : null;
    if (!item || !reviewed) return null;
    const head = reviewed.head;
    const option = optionsHere?.options.find((one) => one.id === (head.option ?? head.proposal.id));
    const author = reviewed.author;
    const adjusted = [...new Set((option?.versions ?? []).map((view) => view.proposal.adjustedBy).filter((by): by is string => Boolean(by)))];
    const title = isMe(author) ? t("ck.cardProposalMine") : adjusted.length ? t("ck.cardProposalAdjusted").replace("{who}", personName(author)).replace("{names}", peopleNames(adjusted)) : t("ck.cardProposal").replace("{who}", personName(author));
    const reason = head.reason || option?.versions[0]?.reason || "";
    const who = (by: string) => (isMe(by) ? t("ck.talkYou") : `@${by}`);
    return (
      <>
        <ProposalCard head={head} original={item.body} title={title} reason={reason} reasonBy={who(author)} />
        <AdjustmentList
          adjustments={option?.adjustments ?? []}
          head={head}
          author={author}
          me={me}
          who={who}
          currentLabel={title}
          closed={stepDone}
          canAnswerFor={(adjustment) => !stepDone && decides(me) && Date.now() - Date.parse(adjustment.at) >= DISPUTE_DAYS * 86_400_000}
          canDecide={Boolean(optionsHere?.stalled && decides(me))}
          saving={saving}
          onAccept={(adjustment, version, decide) => void acceptAdjustment(adjustment, version, decide)}
          onDecline={(adjustment) => void declineAdjustment(adjustment)}
          onRewrite={(adjustment, version) => adjustProposal(version, [], adjustment.proposal.id)}
          onWithdraw={(id) => void withdrawWhole(id)}
        />
      </>
    );
  })();
  /**
   * How this person answers the step, collaborating (Abel, 27 October): agreeing with somebody's review or proposal,
   * or «No del todo…», which opens the points to mark what fails. Asked something, the answer comes first; checking the
   * points then is checking the proposal, when there is one, or opening the note.
   */
  const [doubting, setDoubting] = useState(false);
  useEffect(() => setDoubting(false), [item?.id, group?.about]);
  const meKey = me.trim().toLowerCase();
  const answerMode: "first" | "confirm" | "proposal" | "ownProposal" | "asked" | null = !collab ? null : collab.kind === "asked" ? (doubting ? (collab.head ? "proposal" : "first") : "asked") : collab.kind;
  const reviewHead = collab && (collab.kind === "proposal" || collab.kind === "ownProposal") ? collab.head : collab?.kind === "asked" ? collab.head : undefined;
  const reviewQuestions = reviewHead ? questionsOfProposal(reviewHead) : [];
  const reviewOption = reviewHead ? (reviewHead.option ?? reviewHead.proposal.id) : "";
  const reviewing = answerMode === "proposal" || answerMode === "ownProposal";
  /** The questions of the step this person still has to check of the proposal (its author, less those it began from). */
  const reviewLeft = reviewHead && reviewing
    ? rowsShown.filter(({ question }) => reviewQuestions.includes(question.id) && !(answerMode === "ownProposal" && reviewHead.origin?.includes(question.id)) && reviewHead.marks?.[meKey]?.[question.id] !== "yes" && reviewHead.choices?.[meKey] !== reviewOption)
    : [];
  const tickRows = reviewing ? reviewLeft : pendingHere;
  const tickAll = tickRows.every(({ question }) => isTicked(question.id));
  const tickFailing = tickRows.filter(({ question }) => pointMark(question.id) === "no").map(({ question }) => question.id);
  const agreedAlready = reviewing ? (reviewQuestions.length ? reviewLeft.length === 0 : reviewHead?.choices?.[meKey] === reviewOption) : answerMode === "confirm" ? pendingHere.length === 0 : false;
  /** The points of the step are marked one by one: opening the note, or once «No del todo…» opened them. */
  const showTicks = (questionId: string) => !stepDone && (answerMode && answerMode !== "first" ? doubting && tickRows.some(({ question }) => question.id === questionId) : pendingHere.some(({ question }) => question.id === questionId));
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  /** On to the next step of the note, or from its last to the next note where somebody is needed. */
  const nextStep = () => {
    const at = group ? groups.indexOf(group) : -1;
    if (item && grouped && at >= 0 && at < groups.length - 1) return setAsked({ itemId: item.id, about: groups[at + 1]!.about });
    goOn();
  };
  /** «Estoy de acuerdo»: what agreeing writes (see `agreementRows`), and, when that settles the note, saying so once. */
  const agree = async () => {
    if (!item || !collab) return;
    const now = new Date().toISOString();
    const situationNow: NoteSituation = collab.kind === "asked" && collab.head ? { kind: "proposal", head: collab.head, author: collab.author ?? collab.head.by, since: collab.head.optionAt ?? collab.head.at, agreed: collab.head.inFavour, doubts: collab.head.noBy ?? [] } : collab;
    const versions = new Set(proposals.map((view) => view.proposal.id));
    const rows = agreementRows({ me, at: now, situation: situationNow, stepRows: (answerMode === "confirm" ? pendingHere : rowsShown).map(({ question, answerItemId }) => ({ answerItemId, questionId: question.id })), proposalQuestions: reviewQuestions })
      .map((row) => (row.questionId.startsWith("@") || versions.has(row.itemId) ? row : stamp(row.itemId, row.questionId, "yes")));
    if (!rows.length) return;
    setDoubting(false);
    await save(rows, t("ck.saved"));
    reopenOthers();
    const settled = summaryRef.current.items.find((row) => row.itemId === item.id);
    if (settled?.state === "ok") {
      const voices = [...new Set(Object.values(settled.slots ?? {}).flatMap((slot) => slot.voices.map((who) => who.toLowerCase())))];
      announce(t("ck.ansSettled").replace("{names}", peopleNames(voices)));
      return goOn();
    }
    nextStep();
  };
  const stays = Boolean(collab && answerMode !== "first");
  /** The conversation of the note in view (see `noteTimeline`), with what each person did in it. */
  const timeline = useMemo(() => {
    if (!collab || !item) return null;
    return noteTimeline({ me, itemId: item.id, answers, proposals, steps: groups.map((one) => ({ about: one.about, rows: one.rows.map(({ question, answerItemId }) => ({ answerItemId, questionId: question.id })) })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(collab), item?.id, answers, proposals, groups.length, me]);
  /** Into the box of the conversation, the keyboard up: what «Responder» and «Comentar» do, collaborating. */
  const toThreadBox = () =>
    window.setTimeout(() => {
      const box = document.getElementById(THREAD_BOX) as HTMLTextAreaElement | null;
      box?.scrollIntoView({ block: "center" });
      box?.focus();
    }, 30);
  const commentForm = item ? (
                <form
                  className="ck-say"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = commentDraft.trim();
                    if (!text) return;
                    const now = new Date().toISOString();
                    // Said of the step in view; with a proposal, the points marked «no» are its «no», with this reason.
                    const rows = [itemSaying(item.id, me, now, text, undefined, group?.about || undefined), ...(reviewHead && tickFailing.length ? tickFailing.map((questionId) => proposalMark(reviewHead.proposal.id, questionId, me, now, "no", text)) : [])];
                    void save(rows, t("ck.talkSent")).then(() => {
                      setCommenting(false);
                      setCommentDraft("");
                      setDoubting(false);
                      // Collaborating, the conversation goes on here; opening a note, a doubt said goes on to the next.
                      if (!stays) goOn();
                    });
                  }}
                >
                  <label className="sr-only" htmlFor="ck-say-box">
                    {t("ck.sayToTeam")}
                  </label>
                  <textarea id="ck-say-box" className="af-textarea ck-say__box" rows={3} autoFocus placeholder={t("ck.sayToTeam")} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
                  <div className="ck-go__buttons">
                    <Button type="submit" size="lg" disabled={saving || !commentDraft.trim()}>
                      <MessageCircle size={16} aria-hidden /> {t(stays ? "ck.talkSend" : "ck.sayAndGoOn")}
                    </Button>
                    <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => setCommenting(false)}>
                      {t("af.cancel")}
                    </Button>
                  </div>
                </form>
  ) : null;
  /** This person's choice among the options, and whether the one they chose was edited since. */
  const myChoice = optionsHere?.choices[me.trim().toLowerCase()];
  const myStale = Boolean(optionsHere?.heads.some((view) => view.staleFor?.includes(me.trim().toLowerCase())));
  /** An adjustment this person has to answer: to their proposal, or theirs written over another version of one. */
  const adjustmentForMe = optionsHere?.options.flatMap((option) => (option.adjustments ?? []).filter((view) => (view.adjustment === "pending" && isMe(option.versions[0]!.by)) || (view.adjustment === "stale" && isMe(view.by))))[0];
  /**
   * In a disagreement, whether the last thing said of the options (a choice, a version, a message) was said by
   * somebody who chose another one: then this person has something to answer.
   */
  const lastWordOther = (() => {
    if (!optionsHere || !item) return false;
    const ids = new Set(optionsHere.options.flatMap((option) => option.versions.map((view) => view.proposal.id)));
    const last = answers
      .filter((row) => ids.has(row.itemId) || (row.proposal && ids.has(row.proposal.id)) || (row.itemId === item.id && row.questionId === ITEM_SAYS))
      .reduce<CheckAnswer | undefined>((late, row) => (!late || Date.parse(row.at) >= Date.parse(late.at) ? row : late), undefined);
    const theirs = last ? optionsHere.choices[last.by.trim().toLowerCase()] : undefined;
    return Boolean(last && !isMe(last.by) && theirs !== myChoice);
  })();
  /** Chooses an option for the help in view: one of the proposals, or leaving it as it is. */
  const chooseOption = (option: string) => {
    if (!optionsHere) return;
    const now = new Date().toISOString();
    if (option === KEEP_OPTION) return save([proposalKeeping(optionsHere.heads[0]!.proposal.id, me, now, true)], t("ck.saved"));
    const head = optionsHere.heads.find((view) => (view.option ?? view.proposal.id) === option);
    if (head) return save([proposalSaying(head.proposal.id, me, now, true)], t("ck.saved"));
  };
  /**
   * The steps a proposal for the help in view is checked in, as the note is (27 October): its questions grouped by
   * what they are read against, with that text's verse. Its author does not mark the question it was proposed from.
   */
  const proposalGroups = (view: ProposalView): ProposalCheckGroup[] => {
    if (!item || !data) return [];
    const asked = new Set(questionsOfProposal(view));
    const author = optionsHere?.options.find((option) => option.id === (view.option ?? view.proposal.id))?.versions[0]?.by ?? view.by;
    const own = isMe(author) ? new Set(view.origin ?? []) : new Set<string>();
    const rows = questions.filter((q) => asked.has(q.id) && !own.has(q.id)).map((question) => ({ question, answerItemId: view.proposal.id }));
    return groupsOf(rows).map((group) => ({
      about: group.about,
      label: scopeLabel(group.about, data.board?.settings?.resourceNames, language),
      ...(data.texts[group.about as ChecklistText]?.verses[item.verse] ? { reference: data.texts[group.about as ChecklistText]!.verses[item.verse] } : {}),
      questions: group.rows.map(({ question }) => ({ id: question.id, text: questionText(question, language, ctx?.lang) })),
    }));
  };
  /** One mark on a proposal; a «no» says what fails in the conversation of that option too. */
  const markProposal = async (view: ProposalView, questionId: string, value: "yes" | "no", note?: string) => {
    if (!item) return;
    const now = new Date().toISOString();
    const rows = [proposalMark(view.proposal.id, questionId, me, now, value, note)];
    if (value === "no" && note) rows.push(itemSaying(item.id, me, now, note, view.option ?? view.proposal.id));
    await save(rows, t("ck.saved"));
    if (value === "no") reopenOthers();
  };
  /** Another option, from the help as it is, answering what the others answer. */
  const proposeOption = () => {
    const head = optionsHere?.heads[0];
    if (!head) return;
    const rows = answers.filter((row) => row.outcome === "proposal" && row.proposal?.id === head.proposal.id);
    const [first, ...rest] = rows.length ? rows : [{ itemId: head.itemId, questionId: head.questionId }];
    setProposing({ answerItemId: first!.itemId, questionId: first!.questionId, reason: "", others: rest.map((row) => ({ answerItemId: row.itemId, questionId: row.questionId })) });
  };
  /** Whoever coordinates the team settles it: for an option, or for leaving the help as it is. */
  const decideOption = (option: string) => {
    const head = optionsHere?.heads.find((view) => (view.option ?? view.proposal.id) === option) ?? optionsHere?.heads[0];
    if (head) void decide(head.proposal.id, option !== KEEP_OPTION);
  };
  /** Somebody started the conversation of the help in view: said a step is right, or proposed a change. */
  // A comment starts it too: writing to the team is a way to take part (26 October).
  const talkStarted = Boolean(talk?.lines.length);
  /**
   * A proposal in conversation on what is on screen, with nothing else on it to answer first: the bar says whether
   * there is something new for this person in the conversation, and goes on to the next help.
   */
  /** Something was said that this person has not answered: a proposal, a version of it, or the other side of a dispute. */
  const news = optionsHere
    ? !optionsHere.winner && ((!myChoice && !optionsHere.heads.some((view) => view.noBy?.some(isMe))) || myStale || Boolean(adjustmentForMe) || (optionsHere.heads.some((view) => view.disputedSince) && lastWordOther))
    : openHere.length > 0 || Boolean(disputeHere && myStand !== "none" && tally?.turn === "mine");
  // With nothing new, what else is left on screen to answer (a question no proposal is about) is asked first.
  const convoHere = Boolean(people && (talkStarted || optionsHere) && (inPlay.length || (optionsHere && !optionsHere.winner)) && !decideHere && !choosing && (news || pendingHere.every(({ question }) => (tally?.slots?.[question.id]?.open.length ?? 0) > 0)));
  const restOfList = [...checkItems.slice(position + 1), ...checkItems.slice(0, position)];
  const canGoOn = Boolean(nextOf(restOfList));
  const goOn = () => {
    setAsked(null);
    const found = nextOf(restOfList);
    if (found) jump(found.id);
  };
  /**
   * What the bar says there is, said as if it were heard for the first time: the person may not know there is a
   * proposal, even having taken part in it before (Abel, 21 October). What is asked is read in the conversation.
   */
  const barNews =
    optionsHere && adjustmentForMe?.adjustment === "pending"
      ? t("ck.barAdjustment").replace("{who}", `@${adjustmentForMe.by}`)
      : optionsHere && !myChoice
      ? optionsHere.options.length > 1
        ? t("ck.barOptions").replace("{n}", String(optionsHere.options.length)).replace("{what}", what)
        : isMe(optionsHere.options[0]!.versions[0]!.by)
          ? t("ck.barOwnCheck").replace("{what}", what)
          : t("ck.barProposal").replace("{who}", `@${optionsHere.options[0]!.versions[0]!.by}`).replace("{what}", what)
      : optionsHere && myStale
        ? t("ck.barStale").replace("{what}", what)
        : optionsHere
          ? t("ck.barNews").replace("{what}", what)
          : openHere.length === 1 && !agreedBefore(openHere[0]!)
      ? t("ck.barProposal").replace("{who}", `@${openHere[0]!.by}`).replace("{what}", what)
      : openHere.length === 1
        ? t("ck.barStale").replace("{what}", what)
        : t("ck.barNews").replace("{what}", what);
  /** Into the conversation, at what is asked of this person in it. */
  const joinTalk = () => {
    window.dispatchEvent(new Event(OPEN_TALK));
    window.setTimeout(() => (document.getElementById("ck-opts") ?? document.querySelector(".ck-turn") ?? document.getElementById("ck-talk-box"))?.scrollIntoView({ block: "start" }), 60);
  };
  /**
   * Only once somebody started it: it is the continuation of what they began (21 October). The other teams' messages
   * about the help are read in it, at its end: two places that looked like a conversation were one too many.
   */
  const talkView =
    collab && item && timeline ? (
      <NoteThread
        key={item.id}
        entries={timeline.entries}
        newFrom={timeline.newFrom}
        me={me}
        nameOf={personName}
        stepLabel={(about) => (about ? scopeLabel(about, data?.board?.settings?.resourceNames, language) : t("ck.talkAll"))}
        step={group?.about ?? ""}
        saving={saving}
        onSay={(text, step) => save([itemSaying(item.id, me, new Date().toISOString(), text, undefined, step || undefined)], t("ck.talkSent"))}
      >
        {session && ctx?.pmOrg && ctx.projectId && data && !aboutArticle ? (
          <HelpMessages key={item.id} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={messageKey} resource={kind} taskName={ctx.taskName} lede={t("hm.ledeRead")} onlyIfAny canAttend folded foldLabel={t("ck.messagesFold")} />
        ) : null}
      </NoteThread>
    ) : collab ? null : optionsHere && item ? (
      <NoteOptions
        key={item.id}
        title={t("ck.optsTitle").replace("{what}", what)}
        options={optionsHere.options}
        choices={optionsHere.choices}
        messages={optionsHere.messages}
        me={me}
        people={people}
        original={item.body}
        saving={saving}
        closed={stepDone}
        winner={optionsHere.winner}
        decidedBy={optionsHere.decidedBy}
        stalled={optionsHere.stalled}
        canDecide={optionsHere.stalled && decides(me)}
        onChoose={(option) => void chooseOption(option)}
        onPropose={proposeOption}
        onEdit={adjustProposal}
        onWithdraw={(id) => void withdrawWhole(id)}
        onSay={(text, about) => save([itemSaying(item.id, me, new Date().toISOString(), text, about)], t("ck.talkSent"))}
        onDecide={decideOption}
        checkGroupsOf={proposalGroups}
        onMark={markProposal}
        onAccept={(adjustment, head, decide) => void acceptAdjustment(adjustment, head, decide)}
        onDecline={(adjustment) => void declineAdjustment(adjustment)}
        onRewrite={(adjustment, head) => adjustProposal(head, [], adjustment.proposal.id)}
        answersFor={(adjustment) => !stepDone && decides(me) && Date.now() - Date.parse(adjustment.at) >= DISPUTE_DAYS * 86_400_000}
      >
        {session && ctx?.pmOrg && ctx.projectId && data && !aboutArticle ? (
          <HelpMessages key={item.id} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={messageKey} resource={kind} taskName={ctx.taskName} lede={t("hm.ledeRead")} onlyIfAny canAttend folded foldLabel={t("ck.messagesFold")} />
        ) : null}
      </NoteOptions>
    ) : talk && talkStarted && item ? (
      <NoteConversation
        key={item.id}
        lines={talk.lines}
        status={talk.status}
        me={me}
        people={people}
        original={item.body}
        saving={saving}
        onFor={(id) => void voteFor(id)}
        onKeep={(id) => void voteKeep(id)}
        onWithdraw={(id) => void withdraw(id)}
        onAdjust={stepDone ? undefined : adjustProposal}
        ask={!convoHere && openHere.length !== 1 && !disputeHere}
        title={t("ck.playTitle").replace("{what}", what)}
        turnAsk={turnAsk}
        onOpenChange={setTalkOpen}
        onSay={stepDone ? undefined : (text) => save([itemSaying(item.id, me, new Date().toISOString(), text)], t("ck.talkSent"))}
      >
        {session && ctx?.pmOrg && ctx.projectId && data && !aboutArticle ? (
          <HelpMessages key={item.id} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={messageKey} resource={kind} taskName={ctx.taskName} lede={t("hm.ledeRead")} onlyIfAny canAttend folded foldLabel={t("ck.messagesFold")} />
        ) : null}
      </NoteConversation>
    ) : null;

  /** The helps of the verse whose stop is in view, in their order. */
  const verseHelps = verseStop && data ? data.items.filter((row) => verseKeyOf(row) === verseStop.verseKey) : [];
  // Another verse begins at its first help.
  useEffect(() => setVerseNoteAt(0), [verseStop?.verseKey]);
  /**
   * The help of the verse in view at its stop, and the words its quote points at in each text (27 October): going
   * over them one at a time, what each covers is seen marked in the TPL and the TPS, and what none covers is left.
   */
  const verseNote = verseHelps[Math.min(verseNoteAt, verseHelps.length - 1)];
  const verseMarks = verseNote && data ? helpQuoteInTexts({ texts: Object.fromEntries(textsShown.map((id) => [id, data.texts[id]])), help: verseNote, book: data.book, ...(data.original ? { original: originalTokens(data.original, verseNote.chapter, verseNote.verse) } : {}) }) : {};

  /** The help in view as it reads (or as a change proposed for it would make it read). */
  const helpRead = item ? (
    <>
    {item.title ? (
      // The code of a term («Jesus») was shown until its name came, and then changed under the eyes.
      <h2 className="af-phrase" aria-busy={kind === "palabras" && !titlesRead ? true : undefined}>
        {kind !== "palabras" ? item.title : titlesRead ? termLabel(item.title, termTitles) : "\u00a0"}
      </h2>
    ) : null}
    {!people && termVersions.length ? (
      <section className="ck-versions" aria-label={t(termVersions.length > 1 ? "ck.versionsLead" : "ck.versionOne").replace("{n}", String(termVersions.length))}>
        <p className="ck-versions__lead">{t(termVersions.length > 1 ? "ck.versionsLead" : "ck.versionOne").replace("{n}", String(termVersions.length))}</p>
        {termVersions.map((view) => (
          <div key={view.proposal.id} className="ck-version">
            <b className="ck-proposed__label">{isMine(view.by) ? t("ag.optMine") : t("ag.optBy").replace("{who}", view.by)}</b>
            {/* An article is pages long: what each version changes in it, a touch away, a few words around each change. */}
            <details className="ck-version__fold">
              <summary>{t("ag.showChange")}</summary>
              <span className="ag-diff ck-version__text">
                <ProposalDiff before={view.proposal.before ?? articles[slug] ?? ""} after={view.proposal.after ?? ""} plain />
              </span>
            </details>
          </div>
        ))}
      </section>
    ) : null}
    {!people && helpVersions.length > 1 ? (
      // Two people proposed a version of it (a counterproposal answers a proposal): the help as it is, and each
      // version with whose it is, to be chosen in «Acuerdo del equipo». Only the latest was read here, as «Con el
      // cambio propuesto» and with no name, and the version it answered was nowhere on this screen (20 October).
      <>
        <HelpMarkdownView className="af-note af-note--md" content={item.body} onLink={openLinkedVerse} />
        <section className="ck-versions" aria-label={t("ck.versionsLead").replace("{n}", String(helpVersions.length))}>
          <p className="ck-versions__lead">{t("ck.versionsLead").replace("{n}", String(helpVersions.length))}</p>
          {helpVersions.map((view) => (
            <div key={view.proposal.id} className="ck-version">
              <b className="ck-proposed__label">{isMine(view.by) ? t("ag.optMine") : t("ag.optBy").replace("{who}", view.by)}</b>
              {view.proposal.split ? (
                <span className="ck-version__text">
                  {readable(view.proposal.after ?? "")}
                  <span className="ck-proposed__split">
                    <b className="ck-proposed__label">{t("ag.splitNew")}</b> {readable(view.proposal.split.after)}{view.proposal.split.more?.map((one, index) => (<span key={index}> <b className="ck-proposed__label">{t("ag.splitMoreNew")}</b> {readable(one.after)}</span>))}
                  </span>
                </span>
              ) : (
                <span className="ag-diff ck-version__text">
                  <ProposalDiff before={item.body} after={view.proposal.after ?? ""} whole plain />
                </span>
              )}
            </div>
          ))}
        </section>
      </>
    ) : !people && proposedHelp ? (
      // With a change proposed for it, the help is read as it would be, what goes out struck and what comes
      // in marked: the steps that follow check that version. It was shown under the help as well, a third
      // time counting the one under its question, and the help no longer fitted over its questions.
      <p className="af-note ck-proposed">
        <b className="ck-proposed__label">{isMine(proposedHelp.by) ? t("ck.proposedHere") : t("ck.proposedBy").replace("{who}", proposedHelp.by)}</b>{" "}
        {proposedHelp.proposal.split ? (
          // Parted in two, each note is read as it would be. Struck out in the first, what goes to the
          // second was read twice, and a note of five lines took fourteen over its questions.
          <>
            {readable(proposedHelp.proposal.after ?? "")}
            <span className="ck-proposed__split">
              <b className="ck-proposed__label">{t("ag.splitNew")}</b> {readable(proposedHelp.proposal.split.after)}{proposedHelp.proposal.split.more?.map((one, index) => (<span key={index}> <b className="ck-proposed__label">{t("ag.splitMoreNew")}</b> {readable(one.after)}</span>))}
            </span>
          </>
        ) : (
          <span className="ag-diff">
            <ProposalDiff before={proposedHelp.proposal.before ?? item.body} after={proposedHelp.proposal.after ?? ""} whole plain />
          </span>
        )}
      </p>
    ) : null}
    {!people && proposedHelp && !stepDone ? (
      // Another change once one is proposed: it was there only as «Hay algo que cambiar», asking again which
      // question failed, and nobody looked for it there (20 October). It is made over the change proposed, and
      // takes its place: two versions of one note cannot both be written, the second would undo the first.
      <button type="button" className="af-link ck-proposed__more" disabled={saving} onClick={() => setProposing({ answerItemId: item.id, questionId: PROPOSAL_FREE, reason: "" })}>
        <Pencil size={16} aria-hidden /> {t(isMine(proposedHelp.by) ? "ck.changeMore" : "ck.otherVersion")}
      </button>
    ) : null}
    {/* Decided together, the help is always read as it is, untouched: what is proposed is read against it below. */}
    {(people || !proposedHelp) && item.body ? (
      <>
        {kind === "preguntas" ? <p className="af-lbl">{t("ck.answerLbl")}</p> : null}
        <HelpMarkdownView className={kind === "preguntas" ? "af-note af-note--md ck-answer" : "af-note af-note--md"} content={item.body} onLink={openLinkedVerse} />
      </>
    ) : null}
    </>
  ) : null;

  /** The texts after the first one are read under the note, when there is a note: TPL, the note, TPS. */
  const textsAfter = Boolean(item) && !verseStop && !aboutArticle && textsShown.length > 1;
  /** One text of the passage, its quote marked, and what can be done with it. */
  const textRow = (resource: ChecklistText) => {
    if (!data || !item) return null;
              const text = data.texts[resource];
              // A question about verses 22 and 23 is checked against both: with the first alone, «¿se puede
              // responder con los textos?» had no honest answer.
              const verse = item.verseTo
                ? Array.from({ length: item.verseTo - item.verse + 1 }, (_, i) => text?.verses[item.verse + i] ?? "").filter(Boolean).join(" ")
                : (text?.verses[item.verse] ?? "");
              // The item's quote is in the original language: its words in this text come from the alignment.
              const hit = item.quote && verse ? alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: text?.alignments, book: data.book, chapter: item.chapter, verse: item.verse, ...(data.original ? { original: originalTokens(data.original, item.chapter, item.verse) } : {}) }) : null;
              return (
                <div key={resource} className="af-row">
                  {/* Named as the draft is in afinación, «TPL» in its tag. */}
                  {/* The verse it is, in its label: with the note's, which verse each card is of is read at once. */}
                  <span className="af-res ck-res">
                    {textLabel(resource)} · {bookLabel(data.book, language)} {item.chapter}:{item.verse}
                    {item.verseTo ? `–${item.verseTo}` : ""}
                  </span>
                  {verse ? (
                    <Verse
                      text={verse}
                      marked={verseStop ? verseMarks[resource]?.tokenIndices ?? [] : canPick(resource) && picking ? picking : hit?.tokenIndices ?? []}
                      // A word goes with every word tied to the same words of the original: a quote is in the
                      // original, and «los» of «en los días de» alone is no quote (20 October).
                      onToggle={!verseStop && canPick(resource) && picking ? (index) => setPicking(toggleQuoteWord(picking, index, pickVerse?.units ?? [])) : undefined}
                      loose={!verseStop && canPick(resource) && picking && pickVerse?.units.some(Boolean) ? (index) => !pickVerse.units[index] : undefined}
                    />
                  ) : (
                    <span className="af-hint">{t("ck.noText").replace("{text}", textLabel(resource))}</span>
                  )}
                  {/* In a text that says the meaning in other words (the TPS), what is marked comes from the alignment and
                      may be a part of what changed (26 October: «gobernando» was aligned to «se sentaba»). */}
                  {!verseStop && verse && hit?.tokenIndices?.length && texts.indexOf(resource) > 0 ? <span className="af-hint ck-mark-hint">{t("ck.markHint")}</span> : null}
                  {/* At the verse's stop, a text that does not say what the help in view quotes says so. */}
                  {verseStop && verseNote?.quote && verse && !verseMarks[resource]?.tokenIndices.length ? <span className="ck-quote" data-found="false">{t("ck.verseNoteMissing").replace("{text}", textLabel(resource)).replace("{kind}", kindWord)}</span> : null}
                  {/* What the note quotes is seen highlighted: said in words only when it is not found in the text. */}
                  {!verseStop && item.quote && verse && !hit?.gatewayText ? (
                    <span className="ck-quote" data-found={hit?.gatewayText ? "true" : "false"}>
                      {hit?.gatewayText ? t("ck.quoteIs").replace("{quote}", hit.gatewayText) : t("ck.quoteMissing").replace("{text}", textLabel(resource))}
                    </span>
                  ) : null}
                  {verse && !picking ? (
                    // What else can be done with the text, in one row at its foot, as in afinación.
                    <span className="af-draft__acts ck-expand">
                      {canPick(resource) && !stepDone && !verseStop && verseIsAligned(data.texts[resource]?.alignments, item.chapter, item.verse) ? (
                        // A quiet link at the foot of the text: as a button it read as one of the answers.
                        <button type="button" className="af-link ck-quote-fix" onClick={() => setPicking(wholeQuoteWords(hit?.tokenIndices ?? [], pickVerse?.units ?? []))}>
                          {t("ck.quoteFix")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="af-link"
                        aria-label={t("ck.expandAria")}
                        onClick={() => {
                          setPairShown(textsShown.filter((id) => data.texts[id]));
                          setChapterOpen(true);
                        }}
                      >
                        <Maximize2 size={14} aria-hidden /> {t("af.expand")}
                      </button>
                    </span>
                  ) : null}
                  {verseStop ? null : canPick(resource) && verse && !stepDone && !verseIsAligned(data.texts[resource]?.alignments, item.chapter, item.verse) ? (
                    <span className="af-hint">{t("ck.quoteNeedsAlignment")}</span>
                  ) : canPick(resource) && verse && !stepDone ? (
                    picking ? (
                      <span className="af-buttons">
                        <span className="af-hint">{t("ck.quotePickHint")}</span>
                        {/* What would be saved, in the original, as it is marked. */}
                        {pickedQuote ? (
                          <span className="ck-quote-preview">
                            {t("ck.quotePreview")}{" "}
                            <span className="ck-quote-preview__orig" lang={/[\u0590-\u05FF]/.test(pickedQuote.quote) ? "hbo" : "grc"} dir="auto">
                              {pickedQuote.quote}
                            </span>
                          </span>
                        ) : null}
                        <Button type="button" size="sm" disabled={closing || !picking.length} onClick={() => void saveQuote(resource)}>
                          {t("ck.quoteSave")}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={closing} onClick={() => setPicking(null)}>
                          {t("af.cancel")}
                        </Button>
                      </span>
                    ) : null
                  ) : null}
                </div>
              );
  };

  return (
    <div className="af ck">
      <ToolHeader
        title={toolHeading(ctx, language, stepName).title}
        onBack={onClose}
        meta={toolHeading(ctx, language, stepName).where}
      >
        {data ? (
          <div className="af-progress" aria-label={t("ck.progressAria")}>
            <span>{t("ck.nChecked").replace("{a}", String(summary.done)).replace("{n}", String(checkItems.length))}</span>
            <span className="af-bar">
              <i style={{ width: `${checkItems.length ? (summary.done / checkItems.length) * 100 : 0}%` }} />
            </span>
          </div>
        ) : null}
      </ToolHeader>
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx} />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <LoadingState shape="tool" label={t("af.loading")} /> : null}
      {trying ? (
        <p className="ck-trying" role="status">
          {t("ck.trying")}
        </p>
      ) : null}
      {data && missing.length ? (
        <div className="ck-missing" role="status">
          <p className="ck-missing__title">{t("ck.missTitle")}</p>
          <ul>
            {missing.map((row) => (
              <li key={`${row.kind}-${row.resource}`}>{missingText(row)}</li>
            ))}
          </ul>
          {ctx?.issueNumber ? (
            told ? (
              <p className="af-hint">{t("ck.missAlreadyTold")}</p>
            ) : (
              <Button type="button" size="sm" disabled={saving} onClick={() => void tellMissing()}>
                {t("ck.missTell")}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      {data && !questions.length ? <p className="af-stale">{t("ck.noQuestions")}</p> : null}
      {data && !data.items.length ? <p className="hub-hint">{t("ck.noItems")}</p> : null}

      {data && data.items.length ? (
        <section className="round" aria-label={t("ck.standingAria")}>
          {stepDone ? (
            // Opened again once closed: there is nothing left to do here, and the way out is said.
            <div className="round__done round__done--leave">
              <p>{t("ck.stepClosed")}</p>
              <Button type="button" size="lg" variant="outline" onClick={onClose}>
                {t("fa.back")}
              </Button>
            </div>
          ) : summary.complete && closesHere ? (
            <div className="round__ready">
              <p>{t("ck.allChecked")}</p>
              <Button type="button" size="lg" disabled={saving} onClick={() => void closeStep()}>
                {t("ck.closeStep")}
              </Button>
            </div>
          ) : null}
          {(
            [
              ["ck.openList", summary.open],
              ["ck.consultList", summary.consulting],
              ["ck.changedList", summary.changed],
            ] as const
          ).map(([key, rows]) =>
            rows.length ? (
              <details key={key} className="ck-list" data-kind={key}>
                <summary>{t(key).replace("{n}", String(rows.length))}</summary>
                <ul className="round__list">
                  {rows.map((row) => (
                    <li key={row.itemId}>
                      <button type="button" className="round__item" onClick={() => jump(row.itemId)}>
                        <span>{labelOf(row.itemId)}</span>
                        <span className="round__who">
                          {Object.values(row.answers).filter((a) => a?.value === "no").map((a) => a!.note).filter(Boolean).join(" · ")}
                          {Object.values(row.answers).some((a) => replyTo(a)) ? <b> · {t("ck.repliedShort")}</b> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null,
          )}
        </section>
      ) : null}

      {/* Who else is in the subtask now: a line, only when somebody is. */}
      {data && peers.length ? <p className="ck-here">{t("ck.hereNow").replace("{who}", namesOf(peers))}</p> : null}
      {data && listOpen ? (
        <ChapterHelpsList
          title={t(kind === "notas" ? "ck.listTitleNotes" : kind === "palabras" ? "ck.listTitleTerms" : "ck.listTitleQuestions")}
          rows={roster}
          sections={sections}
          labelOf={rosterLabel}
          onOpen={openFromList}
          onNext={goWhereNeeded}
          nothingLeft={nothingLeft}
          presentOn={(itemId) => peersOn(peers, itemId).map((peer) => ({ login: peer.login, name: peer.name, writing: peer.focus?.doing === "writing" }))}
          nameOf={(login) => data.board?.people?.find((person) => person.id.toLowerCase() === login.toLowerCase())?.name ?? login}
        />
      ) : data && item ? (
        <>
          {/* The point's row, as in afinación (19 October): what it is, where, and the way to the next. The count
              was at the foot, in a second bar over the answers. */}
          <div className="af-head ck-head">
            {/* Which help of its verse, of how many: going on to the next note of a verse of eight, the screen was
                the same and only the words of the note changed (20 October). The state chip and a second count
                («1 de 162», beside «0 de 162 comprobados» over it) are gone: three counters, and none of them this. */}
            {/* A touch on where the help is opens the list of the chapter's helps (26 October). */}
            <button type="button" className="af-kind af-kind--top ck-where" onClick={() => setListOpen(true)} aria-label={t("ck.listOpen")}>
              <List size={16} aria-hidden />
              {/* The book is in the header: said here too, it pushed the kind and the verse out of a phone's row. */}
              {verseStop
                ? `${t("ck.kindVerse")} · ${item.chapter}:${item.verse}`
                : (helpsOfVerse.length > 1 ? t("ck.whereOf").replace("{a}", String(helpsOfVerse.indexOf(item.id) + 1)).replace("{b}", String(helpsOfVerse.length)) : "{kind}")
                    .replace("{kind}", t(kind === "notas" ? "ck.kindNote" : kind === "preguntas" ? "ck.kindQuestion" : "ck.kindTerm"))
                    .concat(` · ${item.chapter}:${item.verse}${item.verseTo ? `–${item.verseTo}` : ""}`)}
            </button>
            <span className="af-step ck-arrows">
              {canShare ? (
                <button type="button" className="th-icon ck-share" aria-label={t("ck.shareHelp").replace("{kind}", kindWord)} title={t("ck.shareHelp").replace("{kind}", kindWord)} onClick={() => void shareHelp()}>
                  {linkCopied ? <Check size={20} aria-hidden /> : <Share2 size={20} aria-hidden />}
                </button>
              ) : null}
              {linkCopied ? (
                <span className="ck-share__done" role="status">
                  {t("ck.linkCopied")}
                </span>
              ) : null}
              <button type="button" className="th-icon" aria-label={t("af.prev")} title={t("af.prev")} disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={20} aria-hidden />
              </button>
              <button type="button" className="th-icon" aria-label={t("af.next")} title={t("af.next")} disabled={position >= checkItems.length - 1} onClick={() => setPosition((p) => p + 1)}>
                <ChevronRight size={20} aria-hidden />
              </button>
            </span>
          </div>
          {grouped ? (
            // The steps of the help, before what each puts on screen: under the note and its messages they were
            // found after the texts they choose (19 October). Numbered and joined by a line; each says how it stands.
            <ol className="ck-steps ck-steps--top" aria-label={t("ck.stepsAria")}>
              {groups.map((row, index) => {
                const said = row.rows.map(({ question }) => markHere(question.id));
                // A «no» with nothing done about it shows at once; a step is ticked, or marked as bringing a
                // change, once all of it is answered.
                const state: Mark = said.includes("no") ? "no" : said.includes("wait") ? "wait" : said.includes("none") ? "none" : said.includes("change") ? "change" : "yes";
                return (
                  <li key={row.about} data-state={state}>
                    <button type="button" aria-current={row === group ? "step" : undefined} onClick={() => setAsked({ itemId: item.id, about: row.about })}>
                      <span className="ck-steps__n">{state === "yes" ? <Check size={14} aria-hidden /> : state === "no" ? <X size={14} aria-hidden /> : state === "change" ? <Pencil size={13} aria-hidden /> : state === "wait" ? <Clock3 size={13} aria-hidden /> : index + 1}</span>
                      <span className="ck-steps__name">{scopeLabel(row.about, data.board?.settings?.resourceNames, language)}</span>
                      {state === "wait" ? <span className="sr-only">{t("ck.stepWaiting")}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {collab ? <SituationLine situation={collab} people={people} me={me} nameOf={personName} answered={wroteHere} /> : null}
          {collabHeading === null ? (
            // Asked something, the question comes first; once the points are opened, the proposal is asked about.
            doubting && collab?.kind === "asked" && collab.head ? (
              <h2 className="af-heading ck-heading">{aboutArticle ? t("ck.headProposalArticle").replace("{who}", personName(collab.author ?? collab.head.by)) : t("ck.headProposal").replace("{who}", personName(collab.author ?? collab.head.by)).replace("{text}", against || textLabel(texts[0]!))}</h2>
            ) : null
          ) : (
            <h2 className="af-heading ck-heading">{collabHeading ?? heading}</h2>
          )}
          {!collab || collab.kind === "first" ? <p className="ck-howto">{howTo}</p> : null}
          {/* What is checked in this step, under its heading and before what it is checked on: it is what the step is
              for, and at the foot of the card, in small grey lines, it read as something secondary (20 October). It
              is answered once, at the foot of the screen; what was said of a line is shown on it. */}
          {/* The text first, its quote marked; in the article's step none: the box stayed, empty, over the note (20 October). */}
          {aboutArticle ? null : (
          <section className="af-dock" aria-label={t("ck.textsAria")}>
            {(textsAfter ? textsShown.slice(0, 1) : textsShown).map(textRow)}
          </section>
          )}
          {verseStop && verseNote ? (
            // The helps of the verse one at a time under its texts (Abel, 27 October), each one's quote marked in
            // them: whether a difficulty of the TPL or the TPS is left without a help is seen going over them. They
            // were a list of their quotes under what was checked.
            <section className="af-card ck-vcar" aria-label={t("ck.verseNotesAria")}>
              <div className="ck-vcar__head">
                <p className="ck-vcar__where">
                  {t("ck.whereOf").replace("{kind}", t(kind === "notas" ? "ck.kindNote" : kind === "preguntas" ? "ck.kindQuestion" : "ck.kindTerm")).replace("{a}", String(verseHelps.indexOf(verseNote) + 1)).replace("{b}", String(verseHelps.length))}
                  {kind === "notas" ? <span className="ck-vcar__what"> · {localizeAfinacion(categoryLabel(categoryFromSupportRef(verseNote.supportRef ?? "")), language)}</span> : null}
                </p>
                <span className="ck-arrows">
                  <button type="button" className="th-icon" aria-label={t("ck.verseNotePrev")} title={t("ck.verseNotePrev")} disabled={verseHelps.indexOf(verseNote) <= 0} onClick={() => setVerseNoteAt(verseHelps.indexOf(verseNote) - 1)}>
                    <ChevronLeft size={20} aria-hidden />
                  </button>
                  <button type="button" className="th-icon" aria-label={t("ck.verseNoteNext")} title={t("ck.verseNoteNext")} disabled={verseHelps.indexOf(verseNote) >= verseHelps.length - 1} onClick={() => setVerseNoteAt(verseHelps.indexOf(verseNote) + 1)}>
                    <ChevronRight size={20} aria-hidden />
                  </button>
                </span>
              </div>
              {kind === "palabras" ? (
                <h3 className="af-phrase ck-vcar__title">{titlesRead ? termLabel(verseNote.title, termTitles) : "\u00a0"}</h3>
              ) : kind === "preguntas" ? (
                <h3 className="af-phrase ck-vcar__title">{verseNote.title}</h3>
              ) : verseMarks[texts[0]!]?.gatewayText ? (
                <p className="ck-note-quote__words ck-vcar__quote">«{verseMarks[texts[0]!]!.gatewayText}»</p>
              ) : null}
              {verseNote.body ? <HelpMarkdownView className={kind === "preguntas" ? "af-note af-note--md ck-answer" : "af-note af-note--md"} content={verseNote.body} onLink={openLinkedVerse} /> : null}
              <button type="button" className="af-link ck-vcar__open" onClick={() => jump(verseNote.id)}>
                {t("ck.verseNoteOpen").replace("{kind}", kindWord)}
              </button>
            </section>
          ) : null}
          {!verseStop && !aboutArticle ? (
            // The help, under the text it is checked against (Abel, 21 October: the text first, then the note and what
            // the team said of it, then what to check, over the answer).
            <section className="af-card ck-first" aria-label={t("ck.itemAria")}>
              {/* What the note is about, as the first text says it, over the note in its card (Abel, 21 October): read
                  first, it says what the note explains before the note is read. */}
              {noteQuote ? (
                <p className="ck-note-quote">
                  <span className="ck-chip">{t("ck.noteChip")} · {bookLabel(data.book, language)} {item.chapter}:{item.verse} · <span className="ck-id">{item.id}</span></span> <span className="ck-note-quote__words">«{noteQuote}»</span>
                </p>
              ) : null}
              {proposalShown ?? helpRead}
              {/* Several notes may share words of the quote (Abel, 26 October): one line for them all, read one at a time. */}
              {crossNotes.length ? (
                <button type="button" className="af-link ck-cross" onClick={() => setPeek({ chapter: item.chapter, verse: item.verse, notes: crossNotes.map((other) => other.id) })}>
                  {crossNotes.length === 1 ? t("ck.crossNote").replace("{words}", crossNotes[0]!.words || "…") : t("ck.crossNotes").replace("{n}", String(crossNotes.length))}
                </button>
              ) : null}
            </section>
          ) : null}
          {/* The TPS after the note (Abel, 26 October): the note is what leads from the TPL to the TPS, so it is read
              between them. */}
          {textsAfter ? (
            <section className="af-dock ck-dock-after" aria-label={t("ck.textsAria")}>
              {textsShown.slice(1).map(textRow)}
            </section>
          ) : null}
          {/* Under the note and over the answer: what is answered at the foot, read just before it (21 October).
              Open while its questions are new (the first notes of a step), and whenever something was said of one of
              them here; folded to one line after: the same three questions for 141 notes pushed the note under the
              bar of a phone, and «Sí, seguir» could be touched without the note seen (20 October). */}
          {/* Always open (Abel, 26 October): it is ticked point by point before «Sí, cumple», not read if wanted. */}
          {/* Somebody else on this help now: before answering, so two do not write the same proposal unseen. */}
          {onThis.length ? (
            <p className="ck-on-this" data-writing={writingHere.length ? true : undefined}>
              {writingHere.length
                ? t("ck.writingNow").replace("{who}", namesOf(writingHere)).replace("{kind}", kindWord)
                : t("ck.onThisNow").replace("{who}", namesOf(onThis)).replace("{kind}", kindWord)}
            </p>
          ) : null}
          <section key={`${item.id}|${group?.about ?? ""}`} className="ck-guide" aria-labelledby="ck-guide-title">
            <h3 className="ck-guide__lead" id="ck-guide-title">
              {t("ck.lookAt")}
            </h3>
        <ul className="ck-checks ck-checks--guide" ref={checksRef}>
          {rowsShown.map(({ question }) => {
            const answer = tally?.answers[question.id];
            const proposal = answer?.outcome === "proposal" ? proposals.find((view) => view.proposal.id === answer.proposal?.id) : undefined;
            const name = questionText(question, language, ctx?.lang);
            return (
              <li key={question.id} data-state={markHere(question.id)}>
                {showTicks(question.id) ? (
                  // Still to be answered: «sí» or «no» beside it (26 October). A list of the same questions to say
                  // which failed came after it, and read as the same thing twice.
                  <div className="ck-check ck-check--read ck-check--tick" data-mark={pointMark(question.id)}>
                    <span className="ck-check__mark" aria-hidden="true">
                      {pointMark(question.id) === "yes" ? <Check size={16} /> : pointMark(question.id) === "no" ? <X size={16} /> : null}
                    </span>
                    <span className="ck-check__text">
                      {name}
                      {question.per === "verse" && !verseStop ? <span className="ck-question__scope"> {t("ck.perVerse")}</span> : null}
                      {saidLine(question.id)}
                    </span>
                    <span className="ck-yn" role="group" aria-label={name}>
                      <button type="button" className="ck-yn__b" data-v="yes" aria-pressed={pointMark(question.id) === "yes"} onClick={() => setMark(question.id, "yes")}>
                        {t("ck.markYes")}
                      </button>
                      <button type="button" className="ck-yn__b" data-v="no" aria-pressed={pointMark(question.id) === "no"} onClick={() => setMark(question.id, "no")}>
                        {t("ck.markNo")}
                      </button>
                    </span>
                  </div>
                ) : (
                <span className="ck-check ck-check--read">
                  <span className="ck-check__mark" aria-hidden="true">
                    {markHere(question.id) === "yes" ? <Check size={16} /> : markHere(question.id) === "no" ? <X size={16} /> : markHere(question.id) === "change" ? <Pencil size={14} /> : markHere(question.id) === "wait" ? <Clock3 size={14} /> : <Circle size={6} />}
                  </span>
                  <span className="ck-check__text">
                    {name}
                    {question.per === "verse" && !verseStop ? <span className="ck-question__scope"> {t("ck.perVerse")}</span> : null}
                    {/* Who already said it is right, decided together: the line is theirs too. */}
                    {saidLine(question.id)}
                  </span>
                  <span className="sr-only">{t(markHere(question.id) === "yes" ? "ck.yes" : markHere(question.id) === "change" ? "ck.withChange" : markHere(question.id) === "no" ? "ck.no" : markHere(question.id) === "wait" ? "ck.waitingShort" : "ck.notYet")}</span>
                </span>
                )}
                {/* Decided together, what was proposed is read in the conversation: here only what waits for somebody. */}
                {answer?.value === "no" && (!people || answer.outcome === "consult") ? (
                  <div className="ck-question__outcome" data-outcome={answer.outcome ?? "none"}>
                    {proposal ? (
                      <>
                        <b>{t(PROPOSAL_STATE_KEY[proposal.state]).replace("{team}", teamOf(proposal.proposal.resource))}</b>
                        {proposal.proposal.id === proposedHelp?.proposal.id ? null : (
                          // What is proposed for the help itself is read in the help, above: here, what is about something else.
                          <span className="ag-diff">
                            <b>{proposal.proposal.add ? t("ag.newNote") : scopeLabel(proposal.proposal.resource, data.board?.settings?.resourceNames, language)}:</b> {proposal.proposal.after ? <ProposalDiff before={proposal.proposal.before ?? ""} after={proposal.proposal.after} plain /> : excerpt(proposal.reason)}
                          </span>
                        )}
                        {proposal.state === "open" && proposal.by.toLowerCase() === (session?.username ?? "").toLowerCase() && !stepDone ? (
                          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void withdraw(proposal.proposal.id)}>
                            {t("ck.withdraw")}
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {/* Waiting for an article to be translated is said as that, not as a change asked for. */}
                        {answer.outcome === "consult" && answer.note === articleNote ? t("ck.articleWaitingShort") : answer.outcome ? t(OUTCOME_KEY[answer.outcome]) : t("ck.noOutcome")}
                        {answer.note && answer.note !== articleNote ? `: ${answer.note}` : ""}
                        {replyTo(answer) ? (
                          <span className="ck-question__reply">
                            {t("ck.replied").replace("{who}", replyTo(answer)!.by)} «{replyTo(answer)!.text}»
                          </span>
                        ) : null}
                        {answer.outcome === "consult" && !answer.resolved ? (
                          <Button type="button" size="sm" variant={replyTo(answer) ? "default" : "outline"} disabled={saving} onClick={() => void save([{ ...answer, resolved: true, by: session?.username ?? "", at: new Date().toISOString() }], t("ck.saved"))}>
                            {t("ck.answered")}
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
          </section>
          {/* What the team said, its own card after what to check (Abel, 21 October): the text, the note, what is
              checked of it, and then what the others answered, over the answer this person gives. */}
          {!verseStop && !aboutArticle ? talkView : null}


          {verseStop ? null : (
          <section className="af-card" aria-label={t("ck.itemAria")}>
              <>
            {/* In the article's step the note is what the article is checked for: named, as context. */}
            {aboutArticle && !articleInSource ? <span className="ck-chip">{t("ck.noteChip")}</span> : null}
            {aboutArticle ? (proposalShown ?? helpRead) : null}
            {slug ? articles[slug] === undefined ? <p className="af-hint">{t("ur.readingArticle")}</p> : articles[slug] === null ? <p className="af-hint">{t("ur.noArticle")}</p> : <HelpMarkdownView className="ur-md ur-article ck-article" content={articleBody(articles[slug]!)} /> : null}
            {/* A term is already named by its title above: the path of its article says nothing to who checks it. */}
            {articleInSource ? (
              <p className="ck-untranslated">
                <Info size={16} aria-hidden />{" "}
                <span>{articleTask ? t("ck.articleUntranslatedBy").replace("{task}", localized(articleTask.name, articleTask.names, language)) : t("ck.articleUntranslated")}</span>
              </p>
            ) : null}
            {aboutArticle && !articleInSource && articlePath && articleSeen && academy[articlePath]?.text ? (
              // Read and checked already in this task (whether it is published is asked once per article): a line, and
              // the article a touch away. It was read whole again for each of the sixteen notes that link it.
              <section className="ck-article-card" aria-label={articleTitle}>
                <p className="ck-article-card__head">
                  <span className="ck-chip">{t("ck.articleChip")}</span> <b>{articleTitle}</b>
                </p>
                <HelpMarkdownView className="ur-md ck-article-card__lead" content={articleLead(academy[articlePath]!.text!)} />
                <Button type="button" variant="outline" size="lg" className="ck-article-card__open" onClick={() => setArticleOpen(true)}>
                  <BookOpen size={16} aria-hidden /> {t("ck.articleReadAll")}
                </Button>
                <p className="ck-article-card__who">
                  <Check size={14} aria-hidden />{" "}
                  {articleBy.some(isMe) ? t("ck.articleYouChecked") : t("ck.articleOthersChecked").replace("{who}", articleBy.map((one) => `@${one}`).join(", "))}
                  {people ? ` · ${Math.min(articleBy.length, people)}/${people}` : ""}
                </p>
              </section>
            ) : aboutArticle && !articleInSource && articlePath ? (
              // What is checked in this step, read as in afinación (20 October): named «Artículo», «Borrador» while it
              // is one, the source's beside it to compare, its title, and all of it at the size of reading. It was a
              // fold under the note, in small print, in a box of its own 150 px high. Read whole here, the suggestions
              // of translation too: the translated article is what is checked.
              academy[articlePath] === undefined ? (
                <p className="af-hint">{t("ur.readingArticle")}</p>
              ) : academy[articlePath]?.text ? (
                <section className="ck-article-step" aria-label={articleTitle}>
                  <HelpVersions
                    label={<span className="ck-chip">{t("ck.articleChip")}</span>}
                    team={academy[articlePath]!.where === "draft" || academy[articlePath]!.where === "published" ? { text: academy[articlePath]!.text!, draft: academy[articlePath]!.where === "draft" } : null}
                    source={academySource[articlePath] ?? ""}
                    teamLang={ctx?.lang ?? ""}
                    sourceLang={sourcePackageLang(resolveSourcePackage(data.board?.settings))}
                    draftLabel={t("hv.draft")}
                  >
                    {(text, lang) => (
                      <div lang={lang} className="ck-article-read">
                        <h3 className="ck-article-read__title">{articleTitle}</h3>
                        <HelpMarkdownView className="ur-md ck-article-read__body" content={text} />
                      </div>
                    )}
                  </HelpVersions>
                </section>
              ) : (
                <p className="af-hint">{t("ur.noArticle")}</p>
              )
            ) : grouped && !aboutArticle ? null : articlePath ? (
              // Closed until asked for: an article is several screens long, and the questions come after it.
              <details key={`${item.id}|${aboutArticle}|${articleInSource}`} className="ck-read" open={aboutArticle && !articleInSource}>
                <summary>{articleInSource ? t("ck.articleSourceSummary").replace("{title}", articleTitle) : t("ck.support").replace("{ref}", articleTitle)}</summary>
                {academy[articlePath] === undefined ? (
                  <p className="af-hint">{t("ur.readingArticle")}</p>
                ) : academy[articlePath]?.text ? (
                  <HelpMarkdownView className="ur-md ur-article ck-article" content={academy[articlePath]!.text!} />
                ) : (
                  <p className="af-hint">{t("ur.noArticle")}</p>
                )}
              </details>
            ) : item.supportRef && kind !== "palabras" ? (
              <p className="af-hint">{t("ck.support").replace("{ref}", kind === "notas" ? localizeAfinacion(categoryLabel(categoryFromSupportRef(item.supportRef)), language) : item.supportRef)}</p>
            ) : null}
            {articlePath && academy[articlePath] && !grouped && !articleInSource ? (
              <p className="af-hint ck-read__where" data-where={academy[articlePath]!.where}>
                {t(`ck.article.${academy[articlePath]!.where}` as MessageKey)}
              </p>
            ) : null}
            {session && ctx?.pmOrg && ctx.projectId && data && !aboutArticle && !talkStarted ? (
              // What the teams before this one said about this very help: folded under one line with how many, so
              // the help and what is checked of it keep the attention (19 October). Nothing said, no line.
              <HelpMessages key={item.id} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={messageKey} resource={kind} taskName={ctx.taskName} lede={t("hm.ledeRead")} onlyIfAny canAttend folded foldLabel={t("ck.messagesFold")} />
            ) : null}
            {session && ctx?.pmOrg && ctx.projectId && data && articlePath ? (
              // And what they said about the article this note links to, which this team maintains too.
              <HelpMessages key={`ta:${item.id}`} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={articleMessageKey(articlePath)} resource="academia" taskName={ctx.taskName} lede={t("hm.ledeReadArticle")} onlyIfAny canAttend folded foldLabel={t("ck.messagesFoldArticle")} />
            ) : null}

              </>
          </section>
          )}

          {/* The conversation of the article's step, after the article it is about. */}
          {aboutArticle ? talkView : null}

          {/* One question and its answer, at the foot of the screen: «Sí, seguir» says every line of the step is
              right; «Hay algo que cambiar» asks which, and opens the proposal for it. A note that is missing, or
              something else, is one of the choices: they were a button and a «Proponer un cambio» of their own. */}
          {stepDone ? null : (
            <div className="ck-go" data-on data-choosing={choosing || undefined} data-reply={people ? "true" : undefined}>
              {/* Decided together, the answer is this person's turn in the conversation of the team (26 October). */}
              {people && !choosing ? <p className="ck-go__lead">{t("ck.yourReply")}</p> : null}
              {choosing ? (
                <div className="ck-choose" role="group" aria-labelledby="ck-choose-q">
                  <p id="ck-choose-q" className="ck-ask">{t("ck.whatFails")}</p>
                  <p className="ck-choose__hint">{t("ck.markAll")}</p>
                  {[...rowsShown.map(({ question }) => ({ id: question.id, name: questionText(question, language, ctx?.lang) })), { id: PROPOSAL_FREE, name: t("ck.otherThing") }].map((row) => (
                    <label key={row.id} className="ck-choose__one ck-choose__mark">
                      <input
                        type="checkbox"
                        checked={failing.includes(row.id)}
                        onChange={() => setFailing((prev) => (prev.includes(row.id) ? prev.filter((id) => id !== row.id) : [...prev, row.id]))}
                      />
                      <span>{row.name}</span>
                    </label>
                  ))}
                  <div className="ck-choose__go">
                    <Button type="button" size="lg" disabled={saving || !failing.length} onClick={() => proposeFailing()}>
                      {t("ck.proposeChange")}
                    </Button>
                    <Button type="button" size="lg" variant="ghost" onClick={() => setChoosing(false)}>
                      {t("af.cancel")}
                    </Button>
                  </div>
                  {/* A note that is missing is another kind of proposal: apart, under the choice. */}
                  {kind === "notas" && ours(kind) ? (
                    <button type="button" className="af-link ck-choose__new" disabled={saving} onClick={() => { setChoosing(false); setProposing({ answerItemId: verseStop?.id ?? item.id, questionId: PROPOSAL_FREE, reason: "", newNote: true }); }}>
                      <Plus size={16} aria-hidden /> {t("ck.missingNote").replace("{ref}", `${item.chapter}:${item.verse}`)}
                    </button>
                  ) : null}
                </div>
              ) : (
                articleInSource && pendingHere.length ? (
                <>
                  <p className="ck-ask">{articleTold ? t("ck.articleTold") : t("ck.articleAsk")}</p>
                  <div className="ck-go__buttons">
                    <Button type="button" size="lg" disabled={saving} onClick={() => void waitForArticle()}>
                      {t(articleTold ? "ck.articleWait" : "ck.articleTell")}
                    </Button>
                    <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => { setAsked(null); nextPending(); }}>
                      {t("ck.articleSkip")}
                    </Button>
                  </div>
                </>
                ) : (
                collab && answerMode !== "first" && commenting ? (
                  commentForm
                ) : collab && answerMode && answerMode !== "first" && !decideHere ? (
                  <NoteAnswer
                    mode={answerMode}
                    situation={collab}
                    doubting={doubting}
                    allTicked={tickAll}
                    failing={tickFailing}
                    agreedAlready={agreedAlready}
                    askedBy={collab.kind === "asked" ? personName(collab.by) : undefined}
                    saving={saving}
                    canGoOn={canGoOn}
                    onAgree={() => void agree()}
                    onDoubt={() => setDoubting(true)}
                    onPropose={() => proposeFailing(tickFailing)}
                    onAdjust={() => reviewHead && adjustProposal(reviewHead)}
                    onSayWhat={() => setCommenting(true)}
                    onComment={toThreadBox}
                    onReply={toThreadBox}
                    onCheckToo={() => setDoubting(true)}
                    onChangeMine={() => reviewHead && adjustProposal(reviewHead)}
                    onWithdrawMine={() => reviewHead && void withdrawWhole(reviewHead.proposal.id)}
                    onGoOn={nextStep}
                  />
                ) : decideHere ? (
                  // Days without an agreement: whoever coordinates the team settles it, having read the conversation.
                  <>
                    <p className="ck-ask">{t("ck.decideAsk").replace("{n}", String(DISPUTE_DAYS))}</p>
                    <div className="ck-go__buttons">
                      <Button type="button" size="lg" disabled={saving} onClick={() => void decide(decideHere.proposal.id, true)}>
                        <Check size={16} aria-hidden /> {t("ck.decideApply")}
                      </Button>
                      <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void decide(decideHere.proposal.id, false)}>
                        {t("ck.decideKeep")}
                      </Button>
                    </div>
                  </>
                ) : convoHere ? (
                  // A proposal in conversation: what there is to do about it is done in the conversation. Two
                  // buttons, to take part or to go on; only the second once nothing new was said since (Abel, 21 October).
                  <>
                    <p className={news && !talkOpen ? "ck-ask" : "ck-ask ck-ask--wait"}>{news ? (talkOpen ? t("ck.talkAnswerAbove") : barNews) : t("ck.talkNothingNew").replace("{what}", what)}</p>
                    <div className="ck-go__buttons" data-one={!(news && !talkOpen) || !canGoOn || undefined}>
                      {news && !talkOpen ? (
                        <Button type="button" size="lg" onClick={joinTalk}>
                          <MessageCircle size={16} aria-hidden /> {t("ck.joinTalk")}
                        </Button>
                      ) : null}
                      {canGoOn ? (
                        <Button type="button" size="lg" variant={news && !talkOpen ? "outline" : "default"} onClick={goOn}>
                          {t("ck.goOn")} <ChevronRight size={16} aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : disputeHere && myStand !== "none" ? (
                  // Some are for it and some are not: nobody wins by having more, the two sides talk until they agree.
                  <>
                    <p className="ck-ask">
                      {myStand === "against"
                        ? t("ck.disputeAgainst")
                        : t(disputeHere.against.length > 1 ? "ck.disputeForMany" : "ck.disputeFor").replace("{who}", disputeHere.against.map((who) => `@${who}`).join(", "))}
                    </p>
                    <div className="ck-go__buttons">
                      <Button type="button" size="lg" disabled={saving || stepDone} onClick={answerInTalk}>
                        <MessageCircle size={16} aria-hidden /> {t(myStand === "against" ? "ck.disputeSay" : "ck.disputeAnswer")}
                      </Button>
                      {myStand === "against" ? (
                        <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void voteFor(disputeHere.proposal.id)}>
                          <Check size={16} aria-hidden /> {t("ck.disputeNowYes")}
                        </Button>
                      ) : (
                        <Button type="button" size="lg" variant="outline" disabled={saving || stepDone} onClick={() => adjustProposal(disputeHere)}>
                          <Pencil size={16} aria-hidden /> {t("ck.adjustShort")}
                        </Button>
                      )}
                    </div>
                    <span className="ck-go__more">
                      {myStand === "against" ? (
                        <button type="button" className="af-link ck-choose__new" disabled={saving || stepDone} onClick={() => adjustProposal(disputeHere)}>
                          <Pencil size={16} aria-hidden /> {t("ck.adjust")}
                        </button>
                      ) : (
                        // Persuaded: its author, or one who was for it, comes round to leaving it as it is.
                        <button type="button" className="af-link ck-go__other" disabled={saving} onClick={() => void voteKeep(disputeHere.proposal.id)}>
                          {t("ck.disputeYield")}
                        </button>
                      )}
                    </span>
                  </>
                ) : (
                <>
                  {openHere.length ? (
                    // Somebody proposed a change of what is on screen: what this person thinks of it is what is asked.
                    <p className="ck-ask">
                      {openHere.length > 1
                        ? t("ck.proposalsAsk").replace("{n}", String(openHere.length))
                        : agreedBefore(openHere[0]!)
                          ? t("ck.staleAsk").replace("{n}", String(chainOf(proposals, openHere[0]!.proposal.id).length))
                          : t("ck.proposalAsk").replace("{who}", `@${openHere[0]!.by}`)}
                    </p>
                  ) : pendingHere.length ? (
                    <p className="ck-ask" data-wait={(!allTicked && !commenting) || undefined}>{commenting
                        ? t("ck.sayLead")
                        : !allTicked
                        ? t("ck.tickFirst")
                        : failingHere.length
                          ? t(failingHere.length > 1 ? "ck.failsMany" : "ck.failsOne").replace("{n}", String(failingHere.length))
                        : optionsHere
                          ? t("ck.restAsk")
                          : othersSaid.length
                            ? t(people ? "ck.agreeWithSaid" : "ck.agreeWith").replace("{who}", othersSaid.map((who) => `@${who}`).join(", "))
                            : people && !rowsShown.some(({ question }) => tally?.slots?.[question.id]?.voices.length)
                              ? `${t("ck.firstToReview")} ${asking}`
                              : asking}</p>
                  ) : tally?.agreedApart ? (
                    // Agreed by the team before Taller (see `ITEM_AGREED`): nobody's turn, and nobody is waited for.
                    <p className="ck-ask ck-ask--wait">{t("ck.agreedApart")}</p>
                  ) : people && !summary.complete ? (
                    <p className="ck-ask ck-ask--wait">{t("ck.youSaid")}</p>
                  ) : null}
                  {commenting && item ? (
                    // What is written goes to the conversation of the help, and this person goes on to the next one;
                    // the help stays theirs to answer when the team replies or the doubt is cleared.
                    commentForm
                  ) : (
                  <div className="ck-go__buttons">
                    {openHere.length === 1 ? (
                      <>
                        <Button type="button" size="lg" disabled={saving} onClick={() => void voteFor(openHere[0]!.proposal.id)}>
                          <Check size={16} aria-hidden /> {t(agreedBefore(openHere[0]!) ? "ck.staleYes" : "ck.voteFor")}
                        </Button>
                        <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void voteKeep(openHere[0]!.proposal.id)}>
                          {t("ck.voteKeep")}
                        </Button>
                      </>
                    ) : pendingHere.length && allTicked && failingHere.length ? (
                      <Button type="button" size="lg" disabled={saving} onClick={() => proposeFailing(failingHere)}>
                        <Pencil size={16} aria-hidden /> {t("ck.proposeChange")}
                      </Button>
                    ) : pendingHere.length ? (
                      <Button type="button" size="lg" disabled={saving || !allTicked} onClick={allGood}>
                        <Check size={16} aria-hidden /> {t(collab?.kind === "first" ? "ck.ansAllGood" : optionsHere ? "ck.restYes" : othersSaid.length ? "ck.agreeYes" : verseStop ? "ck.verseYes" : pendingHere.length < rowsShown.length ? "ck.restGood" : "ck.yesGo")}
                      </Button>
                    ) : !summary.complete ? (
                      <Button type="button" size="lg" onClick={nextPending}>
                        {t(people ? "ck.nextMine" : "ck.nextPending")}
                      </Button>
                    ) : closesHere ? (
                      <Button type="button" size="lg" disabled={saving} onClick={() => void closeStep()}>
                        {t("ck.closeStep")}
                      </Button>
                    ) : null}
                    {openHere.length === 1 || pendingHere.length ? null : (
                      <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => setChoosing(true)}>
                        {t(verseStop ? "ck.verseMissing" : "ck.somethingWrong")}
                      </Button>
                    )}
                    {people && pendingHere.length && openHere.length !== 1 ? (
                      // A doubt, or a «no» with no change in mind: said to the team, and on to the next help.
                      <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => setCommenting(true)}>
                        <MessageCircle size={16} aria-hidden /> {t("ck.sayButton")}
                      </Button>
                    ) : null}
                  </div>
                  )}
                  {pendingHere.length && openHere.length !== 1 && item && !commenting ? (
                    // What the list does not ask: something else, or a note that is missing.
                    <span className="ck-go__more">
                      <button type="button" className="af-link" disabled={saving} onClick={() => setProposing({ answerItemId: verseStop?.id ?? item.id, questionId: PROPOSAL_FREE, reason: "" })}>
                        {t("ck.otherToChange")}
                      </button>
                      <button type="button" className="af-link" disabled={saving} onClick={() => setProposing({ answerItemId: verseStop?.id ?? item.id, questionId: PROPOSAL_FREE, reason: "", newNote: true })}>
                        <Plus size={16} aria-hidden /> {t("ck.noteMissing").replace("{ref}", `${item.chapter}:${item.verse}`)}
                      </button>
                    </span>
                  ) : null}
                  {openHere.length === 1 ? (
                    // Edit it, which is what a conversation does: another proposal beside it was another document to
                    // compare, written differently each time (21 October).
                    <span className="ck-go__more">
                      <button type="button" className="af-link ck-choose__new" disabled={saving} onClick={() => adjustProposal(openHere[0]!)}>
                        <Pencil size={16} aria-hidden /> {t("ck.adjust")}
                      </button>
                    </span>
                  ) : null}
                </>
                )
                )
              )}
            </div>
          )}
        </>
      ) : null}
      {/* The whole article, from its card (21 October): read in a sheet, at the size of reading. */}
      <Dialog open={articleOpen && Boolean(articlePath && academy[articlePath]?.text)} onOpenChange={setArticleOpen}>
        <DialogContent className="fix-sheet help-sheet ck-article-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{articleTitle}</DialogTitle>
          </header>
          <div className="fx-body">
            {articlePath && academy[articlePath]?.text ? <HelpMarkdownView className="ur-md ck-article-read__body" content={academy[articlePath]!.text!} /> : null}
          </div>
        </DialogContent>
      </Dialog>
      {/* Another note of the verse, or a verse the note sends to, read as the note in view is: each text with what
          the note there quotes marked, and the note between them; and back to the note being checked. */}
      {(() => {
        if (!peek || !data || !item) return null;
        const pool = data.bookNotes ?? data.items;
        const notes = peek.notes.map((id) => pool.find((row) => row.id === id) ?? data.items.find((row) => row.id === id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
        const ref = `${bookLabel(data.book, language)} ${peek.chapter}:${peek.verse}`;
        // One note at a time, and the marks are the ones of the note read.
        const at = Math.max(0, Math.min(peek.at ?? 0, notes.length - 1));
        const shown = notes[at];
        const verseOf = (resource: ChecklistText) => {
          const text = data.texts[resource];
          return (peek.chapter === data.chapter ? text?.verses : text?.chapterVerses?.(peek.chapter))?.[peek.verse] ?? "";
        };
        // What is marked: what the note there quotes; with none, the words of the note in view, if they are there.
        const markedIn = (resource: ChecklistText, verse: string) => {
          const by = shown ?? { quote: item.quote, occurrence: 1 };
          if (!by.quote || !verse) return { tokenIndices: [] as number[], gatewayText: "" };
          const hit = alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: by.quote, occurrence: by.occurrence ?? 1, alignments: data.texts[resource]?.alignments, book: data.book, chapter: peek.chapter, verse: peek.verse, ...(data.original ? { original: originalTokens(data.original, peek.chapter, peek.verse) } : {}) });
          return { tokenIndices: hit.tokenIndices ?? [], gatewayText: hit.gatewayText ?? "" };
        };
        const row = (resource: ChecklistText) => {
          const verse = verseOf(resource);
          return (
            <div key={resource} className="af-row">
              <span className="af-res ck-res">
                {textLabel(resource)} · {ref}
              </span>
              {verse ? <Verse text={verse} marked={markedIn(resource, verse).tokenIndices} /> : <span className="af-hint">{t("ck.noText").replace("{text}", textLabel(resource))}</span>}
            </div>
          );
        };
        const firstVerse = verseOf(texts[0]!);
        return (
          <Dialog open onOpenChange={(open) => (open ? null : setPeek(null))}>
            <DialogContent className="fix-sheet help-sheet ck-peek-sheet" aria-describedby={undefined}>
              <header className="fx-head">
                <DialogTitle className="fx-title">{peek.linked ? t("ck.peekLinkedTitle").replace("{ref}", ref) : t(notes.length > 1 ? "ck.peekTitleMany" : "ck.peekTitle")}</DialogTitle>
              </header>
              <div className="fx-body ck-peek">
                {notes.length > 1 ? (
                  <div className="ck-peek__pager">
                    <p className="af-kind">{t("ck.whereOf").replace("{kind}", t("ck.kindNote")).replace("{a}", String(at + 1)).replace("{b}", String(notes.length))}</p>
                    <span className="af-step ck-arrows">
                      <button type="button" className="th-icon" aria-label={t("af.prev")} title={t("af.prev")} disabled={at <= 0} onClick={() => setPeek({ ...peek, at: at - 1 })}>
                        <ChevronLeft size={20} aria-hidden />
                      </button>
                      <button type="button" className="th-icon" aria-label={t("af.next")} title={t("af.next")} disabled={at >= notes.length - 1} onClick={() => setPeek({ ...peek, at: at + 1 })}>
                        <ChevronRight size={20} aria-hidden />
                      </button>
                    </span>
                  </div>
                ) : null}
                <div className="ck-peek__card">
                  {row(texts[0]!)}
                  {(shown ? [shown] : []).map((other) => {
                    const words = firstVerse && other.quote ? alignedGatewayQuoteForHelpQuote({ verseText: firstVerse, quote: other.quote, occurrence: other.occurrence ?? 1, alignments: data.texts[texts[0]!]?.alignments, book: data.book, chapter: other.chapter, verse: other.verse, ...(data.original ? { original: originalTokens(data.original, other.chapter, other.verse) } : {}) }).gatewayText ?? "" : "";
                    return (
                      <section key={other.id} className="ck-peek__note">
                        <p className="ck-note-quote">
                          <span className="ck-chip">{t("ck.noteChip")} · {ref}</span>
                          {words ? <span className="ck-note-quote__words">«{words}»</span> : null}
                        </p>
                        <HelpMarkdownView className="af-note af-note--md" content={other.body} onLink={openLinkedVerse} />
                      </section>
                    );
                  })}
                  {texts.slice(1).map(row)}
                </div>
                <Button type="button" size="lg" variant="outline" onClick={() => setPeek(null)}>
                  {t("ck.peekBack")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
      <Dialog open={chapterOpen && Boolean(item && data)} onOpenChange={setChapterOpen}>
        <DialogContent className="fix-sheet af-pair-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            {chapterOpen && data ? (
              <div className="af-ref__bar af-pair-bar">
                {/* Each text is touched to add it or take it away; one is always read. */}
                <div className="af-ref__texts" role="group" aria-label={t("cr.sideLabel")}>
                  {chapterTexts.map((row) => {
                    const shown = pairShown.includes(row.key);
                    return (
                      <button key={row.key} type="button" aria-pressed={shown} disabled={shown && pairShown.length <= 1} onClick={() => setPairShown(shown ? pairShown.filter((id) => id !== row.key) : chapterTexts.map((other) => other.key).filter((id) => id === row.key || pairShown.includes(id)))}>
                        {row.text.label}
                      </button>
                    );
                  })}
                </div>
                <MoreMenu items={[]} bare />
              </div>
            ) : null}
          </header>
          <div className="fx-body af-pair-sheet__body">
            <DialogTitle className="sr-only">{data && item ? `${bookLabel(data.book, language)} ${item.chapter}` : ""}</DialogTitle>
            {chapterOpen && data && item ? <h3 className="af-pair-title ck-pair-title">{`${bookLabel(data.book, language)} ${item.chapter}`}</h3> : null}
            {chapterOpen && data && item ? (
              <ChapterPair
                chapter={item.chapter}
                verse={item.verse}
                texts={chapterTexts.filter((row) => pairShown.includes(row.key)).map((row) => row.text)}
                renderVerse={(text, key, body) => {
                  // What the help quotes, marked in the verse it is about, in each text of the step.
                  const resource = texts.find((id) => id === chapterTexts.find((row) => row.text === text)?.key);
                  if (key !== `${item.chapter}:${item.verse}` || !resource || !item.quote) return body;
                  const hit = alignedGatewayQuoteForHelpQuote({ verseText: body, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: data.texts[resource]?.alignments, book: data.book, chapter: item.chapter, verse: item.verse, ...(data.original ? { original: originalTokens(data.original, item.chapter, item.verse) } : {}) });
                  return hit.tokenIndices?.length ? <Verse text={body} marked={hit.tokenIndices} /> : body;
                }}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <ProposalSheet
        open={Boolean(proposing)}
        onClose={() => setProposing(null)}
        targets={proposing?.adjust ? targets.filter((target) => target.resource === proposing.adjust!.proposal.resource && (target.rowId ?? "") === (proposing.adjust!.proposal.rowId ?? "") && (target.path ?? "") === (proposing.adjust!.proposal.path ?? "")).concat(targets).slice(0, 1) : targets}
        startFrom={proposing?.adjust?.proposal.after}
        lead={proposing?.adjust && people && !isMe(authorOfOption(proposing.adjust)) ? t("pr.adjustingOf").replaceAll("{who}", `@${authorOfOption(proposing.adjust)}`) : proposing?.adjust ? t("pr.adjusting").replace("{n}", String(chainOf(proposals, proposing.adjust.proposal.id).length)).replace("{who}", isMe(proposing.adjust.by) ? t("ck.talkYou") : `@${proposing.adjust.by}`) : undefined}
        // What the step reads the help against, beside the help: in the TPL's step the note, or the TPL itself, may be
        // what needs the change.
        primary={aboutArticle ? ["article", "help"] : group?.about && texts.includes(group.about as ChecklistText) ? ["help", group.about] : undefined}
        startSplit={proposing?.adjust ? proposing.adjust.proposal.split?.after : proposedHelp?.proposal.split?.after} failed={proposing?.reason || undefined} rule={data?.task ? stepPurpose(data.task.id, data.step ?? undefined, language).criterion : undefined} reason="" book={data?.book} saving={saving} address={helpsAddressOf(ctx?.pmOrg)} onSend={(draft) => void sendProposal(draft)} />
    </div>
  );
}
