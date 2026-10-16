import { termAsk } from "../domain/afinacionWords";
import { openTextProposal } from "../dcs/alignmentDecisionStore";
import { toolHeading } from "./toolHeading";
import { ToolHeader } from "./ToolHeader";
import { PassageIntroText, StepAsk } from "./StepAsk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSession, type GtSession } from "../dcs/auth";
import { draftTaskId, loadAfinacionNotes, loadArticleBody, loadArticleInfo, loadTermArticle, loadTermTitles, type AfinacionNotesData, type AfinacionStep, type OriginalWord } from "../dcs/afinacionLoad";
import { tallerConfig, workspaceOfOrg } from "../config";
import { isRtl, OriginalWords } from "./OriginalWords";
import { ParallelLink } from "./ParallelSheet";
import { WordSheet } from "./WordSheet";
import { ReasonField } from "./ReasonField";
import { appendMyDecision, appendMyDecisions, loadDecisionFiles, savePreferredTerm, saveCorrection } from "../dcs/afinacionStore";
import type { CorrectionReason } from "../domain/correctionLog";
import { CorrectionReasons, reasonLine, VerseCorrections } from "./CorrectionReasons";
import { commentOnIssue } from "../dcs/issues";
import { refComment, whileOpen } from "../domain/commentPlace";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { articleName, articlePathOf, articleShortName, groupByCategory, type ArticleInfo, type NoteItem } from "../domain/afinacionNotes";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { HelpMessages } from "./HelpMessages";
import { articleMessageKey, termMessageKey } from "../domain/studyNotes";
import { articleBody, compareTermRenderings, firstUnanswered, orderTermUses, renderingsElsewhere, sameRenderingUses, termDefinition, termLabel, type PreferredTerms, type TermItem, type TermOrder } from "../domain/afinacionWords";
import { selectionFromWords, selectionWindow, shownWords, wordSpans, wordsOfSelection } from "../domain/afinacionSelection";
import { WordPicker } from "./WordPicker";
import { askRedoAfterCorrection, redoSaid } from "../dcs/redoAfterCorrection";
import { alignedGatewayQuoteForHelpQuote, matchHelpQuoteToTokenIndices, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import {
  changedStretch,
  mergeDecisionFiles,
  reviewersToNotifyAfterEdit,
  standingAnswers,
  summarizeRound,
  tallyItem,
  textFingerprint,
  withAnswersGivenHere,
  type ReviewDecision,
  type ReviewStance,
} from "../domain/reviewRound";
import { tcCheckerOf } from "../domain/tcImport";
import { canConfirmForTeam, confirmersOf, coordinatorsOf, countsForMinimum, levelLabel, levelOf, levelsForTeam, meetsLevel } from "../domain/levels";
import { closesInItsTool } from "../domain/stepClaim";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { deliverSharedSubtask } from "../dcs/deliverShared";
import { useStepWork } from "../dcs/stepWork";
import { FinalDecision, RoundPanel } from "./RoundPanel";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage, sourcePackageLang } from "../domain/sourcePackage";
import { stepPurpose } from "../domain/processes";
import { localizeName } from "../domain/templateNames";
import type { ProjectTask } from "../domain/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { localizeAfinacion } from "../domain/afinacionNames";
import { explainError } from "../dcs/userError";
import { LoadingState } from "./LoadingState";

type Props = {
  ctxEncoded: string;
  /** `notas` or `palabras`. */
  step?: AfinacionStep;
  onClose: () => void;
  announce: (msg: string) => void;
  /** Open the conversation of the subtarea: where a point the team does not agree on is talked over. */
  onOpenThread?: (issue: number) => void;
};

const STANCE_KEY: Record<ReviewStance, MessageKey> = {
  approved: "rv.approved",
  revise: "rv.revise",
  rejected: "rv.rejected",
};

const QUESTION: Record<AfinacionStep, Record<"tpl" | "tps", MessageKey>> = {
  notas: { tpl: "af.qNotasTpl", tps: "af.qNotasTps" },
  palabras: { tpl: "af.qPalabrasTpl", tps: "af.qPalabrasTps" },
};

const TITLE: Record<AfinacionStep, MessageKey> = { notas: "af.titleNotas", palabras: "af.titlePalabras" };

/** Whether the point lays out in two columns: the width its styles turn at. */
const WIDE = "(min-width: 1024px)";
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const look = () => setWide(media.matches);
    look();
    media.addEventListener("change", look);
    return () => media.removeEventListener("change", look);
  }, []);
  return wide;
}


