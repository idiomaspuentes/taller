import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { loadAssignmentsFromDcs } from "../dcs/persist";
import {
  mergeDecisionFiles,
  summarizeRound,
  tallyItem,
  textFingerprint,
  type ReviewDecision,
  type ReviewStance,
} from "../domain/reviewRound";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import type { ProjectTask } from "../domain/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type AlineacionMode = "alinear" | "revisar";

type Props = {
  ctxEncoded: string;
  mode: AlineacionMode;
  onClose: () => void;
  announce: (msg: string) => void;
};

const STANCE_LABEL: Record<ReviewStance, string> = {
  approved: "De acuerdo",
  revise: "Propongo un cambio",
  rejected: "Tengo una objeción",
};

const BANK_ID = "bank";
const boxDropId = (id: string) => `box-${id}`;
const itemId = (chapter: number, verse: number) => `al:${chapter}:${verse}`;
/** «Terminé»: whoever aligned a verse says it is ready to be reviewed. */
const doneId = (chapter: number, verse: number) => `al-done:${chapter}:${verse}`;

type DragData =
  | { type: "word"; indices: number[] }
  | { type: "chip"; boxId: string; transIndex: number }
  | { type: "merge"; boxId: string };

/** What a reviewer sees of the verse: the draft words and every link, so any change makes old answers stale. */
function alignmentFingerprint(draft: WordToken[], groups: AlignmentGroup[]): string {
  const plain = (w: string) => w.replace(/[^\p{L}\p{N}\p{M}]/gu, "");
  const links = groups.map(
    (g) => `${g.sources.map((s) => `${s.content}#${s.occurrence}`).join("+")}=${g.targets.map((t) => `${plain(t.word)}#${t.occurrence}`).join("+")}`,
  );
  return textFingerprint(`${draft.map((w) => plain(w.surface)).join(" ")}|${links.join(";")}`);
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
        <button type="button" className="al-chip__x" aria-label={`Quitar «${token.surface}» de esta caja`} onClick={onRemove} data-no-box-select>
          ×
        </button>
      ) : null}
    </span>
  );
}

function MergeGrip({ boxId, disabled }: { boxId: string; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `merge-${boxId}`,
    data: { type: "merge", boxId } satisfies DragData,
    disabled,
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="al-grip"
      data-dragging={isDragging ? "true" : undefined}
      aria-label="Arrastra esta caja sobre otra para juntarlas"
      data-no-box-select
    >
      ⠿
    </button>
  );
}

