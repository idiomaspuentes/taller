import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { HelpEntry } from "../domain/helpTexts";
import { useT } from "../i18n/messages";

/**
 * All the helps of a passage, over the one being written: the screen shows a single help (C6), and this is the way to
 * any other. The one in hand is marked, those still to be translated say so, and touching one goes to it.
 */
export function HelpListSheet({
  open,
  entries,
  current,
  pending,
  nameOf,
  onPick,
  onClose,
}: {
  open: boolean;
  entries: HelpEntry[];
  current: string;
  /** The entries with something still to translate. */
  pending: Set<string>;
  /** What an entry is called: its verse, or which introduction it is. */
  nameOf: (entry: HelpEntry) => string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const left = entries.filter((entry) => pending.has(entry.id)).length;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="fix-sheet hl-sheet" aria-describedby={undefined}>
        <div className="fx-head">
          <DialogTitle className="fx-title">{t("he.listTitle")}</DialogTitle>
          {left ? <p className="hl-left">{t(left === 1 ? "he.listLeftOne" : "he.listLeftMany").replace("{n}", String(left))}</p> : null}
        </div>
        <ol className="hl-list">
          {entries.map((entry) => {
            const here = entry.id === current;
            const missing = pending.has(entry.id);
            return (
              <li key={entry.id}>
                <button type="button" className="hl-entry" aria-current={here ? "true" : undefined} data-pending={missing ? "true" : undefined} onClick={() => onPick(entry.id)}>
                  <span className="hl-entry__name">
                    {nameOf(entry)}
                    {here ? <span className="hl-entry__tag">{t("he.listHere")}</span> : missing ? <span className="hl-entry__tag hl-entry__tag--pending">{t("he.listPending")}</span> : null}
                  </span>
                  {entry.label ? <span className="hl-entry__text">{entry.label}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
