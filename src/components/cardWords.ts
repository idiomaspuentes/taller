import type { DcsIssue } from "@ip-lms/dcs-client";
import { formatRelativeEs } from "../domain/attention";
import type { BoardSection, MorePart } from "../domain/cardSituation";
import type { BoardCard } from "../domain/myTasksBoard";
import { localized, stepCardWords } from "../domain/processes";
import type { ReadingArrivals } from "../domain/readingArrivals";
import { chapterFromIssue } from "../domain/solverLaunch";
import { localizeHold, localizeName } from "../domain/templateNames";
import type { AssignmentsDoc, Phase, TaskStep } from "../domain/types";
import { handOffTarget, type PathNext } from "../domain/workPath";
import type { MessageKey } from "../i18n/messages";
import type { UiLanguage } from "../config/types";

/**
 * The words of a card of «Mis tareas»: one line that says what is going on, and one button that says what pressing
 * it does, from the card's situation (see `cardSituation.ts`). The steps' own words come from the process.
 */

type T = (key: MessageKey) => string;

export const SECTION_TITLE: Record<BoardSection, MessageKey> = {
  mine: "tc.section.mine",
  waiting: "tc.section.waiting",
  take: "tc.section.take",
  more: "tc.section.more",
};

export const MORE_TITLE: Record<MorePart, MessageKey> = {
  held: "tc.more.held",
  later: "tc.more.later",
  paused: "tc.more.paused",
  done: "tc.more.done",
};

/** `{name}` markers filled in. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** A step's name as the person reads it: the process's own, or the glossary's for plans saved before that. */
export function stepLabel(step: Pick<TaskStep, "name" | "names">, language: UiLanguage): string {
  return step.names?.[language] ? localized(step.name, step.names, language) : localizeName(step.name, language);
}

/** What the process calls the step's button («Traducir», «Revisar»); empty when it says nothing. */
function stepButton(step: TaskStep | undefined, language: UiLanguage): string {
  return step?.actionLabel ? localized(step.actionLabel, step.actionLabels, language) : "";
}

export function phaseLabel(phase: Pick<Phase, "name" | "names">, language: UiLanguage): string {
  return localized(phase.name, phase.names, language);
}

/** «@rut, @miguel y 2 más»: the first two, and how many more. */
export function peopleList(logins: string[], t: T): string {
  const named = logins.slice(0, 2).map((login) => `@${login}`).join(", ");
  return logins.length > 2 ? fill(t("tc.morePeople"), { list: named, n: logins.length - 2 }) : named;
}

/** «Judas 1:1–4» style range, of one chapter: `3:1–6`. */
export const rangeText = (chapter: number, row: { from: number; to: number }) => (row.from === row.to ? `${chapter}:${row.from}` : `${chapter}:${row.from}–${row.to}`);

export type CardWords = { line: string; strong: boolean; button?: string };

