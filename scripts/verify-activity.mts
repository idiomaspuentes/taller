/**
 * The pace of a project (subtareas finished per week, and when it would end) and how much each person worked and
 * when (the stretches Door43 counts, and what the plan says they closed).
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { calendarWeeks, dayOf, lastDays, mergePeople, peopleWork, recentDays, workDays, workLevel, workSummary, type HeatSlot } from "../src/domain/activity";
import { paceNumber, paceOf } from "../src/domain/pace";
import { emptyTaskProgress, encodeTaskProgressMarker, markStepDone, stampDoneSteps, withStepRuntime, withStepWork, type TaskProgressMarker } from "../src/domain/taskProgress";
import type { AssignmentsDoc, ProjectTask } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// Tuesday 6 October 2026, 15:00 in Bogotá (UTC−5).
const now = new Date("2026-10-06T20:00:00Z");
const BOGOTA = -300;
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const STEPS = ["borrador", "pares"];
const rule = { resource: "tpl" as const, articleFilter: "pending" as const };
const board: Pick<AssignmentsDoc, "teams"> = {
  teams: [{ id: "tpl", name: "Traducir TPL", description: "", phaseId: "f1", memberIds: [], scope: ["tpl"], rules: [rule], steps: STEPS.map((id) => ({ id, name: id })) } as ProjectTask],
};

let n = 0;
function issue(o: { assignee?: string; created?: number; closed?: number; marker?: TaskProgressMarker; key?: string } = {}): DcsIssue {
  n++;
  const order = JSON.stringify({ schema: "gateway-work-order-1", key: o.key ?? `tpl|p${n}`, book: "JUD", teamId: "tpl", resource: "tpl", portionIds: [`p${n}`], itemIds: [] });
  const marker = o.marker ?? (o.closed !== undefined ? STEPS.reduce((m, id) => markStepDone(m, id), emptyTaskProgress()) : undefined);
  return {
    id: n, number: n, title: "JUD · tpl", state: o.closed !== undefined ? "closed" : "open",
    body: `<!-- gateway-work-order ${order} -->\n${marker ? encodeTaskProgressMarker(marker) : ""}`,
    labels: [{ name: "pm/tarea:tpl" }],
    assignee: o.assignee ? { login: o.assignee } : null,
    assignees: o.assignee ? [{ login: o.assignee }] : [],
    created_at: ago(o.created ?? 60),
    closed_at: o.closed !== undefined ? ago(o.closed) : undefined,
  } as unknown as DcsIssue;
}

test("el ritmo son las subtareas terminadas por semana, sobre las últimas cuatro", () => {
  // Eight finished in the last four weeks, two long before; four still open, one of them half done.
  const issues = [
    ...[1, 2, 3, 9, 10, 16, 20, 27].map((closed) => issue({ closed })),
    issue({ closed: 40 }), issue({ closed: 50 }),
    issue(), issue(), issue(),
    issue({ marker: markStepDone(emptyTaskProgress(), "borrador") }),
  ];
  const pace = paceOf(issues, board, now);
  assert.deepEqual(pace.weeks, [1, 0, 1, 0, 1, 2, 2, 3], "ocho semanas, la más antigua primero");
  assert.equal(pace.perWeek, 2);
  assert.equal(pace.left, 3.5, "tres sin empezar y media de la que va por la mitad");
  // 3.5 left at 2 a week: twelve days and a quarter from now.
  assert.equal(pace.endsAt, new Date(now.getTime() + 12.25 * 86_400_000).toISOString());
});

test("un proyecto joven se mide por las semanas que tiene; sin nada terminado no promete una fecha", () => {
  const young = paceOf([issue({ created: 5, closed: 1 }), issue({ created: 5, closed: 2 }), issue({ created: 5 })], board, now);
  assert.equal(young.perWeek, 2, "dos en su primera semana son dos por semana, no media");
  assert.ok(young.endsAt);
  const still = paceOf([issue({ closed: 40 }), issue()], board, now);
  assert.equal(still.perWeek, 0);
  assert.equal(still.endsAt, undefined);
  const over = paceOf([issue({ closed: 3 })], board, now);
  assert.deepEqual([over.left, over.endsAt], [0, undefined], "terminado: no queda fecha que dar");
  // Dropped by the plan (closed with steps undone) and team decisions are not work finished.
  const dropped = paceOf([issue({ closed: 2, marker: emptyTaskProgress() }), issue({ closed: 2, key: "tpl|decision:1" })], board, now);
  assert.deepEqual(dropped.weeks.reduce((a, b) => a + b, 0), 0);
  assert.deepEqual([paceNumber(2, "es"), paceNumber(2.54, "es"), paceNumber(0.04, "es"), paceNumber(0, "es"), paceNumber(12.4, "es")], ["2", "2,5", "0,1", "0", "12"]);
});

const slot = (iso: string, contributions = 1): HeatSlot => ({ timestamp: Date.parse(iso) / 1000, contributions });

test("un día trabajado son sus tramos de quince minutos, en la hora de quien lo lee", () => {
  const days = workDays([
    slot("2026-10-06T14:15:00Z"), slot("2026-10-06T14:30:00Z", 4), slot("2026-10-06T19:00:00Z"),
    // 03:30 UTC on the 6th is still the evening of the 5th in Bogotá.
    slot("2026-10-06T03:30:00Z"),
    slot("2026-10-01T15:00:00Z"),
    { timestamp: Number.NaN, contributions: 3 }, slot("2026-10-02T15:00:00Z", 0),
  ], BOGOTA);
  assert.deepEqual([...days.keys()].sort(), ["2026-10-01", "2026-10-05", "2026-10-06"]);
  const today = days.get("2026-10-06")!;
  assert.equal(today.minutes, 45, "tres tramos, hagan lo que hagan en cada uno");
  assert.deepEqual([new Date(today.from).toISOString(), new Date(today.to).toISOString()], ["2026-10-06T14:15:00.000Z", "2026-10-06T19:15:00.000Z"]);
  assert.equal(dayOf(Date.parse("2026-10-06T03:30:00Z"), 0), "2026-10-06", "el mismo momento, leído en otra parte");
  assert.deepEqual([0, 15, 30, 45, 60, 120, 135].map(workLevel), [0, 1, 1, 2, 2, 3, 4]);
});

test("el calendario va por semanas de lunes a domingo, y la semana en curso es la última", () => {
  const days = workDays([slot("2026-10-06T14:15:00Z"), slot("2026-10-05T14:15:00Z"), slot("2026-10-05T14:30:00Z"), slot("2026-09-28T15:00:00Z"), slot("2026-09-20T15:00:00Z")], BOGOTA);
  const weeks = calendarWeeks(days, now, 3, BOGOTA);
  assert.equal(weeks.length, 3);
  assert.deepEqual(weeks.map((week) => week[0]!.day), ["2026-09-21", "2026-09-28", "2026-10-05"], "cada columna empieza en lunes");
  assert.deepEqual(weeks[2]!.map((day) => [day.minutes, day.future]), [[30, false], [15, false], [0, true], [0, true], [0, true], [0, true], [0, true]]);
  assert.deepEqual(weeks[1]!.map((day) => day.level), [1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(weeks[0]!.every((day) => day.minutes === 0), true, "el domingo 20 queda fuera de las tres semanas");
  assert.deepEqual(workSummary(days, now, 7, BOGOTA), { days: 2, minutes: 45 });
  assert.deepEqual(workSummary(days, now, 28, BOGOTA), { days: 4, minutes: 75 });
  assert.deepEqual(recentDays(days, now, 7, BOGOTA).map((day) => day.day), ["2026-10-06", "2026-10-05"], "el más reciente primero");
  // The line of squares of a person shows the very days its sum counts: the last ones up to today, whatever the weekday.
  const line = lastDays(days, now, 28, BOGOTA);
  assert.deepEqual([line.length, line[0]!.day, line[27]!.day], [28, "2026-09-09", "2026-10-06"]);
  assert.deepEqual([line.filter((day) => day.minutes).length, line.reduce((sum, day) => sum + day.minutes, 0)], [4, 75], "lo mismo que dice su resumen");
});

test("de cada persona, lo que el plan dice que cerró: pasos y subtareas, y lo que tiene en la mano", () => {
  const closedBy = (who: string, daysAgo: number, stepId: string, from: TaskProgressMarker = emptyTaskProgress()) => stampDoneSteps(from, markStepDone(from, stepId), who, ago(daysAgo)).marker;
  const drafted = closedBy("ana", 3, "borrador");
  const reviewed = closedBy("Bea", 1, "pares", drafted);
  const issues = [
    issue({ assignee: "ana", closed: 1, marker: reviewed }),
    issue({ assignee: "ana", marker: withStepWork(withStepRuntime(closedBy("ana", 40, "borrador"), "pares", { assignees: ["carla"], approvals: [] }), "pares", { done: 1, total: 4 }) }),
    issue({ assignee: "bea" }),
    issue({ assignee: "ana", closed: 45 }),
    issue({ assignee: "ana", closed: 2, marker: emptyTaskProgress() }),
  ];
  const people = peopleWork(issues, board, new Date(now.getTime() - 28 * 86_400_000));
  assert.deepEqual(people, [
    { login: "ana", steps: 1, finished: 1, inHand: 1 },
    { login: "Bea", steps: 1, finished: 0, inHand: 1 },
    { login: "carla", steps: 0, finished: 0, inHand: 0 },
  ], "lo de hace cuarenta días no es de estas cuatro semanas; la retirada no cuenta; «Bea» y «bea» son una");
  assert.deepEqual(mergePeople([people, [{ login: "ANA", steps: 2, finished: 0, inHand: 3 }, { login: "dani", steps: 0, finished: 0, inHand: 1 }]]).map((row) => [row.login, row.steps, row.finished, row.inHand]), [
    ["ana", 3, 1, 4], ["Bea", 1, 0, 1], ["dani", 0, 0, 1], ["carla", 0, 0, 0],
  ]);
});

console.log(`\nverify-activity: ${passed} checks passed.`);
