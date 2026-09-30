/**
 * «Publicar versión»: phase-dependency gate + idempotent release write, offline.
 * Run: npm run verify:release
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import {
  nextReleaseIdentity,
  publishVersion,
  releaseGate,
  releaseIdentity,
  resolveReleaseIdentity,
  releaseNameBlock,
  releaseResources,
  releaseToast,
  withNameDraft,
  withNameDrafts,
  type ReleaseWriter,
} from "../src/domain/release.ts";
import {
  clearStoredPrincipalPasses,
  dropPrincipalPassesFor,
  dropStalePrincipalPasses,
  isVerseDecisionComment,
  passTaskIntoPrincipal,
  principalPassGate,
  principalPassMarkIsCurrent,
  recordPrincipalPass,
  type PassDecisionComment,
  type PassMarkStore,
  type PrincipalPassIo,
  type PrincipalPassJob,
} from "../src/domain/principalPass.ts";
import { buildVerseChoicePosts, verseChoiceIssues } from "../src/domain/conflictChoice.ts";
import { buildVerseConflictPosts, type VerseConflictData } from "../src/domain/verseConflictEvent.ts";
import { formatVerseConflictsComment } from "../src/domain/verseConflicts.ts";
import { normalizePrincipalPasses, normalizeReleaseProfiles } from "../src/domain/store.ts";
import { applyWorkflowToBoard, boardToWorkflowTemplate } from "../src/domain/workflows.ts";
import { encodeWorkOrderMarker } from "../src/domain/workOrder.ts";
import type {
  AssignmentsDoc,
  Phase,
  PrincipalPassMark,
  ProjectSettings,
  ProjectTask,
  ReleaseProfile,
  ScopeKey,
} from "../src/domain/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const CLOSED_AT = "2026-09-20T10:00:00Z";

function issue(
  n: number,
  opts: { taskId: string; resource?: string; state?: "open" | "closed"; conflict?: boolean; closedAt?: string },
): DcsIssue {
  const body = encodeWorkOrderMarker({
    key: `NEH|${opts.taskId}|${n}`,
    book: "NEH",
    teamId: opts.taskId,
    resource: opts.resource ?? "tpl",
    portionIds: [],
    itemIds: [],
  } as unknown as Parameters<typeof encodeWorkOrderMarker>[0]);
  return {
    number: n,
    state: opts.state ?? "closed",
    ...((opts.state ?? "closed") === "closed" ? { closed_at: opts.closedAt ?? CLOSED_AT } : {}),
    title: `NEH 1:${n * 4 - 3}–${n * 4} · ${(opts.resource ?? "tpl").toUpperCase()}`,
    body,
    labels: [
      { name: "pm" },
      { name: `pm/tarea:${opts.taskId}` },
      ...(opts.conflict ? [{ name: "pm/estado:conflicto" }] : []),
    ],
    milestone: { title: "NEH" },
  } as unknown as DcsIssue;
}

function task(id: string, phaseId: string, resources: ScopeKey[]): ProjectTask {
  return {
    id,
    name: id,
    description: "",
    phaseId,
    memberIds: [],
    scope: resources,
    rules: resources.map((resource) => ({ resource, articleFilter: "all" as const })),
  };
}

const phases: Phase[] = [
  { id: "A", name: "Escritura", slug: "escritura", order: 0 },
  { id: "B", name: "Ayudas", slug: "ayudas", order: 1 },
];
const tasks: ProjectTask[] = [
  task("tpl-a", "A", ["tpl"]),
  task("tps-a", "A", ["tps"]),
  task("notas-b", "B", ["notas"]),
];
const onlyA: ReleaseProfile = { id: "p1", name: "Traducción", requiredPhaseIds: ["A"] };
const gate = (
  profile: ReleaseProfile | null,
  issues: DcsIssue[],
  t: ProjectTask[] = tasks,
  principalPasses: PrincipalPassMark[] = passedA,
) => releaseGate({ profile, phases, tasks: t, issues, book: "NEH", principalPasses });

const PASS_AT = "2026-09-21T12:00:00Z";

function passMark(taskId: string, issues: number[], closedThrough = CLOSED_AT): PrincipalPassMark {
  return { book: "NEH", taskId, at: PASS_AT, serverAt: PASS_AT, by: "gestora", issues, closedThrough };
}

const phaseAReady = [
  issue(1, { taskId: "tpl-a" }),
  issue(2, { taskId: "tpl-a" }),
  issue(3, { taskId: "tps-a", resource: "tps" }),
];
const phaseBOpen = [issue(10, { taskId: "notas-b", resource: "notas", state: "open" })];
const passedA = [passMark("tpl-a", [1, 2]), passMark("tps-a", [3])];

// 0. Scripture subtareas all closed but never passed: blocked, and the reason
//    says the text is not in the borrador principal (not that subtareas are open).
{
  const g = gate(onlyA, [...phaseAReady, ...phaseBOpen], tasks, []);
  assert(g.blockReason === "tpl-a todavía no está en el borrador principal.", `not passed: «${g.blockReason}»`);
  assert(!/subtarea|Falta/.test(g.blockReason), "closed subtareas are not called unfinished");
  assert(!/tronco|rama|SHA|master|\btag\b|\bref\b/i.test(g.blockReason), "no git jargon");

  const onlyTpl = gate(onlyA, phaseAReady, tasks, [passMark("tpl-a", [1, 2])]);
  assert(onlyTpl.blockReason === "tps-a todavía no está en el borrador principal.", `tps still missing: ${onlyTpl.blockReason}`);

  const otherBook = gate(onlyA, phaseAReady, tasks, passedA.map((m) => ({ ...m, book: "EZR" })));
  assert(otherBook.blockReason && /tpl-a todavía no está/.test(otherBook.blockReason), "mark for another book ignored");
  console.log("ok  closed scripture subtareas without a pass mark block with «todavía no está en el borrador principal»");
}

// 1. Requires only A: ready when A passes principalPassGate + has a pass mark while B is still open.
{
  for (const id of ["tpl-a", "tps-a"]) {
    const pass = principalPassGate({ issues: [...phaseAReady, ...phaseBOpen], taskId: id, book: "NEH" });
    assert(pass.blockReason === null, `precondition: ${id} passes principalPassGate (${pass.blockReason})`);
  }
  const g = gate(onlyA, [...phaseAReady, ...phaseBOpen]);
  assert(g.blockReason === null, `only A required: expected ready, got «${g.blockReason}»`);
  assert(g.phaseNames.join() === "Escritura", "phase names list only the required phase");
  console.log("ok  profile requiring only A is ready (passed) while B is still open");
}

// 2. Blocked by an open verse decision or an open subtarea in a required phase, even with a pass mark.
{
  const deciding = [issue(1, { taskId: "tpl-a", conflict: true }), ...phaseAReady.slice(1)];
  const g1 = gate(onlyA, deciding);
  assert(g1.blockReason && /Escritura/.test(g1.blockReason), `open decision blocks: ${g1.blockReason}`);
  assert(/decisiones/.test(g1.blockReason), "reason mentions the open decision");

  const open = [issue(1, { taskId: "tpl-a", state: "open" }), ...phaseAReady.slice(1)];
  const g2 = gate(onlyA, open);
  assert(g2.blockReason && /Escritura/.test(g2.blockReason), `open subtarea blocks: ${g2.blockReason}`);
  assert(/Falta 1 subtarea/.test(g2.blockReason), "reason counts the open subtarea");

  const missingTps = gate(onlyA, phaseAReady.slice(0, 2));
  assert(missingTps.blockReason && /tps-a/.test(missingTps.blockReason), "task with no subtareas blocks");
  console.log("ok  open decision / open subtarea / task without subtareas block the version (pass mark or not)");
}

// 2b. Stale marks: an open decision or open subtarea drops the mark; a new or
//     re-closed subtarea makes it stop counting, so the release blocks again.
{
  const settings: ProjectSettings = { releaseProfiles: [onlyA], principalPasses: passedA };
  const deciding = [issue(1, { taskId: "tpl-a", conflict: true }), ...phaseAReady.slice(1)];
  const afterDecision = dropStalePrincipalPasses(settings, deciding);
  assert(afterDecision?.principalPasses?.map((m) => m.taskId).join() === "tps-a", "open decision drops tpl-a mark");
  assert(afterDecision?.releaseProfiles?.length === 1, "other settings kept");
  const resolved = gate(onlyA, phaseAReady, tasks, afterDecision?.principalPasses ?? []);
  assert(resolved.blockReason === "tpl-a todavía no está en el borrador principal.", `after decision, pass again: ${resolved.blockReason}`);

  const reopened = [issue(1, { taskId: "tpl-a", state: "open" }), ...phaseAReady.slice(1)];
  assert(
    dropStalePrincipalPasses(settings, reopened)?.principalPasses?.every((m) => m.taskId !== "tpl-a"),
    "open subtarea drops the mark",
  );

  const added = [...phaseAReady, issue(4, { taskId: "tpl-a" })];
  assert(!principalPassMarkIsCurrent({ mark: passedA[0], issues: added }), "new subtarea after the pass: mark stale");
  assert(gate(onlyA, added).blockReason === "tpl-a todavía no está en el borrador principal.", "new subtarea blocks release");

  const reclosed = [issue(1, { taskId: "tpl-a", closedAt: "2026-09-25T09:00:00Z" }), ...phaseAReady.slice(1)];
  assert(!principalPassMarkIsCurrent({ mark: passedA[0], issues: reclosed }), "re-closed after the pass: mark stale");

  assert(dropStalePrincipalPasses(settings, phaseAReady) === settings, "nothing stale: same settings object");
  assert(dropStalePrincipalPasses(settings, []) === settings, "no subtareas loaded: marks kept");
  console.log("ok  open decision / open subtarea drop the mark; new or re-closed subtarea makes it stale");
}

// 3. Empty requiredPhaseIds is invalid.
{
  const g = gate({ ...onlyA, requiredPhaseIds: [] }, phaseAReady);
  assert(g.blockReason && /al menos una fase/.test(g.blockReason), `empty profile blocks: ${g.blockReason}`);
  assert(gate(null, phaseAReady).blockReason, "no profile blocks");
  console.log("ok  empty requiredPhaseIds (or no profile) cannot publish");
}

// 4. Non-required phase does not block; required non-scripture phase uses closed PM issues.
{
  const g = gate(onlyA, [...phaseAReady, issue(10, { taskId: "notas-b", resource: "notas", conflict: true, state: "open" })]);
  assert(g.blockReason === null, `B (not required) ignored: ${g.blockReason}`);

  const both: ReleaseProfile = { ...onlyA, requiredPhaseIds: ["A", "B"] };
  const blocked = gate(both, [...phaseAReady, ...phaseBOpen]);
  assert(blocked.blockReason && /Ayudas/.test(blocked.blockReason), `required B open blocks: ${blocked.blockReason}`);
  const ready = gate(both, [...phaseAReady, issue(10, { taskId: "notas-b", resource: "notas" })]);
  assert(ready.blockReason === null, `required B closed is ready (Notas needs no pass mark): ${ready.blockReason}`);
  const onlyB: ReleaseProfile = { ...onlyA, requiredPhaseIds: ["B"] };
  const notesOnly = gate(onlyB, [issue(10, { taskId: "notas-b", resource: "notas" })], tasks, []);
  assert(notesOnly.blockReason === null, `Notas closed, no marks at all: ${notesOnly.blockReason}`);
  assert(ready.phaseNames.join() === "Escritura,Ayudas", "both phase names in board order");

  const emptyPhase = gate(both, phaseAReady, tasks.filter((t) => t.phaseId === "A"));
  assert(emptyPhase.blockReason && /Ayudas.*no tiene tareas/.test(emptyPhase.blockReason), "phase without tasks blocks");

  const gone = gate({ ...onlyA, requiredPhaseIds: ["A", "zzz"] }, phaseAReady);
  assert(gone.blockReason && /ya no existe/.test(gone.blockReason), "deleted phase blocks");

  assert(releaseResources(onlyA, tasks).sort().join() === "tpl,tps", "resources come from required phases only");
  console.log("ok  non-required phase never blocks; notes phase needs closed subtareas; empty / deleted phase blocks");
}

// 4b. Unsaved name draft counts before a phase toggle or publish confirm.
{
  const typed = "Revision corta";
  const drafts = { p1: `  ${typed} ` };
  const toggled = withNameDrafts(
    [{ ...onlyA, requiredPhaseIds: ["A", "B"] }],
    drafts,
  );
  assert(toggled[0].name === typed, `phase toggle keeps typed name: ${toggled[0].name}`);
  assert(toggled[0].requiredPhaseIds.join() === "A,B", "phase toggle still applied");

  const confirmed = releaseIdentity(withNameDraft(onlyA, drafts.p1), new Date(2026, 8, 27));
  assert(confirmed.name === `${typed} · 27 de septiembre de 2026`, `confirm uses typed name: ${confirmed.name}`);
  assert(confirmed.tag === "revision-corta-2026-09-27", `tag from typed name: ${confirmed.tag}`);

  assert(withNameDraft(onlyA, undefined) === onlyA, "no draft: same profile");
  assert(withNameDraft(onlyA, "Traducción") === onlyA, "unchanged draft: same profile");
  assert(withNameDraft(onlyA, "   ").name === "Traducción", "empty draft never saves an empty name");
  assert(releaseNameBlock(onlyA, "   "), "empty name field blocks publish");
  assert(releaseNameBlock(onlyA, ""), "cleared name field blocks publish");
  assert(releaseNameBlock(onlyA, undefined) === null, "stored name: not blocked");
  assert(releaseNameBlock(onlyA, typed) === null, "typed name: not blocked");
  console.log("ok  typed version name counts before a phase toggle or confirm; empty name blocks");
}

// 5. Tag already exists: reported, no second create.
{
  const identity = releaseIdentity(onlyA, new Date(2026, 8, 27));
  assert(identity.tag === "traduccion-2026-09-27", `tag: ${identity.tag}`);
  assert(/^Traducción · 27 de septiembre de 2026$/.test(identity.name), `name: ${identity.name}`);

  const created: string[] = [];
  const tagsByRepo: Record<string, string[]> = { es_glt: [identity.tag], es_gst: [] };
  const writer: ReleaseWriter = {
    listTags: async (repo) => [...(tagsByRepo[repo] ?? [])],
    principalTip: async () => "tip",
    create: async (repo, release) => {
      assert(release.target === "tip", "release cut from the principal tip");
      created.push(repo);
      tagsByRepo[repo] = [...(tagsByRepo[repo] ?? []), release.tag];
    },
  };
  const params = { repos: ["es_glt", "es_gst"], tag: identity.tag, name: identity.name, body: "" };
  const first = await publishVersion(writer, params);
  assert(first.existing.join() === "es_glt" && first.created.join() === "es_gst", "existing repo skipped");
  const second = await publishVersion(writer, params);
  assert(second.created.length === 0 && second.existing.length === 2, "second run creates nothing");
  assert(created.join() === "es_gst", `exactly one create call: ${created.join()}`);
  assert(/ya existe/.test(releaseToast(second, identity.name)), "Spanish «ya existe» message");
  console.log("ok  existing tag reported without a second create");
}

// 5b. Same-day extra versions: next free number on every repo, earlier ones untouched.
{
  const corta: ReleaseProfile = { ...onlyA, name: "Revision corta" };
  const day = new Date(2026, 8, 30);
  const BASE_NAME = "Revision corta · 30 de septiembre de 2026";
  const BASE_TAG = "revision-corta-2026-09-30";

  type Op = { op: "create"; repo: string; tag: string; name: string };
  function fakeDcs(initial: Record<string, string[]>) {
    const tagsByRepo: Record<string, string[]> = Object.fromEntries(
      Object.entries(initial).map(([repo, tags]) => [repo, [...tags]]),
    );
    const ops: Op[] = [];
    const writer: ReleaseWriter = {
      listTags: async (repo) => [...(tagsByRepo[repo] ?? [])],
      principalTip: async () => "tip",
      create: async (repo, release) => {
        assert(!(tagsByRepo[repo] ?? []).includes(release.tag), `never recreate ${release.tag} on ${repo}`);
        ops.push({ op: "create", repo, tag: release.tag, name: release.name });
        tagsByRepo[repo] = [...(tagsByRepo[repo] ?? []), release.tag];
      },
    };
    return { writer, tagsByRepo, ops };
  }
  async function publishNext(dcs: ReturnType<typeof fakeDcs>, repos: string[]) {
    const identity = await resolveReleaseIdentity(dcs.writer, { repos, profile: corta, now: day });
    const outcome = await publishVersion(dcs.writer, { repos, ...identity, body: "" });
    return { identity, outcome };
  }

  const none = fakeDcs({ es_glt: ["revision-corta-2026-09-29", "traduccion-2026-09-30"] });
  const first = await publishNext(none, ["es_glt"]);
  assert(first.identity.name === BASE_NAME && first.identity.tag === BASE_TAG, `no version today: ${JSON.stringify(first.identity)}`);
  assert(first.outcome.created.join() === "es_glt", "first version created");
  assert(releaseIdentity(corta, day).tag === BASE_TAG, "releaseIdentity default is the unsuffixed one");

  const one = fakeDcs({ es_glt: [BASE_TAG] });
  const second = await publishNext(one, ["es_glt"]);
  assert(second.identity.name === `${BASE_NAME} · 2`, `second name: ${second.identity.name}`);
  assert(second.identity.tag === `${BASE_TAG}-2`, `second tag: ${second.identity.tag}`);
  assert(second.outcome.created.join() === "es_glt" && !second.outcome.existing.length, "second version created");
  assert(one.ops.length === 1 && one.ops[0]!.tag === `${BASE_TAG}-2`, "only one create, for the new version");
  assert(one.tagsByRepo.es_glt!.join() === `${BASE_TAG},${BASE_TAG}-2`, "first version kept, not deleted or updated");
  assert(releaseToast(second.outcome, second.identity.name) === `Versión «${BASE_NAME} · 2» publicada.`, "toast names the new version");

  const two = fakeDcs({ es_glt: [BASE_TAG, `${BASE_TAG}-2`] });
  const third = await publishNext(two, ["es_glt"]);
  assert(third.identity.name === `${BASE_NAME} · 3` && third.identity.tag === `${BASE_TAG}-3`, `third: ${JSON.stringify(third.identity)}`);
  assert(two.tagsByRepo.es_glt!.join() === `${BASE_TAG},${BASE_TAG}-2,${BASE_TAG}-3`, "earlier versions kept");

  const mixed = fakeDcs({ es_glt: [BASE_TAG], es_gst: [BASE_TAG, `${BASE_TAG}-2`] });
  const both = await publishNext(mixed, ["es_glt", "es_gst"]);
  assert(both.identity.tag === `${BASE_TAG}-3` && both.identity.name === `${BASE_NAME} · 3`, `one number for all repos: ${both.identity.tag}`);
  assert(both.outcome.created.join() === "es_glt,es_gst", "both repos get the new version");
  assert(mixed.ops.every((o) => o.tag === `${BASE_TAG}-3`), "same tag on every repo");
  assert(mixed.tagsByRepo.es_gst!.includes(`${BASE_TAG}-2`) && mixed.tagsByRepo.es_glt!.includes(BASE_TAG), "earlier versions kept on both");

  assert(
    nextReleaseIdentity(corta, [[`${BASE_TAG}-x`, `${BASE_TAG}-2026`, `${BASE_TAG}-1`, `${BASE_TAG}-02b`]], day).tag === `${BASE_TAG}-2027`,
    "numeric suffixes count (even odd ones); non-numeric do not",
  );
  assert(nextReleaseIdentity(corta, [["otra-revision-corta-2026-09-30"]], day).tag === BASE_TAG, "another profile's tag is ignored");
  assert(!/\btag\b|release|SHA/i.test(second.identity.name), "visible name has no git jargon");
  console.log("ok  same-day extra versions: «· 2», «· 3»…, one free number across repos, earlier versions kept");
}

// 6. Profiles persist and travel with templates.
{
  const norm = normalizeReleaseProfiles([
    { id: "p1", name: " Traducción ", requiredPhaseIds: ["A", "A", ""] },
    { id: "p2", name: "" },
  ]);
  assert(norm?.length === 1 && norm[0]!.name === "Traducción" && norm[0]!.requiredPhaseIds.join() === "A", "normalize");

  const board = {
    schema: "gateway-assignments-2",
    projectId: "NEH",
    book: "NEH",
    title: "NEH",
    kind: "book",
    books: ["NEH"],
    lang: "es-419",
    contentOrg: "org",
    pmOrg: "pm",
    people: [],
    phases,
    teams: tasks,
    assignments: [],
    settings: { allowSelfAssign: true, releaseProfiles: [onlyA] },
  } as AssignmentsDoc;
  const wf = boardToWorkflowTemplate(board, { name: "Flujo" });
  assert(wf.releaseProfiles?.[0]?.requiredPhaseIds.join() === "A", "template carries profiles");
  const fresh = applyWorkflowToBoard({ ...board, settings: { allowSelfAssign: true } }, wf);
  assert(fresh.settings?.releaseProfiles?.[0]?.name === "Traducción", "new project inherits profiles");
  assert(fresh.settings?.allowSelfAssign === true, "other settings kept");
  console.log("ok  profiles normalize, save into templates and copy into projects");
}

// 7. Only a fully successful pass produces the mark; failed / aborted passes never do.
{
  const principal = "\\id NEH\n\\c 1\n\\p\n\\v 1\n\\v 2\n\\v 3\n\\v 4\n\\v 5\n\\v 6\n\\v 7\n\\v 8\n";
  const grupal = principal
    .replace("\\v 1\n", "\\v 1 Uno.\n")
    .replace("\\v 2\n", "\\v 2 Dos.\n")
    .replace("\\v 5\n", "\\v 5 Cinco.\n");
  const tplGate = principalPassGate({ issues: phaseAReady, taskId: "tpl-a", book: "NEH" });
  assert(tplGate.blockReason === null && tplGate.targets.length === 1, "precondition: tpl-a has one target");
  const target = tplGate.targets[0]!;
  const ctx = { taskId: "tpl-a", book: "NEH", by: "@gestora", issues: phaseAReady };

  function job(store: { text: string; at?: string }, grupalText: string, fail?: Error): PrincipalPassJob {
    let commit: string | undefined;
    const io: PrincipalPassIo = {
      readPrincipal: async () => ({ text: store.text, sha: "s", serverAt: store.at ?? "2026-09-20T08:00:00Z" }),
      readGrupal: async () => grupalText,
      write: async (text) => {
        if (fail) throw fail;
        store.text = text;
        store.at = "2026-09-21T12:00:00Z";
        commit = "c0ffee";
        return { serverAt: store.at };
      },
      isShaConflict: () => false,
    };
    return { io, target, label: "NEH 1:1–8", lastCommit: () => commit };
  }

  let settings: ProjectSettings | undefined = { releaseProfiles: [onlyA] };
  const recordIfPassed = async (j: PrincipalPassJob) => {
    const run = await passTaskIntoPrincipal([j], ctx);
    settings = recordPrincipalPass(settings, run.mark);
    return run;
  };

  const differing = { text: principal.replace("\\v 1\n", "\\v 1 Otro texto.\n") };
  await recordIfPassed(job(differing, grupal)).then(
    () => assert(false, "differ must reject"),
    (err: Error) => assert(/texto distinto/.test(err.message), `differ message: ${err.message}`),
  );
  await recordIfPassed(job({ text: principal }, grupal, new Error("500"))).then(
    () => assert(false, "write failure must reject"),
    (err: Error) => assert(err.message === "500", "write error surfaces"),
  );
  await recordIfPassed(job({ text: principal }, principal)).then(
    () => assert(false, "empty grupal must reject"),
    (err: Error) => assert(/no tiene texto/.test(err.message), `empty message: ${err.message}`),
  );
  assert(!settings?.principalPasses, "failed / aborted passes set no mark");
  assert(
    gate(onlyA, phaseAReady, tasks, settings?.principalPasses ?? []).blockReason === "tpl-a todavía no está en el borrador principal.",
    "release still blocked after a failed pass",
  );

  const store: { text: string; at?: string } = { text: principal };
  const written = await recordIfPassed(job(store, grupal));
  assert(written.written.length === 1 && !written.already.length, "first pass writes");
  assert(written.mark.issues.join() === "1,2" && written.mark.book === "NEH" && written.mark.by === "gestora", "mark identity");
  assert(written.mark.commits?.join() === "c0ffee", "mark keeps the principal commit id");
  assert(written.mark.closedThrough === CLOSED_AT, "mark keeps the latest closed_at");
  assert(written.mark.serverAt === "2026-09-21T12:00:00Z", `mark keeps the commit's server time: ${written.mark.serverAt}`);

  settings = { releaseProfiles: [onlyA] };
  const again = await recordIfPassed(job(store, grupal));
  assert(again.already.length === 1 && !again.mark.commits, "already in principal (checked in this call): mark without commit");
  assert(settings.principalPasses?.length === 1, "one mark per task");
  const withTps = recordPrincipalPass(settings, passMark("tps-a", [3]));
  assert(gate(onlyA, phaseAReady, tasks, withTps.principalPasses).blockReason === null, "passed phase no longer blocks");
  console.log("ok  successful pass records the mark (commit id when written); differ / write error / empty grupal record nothing");
}

// 8. Marks persist through the project settings normalizer.
{
  const norm = normalizePrincipalPasses([
    { book: "neh", taskId: "tpl-a", at: "2026-09-21T12:00:00.000Z", by: "g", issues: [2, "1", 0], commits: ["abc", ""] },
    { book: "NEH", taskId: "", at: "x" },
    { book: "NEH", taskId: "tpl-a", at: "2026-09-22T12:00:00Z", serverAt: "2026-09-22T12:00:00Z", by: "g", issues: [1, 2], closedThrough: CLOSED_AT },
  ]);
  assert(norm?.length === 1, "one mark per book + task");
  assert(norm[0]!.at.startsWith("2026-09-22") && norm[0]!.closedThrough === CLOSED_AT, "last row wins");
  assert(norm[0]!.serverAt === "2026-09-22T12:00:00Z", "server time persists");
  const legacyRow = normalizePrincipalPasses([{ book: "NEH", taskId: "tpl-a", at: "2026-09-21T12:00:00.000Z", issues: [1] }])![0]!;
  assert(!("serverAt" in legacyRow), "legacy row stays without a server time");
  const first = normalizePrincipalPasses([
    { book: "neh", taskId: "tpl-a", at: "t", issues: [2, "1", 0], commits: ["abc", ""] },
  ])![0]!;
  assert(first.book === "NEH" && first.issues.join() === "2,1" && first.commits?.join() === "abc", "fields normalized");
  console.log("ok  pass marks normalize for persistence");
}

// 9. A verse conflict or verse choice written after the pass voids the mark at
//    release time, from the stored comments alone (no board visit, label gone).
{
  const conflict: VerseConflictData = {
    pr: { owner: "org", repo: "es_glt", number: 7 },
    bookRef: "neh/tpl-a",
    book: "NEH",
    usfmPath: "16-NEH.usfm",
    range: { chapter: 1, from: 2, to: 2, kind: "texto", kept: "ultimo" },
    conflictIssue: 1,
    closer: "ana",
    otherIssue: 2,
    otherLogin: "bob",
    side: "entrante",
    texts: { entrante: "Dos (Ana).", tronco: "Dos (Bob)." },
    trunkSha: "abc123",
  };
  const choice = buildVerseChoicePosts({ data: conflict, decisionId: "1:1:2-2:abc", option: "desplazado", by: "gestora", wrote: true });
  const conflictPosts = buildVerseConflictPosts({
    payload: { issue: 1, bookRef: "neh/tpl-a", conflicts: [{ chapter: 1, from: 2, to: 2, kind: "texto", kept: "ultimo", candidates: [] }] },
    closer: "ana",
    pr: conflict.pr,
    book: "NEH",
    usfmPath: "16-NEH.usfm",
    others: [{ otherIssue: 2, otherLogin: "bob" }],
    stamp: "abc",
  });
  const prComment = formatVerseConflictsComment({
    issueNumber: 1,
    bookRef: "neh/tpl-a",
    book: "NEH",
    conflicts: [{ chapter: 1, from: 2, to: 2, kind: "texto", kept: "ultimo", candidates: [] }],
  });
  const at = (iso: string) => (body: string, issueNo = 1): PassDecisionComment => ({ issue: issueNo, createdAt: iso, body });
  const newer = at("2026-09-22T08:00:00Z");
  const older = at("2026-09-21T11:00:00Z");
  const withDecisions = (decisions: PassDecisionComment[], marks = passedA) =>
    releaseGate({ profile: onlyA, phases, tasks, issues: phaseAReady, book: "NEH", principalPasses: marks, decisions });

  assert(withDecisions([]).blockReason === null, "precondition: passed, closed, no label, no decisions → ready");
  for (const [label, body] of [
    ["verse-choice", choice[0]!.body],
    ["verse-conflict", conflictPosts[0]!.body],
    ["PR verse-conflicts", prComment],
  ] as const) {
    const g = withDecisions([newer(body)]);
    assert(g.blockReason === "tpl-a todavía no está en el borrador principal.", `${label} newer than pass blocks: «${g.blockReason}»`);
    assert(!/subtarea|Falta|decisiones/.test(g.blockReason), `${label}: closed subtareas are not called unfinished`);
    assert(withDecisions([older(body)]).blockReason === null, `${label} older than pass does not block`);
  }
  assert(withDecisions([newer(choice[1]!.body, 2)]).blockReason === "tpl-a todavía no está en el borrador principal.", "choice on the other covered subtarea blocks");
  assert(withDecisions([newer("Gracias, ya lo revisé.")]).blockReason === null, "plain comments never block");
  assert(withDecisions([newer(choice[0]!.body, 99)]).blockReason === null, "decision on an unrelated subtarea does not block");
  const tpsHit = withDecisions([newer(choice[0]!.body, 3)]);
  assert(tpsHit.blockReason === "tps-a todavía no está en el borrador principal.", `decision on tps-a blocks only tps-a: ${tpsHit.blockReason}`);
  assert(withDecisions([at("no es una fecha")(choice[0]!.body)]).blockReason !== null, "unreadable comment time fails closed");
  assert(isVerseDecisionComment(choice[0]!.body) && isVerseDecisionComment(prComment) && !isVerseDecisionComment("hola"), "reuses the event parsers");
  assert(principalPassMarkIsCurrent({ mark: passedA[0], issues: phaseAReady }), "without comments the old rule still applies");
  assert(
    !principalPassMarkIsCurrent({ mark: passedA[0], issues: phaseAReady, decisions: [newer(choice[0]!.body)] }),
    "old mark (written before this rule) is judged by comment time",
  );
  console.log("ok  verse conflict / verse choice newer than the pass blocks the version; older ones do not");

  // Applying a verse choice clears the stored mark with no board refresh.
  let stored = JSON.stringify({ schema: "gateway-assignments-2", projectId: "NEH", extra: { keep: true }, settings: { releaseProfiles: [onlyA], principalPasses: passedA } });
  let writes = 0;
  let conflictOnce = true;
  const store: PassMarkStore = {
    read: async () => ({ text: stored, sha: `v${writes}` }),
    write: async (text, sha) => {
      if (conflictOnce) {
        conflictOnce = false;
        throw Object.assign(new Error("409"), { status: 409 });
      }
      assert(sha === `v${writes}`, "writes with the version just read");
      stored = text;
      writes++;
    },
    isShaConflict: (err) => (err as { status?: number }).status === 409,
  };
  // Same call runVerseChoice makes; dropStalePrincipalPasses (the board refresh) is never involved.
  const cleared = await clearStoredPrincipalPasses(store, { issues: verseChoiceIssues(conflict) });
  assert(cleared && writes === 1, "choice clears the stored mark (after one version retry)");
  const after = JSON.parse(stored) as { extra: unknown; settings: ProjectSettings };
  assert(after.settings.principalPasses?.map((m) => m.taskId).join() === "tps-a", "only the touched task loses its mark");
  assert((after.extra as { keep: boolean }).keep && after.settings.releaseProfiles?.length === 1, "rest of the plan untouched");
  assert(!(await clearStoredPrincipalPasses(store, { issues: verseChoiceIssues(conflict) })) && writes === 1, "nothing left to clear: no write");
  const byTask = dropPrincipalPassesFor({ principalPasses: passedA }, { issues: [42], taskIds: ["tps-a"] });
  assert(byTask?.principalPasses?.map((m) => m.taskId).join() === "tpl-a", "conflict on a new subtarea clears its task's mark");
  assert(
    withDecisions([], after.settings.principalPasses).blockReason === "tpl-a todavía no está en el borrador principal.",
    "release blocked once the mark is gone",
  );
  console.log("ok  applying a verse choice clears the stored mark without a board refresh");

  // A later successful pass sets the mark again; an aborted pass does not.
  const principal = "\\id NEH\n\\c 1\n\\p\n\\v 1\n\\v 2\n\\v 3\n\\v 4\n\\v 5\n\\v 6\n\\v 7\n\\v 8\n";
  const grupal = principal.replace("\\v 1\n", "\\v 1 Uno.\n").replace("\\v 2\n", "\\v 2 Dos (Bob).\n");
  const target = principalPassGate({ issues: phaseAReady, taskId: "tpl-a", book: "NEH" }).targets[0]!;
  const passJob = (text: string): PrincipalPassJob => {
    const doc = { text };
    return {
      io: {
        readPrincipal: async () => ({ text: doc.text, sha: "s", serverAt: "2026-09-20T08:00:00Z" }),
        readGrupal: async () => grupal,
        write: async (t) => {
          doc.text = t;
          return { serverAt: "2026-09-23T09:00:00Z" };
        },
        isShaConflict: () => false,
      },
      target,
      label: "NEH 1:1–8",
    };
  };
  const decisions = [newer(choice[0]!.body)];
  let settings: ProjectSettings | undefined = after.settings;
  const ctx = { taskId: "tpl-a", book: "NEH", by: "gestora", issues: phaseAReady };
  await passTaskIntoPrincipal([passJob(principal.replace("\\v 2\n", "\\v 2 Dos (Ana).\n"))], ctx).then(
    (run) => {
      settings = recordPrincipalPass(settings, run.mark);
      assert(false, "differing verse must abort");
    },
    (err: Error) => assert(/texto distinto/.test(err.message), `abort message: ${err.message}`),
  );
  assert(!settings?.principalPasses?.some((m) => m.taskId === "tpl-a"), "aborted pass sets no mark");
  assert(
    withDecisions(decisions, settings?.principalPasses).blockReason === "tpl-a todavía no está en el borrador principal.",
    "still blocked after the aborted pass",
  );
  const run = await passTaskIntoPrincipal([passJob(principal)], ctx);
  settings = recordPrincipalPass(settings, run.mark);
  assert(run.mark.serverAt === "2026-09-23T09:00:00Z", "new mark server time is after the decision");
  assert(withDecisions(decisions, settings.principalPasses).blockReason === null, "passed again after the decision → ready");
  console.log("ok  a later successful pass sets the mark again; an aborted pass does not");
}

// 10. Clock skew: the pass time and the decision time both come from Door43.
//     A browser clock ahead of the server must not hide a decision made right after the pass.
{
  const SERVER_PASS = "2026-09-24T10:00:00Z";
  const BROWSER_AHEAD = "2026-09-24T10:05:00.000Z";
  const choiceBody = buildVerseChoicePosts({
    data: {
      pr: { owner: "org", repo: "es_glt", number: 7 },
      bookRef: "neh/tpl-a",
      book: "NEH",
      usfmPath: "16-NEH.usfm",
      range: { chapter: 1, from: 2, to: 2, kind: "texto", kept: "ultimo" },
      conflictIssue: 1,
      closer: "ana",
      otherIssue: 2,
      otherLogin: "bob",
      side: "entrante",
      texts: { entrante: "Dos (Ana).", tronco: "Dos (Bob)." },
      trunkSha: "abc123",
    },
    decisionId: "1:1:2-2:abc",
    option: "desplazado",
    by: "gestora",
    wrote: true,
  })[0]!.body;
  const decision = (iso: string): PassDecisionComment => ({ issue: 1, createdAt: iso, body: choiceBody });
  const releaseWith = (marks: PrincipalPassMark[], decisions: PassDecisionComment[]) =>
    releaseGate({ profile: onlyA, phases, tasks, issues: phaseAReady, book: "NEH", principalPasses: marks, decisions });
  const NOT_PASSED = "tpl-a todavía no está en el borrador principal.";

  const principal = "\\id NEH\n\\c 1\n\\p\n\\v 1\n\\v 2\n\\v 3\n\\v 4\n\\v 5\n\\v 6\n\\v 7\n\\v 8\n";
  const grupal = principal.replace("\\v 1\n", "\\v 1 Uno.\n");
  const target = principalPassGate({ issues: phaseAReady, taskId: "tpl-a", book: "NEH" }).targets[0]!;
  const ctx = { taskId: "tpl-a", book: "NEH", by: "gestora", issues: phaseAReady };
  // Browser clock 5 minutes ahead of Door43 for the whole pass: must not leak into the mark.
  const RealDate = Date;
  const skewMs = RealDate.parse(BROWSER_AHEAD);
  class AheadDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length) super(...(args as [string]));
      else super(skewMs);
    }
    static now() {
      return skewMs;
    }
  }
  async function withBrowserAhead<T>(fn: () => Promise<T>): Promise<T> {
    globalThis.Date = AheadDate as DateConstructor;
    try {
      return await fn();
    } finally {
      globalThis.Date = RealDate;
    }
  }
  const doc = { text: principal };
  const run = await withBrowserAhead(() =>
    passTaskIntoPrincipal(
      [
        {
          io: {
            readPrincipal: async () => ({ text: doc.text, sha: "s", serverAt: "2026-09-01T00:00:00Z" }),
            readGrupal: async () => grupal,
            write: async (t) => {
              doc.text = t;
              return { serverAt: SERVER_PASS };
            },
            isShaConflict: () => false,
          },
          target,
          label: "NEH 1:1–8",
        },
      ],
      ctx,
    ),
  );
  assert(run.written.length === 1, "precondition: the pass wrote");
  assert(run.mark.serverAt === SERVER_PASS && run.mark.at === SERVER_PASS, `mark holds the commit's server time: ${run.mark.serverAt}`);
  const marks = [run.mark, passMark("tps-a", [3])];

  const oneSecondAfter = releaseWith(marks, [decision("2026-09-24T10:00:01Z")]);
  assert(oneSecondAfter.blockReason === NOT_PASSED, `decision 1 s after the server pass blocks: «${oneSecondAfter.blockReason}»`);
  const browserMark = { ...run.mark, at: BROWSER_AHEAD };
  assert(
    releaseWith([browserMark, passMark("tps-a", [3])], [decision("2026-09-24T10:00:01Z")]).blockReason === NOT_PASSED,
    "a browser time in `at` (minutes ahead) is ignored; the server time decides",
  );
  assert(releaseWith(marks, [decision("2026-09-24T09:59:59Z")]).blockReason === null, "decision before the server pass does not block");
  assert(releaseWith(marks, [decision(SERVER_PASS)]).blockReason === null, "decision at the same server second is not after");
  assert(releaseWith(marks, [decision("mañana")]).blockReason === NOT_PASSED, "unreadable comment date fails closed");
  console.log("ok  decision 1 s after the server pass blocks even with the browser clock ahead; earlier ones do not");

  // Legacy mark: only a browser time. Stale for scripture tasks until a new pass stores a server time.
  const legacy: PrincipalPassMark = { book: "NEH", taskId: "tpl-a", at: BROWSER_AHEAD, by: "gestora", issues: [1, 2], closedThrough: CLOSED_AT };
  const withLegacy = [legacy, passMark("tps-a", [3])];
  assert(releaseWith(withLegacy, []).blockReason === NOT_PASSED, "legacy mark blocks with no decisions at all");
  assert(
    releaseGate({ profile: onlyA, phases, tasks, issues: phaseAReady, book: "NEH", principalPasses: withLegacy }).blockReason === NOT_PASSED,
    "legacy mark blocks even without the comment check",
  );
  assert(releaseWith(withLegacy, [decision("2026-09-24T09:00:00Z")]).blockReason === NOT_PASSED, "legacy mark: old decision still blocks");
  assert(!principalPassMarkIsCurrent({ mark: legacy, issues: phaseAReady }), "legacy mark is not current");
  const legacySettings: ProjectSettings = { principalPasses: withLegacy };
  assert(
    dropStalePrincipalPasses(legacySettings, phaseAReady)?.principalPasses?.map((m) => m.taskId).join() === "tps-a",
    "board refresh drops the legacy mark",
  );
  const repassed = recordPrincipalPass(legacySettings, run.mark);
  assert(releaseWith(repassed.principalPasses!, []).blockReason === null, "a new pass with a server time unblocks");
  console.log("ok  legacy mark (browser time only) blocks until a new pass stores a server time");

  // No write («already matched»): store the principal file's last commit server time, not a client time.
  const FILE_AT = "2026-09-24T09:30:00Z";
  let writes = 0;
  const same = await withBrowserAhead(() =>
    passTaskIntoPrincipal(
      [
        {
          io: {
            readPrincipal: async () => ({ text: grupal, sha: "s", serverAt: FILE_AT }),
            readGrupal: async () => grupal,
            write: async () => {
              writes++;
              return { serverAt: "2099-01-01T00:00:00Z" };
            },
            isShaConflict: () => false,
          },
          target,
          label: "NEH 1:1–8",
        },
      ],
      ctx,
    ),
  );
  assert(writes === 0 && same.already.length === 1 && !same.mark.commits, "already matched: nothing written");
  assert(same.mark.serverAt === FILE_AT && same.mark.at === FILE_AT, `already matched stores the file's server commit time: ${same.mark.serverAt}`);
  assert(same.mark.book === "NEH" && same.mark.by === "gestora" && same.mark.issues.join() === "1,2" && same.mark.closedThrough === CLOSED_AT, "identity fields kept");
  const sameMarks = [same.mark, passMark("tps-a", [3])];
  assert(releaseWith(sameMarks, [decision("2026-09-24T09:30:01Z")]).blockReason === NOT_PASSED, "decision after the file's commit time blocks");
  assert(releaseWith(sameMarks, [decision("2026-09-24T09:29:59Z")]).blockReason === null, "decision before the file's commit time does not block");

  // Door43 without a time: fail, no mark (never fall back to the browser clock).
  await passTaskIntoPrincipal(
    [
      {
        io: {
          readPrincipal: async () => ({ text: grupal, sha: "s" }),
          readGrupal: async () => grupal,
          write: async () => undefined,
          isShaConflict: () => false,
        },
        target,
        label: "NEH 1:1–8",
      },
    ],
    ctx,
  ).then(
    () => assert(false, "no server time must reject"),
    (err: Error) => assert(/no devolvió la hora/.test(err.message) && !/tronco|rama|SHA|commit|\bref\b/i.test(err.message), `no server time: ${err.message}`),
  );
  console.log("ok  «already matched» stores the principal file's server commit time; no server time → no mark");
}

// 11. No-write pass after a verse decision: the text already matches, so the
//     file time is older than the decision. The mark takes the newest decision
//     comment time (server), so the release is not blocked forever.
{
  const choiceBody = buildVerseChoicePosts({
    data: {
      pr: { owner: "org", repo: "es_glt", number: 7 },
      bookRef: "neh/tpl-a",
      book: "NEH",
      usfmPath: "16-NEH.usfm",
      range: { chapter: 1, from: 2, to: 2, kind: "texto", kept: "ultimo" },
      conflictIssue: 1,
      closer: "ana",
      otherIssue: 2,
      otherLogin: "bob",
      side: "entrante",
      texts: { entrante: "Dos (Ana).", tronco: "Dos (Bob)." },
      trunkSha: "abc123",
    },
    decisionId: "1:1:2-2:abc",
    option: "desplazado",
    by: "gestora",
    wrote: true,
  })[0]!.body;
  const prComment = formatVerseConflictsComment({
    issueNumber: 1,
    bookRef: "neh/tpl-a",
    book: "NEH",
    conflicts: [{ chapter: 1, from: 2, to: 2, kind: "texto", kept: "ultimo", candidates: [] }],
  });
  const NOT_PASSED = "tpl-a todavía no está en el borrador principal.";
  const releaseWith = (marks: PrincipalPassMark[], decisions: PassDecisionComment[]) =>
    releaseGate({ profile: onlyA, phases, tasks, issues: phaseAReady, book: "NEH", principalPasses: marks, decisions });

  const FILE_AT = "2026-09-25T10:00:00Z";
  const DECISION_AT = "2026-09-25T10:00:01Z";
  const principal = "\\id NEH\n\\c 1\n\\p\n\\v 1 Uno.\n\\v 2 Dos (Ana).\n\\v 3\n\\v 4\n\\v 5\n\\v 6\n\\v 7\n\\v 8\n";
  const target = principalPassGate({ issues: phaseAReady, taskId: "tpl-a", book: "NEH" }).targets[0]!;
  let writes = 0;
  const sameJob = (fileAt = FILE_AT): PrincipalPassJob => ({
    io: {
      readPrincipal: async () => ({ text: principal, sha: "s", serverAt: fileAt }),
      readGrupal: async () => principal,
      write: async () => {
        writes++;
        return { serverAt: "2099-01-01T00:00:00Z" };
      },
      isShaConflict: () => false,
    },
    target,
    label: "NEH 1:1–8",
  });
  const stored: PassDecisionComment[] = [
    { issue: 1, createdAt: "2026-09-25T09:00:00Z", body: prComment },
    { issue: 1, createdAt: DECISION_AT, body: choiceBody },
    { issue: 1, createdAt: "2026-09-25T11:00:00Z", body: "Gracias, ya lo revisé." },
    { issue: 99, createdAt: "2026-09-26T00:00:00Z", body: choiceBody },
  ];
  const sinceAsked: string[] = [];
  const ctx = {
    taskId: "tpl-a",
    book: "NEH",
    by: "gestora",
    issues: phaseAReady,
    loadDecisions: async (since: string) => {
      sinceAsked.push(since);
      return stored;
    },
  };

  const decisions = stored.slice(0, 2);
  const beforeFix = [{ ...passMark("tpl-a", [1, 2]), at: FILE_AT, serverAt: FILE_AT }, passMark("tps-a", [3])];
  assert(releaseWith(beforeFix, decisions).blockReason === NOT_PASSED, "precondition: a file-time mark stays blocked by the decision");

  const run = await passTaskIntoPrincipal([sameJob()], ctx);
  assert(writes === 0 && run.already.length === 1 && !run.mark.commits, "no-write pass: nothing written");
  assert(sinceAsked.join() === FILE_AT, `decisions read since the file time: ${sinceAsked.join()}`);
  assert(Date.parse(run.mark.serverAt!) >= Date.parse(DECISION_AT), `serverAt >= decision: ${run.mark.serverAt}`);
  assert(run.mark.serverAt === DECISION_AT && run.mark.at === DECISION_AT, "serverAt is the newest own decision (plain / unrelated comments ignored)");
  const marks = [run.mark, passMark("tps-a", [3])];
  assert(releaseWith(marks, decisions).blockReason === null, "release allowed after the no-write pass");
  assert(
    releaseWith(marks, [...decisions, { issue: 2, createdAt: "2026-09-25T10:00:02Z", body: choiceBody }]).blockReason === NOT_PASSED,
    "a decision after the stored serverAt blocks again",
  );

  // File newer than every decision: file time wins.
  const fileNewer = await passTaskIntoPrincipal([sameJob("2026-09-25T12:00:00Z")], ctx);
  assert(fileNewer.mark.serverAt === "2026-09-25T12:00:00Z", `file time wins when newer: ${fileNewer.mark.serverAt}`);

  // Unreadable decision date: fail in Spanish, no mark.
  let settings: ProjectSettings | undefined = { releaseProfiles: [onlyA] };
  await passTaskIntoPrincipal([sameJob()], {
    ...ctx,
    loadDecisions: async () => [...stored, { issue: 1, createdAt: "ayer", body: choiceBody }],
  }).then(
    (r) => {
      settings = recordPrincipalPass(settings, r.mark);
      assert(false, "unreadable decision date must reject");
    },
    (err: Error) =>
      assert(/No se pudo leer la fecha/.test(err.message) && !/tronco|rama|SHA|commit|\bref\b/i.test(err.message), `unreadable date: ${err.message}`),
  );
  assert(!settings?.principalPasses, "unreadable decision date sets no mark");
  assert(releaseWith([passMark("tps-a", [3])], decisions).blockReason === NOT_PASSED, "release stays blocked");

  // Comments cannot be read at all: no mark either.
  await passTaskIntoPrincipal([sameJob()], {
    ...ctx,
    loadDecisions: async () => {
      throw new Error("No se pudieron leer las conversaciones de las subtareas: 500");
    },
  }).then(
    () => assert(false, "unreadable comments must reject"),
    (err: Error) => assert(/No se pudieron leer/.test(err.message), `comments error: ${err.message}`),
  );

  // Write path unchanged: commit time, decisions not consulted.
  sinceAsked.length = 0;
  const empty = principal.replace("\\v 1 Uno.\n", "\\v 1\n");
  const doc = { text: empty };
  const wrote = await passTaskIntoPrincipal(
    [
      {
        io: {
          readPrincipal: async () => ({ text: doc.text, sha: "s", serverAt: FILE_AT }),
          readGrupal: async () => principal,
          write: async (t) => {
            doc.text = t;
            return { serverAt: "2026-09-25T10:30:00Z" };
          },
          isShaConflict: () => false,
        },
        target,
        label: "NEH 1:1–8",
      },
    ],
    ctx,
  );
  assert(wrote.written.length === 1 && wrote.mark.serverAt === "2026-09-25T10:30:00Z", `write path keeps the commit time: ${wrote.mark.serverAt}`);
  assert(!sinceAsked.length, "write path does not read decisions");

  // TPL + TPS both no-write: latest of both file times and the decisions.
  const tpsTarget = { ...target, resource: "tps" };
  const two = await passTaskIntoPrincipal(
    [sameJob("2026-09-25T09:30:00Z"), { ...sameJob("2026-09-25T09:45:00Z"), target: tpsTarget }],
    ctx,
  );
  assert(two.already.length === 2, "both targets already matched");
  assert(sinceAsked.join() === "2026-09-25T09:30:00Z", `decisions read since the oldest unchanged file: ${sinceAsked.join()}`);
  assert(two.mark.serverAt === DECISION_AT, `two targets: newest of files and decisions: ${two.mark.serverAt}`);
  sinceAsked.length = 0;
  const twoFileWins = await passTaskIntoPrincipal(
    [sameJob("2026-09-25T09:30:00Z"), { ...sameJob("2026-09-25T13:00:00Z"), target: tpsTarget }],
    ctx,
  );
  assert(twoFileWins.mark.serverAt === "2026-09-25T13:00:00Z", `two targets: newer file wins: ${twoFileWins.mark.serverAt}`);
  console.log("ok  no-write pass after a verse decision stores the newest decision time; newer decisions block; unreadable date → no mark");
}

console.log("\nverify:release — all checks passed");
