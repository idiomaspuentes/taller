import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookLabel } from "../domain/books";
import { portionKey, verseRangeLabel } from "../domain/chapters";
import { addExtraWork, isExtraItemId, removeExtraWork } from "../domain/extraWork";
import { orderedPhases, planOfBoard, tasksOfPhase } from "../domain/plan";
import { displayOrgTeamName } from "../domain/roles";
import { bookSize, startNotices, type StartNotice } from "../domain/startBook";
import { localizeName } from "../domain/templateNames";
import type { AssignmentsDoc, InventoryDoc, ProjectSettings } from "../domain/types";
import { publishableWorkOrders, type WorkOrder } from "../domain/workOrder";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { DEFAULT_MAX_CHAPTER_VERSES, longChapters, splitChapter } from "../domain/handoff";
import { HandoffUnitsPanel } from "./HandoffUnitsPanel";
import { PortionCutsPanel } from "./PortionCutsPanel";

type Props = {
  board: AssignmentsDoc;
  inventory: InventoryDoc;
  /** Change what the project adds to its process (subtareas by hand, chapters split into stretches). Absent: read only. */
  onSettings?: (settings: ProjectSettings) => void;
  /** Cut the portions differently; the host reads the book again. Absent: the portions are fixed (the project exists). */
  onPortionStarts?: (settings: ProjectSettings) => void;
  busy?: boolean;
  /** What each subtarea is in Door43 once the project exists, by the key of its work order. */
  stateOf?: (order: WorkOrder) => { label: string; tone: "open" | "taken" | "done" } | undefined;
};

const NOTICE_KEY: Record<StartNotice, MessageKey> = { "no-notes": "sb.noNotes", "no-questions": "sb.noQuestions", "no-second-text": "sb.noSecondText" };

/**
 * The subtareas a project lays out, phase by phase and task by task: what «Crear proyecto» will write, seen before it
 * does. Here is also where the book is cut differently, and where a subtarea the book does not give is added by hand.
 */
