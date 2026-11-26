import { ToolHeader } from "./ToolHeader";
import { StepAsk } from "./StepAsk";
import { ParallelLink } from "./ParallelSheet";
import { tallerConfig, workspaceOfOrg } from "../config";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Clock3 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { appendMyDecisions } from "../dcs/afinacionStore";
import { openTextProposal } from "../dcs/alignmentDecisionStore";
import type { CorrectionReason } from "../domain/correctionLog";
import { CorrectionReasons, reasonLine } from "./CorrectionReasons";
import { loadSession, type GtSession } from "../dcs/auth";
import { door43Person, type Door43Person } from "../dcs/door43People";
import { loadGroupReading, type GroupReadingData, type GroupReadingText } from "../dcs/groupReading";
import { commentOnIssue } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { useOpenWindow, useSayUntil } from "../useOpenWindow";
import { useStepWork } from "../dcs/stepWork";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import {
  openDoubts,
  passageAgreement,
  passageAgreers,
  passageBlocker,
  readingItemId,
  readingPassages,
  readingProgress,
  verseConversation,
  type ReadingPassage,
} from "../domain/groupReading";
import { latestOf } from "../domain/openWindow";
import { confirmersOf, levelsForTeam } from "../domain/levels";
import { localized } from "../domain/processes";
import { samePiece } from "../domain/reviewProposals";
import { tallyItem, textFingerprint, type ItemTally, type ReviewDecision } from "../domain/reviewRound";
import { decodeSolverLaunchContext } from "../domain/solverLaunch";
import { localizeName } from "../domain/templateNames";
import { heldByLaterPhase } from "../dcs/redoAfterCorrection";
import { localizeThread } from "../domain/threadNames";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT } from "../i18n/messages";
import { ConfirmDialog } from "./ConfirmDialog";
import { PersonPhoto } from "./PersonPhoto";
import { ReasonField } from "./ReasonField";
import { LoadingState } from "./LoadingState";
import { ReadingGuide } from "./screenGuides";

type Props = {
  ctxEncoded: string;
  onClose: () => void;
  announce: (msg: string) => void;
};

/**
 * What is being written under one verse: an answer to somebody's doubt, a doubt or comment of one's own, or other
 * words for it. Kept by the screen, so a verse closed and opened again still has it, and stays open while it has it.
 */
type Draft = { kind: "reply" | "doubt" | "fix"; text: string; why: string; reasons: CorrectionReason[] };

/** How many faces are shown in a row before «+3». */
const FACES = 5;

/**
 * The group reading of a deliverable. The team reads together everything translated of the stretch, on the group's
 * draft, one text at a time: each passage as running text, as soon as it arrives. Touching a verse opens what goes
 * with it (its source, what the team said about it, who agrees); there one answers a doubt or says «No del todo…».
 * At the end of each passage, «Estoy de acuerdo con este pasaje» agrees with every verse of it one has not answered,
 * except those with a doubt still open, which are answered in their verse. When everything arrived and is agreed,
 * the reading is closed. Nothing of how it is kept changed: each answer is still one decision per verse and text.
 */
