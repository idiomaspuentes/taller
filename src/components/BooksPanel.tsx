import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { loadPmConfig } from "../dcs/issues";
import { loadDoneElsewhere, loadTeamToday } from "../dcs/teamToday";
import { bookLabel } from "../domain/books";
import { spaceBooks, type SpaceBook } from "../domain/bookStanding";
import { processPlan } from "../domain/processes";
import { PUBLISHED_FROM } from "../domain/doneElsewhere";
import { endDateText, paceNumber, paceOf, PACE_WEEKS } from "../domain/pace";
import { localizeName } from "../domain/templateNames";
import { percentOf } from "../domain/workProgress";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { ProgressBar } from "./ProgressBar";

type Props = {
  books: SpaceBook[];
  /** The record of the work done before Taller could not be read: only the books of Taller are shown. */
  recordMissing?: boolean;
  /** Folded until it is opened (where it is not the first thing on the screen). */
  folded?: boolean;
};

/**
 * «Libros»: every book of the space and how far it is, counting what was done before Taller. One bar and one line
 * each; touching a book shows its phases and tasks.
 */
export function BooksPanel({ books, recordMissing, folded }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [open, setOpen] = useState(!folded);
  const [book, setBook] = useState("");
  const now = useMemo(() => new Date(), []);

  if (!books.length && !recordMissing) return null;

  function line(row: SpaceBook): string {
    const { fraction, before, started } = row.standing;
    if (fraction >= 1) return before >= 1 ? t(row.elsewhere?.from === PUBLISHED_FROM ? "bk.publishedBefore" : "bk.finishedBefore") : t("bk.finished");
    const parts: string[] = [];
    if (row.paused) parts.push(t("bk.paused"));
    if (started) {
      const pace = paceOf(row.issues, row.plan, now);
      parts.push(
        (pace.perWeek > 0 ? t("pc.pace").replace("{weeks}", String(PACE_WEEKS)).replace("{n}", paceNumber(pace.perWeek, language)) : t("pc.none").replace("{weeks}", String(PACE_WEEKS))) +
          (pace.endsAt ? ` ${t("pc.ends").replace("{date}", endDateText(pace.endsAt, language))}` : ""),
      );
    } else if (!row.paused) parts.push(t("bk.notInTaller"));
    if (before > 0) parts.push(t("bk.before").replace("{n}", String(percentOf(before))));
    return parts.join(" ");
  }

  return (
    <section className="today-group books" aria-labelledby="books-title">
      <button type="button" className="today-group__head" aria-expanded={open} onClick={() => setOpen((prev) => !prev)}>
        <h2 id="books-title" className="today-group__title">
          {t("bk.title")}
        </h2>
        <span className="today-group__count">{books.length}</span>
      </button>
      {open ? (
        <>
          {recordMissing ? <p className="today-group__empty">{t("bk.recordMissing")}</p> : null}
          <ul className="today-list">
            {books.map((row) => {
              const percent = percentOf(row.standing.fraction);
              const shown = book === row.book;
              const name = bookLabel(row.book, language);
              return (
                <li key={row.book} className="book-row" data-done={row.standing.fraction >= 1 || undefined}>
                  <button type="button" className="book-row__head" aria-expanded={shown} onClick={() => setBook(shown ? "" : row.book)}>
                    <span className="book-row__name">
                      {name}
                      <ChevronRight aria-hidden />
                    </span>
                    <span className="book-row__percent">{t("pg.percent").replace("{n}", String(percent))}</span>
                    <ProgressBar value={row.standing.fraction} label={t("bk.barLabel").replace("{book}", name).replace("{n}", String(percent))} />
                    <span className="book-row__line">{line(row)}</span>
                  </button>
                  {shown ? (
                    <div className="book-row__phases">
                      {row.standing.phases.map((phase) => {
                        const named = row.plan.phases.find((p) => p.id === phase.phaseId);
                        return (
                          <div key={phase.phaseId} className="book-phase">
                            <p className="book-phase__head">
                              <strong>{named ? localizeName(named.name, language) : phase.phaseId}</strong>
                              <span>{phase.nothing ? t("bk.nothing") : t("pg.percent").replace("{n}", String(percentOf(phase.fraction)))}</span>
                            </p>
                            <ul className="book-phase__tasks">
                              {phase.tasks.map((task) => {
                                const plan = row.plan.teams.find((p) => p.id === task.taskId);
                                const taskName = plan ? localizeName(plan.name, language) : task.taskId;
                                const p = percentOf(task.fraction);
                                // Nothing to do in this book (all translated before): said, never as a bar at 0 %.
                                if (task.nothing)
                                  return (
                                    <li key={task.taskId} className="book-task">
                                      <span className="book-task__name">{taskName}</span>
                                      <span className="book-task__percent">{t("bk.nothing")}</span>
                                    </li>
                                  );
                                return (
                                  <li key={task.taskId} className="book-task">
                                    <span className="book-task__name">{taskName}</span>
                                    <span className="book-task__percent">{t("pg.percent").replace("{n}", String(p))}</span>
                                    <ProgressBar value={task.fraction} label={t("bk.barLabel").replace("{book}", taskName).replace("{n}", String(p))} />
                                    {task.before > 0 ? (
                                      <span className="book-task__before">
                                        {task.before >= task.fraction ? t("bk.allBefore") : t("bk.before").replace("{n}", String(percentOf(task.before)))}
                                      </span>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * The books of a space as one team sees them: how far each one is in that team's tasks, counting what was done
 * before Taller. Read on its own (the projects, their subtareas, the record and the order of «Proyectos»).
 */
export function TeamBooks({ session, pmOrg, lang, contentOrg, team }: { session: GtSession; pmOrg: string; lang: string; contentOrg: string; team: string }) {
  const [books, setBooks] = useState<SpaceBook[] | null>(null);
  const [recordMissing, setRecordMissing] = useState(false);
  useEffect(() => {
    if (!pmOrg || !team) return;
    let alive = true;
    void (async () => {
      const [projects, config, record] = await Promise.all([
        loadTeamToday({ session, pmOrg, lang, contentOrg }),
        loadPmConfig(session, pmOrg).catch(() => null),
        loadDoneElsewhere(session, pmOrg, lang),
      ]);
      const rows = spaceBooks({
        projects,
        doneElsewhere: record ?? { books: {} },
        process: processPlan(record?.process, { lang, contentOrg, pmOrg }),
        teams: [team],
        priority: { projectOrder: config?.projectOrder ?? [], paused: config?.paused ?? [] },
      });
      if (!alive) return;
      setBooks(rows);
      setRecordMissing(record === null);
    })().catch(() => {
      if (alive) setBooks([]);
    });
    return () => {
      alive = false;
    };
  }, [session, pmOrg, lang, contentOrg, team]);
  return books ? <BooksPanel books={books} recordMissing={recordMissing} folded /> : null;
}
