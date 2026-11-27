import { useEffect, useState } from "react";
import type { GtSession } from "../dcs/auth";
import { listWorkSince } from "../dcs/issues";
import { bookLabel } from "../domain/books";
import { myWeek, weekStart, type MyWeek } from "../domain/myWeek";
import { subtaskName } from "../domain/noticeText";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

/**
 * «Lo que hice esta semana» on the profile (#78): what the person finished and the steps they closed, day by day,
 * and their finished work by project. Only this week. Counted in things done, never in time; nothing to keep up.
 */
export function MyWeekSection({ session, pmOrg }: { session: GtSession; pmOrg: string }) {
  const t = useT();
  const language = useUiLanguage();
  const [week, setWeek] = useState<MyWeek | null | undefined>(undefined);

  useEffect(() => {
    if (!pmOrg) return;
    let live = true;
    setWeek(undefined);
    const now = new Date();
    void listWorkSince(session, pmOrg, weekStart(now))
      .then((issues) => live && setWeek(myWeek(issues, session.username, now)))
      .catch(() => live && setWeek(null));
    return () => {
      live = false;
    };
    // By what the session is, not the object: the app passes a new one on every render, and the week was asked again
    // and again without ever being shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.host, session.username, session.token, pmOrg]);

  const count = (n: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) => (n === 1 ? t(one) : t(many).replace("{n}", String(n)));
  const today = new Date().toDateString();

  return (
    <section className="profile__card" aria-labelledby="profile-week">
      <h2 id="profile-week" className="profile__title">
        {t("wk.title")}
      </h2>
      {week === undefined ? (
        <p className="profile__note">{t("wk.loading")}</p>
      ) : week === null ? (
        <p className="profile__note">{t("wk.failed")}</p>
      ) : !week.tasks && !week.steps ? (
        <p className="week__empty">{t("wk.empty")}</p>
      ) : (
        <>
          <p className="week__summary">{t("wk.summary").replace("{tasks}", count(week.tasks, "wk.tasksOne", "wk.tasksMany")).replace("{steps}", count(week.steps, "wk.stepsOne", "wk.stepsMany"))}</p>
          <ol className="week__days" aria-label={t("wk.daysLabel")}>
            {week.days.map((day) => {
              const done = day.tasks + day.steps;
              const name = day.date.toLocaleDateString(language, { weekday: "short" });
              return (
                <li key={day.date.toISOString()} className="week__day" data-today={day.date.toDateString() === today || undefined} data-done={done > 0 || undefined}>
                  <span className="week__day-name">{name}</span>
                  <span className="week__day-count" role="img" aria-label={t("wk.dayLabel").replace("{day}", day.date.toLocaleDateString(language, { weekday: "long" })).replace("{n}", String(done))}>
                    {done || "·"}
                  </span>
                </li>
              );
            })}
          </ol>
          {week.projects.length ? (
            <div className="week__projects">
              <h3 className="week__subtitle">{t("wk.byProject")}</h3>
              {week.projects.map((project) => (
                <details key={project.projectId} className="week__project">
                  <summary>
                    {project.projectId ? bookLabel(project.projectId, language) || project.projectId : t("wk.noProject")} · {count(project.issues.length, "wk.tasksOne", "wk.tasksMany")}
                  </summary>
                  <ul>
                    {project.issues.map((issue) => (
                      <li key={issue.number}>{subtaskName(issue, language === "pt" ? "pt" : "es")}</li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : null}
          <p className="profile__help week__purpose">{t("wk.purpose")}</p>
        </>
      )}
    </section>
  );
}
