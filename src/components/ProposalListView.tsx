import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { finishProposalList, loadDecisionThread, loadProposalList, type ProposalListData } from "../dcs/proposalList";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import type { ChatEvent } from "../domain/chatEvent";
import { alineacionDecisionData, editsText } from "../domain/chatEvents/alineacionDecision";
import { decisionStatuses, resolveChatEvent } from "../domain/chatEvents/registry";
import type { ThreadItem } from "../domain/conversation";
import { issueProjectId } from "../domain/myTasks";
import { ownTitleOf } from "../domain/myTasksBoard";
import { decisionPlace, firstToRead } from "../domain/proposalList";
import { routeToHash } from "../router";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT } from "../i18n/messages";
import { DecisionCard } from "./DecisionCard";
import { TextChangeView } from "./TextChangeView";
import { VerseCompare } from "./VerseCompare";
import { buildSolverLaunchContext } from "../domain/solverLaunch";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { Button } from "@/components/ui/button";

type Props = {
  session: GtSession | null;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  /** The subtarea that lists the proposals. */
  issueNumber: number;
  /** The proposal to open on (its decision's number), when coming back from its conversation. */
  at?: number;
  canManage: boolean;
  onBack: () => void;
  /** Opens the whole conversation of one proposal. */
  onOpenThread: (issue: number) => void;
  announce: (msg: string) => void;
};

const isClosed = (issue: { state?: string | null }) => (issue.state ?? "").toLowerCase() === "closed";

/**
 * A list of proposals to the text, read one at a time: the verse with what would change in it, why, and the votes
 * of the team, with the buttons of its decision. Whoever goes through it votes on each and goes on to the next; the
 * whole conversation of each one is a tap away. When every proposal is decided, the correction is finished here.
 */
