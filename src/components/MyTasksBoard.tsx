import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TASK_GROUPS, type TaskGroup } from "../domain/cardSituation";
import { keepFolds, keptFolds, type Folds } from "../domain/boardFolds";
import { nextCard, taskGroups, type Board, type BoardCard, type TaskGroups } from "../domain/myTasksBoard";
import { bookLabel } from "../domain/books";
import { mixesPhases, phaseOfCard } from "../domain/phaseBadges";
import { localized } from "../domain/processes";
import { localizeName } from "../domain/templateNames";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { GROUP_TITLE, fill } from "./cardWords";
import { TaskCard } from "./TaskCard";

/** From this many cards the search box shows up; below it there is nothing to search. */
const SEARCH_FROM = 12;

/** An open section shows this many cards, and the rest on request: the first screen is what to do, not a list. */
const SECTION_SHOWN = 3;


export type CardHandlers = {
  onPrimary: (card: BoardCard) => void;
  onOpenThread: (card: BoardCard) => (() => void) | undefined;
  onDeliver: (card: BoardCard) => void;
  /** The author takes the draft back to correct it, while its review is open; undefined when that is not theirs to do. */
  onCorrect: (card: BoardCard) => (() => void) | undefined;
  onRelease: (card: BoardCard) => void;
  onOpenNewTab: (card: BoardCard) => void;
  onClaimStep: (card: BoardCard, step: NonNullable<BoardCard["nextStep"]>) => void;
  onApproveStep: (card: BoardCard, step: NonNullable<BoardCard["nextStep"]>) => void;
  onOpenStep: (card: BoardCard, step: NonNullable<BoardCard["nextStep"]>) => void;
  /** A free step: mark it done, or take that back. */
  onToggleStep: (card: BoardCard, step: NonNullable<BoardCard["nextStep"]>) => void;
  isExternal: (card: BoardCard) => boolean;
  /** The tool of a step completes it itself: the card does not offer to. */
  finishesInTool: (card: BoardCard, step: NonNullable<BoardCard["nextStep"]>) => boolean;
};

/**
 * The same handlers, each telling `touch` first which subtarea the person acted on (#84). Those that only say whether
 * an action is there (`onOpenThread`, `onCorrect`, `isExternal`, `finishesInTool`) touch when the action is run.
 */
export function touchingCards(handlers: CardHandlers, touch: (issue: number) => void): CardHandlers {
  const on = <A extends unknown[]>(run: (card: BoardCard, ...rest: A) => void) => (card: BoardCard, ...rest: A) => {
    touch(card.issue.number);
    run(card, ...rest);
  };
  const later = (offer: (card: BoardCard) => (() => void) | undefined) => (card: BoardCard) => {
    const run = offer(card);
    return run
      ? () => {
          touch(card.issue.number);
          run();
        }
      : undefined;
  };
  return {
    ...handlers,
    onPrimary: on(handlers.onPrimary),
    onDeliver: on(handlers.onDeliver),
    onRelease: on(handlers.onRelease),
    onOpenNewTab: on(handlers.onOpenNewTab),
    onClaimStep: on(handlers.onClaimStep),
    onApproveStep: on(handlers.onApproveStep),
    onOpenStep: on(handlers.onOpenStep),
    onToggleStep: on(handlers.onToggleStep),
    onOpenThread: later(handlers.onOpenThread),
    onCorrect: later(handlers.onCorrect),
  };
}

type Props = {
  board: Board;
  login: string;
  now: Date;
  acting: number | null;
  handlers: CardHandlers;
  /** Where the groups the person opened or closed are kept (`boardFoldsKey`); without it they are kept for this visit. */
  foldsKey?: string;
};

/**
 * «Mis tareas» in four groups by the kind of work (#79, see `TaskGroup`): «En progreso», «Requieren mi
 * intervención», «Grupales» and «Libres». What waits for others, is held, paused, of the next book or done is not
 * shown. «Libres» opens by itself only when the filled button is there, or when nothing else is.
 */
