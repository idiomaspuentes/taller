import { termAsk } from "../domain/afinacionWords";
import { openTextProposal } from "../dcs/alignmentDecisionStore";
import { toolHeading } from "./toolHeading";
import { ToolHeader } from "./ToolHeader";
import { guide, guideDid, useGuideOpener, useGuideRun } from "../guide";
import { StageWindow } from "./StageWindow";
import { TuningGuide } from "./tuningGuides";
import { PassageIntroText, StepAsk } from "./StepAsk";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSession, type GtSession } from "../dcs/auth";
import { chapterTextOf, draftTaskId, groupDraftBranches, loadAfinacionNotes, loadArticleBody, loadArticleInfo, loadTermArticle, loadTermTitles, type AfinacionNotesData, type AfinacionStep, type ChapterText, type OriginalWord } from "../dcs/afinacionLoad";
import { ChapterPair } from "./ChapterReader";
import { chaptersOf } from "../domain/parallelChapter";
import { bookLabel } from "../domain/books";
import { MoreMenu } from "./MoreMenu";
import { draftLabelOf, HelpVersions } from "./HelpVersions";
import { readTeamArticle, readTeamNotes } from "../dcs/teamHelps";
import { loadPmConfig } from "../dcs/issues";
import { DEFAULT_PM_CONFIG, type PmConfig } from "../domain/roles";
import { tryReadExistingBookUsfm } from "../dcs/bookBootstrap";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
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
import { articleName, articlePathOf, articleShortName, groupByCategory, sortByVerse, type ArticleInfo, type NoteItem } from "../domain/afinacionNotes";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Info, Lock, Maximize2, Pencil, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { HelpMessages } from "./HelpMessages";
import { changeMyStudyNotes } from "../dcs/studyNotes";
import { uid } from "../domain/assignment";
import { articleMessageKey, termMessageKey, type StudyNote } from "../domain/studyNotes";
import { articleBody, parseArticleTitle, termArticlePath, termWord, snippetAround, compareTermRenderings, firstUnanswered, orderTermUses, renderingsElsewhere, sameRenderingUses, termDefinition, termLabel, type PreferredTerms, type TermItem, type TermOrder } from "../domain/afinacionWords";
import { referenceExcerpt, selectionFromWords, shownWords, wordSpans, wordsOfSelection } from "../domain/afinacionSelection";
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
  fromTc,
  type ReviewDecision,
  type ReviewStance,
  selectionKey,
} from "../domain/reviewRound";
import { tcCheckerOf } from "../domain/tcImport";
import { canConfirmForTeam, confirmersOf, coordinatorsOf, countsForMinimum, levelLabel, levelOf, levelsForTeam, meetsLevel } from "../domain/levels";
import { closesInItsTool } from "../domain/stepClaim";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { sayUntilNow, useOpenWindow, useSayUntil } from "../useOpenWindow";
import { deliverSharedSubtask } from "../dcs/deliverShared";
import { useStepWork } from "../dcs/stepWork";
import { FinalDecision, MeetingChip, RoundPanel } from "./RoundPanel";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage, sourcePackageLang } from "../domain/sourcePackage";
import { readingOmits, stepPurpose } from "../domain/processes";
import { withoutSections } from "../domain/articleSections";
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
import { PersonPhoto } from "./PersonPhoto";

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
  // An observation, not an objection: about a note or a word, «objeción» read as a quarrel (18 October).
  rejected: "af.observation",
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


/** `only`: just those words of the verse, with «…» where others are left out (see `referenceExcerpt`). */
/**
 * The words of `after`, each said changed or not against `before`: what a proposal changes, marked in green beside
 * today's verse, which stays as it is (Abel, 11 November, «Su propuesta»).
 */
function changedWords(before: string, after: string): { text: string; changed: boolean }[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const same = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) same[i]![j] = a[i] === b[j] ? same[i + 1]![j + 1]! + 1 : Math.max(same[i + 1]![j]!, same[i]![j + 1]!);
  const out: { text: string; changed: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      out.push({ text: b[j]!, changed: false });
      i += 1;
      j += 1;
    } else if (i < a.length && same[i + 1]![j]! >= same[i]![j + 1]!) i += 1;
    else {
      out.push({ text: b[j]!, changed: true });
      j += 1;
    }
  }
  return out;
}

function Words({ text, marked, onTap, selected, only }: { text: string; marked?: number[]; onTap?: (i: number) => void; selected?: number[]; only?: number[] }) {
  const t = useT();
  const all = wordSpans(text);
  if (!all.length) return <span className="af-empty">{t("af.noText")}</span>;
  const words = only ? all.filter((w) => only.includes(w.index)) : all;
  const cutBefore = Boolean(only && words.length && words[0]!.index > 0);
  const cutAfter = Boolean(only && words.length && words[words.length - 1]!.index < all[all.length - 1]!.index);
  return (
    <span className="af-words" dir={isRtl(text) ? "rtl" : undefined}>
      {cutBefore ? <span className="af-word__gap" aria-hidden>… </span> : null}
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
      {cutAfter ? <span className="af-word__gap" aria-hidden> …</span> : null}
    </span>
  );
}

