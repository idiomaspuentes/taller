import { ToolHeader } from "./ToolHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { appendMyDecisions, saveCorrection } from "../dcs/afinacionStore";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadGroupReading, type GroupReadingData, type GroupReadingText } from "../dcs/groupReading";
import { commentOnIssue } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import { readingItemId, readingPassages, readingProgress, type ReadingPassage } from "../domain/groupReading";
import { confirmersOf, levelsForTeam } from "../domain/levels";
import { localized } from "../domain/processes";
import { reviewersToNotifyAfterEdit, tallyItem, textFingerprint, type ItemTally, type ReviewDecision } from "../domain/reviewRound";
import { decodeSolverLaunchContext } from "../domain/solverLaunch";
import { localizeName } from "../domain/templateNames";
import { localizeThread } from "../domain/threadNames";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT } from "../i18n/messages";

type Props = {
  ctxEncoded: string;
  onClose: () => void;
  announce: (msg: string) => void;
};

/** What is being written about one verse of one text: a correction of it, or a doubt about it. */
type Open = { id: string; kind: "fix" | "doubt"; text: string; why: string };

/**
 * The group review of a deliverable. The team reads together everything translated of the stretch, on the group's
 * draft: every text side by side, verse by verse, against the sources. A passage is read as soon as it arrives; the
 * ones still being translated show as waited for. Each person agrees with a verse, corrects it (everybody who had
 * agreed is asked to look again) or raises a doubt; when everything arrived and is agreed, the review is closed.
 */
