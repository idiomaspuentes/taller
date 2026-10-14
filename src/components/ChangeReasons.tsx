import { readChangesNote } from "../domain/proposalList";
import { wordDiff } from "../domain/verseEditView";
import { useT } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";

/**
 * Why a change to a verse is proposed, change by change: the words it touches, with what goes and what comes
 * marked, its cause as a tag, the reason and the notes it is about. It was one block of text, «…» → «…», «Causa:»,
 * «Por qué:», where four changes of one verse could not be told apart. A note written otherwise is shown as it was
 * written.
 */
export function ChangeReasons({ note }: { note: string }) {
  const t = useT();
  const changes = readChangesNote(note);
  if (!changes) return <div className="pl-note"><HelpMarkdownView content={note.replace(/\n/g, "\n\n")} /></div>;
  return (
    <ol className="cr" aria-label={t("cr.listAria")}>
      {changes.map((change, index) => (
        <li key={index} className="cr-item">
          <div className="cr-head">
            {changes.length > 1 ? <span className="cr-n">{index + 1}</span> : null}
            {change.cause ? <span className="cr-cause">{change.cause}</span> : null}
          </div>
          <p className="al-diff cr-words">
            {wordDiff(change.before, change.after).map((piece, i) => {
              const space = i ? " " : "";
              if (piece.kind === "del") return <span key={i}>{space}<del>{piece.text}</del></span>;
              if (piece.kind === "ins") return <span key={i}>{space}<ins>{piece.text}</ins></span>;
              return <span key={i}>{space}{piece.text}</span>;
            })}
          </p>
          {change.why ? (
            <div className="cr-why">
              <HelpMarkdownView content={change.why} />
            </div>
          ) : null}
          {change.notes ? (
            <p className="cr-notes">
              <span className="cr-notes__label">{t("cr.notes")}</span>
              {change.notes.split(/[\s,]+/).filter(Boolean).map((id) => (
                <code key={id} className="cr-note">{id}</code>
              ))}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