function Box({
  box,
  draft,
  slot,
  selected,
  selectedRef,
  editable,
  onTap,
  onSelectRef,
  onRemoveWord,
}: {
  box: AlignmentBoxModel;
  draft: WordToken[];
  slot: number;
  selected: boolean;
  selectedRef: number | null;
  editable: boolean;
  onTap: (boxId: string) => void;
  onSelectRef: (boxId: string, refIndex: number) => void;
  onRemoveWord: (boxId: string, transIndex: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: boxDropId(box.id), data: { boxId: box.id }, disabled: !editable });
  const merged = box.targetTokens.length > 1;
  return (
    <div
      ref={setNodeRef}
      role="group"
      className="al-box"
      data-slot={box.groupIndex !== null ? slot : undefined}
      data-merged={merged ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-over={isOver && editable ? "true" : undefined}
      onClick={(e) => {
        if (!editable || (e.target as HTMLElement).closest("[data-no-box-select]")) return;
        onTap(box.id);
      }}
    >
      <div className="al-box__head">
        {editable ? <MergeGrip boxId={box.id} disabled={false} /> : null}
        <div className="al-box__refs">
          {box.targetTokens.map((tok, i) => {
            const refIndex = box.targetTokenIndices[i] ?? 0;
            return (
              <button
                key={refIndex}
                type="button"
                className="al-ref"
                data-selected={selectedRef === refIndex && merged ? "true" : undefined}
                disabled={!editable || !merged}
                onClick={() => onSelectRef(box.id, refIndex)}
                data-no-box-select
              >
                <span className="al-ref__word">{tok.surface}</span>
                {tok.lemma ? <span className="al-ref__lemma">{tok.lemma}</span> : null}
              </button>
            );
          })}
        </div>
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

function Bank({ children, editable }: { children: ReactNode; editable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: BANK_ID, disabled: !editable });
  return (
    <div ref={setNodeRef} className="al-bank" data-over={isOver ? "true" : undefined} role="region" aria-label="Palabras de tu borrador">
      {children}
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
export function AlineacionView({ ctxEncoded, mode, onClose, announce }: Props) {
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<AlineacionData | null>(null);
  const [task, setTask] = useState<ProjectTask | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  const [position, setPosition] = useState(0);
  const [groups, setGroups] = useState<Record<number, AlignmentGroup[]>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [history, setHistory] = useState<Record<number, { past: AlignmentGroup[][]; future: AlignmentGroup[][] }>>({});
  const [selectedWords, setSelectedWords] = useState<number[]>([]);
  const [selectedBoxes, setSelectedBoxes] = useState<string[]>([]);
  const [selectedRef, setSelectedRef] = useState<{ boxId: string; refIndex: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<ReviewStance | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const editable = mode === "alinear";
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError("El enlace de esta herramienta no es válido. Ábrela de nuevo desde Mis tareas.");
      return;
    }
    setCtx(decoded);
    if (!session?.token) {
      setError("Tu sesión caducó. Vuelve a iniciar sesión.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const board = await loadAssignmentsFromDcs(session, decoded.pmOrg, decoded.lang, decoded.projectId, decoded.contentOrg);
      const thisTask = board?.teams.find((t) => t.id === decoded.taskId) ?? null;
      setTask(thisTask);
      const sourceTaskId = thisTask?.waitsFor?.find((w) => w.taskId)?.taskId;
      if (!sourceTaskId) {
        throw new Error("Esta tarea no dice qué texto alinea. Quien administra debe añadir «Esperar a» la traducción en la tarea.");
      }
      const loaded = await loadAlineacion({ session, ctx: decoded, sourceTaskId });
      setData(loaded);
      setGroups(Object.fromEntries(loaded.verses.map((v) => [v.verse, v.groups])));
      setDirty({});
      const files = await loadDecisionFiles(session, { owner: loaded.draft.owner, repo: loaded.draft.repo, branch: loaded.draft.branch }, loaded.book);
      setDecisions(mergeDecisionFiles(files));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  const verse = data?.verses[Math.min(position, Math.max((data?.verses.length ?? 1) - 1, 0))];
  const current = useMemo(() => (verse ? groups[verse.verse] ?? [] : []), [verse, groups]);
  const boxes = useMemo(() => (verse ? deriveAlignmentBoxes(verse.original, current, verse.draft) : []), [verse, current]);
  const aligned = useMemo(() => (verse ? computeAlignedSourceIndices(verse.draft, boxes) : []), [verse, boxes]);

  const me = (session?.username ?? "").toLowerCase();
  const taskStep = task?.steps?.find((s) => s.id === ctx?.stepId);
  const thresholds = { minAgree: taskStep?.minAssignees ?? 3, minIndependent: taskStep?.minIndependent ?? 2 };
  const hashOf = (v: AlignmentVerse) => alignmentFingerprint(v.draft, groups[v.verse] ?? []);
  const isDone = (v: AlignmentVerse) =>
    Boolean(data) && decisions.some((d) => d.itemId === doneId(data!.chapter, v.verse) && d.textHash === hashOf(v));
  // Whoever marked a verse as finished is its author: their answer does not count as independent.
  const authorsOf = (v: AlignmentVerse): string[] =>
    data ? decisions.filter((d) => d.itemId === doneId(data.chapter, v.verse) && d.textHash === hashOf(v)).map((d) => d.reviewer) : [];
  const answeredByMe = (v: AlignmentVerse) =>
    Boolean(data) && decisions.some((d) => d.itemId === itemId(data!.chapter, v.verse) && d.reviewer.trim().toLowerCase() === me && d.textHash === hashOf(v));
  const authoredByMe = (v: AlignmentVerse) => authorsOf(v).some((a) => a.trim().toLowerCase() === me);
  /** In review: finished by its author, not written by me, and not answered by me since it last changed. */
  const pendingForMe = (v: AlignmentVerse) => isDone(v) && !answeredByMe(v) && !authoredByMe(v);
  const needsWork = (v: AlignmentVerse) => (mode === "alinear" ? !isDone(v) : pendingForMe(v));
  const tally =
    verse && data
      ? tallyItem({ itemId: itemId(data.chapter, verse.verse), decisions, currentHash: hashOf(verse), levels: data.levels, authors: authorsOf(verse), thresholds })
      : null;
  const mine = tally?.answers.find((a) => a.reviewer.trim().toLowerCase() === me);
  const others = (tally?.answers ?? []).filter((a) => a.reviewer.trim().toLowerCase() !== me);
  const summary = useMemo(
    () =>
      data
        ? summarizeRound({
            itemIds: data.verses.map((v) => itemId(data.chapter, v.verse)),
            decisions,
            currentHashes: Object.fromEntries(data.verses.map((v) => [itemId(data.chapter, v.verse), alignmentFingerprint(v.draft, groups[v.verse] ?? [])])),
            levels: data.levels,
            authors: [],
            authorsByItem: Object.fromEntries(data.verses.map((v) => [itemId(data.chapter, v.verse), authorsOf(v)])),
            thresholds,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, decisions, groups, thresholds.minAgree, thresholds.minIndependent],
  );

  useEffect(() => {
    setSelectedWords([]);
    setSelectedBoxes([]);
    setSelectedRef(null);
    setPending(null);
    setNote("");
  }, [verse?.verse]);

  function clearSelection() {
    setSelectedWords([]);
    setSelectedBoxes([]);
    setSelectedRef(null);
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
    setSelectedRef(null);
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
    if (selectedRef && selectedRef.boxId === box.id) {
      change(detachTargetRefFromGroup(verse.original, verse.draft, current, box.groupIndex, selectedRef.refIndex));
    } else {
      change(splitAlignmentGroupPure(verse.original, verse.draft, current, box.groupIndex));
    }
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
    if (data?.type === "merge") setDragging("Juntar cajas");
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
    } else if (from.type === "merge" && toBox && toBox !== from.boxId) {
      change(mergeAlignmentBoxes(verse.original, verse.draft, current, [from.boxId, toBox], toBox));
    }
  }

  async function saveVerseOf(target: AlignmentVerse): Promise<boolean> {
    if (!session || !data) return false;
    setSaving(true);
    setError("");
    try {
      await saveVerseAlignment({
        session,
        target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
        filepath: data.draft.filepath,
        book: data.book,
        chapter: data.chapter,
        verse: target.verse,
        groups: groups[target.verse] ?? [],
        source: data.source,
      });
      setDirty((prev) => ({ ...prev, [target.verse]: false }));
      announce(`Alineación de ${data.book} ${data.chapter}:${target.verse} guardada`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveVerse(): Promise<boolean> {
    return verse ? saveVerseOf(verse) : false;
  }

  /** Change verse; what was edited in this one is saved first, so nothing is left only in memory. */
  async function goTo(index: number) {
    if (!data || index < 0 || index >= data.verses.length || index === position) return;
    if (editable && verse && dirty[verse.verse] && !(await saveVerseOf(verse))) return;
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
    else announce(mode === "alinear" ? "Todos los versículos están terminados" : "No te queda ningún versículo por responder");
  }

  async function saveAndNext() {
    if (dirty[verse?.verse ?? -1] && !(await saveVerse())) return;
    if (data && position < data.verses.length - 1) setPosition((p) => p + 1);
  }

  async function leave() {
    if (editable && data) {
      for (const v of data.verses) {
        if (dirty[v.verse] && !(await saveVerseOf(v))) return;
      }
    }
    onClose();
  }

  async function markDone() {
    if (!session || !data || !verse || !ctx) return;
    if (dirty[verse.verse] && !(await saveVerse())) return;
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
        textHash: hashOf(verse),
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      announce(`Versículo ${verse.verse} terminado`);
      moveOnAfterAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function answer(status: ReviewStance) {
    if (!session || !data || !verse || !ctx) return;
    if (status !== "approved" && !note.trim()) {
      setPending(status);
      return;
    }
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
        note: note.trim() || undefined,
        textHash: hashOf(verse),
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      setPending(null);
      announce(`${STANCE_LABEL[status]}: guardado`);
      moveOnAfterAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const doneCount = data ? data.verses.filter((v) => isDone(v)).length : 0;
  const toAnswer = data ? data.verses.filter((v) => pendingForMe(v)).length : 0;
  const readyToReview = verse ? isDone(verse) : false;
  const complete = verse ? verseComplete(verse, current) : false;
  const pendingWords = aligned.filter((a) => !a).length;
  const pendingBoxes = boxes.filter((b) => b.groupIndex === null).length;
  const oneBox = selectedBoxes.length === 1 ? boxes.find((b) => b.id === selectedBoxes[0]) : undefined;
  const canSeparate = Boolean(oneBox && oneBox.groupIndex !== null && (oneBox.targetTokens.length > 1 || oneBox.alignedSourceWords.length > 1));
  const title = mode === "alinear" ? "Alinear" : "Revisar la alineación";

  /** One of three states per verse, told by a mark and a word, never only by colour. */
  function verseState(v: AlignmentVerse): { id: string; mark: string; label: string } {
    if (mode === "alinear") {
      if (isDone(v)) return { id: "done", mark: "✓", label: "terminado" };
      if (verseComplete(v, groups[v.verse] ?? [])) return { id: "complete", mark: "○", label: "completo, falta terminarlo" };
      return { id: "pending", mark: "", label: "pendiente" };
    }
    if (!isDone(v)) return { id: "pending", mark: "", label: "todavía no está terminado" };
    if (authoredByMe(v)) return { id: "own", mark: "✎", label: "lo alineaste tú" };
    if (answeredByMe(v)) return { id: "done", mark: "✓", label: "ya lo respondiste" };
    return { id: "complete", mark: "○", label: "por responder" };
  }

  return (
    <div className="af al">
      <header className="af-head">
        <button type="button" className="af-back" onClick={() => void leave()} aria-label="Volver">
          ← Volver
        </button>
        <div className="af-title">
          <h1>{title}</h1>
          <p>{data ? `${data.book} ${data.chapter} · ${data.resource === "tps" ? "TPS" : "TPL"}` : ctx ? `${ctx.book} ${ctx.chapter}` : ""}</p>
        </div>
        {data ? (
          <div className="af-progress" aria-label="Avance">
            <span>{mode === "alinear" ? `${doneCount} de ${data.verses.length} versículos terminados` : `${summary?.agreed ?? 0} de ${data.verses.length} acordados`}</span>
            <span className="af-bar">
              <i style={{ width: `${data.verses.length ? ((mode === "alinear" ? doneCount : summary?.agreed ?? 0) / data.verses.length) * 100 : 0}%` }} />
            </span>
            {mode === "revisar" ? (
              <span>{toAnswer === 0 ? "No te queda nada por responder" : `Te ${toAnswer === 1 ? "falta 1 versículo" : `faltan ${toAnswer} versículos`} por responder`}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">Cargando el original y el borrador…</p> : null}

      {data && verse ? (
        <>
          <nav className="al-verses" aria-label="Versículos">
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
                  aria-label={`Versículo ${v.verse}, ${state.label}${dirty[v.verse] ? ", sin guardar" : ""}`}
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

          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="al-layout">
              <Bank editable={editable}>
                <p className="af-lbl">Tu borrador</p>
                <div className="al-bank__words">
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

              <section className="al-main" aria-label={`${data.originalLabel}, ${data.book} ${data.chapter}:${verse.verse}`}>
                <p className="af-lbl">
                  {data.originalLabel} · {data.book} {data.chapter}:{verse.verse}
                </p>
                <div className="al-grid" dir={data.originalRtl ? "rtl" : undefined}>
                  {boxes.map((box, i) => (
                    <Box
                      key={box.id}
                      box={box}
                      draft={verse.draft}
                      slot={i % 6}
                      selected={selectedBoxes.includes(box.id)}
                      selectedRef={selectedRef?.boxId === box.id ? selectedRef.refIndex : null}
                      editable={editable}
                      onTap={tapBox}
                      onSelectRef={(boxId, refIndex) => {
                        setSelectedWords([]);
                        setSelectedBoxes([boxId]);
                        setSelectedRef({ boxId, refIndex });
                      }}
                      onRemoveWord={removeWord}
                    />
                  ))}
                </div>
              </section>
            </div>
            <DragOverlay>{dragging ? <span className="al-word al-word--ghost">{dragging}</span> : null}</DragOverlay>
          </DndContext>

          {editable ? (
            <section className="af-card al-tools" aria-label="Herramientas">
              <p className="af-hint">
                {selectedWords.length
                  ? `Tocaste ${selectedWords.length === 1 ? "una palabra" : `${selectedWords.length} palabras`}. Toca la caja donde van.`
                  : selectedBoxes.length
                    ? "Caja elegida. Toca otra para juntarlas, o usa los botones."
                    : "Toca palabras de tu borrador y luego la caja donde van. También puedes arrastrarlas."}
              </p>
              <div className="al-actions">
                <Button type="button" variant="outline" disabled={selectedBoxes.length < 2} onClick={join}>
                  Juntar cajas
                </Button>
                <Button type="button" variant="outline" disabled={!canSeparate} onClick={separate}>
                  Separar
                </Button>
                <Button type="button" variant="outline" disabled={!selectedBoxes.length} onClick={emptyBoxes}>
                  Vaciar caja
                </Button>
                <Button type="button" variant="ghost" disabled={!selectedWords.length && !selectedBoxes.length} onClick={clearSelection}>
                  Quitar selección
                </Button>
                <Button type="button" variant="ghost" disabled={!current.length} onClick={() => change([])}>
                  Limpiar versículo
                </Button>
              </div>
              {readyToReview ? <p className="af-hint" role="status">Terminado: ya puede revisarlo otra persona.</p> : null}
              {!complete ? (
                <p className="af-stale" role="status">
                  Falta colocar {pendingWords} {pendingWords === 1 ? "palabra" : "palabras"} de tu borrador.
                </p>
              ) : (
                <p className="af-hint" role="status">
                  Todas las palabras de tu borrador están colocadas.
                  {pendingBoxes ? ` Quedan ${pendingBoxes} ${pendingBoxes === 1 ? "caja" : "cajas"} del original sin palabras; está bien si no tienen traducción.` : ""}
                </p>
              )}
            </section>
          ) : (
            <section className="af-card" aria-label="Tu respuesta">
              {!complete ? (
                <p className="af-stale" role="status">
                  Este versículo todavía no está completo: {pendingWords === 1 ? "falta 1 palabra" : `faltan ${pendingWords} palabras`} del borrador por colocar.
                </p>
              ) : null}
              {!readyToReview ? (
                <p className="af-hint" role="status">
                  Todavía no está terminado: quien lo alinea aún no lo marcó. Cuando lo marque podrás responder.
                </p>
              ) : null}
              {authoredByMe(verse) ? (
                <p className="af-hint" role="status">
                  Tú alineaste este versículo: tu respuesta no cuenta como la de una persona independiente.
                </p>
              ) : null}
              <p className="af-question">¿Cada palabra del original está unida a lo que la traduce?</p>
              {mine ? (
                <p className="af-mine">
                  Tu respuesta: {STANCE_LABEL[mine.status as ReviewStance]}
                  {mine.note ? ` · ${mine.note}` : ""}
                </p>
              ) : null}
              {tally?.stale.some((a) => a.reviewer.trim().toLowerCase() === me) ? (
                <p className="af-stale">Cambió la alineación después de tu respuesta. Vuelve a revisarla.</p>
              ) : null}
              {others.length ? (
                <ul className="af-others">
                  {others.map((a) => (
                    <li key={`${a.reviewer}-${a.timestamp}`}>
                      <b>{a.reviewer}</b>: {STANCE_LABEL[a.status as ReviewStance]}
                      {a.note ? ` · ${a.note}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}

          <div className="al-pager">
            <Button type="button" variant="outline" disabled={position === 0} onClick={() => void goTo(position - 1)}>
              ← Anterior
            </Button>
            <span>
              {position + 1} de {data.verses.length}
            </span>
            <Button type="button" variant="outline" disabled={position >= data.verses.length - 1} onClick={() => void goTo(position + 1)}>
              Siguiente →
            </Button>
          </div>

          <div className="al-actionbar" role="region" aria-label="Acciones">
            {editable ? (
              <>
                <div className="al-actionbar__row">
                  <Button type="button" variant="outline" disabled={!canUndo} onClick={undo}>
                    Deshacer
                  </Button>
                  <Button type="button" variant="outline" disabled={!canRedo} onClick={redo}>
                    Rehacer
                  </Button>
                  {dirty[verse.verse] ? <span className="al-actionbar__flag">Sin guardar</span> : null}
                </div>
                <div className="al-actionbar__row">
                  {complete && !readyToReview ? (
                    <Button type="button" onClick={() => void markDone()} disabled={saving}>
                      {saving ? "Guardando…" : "Terminé este versículo"}
                    </Button>
                  ) : null}
                  <Button type="button" variant={complete && !readyToReview ? "outline" : "default"} onClick={() => void saveAndNext()} disabled={saving}>
                    {saving ? "Guardando…" : dirty[verse.verse] ? "Guardar y seguir" : "Seguir"}
                  </Button>
                </div>
              </>
            ) : pending ? (
              <div className="al-actionbar__note">
                <label className="af-field">
                  <span>{pending === "revise" ? "¿Qué cambio propones?" : "¿Cuál es tu objeción?"}</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                </label>
                <div className="al-actionbar__row">
                  <Button type="button" disabled={saving || !note.trim()} onClick={() => void answer(pending)}>
                    Enviar
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPending(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="al-actionbar__row">
                {(["approved", "revise", "rejected"] as ReviewStance[]).map((stance) => (
                  <Button key={stance} type="button" variant={stance === "approved" ? "default" : "outline"} disabled={saving || !readyToReview} onClick={() => void answer(stance)}>
                    {STANCE_LABEL[stance]}
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
