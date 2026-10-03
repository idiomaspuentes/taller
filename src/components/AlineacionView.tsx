import { toolHeading } from "./toolHeading";
import { draftTaskId } from "../dcs/afinacionLoad";
import { saveCorrection } from "../dcs/afinacionStore";
import { ChapterReader } from "./ChapterReader";
import { BookOpen, Eraser, Redo2, Undo2 } from "lucide-react";
import { ToolHeader } from "./ToolHeader";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { levelsForTeam } from "../domain/levels";
import { closesInItsTool } from "../domain/stepClaim";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { RoundPanel } from "./RoundPanel";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { AlignmentGroup } from "@usfm-tools/types";
import type { WordToken } from "@usfm-tools/editor-core";
import {
  addSourcesToBox,
  computeAlignedSourceIndices,
  deriveAlignmentBoxes,
  detachTargetRefFromGroup,
  mergeAlignmentBoxes,
  orderedAlignedTransIndices,
  removeSourcesFromBox,
  splitAlignmentGroupPure,
  transIndexForAlignedWord,
  type AlignmentBoxModel,
} from "@usfm-ast/alignment-box-model";
import { loadSession, type GtSession } from "../dcs/auth";
import { appendMyDecision, loadDecisionFiles } from "../dcs/afinacionStore";
import { loadAlineacion, type AlineacionData, type AlignmentVerse } from "../dcs/alignmentLoad";
import { saveVerseAlignment } from "../dcs/alignmentStore";
import { loadProposalFiles, openAlignmentDecision } from "../dcs/alignmentDecisionStore";
import { settledProposalIds, type ProposalFile, type ResultFile } from "../domain/alignmentDecision";
import { alignmentHash } from "../domain/alignmentHash";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import {
  mergeDecisionFiles,
  summarizeRound,
  tallyItem,
  type ReviewDecision,
  type ReviewStance,
} from "../domain/reviewRound";
import { shortGloss } from "../domain/alignmentGloss";
import { AlignmentBoxes } from "./AlignmentBoxes";
import { groupsAfterTextEdit, objectedBoxKeys, sameText, tokensFromText, viewFromTokens, wordDiff } from "../domain/verseEditView";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { DEFAULT_SOURCE_PACKAGE, resolveSourcePackage, type SourcePackage } from "../domain/sourcePackage";
import type { ProjectTask } from "../domain/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { explainError } from "../dcs/userError";
import { tallerConfig, workspaceOfOrg } from "../config";
import { lexiconRepos, loadLexiconEntry } from "../dcs/lexicon";
import { glossesInclude, strongParts, type LexiconFile } from "../domain/lexicon";
import { WordSheet } from "./WordSheet";
import { CorrectionSheet } from "./CorrectionSheet";

export type AlineacionMode = "alinear" | "revisar";

type Props = {
  ctxEncoded: string;
  mode: AlineacionMode;
  /**
   * One step for the whole team: each person takes the verses they will align, and what is finished goes on to
   * review by the others, verse by verse. Without it the screen is one or the other, as the step says.
   */
  shared?: boolean;
  onClose: () => void;
  announce: (msg: string) => void;
};

const STANCE_KEY: Record<ReviewStance, MessageKey> = {
  approved: "rv.approved",
  revise: "rv.revise",
  rejected: "rv.rejected",
};

const BANK_ID = "bank";
const boxDropId = (id: string) => `box-${id}`;
const itemId = (chapter: number, verse: number) => `al:${chapter}:${verse}`;
/** «Terminé»: whoever aligned a verse says it is ready to be reviewed. */
const doneId = (chapter: number, verse: number) => `al-done:${chapter}:${verse}`;
/** «Lo tomo»: who is aligning a verse, so two people do not work the same one. A note `released` gives it back. */
const takeId = (chapter: number, verse: number) => `al-take:${chapter}:${verse}`;
const RELEASED = "released";

type DragData =
  | { type: "word"; indices: number[] }
  | { type: "chip"; boxId: string; transIndex: number };

/** What a reviewer sees of the verse: the draft words and every link, so any change makes old answers stale. */
function alignmentFingerprint(draft: WordToken[], groups: AlignmentGroup[]): string {
  return alignmentHash(draft.map((w) => w.surface), groups);
}

function verseComplete(verse: AlignmentVerse, groups: AlignmentGroup[]): boolean {
  // Every word of the draft is linked. Words of the original may stay alone (for example the written
  // form of a word the Hebrew gives twice), so empty boxes do not block a verse.
  const boxes = deriveAlignmentBoxes(verse.original, groups, verse.draft);
  return verse.draft.length > 0 && computeAlignedSourceIndices(verse.draft, boxes).every(Boolean);
}

function Occurrence({ token }: { token: WordToken }) {
  return token.occurrences > 1 ? <sup className="al-occ">{token.occurrence}</sup> : null;
}

