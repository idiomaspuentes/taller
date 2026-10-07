/**
 * End to end against the mock Door43, seeded with a book (`MOCK_PM_ORG=es-419_gl MOCK_SEED_BOOK=TIT npm run
 * mock:door43`): a change proposed while checking a note, agreed on by a second person, written on the team's
 * draft; and the agreement of the team on the step, given in its tool by each of them.
 * Run: npm run verify:proposals-mock   (MOCK_HOST=http://localhost:8797 for a mock on another port)
 */
import assert from "node:assert/strict";
import { createIssue, createOrUpdateContents } from "@ip-lms/dcs-client";
import { applyProposal, checkedSteps, loadTaskAnswers } from "../src/dcs/checkProposals";
import { appendCheckAnswers } from "../src/dcs/checkStore";
import { dcsConfig } from "../src/dcs/config";
import { getPmIssue } from "../src/dcs/portionPr";
import { agreeStepFromTool, stepAgreement } from "../src/dcs/roundClose";
import { readTeamHelps } from "../src/dcs/teamHelps";
import { proposalAnswer, proposalDone, proposalSaying, proposalsOf, proposalsSettled } from "../src/domain/checkProposal";
import { shippedWorkflow } from "../src/domain/processes";
import { DEFAULT_PM_CONFIG } from "../src/domain/roles";
import { SOLVER_LAUNCH_SCHEMA, type SolverLaunchContext } from "../src/domain/solverLaunch";
import { stepMinAssignees } from "../src/domain/stepClaim";
import { emptyTaskProgress, isStepDone, parseTaskProgressMarker, upsertTaskProgressInBody } from "../src/domain/taskProgress";
import type { AssignmentsDoc } from "../src/domain/types";
import { applyWorkflowToBoard } from "../src/domain/workflows";

const HOST = process.env.MOCK_HOST || "http://localhost:8787";
const ORG = "es-419_gl";
const BOOK = "TIT";
const as = (who: string) => ({ host: HOST, username: who, token: `token-${who}`, scopes: [], scopesVersion: 3 }) as never;
const [ana, bea] = [as("ana"), as("bea")];

/** A file as the mock has it on a branch, read apart from the app (`/__mock/files`). */
const kept = (repo: string, branch: string, path: string): Promise<string> =>
  fetch(`${HOST}/__mock/files?repo=${ORG}/${repo}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`).then(async (r) => (r.ok ? (((await r.json()) as { text?: string }).text ?? "") : ""), () => "");

const seeded = Boolean(await kept("es-419_tn", "master", `tn_${BOOK}.tsv`));
if (!seeded) {
  console.log(`verify-proposals-mock: no hay un mock de Door43 con ${BOOK} en ${HOST} (MOCK_PM_ORG=${ORG} MOCK_SEED_BOOK=${BOOK} npm run mock:door43); no se ejecutó.`);
  process.exit(0);
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const empty = { projectId: BOOK, book: BOOK, lang: "es-419", teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const board = applyWorkflowToBoard(empty, shippedWorkflow("fcr-base")!);
const task = board.teams.find((row) => row.id === "armonizar-notas")!;
const agreement = task.steps!.find((row) => row.closing === "consensus")!;
const lists = task.steps!.filter((row) => row.closing === "checklist");

const issue = await createIssue(dcsConfig(HOST), ORG, "taller", {
  title: `${BOOK} 1 · ${task.name}`,
  body: upsertTaskProgressInBody("", { ...emptyTaskProgress(), doneStepIds: lists.map((row) => row.id) }),
  token: "token-ana",
} as never);

const ctx: SolverLaunchContext = {
  schema: SOLVER_LAUNCH_SCHEMA, lang: "es-419", pmOrg: ORG, contentOrg: ORG, projectId: BOOK, taskId: task.id, taskName: task.name, book: BOOK, chapter: 1,
  resource: "notas", phaseSlug: "", ref: "1", portionIds: [], itemIds: [], workOrderKey: "", issueNumber: issue.number, issueUrl: "", username: "ana", stepId: agreement.id,
};
const steps = checkedSteps(ctx, task, DEFAULT_PM_CONFIG);
const needed = stepMinAssignees(agreement);
const ours = (resource: string) => task.rules.some((rule) => rule.resource === resource);
const notes = async (who = ana) => (await readTeamHelps({ session: who, ctx, pmConfig: DEFAULT_PM_CONFIG, board, kind: "notas" }))!;
const rowsOf = (text: string) => {
  const [head, ...lines] = text.split("\n");
  const cols = head!.split("\t");
  return lines.filter(Boolean).map((line) => Object.fromEntries(line.split("\t").map((cell, i) => [cols[i]!, cell])) as Record<string, string>);
};

const before = await notes();
const row = rowsOf(before.text).find((r) => r.Note && r.Note.length > 40 && r.Reference !== "front:intro")!;
const proposal = { id: "pr-e2e-1", resource: "notas", field: "Note", rowId: row.ID!, where: row.Reference!, before: row.Note!, after: `${row.Note} (cambiado por acuerdo del equipo)` };
const list = steps[0]!;
const views = async (who = bea) => (await loadTaskAnswers(who, steps)).flatMap((r) => proposalsOf(r.answers, needed, ours));

await step("las tres listas de la tarea guardan sus respuestas con la ayuda que recorren, bajo la subtarea y el paso", async () => {
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.key), lists.map((s) => `${BOOK}.${issue.number}.${s.id}`));
  assert.ok(steps.every((s) => s.target.owner === ORG && s.target.repo));
  assert.ok(ours("notas") && !ours("tpl"), "las notas son de este equipo; el texto no");
  assert.equal(before.branch, undefined, "el equipo todavía no tiene borrador de las notas: se leen las publicadas");
});

