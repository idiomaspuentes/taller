import { readChangesNote } from "../domain/proposalList";
import { reasonPieces, type NoteWords } from "../domain/reasonText";
import { wordDiff } from "../domain/verseEditView";
import { inEveryLanguage, useT } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";

/** What a reason can open: the words of the original it is read against, and the notes of the book. */
export type ReasonLinks = {
  /** The words of the verse first, then of its chapter: a word quoted is looked for in that order. */
  among: string[];
  notes: Set<string>;
  onWord: (index: number) => void;
  onNote: (id: string) => void;
  onArticle?: (path: string) => void;
};

const isHebrew = (text: string) => /[֐-׿]/.test(text);

/** The words notes are named by in every language of the app: a reason is read whatever language it was written in. */
const noteWords = (): NoteWords => ({
  note: inEveryLanguage("rt.noteWords").flatMap((list) => list.split(",").map((word) => word.trim()).filter(Boolean)),
  and: inEveryLanguage("rt.and").map((word) => word.trim()).filter(Boolean),
});

/** A reason, with the words of the original it quotes and the notes it names to tap. */
export function ReasonText({ text, links }: { text: string; links: ReasonLinks }) {
  const t = useT();
  return (
    <>
      {reasonPieces(text, links.among, links.notes, noteWords()).map((paragraph, at) => (
        <p key={at} className="rt-p">
          {paragraph.map((piece, i) => {
            const inner =
              piece.kind === "word" ? (
                piece.match >= 0 ? (
                  <button type="button" className="rt-word" lang={isHebrew(piece.text) ? "hbo" : "grc"} dir={isHebrew(piece.text) ? "rtl" : undefined} title={t("rt.wordTitle")} onClick={() => links.onWord(piece.match)}>
                    {piece.text}
                  </button>
                ) : (
                  <span lang={isHebrew(piece.text) ? "hbo" : "grc"} dir={isHebrew(piece.text) ? "rtl" : undefined}>
                    {piece.text}
                  </span>
                )
              ) : piece.kind === "article" ? (
                links.onArticle ? (
                  <button type="button" className="rt-note" title={t("rt.articleTitle")} onClick={() => links.onArticle!(piece.path)}>
                    {piece.text}
                  </button>
                ) : (
                  piece.text
                )
              ) : piece.kind === "note" ? (
                <button type="button" className="rt-note" title={t("rt.noteTitle")} onClick={() => links.onNote(piece.id)}>
                  {piece.text}
                </button>
              ) : (
                piece.text
              );
            return piece.strong ? <strong key={i}>{inner}</strong> : <span key={i}>{inner}</span>;
          })}
        </p>
      ))}
    </>
  );
}

/**
 * Why a change to a verse is proposed, change by change: the words it touches, with what goes and what comes
 * marked, its cause as a tag, the reason and the notes it is about. It was one block of text, «…» → «…», «Causa:»,
 * «Por qué:», where four changes of one verse could not be told apart. A note written otherwise is shown as it was
 * written. With `links`, the words of the original and the notes it names open.
 */
export function ChangeReasons({ note, links }: { note: string; links?: ReasonLinks }) {
  const t = useT();
  const changes = readChangesNote(note);
  if (!changes) {
    return <div className="pl-note">{links ? <ReasonText text={note} links={links} /> : <HelpMarkdownView content={note.replace(/\n/g, "\n\n")} />}</div>;
  }
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
          {change.why ? <div className="cr-why">{links ? <ReasonText text={change.why} links={links} /> : <HelpMarkdownView content={change.why} />}</div> : null}
          {change.notes ? (
            <p className="cr-notes">
              <span className="cr-notes__label">{t("cr.notes")}</span>
              {change.notes
                .split(/[\s,]+/)
                .filter(Boolean)
                .map((id) =>
                  links?.notes.has(id) ? (
                    <button key={id} type="button" className="cr-note" title={t("rt.noteTitle")} onClick={() => links.onNote(id)}>
                      {id}
                    </button>
                  ) : (
                    <code key={id} className="cr-note">
                      {id}
                    </code>
                  ),
                )}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
