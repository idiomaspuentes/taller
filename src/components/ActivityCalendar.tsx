import { useMemo } from "react";
import { calendarWeeks, lastDays, recentDays, workDays, workSummary, type HeatSlot } from "../domain/activity";
import { endDateText, paceNumber, PACE_WEEKS, type Pace } from "../domain/pace";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

/** The weeks a person's work is summed over: the same the pace of a project is taken over. */
export const WORK_WEEKS = PACE_WEEKS;

type Translate = ReturnType<typeof useT>;

/** Minutes as they are said: «45 min», «2 h», «2 h 30 min». */
export function timeText(minutes: number, t: Translate): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return t("ac.min").replace("{n}", String(rest));
  return rest ? t("ac.hm").replace("{h}", String(hours)).replace("{m}", String(rest)) : t("ac.h").replace("{h}", String(hours));
}

/** «Días trabajados: 9 · Tiempo aproximado: 14 h», over the weeks a person's work is summed over. */
export function useWorkLine(slots: HeatSlot[] | null | undefined): string {
  const t = useT();
  return useMemo(() => {
    if (slots === null) return t("ac.failed");
    if (!slots) return t("ac.loading");
    const sum = workSummary(workDays(slots), new Date(), WORK_WEEKS * 7);
    return sum.days ? t("ac.summary").replace("{days}", String(sum.days)).replace("{time}", timeText(sum.minutes, t)) : t("ac.none").replace("{weeks}", String(WORK_WEEKS));
  }, [slots, t]);
}

/** The last four weeks in one line, a square a day: enough to see at a glance who worked and how steadily. */
export function ActivityStrip({ slots }: { slots: HeatSlot[] | null | undefined }) {
  const days = useMemo(() => lastDays(workDays(slots ?? []), new Date(), WORK_WEEKS * 7), [slots]);
  return (
    <span className="act-strip" aria-hidden>
      {days.map((day) => (
        <i key={day.day} data-level={day.level} />
      ))}
    </span>
  );
}

/**
 * A person's work as a calendar, the way GitHub draws it: a column a week, a square a day, darker the more was
 * worked. Under it, the last seven days in words: a square of a phone's screen cannot be touched to ask it.
 */
export function ActivityCalendar({ slots, weeks = 12, summed = true }: { slots: HeatSlot[]; weeks?: number; /** Off where the sum is already said over it. */ summed?: boolean }) {
  const t = useT();
  const language = useUiLanguage();
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => workDays(slots), [slots]);
  const columns = useMemo(() => calendarWeeks(days, now, weeks), [days, now, weeks]);
  const recent = useMemo(() => recentDays(days, now, 7), [days, now]);
  const line = useWorkLine(slots);
  // Monday 1 January 2024: the names of the days as the language writes them («L M X J V S D»).
  const names = useMemo(() => Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index)).toLocaleDateString(language, { weekday: "narrow", timeZone: "UTC" })), [language]);
  const month = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(language, { month: "short", timeZone: "UTC" });
  const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(language, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const hour = (ms: number) => new Date(ms).toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="act">
      {summed ? (
        <p className="act__sum">
          <small>{t("ac.period").replace("{weeks}", String(WORK_WEEKS))}</small>
          {line}
        </p>
      ) : null}
      <div className="act-cal" role="img" aria-label={`${t("ac.calendarLabel").replace("{weeks}", String(weeks))}. ${line}`}>
        <div className="act-cal__col act-cal__names" aria-hidden>
          <span />
          {names.map((name, index) => (
            <span key={index}>{name}</span>
          ))}
        </div>
        {columns.map((week, index) => (
          <div key={week[0]!.day} className="act-cal__col">
            {/* The month is named over the week it begins in. */}
            <span className="act-cal__month">{index === 0 || month(week[0]!.day) !== month(columns[index - 1]![0]!.day) ? month(week[0]!.day) : ""}</span>
            {week.map((day) => (
              <i key={day.day} data-level={day.level} data-future={day.future || undefined} />
            ))}
          </div>
        ))}
      </div>
      <p className="act__legend" aria-hidden>
        {t("ac.less")}
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} data-level={level} />
        ))}
        {t("ac.more")}
      </p>
      <h3 className="act__title">{t("ac.recent")}</h3>
      {recent.length ? (
        <ul className="act__days">
          {recent.map((day) => (
            <li key={day.day}>
              <strong>{dayName(day.day)}</strong>
              <span>{t("ac.day").replace("{time}", timeText(day.minutes, t)).replace("{from}", hour(day.from)).replace("{to}", hour(day.to))}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="act__empty">{t("ac.noRecent")}</p>
      )}
      <p className="act__note">{t("ac.note")}</p>
    </div>
  );
}

/** The pace of a project: what was finished each of the last weeks, the pace that makes, and when it would end. */
export function PaceChart({ pace }: { pace: Pace }) {
  const t = useT();
  const language = useUiLanguage();
  const top = Math.max(1, ...pace.weeks);
  const ends = pace.endsAt ? endDateText(pace.endsAt, language) : "";
  return (
    <div className="pace">
      {/* With nothing finished in any of them there is nothing to draw: the sentence under says it. */}
      {pace.weeks.some(Boolean) ? (
        <>
          <h3 className="pace__title">{t("pc.title")}</h3>
          <div className="pace__chart" role="img" aria-label={t("pc.chartLabel").replace("{n}", String(pace.weeks.length)).replace("{list}", pace.weeks.join(", "))}>
            {pace.weeks.map((count, index) => (
              <span key={index} className="pace__week">
                <small>{count || ""}</small>
                <i style={{ height: `${Math.round((count / top) * 100)}%` }} data-empty={!count || undefined} />
              </span>
            ))}
          </div>
          <p className="pace__axis" aria-hidden>
            <span>{t("pc.weeksAgo").replace("{n}", String(pace.weeks.length - 1))}</span>
            <span>{t("pc.thisWeek")}</span>
          </p>
        </>
      ) : null}
      <p className="pace__line">
        {pace.left <= 0 ? t("pc.allDone") : pace.perWeek > 0 ? t("pc.pace").replace("{weeks}", String(PACE_WEEKS)).replace("{n}", paceNumber(pace.perWeek, language)) : t("pc.none").replace("{weeks}", String(PACE_WEEKS))}
        {ends ? ` ${t("pc.ends").replace("{date}", ends)}` : ""}
      </p>
    </div>
  );
}
