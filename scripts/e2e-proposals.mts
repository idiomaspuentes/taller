/**
 * End to end against the mock Door43, seeded with a book (`MOCK_PM_ORG=es-419_gl MOCK_SEED_BOOK=TIT npm run
 * mock:door43`): a change proposed while checking a note, agreed on by a second person, written on the team's
 * draft; another version of the same note from another list of the task, refused once the first is written; and
 * the agreement of the team on the step, given in its tool by each of them.
 * Run: npm run verify:proposals-mock   (MOCK_HOST=http://localhost:8797 for a mock on another port)
 */
import assert from "node:assert/strict";
import { createIssue, createOrUpdateContents } from "@ip-lms/dcs-client";
import { HelpChangedError, applyProposal, checkedSteps, loadTaskAnswers, readProposedWords } from "../src/dcs/checkProposals";
import { appendCheckAnswers } from "../src/dcs/checkStore";
import { dcsConfig } from "../src/dcs/config";
import { getPmIssue } from "../src/dcs/portionPr";
import { agreeStepFromTool, stepAgreement } from "../src/dcs/roundClose";
import { readTeamHelps } from "../src/dcs/teamHelps";
import { byPlaceAndHelp, proposalAnswer, proposalDone, proposalFit, proposalKeeping, proposalSaying, proposalWords, proposalsOf, proposalsSettled, sharedHelp } from "../src/domain/checkProposal";
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
const [ana, bea, carla] = [as("ana"), as("bea"), as("carla")];

/** A file as the mock has it on a branch, read apart from the app (`/__mock/files`). */
const kept = (repo: string, branch: string, path: string): Promise<string> =>
  fetch(`${HOST}/__mock/files?repo=${ORG}/${repo}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`).then(async (r) => (r.ok ? (((await r.json()) as { text?: string }).text ?? "") : ""), () => "");

const seeded = Boolean(await kept("es-419_tn", "master", `tn_${BOOK}.tsv`));
if (!seeded) {
  console.log(`verify-proposals-mock: no hay un mock de Door43 con ${BOOK} en ${HOST} (MOCK_PM_ORG=${ORG} MOCK_SEED_BOOK=${BOOK} npm run mock:door43); no se ejecutó.`);
  process.exit(0);
}