/** A verse of the translation with the words chosen marked; words chosen one after the other are one mark. */
function ChosenWords({ text, selected }: { text: string; selected: number[] }) {
  const runs = wordSpans(text).reduce<{ chosen: boolean; words: string[]; at: number }[]>((all, word) => {
    const chosen = selected.includes(word.index);
    const last = all[all.length - 1];
    if (last && last.chosen === chosen) last.words.push(word.text);
    else all.push({ chosen, words: [word.text], at: word.index });
    return all;
  }, []);
  return (
    <>
      {runs.map((run, at) => (
        <span key={run.at}>
          {at ? " " : null}
          <span className={run.chosen ? "af-recap__chosen" : undefined}>{run.words.join(" ")}</span>
        </span>
      ))}
    </>
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
  /**
   * The note of a challenge, or what a key word means: a help, opened when the highlight, the words of the original
   * and the name of the challenge are not enough (Abel, 18 October). Open beside the work it took a column of its
   * own and was read before the question; it starts closed, and stays as this person left it, for each kind of step.
   */
  const reasonKey = `taller-af-reason:${stepProp}`;
  const [showReason, setShowReason] = useState(() => {
    try {
      return localStorage.getItem(reasonKey) === "1";
    } catch {
      return false;
    }
  });
  /** On a phone the help is a sheet over the point: open only while it is read, never from one point to the next. */
  const [sheetOpen, setSheetOpen] = useState(false);
  /** The whole chapter in the reference and the translation, to see the point in its place. */
  const [chapterOpen, setChapterOpen] = useState(false);
  /** In the chapter sheet: the chapter read (the point's, unless another is chosen), and the team's other text beside. */
  const [pairChapter, setPairChapter] = useState<number | null>(null);
  /**
   * The texts read beside the draft in the chapter sheet, as in the tab «Capítulo» it replaced: any of the original,
   * the ULT, the UST and the team's other text, up to three (four columns with the draft, which is always there).
   * `null`: the reference chosen in the point, as the sheet opens the first time.
   */
  const [pairTexts, setPairTexts] = useState<string[] | null>(null);
  /** The introductions of the book and the chapter, and how a key term reads in the whole book: sheets over the point. */
  const [introOpen, setIntroOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  /** A verse of the chapter being changed there: reading the chapter, a verse that needs it is proposed at once. */
  const [pairFix, setPairFix] = useState<{ chapter: number; verse: number; text: string } | null>(null);
  const [pairReasons, setPairReasons] = useState<CorrectionReason[]>([]);
  const [pairReason, setPairReason] = useState("");
  const [pairError, setPairError] = useState("");
  const toggleReason = (shown: boolean) => {
    setShowReason(shown);
    try {
      localStorage.setItem(reasonKey, shown ? "1" : "0");
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
  // As the text comes, by default: the team reads a passage verse by verse, and the points of one figure or term
  // together are a choice (18 October).
  const [order, setOrder] = useState<TermOrder>("text");
  const [openedAt, setOpenedAt] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<ReviewStance | null>(null);
  /** «Otra respuesta» was pressed: the two other answers are offered in the card. */
  const [, setChoosing] = useState(false);
  /** Step 2: the words of the translation are confirmed; what is asked now is whether they keep the rule. */
  const [confirmed, setConfirmed] = useState(false);
  /**
   * Step 1 of 3 done for the point in hand: the reviewer said whether its challenge is there (or whether the key term
   * has that sense here), after reading the original and, when needed, the note. The team of Esdras fought the tool
   * over a «personificación» that for them was a sinécdoque: it only asked whether the TPL kept it (18 October).
   */
  const [studied, setStudied] = useState(false);
  /** What they said of it, kept with their answer; `null` until said. */
  const [study, setStudy] = useState<{ applies: boolean; note?: string } | null>(null);
  /** Saying what they see instead: its box is open. */
  const [doubting, setDoubting] = useState(false);
  const [doubtText, setDoubtText] = useState("");
  /** Somebody else already chose the words of this point: after step 1 the person goes to whether they are right. */
  const othersChose = useRef(false);
  /** Remounts the messages of the point after one was left from step 1, so it is read there. */
  const [messagesSeen, setMessagesSeen] = useState(0);
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
  /** The text the draft is read against: the original unless the person chose another. */
  // The point is read in the original; the ULT or the UST is read under it, not in its place.
  const refText = "orig" as "orig" | "ult" | "ust";
  /** The text read under the original in step 1. */
  const [glossText, setGlossText] = useState("ult");
  /**
   * The text read under «Ver más» in Marcar: the original too, since this screen does not show it apart (Abel, 12
   * November). `null`: the one read under the original in Estudiar.
   */
  const [seekText, setSeekText] = useState<string | null>(null);
  /** «Revisar» (the item in hand) or «Capítulo» (whole chapters of a text, to read around it). */
  const [pane, setPane] = useState<"review" | "helps" | "chapter" | "intro">("review");
  // The team's other text (the TPS beside a TPL being tuned), read once the chapter is opened.
  const [otherText, setOtherText] = useState<ChapterText | null>(null);
  /** The text read in «Leer el capítulo»: the original, an English text, or what the team's draft has so far. */
  /** The article open to be read in full: its path, and its text once it arrives (`null` = it could not be read). */
  /**
   * The article being read: as the team has it (a draft, or published) and as the source has it. `body` is what is
   * read first, the team's when it has one.
   */
  const [reading, setReading] = useState<{ path: string; body?: string | null; team?: { text: string; draft: boolean } | null; source?: string | null } | null>(null);
  /**
   * The team's translated notes, to read beside the source's: a draft until harmonized, and said to be one, so
   * that whoever refines the text can say what to improve in it (18 October). `undefined` while being read.
   */
  const [pmConfig, setPmConfig] = useState<PmConfig | null>(null);
  const [teamNotes, setTeamNotes] = useState<Awaited<ReturnType<typeof readTeamNotes>> | undefined>(undefined);
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
    // The team's article, a draft too (said to be one), beside the source's: it was read only once published.
    const config = pmConfig ?? (ctx.pmOrg ? await loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG) : DEFAULT_PM_CONFIG);
    const [own, source] = await Promise.all([
      readTeamArticle({ session, ctx, pmConfig: config, board: plan, pkg: data.sourcePackage, resource: "academia", path }).catch(() => null),
      loadArticleBody(session, ctx, data.sourcePackage, path, { teamFirst: false }).catch(() => null),
    ]);
    const team = own?.text && (own.where === "draft" || own.where === "published") ? { text: own.text, draft: own.where === "draft" } : null;
    setReading((current) => (current?.path === path ? { path, body: team?.text ?? source, team, source } : current));
  }

  useEffect(() => {
    if (!session || !ctx?.pmOrg) return;
    let alive = true;
    void loadPmConfig(session, ctx.pmOrg)
      .catch(() => DEFAULT_PM_CONFIG)
      .then((config) => alive && setPmConfig(config));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, ctx?.pmOrg]);
  useEffect(() => {
    if (!session || !ctx || !pmConfig || !data || stepProp !== "notas") return;
    let alive = true;
    void readTeamNotes({ session, ctx, pmConfig, board: plan })
      .then((notes) => alive && setTeamNotes(notes))
      .catch(() => alive && setTeamNotes(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, ctx?.book, pmConfig, plan, Boolean(data), stepProp]);
  /** What a draft of the notes is called: from the phase of the task that translates them («fase 1: Traducción»). */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const notesDraftLabel = useMemo(() => draftLabelOf(plan, "notas", t, language), [plan, language]);

  const groups = useMemo(() => (data ? groupByCategory(data.items) : []), [data]);
  /** What a group of points is called in the list: «Modismo», «Nombres», «Términos clave». */
  const groupName = (group: { category: string; label: string; items: NoteItem[] } | undefined) =>
    !group ? "" : stepProp === "notas" ? articleShortName(group.items[0]!, articles[articlePathOf(group.items[0]!.supportRef)], (label) => localizeAfinacion(label, language)) : localizeAfinacion(group.label, language);
  /** How many points of a group the team has agreed. */
  const groupDone = (items: NoteItem[]) => (summary ? items.filter((row) => summary.items.find((one) => one.itemId === row.id)?.state === "agreed").length : 0);
  const [filterOpen, setFilterOpen] = useState(false);
  const visible = useMemo(() => {
    const shown = groups.filter((g) => category === "all" || g.category === category).flatMap((g) => g.items);
    if (stepProp === "palabras") return orderTermUses(shown as TermItem[], order) as NoteItem[];
    // The notes come grouped by challenge; as the text comes, they are put back in the order of their verses.
    return order === "text" ? sortByVerse(shown) : shown;
  }, [groups, category, order, stepProp]);
  const item: NoteItem | undefined = visible[Math.min(position, Math.max(visible.length - 1, 0))];

  const taskStep = task?.steps?.find((s) => s.id === (ctx?.stepId || stepProp));
  /** What the step is for and the rule it measures against, as the process says them. */
  const said = stepPurpose(task?.id ?? ctx?.taskId ?? "", taskStep, language);
  const heading = toolHeading(ctx, language, t(TITLE[stepProp]));
  const taskLabel = ctx?.taskName ? localizeName(ctx.taskName, language) : "";
  /** «Sobre esta tarea», opened from the header («Más») or the guide. */
  const [aboutOpen, setAboutOpen] = useState(false);
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

  // An agreed item stays open for those seated on the step.
  const { open, wakeAt } = useOpenWindow({ session, pmOrg: ctx?.pmOrg, issueNumber: ctx?.issueNumber, step: taskStep, closed: stepDone });
  const sayUntil = useSayUntil();
  const tally = item && data
    ? tallyItem({ itemId: item.id, decisions, currentHash: hash, levels: teamLevels, authors: [], thresholds, confirmers, tcCloses: stepDone, open })
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
  /** The point is shown closed, with the one way to open it again; the team's box then only says who answered. */
  const closedView = Boolean(tally?.decided) && !reopened && !fixing;
  /** «No del todo…»: the sheet with the two ways to say why (propose other words, comment to the team). */
  const [noSheet, setNoSheet] = useState(false);
  /** The words of the original open their meaning only when asked: underlined all, the verse looked touchable. */
  /**
   * The verse card of step 1 shows the original alone; «Ver más» opens under it the ULT, the other texts, the chapter
   * and the other books (Abel, 11 November). Whoever opens it keeps it open from one point to the next, on this device.
   */
  /**
   * The note of a challenge in step 1, folded under its article until asked for (Abel, 12 November): the question
   * asks whether the highlight is a case of the article, and a note that says, by mistake, that it is something
   * else confused the answer when it was read first. Folded again on every point.
   */
  const [noteOpen, setNoteOpen] = useState(false);
  /** What more there is to see under the translation's verse in steps 2 and 3, folded at the foot of its card. */
  const [draftMore, setDraftMore] = useState(false);
  const [refMore, setRefMore] = useState(() => {
    try {
      return localStorage.getItem("taller-af-refmore") === "1";
    } catch {
      return false;
    }
  });
  const toggleRefMore = () => {
    setRefMore(!refMore);
    try {
      localStorage.setItem("taller-af-refmore", refMore ? "0" : "1");
    } catch {
      /* private window: open for this visit only */
    }
  };
  // Another point: closed as it is. Not on an answer to this one: a point opened again stays open for the answer just
  // given (with «Reabrir» alone, the person had no way on).
  useEffect(() => {
    setReopened(false);
    setNoteOpen(false);
    setDraftMore(false);
  }, [item?.id]);
  // Steps 2 and 3 fold the same: what was opened under the words to mark is closed under the words to judge.
  useEffect(() => {
    setDraftMore(false);
  }, [confirmed]);
  /** An answer in the words of the button that gave it: «Usted dijo: De acuerdo» answered «Sí, está bien». */
  const saidAs = (status: string) => t(status === "approved" ? "af.yesFine" : status === "revise" ? "rv.revise" : "af.observation");
  /** The list of the points, from «Frase 3 de 82»: the arrows between points are gone (11 November). */
  const [listOpen, setListOpen] = useState(false);
  /** The stage of the point on screen, when one is: 1 Estudiar, 2 Marcar, 3 Decidir. */
  const phase: 1 | 2 | 3 | null = data && item && pane === "review" && !busy && !closedView ? (!studied ? 1 : !confirmed ? 2 : 3) : null;
  /*
   * What is done here, said before it is done. The tuning team is made of older people who fear that a touch may
   * spoil the work (Abel, 11 November): on entering the task, a window says what it is about; at each stage of the
   * first point of the visit, another says what the stage asks and whether anything is kept, and offers its walk.
   * From then on a line under the steps says it, and «¿Qué hago aquí?» opens the window again.
   */
  const [taskWindow, setTaskWindow] = useState(true);
  const [stageWindow, setStageWindow] = useState<1 | 2 | 3 | null>(null);
  const stagesSaid = useRef(new Set<number>());
  const guideRun = useGuideRun();
  const taskWindowOpen = taskWindow && Boolean(data) && !busy;
  useEffect(() => {
    // Not over a walk still going (its last word, after the stage it showed), nor over the window of the task.
    if (!phase || taskWindowOpen || stageWindow || guideRun || stagesSaid.current.has(phase)) return;
    stagesSaid.current.add(phase);
    setStageWindow(phase);
  }, [phase, taskWindowOpen, stageWindow, guideRun]);
  // «Guía» opens the window of the step in hand, which offers its walk.
  useGuideOpener(phase ? () => setStageWindow(phase) : null);
  const openUntilText = (until: string) => sayUntil("round.openUntil", until);
  const agreeCount = tally ? (tally.state === "agreed" && tally.openUntil ? openUntilText(tally.openUntil) : tally.state === "agreed" ? t("af.teamAgreed").replace("{n}", String(tally.agree)) : t("af.agreeCount").replace("{n}", String(tally.agree)).replace("{of}", String(thresholds.minAgree))) : "";
  // Beside one's own answer the open time is for the others: «De acuerdo» twice, and an invitation to give the view
  // already given, was what it read.
  const mineCount = tally?.state === "agreed" && tally.openUntil ? sayUntil("af.openToOthers", tally.openUntil) : agreeCount;

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
            tcCloses: stepDone,
            open,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, decisions, thresholds.minAgree, thresholds.minIndependent, teamLevels, confirmers, stepDone, open],
  );
  useEffect(() => wakeAt((summary?.items ?? []).map((point) => point.openUntil)), [summary, wakeAt]);
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

  /** This person's answer to a point, as it counts: not one to a verse corrected since, nor one from translationCore. */
  const myAnswerOf = (row: NoteItem) => {
    const hash = textFingerprint(data?.draftVerses[row.verse] ?? "");
    return decisions
      .filter((d) => d.itemId === row.id && d.reviewer.trim().toLowerCase() === me && !fromTc(d) && (d.textHash === undefined || d.textHash === hash))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  };
  const answeredByMe = useMemo(() => {
    if (!data) return 0;
    return data.items.filter((row) => {
      const hash = textFingerprint(data.draftVerses[row.verse] ?? "");
      return decisions.some((d) => d.itemId === row.id && d.reviewer.trim().toLowerCase() === me && !fromTc(d) && (d.textHash === undefined || d.textHash === hash));
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
  async function decide(text: string, selectedText?: ReviewDecision["selectedText"]) {
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
        // Choosing between agreements on different words: the team's decision is about those words.
        ...(selectedText ? { selectedText } : {}),
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
  const kindRef = useRef<HTMLButtonElement>(null);
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
  const allAgreed = Boolean(summary?.allAgreed);
  useEffect(() => {
    if (!allAgreed || stepDone) return;
    // After the next point has been brought to its top, which the last answer also asks for.
    const later = window.setTimeout(() => roundRef.current?.scrollIntoView({ block: "start" }), 200);
    return () => window.clearTimeout(later);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAgreed]);

  /** The point after this one that waits for this person; after the last, the next in the list; -1 at the end. */
  function nextFrom(at: number, given = decisions): number {
    if (!data) return -1;
    const next = firstUnanswered({ items: visible, decisions: given, me, hashOf: (id) => textFingerprint(data.draftVerses[visible.find((row) => row.id === id)?.verse ?? 0] ?? ""), from: at + 1, settled });
    return next >= 0 ? next : at < visible.length - 1 ? at + 1 : -1;
  }
  /** To another point of the list, from the list or after an answer. */
  function goTo(index: number) {
    setListOpen(false);
    setPosition(index);
  }

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
    setArticleOpen(false);
    // Somebody already chose the words: what is asked is whether one agrees with them, at the last step. It opened
    // at the marking, as if nothing had been done, and Miguel answered again a point Ramón had answered (16 October).
    // Each person studies the point first all the same: that is what the first step is for.
    othersChose.current = theirs.length > 0;
    setConfirmed(Boolean(saved) && !again);
    setStudied(Boolean(saved));
    setStudy(saved?.challenge ?? null);
    setDoubting(false);
    setDoubtText("");
    // The person's own answers arrive after the item is shown: an item they answered opens at its second step. The
    // answers of the others, read again every so often, do not move what this person is doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, verseText, answersRead, mineHere]);


  // Words step: how this term was rendered in every use across the book.
  const termSlug = item && "termSlug" in item ? (item as TermItem).termSlug : "";
  const termKey = termSlug ? termMessageKey((item as TermItem).termKind, termSlug) : "";
  /**
   * The article of the term in hand, by slug: as the team has it (a draft too, said to be one) and as the source has
   * it, to read one or the other as the notes are read (18 October). `null` when neither can be read.
   */
  const [termArticles, setTermArticles] = useState<Record<string, { team: { text: string; draft: boolean; title: string } | null; source: string | null } | null>>({});
  useEffect(() => {
    if (!session || !ctx || !data || !termSlug || termSlug in termArticles) return;
    let cancelled = false;
    const term = item as TermItem;
    void (async () => {
      const config = pmConfig ?? (ctx.pmOrg ? await loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG) : DEFAULT_PM_CONFIG);
      const [own, source] = await Promise.all([
        readTeamArticle({ session, ctx, pmConfig: config, board: plan, pkg: data.sourcePackage, resource: "palabras", path: termArticlePath(term.termKind, term.termSlug) }).catch(() => null),
        loadTermArticle(session, data.sourcePackage, term, ctx, config, { teamFirst: false }).catch(() => null),
      ]);
      const team = own?.text && (own.where === "draft" || own.where === "published") ? { text: own.text, draft: own.where === "draft", title: own.title } : null;
      if (!cancelled) setTermArticles((had) => ({ ...had, [termSlug]: team || source ? { team, source } : null }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, ctx, data, termSlug]);
  const termRead = termSlug ? termArticles[termSlug] : undefined;
  /** What is read first of the term's article: the team's when it has one. */
  const termArticle = termRead === undefined ? undefined : termRead ? (termRead.team?.text ?? termRead.source) : null;
  const definition = termArticle ? termDefinition(termArticle) : "";
  /**
   * The term's name as the team's article has it, a draft too: the definition read in Spanish under «Qué significa
   * «day»», the title of the published articles only (18 October).
   */
  const teamTermTitle = termRead?.team?.title?.trim() ?? "";
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
        ...(study ? { challenge: study } : {}),
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      if (status !== "approved") await tellTeam(`${stanceLabel(status)}: ${words}`);
      // With this answer everything is agreed, and this person may not close the review: whoever coordinates is
      // told. Nobody was: the round stood at «30 de 30» until somebody who may close it happened to open the tool.
      if (status === "approved" && closesHere && !canConfirm && !stepDone && summary && !summary.allAgreed && ctx.pmOrg && ctx.issueNumber) {
        const round = summarizeRound({
          itemIds: data.items.map((i) => i.id),
          decisions: [...decisions, decision],
          currentHashes: Object.fromEntries(data.items.map((i) => [i.id, textFingerprint(data.draftVerses[i.verse] ?? "")])),
          levels: teamLevels,
          authors: [],
          thresholds,
          confirmers,
          open,
        });
        const who = coordinatorsOf(data.levelBook, task?.orgTeamName).filter((login) => login.toLowerCase() !== me);
        if (round.allAgreed && who.length) {
          const tell = round.closesAt ? sayUntilNow("round.allAgreedTellOpen", round.closesAt) : tNow("round.allAgreedTell");
          await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, whileOpen(`${who.map((login) => `@${login}`).join(" ")} ${tell}`)).catch(() => undefined);
        }
      }
      setPending(null);
      setChanging(false);
      announce(t("af.savedAnswer").replace("{stance}", stanceLabel(status)));
      guideDid("af:answered");
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * «Propongo un cambio»: the verse as it should read, proposed to the team as a correction from the box is, and the
   * answer to the point that says so and where it is decided. It was a free text beside the point, which somebody
   * had to copy into the draft by hand (18 October).
   */
  async function proposeForPoint() {
    if (!session || !data || !item || !ctx) return;
    const text = fixText.trim();
    if (!text || text === verseText.trim()) return;
    const why = reasonLine(fixReasons, fixReason, t);
    setSaving(true);
    setError("");
    try {
      const opened = await openTextProposal({
        session,
        pmOrg: ctx.pmOrg,
        task: { projectId: ctx.projectId, taskId: ctx.taskId, taskName: ctx.taskName || ctx.taskId, resource: data.resource, parentIssue: ctx.issueNumber },
        target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
        draftFilepath: data.draft.filepath,
        book: data.book,
        chapter: item.chapter,
        verse: item.verse,
        oldText: data.draftVerses[item.verse] ?? "",
        newText: text,
        note: why || tNow("fx.proposalNote"),
        tell: Object.keys(teamLevels),
        thresholds,
      });
      setFixReason("");
      setFixReasons([]);
      await answer("revise", [tNow("af.proposedAnswer").replace("{n}", String(opened.issue.number)).replace("{text}", text), why].filter(Boolean).join(" — "));
    } catch (err) {
      setError(explainError(err));
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
      setDecisions((prev) => [...prev, ...batch]);
      announce(t("af.savedAlike").replace("{n}", String(batch.length)));
      guideDid("af:answered");
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

  /**
   * A change to any verse of the chapter, from the chapter sheet: always a proposal the team decides, as a correction
   * from the box is. Only a correction of the point the team has already decided is written at once, and that is
   * made in the box (18 October).
   */
  async function proposeInChapter() {
    if (!session || !data || !item || !ctx || !pairFix) return;
    const text = pairFix.text.trim();
    const before = data.bookDraft[`${pairFix.chapter}:${pairFix.verse}`] ?? "";
    if (!text || text === before.trim()) return setPairFix(null);
    setSaving(true);
    setPairError("");
    try {
      const opened = await openTextProposal({
        session,
        pmOrg: ctx.pmOrg,
        task: { projectId: ctx.projectId, taskId: ctx.taskId, taskName: ctx.taskName || ctx.taskId, resource: data.resource, parentIssue: ctx.issueNumber },
        target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
        draftFilepath: data.draft.filepath,
        book: data.book,
        chapter: pairFix.chapter,
        verse: pairFix.verse,
        oldText: before,
        newText: text,
        note: reasonLine(pairReasons, pairReason, t) || tNow("fx.proposalNote"),
        tell: Object.keys(teamLevels),
        thresholds,
      });
      announce(t("gr.proposed").replace("{ref}", `${pairFix.chapter}:${pairFix.verse}`).replace("{n}", String(opened.issue.number)));
      setPairFix(null);
      setPairReasons([]);
      setPairReason("");
    } catch (err) {
      setPairError(explainError(err));
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
  /**
   * The others who agree with the words this person has marked: they are asked whether they do too. Whoever agreed on
   * other words is not, and is said apart: «@Keneramk ya dijo que está bien» was read over words Abel had changed,
   * and his «sí» was counted with an agreement on other words (19 October).
   */
  const myWordsKey = selectionKey({ selectedText: { text: chosenWords } });
  const sameWords = (a: ReviewDecision) => selectionKey(a) === undefined || myWordsKey === undefined || selectionKey(a) === myWordsKey;
  /**
   * The agreements grouped by their words, when they differ from each other or from the words marked now: each
   * group with its words and who agreed on them, to take those words or (whoever coordinates) to choose them.
   */
  const wordGroupsOf = (answers: ReviewDecision[]) => {
    const groups = new Map<string, { key: string; words: string; selectedText: ReviewDecision["selectedText"]; people: ReviewDecision[] }>();
    for (const a of answers) {
      const key = a.status === "approved" ? selectionKey(a) : undefined;
      if (key === undefined) continue;
      const group = groups.get(key) ?? { key, words: a.selectedText!.text!.trim(), selectedText: a.selectedText, people: [] };
      group.people.push(a);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.people.length - a.people.length);
  };
  /** Marks the words somebody agreed on, to agree on the same: their words, here, in the verse as it is. */
  const takeWords = (selectedText: ReviewDecision["selectedText"]) => {
    if (!selectedText) return;
    setSelected(wordsOfSelection(verseText, selectedText));
    if (mine) setChanging(true);
  };
  /** Who agreed on other words than those marked now, with those words: the first group, the most agreed on. */
  const otherWords = (() => {
    const apart = others.filter((a) => a.status === "approved" && !sameWords(a));
    if (!apart.length) return null;
    const key = selectionKey(apart[0]!);
    const group = apart.filter((a) => selectionKey(a) === key);
    return { words: group[0]!.selectedText!.text!.trim(), who: group.map((a) => tcCheckerOf(a) ?? a.reviewer) };
  })();
  /**
   * Everybody who answered agrees, with nothing more said: no objection, no other words, nobody asked to answer,
   * nothing said before a correction. It is said in the line over the buttons, with how many agree.
   */
  const plainAgreement =
    Boolean(tally) && !tally?.decided && !closedView && !saidBefore.length && !tally?.open.length && !tally?.selections && !otherWords && listed.every((a) => a.status === "approved" && (!a.note || Boolean(tcCheckerOf(a))));
  /** «1 de 3 de acuerdo», or «Acordado · 3 de acuerdo». */
  // The words the item is about, marked in the text it is read against: in the original from the quote, in the
  // English texts through their alignment with it.
  const reference = data?.references.find((row) => row.id === refText) ?? data?.references[0];
  /** A text named by its language or its name, «Hebreo» or «ULT»: not «Hebreo (UHB)», nor «Original» (11 November). */
  const refName = (row: { id?: string; label: string } | undefined) =>
    row?.id === "orig" ? t(/UGNT|grieg|grec/i.test(row.label) ? "af.langGreek" : "af.langHebrew") : (row?.label ?? "").replace(/\s*\(.*\)\s*$/, "");
  /** The language of the original, in a sentence: «hebreo», «griego». */
  const origWord = (refName(data?.references.find((row) => row.id === "orig")) || t("af.qOriginal")).toLocaleLowerCase(language);
  const refVerse = item && reference ? (reference.book[`${item.chapter}:${item.verse}`] ?? "") : "";
  const refMarked = useMemo(() => {
    if (!item || !reference || !refVerse) return [] as number[];
    if (reference.id === "orig") return item.quote ? matchHelpQuoteToTokenIndices(tokenizeVersePlainText(refVerse), item.quote, item.occurrence) : [];
    return alignedGatewayQuoteForHelpQuote({ verseText: refVerse, quote: item.quote, occurrence: item.occurrence, alignments: reference.alignments, book: data!.book, chapter: item.chapter, verse: item.verse }).tokenIndices;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, reference?.id, refVerse]);
  /** What is marked in the reference, to say in the draft which words to look for. */
  const markedWords = useMemo(() => wordsAt(refVerse, refMarked), [refVerse, refMarked]);
  /** What is highlighted, short enough to name the point: its first words and its last when it is long. */
  const pointWords = useMemo(() => {
    const words = markedWords.split(/\s+/).filter(Boolean);
    return (words.length > 4 ? `${words.slice(0, 2).join(" ")} … ${words[words.length - 1]}` : words.join(" ")).replace(/…(\s*…)+/g, "…");
  }, [markedWords]);
  /** The texts read beside the draft in the chapter sheet. */
  const pairShown = pairTexts ?? [refText];
  /** The reference shown whole in steps 2 and 3, when asked for: a new point starts with its excerpt again. */
  const [refWhole, setRefWhole] = useState(false);
  useEffect(() => setRefWhole(false), [item?.id]);
  /** Steps 2 and 3: the words of the reference around what is highlighted, so the translation is in sight. */
  const refExcerpt = studied && !refWhole ? referenceExcerpt(wordSpans(refVerse).length, refMarked) : null;
  const refCut = studied && (refWhole || Boolean(refExcerpt));
  const refToggle = refCut ? (
    <button type="button" className={isRtl(refVerse) ? "af-link af-ref__whole af-ref__whole--rtl" : "af-link af-ref__whole"} onClick={() => setRefWhole(!refWhole)}>
      {t(refWhole ? "af.refLess" : "af.refWhole")}
    </button>
  ) : null;
  /**
   * The chapter opened in step 1 shows the references alone: that step studies them, and the team's texts are for
   * marking and deciding (steps 2 and 3). It showed the TPL beside them (19 October).
   */
  const refsOnly = !studied;
  /** The words of a reference that render what the point is about, in the point's verse. */
  const markedIn = (id: string, text: string): number[] => {
    if (!item || !data || !text) return [];
    if (id === "orig") return item.quote ? matchHelpQuoteToTokenIndices(tokenizeVersePlainText(text), item.quote, item.occurrence) : [];
    const row = data.references.find((one) => one.id === id);
    if (!row) return [];
    return alignedGatewayQuoteForHelpQuote({ verseText: text, quote: item.quote, occurrence: item.occurrence, alignments: row.alignments, book: data.book, chapter: item.chapter, verse: item.verse }).tokenIndices;
  };
  /** The verse in the ULT with the point marked, read under the original in step 1 and as its meaning in step 2. */
  // The original always stays on top in step 1; the text under it is the one chosen, the ULT unless the UST is
  // (Abel, 11 November).
  const glossRows = data?.references.filter((row) => row.id !== "orig") ?? [];
  const glossRow = glossRows.find((row) => row.id === glossText) ?? glossRows.find((row) => /ult/i.test(`${row.id} ${row.label}`)) ?? glossRows[0];
  const glossVerse = item && glossRow ? (glossRow.book[`${item.chapter}:${item.verse}`] ?? "") : "";
  const glossMarked = useMemo(
    () => (glossRow && glossVerse ? markedIn(glossRow.id, glossVerse) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [glossRow?.id, glossVerse, item?.id],
  );
  const glossWords = glossVerse && glossMarked.length ? wordsAt(glossVerse, glossMarked) : "";
  // The other text of the team, to compare: its group draft, or what is published.
  useEffect(() => {
    if ((!chapterOpen && pane !== "chapter") || otherText || !data || !ctx || !session) return;
    let alive = true;
    const other = data.resource === "tps" ? "tpl" : "tps";
    void (async () => {
      const target = resolveScriptureTarget({ ...ctx, resource: other });
      if ("error" in target) return;
      const found = await tryReadExistingBookUsfm({ session, owner: target.owner, repo: target.repo, filepath: target.filepath, branches: [...groupDraftBranches(target.book, (plan && draftTaskId(plan.teams, other)) || ""), undefined] }).catch(() => null);
      if (found && alive) setOtherText(chapterTextOf("other", other.toUpperCase(), found.text));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane, chapterOpen, data, session?.token]);

  useEffect(() => setSheetOpen(false), [item?.id]);
  // From one step of a point to the other, the screen goes back to what the step asks: on a phone it stayed where the
  // button was, under the words, and the question of step 2 was above the screen (18 October).
  const stepNow = `${studied}|${confirmed}`;
  const stepShown = useRef(stepNow);
  useEffect(() => {
    if (stepShown.current === stepNow) return;
    stepShown.current = stepNow;
    const top = kindRef.current;
    if (top && top.getBoundingClientRect().top < 64) top.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNow]);
  /** What the point is called where it is reviewed: the challenge («Metáfora») or the key word («año»). */
  const pointName = !item
    ? ""
    : stepProp === "notas"
      ? nameOf(item)
      : termSlug
        ? teamTermTitle
          ? termWord(teamTermTitle)
          : titlesRead || termTitles[termSlug]
            ? termWord(termLabel(termSlug, termTitles))
            : "…"
        : item.phrase
          ? `«${item.phrase}»`
          : item.quote || t("af.wholeVerse");
  /** Whether there is a help to open: the note of the challenge, or the article of the key word. */
  const hasHelp = Boolean(item) && (stepProp === "notas" ? Boolean(item?.note) : Boolean(definition || termSlug));
  // Both name the point: «Por qué es un desafío» did not say which challenge, nor that it is one in this verse (18 October).
  /**
   * What step 1 asks about: a challenge by its name; a key word by what is highlighted, as in the heading. By the
   * title of its article the question read «…traducir «rule, reign, ruler, prefect, official, leader» con especial
   * cuidado?», and it could not be told whether that article was about the word at all (19 October).
   */
  const askName = stepProp === "palabras" ? pointWords || pointName.replace(/^«|»$/g, "") : pointName.replace(/^«|»$/g, "");
  const askInOrig = stepProp === "palabras" && reference?.id === "orig" && Boolean(markedWords);
  const askNamed = (key: MessageKey) =>
    t(key)
      .split(/(\{name\})/)
      .map((piece, at) =>
        piece !== "{name}" ? (
          piece
        ) : stepProp === "palabras" ? (
          <bdi key={at} className={askInOrig ? "af-orig af-tag af-tag--marked" : "af-tag af-tag--marked"} lang={askInOrig ? "hbo" : undefined}>
            {askName}
          </bdi>
        ) : (
          askName
        ),
      );
  const sideTitle = t(stepProp === "notas" ? "af.sideNote" : "af.sideTerm").replace("{name}", askName);
  /**
   * The help, with its title and a way to close it: beside the work on a computer, under the name of the point on a
   * phone. What «well» means in this text (the step's criterion) is read here too: the question and its evidence
   * are what the screen is for, and the rule is what one reads when they are not enough.
   */
  /**
   * An article as it is read here, to understand a point: without its translation suggestions and strategies, which
   * are for whoever translates into another language and not the rules of the TPL or the TPS (19 October). Nothing
   * says they were left out: a line saying so was one more thing to read. A suggestion inside the definition, as a
   * bullet, stays.
   */
  const readArticleText = (markdown: string, className?: string) => (
    <HelpMarkdownView className={className} content={withoutSections(markdown, readingOmits()).text} />
  );
  /** The article being read, as the team has it (said to be a draft while it is one) and as the source has it. */
  const articleVersions = reading ? (
    <HelpVersions simple team={reading.team} source={reading.source ?? ""} teamLang={ctx?.lang ?? ""} sourceLang={data ? sourcePackageLang(data.sourcePackage) : "en"} draftLabel={t("hv.draft")}>
      {(text, lang) => <div lang={lang}>{readArticleText(text)}</div>}
    </HelpVersions>
  ) : null;
  /** What to improve in an article, left for whoever harmonizes it, where the article is read. */
  const articleMessages = (point: NoteItem) =>
    session && ctx?.pmOrg && ctx.projectId && data && articlePathOf(point.supportRef) ? (
      <HelpMessages
        key={`sheet-${articleMessageKey(articlePathOf(point.supportRef))}`}
        session={session}
        pmOrg={ctx.pmOrg}
        lang={ctx.lang}
        projectId={ctx.projectId}
        book={data.book}
        chapter={point.chapter}
        verse={point.verse}
        about={articleMessageKey(articlePathOf(point.supportRef))}
        resource="academia"
        taskName={ctx.taskName}
        lede={t("hm.ledeLeaveArticle")}
        folded
        foldLabel={t("hm.toggleArticle")}
      />
    ) : null;
  /**
   * The note or the article of the point, with its version and its links: read in step 1, and in the side panel.
   * `label`: a name at the start of the row of its versions, as «Referencia» names the text over it. `whole`: a key
   * word's article read whole, with nothing to open: what step 1 studies (19 October).
   */
  const noteGroupWith = (label?: ReactNode, whole = false) =>
    data && item && hasHelp ? (
      <>
      {/* The note and what goes with it are one group: which version, who it is written for, the note, its
          article. The help read as a column of paragraphs of one weight, each as far from the next (18 October). */}
      <div className="af-about__note" data-guide="af-help">
      {stepProp === "notas" && item.note ? (
        // Why this is a challenge: the team's note first, said to be a draft until harmonized, or the source's.
        // In step 1, named as the reference is («Nota»), its draft said in a word beside it: «Borrador de la fase 1:
        // Traducción» took a line of its own over the note (19 October).
        <HelpVersions label={label} simple={Boolean(label)} team={teamNotes?.byId[item.id] ?? null} source={item.note} teamLang={ctx?.lang ?? ""} sourceLang={sourcePackageLang(data.sourcePackage)} draftLabel={label ? t("hv.draft") : notesDraftLabel}>
          {(text, lang) => (
            <>
              {/* How to read the note: it is not written for whoever refines the text, but for whoever will
                  translate the TPL into another language, whichever text is refined here; its advice is often
                  what the TPS does (18 October). Over the note, as its caption. */}
              {/* An aside about the note, not its first line: an icon, in italics, apart from it (19 October). */}
              <p className="af-note-reader">
                <Info size={14} aria-hidden /> <span>{t("af.noteReader")}</span>
              </p>
              <div className="af-reason" lang={lang} data-whole="true">
                <HelpMarkdownView className="af-note af-note--md" content={text} />
              </div>
            </>
          )}
        </HelpVersions>
      ) : null}
      {stepProp === "palabras" && definition && termRead ? (
        // What the term means: the team's article first, said to be a draft until harmonized, or the source's.
        // Said whom it is written for, as the note of a challenge is.
        <HelpVersions
          label={label}
          simple={Boolean(label)}
          team={termRead.team ? { text: whole ? termRead.team.text : termDefinition(termRead.team.text), draft: termRead.team.draft } : null}
          source={termRead.source ? (whole ? termRead.source : termDefinition(termRead.source)) : ""}
          teamLang={ctx?.lang ?? ""}
          sourceLang={sourcePackageLang(data.sourcePackage)}
          draftLabel={t("hv.draft")}
        >
          {(text, lang) => (
            <>
              {/* Not in step 1, where the article is read whole: grey over its first line, it read as part of it. */}
              {whole ? null : (
                <p className="af-note-reader">
                  <Info size={14} aria-hidden /> <span>{t("af.termReader")}</span>
                </p>
              )}
              {whole ? (
                // The article whole, under its title: without it the definition began with nothing to say whose.
                <div className="af-reason af-article" lang={lang} data-whole="true">
                  {parseArticleTitle(text) ? <h3 className="af-article__title">{parseArticleTitle(text)}</h3> : null}
                  {readArticleText(articleBody(text), "af-note af-note--md")}
                </div>
              ) : (
                <div className="af-reason" lang={lang} data-whole="true">
                  <HelpMarkdownView className="af-note af-note--md" content={text} />
                </div>
              )}
            </>
          )}
        </HelpVersions>
      ) : null}
      {whole ? null : (
      <p className="af-about__links">
        {stepProp === "notas" && articlePathOf(item.supportRef) ? (
          <button
            type="button"
            className="af-link"
            lang={language}
            onClick={() => {
              void readArticle(articlePathOf(item.supportRef));
              setArticleOpen(true);
            }}
          >
            {/* Which article: «Leer el artículo» alone did not say what would open (18 October). */}
            {t("af.readArticleNamed").replace("{name}", nameOf(item))}
          </button>
        ) : null}
        {/* Under the article of a key word its links do not name it again: «Leer el artículo «rule, reign, ruler,
            prefect, official, leader»» under that very article said its title twice (19 October). */}
        {stepProp === "palabras" && definition ? (
          <button type="button" className="af-link" lang={language} onClick={() => setArticleOpen(true)}>
            {t("af.wholeArticle")}
          </button>
        ) : null}
        {stepProp === "palabras" && comparison ? (
          <button type="button" className="af-link" lang={language} onClick={() => setBookOpen(true)}>
            {t("af.inBookLink")}
          </button>
        ) : null}
        {stepProp === "palabras" ? termGlossary : null}
      </p>
      )}
      </div>
      </>
    ) : null;
  const noteGroup = noteGroupWith();
  const sideContent =
    data && item && hasHelp ? (
      <>
        {/* What the note is about, first, in the text chosen as reference (the original, the ULT or the UST): the
            note spoke of «this» without saying of what (18 October). */}
        {/* A key word's is named by the title over it, «Qué significa «הַמֶּלֶךְ»»: said again here, it was twice. */}
        {markedWords && stepProp === "notas" ? (
          <p className="af-about__quote">
            «
            <bdi className={reference?.id === "orig" ? "af-orig af-about__quote-words" : "af-about__quote-words"} lang={reference?.id === "orig" ? "hbo" : undefined}>
              {markedWords}
            </bdi>
            »
          </p>
        ) : null}
        {noteGroup}
        {/* What «well» means in this text, apart from the note: the rule of the TPL or the TPS. */}
        {stepProp === "notas" || said.criterion ? <p className="af-about__rule">{said.criterion ?? t(data.resource === "tps" ? "af.guideTps" : "af.guideTpl")}</p> : null}
        {/* What to improve in the note, left for whoever harmonizes it, right where the note is read. */}
        {(stepProp === "notas" || termKey) && session && ctx?.pmOrg && ctx.projectId ? (
          <HelpMessages
            key={`side-${stepProp === "notas" ? item.id : termKey}-${messagesSeen}`}
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
            lede={t(stepProp === "notas" ? "hm.ledeImprove" : "hm.ledeLeaveTerm")}
            folded
            foldLabel={t(stepProp === "notas" ? "hm.toggleNote" : "hm.toggleArticle")}
          />
        ) : null}
      </>
    ) : null;
  /** Opens the note or the article. Under what the step asks, where the doubt comes up: beside the small name at the
   *  top it was a big button read before the question (18 October). */
  const helpButton = (closed: boolean) =>
    // With the panel open beside the work the link said the same as its title; its own «Cerrar» closes it.
    hasHelp && !(wide && showReason) ? (
      <button
        type="button"
        className={closed ? "af-side-toggle" : "af-side-toggle af-side-toggle--under"}
        aria-expanded={wide ? showReason : sheetOpen}
        aria-controls="af-side"
        onClick={() => (wide ? toggleReason(!showReason) : setSheetOpen(true))}
      >
        <BookOpen size={16} aria-hidden /> {sideTitle}
      </button>
    ) : null;
  /** Beside the work on a computer, with its title and a way to close it. */
  const sidePanel = (onClose: () => void) =>
    sideContent ? (
      <aside className="af-about" id="af-side" aria-labelledby="af-side-title">
        <div className="af-about__head">
          <h3 id="af-side-title" className="af-about__title">
            {sideTitle}
          </h3>
          <button type="button" className="af-link af-about__close" onClick={onClose}>
            {t("af.sideClose")} <X size={16} aria-hidden />
          </button>
        </div>
        {sideContent}
      </aside>
    ) : null;

  /**
   * Step 1's heading says what to do, like the other two: «Estudia «X» con su nota». «Afinación de «בִּימֵי» en el TPL»
   * named the tool and a text not yet touched (19 October). The point is named by what is highlighted in the text
   * chosen as reference, in its yellow, for a key word too: the name of its article is already over the question.
   */
  const withPoint = (text: string) =>
    text.split(/(\{x\}|\{res\})/).map((piece, at) =>
      piece === "{x}" ? (
        <span key={at}>
          «<bdi className={reference?.id === "orig" && markedWords ? "af-orig af-tag af-tag--marked" : "af-tag af-tag--marked"} lang={reference?.id === "orig" && markedWords ? "hbo" : undefined}>{pointWords || pointName.replace(/^«|»$/g, "")}</bdi>»
        </span>
      ) : piece === "{res}" ? (
        data?.resource === "tps" ? "TPS" : "TPL"
      ) : (
        piece
      ),
    );
  /** Where the point is: marked in the text the draft is read against, the original unless another is chosen. */
  const referenceBox =
    data && item ? (
        <div className="af-ref" data-guide="af-ref">
          {/* No line saying that the words of the original open their meaning: their dotted underline says it, and the
              line was one more thing to read before the verse (19 October). */}
          {/* Another text than the original says its name: chosen down under «Más para ver», the verse changed here
              without saying in which text it now reads. */}
          {reference && reference.id !== "orig" ? <span className="af-gloss__name">{refName(reference)}</span> : null}
          <span className={reference?.id === "orig" ? "af-orig" : undefined} lang={reference?.id === "orig" ? "grc" : undefined}>
            {reference?.id === "orig" ? (
              <OriginalWords text={refVerse} words={data.originalWords[`${item.chapter}:${item.verse}`]} marked={refMarked} only={refExcerpt ?? undefined} onOpen={(word) => setSheetWord({ word, chapter: item.chapter, verse: item.verse })} />
            ) : (
              <Words text={refVerse} marked={refMarked} only={refExcerpt ?? undefined} />
            )}
          </span>
          {refToggle}
          {/* The same verse in English, with the same phrase marked: whoever does not read the original well reads
              it here, without opening anything (11 November). */}
          {refMore ? (
            <div className="af-ref__extra" id="af-ref-more">
              {reference?.id === "orig" && glossRow && glossVerse ? (
                <div className="af-ref__gloss">
                  {glossRows.length > 1 ? (
                    <div className="af-ref__texts" role="tablist" aria-label={t("af.readAgainst")} data-guide="af-tabs">
                    {glossRows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        role="tab"
                        aria-selected={glossRow?.id === row.id}
                        onClick={() => {
                          if (row.id !== glossRow?.id) guideDid("af:ref-tab");
                          setGlossText(row.id);
                        }}
                      >
                        {refName(row)}
                      </button>
                    ))}
                    </div>
                  ) : (
                    <span className="af-gloss__name">{refName(glossRow)}</span>
                  )}
                  <p className="af-gloss" lang="en">
                    <Words text={glossVerse} marked={glossMarked} />
                  </p>
                </div>
              ) : null}
              <div className="af-ref__links">
                <button type="button" className="af-see" aria-label={t("af.expandRefsAria")} onClick={() => setChapterOpen(true)}>
                  <Maximize2 size={16} aria-hidden /> {t("af.seeChapter")}
                </button>
                <ParallelLink book={data.book} chapter={item.chapter} from={item.verse} session={session ?? null} workspace={ctx ? workspaceOfOrg(tallerConfig, ctx.pmOrg) : undefined} team={{ owner: data.draft.owner, repo: data.draft.repo }} />
              </div>
            </div>
          ) : null}
          <button type="button" className="af-see af-ref__fold" data-guide="af-more" aria-expanded={refMore} aria-controls="af-ref-more" onClick={toggleRefMore}>
            {t(refMore ? "af.seeLess" : "af.seeMore")}
            <ChevronDown size={18} aria-hidden className="af-more__chev" />
          </button>
        </div>
    ) : null;
  const stageRes = data?.resource === "tps" ? "TPS" : "TPL";
  /** What a step asks, in its window. */
  const stageText = (n: 1 | 2 | 3) =>
    (n === 1
      ? stepProp === "notas"
        ? t(stageRes === "TPS" ? "stage.studyNoteTps" : "stage.studyNoteTpl")
        : t(stageRes === "TPS" ? "stage.studyTermTps" : "stage.studyTermTpl")
      : n === 2
        ? t("stage.mark")
        : t("stage.judge"))
      .replace("{res}", stageRes)
      .replace("{orig}", origWord)
      .replace("{name}", askName);
  const stepName = (n: 1 | 2 | 3) => t(n === 1 ? "af.stepShortStudy" : n === 2 ? "af.stepShortMark" : "af.stepShortJudge");
  /** Step 1 said: on to marking, or, when somebody already chose the words, to whether they are right. */
  const studyDone = (said: { applies: boolean; note?: string }) => {
    setStudy(said);
    setStudied(true);
    setDoubting(false);
    if (othersChose.current) setConfirmed(true);
  };
  /**
   * The challenge is not what the note says (or the term has not that sense here): said once, for whoever harmonizes
   * the note or the article, as a message about it; then the person goes on, judging by what they see.
   */
  async function sayDoubt() {
    const text = doubtText.trim();
    if (!text || !data || !item) return;
    const said = text;
    if (!session || !ctx?.pmOrg || !ctx.projectId) return studyDone({ applies: false, note: said });
    setSaving(true);
    setError("");
    try {
      const name = pointName.replace(/^«|»$/g, "");
      const message: StudyNote = {
        id: `n-${uid().slice(0, 8)}`,
        by: session.username.toLowerCase(),
        book: data.book.toUpperCase(),
        chapter: item.chapter,
        verse: item.verse,
        kind: "remember",
        resource: stepProp === "notas" ? "notas" : "palabras",
        ...(ctx.taskName ? { task: ctx.taskName } : {}),
        about: stepProp === "notas" ? item.id : termKey,
        text:
          stepProp === "notas"
            ? t("af.doubtMsgNote").replace("{name}", name).replace("{text}", text)
            : t("af.doubtMsgTerm").replace("{article}", name).replace("{name}", askName).replace("{text}", text),
        shared: true,
        at: new Date().toISOString(),
      };
      await changeMyStudyNotes({ session, pmOrg: ctx.pmOrg, lang: ctx.lang, projectId: ctx.projectId }, (mine) => [...mine, message]);
      setMessagesSeen((n) => n + 1);
      studyDone({ applies: false, note: said });
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /** Agreements grouped by their words, when there is a difference to see (see `wordGroupsOf`). */
  const wordGroups = tally && (tally.selections || otherWords) ? wordGroupsOf(listed) : null;
  /**
   * How the team stands on the point, and what each said: at the decision, in step 3, where it is weighed. Over the
   * steps it was read before the case was studied, and in the colour of a warning (19 October).
   */
  const teamBox = (compact = false) =>
    item && tally && !reviewing && (compact ? Boolean(wordGroups || saidBefore.length || tally.decided || (tally.state === "disputed" && canConfirm)) : !plainAgreement && (tally.answers.length || tally.stale.length || tally.decided) && !(closedView && !listed.length && !saidBefore.length)) ? (
        <details key={item.id} className="af-team" data-state={closedView ? "pending" : tally.state} open>
          <summary>
            {/* In the conversation, a title: the count «0 de 2 de acuerdo» said again what the messages say. */}
            {compact && !tally.decided
              ? t("af.teamDecision")
              : closedView
              ? t("af.teamWho")
              : tally.selections && !tally.decided
              ? t("af.teamSplit")
              : tally.decided
              ? t(tally.decided.inTc ? "af.closedInTc" : "af.teamDecided")
              : tally.state === "agreed" && tally.openUntil
              ? openUntilText(tally.openUntil)
              : tally.state === "agreed"
              ? t("af.teamAgreed").replace("{n}", String(tally.agree))
              : [t("af.teamCount").replace("{n}", String(tally.agree)).replace("{of}", String(thresholds.minAgree)), tally.open.length ? t(tally.open.length === 1 ? "af.teamOpenOne" : "af.teamOpenMany").replace("{who}", tally.open.map((who) => `@${who}`).join(", ")) : ""].filter(Boolean).join(" · ")}
          </summary>
          {listed.length ? (
            <ul className="af-others" aria-label={t("af.teamAria")}>
              {/* Agreements on different words, or on other words than those marked now: by their words. «@bea ·
                  De acuerdo» and «Tú · De acuerdo» read as two agreements where each was on other words. */}
              {wordGroups
                ? wordGroups.map((group) => (
                    <li key={`w-${group.key}`} className="af-others__group">
                      <span className="af-others__words">«{group.words}»</span>
                      <span className="af-others__who">{group.people.map((a) => whoSaid(a)).join(", ")}</span>
                      {!stepDone && !tally.decided ? (
                        <span className="af-others__acts">
                          {group.key !== myWordsKey ? (
                            <button type="button" className="af-second" data-guide="af-second" onClick={() => takeWords(group.selectedText)}>
                              {t("af.takeWords")}
                            </button>
                          ) : null}
                          {canConfirm && tally.selections ? (
                            <button type="button" className="af-second" data-guide="af-second" disabled={saving} onClick={() => void decide(t("af.chosenWords").replace("{words}", group.words), group.selectedText)}>
                              {t("af.chooseWords")}
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </li>
                  ))
                : null}
              {(compact ? [] : wordGroups ? listed.filter((a) => !(a.status === "approved" && selectionKey(a) !== undefined)) : listed).map((a) => (
                <li key={a.reviewer} data-mine={a === mine ? "true" : undefined}>
                  <PersonPhoto login={tcCheckerOf(a) ?? a.reviewer} size="sm" />
                  <b>{whoSaid(a)}</b> · {stanceLabel(a.status)}
                  {a.note && !tcCheckerOf(a) ? `: ${a.note}` : ""}
                  {a !== mine && a.status !== "approved" && a.note && !stepDone && !tally.decided && mine?.status !== a.status && firstOf(a.status) === a ? (
                    <button
                      type="button"
                      className="af-second" data-guide="af-second"
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
          ) : compact || saidBefore.length || tally.decided ? null : (
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
                    <PersonPhoto login={tcCheckerOf(a) ?? a.reviewer} size="sm" />
                  <b>{whoSaid(a)}</b> · {stanceLabel(a.status)}
                    {a.note && !tcCheckerOf(a) ? `: ${a.note}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {!compact && tally.open.length && onOpenThread && ctx?.issueNumber ? (
            // «Para conversarlo en equipo»: the way to where the team talks.
            <button type="button" className="af-second" data-guide="af-second" onClick={() => onOpenThread(ctx.issueNumber!)}>
              {t("af.talk")}
            </button>
          ) : null}
          {closedView ? null : <FinalDecision key={item.id} tally={tally} canConfirm={canConfirm} busy={saving} onDecide={(text) => void decide(text)} />}
          {tally.decided && canConfirm && !stepDone && !fixing ? (
            // What was decided is often a change of the verse, and the way to it was «Cambiar», which is about
            // the words chosen.
            <button
              type="button"
              className="af-second" data-guide="af-second"
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
      ) : null;

  return (
    <div className="af af--round">
      {/* The help of the point on a phone: a sheet, so the question stays where it is (open in the page it pushed
          the question 700 px down, on every point). */}
      <Dialog open={sheetOpen && !wide && hasHelp} onOpenChange={setSheetOpen}>
        {/* Framed as the article's sheet is: its title, its own way to close, the text with room around it. */}
        <DialogContent className="fix-sheet hint-sheet af-side-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{sideTitle}</DialogTitle>
          </header>
          <div className="fx-body af-side-sheet__body" id="af-side">
            {/* Only while open: closed, it was read a second time beside the panel of a computer. */}
            {sheetOpen ? sideContent : null}
          </div>
        </DialogContent>
      </Dialog>
      {/* The whole article of the point's note or term, over the point: it was laid out in the box, or a tab away. */}
      <Dialog open={articleOpen && Boolean(item)} onOpenChange={setArticleOpen}>
        <DialogContent className="fix-sheet hint-sheet af-article-sheet" aria-label={t(stepProp === "notas" ? "af.readArticle" : "af.wholeArticle")}>
          <header className="fx-head">
            <DialogTitle className="fx-title">
              {item ? (stepProp === "notas" ? nameOf(item) : termSlug ? teamTermTitle || termLabel(termSlug, termTitles) : "") : ""}
            </DialogTitle>
          </header>
          {/* No «lang» of the source: the article is the team's when they published it (see «teamFirst: "published"»). */}
          <div className="fx-body af-article-read">
            {/* The question the article answers, over it: it was shown only in the tab «Ayudas». */}
            {stepProp === "notas" && item && articles[articlePathOf(item.supportRef)]?.question ? <p className="af-article-q">{articles[articlePathOf(item.supportRef)]!.question}</p> : null}
            {stepProp === "palabras" ? (
              termRead ? (
                <HelpVersions
                  team={termRead.team ? { text: articleBody(termRead.team.text), draft: termRead.team.draft } : null}
                  source={termRead.source ? articleBody(termRead.source) : ""}
                  teamLang={ctx?.lang ?? ""}
                  sourceLang={data ? sourcePackageLang(data.sourcePackage) : "en"}
                  draftLabel={t("hv.draft")}
                >
                  {(text, lang) => <div lang={lang}>{readArticleText(text)}</div>}
                </HelpVersions>
              ) : termRead === null ? (
                <p className="af-hint">{t("af.noArticle")}</p>
              ) : (
                <LoadingState shape="text" label={t("af.loadingArticle")} lines={8} />
              )
            ) : reading?.body ? (
              articleVersions
            ) : (
              reading?.body === null ? <p className="af-hint">{t("af.noArticle")}</p> : <LoadingState shape="text" label={t("af.loadingArticle")} lines={8} />
            )}
            {stepProp === "notas" && item ? articleMessages(item) : null}
            {stepProp === "palabras" && termKey && item && session && ctx?.pmOrg && ctx.projectId && data ? (
              <HelpMessages
                key={`sheet-${termKey}`}
                session={session}
                pmOrg={ctx.pmOrg}
                lang={ctx.lang}
                projectId={ctx.projectId}
                book={data.book}
                chapter={item.chapter}
                verse={item.verse}
                about={termKey}
                resource="palabras"
                taskName={ctx.taskName}
                lede={t("hm.ledeLeaveTerm")}
                folded
                foldLabel={t("hm.toggleArticle")}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {/* The chapter around the point, from the translation's box: the reference with what is highlighted and the
          translation with the words chosen, to see them in their place without leaving the step (18 October). */}
      <Dialog
        open={chapterOpen && Boolean(item)}
        onOpenChange={(open) => {
          setChapterOpen(open);
          if (!open) {
            setPairFix(null);
            setPairChapter(null);
          }
        }}
      >
        <DialogContent className="fix-sheet af-pair-sheet" aria-describedby={undefined} showCloseButton={false}>
          <header className="fx-head">
            {/* The way back to the point, said in a word, where a page's way back is: the small cross in the corner
                was not found by whoever does not know that a cross closes (11 November). */}
            <button
              type="button"
              className="af-pair-back"
              onClick={() => {
                setChapterOpen(false);
                setPairFix(null);
                setPairChapter(null);
              }}
            >
              <ChevronLeft size={22} aria-hidden /> {t("af.back")}
            </button>
            {/* Which text is read beside the draft, chosen here as in the box (it is the same choice): the sheet
                showed only the one chosen before opening it (18 October). In the header, which stays while the
                chapter scrolls under it. The tabs alone: a «Referencia» label there was one word too many. And «Más»
                with the size of the text, which is wanted at hand wherever the text is read. */}
            {chapterOpen && data ? (
              <div className="af-ref__bar af-pair-bar">
                {/* Each text is touched to add it or take it away; the draft is always read, and is not offered. */}
                <div className="af-ref__texts" role="group" aria-label={t("cr.sideLabel")}>
                  {[...(data.references ?? []).map((row) => ({ id: row.id as string, label: row.id === "orig" ? t("af.tabOriginal") : row.label.replace(/\s*\(.*\)\s*$/, "") })), ...(refsOnly ? [] : [{ id: "other", label: data.resource === "tps" ? "TPL" : "TPS" }])].map((row) => {
                    const shown = pairShown.includes(row.id);
                    // Without the draft beside them, the last reference is not taken away: the chapter would be empty.
                    const last = refsOnly && shown && pairShown.filter((id) => id !== "other").length <= 1;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        aria-pressed={shown}
                        disabled={last || (!shown && pairShown.length >= 3)}
                        onClick={() => {
                          setPairFix(null);
                          setPairTexts(shown ? pairShown.filter((id) => id !== row.id) : [...pairShown, row.id]);
                        }}
                      >
                        {row.label}
                      </button>
                    );
                  })}
                </div>
                <MoreMenu items={[]} bare />
              </div>
            ) : null}
          </header>
          <div className="fx-body af-pair-sheet__body">
            {/* The chapter's name opens the text, not the header: beside the tabs a phone had room for «Ester 1»
                and no more, and «Cantar de los Cantares 8» broke the header in two rows (18 October). */}
            {/* The chapter's name is the chapter chosen: one name, which is also where another is chosen. */}
            <DialogTitle className="sr-only">{data && item ? `${bookLabel(data.book, language)} ${pairChapter ?? item.chapter}` : heading.title}</DialogTitle>
            {/* What the tab «Capítulo» gave, here (18 October): any chapter of the book; the texts beside the draft
                are chosen in the header. */}
            {chapterOpen && data && item ? (
              <div className="af-pair-tools">
                <label className="af-pick">
                  <span className="sr-only">{t("af.chapterPick")}</span>
                  <select
                    value={pairChapter ?? item.chapter}
                    onChange={(e) => {
                      setPairFix(null);
                      setPairChapter(Number(e.target.value));
                    }}
                  >
                    {(chaptersOf([{ id: "draft", book: data.bookDraft }]).length ? chaptersOf([{ id: "draft", book: data.bookDraft }]) : [item.chapter]).map((n) => (
                      <option key={n} value={n}>
                        {`${bookLabel(data.book, language)} ${n}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} aria-hidden />
                </label>
              </div>
            ) : null}
            {chapterOpen && data && !refsOnly ? <p className="af-subhead af-pair-hint">{t("af.pairHint").replace("{res}", data.resource === "tps" ? "TPS" : "TPL")}</p> : null}
            {chapterOpen && data && item ? (
              <ChapterPair
                chapter={pairChapter ?? item.chapter}
                verse={(pairChapter ?? item.chapter) === item.chapter ? item.verse : 0}
                texts={[
                  // The references chosen, in the order the header lists them; the draft; the team's other text.
                  ...data.references.filter((row) => pairShown.includes(row.id)).map((row) => ({ ...row, label: row.id === "orig" ? t("af.tabOriginal") : row.label.replace(/\s*\(.*\)\s*$/, "") })),
                  ...(refsOnly ? [] : [{ id: "draft" as const, label: data.resource === "tps" ? "TPS" : "TPL", book: data.bookDraft, joined: data.draftJoined }]),
                  ...(!refsOnly && pairShown.includes("other") && otherText ? [otherText] : []),
                ]}
                renderVerse={(text, key, body) => {
                  const here = key === `${item.chapter}:${item.verse}`;
                  if (text.id === "draft") {
                    // Any verse of the translation is touched to propose a change to it, right where it is read.
                    const c = Number(key.split(":")[0]);
                    const v = Number(key.split(":")[1]);
                    if (pairFix?.chapter === c && pairFix.verse === v)
                      return (
                        <div className="crp__fix" role="group" aria-label={t("af.fixAria")}>
                          <textarea className="af-textarea" rows={4} autoFocus value={pairFix.text} aria-label={t("af.verseText")} onChange={(e) => setPairFix({ chapter: c, verse: v, text: e.target.value })} />
                          <span className="af-lbl">{t("fx.reasons")}</span>
                          <CorrectionReasons value={pairReasons} onChange={setPairReasons} />
                          <ReasonField id="af-pair-reason" rows={2} value={pairReason} onChange={setPairReason} session={session} ctx={ctx} chapter={c} verse={v} placeholder={t("fx.whyHint")} ariaLabel={t("fx.why")} />
                          {pairError ? (
                            <p className="af-hint" role="alert">
                              {pairError}
                            </p>
                          ) : null}
                          <div className="af-row-buttons">
                            <Button type="button" size="sm" disabled={saving || !pairFix.text.trim()} onClick={() => void proposeInChapter()}>
                              {saving ? t("af.saving") : t("fx.fixNow")}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setPairFix(null)}>
                              {t("af.cancel")}
                            </Button>
                          </div>
                        </div>
                      );
                    return (
                      <button
                        type="button"
                        className="crp__edit"
                        aria-label={t("af.proposeAt").replace("{v}", String(v))}
                        onClick={() => {
                          setPairError("");
                          setPairReasons([]);
                          setPairReason("");
                          setPairFix({ chapter: c, verse: v, text: here ? verseText : body });
                        }}
                      >
                        <span>{here ? <ChosenWords text={verseText} selected={selected} /> : body}</span>
                        <Pencil size={14} className="crp__edit-icon" aria-hidden />
                      </button>
                    );
                  }
                  // What is highlighted, in each text shown: in the original from the quote, in the English texts
                  // through their alignment with it.
                  const marks = here ? markedIn(text.id, body) : undefined;
                  if (text.id === "orig")
                    return <OriginalWords text={body} words={data.originalWords[key]} marked={marks} onOpen={(word) => setSheetWord({ word, chapter: Number(key.split(":")[0]), verse: Number(key.split(":")[1]) })} />;
                  return marks?.length ? <Words text={body} marked={marks} /> : body;
                }}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {/* Which points to go through: all, or those of one figure or kind of term, with how many are agreed. */}
      <Dialog open={filterOpen && Boolean(data)} onOpenChange={setFilterOpen}>
        <DialogContent className="fix-sheet hint-sheet af-filter-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{t("af.filterMenu")}</DialogTitle>
          </header>
          <div className="fx-body af-filter-list" role="list">
            {data
              ? [{ category: "all", label: "", items: data.items }, ...groups].map((group) => (
                  <button
                    key={group.category}
                    type="button"
                    role="listitem"
                    className="af-filter-row"
                    aria-current={category === group.category ? "true" : undefined}
                    onClick={() => {
                      setCategory(group.category);
                      setPosition(0);
                      setFilterOpen(false);
                    }}
                  >
                    <span className="af-filter-row__name">{group.category === "all" ? t("af.allFigures") : groupName(group)}</span>
                    <span className="af-filter-row__count">{t("af.filterAgreed").replace("{a}", String(groupDone(group.items))).replace("{n}", String(group.items.length))}</span>
                    {category === group.category ? <Check size={16} aria-hidden className="af-filter-row__on" /> : null}
                  </button>
                ))
              : null}
          </div>
        </DialogContent>
      </Dialog>
      {/* The introductions of the book and the chapter, the team's draft beside the source, from «Más». */}
      <Dialog open={introOpen && Boolean(ctx)} onOpenChange={setIntroOpen}>
        <DialogContent className="fix-sheet hint-sheet af-intro-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{t("af.paneIntro")}</DialogTitle>
          </header>
          <div className="fx-body af-intro">{introOpen && ctx ? <PassageIntroText session={session} ctx={ctx} drafts board={plan} /> : null}</div>
        </DialogContent>
      </Dialog>
      {/* How a key term reads in the whole book, and the team's word for it: it was a tab of «Ayudas». */}
      <Dialog open={bookOpen && Boolean(item) && stepProp === "palabras"} onOpenChange={setBookOpen}>
        <DialogContent className="fix-sheet hint-sheet af-book-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{t("af.inBookOf").replace("{name}", pointName.replace(/^«|»$/g, ""))}</DialogTitle>
          </header>
          <div className="fx-body">
            {bookOpen && comparison ? (
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
                                setBookOpen(false);
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
        </DialogContent>
      </Dialog>
      <WordSheet word={sheetWord?.word ?? null} at={{ book: data?.book ?? "", chapter: sheetWord?.chapter ?? 0, verse: sheetWord?.verse ?? 0 }} session={session ?? null} workspace={ctx ? workspaceOfOrg(tallerConfig, ctx.pmOrg) : undefined} literal={data?.resource === "tpl"} onClose={() => setSheetWord(null)} />
      <ToolHeader
        // The passage, and under it the task with how far along: «Palabras clave TPS · 0 de 74 acordadas». The line said
        // «Revisar palabras clave · Palabras clave TPS», the task twice; with both in the title, a phone cut the passage.
        title={heading.title}
        // From the helps or the chapter, back returns to what was being reviewed; from there it leaves.
        onBack={() => (pane === "review" ? onClose() : setPane("review"))}
        meta={[taskLabel || heading.where, summary && data ? t("af.nAgreed").replace("{a}", String(summary.agreed)).replace("{n}", String(data.items.length)) : ""].filter(Boolean).join(" · ")}
        more={
          data
            ? [
                // The list grouped by challenge or term instead of verse by verse: chosen once, it sat in the row
                // over every point and pushed the point down a line on a phone (18 October).
                { id: "order", label: t(stepProp === "palabras" ? "af.groupByTerm" : "af.groupByChallenge"), hint: t(stepProp === "palabras" ? "af.groupByTermHint" : "af.groupByChallengeHint"), pressed: order === "term", onSelect: () => setOrder(order === "term" ? "text" : "term") },
                ...(groups.length > 1
                  ? [{ id: "filter", label: t("af.filterMenu"), hint: category === "all" ? t("af.filterHint") : t("af.filterOnly").replace("{name}", groupName(groups.find((group) => group.category === category))), onSelect: () => setFilterOpen(true) }]
                  : []),
                // The introductions of the book and of the chapter, read when wanted: a tab of their own over every point.
                { id: "intro", label: t("af.paneIntro"), hint: t("mm.introHint"), onSelect: () => setIntroOpen(true) },
                { id: "glossary", label: t("gl.open"), hint: t("mm.glossaryHint"), href: `#/glosario?libro=${encodeURIComponent(data.book)}&c=${data.chapter}&de=1&a=200` },
              ]
            : []
        }
        info={said.purpose ? { label: t("af.aboutTask"), onOpen: () => setAboutOpen(true) } : undefined}
      />
      <div className="step-ask-bar">
        {/* What the task is for, how the round goes and the team's rules: said once in a welcome, then a touch away
            in the header («ⓘ»). Laid out over the tabs they took 130 px of every point (16 October). */}
        <StepAsk
          session={session}
          ctx={ctx && taskStep ? { ...ctx, stepId: taskStep.id } : ctx}
          intro={false}
          label={t("af.aboutTask")}
          open={aboutOpen}
          onOpenChange={setAboutOpen}
          // Opened from «Más» only: a line of its own over the work was one more thing to read (11 November).
          trigger={false}
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <LoadingState shape="tool" label={t("af.loading")} /> : null}

      {summary ? (
        <div ref={roundRef} className="af-round-top" data-guide="af-round">
          <RoundPanel summary={summary} labelOf={labelOfItem} onJump={jumpToItem} closesHere={closesHere} canClose={canConfirm} stepDone={stepDone} delivered={delivered} busy={closing} onClose={() => void closeRound()} onLeave={onClose} meetingElsewhere />
        </div>
      ) : null}


      {/* Not before the answers of everybody have been read: for some seconds the first point of the list was
          shown as if nobody had answered anything, to be touched, and then the screen went to another point. */}
      {/* The first point is worked with the guide, step by step (see `tuningGuides.tsx`). */}
      {data && item ? (
        <TuningGuide
          ready={!busy && pane === "review" && !closedView}
          state={{
            kind: stepProp,
            phase: phase ?? 1,
            orig: origWord,
            res: data.resource === "tps" ? "TPS" : "TPL",
            name: pointName.replace(/^«|»$/g, ""),
            tab: data.references.find((row) => row.id !== reference?.id)?.label.replace(/\s*\(.*\)\s*$/, ""),
            hasHelp,
            studied,
            doubting,
            marked: selected.length > 0,
            confirmed,
            needsWords,
            pending,
            answered: Boolean(mine) && !changing,
            elsewhere: elsewhere.length > 0,
            othersChose: othersChose.current,
            others: others.length > 0,
          }}
        />
      ) : null}
      {/* On entering: what is reviewed and why, its three steps, that the person does not decide alone, and that
          studying and marking change nothing. In the app's own words, plain: the purpose of the process's step
          («Compruebe que el TPL conserve…») said the rule, not what the person would do (Abel, 11 November). */}
      <StageWindow
        open={taskWindowOpen}
        title={t(stepProp === "notas" ? "stage.taskTitleNotes" : "stage.taskTitleTerms")}
        sub={[heading.title, stageRes].filter(Boolean).join(" · ")}
        text={t(stepProp === "notas" ? (stageRes === "TPS" ? "stage.aboutNotesTps" : "stage.aboutNotesTpl") : stageRes === "TPS" ? "stage.aboutTermsTps" : "stage.aboutTermsTpl").replace("{orig}", origWord)}
        steps={[stepName(1), stepName(2), stepName(3)]}
        go={t("stage.start")}
        onGo={() => setTaskWindow(false)}
      />
      {/* At each step of the first point: what it asks, and its walk if wanted. «Guía» opens it again. */}
      <StageWindow
        open={stageWindow !== null && !taskWindowOpen}
        title={stageWindow ? t("stage.stepTitle").replace("{n}", String(stageWindow)).replace("{name}", stepName(stageWindow)) : ""}
        text={stageWindow ? stageText(stageWindow) : ""}
        go={t("stage.go")}
        onGo={() => setStageWindow(null)}
        show={t("stage.show")}
        onShow={() => {
          setStageWindow(null);
          // Once the window is gone: the walk of the stage on screen, from its first step.
          window.setTimeout(() => guide.replay(["screen"]), 150);
        }}
      />
      {/* «No del todo…» keeps nothing: it opens the two ways to say why, and the way back to the question. */}
      <Dialog open={noSheet} onOpenChange={setNoSheet}>
        <DialogContent className="fix-sheet hint-sheet af-no-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{t("af.noSheetTitle")}</DialogTitle>
          </header>
          <div className="fx-body af-no-sheet__body">
            <button
              type="button"
              className="af-opt"
              onClick={() => {
                setNoSheet(false);
                setFixText(verseText);
                setPending("revise");
              }}
            >
              <b>{t("af.proposeWords")}</b>
              <span>{t("af.proposeWordsHint")}</span>
            </button>
            <button
              type="button"
              className="af-opt"
              onClick={() => {
                setNoSheet(false);
                setNote(mine?.status === "rejected" && mine.note ? mine.note : "");
                setPending("rejected");
              }}
            >
              <b>{t("af.commentTeam")}</b>
              <span>{t("af.commentTeamHint")}</span>
            </button>
            <button type="button" className="af-back" onClick={() => setNoSheet(false)}>
              <ChevronLeft size={16} aria-hidden /> {t("af.backToQuestion")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Every point of the list, with what this person answered in each: the way to another point. */}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="fix-sheet hint-sheet af-list-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{t(stepProp === "notas" ? "af.listNotes" : "af.listTerms")}</DialogTitle>
          </header>
          <ol className="fx-body af-list">
            {visible.map((row, index) => {
              const said = listOpen ? myAnswerOf(row) : undefined;
              return (
                <li key={row.id}>
                  <button type="button" aria-current={index === position ? "true" : undefined} onClick={() => goTo(index)}>
                    <span className="af-list__n">{index + 1}</span>
                    <span className="af-list__what">{labelOfItem(row.id)}</span>
                    <span className="af-list__said" data-said={said ? "true" : undefined}>
                      {said ? (
                        <>
                          <Check size={14} aria-hidden /> {stanceLabel(said.status)}
                        </>
                      ) : (
                        t("af.notYet")
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </DialogContent>
      </Dialog>
      {data && item && pane === "review" && !busy ? (
        <section className="af-focus" aria-label={t("af.noteAria")}>
          {/* What the point is, small, with the help beside it: the question below is what the screen asks. The name
              of the key word or the challenge, in a heading of its own, was the biggest thing on the screen and was
              read before the question (18 October). */}
          {/* The point's line carries where it is in the list and the way to the next: a row of its own over every
              point, with the figure to filter by, pushed the point down and drew the eye first (18 October). The
              filter is in «Más»; when one is on, it is said here, with the way to take it off. */}
          <div className="af-head" data-guide="af-head">
            <button type="button" className="af-where" ref={kindRef} data-guide="af-where" aria-haspopup="dialog" onClick={() => setListOpen(true)}>
              <span className="af-where__n">{t(stepProp === "notas" ? "af.whereNote" : "af.whereTerm").replace("{a}", String(Math.min(position + 1, total))).replace("{b}", String(total))}</span>
              <span className="af-where__what">
                {item.chapter}:{item.verse} · {stepProp === "palabras" && pointWords ? <bdi className="af-orig">{pointWords}</bdi> : pointName}
              </span>
              <ChevronDown size={16} aria-hidden />
            </button>
            {tally?.decided && closedView ? helpButton(true) : null}
            {summary && !stepDone ? <MeetingChip summary={summary} labelOf={labelOfItem} onJump={jumpToItem} /> : null}
            {category !== "all" ? (
              <button
                type="button"
                className="af-filter-on"
                aria-label={t("af.filterOff")}
                onClick={() => {
                  setCategory("all");
                  setPosition(0);
                }}
              >
                {t("af.filterOnly").replace("{name}", groupName(groups.find((group) => group.category === category)))} <X size={14} aria-hidden />
              </button>
            ) : null}
          </div>

          <div className="af-work" data-cols={phase && !(wide && showReason) ? String(phase) : undefined}>
          {/* Why the point is back, said where it is read on arriving: under the answer it was below the screen. */}
          {staleMine ? <p className="af-stale">{t("af.staleMine")}</p> : null}
          {reviewing ? (
            <p className={answeredByMe >= data.items.length ? "af-team af-team--done" : "af-team"}>
              {stepDone ? t("af.reviewDoneShort") : t("af.reviewProgress").replace("{n}", String(answeredByMe)).replace("{of}", String(data.items.length))}
            </p>
          ) : null}
          {/* How the team stands on it, and what the others said: before answering, not after. Where somebody does
              not agree it is found open: what they propose and why was folded under a line that did not look like
              something to touch, and the others read «no está de acuerdo» with no way to know about what. */}
          {/* A point closed in translationCore with nothing else said: no box that says nothing. Where everybody who
              answered agrees, with nothing more said, it is one line over the buttons instead (see `plainAgreement`):
              the box sat between the note and the question and said what that line says (16 October). It stands
              in the work column, over the steps, where the answer is given. */}
          {/* The team's answers: on a closed point here, where it is read; otherwise only at the decision (step 3). */}
          {closedView ? teamBox() : null}
          {tally?.decided && closedView ? (
            // Closed: it reads as closed, and opening it again is a deliberate act. A closed point looked like any
            // other, its buttons waiting to be pressed (16 October).
            <div className="af-closed" data-guide="af-closed">
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
          ) : !studied ? (
            // Step 1 of 3: the point itself, before the translation: is the challenge there, does the term mean that.
            <>
              {referenceBox}
              {/* The note in sight: studying it is what this step is for. Behind a link it was read by whoever
                  already doubted; the others answered without it (18 October). */}
              {/* A key word's article in sight again, whole, named as the reference is, «Artículo», with its versions in
                  the same row: the step studies the reference and the article of its general sense, to tell what it
                  means here. Behind a link, and with links of its own, it was one more thing to open (19 October). */}
              {stepProp === "palabras" && noteGroup ? (
                <section className="af-study-help af-study-help--named">{noteGroupWith(<span className="af-study-lbl">{t("af.articleHeading")}</span>, true)}</section>
              ) : stepProp === "palabras" ? (
                helpButton(false)
              ) : noteGroup ? (
                // What the question asks about first, the article, and the note folded at the card's foot.
                <section className="af-study-help af-study-help--named af-study-help--article">
                  {/* The article as one row touched whole, as a list in a phone: its name, what touching it does, and
                      the arrow. A heading, a bordered button and the band were three things for one (12 November). */}
                  <div className="af-study-article" data-guide="af-help">
                    {articlePathOf(item.supportRef) ? (
                      <button
                        type="button"
                        className="af-study-article__open"
                        onClick={() => {
                          void readArticle(articlePathOf(item.supportRef));
                          setArticleOpen(true);
                        }}
                      >
                        <span className="af-study-article__icon" aria-hidden>
                          <BookOpen size={20} />
                        </span>
                        <span className="af-study-article__text">
                          <span className="af-study-article__name">{askName}</span>
                          {/* The article's own question, in the team's language only: in English it read as a stray line. */}
                          {articles[articlePathOf(item.supportRef)]?.own && articles[articlePathOf(item.supportRef)]?.question ? (
                            <span className="af-study-article__q">{articles[articlePathOf(item.supportRef)]!.question}</span>
                          ) : null}
                          <span className="af-study-article__go">{t("af.readArticle")}</span>
                        </span>
                        <ChevronRight size={20} aria-hidden className="af-study-article__chev" />
                      </button>
                    ) : (
                      <h3 className="af-study-article__name">{askName}</h3>
                    )}
                  </div>
                  {noteOpen ? <div className="af-study-note" id="af-study-note">{noteGroupWith(<span className="af-study-lbl">{t("af.noteHeading")}</span>, true)}</div> : null}
                  <button type="button" className="af-see af-ref__fold" aria-expanded={noteOpen} aria-controls="af-study-note" onClick={() => setNoteOpen(!noteOpen)}>
                    {t(noteOpen ? "af.hideNote" : "af.showNote")}
                    <ChevronDown size={18} aria-hidden className="af-more__chev" />
                  </button>
                </section>
              ) : null}
              {/* What the others said of it, before answering: why they do not see it, in their words. */}
              {tally && tally.doubted.some((d) => d.by.trim().toLowerCase() !== me) ? (
                <div className="af-doubts">
                  <p className="af-doubts__lead">{t(stepProp === "notas" ? "af.doubtsLeadNote" : "af.doubtsLeadTerm").replace("{name}", askName)}</p>
                  <ul>
                    {tally.doubted
                      .filter((d) => d.by.trim().toLowerCase() !== me)
                      .map((d) => (
                        <li key={d.by}>
                          <b>@{d.by}</b>
                          {d.note ? `: ${d.note}` : ` ${t("af.doubtNoReason")}`}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
              {doubting ? (
                <div className="af-why" data-guide="af-doubt">
                  <h3 className="af-study-q">{askNamed(stepProp === "notas" ? "af.studyQNote" : "af.studyQTerm")}</h3>
                  <label htmlFor="af-doubt" className="af-lbl">
                    {t(stepProp === "notas" ? "af.doubtWhatNote" : "af.doubtWhatTerm")}
                  </label>
                  <p className="af-subhead">{t(stepProp === "notas" ? "af.doubtGoesToNote" : "af.doubtGoesToTerm")}</p>
                  <textarea id="af-doubt" className="af-textarea" rows={3} autoFocus value={doubtText} placeholder={t(stepProp === "notas" ? "af.doubtPlaceholderNote" : "af.doubtPlaceholderTerm")} onChange={(e) => setDoubtText(e.target.value)} />
                  <div className="af-row-buttons">
                    <Button type="button" disabled={saving || !doubtText.trim()} onClick={() => void sayDoubt()}>
                      {saving ? t("af.saving") : t("af.doubtContinue")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setDoubting(false)}>
                      {t("af.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                // The question with its answers, at the foot of a phone: under the note it was hidden by them. A key
                // word asks whether the person understands what it means here and its literal form: both texts need
                // to know both, whatever each then does with them by its rules (literal, simple). Its «no» is an
                // error to report: an article that does not match the word marked (19 October).
                <div className="af-decide af-decide--ask af-decide--one" data-guide="af-answer">
                  {/* One way on, and the other answer a quiet link under it. A note asks a real question; a key word
                      only asks to study it: what it asked («¿Entiende…?») is said by the window of the step. */}
                  {stepProp === "notas" ? <h3 className="af-study-q">{askNamed("af.studyQNote")}</h3> : null}
                  <Button type="button" onClick={() => studyDone({ applies: true })}>
                    {t(stepProp === "notas" ? "af.studyYesNote" : "af.studyYesTerm").replace("{name}", pointName.replace(/^«|»$/g, ""))}
                  </Button>
                  <button
                    type="button"
                    className="af-link af-decide__aside"
                    onClick={() => {
                      setDoubtText(study?.applies === false ? (study.note ?? "") : "");
                      setDoubting(true);
                    }}
                  >
                    {t(stepProp === "notas" ? "af.studyNoNote" : "af.studyNoTerm")}
                  </button>
                </div>
              )}
            </>
          ) : !confirmed ? (
            // Step 2 of 3: which words of the translation render what is marked in the reference.
            <>
              {/* What is sought, and what it means: here the person had only the original, and had to remember
                  its sense from the step before (11 November, «El resaltador»). */}
              {fixing ? null : (
                <button type="button" className="af-back af-back--top" data-guide="af-back" onClick={() => setStudied(false)}>
                  <ChevronLeft size={16} aria-hidden /> {t(stepProp === "notas" ? "af.backToStudy" : "af.backToStudyTerm")}
                </button>
              )}
              <div className="af-seek" data-guide="af-seek">
                <h2 className="af-heading">{t("af.seekHeading").replace("{res}", stageRes)}</h2>
                <p className="af-seek__phrase">{withPoint("{x}")}</p>
                {glossWords || stepProp === "notas" ? (
                  <p className="af-seek__mean">
                    {stepProp === "notas" ? <b>{pointName.replace(/^«|»$/g, "")}</b> : null}
                    {stepProp === "notas" && glossWords ? " · " : null}
                    {glossWords ? (
                      <>
                        {t("af.inRef").replace("{ref}", refName(glossRow))} <span lang="en">«{glossWords}»</span>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>

            {/* 2. The words of the translation that render it: tapped in the draft. */}
            <div className="af-draft" data-guide="af-words">
              {/* Which verse, in which text, in words: the tags «TPL» and «Borrador» read as buttons. */}
              <p className="af-draft__where">{t("af.verseInRes").replace("{ref}", `${item.chapter}:${item.verse}`).replace("{res}", stageRes)}</p>
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
                  {/* How to choose, in the box where it is done: under the heading it was read before the reference,
                      far from the words it speaks of (18 October). In the grey of the reference's line: the two say how
                      a box is used, and blue made one of them read as a link. */}
                  <WordPicker text={verseText} selected={selected} onChange={setSelected} />
                  {/* What is marked, said, and the way to take it all off. */}
                  {selected.length ? (
                    <p className="af-echo">
                      <span>{t(selected.length === 1 ? "af.markedOne" : "af.markedMany").replace("{n}", String(selected.length))}</span>
                      <button type="button" className="af-see" onClick={() => setSelected([])}>
                        {t("af.clearMarks")}
                      </button>
                    </p>
                  ) : null}
                  {draftMore ? (
                    <div className="af-ref__extra" id="af-draft-more">
                      {/* The verse in the original, the ULT or the UST, the point highlighted, chosen as in Estudiar. */}
                      {(() => {
                        const rows = data.references.filter((row) => row.id === "orig" || glossRows.includes(row));
                        const shown = rows.find((row) => row.id === seekText) ?? glossRow ?? rows[0];
                        if (!shown) return null;
                        const verse = shown.book[`${item.chapter}:${item.verse}`] ?? "";
                        return (
                          <div className="af-ref__gloss">
                            {rows.length > 1 ? (
                              <div className="af-ref__texts" role="tablist" aria-label={t("af.readAgainst")}>
                                {rows.map((row) => (
                                  <button key={row.id} type="button" role="tab" aria-selected={shown.id === row.id} onClick={() => setSeekText(row.id)}>
                                    {refName(row)}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span className="af-gloss__name">{refName(shown)}</span>
                            )}
                            {shown.id === "orig" ? (
                              <p className="af-gloss af-orig" lang="hbo" dir="rtl">
                                <OriginalWords text={verse} words={data.originalWords[`${item.chapter}:${item.verse}`]} marked={markedIn("orig", verse)} onOpen={(word) => setSheetWord({ word, chapter: item.chapter, verse: item.verse })} />
                              </p>
                            ) : (
                              <p className="af-gloss" lang="en">
                                <Words text={verse} marked={markedIn(shown.id, verse)} />
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      <div className="af-ref__links">
                        <button type="button" className="af-see" aria-label={t("af.expandRefsAria")} onClick={() => setChapterOpen(true)}>
                          <Maximize2 size={16} aria-hidden /> {t("af.seeChapter")}
                        </button>
                      </div>
                      <VerseCorrections session={session} target={data.draft} book={data.book} chapter={item.chapter} verse={item.verse} />
                    </div>
                  ) : null}
                  <button type="button" className="af-see af-ref__fold" data-guide="af-more" aria-expanded={draftMore} aria-controls="af-draft-more" onClick={() => setDraftMore(!draftMore)}>
                    {t(draftMore ? "af.seeLess" : "af.seeMore")}
                    <ChevronDown size={18} aria-hidden className="af-more__chev" />
                  </button>
                </>
              )}
            </div>

              {fixing ? null : (
              <div className="af-decide af-decide--ask af-decide--one" data-guide="af-confirm">
                {/* Waiting, it says for what: grey and silent, it did not. */}
                <Button type="button" disabled={needsWords} onClick={() => setConfirmed(true)}>
                  {needsWords ? t("af.touchFirst") : t("af.confirmWords")}
                </Button>
                <button
                  type="button"
                  className="af-link af-decide__aside"
                  onClick={() => {
                    // Missing from the translation: what is left is to propose a change or object.
                    setConfirmed(true);
                    setChoosing(true);
                  }}
                >
                  {t("af.notThere").replace("{res}", stageRes)}
                </button>
              </div>
              )}
            </>
          ) : (
            // Step 3 of 3, as what it is: the team talking about this point, each with their face and their words. A
            // disagreement is one more message somebody answers, the most harmless thing to see (Abel, 11 November).
            <>
              {/* What is judged, small and first, in reading order as the cards before: the original with what is
                  highlighted, a fine line, the name of the translation's verse and the verse with the words chosen.
                  The chapter, folded at the foot. */}
              <div className="af-pin" data-guide="af-recap">
                <p className={reference?.id === "orig" ? "af-pin__ref af-orig" : "af-pin__ref"} lang={reference?.id === "orig" ? "hbo" : undefined} dir="auto">
                  {reference?.id === "orig" ? (
                    <OriginalWords text={refVerse} words={data.originalWords[`${item.chapter}:${item.verse}`]} marked={refMarked} only={refExcerpt ?? undefined} onOpen={(word) => setSheetWord({ word, chapter: item.chapter, verse: item.verse })} />
                  ) : refVerse ? (
                    <Words text={refVerse} marked={refMarked} only={refExcerpt ?? undefined} />
                  ) : (
                    markedWords || t("af.theMarked")
                  )}
                </p>
                <span className="af-pin__lbl">{t("af.verseInRes").replace("{ref}", `${item.chapter}:${item.verse}`).replace("{res}", stageRes)}</span>
                <p className="af-pin__verse">
                  {selected.length ? (
                    (() => {
                      const words = wordSpans(verseText);
                      const shown = shownWords(words);
                      // Words chosen one after the other are one mark: «Durante el», not «Durante» and «el».
                      return words
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
                        ));
                    })()
                  ) : verseText.trim() ? (
                    verseText
                  ) : (
                    <b>{t("af.nothingChosen")}</b>
                  )}
                </p>
                {draftMore ? (
                  <div className="af-ref__extra" id="af-pin-more">
                    <div className="af-ref__links">
                      <button type="button" className="af-see" aria-label={t("af.expandRefsAria")} onClick={() => setChapterOpen(true)}>
                        <Maximize2 size={16} aria-hidden /> {t("af.seeChapter")}
                      </button>
                    </div>
                  </div>
                ) : null}
                <button type="button" className="af-see af-ref__fold" data-guide="af-more" aria-expanded={draftMore} aria-controls="af-pin-more" onClick={() => setDraftMore(!draftMore)}>
                  {t(draftMore ? "af.seeLess" : "af.seeMore")}
                  <ChevronDown size={18} aria-hidden className="af-more__chev" />
                </button>
              </div>
              {/* The question, short: what is decided, under the name of the point and the way to its note. The words
                  are in the box above; named in the question too, it ran to five lines in three colours. */}
              <div className="af-q" data-guide="af-question">
                <p className="af-q__about">
                  {stepProp === "palabras" && pointWords ? <bdi className="af-orig">{pointWords}</bdi> : pointName.replace(/^«|»$/g, "")}
                  {hasHelp ? (
                    <>
                      {" · "}
                      <button type="button" className="af-see af-q__help" aria-controls="af-side" onClick={() => (wide ? toggleReason(!showReason) : setSheetOpen(true))}>
                        {t(stepProp === "notas" ? "af.theNote" : "af.theArticle")}
                      </button>
                    </>
                  ) : null}
                </p>
                {(() => {
                  const ask = stepProp === "palabras" ? termAsk(data.termUses.filter((use) => use.termSlug === termSlug), comparison, item.id) : "compare";
                  const key: MessageKey = needsWords
                    ? "af.askMissing"
                    : stepProp === "notas"
                      ? data.resource === "tps"
                        ? "af.askNotasTps"
                        : "af.askNotasTpl"
                      : ask === "compare"
                        ? "af.askPalabras"
                        : data.resource === "tps"
                          ? "af.askPalabrasFirstTps"
                          : "af.askPalabrasFirstTpl";
                  return (
                    <>
                      <h2 className="af-heading af-q__ask">{t(key).replace("{orig}", origWord).replace("{res}", stageRes)}</h2>
                      {/* The first time a key word of the TPL is reviewed it sets the word for the rest of the book. */}
                      {stepProp === "palabras" && ask !== "compare" && !needsWords ? <p className="af-criterion af-criterion--hint">{t(ask === "only" ? "af.qOnlyNote" : "af.qFirstNote")}</p> : null}
                    </>
                  );
                })()}
                {tally?.notApplicable ? <p className="af-stale">{t(stepProp === "notas" ? "af.notApplicableNote" : "af.notApplicableTerm").replace("{name}", askName)}</p> : null}
              </div>
              {/* What each person said, with their face and their words; Taller first, for a key word, with how it was
                  translated elsewhere. The person's own answer, kept, is their message, in green, with the way to
                  change it beside it: no screen of its own to find. */}
              <div className="af-thread" data-guide="af-thread">
                {stepProp === "palabras" && elsewhere.length ? (
                  <div className="af-msg af-msg--taller" data-guide="af-elsewhere">
                    <span className="af-msg__face" aria-hidden>
                      T
                    </span>
                    <div className="af-msg__bub">
                      <b>{titlesRead || termTitles[termSlug] ? t("af.elsewhereTerm").replace("{term}", termWord(termLabel(termSlug, termTitles))) : t("af.elsewhere")}</b>
                      <ul>
                        {elsewhere.map((r) => (
                          <li key={r.text} data-preferred={preferredTerms[termSlug]?.text.trim().toLowerCase() === r.text.trim().toLowerCase() ? "true" : undefined}>
                            <b>«{r.text}»</b> <span>{r.uses.map((u) => `${u.chapter}:${u.verse}`).join(", ")}</span>
                            {(() => {
                              const use = r.uses[0];
                              const around = use ? snippetAround(data.bookDraft[`${use.chapter}:${use.verse}`] ?? "", r.text) : null;
                              return around ? (
                                <span className="af-elsewhere__ctx">
                                  {around.cutBefore ? "… " : ""}
                                  {around.before} <mark>{around.match}</mark> {around.after}
                                  {around.cutAfter ? " …" : ""}
                                </span>
                              ) : null;
                            })()}
                          </li>
                        ))}
                      </ul>
                      {elsewhere.length > 1 ? <p className="af-hint">{t("af.manyForms").replace("{n}", String(elsewhere.length))}</p> : null}
                    </div>
                  </div>
                ) : null}
                {listed.filter((a) => a !== mine && !(wordGroups && a.status === "approved" && selectionKey(a) !== undefined)).map((a) => (
                  <div key={a.reviewer} className="af-msg">
                    <PersonPhoto login={tcCheckerOf(a) ?? a.reviewer} size="sm" />
                    <div className="af-msg__bub">
                      <b>{whoSaid(a)}</b>
                      <span>{a.note && !tcCheckerOf(a) ? a.note : saidAs(a.status)}</span>
                      {a.selectedText?.text && selectionKey(a) !== myWordsKey ? <span className="af-msg__words">«{a.selectedText.text}»</span> : null}
                      {(!mine || changing) && !stepDone && !tally?.decided ? (
                        <span className="af-msg__acts">
                          {/* Taking a colleague's objection or proposal as one's own, by a touch. */}
                          {a.status !== "approved" && a.note && mine?.status !== a.status && firstOf(a.status) === a ? (
                            <button type="button" className="af-see" data-guide="af-second" disabled={saving || needsWords} onClick={() => void answer(a.status as ReviewStance, t("af.secondNote").replace("{who}", a.reviewer))}>
                              {t("af.second")}
                            </button>
                          ) : null}
                          {a.selectedText && selectionKey(a) !== myWordsKey ? (
                            <button type="button" className="af-see" onClick={() => takeWords(a.selectedText)}>
                              {t("af.useTheseWords")}
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {mine && !changing ? (
                  <div className="af-msg af-msg--mine" data-guide="af-saved-now">
                    <div className="af-msg__bub">
                      <b>
                        <Check size={14} aria-hidden /> {t("af.you")}
                      </b>
                      <span>{mine.note && mine.status !== "approved" ? mine.note : saidAs(mine.status)}</span>
                      {mine.selectedText?.text ? <span className="af-msg__words">«{mine.selectedText.text}»</span> : null}
                      {plainAgreement && tally ? <span className="af-msg__count">{mineCount}</span> : null}
                    </div>
                    <button
                      type="button"
                      className="af-back af-msg__change"
                      onClick={() => {
                        // On a point the team had decided, the answer is changed by opening it again, as «Reabrir» does.
                        if (tally?.decided) {
                          setReopened(true);
                          setConfirmed(true);
                          setChoosing(true);
                        }
                        setChanging(true);
                      }}
                    >
                      {t("af.changeMine")}
                    </button>
                  </div>
                ) : null}
              </div>
              {/* What the team settles beyond each answer: words chosen apart, the coordinator's decision, what was said
                  before the verse was corrected. */}
              {teamBox(true)}
              {(!mine || changing) && otherWords && !needsWords && !pending ? (
                <p className="af-stale af-other-words">
                  {t(otherWords.who.length === 1 ? "af.otherWordsWarn" : "af.otherWordsWarnMany").replace("{who}", otherWords.who.map((who) => `@${who}`).join(", ")).replace("{words}", otherWords.words)}
                </p>
              ) : null}
              {/* Somebody who is not yet «habilitada» agreed and read «0 de 3 de acuerdo» over their own answer. */}
              {mine?.status === "approved" && !reviewing && !countsForMinimum(levelOf(teamLevels, me)) ? <p className="af-hint">{t("af.notCounted").replace("{level}", levelLabel("habilitada", language))}</p> : null}
              {/* Two answers of very different weight: yes, kept in green; «No del todo…», which only opens the ways to
                  say why. With nothing marked there is no yes: what is left is to propose or comment. */}
              {!pending && (!mine || changing) ? (
                <div className="af-decide af-decide--ask af-decide--one af-answers" data-guide="af-answer-final">
                  {needsWords ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => {
                          setFixText(verseText);
                          setPending("revise");
                        }}
                      >
                        {t("af.proposeWords")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => {
                          setNote(mine?.status === "rejected" && mine.note ? mine.note : "");
                          setPending("rejected");
                        }}
                      >
                        {t("af.commentTeam")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" data-kind="save" disabled={saving} onClick={() => void answer("approved")}>
                        <Check size={16} aria-hidden /> {t("af.yesFine")}
                      </Button>
                      <Button type="button" variant="outline" disabled={saving} onClick={() => setNoSheet(true)}>
                        {t("af.notQuite")}
                      </Button>
                    </>
                  )}
                  {alike.length && !needsWords ? (
                    // The uses that read the same are agreed with here; the person stops where the term reads otherwise.
                    <Button type="button" variant="outline" className="af-alike" data-kind="save-alt" data-guide="af-alike" disabled={saving} onClick={() => void answerAlike()}>
                      <Check size={16} aria-hidden /> {t(alike.length === 1 ? "af.alikeOne" : "af.alikeMany").replace("{n}", String(alike.length))}
                    </Button>
                  ) : null}
                  {needsWords ? null : (
                    <button
                      type="button"
                      className="af-back af-decide__aside"
                      data-guide="af-change"
                      onClick={() => {
                        // Other words for an answer given are a change of it: the answer is asked again after them.
                        if (mine) setChanging(true);
                        setConfirmed(false);
                        window.setTimeout(() => document.querySelector(".af-draft__words")?.scrollIntoView({ block: "center" }), 80);
                      }}
                    >
                      <ChevronLeft size={16} aria-hidden /> {t("af.changeTheWords")}
                    </button>
                  )}
                  {needsWords || changing || reopened ? (
                    <button
                      type="button"
                      className="af-back af-decide__aside"
                      onClick={() => {
                        setChoosing(false);
                        // Nothing marked: back to marking, not to a «Sí, está bien» that cannot be touched.
                        if (needsWords) setConfirmed(false);
                        // An answer being changed, or a closed point opened by mistake, stays as it was.
                        setChanging(false);
                        if (reopened) setReopened(false);
                      }}
                    >
                      <ChevronLeft size={16} aria-hidden /> {t(needsWords ? "af.markAgain" : "af.cancel")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {mine && !changing ? (
                // The way on from a point answered: the next one, or the list after the last.
                <div className="af-decide af-decide--ask af-decide--one">
                  {nextFrom(position) >= 0 ? (
                    <Button type="button" data-guide="af-next" onClick={() => goTo(nextFrom(position))}>
                      {t(stepProp === "notas" ? "af.nextNote" : "af.nextTerm")} <ChevronRight size={18} aria-hidden />
                    </Button>
                  ) : (
                    <Button type="button" data-guide="af-next" onClick={() => setListOpen(true)}>
                      {t(stepProp === "notas" ? "af.listNotes" : "af.listTerms")}
                    </Button>
                  )}
                </div>
              ) : null}
              {pending === "revise" ? (
                // «Su propuesta»: the verse as it should read, written beside today's, which stays as it is above; what
                // it changes is marked in green under the box (Abel, 11 November, from «Hoy» y «Su propuesta»).
                <div className="af-prop" ref={whyRef} role="group" aria-label={t("af.fixAria")} data-guide="af-why">
                  <label htmlFor="af-fix-point" className="af-prop__lbl">
                    {t("af.yourProposal")}
                  </label>
                  <p className="af-subhead">
                    {needsWords && markedWords
                      ? t("af.changeHintMissing")
                          .split(/(\{orig\})/)
                          .map((piece, at) =>
                            piece === "{orig}" ? (
                              <span key={at}>
                                «<bdi className={reference?.id === "orig" ? "af-orig af-about__quote-words" : "af-about__quote-words"} lang={reference?.id === "orig" ? "hbo" : undefined}>{markedWords}</bdi>»
                              </span>
                            ) : (
                              piece
                            ),
                          )
                      : t("af.changeHint")}
                  </p>
                  <textarea id="af-fix-point" className="af-textarea" rows={4} value={fixText} autoFocus aria-label={t("af.verseText")} onChange={(e) => setFixText(e.target.value)} />
                  {fixText.trim() && fixText.trim() !== verseText.trim() ? (
                    <p className="af-prop__diff">
                      {changedWords(verseText, fixText).map((word, at) => (
                        <span key={at}>
                          {at ? " " : null}
                          {word.changed ? <ins>{word.text}</ins> : word.text}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {/* Why, by a touch; what a touch does not say can be written: as when correcting from the box. */}
                  <span className="af-lbl">{t("fx.reasons")}</span>
                  <CorrectionReasons value={fixReasons} onChange={setFixReasons} />
                  <ReasonField id="af-fix-point-reason" rows={2} value={fixReason} onChange={setFixReason} session={session} ctx={ctx} chapter={item.chapter} verse={item.verse} placeholder={t("fx.whyHint")} ariaLabel={t("fx.why")} />
                  <div className="af-decide af-decide--ask af-decide--one">
                    {/* A proposal is a change to the verse: the verse unchanged proposes nothing. */}
                    <Button type="button" data-kind="save" disabled={saving || !fixText.trim() || fixText.trim() === verseText.trim()} onClick={() => void proposeForPoint()}>
                      {saving ? (
                        t("af.saving")
                      ) : (
                        <>
                          <Check size={16} aria-hidden /> {t("af.sendToTeam")}
                        </>
                      )}
                    </Button>
                    <button
                      type="button"
                      className="af-back af-decide__aside"
                      onClick={() => {
                        setPending(null);
                        setChoosing(false);
                      }}
                    >
                      <ChevronLeft size={16} aria-hidden /> {t("af.leaveAsIs")}
                    </button>
                  </div>
                </div>
              ) : pending ? (
                <div className="af-prop af-prop--comment" ref={whyRef} data-guide="af-why">
                  <label htmlFor="af-note" className="af-prop__lbl">
                    {t(needsWords ? "af.whyMissing" : "af.yourComment").replace("{res}", stageRes)}
                  </label>
                  <textarea id="af-note" className="af-textarea" rows={3} value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
                  <div className="af-decide af-decide--ask af-decide--one">
                    <Button type="button" data-kind="save" disabled={saving || !note.trim()} onClick={() => void answer(pending)}>
                      {saving ? (
                        t("af.saving")
                      ) : (
                        <>
                          <Check size={16} aria-hidden /> {t("af.sendToTeam")}
                        </>
                      )}
                    </Button>
                    <button
                      type="button"
                      className="af-back af-decide__aside"
                      onClick={() => {
                        setPending(null);
                        setChoosing(false);
                      }}
                    >
                      <ChevronLeft size={16} aria-hidden /> {t("af.backToQuestion")}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
          </div>
          {/* After the work in the page, so that it is read after it: on a computer, its column at the right. */}
          {wide && showReason && (closedView || (studied && confirmed)) ? sidePanel(() => toggleReason(false)) : null}
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
