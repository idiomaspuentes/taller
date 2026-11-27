/**
 * «Lo que hiciste esta semana» on the profile (#78): the subtareas of the person finished this week and the steps
 * they closed, day by day from Monday, and the finished ones by project (closed projects too). Nothing from before
 * the week, nothing of other people.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { myWeek, weekStart } from "../src/domain/myWeek";
import { encodeTaskProgressMarker } from "../src/domain/taskProgress";
import { encodeWorkOrderMarker } from "../src/domain/workOrder";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// Thursday 26 November 2026, 15:00 local: the week starts on Monday the 23rd.
const NOW = new Date(2026, 10, 26, 15, 0);
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour, 0).toISOString();

let n = 0;
function issue(opts: { project: string; owner?: string; closedOn?: number; steps?: Record<string, { by: string; day: number }> }): DcsIssue {
  n++;
  const order = encodeWorkOrderMarker({ key: `tpl|${n}`, teamId: "tpl", teamName: "Traducir TPL", book: opts.project, resource: "tpl", chapter: 1, portionIds: [`p${n}`], itemIds: [], itemTypes: [], label: `1:${n}` });
  const steps = Object.fromEntries(Object.entries(opts.steps ?? {}).map(([id, s]) => [id, { assignees: [s.by], approvals: [s.by], done: { by: s.by, at: at(s.day) } }]));
  const progress = encodeTaskProgressMarker({ schema: "gateway-task-progress-2", doneStepIds: Object.keys(steps), steps } as never);
  return {
    id: n,
    number: n,
    title: `${opts.project} 1:${n} · Traducir TPL`,
    state: opts.closedOn ? "closed" : "open",
    closed_at: opts.closedOn ? at(opts.closedOn) : null,
    body: `${order}\n\n${progress}`,
    milestone: { title: opts.project },
    labels: [{ name: "pm/tarea:tpl" }],
    assignee: opts.owner ? { login: opts.owner } : null,
    assignees: opts.owner ? [{ login: opts.owner }] : [],
  } as unknown as DcsIssue;
}

test("la semana empieza el lunes a las 0:00", () => {
  const start = weekStart(NOW);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 23);
  assert.equal(start.getHours(), 0);
  assert.equal(weekStart(new Date(2026, 10, 29, 23)).getDate(), 23, "el domingo sigue en la misma semana");
  assert.equal(weekStart(new Date(2026, 10, 30, 0, 1)).getDate(), 30, "el lunes empieza otra");
});

test("cuenta lo terminado y los pasos de la persona, día por día", () => {
  const issues = [
    issue({ project: "EZR", owner: "ana", closedOn: 24, steps: { borrador: { by: "ana", day: 24 } } }),
    issue({ project: "EZR", owner: "ana", closedOn: 26, steps: { borrador: { by: "ana", day: 25 }, pares: { by: "bea", day: 26 } } }),
    issue({ project: "EST", owner: "bea", steps: { pares: { by: "ana", day: 26 } } }),
  ];
  const week = myWeek(issues, "Ana", NOW);
  assert.equal(week.tasks, 2);
  assert.equal(week.steps, 3, "dos borradores suyos y una revisión del trabajo de otra persona");
  assert.deepEqual(week.days.map((d) => d.tasks + d.steps), [0, 2, 1, 2, 0, 0, 0]);
});

test("lo de antes de la semana y lo de otras personas no se cuenta", () => {
  const issues = [
    issue({ project: "EZR", owner: "ana", closedOn: 21, steps: { borrador: { by: "ana", day: 20 } } }),
    issue({ project: "EZR", owner: "bea", closedOn: 25, steps: { borrador: { by: "bea", day: 25 } } }),
  ];
  const week = myWeek(issues, "ana", NOW);
  assert.equal(week.tasks + week.steps, 0);
  assert.equal(week.projects.length, 0);
});

test("lo terminado va por proyecto, con los proyectos cerrados también, lo más reciente primero", () => {
  const issues = [
    issue({ project: "NEH", owner: "ana", closedOn: 24 }),
    issue({ project: "EZR", owner: "ana", closedOn: 25 }),
    issue({ project: "EZR", owner: "ana", closedOn: 26 }),
  ];
  const week = myWeek(issues, "ana", NOW);
  assert.deepEqual(week.projects.map((p) => [p.projectId, p.issues.length]), [["EZR", 2], ["NEH", 1]]);
  assert.equal(week.projects[0]!.issues[0]!.closed_at, at(26));
});

test("una subtarea que llega dos veces se cuenta una", () => {
  const one = issue({ project: "EZR", owner: "ana", closedOn: 25, steps: { borrador: { by: "ana", day: 25 } } });
  const week = myWeek([one, one], "ana", NOW);
  assert.equal(week.tasks, 1);
  assert.equal(week.steps, 1);
});

console.log(`\nverify-my-week: ${passed} checks passed.`);
