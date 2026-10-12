/**
 * End to end against the mock Door43, seeded with a book (`MOCK_PM_ORG=es-419_gl MOCK_SEED_BOOK=TIT npm run
 * mock:door43`): a text is corrected when some of the reviews of the verse are delivered and some are not; the
 * tasks that had delivered get a subtarea to look at the verse again, kept in the plan and published; asking again
 * creates nothing twice; and the new subtareas wait their turn, one phase after another.
 * Run: npm run verify:redo-mock   (MOCK_HOST=http://localhost:8797 for a mock on another port)
 */
import assert from "node:assert/strict";
import { closeIssue, listProjectIssues, publishWorkOrders } from "../src/dcs/issues";
import { loadAssignmentsFromDcs, saveProjectToDcs } from "../src/dcs/persist";
import { getPmIssue } from "../src/dcs/portionPr";
import { askRedoAfterCorrection, redoSaid } from "../src/dcs/redoAfterCorrection";
import { issueTaskId } from "../src/domain/myTasks";
import { shippedWorkflow, tasksToRedoAfter } from "../src/domain/processes";
import type { AssignmentsDoc, InventoryDoc } from "../src/domain/types";
import { waitBlocks } from "../src/domain/waits";
import { parseWorkOrderMarker, type WorkOrder } from "../src/domain/workOrder";
import { applyWorkflowToBoard } from "../src/domain/workflows";

const HOST = process.env.MOCK_HOST || "http://localhost:8787";
const ORG = "es-419_gl";
const BOOK = "TIT";
const as = (who: string) => ({ host: HOST, username: who, token: `token-${who}`, scopes: [], scopesVersion: 3 }) as never;
const [ana, bea] = [as("ana"), as("bea")];

