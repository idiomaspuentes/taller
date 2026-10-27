import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rosterCounts, rosterFilters, searchRoster, type RosterFilter, type RosterRow, type RosterSection, type RosterStatus } from "../domain/chapterRoster";
import { useT, type MessageKey } from "../i18n/messages";
import { door43Person, type Door43Person } from "../dcs/door43People";
import { PersonPhoto } from "./PersonPhoto";

/** Somebody on a help right now, and whether they are writing to the team. */
export type PresentPerson = { login: string; name: string; writing: boolean };

const ORDER: RosterStatus[] = ["ready", "mine", "waiting", "unread"];
const LEGEND: Record<RosterStatus, MessageKey> = { ready: "ck.listReady", mine: "ck.listMine", waiting: "ck.listWaiting", unread: "ck.listUnread" };
const CHIP: Record<RosterStatus, MessageKey> = { ready: "ck.rowReady", mine: "ck.rowMine", waiting: "ck.rowWaiting", unread: "ck.rowUnread" };

/** A face of the list: the person's photo, else their initials, and their name under the pointer. */
function RosterFace(props: { login: string; name: string; now: boolean }) {
  const [person, setPerson] = useState<Door43Person | null>(null);
  useEffect(() => {
    let live = true;
    void door43Person(props.login).then((found) => live && setPerson(found));
    return () => {
      live = false;
    };
  }, [props.login]);
  // The name the project knows is kept over a bare login from Door43.
  const name = person && person.name !== props.login ? person.name : props.name;
  return (
    <span className="ck-roster__face" data-now={props.now || undefined} title={name}>
      <PersonPhoto login={props.login} name={name} avatarUrl={person?.avatarUrl} size="sm" />
    </span>
  );
}

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
  /** A person's name, by their login: shown when the pointer is on their face. */
  nameOf?: (login: string) => string;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<RosterFilter>("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => rosterCounts(props.rows), [props.rows]);
  const filters = rosterFilters(counts);
  // A filter that emptied (the last note of the person's turn answered) goes back to all of them.
  const filter = filters.includes(chosen) ? chosen : "all";
  const shown = searchRoster(
    props.rows.filter((row) => filter === "all" || row.status === filter),
    query,
    props.labelOf,
  );
  const share = Math.round(counts.readyShare * 100);
  const named = (login: string) => props.nameOf?.(login) || login;
  const faces = (voices: string[], present: PresentPerson[]) => [
    ...present.map((person) => ({ login: person.login, name: person.name || named(person.login), now: true })),
    ...voices.filter((login) => !present.some((person) => person.login.toLowerCase() === login)).map((login) => ({ login, name: named(login), now: false })),
  ];

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

      <div className="ck-roster__find">
        {/* The team names a help by its id (27 October): «la jd31». A verse or a few of its words find it too. */}
        <label className="ck-roster__search">
          <Search size={18} aria-hidden />
          <span className="sr-only">{t("ck.listSearchAria")}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("ck.listSearch")} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" />
        </label>
        {filters.length ? (
          <div className="ck-roster__filters" role="group" aria-label={t("ck.listFilterAria")}>
            {filters.map((key) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setChosen(key)}>
                {t(key === "all" ? "ck.listAll" : key === "mine" ? "ck.listFilterMine" : "ck.listFilterUnread")}
                {key === "all" ? null : <b>{counts[key]}</b>}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {query.trim() && !shown.length ? <p className="af-hint ck-roster__none">{t("ck.listSearchNone").replace("{q}", query.trim())}</p> : null}

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
                        {/* The id the team names it by; a verse's own stop is named by its verse. */}
                        {row.itemId.startsWith("verse:") ? null : <small className="ck-roster__id">{row.itemId}</small>}
                      </span>
                      <span className="ck-roster__words">{props.labelOf(row.itemId)}</span>
                      <span className="ck-roster__chip" data-status={row.status}>
                        {t(CHIP[row.status])}
                      </span>
                      {row.voices.length || present.length ? (
                        // Who is on it now first, ringed; then who answered. Each face is their photo, or their initials,
                        // with their name under the pointer (27 October).
                        <span className="ck-roster__people" aria-label={faces(row.voices, present).map((face) => face.name).join(", ")}>
                          {faces(row.voices, present).map((face) => (
                            <RosterFace key={face.login} {...face} />
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