export function MyTasksBoard({ board, login, now, acting, handlers, foldsKey }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [search, setSearch] = useState("");
  const sections = useMemo(() => taskGroups(board), [board]);
  // What the person opened or closed by hand; the rest follows the board as it is now. Decided once, «Para tomar»
  // stayed folded after the last card of the person's was handed in, with the filled button inside it.
  // Kept in the device, so a group closed stays closed when the person comes back (#81); read again when the space or
  // the person changes.
  const [folds, setFolds] = useState<{ key: string | undefined; toggled: Folds }>(() => ({ key: foldsKey, toggled: keptFolds(foldsKey) }));
  const toggled = folds.key === foldsKey ? folds.toggled : keptFolds(foldsKey);
  /** The groups shown whole because the person asked for the rest of their cards. */
  const [whole, setWhole] = useState<Set<string>>(() => new Set());

  const all = useMemo(() => TASK_GROUPS.flatMap((g) => sections[g]), [sections]);
  // One filled button on the screen: the card of what to do now.
  const leadCard = nextCard(board);
  const lead = leadCard?.issue.number;
  // «Le toca a usted» and «Esperan» open; «Para tomar» open when the filled button is there (nothing of the person's
  // to press); «Más» folded.
  // What is the person's open; «Libres» only when the filled button is there, or nothing else is.
  const openByDefault = (group: TaskGroup) => group !== "free" || !leadCard || sections.free.includes(leadCard) || all.length === sections.free.length;
  const isOpenSection = (group: TaskGroup) => toggled.get(group) ?? openByDefault(group);
  const projects = new Set(all.map((c) => c.bucket?.projectId).filter(Boolean));
  // Whoever works in more than one team is told the phase of each card; whoever works in one, nothing more.
  const mixed = mixesPhases(all);
  const showSearch = all.length >= SEARCH_FROM;
  const needle = search.trim().toLowerCase();

  const filtered = useMemo((): TaskGroups => {
    if (!needle) return sections;
    // Only when the cards say their phase: a match on a word nobody can see on the card looks like a fault.
    const phaseName = (c: BoardCard) => {
      const phase = mixed ? phaseOfCard(c) : undefined;
      return phase ? localized(phase.name, phase.names, language) : "";
    };
    const match = (c: BoardCard) =>
      `${localizeName(c.taskName, language)} ${bookLabel(c.book, language)} ${c.place} ${c.issue.title} ${phaseName(c)}`.toLowerCase().includes(needle);
    return Object.fromEntries(TASK_GROUPS.map((g) => [g, sections[g].filter(match)])) as TaskGroups;
  }, [sections, needle, language, mixed]);

  const toggle = (section: TaskGroup) => {
    const next = new Map(toggled).set(section, !isOpenSection(section));
    keepFolds(foldsKey, next);
    setFolds({ key: foldsKey, toggled: next });
  };

  const renderCards = (cards: BoardCard[], key: string, first: number) => {
    // Two cards more are not worth a button to see them.
    const cut = !needle && !whole.has(key) && cards.length > first + 1;
    const shown = cut ? cards.slice(0, first) : cards;
    return (
      <div className="task-board__cards">
        {shown.map((card) => (
          <TaskCard
            key={card.issue.number}
            card={card}
            login={login}
            now={now}
            busy={acting === card.issue.number}
            externalTool={handlers.isExternal(card)}
            finishesInTool={(step) => handlers.finishesInTool(card, step)}
            projectLabel={projects.size > 1 ? card.bucket?.title : undefined}
            phase={mixed ? phaseOfCard(card) : undefined}
            lead={card.issue.number === lead}
            onPrimary={() => handlers.onPrimary(card)}
            onOpenThread={handlers.onOpenThread(card)}
            onOpenDecision={card.decisions?.length ? () => handlers.onPrimary({ ...card, action: { kind: "proposals" } }) : undefined}
            onDeliver={card.canDeliver ? () => handlers.onDeliver(card) : undefined}
            onCorrect={handlers.onCorrect(card)}
            onRelease={card.canRelease ? () => handlers.onRelease(card) : undefined}
            onOpenNewTab={() => handlers.onOpenNewTab(card)}
            onClaimStep={(step) => handlers.onClaimStep(card, step)}
            onApproveStep={(step) => handlers.onApproveStep(card, step)}
            onOpenStep={(step) => handlers.onOpenStep(card, step)}
            onToggleStep={(step) => handlers.onToggleStep(card, step)}
          />
        ))}
        {cut ? (
          <button type="button" className="task-board__rest" onClick={() => setWhole((prev) => new Set(prev).add(key))}>
            {fill(t("tc.showRest"), { n: cards.length - first })}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="task-board">
      {showSearch ? <Input className="task-board__search" placeholder={t("tb.search")} aria-label={t("tb.search")} value={search} onChange={(e) => setSearch(e.target.value)} /> : null}
      {TASK_GROUPS.map((section) => {
        const count = filtered[section].length;
        if (!count) return null;
        const isOpen = isOpenSection(section) || Boolean(needle);
        return (
          <section key={section} className="task-board__group" data-section={section}>
            <button type="button" className="task-board__head" aria-expanded={isOpen} onClick={() => toggle(section)}>
              <ChevronRight className="task-board__chevron" data-open={isOpen || undefined} aria-hidden />
              <span className="task-board__title">{t(GROUP_TITLE[section])}</span>
              <span className="task-board__count">{count}</span>
            </button>
            {!isOpen ? null : (
              renderCards(filtered[section], section, SECTION_SHOWN)
            )}
          </section>
        );
      })}
    </div>
  );
}
