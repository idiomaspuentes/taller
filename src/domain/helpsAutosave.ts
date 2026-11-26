/**
 * When the helps editor saves by itself. It writes on the person's own draft a moment after the last key, as the
 * editor of the text does; on the team's draft (`shared`) a save changes everybody's text, and stays a button.
 */

export type AutosaveState = {
  shared: boolean;
  hasSession: boolean;
  dirty: boolean;
  saving: boolean;
  finishing: boolean;
  openingPr: boolean;
  busy: boolean;
  hasItems: boolean;
  /** «¿Entregar con piezas sin traducir?» is open. */
  confirming: boolean;
  /** `labWriteDecision(ctx).mode === "blocked"`, or nothing says where to write: nothing can be saved. */
  blocked: boolean;
  /** The last save failed and nothing was typed since, nor did the connection come back. */
  failedSinceEdit: boolean;
};

/** As the editor of the text: long enough not to write on every word, short enough that little waits on the device. */
export const AUTOSAVE_DELAY_MS = 3500;

/**
 * Whether a save is due once the last key has waited `AUTOSAVE_DELAY_MS`. After a failure it is not: trying again
 * every few seconds would knock on Door43 for as long as the network is down. A key, the connection coming back or
 * «Reintentar» try again.
 */
export function autosaveDue(s: AutosaveState): boolean {
  return (
    !s.shared &&
    s.hasSession &&
    s.dirty &&
    !s.saving &&
    !s.finishing &&
    !s.openingPr &&
    !s.busy &&
    s.hasItems &&
    !s.confirming &&
    !s.blocked &&
    !s.failedSinceEdit
  );
}
