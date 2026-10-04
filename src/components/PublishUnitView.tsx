import { markPhaseIfClosed } from "../dcs/phaseMarks";
import { toolHeading } from "./toolHeading";
import { ToolHeader } from "./ToolHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { closeIssue, commentOnIssue } from "../dcs/issues";
import { loadGlossary, saveBookRenderings } from "../dcs/glossaryStore";
import { getPmIssue } from "../dcs/portionPr";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { glossaryNotices, loadEndorsement, loadUnitToPublish, publishedTextsOf, publishUnit, unitChanges, unitProblems, type GlossaryNotice, type PublishOutcome, type UnitToPublish } from "../dcs/unitPublish";
import { canConfirmForTeam, coordinatorsOf } from "../domain/levels";
import { localized } from "../domain/processes";
import { ownerTaskOf } from "../domain/resourceOwner";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { isStepDone, parseTaskProgressMarker } from "../domain/taskProgress";
import { scopeLabel } from "../domain/resourceNames";
import type { UnitCheckId, UnitProblem } from "../domain/unitPublish";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { explainError } from "../dcs/userError";

type Props = {
  ctxEncoded: string;
  /** `comprobar`: the checks before publishing. `publicar`: put the unit on the published branch. */
  mode: "comprobar" | "publicar";
  /** Texts that must be aligned to be published (the process says which). */
  aligned: string[];
  /** Article resources published with the unit, besides what the task's rules name (the process says which). */
  articles: string[];
  /** The unit must be what a committee endorsed. A process without a committee says no. */
  needsEndorsement: boolean;
  onClose: () => void;
  announce: (msg: string) => void;
};

const PROBLEM_KEY: Record<UnitCheckId, MessageKey> = {
  "draft-missing": "pu.p.draftMissing",
  "usfm-invalid": "pu.p.usfmInvalid",
  "verses-missing": "pu.p.versesMissing",
  "verses-empty": "pu.p.versesEmpty",
  "conflict-marks": "pu.p.conflictMarks",
  "not-aligned": "pu.p.notAligned",
  "tsv-header": "pu.p.tsvHeader",
  "rows-none": "pu.p.rowsNone",
  "row-id": "pu.p.rowId",
  "row-id-repeated": "pu.p.rowIdRepeated",
  "row-empty": "pu.p.rowEmpty",
  "row-quote": "pu.p.rowQuote",
  "row-support": "pu.p.rowSupport",
  "changed-since-endorsement": "pu.p.changed",
  "not-endorsed": "pu.p.notEndorsed",
  "article-empty": "pu.p.articleEmpty",
};
const OUTCOME_KEY: Record<PublishOutcome["status"], MessageKey> = { published: "pu.o.published", unchanged: "pu.o.unchanged", waiting: "pu.o.waiting", nothing: "pu.o.nothing" };

/**
 * Publishing one unit, nearly by itself: the checks run when the screen opens, and a step that passes them is
 * completed without anybody marking it. A person only steps in when a check fails (it goes to whoever maintains
 * that resource) or to confirm the publication.
 */