export function GroupReadingView({ ctxEncoded, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const ctx = useMemo(() => decodeSolverLaunchContext(ctxEncoded), [ctxEncoded]);
  const [data, setData] = useState<GroupReadingData | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  const [showSources, setShowSources] = useState(true);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stepDone, setStepDone] = useState(false);
  const [error, setError] = useState("");

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
  const minAgree = step?.minAssignees ?? 2;
  const minIndependent = step?.minIndependent ?? 1;
  const teamLevels = useMemo(() => levelsForTeam(data?.levelBook, data?.teamName), [data?.levelBook, data?.teamName]);
  const confirmers = useMemo(() => confirmersOf(data?.levelBook, data?.teamName), [data?.levelBook, data?.teamName]);

  const passages = useMemo<ReadingPassage[]>(() => (data ? readingPassages(data.passages, data.texts) : []), [data]);
  const tallies = useMemo(() => {
    const map = new Map<string, ItemTally>();
    if (!data) return map;
    for (const text of data.texts) {
      for (const [verse, body] of Object.entries(text.verses)) {
        if (!body?.trim()) continue;
        const itemId = readingItemId(text.resource, data.chapter, Number(verse));
        map.set(itemId, tallyItem({ itemId, decisions, currentHash: textFingerprint(body), levels: teamLevels, authors: data.authorsByItem[itemId] ?? [], thresholds: { minAgree, minIndependent }, confirmers }));
      }
    }
    return map;
  }, [data, decisions, teamLevels, confirmers, minAgree, minIndependent]);
  const progress = useMemo(() => (data ? readingProgress(passages, data.texts, data.chapter, tallies) : null), [data, passages, tallies]);

  const myAnswer = (id: string) => tallies.get(id)?.answers.find((answer) => answer.reviewer.trim().toLowerCase() === me);

  function decision(text: GroupReadingText, verse: number, status: "approved" | "revise", note?: string): ReviewDecision {
    return {
      itemId: readingItemId(text.resource, data!.chapter, verse),
      ref: { start: { chapter: data!.chapter, verse } },
      sessionId: String(ctx!.issueNumber || ctx!.taskId),
      stageId: step?.id ?? "lectura",
      status,
      reviewer: session!.username,
      timestamp: new Date().toISOString(),
      ...(note ? { note } : {}),
      textHash: textFingerprint(text.verses[verse] ?? ""),
    };
  }

  /** Answers, saved text by text (each text keeps its own in its repository). */
  async function answer(rows: { text: GroupReadingText; verse: number; status: "approved" | "revise"; note?: string }[], said: string) {
    if (!session || !data || !ctx || !rows.length) return;
    setSaving(true);
    setError("");
    try {
      const made: ReviewDecision[] = [];
      for (const text of data.texts) {
        const mine = rows.filter((row) => row.text.resource === text.resource && text.draft).map((row) => decision(text, row.verse, row.status, row.note));
        if (!mine.length || !text.draft) continue;
        await appendMyDecisions(session, text.draft, data.book, mine);
        made.push(...mine);
      }
      setDecisions((prev) => [...prev, ...made]);
      setOpen(null);
      announce(said);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /** Everything of a passage I have not answered yet, agreed at once: reading it whole is the point. */
  const unanswered = (passage: ReadingPassage) =>
    (data?.texts ?? []).flatMap((text) => (passage.arrived[text.resource] ? passage.verses.filter((verse) => text.verses[verse]?.trim() && !myAnswer(readingItemId(text.resource, data!.chapter, verse))).map((verse) => ({ text, verse, status: "approved" as const })) : []));

  async function correct(text: GroupReadingText, verse: number) {
    if (!session || !data || !ctx || !open || !text.draft) return;
    const next = open.text.trim();
    if (!next) return;
    setSaving(true);
    setError("");
    try {
      await saveCorrection({ session, target: text.draft, filepath: text.draft.filepath, chapter: data.chapter, verse, text: next, reason: open.why, book: data.book });
      const itemId = readingItemId(text.resource, data.chapter, verse);
      // Whoever had agreed with the old wording is told: their answer no longer counts.
      const who = reviewersToNotifyAfterEdit({ itemId, decisions, newHash: textFingerprint(next), editor: session.username });
      const texts = data.texts.map((row) => (row.resource === text.resource ? { ...row, verses: { ...row.verses, [verse]: next } } : row));
      setData({ ...data, texts });
      // Having written it, I agree with it.
      const own = { ...decision({ ...text, verses: { ...text.verses, [verse]: next } }, verse, "approved", open.why.trim() || undefined) };
      await appendMyDecisions(session, text.draft, data.book, [own]);
      setDecisions((prev) => [...prev, own]);
      if (who.length && ctx.pmOrg && ctx.issueNumber) {
        const why = open.why.trim();
        await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, `${who.map((login) => `@${login}`).join(" ")} ${tNow("gr.correctedNote").replace("{ref}", `${data.book} ${data.chapter}:${verse}`).replace("{text}", text.name)}${why ? ` ${tNow("gr.reason").replace("{why}", why)}` : ""}`).catch(() => undefined);
      }
      setOpen(null);
      announce(t("gr.corrected").replace("{ref}", `${data.chapter}:${verse}`));
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

  const stepName = step ? localized(step.name, step.names, language) : t("gr.title");
  const place = ctx ? `${bookLabel(ctx.book, language)} ${ctx.ref}` : stepName;

  function verseOf(text: GroupReadingText, passage: ReadingPassage, verse: number) {
    if (!data) return null;
    const body = text.verses[verse]?.trim() ?? "";
    if (!passage.arrived[text.resource] || !body) return null;
    const id = readingItemId(text.resource, data.chapter, verse);
    const tally = tallies.get(id);
    const mine = myAnswer(id);
    const stale = tally?.stale.some((row) => row.reviewer.trim().toLowerCase() === me);
    const doubts = (tally?.answers ?? []).filter((row) => row.status !== "approved");
    const writing = open?.id === id ? open : null;
    return (
      <div key={text.resource} className="gr-text" data-state={tally?.state}>
        <div className="gr-text__head">
          <span className="gr-text__name">{text.name}</span>
          <span className="gr-text__state">
            {tally?.state === "agreed" ? (
              <>
                <Check size={12} aria-hidden /> {t("gr.agreed")}
              </>
            ) : tally?.state === "disputed" ? (
              t("gr.disputed")
            ) : (
              t("gr.count").replace("{n}", String(tally?.agree ?? 0)).replace("{of}", String(minAgree))
            )}
          </span>
        </div>
        {writing?.kind === "fix" ? null : <p className="gr-text__body">{body}</p>}
        {doubts.map((row) => (
          <p key={`${row.reviewer}-${row.timestamp}`} className="gr-doubt">
            <strong>@{row.reviewer}</strong> {row.note}
          </p>
        ))}
        {stale ? <p className="gr-stale">{t("gr.stale")}</p> : null}
        {stepDone ? null : writing ? (
          <div className="rv-composer">
            {writing.kind === "fix" ? <textarea className="af-textarea" rows={3} value={writing.text} aria-label={t("gr.fixAria")} onChange={(e) => setOpen({ ...writing, text: e.target.value })} /> : null}
            <textarea className="af-textarea" rows={2} value={writing.why} placeholder={t(writing.kind === "fix" ? "gr.whyFix" : "gr.whyDoubt")} aria-label={t(writing.kind === "fix" ? "gr.whyFix" : "gr.whyDoubt")} onChange={(e) => setOpen({ ...writing, why: e.target.value })} />
            <div className="rv-composer__row">
              {writing.kind === "fix" ? (
                <Button type="button" size="sm" disabled={saving || !writing.text.trim() || writing.text.trim() === body} onClick={() => void correct(text, verse)}>
                  {t("gr.saveFix")}
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={saving || !writing.why.trim()} onClick={() => void answer([{ text, verse, status: "revise", note: writing.why.trim() }], t("gr.doubtSaved"))}>
                  {t("gr.saveDoubt")}
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>
                {t("gr.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="gr-text__actions">
            {mine?.status === "approved" ? (
              <span className="gr-mine">
                <Check size={12} aria-hidden /> {t("gr.youAgreed")}
              </span>
            ) : (
              <button type="button" disabled={saving} onClick={() => void answer([{ text, verse, status: "approved" }], t("gr.agreedSaved"))}>
                <Check size={13} aria-hidden /> {t("gr.agree")}
              </button>
            )}
            <button type="button" disabled={saving} onClick={() => setOpen({ id, kind: "fix", text: body, why: "" })}>
              <Pencil size={13} aria-hidden /> {t("gr.fix")}
            </button>
            <button type="button" disabled={saving} onClick={() => setOpen({ id, kind: "doubt", text: "", why: mine?.status === "revise" ? (mine.note ?? "") : "" })}>
              {t("gr.doubt")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="scripture-editor fam">
      <ToolHeader
        title={place}
        onBack={onClose}
        meta={
          <>
            {[stepName, ctx?.taskName ? localizeName(ctx.taskName, language) : "", progress && progress.items ? t("gr.progress").replace("{n}", String(progress.agreed)).replace("{of}", String(progress.items)) : ""].filter(Boolean).join(" · ")}
          </>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{localizeThread(error, language)}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">{t("gr.loading")}</p>
      ) : data && progress ? (
        <div className="fam__body">
          <div className="rv-bar">
            <p className="rv-bar__count">{t("gr.lede").replace("{n}", String(minAgree))}</p>
            {data.sources.length ? (
              <label className="rv-toggle">
                <input type="checkbox" checked={showSources} onChange={(e) => setShowSources(e.target.checked)} /> {t("rv.showSources")}
              </label>
            ) : null}
          </div>
          {!data.texts.length ? <p className="pe-hint">{t("gr.noTexts")}</p> : null}

          {passages.map((passage) => {
            const here = data.texts.filter((text) => passage.arrived[text.resource]);
            const waited = data.texts.filter((text) => !passage.arrived[text.resource]);
            const left = unanswered(passage);
            return (
              <section key={passage.from} className="gr-passage" data-arrived={here.length ? "true" : "false"}>
                <div className="gr-passage__head">
                  <h2>{`${data.chapter}:${passage.from}${passage.to > passage.from ? `–${passage.to}` : ""}`}</h2>
                  {waited.length ? (
                    <span className="gr-passage__wait">
                      <Clock3 size={13} aria-hidden /> {t(here.length ? "gr.waitingSome" : "gr.waitingAll").replace("{what}", waited.map((text) => text.name).join(", "))}
                    </span>
                  ) : null}
                  {here.length && left.length && !stepDone ? (
                    <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void answer(left, t("gr.passageAgreed"))}>
                      <Check size={14} aria-hidden /> {t("gr.agreePassage")}
                    </Button>
                  ) : null}
                </div>
                {here.length
                  ? passage.verses.map((verse) => (
                      <div key={verse} className="gr-verse">
                        <p className="gr-verse__ref">{`${data.chapter}:${verse}`}</p>
                        <div className="gr-verse__body">
                          {showSources && data.sources.some((source) => source.verses[verse]) ? (
                            <dl className="rv-sources">
                              {data.sources.map((source) =>
                                source.verses[verse] ? (
                                  <div key={source.short}>
                                    <dt>{source.short}</dt>
                                    <dd>{source.verses[verse]}</dd>
                                  </div>
                                ) : null,
                              )}
                            </dl>
                          ) : null}
                          <div className="gr-texts">{here.map((text) => verseOf(text, passage, verse))}</div>
                        </div>
                      </div>
                    ))
                  : null}
              </section>
            );
          })}

          <div className="fam__finish">
            <p>
              {stepDone
                ? t("gr.alreadyClosed")
                : progress.complete
                  ? t("gr.readyToClose")
                  : !progress.items
                    ? t("gr.nothingYet")
                    : [
                        t("gr.progress").replace("{n}", String(progress.agreed)).replace("{of}", String(progress.items)),
                        progress.disputed ? t(progress.disputed === 1 ? "gr.doubtsOne" : "gr.doubtsMany").replace("{n}", String(progress.disputed)) : "",
                        progress.missing ? t(progress.missing === 1 ? "gr.missingOne" : "gr.missingMany").replace("{n}", String(progress.missing)) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
            </p>
            {stepDone ? (
              <Button type="button" onClick={onClose}>
                {t("fa.back")}
              </Button>
            ) : progress.complete && ctx?.issueNumber ? (
              <Button type="button" disabled={saving} onClick={() => void close()}>
                {saving ? t("wf.saving") : t("gr.close")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
