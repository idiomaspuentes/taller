import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { intakeRepos, listSuggestions, prepareIntake, refuseSuggestion, takeSuggestion, verseNow, type IntakeRepo } from "../dcs/outsideSuggestions";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import { parseReference, type OutsideSuggestion } from "../domain/outsideSuggestion";
import { formatRelativeEs } from "../domain/attention";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { TextChangeView } from "./TextChangeView";
import { Button } from "@/components/ui/button";

type Props = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  onBack: () => void;
  /** Opens the proposal a suggestion became, on the proposal screen. */
  onOpenProposal: (issue: number) => void;
  announce: (msg: string) => void;
};

/** Where a suggestion is read from Door43: the page where anybody opens one with the form. */
const newIssueUrl = (host: string, repo: IntakeRepo) => `${host.replace(/\/+$/, "")}/${repo.owner}/${repo.repo}/issues/new/choose`;

/**
 * The suggestions to the text that came from outside, for whoever coordinates to look at one by one: the verse as
 * the team has it and as suggested, why, and two ways on: to the team, as a proposal like any other, or back to
 * its author with the reason it does not go ahead.
 */
export function SuggestionsView({ session, pmOrg, lang, contentOrg, onBack, onOpenProposal, announce }: Props) {
  const t = useT();
  const [repos, setRepos] = useState<IntakeRepo[] | null>(null);
  const [rows, setRows] = useState<OutsideSuggestion[] | null>(null);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState<string>("");
  const [asking, setAsking] = useState<IntakeRepo | null>(null);
  const place = { session, pmOrg, lang, contentOrg };
  const [copied, setCopied] = useState("");

  // The page where anybody opens a suggestion: to be passed on to whoever uses the texts.
  async function copyLink(repo: IntakeRepo) {
    const url = newIssueUrl(session.host, repo);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(repo.repo);
      window.setTimeout(() => setCopied(""), 2500);
    } catch {
      window.open(url, "_blank", "noreferrer");
    }
  }

  const load = useCallback(async () => {
    setError("");
    try {
      const found = await intakeRepos({ session, pmOrg, lang, contentOrg });
      setRepos(found);
      setRows(await listSuggestions(session, found.filter((repo) => repo.ready)));
    } catch (err) {
      setError(explainError(err));
    }
  }, [session, pmOrg, lang, contentOrg]);

  useEffect(() => {
    void load();
  }, [load]);

  async function prepare(repo: IntakeRepo) {
    setAsking(null);
    setPreparing(repo.repo);
    setError("");
    try {
      await prepareIntake(session, repo);
      announce(t("sg.prepared").replace("{text}", repo.name));
      await load();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setPreparing("");
    }
  }

  return (
    <div className="chat-main pl">
      <header className="chat-header">
        <div className="chat-header__row">
          <button type="button" className="chat-back" onClick={onBack} aria-label={t("sg.backAria")}>
            <ArrowLeft aria-hidden className="size-4" />
            <span className="chat-back__label">{t("td.title")}</span>
          </button>
          <div className="chat-header__name">
            <h1 className="chat-header__title">{t("sg.title")}</h1>
          </div>
        </div>
      </header>
      <div className="pl-body">
        <p className="af-hint">{t("sg.lede")}</p>
        {error ? (
          <p className="pl-error" role="alert">
            {error}
          </p>
        ) : null}
        {repos === null && !error ? <p className="hub-hint">{t("sg.loading")}</p> : null}
        {(repos ?? []).map((repo) =>
          repo.ready ? (
            <div key={repo.repo} className="sg-intake">
              <span>{t("sg.ready").replace("{text}", repo.name)}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyLink(repo)}>
                {copied === repo.repo ? t("sg.copied") : t("sg.copyLink")}
              </Button>
            </div>
          ) : (
            <div key={repo.repo} className="pl-item sg-prepare">
              <p>{t("sg.notReady").replace("{text}", repo.name)}</p>
              {asking?.repo === repo.repo ? (
                <div className="chat-decision__confirm" role="group">
                  <p className="chat-decision__confirm-text">{t("sg.prepareAsk").replace("{repo}", `${repo.owner}/${repo.repo}`)}</p>
                  <div className="sg-actions">
                    <Button type="button" onClick={() => void prepare(repo)}>
                      {t("sg.prepareYes")}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setAsking(null)}>
                      {t("dc.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="outline" disabled={Boolean(preparing)} onClick={() => setAsking(repo)}>
                  {preparing === repo.repo ? t("sg.preparing") : t("sg.prepare").replace("{text}", repo.name)}
                </Button>
              )}
            </div>
          ),
        )}
        {rows && !rows.length ? <p className="hub-hint">{t("sg.none")}</p> : null}
        {(rows ?? []).map((row) => (
          <SuggestionCard key={`${row.repo}#${row.number}`} place={place} suggestion={row} onOpenProposal={onOpenProposal} announce={announce} onDone={() => setRows((prev) => (prev ?? []).filter((other) => other !== row))} />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({
  place,
  suggestion,
  onOpenProposal,
  announce,
  onDone,
}: {
  place: { session: GtSession; pmOrg: string; lang: string; contentOrg: string };
  suggestion: OutsideSuggestion;
  onOpenProposal: (issue: number) => void;
  announce: (msg: string) => void;
  onDone: () => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const at0 = suggestion.ref;
  const [ref, setRef] = useState(at0 ? `${bookLabel(at0.book, "es")} ${at0.chapter}:${at0.verse}` : "");
  const [text, setText] = useState(suggestion.text);
  const at = parseReference(ref);
  const [now, setNow] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [taken, setTaken] = useState<number | null>(null);
  const where = at ? `${at.book}|${at.chapter}|${at.verse}` : "";

  useEffect(() => {
    if (!at) return setNow(null);
    let alive = true;
    setNow(undefined);
    void verseNow(place, suggestion.resource, at)
      .then((found) => alive && setNow(found?.text ?? null))
      .catch(() => alive && setNow(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where]);

  const clean = text.replace(/\s+/g, " ").trim();
  const canTake = Boolean(at && now && clean && clean !== now.replace(/\s+/g, " ").trim());

  async function take() {
    if (!at) return;
    setBusy(true);
    setError("");
    try {
      const number = await takeSuggestion({ ...place, suggestion, at, text: clean });
      setTaken(number);
      announce(t("sg.taken"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function refuse() {
    setBusy(true);
    setError("");
    try {
      await refuseSuggestion(place.session, suggestion, reason);
      announce(t("sg.refused"));
      onDone();
    } catch (err) {
      setError(explainError(err));
      setBusy(false);
    }
  }

  return (
    <section className="pl-item sg-card">
      <h2 className="pl-ref">
        {at ? `${bookLabel(at.book, language)} ${at.chapter}:${at.verse}` : t("sg.noPlace")}
        <span className="pl-tag">{suggestion.resource.toUpperCase()}</span>
      </h2>
      <p className="sg-meta">
        {t("sg.from").replace("{who}", suggestion.by).replace("{when}", formatRelativeEs(suggestion.at, new Date(), language))}{" "}
        <a className="chat-link" href={suggestion.url} target="_blank" rel="noreferrer">
          {t("sg.openDoor43")}
        </a>
      </p>
      {taken ? (
        <div className="pl-finish">
          <p>{t("sg.takenLede")}</p>
          <Button type="button" onClick={() => onOpenProposal(taken)}>
            {t("sg.openProposal")}
          </Button>
        </div>
      ) : (
        <>
          {now === undefined && at ? <p className="hub-hint">{t("vc.loading")}</p> : null}
          {now && clean ? <TextChangeView before={now} after={clean} /> : null}
          {now === null && at ? <p className="af-hint">{t("sg.noVerse")}</p> : null}
          {suggestion.why ? (
            <>
              <h3 className="pl-why">{t("sg.why")}</h3>
              <div className="pl-note">
                <HelpMarkdownView content={suggestion.why} />
              </div>
            </>
          ) : null}
          {/* What the form did not make clear, or was written by hand, is put right before it goes to the team. */}
          <details className="pl-compare" open={!suggestion.ref || !suggestion.text}>
            <summary>{t("sg.fix")}</summary>
            <label className="af-lbl" htmlFor={`sg-ref-${suggestion.number}`}>
              {t("sg.refLabel")}
            </label>
            <input id={`sg-ref-${suggestion.number}`} className="af-input" value={ref} placeholder="Esdras 3:3" onChange={(event) => setRef(event.target.value)} />
            <label className="af-lbl" htmlFor={`sg-text-${suggestion.number}`}>
              {t("sg.textLabel")}
            </label>
            <textarea id={`sg-text-${suggestion.number}`} className="af-textarea" rows={4} value={text} onChange={(event) => setText(event.target.value)} />
          </details>
          {error ? (
            <p className="pl-error" role="alert">
              {error}
            </p>
          ) : null}
          {refusing ? (
            <div className="chat-decision__confirm chat-decision__write" role="group">
              <label className="chat-decision__confirm-text" htmlFor={`sg-why-${suggestion.number}`}>
                {t("sg.refuseLabel")}
              </label>
              <textarea id={`sg-why-${suggestion.number}`} className="af-textarea" rows={3} value={reason} autoFocus onChange={(event) => setReason(event.target.value)} />
              <div className="sg-actions">
                <Button type="button" disabled={busy || !reason.trim()} onClick={() => void refuse()}>
                  {t("sg.refuseSend")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setRefusing(false)}>
                  {t("dc.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="sg-actions">
              <Button type="button" disabled={busy || !canTake} onClick={() => void take()}>
                {busy ? t("sg.taking") : t("sg.take")}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setRefusing(true)}>
                {t("sg.refuse")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