export function ProposalListView({ session, pmOrg, lang, contentOrg, issueNumber, at, canManage, onBack, onOpenThread, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [data, setData] = useState<ProposalListData | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [thread, setThread] = useState<{ issue: number; items: ThreadItem[] } | null>(null);
  const [threadError, setThreadError] = useState("");
  const [finishing, setFinishing] = useState(false);
  // Open or not, as the person left it: whoever compares, compares every proposal.
  const [compareOpen, setCompareOpen] = useState(false);

  const loadList = useCallback(async () => {
    if (!session) return null;
    const next = await loadProposalList({ session, pmOrg, lang, contentOrg, issueNumber });
    setData(next);
    return next;
  }, [session, pmOrg, lang, contentOrg, issueNumber]);

  useEffect(() => {
    let alive = true;
    setError("");
    void loadList()
      .then((next) => {
        if (!alive || !next) return;
        const asked = at ? next.proposals.findIndex((row) => row.number === at) : -1;
        setIndex(asked >= 0 ? asked : firstToRead(next.proposals, () => false));
      })
      .catch((err) => alive && setError(explainError(err)));
    return () => {
      alive = false;
    };
  }, [loadList, at]);

  const rows = data?.proposals ?? [];
  const current = rows[index];

  const loadThread = useCallback(async () => {
    if (!session || !current) return;
    setThreadError("");
    try {
      setThread({ issue: current.number, items: await loadDecisionThread(session, pmOrg, current.number) });
    } catch (err) {
      setThreadError(t("pl.threadFailed").replace("{why}", explainError(err)));
    }
  }, [session, pmOrg, current, t]);

  useEffect(() => {
    setThread(null);
    void loadThread();
    // The place in the list is kept in the address, so the conversation of a proposal comes back to it.
    if (current) window.history.replaceState(null, "", routeToHash({ name: "propuestas", issue: issueNumber, at: current.number }));
    // «Siguiente» is pressed at the foot of the one before: the next one is read from its verse.
    document.querySelector(".pl")?.scrollIntoView({ block: "start" });
  }, [current?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  // The decision as it stands: the last wording of the proposal, and whether it was closed.
  const decision = useMemo(() => {
    if (!thread || thread.issue !== current?.number) return null;
    const statuses = decisionStatuses(thread.items);
    const cards = thread.items.filter((item) => item.event && resolveChatEvent(item.event).render === "decision" && alineacionDecisionData(item.event));
    const item = [...cards].reverse().find((row) => !statuses.get(row.key)?.superseded) ?? cards.at(-1);
    if (!item?.event) return null;
    return { item, status: statuses.get(item.key), data: alineacionDecisionData(item.event)!, resolved: resolveChatEvent(item.event) };
  }, [thread, current?.number]);

  const projectId = data ? issueProjectId(data.card) : "";
  const launchCtx = useMemo(
    () => (data && session ? buildSolverLaunchContext({ username: session.username, lang, pmOrg, contentOrg, board: data.board, issue: data.card }) : null),
    [data, session, lang, pmOrg, contentOrg],
  );
  const env = useMemo(() => ({ session, pmOrg, issueNumber: current?.number ?? 0, lang, projectId, contentOrg }), [session, pmOrg, current?.number, lang, projectId, contentOrg]);
  const viewer = useMemo(() => ({ username: session?.username ?? "", canManage, assignees: [] as string[] }), [session?.username, canManage]);

  const run = useCallback(
    async (optionId: string, event: ChatEvent, input?: string) => {
      const definition = resolveChatEvent(event).definition;
      if (!definition?.run) return;
      await definition.run(optionId, event, { ...env, remainingDecisions: [], ...(input !== undefined ? { input } : {}) });
      await loadThread();
      // Closing it changes what is left of the list.
      if (optionId === "confirmar") await loadList().catch(() => undefined);
      announce(tNow("cv.decisionSaved"));
    },
    [env, loadThread, loadList, announce],
  );

  async function finish() {
    if (!session || !data) return;
    setFinishing(true);
    setError("");
    try {
      await finishProposalList({ session, pmOrg, card: data.card, board: data.board });
      announce(t("pl.finished"));
      onBack();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setFinishing(false);
    }
  }

  const left = rows.filter((row) => !isClosed(row)).length;
  const single = Boolean(data?.single);
  const changesText = decision ? editsText(decision.data) : false;
  const place = current ? decisionPlace(current) : undefined;
  const book = data ? bookLabel((data.board.books?.[0] || data.board.book || projectId).toUpperCase(), language) : "";
  const chapter = place?.chapter ?? (rows[0] ? decisionPlace(rows[0])?.chapter : undefined);
  const go = (to: number) => setIndex(Math.max(0, Math.min(rows.length - 1, to)));

  return (
    <div className="chat-main pl">
      <header className="chat-header">
        <div className="chat-header__row">
          <button type="button" className="chat-back" onClick={onBack} aria-label={t("cv.backToMy")}>
            <ArrowLeft aria-hidden className="size-4" />
            <span className="chat-back__label">{t("nav.myTasks")}</span>
          </button>
          <div className="chat-header__name">
            <h1 className="chat-header__title">{[t(single ? "pl.titleOne" : "pl.title"), [book, chapter].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</h1>
            {data ? <p className="chat-header__sub">{ownTitleOf(data.card) || data.card.title}</p> : null}
          </div>
        </div>
      </header>
      <div className="pl-body">
        {error ? (
          <p className="pl-error" role="alert">
            {error}
          </p>
        ) : null}
        {!data && !error ? <p className="hub-hint">{t("pl.loading")}</p> : null}
        {data && !rows.length ? <p className="hub-hint">{t("pl.none")}</p> : null}
        {data && current ? (
          <>
            {single ? null : (
              <p className="pl-count" role="status">
                <span>{t("pl.position").replace("{n}", String(index + 1)).replace("{total}", String(rows.length))}</span>
                <span className="pl-count__left">{left ? t(left === 1 ? "pl.leftOne" : "pl.left").replace("{n}", String(left)) : t("pl.allDecided")}</span>
              </p>
            )}
            {isClosed(data.card) ? (single ? null : <p className="af-hint">{t("pl.done")}</p>) : <p className="af-hint">{t("pl.howTo")}</p>}
            <section className="pl-item" aria-labelledby="pl-ref">
              <h2 id="pl-ref" className="pl-ref">
                {place ? `${book} ${place.chapter}:${place.verse}` : current.title}
                {isClosed(current) ? <span className="pl-tag">{t("pl.decided")}</span> : null}
              </h2>
              {threadError ? (
                <p className="pl-error" role="alert">
                  {threadError}
                </p>
              ) : null}
              {!decision && !threadError && !thread ? <p className="hub-hint">{t("pl.loading")}</p> : null}
              {!decision && thread ? (
                // Not a proposal this screen knows how to show: its conversation does.
                <button type="button" className="chat-link pl-thread" onClick={() => onOpenThread(current.number)}>
                  {t("pl.thread")}
                </button>
              ) : null}
              {decision ? (
                <>
                  {changesText ? (
                    <>
                      <p className="af-lbl">{t("pl.verse")}</p>
                      <div className="pl-verse">
                        <TextChangeView before={decision.data.oldText} after={decision.data.newText} />
                      </div>
                    </>
                  ) : null}
                  {session && launchCtx && place ? (
                    <details className="pl-compare" open={compareOpen} onToggle={(event) => setCompareOpen(event.currentTarget.open)}>
                      <summary>{t("vc.title")}</summary>
                      {compareOpen ? <VerseCompare session={session} ctx={launchCtx} board={data.board} chapter={place.chapter} verse={place.verse} /> : null}
                    </details>
                  ) : null}
                  <p className="af-lbl">{t("pl.why").replace("{who}", decision.data.by)}</p>
                  <div className="pl-note">
                    {/* Each line of a proposal is its own: what changes, its cause, why. */}
                    <HelpMarkdownView content={decision.data.note.replace(/\n/g, "\n\n")} />
                  </div>
                  <DecisionCard
                    key={decision.item.key}
                    item={decision.item}
                    resolved={decision.resolved}
                    time=""
                    status={decision.status}
                    viewer={viewer}
                    env={env}
                    onRun={session ? run : undefined}
                    // A decision about the alignment alone is read in its own panels, its boxes.
                    hidePanels={changesText}
                  />
                  <button type="button" className="chat-link pl-thread" onClick={() => onOpenThread(current.number)}>
                    {t("pl.thread")}
                  </button>
                </>
              ) : null}
            </section>
            {single ? null : (
            <nav className="pl-nav" aria-label={t("pl.position").replace("{n}", String(index + 1)).replace("{total}", String(rows.length))}>
              <Button type="button" variant="outline" disabled={index === 0} onClick={() => go(index - 1)}>
                <ChevronLeft aria-hidden className="size-4" />
                {t("pl.prev")}
              </Button>
              <Button type="button" variant="outline" disabled={index >= rows.length - 1} onClick={() => go(index + 1)}>
                {t("pl.next")}
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </nav>
            )}
            {!single && !left && !isClosed(data.card) ? (
              <div className="pl-finish">
                <p>{t("pl.finishLede")}</p>
                <Button type="button" disabled={finishing} onClick={() => void finish()}>
                  {finishing ? t("pl.finishing") : t("pl.finish")}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
