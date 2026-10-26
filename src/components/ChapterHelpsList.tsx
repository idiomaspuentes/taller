import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rosterCounts, type RosterRow, type RosterSection, type RosterStatus } from "../domain/chapterRoster";
import { useT, type MessageKey } from "../i18n/messages";

/** Somebody on a help right now, and whether they are writing to the team. */
export type PresentPerson = { login: string; name: string; writing: boolean };

type Filter = "all" | "mine" | "unread";

const ORDER: RosterStatus[] = ["ready", "mine", "waiting", "unread"];
const LEGEND: Record<RosterStatus, MessageKey> = { ready: "ck.listReady", mine: "ck.listMine", waiting: "ck.listWaiting", unread: "ck.listUnread" };
const CHIP: Record<RosterStatus, MessageKey> = { ready: "ck.rowReady", mine: "ck.rowMine", waiting: "ck.rowWaiting", unread: "ck.rowUnread" };

const initial = (login: string) => (login.trim()[0] ?? "?").toUpperCase();

/**
 * Every help of a chapter in one list (26 October), as the team's spreadsheet of the migration had them: by section,
 * each with where it stands for the person looking, and the way on to where people are still needed.
 */
export function ChapterHelpsList(props: {
  title: string;
  rows: RosterRow[];
  sections: RosterSection[];
  labelOf: (itemId: string) => string;
  onOpen: (itemId: string) => void;
  onNext: () => void;
  /** Nothing is left for this person: «Seguir» found nothing to take them to. */
  nothingLeft?: boolean;
  presentOn?: (itemId: string) => PresentPerson[];
}) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => rosterCounts(props.rows), [props.rows]);
  const shown = props.rows.filter((row) => filter === "all" || row.status === filter);
  const share = Math.round(counts.readyShare * 100);

  return (
    <section className="ck-roster" aria-labelledby="ck-roster-title">
      <header className="ck-roster__head">
        <h2 className="af-heading ck-roster__title" id="ck-roster-title">
          {props.title}
        </h2>
        <p className="ck-roster__share">{t("ck.listShare").replace("{n}", String(share))}</p>
        {/* Where the chapter stands, in four parts that always add up to all of it. */}
        <div className="ck-roster__bar" aria-hidden>
          {ORDER.map((status) => (counts[status] ? <span key={status} data-status={status} style={{ flexGrow: counts[status] }} /> : null))}
        </div>
        <ul className="ck-roster__legend">
          {ORDER.map((status) => (
            <li key={status} data-status={status}>
              <span className="ck-roster__dot" aria-hidden /> {t(LEGEND[status])} <b>{counts[status]}</b>
            </li>
          ))}
        </ul>
        <Button type="button" size="lg" className="ck-roster__next" onClick={props.onNext}>
          {t("ck.listNext")} <ArrowRight size={18} aria-hidden />
        </Button>
        {props.nothingLeft ? <p className="af-hint ck-roster__nothing">{t("ck.listNothing")}</p> : null}
      </header>

      <div className="ck-roster__filters" role="group" aria-label={t("ck.listFilterAria")}>
        {(["all", "mine", "unread"] as const).map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {t(key === "all" ? "ck.listAll" : key === "mine" ? "ck.listFilterMine" : "ck.listFilterUnread")}
            {key === "all" ? null : <b>{counts[key]}</b>}
          </button>
        ))}
      </div>

      {props.sections.map((section) => {
        const all = props.rows.filter((row) => row.section === section.ref);
        const here = shown.filter((row) => row.section === section.ref);
        if (!here.length) return null;
        return (
          <section key={section.ref} className="ck-roster__section" aria-label={section.ref}>
            <h3 className="ck-roster__section-title">
              {t("ck.listSection")
                .replace("{ref}", section.ref.replace("-", "–"))
                .replace("{done}", String(all.filter((row) => row.status === "ready").length))
                .replace("{total}", String(all.length))}
            </h3>
            <ul className="ck-roster__rows">
              {here.map((row) => {
                const present = props.presentOn?.(row.itemId) ?? [];
                return (
                  <li key={row.itemId}>
                    <button type="button" className="ck-roster__row" data-status={row.status} onClick={() => props.onOpen(row.itemId)}>
                      <span className="ck-roster__ref">
                        {row.chapter}:{row.verse}
                      </span>
                      <span className="ck-roster__words">{props.labelOf(row.itemId)}</span>
                      <span className="ck-roster__chip" data-status={row.status}>
                        {t(CHIP[row.status])}
                      </span>
                      {row.voices.length || present.length ? (
                        <span className="ck-roster__people" aria-label={[...row.voices, ...present.map((p) => p.login)].join(", ")}>
                          {present.map((person) => (
                            <span key={`now-${person.login}`} className="ck-roster__face" data-now>
                              {initial(person.name || person.login)}
                            </span>
                          ))}
                          {row.voices
                            .filter((login) => !present.some((person) => person.login === login))
                            .map((login) => (
                              <span key={login} className="ck-roster__face">
                                {initial(login)}
                              </span>
                            ))}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
