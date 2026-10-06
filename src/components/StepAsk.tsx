import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { AlignmentMap } from "@usfm-tools/types";
import type { GtSession } from "../dcs/auth";
import { rememberedBoard } from "../dcs/notices";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { avoided, decisionsForVerse, groupsOfVerse, type GlossaryText, type VerseDecision } from "../domain/glossary";
import { teamKey } from "../domain/levels";
import { formatWhen, itemChecks, parseWhen, stepWideChecks } from "../domain/stepChecks";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { activeRules, ruleText } from "../domain/teamRules";
import { localizeName } from "../domain/templateNames";
import { portionRange } from "../domain/usfmEdit";
import type { ProjectTask, TaskStep } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { useGlossaryEntries } from "../useGlossary";
import { addRuleToTeam, answerTeamRule, useManagesTeamRules, useTeamRules } from "../useTeamRules";

/**
 * What a step asks of whoever does it: the process's description of the step, the things to keep in mind in it and
 * the rules the team gave itself.
 *
 * They are lines to read, each said where it is of use. What is true of the whole work (that nothing is missing,
 * the spelling) is said once, under «Qué se pide en …». What a passage calls for by its own words («you»: one
 * person or several) is said at the verse that has them, beside its source, when the person is on that verse. So is
 * what the glossary decided about a word of that verse: it used to wait on a screen of its own, for whoever went
 * looking, and nobody translating saw it.
 *
 * They used to be boxes to tick. The ticks closed nothing and nobody else saw them, and there were a great many:
 * the review of the notes of a short book (Jude, 159 notes) had 580 boxes. Opened inside a tool the list took the
 * whole screen of a phone and hid the work it was about.
 */

/** `by`: who gave the team that rule. `tag`: where the line comes from, when it is not the step or the team («glosario»). */
export type HintLine = { id: string; text: string; by?: string; tag?: string };

