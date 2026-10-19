import { useEffect, useMemo, useState } from "react";
import { ChevronDown, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { changeMyStudyNotes, loadStudyNotes } from "../dcs/studyNotes";
import { explainError } from "../dcs/userError";
import { uid } from "../domain/assignment";
import { attendedMessages, canEditMessage, editStudyNote, messageRef, messagesAbout, type StudyNote } from "../domain/studyNotes";
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
  /**
   * For the team the messages were left for: each one can be said to be attended to, once it was looked at.
   * Whoever left it sees that it was, and by whom.
   */
  canAttend?: boolean;
  /**
   * Folded under one line, opened by a touch: where the help itself is what is read, the box under it took the
   * attention from it (18 October). The line says how many messages there are.
   */
  folded?: boolean;
};

/**
 * Messages about one help (a translation note, say), left by a team whose work is not that help for the team
 * that will work on it: whoever refines the text and disagrees with a note says what they would change, and
 * whoever harmonizes that note later finds it there. They are shared study notes that name the help.
 */
export function HelpMessages({ session, pmOrg, lang, projectId, book, chapter, verse, about, resource, resourceName, taskName, lede, onCount, onlyIfAny, canAttend, folded }: Props) {
  const t = useT();
  const [notes, setNotes] = useState<StudyNote[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** A message of one's own being said again, in its place. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [open, setOpen] = useState(!folded);

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
  const attended = useMemo(() => attendedMessages(notes ?? [], book, about), [notes, book, about]);

  /** Says a message was looked at: a note of this person's own that names it, so its writer finds it answered. */
  async function attend(message: StudyNote) {
    const mark: StudyNote = { id: `n-${uid().slice(0, 8)}`, by: session.username.toLowerCase(), book: book.toUpperCase(), chapter, verse, kind: "remember", resource: resource.toLowerCase(), ...(taskName ? { task: taskName } : {}), about, attends: messageRef(message), text: t("hm.attendedText"), shared: true, at: new Date().toISOString() };
    setBusy(true);
    setError("");
    const before = notes;
    setNotes([...(notes ?? []), mark]);
    try {
      await changeMyStudyNotes({ session, pmOrg, lang, projectId }, (mine) => [...mine, mark]);
    } catch (err) {
      setNotes(before);
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (notes) onCount?.(here.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here.length, notes]);

  /** What one's own message says now: it was written in a hurry, or wrong, and could not be corrected. */
  async function saveEdit() {
    if (!editing?.text.trim()) return;
    const { id, text: said } = editing;
    const at = new Date().toISOString();
    const me = session.username.toLowerCase();
    setBusy(true);
    setError("");
    const before = notes;
    setNotes((notes ?? []).map((note) => (note.by.toLowerCase() === me ? editStudyNote([note], id, said, at)[0]! : note)));
    setEditing(null);
    try {
      await changeMyStudyNotes({ session, pmOrg, lang, projectId }, (mine) => editStudyNote(mine, id, said, at));
    } catch (err) {
      setNotes(before);
      setEditing({ id, text: said });
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

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

  const toggle = folded ? (
    <button type="button" className="hm-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      <MessageSquarePlus size={16} aria-hidden />
      <span>
        {t("hm.toggle")}
        {here.length ? ` · ${t(here.length === 1 ? "hm.countOne" : "hm.countMany").replace("{n}", String(here.length))}` : ""}
      </span>
      <ChevronDown size={16} aria-hidden className="hm-toggle__chev" />
    </button>
  ) : null;
  if (!open)
    return <div className="hm hm--folded">{toggle}</div>;

  return (
    <div className="hm">
      {toggle}
      {/* Who the message is for, as the title of the box: in small grey it read as a footnote and was missed. */}
      <p className="hm__lede">{lede}</p>
      {here.length ? (
        <ul className="rv-comments">
          {here.map((note) =>
            editing?.id === note.id && note.by.toLowerCase() === session.username.toLowerCase() ? (
              <li key={`${note.by}-${note.id}`} className="rv-comment hm-editing">
                <textarea className="af-textarea" rows={2} autoFocus value={editing.text} aria-label={t("hm.editAria")} onChange={(e) => setEditing({ id: note.id, text: e.target.value })} />
                <div className="af-row-buttons">
                  <Button type="button" size="sm" disabled={busy || !editing.text.trim()} onClick={() => void saveEdit()}>
                    {t("hm.save")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    {t("hm.cancel")}
                  </Button>
                </div>
              </li>
            ) : (
            <li key={`${note.by}-${note.id}`} className="rv-comment">
              <p className="rv-comment__text">{note.text}</p>
              <p className="rv-comment__meta">{[`@${note.by}`, note.task ?? "", note.edited ? t("hm.edited") : ""].filter(Boolean).join(" · ")}</p>
              {canEditMessage(note, session.username, attended) ? (
                <button type="button" className="af-link hm-edit" disabled={busy} onClick={() => setEditing({ id: note.id, text: note.text })}>
                  {t("hm.edit")}
                </button>
              ) : null}
              {attended.has(messageRef(note)) ? (
                <p className="rv-comment__meta hm-attended">{t("hm.attendedBy").replace("{who}", `@${attended.get(messageRef(note))!.by}`)}</p>
              ) : canAttend && note.by.toLowerCase() !== session.username.toLowerCase() ? (
                <button type="button" className="af-link hm-attend" disabled={busy} onClick={() => void attend(note)}>
                  {t("hm.attend")}
                </button>
              ) : null}
            </li>
            ),
          )}
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
