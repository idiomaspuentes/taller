import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { appendCheckAnswers, loadCheckAnswers } from "../dcs/checkStore";
import { loadChecklist, type ChecklistData, type ChecklistItem, type ChecklistKind, type ChecklistText } from "../dcs/checklistLoad";
import { commentOnIssue } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { questionsFor, summarizeChecklist, type CheckAnswer, type CheckItem, type CheckOutcome } from "../domain/checklist";
import { alignedGatewayQuoteForHelpQuote, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { coordinatorsOf } from "../domain/levels";
import { localized } from "../domain/processes";
import { decodeSolverLaunchContext, encodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { textFingerprint } from "../domain/reviewRound";
import { closesInItsTool } from "../domain/stepClaim";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT, type MessageKey } from "../i18n/messages";

type Props = {
  ctxEncoded: string;
  /** What the checklist goes over, and the text each item is checked against: the process says it per step. */
  kind: ChecklistKind;
  texts: ChecklistText[];
  onClose: () => void;
  announce: (msg: string) => void;
};

const TEXT_LABEL: Record<ChecklistText, string> = { tpl: "TPL", tps: "TPS" };
const OUTCOME_KEY: Record<CheckOutcome, MessageKey> = { fixed: "ck.fixed", created: "ck.created", consult: "ck.consult" };
const verseKeyOf = (item: Pick<ChecklistItem, "chapter" | "verse">) => `${item.chapter}:${item.verse}`;

/** A verse with the words a quote points at marked. */
function Verse({ text, marked }: { text: string; marked: number[] }) {
  const tokens = tokenizeVersePlainText(text);
  const on = new Set(marked);
  return (
    <span className="ck-verse">
      {tokens.map((token, index) => (
        <span key={index}>
          {on.has(index) ? <mark>{token}</mark> : token}{" "}
        </span>
      ))}
    </span>
  );
}

/**
 * A step that closes by a checklist: every item of the passage, with the yes/no questions the process declares for
 * the step. The screen knows how to show notes, questions and terms beside a text; which questions are asked, and of
 * what, comes from the template.
 */
export function ChecklistView({ ctxEncoded, kind, texts, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<ChecklistData | null>(null);
  const [answers, setAnswers] = useState<CheckAnswer[]>([]);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [stepDone, setStepDone] = useState(false);
  /** A «no» being explained: which question, what was done about it and the note. */
  const [draft, setDraft] = useState<{ answerItemId: string; questionId: string; outcome: CheckOutcome; note: string } | null>(null);

  const textsKey = texts.join(",");
  const storeKey = ctx ? `${(ctx.book || ctx.projectId).toUpperCase()}.${ctx.issueNumber || ctx.taskId}.${ctx.stepId || "paso"}` : "";

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) return setError(tNow("af.badLink"));
    setCtx(decoded);
    if (!session?.token) return setError(tNow("af.expired"));
    setBusy(true);
    setError("");
    try {
      const loaded = await loadChecklist({ session, ctx: decoded, kind, texts: textsKey.split(",").filter(Boolean) as ChecklistText[] });
      setData(loaded);
      const key = `${(decoded.book || decoded.projectId).toUpperCase()}.${decoded.issueNumber || decoded.taskId}.${decoded.stepId || "paso"}`;
      setAnswers(await loadCheckAnswers(session, loaded.target, key));
      if (decoded.pmOrg && decoded.issueNumber && decoded.stepId) {
        setStepDone(await stepIsDone({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId }).catch(() => false));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session, kind, textsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const questions = data?.step?.checklist ?? [];
  const checkItems: CheckItem[] = useMemo(() => (data?.items ?? []).map((item) => ({ id: item.id, verseKey: verseKeyOf(item) })), [data]);
  // What each verse reads now in the texts on screen: an answer given before a change of the text is checked again.
  const hashes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of data?.items ?? []) out[verseKeyOf(row)] = textFingerprint(texts.map((x) => data?.texts[x]?.verses[row.verse] ?? "").join("|"));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, textsKey]);
  const summary = useMemo(() => summarizeChecklist({ items: checkItems, questions, answers, currentHashes: hashes }), [checkItems, questions, answers, hashes]);
  const item = data?.items[Math.min(position, Math.max((data?.items.length ?? 1) - 1, 0))];
  const tally = item ? summary.items.find((row) => row.itemId === item.id) : undefined;
  const closesHere = Boolean(data?.step && closesInItsTool(data.step) && ctx?.issueNumber);

  /** Who to tell when the problem is in a text this team may not change: the coordinators of the tasks it waits for. */
  const owners = useMemo(() => {
    if (!data?.board || !data.task) return [] as string[];
    const awaited = (data.task.waitsFor ?? []).flatMap((rule) => (rule.taskId ? data.board!.teams.filter((task) => task.id === rule.taskId) : data.board!.teams.filter((task) => task.phaseId === rule.phaseId)));
    return [...new Set(awaited.filter((task) => task.rules.some((rule) => texts.includes(rule.resource as ChecklistText))).flatMap((task) => coordinatorsOf(data.levelBook, task.orgTeamName)))];
  }, [data, textsKey]);

  async function save(next: CheckAnswer[], said: string) {
    if (!session || !data) return;
    setSaving(true);
    setError("");
    try {
      await appendCheckAnswers(session, data.target, storeKey, next);
      setAnswers((prev) => [...prev, ...next]);
      announce(said);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const stamp = (answerItemId: string, questionId: string, value: "yes" | "no", extra: Partial<CheckAnswer> = {}): CheckAnswer => ({
    itemId: answerItemId,
    questionId,
    value,
    by: session?.username ?? "",
    at: new Date().toISOString(),
    textHash: hashes[answerItemId.startsWith("verse:") ? answerItemId.slice("verse:".length) : (checkItems.find((row) => row.id === answerItemId)?.verseKey ?? "")],
    ...extra,
  });

  async function saveNo() {
    if (!draft || !item || !session || !ctx) return;
    await save([stamp(draft.answerItemId, draft.questionId, "no", { outcome: draft.outcome, note: draft.note.trim() })], t("ck.saved"));
    if (draft.outcome === "consult" && ctx.pmOrg && ctx.issueNumber) {
      const where = `${data?.book ?? ""} ${item.chapter}:${item.verse}`;
      const who = owners.map((login) => `@${login}`).join(" ");
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, `${who ? `${who} ` : ""}Consulta sobre ${texts.map((x) => TEXT_LABEL[x]).join(" y ")} ${where}: ${draft.note.trim()}`).catch(() => undefined);
    }
    setDraft(null);
  }

  async function closeStep() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !ctx.stepId) return;
    setSaving(true);
    try {
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      setStepDone(true);
      announce(t("ck.stepClosed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const jump = (itemId: string) => {
    const at = data?.items.findIndex((row) => row.id === itemId) ?? -1;
    if (at >= 0) setPosition(at);
  };
  const nextPending = () => {
    if (!data) return;
    const order = [...data.items.slice(position + 1), ...data.items.slice(0, position + 1)];
    const found = order.find((row) => summary.items.find((s) => s.itemId === row.id)?.state !== "ok");
    if (found) jump(found.id);
  };
  const labelOf = (itemId: string) => {
    const found = data?.items.find((row) => row.id === itemId);
    return found ? `${found.chapter}:${found.verse}${found.title ? ` · ${found.title}` : ""}` : itemId;
  };

  const stepName = data?.step ? localized(data.step.name, data.step.names, language) : t("ck.title");
  // The helps editor opens for one resource: this checklist's.
  const editorHref = ctx && kind !== "palabras" ? `#/solver/helps?ctx=${encodeURIComponent(encodeSolverLaunchContext({ ...ctx, resource: kind }))}` : "";

  return (
    <div className="af ck">
      <header className="af-head">
        <button type="button" className="af-back" onClick={onClose} aria-label={t("af.back")}>
          {t("af.backArrow")}
        </button>
        <div className="af-title">
          <h1>{stepName}</h1>
          <p>{data ? `${data.book} ${ctx?.ref || data.chapter}` : ctx ? `${ctx.book} ${ctx.chapter}` : ""}</p>
        </div>
        {data ? (
          <div className="af-progress" aria-label={t("ck.progressAria")}>
            <span>{t("ck.nChecked").replace("{a}", String(summary.done)).replace("{n}", String(data.items.length))}</span>
            <span className="af-bar">
              <i style={{ width: `${data.items.length ? (summary.done / data.items.length) * 100 : 0}%` }} />
            </span>
          </div>
        ) : null}
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("af.loading")}</p> : null}
      {data?.fromSource ? <p className="af-stale">{t("ck.fromSource")}</p> : null}
      {data && !questions.length ? <p className="af-stale">{t("ck.noQuestions")}</p> : null}
      {data && !data.items.length ? <p className="hub-hint">{t("ck.noItems")}</p> : null}

      {data && data.items.length ? (
        <section className="round" aria-label={t("ck.standingAria")}>
          {stepDone ? (
            <p className="round__done">{t("ck.stepClosed")}</p>
          ) : summary.complete && closesHere ? (
            <div className="round__ready">
              <p>{t("ck.allChecked")}</p>
              <Button type="button" size="lg" disabled={saving} onClick={() => void closeStep()}>
                {t("ck.closeStep")}
              </Button>
            </div>
          ) : null}
          {(
            [
              ["ck.openList", summary.open],
              ["ck.consultList", summary.consulting],
              ["ck.changedList", summary.changed],
            ] as const
          ).map(([key, rows]) =>
            rows.length ? (
              <details key={key} className="ck-list" data-kind={key}>
                <summary>{t(key).replace("{n}", String(rows.length))}</summary>
                <ul className="round__list">
                  {rows.map((row) => (
                    <li key={row.itemId}>
                      <button type="button" className="round__item" onClick={() => jump(row.itemId)}>
                        <span>{labelOf(row.itemId)}</span>
                        <span className="round__who">
                          {Object.values(row.answers).filter((a) => a?.value === "no").map((a) => a!.note).filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null,
          )}
        </section>
      ) : null}

      {data && item ? (
        <>
          <section className="af-dock" aria-label={t("ck.textsAria")}>
            <div className="af-dock__bar">
              <strong>
                {data.book} {item.chapter}:{item.verse}
              </strong>
            </div>
            {texts.map((resource) => {
              const text = data.texts[resource];
              const verse = text?.verses[item.verse] ?? "";
              // The item's quote is in the original language: its words in this text come from the alignment.
              const hit = item.quote && verse ? alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: text?.alignments, book: data.book, chapter: item.chapter, verse: item.verse }) : null;
              return (
                <div key={resource} className="af-row">
                  <span className="af-lbl">{TEXT_LABEL[resource]}</span>
                  {verse ? <Verse text={verse} marked={hit?.tokenIndices ?? []} /> : <span className="af-hint">{t("ck.noText").replace("{text}", TEXT_LABEL[resource])}</span>}
                  {item.quote && verse ? (
                    <span className="ck-quote" data-found={hit?.gatewayText ? "true" : "false"}>
                      {hit?.gatewayText ? t("ck.quoteIs").replace("{quote}", hit.gatewayText) : t("ck.quoteMissing").replace("{text}", TEXT_LABEL[resource])}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </section>

          <section className="af-card" aria-label={t("ck.itemAria")}>
            <div className="af-card__top">
              <span className="af-chip">{t(kind === "notas" ? "ck.kindNote" : kind === "preguntas" ? "ck.kindQuestion" : "ck.kindTerm")}</span>
              {tally ? <span className="af-state" data-state={tally.state === "ok" ? "agreed" : tally.state === "pending" ? "pending" : "disputed"}>{t(`ck.state.${tally.state}` as MessageKey)}</span> : null}
            </div>
            {item.title ? <h2 className="af-phrase">{item.title}</h2> : null}
            {item.body ? <p className="af-note">{item.body}</p> : null}
            {item.supportRef ? <p className="af-hint">{t("ck.support").replace("{ref}", item.supportRef)}</p> : null}
            {editorHref ? (
              <a className="af-link" href={editorHref} target="_blank" rel="noopener noreferrer">
                {t("ck.openEditor")}
              </a>
            ) : null}

            <ul className="ck-questions">
              {questionsFor({ id: item.id, verseKey: verseKeyOf(item) }, checkItems, questions).map(({ question, answerItemId }) => {
                const answer = tally?.answers[question.id];
                const writing = draft && draft.answerItemId === answerItemId && draft.questionId === question.id;
                return (
                  <li key={question.id} className="ck-question">
                    <p className="ck-question__text">
                      {localized(question.text, question.texts, language)}
                      {question.per === "verse" ? <span className="ck-question__scope"> {t("ck.perVerse")}</span> : null}
                    </p>
                    <div className="ck-question__buttons">
                      <Button type="button" variant={answer?.value === "yes" ? "default" : "outline"} aria-pressed={answer?.value === "yes"} disabled={saving || stepDone} onClick={() => void save([stamp(answerItemId, question.id, "yes")], t("ck.saved"))}>
                        {t("ck.yes")}
                      </Button>
                      <Button type="button" variant={answer?.value === "no" ? "default" : "outline"} aria-pressed={answer?.value === "no"} disabled={saving || stepDone} onClick={() => setDraft({ answerItemId, questionId: question.id, outcome: answer?.outcome ?? "fixed", note: answer?.note ?? "" })}>
                        {t("ck.no")}
                      </Button>
                    </div>
                    {answer?.value === "no" && !writing ? (
                      <p className="ck-question__outcome" data-outcome={answer.outcome ?? "none"}>
                        {answer.outcome ? t(OUTCOME_KEY[answer.outcome]) : t("ck.noOutcome")}
                        {answer.note ? `: ${answer.note}` : ""}
                        {answer.outcome === "consult" && !answer.resolved ? (
                          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void save([{ ...answer, resolved: true, by: session?.username ?? "", at: new Date().toISOString() }], t("ck.saved"))}>
                            {t("ck.answered")}
                          </Button>
                        ) : null}
                      </p>
                    ) : null}
                    {writing ? (
                      <div className="ck-no" role="group" aria-label={t("ck.whatDone")}>
                        <p className="af-lbl">{t("ck.whatDone")}</p>
                        <div className="ck-no__outcomes">
                          {(["fixed", "created", "consult"] as CheckOutcome[]).map((outcome) => (
                            <button key={outcome} type="button" aria-pressed={draft.outcome === outcome} onClick={() => setDraft({ ...draft, outcome })}>
                              {t(OUTCOME_KEY[outcome])}
                            </button>
                          ))}
                        </div>
                        <label htmlFor="ck-note" className="af-lbl">
                          {t(draft.outcome === "consult" ? "ck.reason" : "ck.whatChanged")}
                        </label>
                        <textarea id="ck-note" className="af-textarea" rows={3} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                        {draft.outcome === "consult" ? <p className="af-hint">{owners.length ? t("ck.consultTo").replace("{who}", owners.map((o) => `@${o}`).join(", ")) : t("ck.consultNobody")}</p> : null}
                        <div className="af-buttons">
                          <Button type="button" disabled={saving || !draft.note.trim()} onClick={() => void saveNo()}>
                            {saving ? t("af.saving") : t("ck.saveNo")}
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                            {t("af.cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <nav className="af-nav" aria-label={t("ck.navAria")}>
            <Button type="button" variant="secondary" disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
              {t("af.prev")}
            </Button>
            <span className="af-count">{t("af.countOf").replace("{a}", String(position + 1)).replace("{b}", String(data.items.length))}</span>
            <Button type="button" variant="secondary" disabled={position >= data.items.length - 1} onClick={() => setPosition((p) => p + 1)}>
              {t("af.next")}
            </Button>
          </nav>
          {!summary.complete ? (
            <Button type="button" variant="outline" onClick={nextPending}>
              {t("ck.nextPending")}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