const up = await fetch(`${HOST}/__mock/files?repo=${ORG}/es-419_tn&branch=master&path=${encodeURIComponent(`tn_${BOOK}.tsv`)}`).then((r) => r.ok, () => false);
if (!up) {
  console.log(`verify-redo-mock: no hay un mock de Door43 con ${BOOK} en ${HOST} (MOCK_PM_ORG=${ORG} MOCK_SEED_BOOK=${BOOK} npm run mock:door43); no se ejecutó.`);
  process.exit(0);
}
if ((await listProjectIssues(ana, ORG, BOOK).then((found) => found.issues.length, () => 0)) > 0) {
  console.log(`verify-redo-mock: el mock de ${HOST} ya tiene subtareas de ${BOOK} (POST /__mock/reset lo deja como al empezar, o MOCK_HOST con otro); no se ejecutó.`);
  process.exit(0);
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const empty = { projectId: BOOK, book: BOOK, books: [BOOK], lang: "es-419", contentOrg: ORG, teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const board = applyWorkflowToBoard(empty, shippedWorkflow("fcr-base")!);
const portion = (id: string, ref: string, verses: number[]) => ({ id, ref, chapter: 1, verses, tpl: 1, tps: 1, notas: 1, preguntas: 1, tplItems: [], tpsItems: [], notasItems: [], preguntasItems: [], academia: [], palabras: [] });
const inventory = { book: BOOK, lang: "es-419", contentOrg: ORG, portions: [portion("c1a", "1:1-4", [1, 2, 3, 4]), portion("c1b", "1:5-9", [5, 6, 7, 8, 9])], articles: [] } as unknown as InventoryDoc;

// The tasks the process names for the literal text, as the plan has them, and one subtarea of each for 1:1-4.
const named = tasksToRedoAfter("tpl");
const tasks = board.teams.filter((task) => named.includes(task.id));
const orderOf = (taskId: string): WorkOrder => {
  const task = board.teams.find((row) => row.id === taskId)!;
  return { key: `${BOOK}|${task.id}|c1a`, teamId: task.id, teamName: task.name, book: BOOK, resource: task.rules.length === 1 ? (task.rules[0]!.resource as never) : "bundle", chapter: 1, portionIds: ["c1a"], itemIds: ["porcion:c1a"], itemTypes: ["porcion"], label: `1:1–4 · ${task.name}` };
};
const all = async () => (await listProjectIssues(ana, ORG, BOOK)).issues;
const ofTask = (issues: Awaited<ReturnType<typeof all>>, taskId: string) => issues.filter((issue) => issueTaskId(issue) === taskId);
const corrected = { resource: "tpl", chapter: 1, from: 2, to: 2, decision: 9001, by: "ana" };
const where = { pmOrg: ORG, lang: "es-419", projectId: BOOK, contentOrg: ORG };

// Which of them had delivered: the reviews of the text of the first phase that reviews it, and the first of the
// helps. The last review of the text is still open, and the endorsement was never begun.
const phases = [...new Set(tasks.map((task) => task.phaseId))];
const reviews = tasks.filter((task) => task.phaseId === phases[0]);
const stillOpen = reviews.at(-1)!;
const delivered = [...reviews.slice(0, -1), tasks.find((task) => task.phaseId === phases[1])!];
const neverBegun = tasks.filter((task) => task.phaseId === phases.at(-1));

await step("el plan y sus subtareas, publicados: tres revisiones del texto, la armonización de una ayuda; el aval no empezó", async () => {
  assert.ok(reviews.length >= 2 && phases.length >= 3, "el proceso que trae la app revisa el texto en varias tareas y fases");
  await saveProjectToDcs({ session: ana, org: ORG, lang: "es-419", book: BOOK, assignments: board, inventory });
  const made = await publishWorkOrders({ session: ana, org: ORG, board, inventory, orders: [...delivered, stillOpen].map((task) => orderOf(task.id)), retireOrphans: false });
  assert.equal(made.created, delivered.length + 1);
  for (const task of delivered) await closeIssue(ana, ORG, ofTask(await all(), task.id)[0]!.number);
  const now = await all();
  assert.deepEqual(delivered.map((task) => ofTask(now, task.id)[0]!.state), delivered.map(() => "closed"));
  assert.equal(ofTask(now, stillOpen.id)[0]!.state, "open");
});

let asked: Awaited<ReturnType<typeof askRedoAfterCorrection>>;

await step("corregido 1:2, cada tarea que había entregado recibe una subtarea de ese versículo; la que sigue abierta y la que no empezó, ninguna", async () => {
  asked = await askRedoAfterCorrection({ session: bea, ...where, corrected });
  assert.deepEqual(asked.asked, delivered.map((task) => task.name));
  assert.deepEqual(asked.open, [stillOpen.name]);
  assert.equal(asked.issues.length, delivered.length);
  const now = await all();
  for (const task of delivered) {
    const mine = ofTask(now, task.id);
    assert.equal(mine.length, 2, `${task.id}: la entregada y la nueva`);
    const fresh = mine.find((issue) => issue.state === "open")!;
    assert.match(fresh.title, /1:2/, "nombrada por el versículo");
    assert.match(fresh.title, /Revisar de nuevo/);
    assert.deepEqual(parseWorkOrderMarker(fresh.body)?.portionIds, ["c1a"], "de su pasaje, para que espere y la esperen como las demás");
    assert.equal(mine.find((issue) => issue.state !== "open")!.state, "closed", "lo entregado no se reabre");
  }
  assert.equal(ofTask(now, stillOpen.id).length, 1);
  for (const task of neverBegun) assert.equal(ofTask(now, task.id).length, 0);
});

await step("el plan guarda lo que se pidió, con el versículo, quién lo corrigió y la decisión de la que viene", async () => {
  const plan = (await loadAssignmentsFromDcs(ana, ORG, "es-419", BOOK, ORG))!;
  assert.deepEqual((plan.settings?.extraWork ?? []).map((row) => [row.taskId, row.ref, row.portionId, row.askedBy, row.redoOf]), delivered.map((task) => [task.id, "1:2", "c1a", "ana", 9001]));
  assert.equal(plan.teams.length, board.teams.length, "y nada más del plan cambió");
  const said = redoSaid("1:2", asked, (key) => (key === "redo.asked" ? "{ref} → {tasks} ({issues})" : "en curso: {tasks}"));
  assert.ok(delivered.every((task) => said.includes(task.name)) && said.includes(stillOpen.name) && asked.issues.every((issue) => said.includes(`#${issue.number}`)), "y la conversación de la decisión puede decirlo");
});

await step("la misma corrección, pedida otra vez, no crea nada; la de otro versículo del pasaje, sí", async () => {
  const before = (await all()).length;
  const again = await askRedoAfterCorrection({ session: ana, ...where, corrected });
  assert.deepEqual([again.issues.length, again.asked.length], [0, 0]);
  assert.equal((await all()).length, before);
  const other = await askRedoAfterCorrection({ session: ana, ...where, corrected: { ...corrected, from: 3, to: 3 } });
  assert.equal(other.asked.length, delivered.length, "1:3 es otro versículo: las entregadas lo vuelven a mirar");
  assert.equal((await all()).length, before + delivered.length);
  const plan = (await loadAssignmentsFromDcs(ana, ORG, "es-419", BOOK, ORG))!;
  assert.deepEqual([...new Set((plan.settings?.extraWork ?? []).map((row) => row.ref))], ["1:2", "1:3"], "las dos peticiones siguen en el plan");
});

await step("lo pedido espera su turno: la armonización no queda libre hasta que cierren las revisiones del texto", async () => {
  const plan = (await loadAssignmentsFromDcs(ana, ORG, "es-419", BOOK, ORG))!;
  const open = () => all().then((issues) => issues.filter((issue) => issue.state === "open"));
  const later = delivered.at(-1)!;
  const mine = async () => ofTask(await open(), later.id).find((issue) => /1:2/.test(issue.title))!;
  assert.ok(waitBlocks(await mine(), plan, await open()).length > 0, "espera a la fase anterior");
  for (const issue of await open()) if (reviews.some((task) => task.id === issueTaskId(issue))) await closeIssue(ana, ORG, issue.number);
  assert.equal((await getPmIssue(ana, ORG, (await mine()).number)).state, "open");
  assert.equal(waitBlocks(await mine(), plan, await open()).length, 0, "cerradas todas las de esa fase, queda libre");
});

console.log(`\nverify-redo-mock: ${passed} checks passed.`);
process.exit(0);
