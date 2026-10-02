import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { commentOnIssue } from "../dcs/issues";
import { changeMyStudyNotes, loadStudyNotes } from "../dcs/studyNotes";
import { explainError } from "../dcs/userError";
import { uid } from "../domain/assignment";
import { notesByResource, studyNotesFor, type StudyNote } from "../domain/studyNotes";
import { useT } from "../i18n/messages";

type Props = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  projectId: string;
  book: string;
  chapter: number;
  /** The verses of the passage in hand: what is written here is about them. */
  from?: number;
  to?: number;
  /** The resource being worked on and its name: a note written here is of it, and the ones of it are shown first. */
  resource?: string;
  resourceName?: string;
  /** The task the tool was opened for: said on the note, so that a later phase knows where it comes from. */
  taskName?: string;
  /** The subtarea whose conversation a question to the team goes to. Absent: asking is not offered. */
  issueNumber?: number;
  /** How many notes there are for the passage, once known. */
  onCount?: (count: number) => void;
};

/**
 * «Apuntes»: one box to write in and three things to do with what was written: keep it, share it with the team, or
 * ask the team about it. Below, what the person and the team already wrote about the passage. No kinds, no settings:
 * a note is about the passage in hand, and whether the team sees it is the button pressed.
 */
export function StudyNotesPanel({ session, pmOrg, lang, projectId, book, chapter, from, to, resource, resourceName, taskName, issueNumber, onCount }: Props) {
  const t = useT();
  const [notes, setNotes] = useState<StudyNote[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const me = session.username.toLowerCase();

  useEffect(() => {
    let alive = true;
    loadStudyNotes({ session, pmOrg, lang, projectId })
      .then((rows) => alive && setNotes(rows))
      .catch(() => alive && setNotes([]));
    return () => {
      alive = false;
    };
    // By what the session is, not by the object: a host that hands a new one on every render must not make the
    // notes load again (and show the list as it was before the last one was written).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, session.host, pmOrg, lang, projectId]);

  const here = useMemo(() => studyNotesFor(notes ?? [], { book, chapter, from, to }), [notes, book, chapter, from, to]);
  const { own, others } = useMemo(() => notesByResource(here, resource), [here, resource]);
  useEffect(() => {
    if (notes) onCount?.(here.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here.length, notes]);

  async function change(next: (mine: StudyNote[]) => StudyNote[], optimistic: (all: StudyNote[]) => StudyNote[], done = "") {
    setBusy(true);
    setError("");
    setSaid("");
    const before = notes;
    setNotes(optimistic(notes ?? []));
    try {
      await changeMyStudyNotes({ session, pmOrg, lang, projectId }, next);
      setSaid(done);
    } catch (err) {
      setNotes(before);
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  function keep(shared: boolean) {
    const body = text.trim();
    if (!body) return;
    const note: StudyNote = { id: `n-${uid().slice(0, 8)}`, by: me, book: book.toUpperCase(), chapter, ...(from ? { verse: from, ...(to && to > from ? { to } : {}) } : {}), kind: "found", ...(resource ? { resource: resource.toLowerCase(), ...(resourceName ? { resourceName } : {}) } : {}), ...(taskName ? { task: taskName } : {}), text: body, shared, at: new Date().toISOString() };
    setText("");
    void change(
      (mine) => [...mine, note],
      (all) => [...all, note],
      t(shared ? "sn.savedShared" : "sn.savedMine"),
    );
  }

  /** A question goes to the conversation of the task, where the team answers, and stays here as a shared note. */
  async function ask() {
    const body = text.trim();
    if (!body || !issueNumber) return;
    setBusy(true);
    setError("");
    setSaid("");
    try {
      await commentOnIssue(session, pmOrg, issueNumber, t("fa.doubtComment").replace("{ref}", `${book} ${where({ chapter, verse: from, to })}`).replace("{text}", body));
      setText("");
      setSaid(t("sn.asked"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  const where = (note: Pick<StudyNote, "chapter" | "verse" | "to">) => (note.verse ? `${note.chapter}:${note.verse}${note.to && note.to > note.verse ? `–${note.to}` : ""}` : note.chapter ? t("sn.chapter").replace("{n}", String(note.chapter)) : t("sn.book"));

  const row = (note: StudyNote) => {
            const mine = note.by.toLowerCase() === me;
            return (
              <li key={`${note.by}-${note.id}`} className="sn-note" data-shared={note.shared ? "true" : undefined}>
                <p className="sn-note__text">{note.text}</p>
                <p className="sn-note__meta">
                  <span>{[where(note), note.resourceName, note.task && note.task !== taskName ? note.task : ""].filter(Boolean).join(" · ")}</span>
                  <span>{mine ? t(note.shared ? "sn.mineShared" : "sn.mine") : `@${note.by}`}</span>
                  {mine ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void change(
                            (rows) => rows.map((row) => (row.id === note.id ? { ...row, shared: !row.shared } : row)),
                            (all) => all.map((row) => (row.id === note.id && row.by.toLowerCase() === me ? { ...row, shared: !row.shared } : row)),
                          )
                        }
                      >
                        {t(note.shared ? "sn.unshare" : "sn.shareIt")}
                      </button>
                      <button
                        type="button"
                        className="sn-note__del"
                        disabled={busy}
                        aria-label={t("sn.remove")}
                        title={t("sn.remove")}
                        onClick={() =>
                          void change(
                            (rows) => rows.filter((row) => row.id !== note.id),
                            (all) => all.filter((row) => !(row.id === note.id && row.by.toLowerCase() === me)),
                          )
                        }
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </>
                  ) : null}
                </p>
              </li>
            );
          };

  return (
    <div className="sn">
      <div className="sn-form">
        <textarea className="af-textarea" rows={3} value={text} placeholder={t("sn.placeholder")} aria-label={t("sn.text")} onChange={(e) => setText(e.target.value)} />
        <div className="sn-form__row">
          <Button type="button" size="sm" disabled={busy || !text.trim()} onClick={() => keep(false)}>
            {t("sn.keep")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || !text.trim()} onClick={() => keep(true)}>
            {t("sn.share")}
          </Button>
          {issueNumber ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy || !text.trim()} onClick={() => void ask()}>
              {t("sn.ask")}
            </Button>
          ) : null}
        </div>
        {said ? (
          <p className="af-saved" role="status">
            {said}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </div>

      {notes === null ? (
        <p className="pe-hint">{t("sn.loading")}</p>
      ) : own.length || others.length ? (
        <>
          {own.length ? <ul className="sn-list">{own.map(row)}</ul> : <p className="pe-hint">{t("sn.noneOfResource").replace("{res}", resourceName || "")}</p>}
          {others.length ? (
            <>
              <button type="button" className="pe-link" aria-expanded={showOthers} onClick={() => setShowOthers(!showOthers)}>
                {t(showOthers ? "sn.hideOthers" : others.length === 1 ? "sn.othersOne" : "sn.othersMany").replace("{n}", String(others.length))}
              </button>
              {showOthers ? <ul className="sn-list">{others.map(row)}</ul> : null}
            </>
          ) : null}
        </>
      ) : (
        <p className="pe-hint">{t("sn.none")}</p>
      )}
    </div>
  );
}
