import { useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { LineShape } from "../domain/verseShape";
import { fieldLines, joinLine, linesText, setLine, splitLine, type LinePlace, type LinesChange } from "../domain/verseLines";

type Props = {
  /** The id of the first field: the number of the verse is its label. */
  id: string;
  /** The verse as it is kept: its lines parted by `\n`. */
  text: string;
  /** The lines the text it is translated from has in this verse. */
  least: number;
  /** The shape of each of `count` lines (`lineShapes`). */
  shapes: (count: number) => LineShape[];
  placeholder: (line: number) => string;
  addLabel: string;
  disabled?: boolean;
  onChange: (text: string) => void;
  onFocus: () => void;
  /** The focus left the verse, not one of its lines for another. */
  onBlur: () => void;
};

/** The id of the field of a line, as `VerseLines` names them. */
export function lineFieldId(id: string, line: number): string {
  return line === 0 ? id : `${id}-l${line + 1}`;
}

/**
 * A verse of a poem, a field to a line, each drawn as its line is in the text it is translated from: the rule at
 * its left, and set in by its depth. In one box a new line is a key to know of, and the shape of the verse is not
 * seen until the box is left.
 */
export function VerseLines({ id, text, least, shapes, placeholder, addLabel, disabled, onChange, onFocus, onBlur }: Props) {
  /** Empty lines opened after the last one: they are not text until something is written in them. */
  const [more, setMore] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const lines = fieldLines(text, least, more);
  const shape = shapes(lines.length);

  const put = (place: LinePlace) => {
    const box = root.current?.querySelector<HTMLTextAreaElement>(`#${CSS.escape(lineFieldId(id, place.line))}`);
    if (!box) return;
    box.focus();
    box.setSelectionRange(place.offset, place.offset);
  };
  /** The lines as they are now, and the cursor where the change left it: at once, so the focus is given while the key is still down. */
  const apply = (change: LinesChange) => {
    const kept = linesText(change.lines);
    const written = kept ? kept.split("\n").length : 0;
    flushSync(() => {
      setMore(Math.max(0, change.lines.length - Math.max(written, least, 1)));
      onChange(kept);
    });
    put(change.place);
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>, line: number) => {
    const box = event.currentTarget;
    const { selectionStart: from, selectionEnd: to } = box;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      apply(splitLine(lines, line, from, to));
    } else if (event.key === "Backspace" && from === 0 && to === 0 && line > 0) {
      event.preventDefault();
      apply(joinLine(lines, line));
    } else if (event.key === "ArrowUp" && from === 0 && to === 0 && line > 0) {
      event.preventDefault();
      put({ line: line - 1, offset: lines[line - 1]!.length });
    } else if (event.key === "ArrowDown" && from === box.value.length && line < lines.length - 1) {
      event.preventDefault();
      put({ line: line + 1, offset: 0 });
    }
  };

  return (
    <div
      ref={root}
      className="se-lines"
      onFocus={onFocus}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setMore(0);
        onBlur();
      }}
    >
      {lines.map((value, line) => (
        <div key={line} className="usfm-para se-line" data-marker={shape[line]?.marker} data-gap={shape[line]?.gap || undefined}>
          <textarea
            id={lineFieldId(id, line)}
            className="scripture-editor__input se-line__box"
            rows={1}
            value={value}
            placeholder={placeholder(line + 1)}
            disabled={disabled}
            enterKeyHint="next"
            onKeyDown={(event) => onKey(event, line)}
            onChange={(event) => {
              // A keyboard that sends no key for Enter leaves a line end in the text: it is the same request.
              const change = setLine(lines, line, event.target.value);
              if (change.lines.length !== lines.length) apply(change);
              else onChange(linesText(change.lines));
            }}
          />
        </div>
      ))}
      {lines[lines.length - 1]!.trim() ? (
        <button type="button" className="se-lines__add" disabled={disabled} onClick={() => apply({ lines: [...lines, ""], place: { line: lines.length, offset: 0 } })}>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}
