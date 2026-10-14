import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useT } from "../i18n/messages";
import { MoreMenu, type MoreItem } from "./MoreMenu";
import { setNotesSlot, useNotesEntry } from "./notesSlot";

type Props = {
  /** What is in hand: the passage, or the name of the step. One line; it is cut short when it does not fit. */
  title: ReactNode;
  /** The step, the task, how far along: small, under the title. */
  meta?: ReactNode;
  onBack: () => void;
  /** What the tool can do besides its work (the glossary, the chapter): rows of «Más», each with what it is for. */
  more?: MoreItem[];
  /** A second row under the name: a progress bar, the modes of the tool. */
  children?: ReactNode;
};

/**
 * The header of every tool: the way back, what is in hand, and «Más» for everything else, in one short row. All the
 * tools share it, so that on a phone none of them spends the top of the screen on its name, and none puts an icon
 * there that says nothing to the team: what is not the work itself is a row of «Más», with a line that says what it
 * does (as in translationCore 4).
 */
export function ToolHeader({ title, meta, onBack, more = [], children }: Props) {
  const t = useT();
  const notes = useNotesEntry();
  const items: MoreItem[] = [
    ...more,
    ...(notes ? [{ id: "notes", label: t("sn.tab"), hint: t("mm.notesHint"), count: notes.count, pressed: notes.open, onSelect: notes.toggle }] : []),
  ];
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
          {/* Says to the notes that this tool has a header: they become a row of «Más» instead of a corner button. */}
          <span className="th-notes" ref={setNotesSlot} />
          <MoreMenu items={items} />
        </div>
      </div>
      {children ? <div className="th-below">{children}</div> : null}
    </header>
  );
}
