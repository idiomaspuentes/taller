import type { GuideStep } from "../domain/guide";
import { GuideScreen } from "../guide";
import { useT, type MessageKey } from "../i18n/messages";

/**
 * The guides of the tuning tools, as walks through the first piece of work (see `domain/guide.ts`): each step shows
 * one thing, says what to do in a sentence, and waits for it to be done. What has not had its turn is not on screen
 * yet (`hide`). The cases the first piece does not have (somebody answered before, a point the team closed, closing
 * the review) are said on their own the first time they come. Designed with Abel on 9 November, from the page
 * «Guía de afinación paso a paso».
 */

/** Where a point of tuning stands, as `AfinacionView` has it. */
export type TuningState = {
  kind: "notas" | "palabras";
  /** The step of the point on screen: 1 Estudiar, 2 Marcar, 3 Decidir, each with its own walk; 0 an answer just saved. */
  phase: 0 | 1 | 2 | 3;
  /** The language of the original, in a sentence: «hebreo». */
  orig: string;
  res: "TPL" | "TPS";
  /** What the point is a case of («Nombres»), for notes. */
  name: string;
  /** Another text to read the point in («ULT»), when there is one. */
  tab?: string;
  hasHelp: boolean;
  studied: boolean;
  /** «No, es otra cosa» was touched: the box to say what one sees is open. */
  doubting: boolean;
  marked: boolean;
  confirmed: boolean;
  /** Nothing of the translation renders it: there is no «Sí, está bien». */
  needsWords: boolean;
  /** The box of a proposal or an observation is open. */
  pending: string | null;
  /** This person's answer is on the point (and is not being changed). */
  answered: boolean;
  /** How the key word reads elsewhere is listed. */
  elsewhere: boolean;
  /** Somebody else had marked the words: the point opened at the question. */
  othersChose: boolean;
  /** Somebody of the team has answered the point: their messages are on screen. */
  others: boolean;
};

/**
 * A walk's step: one key per stage, so each stage's walk is seen as a whole. Asked for only («Muéstreme cómo» in the
 * window that opens the stage, or «Guía»): nothing comes by itself to the tuning team (11 November).
 */
const walkStep = (kind: TuningState["kind"], phase: number, id: string, rest: Omit<GuideStep, "id" | "seenKey" | "flow">): GuideStep => ({ id, seenKey: `flow:afinar-${kind}-${phase}`, flow: true, manual: true, ...rest });

