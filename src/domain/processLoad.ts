import { portionKey } from "./chapters";
import type { SolverApp, ToolWalk, WalkUnit } from "./solvers";
import { stepClaimMode, stepMaxAssignees, stepMinAssignees } from "./stepClaim";
import type { AssignmentsDoc, InventoryDoc, ProjectTask, TaskStep } from "./types";
import type { WorkOrder } from "./workOrder";

/**
 * How much each step of a process asks of one person, read before anybody works: for every step, how many people
 * take it, how big its largest subtarea is, and how many people wait for it. A process can be correct (every piece
 * fits) and still be badly shared out: one person answering 110 key terms while three others wait. That shows only
 * when the process meets a book, so this reads both.
 *
 * Nothing here knows a process. What a tool walks one by one is said by the tool (`walks`); without it, a step is as
 * big as its subtarea: the verses of a text, or the items of anything else.
 */

export type LoadLimits = {
  /** The most items one person should have to finish alone in one subtarea. */
  soloItems: number;
  /** The most people who should be waiting for one person to finish. */
  waiting: number;
};

export const DEFAULT_LOAD_LIMITS: LoadLimits = { soloItems: 40, waiting: 2 };

/** `solo`: one person carries too many items. `waiting`: too many people wait for one person. */
export type LoadFlag = "solo" | "waiting";

export type StepLoad = {
  taskId: string;
  stepId: string;
  /** How many people the step needs and admits; one and one when a single person takes it. */
  people: { min: number; max: number };
  solo: boolean;
  subtasks: number;
  /** The size of its largest subtarea, and which one it is. */
  largest: number;
  largestLabel: string;
  /** Once the project exists: who holds that much, assigned and not handed in. */
  holder?: string;
  unit: WalkUnit;
  /** The tool's own word for what it walks, when it has one. */
  walk?: ToolWalk;
  /** The size is an estimate (the book does not say it exactly before the work exists). */
  approx: boolean;
  /** People the later steps of the task need at least, who cannot start until this one is done. */
  waiting: number;
  flags: LoadFlag[];
};

const TEXTS = new Set(["tpl", "tps"]);

/**
 * How big a subtarea is for a step: what its tool walks or, when the tool does not say, what the subtarea is made
 * of (the verses of a text, the notes or questions of its passages, its articles; everything together when a task
 * mixes them).
 */
export function orderSize(order: WorkOrder, task: ProjectTask, inventory: InventoryDoc, walk?: ToolWalk): { size: number; unit: WalkUnit; approx: boolean } {
  const portions = inventory.portions.filter((portion) => order.portionIds.includes(portionKey(portion)) || order.portionIds.includes(portion.ref));
  const count: Record<WalkUnit, () => number> = {
    verses: () => portions.reduce((sum, portion) => sum + portion.verses.length, 0),
    notes: () => portions.reduce((sum, portion) => sum + (portion.notas || 0), 0),
    questions: () => portions.reduce((sum, portion) => sum + (portion.preguntas || 0), 0),
    items: () => order.itemTypes.filter((type) => type === "articulo").length,
  };
  const times = walk?.times && walk.times > 0 ? walk.times : 1;
  if (walk) return { size: Math.round(count[walk.unit]() * times), unit: walk.unit, approx: Boolean(walk.approx) || times !== 1 };
  const resources = [...new Set(task.rules.map((rule) => rule.resource as string))];
  const unitOf = (resource: string): WalkUnit => (TEXTS.has(resource) ? "verses" : resource === "notas" ? "notes" : resource === "preguntas" ? "questions" : "items");
  // Two texts of the same passage are the same verses, read once.
  const units = [...new Set(resources.map(unitOf))];
  const size = units.reduce((sum, unit) => sum + count[unit](), 0);
  return { size, unit: units.length === 1 ? units[0]! : "items", approx: false };
}

/** A step somebody works through item by item in each subtarea (not a reading done once, a checklist or a machine's step). */
function walked(step: TaskStep, tool: SolverApp | undefined): boolean {
  if (step.scope && step.scope !== "subtask") return false;
  if (tool?.walks) return true;
  return step.closing !== "automatic" && step.closing !== "checklist";
}

/**
 * The tools a board's steps open, each with what it walks: an organization's saved copy of a tool keeps its own
 * address and name, and takes what it walks from the shipped one when it does not say it.
 */
export function toolsWithWalks(saved: SolverApp[], shipped: SolverApp[]): SolverApp[] {
  const mine = new Set(saved.map((tool) => tool.id));
  return [...saved.map((tool) => (tool.walks ? tool : { ...tool, walks: shipped.find((row) => row.id === tool.id)?.walks })), ...shipped.filter((tool) => !mine.has(tool.id))];
}

/** Where a step of a subtarea stands once the project exists: done, or in somebody's hands. */
export type StepHold = { done: boolean; who?: string };

/**
 * Before the project exists, the load of a step is its largest subtarea: what one person could be handed. Once it
 * exists (`held`), what counts is what each person actually has: for a step one person takes, everything assigned
 * to them and not handed in, across their subtareas. Work handed in is nobody's load, and a subtarea nobody took is
 * not yet anybody's.
 */
export function processLoad(
  board: AssignmentsDoc,
  inventory: InventoryDoc,
  orders: WorkOrder[],
  tools: SolverApp[],
  limits: LoadLimits = DEFAULT_LOAD_LIMITS,
  held?: (order: WorkOrder, stepId: string) => StepHold,
): StepLoad[] {
  const rows: StepLoad[] = [];
  for (const task of board.teams) {
    const mine = orders.filter((order) => order.teamId === task.id);
    const steps = task.steps ?? [];
    if (!mine.length) continue;
    steps.forEach((step, index) => {
      const tool = tools.find((row) => row.id === step.solverAppId);
      if (!walked(step, tool)) return;
      let largest = 0, largestLabel = "", holder: string | undefined, unit: WalkUnit = "items", approx = false;
      const solo = stepClaimMode(step) !== "pool";
      const pending = held ? mine.filter((order) => !held(order, step.id).done) : mine;
      const byPerson = new Map<string, number>();
      for (const order of pending) {
        const sized = orderSize(order, task, inventory, tool?.walks);
        unit = sized.unit;
        approx = sized.approx;
        if (held && solo) {
          const who = held(order, step.id).who?.trim().toLowerCase();
          if (!who) continue;
          const total = (byPerson.get(who) ?? 0) + sized.size;
          byPerson.set(who, total);
          if (total > largest) {
            largest = total;
            largestLabel = order.label;
            holder = who;
          }
        } else if (sized.size > largest) {
          largest = sized.size;
          largestLabel = order.label;
        }
      }
      if (!largest) return;
      const waiting = solo ? steps.slice(index + 1).reduce((most, later) => Math.max(most, stepMinAssignees(later)), 0) : 0;
      const flags: LoadFlag[] = [];
      if (solo && largest > limits.soloItems) flags.push("solo");
      if (solo && waiting > limits.waiting) flags.push("waiting");
      rows.push({
        taskId: task.id,
        stepId: step.id,
        people: solo ? { min: 1, max: 1 } : { min: stepMinAssignees(step), max: stepMaxAssignees(step) },
        solo,
        subtasks: pending.length,
        largest,
        largestLabel,
        ...(holder ? { holder } : {}),
        unit,
        ...(tool?.walks ? { walk: tool.walks } : {}),
        approx,
        waiting,
        flags,
      });
    });
  }
  return rows;
}
