/** «Mis tareas»: the phase a card is of, and when a board has cards of more than one. */
import assert from "node:assert/strict";
import { mixesPhases, phaseOfCard } from "../src/domain/phaseBadges";
import type { BoardCard } from "../src/domain/myTasksBoard";
import type { AssignmentsDoc, Phase } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

type Card = Pick<BoardCard, "task" | "bucket" | "group">;

function project(id: string, phases: Partial<Phase>[]) {
  const board = { phases, teams: phases.map((phase) => ({ id: `t-${phase.id}`, name: `Tarea ${phase.id}`, phaseId: phase.id })) } as unknown as AssignmentsDoc;
  return { projectId: id, title: id, browseProject: false, board, issues: [] };
}

function cardOf(bucket: ReturnType<typeof project>, phaseId: string, group: BoardCard["group"] = "todo"): Card {
  const task = bucket.board.teams.find((t) => t.phaseId === phaseId);
  return { task, bucket, group } as Card;
}

const fcr = project("EZR", [
  { id: "a", name: "Traducción", names: { pt: "Tradução" }, order: 0 },
  { id: "b", name: "Afinación", order: 1 },
  { id: "c", name: "Armonización", order: 2 },
]);

test("a card says the phase of its task, with the tone of the phase's place", () => {
  assert.deepEqual(phaseOfCard(cardOf(fcr, "b")), { name: "Afinación", tone: 2 });
  assert.deepEqual(phaseOfCard(cardOf(fcr, "a")), { name: "Traducción", names: { pt: "Tradução" }, tone: 1 });
});

test("the tones go round after five phases", () => {
  const six = project("SIX", [0, 1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, name: `Fase ${i}`, order: i })));
  assert.equal(phaseOfCard(cardOf(six, "p5"))?.tone, 1);
  assert.equal(phaseOfCard(cardOf(six, "p4"))?.tone, 5);
});

test("phases are placed by their order, not by where they are written", () => {
  const shuffled = project("SHF", [{ id: "y", name: "Segunda", order: 1 }, { id: "x", name: "Primera", order: 0 }]);
  assert.equal(phaseOfCard(cardOf(shuffled, "x"))?.tone, 1);
  assert.equal(phaseOfCard(cardOf(shuffled, "y"))?.tone, 2);
});

test("phases with no order keep the place they are written in", () => {
  const plain = project("PLN", [{ id: "x", name: "Una" }, { id: "y", name: "Otra" }]);
  assert.equal(phaseOfCard(cardOf(plain, "x"))?.tone, 1);
  assert.equal(phaseOfCard(cardOf(plain, "y"))?.tone, 2);
});

test("phases with the same order keep the place they are written in", () => {
  const tied = project("TIE", [{ id: "x", name: "Una", order: 0 }, { id: "y", name: "Otra", order: 0 }]);
  assert.equal(phaseOfCard(cardOf(tied, "x"))?.tone, 1);
  assert.equal(phaseOfCard(cardOf(tied, "y"))?.tone, 2);
});

test("when only some phases have an order, the place they are written in decides", () => {
  const partly = project("PRT", [{ id: "x", name: "Una", order: 5 }, { id: "y", name: "Otra" }, { id: "z", name: "Tercera", order: 0 }]);
  assert.deepEqual(["x", "y", "z"].map((id) => phaseOfCard(cardOf(partly, id))?.tone), [1, 2, 3]);
});

test("a card with no task, no project or an unknown phase says none", () => {
  assert.equal(phaseOfCard({ bucket: fcr } as Card), undefined);
  assert.equal(phaseOfCard({ task: fcr.board.teams[0] } as Card), undefined);
  assert.equal(phaseOfCard({ task: { ...fcr.board.teams[0]!, phaseId: "gone" }, bucket: fcr } as Card), undefined);
});

test("cards of one phase do not mix", () => {
  assert.equal(mixesPhases([cardOf(fcr, "a"), cardOf(fcr, "a", "doing")]), false);
  assert.equal(mixesPhases([]), false);
});

test("cards of two phases mix", () => {
  assert.equal(mixesPhases([cardOf(fcr, "a"), cardOf(fcr, "b", "free")]), true);
});

test("the same phase in two books is one phase", () => {
  const neh = project("NEH", [{ id: "other-id", name: " traducción ", order: 0 }]);
  assert.equal(mixesPhases([cardOf(fcr, "a"), cardOf(neh, "other-id")]), false);
});

test("work already done of another phase does not count", () => {
  assert.equal(mixesPhases([cardOf(fcr, "a"), cardOf(fcr, "b", "done")]), false);
});

test("work of a project set aside does not count", () => {
  assert.equal(mixesPhases([cardOf(fcr, "a"), cardOf(fcr, "b", "paused")]), false);
});

test("a card with no phase does not make a mix", () => {
  assert.equal(mixesPhases([cardOf(fcr, "a"), { bucket: fcr, group: "decide" } as Card]), false);
});

console.log(`\n${passed} checks passed`);