export function PublishUnitView({ ctxEncoded, mode, aligned, articles, needsEndorsement, onClose, announce }: Props) {
  const articlesKey = articles.join(",");
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [unit, setUnit] = useState<UnitToPublish | null>(null);
  const [problems, setProblems] = useState<UnitProblem[] | null>(null);
  const [outcomes, setOutcomes] = useState<PublishOutcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [stepDone, setStepDone] = useState(false);
  const [told, setTold] = useState(false);
  /** Where the unit departs from agreed glossary entries: shown, never a reason to stop. */
  const [notices, setNotices] = useState<GlossaryNotice[]>([]);
  const alignedKey = aligned.join(",");

  /** The step is over: mark it, and deliver the subtarea when every step of it was done by a tool. */
  const finishStep = useCallback(
    async (decoded: SolverLaunchContext, loaded: UnitToPublish) => {
      if (!session || !decoded.pmOrg || !decoded.issueNumber || !decoded.stepId) return;
      await completeStepFromTool({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId });
      setStepDone(true);
      const steps = loaded.task?.steps ?? [];
      if (!steps.length || !steps.every((step) => step.closing === "automatic")) return;
      const issue = await getPmIssue(session, decoded.pmOrg, decoded.issueNumber);
      const progress = parseTaskProgressMarker(issue.body);
      if (issue.state === "open" && steps.every((step) => isStepDone(progress, step.id))) {
        await closeIssue(session, decoded.pmOrg, decoded.issueNumber);
        // The last subtarea of the phase leaves its mark on the drafts; it never holds the step back.
        if (loaded.board) await markPhaseIfClosed({ session, pmOrg: decoded.pmOrg, lang: decoded.lang, contentOrg: decoded.contentOrg, board: loaded.board, issue }).catch(() => null);
      }
    },
    [session],
  );

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) return setError(tNow("af.badLink"));
    setCtx(decoded);
    if (!session?.token) return setError(tNow("af.expired"));
    setBusy(true);
    setError("");
    try {
      // Which resources make the unit comes from the rules of the task that publishes it.
      const peek = await loadUnitToPublish({ session, ctx: decoded, resources: [] });
      const wanted = [...new Set([...(peek.task?.rules ?? []).map((rule) => rule.resource as string), ...articlesKey.split(",").filter(Boolean)])];
      const loaded = await loadUnitToPublish({ session, ctx: decoded, resources: wanted.length ? wanted : ["tpl", "tps", "notas", "preguntas"] });
      setUnit(loaded);
      const endorsement = needsEndorsement ? await loadEndorsement(session, loaded).catch(() => null) : null;
      const found = unitProblems(loaded, { aligned: alignedKey.split(",").filter(Boolean), endorsement: endorsement?.fingerprints ?? null, needsEndorsement });
      setProblems(found);
      if (decoded.contentOrg && decoded.lang) {
        void loadGlossary(session, decoded.contentOrg, decoded.lang)
          .then((glossary) => setNotices(glossaryNotices(loaded, glossary.entries)))
          .catch(() => setNotices([]));
      }
      const done = decoded.pmOrg && decoded.issueNumber && decoded.stepId ? await stepIsDone({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId }).catch(() => false) : false;
      setStepDone(done);
      // The checks step needs nobody: when everything passes it completes itself.
      if (mode === "comprobar" && !found.length && !done) {
        await finishStep(decoded, loaded);
        announce(tNow("pu.checksPassed"));
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session, mode, alignedKey, articlesKey, needsEndorsement, finishStep, announce]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (resource: string) => scopeLabel(resource, unit?.board?.settings?.resourceNames, language);
  const unitName = unit ? `${unit.book} ${ctx?.ref || unit.chapter}` : "";
  const me = (session?.username ?? "").toLowerCase();
  const canPublish = Boolean(session) && (session!.canManage || canConfirmForTeam(unit?.levelBook, unit?.task?.orgTeamName, me));
  const title = unit?.step ? localized(unit.step.name, unit.step.names, language) : t("pu.title");
  /** What publishing would change, per resource. */
  const plan = useMemo(
    () => (unit ? unit.resources.map((r) => ({ resource: r.resource, changes: unitChanges(unit, r)?.length ?? 0, articles: r.kind === "articles", hasDraft: Boolean(r.draft) })) : []),
    [unit],
  );
  const line = (problem: UnitProblem) =>
    `${problem.resource ? `${label(problem.resource)}: ` : ""}${t(PROBLEM_KEY[problem.id])}${problem.where.length ? ` ${problem.where.slice(0, 12).join(", ")}${problem.where.length > 12 ? "…" : ""}` : ""}`;

  /** A failed check is about content: it goes to whoever maintains that resource, in the conversation of this unit. */
  async function tellOwners() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !unit || !problems?.length) return;
    setWorking(true);
    setError("");
    try {
      const byOwner = new Map<string, string[]>();
      for (const problem of problems) {
        const owner = ownerTaskOf(problem.resource, unit.board, unit.task);
        const who = coordinatorsOf(unit.levelBook, owner?.orgTeamName).map((login) => `@${login}`).join(" ") || owner?.name || t("pu.team");
        byOwner.set(who, [...(byOwner.get(who) ?? []), `- ${line(problem)}`]);
      }
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, [t("pu.stoppedNote").replace("{unit}", unitName), ...[...byOwner].map(([who, lines]) => `\n${who}\n${lines.join("\n")}`)].join("\n"));
      setTold(true);
      announce(t("pu.told"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setWorking(false);
    }
  }

  async function publish() {
    if (!session || !ctx || !unit) return;
    setWorking(true);
    setError("");
    try {
      const result = await publishUnit({ session, unit, note: ctx.issueUrl || `#${ctx.issueNumber}` });
      setOutcomes(result);
      if (result.some((row) => row.status === "waiting")) {
        announce(t("pu.waiting"));
        return;
      }
      if (ctx.pmOrg && ctx.issueNumber) {
        const what = result.filter((row) => row.status !== "nothing").map((row) => `${label(row.resource)}: ${t(OUTCOME_KEY[row.status])}`).join(" · ");
        await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, t("pu.publishedNote").replace("{unit}", unitName).replace("{what}", what));
        await finishStep(ctx, unit);
      }
      // The glossary's «how it was translated before» covers every published book: renew this book's part. It is
      // an aid, so failing to write it never undoes a publication.
      if (ctx.contentOrg && ctx.lang) await saveBookRenderings(session, ctx.contentOrg, ctx.lang, unit.book, publishedTextsOf(unit)).catch((err) => console.warn("glossary index not renewed", err));
      announce(t("pu.published"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="af pu">
      <ToolHeader
        title={toolHeading(ctx, language, title).title}
        onBack={onClose}
        meta={toolHeading(ctx, language, title).where}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("pu.loading")}</p> : null}

      {unit && problems ? (
        <section className="af-card" aria-label={t("pu.checks")}>
          <h2 className="af-phrase">{t("pu.checks")}</h2>
          {problems.length ? (
            <>
              <p className="af-stale">{t("pu.stopped")}</p>
              <ul className="pu-list">
                {problems.map((problem, index) => (
                  <li key={index} data-ok="false">
                    <span aria-hidden>✗</span> {line(problem)}
                  </li>
                ))}
              </ul>
              <p className="af-hint">{t("pu.stoppedHint")}</p>
              <div className="af-buttons">
                <Button type="button" variant="outline" disabled={working || told} onClick={() => void tellOwners()}>
                  {told ? t("pu.told") : t("pu.tell")}
                </Button>
                <Button type="button" variant="secondary" disabled={working || busy} onClick={() => void load()}>
                  {t("pu.again")}
                </Button>
              </div>
            </>
          ) : (
            <ul className="pu-list">
              {unit.resources.map((r) => (
                <li key={r.resource} data-ok="true">
                  <span aria-hidden>✓</span> {label(r.resource)}: {r.draft ? (r.kind === "articles" ? t("pu.okArticles").replace("{n}", String(r.articles?.length ?? 0)) : t(r.kind === "usfm" ? "pu.okText" : "pu.okTable")) : t("pu.o.nothing")}
                </li>
              ))}
              {needsEndorsement ? (
                <li data-ok="true">
                  <span aria-hidden>✓</span> {t("pu.okEndorsed")}
                </li>
              ) : null}
            </ul>
          )}
          {mode === "comprobar" && stepDone ? <p className="round__done">{t("pu.checksPassed")}</p> : null}
        </section>
      ) : null}

      {notices.length ? (
        <section className="af-card" aria-label={t("pu.glossary")}>
          <h2 className="af-phrase">{t("pu.glossary")}</h2>
          <p className="af-hint">{t("pu.glossaryHint")}</p>
          <ul className="pu-list">
            {notices.map((notice) => (
              <li key={`${notice.resource}-${notice.entry.id}`}>
                {label(notice.resource)} · {notice.entry.lemma}: {t("pu.glossaryAgreed").replace("{rendering}", notice.entry.rendering)}{" "}
                {notice.found.map((row) => `«${row.rendering}» (${row.examples.join(", ")})`).join("; ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {unit && problems && mode === "publicar" ? (
        <section className="af-card" aria-label={t("pu.publishing")}>
          <h2 className="af-phrase">{t("pu.publishing")}</h2>
          {stepDone && !outcomes ? <p className="round__done">{t("pu.published")}</p> : null}
          {!outcomes && !stepDone ? (
            <>
              <ul className="pu-list">
                {plan.map((row) => (
                  <li key={row.resource}>
                    {label(row.resource)}: {!row.hasDraft ? t("pu.o.nothing") : !row.changes ? t("pu.o.unchanged") : row.articles ? t("pu.willChangeArticles").replace("{n}", String(row.changes)) : t("pu.willChange")}
                  </li>
                ))}
              </ul>
              {problems.length ? (
                <p className="af-hint">{t("pu.fixFirst")}</p>
              ) : canPublish ? (
                <Button type="button" size="lg" disabled={working} onClick={() => void publish()}>
                  {working ? t("pu.working") : t("pu.publish")}
                </Button>
              ) : (
                <p className="af-hint">{t("pu.onlyConfirmer")}</p>
              )}
            </>
          ) : null}
          {outcomes ? (
            <>
              <ul className="pu-list">
                {outcomes.map((row) => (
                  <li key={row.resource} data-ok={row.status === "waiting" ? "false" : "true"}>
                    {label(row.resource)}: {t(OUTCOME_KEY[row.status])}
                    {row.pullUrl && row.status === "waiting" ? (
                      <>
                        {" · "}
                        <a href={row.pullUrl} target="_blank" rel="noreferrer">
                          {t("pu.openRequest")}
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              {outcomes.some((row) => row.status === "waiting") ? (
                <>
                  <p className="af-stale">{t("pu.waiting")}</p>
                  <Button type="button" variant="secondary" disabled={working} onClick={() => void publish()}>
                    {t("pu.again")}
                  </Button>
                </>
              ) : (
                <p className="round__done">{t("pu.published")}</p>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
