import { StepAskBody, TeamRuleChecks, stepAsks } from "./StepAsk";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookLabel } from "../domain/books";
import { formatRelativeEs, previewLine } from "../domain/attention";
import { placedPreview } from "../commentPlaceText";
import type { BoardCard } from "../domain/myTasksBoard";
import { canApproveStep, canClaimStep, closesInItsTool, isStepActor, isStepUnlocked, stepClaimMode } from "../domain/stepClaim";
import { changedKinds, versionsByKind, type SourceKind } from "../domain/sourceVersions";
import { getStepRuntime, parseTaskProgressMarker } from "../domain/taskProgress";
import { localized } from "../domain/processes";
import { localizeName } from "../domain/templateNames";
import { localizeThread } from "../domain/threadNames";
import type { TaskStep } from "../domain/types";
import { workPath } from "../domain/workPath";
import { percentOf, stepFraction } from "../domain/workProgress";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { useSourcesNow } from "../useSourcesNow";
import { ProgressBar } from "./ProgressBar";
import { PathBar } from "./PathBar";
import { arrivalDetails, cardWords, fill, goesToLine, phaseLabel, stepLabel } from "./cardWords";
import { correctionCardTitle } from "../domain/corrections";
import type { PhaseBadge } from "../domain/phaseBadges";
import { handOffTarget } from "../domain/workPath";

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
  /** The person works in more than one phase: the card says which one it is of, above its title. */
  phase?: PhaseBadge;
  /** The card that is what to do now: its button is the one filled on the screen; the others are links. */
  lead?: boolean;
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

/** Waiting this long on somebody, the card says since when. */
const WAIT_SAID_AFTER_MS = 3 * 24 * 3600 * 1000;

function assigneeOf(card: BoardCard): string {
  return card.issue.assignee?.login || card.issue.assignees?.[0]?.login || "";
}

/**
 * One subtarea as a card, read in one place, top to bottom: its marks, its title, where on its way the work is, one
 * line that says what is going on, and one button that says what pressing it does. The rest is under «Ver detalles»
 * and in the «···» menu. The button, the line and the bar said different things («0 %» beside «Todos los pasos
 * están hechos»), and «Revisar» meant four (24 November).
 */
