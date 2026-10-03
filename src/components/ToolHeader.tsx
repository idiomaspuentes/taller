import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useT } from "../i18n/messages";
import { setNotesSlot } from "./notesSlot";

type Props = {
  /** What is in hand: the passage, or the name of the step. One line; it is cut short when it does not fit. */
  title: ReactNode;
  /** The step, the task, how far along: small, under the title. */
  meta?: ReactNode;
  onBack: () => void;
  /** Buttons of the tool, at the right; on a phone they keep to icons or short words. */
  actions?: ReactNode;
  /** A second row under the name: a progress bar, the modes of the tool. */
  children?: ReactNode;
};

/**
 * The header of every tool: the way back, what is in hand, and the tool's own buttons, in one short row. All the
 * tools share it, so that on a phone none of them spends the top of the screen on its name.
 */
export function ToolHeader({ title, meta, onBack, actions, children }: Props) {
  const t = useT();
  return (
    <header className="th">
      <div className="th-row">
        <button type="button" className="th-back" onClick={onBack} aria-label={t("af.back")} title={t("af.back")}>
          <ChevronLeft size={20} aria-hidden />
        </button>
        <div className="th-name">
          <h1>{title}</h1>
          {meta ? <p>{meta}</p> : null}
        </div>
        <div className="th-actions">
          {/* Where the notes button is drawn: the notes are mounted beside the tool, the header says where they show. */}
          <span className="th-notes" ref={setNotesSlot} />
          {actions}
        </div>
      </div>
      {children ? <div className="th-below">{children}</div> : null}
    </header>
  );
}