/** The line and the button of a card. `button` is absent when there is nothing to press. */
export function cardWords(card: BoardCard, opts: { t: T; language: UiLanguage; externalTool: boolean; now: Date }): CardWords {
  const { t, language } = opts;
  const { situation, action } = card;
  const step = "step" in action ? action.step : undefined;
  const words = stepCardWords(card.task?.id ?? "", step, language);
  const who = (situation.who ?? []).join(", ");
  const name = step ? stepLabel(step, language) : card.taskName ? localizeName(card.taskName, language) : "";
  const chapter = chapterFromIssue(card.issue);
  // Opens a tool: what a card waiting on others may still do (look at the review, at one's answers).
  const opensTool = action.kind === "begin" || action.kind === "continue";
  const opensStep = action.kind === "none" && "step" in action && Boolean(action.step?.solverAppId);
  const start = opts.externalTool ? t("tb.study") : stepButton(step, language) || t("tb.begin");
  const strong = situation.section === "mine";
  const say = (line: string, button?: string): CardWords => ({ line, strong, ...(button ? { button } : {}) });

  switch (situation.state) {
    case "free":
      return say(t("tc.line.free"), action.kind === "begin" ? start : undefined);
    case "nextBook":
      return say(t("tc.line.nextBook"));
    case "held":
      return say(localizeHold(card.holdText ?? "", language));
    case "toStart":
      return say(t("tc.line.toStart"), start);
    case "ownStep":
      return say(words.line || fill(t("tc.line.ownStep"), { step: name }), opts.externalTool ? t("tb.study") : words.continue || stepButton(step, language) || t("tc.btn.continue"));
    case "finishStep":
      return say(fill(t("tc.line.finishStep"), { step: name }), fill(t("tb.stepFinishNamed"), { step: name }));
    case "noReviewer":
      return say(t("tc.line.noReviewer"));
    case "beingReviewed":
      return say(fill(t("tc.line.beingReviewed"), { who }), opensTool ? t("tc.btn.seeReview") : undefined);
    case "changesAsked":
      return say(t("tc.line.changesAsked"), opensTool && !opts.externalTool ? t("tc.btn.correct") : undefined);
    case "correcting":
      return say(t("tc.line.correcting"), opensTool && !opts.externalTool ? t("tc.btn.keepCorrecting") : undefined);
    case "yourAgreement":
      return say(fill(t("tc.line.yourAgreement"), { who: (situation.who ?? []).join(", @") }), opensTool ? t("tc.btn.seeReview") : action.kind === "approveStep" ? fill(t("tb.approveStep"), { step: name }) : undefined);
    case "toDeliver":
      return say(t("tc.line.toDeliver"), t("tc.btn.deliver"));
    case "done":
    case "withdrawn":
      return say(fill(t(situation.state === "done" ? "tb.doneAt" : "tb.withdrawnAt"), { when: formatRelativeEs(card.issue.closed_at ?? card.issue.updated_at ?? "", opts.now, language) }));
    case "reviewOffered":
      return say(fill(t("tc.line.reviewOffered"), { who }), fill(t("tc.btn.reviewOf"), { who }));
    case "reviewing":
      return say(fill(t("tc.line.reviewing"), { who }), action.kind === "approveStep" && !step?.solverAppId ? fill(t("tb.approveStep"), { step: name }) : t("tc.btn.keepReviewing"));
    case "askedChanges":
      return say(fill(t("tc.line.askedChanges"), { who }), opensTool ? t("tc.btn.seeMyReview") : undefined);
    case "authorCorrecting":
      return say(fill(t("tc.line.authorCorrecting"), { who }), opensTool ? t("tc.btn.seeMyReview") : undefined);
    case "correctedLook":
      return say(fill(t("tc.line.correctedLook"), { who }), t("tc.btn.lookAgain"));
    case "authorDelivers":
      return say(fill(t("tc.line.authorDelivers"), { who }), opensStep ? t("tc.btn.seeMyReview") : undefined);
    case "groupNotYet":
      return say(t("tc.line.groupNotYet"));
    case "groupOffered": {
      const offer = words.offer ? fill(words.offer, { n: chapter }) : chapter ? fill(t("tc.line.groupOffered"), { step: name, n: chapter }) : fill(t("tc.line.groupOfferedNoChapter"), { step: name });
      return say(offer, words.join || stepButton(step, language) || t("tc.btn.join"));
    }
    case "group": {
      const line = card.arrivals ? arrivedLine(card.arrivals, t) : words.line || fill(t("tc.line.group"), { step: name });
      const button = action.kind === "approveStep" && !step?.solverAppId ? fill(t("tb.approveStep"), { step: name }) : words.continue || stepButton(step, language) || t("tc.btn.continue");
      return say(line, button);
    }
    case "answered":
      return say(t("tc.line.answered"), opensStep ? t("tb.seeMine") : undefined);
    case "approved":
      return say(t("tc.line.approved"));
    case "groupToDeliver": {
      const last = card.task?.steps?.at(-1);
      const wholeChapter = /^\d+$/.test(card.place.trim());
      return say(fill(t("tc.line.groupToDeliver"), { step: last ? stepLabel(last, language) : name }), t(wholeChapter ? "tc.btn.deliverChapter" : "tc.btn.deliver"));
    }
    case "decide":
      return say(t("tc.line.decide"), t("tb.vote"));
    case "proposals": {
      const left = card.proposalList?.open ?? 0;
      const line = card.proposalList ? (left ? fill(t(left === 1 ? "tb.proposalsLeftOne" : "tb.proposalsLeft"), { n: left }) : t("tb.proposalsDecided")) : "";
      return say(line, t("tb.proposals"));
    }
    case "paused":
      return say(t("tc.line.paused"), pausedButton(card, start, name, t, language));
  }
}

