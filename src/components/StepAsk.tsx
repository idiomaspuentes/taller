import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { AlignmentMap } from "@usfm-tools/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { GtSession } from "../dcs/auth";
import { rememberedBoard } from "../dcs/notices";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { extraItemId } from "../domain/extraWork";
import { avoided, decisionsForText, decisionsForVerse, groupsOfVerse, type GlossaryText, type VerseDecision } from "../domain/glossary";
import { teamKey } from "../domain/levels";
import { formatWhen, itemChecks, parseWhen, stepWideChecks } from "../domain/stepChecks";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { activeRules, ruleText } from "../domain/teamRules";
import { localizeName } from "../domain/templateNames";
import { stepPurpose } from "../domain/processes";
import { setAboutEntry, setIntroEntry } from "./introSlot";
import { Button } from "@/components/ui/button";
import { portionRange } from "../domain/usfmEdit";
import type { ProjectSettings, ProjectTask, TaskStep } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { useGlossaryEntries } from "../useGlossary";
import { bookLabel } from "../domain/books";
import { loadIntroNotes } from "../domain/referenceResources";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { addRuleToTeam, answerTeamRule, useManagesTeamRules, useTeamRules } from "../useTeamRules";
import { LoadingState } from "./LoadingState";
import { draftLabelOf, HelpVersions } from "./HelpVersions";
import { HelpMessages } from "./HelpMessages";
import { readTeamNotes, type TeamNote } from "../dcs/teamHelps";
import { loadPmConfig } from "../dcs/issues";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { sourcePackageLang, resolveSourcePackage } from "../domain/sourcePackage";
import type { AssignmentsDoc } from "../domain/types";

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

const hintList = (lines: HintLine[]) => (
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
);

/** What the hints of an item are about, to read them against: its source and what has been written for it. */
export type HintContext = { ref?: string; sourceName?: string; source?: string; translation?: string };

/**
 * Beside an item (a verse, a note) the hints are one line: how many there are and the first of them, which is what
 * the glossary decided when it decided something. Laid out whole they took more of a phone's screen than the verse
 * and its source together. A touch opens them over the work, with what they are read against: the source, the
 * translation as it stands, and the list.
 */
