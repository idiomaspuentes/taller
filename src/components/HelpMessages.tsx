import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { changeMyStudyNotes, loadStudyNotes } from "../dcs/studyNotes";
import { explainError } from "../dcs/userError";
import { uid } from "../domain/assignment";
import { messagesAbout, type StudyNote } from "../domain/studyNotes";
import { useT } from "../i18n/messages";

type Props = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  projectId: string;
  book: string;
  chapter: number;
  verse: number;
  /** The help the messages are about: the id of the note (or question, or term) in its file. */
  about: string;
  /** The resource that help belongs to, and its name. */
  resource: string;
  resourceName?: string;
  /** The task they are written from, so that whoever reads them knows who said it and when in the process. */
  taskName?: string;
  /** Said above the box: who the message is for, or who it comes from. */
  lede: string;
  /** How many there are, once known. */
  onCount?: (count: number) => void;
  /** For whoever only reads them: with none there is nothing to read nor to answer, so nothing is shown. */
  onlyIfAny?: boolean;
};

/**
 * Messages about one help (a translation note, say), left by a team whose work is not that help for the team
 * that will work on it: whoever refines the text and disagrees with a note says what they would change, and
 * whoever harmonizes that note later finds it there. They are shared study notes that name the help.
 */
export function HelpMessages({ session, pmOrg, lang, projectId, book, chapter, verse, about, resource, resourceName, taskName, lede, onCount, onlyIfAny }: Props) {
  const t = useT();
  const [notes, setNotes] = useState<StudyNote[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    loadStudyNotes({ session, pmOrg, lang, projectId })
      .then((rows) => alive && setNotes(rows))
      .catch(() => alive && setNotes([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, session.host, pmOrg, lang, projectId]);

  const here = useMemo(() => messagesAbout(notes ?? [], book, about), [notes, book, about]);
  useEffect(() => {
    if (notes) onCount?.(here.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here.length, notes]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    const note: StudyNote = { id: `n-${uid().slice(0, 8)}`, by: session.username.toLowerCase(), book: book.toUpperCase(), chapter, verse, kind: "remember", resource: resource.toLowerCase(), ...(resourceName ? { resourceName } : {}), ...(taskName ? { task: taskName } : {}), about, text: body, shared: true, at: new Date().toISOString() };
    setBusy(true);
    setError("");
    const before = notes;
    setNotes([...(notes ?? []), note]);
    setText("");
    try {
      await changeMyStudyNotes({ session, pmOrg, lang, projectId }, (mine) => [...mine, note]);
    } catch (err) {
      setNotes(before);
      setText(body);
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  if (onlyIfAny && !here.length) return null;

  return (
    <div className="hm">
      <p className="af-hint">{lede}</p>
      {here.length ? (
        <ul className="rv-comments">
          {here.map((note) => (
            <li key={`${note.by}-${note.id}`} className="rv-comment">
              <p className="rv-comment__text">{note.text}</p>
              <p className="rv-comment__meta">{[`@${note.by}`, note.task ?? ""].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea className="af-textarea" rows={2} value={text} placeholder={t("hm.placeholder")} aria-label={t("hm.placeholder")} onChange={(e) => setText(e.target.value)} />
      <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={busy || !text.trim()} onClick={() => void send()}>
        {t("hm.send")}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
