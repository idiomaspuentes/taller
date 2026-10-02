import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookLabel } from "../domain/books";
import { formatRelativeEs, previewLine } from "../domain/attention";
import type { BoardCard } from "../domain/myTasksBoard";
import { canApproveStep, canClaimStep, closesInItsTool, isStepActor, isStepUnlocked, stepClaimMode } from "../domain/stepClaim";
import { parseTaskProgressMarker } from "../domain/taskProgress";
import { localized } from "../domain/processes";
import { localizeHold, localizeName } from "../domain/templateNames";
import { localizeThread } from "../domain/threadNames";
import type { TaskStep } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

type Props = {
  card: BoardCard;
  login: string;
  now: Date;
  busy: boolean;
  /** The tool of the card's action opens outside Taller (TranslationCore Study): the button says so. */
  externalTool: boolean;
  /** More than one project: the project's name goes on the card as a small label. */
  projectLabel?: string;
  onPrimary: () => void;
  onOpenThread?: () => void;
  onDeliver?: () => void;
  onRelease?: () => void;
  onOpenNewTab?: () => void;
  onClaimStep: (step: TaskStep) => void;
  onApproveStep: (step: TaskStep) => void;
  /** A free step (no seats): mark it done, or take that back. */
  onToggleStep: (step: TaskStep) => void;
};

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
  const where = [card.book ? bookLabel(card.book, language) : "", card.place].filter(Boolean).join(" ");
  const title = where ? `${what} · ${where}` : what;

  const action = card.action;
  let label = "";
  if (action.kind === "begin") label = props.externalTool ? t("tb.study") : stepButton(action.step) || t("tb.begin");
  else if (action.kind === "continue") label = props.externalTool ? t("tb.study") : stepButton(action.step) || (card.started ? t("tb.continue") : t("tb.begin"));
  else if (action.kind === "deliver") label = t("tb.deliver");
  else if (action.kind === "vote") label = t("tb.vote");
  // The step's own name says what it is; the app only knows the mechanics (join it, approve it).
  else if (action.kind === "claimStep") label = t("tb.join").replace("{step}", stepName(action.step));
  else if (action.kind === "approveStep") label = t("tb.approveStep").replace("{step}", stepName(action.step));

  let status = "";
  if (card.group === "waiting") status = localizeHold(card.holdText ?? "", language);
  else if (card.group === "free") status = t("tb.freeLine");
  else if (card.group === "done") status = t("tb.doneAt").replace("{when}", formatRelativeEs(card.issue.closed_at ?? card.issue.updated_at ?? "", now, language));
  else if (action.kind === "none" && action.why === "othersReview") status = t("tb.othersReview");
  else if (action.kind === "none" && action.why === "assigneeDelivers") status = t("tb.assigneeDelivers").replace("{who}", assigneeOf(card));
  else if (card.group === "decide") status = t("tb.decideLine");

  const activity = card.activity.latest ? previewLine(card.activity.latest, (text) => localizeThread(text, language)) : "";
  const steps = card.task?.steps ?? [];
  const progress = parseTaskProgressMarker(card.issue.body ?? "");
  const hasTool = action.kind === "begin" || action.kind === "continue";
  const mine = assigneeOf(card).toLowerCase() === props.login.toLowerCase();
  // The step in hand is a free one: the person says when it is done (the tool cannot know, above all an outside one).
  const stepInHand = action.kind === "continue" ? action.step : undefined;
  const canFinishStep = Boolean(stepInHand && mine && card.started && stepClaimMode(stepInHand) === "none" && !closesInItsTool(stepInHand));

  const menuItems: { id: string; label: string; run: () => void; danger?: boolean }[] = [];
  if (steps.length && card.group !== "done") menuItems.push({ id: "steps", label: stepsOpen ? t("tb.hideSteps") : t("tb.showSteps"), run: () => setStepsOpen((v) => !v) });
  if (props.onOpenThread) menuItems.push({ id: "thread", label: t("tb.comment"), run: props.onOpenThread });
  if (hasTool && props.onOpenNewTab && !props.externalTool) menuItems.push({ id: "tab", label: t("tb.newTab"), run: props.onOpenNewTab });
  if (props.onDeliver && action.kind !== "deliver") menuItems.push({ id: "deliver", label: t("tb.deliver"), run: props.onDeliver });
  if (props.onRelease) menuItems.push({ id: "release", label: t("tb.release"), run: props.onRelease, danger: true });

  return (
    <article className="task-card" data-group={card.group} data-unread={card.activity.unread || undefined}>
      <div className="task-card__top">
        <h3 className="task-card__title">
          {card.activity.unread ? <span className="task-card__dot" role="img" aria-label={t("mt.unread")} /> : null}
          {card.activity.isNew ? <span className="task-card__new">{t("mt.tagNew")}</span> : null}
          {title}
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

      {props.projectLabel ? <span className="task-card__project">{props.projectLabel}</span> : null}

      {card.stepsTotal > 0 && card.group !== "done" && card.group !== "free" ? (
        <div className="task-card__progress">
          <span className="task-card__dots" aria-hidden>
            {steps.map((s) => (
              <i key={s.id} data-done={progress.doneStepIds.includes(s.id) || undefined} />
            ))}
          </span>
          <span>{t("tb.steps").replace("{done}", String(card.stepsDone)).replace("{total}", String(card.stepsTotal))}</span>
          {card.nextStep && card.stepsDone < card.stepsTotal ? (
            <span className="task-card__next">{t("tb.next").replace("{step}", stepName(card.nextStep))}</span>
          ) : null}
        </div>
      ) : null}

      {status ? <p className="task-card__status">{status}</p> : null}

      {activity ? (
        <p className="task-card__activity">
          <span>{activity}</span>
          {card.activity.latest ? <time dateTime={card.activity.latest.at}>{formatRelativeEs(card.activity.latest.at, now, language)}</time> : null}
        </p>
      ) : null}

      {stepsOpen ? (
        <ol className="task-card__steps">
          {steps.map((step) => {
            const done = progress.doneStepIds.includes(step.id);
            const assignee = assigneeOf(card);
            const claim = !done && canClaimStep(props.login, steps, progress, step, undefined, assignee);
            const approve = !done && canApproveStep(props.login, progress, step, assignee);
            const seated = isStepActor(props.login, progress, step, assignee);
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
            return (
              <li key={step.id} data-done={done || undefined}>
                <span className="task-card__step-name">{stepName(step)}</span>
                <span className="task-card__step-note">{note}</span>
                {isPrimary ? null : claim ? (
                  <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.onClaimStep(step)}>
                    {t("tb.joinShort")}
                  </Button>
                ) : approve && !(step.solverAppId && step.checklist?.length) ? (
                  <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.onApproveStep(step)}>
                    {t("mt.approve")}
                  </Button>
                ) : mine && stepClaimMode(step) === "none" && !closesInItsTool(step) && card.group !== "done" && (done || isStepUnlocked(steps, progress, step.id)) ? (
                  <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => props.onToggleStep(step)}>
                    {done ? t("tb.stepUndo") : t("tb.stepFinish")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {label ? (
        <div className="task-card__actions">
          <Button type="button" size="lg" className="task-card__action" disabled={props.busy} onClick={props.onPrimary}>
            {props.busy ? t("tb.working") : label}
          </Button>
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
