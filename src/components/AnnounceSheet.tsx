import { useEffect, useMemo, useState } from "react";
import type { DcsTeam } from "@ip-lms/dcs-client";
import { Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { GtSession } from "../dcs/auth";
import { listPmOrgTeamMembers } from "../dcs/persist";
import { explainError } from "../dcs/userError";
import type { Person } from "../domain/types";
import { useT } from "../i18n/messages";
import { ANNOUNCE_TEXT, announceTo, type AnnounceResult } from "../push";

type Props = {
  open: boolean;
  onClose: () => void;
  session: GtSession;
  pmOrg: string;
  /** The teams the app works with, and how each is called on screen. */
  teams: DcsTeam[];
  teamName: (name: string) => string;
  /** Everybody in the organization. */
  people: Person[];
  announce: (msg: string) => void;
};

/**
 * A message of whoever administers the organization to the people or teams they choose, as a notice on their
 * devices (19 October). It reaches whoever turned the notices on; who has not is said after sending, by name.
 */
export function AnnounceSheet({ open, onClose, session, pmOrg, teams, teamName, people, announce }: Props) {
  const t = useT();
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  /** The logins of each team, read as the sheet opens. */
  const [teamPeople, setTeamPeople] = useState<Record<number, string[]>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnnounceResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError("");
    let alive = true;
    void Promise.all(teams.map(async (team) => [team.id, (await listPmOrgTeamMembers(session, team.id).catch(() => [] as Person[])).map((p) => p.id.toLowerCase())] as const)).then(
      (rows) => alive && setTeamPeople(Object.fromEntries(rows)),
    );
    return () => {
      alive = false;
    };
  }, [open, teams, session]);

  const everybody = useMemo(() => people.map((p) => p.id.toLowerCase()), [people]);
  const all = (logins: string[]) => logins.length > 0 && logins.every((login) => chosen.has(login));
  const toggle = (logins: string[]) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (all(logins)) for (const login of logins) next.delete(login);
      else for (const login of logins) next.add(login);
      return next;
    });

  async function send() {
    setSending(true);
    setError("");
    try {
      const done = await announceTo(session, pmOrg, [...chosen], text);
      setResult(done);
      announce(t("ann.sent").replace("{n}", String(done.reached.length)));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSending(false);
    }
  }

  const nameOf = (login: string) => people.find((p) => p.id.toLowerCase() === login)?.name || login;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="fix-sheet ann-sheet" aria-describedby={undefined}>
        <header className="fx-head">
          <DialogTitle className="fx-title">{t("ann.title")}</DialogTitle>
        </header>
        <div className="fx-body ann">
          {result ? (
            // What happened, by name: who got it, and who has the notices off and should be told another way.
            <div className="ann-result" role="status">
              <p className="ann-result__lead">
                <Check size={18} aria-hidden /> {t(result.reached.length === 1 ? "ann.reachedOne" : "ann.reachedMany").replace("{n}", String(result.reached.length))}
              </p>
              {result.unreached.length ? (
                <p className="ann-hint">
                  {t("ann.unreached")} {result.unreached.map((login) => `@${login}`).join(", ")}
                </p>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose}>
                {t("ann.close")}
              </Button>
            </div>
          ) : (
            <>
              <section className="ann-group">
                <label htmlFor="ann-text" className="ann-label">
                  {t("ann.message")}
                </label>
                <textarea id="ann-text" className="af-textarea ann-text" rows={4} maxLength={ANNOUNCE_TEXT} value={text} placeholder={t("ann.placeholder")} onChange={(e) => setText(e.target.value)} />
                <p className="ann-hint">
                  {t("ann.count").replace("{n}", String(text.length)).replace("{max}", String(ANNOUNCE_TEXT))} · {t("ann.how")}
                </p>
              </section>

              <section className="ann-group">
                <p className="ann-label">{t("ann.teams")}</p>
                <div className="ann-chips">
                  <button type="button" className="ann-chip" aria-pressed={all(everybody)} onClick={() => toggle(everybody)}>
                    {t("ann.everybody")} <span className="ann-chip__n">{everybody.length}</span>
                  </button>
                  {teams.map((team) => {
                    const logins = teamPeople[team.id] ?? [];
                    return (
                      <button key={team.id} type="button" className="ann-chip" aria-pressed={all(logins)} disabled={!logins.length} onClick={() => toggle(logins)}>
                        {teamName(team.name)} <span className="ann-chip__n">{logins.length}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="ann-group">
                <p className="ann-label">{t("ann.people")}</p>
                <ul className="ann-people">
                  {people.map((person) => {
                    const login = person.id.toLowerCase();
                    return (
                      <li key={login}>
                        <label className="ann-person">
                          <input type="checkbox" checked={chosen.has(login)} onChange={() => toggle([login])} />
                          <span>{person.name || person.id}</span>
                          {person.name && person.name !== person.id ? <span className="ann-person__login">@{person.id}</span> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {error ? <p className="ann-error" role="alert">{error}</p> : null}
            </>
          )}
        </div>
        {result ? null : (
          <footer className="fx-foot ann-foot">
            <Button type="button" size="lg" disabled={sending || !text.trim() || !chosen.size} onClick={() => void send()}>
              <Send size={16} aria-hidden /> {sending ? t("ann.sending") : !chosen.size ? t("ann.pickFirst") : chosen.size === 1 ? t("ann.sendOne").replace("{who}", nameOf([...chosen][0]!)) : t("ann.sendMany").replace("{n}", String(chosen.size))}
            </Button>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
