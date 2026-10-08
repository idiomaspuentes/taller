import { useRef } from "react";
import type { ShownLine } from "../domain/verseShape";

/** Where a verse was touched: on which of its shown lines, and after how many of its characters. */
export type ShownPlace = { line: number; offset: number };

/** The place of the text under a point of the screen, in the lines of `root`. */
function placeAt(root: HTMLElement, x: number, y: number): ShownPlace | null {
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || !root.contains(node)) return null;
  const line = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest<HTMLElement>("[data-line]");
  if (!line) return null;
  const before = doc.createRange();
  before.setStart(line, 0);
  before.setEnd(node, offset);
  return { line: Number(line.dataset.line) || 0, offset: before.toString().length };
}

/**
 * A verse of the draft as it reads, in the shape its marks give it: the lines of a poem, each as deep as its mark
 * says. It is what the verse is while nobody writes in it; in the box where it is written, a line of a poem and a
 * long line that wraps look the same. Touching it goes back to writing, with the cursor where it was touched.
 */
export function VerseShown({ lines, label, onEdit }: { lines: ShownLine[]; label: string; onEdit: (place: ShownPlace | null) => void }) {
  // A touch gives focus before it gives the click that says where: only the keyboard writes from the focus alone.
  const touched = useRef(false);
  return (
    <div
      className="se-shown"
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={() => {
        touched.current = true;
      }}
      onFocus={() => {
        if (!touched.current) onEdit(null);
      }}
      onClick={(event) => {
        touched.current = false;
        onEdit(placeAt(event.currentTarget, event.clientX, event.clientY));
      }}
    >
      {lines.map((line, index) => (
        <p key={index} className="usfm-para" data-marker={line.marker} data-opens={line.opens || undefined} data-gap={line.gap || undefined} data-line={index}>
          {line.text}
        </p>
      ))}
    </div>
  );
}
