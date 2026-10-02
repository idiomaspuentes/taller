import { useEffect, useMemo, useState } from "react";
import { Lightbulb, Pin, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { changeMyStudyNotes, loadStudyNotes } from "../dcs/studyNotes";
import { explainError } from "../dcs/userError";
import { uid } from "../domain/assignment";
import { studyNotesFor, type StudyNote, type StudyNoteKind } from "../domain/studyNotes";
import { useT } from "../i18n/messages";

type Props = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  projectId: string;
  book: string;
  chapter: number;
  /** The verses of the passage in hand: a note can be about one of them. */
  from?: number;
  to?: number;
  /** Only read: the notes are shown and none is added (a tool where writing them would be out of place). */
  readOnly?: boolean;
  /** How many notes there are for the passage, once known. */
  onCount?: (count: number) => void;
};

/**
 * «Apuntes»: what the person found out or wants to keep in mind about a passage, their own and the ones the team
 * shared. Written while studying; shown again wherever the same passage is worked on.
 */
export function StudyNotesPanel({ session, pmOrg, lang, projectId, book, chapter, from, to, readOnly, onCount }: Props) {
  const t = useT();
  const [notes, setNotes] = useState<StudyNote[] | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<StudyNoteKind>("found");
  const [verse, setVerse] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = session.username.toLowerCase();

  useEffect(() => {
    let alive = true;
    loadStudyNotes({ session, pmOrg, lang, projectId })
      .then((rows) => alive && setNotes(rows))
      .catch(() => alive && setNotes([]));
    return () => {
      alive = false;
    };
  }, [session, pmOrg, lang, projectId]);

  const here = useMemo(() => studyNotesFor(notes ?? [], { book, chapter, from, to }), [notes, book, chapter, from, to]);
  useEffect(() => {
    if (notes) onCount?.(here.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here.length, notes]);

  async function change(next: (mine: StudyNote[]) => StudyNote[], optimistic: (all: StudyNote[]) => StudyNote[]) {
    setBusy(true);
    setError("");
    const before = notes;
    setNotes(optimistic(notes ?? []));
    try {
      await changeMyStudyNotes({ session, pmOrg, lang, projectId }, next);
    } catch (err) {
      setNotes(before);
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const body = text.trim();
    if (!body) return;
    const note: StudyNote = { id: `n-${uid().slice(0, 8)}`, by: me, book: book.toUpperCase(), chapter, ...(verse ? { verse: Number(verse) } : {}), kind, text: body, shared, at: new Date().toISOString() };
    setText("");
    void change(
      (mine) => [...mine, note],
      (all) => [...all, note],
    );
  }

  const verses = from !== undefined ? Array.from({ length: (to ?? from) - from + 1 }, (_, index) => from + index) : [];
  const where = (note: StudyNote) => (note.verse ? `${note.chapter}:${note.verse}` : note.chapter ? t("sn.chapter").replace("{n}", String(note.chapter)) : t("sn.book"));

  return (
    <div className="sn">
      {!readOnly ? (
        <form
          className="sn-form"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="pe-seg sn-kinds" role="radiogroup" aria-label={t("sn.kind")}>
            <button type="button" role="radio" aria-checked={kind === "found"} className="pe-seg__opt" onClick={() => setKind("found")}>
              <Lightbulb size={14} aria-hidden /> {t("sn.found")}
            </button>
            <button type="button" role="radio" aria-checked={kind === "remember"} className="pe-seg__opt" onClick={() => setKind("remember")}>
              <Pin size={14} aria-hidden /> {t("sn.remember")}
            </button>
          </div>
          <textarea className="af-textarea" rows={2} value={text} placeholder={t(kind === "found" ? "sn.foundPlaceholder" : "sn.rememberPlaceholder")} aria-label={t("sn.text")} onChange={(e) => setText(e.target.value)} />
          <div className="sn-form__row">
            {verses.length ? (
              <select className="af-input pe-auto" value={verse} aria-label={t("sn.about")} onChange={(e) => setVerse(e.target.value)}>
                <option value="">{t("sn.wholePassage")}</option>
                {verses.map((v) => (
                  <option key={v} value={v}>
                    {chapter}:{v}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="pe-check">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              <span>{t("sn.share")}</span>
            </label>
            <Button type="submit" size="sm" disabled={busy || !text.trim()}>
              {t("sn.add")}
            </Button>
          </div>
          <p className="pe-hint">{t(shared ? "sn.sharedHint" : "sn.privateHint")}</p>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {notes === null ? (
        <p className="pe-hint">{t("sn.loading")}</p>
      ) : here.length ? (
        <ul className="sn-list">
          {here.map((note) => {
            const mine = note.by.toLowerCase() === me;
            return (
              <li key={`${note.by}-${note.id}`} className="sn-note" data-kind={note.kind}>
                <p className="sn-note__meta">
                  {note.kind === "found" ? <Lightbulb size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
                  <b>{where(note)}</b>
                  <span>{mine ? t(note.shared ? "sn.mineShared" : "sn.mine") : `@${note.by}`}</span>
                  {note.shared && mine ? <Users size={13} aria-hidden /> : null}
                </p>
                <p className="sn-note__text">{note.text}</p>
                {mine && !readOnly ? (
                  <div className="sn-note__actions">
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
                      disabled={busy}
                      aria-label={t("sn.remove")}
                      onClick={() =>
                        void change(
                          (rows) => rows.filter((row) => row.id !== note.id),
                          (all) => all.filter((row) => !(row.id === note.id && row.by.toLowerCase() === me)),
                        )
                      }
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="pe-hint">{t(readOnly ? "sn.noneRead" : "sn.none")}</p>
      )}
    </div>
  );
}