// It starts from a team with no draft of its notes yet: on a mock somebody has worked on, that is not so.
if (await kept("es-419_tn", `borrador/${BOOK.toLowerCase()}/notas-ayuda`, `tn_${BOOK}.tsv`)) {
  console.log(`verify-proposals-mock: el mock de ${HOST} ya tiene trabajo sobre ${BOOK} (POST /__mock/reset lo deja como al empezar, o MOCK_HOST con otro); no se ejecutó.`);
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
// Two people can each write a version of one note from the note as it still is. They did it from two lists of
// the task while it had a list for each text; it has one now, and it is the same one for both.
const otherList = steps.at(-1)!;
const rival = { ...proposal, id: "pr-e2e-rival", after: `${row.Note} (otra versión, de otra persona)` };
/** How many times the notes of the book were written, on any branch. */
const noteWrites = async () => ((await fetch(`${HOST}/__mock/log`).then((r) => r.json())) as { write?: string }[]).filter((entry) => (entry.write ?? "").endsWith(`tn_${BOOK}.tsv`)).length;
const views = async (who = bea) => (await loadTaskAnswers(who, steps)).flatMap((r) => proposalsOf(r.answers, needed, ours));

await step("la lista de la tarea guarda sus respuestas con la ayuda que recorre, bajo la subtarea y el paso", async () => {
  assert.equal(steps.length, 1, "una sola lista: cada nota frente a los dos textos y su artículo");
  assert.deepEqual(steps[0]!.texts, ["tpl", "tps"]);
  assert.ok(steps[0]!.questions.length > 0, "con las preguntas que hace, para decir cuál no se cumplió");
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

await step("otra persona propone otra versión de la misma nota, escrita de la nota como está: el acuerdo las señala y las pone juntas", async () => {
  await appendCheckAnswers(carla, otherList.target, otherList.key, [proposalAnswer({ itemId: row.ID!, questionId: "e2e", by: "carla", at: new Date().toISOString(), reason: "No coincide con el otro texto", proposal: rival })]);
  const all = await views();
  assert.deepEqual(all.map((v) => [v.proposal.id, v.state]), [[proposal.id, "open"], [rival.id, "open"]]);
  assert.equal(rival.before, proposal.before, "las dos parten de las mismas palabras");
  assert.deepEqual([...sharedHelp(all)], [[proposal.id, 1], [rival.id, 1]]);
  assert.deepEqual(byPlaceAndHelp(all).map((v) => v.proposal.id), [proposal.id, rival.id]);
  // What the screen reads to say so before anybody agrees: the note as the team has it, which both still fit.
  const words = await readProposedWords({ session: bea, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposals: [proposal, rival] });
  assert.deepEqual(Object.keys(words), [proposalWords(proposal)]);
  assert.deepEqual([proposalFit(proposal, words[proposalWords(proposal)]!), proposalFit(rival, words[proposalWords(rival)]!)], ["fits", "fits"]);
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

await step("la otra versión de esa nota ya no se escribe encima: se rechaza diciendo cómo quedó, y la nota sigue como la dejó la primera", async () => {
  const drafted = await notes();
  const written = await noteWrites();
  const refused = await applyProposal({ session: carla, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: rival }).then(() => null, (err: unknown) => err);
  assert.ok(refused instanceof HelpChangedError, "no se aplica: la nota cambió desde que se propuso");
  assert.equal(refused.current, proposal.after, "y dice lo que la nota dice ahora, para escribir la propuesta de nuevo");
  assert.equal((await notes()).text, drafted.text, "la nota conserva el cambio de la primera");
  assert.equal(await noteWrites(), written, "no se escribió nada");
  // The screen reads the same on opening: the card of that proposal says the help changed.
  const words = await readProposedWords({ session: ana, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposals: [rival] });
  assert.equal(proposalFit(rival, words[proposalWords(rival)]!), "changed");
});

await step("la que ya está escrita, aplicada otra vez (no se pudo anotar que estaba hecha), ni escribe ni se rechaza", async () => {
  const written = await noteWrites();
  await applyProposal({ session: ana, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal });
  assert.equal(await noteWrites(), written);
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

await step("«Otra propuesta» sobre la que se rechazó parte de la nota como está ahora, y esa sí se aplica con los dos cambios", async () => {
  const now = (await readProposedWords({ session: carla, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposals: [rival] }))[proposalWords(rival)]!;
  const again = { ...rival, id: "pr-e2e-rival-2", replaces: rival.id, before: now, after: `${now} (y lo que pedía la otra persona)` };
  await appendCheckAnswers(carla, otherList.target, otherList.key, [proposalAnswer({ itemId: row.ID!, questionId: "e2e", by: "carla", at: new Date().toISOString(), reason: "Sobre la nota como quedó", proposal: again })]);
  await appendCheckAnswers(ana, otherList.target, otherList.key, [proposalSaying(again.id, "ana", new Date().toISOString(), true)]);
  assert.deepEqual((await views()).map((v) => [v.proposal.id, v.state]), [[proposal.id, "agreed"], [rival.id, "replaced"], [again.id, "agreed"]]);
  await applyProposal({ session: ana, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: again });
  await appendCheckAnswers(ana, otherList.target, otherList.key, [proposalDone(again.id, "ana", new Date().toISOString())]);
  const note = rowsOf((await notes()).text).find((r) => r.ID === row.ID)!.Note!;
  assert.equal(note, again.after);
  assert.ok(note.includes("(cambiado por acuerdo del equipo)") && note.includes("(y lo que pedía la otra persona)"), "lo de las dos personas");
});

await step("una propuesta que dos personas prefieren dejar como está no se acepta: no se escribe nada, y ya no detiene el paso", async () => {
  const kept = rowsOf((await notes()).text).filter((r) => r.Note && r.Note.length > 40 && r.Reference !== "front:intro" && r.ID !== row.ID)[3]!;
  const unwanted = { id: "pr-e2e-no", resource: "notas", field: "Note", rowId: kept.ID!, where: kept.Reference!, before: kept.Note!, after: `${kept.Note} (un cambio que el equipo no quiere)` };
  const written = await noteWrites();
  await appendCheckAnswers(carla, list.target, list.key, [proposalAnswer({ itemId: kept.ID!, questionId: "e2e", by: "carla", at: new Date().toISOString(), reason: "", proposal: unwanted })]);
  await appendCheckAnswers(ana, list.target, list.key, [proposalKeeping(unwanted.id, "ana", new Date().toISOString(), true)]);
  const one = (await views()).find((v) => v.proposal.id === unwanted.id)!;
  assert.deepEqual([one.state, one.against], ["open", ["ana"]], "una persona lo dice, y quien la propuso lo lee");
  await appendCheckAnswers(bea, list.target, list.key, [proposalKeeping(unwanted.id, "bea", new Date().toISOString(), true)]);
  const two = (await views(carla)).find((v) => v.proposal.id === unwanted.id)!;
  assert.equal(two.state, "rejected");
  assert.equal(proposalsSettled([two]), true);
  assert.equal(await noteWrites(), written, "la nota queda como estaba");
});

await step("dos personas aplican a la vez dos versiones de una nota: se escribe una sola, y a la otra se le dice que la nota cambió", async () => {
  const third = rowsOf((await notes()).text).filter((r) => r.Note && r.Note.length > 40 && r.Reference !== "front:intro" && r.ID !== row.ID)[1]!;
  const version = (id: string, text: string) => ({ id, resource: "notas", field: "Note", rowId: third.ID!, where: third.Reference!, before: third.Note!, after: text });
  const [one, two] = [version("pr-e2e-a", `${third.Note} (versión de Ana)`), version("pr-e2e-b", `${third.Note} (versión de Bea)`)];
  const ended = await Promise.allSettled([applyProposal({ session: ana, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: one }), applyProposal({ session: bea, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: two })]);
  assert.deepEqual(ended.map((end) => end.status).sort(), ["fulfilled", "rejected"]);
  const won = ended[0]!.status === "fulfilled" ? one : two;
  const lost = ended.find((end) => end.status === "rejected") as PromiseRejectedResult;
  assert.ok(lost.reason instanceof HelpChangedError);
  assert.equal(lost.reason.current, won.after);
  assert.equal(rowsOf((await notes()).text).find((r) => r.ID === third.ID)!.Note, won.after);
});

await step("una propuesta para una nota que el equipo ya no tiene no se da por aplicada", async () => {
  const written = await noteWrites();
  const gone = await applyProposal({ session: ana, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: { id: "pr-e2e-gone", resource: "notas", field: "Note", rowId: "zzzz", where: "1:1", before: "Una nota que no está.", after: "Otra." } }).then(() => null, (err: unknown) => err);
  assert.ok(gone instanceof Error && !(gone instanceof HelpChangedError), "falla, y no como una nota que cambió");
  assert.equal(await noteWrites(), written);
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
  // A third one, written from the article as published: the draft says something else by now.
  const late = await applyProposal({ session: carla, ctx, pmConfig: DEFAULT_PM_CONFIG, board, proposal: { ...article, id: "pr-e2e-5", before: published, after: "# Metáfora\n\nEscrita de lo publicado.\n" } }).then(() => null, (err: unknown) => err);
  assert.ok(late instanceof HelpChangedError, "no se escribe encima de la segunda");
  assert.equal(await kept("es-419_ta", branch, article.path), "# Metáfora\n\nSegunda versión acordada.\n");
});

await step("aplicada, la propuesta queda resuelta para todos", async () => {
  await appendCheckAnswers(bea, list.target, list.key, [proposalDone(proposal.id, "bea", new Date().toISOString())]);
  const all = await views(ana);
  assert.deepEqual(all.map((v) => v.state), ["applied", "replaced", "applied", "rejected"], "la primera, la que se rechazó y fue respondida, la que la respondió, y la que el equipo prefirió no aceptar");
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
