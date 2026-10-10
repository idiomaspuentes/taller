import { parsePortionPrMarker } from "../domain/portionPr";
import { StepAskBody, TeamRuleChecks, stepAsks } from "./StepAsk";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookLabel } from "../domain/books";
import { formatRelativeEs, previewLine } from "../domain/attention";
import { placedPreview } from "../commentPlaceText";
import type { BoardCard } from "../domain/myTasksBoard";
import { canApproveStep, canClaimStep, closesInItsTool, isStepActor, isStepUnlocked, stepClaimMode, changesPending, takenBackByAuthor, handedInAgain } from "../domain/stepClaim";
import { changedKinds, versionsByKind, type SourceKind } from "../domain/sourceVersions";
import { getStepRuntime, parseTaskProgressMarker } from "../domain/taskProgress";
import { localized } from "../domain/processes";
import { localizeHold, localizeName } from "../domain/templateNames";
import { localizeThread } from "../domain/threadNames";
import type { TaskStep } from "../domain/types";
import { percentOf, stepFraction, subtaskFraction } from "../domain/workProgress";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { useSourcesNow } from "../useSourcesNow";
import { ProgressBar } from "./ProgressBar";

type Props = {
  card: BoardCard;
  login: string;
  now: Date;
  busy: boolean;
  /** The tool of the card's action opens outside Taller (TranslationCore Study): the button says so. */
  externalTool: boolean;
  /** The tool of a step completes it itself (an editor, with «Terminé el borrador»): it is not finished from here. */
  finishesInTool: (step: TaskStep) => boolean;
  /** More than one project: the project's name goes on the card as a small label. */
  projectLabel?: string;
  onPrimary: () => void;
  onOpenThread?: () => void;
  onDeliver?: () => void;
  /** «Corregir mi borrador»: the author takes the draft back while its review is open. */
  onCorrect?: () => void;
  onRelease?: () => void;
  onOpenNewTab?: () => void;
  onClaimStep: (step: TaskStep) => void;
  onApproveStep: (step: TaskStep) => void;
  /** Open the tool of a step, when the card's own button asks for something else. */
  onOpenStep?: (step: TaskStep) => void;
  /** A free step (no seats): mark it done, or take that back. */
  onToggleStep: (step: TaskStep) => void;
};

/** How each kind of source is called to a person. */
const SOURCE_NAME: Record<SourceKind, MessageKey> = { ult: "src.ult", ust: "src.ust", tn: "src.tn", tq: "src.tq", twl: "src.twl", tw: "src.tw", ta: "src.ta", original: "src.original" };

function assigneeOf(card: BoardCard): string {
  return card.issue.assignee?.login || card.issue.assignees?.[0]?.login || "";
}

/**
 * One subtarea as a card: what it is and where, how far it is, and ONE button that says what will happen.
 * Everything else (steps, messages, giving it back) is in the «···» menu.
 */