function Words({ text, marked, onTap, selected }: { text: string; marked?: number[]; onTap?: (i: number) => void; selected?: number[] }) {
  const t = useT();
  const words = wordSpans(text);
  if (!words.length) return <span className="af-empty">{t("af.noText")}</span>;
  return (
    <span className="af-words" dir={isRtl(text) ? "rtl" : undefined}>
      {words.map((w) =>
        onTap ? (
          <button
            key={w.index}
            type="button"
            className="af-word af-word--tap"
            data-selected={selected?.includes(w.index) ? "true" : undefined}
            aria-pressed={selected?.includes(w.index) ? true : false}
            onClick={() => onTap(w.index)}
          >
            {w.text}
          </button>
        ) : (
          <span key={w.index} className="af-word" data-marked={marked?.includes(w.index) ? "true" : undefined}>
            {w.text}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * «Revisar notas» of a Afinación: every translation note of the chapter, one at
 * a time, with the original and the draft always in view. The reviewer marks
 * the words of the draft that render the note and answers; anyone may also
 * correct the verse at any moment, which makes earlier answers to it stale.
 */
export function AfinacionView({ ctxEncoded, step: stepProp = "notas", onClose, announce, onOpenThread }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const stanceLabel = (status: string) => t(STANCE_KEY[status as ReviewStance] ?? "rv.approved");
  const [session] = useState<GtSession | undefined>(() => loadSession());
  /** The word of the original whose meaning is open, and the verse it is of. */
  const [sheetWord, setSheetWord] = useState<{ word: OriginalWord; chapter: number; verse: number } | null>(null);
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<AfinacionNotesData | null>(null);
  // What each person answered, as their files have it; `decisions` is how it stands over the text of today.
  const [given, setDecisions] = useState<ReviewDecision[]>([]);
  /** Everyone's answers have been read once: until then a point looks unanswered, and must not be opened as such. */
  const [answersRead, setAnswersRead] = useState(false);
  /** The answer of this person is shown, not its buttons, until they choose to change it. */
  const [changing, setChanging] = useState(false);
  /** A closed point opened again by this person, to object to it. */
  const [reopened, setReopened] = useState(false);
  /** The whole note, on a phone: a long one pushed the verse below the screen. */
  /** Side by side: the width the styles of this screen turn at, where the note has a column of its own. */
  const wide = useWide();
  /** The note or the definition shown on the point, as this person left it last (a per-device convenience). */
  const [foldedPref, setShowReason] = useState(() => {
    try {
      return localStorage.getItem("taller-af-reason") === "1";
    } catch {
      return false;
    }
  });
  // Folded only where it takes the place of the work (a phone); on a wide screen it has its column, which folded
  // stood empty beside the work.
  const showReason = wide || foldedPref;
  const toggleReason = (shown: boolean) => {
    setShowReason(shown);
    try {
      localStorage.setItem("taller-af-reason", shown ? "1" : "0");
    } catch {
      /* private window: shown for this visit only */
    }
  };
  /** The whole article of the note or the term, in a sheet over the point. */
  const [articleOpen, setArticleOpen] = useState(false);
  const decisions = useMemo(
    () =>
      standingAnswers(given, (d) => {
        const at = d.ref?.start;
        if (!data || !at) return undefined;
        return at.chapter === data.chapter ? data.draftVerses[at.verse] : data.bookDraft[`${at.chapter}:${at.verse}`];
      }),
    [given, data],
  );
  const [task, setTask] = useState<ProjectTask | null>(null);
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof loadAssignmentsFromDcs>> | null>(null);
  /** The subtarea was delivered here, with the closing of its last step. */
  const [delivered, setDelivered] = useState(false);
  const [category, setCategory] = useState("all");
  const [position, setPosition] = useState(0);
  // Key terms are gone through term by term unless the person asks for the order of the text.
  const [order, setOrder] = useState<TermOrder>("term");
  const [openedAt, setOpenedAt] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<ReviewStance | null>(null);
  /** «Otra respuesta» was pressed: the two other answers are offered in the card. */
  const [choosing, setChoosing] = useState(false);
  /** Step 2: the words of the translation are confirmed; what is asked now is whether they keep the rule. */
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixText, setFixText] = useState("");
  const [fixReason, setFixReason] = useState("");
  const [fixReasons, setFixReasons] = useState<CorrectionReason[]>([]);
  const [preferredTerms, setPreferredTerms] = useState<PreferredTerms>({});
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});
  /** The titles were asked for and came (or could not be read): until then a term has no name to show. */
  const [titlesRead, setTitlesRead] = useState(false);
  const [articles, setArticles] = useState<Record<string, ArticleInfo>>({});
  /** How many messages each note has for the team that will work on the notes. */
  const [noteMessages, setNoteMessages] = useState<Record<string, number>>({});
  /** What the draft is compared with, kept from one item to the next. */
  /** The help or context open under the answer: the article, the note, the renderings in the book. */
  const [compare, setCompare] = useState<"article" | "note" | "book">("article");
  /** The text the draft is read against: the original unless the person chose another. */
  const [refText, setRefText] = useState<"orig" | "ult" | "ust">("orig");
  /** «Revisar» (the item in hand) or «Capítulo» (whole chapters of a text, to read around it). */
  const [pane, setPane] = useState<"review" | "helps" | "chapter" | "intro">("review");
  const [readChapter, setReadChapter] = useState(0);
  /** The text read in «Leer el capítulo»: the original, an English text, or what the team's draft has so far. */
  const [chapterText, setChapterText] = useState<"orig" | "ult" | "ust" | "draft">("orig");
  /** The article open to be read in full: its path, and its text once it arrives (`null` = it could not be read). */
  const [reading, setReading] = useState<{ path: string; body?: string | null } | null>(null);
  const [stepDone, setStepDone] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError(tNow("af.badLink"));
      return;
    }
    setCtx(decoded);
    if (!session?.token) {
      setError(tNow("af.expired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const board = await loadAssignmentsFromDcs(session, decoded.pmOrg, decoded.lang, decoded.projectId, decoded.contentOrg);
      const found = board?.teams.find((t) => t.id === decoded.taskId) ?? null;
      // Whose levels count: the task's team, or without one, the team of its phase (the tasks of a phase share it).
      const phaseTeam = found && !found.orgTeamName ? board?.teams.find((t) => t.phaseId === found.phaseId && t.orgTeamName)?.orgTeamName : undefined;
      const thisTask = found && phaseTeam ? { ...found, orgTeamName: phaseTeam } : found;
      setTask(thisTask);
      setPlan(board ?? null);
      // The text read is the one its translation task writes, wherever this task stands in the phase.
      const sourceTaskId = (board && draftTaskId(board.teams, decoded.resource)) || thisTask?.waitsFor?.find((w) => w.taskId)?.taskId;
      if (!sourceTaskId) {
        throw new Error(tNow("af.noSource"));
      }
      const loaded = await loadAfinacionNotes({ session, ctx: decoded, sourceTaskId, step: stepProp, pkg: resolveSourcePackage(board?.settings), board });
      setData(loaded);
      setPreferredTerms(loaded.preferredTerms);
      const files = await loadDecisionFiles(session, { owner: loaded.draft.owner, repo: loaded.draft.repo, branch: loaded.draft.branch }, loaded.book);
      setDecisions(mergeDecisionFiles(files));
      setAnswersRead(true);
    } catch (err) {
      setError(err instanceof Error ? localizeThread(err.message, language) : String(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session, stepProp]);

  useEffect(() => {
    void load();
  }, [load]);

  // What the others answer while the screen is open: on coming back to it, and every so often while it is in sight.
  // The files were read once, on opening, and two people answered the same point of Ezra 4:1 a quarter of an hour
  // apart without seeing each other (16 October).
  useEffect(() => {
    if (!session || !data) return;
    const target = { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch };
    let reading = false;
    const reread = () => {
      if (reading || document.visibilityState !== "visible") return;
      reading = true;
      void loadDecisionFiles(session, target, data.book)
        .then((files) => setDecisions((had) => withAnswersGivenHere(mergeDecisionFiles(files), had)))
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    };
    const timer = window.setInterval(reread, 45_000);
    window.addEventListener("focus", reread);
    document.addEventListener("visibilitychange", reread);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", reread);
      document.removeEventListener("visibilitychange", reread);
    };
  }, [session, data]);

  // The article titles arrive after the screen is up. Until then a term showed its address spelled out («Know»),
  // and when the title came («Conocer, conocimiento, desconocido, distinguir») everything under it moved down a
  // line, buttons included, under the finger.
  useEffect(() => {
    if (!session?.token || !data || data.step !== "palabras" || !data.termUses.length) return;
    let cancelled = false;
    void loadTermTitles(session, data.sourcePackage, data.termUses, ctx)
      .then((titles) => !cancelled && setTermTitles(titles))
      .catch(() => undefined)
      .finally(() => !cancelled && setTitlesRead(true));
    return () => {
      cancelled = true;
    };
  }, [session, data?.step, data?.termUses]);

  // The Academy articles the notes point to: what each figure is called, and what the article answers.
  useEffect(() => {
    if (!session?.token || !ctx || !data || data.step !== "notas" || !data.items.length) return;
    let cancelled = false;
    void loadArticleInfo(session, ctx, data.sourcePackage, data.items.map((note) => articlePathOf(note.supportRef)), { teamFirst: "published" })
      .then((found) => !cancelled && setArticles(found))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, data?.step, data?.items]);

  const nameOf = (note: Pick<NoteItem, "category" | "categoryLabel" | "supportRef">) => articleName(note, articles[articlePathOf(note.supportRef)], (label) => localizeAfinacion(label, language));

  async function readArticle(path: string) {
    if (!session || !ctx || !data) return;
    if (reading?.path === path && reading.body !== undefined) return;
    setReading({ path });
    const body = await loadArticleBody(session, ctx, data.sourcePackage, path, { teamFirst: "published" }).catch(() => null);
    setReading((current) => (current?.path === path ? { path, body } : current));
  }

  const groups = useMemo(() => (data ? groupByCategory(data.items) : []), [data]);
  const visible = useMemo(() => {
    const shown = groups.filter((g) => category === "all" || g.category === category).flatMap((g) => g.items);
    return stepProp === "palabras" ? (orderTermUses(shown as TermItem[], order) as NoteItem[]) : shown;
  }, [groups, category, order, stepProp]);
  const item: NoteItem | undefined = visible[Math.min(position, Math.max(visible.length - 1, 0))];

  const taskStep = task?.steps?.find((s) => s.id === (ctx?.stepId || stepProp));
  /** What the step is for and the rule it measures against, as the process says them. */
  const said = stepPurpose(task?.id ?? ctx?.taskId ?? "", taskStep, language);
  const heading = toolHeading(ctx, language, t(TITLE[stepProp]));
  const taskLabel = ctx?.taskName ? localizeName(ctx.taskName, language) : "";
  /** How the round is answered, line by line, for the welcome. */
  const roundSteps = (said.description ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  /** «Sobre esta tarea», opened from the header or the welcome. */
  const [aboutOpen, setAboutOpen] = useState(false);
  /** Whether this person has seen the welcome of this task on this device. */
  const welcomeKey = `taller-af-welcome:${ctx?.taskId ?? ""}`;
  const [welcomed, setWelcomed] = useState(true);
  useEffect(() => {
    try {
      setWelcomed(localStorage.getItem(welcomeKey) === "1");
    } catch {
      setWelcomed(false);
    }
  }, [welcomeKey]);
  const dismissWelcome = () => {
    setWelcomed(true);
    try {
      localStorage.setItem(welcomeKey, "1");
    } catch {
      /* private window: seen for this visit only */
    }
  };
  // Who counts for the minimum is decided by the levels of this task's team.
  const teamLevels = useMemo(() => levelsForTeam(data?.levelBook, task?.orgTeamName), [data?.levelBook, task?.orgTeamName]);
  const thresholds = { minAgree: taskStep?.minAgree ?? taskStep?.minAssignees ?? 3, minIndependent: taskStep?.minIndependent ?? 2 };
  /** The first step of a task: one person answers every item; the step is theirs, and ends when nothing is left. */
  const reviewing = taskStep?.closing === "automatic" && taskStep.claimMode === "exclusive";
  const me = (session?.username ?? "").toLowerCase();
  // The team's final decision on a disputed item: its coordinator or a persona habilitada of the team.
  const confirmers = useMemo(() => confirmersOf(data?.levelBook, task?.orgTeamName), [data?.levelBook, task?.orgTeamName]);
  const canConfirm = Boolean(session) && canConfirmForTeam(data?.levelBook, task?.orgTeamName, me);
  const closesHere = Boolean(taskStep && closesInItsTool(taskStep) && ctx?.issueNumber);
  const verseText = item ? data?.draftVerses[item.verse] ?? "" : "";
  const hash = textFingerprint(verseText);

  const tally = item && data
    ? tallyItem({ itemId: item.id, decisions, currentHash: hash, levels: teamLevels, authors: [], thresholds, confirmers })
    : null;
  const mine = tally?.answers.find((a) => a.reviewer.trim().toLowerCase() === me);
  // The decision of the team is said once, as such, and not also as the answer of whoever registered it.
  // In the order they were given: whoever proposed something first, then whoever agreed with them.
  const others = (tally?.answers ?? []).filter((a) => a.reviewer.trim().toLowerCase() !== me && !(a.final && tally?.decided)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  /** The first proposal and the first objection: the ones that can be seconded. Under «De acuerdo con @ana» there was a second «Pienso lo mismo». */
  const firstOf = (status: string) => others.find((a) => a.status === status && a.note);
  const staleMine = tally?.stale.find((a) => a.reviewer.trim().toLowerCase() === me);
  /** What the others had answered before the verse was corrected. */
  const saidBefore = (tally?.stale ?? []).filter((a) => a.reviewer.trim().toLowerCase() !== me);
  /**
   * Everybody's answer on the point, this person's among them: Miguel agreed, went on, came back, and did not find
   * his «De acuerdo» where the team's are listed, so it looked as if he had done nothing (16 October).
   */
  const listed = [...others, ...(mine && !(mine.final && tally?.decided) ? [mine] : [])]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    // One check of translationCore brought over twice, by two people, is still one answer.
    .filter((a, at, all) => !tcCheckerOf(a) || all.findIndex((b) => tcCheckerOf(b) === tcCheckerOf(a) && b.status === a.status) === at);
  /** Who said it: «Tú»; whoever checked it in translationCore, for an answer brought from there; or the login. */
  const whoSaid = (a: ReviewDecision) => {
    if (a.reviewer.trim().toLowerCase() === me) return t("af.you");
    const checker = tcCheckerOf(a);
    return checker ? t("af.inTc").replace("{who}", `@${checker}`) : `@${a.reviewer}`;
  };
  /** The others who agree with the words on the point as it is now: this person is asked whether they do too. */
  const agreeing = others.filter((a) => a.status === "approved").map((a) => tcCheckerOf(a) ?? a.reviewer);
  /** The point is shown closed, with the one way to open it again; the team's box then only says who answered. */
  const closedView = Boolean(tally?.decided) && !reopened && !fixing;
  /**
   * Everybody who answered agrees, with nothing more said: no objection, no other words, nobody asked to answer,
   * nothing said before a correction. It is said in the line over the buttons, with how many agree.
   */
  const plainAgreement =
    Boolean(tally) && !tally?.decided && !closedView && !saidBefore.length && !tally?.open.length && listed.every((a) => a.status === "approved" && (!a.note || Boolean(tcCheckerOf(a))));
  /** «1 de 3 de acuerdo», or «Acordado · 3 de acuerdo». */
  const agreeCount = tally ? (tally.state === "agreed" ? t("af.teamAgreed").replace("{n}", String(tally.agree)) : t("af.agreeCount").replace("{n}", String(tally.agree)).replace("{of}", String(thresholds.minAgree))) : "";

  const summary = useMemo(
    () =>
      data
        ? summarizeRound({
            itemIds: data.items.map((i) => i.id),
            decisions,
            currentHashes: Object.fromEntries(data.items.map((i) => [i.id, textFingerprint(data.draftVerses[i.verse] ?? "")])),
            levels: teamLevels,
            authors: [],
            thresholds,
            confirmers,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, decisions, thresholds.minAgree, thresholds.minIndependent, teamLevels, confirmers],
  );
  /** The points closed already, by the team or in translationCore: nobody is taken to them to answer. */
  const settled = useMemo(() => new Set((summary?.items ?? []).filter((point) => point.decided).map((point) => point.itemId)), [summary]);

  // Was this step already closed in the subtarea?
  useEffect(() => {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !taskStep) return;
    let cancelled = false;
    void stepIsDone({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: taskStep.id })
      .then((done) => !cancelled && setStepDone(done))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session, ctx?.pmOrg, ctx?.issueNumber, taskStep?.id]);

  const arriving = useRef(false);
  // The tool opens on the first item this person has not answered, not on the first of the list: in a round that
  // several people answer in turns, each one comes back to where they left it.
  useEffect(() => {
    if (!data || busy || !visible.length) return;
    const key = `${data.book}|${data.chapter}|${stepProp}|${ctx?.taskId ?? ""}|${ctx?.issueNumber ?? ""}|${category}|${order}`;
    if (openedAt === key) return;
    setOpenedAt(key);
    const hashOf = (id: string) => textFingerprint(data.draftVerses[visible.find((row) => row.id === id)?.verse ?? 0] ?? "");
    // Opened from a message about a verse («1:3» in the conversation): at that verse, on the point the team does
    // not agree on if it has one. It opened on the first point of the passage, and the one called to settle a
    // disagreement had to find it among thirty.
    const place = /^(\d+):(\d+)/.exec(ctx?.focus ?? "");
    if (place) {
      const there = visible.map((row, index) => ({ row, index })).filter(({ row }) => row.chapter === Number(place[1]) && row.verse === Number(place[2]));
      const disputed = there.find(({ row }) => summary?.meeting.some((point) => point.itemId === row.id));
      const mine = firstUnanswered({ items: there.map(({ row }) => row), decisions, me, hashOf, settled });
      const pick = disputed ?? there[mine > 0 ? mine : 0];
      if (pick) {
        setPosition(pick.index);
        return;
      }
    }
    const at = firstUnanswered({ items: visible, decisions, me, hashOf, settled });
    // Nothing left to answer: from the first point, not from where another subtarea was left.
    if (at < 0) setPosition(0);
    if (at > 0) {
      // Arriving where one left it, the page stays at its top: what the round says (a point without agreement,
      // everything agreed) is read there before the point.
      arriving.current = true;
      setPosition(at);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, busy, visible, decisions.length]);

  const answeredByMe = useMemo(() => {
    if (!data) return 0;
    return data.items.filter((row) => {
      const hash = textFingerprint(data.draftVerses[row.verse] ?? "");
      return decisions.some((d) => d.itemId === row.id && d.reviewer.trim().toLowerCase() === me && (d.textHash === undefined || d.textHash === hash));
    }).length;
  }, [data, decisions, me]);
  // The first pass is one person's: it goes by what they answered. A round goes by the answers that count, of
  // those it needs: it went by the points agreed, and read «0 %» until the third person had answered everything.
  const points = data?.items.length ?? 0;
  const counted = (summary?.items ?? []).reduce((sum, point) => sum + (point.state === "agreed" ? thresholds.minAgree : Math.min(point.agree, thresholds.minAgree - 1)), 0);
  useStepWork(session, ctx, reviewing ? answeredByMe : counted, reviewing ? points : points * thresholds.minAgree, {
    stepId: taskStep?.id,
    on: !stepDone && !closing && !busy,
    mine: reviewing || !points ? undefined : answeredByMe >= points,
  });
  useEffect(() => {
    if (!reviewing || stepDone || !data?.items.length || answeredByMe < data.items.length || !session || !ctx?.pmOrg || !ctx.issueNumber || !taskStep) return;
    void completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: taskStep.id })
      .then(() => {
        setStepDone(true);
        announce(t("af.reviewDone"));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing, stepDone, answeredByMe, data?.items.length]);

  /** Every item is agreed: the step is completed in the subtarea, so the task can move on. */
  async function closeRound() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !taskStep) return;
    setClosing(true);
    setError("");
    try {
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: taskStep.id });
      setStepDone(true);
      // Its last step closed, the subtarea is delivered here. The button said «para que la tarea siga», and the
      // task waited for one of those who had joined it to find «Entregar» on their list, without anybody being told.
      const done = plan ? await deliverSharedSubtask({ session, pmOrg: ctx.pmOrg, lang: ctx.lang, contentOrg: ctx.contentOrg, board: plan, issueNumber: ctx.issueNumber }).catch(() => false) : false;
      setDelivered(done);
      announce(t(done ? "round.closedDelivered" : "round.closedNow"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setClosing(false);
    }
  }

  /**
   * What somebody proposes or objects, and what the team decides, said in the conversation of the subtarea too, to
   * whoever had already answered the challenge. It was written in the tool and nowhere else: the others learned
   * of it only on opening the tool again, and nobody was told that what they had agreed to was in question.
   */
  async function tellTeam(said: string) {
    if (!session || !data || !item || !ctx?.pmOrg || !ctx.issueNumber) return;
    // Whoever coordinates the team is told as well: a point without agreement waits for their decision.
    const who = [...new Set([...(tally?.answers ?? []).map((a) => a.reviewer.trim()), ...coordinatorsOf(data.levelBook, task?.orgTeamName)].filter((login) => login && login.toLowerCase() !== me))];
    const about = [stepProp === "notas" ? nameOf(item) : "", chosenWords ? `«${chosenWords}»` : ""].filter(Boolean).join(" · ");
    const body = `${who.map((login) => `@${login}`).join(" ")} ${about ? `${about}. ` : ""}${said}`.trim();
    await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, refComment(data.book, `${item.chapter}:${item.verse}`, body)).catch(() => undefined);
  }

  /** The team's final decision on the item in view, after talking it over. */
  async function decide(text: string) {
    if (!session || !data || !item || !ctx) return;
    setSaving(true);
    setError("");
    try {
      const decision: ReviewDecision = {
        itemId: item.id,
        ref: { start: { chapter: item.chapter, verse: item.verse } },
        sessionId: String(ctx.issueNumber || ctx.taskId),
        stageId: "afinacion",
        status: "approved",
        reviewer: session.username,
        timestamp: new Date().toISOString(),
        note: text,
        textHash: hash,
        final: true,
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      await tellTeam(`${tNow("af.decisionSaid")} ${text}`);
      announce(t("round.decisionSaved"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  // On a phone a new point starts at its own top, with the words to touch in sight: it was shown wherever the last
  // one had been left, and the translation fell under the bar of the answer. Not the first one: whoever arrives
  // reads from the top.
  const kindRef = useRef<HTMLParagraphElement>(null);
  const shownOnce = useRef(false);
  useEffect(() => {
    if (!item?.id) return;
    if (!shownOnce.current || arriving.current) {
      shownOnce.current = true;
      arriving.current = false;
      return;
    }
    if (!window.matchMedia("(max-width: 48rem)").matches) return;
    // Once the point shows the step it opens at: before that the page is as short as the answer just given.
    const later = window.setTimeout(() => kindRef.current?.scrollIntoView({ block: "start" }), 80);
    return () => window.clearTimeout(later);
  }, [item?.id]);

  // The box where a change is proposed or an objection written opens in sight, with the button that sends it:
  // on a phone it opened under the screen, the button eleven pixels beyond its foot.
  const whyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending) whyRef.current?.scrollIntoView({ block: "center" });
  }, [pending]);
  // So does what tells that everything is agreed, to whoever gave the last answer: it is at the top of the page.
  const roundRef = useRef<HTMLDivElement>(null);
  const allAgreed = Boolean(summary?.complete);
  useEffect(() => {
    if (!allAgreed || stepDone) return;
    // After the next point has been brought to its top, which the last answer also asks for.
    const later = window.setTimeout(() => roundRef.current?.scrollIntoView({ block: "start" }), 200);
    return () => window.clearTimeout(later);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAgreed]);

  function jumpToItem(id: string) {
    setCategory("all");
    const at = groups.flatMap((g) => g.items).findIndex((i) => i.id === id);
    if (at >= 0) setPosition(at);
  }

  function labelOfItem(id: string): string {
    const found = data?.items.find((i) => i.id === id);
    if (!found) return id;
    // Named by the words of the translation somebody chose for it. The notes name it by a phrase of the English
    // text they were written for («of Jesus … kept and called in … Christ»), which the team does not have in front.
    const chosen = [...decisions].reverse().find((d) => d.itemId === id && d.selectedText?.text)?.selectedText?.text.replace(/^[\s.,;:!?¡¿«»“”"'()]+|[\s.,;:!?¡¿«»“”"'()]+$/g, "");
    const words = chosen || found.phrase;
    const what = "termSlug" in found ? termLabel((found as TermItem).termSlug, termTitles) : [nameOf(found), words ? `«${words}»` : ""].filter(Boolean).join(" ");
    return `${found.chapter}:${found.verse}${what ? ` · ${what}` : ""}`;
  }

  const mineHere = item ? decisions.filter((d) => d.itemId === item.id && d.reviewer.trim().toLowerCase() === me).map((d) => d.timestamp).join("|") : "";
  // Changing item: show what this person already answered (their words and their note).
  useEffect(() => {
    if (!item || !data) return;
    const saved = decisions
      .filter((d) => d.itemId === item.id && d.reviewer.trim().toLowerCase() === me)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    const own = saved?.selectedText ? wordsOfSelection(verseText, saved.selectedText) : [];
    // The verse was corrected after this person answered, and the words they had chosen (if any) are no longer in
    // it: they choose them again. The item opened at its second step with «(sin palabras)» and an answer that could
    // not be pressed.
    const again = Boolean(saved) && !own.length && (Boolean(saved?.selectedText?.text) || (saved?.textHash !== undefined && saved.textHash !== hash));
    // Confirming what someone else answered starts from the words they chose: the question is whether those are
    // right. The latest of them that are still in the verse.
    const theirs =
      saved && !again
        ? []
        : decisions
            .filter((d) => d.itemId === item.id && d.selectedText && d.reviewer.trim().toLowerCase() !== me)
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
            .map((d) => wordsOfSelection(verseText, d.selectedText))
            .find((words) => words.length) ?? [];
    setSelected(own.length ? own : theirs);
    setNote(saved?.note ?? "");
    setPending(null);
    setChoosing(false);
    setChanging(false);
    setReopened(false);
    setArticleOpen(false);
    // Somebody already chose the words: what is asked is whether one agrees with them, at the second step. It opened
    // at the first, as if nothing had been done, and Miguel answered again a point Ramón had answered (16 October).
    setConfirmed((Boolean(saved) && !again) || theirs.length > 0);
    // The person's own answers arrive after the item is shown: an item they answered opens at its second step. The
    // answers of the others, read again every so often, do not move what this person is doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, verseText, answersRead, mineHere]);


  // Words step: how this term was rendered in every use across the book.
  const termSlug = item && "termSlug" in item ? (item as TermItem).termSlug : "";
  const termKey = termSlug ? termMessageKey((item as TermItem).termKind, termSlug) : "";
  /** The article of the term in hand, as the source package has it (the team's has not been harmonized): by slug. */
  const [termArticles, setTermArticles] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!session || !ctx || !data || !termSlug || termSlug in termArticles) return;
    let cancelled = false;
    void loadTermArticle(session, data.sourcePackage, item as TermItem, ctx, undefined, { teamFirst: "published" })
      .catch(() => null)
      .then((text) => !cancelled && setTermArticles((had) => ({ ...had, [termSlug]: text ?? null })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, ctx, data, termSlug]);
  const termArticle = termSlug ? termArticles[termSlug] : undefined;
  const definition = termArticle ? termDefinition(termArticle) : "";
  // What the team decided about the words of this verse, beside the term: it was a link in the step's fold, far from
  // the word it is about. In another tab, so the point in hand stays as it is.
  const termGlossary =
    termSlug && ctx && !ctx.lab && data && item ? (
      <a className="af-link af-term-glossary" lang={language} href={`#/glosario?libro=${encodeURIComponent(data.book)}&c=${item.chapter}&de=${item.verse}&a=${item.verse}${data.resource === "tps" ? "&texto=tps" : ""}`} target="_blank" rel="noreferrer">
        {t("af.termGlossary")}
      </a>
    ) : null;
  const comparison = useMemo(
    () =>
      data && termSlug
        ? compareTermRenderings({
            uses: data.termUses.filter((u) => u.termSlug === termSlug),
            decisions,
            verseText: (c, v) => data.bookDraft[`${c}:${v}`] ?? "",
            preferred: preferredTerms[termSlug]?.text,
          })
        : null,
    [data, termSlug, decisions, preferredTerms],
  );
  /** The term's other places, without the one in hand. */
  const elsewhere = useMemo(() => renderingsElsewhere(comparison, item?.id ?? ""), [comparison, item?.id]);
  const canChoosePreferred = Boolean(data) && meetsLevel(levelOf(teamLevels, me), "habilitada");

  async function choosePreferred(text: string) {
    if (!session || !data || !termSlug) return;
    setSaving(true);
    setError("");
    try {
      const next = await savePreferredTerm({
        session,
        target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
        slug: termSlug,
        text,
      });
      setPreferredTerms(next);
      announce(text ? t("af.preferredSet").replace("{text}", text) : t("af.preferredCleared"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  function jumpToUse(use: TermItem) {
    setCategory("all");
    const at = groups.flatMap((g) => g.items).findIndex((i) => i.id === use.id);
    if (at >= 0) setPosition(at);
  }

  /**
   * `said`: what goes with the answer when it is not what was typed in the box. Taking a colleague's proposal as
   * one's own is said by a touch («Pienso lo mismo»): whoever agreed with it had to write a proposal of their own.
   */
  async function answer(status: ReviewStance, said?: string) {
    if (!session || !data || !item || !ctx) return;
    // An agreement carries no note: what stays in the box from an earlier objection is not sent with it.
    const words = (said ?? (status === "approved" ? "" : note)).trim();
    if (status !== "approved" && !words) {
      setPending(status);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const decision: ReviewDecision = {
        itemId: item.id,
        ref: { start: { chapter: item.chapter, verse: item.verse } },
        selectedText: selectionFromWords(verseText, selected, { chapter: item.chapter, verse: item.verse }),
        sessionId: String(ctx.issueNumber || ctx.taskId),
        stageId: "afinacion",
        status,
        reviewer: session.username,
        timestamp: new Date().toISOString(),
        note: words || undefined,
        textHash: hash,
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      if (status !== "approved") await tellTeam(`${stanceLabel(status)}: ${words}`);
      // With this answer everything is agreed, and this person may not close the review: whoever coordinates is
      // told. Nobody was: the round stood at «30 de 30» until somebody who may close it happened to open the tool.
      if (status === "approved" && closesHere && !canConfirm && !stepDone && summary && !summary.complete && ctx.pmOrg && ctx.issueNumber) {
        const round = summarizeRound({
          itemIds: data.items.map((i) => i.id),
          decisions: [...decisions, decision],
          currentHashes: Object.fromEntries(data.items.map((i) => [i.id, textFingerprint(data.draftVerses[i.verse] ?? "")])),
          levels: teamLevels,
          authors: [],
          thresholds,
          confirmers,
        });
        const who = coordinatorsOf(data.levelBook, task?.orgTeamName).filter((login) => login.toLowerCase() !== me);
        if (round.complete && who.length) {
          await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, whileOpen(`${who.map((login) => `@${login}`).join(" ")} ${tNow("round.allAgreedTell")}`)).catch(() => undefined);
        }
      }
      setPending(null);
      setChanging(false);
      announce(t("af.savedAnswer").replace("{stance}", stanceLabel(status)));
      // On to the next one this person has not answered; after the last, the next in the list.
      const next = firstUnanswered({ items: visible, decisions: [...decisions, decision], me, hashOf: (id) => textFingerprint(data.draftVerses[visible.find((row) => row.id === id)?.verse ?? 0] ?? ""), from: position + 1, settled });
      if (next >= 0) setPosition(next);
      else if (position < visible.length - 1) setPosition((p) => p + 1);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  // The other uses of this term, in what is in hand, that read like the words chosen here and wait for this person.
  const alike = useMemo(
    () =>
      data && item && termSlug && !reviewing
        ? sameRenderingUses({
            use: item as TermItem,
            uses: visible as TermItem[],
            rendering: selectionFromWords(verseText, selected, { chapter: item.chapter, verse: item.verse })?.text ?? "",
            decisions,
            me,
            verseText: (c, v) => (c === data.chapter ? data.draftVerses[v] ?? "" : data.bookDraft[`${c}:${v}`] ?? ""),
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, item?.id, termSlug, reviewing, visible, selected, decisions, me],
  );

  /** Agree with this use and with every other use of the term that reads the same, in one go. */
  async function answerAlike() {
    if (!session || !data || !item || !ctx || !alike.length) return;
    setSaving(true);
    setError("");
    try {
      const stamp = new Date().toISOString();
      const make = (use: TermItem, selectedText: ReviewDecision["selectedText"], text: string): ReviewDecision => ({
        itemId: use.id,
        ref: { start: { chapter: use.chapter, verse: use.verse } },
        selectedText,
        sessionId: String(ctx.issueNumber || ctx.taskId),
        stageId: "afinacion",
        status: "approved",
        reviewer: session.username,
        timestamp: stamp,
        textHash: textFingerprint(text),
      });
      const batch = [
        make(item as TermItem, selectionFromWords(verseText, selected, { chapter: item.chapter, verse: item.verse }), verseText),
        ...alike.map((row) => make(row.use, row.selectedText, data.draftVerses[row.use.verse] ?? "")),
      ];
      await appendMyDecisions(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, batch);
      const all = [...decisions, ...batch];
      setDecisions((prev) => [...prev, ...batch]);
      announce(t("af.savedAlike").replace("{n}", String(batch.length)));
      const next = firstUnanswered({ items: visible, decisions: all, me, hashOf: (id) => textFingerprint(data.draftVerses[visible.find((row) => row.id === id)?.verse ?? 0] ?? ""), from: position + 1, settled });
      if (next >= 0) setPosition(next);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveFix() {
    if (!session || !data || !item || !ctx) return;
    const text = fixText.trim();
    if (!text) return;
    setSaving(true);
    setError("");
    // The kinds chosen, then what the person wrote: one line for whoever reads the change later.
    const why = reasonLine(fixReasons, fixReason, t);
    const before = data.draftVerses[item.verse] ?? "";
    try {
      // A correction is a proposal: it reaches the draft when the team agrees to it and somebody applies it. The
      // one case that is written at once is the correction the team has already decided on this very point, made
      // by whoever may confirm for the team: that is the team's decision being carried out, not one person's.
      if (!(tally?.decided && canConfirm)) {
        const opened = await openTextProposal({
          session,
          pmOrg: ctx.pmOrg,
          task: { projectId: ctx.projectId, taskId: ctx.taskId, taskName: ctx.taskName || ctx.taskId, resource: data.resource, parentIssue: ctx.issueNumber },
          target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
          draftFilepath: data.draft.filepath,
          book: data.book,
          chapter: item.chapter,
          verse: item.verse,
          oldText: before,
          newText: text,
          note: why || tNow("fx.proposalNote"),
          tell: Object.keys(teamLevels),
          thresholds,
        });
        setFixing(false);
        setFixReason("");
        setFixReasons([]);
        announce(t("gr.proposed").replace("{ref}", `${item.chapter}:${item.verse}`).replace("{n}", String(opened.issue.number)));
        return;
      }
      const result = await saveCorrection({
        session,
        target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
        filepath: data.draft.filepath,
        chapter: item.chapter,
        verse: item.verse,
        text,
        reason: why,
        book: data.book,
        before,
        reasons: fixReasons,
        note: fixReason.trim(),
        // What was in hand: the note or the key term being checked, as the screen names it.
        from: { issue: ctx.issueNumber, task: ctx.taskId, step: taskStep?.id ?? ctx.stepId, item: item.id, label: item.phrase || item.quote },
      });
      setData({ ...data, draftVerses: { ...data.draftVerses, [item.verse]: text }, bookDraft: { ...data.bookDraft, [`${item.chapter}:${item.verse}`]: text } });
      setFixing(false);
      setFixReason("");
      setFixReasons([]);
      announce(t("af.corrected").replace("{ref}", `${data.book} ${item.chapter}:${item.verse}`));
      if (result.clearedVerses.length) {
        announce(t("af.alignmentLost").replace("{v}", String(item.verse)));
      }
      // The text changed: the tasks that had delivered their work on this verse are asked to look at it again.
      if (before !== text && ctx.pmOrg && ctx.projectId && ctx.contentOrg) {
        const ref = `${item.chapter}:${item.verse}`;
        const said = await askRedoAfterCorrection({ session, pmOrg: ctx.pmOrg, lang: ctx.lang, projectId: ctx.projectId, contentOrg: ctx.contentOrg, corrected: { resource: data.resource, chapter: item.chapter, from: item.verse, to: item.verse, decision: ctx.issueNumber || undefined, by: session.username } })
          .then((asked) => redoSaid(ref, asked, tNow))
          .catch((err) => tNow("redo.failed").replace("{ref}", ref).replace("{why}", explainError(err)));
        if (said && ctx.issueNumber) await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, refComment(data.book, ref, said)).catch(() => undefined);
      }
      // The team had decided this point, and the correction is what it decided: the decision is said again over
      // the text as it is now. It was undone by the very correction it asked for, with everything said about it.
      const settled = tally?.decided;
      if (settled && canConfirm && before !== text) {
        const again: ReviewDecision = {
          itemId: item.id,
          ref: { start: { chapter: item.chapter, verse: item.verse } },
          sessionId: String(ctx.issueNumber || ctx.taskId),
          stageId: "afinacion",
          status: "approved",
          reviewer: session.username,
          timestamp: new Date().toISOString(),
          note: settled.note,
          textHash: textFingerprint(text),
          final: true,
        };
        await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, again);
        setDecisions((prev) => [...prev, again]);
      }
      // Tell whoever answered about words that are no longer as they were, in the subtarea of this task.
      const ids = data.items.filter((i) => i.verse === item.verse).map((i) => i.id);
      // Whoever checked the alignment of this verse is told too.
      ids.push(`al:${item.chapter}:${item.verse}`, `al-done:${item.chapter}:${item.verse}`);
      const after = standingAnswers(given, (d) => (d.ref?.start.chapter === item.chapter && d.ref.start.verse === item.verse ? text : undefined));
      const who = new Set<string>();
      for (const id of ids) {
        for (const login of reviewersToNotifyAfterEdit({ itemId: id, decisions: after, newHash: textFingerprint(text), editor: session.username })) who.add(login);
      }
      if (who.size && ctx.issueNumber && ctx.pmOrg && before !== text) {
        // Said as the person who corrected would say it, with the place and what changed: it was a line of small
        // print («Corregí JUD 1:3») among the messages, the only one that asked the others to do something.
        const change = changedStretch(before, text);
        const said = [
          [...who].map((login) => `@${login}`).join(" "),
          tNow("af.correctedNote").replace("{before}", change.before).replace("{now}", change.now),
          why ? tNow("gr.reason").replace("{why}", why) : "",
          tNow("af.correctedAgain"),
        ].filter(Boolean).join(" ");
        await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, refComment(data.book, `${item.chapter}:${item.verse}`, said)).catch(() => undefined);
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  const total = visible.length;
  /** Words of a verse by their positions, in order; a gap between them is said with «…». */
  const wordsAt = (text: string, positions: number[]) => {
    const words = wordSpans(text);
    const picked = [...positions].sort((x, y) => x - y);
    return picked.map((index, at) => `${at && index !== picked[at - 1]! + 1 ? "… " : ""}${words[index]?.text ?? ""}`).join(" ")
      // Punctuation at either end is not part of what is asked about.
      .replace(/^[\s.,;:!?¡¿«»“”"'()]+|[\s.,;:!?¡¿«»“”"'()]+$/g, "");
  };
  /** «De acuerdo» waits for the words of the draft that render what is marked (a verse with no text has none to pick). */
  const needsWords = !selected.length && Boolean(verseText.trim());
  /** The words of the draft the person marked. */
  const chosenWords = useMemo(() => wordsAt(verseText, selected), [selected, verseText]);
  const messageKeyOf = stepProp === "notas" ? (item?.id ?? "") : termKey;
  const messagesHere = noteMessages[messageKeyOf] ?? 0;
  const compareTabs = [
    ...(stepProp === "notas" ? [{ id: "article" as const, label: t("af.tabArticle") }] : [{ id: "book" as const, label: t("af.inWholeBook") }]),
    { id: "note" as const, label: `${t(stepProp === "notas" ? "af.tabNote" : "af.tabMessage")}${messagesHere ? ` · ${messagesHere}` : ""}` },
  ];
  const helpsTab = compareTabs.some((tab) => tab.id === compare) ? compare : compareTabs[0]!.id;
  // The words the item is about, marked in the text it is read against: in the original from the quote, in the
  // English texts through their alignment with it.
  const reference = data?.references.find((row) => row.id === refText) ?? data?.references[0];
  const refVerse = item && reference ? (reference.book[`${item.chapter}:${item.verse}`] ?? "") : "";
  const refMarked = useMemo(() => {
    if (!item || !reference || !refVerse) return [] as number[];
    if (reference.id === "orig") return item.quote ? matchHelpQuoteToTokenIndices(tokenizeVersePlainText(refVerse), item.quote, item.occurrence) : [];
    return alignedGatewayQuoteForHelpQuote({ verseText: refVerse, quote: item.quote, occurrence: item.occurrence, alignments: reference.alignments, book: data!.book, chapter: item.chapter, verse: item.verse }).tokenIndices;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, reference?.id, refVerse]);
  /** What is marked in the reference, to say in the draft which words to look for. */
  const markedWords = useMemo(() => wordsAt(refVerse, refMarked), [refVerse, refMarked]);
  const chapterTexts = useMemo(
    () => (data ? [...data.references, { id: "draft" as const, label: t("af.draftLabel").replace("{res}", data.resource === "tps" ? "TPS" : "TPL"), book: data.bookDraft }] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  const chapterSource = chapterTexts.find((row) => row.id === chapterText) ?? chapterTexts[0];
  const lastChapter = useMemo(() => Math.max(0, ...Object.keys(reference?.book ?? {}).map((key) => Number(key.split(":")[0]))), [reference]);
  // The article is read when its tab is opened, and again for each new figure while it stays open.
  useEffect(() => {
    if (helpsTab !== "article" || !item) return;
    const path = articlePathOf(item.supportRef);
    if (path && reading?.path !== path) void readArticle(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpsTab, item?.id]);

  return (
    <div className="af af--round">
      {/* The whole article of the point's note or term, over the point: it was laid out in the box, or a tab away. */}
      <Dialog open={articleOpen && Boolean(item)} onOpenChange={setArticleOpen}>
        <DialogContent className="fix-sheet hint-sheet af-article-sheet" aria-label={t(stepProp === "notas" ? "af.readArticle" : "af.wholeArticle")}>
          <header className="fx-head">
            <DialogTitle className="fx-title">
              {item ? (stepProp === "notas" ? nameOf(item) : termSlug ? termLabel(termSlug, termTitles) : "") : ""}
            </DialogTitle>
          </header>
          {/* No «lang» of the source: the article is the team's when they published it (see «teamFirst: "published"»). */}
          <div className="fx-body af-article-read">
            {stepProp === "palabras" ? (
              termArticle ? <HelpMarkdownView content={articleBody(termArticle)} /> : termArticle === null ? <p className="af-hint">{t("af.noArticle")}</p> : <LoadingState shape="text" label={t("af.loadingArticle")} lines={8} />
            ) : reading?.body ? (
              <HelpMarkdownView content={reading.body} />
            ) : (
              reading?.body === null ? <p className="af-hint">{t("af.noArticle")}</p> : <LoadingState shape="text" label={t("af.loadingArticle")} lines={8} />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <WordSheet word={sheetWord?.word ?? null} at={{ book: data?.book ?? "", chapter: sheetWord?.chapter ?? 0, verse: sheetWord?.verse ?? 0 }} session={session ?? null} workspace={ctx ? workspaceOfOrg(tallerConfig, ctx.pmOrg) : undefined} onClose={() => setSheetWord(null)} />
      <ToolHeader
        // The passage, and under it the task with how far along: «Palabras clave TPS · 0 de 74 acordadas». The line said
        // «Revisar palabras clave · Palabras clave TPS», the task twice; with both in the title, a phone cut the passage.
        title={heading.title}
        // From the helps or the chapter, back returns to what was being reviewed; from there it leaves.
        onBack={() => (pane === "review" ? onClose() : setPane("review"))}
        meta={[taskLabel || heading.where, summary && data ? t("af.nAgreed").replace("{a}", String(summary.agreed)).replace("{n}", String(data.items.length)) : ""].filter(Boolean).join(" · ")}
        more={data ? [{ id: "glossary", label: t("gl.open"), hint: t("mm.glossaryHint"), href: `#/glosario?libro=${encodeURIComponent(data.book)}&c=${data.chapter}&de=1&a=200` }] : []}
        info={said.purpose ? { label: t("af.aboutTask"), onOpen: () => setAboutOpen(true) } : undefined}
      />
      <div className="step-ask-bar">
        {/* What the task is for, how the round goes and the team's rules: said once in a welcome, then a touch away
            in the header («ⓘ»). Laid out over the tabs they took 130 px of every point (16 October). */}
        <StepAsk
          session={session}
          ctx={ctx && taskStep ? { ...ctx, stepId: taskStep.id } : ctx}
          intro={false}
          label={said.purpose ? t("af.aboutTask") : undefined}
          open={said.purpose ? aboutOpen : undefined}
          onOpenChange={said.purpose ? setAboutOpen : undefined}
          trigger={!said.purpose}
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <LoadingState shape="tool" label={t("af.loading")} /> : null}

      {summary ? (
        <div ref={roundRef} className="af-round-top">
          <RoundPanel summary={summary} labelOf={labelOfItem} onJump={jumpToItem} closesHere={closesHere} canClose={canConfirm} stepDone={stepDone} delivered={delivered} busy={closing} onClose={() => void closeRound()} onLeave={onClose} />
        </div>
      ) : null}

      {data && item ? (
        <div className="fam-tabs af-panes" role="tablist">
          <button type="button" role="tab" className="fam-tab" aria-selected={pane === "review"} onClick={() => setPane("review")}>
            {t("af.paneReview")}
          </button>
          <button type="button" role="tab" className="fam-tab" aria-selected={pane === "helps"} onClick={() => setPane("helps")}>
            {t("af.helps")}
            {messagesHere ? <span className="fam-tab__count">{messagesHere}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            className="fam-tab"
            aria-selected={pane === "chapter"}
            onClick={() => {
              setReadChapter(item.chapter);
              setPane("chapter");
            }}
          >
            {t("af.paneChapter")}
          </button>
          <button type="button" role="tab" className="fam-tab" aria-selected={pane === "intro"} onClick={() => setPane("intro")}>
            {t("af.paneIntro")}
          </button>
        </div>
      ) : null}

      {data && item && pane === "intro" && ctx ? (
        // The introduction of the book and of the chapter: a place to go to beside the work, as the chapter is.
        <section className="af-chapter af-intro">
          <PassageIntroText session={session} ctx={ctx} />
        </section>
      ) : null}

      {data && item && pane === "chapter" ? (
        // Whole chapters of the text chosen, to read the item in its place: the original unless another is chosen.
        <section className="af-chapter">
          <div className="af-ref__bar">
            <div className="af-ref__texts" role="tablist" aria-label={t("af.readAgainst")}>
              {chapterTexts.map((row) => (
                <button key={row.id} type="button" role="tab" aria-selected={chapterSource?.id === row.id} onClick={() => setChapterText(row.id)}>
                  {row.id === "orig" ? t("af.tabOriginal") : row.label}
                </button>
              ))}
            </div>
            <label className="af-pick">
              <span className="sr-only">{t("af.chapterPick")}</span>
              <select value={readChapter || item.chapter} onChange={(e) => setReadChapter(Number(e.target.value))}>
                {Array.from({ length: Math.max(lastChapter, item.chapter) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {t("af.chapterN").replace("{n}", String(n))}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden />
            </label>
          </div>
          {chapterSource?.id === "draft" ? <p className="af-hint">{t("af.draftSoFar")}</p> : null}
          <div className={chapterSource?.id === "orig" ? "af-chapter__text af-orig" : "af-chapter__text"} lang={chapterSource?.id === "orig" ? "grc" : undefined}>
            {Object.entries(chapterSource?.book ?? {})
              .filter(([key]) => Number(key.split(":")[0]) === (readChapter || item.chapter))
              .sort(([a], [b]) => Number(a.split(":")[1]) - Number(b.split(":")[1]))
              .map(([key, text]) => {
                const verse = Number(key.split(":")[1]);
                return (
                  <p key={key} className="hs-v" data-here={(readChapter || item.chapter) === item.chapter && verse === item.verse ? "true" : undefined}>
                    <sup>{verse}</sup> {chapterSource?.id === "orig" ? <OriginalWords text={text} words={data.originalWords[key]} onOpen={(word) => setSheetWord({ word, chapter: readChapter || item.chapter, verse })} /> : text}
                  </p>
                );
              })}
          </div>
        </section>
      ) : null}

      {data && item && pane === "helps" ? (
        // Helps and context, one at a time: they explain the category; they are not what is judged.
        <section className="af-chapter">
          <p className="af-kind">{nameOf(item)}</p>
          <div className="af-compare-tabs" role="tablist" aria-label={t("af.helps")}>
            {compareTabs.map((tab) => (
              <button key={tab.id} type="button" role="tab" className="mde-kind" aria-selected={helpsTab === tab.id} onClick={() => setCompare(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="af-help-pane" role="tabpanel">
            {helpsTab === "article" ? (
              <>
                {articles[articlePathOf(item.supportRef)]?.question ? <p className="af-article-q">{articles[articlePathOf(item.supportRef)]!.question}</p> : null}
                {reading?.path === articlePathOf(item.supportRef) ? (
                  reading.body === undefined ? <LoadingState shape="text" label={t("af.loadingArticle")} lines={8} /> : reading.body ? <HelpMarkdownView content={reading.body} /> : <p className="af-hint">{t("af.noArticle")}</p>
                ) : null}
                {session && ctx?.pmOrg && ctx.projectId && articlePathOf(item.supportRef) ? (
                  // The article is read here and maintained by whoever harmonizes: what is found in it is left for them.
                  <HelpMessages
                    key={articleMessageKey(articlePathOf(item.supportRef))}
                    session={session}
                    pmOrg={ctx.pmOrg}
                    lang={ctx.lang}
                    projectId={ctx.projectId}
                    book={data.book}
                    chapter={item.chapter}
                    verse={item.verse}
                    about={articleMessageKey(articlePathOf(item.supportRef))}
                    resource="academia"
                    taskName={ctx.taskName}
                    lede={t("hm.ledeLeaveArticle")}
                  />
                ) : null}
              </>
            ) : helpsTab === "note" ? (
              <>
                {item.note ? <HelpMarkdownView className="af-note af-note--md" content={item.note} /> : null}
                {session && ctx?.pmOrg && ctx.projectId && (stepProp === "notas" || termSlug) ? (
                  // Refining is about the text, not the helps: a disagreement with a note or a term is left for whoever harmonizes it.
                  <HelpMessages
                    key={stepProp === "notas" ? item.id : termKey}
                    session={session}
                    pmOrg={ctx.pmOrg}
                    lang={ctx.lang}
                    projectId={ctx.projectId}
                    book={data.book}
                    chapter={item.chapter}
                    verse={item.verse}
                    about={stepProp === "notas" ? item.id : termKey}
                    resource={stepProp === "notas" ? "notas" : "palabras"}
                    taskName={ctx.taskName}
                    lede={t(stepProp === "notas" ? "hm.ledeLeave" : "hm.ledeLeaveTerm")}
                    onCount={(count) => setNoteMessages((prev) => (prev[messageKeyOf] === count ? prev : { ...prev, [messageKeyOf]: count }))}
                  />
                ) : null}
              </>
            ) : comparison ? (
              <div className="af-compare" aria-label={t("af.compareAria")}>
                {preferredTerms[termSlug] ? (
                  <p className="af-preferred">
                    {t("af.preferred")}<b>«{preferredTerms[termSlug]!.text}»</b>
                    {canChoosePreferred ? (
                      <button type="button" className="af-use" disabled={saving} onClick={() => void choosePreferred("")}>
                        {t("af.remove")}
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {comparison.renderings.length ? (
                  <ul className="af-renderings">
                    {comparison.renderings.map((r) => (
                      <li key={r.text} className="af-rendering">
                        <b>«{r.text}»</b> · {r.uses.length} {r.uses.length === 1 ? t("af.useOne") : t("af.useMany")}
                        {canChoosePreferred && preferredTerms[termSlug]?.text.trim().toLowerCase() !== r.text.trim().toLowerCase() ? (
                          <button type="button" className="af-use" disabled={saving} onClick={() => void choosePreferred(r.text)}>
                            {t("af.usePreferred")}
                          </button>
                        ) : null}
                        <span className="af-uses">
                          {r.uses.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              className="af-use"
                              onClick={() => {
                                jumpToUse(u);
                                setPane("review");
                              }}
                            >
                              {u.chapter}:{u.verse}
                            </button>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="af-hint">{t("af.nobodyMarked")}</p>
                )}
                {comparison.differing.length ? (
                  <p className="af-stale">
                    {t(comparison.differing.length === 1 ? "af.differOne" : "af.differMany")
                      .replace("{n}", String(comparison.differing.length))
                      .replace("{list}", comparison.differing.map((u) => `${u.chapter}:${u.verse}`).join(", "))}
                  </p>
                ) : null}
                {comparison.renderings.length > 1 ? <p className="af-stale">{t("af.manyRenderings").replace("{n}", String(comparison.renderings.length))}</p> : null}
                {comparison.unmarked.length ? <p className="af-hint">{t(comparison.unmarked.length === 1 ? "af.unmarkedOne" : "af.unmarkedMany").replace("{n}", String(comparison.unmarked.length))}</p> : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Not before the answers of everybody have been read: for some seconds the first point of the list was
          shown as if nobody had answered anything, to be touched, and then the screen went to another point. */}
      {data && item && pane === "review" && !busy && said.purpose && !welcomed ? (
        // The first time this person opens this task on this device: what it is for and how it is answered, once.
        <section className="af-welcome" aria-label={t("af.welcomeTitle")}>
          <p className="af-welcome__title">{t("af.welcomeTitle")}</p>
          <p className="af-welcome__purpose">{said.purpose}</p>
          {roundSteps.length > 1 ? (
            <ol className="af-welcome__steps">
              {roundSteps.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : null}
          <div className="af-welcome__actions">
            <Button type="button" variant="outline" onClick={dismissWelcome}>
              {t("af.welcomeOk")}
            </Button>
            <button type="button" className="af-link" onClick={() => setAboutOpen(true)}>
              {t("af.welcomeRules")}
            </button>
          </div>
        </section>
      ) : null}
      {data && item && pane === "review" && !busy ? (
        <section className="af-focus" aria-label={t("af.noteAria")}>
          {/* What this item is: the category of the note (or the key term). Everything below is about it. */}
          <div className="af-focus__top">
            {groups.length > 1 ? (
              // Which figure is reviewed: one picker instead of a row of every kind of the chapter.
              <label className="af-pick">
                <span className="sr-only">{t(stepProp === "notas" ? "af.figuresAria" : "af.category")}</span>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPosition(0);
                  }}
                >
                  {[{ category: "all", label: "", items: data.items }, ...groups].map((group) => {
                    const done = summary ? group.items.filter((row) => summary.items.find((one) => one.itemId === row.id)?.state === "agreed").length : 0;
                    const name = group.category === "all" ? t("af.allFigures") : stepProp === "notas" ? articleShortName(group.items[0]!, articles[articlePathOf(group.items[0]!.supportRef)], (label) => localizeAfinacion(label, language)) : localizeAfinacion(group.label, language);
                    return (
                      <option key={group.category} value={group.category}>
                        {`${name} · ${done}/${group.items.length}`}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown size={14} aria-hidden />
              </label>
            ) : (
              <span />
            )}
            {stepProp === "palabras" ? (
              // The same list in two orders: every use of a term together, or as they come in the text.
              <span className="af-order" role="group" aria-label={t("af.orderAria")}>
                {(["term", "text"] as TermOrder[]).map((one) => (
                  <button key={one} type="button" aria-pressed={order === one} onClick={() => setOrder(one)}>
                    {t(one === "term" ? "af.orderTerm" : "af.orderText")}
                  </button>
                ))}
              </span>
            ) : null}
            <span className="af-step">
              <button type="button" className="th-icon" aria-label={t("af.prev")} title={t("af.prev")} disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={18} aria-hidden />
              </button>
              <span className="af-count">{t("af.countOf").replace("{a}", String(Math.min(position + 1, total))).replace("{b}", String(total))}</span>
              <button type="button" className="th-icon" aria-label={t("af.next")} title={t("af.next")} disabled={position >= total - 1} onClick={() => setPosition((p) => p + 1)}>
                <ChevronRight size={18} aria-hidden />
              </button>
            </span>
          </div>
          <p className="af-kind af-kind--top" ref={kindRef}>{stepProp === "notas" ? t("af.kindNote").replace("{ref}", `${item.chapter}:${item.verse}`) : t("af.kindTerm").replace("{ref}", `${item.chapter}:${item.verse}`)}</p>
          {(() => {
            const name = stepProp === "notas" ? nameOf(item) : termSlug ? (titlesRead || termTitles[termSlug] ? termLabel(termSlug, termTitles) : "…") : item.phrase ? `«${item.phrase}»` : item.quote || t("af.wholeVerse");
            // On a phone the name is what opens its note or definition: «Ver qué significa» and «Ver en el glosario»
            // stood as two loud links between the name and the step, belonging to neither (16 October).
            const foldable = !wide && ((stepProp === "notas" && Boolean(item.note)) || (stepProp === "palabras" && Boolean(definition)));
            return (
              <h2 className={termSlug ? "af-category af-category--term" : "af-category"}>
                {foldable ? (
                  <button type="button" className="af-category__toggle" aria-expanded={showReason} onClick={() => toggleReason(!showReason)}>
                    {name}
                    <ChevronDown size={18} className="af-category__chev" data-open={showReason ? "true" : undefined} aria-hidden />
                    <span className="sr-only">{t(showReason ? "af.hideReason" : stepProp === "notas" ? "af.showNote" : "af.showDefinition")}</span>
                  </button>
                ) : (
                  name
                )}
              </h2>
            );
          })()}
          {termSlug && !definition ? termGlossary : null}

          {/* Why the point is a challenge and what the team said: beside the text on a wide screen, above it on a phone. */}
          <div className="af-about">
          {/* The note of a challenge, or what a key word means, in two stages: a line to show it, then the whole article
              in a sheet over the point. Laid out open on every point it took the first screen of a phone (16 October).
              Shown or hidden, it stays so from point to point and visit to visit. */}
          {stepProp === "notas" && item.note ? (
            // Why this is a challenge, where the point is read: the note was a tab away, in «Ayudas», and the team
            // did not see why a phrase was one (16 October). As the source has it: the team's translation of the
            // notes has not been through Harmonization yet.
            showReason ? (
              <div className="af-reason" lang={sourcePackageLang(data.sourcePackage)} data-whole="true">
                <HelpMarkdownView className="af-note af-note--md" content={item.note} />
                {articlePathOf(item.supportRef) ? (
                  <button
                    type="button"
                    className="af-link"
                    lang={language}
                    onClick={() => {
                      void readArticle(articlePathOf(item.supportRef));
                      setArticleOpen(true);
                    }}
                  >
                    {t("af.readArticle")}
                  </button>
                ) : null}
              </div>
            ) : (
              null
            )
          ) : null}
          {stepProp === "palabras" && definition ? (
            // What the term means, where it is reviewed, as the note is for a challenge: the team checked key words
            // without the screen saying what the word was (16 October). From the source package, like the notes.
            showReason ? (
              <div className="af-reason" data-whole="true">
                <HelpMarkdownView className="af-note af-note--md" content={definition} />
                <button type="button" className="af-link" lang={language} onClick={() => setArticleOpen(true)}>
                  {t("af.wholeArticle")}
                </button>
                {termGlossary}
              </div>
            ) : (
              null
            )
          ) : null}
          {/* Why the point is back, said where it is read on arriving: under the answer it was below the screen. */}
          {staleMine ? <p className="af-stale">{t("af.staleMine")}</p> : null}
          {reviewing ? (
            <p className={answeredByMe >= data.items.length ? "af-team af-team--done" : "af-team"}>
              {stepDone ? t("af.reviewDoneShort") : t("af.reviewProgress").replace("{n}", String(answeredByMe)).replace("{of}", String(data.items.length))}
            </p>
          ) : null}
          </div>

          <div className="af-work">
          {/* How the team stands on it, and what the others said: before answering, not after. Where somebody does
              not agree it is found open: what they propose and why was folded under a line that did not look like
              something to touch, and the others read «no está de acuerdo» with no way to know about what. */}
          {/* A point closed in translationCore with nothing else said: no box that says nothing. Where everybody who
              answered agrees, with nothing more said, it is one line over the buttons instead (see `plainAgreement`):
              the box sat between the note and the question and said what that line says (16 October). It stands
              in the work column, over the steps, where the answer is given. */}
          {tally && !reviewing && !plainAgreement && (tally.answers.length || tally.stale.length || tally.decided) && !(closedView && !listed.length && !saidBefore.length) ? (
            <details key={item.id} className="af-team" data-state={closedView ? "pending" : tally.state} open>
              <summary>
                {closedView
                  ? t("af.teamWho")
                  : tally.decided
                  ? t(tally.decided.inTc ? "af.closedInTc" : "af.teamDecided")
                  : tally.state === "agreed"
                  ? t("af.teamAgreed").replace("{n}", String(tally.agree))
                  : [t("af.teamCount").replace("{n}", String(tally.agree)).replace("{of}", String(thresholds.minAgree)), tally.open.length ? t(tally.open.length === 1 ? "af.teamOpenOne" : "af.teamOpenMany").replace("{who}", tally.open.map((who) => `@${who}`).join(", ")) : ""].filter(Boolean).join(" · ")}
              </summary>
              {listed.length ? (
                <ul className="af-others" aria-label={t("af.teamAria")}>
                  {listed.map((a) => (
                    <li key={a.reviewer} data-mine={a === mine ? "true" : undefined}>
                      <b>{whoSaid(a)}</b> · {stanceLabel(a.status)}
                      {a.note && !tcCheckerOf(a) ? `: ${a.note}` : ""}
                      {a !== mine && a.status !== "approved" && a.note && !stepDone && !tally.decided && mine?.status !== a.status && firstOf(a.status) === a ? (
                        <button
                          type="button"
                          className="af-second"
                          disabled={saving || needsWords}
                          title={needsWords ? t("af.pickFirst") : undefined}
                          onClick={() => void answer(a.status as ReviewStance, t("af.secondNote").replace("{who}", a.reviewer))}
                        >
                          {t("af.second")}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : saidBefore.length || tally.decided ? null : (
                <p className="af-hint">{t("af.teamNobody")}</p>
              )}
              {saidBefore.length ? (
                // What was said before the verse was corrected stays in sight: «nadie ha respondido» was read where
                // three people had, and the reasons of the disagreement were gone with the correction.
                <>
                  <p className="af-lbl">{t("af.beforeFix")}</p>
                  <ul className="af-others af-others--before">
                    {saidBefore.map((a) => (
                      <li key={a.reviewer}>
                        <b>{whoSaid(a)}</b> · {stanceLabel(a.status)}
                        {a.note && !tcCheckerOf(a) ? `: ${a.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {tally.open.length && onOpenThread && ctx?.issueNumber ? (
                // «Para conversarlo en equipo»: the way to where the team talks.
                <button type="button" className="af-second" onClick={() => onOpenThread(ctx.issueNumber!)}>
                  {t("af.talk")}
                </button>
              ) : null}
              {closedView ? null : <FinalDecision key={item.id} tally={tally} canConfirm={canConfirm} busy={saving} onDecide={(text) => void decide(text)} />}
              {tally.decided && canConfirm && !stepDone && !fixing ? (
                // What was decided is often a change of the verse, and the way to it was «Cambiar», which is about
                // the words chosen.
                <button
                  type="button"
                  className="af-second"
                  onClick={() => {
                    setConfirmed(false);
                    setFixText(verseText);
                    setFixing(true);
                    window.setTimeout(() => document.getElementById("af-fix-text")?.scrollIntoView({ block: "center" }), 50);
                  }}
                >
                  {t("af.fixVerse")}
                </button>
              ) : null}
            </details>
          ) : null}
          {tally?.decided && closedView ? (
            // Closed: it reads as closed, and opening it again is a deliberate act. A closed point looked like any
            // other, its buttons waiting to be pressed (16 October).
            <div className="af-closed">
              <p className="af-closed__state">
                <Lock size={16} aria-hidden /> {t(tally.decided.inTc ? "af.closedInTc" : "af.closed")}
              </p>
              {chosenWords ? (
                <p className="af-closed__words">
                  <span className={reference?.id === "orig" ? "af-orig" : undefined} lang={reference?.id === "orig" ? "grc" : undefined}>
                    {markedWords || t("af.theMarked")}
                  </span>
                  <span aria-hidden> → </span>
                  <span className="af-res">{data.resource === "tps" ? "TPS" : "TPL"}</span> <b>{chosenWords}</b>
                </p>
              ) : null}
              <p className="af-hint">{t("af.closedHint")}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReopened(true);
                  setConfirmed(true);
                  setChanging(true);
                  setChoosing(true);
                }}
              >
                {t("af.reopen")}
              </Button>
            </div>
          ) : !confirmed ? (
            // Step 1 of 2: which words of the translation render what is marked in the reference.
            <>
              <p className="af-stepname">{t("af.step1").replace("{res}", data.resource === "tps" ? "TPS" : "TPL")}</p>
          {/* 1. Where it is: marked in the text the draft is read against, the original unless another is chosen. */}
            <div className="af-ref">
              <div className="af-ref__bar">
                <span className="af-lbl">{t("af.refLabel")}</span>
                <div className="af-ref__texts" role="tablist" aria-label={t("af.readAgainst")}>
                  {(data.references ?? []).map((row) => (
                    <button key={row.id} type="button" role="tab" aria-selected={reference?.id === row.id} onClick={() => setRefText(row.id)}>
                      {row.id === "orig" ? t("af.tabOriginal") : row.label}
                    </button>
                  ))}
                </div>
              </div>
              <span className={reference?.id === "orig" ? "af-orig" : undefined} lang={reference?.id === "orig" ? "grc" : undefined}>
                {reference?.id === "orig" ? (
                  <OriginalWords text={refVerse} words={data.originalWords[`${item.chapter}:${item.verse}`]} marked={refMarked} onOpen={(word) => setSheetWord({ word, chapter: item.chapter, verse: item.verse })} />
                ) : (
                  <Words text={refVerse} marked={refMarked} />
                )}
              </span>
              <ParallelLink book={data.book} chapter={item.chapter} from={item.verse} session={session ?? null} workspace={ctx ? workspaceOfOrg(tallerConfig, ctx.pmOrg) : undefined} team={{ owner: data.draft.owner, repo: data.draft.repo }} />
            </div>
  
            {/* 2. The words of the translation that render it: tapped in the draft. */}
            <div className="af-draft">
              <div className="af-draft__bar">
                <span className="af-draft__name">
                  <span className="af-lbl">{t("af.draftLabel2")}</span>
                  {/* Which text the words tapped belong to: the literal or the simple translation. */}
                  <span className="af-res">{data.resource === "tps" ? "TPS" : "TPL"}</span>
                </span>
                {fixing ? null : (
                  <button
                    type="button"
                    className="af-link"
                    onClick={() => {
                      setFixText(verseText);
                      setFixing(true);
                    }}
                  >
                    {t("af.fixShort")}
                  </button>
                )}
              </div>
              {fixing ? (
                <div className="af-fix" role="group" aria-label={t("af.fixAria")}>
                  <textarea id="af-fix-text" className="af-textarea" rows={4} value={fixText} aria-label={t("af.verseText")} onChange={(e) => setFixText(e.target.value)} />
                  {/* Why, by a touch; what a touch does not say can be written. */}
                  <span className="af-lbl">{t("fx.reasons")}</span>
                  <CorrectionReasons value={fixReasons} onChange={setFixReasons} />
                  <ReasonField id="af-fix-reason" rows={2} value={fixReason} onChange={setFixReason} session={session} ctx={ctx} chapter={item.chapter} verse={item.verse} placeholder={t("fx.whyHint")} ariaLabel={t("fx.why")} />
                  <p className="af-hint">{t("af.fixHint")}</p>
                  <div className="af-row-buttons">
                    <Button type="button" size="sm" disabled={saving || !fixText.trim()} onClick={() => void saveFix()}>
                      {saving ? t("af.saving") : tally?.decided && canConfirm ? t("af.saveFix") : t("fx.fixNow")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setFixing(false)}>
                      {t("af.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <WordPicker text={verseText} selected={selected} onChange={setSelected} />
                  <VerseCorrections session={session} target={data.draft} book={data.book} chapter={item.chapter} verse={item.verse} />
                <p className="af-hint" data-needed={needsWords ? "true" : undefined}>
                    {t("af.tapMarked")
                      .replace("{res}", data.resource === "tps" ? "TPS" : "TPL")
                      .replace("{marked}", markedWords ? `«${markedWords}»` : t(termSlug ? "af.theTerm" : "af.theMarked"))}{" "}
                    {t("af.runHint")}
                  </p>
                </>
              )}
            </div>
  
              {/* While the verse is being corrected the answer is not what is in hand: this bar, which stays at the
                  foot of a phone, stood over the button that saves the correction. */}
              {fixing ? null : (
              <div className="af-decide">
                <Button type="button" disabled={needsWords} title={needsWords ? t("af.pickFirst") : undefined} onClick={() => setConfirmed(true)}>
                  <Check size={16} aria-hidden /> {t("af.confirmWords")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    // Missing from the translation: what is left is to propose a change or object.
                    setConfirmed(true);
                    setChoosing(true);
                  }}
                >
                  {t("af.notThere")}
                </Button>
              </div>
              )}
            </>
          ) : (
            // Step 2 of 2: whether those words keep the rule of the TPL or the TPS.
            <>
              <p className="af-stepname">{t("af.step2").replace("{res}", data.resource === "tps" ? "TPS" : "TPL")}</p>
              {/* What is judged, in two labelled rows: what is marked in the reference, and the verse of the translation
                  with the words chosen marked in it. One line «וּבִשְׁנַת → TPS Durante el … año» mixed two directions of
                  writing and showed the words without the verse they are judged in (16 October). */}
              <div className="af-recap af-recap--rows">
                <p className="af-recap__row">
                  {/* «Hebreo», not «Hebreo (UHB)»: the edition is said where the reference is chosen. */}
                  <span className="af-recap__lbl">{reference?.label.replace(/\s*\(.*\)\s*$/, "") || t("af.refLabel")}</span>
                  <span className={reference?.id === "orig" ? "af-orig af-recap__ref" : "af-recap__ref"} lang={reference?.id === "orig" ? "grc" : undefined} dir="auto">
                    {/* The words of the original open their sheet (lemma, meaning, form), as they do over the words to
                        choose: here they were letters to look at, and the smallest on the box (16 October). */}
                    {reference?.id === "orig" && refMarked.length ? (
                      <OriginalWords text={refVerse} words={data.originalWords[`${item.chapter}:${item.verse}`]} only={refMarked} onOpen={(word) => setSheetWord({ word, chapter: item.chapter, verse: item.verse })} />
                    ) : (
                      markedWords || t("af.theMarked")
                    )}
                  </span>
                </p>
                <p className="af-recap__row">
                  <span className="af-recap__lbl">{data.resource === "tps" ? "TPS" : "TPL"}</span>
                  {selected.length ? (
                    <span className="af-recap__verse">
                      {(() => {
                        const words = wordSpans(verseText);
                        const shown = shownWords(words);
                        const { from, to } = selectionWindow(words.length, selected);
                        return (
                          <>
                            {from > 0 ? "… " : null}
                            {/* Words chosen one after the other are one mark: «Durante el», not «Durante» and «el». */}
                            {words
                              .slice(from, to)
                              .reduce<{ chosen: boolean; words: typeof words }[]>((runs, word) => {
                                const chosen = selected.includes(word.index);
                                const last = runs[runs.length - 1];
                                if (last && last.chosen === chosen) last.words.push(word);
                                else runs.push({ chosen, words: [word] });
                                return runs;
                              }, [])
                              .map((run, at) => (
                                <span key={run.words[0]!.index}>
                                  {at ? " " : null}
                                  <span className={run.chosen ? "af-recap__chosen" : undefined}>
                                    {run.words.map((word, i) => (
                                      <span key={word.index} data-implied={shown[word.index]?.implied ? "true" : undefined}>
                                        {i ? " " : null}
                                        {shown[word.index]?.text ?? word.text}
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              ))}
                            {to < words.length ? " …" : null}
                          </>
                        );
                      })()}
                    </span>
                  ) : (
                    <b>{t("af.nothingChosen")}</b>
                  )}
                </p>
                <button
                  type="button"
                  className="af-link af-recap__change"
                  onClick={() => {
                    setConfirmed(false);
                    // The words to choose again open under the screen (their box started at 752 px of 812).
                    window.setTimeout(() => document.querySelector(".af-draft__words")?.scrollIntoView({ block: "center" }), 80);
                  }}
                >
                  {t("af.changeWords")}
                </button>
              </div>
          {/* 3. Whether those words keep the rule of the TPL or the TPS, and the answer. */}
            <div className="af-ask">
              {(() => {
                // The question names what the box above shows: the words chosen in the translation and the words
                // highlighted in the original. It named the term's title («Israel, israelitas»), which is neither, and
                // left the person to work out what it was about (16 October).
                const ask = stepProp === "palabras" ? termAsk(data.termUses.filter((use) => use.termSlug === termSlug), comparison, item.id) : "compare";
                const key: MessageKey =
                  stepProp === "notas" ? QUESTION.notas[data.resource] : data.resource === "tps" ? QUESTION.palabras.tps : ask === "compare" ? QUESTION.palabras.tpl : "af.qPalabrasFirst";
                const marked = (markedWords || "").split(/\s+/).filter(Boolean);
                // A long highlight is shortened to its first words and its last; marks of words left out («…») are one.
                const orig = (marked.length > 4 ? `${marked.slice(0, 2).join(" ")} … ${marked[marked.length - 1]}` : marked.join(" ")).replace(/…(\s*…)+/g, "…");
                const isOrig = reference?.id === "orig";
                return (
                  <>
                    <p className="af-question">
                      {t(key)
                        .split(/(\{words\}|\{orig\})/)
                        .map((piece, at) =>
                          piece === "{words}" ? (
                            <span key={at} className="af-question__words">«{chosenWords || t("af.theWords")}»</span>
                          ) : piece === "{orig}" ? (
                            <span key={at}>
                              «<bdi className={isOrig ? "af-orig af-question__orig" : undefined} lang={isOrig ? "hbo" : undefined}>{orig || t("af.theMarked")}</bdi>»
                            </span>
                          ) : (
                            piece
                          ),
                        )}
                    </p>
                    {/* The first time a key word of the TPL is reviewed it sets the word for the rest of the book. */}
                    {stepProp === "palabras" && data.resource !== "tps" && ask !== "compare" ? <p className="af-criterion af-criterion--hint">{t(ask === "only" ? "af.qOnlyNote" : "af.qFirstNote")}</p> : null}
                  </>
                );
              })()}
              {elsewhere.length ? (
                // What the question is about, where it is asked: how this term reads in its other places. It was
                // shown a step before, over the words to touch, and was out of sight when the answer was given.
                <div className="af-elsewhere">
                  <p className="af-lbl">{t("af.elsewhere")}</p>
                  <ul>
                    {elsewhere.map((r) => (
                      <li key={r.text} data-preferred={preferredTerms[termSlug]?.text.trim().toLowerCase() === r.text.trim().toLowerCase() ? "true" : undefined}>
                        <b>«{r.text}»</b> <span>{r.uses.map((u) => `${u.chapter}:${u.verse}`).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Asked, not warned: «salvación», «habiendo salvado» and «sálvenlos» are three forms and one translation. */}
                  {elsewhere.length > 1 ? <p className="af-hint">{t("af.manyForms").replace("{n}", String(elsewhere.length))}</p> : null}
                  {/* Said, not shouted: in the TPS another form may say the same. */}
                  {chosenWords && !elsewhere.some((r) => r.text.trim().toLowerCase() === chosenWords.trim().toLowerCase()) ? <p className="af-hint af-differs">{t("af.differsElsewhere").replace("{words}", chosenWords)}</p> : null}
                </div>
              ) : null}
              {stepProp === "notas" || said.criterion ? (
                // The rule of the text, small under the question: the question asks about the words, this says what
                // «well» means in this text.
                <p className="af-criterion af-criterion--hint">{said.criterion ?? t(data.resource === "tps" ? "af.guideTps" : "af.guideTpl")}</p>
              ) : null}
              {mine ? <p className="af-saved"><Check size={16} aria-hidden /> {t("af.myAnswer").replace("{stance}", stanceLabel(mine.status))}{plainAgreement && tally ? <span className="af-saved__count"> · {agreeCount}</span> : null}</p> : null}
              {mine && !changing ? (
                // Answered: what there is to do here is nothing, or change it. The same buttons as before answering
                // were read as a point still to answer.
                <div className="af-row-buttons">
                  <Button type="button" variant="outline" onClick={() => setChanging(true)}>
                    {t("af.changeMine")}
                  </Button>
                </div>
              ) : !mine && agreeing.length && !choosing && !pending ? (
                <p className="af-hint af-ask-agree">{plainAgreement ? <b>{agreeCount}</b> : null}{plainAgreement ? " · " : null}{t(agreeing.length === 1 ? "af.othersAgreeOne" : "af.othersAgreeMany").replace("{who}", agreeing.map((who) => `@${who}`).join(", "))}</p>
              ) : null}
              {/* Somebody who is not yet «habilitada» agreed and read «0 de 3 de acuerdo» over their own answer. */}
              {mine?.status === "approved" && !reviewing && !countsForMinimum(levelOf(teamLevels, me)) ?<p className="af-hint">{t("af.notCounted").replace("{level}", levelLabel("habilitada", language))}</p> : null}
              {!choosing && !pending && (!mine || changing) ? (
                // The decision sits under what is decided. Agreeing is about the words chosen: none chosen, nothing to agree with yet.
                <div className="af-decide">
                  <Button type="button" disabled={saving || needsWords} title={needsWords ? t("af.pickFirst") : undefined} onClick={() => void answer("approved")}>
                    <Check size={16} aria-hidden /> {t("af.yesFine")}
                  </Button>
                  <Button type="button" variant="outline" disabled={saving} onClick={() => setChoosing(true)}>
                    {t("af.otherAnswer")}
                  </Button>
                  {alike.length && !needsWords ? (
                    // The uses that read the same are agreed with here; the person stops where the term reads otherwise.
                    <Button type="button" variant="outline" className="af-alike" disabled={saving} onClick={() => void answerAlike()}>
                      <Check size={16} aria-hidden /> {t(alike.length === 1 ? "af.alikeOne" : "af.alikeMany").replace("{n}", String(alike.length))}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {choosing && !pending && (!mine || changing) ? (
                <div className="af-row-buttons">
                  <Button type="button" variant="outline" onClick={() => setPending("revise")}>
                    {t("rv.revise")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setPending("rejected")}>
                    {t("rv.rejected")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => {
                      setChoosing(false);
                      // A closed point opened by mistake closes again.
                      if (reopened) {
                        setReopened(false);
                        setChanging(false);
                      }
                    }}>
                    {t("af.cancel")}
                  </Button>
                </div>
              ) : null}
              {pending ? (
                <div className="af-why" ref={whyRef}>
                  <label htmlFor="af-note" className="af-lbl">
                    {pending === "revise" ? t("af.whatChange") : t("af.whatObjection")}
                  </label>
                  <textarea id="af-note" className="af-textarea" rows={3} value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
                  <div className="af-row-buttons">
                    <Button type="button" disabled={saving || !note.trim()} onClick={() => void answer(pending)}>
                      {saving ? t("af.saving") : t("af.send")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setPending(null);
                        setChoosing(false);
                      }}
                    >
                      {t("af.cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            </>
          )}
          </div>
        </section>
      ) : null}


      {data && !item && !busy ? (
        <div className="hub-empty-panel">
          <h2 className="hub-empty-panel__title">{stepProp === "palabras" ? t("af.noKeywords") : t("af.noNotes")}</h2>
          <p className="hub-empty-panel__body">{t("af.notesFrom").replace("{src}", data.notesSource)}</p>
        </div>
      ) : null}
    </div>
  );
}
