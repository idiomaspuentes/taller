import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GROUP_ORDER, OPEN_GROUPS, type Board, type BoardCard, type BoardGroup } from "../domain/myTasksBoard";
import { bookLabel } from "../domain/books";
import { localizeName } from "../domain/templateNames";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { TaskCard } from "./TaskCard";

const GROUP_TITLE: Record<BoardGroup, MessageKey> = {
  decide: "tb.group.decide",
  doing: "tb.group.doing",
  todo: "tb.group.todo",
  reviews: "tb.group.reviews",
  free: "tb.group.free",
  later: "tb.group.later",
  waiting: "tb.group.waiting",
  done: "tb.group.done",
};

/** From this many cards the search box shows up; below it there is nothing to search. */
const SEARCH_FROM = 12;

/**
 * Of what is not the person's own work (what can be taken, what waits, what is done) this many cards are shown,
 * and the rest on request: opened whole, the work a team could take was thirteen screens of cards on a phone.
 */
const FIRST_SHOWN = 6;

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

type Props = {
  board: Board;
  login: string;
  now: Date;
  acting: number | null;
  handlers: CardHandlers;
};

/**
 * «Mis tareas»: the cards grouped by what there is to do. What needs the person is open; the rest is folded with
 * its count, so the screen starts short.
 */
export function MyTasksBoard({ board, login, now, acting, handlers }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<BoardGroup>>(() => {
    const start = new Set<BoardGroup>(OPEN_GROUPS);
    // Nothing of mine to do: open what can be taken, so the screen is never just closed boxes.
    if (OPEN_GROUPS.every((g) => board[g].length === 0)) start.add("free");
    return start;
  });

  const all = GROUP_ORDER.flatMap((g) => board[g]);
  const projects = new Set(all.map((c) => c.bucket?.projectId).filter(Boolean));
  const showSearch = all.length >= SEARCH_FROM;
  const needle = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!needle) return board;
    const match = (c: BoardCard) =>
      `${localizeName(c.taskName, language)} ${bookLabel(c.book, language)} ${c.place} ${c.issue.title}`.toLowerCase().includes(needle);
    return Object.fromEntries(GROUP_ORDER.map((g) => [g, board[g].filter(match)])) as Board;
  }, [board, needle, language]);

  /** The groups shown whole because the person asked for the rest of their cards. */
  const [whole, setWhole] = useState<Set<BoardGroup>>(() => new Set());

  const toggle = (g: BoardGroup) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <div className="task-board">
      {showSearch ? <Input className="task-board__search" placeholder={t("tb.search")} aria-label={t("tb.search")} value={search} onChange={(e) => setSearch(e.target.value)} /> : null}
      {GROUP_ORDER.map((group) => {
        const cards = filtered[group];
        if (!cards.length) return null;
        const isOpen = open.has(group) || Boolean(needle);
        // Two or three cards more are not worth a button to see them.
        const few = !OPEN_GROUPS.includes(group) && !needle && !whole.has(group) && cards.length > FIRST_SHOWN + 2;
        const shown = few ? cards.slice(0, FIRST_SHOWN) : cards;
        return (
          <section key={group} className="task-board__group" data-group={group}>
            <button type="button" className="task-board__head" aria-expanded={isOpen} onClick={() => toggle(group)}>
              <ChevronRight className="task-board__chevron" data-open={isOpen || undefined} aria-hidden />
              <span className="task-board__title">{t(GROUP_TITLE[group])}</span>
              <span className="task-board__count">{cards.length}</span>
            </button>
            {isOpen ? (
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
                    onPrimary={() => handlers.onPrimary(card)}
                    onOpenThread={handlers.onOpenThread(card)}
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
                {few ? (
                  <button type="button" className="task-board__rest" onClick={() => setWhole((prev) => new Set(prev).add(group))}>
                    {t("tb.showRest").replace("{n}", String(cards.length - FIRST_SHOWN))}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
