import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadPersonDocs, savePersonDoc } from "../dcs/checkStore";
import { loadUnitTexts, type ChecklistData, type ChecklistText } from "../dcs/checklistLoad";
import { commentOnIssue } from "../dcs/issues";
import { approveStepFromTool, completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { loadUnitToPublish, recordEndorsement } from "../dcs/unitPublish";
import { ownerTaskOf } from "../domain/resourceOwner";
import { tallyEndorsement, visibleReports, type Concern, type EndorsementReport } from "../domain/endorsement";
import { canConfirmForTeam, coordinatorsOf } from "../domain/levels";
import { localized } from "../domain/processes";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { stepMinAssignees } from "../domain/stepClaim";
import type { ChecklistQuestion } from "../domain/types";
import { scopeLabel } from "../domain/resourceNames";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT } from "../i18n/messages";

type Props = {
  ctxEncoded: string;
  /** `reporte`: a member reads the unit and hands in their report. `decision`: the committee decides. */
  mode: "reporte" | "decision";
  onClose: () => void;
  announce: (msg: string) => void;
};

type UnitData = Omit<ChecklistData, "kind" | "items" | "fromSource">;
const TEXTS: ChecklistText[] = ["tpl", "tps"];
const blank = (by: string): EndorsementReport => ({ by, answers: {}, concerns: [], delivered: false, at: "" });

/** What a committee endorses of a unit, when its board does not say otherwise: the two texts and their helps. */
const ENDORSED = ["tpl", "tps", "notas", "preguntas"];

/**
 * A committee endorses a unit. Each member reads it alone and hands in a report (the questions come from the step's
 * template); nobody sees another report before handing in their own. Then the committee decides, by the step's rule,
 * and what is not endorsed goes to whoever maintains each resource.
 */