export function WorkPreview({ board, inventory, onSettings, onPortionStarts, busy, stateOf }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const orders = useMemo(() => publishableWorkOrders(board, inventory), [board, inventory]);
  const plan = planOfBoard(board);
  const phases = orderedPhases(plan);
  const size = bookSize(inventory);
  const book = (board.books?.[0] || board.book).toUpperCase();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [portionId, setPortionId] = useState("");
  const [section, setSection] = useState<"portions" | "units" | null>(null);
  const max = board.settings?.maxChapterVerses ?? DEFAULT_MAX_CHAPTER_VERSES;
  const long = useMemo(() => longChapters(inventory.portions, board.settings?.handoffUnits, max), [inventory.portions, board.settings?.handoffUnits, max]);
  const splitCount = board.settings?.handoffUnits?.length ?? 0;
  const byTask = useMemo(() => {
    const map = new Map<string, WorkOrder[]>();
    for (const order of orders) map.set(order.teamId, [...(map.get(order.teamId) ?? []), order]);
    return map;
  }, [orders]);
  const name = (row: { name: string; names?: Partial<Record<string, string>> }) => localizeName(row.names?.[language] ?? row.name, language);

  function add(taskId: string) {
    if (!onSettings || !title.trim()) return;
    onSettings(addExtraWork(board.settings, { taskId, title, ...(portionId ? { portionId } : {}) }));
    setTitle("");
    setPortionId("");
    setAdding(null);
    setOpen((prev) => new Set(prev).add(taskId));
  }

  return (
    <div className="wp">
      <dl className="wp-stats">
        <div>
          <dt>{t("wp.book")}</dt>
          <dd>{bookLabel(book, language)}</dd>
        </div>
        <div>
          <dt>{t("wp.chapters")}</dt>
          <dd>{size.chapters}</dd>
        </div>
        <div>
          <dt>{t("wp.portions")}</dt>
          <dd>{size.portions}</dd>
        </div>
        <div>
          <dt>{t("wp.subtasks")}</dt>
          <dd>{orders.length}</dd>
        </div>
      </dl>

      {startNotices(inventory).map((notice) => (
        <p key={notice} className="af-stale">
          {t(NOTICE_KEY[notice])}
        </p>
      ))}

      {onPortionStarts ? (
        <div className="wp-tools">
          <button type="button" className="wp-tool" aria-expanded={section === "portions"} onClick={() => setSection(section === "portions" ? null : "portions")}>
            <span className="wp-tool__name">{t("wp.cutPortions")}</span>
            <span className="wp-tool__hint">{t("wp.cutPortionsHint")}</span>
          </button>
        </div>
      ) : null}
      {onSettings && long.length ? (
        <div className="wp-suggest" role="status">
          <p className="wp-suggest__title">{t(long.length === 1 ? "wp.longOne" : "wp.longMany").replace("{n}", String(long.length)).replace("{max}", String(max))}</p>
          <ul>
            {long.map((row) => (
              <li key={row.chapter}>
                {t("wp.longRow")
                  .replace("{chapter}", String(row.chapter))
                  .replace("{verses}", String(row.verses))
                  .replace("{parts}", String(row.cuts.length + 1))}
              </li>
            ))}
          </ul>
          <div className="wp-suggest__actions">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                let units = board.settings?.handoffUnits;
                for (const row of long) units = splitChapter(units, row.chapter, row.portionIds, row.cuts);
                onSettings({ ...board.settings, handoffUnits: units });
                setSection("units");
              }}
            >
              {t("wp.splitSuggested")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSection(section === "units" ? null : "units")}>
              {t("wp.splitChoose")}
            </Button>
          </div>
        </div>
      ) : null}
      {onSettings && size.portions > size.chapters ? (
        <div className="wp-limit">
          <label>
            {t("wp.limitA")}{" "}
            <input
              className="af-input pe-num"
              type="number"
              min={1}
              value={max}
              disabled={busy}
              aria-label={t("wp.limitAria")}
              onChange={(e) => {
                const value = Math.floor(Number(e.target.value));
                if (value >= 1) onSettings({ ...board.settings, maxChapterVerses: value });
              }}
            />{" "}
            {t("wp.limitB")}
          </label>
          {!long.length ? (
            <button type="button" className="pe-link" aria-expanded={section === "units"} onClick={() => setSection(section === "units" ? null : "units")}>
              {t(splitCount ? "wp.seeSplit" : "wp.splitAnyway")}
            </button>
          ) : null}
        </div>
      ) : null}
      {section === "portions" && onPortionStarts ? <PortionCutsPanel key={inventory.generated_at ?? "p"} book={book} portions={inventory.portions} settings={board.settings} onApply={onPortionStarts} busy={busy} /> : null}
      {section === "units" && onSettings ? (
        <HandoffUnitsPanel
          portions={inventory.portions}
          units={board.settings?.handoffUnits}
          onChange={(units) => {
            const { handoffUnits: _previous, ...rest } = board.settings ?? {};
            onSettings(units.length ? { ...rest, handoffUnits: units } : rest);
          }}
        />
      ) : null}

      {phases.map((phase) => {
        const tasks = tasksOfPhase(plan, phase.id);
        const total = tasks.reduce((sum, task) => sum + (byTask.get(task.id)?.length ?? 0), 0);
        return (
          <section key={phase.id} className="wp-phase">
            <header className="wp-phase__head">
              <h3>{name(phase)}</h3>
              <span>{t(total === 1 ? "wp.subtasksOne" : "wp.subtasksMany").replace("{n}", String(total))}</span>
            </header>
            <ul className="wp-tasks">
              {tasks.map((task) => {
                const rows = byTask.get(task.id) ?? [];
                const isOpen = open.has(task.id);
                const own = board.teams.find((row) => row.id === task.id);
                return (
                  <li key={task.id} className="wp-task">
                    <div className="wp-task__row">
                      <button
                        type="button"
                        className="wp-task__main"
                        aria-expanded={isOpen}
                        onClick={() =>
                          setOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(task.id)) next.delete(task.id);
                            else next.add(task.id);
                            return next;
                          })
                        }
                      >
                        {isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                        <span className="wp-task__name">{name(task)}</span>
                        <span className="wp-task__meta">{own?.orgTeamName ? displayOrgTeamName(own.orgTeamName) : t("wp.noTeam")}</span>
                        <span className="wp-task__count" data-none={rows.length ? undefined : "true"}>
                          {rows.length}
                        </span>
                      </button>
                      {onSettings ? (
                        <button
                          type="button"
                          className="pe-icon"
                          aria-label={t("wp.addTo").replace("{task}", name(task))}
                          title={t("wp.add")}
                          onClick={() => {
                            setAdding(adding === task.id ? null : task.id);
                            setTitle("");
                            setPortionId("");
                          }}
                        >
                          <Plus size={16} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                    {adding === task.id ? (
                      <form
                        className="wp-add"
                        onSubmit={(e) => {
                          e.preventDefault();
                          add(task.id);
                        }}
                      >
                        <input className="af-input" value={title} autoFocus placeholder={t("wp.addPlaceholder")} aria-label={t("wp.addTitle")} onChange={(e) => setTitle(e.target.value)} />
                        <select className="af-input" value={portionId} aria-label={t("wp.addAbout")} onChange={(e) => setPortionId(e.target.value)}>
                          <option value="">{t("wp.wholeBook")}</option>
                          {inventory.portions.map((portion) => (
                            <option key={portionKey(portion)} value={portionKey(portion)}>
                              {verseRangeLabel(portion.ref) || portion.ref}
                            </option>
                          ))}
                        </select>
                        <div className="pf-footer__actions">
                          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(null)}>
                            {t("pj.cancel")}
                          </Button>
                          <Button type="submit" size="sm" disabled={!title.trim()}>
                            {t("wp.add")}
                          </Button>
                        </div>
                      </form>
                    ) : null}
                    {isOpen ? (
                      rows.length ? (
                        <ul className="wp-orders">
                          {rows.map((order) => {
                            const extra = order.itemIds.length === 1 && isExtraItemId(order.itemIds[0]!);
                            const state = stateOf?.(order);
                            return (
                              <li key={order.key} className="wp-order" data-extra={extra ? "true" : undefined} data-tone={state?.tone}>
                                <span>{order.label}</span>
                                {state ? <small>{state.label}</small> : extra ? <small>{t("wp.byHand")}</small> : null}
                                {extra && onSettings ? (
                                  <button type="button" aria-label={t("wp.remove").replace("{title}", order.label)} onClick={() => onSettings(removeExtraWork(board.settings, order.itemIds[0]!.slice("extra:".length)))}>
                                    <X size={14} aria-hidden />
                                  </button>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="pe-hint wp-none">{task.general || !task.rules.length ? t("wp.noneGeneral") : t("wp.none")}</p>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