/** A draft word in the bank: tap to select, long-press or drag to put it in a box. */
function BankWord({
  token,
  index,
  aligned,
  selected,
  dragIndices,
  disabled,
  onTap,
}: {
  token: WordToken;
  index: number;
  aligned: boolean;
  selected: boolean;
  dragIndices: number[];
  disabled: boolean;
  onTap: (index: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `word-${index}`,
    data: { type: "word", indices: dragIndices } satisfies DragData,
    disabled: disabled || aligned,
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="al-word"
      data-aligned={aligned ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      disabled={disabled && !aligned ? true : undefined}
      aria-pressed={selected}
      onClick={() => !aligned && onTap(index)}
    >
      {token.surface}
      <Occurrence token={token} />
    </button>
  );
}

/** A word already placed in a box: draggable to another box or back to the bank, with a remove button. */
function PlacedWord({
  token,
  boxId,
  transIndex,
  disabled,
  onRemove,
}: {
  token: WordToken;
  boxId: string;
  transIndex: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip-${boxId}-${transIndex}`,
    data: { type: "chip", boxId, transIndex } satisfies DragData,
    disabled,
  });
  return (
    <span className="al-chip" data-dragging={isDragging ? "true" : undefined} data-no-box-select>
      <button type="button" ref={setNodeRef} {...listeners} {...attributes} className="al-chip__word" data-no-box-select>
        {token.surface}
        <Occurrence token={token} />
      </button>
      {!disabled ? (
        <button type="button" className="al-chip__x" aria-label={t("al.removeFromBox").replace("{w}", token.surface)} onClick={onRemove} data-no-box-select>
          ×
        </button>
      ) : null}
    </span>
  );
}

function Box({
  box,
  draft,
  gloss,
  compact,
  selected,
  hinted,
  editable,
  onTap,
  onWord,
  onRemoveWord,
}: {
  box: AlignmentBoxModel;
  draft: WordToken[];
  /** English gloss of each word of the original, by its index in the verse. */
  gloss: string[];
  /** An empty box that is not being filled: one slim line instead of a tall drop area. */
  compact: boolean;
  selected: boolean;
  /** The lexicon gives the draft word in hand as a rendering of this box's word. */
  hinted?: boolean;
  editable: boolean;
  onTap: (boxId: string) => void;
  /** A word of the original was tapped: show what it means. */
  onWord: (boxId: string, refIndex: number) => void;
  onRemoveWord: (boxId: string, transIndex: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: boxDropId(box.id), data: { boxId: box.id }, disabled: !editable });
  const merged = box.targetTokens.length > 1;
  return (
    <div
      ref={setNodeRef}
      role="group"
      className="al-box"
      data-merged={merged ? "true" : undefined}
      data-compact={compact ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-hint={hinted ? "true" : undefined}
      data-over={isOver && editable ? "true" : undefined}
      onClick={(e) => {
        if (!editable || (e.target as HTMLElement).closest("[data-no-box-select]")) return;
        onTap(box.id);
      }}
    >
      <div className="al-box__head">
        <div className="al-box__refs">
          {box.targetTokens.map((tok, i) => {
            const refIndex = box.targetTokenIndices[i] ?? 0;
            return (
              <button
                key={refIndex}
                type="button"
                className="al-ref"
                aria-label={tNow("lx.wordAria").replace("{word}", tok.surface)}
                onClick={() => onWord(box.id, refIndex)}
                data-no-box-select
              >
                <span className="al-ref__word">{tok.surface}</span>
                {gloss[refIndex] ? (
                  <span className="al-ref__gloss" dir="ltr" title={tok.lemma ? `${gloss[refIndex]} · ${tok.lemma}` : gloss[refIndex]}>
                    {shortGloss(gloss[refIndex]!)}
                  </span>
                ) : tok.lemma ? (
                  <span className="al-ref__lemma">{tok.lemma}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {compact ? (
          <span className="al-box__plus" aria-hidden>
            +
          </span>
        ) : null}
      </div>
      <div className="al-box__body">
        {box.alignedSourceWords.length === 0 ? (
          <span className="al-box__empty" aria-hidden>
            {editable ? "+" : "—"}
          </span>
        ) : (
          box.alignedSourceWords.map((aw) => {
            const at = transIndexForAlignedWord(draft, aw);
            const token = at !== null ? draft[at] : undefined;
            return token && at !== null ? (
              <PlacedWord key={`${aw.word}-${aw.occurrence}`} token={token} boxId={box.id} transIndex={at} disabled={!editable} onRemove={() => onRemoveWord(box.id, at)} />
            ) : (
              <span key={`${aw.word}-${aw.occurrence}`} className="al-chip">
                {aw.word}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

const BANK_HEIGHT_KEY = "taller.al-bank-height";
// The least the bank can be: its bar, one line of the verse and its foot. Lower, the foot with the grip is cut off
// and there is no way to make it taller again.
const BANK_MIN = 144;

function savedBankHeight(): number | null {
  try {
    const n = Number(window.localStorage.getItem(BANK_HEIGHT_KEY));
    return n >= BANK_MIN ? n : null;
  } catch {
    return null;
  }
}

/**
 * The words of the draft, in a box whose height the person chooses: dragging its bottom edge, or with a button
 * that opens it to the whole verse and back. Reading the verse well is part of deciding the alignment.
 */
function Bank({ children, editable, foot }: { children: ReactNode; editable: boolean; foot?: ReactNode }) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: BANK_ID, disabled: !editable });
  const [height, setHeight] = useState<number | null>(() => savedBankHeight());
  const [open, setOpen] = useState(false);
  const drag = useRef<{ y: number; h: number; last?: number } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const keep = (h: number | null) => {
    setHeight(h);
    try {
      if (h) window.localStorage.setItem(BANK_HEIGHT_KEY, String(Math.round(h)));
      else window.localStorage.removeItem(BANK_HEIGHT_KEY);
    } catch {
      /* the size is a convenience */
    }
  };
  const max = () => Math.round(window.innerHeight * 0.7);
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        box.current = node;
      }}
      className="al-bank"
      data-over={isOver ? "true" : undefined}
      data-open={open ? "true" : undefined}
      style={!open && height ? { maxHeight: height } : undefined}
      role="region"
      aria-label={t("al.bankAria")}
    >
      {children}
      <div className="al-bank__foot">
        {foot}
        <button
          type="button"
          className="al-bank__grip"
          aria-label={t("al.bankResize")}
          title={t("al.bankResize")}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, h: box.current?.getBoundingClientRect().height ?? BANK_MIN };
            setOpen(false);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const next = Math.min(max(), Math.max(BANK_MIN, drag.current.h + e.clientY - drag.current.y));
            drag.current = { ...drag.current, last: next };
            setHeight(next);
          }}
          onPointerUp={() => {
            // The height dragged to is kept for next time (read from the drag: the state may not be updated yet).
            if (drag.current?.last) keep(drag.current.last);
            drag.current = null;
          }}
          onDoubleClick={() => setOpen(!open)}
        >
          <span aria-hidden />
        </button>
        <button type="button" className="af-link al-bank__size" onClick={() => setOpen(!open)}>
          {t(open ? "al.bankLess" : "al.bankMore")}
        </button>
      </div>
    </div>
  );
}

/**
 * The alignment step of a Afinación, built like the alignment editor of the
 * enhanced project model: one box per word of the original, a bank with the
 * words of the draft, and words that go from the bank into the boxes. On a
 * phone a word is selected with a tap and put in a box with another tap;
 * dragging (long press) works too. Whoever reviews sees the same boxes
 * read-only and answers.
 */
export function AlineacionView({ ctxEncoded, mode: initialMode, shared: sharedByRoute = false, onClose, announce }: Props) {
  const [mode, setMode] = useState<AlineacionMode>(initialMode);
  const t = useT();
  const language = useUiLanguage();
  const stanceLabel = (status: string) => t(STANCE_KEY[status as ReviewStance] ?? "rv.approved");
  const n = (key: MessageKey, count: number) => t(key).replace("{n}", String(count));
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<AlineacionData | null>(null);
  /** The source package the project reads from: for reading the chapter in the other texts. */
  const [pkg, setPkg] = useState<SourcePackage>(DEFAULT_SOURCE_PACKAGE);
  const [pane, setPane] = useState<"align" | "chapter">("align");
  /** Correcting the text of the verse in view, with why. */
  const [fixing, setFixing] = useState(false);
  /** What went wrong inside the correction sheet: shown there, not behind it. */
  const [fixError, setFixError] = useState("");
  const [task, setTask] = useState<ProjectTask | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  const [position, setPosition] = useState(0);
  const [groups, setGroups] = useState<Record<number, AlignmentGroup[]>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [history, setHistory] = useState<Record<number, { past: AlignmentGroup[][]; future: AlignmentGroup[][] }>>({});
  const [selectedWords, setSelectedWords] = useState<number[]>([]);
  /** The text the bank shows: the draft (the one whose words are placed), the original, or the English. */
  const [bankText, setBankText] = useState<"draft" | "orig" | "ref">("draft");
  const bankWords = useRef<HTMLDivElement | null>(null);
  const [selectedBoxes, setSelectedBoxes] = useState<string[]>([]);
  /** The lexicon entry of each word of the original of the verse in view, by its place in the verse. */
  const [verseLex, setVerseLex] = useState<Record<number, LexiconFile>>({});
  /** The word of the original whose meaning is shown over the tool. */
  const [sheet, setSheet] = useState<{ boxId: string; refIndex: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [proposals, setProposals] = useState<{ proposals: ProposalFile[]; results: ResultFile[] }>({ proposals: [], results: [] });
  /** A proposal being written: the alignment as it was, to put back if it is cancelled or sent. */
  const [proposing, setProposing] = useState<{ base: AlignmentGroup[]; text: string; tokens: WordToken[] | null } | null>(null);
  const [objecting, setObjecting] = useState(false);
  const [objectWords, setObjectWords] = useState<string[]>([]);
  const [sentIssue, setSentIssue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [stepDone, setStepDone] = useState(false);
  const [closingRound, setClosingRound] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

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
      const thisTask = board?.teams.find((t) => t.id === decoded.taskId) ?? null;
      setTask(thisTask);
      // The text read is the one its translation task writes, wherever this task stands in the phase.
      const sourceTaskId = (board && draftTaskId(board.teams, decoded.resource)) || thisTask?.waitsFor?.find((w) => w.taskId)?.taskId;
      if (!sourceTaskId) {
        throw new Error(tNow("al.noSource"));
      }
      setPkg(resolveSourcePackage(board?.settings));
      const loaded = await loadAlineacion({ session, ctx: decoded, sourceTaskId, pkg: resolveSourcePackage(board?.settings) });
      // Everything is read before anything is shown: a verse must not look unfinished for a moment
      // because the decisions and answers about it have not arrived yet.
      const repoTarget = { owner: loaded.draft.owner, repo: loaded.draft.repo, branch: loaded.draft.branch };
      const [files, loadedProposals] = await Promise.all([
        loadDecisionFiles(session, repoTarget, loaded.book),
        loadProposalFiles(session, repoTarget, loaded.book).catch(() => ({ proposals: [], results: [] })),
      ]);
      setDecisions(mergeDecisionFiles(files));
      setProposals(loadedProposals);
      setData(loaded);
      setGroups(Object.fromEntries(loaded.verses.map((v) => [v.verse, v.groups])));
      setDirty({});
    } catch (err) {
      setError(err instanceof Error ? localizeThread(err.message, language) : String(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session]);

  useEffect(() => {
    void load();
  }, [load]);

  // Leaving the page with changes that were not saved asks first.
  const hasUnsaved = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  const baseVerse = data?.verses[Math.min(position, Math.max((data?.verses.length ?? 1) - 1, 0))];
  /** While a proposal edits the text, the verse has the words of the new text. */
  const verse = baseVerse && proposing?.tokens ? { ...baseVerse, draft: proposing.tokens } : baseVerse;
  const current = useMemo(() => (verse ? groups[verse.verse] ?? [] : []), [verse, groups]);
  const boxes = useMemo(() => (verse ? deriveAlignmentBoxes(verse.original, current, verse.draft) : []), [verse, current]);
  const aligned = useMemo(() => (verse ? computeAlignedSourceIndices(verse.draft, boxes) : []), [verse, boxes]);

  const me = (session?.username ?? "").toLowerCase();
  const taskStep = task?.steps?.find((s) => s.id === ctx?.stepId);
  // Who counts for the minimum is decided by the levels of this task's team.
  const teamLevels = useMemo(() => levelsForTeam(data?.levelBook, task?.orgTeamName), [data?.levelBook, task?.orgTeamName]);
  // An open round: one step anybody of the team enters, that closes by agreement and leaves nobody out for having
  // done an earlier step. A project that turned its two steps into one by hand keeps the old step id, so the step
  // itself says it, not only the address the tool was opened with.
  const shared = sharedByRoute || Boolean(taskStep && taskStep.claimMode === "pool" && taskStep.closing === "consensus" && !taskStep.excludePriorStepIds?.length);
  const thresholds = { minAgree: taskStep?.minAgree ?? taskStep?.minAssignees ?? 3, minIndependent: taskStep?.minIndependent ?? 2 };
  const hashOf = (v: AlignmentVerse) => alignmentFingerprint(v.draft, groups[v.verse] ?? []);
  // When the team decides not to change the alignment, the open answer that came with the
  // proposal or objection stops blocking the verse.
  const settled = useMemo(() => settledProposalIds(proposals.results), [proposals]);
  const effective = useMemo(() => decisions.filter((d) => !(d.proposalId && settled.has(d.proposalId))), [decisions, settled]);
  /** An accepted proposal is what the verse looks like now: its result carries the hash of that version. */
  const acceptedFor = (v: AlignmentVerse): ResultFile[] =>
    data ? proposals.results.filter((r) => r.outcome === "aceptada" && r.chapter === data.chapter && r.verse === v.verse && r.newHash === hashOf(v)) : [];
  const isDone = (v: AlignmentVerse) =>
    Boolean(data) && (effective.some((d) => d.itemId === doneId(data!.chapter, v.verse) && d.textHash === hashOf(v)) || acceptedFor(v).length > 0);
  /** Decisions about this verse that nobody has closed yet. */
  const openFor = (v: AlignmentVerse) =>
    data ? proposals.proposals.filter((p) => p.chapter === data.chapter && p.verse === v.verse && !proposals.results.some((r) => r.id === p.id)) : [];
  /** Objections that prospered and asked for an adjustment nobody has made yet. */
  const realignFor = (v: AlignmentVerse) =>
    data ? proposals.results.filter((r) => r.outcome === "realinear" && r.chapter === data.chapter && r.verse === v.verse && r.baseHash === hashOf(v)) : [];
  // Whoever marked a verse as finished is its author: their answer does not count as independent.
  /** Who wrote the version of the verse with this hash: who marked it finished, or whose proposal was accepted. */
  const authorsAt = (v: AlignmentVerse, hash: string): string[] =>
    data
      ? [
          ...effective.filter((d) => d.itemId === doneId(data.chapter, v.verse) && d.textHash === hash).map((d) => d.reviewer),
          ...proposals.results.filter((r) => r.outcome === "aceptada" && r.chapter === data.chapter && r.verse === v.verse && r.newHash === hash).map((r) => r.proposer),
        ]
      : [];
  const authorsOf = (v: AlignmentVerse): string[] => authorsAt(v, hashOf(v));
  const answeredByMe = (v: AlignmentVerse) =>
    Boolean(data) && effective.some((d) => d.itemId === itemId(data!.chapter, v.verse) && d.reviewer.trim().toLowerCase() === me && d.textHash === hashOf(v));
  const authoredByMe = (v: AlignmentVerse) => authorsOf(v).some((a) => a.trim().toLowerCase() === me);
  /** In review: finished by its author, not written by me, and not answered by me since it last changed. */
  const pendingForMe = (v: AlignmentVerse) => isDone(v) && !answeredByMe(v) && !authoredByMe(v);
  /** Shared step: who took the verse to align it (the latest «lo tomo» that was not given back). */
  const ownerOf = (v: AlignmentVerse): string => {
    if (!data) return "";
    const id = takeId(data.chapter, v.verse);
    const last = decisions.filter((d) => d.itemId === id).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    return last && last.note !== RELEASED ? last.reviewer.trim().toLowerCase() : "";
  };
  /** In a shared step a verse is aligned only by whoever took it; otherwise by whoever has the step. */
  const mineToAlign = (v: AlignmentVerse) => !shared || ownerOf(v) === me;
  const needsWork = (v: AlignmentVerse) => (mode === "alinear" ? !isDone(v) && (mineToAlign(v) || !ownerOf(v)) : pendingForMe(v));
  const editable = (mode === "alinear" && Boolean(verse) && mineToAlign(verse!)) || Boolean(proposing);
  // In a shared step everybody aligns some verses and reviews the rest: whoever finished a verse stands behind it,
  // so that mark counts as their agreement (never as an independent one). Without it a team of three could not
  // reach an agreement of three on any verse.
  const counted = useMemo(() => {
    if (!shared || !data) return effective;
    const own: ReviewDecision[] = [];
    for (const v of data.verses) {
      const hash = alignmentFingerprint(v.draft, groups[v.verse] ?? []);
      const id = itemId(data.chapter, v.verse);
      for (const d of effective) {
        if (d.itemId !== doneId(data.chapter, v.verse) || d.textHash !== hash) continue;
        own.push({ ...d, itemId: id, status: "approved" });
      }
    }
    return [...own, ...effective];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, data, effective, groups]);
  const tally =
    verse && data
      ? tallyItem({ itemId: itemId(data.chapter, verse.verse), decisions: counted, currentHash: hashOf(verse), levels: teamLevels, authors: authorsOf(verse), thresholds })
      : null;
  const mine = tally?.answers.find((a) => a.reviewer.trim().toLowerCase() === me);
  const others = (tally?.answers ?? []).filter((a) => a.reviewer.trim().toLowerCase() !== me);
  const summary = useMemo(
    () =>
      data
        ? summarizeRound({
            itemIds: data.verses.map((v) => itemId(data.chapter, v.verse)),
            decisions: counted,
            currentHashes: Object.fromEntries(data.verses.map((v) => [itemId(data.chapter, v.verse), alignmentFingerprint(v.draft, groups[v.verse] ?? [])])),
            levels: teamLevels,
            authors: [],
            authorsByItem: Object.fromEntries(data.verses.map((v) => [itemId(data.chapter, v.verse), authorsOf(v)])),
            thresholds,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, counted, proposals, groups, thresholds.minAgree, thresholds.minIndependent, teamLevels],
  );

  // The review of the alignment closes here, by consensus, when the step says so (objections are settled as team
  // decisions in the conversation, so there is no final decision to record on this screen).
  const closesHere = (shared || mode === "revisar") && Boolean(taskStep && closesInItsTool(taskStep) && ctx?.issueNumber);
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

  async function closeRound() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !taskStep) return;
    setClosingRound(true);
    setError("");
    try {
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: taskStep.id });
      setStepDone(true);
      announce(t("round.closedNow"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setClosingRound(false);
    }
  }

  // An open round opens where this person is needed: on a verse waiting for their review if there is one (that is
  // what lets somebody else's work move on), otherwise on the first verse nobody has aligned yet. Once, on arrival.
  const placed = useRef(false);
  useEffect(() => {
    if (!shared || !data || placed.current) return;
    placed.current = true;
    const toReview = data.verses.findIndex(pendingForMe);
    const toAlign = data.verses.findIndex((v) => !isDone(v) && (ownerOf(v) === me || !ownerOf(v)));
    if (toReview >= 0) {
      setMode("revisar");
      setPosition(toReview);
    } else if (toAlign >= 0) {
      setMode("alinear");
      setPosition(toAlign);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, data]);

  useEffect(() => {
    setSelectedWords([]);
    setSelectedBoxes([]);
    setNote("");
    setObjecting(false);
    setObjectWords([]);
    setSentIssue(null);
  }, [verse?.verse]);

  function clearSelection() {
    setSelectedWords([]);
    setSelectedBoxes([]);
  }

  function change(next: AlignmentGroup[] | null) {
    if (!verse || !next) return;
    const before = current;
    setHistory((prev) => {
      const h = prev[verse.verse] ?? { past: [], future: [] };
      return { ...prev, [verse.verse]: { past: [...h.past.slice(-49), before], future: [] } };
    });
    setGroups((prev) => ({ ...prev, [verse.verse]: next }));
    setDirty((prev) => ({ ...prev, [verse.verse]: true }));
    clearSelection();
  }

  const canUndo = Boolean(verse && (history[verse.verse]?.past.length ?? 0) > 0);
  const canRedo = Boolean(verse && (history[verse.verse]?.future.length ?? 0) > 0);

  function undo() {
    if (!verse) return;
    const h = history[verse.verse];
    const back = h?.past[h.past.length - 1];
    if (!h || !back) return;
    setHistory((prev) => ({ ...prev, [verse.verse]: { past: h.past.slice(0, -1), future: [current, ...h.future] } }));
    setGroups((prev) => ({ ...prev, [verse.verse]: back }));
    setDirty((prev) => ({ ...prev, [verse.verse]: true }));
    clearSelection();
  }

  function redo() {
    if (!verse) return;
    const h = history[verse.verse];
    const ahead = h?.future[0];
    if (!h || !ahead) return;
    setHistory((prev) => ({ ...prev, [verse.verse]: { past: [...h.past, current], future: h.future.slice(1) } }));
    setGroups((prev) => ({ ...prev, [verse.verse]: ahead }));
    setDirty((prev) => ({ ...prev, [verse.verse]: true }));
    clearSelection();
  }

  function put(boxId: string, indices: number[]) {
    if (!verse || !indices.length) return;
    change(addSourcesToBox(verse.original, verse.draft, current, boxId, indices));
  }

  function tapWord(index: number) {
    setSelectedBoxes([]);
    setSelectedWords((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));
  }

  function tapBox(boxId: string) {
    if (selectedWords.length) {
      put(boxId, selectedWords);
      return;
    }
    setSelectedBoxes((prev) => (prev.includes(boxId) ? prev.filter((id) => id !== boxId) : [...prev, boxId]));
  }

  function removeWord(boxId: string, transIndex: number) {
    if (!verse) return;
    change(removeSourcesFromBox(verse.original, verse.draft, current, boxId, [transIndex]));
  }

  function join() {
    if (!verse || selectedBoxes.length < 2) return;
    change(mergeAlignmentBoxes(verse.original, verse.draft, current, selectedBoxes, selectedBoxes[0]!));
  }

  function separate() {
    if (!verse || selectedBoxes.length !== 1) return;
    const box = boxes.find((b) => b.id === selectedBoxes[0]);
    if (!box || box.groupIndex === null) return;
    change(splitAlignmentGroupPure(verse.original, verse.draft, current, box.groupIndex));
  }

  /** Take one word of the original out of the box it shares with others; asked from the word's sheet. */
  function separateWord(boxId: string, refIndex: number) {
    const box = boxes.find((b) => b.id === boxId);
    if (!verse || !box || box.groupIndex === null) return;
    change(detachTargetRefFromGroup(verse.original, verse.draft, current, box.groupIndex, refIndex));
    setSheet(null);
  }

  function emptyBoxes() {
    if (!verse) return;
    let next = current;
    for (const id of selectedBoxes) {
      const nowBoxes = deriveAlignmentBoxes(verse.original, next, verse.draft);
      const box = nowBoxes.find((b) => b.targetTokenIndices.join(",") === boxes.find((x) => x.id === id)?.targetTokenIndices.join(","));
      if (box) next = removeSourcesFromBox(verse.original, verse.draft, next, box.id, orderedAlignedTransIndices(box, verse.draft));
    }
    change(next);
  }

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as DragData | undefined;
    if (data?.type === "word") setDragging(verse?.draft[data.indices[0]!]?.surface ?? null);
    if (data?.type === "chip") setDragging(verse?.draft[data.transIndex]?.surface ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    if (!verse || !e.over) return;
    const from = e.active.data.current as DragData | undefined;
    const overId = String(e.over.id);
    const toBox = overId.startsWith("box-") ? overId.slice(4) : null;
    if (!from) return;
    if (from.type === "word" && toBox) {
      // A selected word carries the whole selection.
      const group = from.indices.length ? from.indices : [];
      put(toBox, group);
    } else if (from.type === "chip") {
      if (toBox && toBox !== from.boxId) put(toBox, [from.transIndex]);
      else if (overId === BANK_ID) removeWord(from.boxId, from.transIndex);
    }
  }

  /** Saves a verse. Returns its links as they were stored (what a reload will show), or `null` if it failed. */
  async function saveVerseOf(target: AlignmentVerse): Promise<AlignmentGroup[] | null> {
    if (!session || !data) return null;
    setSaving(true);
    setError("");
    try {
      const saved = await saveVerseAlignment({
        session,
        target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
        filepath: data.draft.filepath,
        book: data.book,
        chapter: data.chapter,
        verse: target.verse,
        groups: groups[target.verse] ?? [],
        source: data.source,
      });
      setGroups((prev) => ({ ...prev, [target.verse]: saved.stored }));
      setDirty((prev) => ({ ...prev, [target.verse]: false }));
      announce(t("al.saved").replace("{ref}", `${data.book} ${data.chapter}:${target.verse}`));
      return saved.stored;
    } catch (err) {
      setError(explainError(err));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveVerse(): Promise<AlignmentGroup[] | null> {
    return verse ? saveVerseOf(verse) : null;
  }

  /** Change verse; what was edited in this one is saved first, so nothing is left only in memory. */
  async function goTo(index: number) {
    if (!data || index < 0 || index >= data.verses.length || index === position) return;
    if (proposing || objecting) {
      announce(t("al.finishFirst"));
      return;
    }
    if (mode === "alinear" && verse && dirty[verse.verse] && !(await saveVerseOf(verse))) return;
    setPosition(index);
  }

  /** The next verse (after this one, wrapping) that still needs this person's work. */
  function nextNeedingWork(): number {
    if (!data) return -1;
    const n = data.verses.length;
    for (let k = 1; k < n; k++) {
      const i = (position + k) % n;
      if (needsWork(data.verses[i]!)) return i;
    }
    return -1;
  }

  function moveOnAfterAction() {
    const next = nextNeedingWork();
    if (next >= 0) setPosition(next);
    else announce(mode === "alinear" ? t("al.allDone") : t("al.noneToAnswer"));
  }

  async function saveAndNext() {
    if (dirty[verse?.verse ?? -1] && !(await saveVerse())) return;
    if (data && position < data.verses.length - 1) setPosition((p) => p + 1);
  }

  async function leave() {
    if (mode === "alinear" && data) {
      for (const v of data.verses) {
        if (dirty[v.verse] && !(await saveVerseOf(v))) return;
      }
    }
    onClose();
  }

  /** Correct the text of the verse in view on the group's draft; what is aligned of the words that stay is kept. */
  async function saveFix(text: string, why: string) {
    if (!session || !data || !verse || !text.trim()) return;
    setSaving(true);
    setFixError("");
    try {
      await saveCorrection({ session, target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, filepath: data.draft.filepath, chapter: data.chapter, verse: verse.verse, text: text.trim(), reason: why, book: data.book });
      setFixing(false);
      announce(t("af.corrected").replace("{ref}", `${data.book} ${data.chapter}:${verse.verse}`));
      await load();
    } catch (err) {
      setFixError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Leave the verse for the group instead of changing it: the comment, with the wording proposed if the person
   * wrote one, becomes a decision of the team in its own subtarea. Nothing is written to the draft.
   */
  async function askGroup(text: string, why: string) {
    if (!session || !data || !verse || !ctx || !why.trim()) return;
    const textChanged = Boolean(text.trim()) && !sameText(text, verse.text);
    const sid = `${data.book} ${data.chapter}:${verse.verse}`;
    setSaving(true);
    setFixError("");
    try {
      const target = { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch };
      const hash = alignmentFingerprint(verse.draft, current);
      const opened = await openAlignmentDecision({
        session,
        pmOrg: ctx.pmOrg,
        task: { projectId: ctx.projectId, taskId: ctx.taskId, taskName: ctx.taskName || ctx.taskId, resource: data.resource, parentIssue: ctx.issueNumber },
        target,
        draftFilepath: data.draft.filepath,
        source: data.source,
        book: data.book,
        chapter: data.chapter,
        verse: verse.verse,
        kind: textChanged ? "proposal" : "objection",
        note: why,
        baseHash: hash,
        before: current,
        // With a wording proposed, the links follow the words that stay; the new ones are left to place.
        ...(textChanged ? { proposed: groupsAfterTextEdit(current, verse.text, text), newText: text.trim() } : { words: [] }),
        view: viewFromTokens({ rtl: data.originalRtl, original: verse.original, gloss: verse.gloss, draftBefore: verse.draft, draftAfter: textChanged ? tokensFromText(text, sid) : verse.draft }),
        oldText: verse.text,
        aligners: authorsAt(verse, hash),
        thresholds,
      });
      setFixing(false);
      const [files, loadedProposals] = await Promise.all([loadDecisionFiles(session, target, data.book), loadProposalFiles(session, target, data.book)]);
      setDecisions(mergeDecisionFiles(files));
      setProposals(loadedProposals);
      setSentIssue(opened.issue.number);
      announce(n("al.decisionOpened", opened.issue.number));
    } catch (err) {
      setFixError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /** Shared step: take the verse in view to align it, or give it back. */
  async function takeVerse(release = false) {
    if (!session || !data || !verse || !ctx) return;
    setSaving(true);
    setError("");
    try {
      const decision: ReviewDecision = {
        itemId: takeId(data.chapter, verse.verse),
        ref: { start: { chapter: data.chapter, verse: verse.verse } },
        sessionId: String(ctx.issueNumber || ctx.taskId),
        stageId: "afinacion",
        status: "approved",
        reviewer: session.username,
        timestamp: new Date().toISOString(),
        ...(release ? { note: RELEASED } : {}),
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      announce(n(release ? "al.released" : "al.taken", verse.verse));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  async function markDone() {
    if (!session || !data || !verse || !ctx) return;
    // The mark carries the hash of the verse as it is stored, not as it was in memory before saving.
    let stored = groups[verse.verse] ?? [];
    if (dirty[verse.verse]) {
      const saved = await saveVerse();
      if (!saved) return;
      stored = saved;
    }
    setSaving(true);
    setError("");
    try {
      const decision: ReviewDecision = {
        itemId: doneId(data.chapter, verse.verse),
        ref: { start: { chapter: data.chapter, verse: verse.verse } },
        sessionId: String(ctx.issueNumber || ctx.taskId),
        stageId: "afinacion",
        status: "approved",
        reviewer: session.username,
        timestamp: new Date().toISOString(),
        textHash: alignmentFingerprint(verse.draft, stored),
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      announce(n("al.verseDone", verse.verse));
      moveOnAfterAction();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  async function answer(status: ReviewStance) {
    if (!session || !data || !verse || !ctx) return;
    // A change proposal or an objection is not an answer: it opens a decision for the team.
    if (status === "revise") return startProposal();
    if (status === "rejected") return startObjection();
    setSaving(true);
    setError("");
    try {
      const decision: ReviewDecision = {
        itemId: itemId(data.chapter, verse.verse),
        ref: { start: { chapter: data.chapter, verse: verse.verse } },
        sessionId: String(ctx.issueNumber || ctx.taskId),
        stageId: "afinacion",
        status,
        reviewer: session.username,
        timestamp: new Date().toISOString(),
        textHash: hashOf(verse),
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      announce(t("af.savedAnswer").replace("{stance}", stanceLabel(status)));
      moveOnAfterAction();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  function startProposal() {
    if (!verse || !baseVerse) return;
    setProposing({ base: current, text: baseVerse.text, tokens: null });
    setObjecting(false);
    setNote("");
    setSentIssue(null);
  }

  function cancelProposal() {
    if (!verse || !proposing) return;
    setGroups((prev) => ({ ...prev, [verse.verse]: proposing.base }));
    setDirty((prev) => ({ ...prev, [verse.verse]: false }));
    setHistory((prev) => ({ ...prev, [verse.verse]: { past: [], future: [] } }));
    setProposing(null);
    setNote("");
    clearSelection();
  }

  /** Editing the text in a proposal: the links follow the words that stay, the rest are left to place. */
  function changeProposalText(text: string) {
    if (!data || !verse || !baseVerse || !proposing) return;
    const sid = `${data.book} ${data.chapter}:${verse.verse}`;
    const back = sameText(text, baseVerse.text);
    setProposing({ ...proposing, text, tokens: back ? null : tokensFromText(text, sid) });
    change(back ? proposing.base : groupsAfterTextEdit(current, proposing.text, text));
  }

  function startObjection() {
    setObjecting(true);
    setProposing(null);
    setObjectWords([]);
    setNote("");
    setSentIssue(null);
  }

  function cancelObjection() {
    setObjecting(false);
    setObjectWords([]);
    setNote("");
  }

  /** Sends the proposal or the objection: it becomes a decision of the team in its own subtarea. */
  async function sendDecision(kind: "proposal" | "objection") {
    if (!session || !data || !verse || !ctx) return;
    const base = kind === "proposal" && proposing ? proposing.base : current;
    // What the verse was when the proposal was made: the hash, the card and "who aligned it" use this version.
    const was = baseVerse ?? verse;
    const textChanged = kind === "proposal" && Boolean(proposing) && !sameText(proposing!.text, was.text);
    setSaving(true);
    setError("");
    try {
      const target = { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch };
      const opened = await openAlignmentDecision({
        session,
        pmOrg: ctx.pmOrg,
        task: { projectId: ctx.projectId, taskId: ctx.taskId, taskName: ctx.taskName || ctx.taskId, resource: data.resource, parentIssue: ctx.issueNumber },
        target,
        draftFilepath: data.draft.filepath,
        source: data.source,
        book: data.book,
        chapter: data.chapter,
        verse: verse.verse,
        kind,
        note,
        baseHash: alignmentFingerprint(was.draft, base),
        before: base,
        ...(kind === "proposal" ? { proposed: current } : { words: objectWords }),
        view: viewFromTokens({ rtl: data.originalRtl, original: was.original, gloss: was.gloss, draftBefore: was.draft, draftAfter: textChanged ? verse.draft : was.draft }),
        oldText: was.text,
        ...(textChanged ? { newText: proposing!.text } : {}),
        aligners: authorsAt(was, alignmentFingerprint(was.draft, base)),
        thresholds,
      });
      if (kind === "proposal") cancelProposal();
      else cancelObjection();
      const [files, loadedProposals] = await Promise.all([loadDecisionFiles(session, target, data.book), loadProposalFiles(session, target, data.book)]);
      setDecisions(mergeDecisionFiles(files));
      setProposals(loadedProposals);
      setSentIssue(opened.issue.number);
      announce(n("al.decisionOpened", opened.issue.number));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  const doneCount = data ? data.verses.filter((v) => isDone(v)).length : 0;
  const toAnswer = data ? data.verses.filter((v) => pendingForMe(v)).length : 0;
  const readyToReview = verse ? isDone(verse) : false;
  const complete = verse ? verseComplete(verse, current) : false;
  const pendingWords = aligned.filter((a) => !a).length;
  const oneBox = selectedBoxes.length === 1 ? boxes.find((b) => b.id === selectedBoxes[0]) : undefined;
  // On a new verse the bank shows the first word still to place, not the start of a verse already half done.
  useEffect(() => {
    const first = bankWords.current?.querySelector<HTMLElement>(".al-word:not([data-aligned])");
    first?.scrollIntoView({ block: "nearest" });
  }, [verse?.verse]);
  /** The first word still to place: named in the hint before anything is placed. */
  const nextWord = verse ? verse.draft.find((_, i) => !aligned[i])?.surface : undefined;
  /**
   * The boxes the lexicon points to for the word of the draft in hand: those whose word of the original has it,
   * or a form of it, among its glosses. A hint for where to look, said as such; the person decides.
   */
  const hinted = useMemo(() => {
    const out = new Set<string>();
    if (!verse || selectedWords.length !== 1) return out;
    const word = verse.draft[selectedWords[0]!]?.surface ?? "";
    for (const box of boxes) if (box.targetTokenIndices.some((i) => verseLex[i] && glossesInclude(verseLex[i]!, word))) out.add(box.id);
    return out;
  }, [boxes, selectedWords, verse, verseLex]);
  const hintedWords = boxes.filter((box) => hinted.has(box.id)).map((box) => box.targetTokens.map((token) => token.surface).join(" "));
  const canSeparate = Boolean(oneBox && oneBox.groupIndex !== null && (oneBox.targetTokens.length > 1 || oneBox.alignedSourceWords.length > 1));
  const title = mode === "alinear" ? t("al.titleAlign") : t("al.titleReview");
  const openHere = verse ? openFor(verse) : [];
  const realignHere = verse ? realignFor(verse) : [];
  /** The tools card has something to show: a proposal being written, or notes of decisions taken. */
  const hasTools = (mode === "revisar" && proposing && Boolean(baseVerse)) || Boolean(sentIssue) || (mode === "alinear" && realignHere.length > 0);
  const decisionNotes = (
    <>
      {sentIssue ? (
        <p className="af-hint" role="status">
          {t("al.decisionOpenedNote")}<a href={`#/mis-tareas/${sentIssue}`}>{n("al.openIt", sentIssue)}</a>
        </p>
      ) : null}
      {mode === "alinear" && realignHere.length ? (
        <div className="af-stale" role="status">
          {t("al.teamAsked")}
          <ul className="al-decisions">
            {realignHere.map((r) => (
              <li key={r.id}>
                {proposals.proposals.find((p) => p.id === r.id)?.note ?? t("al.objectionHeld")}
                {r.issue ? <> · <a href={`#/mis-tareas/${r.issue}`}>{t("al.seeDecision")}</a></> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );

  /** One of three states per verse, told by a mark and a word, never only by colour. */
  function verseState(v: AlignmentVerse): { id: string; mark: string; label: string } {
    if (openFor(v).length) return { id: "discussion", mark: "…", label: t("al.stDiscussion") };
    if (mode === "alinear") {
      if (isDone(v)) return { id: "done", mark: "✓", label: t("al.stDone") };
      if (shared && ownerOf(v) && ownerOf(v) !== me) return { id: "taken", mark: "·", label: t("al.takenBy").replace("{who}", ownerOf(v)) };
      if (verseComplete(v, groups[v.verse] ?? [])) return { id: "complete", mark: "○", label: t("al.stComplete") };
      return { id: "pending", mark: "", label: t("al.stPending") };
    }
    if (!isDone(v)) return { id: "pending", mark: "", label: t("al.stNotDone") };
    if (authoredByMe(v)) return { id: "own", mark: "✎", label: t("al.stOwn") };
    if (answeredByMe(v)) return { id: "done", mark: "✓", label: t("al.stAnswered") };
    return { id: "complete", mark: "○", label: t("al.stToAnswer") };
  }

  /** The verse in English (ULT or UST) under the original, closed by default on a phone. */
  const reference = verse?.reference ? (
    <details className="al-reference" open={typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches}>
      <summary>{t("al.english").replace("{label}", data?.referenceLabel ?? "")}</summary>
      <p>{verse.reference}</p>
    </details>
  ) : null;

  const dnd = verse && data ? (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="al-layout">
              <Bank
                editable={editable}
                foot={
                  mode === "alinear" ? (
                    <button
                      type="button"
                      className="af-link al-bank__fix"
                      disabled={Boolean(dirty[verse.verse])}
                      title={dirty[verse.verse] ? t("al.saveBeforeFix") : undefined}
                      onClick={() => {
                        setFixError("");
                        setFixing(true);
                      }}
                    >
                      {t("al.fixOrAsk")}
                    </button>
                  ) : null
                }
              >
                <div className="al-bank__bar">
                  <div className="af-ref__texts" role="tablist" aria-label={t("al.bankTexts")}>
                    <button type="button" role="tab" aria-selected={bankText === "draft"} onClick={() => setBankText("draft")}>
                      {t("al.bankDraft")}
                    </button>
                    <button type="button" role="tab" aria-selected={bankText === "orig"} onClick={() => setBankText("orig")}>
                      {t("af.tabOriginal")}
                    </button>
                    {verse.reference ? (
                      <button type="button" role="tab" aria-selected={bankText === "ref"} onClick={() => setBankText("ref")}>
                        {data.referenceLabel}
                      </button>
                    ) : null}
                  </div>
                  <p className="af-lbl">{pendingWords ? (pendingWords === 1 ? t("al.toPlaceOne") : t("al.toPlaceMany").replace("{n}", String(pendingWords))) : t("al.allPlacedShort")}</p>
                </div>
                {bankText === "orig" ? (
                  <p className="al-bank__text af-orig" lang="grc" dir={data.originalRtl ? "rtl" : undefined}>
                    {verse.original.map((token) => token.surface).join(" ")}
                  </p>
                ) : bankText === "ref" ? (
                  <p className="al-bank__text">{verse.reference}</p>
                ) : null}
                <div className="al-bank__words" ref={bankWords} hidden={bankText !== "draft"}>
                  {verse.draft.map((token, i) => (
                    <BankWord
                      key={`${i}-${token.surface}`}
                      token={token}
                      index={i}
                      aligned={aligned[i] === true}
                      selected={selectedWords.includes(i)}
                      dragIndices={selectedWords.includes(i) ? selectedWords.filter((w) => !aligned[w]) : [i]}
                      disabled={!editable}
                      onTap={tapWord}
                    />
                  ))}
                </div>
              </Bank>

              {/* What to do with what is chosen; before the first word, how it works. The rest is in the boxes. */}
              {selectedWords.length || selectedBoxes.length ? (
                <div className="al-guide" role="status">
                  <p className="af-hint">
                    {selectedWords.length
                      ? selectedWords.length === 1
                        ? `${t("al.guideWord").replace("{word}", verse.draft[selectedWords[0]!]?.surface ?? "")}${hintedWords.length ? ` ${t("al.guideHint").replace("{words}", hintedWords.join(", "))}` : ""}`
                        : n("al.guideWords", selectedWords.length)
                      : t("al.boxChosen")}
                  </p>
                  <div className="al-actions">
                    {selectedBoxes.length >= 2 ? (
                      <Button type="button" size="sm" variant="outline" onClick={join}>
                        {t("al.mergeBoxes")}
                      </Button>
                    ) : null}
                    {canSeparate ? (
                      <Button type="button" size="sm" variant="outline" onClick={separate}>
                        {t("al.separate")}
                      </Button>
                    ) : null}
                    {selectedBoxes.length ? (
                      <Button type="button" size="sm" variant="outline" onClick={emptyBoxes}>
                        {t("al.emptyBox")}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" onClick={clearSelection}>
                      {t("al.clearSel")}
                    </Button>
                  </div>
                </div>
              ) : !current.length && nextWord ? (
                <p className="af-hint al-guide" role="status">
                  {t("al.guideNext").replace("{word}", nextWord)}
                </p>
              ) : null}
              <section className="al-main" aria-label={`${data.originalLabel}, ${data.book} ${data.chapter}:${verse.verse}`}>
                <div className="al-grid" dir={data.originalRtl ? "rtl" : undefined}>
                  {boxes.map((box) => (
                    <Box
                      key={box.id}
                      box={box}
                      draft={verse.draft}
                      gloss={verse.gloss}
                      compact={editable && box.alignedSourceWords.length === 0 && !selectedWords.length && !selectedBoxes.includes(box.id)}
                      selected={selectedBoxes.includes(box.id)}
                      hinted={hinted.has(box.id)}
                      editable={editable}
                      onTap={tapBox}
                      onWord={(boxId, refIndex) => setSheet({ boxId, refIndex })}
                      onRemoveWord={removeWord}
                    />
                  ))}
                </div>
              </section>
            </div>
            <DragOverlay>{dragging ? <span className="al-word al-word--ghost">{dragging}</span> : null}</DragOverlay>
          </DndContext>
  ) : null;

  const workspace = ctx ? workspaceOfOrg(tallerConfig, ctx.pmOrg) : undefined;
  // The entries of the verse in view are asked for as it opens, so a tap on a word answers at once.
  // They are kept too: a word of the draft, once chosen, is looked for among their glosses.
  const verseKey = verse ? `${data?.book} ${data?.chapter}:${verse.verse}` : "";
  useEffect(() => {
    setVerseLex({});
    if (!session || !verse) return;
    let alive = true;
    verse.original.forEach((token, index) => {
      const part = strongParts(token.strong).at(-1);
      if (!part) return;
      void loadLexiconEntry(session, lexiconRepos(workspace, part.kind), part.number).then((found) => {
        if (alive && found) setVerseLex((prev) => ({ ...prev, [index]: found.file }));
      });
    });
    return () => {
      alive = false;
    };
    // The verse object is made anew on every edit; its entries only change with the verse itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, verseKey, workspace]);
  const sheetBox = sheet ? boxes.find((b) => b.id === sheet.boxId) : undefined;
  const sheetToken = sheet && verse ? verse.original[sheet.refIndex] : undefined;

  return (
    <div className="af al">
      {data && verse ? (
        <CorrectionSheet
          open={fixing}
          refLabel={`${data.book} ${data.chapter}:${verse.verse}`}
          text={verse.text}
          references={[
            { id: "orig", label: data.originalLabel, text: verse.original.map((token) => token.surface).join(" "), lang: data.originalRtl ? "hbo" : "grc", rtl: data.originalRtl, original: true },
            ...(verse.reference ? [{ id: "ref", label: data.referenceLabel, text: verse.reference, lang: "en" }] : []),
          ]}
          busy={saving}
          error={fixError}
          onFix={(text, why) => void saveFix(text, why)}
          onAsk={(text, why) => void askGroup(text, why)}
          onClose={() => setFixing(false)}
        />
      ) : null}
      <WordSheet
        word={sheetToken ? { surface: sheetToken.surface, lemma: sheetToken.lemma, strong: sheetToken.strong, morph: sheetToken.morph } : null}
        at={{ book: data?.book ?? "", chapter: data?.chapter ?? 0, verse: verse?.verse ?? 0 }}
        session={session ?? null}
        workspace={workspace}
        onClose={() => setSheet(null)}
        onSeparate={sheet && editable && sheetBox && sheetBox.targetTokens.length > 1 && sheetBox.groupIndex !== null ? () => separateWord(sheet.boxId, sheet.refIndex) : undefined}
      />
      <ToolHeader
        title={toolHeading(ctx, language, title).title}
        onBack={() => void leave()}
        meta={[
          toolHeading(ctx, language, title).where,
          data ? (mode === "alinear" ? t("al.metaDone").replace("{a}", String(doneCount)) : t("al.metaAgreed").replace("{a}", String(summary?.agreed ?? 0))).replace("{b}", String(data.verses.length)) : "",
          data && mode === "revisar" && toAnswer ? t("al.toAnswerShort").replace("{n}", String(toAnswer)) : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          data && verse && session ? (
            <button
              type="button"
              className="th-icon"
              aria-pressed={pane === "chapter"}
              aria-label={t("af.paneChapter")}
              title={t("af.paneChapter")}
              onClick={() => setPane(pane === "chapter" ? "align" : "chapter")}
            >
              <BookOpen size={20} aria-hidden />
            </button>
          ) : undefined
        }
      >
        {shared ? (
          <div className="al-modes" role="tablist" aria-label={t("al.modesAria")}>
            <button type="button" role="tab" aria-selected={mode === "alinear"} onClick={() => setMode("alinear")}>
              {t("al.modeAlign")}
            </button>
            <button type="button" role="tab" aria-selected={mode === "revisar"} onClick={() => setMode("revisar")}>
              {t("al.modeReview")}
            </button>
          </div>
        ) : null}
      </ToolHeader>

      {data && verse && session && pane === "chapter" ? (
        <ChapterReader session={session} book={data.book} pkg={pkg} draft={data.draft} draftLabel={t("af.draftLabel").replace("{res}", data.resource === "tps" ? "TPS" : "TPL")} chapter={data.chapter} from={verse.verse} />
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("al.loading")}</p> : null}

      {(shared || mode === "revisar") && summary && data ? (
        <RoundPanel
          summary={summary}
          labelOf={(id) => `${data.book} ${id.replace(/^al:/, "")}`}
          onJump={(id) => {
            const at = data.verses.findIndex((v) => itemId(data.chapter, v.verse) === id);
            if (at >= 0) void goTo(at);
          }}
          closesHere={closesHere}
          stepDone={stepDone}
          busy={closingRound}
          onClose={() => void closeRound()}
        />
      ) : null}

      {data && verse && pane === "align" ? (
        <>
          <nav className="al-verses" aria-label={t("al.versesNav")}>
            {data.verses.map((v, i) => {
              const state = verseState(v);
              return (
                <button
                  key={v.verse}
                  type="button"
                  className="al-verse-tab"
                  data-current={i === position ? "true" : undefined}
                  data-state={state.id}
                  data-dirty={dirty[v.verse] ? "true" : undefined}
                  onClick={() => void goTo(i)}
                  aria-label={`${t("al.verseTab").replace("{n}", String(v.verse)).replace("{state}", state.label)}${dirty[v.verse] ? t("al.unsavedSuffix") : ""}`}
                  aria-current={i === position ? "true" : undefined}
                >
                  <span>{v.verse}</span>
                  <span className="al-verse-tab__mark" aria-hidden>
                    {state.mark}
                  </span>
                </button>
              );
            })}
          </nav>

          {openHere.length ? (
            <section className="al-talk" role="status" aria-label={t("al.talkTitle")}>
              <p className="al-talk__title">{t("al.talkTitle")}</p>
              <ul>
                {openHere.map((p) => (
                  <li key={p.id}>
                    <p className="al-talk__who">{t(p.kind === "proposal" ? "al.talkProposal" : "al.talkObjection").replace("{by}", p.by)}</p>
                    {p.note ? <p className="al-talk__note">«{p.note}»</p> : null}
                    {p.issue ? (
                      <a className="btn al-talk__go" data-variant="outline" data-size="sm" href={`#/mis-tareas/${p.issue}`}>
                        {t("al.talkOpen")}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
              {mode === "alinear" ? <p className="ws-meta">{t("al.talkHow")}</p> : null}
            </section>
          ) : null}

          {editable ? (
            dnd
          ) : (
            <section className="al-main" aria-label={`${data.originalLabel}, ${data.book} ${data.chapter}:${verse.verse}`}>
              <p className="af-lbl">
                {data.originalLabel} · {data.book} {data.chapter}:{verse.verse}
              </p>
              {reference}
              <AlignmentBoxes
                original={verse.original}
                gloss={verse.gloss}
                draft={verse.draft}
                groups={current}
                rtl={data.originalRtl}
                picked={objecting ? objectedBoxKeys(boxes, objectWords) : undefined}
                onPick={
                  objecting
                    ? (box) => {
                        const words = box.targetTokens.map((t) => `${t.surface}#${t.occurrence}`);
                        setObjectWords((prev) => (words.every((w) => prev.includes(w)) ? prev.filter((w) => !words.includes(w)) : [...new Set([...prev, ...words])]));
                      }
                    : undefined
                }
              />
            </section>
          )}

          {editable && !hasTools ? null : editable ? (
            <section className="af-card al-tools" aria-label={t("al.toolsAria")}>
              {mode === "revisar" && proposing && baseVerse ? (
                <div className="al-textedit">
                  <p className="af-hint">{t("al.proposalIntro")}</p>
                  <label className="af-field">
                    <span>{t("al.verseTextEdit")}</span>
                    <textarea value={proposing.text} onChange={(e) => changeProposalText(e.target.value)} rows={3} />
                  </label>
                  {!sameText(proposing.text, baseVerse.text) ? (
                    <p className="al-diff" aria-label={t("al.textDiffAria")}>
                      {wordDiff(baseVerse.text, proposing.text).map((piece, i) => (
                        <span key={i}>
                          {i ? " " : ""}
                          {piece.kind === "del" ? <del>{piece.text}</del> : piece.kind === "ins" ? <ins>{piece.text}</ins> : piece.text}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {decisionNotes}
            </section>
          ) : (
            <section className="af-card" aria-label={t("al.yourAnswerAria")}>
              {decisionNotes}
              {/* One reason at a time: a verse nobody marked as finished is not answered yet, whatever else it lacks
                  (the words left to place are listed above the boxes). */}
              {!readyToReview ? (
                <p className="af-stale" role="status">
                  {/* On the aligning side of an open round the verse is not waiting for somebody else: it is there to take. */}
                  {mode !== "alinear" ? t("al.notMarked") : ownerOf(verse) ? t("al.takenHint").replace("{who}", ownerOf(verse)) : t("al.takeHint")}
                </p>
              ) : !complete ? (
                <p className="af-stale" role="status">
                  {pendingWords === 1 ? t("al.notCompleteOne") : n("al.notCompleteMany", pendingWords)}
                </p>
              ) : null}
              {authoredByMe(verse) ? (
                <p className="af-hint" role="status">
                  {t("al.authoredByMe")}
                </p>
              ) : null}
              {readyToReview ? <p className="af-question">{t("al.question")}</p> : null}
              {mine ? (
                <p className="af-mine">
                  {t("al.myAnswer").replace("{stance}", stanceLabel(mine.status))}
                  {mine.note ? ` · ${mine.note}` : ""}
                </p>
              ) : null}
              {tally?.stale.some((a) => a.reviewer.trim().toLowerCase() === me) ? (
                <p className="af-stale">{t("al.staleMine")}</p>
              ) : null}
              {others.length ? (
                <ul className="af-others">
                  {others.map((a) => (
                    <li key={`${a.reviewer}-${a.timestamp}`}>
                      <b>{a.reviewer}</b>: {stanceLabel(a.status)}
                      {a.note ? ` · ${a.note}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}

          <div className="al-actionbar" role="region" aria-label={t("al.actionsAria")}>
            {mode === "alinear" && !mineToAlign(verse) ? (
              <div className="al-actionbar__row">
                {ownerOf(verse) && !readyToReview ? (
                  <>
                    <span className="al-actionbar__flag">{t("al.takenBy").replace("{who}", ownerOf(verse))}</span>
                    {/* Nobody is left waiting for a verse somebody took and did not finish. */}
                    <Button type="button" variant="ghost" onClick={() => void takeVerse()} disabled={saving}>
                      {t("al.takeOver")}
                    </Button>
                  </>
                ) : readyToReview ? (
                  <span className="al-actionbar__flag">{t("al.stDone")}</span>
                ) : (
                  <Button type="button" onClick={() => void takeVerse()} disabled={saving}>
                    {saving ? t("al.saving") : t("al.take")}
                  </Button>
                )}
                <Button type="button" variant="outline" disabled={position >= data.verses.length - 1} onClick={() => void goTo(position + 1)}>
                  {t("al.continue")}
                </Button>
              </div>
            ) : mode === "alinear" ? (
              <>
                {shared && !readyToReview ? (
                  <div className="al-actionbar__row">
                    <Button type="button" variant="ghost" disabled={saving} onClick={() => void takeVerse(true)}>
                      {t("al.release")}
                    </Button>
                  </div>
                ) : null}
                <div className="al-actionbar__row al-actionbar__row--one">
                  <Button type="button" variant="ghost" size="icon" aria-label={t("al.undo")} title={t("al.undo")} disabled={!canUndo} onClick={undo}>
                    <Undo2 size={18} aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("al.redo")} title={t("al.redo")} disabled={!canRedo} onClick={redo}>
                    <Redo2 size={18} aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("al.clearVerse")} title={t("al.clearVerse")} disabled={!current.length} onClick={() => change([])}>
                    <Eraser size={18} aria-hidden />
                  </Button>
                  {complete && !readyToReview ? (
                    <Button type="button" className="al-actionbar__main" aria-label={t("al.markDone")} onClick={() => void markDone()} disabled={saving}>
                      {saving ? (
                        t("al.saving")
                      ) : (
                        <>
                          {/* The whole sentence where it fits; on a phone, beside three icons and "Guardar", the verb alone. */}
                          <span className="al-long">{t("al.markDone")}</span>
                          <span className="al-short">{t("al.markDoneShort")}</span>
                        </>
                      )}
                    </Button>
                  ) : null}
                  <Button type="button" variant={complete && !readyToReview ? "outline" : "default"} onClick={() => void saveAndNext()} disabled={saving}>
                    {/* Beside "Terminé", which is the main way on, saving alone has a short name: the bar is one row on a phone. */}
                    {saving ? t("al.saving") : dirty[verse.verse] ? t(complete && !readyToReview ? "al.saveShort" : "al.saveNext") : t("al.continue")}
                  </Button>
                </div>
              </>
            ) : proposing ? (
              <div className="al-actionbar__note">
                <label className="af-field">
                  <span>{t("al.whatChange")}</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                </label>
                <div className="al-actionbar__row">
                  <Button type="button" variant="outline" disabled={!canUndo} onClick={undo}>
                    {t("al.undo")}
                  </Button>
                  <Button type="button" variant="outline" disabled={!canRedo} onClick={redo}>
                    {t("al.redo")}
                  </Button>
                  <Button type="button" variant="outline" disabled={!current.length} onClick={() => change([])}>
                    {t("al.clearVerse")}
                  </Button>
                </div>
                <div className="al-actionbar__row">
                  <Button type="button" disabled={saving || !note.trim() || (!dirty[verse.verse] && !(baseVerse && proposing && !sameText(proposing.text, baseVerse.text)))} onClick={() => void sendDecision("proposal")}>
                    {saving ? t("al.sending") : t("al.sendProposal")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={cancelProposal}>
                    {t("al.cancel")}
                  </Button>
                </div>
                {!dirty[verse.verse] ? <p className="af-hint">{t("al.changeToSend")}</p> : null}
              </div>
            ) : objecting ? (
              <div className="al-actionbar__note">
                <p className="af-hint">{t("al.objectHint")}</p>
                <label className="af-field">
                  <span>{t("al.whatObjection")}</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                </label>
                <div className="al-actionbar__row">
                  <Button type="button" disabled={saving || !note.trim()} onClick={() => void sendDecision("objection")}>
                    {saving ? t("al.sending") : t("al.sendObjection")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={cancelObjection}>
                    {t("al.cancel")}
                  </Button>
                </div>
              </div>
            ) : !readyToReview ? (
              // Nothing to answer here yet: the bar offers the way on instead of three buttons that do nothing.
              <div className="al-actionbar__row">
                <Button type="button" variant="outline" disabled={position >= data.verses.length - 1} onClick={() => void goTo(position + 1)}>
                  {t("al.continue")}
                </Button>
              </div>
            ) : (
              <div className="al-actionbar__row">
                {(["approved", "revise", "rejected"] as ReviewStance[]).map((stance) => (
                  <Button key={stance} type="button" variant={stance === "approved" ? "default" : "outline"} disabled={saving || !readyToReview} onClick={() => void answer(stance)}>
                    {t(STANCE_KEY[stance])}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