export function Hints({ lines, lead }: { lines: HintLine[]; lead?: string }) {
  if (!lines.length) return null;
  return (
    <div className="step-hints" data-item={lead ? "true" : undefined}>
      {lead ? <p className="step-hints__lead">{lead}</p> : null}
      <ul>
        {lines.map((line) => (
          <li key={line.id}>
            {line.text}
            {/* The space stays outside: who said it goes to the next line whole, without taking the rule's last word. */}
            {line.by || line.tag ? " " : null}
            {line.by ? <small className="step-ask__by">· @{line.by}</small> : line.tag ? <small className="step-ask__by">· {line.tag}</small> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The description of a step and what it asks to keep in mind through the whole of it. */
export function StepAskBody({ step }: { step: TaskStep }) {
  const language = useUiLanguage();
  const description = step.descriptions?.[language] ?? step.description;
  return (
    <>
      {description ? <p>{description}</p> : null}
      <Hints lines={stepWideChecks(step.checks ?? []).map((check) => ({ id: check.id, text: check.texts?.[language] ?? check.text }))} />
    </>
  );
}

export function stepAsks(step: TaskStep | undefined, language: string): boolean {
  return Boolean(step && ((step.descriptions?.[language] ?? step.description) || stepWideChecks(step.checks ?? []).length));
}

/**
 * The rules of the team that does the step, under the step's own: those that hold always. One that says which words
 * of the source call for it is said at the item that has them, with the step's (see `useItemHints`). `canAdd`: this
 * person is of the team, so they may add one; `issue` is the subtarea in hand, for the notice to whoever coordinates.
 */
export function TeamRuleChecks({ team, canAdd, issue }: { team: string | undefined; canAdd?: boolean; issue?: number }) {
  const t = useT();
  const language = useUiLanguage();
  const doc = useTeamRules(team);
  const manages = useManagesTeamRules(team);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const rules = stepWideChecks(doc ? activeRules(doc) : []);
  if (!team || (!rules.length && !canAdd && !manages)) return null;
  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    setFailed(false);
    try {
      await addRuleToTeam(team, draft, issue);
      setDraft("");
      setAdding(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="step-ask__team" aria-label={t("sa.teamRules")}>
      {rules.length ? <p className="step-ask__title">{t("sa.teamRules")}</p> : null}
      <Hints lines={rules.map((rule) => ({ id: `team-${rule.id}`, text: ruleText(rule, language), by: rule.by }))} />
      {canAdd && adding ? (
        // Whoever finds something worth keeping in mind writes it where they found it: it counts for the team at
        // once. Which words of the source call for it is for whoever coordinates to say, where rules are kept.
        <form
          className="step-ask__add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          {/* Left with nothing written, it goes back to being a line: whoever opened it by mistake needs no way out. */}
          <input className="af-input" value={draft} maxLength={240} placeholder={t("sa.addRule")} aria-label={t("sa.addRule")} disabled={saving} autoFocus onChange={(e) => setDraft(e.target.value)} onBlur={() => !draft.trim() && setAdding(false)} />
          <button type="submit" className="btn" data-size="sm" data-variant="outline" disabled={saving || !draft.trim()}>
            {saving ? t("sa.saving") : t("sa.add")}
          </button>
        </form>
      ) : canAdd ? (
        // A box to write a rule in stood open in every tool: it is one line to press, for whoever has one to add.
        <button type="button" className="step-ask__manage" onClick={() => setAdding(true)}>
          {t("sa.propose")}
        </button>
      ) : null}
      {failed ? <p className="af-stale">{t("sa.ruleError")}</p> : null}
      {/* Whoever coordinates the team or runs the project corrects and removes them on the team's own screen. */}
      {manages ? (
        <a className="step-ask__manage" href="#/organizacion">
          {t("sa.manageRules")}
        </a>
      ) : null}
    </section>
  );
}

/** Whether a person is of the team that does a task: in its Door43 team, listed in the plan, or running the project. */
export function isOfTeam(session: Pick<GtSession, "username" | "teams" | "canManage"> | null | undefined, task: Pick<ProjectTask, "orgTeamName" | "memberIds"> | undefined): boolean {
  if (!session || !task?.orgTeamName) return false;
  const me = session.username.trim().toLowerCase();
  return Boolean(session.canManage) || (task.memberIds ?? []).some((id) => id.toLowerCase() === me) || (session.teams ?? []).some((team) => teamKey(team.name) === teamKey(task.orgTeamName));
}

/** The step a tool was opened for and its task, from the launch (which subtarea, which step) and the plan of its project. */
export function useLaunchStep(session: GtSession | null | undefined, ctx: SolverLaunchContext | null | undefined): { task: ProjectTask; step: TaskStep } | null {
  const [found, setFound] = useState<{ task: ProjectTask; step: TaskStep } | null>(null);
  const { pmOrg, projectId, taskId, stepId, lang, contentOrg } = ctx ?? {};
  useEffect(() => {
    setFound(null);
    if (!session || !pmOrg || !projectId || !taskId || !stepId) return;
    let cancelled = false;
    const place = (board: { teams: ProjectTask[] } | null | undefined): boolean => {
      const task = board?.teams.find((row) => row.id === taskId);
      const step = task?.steps?.find((row) => row.id === stepId);
      if (!task || !step || cancelled) return false;
      setFound({ task, step });
      return true;
    };
    if (!place(rememberedBoard(session, pmOrg, projectId)))
      void loadAssignmentsFromDcs(session, pmOrg, lang ?? "", projectId, contentOrg ?? "")
        .then(place)
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.token, pmOrg, projectId, taskId, stepId, lang, contentOrg]); // eslint-disable-line react-hooks/exhaustive-deps
  return found;
}

/**
 * What one item (a verse, a note, a paragraph) calls for by its own words, among the checks of the step and the
 * rules of the team: given its source, the lines to show beside it. None for an item whose source is not known:
 * a reminder about a word is only worth saying where the word is.
 */
export function useItemHints(session: GtSession | null | undefined, ctx: SolverLaunchContext | null | undefined): (source: string | null | undefined) => HintLine[] {
  const language = useUiLanguage();
  const found = useLaunchStep(session, ctx);
  const doc = useTeamRules(found?.task.orgTeamName);
  return useCallback(
    (source) => {
      if (!found || !source?.trim()) return [];
      return [
        ...itemChecks(found.step.checks ?? [], source).map((check) => ({ id: check.id, text: check.texts?.[language] ?? check.text })),
        ...itemChecks(doc ? activeRules(doc) : [], source).map((rule) => ({ id: `team-${rule.id}`, text: ruleText(rule, language), by: rule.by })),
      ];
    },
    [found, doc, language],
  );
}

/** A decision of the glossary as a line beside a verse: «James» → «Jacobo». No «Santiago». */
export function decisionLine(decision: VerseDecision, t: (key: MessageKey) => string): HintLine {
  const { entry } = decision;
  let text = t("gl.at").replace("{english}", decision.english).replace("{rendering}", entry.rendering);
  const no = avoided(entry);
  if (no.length) text = t("gl.atAvoid").replace("{line}", text).replace("{avoid}", no.map((word) => `«${word}»`).join(", "));
  if (decision.decidedFor) text = t("gl.atFor").replace("{line}", text).replace("{term}", decision.decidedFor);
  return { id: `gl-${entry.id}`, text, tag: t(entry.status === "agreed" ? "gl.tag" : "gl.tagProposed") };
}

/** Which text a tool works on, as a decision of the glossary says where it holds. */
export function glossaryTextOf(resource: string | undefined): GlossaryText {
  return resource === "tpl" || resource === "tps" ? resource : "helps";
}

/**
 * What the glossary decided about the words of a verse, as lines to show beside it. `alignments`: the English text
 * that verse is translated from, aligned with the original: the word of the original under each English word is
 * what a decision is found by, so one taken on a word of the other English text is found here too.
 */
export function useVerseDecisions(
  session: GtSession | null | undefined,
  ctx: SolverLaunchContext | null | undefined,
  alignments: AlignmentMap | undefined,
): (chapter: number | undefined, verse: number, english?: string | null) => HintLine[] {
  const t = useT();
  const entries = useGlossaryEntries(session, ctx?.contentOrg, ctx?.lang);
  const text = glossaryTextOf(ctx?.resource);
  return useCallback(
    (chapter, verse, english) => {
      if (!entries.length || !chapter) return [];
      return decisionsForVerse(entries, groupsOfVerse(alignments, chapter, verse), text, english ?? "").map((decision) => decisionLine(decision, t));
    },
    [entries, alignments, text, t],
  );
}

/** Where the glossary opens from a tool: on the passage in hand, read in the English text being translated. */
export function glossaryHref(ctx: SolverLaunchContext): string {
  const range = ctx.chapter ? portionRange(ctx.ref, ctx.chapter) : null;
  if (!ctx.book || !ctx.chapter) return "#/glosario";
  return `#/glosario?libro=${encodeURIComponent(ctx.book)}&c=${ctx.chapter}&de=${range?.from ?? 1}&a=${range?.to ?? 200}${ctx.resource === "tps" ? "&texto=tps" : ""}`;
}

/** Inside a tool: what the step it was opened for asks, folded over the work. */
export function StepAsk({ session, ctx }: { session: GtSession | null | undefined; ctx: SolverLaunchContext | null | undefined }) {
  const t = useT();
  const language = useUiLanguage();
  const found = useLaunchStep(session, ctx);
  if (!found || !ctx) return null;
  const { task, step } = found;
  if (!stepAsks(step, language) && !task.orgTeamName) return null;
  return (
    <details className="step-ask">
      <summary>{t("tb.howStep").replace("{step}", step.names?.[language] ?? localizeName(step.name, language))}</summary>
      <StepAskBody step={step} />
      <TeamRuleChecks team={task.orgTeamName} canAdd={isOfTeam(session, task)} issue={ctx.issueNumber} />
      {ctx.lab ? null : (
        // The glossary beside the rules: both are what the team decided, and on a phone its only way in was a small
        // link among the file's details. In another tab, so the work in hand stays as it is.
        <a className="step-ask__manage step-ask__glossary" href={glossaryHref(ctx)} target="_blank" rel="noreferrer">
          {t(ctx.chapter ? "gl.openPassage" : "gl.openSearch")}
        </a>
      )}
    </details>
  );
}

/**
 * Every rule of a team, for whoever coordinates it: correct one, remove one or add one at any time, not only while
 * it is new. The same shape as the checks of a step: a line each, saying what it asks and when it shows; touching a
 * line opens it, alone, to edit.
 */
export function TeamRulesPanel({ team, canEdit }: { team: string; canEdit: boolean }) {
  const t = useT();
  const language = useUiLanguage();
  const doc = useTeamRules(team);
  /** The rule being edited (`new` for one not yet added), with what was typed. */
  const [open, setOpen] = useState<{ id: string; text: string; when: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const rules = doc ? activeRules(doc) : [];
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await work();
      setOpen(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (!rules.length && !canEdit) return null;
  const fields = (
    <>
      <label className="ce-field">
        <span>{t("st.checkText")}</span>
        <textarea className="af-textarea" rows={3} value={open?.text ?? ""} maxLength={240} disabled={!canEdit || busy} autoFocus={open?.id === "new"} onChange={(e) => open && setOpen({ ...open, text: e.target.value })} />
      </label>
      <label className="ce-field">
        <span>{t("st.checkWhenLabel")}</span>
        <input className="af-input" value={open?.when ?? ""} disabled={!canEdit || busy} placeholder={t("st.checkWhenExample")} autoCapitalize="none" spellCheck={false} onChange={(e) => open && setOpen({ ...open, when: e.target.value })} />
        <small>{t("st.checkWhenHint")}</small>
      </label>
    </>
  );
  return (
    <section className="team-rules" aria-label={t("sa.teamRules")}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sa.teamRules")}</h3>
      <div className="ce">
        {rules.length ? (
          <ol className="ce-list">
            {rules.map((rule) => {
              const isOpen = open?.id === rule.id;
              return (
                <li key={rule.id} className="ce-item" data-open={isOpen ? "true" : undefined}>
                  <button type="button" className="ce-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : { id: rule.id, text: ruleText(rule, language), when: formatWhen(rule.when) })}>
                    {isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                    <span className="ce-row__text">
                      {ruleText(rule, language)}
                      <small className="step-ask__by">
                        {rule.by ? ` · @${rule.by}` : ""}
                        {rule.reviewedBy ? "" : ` · ${t("sa.ruleNew")}`}
                      </small>
                    </span>
                    <span className="ce-row__when" data-always={rule.when?.length ? undefined : "true"}>
                      {rule.when?.length ? t("st.checkIf").replace("{words}", formatWhen(rule.when)) : t("st.checkAlways")}
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="ce-edit">
                      {fields}
                      {canEdit ? (
                        <div className="ce-actions">
                          <button type="button" className="ce-remove" disabled={busy} onClick={() => void run(() => answerTeamRule(team, rule.id, { keep: false }))}>
                            <Trash2 size={16} aria-hidden /> {t("st.checkRemoveShort")}
                          </button>
                          <button type="button" className="btn ce-done" data-size="sm" disabled={busy || !open.text.trim()} onClick={() => void run(() => answerTeamRule(team, rule.id, { keep: true, text: open.text, when: parseWhen(open.when) ?? [] }))}>
                            {busy ? t("sa.saving") : t("mt.ruleSave")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="pe-hint">{t("sa.noRules")}</p>
        )}
        {canEdit && open?.id === "new" ? (
          <div className="ce-list">
            <div className="ce-edit ce-edit--new">
              {fields}
              <div className="ce-actions">
                <button type="button" className="btn" data-size="sm" data-variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
                  {t("pj.cancel")}
                </button>
                <button type="button" className="btn ce-done" data-size="sm" disabled={busy || !open.text.trim()} onClick={() => void run(() => addRuleToTeam(team, open.text, undefined, parseWhen(open.when)))}>
                  {busy ? t("sa.saving") : t("sa.add")}
                </button>
              </div>
            </div>
          </div>
        ) : canEdit ? (
          <button type="button" className="pe-add" onClick={() => setOpen({ id: "new", text: "", when: "" })}>
            <Plus size={14} aria-hidden /> {t("sa.addRuleShort")}
          </button>
        ) : null}
      </div>
      {failed ? <p className="af-stale">{t("sa.ruleError")}</p> : null}
    </section>
  );
}
