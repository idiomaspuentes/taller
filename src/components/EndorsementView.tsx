import { toolHeading } from "./toolHeading";
import { ToolHeader } from "./ToolHeader";
import { StepAsk } from "./StepAsk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadPersonDocs, savePersonDoc } from "../dcs/checkStore";
import { loadTermArticle, loadTermTitles } from "../dcs/afinacionLoad";
import { loadUnitItems, loadUnitTexts, type ChecklistData, type ChecklistItem, type ChecklistText } from "../dcs/checklistLoad";
import type { TermKind } from "../domain/afinacionWords";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { unitVerses } from "../domain/unitReading";
import { UnitReading, type NewConcern, type PlacedConcern, type UnitHelps } from "./UnitReading";
import { commentOnIssue, listProjectOpenIssues } from "../dcs/issues";
import { listPmOrgTeamMembers, listPmOrgTeams } from "../dcs/persist";
import { correctionTitle } from "../domain/corrections";
import { askedFrom } from "../domain/extraWork";
import { teamKey } from "../domain/levels";
import { parseWorkOrderMarker } from "../domain/workOrder";
import { ConfirmDialog } from "./ConfirmDialog";
import { approveStepFromTool, completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { loadUnitToPublish, recordEndorsement, stageUnit, unitChanges, unitProblems, type UnitToPublish } from "../dcs/unitPublish";
import { stagingTasks } from "../domain/unitStage";
import { createCorrections } from "../dcs/corrections";
import type { ResourceChanges } from "../dcs/changesSince";
import { changesBetween } from "../domain/changesSince";
import { ChangeGroups } from "./ChangesView";
import { ownerTaskOf } from "../domain/resourceOwner";
import { tallyEndorsement, visibleReports, type Concern, type EndorsementReport } from "../domain/endorsement";
import { canConfirmForTeam, coordinatorsOf } from "../domain/levels";
import { localized } from "../domain/processes";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { stepMinAssignees } from "../domain/stepClaim";
import type { ChecklistQuestion, ProjectSettings } from "../domain/types";
import { scopeLabel } from "../domain/resourceNames";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT } from "../i18n/messages";
import { explainError } from "../dcs/userError";
import { deliverSharedSubtask } from "../dcs/deliverShared";
import { refComment } from "../domain/commentPlace";

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
const ENDORSED = ["tpl", "tps", "notas", "preguntas", "academia", "palabras"];

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
  /** The unit as it would be published: what the committee validates, next to what is published today. */
  const [unit, setUnit] = useState<UnitToPublish | null>(null);
  const [requests, setRequests] = useState<string[]>([]);
  /** The notes, the questions and the key terms of the unit: what is read under each verse. */
  const [helps, setHelps] = useState<UnitHelps>({});
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});
  const [articles, setArticles] = useState<Record<string, string | null>>({});
  /** The terms whose name or article was already asked for, so each is read once. */
  const asked = useRef(new Set<string>());
  const reportRef = useRef<HTMLElement>(null);
  /**
   * Where the person was reading when they went to their report, to go back to it. On a phone the report is under
   * the whole passage (twenty screens of it): «Ir a mi reporte» took them there and left no way back to the verse.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLDetailsElement>(null);
  const [leftAt, setLeftAt] = useState<{ root: number; read: number } | null>(null);
  /** The plan's settings once corrections were asked from here, and the items of every open subtarea of the project. */
  const [settings, setSettings] = useState<ProjectSettings | undefined>();
  const [openItems, setOpenItems] = useState<string[]>([]);

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
      // The helps of the unit are read apart, each kind on its own: one that fails does not hide the passage.
      setHelps({});
      for (const kind of ["notas", "preguntas", "palabras"] as const) {
        void loadUnitItems({ session, ctx: decoded, kind, pmConfig: loaded.pmConfig ?? DEFAULT_PM_CONFIG, board: loaded.board })
          .then((read) => read && setHelps((prev) => ({ ...prev, [kind]: read })))
          .catch(() => undefined);
      }
      // What the unit changes is read apart: a repository that fails to answer does not hide the passage.
      setUnit(null);
      void loadUnitToPublish({ session, ctx: decoded, resources: ENDORSED })
        .then(async (found) => {
          setUnit(found);
          // Whoever may write renews the validation branch on the way, so what Door43 shows is what is read here.
          // Somebody who may only read validates all the same: this screen compares for itself.
          const rule = stagingTasks(found.board ?? { teams: [] }).find((row) => row.task.id === decoded.taskId);
          if (unitProblems(found, { aligned: rule?.aligned ?? [], endorsement: null, needsEndorsement: false }).length) return;
          const staged = await stageUnit({ session, unit: found, note: decoded.issueUrl || `#${decoded.issueNumber}` }).catch(() => []);
          setRequests([...new Set(staged.flatMap((row) => (row.pullUrl ? [row.pullUrl] : [])))]);
        })
        .catch(() => undefined);
      // Which of the corrections asked from here are still being worked on.
      setSettings(undefined);
      if (decoded.pmOrg && loaded.board?.projectId) {
        void listProjectOpenIssues(session, decoded.pmOrg, loaded.board.projectId)
          .then((open) => setOpenItems(open.flatMap((issue) => parseWorkOrderMarker(issue.body ?? "")?.itemIds ?? [])))
          .catch(() => undefined);
      }
      const docs = await loadPersonDocs<EndorsementReport>(session, loaded.target, keyOf(decoded));
      const list = docs.map((row) => ({ ...row.doc, by: row.doc.by || row.login }));
      setReports(list);
      setMine(list.find((report) => report.by.toLowerCase() === session.username.toLowerCase()) ?? blank(session.username));
      if (decoded.pmOrg && decoded.issueNumber && decoded.stepId) {
        setStepDone(await stepIsDone({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId }).catch(() => false));
      }
    } catch (err) {
      setError(explainError(err));
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
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /** The endorsement is being kept, which reads every file of the unit: said while it lasts (it took 105 s). */
  const [endorsing, setEndorsing] = useState(false);
  async function endorse() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !ctx.stepId || !data) return;
    setSaving(true);
    setEndorsing(true);
    setError("");
    try {
      // What was endorsed is kept piece by piece, so publishing can tell whether anything changed afterwards.
      await recordEndorsement(session, await loadUnitToPublish({ session, ctx, resources: ENDORSED }), ctx.issueNumber);
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, t("en.endorsedNote").replace("{n}", String(tally.supporters.length)).replace("{of}", String(tally.delivered.length)).replace("{who}", tally.supporters.map((s) => `@${s}`).join(", ")));
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      setStepDone(true);
      // The decision is the last step: with it the subtarea is delivered (it works on the shared draft, see
      // `deliverSharedSubtask`). It was left for whoever decided to find «Entregar» on their list.
      if (data.board) await deliverSharedSubtask({ session, pmOrg: ctx.pmOrg, lang: ctx.lang, contentOrg: ctx.contentOrg, board: data.board, issueNumber: ctx.issueNumber }).catch(() => false);
      announce(t("en.endorsed"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
      setEndorsing(false);
    }
  }

  /**
   * The corrections already asked from this subtarea, and the concerns that have none yet. The button asked again
   * for the same ones (nothing was created twice) and the screen stayed as it was: whoever decided could not tell
   * whether anything had been sent, nor whether it had come back.
   */
  const corrections = useMemo(() => askedFrom(settings ?? data?.board?.settings, ctx?.issueNumber ?? 0, openItems), [settings, data, ctx, openItems]);
  const unsent = useMemo(
    () => [...tally.objections, ...tally.observations].filter((c) => ownerTaskOf(c.about, data?.board, data?.task) && !corrections.some(({ row }) => row.title === correctionTitle(c))),
    [tally, data, corrections],
  );
  /** The teams the corrections go to and how many people each has now: one emptied by a rotation sees nothing. */
  const [confirming, setConfirming] = useState(false);
  const [owners, setOwners] = useState<{ name: string; people: number }[]>([]);
  async function askToSend() {
    setOwners([]);
    setConfirming(true);
    if (!session || !ctx?.pmOrg || !data) return;
    const names = [...new Set(unsent.map((c) => ownerTaskOf(c.about, data.board, data.task)?.orgTeamName ?? "").filter(Boolean))];
    try {
      const teams = await listPmOrgTeams(session, ctx.pmOrg);
      const counted = await Promise.all(
        names.map(async (name) => {
          const team = teams.find((row) => teamKey(row.name) === teamKey(name));
          return team ? { name, people: (await listPmOrgTeamMembers(session, team.id)).length } : null;
        }),
      );
      setOwners(counted.filter((row): row is { name: string; people: number } => row !== null));
    } catch {
      /* the question is asked all the same, without the count */
    }
  }

  /**
   * Not endorsed yet: each concern becomes a subtarea of correction for the task that maintains what it is about,
   * and all of them are listed in the conversation of this unit for whoever coordinates those teams.
   */
  async function sendBack() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !data) return;
    setSaving(true);
    setError("");
    try {
      const byOwner = new Map<string, string[]>();
      for (const c of unsent) {
        const owner = ownerTaskOf(c.about, data.board, data.task);
        const who = coordinatorsOf(data.levelBook, owner?.orgTeamName).map((login) => `@${login}`).join(" ") || (owner?.name ?? c.about);
        byOwner.set(who, [...(byOwner.get(who) ?? []), `- ${c.kind === "objection" ? t("en.objection") : t("en.observation")}${c.where ? ` (${c.where})` : ""}: ${c.text} — @${c.by}`]);
      }
      const sent =
        data.board && data.task
          ? await createCorrections({
              session,
              pmOrg: ctx.pmOrg,
              board: settings ? { ...data.board, settings } : data.board,
              from: data.task,
              asks: unsent.map((c) => ({ about: c.about, where: c.where, text: c.text, by: c.by })),
              portionIds: ctx.portionIds,
              askedIn: ctx.issueNumber,
            })
          : null;
      const created = sent?.issues ?? [];
      if (sent) {
        setSettings(sent.settings);
        setOpenItems((prev) => [...prev, ...created.flatMap((issue) => parseWorkOrderMarker(issue.body ?? "")?.itemIds ?? [])]);
      }
      const body = [
        t("en.pendingNote"),
        ...[...byOwner].map(([who, lines]) => `\n${who}\n${lines.join("\n")}`),
        ...(created.length ? [`\n${t("en.correctionsNote").replace("{list}", created.map((issue) => `#${issue.number}`).join(", "))}`] : []),
      ].join("\n");
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, body);
      announce(created.length ? t("en.sentBack").replace("{n}", String(created.length)) : t("en.sentBackNone"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * An objection stands until whoever made it takes it back, and while one stands the committee cannot endorse. Its
   * author had handed in their report and had the task no longer on their list: once the corrections came back
   * nobody told them, and whoever decided had a button that stayed off. They are asked from here, in the
   * conversation of the task, where they get the way back to their report.
   */
  const [askedOf, setAskedOf] = useState<string[]>([]);
  async function askObjector(who: string) {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber) return;
    setSaving(true);
    setError("");
    try {
      const where = /^\s*(\d+:\d+)/.exec(tally.objections.find((c) => c.by === who)?.where ?? "")?.[1];
      const said = `@${who} ${tNow("en.askObjectorSaid")}`;
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, where && data ? refComment(data.book, where, said) : said);
      setAskedOf((prev) => [...prev, who]);
      announce(t("en.askedObjector").replace("{who}", who));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /** For each text and each help of the unit: the pieces that differ from what is published. */
  const changes = useMemo<ResourceChanges[]>(
    () =>
      (unit?.resources ?? [])
        .filter((r) => r.kind !== "articles" && r.draft)
        .map((r) => ({
          resource: r.resource,
          status: "open" as const,
          items: changesBetween({ filename: r.filepath, before: r.published?.text ?? "", now: unitChanges(unit!, r)?.[0]?.content ?? r.published?.text ?? "", range: unit!.range }),
        })),
    [unit],
  );

  // A term is named and read in the team's own words: its name when the terms of a verse are opened, its article
  // when that term is. Each once.
  const termOf = (row: ChecklistItem) => ({ termSlug: row.title, termKind: ((row.supportRef ?? "").split("/")[0] || "kt") as TermKind });
  const openTerms = (rows: ChecklistItem[]) => {
    if (!session || !ctx || !data) return;
    const fresh = rows.map(termOf).filter((term) => !asked.current.has(`t:${term.termSlug}`));
    if (!fresh.length) return;
    fresh.forEach((term) => asked.current.add(`t:${term.termSlug}`));
    void loadTermTitles(session, resolveSourcePackage(data.board?.settings), fresh, ctx)
      .then((titles) => setTermTitles((prev) => ({ ...prev, ...titles })))
      .catch(() => undefined);
  };
  const openArticle = (row: ChecklistItem) => {
    if (!session || !ctx || !data) return;
    const term = termOf(row);
    if (asked.current.has(`a:${term.termSlug}`)) return;
    asked.current.add(`a:${term.termSlug}`);
    void loadTermArticle(session, resolveSourcePackage(data.board?.settings), term, ctx, data.pmConfig ?? DEFAULT_PM_CONFIG)
      .catch(() => null)
      .then((article) => setArticles((prev) => ({ ...prev, [term.termSlug]: article?.trim() ? article : null })));
  };

  /**
   * A concern noted where it was read. It is kept at once, as the report's draft: whoever reads a unit for half an
   * hour and leaves has lost nothing.
   */
  const noteConcern = (concern: NewConcern) => {
    if (!mine) return;
    const next = { ...mine, concerns: [...mine.concerns, { id: `${Date.now()}`, ...concern }] };
    setMine(next);
    // A sandbox launch writes nothing on its own (see `SolverLaunchContext.lab`): there it waits for «Guardar».
    if (ctx?.lab && !ctx.labAllowWrite) return announce(t("ur.concernNoted"));
    void saveMine(next, t("ur.concernSaved"));
  };
  // What is shown where it was said: one's own always; the others' when they may be seen (see `visibleReports`).
  const placed: PlacedConcern[] =
    mode === "decision"
      ? tally.delivered.flatMap((report) => report.concerns.map((c) => ({ ...c, by: report.by })))
      : [...(mine?.concerns ?? []), ...others.flatMap((report) => report.concerns.map((c) => ({ ...c, by: report.by })))];
  const standing = (mine?.concerns ?? []).filter((c) => !c.withdrawn).length;

  const title = data?.step ? localized(data.step.name, data.step.names, language) : t("en.title");
  const aboutLabel = (resource: string) => scopeLabel(resource, data?.board?.settings?.resourceNames, language);

  return (
    <div className="af en" ref={rootRef}>
      <ToolHeader
        title={toolHeading(ctx, language, title).title}
        onBack={onClose}
        meta={toolHeading(ctx, language, title).where}
      />
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx} />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("af.loading")}</p> : null}
      {stepDone && mode === "decision" ? (
        // Decided: there is nothing left to do here, and the way out is said. It read «Aval concedido» over a screen
        // with no button at all.
        <div className="round__done round__done--leave">
          <p>{t("en.endorsed")}</p>
          <Button type="button" size="lg" variant="outline" onClick={onClose}>
            {t("fa.back")}
          </Button>
        </div>
      ) : null}

      {data ? (
        <details className="en-texts en-read" open={mode === "reporte"} ref={readRef}>
          <summary>{t("en.readUnit")}</summary>
          <UnitReading
            book={data.book}
            chapter={data.chapter}
            verses={unitVerses(ctx?.ref, data.chapter, [data.texts.tpl?.verses, data.texts.tps?.verses])}
            texts={data.texts}
            helps={helps}
            label={aboutLabel}
            termTitles={termTitles}
            articles={articles}
            onOpenTerms={openTerms}
            onOpenArticle={openArticle}
            concerns={placed}
            onConcern={mode === "reporte" && mine ? noteConcern : undefined}
            saving={saving}
          />
          {mode === "reporte" && mine ? (
            // On a phone the report is under the whole reading: it stays one press away while reading.
            <div className="en-jump">
              <p>{standing ? t(standing === 1 ? "en.jumpOne" : "en.jumpMany").replace("{n}", String(standing)) : t("en.jumpNone")}</p>
              <button
                type="button"
                className="btn"
                data-variant="outline"
                data-size="default"
                onClick={() => {
                  setLeftAt({ root: rootRef.current?.scrollTop ?? 0, read: readRef.current?.scrollTop ?? 0 });
                  reportRef.current?.scrollIntoView({ block: "start" });
                }}
              >
                {t("en.jump")}
              </button>
            </div>
          ) : null}
        </details>
      ) : null}

      {data ? (
        <details className="en-texts en-changes" open={mode === "reporte"}>
          <summary>{t("en.whatChanges")}</summary>
          <p className="af-hint">{t("en.whatChangesHint")}</p>
          {unit ? (
            <>
              <ChangeGroups groups={changes} board={data.board} />
              {unit.resources
                .filter((r) => r.kind === "articles" && (unitChanges(unit, r)?.length ?? 0) > 0)
                .map((r) => (
                  <p key={r.resource} className="af-hint">
                    {t("en.articles").replace("{name}", aboutLabel(r.resource)).replace("{n}", String(unitChanges(unit, r)?.length ?? 0))}
                  </p>
                ))}
              {requests.length ? (
                // One line, closed: they were six links in a row, each reading «Ver la solicitud en Door43», to a
                // committee that reads the unit here. Whoever opens them is told which repository each one is of.
                <details className="en-requests">
                  <summary>{t("en.requests").replace("{n}", String(requests.length))}</summary>
                  <ul>
                    {requests.map((url) => (
                      <li key={url}>
                        <a className="en-request" href={url} target="_blank" rel="noreferrer">
                          {url.replace(/^https?:\/\/[^/]+\//, "").split("/")[1] ?? t("en.openRequest")}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <p className="af-hint" aria-busy="true">{t("en.changesLoading")}</p>
          )}
        </details>
      ) : null}

      {data && mode === "reporte" && mine ? (
        <section ref={reportRef} className="af-card" aria-label={t("en.myReport")}>
          <h2 className="af-phrase">{t("en.myReport")}</h2>
          {leftAt ? (
            <Button
              type="button"
              variant="outline"
              className="en-back"
              onClick={() => {
                if (rootRef.current) rootRef.current.scrollTop = leftAt.root;
                if (readRef.current) readRef.current.scrollTop = leftAt.read;
                setLeftAt(null);
              }}
            >
              {t("en.backToReading")}
            </Button>
          ) : null}
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
            {mine.delivered ? (
              // Handed in: what is left to do here is to leave. The button that stood out said «Volver a entregar»,
              // as if something were still owed; that is for whoever changes an answer.
              <Button type="button" size="lg" onClick={onClose}>
                {t("fa.back")}
              </Button>
            ) : null}
            <Button type="button" size="lg" variant={mine.delivered ? "outline" : undefined} disabled={saving || questions.some((q) => mine.answers[q.id] === undefined)} onClick={() => void saveMine({ ...mine, delivered: true }, t("en.delivered"))}>
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
            {tally.delivered.length ? t("en.tally").replace("{n}", String(tally.supporters.length)).replace("{of}", String(tally.delivered.length)) : t("en.noReportsYet")}
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
              {canDecide && tally.blocker === "objections"
                ? [...new Set(tally.objections.map((c) => c.by ?? "").filter((who) => who && who.toLowerCase() !== (session?.username ?? "").toLowerCase()))].map((who) =>
                    askedOf.includes(who) ? (
                      <p key={who} className="af-hint" role="status">
                        {t("en.askedObjector").replace("{who}", who)}
                      </p>
                    ) : (
                      <Button key={who} type="button" size="lg" variant="outline" disabled={saving} onClick={() => void askObjector(who)}>
                        {t("en.askObjector").replace("{who}", who)}
                      </Button>
                    ),
                  )
                : null}
              {corrections.length ? (
                // What was asked and how it stands: sent, the screen stayed the same, and nothing said they were back.
                <div className="en-asked" role="status" data-back={!corrections.some((row) => row.open)}>
                  <p className="en-asked__head">
                    {corrections.some((row) => row.open)
                      ? t("en.askedOpen").replace("{done}", String(corrections.filter((row) => !row.open).length)).replace("{total}", String(corrections.length))
                      : t("en.askedBack")}
                  </p>
                  <ul>
                    {corrections.map(({ row, open }) => (
                      <li key={row.id} data-open={open}>
                        <span>{row.title}</span>
                        <span className="hub-place">{[data.board?.teams.find((task) => task.id === row.taskId)?.orgTeamName ?? "", open ? t("en.askedPending") : t("en.askedDone")].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                  {corrections.some((row) => row.open) ? (
                    <Button type="button" size="lg" onClick={onClose}>
                      {t("fa.back")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {canDecide ? (
                <div className="af-buttons">
                  <Button type="button" size="lg" variant={corrections.some((row) => row.open) ? "outline" : undefined} disabled={saving || !tally.canEndorse} onClick={() => void endorse()}>
                    {t("en.endorse")}
                  </Button>
                  {/* Only for what has not been asked yet: asked again, it did nothing that could be seen. */}
                  {unsent.length || !corrections.length ? (
                    <Button type="button" size="lg" variant="outline" disabled={saving || !unsent.length} onClick={() => void askToSend()}>
                      {t("en.sendBack")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="af-hint">{t("en.onlyCoordinator")}</p>
              )}
              {endorsing ? (
                <p className="af-hint" role="status">
                  {t("en.endorsing")}
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={unsent.length === 1 ? t("en.sendBackTitleOne") : t("en.sendBackTitle").replace("{n}", String(unsent.length))}
        text={[
          t("en.sendBackText"),
          ...owners.map((team) => (team.people ? t(team.people === 1 ? "en.sendBackTeamOne" : "en.sendBackTeam").replace("{team}", team.name).replace("{n}", String(team.people)) : t("en.sendBackTeamEmpty").replace("{team}", team.name))),
        ].join(" ")}
        yes={t("en.sendBackYes")}
        onYes={() => {
          setConfirming(false);
          void sendBack();
        }}
        onNo={() => setConfirming(false)}
      />
    </div>
  );
}