/** A project set aside keeps what its card offered, as a way in. */
function pausedButton(card: BoardCard, start: string, name: string, t: T, language: UiLanguage): string | undefined {
  const { action } = card;
  if (action.kind === "begin" || action.kind === "continue") return action.kind === "begin" ? start : stepButton(action.step, language) || t("tc.btn.continue");
  if (action.kind === "deliver") return t("tc.btn.deliver");
  if (action.kind === "claimStep") return stepButton(action.step, language) || t("tc.btn.join");
  if (action.kind === "approveStep") return fill(t("tb.approveStep"), { step: name });
  if (action.kind === "vote") return t("tb.vote");
  if (action.kind === "proposals") return t("tb.proposals");
  return undefined;
}

/** «Llegaron 3 de 5 pasajes. Ya puede leerlos.», or «Llegó todo el capítulo.». */
export function arrivedLine(arrivals: ReadingArrivals, t: T): string {
  const total = arrivals.arrived.length + arrivals.missing.length;
  return arrivals.missing.length ? fill(t("tc.line.arrived"), { a: arrivals.arrived.length, b: total }) : t("tc.line.arrivedAll");
}

/** What «Ver detalles» says of a group reading: what arrived, what is missing and with whom, who joined. */
export function arrivalDetails(arrivals: ReadingArrivals, t: T): string[] {
  const rows: string[] = [];
  if (arrivals.arrived.length) {
    rows.push(fill(t("tc.arrived.list"), { list: arrivals.arrived.map((row) => rangeText(arrivals.chapter, row)).join(" · "), a: arrivals.arrivedVerses, b: arrivals.totalVerses }));
  }
  for (const row of arrivals.missing) {
    const range = rangeText(arrivals.chapter, row);
    rows.push(row.who ? fill(t("tc.arrived.missing"), { range, who: row.who }) : fill(t("tc.arrived.missingNobody"), { range }));
  }
  if (arrivals.joined.length) rows.push(fill(t("tc.arrived.joined"), { who: peopleList(arrivals.joined, t) }));
  return rows;
}

/** Where a piece of work goes once handed in, in words: a step (of the same chapter), or a phase. */
function goesTo(target: PathNext | undefined, chapter: number, keys: { step: MessageKey; stepNoChapter: MessageKey; phase: MessageKey }, t: T, language: UiLanguage): string | undefined {
  if (!target) return undefined;
  if (target.kind === "phase") return fill(t(keys.phase), { phase: phaseLabel(target.phase, language) });
  const step = stepLabel(target.step, language);
  return chapter ? fill(t(keys.step), { step, n: chapter }) : fill(t(keys.stepNoChapter), { step });
}

/** «Después pasa a «Lectura grupal» del capítulo 3.»: for whom the work is, in «Ver detalles». */
export function goesToLine(card: BoardCard, t: T, language: UiLanguage): string | undefined {
  if (!card.task || !card.bucket) return undefined;
  return goesTo(handOffTarget(card.task.id, card.bucket.board), chapterFromIssue(card.issue), { step: "tc.goesTo.step", stepNoChapter: "tc.goesTo.stepNoChapter", phase: "tc.goesTo.phase" }, t, language);
}

/** «Entregado. Pasa a «Lectura grupal» del capítulo 3.»: said once a delivery went well, so the card is not thought lost. */
export function deliveredNotice(issue: DcsIssue, taskId: string, board: Pick<AssignmentsDoc, "teams" | "phases">, t: T, language: UiLanguage): string | undefined {
  return goesTo(handOffTarget(taskId, board), chapterFromIssue(issue), { step: "tc.delivered.step", stepNoChapter: "tc.delivered.stepNoChapter", phase: "tc.delivered.phase" }, t, language);
}
