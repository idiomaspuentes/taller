/**
 * Fills a running mock Door43 with books the size of the real ones, to measure what the screens ask of Door43
 * (docs/ISSUES_Y_RENDIMIENTO.md). Each book gets the FCR plan and its subtareas written as the app writes them: the
 * same title, text, markers and labels, on the book's milestone. Nothing is sent anywhere but the mock.
 *
 *   MOCK_PM_ORG=es-419_gl MOCK_FULL_ISSUES=1 node scripts/mock-door43/server.mjs
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/mock-door43/seed-big-book.mts NEH:6:0 EZR:6:0.9
 *
 * Each argument is BOOK:PORTIONS_PER_CHAPTER:SHARE_CLOSED. NEH:6:0 is Nehemías as it started in production (about
 * 1.200 subtareas, all open); EZR:6:0.9 a book mostly done. MOCK_HOST picks the mock (default http://localhost:8787).
 */
import { applyWorkflowToBoard } from "../../src/domain/workflows.ts";
import { shippedWorkflow } from "../../src/domain/processes.ts";
import { emptyAssignments } from "../../src/domain/store.ts";
import { saveProjectToDcs } from "../../src/dcs/persist.ts";
import { pmIssueLabelNames } from "../../src/dcs/issues.ts";
import { workOrderIssueBody, workOrderIssueTitle, type WorkOrder } from "../../src/domain/workOrder.ts";
import { upsertTaskProgressInBody, emptyTaskProgress, withStepRuntime, type TaskProgressMarker } from "../../src/domain/taskProgress.ts";
import type { GtSession } from "../../src/dcs/auth.ts";