export function TaskCard(props: Props) {
  const { card, now } = props;
  const t = useT();
  const language = useUiLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  const stepName = (step: TaskStep) => stepLabel(step, language);
  const stepButton = (step: TaskStep | undefined) => (step?.actionLabel ? localized(step.actionLabel, step.actionLabels, language) : "");

  const what = card.taskName ? localizeName(card.taskName, language) : localizeName(card.issue.title ?? "", language);
  // «Judas 1:5–8» reads as one reference; what is not a passage (an article, work added by hand) is set apart.
  const where = [card.book ? bookLabel(card.book, language) : "", card.place].filter(Boolean).join(/^\d/.test(card.place ?? "") ? " " : " · ");
  const title = where ? `${what} · ${where}` : what;

  const action = card.action;
  const { section, state } = card.situation;
  const words = cardWords(card, { t, language, externalTool: props.externalTool, now });

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
  const day = (iso: string) => (Number.isNaN(Date.parse(iso)) ? "" : new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short" }));
  const mine = assigneeOf(card).toLowerCase() === props.login.toLowerCase();
  // A free step whose tool cannot know when it is done (an outside one, or none at all): the person says so here.
  // One that is completed where its work is done is not: «Terminé «Borrador»» beside «Traducir», before a word
  // was written, marked the draft done and sent it to review.
  const finishedHere = (step: TaskStep) => stepClaimMode(step) === "none" && !closesInItsTool(step) && !props.finishesInTool(step);
  const stepInHand = action.kind === "continue" ? action.step : undefined;
  const canFinishStep = Boolean(stepInHand && mine && card.started && finishedHere(stepInHand));

  // Where on its way the work is: not of what cannot be started yet or is done (under «Más»), nor of a decision or
  // a list of proposals, which are not steps of a path.
  const path = section !== "more" && state !== "decide" && state !== "proposals" && card.task && card.bucket ? workPath(card.task.id, card.bucket.board, progress.doneStepIds) : undefined;

  // «Ver detalles»: the steps and who closed each, since when it waits, what arrived of a reading, where it goes.
  const lastClosed = Math.max(...Object.values(progress.steps ?? {}).map((row) => Date.parse(row.done?.at ?? "")).filter((at) => !Number.isNaN(at)));
  const waitingSince = section === "waiting" && Number.isFinite(lastClosed) && now.getTime() - lastClosed > WAIT_SAID_AFTER_MS ? fill(t("tc.waitingSince"), { when: formatRelativeEs(new Date(lastClosed).toISOString(), now, language) }) : "";
  const arrivals = card.arrivals ? arrivalDetails(card.arrivals, t) : [];
  const after = card.arrivals && card.task && card.bucket ? handOffTarget(card.task.id, card.bucket.board) : undefined;
  if (after?.kind === "phase") arrivals.push(fill(t("tc.arrived.after"), { phase: phaseLabel(after.phase, language) }));
  const goesTo = section !== "more" && !card.arrivals ? goesToLine(card, t, language) : undefined;
  // The steps of what waits or is set aside too (who closed each, «Terminé…»): not of what is done.
  const showSteps = steps.length > 0 && state !== "decide" && state !== "proposals" && card.situation.morePart !== "done";
  const hasDetails = showSteps || Boolean(waitingSince) || arrivals.length > 0 || Boolean(goesTo);

  const menuItems: { id: string; label: string; run: () => void; danger?: boolean }[] = [];
  const hasTool = action.kind === "begin" || action.kind === "continue";
  if (props.onOpenThread) menuItems.push({ id: "thread", label: t("tb.comment"), run: props.onOpenThread });
  if (hasTool && props.onOpenNewTab && !props.externalTool) menuItems.push({ id: "tab", label: t("tb.newTab"), run: props.onOpenNewTab });
  if (props.onCorrect) menuItems.push({ id: "correct", label: t("rv.correct"), run: props.onCorrect });
  if (props.onDeliver && action.kind !== "deliver") menuItems.push({ id: "deliver", label: t("tb.deliver"), run: props.onDeliver });
  if (props.onRelease) menuItems.push({ id: "release", label: t("tb.release"), run: props.onRelease, danger: true });

  // «Nueva» is said of what is the person's to do. Of what nobody has taken, or waits, it stayed on every card for
  // ever: nobody opens those.
  const isNew = card.activity.isNew && section === "mine" ? <span className="task-card__new">{t("mt.tagNew")}</span> : null;
  const back = card.askedBack && card.group !== "done" ? <span className="task-card__new task-card__back">{t("tb.correctionAsked")}</span> : null;
  const redo = card.redoOf && card.group !== "done" ? <span className="task-card__new task-card__back">{t("tb.redoAsked")}</span> : null;
  const hasMarks = Boolean(props.phase || isNew || back || redo);

  return (
    <article className="task-card" data-guide="task" data-issue={card.issue.number} data-group={card.group} data-section={section} data-state={state} data-unread={card.activity.unread || undefined} data-lead={props.lead || undefined}>
      {/* The marks, on one row above the title, only when there is one. */}
      {hasMarks ? (
        <div className="task-card__tags">
          {props.phase ? (
            <span className="task-card__phase" data-tone={props.phase.tone}>
              {localized(props.phase.name, props.phase.names, language)}
            </span>
          ) : null}
          {isNew}
          {back}
          {redo}
        </div>
      ) : null}
      <div className="task-card__top">
        <h3 className="task-card__title">
          {card.activity.unread ? <span className="task-card__dot" role="img" aria-label={t("mt.unread")} /> : null}
          {card.ownTitle ? (
            correctionCardTitle(card.ownTitle)
          ) : where ? (
            // «Esdras 4:1–5» is one reference: with the letter larger it broke after the dash.
            <>
              {what} · <span className="task-card__where">{where}</span>
            </>
          ) : (
            title
          )}
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
      {/* Not when the card already names the book («Desafíos TPL · Esdras 1:1»): it said Esdras twice. */}
      {props.projectLabel && !`${card.ownTitle ?? ""} ${title}`.includes(props.projectLabel) ? <span className="task-card__project">{props.projectLabel}</span> : null}

      {path ? <PathBar path={path} /> : null}

      {words.line ? <p className="task-card__line" data-strong={words.strong || undefined}>{words.line}</p> : null}
      {card.corrections && card.group !== "done" ? (
        <p className="task-card__asked" data-back={card.corrections.open === 0}>
          {card.corrections.open
            ? t("tb.correctionsOpen").replace("{done}", String(card.corrections.total - card.corrections.open)).replace("{total}", String(card.corrections.total))
            : t("tb.correctionsBack")}
        </p>
      ) : null}
      {moved.map(({ step, kinds }) => (
        <p key={step.id} className="task-card__moved">
          {t("tb.sourceMoved").replace("{step}", stepName(step)).replace("{sources}", sourceNames(kinds))}
        </p>
      ))}
      {/* What the next step asks is read where the step is done: its tool says it, under its header. The card says
          it only of a step with no tool of Taller to read it in. */}
      {card.nextStep && section !== "more" && section !== "waiting" && (!card.nextStep.solverAppId || props.externalTool) && stepAsks(card.nextStep, language) ? (
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

      {words.button ? (
        <div className="task-card__actions">
          {props.lead ? (
            <Button type="button" size="lg" className="task-card__action" disabled={props.busy} onClick={props.onPrimary}>
              {props.busy ? t("tb.working") : words.button}
            </Button>
          ) : (
            // Every other card is a way in, not a second thing to do now: a link, its whole height to touch.
            <button type="button" className="task-card__go" disabled={props.busy} onClick={props.onPrimary}>
              {props.busy ? t("tb.working") : words.button}
              <ChevronRight aria-hidden />
            </button>
          )}
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

      {hasDetails ? (
        <button type="button" className="task-card__details" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)}>
          <span>{detailsOpen ? t("tc.hideDetails") : t("tc.details")}</span>
          <ChevronDown className="task-card__chev" aria-hidden />
        </button>
      ) : null}
      {detailsOpen ? (
        <div className="task-card__more-info">
          {waitingSince ? <p className="task-card__detail">{waitingSince}</p> : null}
          {arrivals.map((row) => (
            <p key={row} className="task-card__detail">
              {row}
            </p>
          ))}
          {goesTo ? <p className="task-card__detail">{goesTo}</p> : null}
          {showSteps ? (
            <ol className="task-card__steps">
              {steps.map((step) => {
                const done = progress.doneStepIds.includes(step.id);
                const assignee = assigneeOf(card);
                const claim = !done && canClaimStep(props.login, steps, progress, step, undefined, assignee);
                // The author of a draft is part of its review, but has nothing to confirm until somebody takes it.
                const othersFirst = stepClaimMode(step) !== "none" && !claim && !getStepRuntime(progress, step.id).assignees.length;
                // Only of a step that has come: the author was offered to approve the review before writing the draft.
                const approve = !done && !othersFirst && isStepUnlocked(steps, progress, step.id) && canApproveStep(props.login, progress, step, assignee);
                const seated = !othersFirst && isStepActor(props.login, progress, step, assignee);
                const isNext = card.nextStep?.id === step.id;
                // The card's big button already does it: no second button for the same thing.
                const isPrimary = (action.kind === "claimStep" || action.kind === "approveStep") && action.step.id === step.id;
                const note = done ? t("tb.stepDone") : !isNext ? t("tb.stepLater") : stepClaimMode(step) === "none" || seated ? t("tb.stepMine") : claim ? t("tb.stepFree") : t("tb.stepOthers");
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
                      // What a step closed in its tool left can be looked at again.
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
        </div>
      ) : null}
    </article>
  );
}
