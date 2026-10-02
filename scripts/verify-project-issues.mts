/**
 * The subtareas of one project are only that project's, whatever Door43 answers. Seen on qa.door43.org: a search
 * filtered by a milestone that does not exist yet (a project being created) returns every issue of the organization,
 * and taking them for the new project's closed all the subtareas of the book before it.
 *
 *   npm run verify:project-issues
 */
import assert from "node:assert/strict";
import { issuesOfMilestones } from "../src/dcs/issues";
import { scopedMilestone } from "../src/domain/scope";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const issue = (number: number, milestone: string | null) => ({ number, milestone: milestone ? { title: milestone } : null });
const answered = [issue(1, "3JN"), issue(2, "3JN"), issue(3, "2JN"), issue(4, null), issue(5, "pt/3JN")];

test("de lo que Door43 devuelve solo cuenta lo del proyecto pedido", () => {
  assert.deepEqual(issuesOfMilestones(answered, ["2JN"]).map((row) => row.number), [3]);
  assert.deepEqual(issuesOfMilestones(answered, ["3jn"]).map((row) => row.number), [1, 2, 5], "sin importar mayúsculas ni el prefijo del espacio");
});

test("un proyecto que todavía no tiene hito no tiene subtareas, aunque Door43 las devuelva todas", () => {
  assert.deepEqual(issuesOfMilestones(answered, ["JUD"]), []);
});

test("el hito de un espacio con prefijo se reconoce por su proyecto", () => {
  assert.deepEqual(issuesOfMilestones(answered, [scopedMilestone("3JN", "pt")]).map((row) => row.number), [1, 2, 5]);
});

test("sin proyecto pedido no se filtra nada", () => {
  assert.equal(issuesOfMilestones(answered, undefined).length, answered.length);
  assert.equal(issuesOfMilestones(answered, []).length, answered.length);
});

console.log(`\nverify-project-issues: ${passed} checks passed.`);