const HOST = process.env.MOCK_HOST || "http://localhost:8787";
const ORG = "es-419_gl";
const PEOPLE = ["ana", "bea", "carla", "dina", "eva"];
const CHAPTERS: Record<string, number[]> = {
  NEH: [11, 20, 20, 23, 19, 19, 73, 18, 38, 40, 36, 47, 31],
  EZR: [11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
  EST: [22, 23, 15, 17, 14, 14, 10, 17, 32, 3],
};
const session: GtSession = { host: HOST, username: "ana", token: "token-ana", scopesVersion: 3 } as GtSession;

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${HOST}${path}`, { ...init, headers: { "content-type": "application/json", authorization: "token token-ana", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

type MockIssue = Record<string, unknown> & { number: number };
// The plans first: the state is read after them, so loading it back keeps them.
const boards = new Map<string, ReturnType<typeof applyWorkflowToBoard>>();
for (const arg of process.argv.slice(2)) {
  const book = arg.split(":")[0]!;
  const template = shippedWorkflow("fcr-base");
  if (!template) throw new Error("fcr-base is not shipped");
  const board = applyWorkflowToBoard(emptyAssignments(book, "es-419", ORG, ORG), template);
  board.people = PEOPLE.map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) }));
  for (const task of board.teams) Object.assign(task, { memberIds: PEOPLE, orgTeamName: "Equipo" });
  board.settings = { ...(board.settings ?? {}), allowSelfAssign: true };
  await saveProjectToDcs({ session, org: ORG, lang: "es-419", book, assignments: board, inventory: null });
  boards.set(book, board);
}
const state = await api("/__mock/dump");
const user = (login: string) => ({ id: PEOPLE.indexOf(login) + 1, login, full_name: login[0]!.toUpperCase() + login.slice(1) });
const labelId = (name: string) => {
  let label = state.labels.find((l: { name: string }) => l.name === name);
  if (!label) state.labels.push((label = { id: state.labels.length + 1, name, color: "0075ca" }));
  return { id: label.id, name };
};

let seeded = 0;
for (const arg of process.argv.slice(2)) {
  const [book, perChapterRaw, closedRaw] = arg.split(":");
  const verses = CHAPTERS[book!];
  if (!verses) throw new Error(`no verse counts for ${book}`);
  const perChapter = Number(perChapterRaw || 6);
  const shareClosed = Number(closedRaw || 0);

  const board = boards.get(book!)!;

  let milestone = state.milestones.find((m: { title: string }) => m.title === book);
  if (!milestone) state.milestones.push((milestone = { id: state.milestones.length + 1, title: book, state: "open" }));

  // Translation, helps and alignment go by portion; harmonizing, validating and publishing by chapter.
  const byChapter = (taskId: string) => /^(armonizar|validar|publicar)/.test(taskId);
  const made: MockIssue[] = [];
  for (const task of board.teams) {
    verses.forEach((count, index) => {
      const chapter = index + 1;
      const portions = byChapter(task.id) ? 1 : perChapter;
      for (let p = 0; p < portions; p++) {
        const from = Math.floor((count * p) / portions) + 1;
        const to = Math.max(from, Math.floor((count * (p + 1)) / portions));
        const isHelps = /notas|preguntas|palabras|academia|desafios/.test(task.id);
        // A portion of helps lists the notes or words it covers; a portion of text, its verses.
        const itemIds = isHelps
          ? Array.from({ length: 4 + ((from * 7) % 9) }, (_, i) => `articulo:${task.resource}-${chapter}-${from}-${i.toString(36)}${(chapter * 31 + i).toString(36)}`)
          : [`porcion:${book}-${chapter}-${from}-${to}`];
        const order: WorkOrder = {
          key: `${book}|${task.id}|${task.resource}|${book}-${chapter}-${from}|${itemIds.join(",")}`,
          teamId: task.id, teamName: task.name, book: book!, resource: task.resource as WorkOrder["resource"], chapter,
          portionIds: [`${book}-${chapter}-${from}`], itemIds, itemTypes: itemIds.map((id) => id.split(":")[0] as "articulo"),
          label: `${chapter}:${from}–${to} · ${task.name}`,
        };
        made.push(subtarea(order, task.steps?.map((s) => s.id) ?? []));
      }
    });
  }

  function subtarea(order: WorkOrder, steps: string[]): MockIssue {
    const n = ++state.issueCounter;
    const closed = (n * 2654435761) % 1000 < shareClosed * 1000;
    const who = PEOPLE[n % PEOPLE.length]!;
    const taken = closed || n % 3 === 0;
    // Work in hand carries its progress: steps done, who sits where, and how far each one is.
    let progress: TaskProgressMarker = { ...emptyTaskProgress(), doneStepIds: closed ? steps : steps.slice(0, n % Math.max(steps.length, 1)) };
    for (const step of steps.slice(0, 2)) progress = withStepRuntime(progress, step, { assignees: taken ? [who] : [], approvals: closed ? [who] : [] });
    const body = taken ? upsertTaskProgressInBody(workOrderIssueBody(order), progress) : workOrderIssueBody(order);
    const updated = new Date(Date.now() - ((n * 7919) % (30 * 86_400)) * 1000).toISOString();
    return {
      id: n, number: n, title: workOrderIssueTitle(order), state: closed ? "closed" : "open", body,
      labels: pmIssueLabelNames(order).map(labelId),
      milestone: { id: milestone.id, title: milestone.title, state: "open" },
      assignee: taken ? user(who) : null, assignees: taken ? [user(who)] : [],
      created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(), updated_at: updated, comments: 0,
      ...(closed ? { closed_at: updated } : {}),
    };
  }

  state.issues.push(...made);
  // A conversation on one subtarea in ten: a few comments each, as the team leaves them.
  for (const issue of made.filter((i) => i.number % 10 === 0)) {
    const thread = Array.from({ length: 2 + (issue.number % 4) }, (_, i) => ({
      id: 0, body: `Comentario ${i + 1} sobre ${issue.title}. @${PEOPLE[(issue.number + i) % PEOPLE.length]} ¿lo puede ver?`,
      user: user(PEOPLE[(issue.number + i + 1) % PEOPLE.length]!), created_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
    }));
    state.comments.push([issue.number, thread]);
  }
  const open = made.filter((i) => i.state === "open").length;
  console.log(`${book}: ${made.length} subtareas (${open} open, ${made.length - open} closed), ${board.teams.length} tasks`);
  seeded += made.length;
}

await api("/__mock/load", { method: "POST", body: JSON.stringify(state) });
const sizes = state.issues.map((i: MockIssue) => String(i.body ?? "").length);
console.log(`loaded ${state.issues.length} issues (${seeded} new); body ${Math.round(sizes.reduce((a: number, b: number) => a + b, 0) / sizes.length)} chars on average`);