export function GroupReadingView({ ctxEncoded, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const ctx = useMemo(() => decodeSolverLaunchContext(ctxEncoded), [ctxEncoded]);
  const [data, setData] = useState<GroupReadingData | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  /** The other English text, shown as a support only when it is asked for (as in the editor and in the review). */
  const [support, setSupport] = useState(false);
  /** The text being read, when the reading has more than one. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** The verse open (`resource:verse`): one at a time, except those with words written under them. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => new Map());
  /** Verses where «No del todo…» shows its two ways. */
  const [choosing, setChoosing] = useState<ReadonlySet<string>>(() => new Set());
  /** Verses whose whole conversation was asked for. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  /** The verses that were on the screen at some moment in this visit: the end of a passage counts as read. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  /** The passage whose «Estoy de acuerdo» was touched before its end was read: it asks. */
  const [agreeAsk, setAgreeAsk] = useState<number | null>(null);
  /** The passage whose «No del todo…» asks which verse. */
  const [whichFor, setWhichFor] = useState<number | null>(null);
  const [names, setNames] = useState<Record<string, Door43Person>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stepDone, setStepDone] = useState(false);
  const [error, setError] = useState("");
  const pane = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return void setError(tNow("se.badContext"));
    if (!session?.token) return void setError(tNow("pr.needSession"));
    if (!ctx.chapter) return void setError(tNow("gr.noChapter"));
    setBusy(true);
    setError("");
    try {
      const loaded = await loadGroupReading(session, ctx);
      setData(loaded);
      setDecisions(loaded.decisions);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctx, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const step = data?.task?.steps?.find((row) => row.id === ctx?.stepId) ?? data?.task?.steps?.[0];
  useEffect(() => {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !step) return;
    let cancelled = false;
    void stepIsDone({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: step.id })
      .then((done) => !cancelled && setStepDone(done))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session, ctx?.pmOrg, ctx?.issueNumber, step?.id]);

  const me = (session?.username ?? "").toLowerCase();
  const isMe = (login: string) => login.trim().toLowerCase() === me;
  const minAgree = step?.minAssignees ?? 2;
  const minIndependent = step?.minIndependent ?? 1;
  const teamLevels = useMemo(() => levelsForTeam(data?.levelBook, data?.teamName), [data?.levelBook, data?.teamName]);
  const confirmers = useMemo(() => confirmersOf(data?.levelBook, data?.teamName), [data?.levelBook, data?.teamName]);

  const { open: openWin, wakeAt } = useOpenWindow({ session, pmOrg: ctx?.pmOrg, issueNumber: ctx?.issueNumber, step, closed: stepDone });
  const sayUntil = useSayUntil();
  const passages = useMemo<ReadingPassage[]>(() => (data ? readingPassages(data.passages, data.texts) : []), [data]);
  const tallies = useMemo(() => {
    const map = new Map<string, ItemTally>();
    if (!data) return map;
    for (const text of data.texts) {
      for (const [verse, body] of Object.entries(text.verses)) {
        if (!body?.trim()) continue;
        const itemId = readingItemId(text.resource, data.chapter, Number(verse));
        map.set(itemId, tallyItem({ itemId, decisions, currentHash: textFingerprint(body), levels: teamLevels, authors: data.authorsByItem[itemId] ?? [], thresholds: { minAgree, minIndependent }, confirmers, open: openWin }));
      }
    }
    return map;
  }, [data, decisions, teamLevels, confirmers, minAgree, minIndependent, openWin]);
  const progress = useMemo(() => (data ? readingProgress(passages, data.texts, data.chapter, tallies) : null), [data, passages, tallies]);
  useEffect(() => wakeAt([...tallies.values()].map((point) => point.openUntil)), [tallies, wakeAt]);
  // Counted against the whole chapter: the verses of a passage still being translated are yet to be read.
  const toRead = Math.max(progress?.items ?? 0, passages.reduce((sum, passage) => sum + passage.verses.length, 0) * (data?.texts.length ?? 0));
  useStepWork(session, ctx, progress?.agreed ?? 0, toRead, { stepId: step?.id, on: !stepDone && !saving });

  /** Per text and passage: what agreeing with it would save, and what stays for me. */
  const mineLeft = useMemo(() => {
    const map = new Map<string, ReturnType<typeof passageAgreement>>();
    if (!data) return map;
    for (const text of data.texts) for (const passage of passages) map.set(`${text.resource}:${passage.from}`, passageAgreement(passage, text, data.chapter, tallies, me));
    return map;
  }, [data, passages, tallies, me]);
  const leftOf = (resource: string, passage: ReadingPassage) => mineLeft.get(`${resource}:${passage.from}`) ?? { verses: [], othersDoubt: [], myDoubt: [], changed: [] };
  const hasTodo = (resource: string) => passages.some((passage) => leftOf(resource, passage).verses.length > 0 || leftOf(resource, passage).othersDoubt.length > 0);

  // It opens on the first text with something to do for whoever comes in.
  useEffect(() => {
    if (!data || chosen) return;
    setChosen((data.texts.find((text) => hasTodo(text.resource)) ?? data.texts[0])?.resource ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mineLeft, chosen]);
  const text = data?.texts.find((row) => row.resource === chosen) ?? data?.texts[0];

  const keyOf = (resource: string, verse: number) => `${resource}:${verse}`;
  const refOf = (verse: number) => `${data?.chapter ?? 0}:${verse}`;
  const placeOf = (passage: ReadingPassage) => `${data?.chapter ?? 0}:${passage.from}${passage.to > passage.from ? `–${passage.to}` : ""}`;
  /** The verses of a passage there is something to read in, in this text: one left empty (joined to its neighbour) is not. */
  const withText = (row: GroupReadingText | undefined, passage: ReadingPassage) => (row && passage.arrived[row.resource] ? passage.verses.filter((verse) => row.verses[verse]?.trim()) : []);

  // What was on the screen, at some moment, inside the part that scrolls (not the window): the end of a passage counts as read.
  useEffect(() => {
    const root = pane.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(
      (entries) => {
        const places = entries.filter((entry) => entry.isIntersecting).map((entry) => (entry.target as HTMLElement).dataset.place).filter((place): place is string => Boolean(place));
        if (places.length) setSeen((prev) => (places.every((place) => prev.has(place)) ? prev : new Set([...prev, ...places])));
      },
      { root },
    );
    root.querySelectorAll<HTMLElement>("[data-piece][data-place]").forEach((element) => watch.observe(element));
    return () => watch.disconnect();
  }, [data, chosen, openKey, busy]);

  // The names and faces of whoever speaks or agrees, read once each.
  const people = useMemo(() => {
    const found = new Set<string>();
    for (const tally of tallies.values()) for (const row of [...tally.answers, ...tally.stale]) found.add(row.reviewer.trim());
    for (const row of decisions) if (row.note?.trim()) found.add(row.reviewer.trim());
    return [...found].filter(Boolean).sort().join("|");
  }, [tallies, decisions]);
  useEffect(() => {
    let live = true;
    for (const login of people ? people.split("|") : []) void door43Person(login).then((found) => live && setNames((prev) => (prev[login.toLowerCase()] ? prev : { ...prev, [login.toLowerCase()]: found })));
    return () => {
      live = false;
    };
  }, [people]);
  const nameOf = (login: string) => {
    const found = names[login.trim().toLowerCase()];
    return found?.name && found.name !== login ? found.name : `@${login}`;
  };

  function decision(row: GroupReadingText, verse: number, status: "approved" | "revise", note?: string): ReviewDecision {
    return {
      itemId: readingItemId(row.resource, data!.chapter, verse),
      ref: { start: { chapter: data!.chapter, verse } },
      sessionId: String(ctx!.issueNumber || ctx!.taskId),
      stageId: step?.id ?? "lectura",
      status,
      reviewer: session!.username,
      timestamp: new Date().toISOString(),
      ...(note ? { note } : {}),
      textHash: textFingerprint(row.verses[verse] ?? ""),
    };
  }

  const dropDraft = (key: string) => {
    setDrafts((now) => {
      if (!now.has(key)) return now;
      const next = new Map(now);
      next.delete(key);
      return next;
    });
    setChoosing((now) => {
      if (!now.has(key)) return now;
      const next = new Set(now);
      next.delete(key);
      return next;
    });
  };

  /** Answers, saved text by text (each text keeps its own in its repository). */
  async function answer(rows: { text: GroupReadingText; verse: number; status: "approved" | "revise"; note?: string }[], said: string): Promise<boolean> {
    if (!session || !data || !ctx || !rows.length) return false;
    setSaving(true);
    setError("");
    try {
      const made: ReviewDecision[] = [];
      for (const row of data.texts) {
        const mine = rows.filter((one) => one.text.resource === row.resource && row.draft).map((one) => decision(row, one.verse, one.status, one.note));
        if (!mine.length || !row.draft) continue;
        await appendMyDecisions(session, row.draft, data.book, mine);
        made.push(...mine);
      }
      setDecisions((prev) => [...prev, ...made]);
      for (const row of rows) dropDraft(keyOf(row.text.resource, row.verse));
      announce(said);
      return true;
    } catch (err) {
      setError(explainError(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * Agreeing with a verse somebody has a doubt about, saying why it is right as it is: the answer to the doubt. The
   * reason is kept with the agreement, shown in the verse's conversation, and sent to whoever asked.
   */
  async function reply(row: GroupReadingText, verse: number, why: string, askers: string[]) {
    const saved = await answer([{ text: row, verse, status: "approved", note: why.trim() }], t("gr.replied"));
    if (!saved || !session || !data || !ctx?.pmOrg || !ctx.issueNumber || !askers.length) return;
    const said = tNow("gr.repliedNote").replace("{ref}", `${data.book} ${data.chapter}:${verse}`).replace("{text}", row.name).replace("{why}", why.trim());
    await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, `${askers.map((login) => `@${login}`).join(" ")} ${said}`).catch(() => undefined);
  }

  /**
   * Another wording for a verse is proposed, not written: it reaches the draft when the team agrees to it. Until the
   * team decides, the person's answer to the verse is a doubt, with what they propose.
   */
  async function propose(row: GroupReadingText, verse: number, draft: Draft) {
    if (!session || !data || !ctx || !row.draft) return;
    const next = draft.text.trim();
    if (!next) return;
    setSaving(true);
    setError("");
    try {
      const why = reasonLine(draft.reasons, draft.why, tNow) || tNow("fx.proposalNote");
      const resource: "tpl" | "tps" = row.resource === "tps" ? "tps" : "tpl";
      // A text a later phase already has in its hands is not proposed to be changed from this one: it is said there.
      const held = await heldByLaterPhase({ session, pmOrg: ctx.pmOrg, lang: ctx.lang, projectId: ctx.projectId, contentOrg: ctx.contentOrg, fromTaskId: ctx.taskId, resource, chapter: data.chapter, verse });
      if (held) throw new Error(tNow("redo.heldBy").replace("{ref}", `${data.chapter}:${verse}`).replace("{phase}", localizeName(held, language)));
      const opened = await openTextProposal({
        session,
        pmOrg: ctx.pmOrg,
        task: { projectId: ctx.projectId, taskId: ctx.taskId, taskName: ctx.taskName || ctx.taskId, resource, parentIssue: ctx.issueNumber },
        target: row.draft,
        draftFilepath: row.draft.filepath,
        book: data.book,
        chapter: data.chapter,
        verse,
        oldText: row.verses[verse] ?? "",
        newText: next,
        note: why,
        tell: Object.keys(teamLevels),
        thresholds: { minAgree, minIndependent },
      });
      const own = decision(row, verse, "revise", tNow("gr.proposedNote").replace("{n}", String(opened.issue.number)).replace("{text}", next));
      await appendMyDecisions(session, row.draft, data.book, [own]);
      setDecisions((prev) => [...prev, own]);
      dropDraft(keyOf(row.resource, verse));
      announce(t("gr.proposed").replace("{ref}", `${data.chapter}:${verse}`).replace("{n}", String(opened.issue.number)));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !step) return;
    setSaving(true);
    setError("");
    try {
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: step.id });
      setStepDone(true);
      announce(t("gr.closed"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /** Takes the reader to a verse and opens it; `choose`: with «No del todo…» already showing its two ways. */
  const goTo = (resource: string, verse: number, choose = false) => {
    const key = keyOf(resource, verse);
    setChosen(resource);
    setOpenKey(key);
    if (choose) setChoosing((now) => new Set(now).add(key));
    window.setTimeout(() => pane.current?.querySelector<HTMLElement>(`[data-place="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "start" }), 50);
  };

  /** «1:2, 1:3 y 1:7», each place a link to its verse. */
  const refLinks = (resource: string, verses: number[]) =>
    verses.map((verse, at) => (
      <Fragment key={verse}>
        {at === 0 ? "" : at === verses.length - 1 ? t("gr.and") : ", "}
        <button type="button" className="gr-link" onClick={() => goTo(resource, verse)}>
          {refOf(verse)}
        </button>
      </Fragment>
    ));
  /** A sentence with `{refs}` in it, the places as links. */
  const withRefs = (said: string, resource: string, verses: number[]) => {
    const [before, after = ""] = said.split("{refs}");
    return (
      <>
        {before}
        {refLinks(resource, verses)}
        {after}
      </>
    );
  };

  const faces = (logins: string[]) => {
    if (!logins.length) return null;
    const shown = logins.slice(0, FACES);
    const said = logins.map(nameOf).join(", ");
    return (
      <div className="gr-faces">
        <span className="gr-faces__row" role="img" aria-label={said}>
          {shown.map((login) => (
            <PersonPhoto key={login} login={login} name={names[login.toLowerCase()]?.name} avatarUrl={names[login.toLowerCase()]?.avatarUrl} size="sm" />
          ))}
          {logins.length > FACES ? <span className="gr-faces__more">{t("gr.moreFaces").replace("{n}", String(logins.length - FACES))}</span> : null}
        </span>
        <span className="gr-faces__said">{t(logins.length === 1 ? "gr.agreesOne" : "gr.agreesMany")}</span>
      </div>
    );
  };

  /** Why a passage (or a verse) is not agreed yet, in a line; null when nothing holds it. */
  const blockerLine = (resource: string, blocker: ReturnType<typeof passageBlocker>) =>
    !blocker ? null : blocker.kind === "doubt" ? (
      withRefs(t(blocker.verses.length === 1 ? "gr.blockDoubtOne" : "gr.blockDoubtMany"), resource, blocker.verses)
    ) : blocker.kind === "tc" ? (
      withRefs(t("gr.blockTc"), resource, [blocker.verse])
    ) : (
      t(blocker.kind === "more" ? "gr.blockMore" : "gr.blockIndependent")
    );

  /** What stays for me in a passage after agreeing with it: a doubt to answer, mine still open, a verse that changed. */
  const leftLines = (resource: string, left: ReturnType<typeof passageAgreement>) => {
    if (!data) return [];
    const lines: ReactNode[] = [];
    const stale = (verse: number) => tallies.get(readingItemId(resource, data.chapter, verse))?.stale.find((row) => isMe(row.reviewer));
    const changedDoubt = left.changed.filter((verse) => stale(verse)?.status !== "approved");
    const changedAgree = left.changed.filter((verse) => stale(verse)?.status === "approved");
    if (changedDoubt.length) lines.push(withRefs(t("gr.changedDoubt"), resource, changedDoubt));
    if (changedAgree.length) lines.push(withRefs(t("gr.changedAgree"), resource, changedAgree));
    if (left.othersDoubt.length) lines.push(withRefs(t("gr.leftReply"), resource, left.othersDoubt));
    if (left.myDoubt.length) lines.push(withRefs(t(left.myDoubt.length === 1 ? "gr.leftMineOne" : "gr.leftMineMany"), resource, left.myDoubt));
    return lines;
  };

  const stepName = step ? localized(step.name, step.names, language) : t("gr.title");
  const place = ctx ? `${bookLabel(ctx.book, language)} ${ctx.ref}` : stepName;

  // The first passage I still have to agree with in the text being read: its button is the one filled.
  const firstMine = text ? passages.find((passage) => leftOf(text.resource, passage).verses.length > 0) : undefined;
  const firstPiece = text ? passages.map((passage) => withText(text, passage)[0]).find((verse) => verse !== undefined) : undefined;
  const anyOpen = Boolean(openKey) || [...drafts.keys()].some((key) => key.startsWith(`${text?.resource}:`));

  function piece(row: GroupReadingText, passage: ReadingPassage, verse: number) {
    if (!data) return null;
    const body = row.verses[verse]?.trim() ?? "";
    const id = readingItemId(row.resource, data.chapter, verse);
    const key = keyOf(row.resource, verse);
    const tally = tallies.get(id);
    const hash = textFingerprint(row.verses[verse] ?? "");
    const said = verseConversation(decisions, id, hash);
    const draft = drafts.get(key);
    const written = Boolean(draft && (draft.why.trim() || draft.reasons.length || (draft.kind === "fix" && !samePiece({ text: body }, { text: draft.text }))));
    const isOpen = openKey === key || written;
    const mine = tally?.answers.find((one) => isMe(one.reviewer));
    const myDoubt = mine && mine.status !== "approved" ? mine : undefined;
    const changed = Boolean(tally?.stale.some((one) => isMe(one.reviewer)));
    const askers = (tally?.open ?? []).filter((login) => !isMe(login));
    const dots = { talk: said.length > 0, open: (tally?.open.length ?? 0) > 0, changed };
    const agreers = (tally?.answers ?? []).filter((one) => one.status === "approved").map((one) => one.reviewer);
    const here: ReadingPassage = { ...passage, from: verse, to: verse, verses: [verse] };
    const blocker = tally?.state === "agreed" ? null : passageBlocker(here, row, data.chapter, tallies, minAgree);
    const guideHere = row.resource === text?.resource && verse === firstPiece;

    const toggle = () => setOpenKey(openKey === key ? null : key);
    const setDraft = (next: Draft) => setDrafts((now) => new Map(now).set(key, next));
    const choosingNow = choosing.has(key);
    const choose = (on: boolean) =>
      setChoosing((now) => {
        const next = new Set(now);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      });

    // Own source first: the ULT for the TPL, the UST for the TPS; the other on request.
    const own = data.sources.filter((source) => (row.resource === "tps" ? /ust|gst|tps/i : /ult|glt|tpl/i).test(source.short));
    const others = data.sources.filter((source) => !own.includes(source) && source.verses[verse]);
    const sources = own.length ? (support ? [...own, ...others] : own) : data.sources;

    // The last two said, and «Ver 3 antes» over them.
    const folding = said.length > 2 && !unfolded.has(key);
    const shownSaid = folding ? said.slice(-2) : said;

    const box = !draft ? null : draft.kind === "fix" ? (
      <div className="rv-proposal" data-box-kind="proposal">
        <textarea className="af-textarea" rows={3} autoFocus data-box={key} value={draft.text} aria-label={t("rv.proposalWords")} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <ReasonField rows={2} value={draft.why} session={session} ctx={ctx} chapter={data.chapter} verse={verse} placeholder={t("gr.whyFix")} ariaLabel={t("gr.whyFix")} onChange={(why) => setDraft({ ...draft, why })} />
        <CorrectionReasons value={draft.reasons} onChange={(reasons) => setDraft({ ...draft, reasons })} />
        <div className="rv-composer__row">
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => dropDraft(key)}>
            {t("rv.cancelEdit")}
          </Button>
          {/* Off while the words say what the verse says, or differ only in spaces or quotes. */}
          <Button type="button" size="sm" disabled={saving || !draft.text.trim() || samePiece({ text: body }, { text: draft.text })} onClick={() => void propose(row, verse, draft)}>
            {t("rv.sendProposal")}
          </Button>
        </div>
      </div>
    ) : (
      <div className="rv-composer">
        <ReasonField
          rows={2}
          autoFocus
          value={draft.why}
          session={session}
          ctx={ctx}
          chapter={data.chapter}
          verse={verse}
          placeholder={t(draft.kind === "reply" ? "gr.whyReply" : "gr.whyDoubt")}
          ariaLabel={t(draft.kind === "reply" ? "gr.whyReply" : "gr.whyDoubt")}
          onChange={(why) => setDraft({ ...draft, why })}
        />
        <div className="rv-composer__row">
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => dropDraft(key)}>
            {t("rv.cancelEdit")}
          </Button>
          {draft.kind === "reply" ? (
            <Button type="button" size="sm" disabled={saving || !draft.why.trim()} onClick={() => void reply(row, verse, draft.why, askers)}>
              {t("gr.sendReply")}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={saving || !draft.why.trim() || draft.why.trim() === (myDoubt?.note ?? "").trim()} onClick={() => void answer([{ text: row, verse, status: "revise", note: draft.why.trim() }], t("gr.doubtSaved"))}>
              {t("gr.saveDoubt")}
            </Button>
          )}
        </div>
      </div>
    );

    return (
      <li key={verse} className="rv-item rv-piece gr-piece" data-piece="" data-place={key} data-open={isOpen ? "true" : undefined} data-state={tally?.state}>
        {/* Closed, a verse is its number and its text: touching it opens what goes with it, under. */}
        <button type="button" className="rv-piece__read" aria-expanded={isOpen} data-guide={guideHere ? "gr-piece" : undefined} onClick={toggle}>
          <span className="rv-piece__ref">{verse}</span>
          <span className="rv-piece__text">{body}</span>
          {dots.talk || dots.open || dots.changed ? (
            <span className="rv-dots">
              {dots.talk ? <span className="rv-dot" data-kind="talk" role="img" aria-label={t("rv.dotTalk")} /> : null}
              {dots.open ? <span className="rv-dot" data-kind="open" role="img" aria-label={t("rv.dotOpen")} /> : null}
              {dots.changed ? <span className="rv-dot" data-kind="changed" role="img" aria-label={t("gr.dotChanged")} /> : null}
            </span>
          ) : null}
        </button>
        {isOpen ? (
          <div className="rv-piece__more">
            {sources.some((source) => source.verses[verse]) ? (
              <div className="rv-sources-box">
                <dl className="rv-sources">
                  {sources.map((source) =>
                    source.verses[verse] ? (
                      <div key={source.short} data-support={(own.length > 0 && !own.includes(source)) || undefined}>
                        <dt>{source.short}</dt>
                        <dd>{source.verses[verse]}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
                {own.length && others.length ? (
                  <button type="button" className="se-peek__more" aria-pressed={support} onClick={() => setSupport(!support)}>
                    {t(support ? "se.supportHide" : "se.supportShow").replace("{name}", others.map((source) => source.short).join(", "))}
                  </button>
                ) : null}
              </div>
            ) : null}
            <ParallelLink book={data.book} chapter={data.chapter} from={verse} session={session ?? null} workspace={ctx ? workspaceOfOrg(tallerConfig, ctx.pmOrg) : undefined} team={row.draft ? { owner: row.draft.owner, repo: row.draft.repo } : undefined} />
            {said.length ? (
              <div className="gr-said">
                {folding ? (
                  <button type="button" className="rv-item__add rv-fold" onClick={() => setUnfolded((now) => new Set(now).add(key))}>
                    {t(said.length - 2 === 1 ? "gr.seeBeforeOne" : "gr.seeBeforeMany").replace("{n}", String(said.length - 2))}
                  </button>
                ) : null}
                <ul className="rv-comments">
                  {shownSaid.map((one) => (
                    <li key={`${one.reviewer}-${one.timestamp}`} className="rv-comment gr-said__row" data-kind={one.status === "approved" ? "reply" : "doubt"}>
                      {one.earlier ? <p className="rv-comment__where">{t("gr.earlier")}</p> : null}
                      <p className="gr-said__who">
                        <PersonPhoto login={one.reviewer} name={names[one.reviewer.toLowerCase()]?.name} avatarUrl={names[one.reviewer.toLowerCase()]?.avatarUrl} size="sm" />
                        <span>{nameOf(one.reviewer)}</span>
                      </p>
                      <p className="rv-comment__text">{one.note}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {faces(agreers)}
            {blocker && blocker.kind !== "doubt" ? <p className="gr-line">{blockerLine(row.resource, blocker)}</p> : null}
            {stepDone ? null : box ? (
              box
            ) : (
              <div className="rv-say">
                {myDoubt ? (
                  <button type="button" className="rv-item__add" disabled={saving} onClick={() => void answer([{ text: row, verse, status: "approved" }], t("gr.doubtDropped"))}>
                    <Check size={14} aria-hidden /> {t("gr.dropDoubt")}
                  </button>
                ) : askers.length ? (
                  <button type="button" className="rv-item__add" disabled={saving} onClick={() => setDraft({ kind: "reply", text: "", why: "", reasons: [] })}>
                    {t("rv.reply")}
                  </button>
                ) : null}
                <button type="button" className="rv-item__add rv-notquite" data-guide={openKey === key ? "gr-notquite" : undefined} aria-expanded={choosingNow} onClick={() => choose(!choosingNow)}>
                  {t("rv.notQuite")}
                </button>
                {choosingNow ? (
                  <div className="rv-choose">
                    <Button
                      type="button"
                      variant="outline"
                      data-choice="propose"
                      onClick={() => {
                        choose(false);
                        setDraft({ kind: "fix", text: body, why: "", reasons: [] });
                      }}
                    >
                      {t("rv.proposeWords")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      data-choice="comment"
                      onClick={() => {
                        choose(false);
                        // Changing what one said starts from it.
                        setDraft({ kind: "doubt", text: "", why: myDoubt?.note ?? "", reasons: [] });
                      }}
                    >
                      {t("rv.commentSomething")}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </li>
    );
  }

  /** The end of a passage: who agrees, why it is not agreed yet, and my agreement with it. */
  function passageEnd(row: GroupReadingText, passage: ReadingPassage) {
    if (!data) return null;
    const verses = withText(row, passage);
    if (!verses.length) return null;
    const agreers = passageAgreers(passage, row, data.chapter, tallies);
    const blocker = passageBlocker(passage, row, data.chapter, tallies, minAgree);
    const left = leftOf(row.resource, passage);
    const lastKey = keyOf(row.resource, verses[verses.length - 1]!);
    const readToEnd = seen.has(lastKey);
    const filled = readToEnd && passage.from === firstMine?.from && !progress?.complete;
    const openUntil = latestOf(verses.map((verse) => tallies.get(readingItemId(row.resource, data.chapter, verse))?.openUntil));
    const lines = stepDone ? [] : leftLines(row.resource, left);
    return (
      <div className="gr-end">
        {faces(agreers)}
        <p className="gr-line" data-done={blocker ? undefined : "true"}>
          {blocker ? (
            blockerLine(row.resource, blocker)
          ) : (
            <>
              <Check size={14} aria-hidden /> {openUntil ? sayUntil("round.openUntil", openUntil) : t("gr.passageDone")}
            </>
          )}
        </p>
        {!stepDone && left.verses.length ? (
          <Button
            type="button"
            className="gr-end__agree"
            variant={filled ? "default" : "outline"}
            disabled={saving}
            data-read={readToEnd}
            data-guide={passage.from === firstMine?.from ? "gr-passage" : undefined}
            onClick={() => (readToEnd ? void answer(left.verses.map((verse) => ({ text: row, verse, status: "approved" as const })), t("gr.passageAgreed")) : setAgreeAsk(passage.from))}
          >
            <Check size={16} aria-hidden /> {saving ? t("wf.saving") : t("gr.iAgreePassage")}
          </Button>
        ) : null}
        {lines.map((line, at) => (
          <p key={at} className="gr-line">
            {line}
          </p>
        ))}
        {stepDone ? null : (
          <button type="button" className="rv-item__add rv-notquite gr-end__notquite" onClick={() => setWhichFor(passage.from)}>
            {t("rv.notQuite")}
          </button>
        )}
      </div>
    );
  }

  // The doubts of what arrived of the text being read: mine first, those answered said apart.
  const doubts = data && text && !stepDone ? openDoubts(passages, text, data.chapter, tallies, decisions, me) : [];
  const answeredMine = doubts.filter((row) => row.mine && row.answered).map((row) => row.verse);
  const otherDoubts = doubts.filter((row) => !(row.mine && row.answered)).map((row) => row.verse);

  /** The foot: where the reading stands, without numbers, and one button (filled unless a passage's button is). */
  const foot = (() => {
    if (!data || !progress || !text) return { line: null as ReactNode, filled: true };
    if (stepDone) return { line: t("gr.alreadyClosed"), filled: true };
    if (progress.complete) return { line: t("gr.readyToClose"), filled: true };
    if (!progress.items) return { line: t("gr.nothingYet"), filled: true };
    const order = [text, ...data.texts.filter((row) => row !== text)];
    for (const row of order) {
      const passage = passages.find((one) => leftOf(row.resource, one).verses.length > 0);
      if (!passage) continue;
      if (row === text) return { line: t("gr.footLeftPassage").replace("{ref}", placeOf(passage)), filled: false };
      return {
        line: (
          <button type="button" className="gr-link" onClick={() => setChosen(row.resource)}>
            {t("gr.footLeftText").replace("{name}", row.name)}
          </button>
        ),
        filled: true,
      };
    }
    for (const row of order) {
      for (const passage of passages) {
        const lines = leftLines(row.resource, { ...leftOf(row.resource, passage), changed: [] });
        if (lines.length) return { line: lines[0], filled: true };
      }
    }
    if (progress.missing) return { line: t("gr.footAllRead"), filled: true };
    if (!progress.allAgreed) {
      for (const row of order)
        for (const passage of passages) {
          const blocker = passageBlocker(passage, row, data.chapter, tallies, minAgree);
          if (blocker) return { line: blockerLine(row.resource, blocker), filled: true };
        }
    }
    if (progress.closesAt) return { line: sayUntil("round.allAgreedOpen", progress.closesAt), filled: true };
    return { line: null, filled: true };
  })();

  const which = whichFor !== null && text ? passages.find((passage) => passage.from === whichFor) : undefined;

  return (
    <div className="scripture-editor fam">
      <ToolHeader
        title={place}
        onBack={onClose}
        meta={
          <>
            {/* How far along it is, is said at the foot: here it pushed the name of the step out of a phone's width. */}
            {[stepName, ctx?.taskName && localizeName(ctx.taskName, language) !== stepName ? localizeName(ctx.taskName, language) : ""].filter(Boolean).join(" · ")}
          </>
        }
      />
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx && step ? { ...ctx, stepId: step.id } : ctx} />
      </div>

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{localizeThread(error, language)}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <LoadingState shape="tool" label={t("gr.loading")} />
      ) : data && progress ? (
        <>
          <div className="fam__body gr-body" ref={pane}>
            {data.texts.length > 1 ? (
              <div className="pe-seg gr-pick" role="radiogroup" aria-label={t("gr.pickText")} style={{ gridTemplateColumns: `repeat(${data.texts.length}, minmax(0, 1fr))` }}>
                {data.texts.map((row) => (
                  <button key={row.resource} type="button" role="radio" aria-checked={row === text} className="pe-seg__opt" onClick={() => setChosen(row.resource)}>
                    {row.name}
                    {row !== text && hasTodo(row.resource) ? <span className="rv-dot gr-pick__dot" data-kind="open" role="img" aria-label={t("gr.textTodo")} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {answeredMine.length || otherDoubts.length ? (
              <p className="gr-top">
                {answeredMine.length && text ? <span>{withRefs(t("gr.answeredYou"), text.resource, answeredMine)}</span> : null}
                {answeredMine.length && otherDoubts.length ? " · " : null}
                {otherDoubts.length && text ? <span>{withRefs(t(otherDoubts.length === 1 ? "gr.blockDoubtOne" : "gr.blockDoubtMany"), text.resource, otherDoubts)}</span> : null}
              </p>
            ) : null}
            {!data.texts.length ? <p className="pe-hint">{t("gr.noTexts")}</p> : null}

            {text
              ? passages.map((passage) => {
                  const arrived = passage.arrived[text.resource];
                  return (
                    <section key={passage.from} className="gr-passage" data-arrived={arrived ? "true" : "false"}>
                      <h2 className="gr-passage__place">{placeOf(passage)}</h2>
                      {arrived ? (
                        <>
                          <ol className="gr-verses">{withText(text, passage).map((verse) => piece(text, passage, verse))}</ol>
                          {passageEnd(text, passage)}
                        </>
                      ) : (
                        <p className="gr-passage__wait">
                          <Clock3 size={14} aria-hidden /> {t("gr.waitingAll")}
                        </p>
                      )}
                    </section>
                  );
                })
              : null}
          </div>
          <ReadingGuide ready={firstPiece !== undefined} open={anyOpen} watch={`${openKey ?? ""}|${choosing.size}`} />
          <div className="tool-foot">
            <p>{foot.line}</p>
            {progress.complete && !stepDone && ctx?.issueNumber ? (
              <Button type="button" disabled={saving} onClick={() => void close()}>
                {saving ? t("wf.saving") : t("gr.close")}
              </Button>
            ) : (
              <Button type="button" variant={foot.filled ? "default" : "outline"} onClick={onClose}>
                {t("fa.back")}
              </Button>
            )}
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={agreeAsk !== null}
        safe
        title={t("gr.agreeEarlyTitle")}
        text={t("rv.agreeEarlyText")}
        yes={t("rv.agreeEarlyYes")}
        no={t("rv.agreeEarlyKeep")}
        onYes={() => {
          const passage = passages.find((one) => one.from === agreeAsk);
          setAgreeAsk(null);
          if (passage && text) void answer(leftOf(text.resource, passage).verses.map((verse) => ({ text, verse, status: "approved" as const })), t("gr.passageAgreed"));
        }}
        onNo={() => setAgreeAsk(null)}
      />
      <Dialog open={Boolean(which)} onOpenChange={(next) => (next ? undefined : setWhichFor(null))}>
        <DialogContent className="fix-sheet gr-which" aria-describedby={undefined}>
          <div className="fx-head">
            <DialogTitle className="fx-title">{t("gr.whichVerse")}</DialogTitle>
          </div>
          <div className="gr-which__list">
            {which && text
              ? withText(text, which).map((verse) => (
                  <Button
                    key={verse}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setWhichFor(null);
                      goTo(text.resource, verse, true);
                    }}
                  >
                    {refOf(verse)}
                  </Button>
                ))
              : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