export function TaskCard(props: Props) {
  const { card, now } = props;
  const t = useT();
  const language = useUiLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Names and the button's words are the process's own (its template); the glossary covers plans saved before that.
  const stepName = (step: TaskStep) => (step.names?.[language] ? localized(step.name, step.names, language) : localizeName(step.name, language));
  const stepButton = (step: TaskStep | undefined) => (step?.actionLabel ? localized(step.actionLabel, step.actionLabels, language) : "");

  const what = card.taskName ? localizeName(card.taskName, language) : localizeName(card.issue.title ?? "", language);
  // «Judas 1:5–8» reads as one reference; what is not a passage (an article, work added by hand) is set apart.
  const where = [card.book ? bookLabel(card.book, language) : "", card.place].filter(Boolean).join(/^\d/.test(card.place ?? "") ? " " : " · ");
  const title = where ? `${what} · ${where}` : what;

  const action = card.action;
  // Whoever wrote a draft does not «review» it when its review comes to them: they see what was said of it and
  // say whether it is right. The button read «Revisar», as it does to whoever reviews.
  const ownReview = (action.kind === "begin" || action.kind === "continue") && Boolean(action.step && stepClaimMode(action.step) !== "none" && action.step.includeAuthorInApproval) && assigneeOf(card).toLowerCase() === props.login.toLowerCase();
  let label = "";
  if (ownReview) label = t("tb.seeReview");
  else if (action.kind === "begin") label = props.externalTool ? t("tb.study") : stepButton(action.step) || t("tb.begin");
  else if (action.kind === "continue") label = props.externalTool ? t("tb.study") : stepButton(action.step) || (card.started ? t("tb.continue") : t("tb.begin"));
  else if (action.kind === "deliver") label = t("tb.deliver");
  // My part of a round is done: the tool can be looked at, and it is not what the card asks for.
  // A step with no tool is an approval: there are no answers to look at, and the card offered «Ver mis respuestas».
  else if (action.kind === "none" && action.why === "othersAnswer") label = action.step?.solverAppId ? t("tb.seeMine") : "";
  else if (action.kind === "vote") label = t("tb.vote");
  // A step somebody joins to do it says what is done in it, as any other («Revisar»): pressing it takes the seat and
  // opens its tool. One with no tool is only joined, and says so.
  else if (action.kind === "claimStep") label = (action.step.solverAppId && stepButton(action.step)) || t("tb.join").replace("{step}", stepName(action.step));
  // What a person did themselves they finish; what somebody else did, they approve.
  else if (action.kind === "approveStep") label = t(action.step.closing === "self" ? "tb.stepFinishNamed" : "tb.approveStep").replace("{step}", stepName(action.step));

  let status = "";
  if (action.kind === "none" && action.why === "othersAnswer") status = t(action.step?.solverAppId ? "tb.othersAnswer" : "tb.othersApprove");
  else if (card.group === "waiting") status = localizeHold(card.holdText ?? "", language);
  else if (card.group === "done") {
    // Closed with steps left undone: the plan withdrew it (its portion was cut otherwise). It was not delivered,
    // and whoever had it must know that what they wrote stayed where it was.
    const marked = parseTaskProgressMarker(card.issue.body ?? "");
    const withdrawn = (card.task?.steps ?? []).some((step) => !marked.doneStepIds.includes(step.id));
    status = t(withdrawn ? "tb.withdrawnAt" : "tb.doneAt").replace("{when}", formatRelativeEs(card.issue.closed_at ?? card.issue.updated_at ?? "", now, language));
  }
  else if (action.kind === "none" && action.why === "othersReview") status = t("tb.othersReview");
  else if (action.kind === "none" && action.why === "assigneeDelivers") status = t("tb.assigneeDelivers").replace("{who}", assigneeOf(card));
  else if (card.group === "decide") status = t("tb.decideLine");
  // As a free subtarea says nobody has taken it, a step nobody has joined says so: the button will take it.
  else if (action.kind === "claimStep" && !getStepRuntime(parseTaskProgressMarker(card.issue.body ?? ""), action.step.id).assignees.length) status = t("tb.stepUntaken").replace("{step}", stepName(action.step));

  const activity = card.activity.latest ? previewLine(card.activity.latest, (text) => placedPreview(localizeThread(text, language))) : "";
  const steps = card.task?.steps ?? [];
  const progress = parseTaskProgressMarker(card.issue.body ?? "");
  // The sources each closed step was done against, beside what they are today: one that moved on since is said on
  // the card, for whoever goes on with the subtarea to look at it again.
  const sourcesNow = useSourcesNow(steps.flatMap((step) => progress.steps?.[step.id]?.sources ?? []));
  const sourceNames = (kinds: SourceKind[]) => kinds.map((kind) => t(SOURCE_NAME[kind])).join(", ");
  const moved = steps
    .filter((step) => progress.doneStepIds.includes(step.id))
    .map((step) => ({ step, kinds: changedKinds(progress.steps?.[step.id]?.sources ?? [], sourcesNow) }))
    .filter((row) => row.kinds.length);
  // How far the subtarea is: its steps one after another, the one in hand filled as far as its tool says.
  const fraction = subtaskFraction(steps.map((step) => step.id), progress, card.issue.state === "closed");
  const percent = (value: number) => t("pg.percent").replace("{n}", String(percentOf(value)));
  const day = (iso: string) => (Number.isNaN(Date.parse(iso)) ? "" : new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short" }));
  const hasTool = action.kind === "begin" || action.kind === "continue";
  const mine = assigneeOf(card).toLowerCase() === props.login.toLowerCase();
  // A reviewer sent the work back: its author is told why it is theirs again, and the reviewers what they wait for.
  const waiting = card.group !== "done" ? steps.find((step) => changesPending(steps, progress, step)) : undefined;
  if (waiting) {
    // The author took the draft back to correct it: nobody asked for changes, and saying so sent people looking for who had.
    const own = takenBackByAuthor(steps, progress, waiting, assigneeOf(card));
    status = mine ? t(own ? "tb.correctingOwn" : "tb.changesForYou") : t(own ? "tb.authorCorrecting" : "tb.changesWait").replace("{who}", assigneeOf(card));
    // The line says «abre tu borrador» and the button under it read «Traducir»: it says what the line asks for.
    if (mine && hasTool && !ownReview && !props.externalTool) label = t("rv.correct");
  }
  // The draft came back corrected: whoever reviews it, and has not approved it since, is told to look again.
  const again = !waiting && card.group !== "done" && !mine ? steps.find((step) => handedInAgain(steps, progress, step)) : undefined;
  if (again && !status) {
    const seat = getStepRuntime(progress, again.id);
    const here = (logins: string[]) => logins.some((login) => login.toLowerCase() === props.login.toLowerCase());
    if (here(seat.assignees) && !here(seat.approvals)) status = t("tb.correctedLook").replace("{who}", assigneeOf(card));
  }
  // Every step is done and the card reads «100 %»: what is left is to hand it in, and the card says what that does.
  if (action.kind === "deliver" && !status) status = t(parsePortionPrMarker(card.issue.body ?? "") ? "tb.readyToDeliver" : "tb.readyToClose");
  // Whoever reviewed has approved and the review waits for its author's word: the author's card says so. It showed
  // only «Ver la revisión», the same as while the reviewers were still reading.
  if (ownReview && !status && !waiting && (action.kind === "begin" || action.kind === "continue") && action.step) {
    const approvals = getStepRuntime(progress, action.step.id).approvals;
    const others = approvals.filter((login) => login.toLowerCase() !== props.login.toLowerCase());
    if (others.length && others.length === approvals.length) status = t("tb.agreeToEnd").replace("{who}", others.map((login) => `@${login}`).join(", "));
  }
  // A free step whose tool cannot know when it is done (an outside one, or none at all): the person says so here.
  // One that is completed where its work is done is not: «Terminé «Borrador»» beside «Traducir», before a word
  // was written, marked the draft done and sent it to review.
  const finishedHere = (step: TaskStep) => stepClaimMode(step) === "none" && !closesInItsTool(step) && !props.finishesInTool(step);
  const stepInHand = action.kind === "continue" ? action.step : undefined;
  const canFinishStep = Boolean(stepInHand && mine && card.started && finishedHere(stepInHand));

  // A subtarea that waits with nothing done has no progress to show: its line is why it waits. One nobody has
  // taken has none either.
  // A decision is not a task with steps: its card read «0 de 2 pasos · 0 %», those of the task its verse is of.
  const showsRow = card.stepsTotal > 0 && card.group !== "done" && card.group !== "free" && card.group !== "decide" && (card.group !== "waiting" || fraction > 0);
  // The button says what is done next when its step has words of its own («Traducir», «Revisar»). One that only
  // says «Empezar», or that opens a tool outside, leaves the step unnamed: then it is named beside it.
  const nextUnnamed = hasTool && card.stepsDone < card.stepsTotal && (!stepButton(action.kind === "begin" || action.kind === "continue" ? action.step : undefined) || props.externalTool);

  const menuItems: { id: string; label: string; run: () => void; danger?: boolean }[] = [];
  // The row of the bar unfolds the steps; a card without that row has them here.
  if (steps.length && card.group !== "done" && !showsRow) menuItems.push({ id: "steps", label: stepsOpen ? t("tb.hideSteps") : t("tb.showSteps"), run: () => setStepsOpen((v) => !v) });
  if (props.onOpenThread) menuItems.push({ id: "thread", label: t("tb.comment"), run: props.onOpenThread });
  if (hasTool && props.onOpenNewTab && !props.externalTool) menuItems.push({ id: "tab", label: t("tb.newTab"), run: props.onOpenNewTab });
  if (props.onCorrect) menuItems.push({ id: "correct", label: t("rv.correct"), run: props.onCorrect });
  if (props.onDeliver && action.kind !== "deliver") menuItems.push({ id: "deliver", label: t("tb.deliver"), run: props.onDeliver });
  if (props.onRelease) menuItems.push({ id: "release", label: t("tb.release"), run: props.onRelease, danger: true });

  return (
    <article className="task-card" data-issue={card.issue.number} data-group={card.group} data-unread={card.activity.unread || undefined}>
      <div className="task-card__top">
        <h3 className="task-card__title">
          {card.activity.unread ? <span className="task-card__dot" role="img" aria-label={t("mt.unread")} /> : null}
          {/* «Nueva» is said of what is the person's to do. Of what nobody has taken, or waits, it stayed on every
              card for ever: nobody opens those. */}
          {card.activity.isNew && card.group !== "free" && card.group !== "waiting" ? <span className="task-card__new">{t("mt.tagNew")}</span> : null}
          {card.askedBack && card.group !== "done" ? <span className="task-card__new task-card__back">{t("tb.correctionAsked")}</span> : null}
          {card.ownTitle || title}
        </h3>
        {menuItems.length ? (
          <div className="task-card__menu" ref={menuRef}>
            <button type="button" className="task-card__more" aria-label={t("tb.more")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <MoreHorizontal aria-hidden />
            </button>
            {menuOpen ? (
              <div className="task-card__menu-panel" role="menu">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    data-danger={item.danger || undefined}
                    onClick={() => {
                      setMenuOpen(false);
                      item.run();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Named by what was asked; the task and the passage it belongs to come under it. */}
      {card.ownTitle ? <p className="task-card__sub">{title}</p> : null}
      {card.corrections && card.group !== "done" ? (
        <p className="task-card__asked" data-back={card.corrections.open === 0}>
          {card.corrections.open
            ? t("tb.correctionsOpen").replace("{done}", String(card.corrections.total - card.corrections.open)).replace("{total}", String(card.corrections.total))
            : t("tb.correctionsBack")}
        </p>
      ) : null}

      {props.projectLabel ? <span className="task-card__project">{props.projectLabel}</span> : null}

      {/* How far it is, in one line; touching it unfolds its steps (who closed each, against what, how far the one
          in hand is). What comes next is not said apart: the button says it, and the steps show it. */}
      {showsRow ? (
        <button type="button" className="task-card__progress" aria-expanded={stepsOpen} onClick={() => setStepsOpen((v) => !v)}>
          <ProgressBar value={fraction} segments={steps.map((s) => stepFraction(progress, s.id))} label={t("pg.label").replace("{n}", String(percentOf(fraction)))} />
          <span className="task-card__count">
            {t(card.stepsTotal === 1 ? "tb.step1" : "tb.steps").replace("{done}", String(card.stepsDone)).replace("{total}", String(card.stepsTotal))} · <strong>{percent(fraction)}</strong>
          </span>
          <ChevronDown className="task-card__chev" aria-hidden />
          <span className="sr-only">{stepsOpen ? t("tb.hideSteps") : t("tb.showSteps")}</span>
        </button>
      ) : null}
      {stepsOpen ? (
        <ol className="task-card__steps">
          {steps.map((step) => {
            const done = progress.doneStepIds.includes(step.id);
            const assignee = assigneeOf(card);
            const claim = !done && canClaimStep(props.login, steps, progress, step, undefined, assignee);
            // The author of a draft is part of its review, but has nothing to confirm until somebody takes it (the
            // card says so: «Ahora la revisan otras personas»). The list said «Te toca» and offered to approve.
            const othersFirst = stepClaimMode(step) !== "none" && !claim && !getStepRuntime(progress, step.id).assignees.length;
            // Only of a step that has come: the author was offered to approve the review before writing the draft.
            const approve = !done && !othersFirst && isStepUnlocked(steps, progress, step.id) && canApproveStep(props.login, progress, step, assignee);
            const seated = !othersFirst && isStepActor(props.login, progress, step, assignee);
            const isNext = card.nextStep?.id === step.id;
            // The card's big button already does it: no second button for the same thing.
            const isPrimary = (action.kind === "claimStep" || action.kind === "approveStep") && action.step.id === step.id;
            const note = done
              ? t("tb.stepDone")
              : !isNext
                ? t("tb.stepLater")
                : stepClaimMode(step) === "none" || seated
                  ? t("tb.stepMine")
                  : claim
                    ? t("tb.stepFree")
                    : t("tb.stepOthers");
            const closed = done ? progress.steps?.[step.id]?.done : undefined;
            const sources = done ? (progress.steps?.[step.id]?.sources ?? []) : [];
            // An open step its tool has counted: «6 de 12», and its own bar under its name.
            const work = done ? undefined : progress.steps?.[step.id]?.work;
            return (
              <li key={step.id} data-done={done || undefined}>
                <span className="task-card__step-name">{stepName(step)}</span>
                <span className="task-card__step-note">
                  {closed?.by ? t("tb.stepDoneBy").replace("{who}", closed.by).replace("{when}", day(closed.at)) : note}
                  {work ? ` · ${t("pg.stepWork").replace("{done}", String(work.done)).replace("{total}", String(work.total))}` : ""}
                  {/* Against which version of its sources: what tells, later, whether there is anything to look at again. */}
                  {sources.length ? (
                    <small className="task-card__step-sources">
                      {versionsByKind(sources)
                        .map((row) => `${t(SOURCE_NAME[row.kind])} ${row.version}`)
                        .join(" · ")}
                    </small>
                  ) : null}
                </span>
                {done && closesInItsTool(step) && props.onOpenStep && card.group !== "done" ? (
                  // What a step closed in its tool left (what was checked, what was changed) can be looked at
                  // again: the step after it asked a team to agree on changes nobody could see from here.
                  <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.onOpenStep!(step)}>
                    {t("tb.seeStep")}
                  </Button>
                ) : isPrimary ? null : claim ? (
                  <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.onClaimStep(step)}>
                    {t("tb.joinShort")}
                  </Button>
                ) : approve && !(step.solverAppId && step.checklist?.length) ? (
                  <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.onApproveStep(step)}>
                    {t(step.closing === "self" ? "tb.stepFinish" : "mt.approve")}
                  </Button>
                ) : mine && finishedHere(step) && card.group !== "done" && (done || isStepUnlocked(steps, progress, step.id)) ? (
                  <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.onToggleStep(step)}>
                    {done ? t("tb.stepUndo") : t("tb.stepFinish")}
                  </Button>
                ) : null}
                {work ? <ProgressBar value={stepFraction(progress, step.id)} label={t("pg.label").replace("{n}", String(percentOf(stepFraction(progress, step.id))))} /> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {nextUnnamed && card.nextStep ? <p className="task-card__status">{t("tb.next").replace("{step}", stepName(card.nextStep))}</p> : null}

      {status ? <p className="task-card__status">{status}</p> : null}
      {moved.map(({ step, kinds }) => (
        <p key={step.id} className="task-card__moved">
          {t("tb.sourceMoved").replace("{step}", stepName(step)).replace("{sources}", sourceNames(kinds))}
        </p>
      ))}
      {/* What the next step asks is read where the step is done: its tool says it, under its header. The card says
          it only of a step with no tool of Taller to read it in (one that is marked done from here, or done in a
          tool outside), so the card stays short. */}
      {card.nextStep && card.group !== "done" && card.group !== "waiting" && (!card.nextStep.solverAppId || props.externalTool) && stepAsks(card.nextStep, language) ? (
        <details className="step-ask">
          <summary>{t("tb.howStep").replace("{step}", stepName(card.nextStep))}</summary>
          <StepAskBody step={card.nextStep} />
          <TeamRuleChecks team={card.task?.orgTeamName} />
        </details>
      ) : null}

      {activity ? (
        <p className="task-card__activity">
          <span>{activity}</span>
          {card.activity.latest ? <time dateTime={card.activity.latest.at}>{formatRelativeEs(card.activity.latest.at, now, language)}</time> : null}
        </p>
      ) : null}

      {label ? (
        <div className="task-card__actions">
          <Button type="button" size="lg" variant={action.kind === "none" ? "outline" : undefined} className="task-card__action" disabled={props.busy} onClick={props.onPrimary}>
            {props.busy ? t("tb.working") : label}
          </Button>
          {action.kind === "approveStep" && action.step.solverAppId && props.onOpenStep ? (
            // The tool of a step that is all done can still be opened, beside what the card asks for.
            <Button type="button" size="lg" variant="outline" className="task-card__action" disabled={props.busy} onClick={() => props.onOpenStep!(action.step)}>
              {stepButton(action.step) || t("tb.continue")}
            </Button>
          ) : null}
          {canFinishStep && stepInHand ? (
            <Button type="button" size="lg" variant="outline" className="task-card__action" disabled={props.busy} onClick={() => props.onToggleStep(stepInHand)}>
              {t("tb.stepFinishNamed").replace("{step}", stepName(stepInHand))}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