export function TuningGuide({ ready, state: s }: { ready: boolean; state: TuningState }) {
  const t = useT();
  const fill = (key: MessageKey, values: Record<string, string>) => Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), t(key));
  const notes = s.kind === "notas";
  // Over every step: the round of the team, which is not the work of the step.
  const round = ["af-round"];
  const study = s.studied;
  const answer = s.doubting
    ? { kind: "do" as const, target: "af-doubt", text: fill("guide.afDoubt", { button: t("af.doubtContinue") }) }
    : { kind: "tap" as const, target: "af-answer", text: notes ? fill("guide.afN5", { name: s.name }) : fill("guide.afW5", { button: t("af.studyYesTerm") }) };
  const decide =
    s.pending === "revise"
      ? { kind: "do" as const, target: "af-why", text: fill("guide.afPropose", { button: t("af.sendToTeam") }) }
      : s.pending
        ? { kind: "do" as const, target: "af-why", text: fill("guide.afObserve", { button: t("af.sendToTeam") }) }
        : s.needsWords
          ? { kind: "tap" as const, target: "af-answer-final", text: fill("guide.afDecideMissing", { revise: t("af.proposeWords"), obs: t("af.commentTeam") }) }
          : {
              kind: "tap" as const,
              target: "af-answer-final",
              text: fill(notes ? (s.res === "TPS" ? "guide.afDecideTps" : "guide.afDecideTpl") : s.elsewhere ? "guide.afDecideW" : "guide.afDecideWFirst", { yes: t("af.yesFine"), orig: s.orig }),
              sub: fill("guide.afDecideSub", { no: t("af.notQuite") }),
            };
  const k = s.kind;
  // Each walk shows every button of its step, one by one, in the order they are met: where the point is, what is
  // read, what can be looked at, the way back, and the way on (Abel, 11 November: «que te muestre qué hace cada
  // botón»). What has not had its turn is hidden.
  const stage: GuideStep[] =
    s.phase === 1
      ? [
          // Estudiar
          walkStep(k, 1, "where", { target: "af-where", text: t(notes ? "guide.afWhere" : "guide.afWhereW"), done: study, hide: [...round, "af-title", "af-ref", "af-help", "af-more", "af-answer"] }),
          walkStep(k, 1, "ref", { target: "af-ref", text: fill(notes ? "guide.afN2" : "guide.afW2", { orig: s.orig }), sub: fill("guide.afWordsSub", { orig: s.orig }), done: study, hide: [...round, "af-help", "af-more", "af-answer"] }),
          walkStep(k, 1, "help", { target: "af-help", text: t(notes ? "guide.afN4" : "guide.afW4"), ok: t(notes ? "guide.readNote" : "guide.readArticle"), when: s.hasHelp, done: study, hide: [...round, "af-more", "af-answer"] }),
          walkStep(k, 1, "more", { target: "af-more", text: t("guide.afMore"), done: study, hide: [...round, "af-answer"] }),
          walkStep(k, 1, "answer", { ...answer, done: study, hide: round }),
        ]
      : s.phase === 2
        ? [
            // Marcar
            walkStep(k, 2, "seek", { target: "af-seek", text: fill("guide.afSeek", { res: s.res }), done: s.confirmed, hide: [...round, "af-words", "af-more", "af-back", "af-confirm"] }),
            walkStep(k, 2, "back", { target: "af-back", text: t("guide.afBackStudy"), done: s.confirmed, hide: [...round, "af-more", "af-confirm"] }),
            // One step of work, in two shapes: the screen stays free while words are marked, and once there is one, the
            // line says how to go on. As a step to touch, «¿Están todas?» held the words, and no second word could be marked.
            s.marked
              ? walkStep(k, 2, "mark", { kind: "do", target: "af-words", text: fill("guide.afConfirm", { button: t("af.confirmWords") }), sub: fill("guide.afConfirmSub", { res: s.res, none: fill("af.notThere", { res: s.res }) }), done: s.confirmed, hide: round })
              : walkStep(k, 2, "mark", { kind: "do", target: "af-words", text: fill(notes ? "guide.afMark" : "guide.afMarkW", { res: s.res }), sub: t("guide.afMarkSub"), done: s.confirmed, hide: round }),
          ]
        : s.phase === 3
          ? [
              // Decidir
              notes
                ? walkStep(k, 3, "compare", { target: "af-recap", text: t("guide.afCompare"), when: !s.needsWords, done: s.answered, hide: [...round, "af-more", "af-question", "af-answer-final"] })
                : walkStep(k, 3, "compare", { target: "af-elsewhere", text: t("guide.afElsewhere"), when: s.elsewhere, done: s.answered, hide: [...round, "af-more", "af-question", "af-answer-final", "af-recap"] }),
              walkStep(k, 3, "back", { target: "af-change", text: t("guide.afBackMark"), when: !s.needsWords, done: s.answered, hide: [...round, "af-thread", "af-answer-final"] }),
              walkStep(k, 3, "thread", { target: "af-thread", text: t("guide.afThread"), when: s.others, done: s.answered, hide: [...round, "af-answer-final"] }),
              walkStep(k, 3, "decide", { ...decide, until: ["af:answered"], done: s.answered, hide: round }),
            ]
          : [];
  const steps: GuideStep[] = [
    ...stage,
    // An answer is said kept, with the way on and the way to change it: in every list, since the screen leaves the step.
    walkStep(k, 3, "saved", { target: "af-saved-now", text: fill("guide.afSaved", { next: t(notes ? "af.nextNote" : "af.nextTerm"), change: t("af.changeMine") }), after: ["af:answered"] }),
    // The cases that come later: with «Guía», when they are on screen.
    { id: "others-chose", seenKey: "afinar:others-chose", manual: true, target: "af-change", text: fill("guide.afOthersChose", { button: t("af.changeTheWords") }), when: s.othersChose && s.confirmed && !s.answered },
    { id: "second", seenKey: "afinar:second", manual: true, target: "af-second", text: fill("guide.afSecond", { same: t("af.second") }) },
    { id: "alike", seenKey: "afinar:alike", manual: true, target: "af-alike", text: t("guide.afAlike") },
    { id: "closed", seenKey: "afinar:closed", manual: true, target: "af-closed", text: fill("guide.afClosed", { button: t("af.reopen") }) },
    { id: "round-close", seenKey: "afinar:round-close", manual: true, target: "round-close", text: fill("guide.afRoundClose", { button: t("round.close") }) },
  ];
  return <GuideScreen steps={steps} ready={ready} />;
}

/** Where the verse in hand stands, as `AlineacionView` has it. */
export type AligningState = {
  mode: "alinear" | "revisar";
  res: "TPL" | "TPS";
  /** What the original is called («Hebreo»). */
  orig: string;
  /** The alignment can be changed here: the verse is this person's to align. */
  editable: boolean;
  /** In a step the team shares, the verse is free: it is taken before it is aligned. */
  canTake: boolean;
  /** A word of the draft is in hand, and which. */
  picked: string;
  /** The first word still to place. */
  nextWord: string;
  complete: boolean;
  /** The verse is marked finished: in a review, it can be answered. */
  ready: boolean;
  answered: boolean;
  proposing: boolean;
  objecting: boolean;
  /** How many agree make a verse reviewed. */
  minAgree: number;
};