function ItemHints({ lines, lead, context }: { lines: HintLine[]; lead: string; context?: HintContext }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="step-hints" data-item="true">
      <button type="button" className="step-hints__open" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="step-hints__lead">{lead}</span>
        <span className="step-hints__n">{lines.length}</span>
        <span className="step-hints__brief">{lines[0]!.text}</span>
        <ChevronRight size={14} aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fix-sheet hint-sheet" aria-label={lead}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{lead}</DialogTitle>
            {context?.ref ? <p className="ws-meta">{context.ref}</p> : null}
          </header>
          <div className="fx-body">
            {context?.source ? (
              <section className="hint-sheet__text">
                <span className="af-lbl">{context.sourceName ? t("sa.sourceNamed").replace("{name}", context.sourceName) : t("sa.source")}</span>
                <p>{context.source}</p>
              </section>
            ) : null}
            {context ? (
              <section className="hint-sheet__text" data-own="true">
                <span className="af-lbl">{t("sa.translation")}</span>
                <p>{context.translation?.trim() ? context.translation : <em>{t("sa.notYet")}</em>}</p>
              </section>
            ) : null}
            <div className="step-hints">{hintList(lines)}</div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Hints({ lines, lead, context }: { lines: HintLine[]; lead?: string; context?: HintContext }) {
  if (!lines.length) return null;
  if (lead) return <ItemHints lines={lines} lead={lead} context={context} />;
  return (
    <div className="step-hints">
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

/**
 * The description of a step and what it asks to keep in mind through the whole of it. A description of several lines
 * is a sequence (how a round is answered) and reads as numbered steps. `description` overrides the step's own.
 */
export function StepAskBody({ step, description: given }: { step: TaskStep; description?: string }) {
  const language = useUiLanguage();
  const description = given ?? step.descriptions?.[language] ?? step.description;
  const lines = (description ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (
    <>
      {lines.length > 1 ? (
        <ol className="step-ask__steps">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      ) : description ? (
        <p>{description}</p>
      ) : null}
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
export function TeamRuleChecks({ team, canAdd, issue, inSheet }: { team: string | undefined; canAdd?: boolean; issue?: number; inSheet?: boolean }) {
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
      {rules.length || inSheet ? <p className="step-ask__title">{t("sa.teamRules")}</p> : null}
      {inSheet && !rules.length ? <p className="step-ask__none">{t("sa.noRulesYet")}</p> : null}
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
      {/* Inside a tool's sheet only adding is offered: correcting the rules is done where the team is kept. */}
      {manages && !inSheet ? (
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
export function useLaunchStep(session: GtSession | null | undefined, ctx: SolverLaunchContext | null | undefined): { task: ProjectTask; step: TaskStep; asked?: string } | null {
  const [found, setFound] = useState<{ task: ProjectTask; step: TaskStep; asked?: string } | null>(null);
  const { pmOrg, projectId, taskId, stepId, lang, contentOrg } = ctx ?? {};
  const items = (ctx?.itemIds ?? []).join(" ");
  useEffect(() => {
    setFound(null);
    if (!session || !pmOrg || !projectId || !taskId || !stepId) return;
    let cancelled = false;
    const place = (board: { teams: ProjectTask[]; settings?: ProjectSettings } | null | undefined): boolean => {
      const task = board?.teams.find((row) => row.id === taskId);
      const step = task?.steps?.find((row) => row.id === stepId);
      if (!task || !step || cancelled) return false;
      // A subtarea added by hand (a correction a committee asked for) is about what its title says.
      const asked = (board?.settings?.extraWork ?? []).find((row) => items.split(" ").includes(extraItemId(row.id)))?.title;
      setFound({ task, step, ...(asked ? { asked } : {}) });
      return true;
    };
    if (!place(rememberedBoard(session, pmOrg, projectId)))
      void loadAssignmentsFromDcs(session, pmOrg, lang ?? "", projectId, contentOrg ?? "")
        .then(place)
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.token, pmOrg, projectId, taskId, stepId, lang, contentOrg, items]); // eslint-disable-line react-hooks/exhaustive-deps
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

/** How many decisions are said beside one note or paragraph: an article about key terms would bring a screenful. */
const BESIDE_TEXT = 5;

/**
 * What the glossary decided about the English words a note, a question or a paragraph of an article says, as lines
 * to show beside it. Such a text is not aligned with the original: the entry is what ties its word to it.
 */
export function useTextDecisions(session: GtSession | null | undefined, ctx: SolverLaunchContext | null | undefined): (text: string | null | undefined) => HintLine[] {
  const t = useT();
  const entries = useGlossaryEntries(session, ctx?.contentOrg, ctx?.lang);
  return useCallback(
    (text) => {
      if (!entries.length || !text?.trim()) return [];
      const found = decisionsForText(entries, text);
      const lines = found.slice(0, BESIDE_TEXT).map((decision) => decisionLine(decision, t));
      return found.length > BESIDE_TEXT ? [...lines, { id: "gl-more", text: t("gl.atMore").replace("{n}", String(found.length - BESIDE_TEXT)) }] : lines;
    },
    [entries, t],
  );
}

/** Is what a tool works on a passage of the book? An article belongs to a book's project, but is of no verse. */
const ofPassage = (ctx: SolverLaunchContext): boolean => Boolean(ctx.book && ctx.chapter) && ctx.resource !== "academia" && ctx.resource !== "palabras";

/** Where the glossary opens from a tool: on the passage in hand, read in the English text being translated; to be searched, from an article. */
export function glossaryHref(ctx: SolverLaunchContext): string {
  const range = ctx.chapter ? portionRange(ctx.ref, ctx.chapter) : null;
  if (!ofPassage(ctx)) return "#/glosario";
  return `#/glosario?libro=${encodeURIComponent(ctx.book)}&c=${ctx.chapter}&de=${range?.from ?? 1}&a=${range?.to ?? 200}${ctx.resource === "tps" ? "&texto=tps" : ""}`;
}

/**
 * The introduction of the book and the one of the chapter in hand, folded over the work in every tool: what the
 * book is, who wrote it and to whom, what the chapter is about. They were read once, in «Estudiar», and whoever
 * aligned or reviewed a week later had no way back to them. Read when they are opened, and in the team's own
 * language when the team has translated them. They scroll inside their own height: a book's introduction is
 * several screens long, and would hide the work it is there to help with.
 *
 * A tool that has tabs of its own gives them one (`PassageIntroText`, and `intro={false}` to `StepAsk`): there
 * they are a place to go to, beside the work, and not one more line folded over it.
 */
function PassageIntro({ session, ctx }: { session: GtSession | null | undefined; ctx: SolverLaunchContext }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Not a fold over the work: a row of the tool's «Más» (`introSlot.ts`), and a sheet over the work when chosen.
  // It was the one fold left at the top of every tool, pushing the work down (16 October).
  useEffect(() => {
    if (!ctx.book) return;
    const entry = { open: () => setOpen(true) };
    setIntroEntry(entry);
    return () => setIntroEntry(null);
  }, [ctx.book]);
  if (!ctx.book) return null;
  const title = t(ctx.chapter ? "sa.intro" : "sa.introBook");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="fix-sheet hint-sheet af-article-sheet" aria-label={title}>
        <header className="fx-head">
          <DialogTitle className="fx-title">{title}</DialogTitle>
        </header>
        <div className="fx-body af-article-read">{open ? <PassageIntroText session={session} ctx={ctx} /> : null}</div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The introductions themselves, read when this is shown. With `drafts`, the team's translation is read too, its
 * draft said to be one, beside the source's, and what to improve in it can be left for whoever harmonizes it
 * (18 October); without, the team's when published, else the source's.
 */
export function PassageIntroText({ session, ctx, drafts, board }: { session: GtSession | null | undefined; ctx: SolverLaunchContext; drafts?: boolean; board?: AssignmentsDoc | null }) {
  const t = useT();
  const language = useUiLanguage();
  const [intro, setIntro] = useState<{ book: string; chapter: string } | null | undefined>(undefined);
  const [team, setTeam] = useState<{ book?: TeamNote; chapter?: TeamNote } | null>(null);
  useEffect(() => {
    if (!session || !ctx.book) return;
    let alive = true;
    setIntro(undefined);
    // Beside the team's draft the source is read as it is; alone, the team's published text comes first.
    void loadIntroNotes(session, ctx.book, ctx.chapter, drafts ? undefined : { contentOrg: ctx.contentOrg, lang: ctx.lang })
      .then((found) => alive && setIntro(found))
      .catch(() => alive && setIntro(null));
    return () => {
      alive = false;
    };
  }, [session?.token, ctx.book, ctx.chapter, ctx.contentOrg, ctx.lang, drafts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!drafts || !session || !ctx.book) return;
    let alive = true;
    void (async () => {
      const pmConfig = ctx.pmOrg ? await loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG) : DEFAULT_PM_CONFIG;
      const notes = await readTeamNotes({ session, ctx, pmConfig, board: board ?? null }).catch(() => null);
      if (alive) setTeam(notes ? { book: notes.byRef["front:intro"], chapter: notes.byRef[`${ctx.chapter}:intro`] } : null);
    })();
    return () => {
      alive = false;
    };
  }, [session?.token, ctx.book, ctx.chapter, drafts, board]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftLabel = draftLabelOf(board, "notas", t, language);
  const sourceLang = sourcePackageLang(resolveSourcePackage(board?.settings));
  /** An introduction, as the team has it beside the source's, with what to improve in it left for the next team. */
  const versions = (source: string, own: TeamNote | undefined, verse: number) =>
    drafts ? (
      <>
        <HelpVersions team={own ?? null} source={source} teamLang={ctx.lang} sourceLang={sourceLang} draftLabel={draftLabel}>
          {(text, lang) => (
            <div lang={lang}>
              <HelpMarkdownView content={text} />
            </div>
          )}
        </HelpVersions>
        {own && session && ctx.pmOrg && ctx.projectId ? (
          <HelpMessages session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={ctx.book} chapter={ctx.chapter} verse={verse} about={own.id} resource="notas" taskName={ctx.taskName} lede={t("hm.ledeImproveIntro")} folded foldLabel={t("hm.toggleIntro")} />
        ) : null}
      </>
    ) : (
      <HelpMarkdownView content={source} />
    );
  if (!ctx.book) return null;
  return (
    <>
        {intro === undefined ? <LoadingState shape="text" label={t("sa.introLoading")} lines={6} /> : null}
        {intro === null || (intro && !intro.book && !intro.chapter) ? <p className="af-hint">{t("sa.introNone")}</p> : null}
        {intro?.book ? (
          <section>
            {/* An introduction that names itself is not named twice. */}
            {/^\s*#/.test(intro.book) ? null : <p className="step-ask__title">{t("sa.introOfBook").replace("{book}", bookLabel(ctx.book.toUpperCase(), language))}</p>}
            {versions(intro.book, team?.book, 0)}
          </section>
        ) : null}
        {intro?.chapter ? (
          <section>
            {/^\s*#/.test(intro.chapter) ? null : <p className="step-ask__title">{t("sa.introOfChapter").replace("{n}", String(ctx.chapter))}</p>}
            {versions(intro.chapter, team?.chapter, 0)}
          </section>
        ) : null}
    </>
  );
}

/**
 * Inside a tool: what the step it was opened for asks, and the introductions of its book, folded over the work.
 * `intro={false}` for a tool that shows the introductions in a tab of its own.
 */
export function StepAsk({
  session,
  ctx,
  intro = true,
  label,
  open,
  onOpenChange,
  trigger = true,
}: {
  session: GtSession | null | undefined;
  ctx: SolverLaunchContext | null | undefined;
  intro?: boolean;
  /** Names the sheet the step is explained in (a tool that says what it is for); without it, the fold of old. */
  label?: string;
  /** The sheet opened from elsewhere (the tool's header), and no line of its own to open it when `trigger` is false. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: boolean;
}) {
  const t = useT();
  const language = useUiLanguage();
  const found = useLaunchStep(session, ctx);
  const [ownOpen, setOwnOpen] = useState(false);
  const sheetOpen = open ?? ownOpen;
  const setSheetOpen = onOpenChange ?? setOwnOpen;
  if (!ctx) return null;
  const introductions = intro ? <PassageIntro session={session} ctx={ctx} /> : null;
  // The introductions are there whatever the step asks, and when it asks nothing.
  if (!found) return introductions;
  const { task, step } = found;
  if (!stepAsks(step, language) && !task.orgTeamName && !found.asked) return introductions;
  if (label) {
    // A tool that says what it is for above (`label` names how it is done) opens the rest over the work, in a sheet:
    // folded open in place it pushed the work down a screen, and scrolled inside its own height (16 October). The
    // team's rules come first, then how the round is answered; the glossary is in «Más».
    const said = stepPurpose(task.id, step, language);
    return (
      <>
        {found.asked ? (
          <p className="step-ask__asked" role="note">
            <b>{t("sa.asked")}</b> {found.asked}
          </p>
        ) : null}
        {trigger ? (
          <button type="button" className="step-ask__open" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
            {label}
            <ChevronRight size={14} aria-hidden />
          </button>
        ) : null}
        <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
          <DialogContent className="fix-sheet hint-sheet step-sheet" aria-label={label}>
            <header className="fx-head">
              <DialogTitle className="fx-title">{label}</DialogTitle>
            </header>
            {/* What the task is for, how the round is answered, and the rules the team gave itself. */}
            <div className="fx-body step-sheet__body">
              {said.purpose ? (
                <section>
                  <p className="step-ask__title">{t("sa.purpose")}</p>
                  <p className="step-sheet__purpose">{said.purpose}</p>
                </section>
              ) : null}
              <section>
                <p className="step-ask__title">{t("sa.howRound")}</p>
                <StepAskBody step={step} description={said.description} />
              </section>
              <TeamRuleChecks team={task.orgTeamName} canAdd={isOfTeam(session, task)} issue={ctx.issueNumber} inSheet />
            </div>
          </DialogContent>
        </Dialog>
        {introductions}
      </>
    );
  }
  const said = stepPurpose(task.id, step, language);
  if (said.purpose) {
    return (
      <>
        {found.asked ? (
          <p className="step-ask__asked" role="note">
            <b>{t("sa.asked")}</b> {found.asked}
          </p>
        ) : null}
        <AboutStep session={session} ctx={ctx} task={task} step={step} purpose={said.purpose} criterion={said.criterion} description={said.description} />
        {introductions}
      </>
    );
  }
  return (
    <>
      {/* What a subtarea added by hand asks, in plain sight: the tool of its task opens as it does for the work that
          task had already finished, and what the committee asked to correct was said nowhere in it. */}
      {found.asked ? (
        <p className="step-ask__asked" role="note">
          <b>{t("sa.asked")}</b> {found.asked}
        </p>
      ) : null}
      <details className="step-ask">
      <summary>{label ?? t("tb.howStep").replace("{step}", step.names?.[language] ?? localizeName(step.name, language))}</summary>
      <StepAskBody step={step} />
      <TeamRuleChecks team={task.orgTeamName} canAdd={isOfTeam(session, task)} issue={ctx.issueNumber} />
      {ctx.lab ? null : (
        // The glossary beside the rules: both are what the team decided, and on a phone its only way in was a small
        // link among the file's details. In another tab, so the work in hand stays as it is.
        <a className="step-ask__manage step-ask__glossary" href={glossaryHref(ctx)} target="_blank" rel="noreferrer">
          {t(ofPassage(ctx) ? "gl.openPassage" : "gl.openSearch")}
        </a>
      )}
      </details>
      {introductions}
    </>
  );
}

/**
 * A step that says what it is for, in any tool: a welcome the first time a person opens it on a device (what it is
 * for, how it is done, «Entendido»), then «Sobre esta tarea» a touch away (an «ⓘ» in the header, or a row of «Más»):
 * what it is for, how it is done, the team's rules and the glossary. It replaces the fold «Qué se pide en …», which
 * sat over the work in every tool and scrolled inside its own height (16 October).
 */
function AboutStep({
  session,
  ctx,
  task,
  step,
  purpose,
  criterion,
  description,
}: {
  session: GtSession | null | undefined;
  ctx: SolverLaunchContext;
  task: ProjectTask;
  step: TaskStep;
  purpose: string;
  /** The rule of the step, as the process words it: what a change has to keep. */
  criterion?: string;
  description?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const key = `taller-af-welcome:${task.id}:${step.id}`;
  const [welcomed, setWelcomed] = useState(true);
  useEffect(() => {
    try {
      setWelcomed(localStorage.getItem(key) === "1");
    } catch {
      setWelcomed(false);
    }
  }, [key]);
  useEffect(() => {
    const entry = { open: () => setOpen(true) };
    setAboutEntry(entry);
    return () => setAboutEntry(null);
  }, []);
  const dismiss = () => {
    setWelcomed(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* private window: seen for this visit only */
    }
  };
  const lines = (description ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (
    <>
      {welcomed ? null : (
        <section className="af-welcome" aria-label={t("af.welcomeTitle")}>
          <p className="af-welcome__title">{t("af.welcomeTitle")}</p>
          <p className="af-welcome__purpose">{purpose}</p>
          {lines.length > 1 ? (
            <ol className="af-welcome__steps">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : null}
          <div className="af-welcome__actions">
            <Button type="button" variant="outline" onClick={dismiss}>
              {t("af.welcomeOk")}
            </Button>
            <button type="button" className="af-link" onClick={() => setOpen(true)}>
              {t("af.welcomeRules")}
            </button>
          </div>
        </section>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fix-sheet hint-sheet step-sheet" aria-label={t("af.aboutTask")}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{t("af.aboutTask")}</DialogTitle>
          </header>
          <div className="fx-body step-sheet__body">
            <section>
              <p className="step-ask__title">{t("sa.purpose")}</p>
              <p className="step-sheet__purpose">{purpose}</p>
            </section>
            {criterion ? (
              <section>
                <p className="step-ask__title">{t("sa.rule")}</p>
                <p className="step-sheet__purpose">{criterion}</p>
              </section>
            ) : null}
            <section>
              <p className="step-ask__title">{t("sa.howDone")}</p>
              <StepAskBody step={step} description={description} />
            </section>
            <TeamRuleChecks team={task.orgTeamName} canAdd={isOfTeam(session, task)} issue={ctx.issueNumber} inSheet />
            {ctx.lab ? null : (
              <a className="step-ask__manage step-ask__glossary" href={glossaryHref(ctx)} target="_blank" rel="noreferrer">
                {t(ofPassage(ctx) ? "gl.openPassage" : "gl.openSearch")}
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
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
