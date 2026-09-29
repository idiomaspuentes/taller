/**
 * Render side of the scripture `verse-conflict` decision and its
 * `verse-choice` result. Pure; `prepare` / `run` (DCS reads and writes) are
 * attached by `src/dcs/scriptureThread.ts`.
 */
import { registerChatEventType, type ChatEventType } from "./registry";
import {
  VERSE_CONFLICT_TYPE,
  conflictOwnInTrunk,
  decidedConflictSentence,
  rangeLabel,
  withKept,
  verseConflictData,
  verseConflictOptionLabels,
  verseConflictPanels,
  verseConflictTitle,
  type VerseConflictOptionId,
} from "../verseConflictEvent";
import {
  VERSE_CHOICE_TYPE,
  choiceBlockReason,
  keptAfterDecision,
  versionOwner,
  verseChoiceDecisionId,
  verseChoiceTitle,
  verseChangedReason,
  type ConflictPrepared,
} from "../conflictChoice";

export const verseConflictType: ChatEventType<ConflictPrepared> = {
  type: VERSE_CONFLICT_TYPE,
  render: "decision",
  valid: (event) => verseConflictData(event) !== null,
  title(event) {
    const data = verseConflictData(event);
    return data ? verseConflictTitle(data) : event.summary;
  },
  panels(event) {
    const data = verseConflictData(event);
    return data ? verseConflictPanels(data) : [];
  },
  group(event) {
    const data = verseConflictData(event);
    return data ? `${data.conflictIssue}:${data.range.chapter}:${data.range.from}-${data.range.to}` : null;
  },
  options(event, ctx) {
    const data = verseConflictData(event);
    if (!data) return [];
    const labels = verseConflictOptionLabels(data);
    const ids: VerseConflictOptionId[] = ["tronco", "desplazado"];
    return ids.map((id) => {
      const owner = versionOwner(data, id);
      const blockReason = choiceBlockReason({
        data,
        option: id,
        viewer: ctx.viewer,
        prepared: ctx.prepared,
        prepareError: ctx.prepareError,
      });
      return {
        id,
        label: labels[id],
        primary: id === "tronco",
        blockReason,
        ...(blockReason === verseChangedReason(data.range) ? { openEditor: data.range } : {}),
        busyLabel: id === "desplazado" ? "Guardando en el borrador grupal…" : "Guardando la decisión…",
        ...(id === "desplazado"
          ? {
              confirm: `¿Volver a ${owner ? `la versión de @${owner}` : "la otra versión"} en ${rangeLabel(
                data.range,
              )}? Se guarda en el borrador grupal.`,
            }
          : {}),
      };
    });
  },
  decided(event, resolution) {
    const data = verseConflictData(event);
    if (!data) return null;
    const now = withKept(data, keptAfterDecision(data, resolution));
    return {
      event: { ...event, data: now as unknown as Record<string, unknown> },
      title: decidedConflictSentence(now),
      // Only the side whose text left the trunk may put it back.
      options: conflictOwnInTrunk(now) ? [] : ["desplazado"],
    };
  },
};

registerChatEventType(verseConflictType);

registerChatEventType({
  type: VERSE_CHOICE_TYPE,
  render: "system",
  title: verseChoiceTitle,
  resolves: verseChoiceDecisionId,
});