export function EndorsementView({ ctxEncoded, mode, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<UnitData | null>(null);
  const [reports, setReports] = useState<EndorsementReport[]>([]);
  const [mine, setMine] = useState<EndorsementReport | null>(null);
  const [concern, setConcern] = useState<{ kind: Concern["kind"]; about: string; where: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [stepDone, setStepDone] = useState(false);

  const me = (session?.username ?? "").toLowerCase();
  const keyOf = (c: SolverLaunchContext) => `${(c.book || c.projectId).toUpperCase()}.${c.issueNumber || c.taskId}.aval`;

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) return setError(tNow("af.badLink"));
    setCtx(decoded);
    if (!session?.token) return setError(tNow("af.expired"));
    setBusy(true);
    setError("");
    try {
      const loaded = await loadUnitTexts({ session, ctx: decoded, texts: TEXTS });
      setData(loaded);
      const docs = await loadPersonDocs<EndorsementReport>(session, loaded.target, keyOf(decoded));
      const list = docs.map((row) => ({ ...row.doc, by: row.doc.by || row.login }));
      setReports(list);
      setMine(list.find((report) => report.by.toLowerCase() === session.username.toLowerCase()) ?? blank(session.username));
      if (decoded.pmOrg && decoded.issueNumber && decoded.stepId) {
        setStepDone(await stepIsDone({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId }).catch(() => false));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session]);

  useEffect(() => {
    void load();
  }, [load]);

  // The questions are those of the report step of this task: the decision reads the same ones.
  const reportStep = data?.task?.steps?.find((step) => step.checklist?.length);
  const questions: ChecklistQuestion[] = reportStep?.checklist ?? [];
  const decisionStep = data?.step;
  const resources = useMemo(() => [...new Set((data?.board?.teams ?? []).flatMap((task) => task.rules.map((rule) => rule.resource)))], [data]);
  const others = visibleReports(reports, me).filter((report) => report.by.toLowerCase() !== me);
  const tally = useMemo(
    () => tallyEndorsement({ reports, questions, minMembers: reportStep ? stepMinAssignees(reportStep) : 2, rule: decisionStep?.decisionRule ?? "majority" }),
    [reports, questions, reportStep, decisionStep],
  );
  const canDecide = Boolean(session) && (session!.canManage || canConfirmForTeam(data?.levelBook, data?.task?.orgTeamName, me));

  async function saveMine(next: EndorsementReport, said: string) {
    if (!session || !data || !ctx) return;
    setSaving(true);
    setError("");
    try {
      const stamped = { ...next, by: session.username, at: new Date().toISOString() };
      await savePersonDoc(session, data.target, keyOf(ctx), stamped);
      setMine(stamped);
      setReports((prev) => [...prev.filter((report) => report.by.toLowerCase() !== me), stamped]);
      if (stamped.delivered && ctx.pmOrg && ctx.issueNumber && data.step) {
        await approveStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, step: data.step }).then(setStepDone).catch(() => undefined);
      }
      announce(said);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function endorse() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !ctx.stepId || !data) return;
    setSaving(true);
    setError("");
    try {
      // What was endorsed is kept piece by piece, so publishing can tell whether anything changed afterwards.
      await recordEndorsement(session, await loadUnitToPublish({ session, ctx, resources: ENDORSED }), ctx.issueNumber);
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, t("en.endorsedNote").replace("{n}", String(tally.supporters.length)).replace("{of}", String(tally.delivered.length)).replace("{who}", tally.supporters.map((s) => `@${s}`).join(", ")));
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      setStepDone(true);
      announce(t("en.endorsed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /** Not endorsed yet: each concern goes to whoever maintains what it is about, in the conversation of this unit. */
  async function sendBack() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !data) return;
    setSaving(true);
    setError("");
    try {
      const byOwner = new Map<string, string[]>();
      for (const c of [...tally.objections, ...tally.observations]) {
        const owner = ownerTaskOf(c.about, data.board, data.task);
        const who = coordinatorsOf(data.levelBook, owner?.orgTeamName).map((login) => `@${login}`).join(" ") || (owner?.name ?? c.about);
        byOwner.set(who, [...(byOwner.get(who) ?? []), `- ${c.kind === "objection" ? t("en.objection") : t("en.observation")}${c.where ? ` (${c.where})` : ""}: ${c.text} — @${c.by}`]);
      }
      const body = [t("en.pendingNote"), ...[...byOwner].map(([who, lines]) => `\n${who}\n${lines.join("\n")}`)].join("\n");
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, body);
      announce(t("en.sentBack"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const title = data?.step ? localized(data.step.name, data.step.names, language) : t("en.title");
  const aboutLabel = (resource: string) => scopeLabel(resource, data?.board?.settings?.resourceNames, language);

  return (
    <div className="af en">
      <header className="af-head">
        <button type="button" className="af-back" onClick={onClose} aria-label={t("af.back")}>
          {t("af.backArrow")}
        </button>
        <div className="af-title">
          <h1>{title}</h1>
          <p>{data ? `${data.book} ${ctx?.ref || data.chapter}` : ""}</p>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("af.loading")}</p> : null}
      {stepDone && mode === "decision" ? <p className="round__done">{t("en.endorsed")}</p> : null}

      {data ? (
        <details className="en-texts" open={mode === "reporte"}>
          <summary>{t("en.readUnit")}</summary>
          {Object.keys(data.texts.tpl?.verses ?? data.texts.tps?.verses ?? {}).map(Number).sort((a, b) => a - b).map((verse) => (
            <div key={verse} className="en-verse">
              <strong>{data.chapter}:{verse}</strong>
              {TEXTS.map((resource) => (data.texts[resource]?.verses[verse] ? (
                <p key={resource}>
                  <span className="af-lbl">{aboutLabel(resource)}</span> {data.texts[resource]!.verses[verse]}
                </p>
              ) : null))}
            </div>
          ))}
        </details>
      ) : null}

      {data && mode === "reporte" && mine ? (
        <section className="af-card" aria-label={t("en.myReport")}>
          <h2 className="af-phrase">{t("en.myReport")}</h2>
          <p className="af-hint">{mine.delivered ? t("en.deliveredHint") : t("en.blindHint")}</p>
          {!questions.length ? <p className="af-stale">{t("ck.noQuestions")}</p> : null}
          <ul className="ck-questions">
            {questions.map((question) => (
              <li key={question.id} className="ck-question">
                <p className="ck-question__text">{localized(question.text, question.texts, language)}</p>
                <div className="ck-question__buttons">
                  {[true, false].map((value) => (
                    <Button key={String(value)} type="button" variant={mine.answers[question.id] === value ? "default" : "outline"} aria-pressed={mine.answers[question.id] === value} disabled={saving} onClick={() => setMine({ ...mine, answers: { ...mine.answers, [question.id]: value } })}>
                      {value ? t("ck.yes") : t("ck.no")}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <h3 className="en-sub">{t("en.concerns")}</h3>
          {mine.concerns.length ? (
            <ul className="en-concerns">
              {mine.concerns.map((c) => (
                <li key={c.id} data-kind={c.kind} data-withdrawn={c.withdrawn || undefined}>
                  <span>
                    <b>{c.kind === "objection" ? t("en.objection") : t("en.observation")}</b> · {aboutLabel(c.about)}{c.where ? ` · ${c.where}` : ""}: {c.text}
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMine({ ...mine, concerns: mine.concerns.map((x) => (x.id === c.id ? { ...x, withdrawn: !x.withdrawn } : x)) })}>
                    {c.withdrawn ? t("en.restore") : t("en.withdraw")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="af-hint">{t("en.noConcerns")}</p>
          )}
          {concern ? (
            <div className="ck-no" role="group" aria-label={t("en.addConcern")}>
              <div className="ck-no__outcomes">
                {(["observation", "objection"] as const).map((kind) => (
                  <button key={kind} type="button" aria-pressed={concern.kind === kind} onClick={() => setConcern({ ...concern, kind })}>
                    {kind === "objection" ? t("en.objectionLong") : t("en.observationLong")}
                  </button>
                ))}
              </div>
              <label className="af-lbl" htmlFor="en-about">{t("en.about")}</label>
              <select id="en-about" className="af-input" value={concern.about} onChange={(e) => setConcern({ ...concern, about: e.target.value })}>
                {resources.map((resource) => (
                  <option key={resource} value={resource}>{aboutLabel(resource)}</option>
                ))}
              </select>
              <label className="af-lbl" htmlFor="en-where">{t("en.where")}</label>
              <input id="en-where" className="af-input" value={concern.where} placeholder={`${data.chapter}:1`} onChange={(e) => setConcern({ ...concern, where: e.target.value })} />
              <label className="af-lbl" htmlFor="en-text">{t("en.what")}</label>
              <textarea id="en-text" className="af-textarea" rows={3} value={concern.text} onChange={(e) => setConcern({ ...concern, text: e.target.value })} />
              <div className="af-buttons">
                <Button
                  type="button"
                  disabled={!concern.text.trim()}
                  onClick={() => {
                    setMine({ ...mine, concerns: [...mine.concerns, { id: `${Date.now()}`, kind: concern.kind, about: concern.about, where: concern.where.trim() || undefined, text: concern.text.trim() }] });
                    setConcern(null);
                  }}
                >
                  {t("en.addIt")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConcern(null)}>
                  {t("af.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={() => setConcern({ kind: "observation", about: resources[0] ?? "", where: "", text: "" })}>
              {t("en.addConcern")}
            </Button>
          )}

          <div className="af-buttons">
            <Button type="button" size="lg" disabled={saving || questions.some((q) => mine.answers[q.id] === undefined)} onClick={() => void saveMine({ ...mine, delivered: true }, t("en.delivered"))}>
              {saving ? t("af.saving") : mine.delivered ? t("en.deliverAgain") : t("en.deliver")}
            </Button>
            {!mine.delivered ? (
              <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void saveMine(mine, t("en.draftSaved"))}>
                {t("en.saveDraft")}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {data && (mode === "decision" || mine?.delivered) ? (
        <section className="af-card" aria-label={t("en.committee")}>
          <h2 className="af-phrase">{t("en.committee")}</h2>
          <p className="en-tally">
            {t("en.tally").replace("{n}", String(tally.supporters.length)).replace("{of}", String(tally.delivered.length))}
          </p>
          {(mode === "decision" ? tally.delivered : others).map((report) => (
            <div key={report.by} className="en-report">
              <b>@{report.by}</b>
              <span>
                {questions.map((q) => `${localized(q.text, q.texts, language)} ${report.answers[q.id] ? t("ck.yes") : t("ck.no")}`).join(" · ")}
              </span>
              {report.concerns.filter((c) => !c.withdrawn).map((c) => (
                <p key={c.id} data-kind={c.kind}>
                  <b>{c.kind === "objection" ? t("en.objection") : t("en.observation")}</b> · {aboutLabel(c.about)}{c.where ? ` · ${c.where}` : ""}: {c.text}
                </p>
              ))}
            </div>
          ))}
          {mode === "decision" && !stepDone ? (
            <>
              <p className="af-hint">
                {tally.blocker === "few-reports" ? t("en.fewReports") : tally.blocker === "objections" ? t("en.blockedObjections") : tally.blocker === "no-majority" ? t("en.noMajority") : tally.consensus ? t("en.consensus") : t("en.byMajority")}
              </p>
              {canDecide ? (
                <div className="af-buttons">
                  <Button type="button" size="lg" disabled={saving || !tally.canEndorse} onClick={() => void endorse()}>
                    {t("en.endorse")}
                  </Button>
                  <Button type="button" size="lg" variant="outline" disabled={saving || (!tally.objections.length && !tally.observations.length)} onClick={() => void sendBack()}>
                    {t("en.sendBack")}
                  </Button>
                </div>
              ) : (
                <p className="af-hint">{t("en.onlyCoordinator")}</p>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