export function AligningGuide({ ready, state: s }: { ready: boolean; state: AligningState }) {
  const t = useT();
  const fill = (key: MessageKey, values: Record<string, string>) => Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), t(key));
  const step = (id: string, rest: Omit<GuideStep, "id" | "seenKey" | "flow">): GuideStep => ({ id, seenKey: `flow:alinear-${s.mode}`, flow: true, ...rest });
  if (s.mode === "alinear") {
    const steps: GuideStep[] = [
      step("take", { kind: "tap", target: "al-take", text: fill("guide.alTake", { button: t("al.take") }), when: s.canTake, done: s.editable || s.complete }),
      step("bank", { target: "al-bank", text: fill("guide.alBank", { res: s.res }), done: s.complete, hide: ["al-grid", "al-hint", "al-actionbar", "al-verses"] }),
      step("boxes", { target: "al-grid", text: fill("guide.alBoxes", { orig: s.orig }), done: s.complete, hide: ["al-hint", "al-actionbar", "al-verses"] }),
      // One step in two shapes: a word in hand goes to its box; with none, a word is touched first.
      s.picked
        ? step("place", { kind: "tap", target: "al-grid", text: fill("guide.alPlace", { word: s.picked, orig: s.orig }), sub: t("guide.alPlaceSub"), until: ["al:placed"], done: s.complete, hide: ["al-actionbar", "al-verses"] })
        : step("place", { kind: "tap", target: "al-word", text: fill("guide.alPick", { word: s.nextWord }), until: ["al:placed"], done: s.complete, hide: ["al-actionbar", "al-verses"] }),
      step("remove", { target: "al-chip", text: t("guide.alRemove"), done: s.complete, hide: ["al-actionbar", "al-verses"] }),
      // While the bar is there: the next verse may not be this person's yet, and have no bar to point at.
      step("tools", { target: "al-tools", text: t("guide.alTools"), done: s.complete, hide: ["al-verses"] }),
      step("rest", { kind: "do", text: t("guide.alRest"), sub: t("guide.alRestSub"), done: s.complete, hide: ["al-verses"] }),
      step("done", { kind: "tap", target: "al-done", text: fill("guide.alDone", { button: t("al.markDoneShort") }), until: ["al:verse-done"], done: s.ready }),
      step("next", { target: "al-verses", text: t("guide.alNext"), after: ["al:verse-done"] }),
      { id: "join", seenKey: "alinear:join", target: "al-join", text: fill("guide.alJoin", { button: t("al.mergeBoxes") }) },
      { id: "finish", seenKey: "alinear:finish", target: "al-finish", text: fill("guide.alFinish", { button: t("al.finishStep") }) },
      { id: "fix", seenKey: "alinear:fix", target: "al-fix", text: fill("guide.alFix", { button: t("al.fixOrAsk") }) },
    ];
    return <GuideScreen steps={steps} ready={ready && (s.editable || s.canTake)} />;
  }
  const answer = s.proposing
    ? { kind: "do" as const, target: "al-actionbar", text: fill("guide.alPropose", { button: t("al.sendProposal") }) }
    : s.objecting
      ? { kind: "do" as const, target: "al-actionbar", text: fill("guide.alObject", { button: t("al.sendObjection") }) }
      : { kind: "tap" as const, target: "al-actionbar", text: fill("guide.alAgree", { yes: t("rv.approved") }), sub: fill("guide.alAgreeSub", { revise: t("rv.revise"), object: t("rv.rejected") }) };
  const steps: GuideStep[] = [
    step("read", { target: "al-read", text: fill("guide.alRead", { orig: s.orig, res: s.res }), done: s.answered, hide: ["al-question", "al-actionbar", "al-verses", "al-round"] }),
    step("question", { target: "al-question", text: t("guide.alQuestion"), done: s.answered, hide: ["al-actionbar", "al-verses", "al-round"] }),
    step("answer", { ...answer, until: ["al:answered"], done: s.answered, hide: ["al-verses", "al-round"] }),
    // How a verse comes to be reviewed, said once it has an answer: the panel of the round has nothing to say yet.
    step("next", { target: "al-verses", text: fill("guide.alAnswered", { n: String(s.minAgree) }), after: ["al:answered"] }),
    { id: "not-marked", seenKey: "revisar:not-marked", target: "al-not-marked", text: fill("guide.alNotMarked", { button: t("al.continue") }) },
    { id: "own", seenKey: "revisar:own", target: "al-own", text: t("guide.alOwn") },
    { id: "tell", seenKey: "revisar:tell", target: "al-tell", text: t("guide.alTell") },
    { id: "round-close", seenKey: "afinar:round-close", target: "round-close", text: fill("guide.afRoundClose", { button: t("round.close") }) },
  ];
  return <GuideScreen steps={steps} ready={ready && s.ready} />;
}