await step("una propuesta se guarda como respuesta de quien la hizo, y otra persona la lee por acordar, sin que cambie la nota", async () => {
  await appendCheckAnswers(ana, list.target, list.key, [proposalAnswer({ itemId: row.ID!, questionId: "e2e", by: "ana", at: new Date().toISOString(), reason: "No coincide con el texto", proposal })]);
  const [view] = await views();
  assert.equal(view!.state, "open");
  assert.deepEqual(view!.inFavour, ["ana"]);
  assert.equal(view!.proposal.after, proposal.after);
  assert.equal((await notes()).text, before.text, "nada cambia al proponer");
});

await step("con el acuerdo de una segunda persona queda acordada, y se escribe en el borrador del equipo: solo esa nota", async () => {
  await appendCheckAnswers(bea, list.target, list.key, [proposalSaying(proposal.id, "bea", new Date().toISOString(), true)]);
  const [agreed] = await views(ana);
  assert.equal(agreed!.state, "agreed");
  assert.equal(proposalsSettled([agreed!]), false, "acordada no es hecha");
  await applyProposal({ session: bea, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal });
  const after = await notes();
  assert.ok(after.branch, "ahora el equipo tiene borrador de sus notas");
  const [was, now] = [rowsOf(before.text), rowsOf(after.text)];
  assert.equal(now.length, was.length);
  const changed = now.filter((r, i) => JSON.stringify(r) !== JSON.stringify(was[i]));
  assert.deepEqual(changed.map((r) => [r.ID, r.Note]), [[row.ID, proposal.after]]);
  assert.equal(await kept(list.target.repo, "master", `tn_${BOOK}.tsv`), before.text, "lo publicado no se toca");
});

await step("otra nota acordada después se escribe en el mismo borrador, sin perder la primera", async () => {
  const other = rowsOf(before.text).find((r) => r.ID !== row.ID && r.Note && r.Note.length > 40 && r.Reference !== "front:intro")!;
  const drafted = await notes();
  await applyProposal({ session: ana, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: { id: "pr-e2e-2", resource: "notas", field: "Note", rowId: other.ID!, where: other.Reference!, before: other.Note!, after: "Otra nota, entera." } });
  const after = await notes(bea);
  assert.equal(after.branch, drafted.branch);
  const byId = new Map(rowsOf(after.text).map((r) => [r.ID, r.Note]));
  assert.equal(byId.get(other.ID!), "Otra nota, entera.");
  assert.equal(byId.get(row.ID!), proposal.after);
});

await step("la nueva versión de un artículo se escribe en el borrador de los artículos, y la siguiente sobre ella", async () => {
  const article = { id: "pr-e2e-3", resource: "academia", path: "translate/figs-metaphor/01.md", where: "figs-metaphor" };
  const published = "# Metáfora\n\nComo está publicado.\n";
  // The mock starts with no articles: the one the team has published is put there first.
  await createOrUpdateContents(dcsConfig(HOST), ORG, "es-419_ta", article.path, { content: published, message: "seed", branch: "master", token: "token-ana" } as never);
  await applyProposal({ session: bea, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: { ...article, before: published, after: "# Metáfora\n\nPrimera versión acordada.\n" } });
  await applyProposal({ session: ana, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: { ...article, id: "pr-e2e-4", before: "# Metáfora\n\nPrimera versión acordada.\n", after: "# Metáfora\n\nSegunda versión acordada.\n" } });
  const log = (await fetch(`${HOST}/__mock/log`).then((r) => r.json())) as { write?: string }[];
  const writes = log.map((entry) => entry.write ?? "").filter((write) => write.endsWith(article.path) && !write.includes("@master:"));
  assert.equal(writes.length, 2, "las dos versiones, en el borrador");
  const branch = /@(.+):/.exec(writes[1]!)![1]!;
  assert.equal(await kept("es-419_ta", branch, article.path), "# Metáfora\n\nSegunda versión acordada.\n");
  assert.equal(await kept("es-419_ta", "master", article.path), published, "lo publicado no se toca");
});

await step("aplicada, la propuesta queda resuelta para todos", async () => {
  await appendCheckAnswers(bea, list.target, list.key, [proposalDone(proposal.id, "bea", new Date().toISOString())]);
  const all = await views(ana);
  assert.deepEqual(all.map((v) => v.state), ["applied"]);
  assert.equal(proposalsSettled(all), true);
});

await step("cada persona da su acuerdo al paso en su pantalla: la primera se sienta y espera, con la segunda se cierra", async () => {
  const tell = { pmOrg: ORG, issueNumber: issue.number, steps: task.steps!, step: agreement };
  const start = await stepAgreement({ session: ana, ...tell });
  assert.deepEqual([start.open, start.done, start.seated.length], [true, false, 0]);
  const first = await agreeStepFromTool({ session: ana, ...tell, settled: true });
  assert.deepEqual([first.seated, first.agreed, first.done], [["ana"], ["ana"], false]);
  // What the second person finds on opening the screen.
  const seen = await stepAgreement({ session: bea, ...tell });
  assert.deepEqual([seen.agreed, seen.done], [["ana"], false]);
  const second = await agreeStepFromTool({ session: bea, ...tell, settled: true });
  assert.deepEqual([second.agreed, second.done], [["ana", "bea"], true]);
  const marker = parseTaskProgressMarker((await getPmIssue(ana, ORG, issue.number)).body);
  assert.ok(isStepDone(marker, agreement.id), "el paso quedó cerrado en la subtarea");
  assert.equal(marker.steps?.[agreement.id]?.done?.by, "bea", "y dice quién lo cerró");
});

console.log(`\nverify-proposals-mock: ${passed} checks passed.`);
process.exit(0);
