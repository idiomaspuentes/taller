/**
 * When the editor of the text (TPL, TPS) saves by itself: a moment after the last key, as the helps editor does on
 * the person's own draft (`autosaveDue`).
 */
import { AUTOSAVE_DELAY_MS } from "./helpsAutosave";

export { AUTOSAVE_DELAY_MS };

export type TextAutosaveState = {
  /** Signed in, with the passage known: a save can reach Door43. */
  hasSession: boolean;
  dirty: boolean;
  saving: boolean;
  recreating: boolean;
  openingPr: boolean;
  finishing: boolean;
  hasDrafts: boolean;
  /** `labWriteDecision(ctx).mode === "blocked"`: nothing can be saved. */
  blocked: boolean;
  /** The last save failed and nothing was typed since, nor did the connection come back. */
  failedSinceEdit: boolean;
};

/**
 * Whether a save is due once the last key has waited `AUTOSAVE_DELAY_MS`. After a failure it is not: with the
 * network down, trying again every few seconds knocked on Door43 for as long as it lasted (#89). A key, the
 * connection coming back or «Guardar» try again.
 */
export function textAutosaveDue(s: TextAutosaveState): boolean {
  return (
    s.hasSession &&
    s.dirty &&
    !s.saving &&
    !s.recreating &&
    !s.openingPr &&
    !s.finishing &&
    s.hasDrafts &&
    !s.blocked &&
    !s.failedSinceEdit
  );
}

/**
 * Whether a save that just ended leaves the editor waiting for a key, the connection or «Guardar». A key typed
 * while it was on its way tries again by itself: it is not «nothing typed since». Without a session nothing is sent
 * anywhere, so nothing failed.
 */
export function failedWithNothingTyped(r: { ok: boolean; hasSession: boolean; editsAtStart: number; editsNow: number }): boolean {
  return !r.ok && r.hasSession && r.editsNow === r.editsAtStart;
}
