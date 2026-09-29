/**
 * Self-test for the local read cursor, comment → subtarea mapping and
 * Mis tareas attention helpers (plan slices 1–2).
 * Run: npx tsx scripts/verify-conversation.mts
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import {
  buildPrIndex,
  contentReposOf,
  issueNumberFromUrl,
  mapCommentToIssue,
  parseIssueUrl,
} from "../src/domain/notificationMap.ts";
import {
  countAttention,
  countUnread,
  cursorStorageKey,
  isNewTask,
  markSeen,
  seedSeenIfEmpty,
  emptyCursor,
  hasDecisionUnread,
  hasUnread,
  latestActivity,
  markThreadRead,
  mergeCursors,
  parseCursor,
  recordDecisions,
  recordLatest,
  seedIfEmpty,
  seedRead,
  type MappedComment,
} from "../src/domain/readCursor.ts";
import {
  attentionRank,
  formatRelativeEs,
  previewLine,
  rowActivity,
  rowPreview,
} from "../src/domain/attention.ts";
import {
  attentionCandidates,
  emptyNotified,
  notificationHref,
  notifiedStorageKey,
  parseNotified,
  shouldNotify,
} from "../src/domain/browserNotify.ts";
import {
  encodePortionPrMarker,
  portionPrApprovalReviewBody,
  trunkMergeCommitMessage,
} from "../src/domain/portionPr.ts";
import { formatVerseConflictsComment } from "../src/domain/verseConflicts.ts";
import {
  canOpenConversation,
  classifyComment,
  commentToItem,
  commitToItem,
  groupSaves,
  mergeTimeline,
  parseSaveCommit,
  stripHtmlComments,
  threadReadIds,
  activeMention,
  insertQuote,
  localClosedItem,
  localSavedItem,
  mentionCandidates,
  quoteVerse,
  sanitizeMentions,
  type ThreadItem,
  type ThreadSourceState,
} from "../src/domain/conversation.ts";
import { buildThreadReplyRequest } from "../src/dcs/conversationPost.ts";
import {
  PENDING_TTL_MS,
  listLocal,
  parsePending,
  pendingStorageKey,
  pruneExpired,
  pushLocal,
  reconcile,
  updateLocal,
} from "../src/domain/pendingEvents.ts";
import { scriptureCiteTargets } from "../src/domain/scriptureCites.ts";
import { findDisplacedAuthor, parseTrunkMergeCommit } from "../src/domain/trunkAuthor.ts";
import { buildVerseConflictPosts, verseConflictData } from "../src/domain/verseConflictEvent.ts";
import "../src/domain/chatEvents/verseConflict.ts";
import {
  buildVerseChoicePosts,
  choiceBlockReason,
  computeChoicePatch,
  sourceBlockReason,
  trunkChoiceCommitMessage,
} from "../src/domain/conflictChoice.ts";
import { formatChatEvent, isDecisionComment, parseChatEvent } from "../src/domain/chatEvent.ts";
import {
  decisionStatuses,
  pendingDecisionIds,
  resolutionsOnCards,
  resolveChatEvent,
} from "../src/domain/chatEvents/registry.ts";
import { isLabLaunch, labWriteDecision, launchForRange } from "../src/domain/solverLab.ts";
import { demoThreadSources } from "../src/domain/conversationFixture.ts";
import {
  SANDBOX_TEXTS,
  chooseInSandbox,
  editSandboxVerse,
  initialSandbox,
  resetSandbox,
  sandboxDecisionId,
  sandboxLaunch,
  sandboxPostsToItems,
  sandboxPrepared,
  sandboxThreadSources,
  sandboxVerseText,
} from "../src/domain/conflictSandbox.ts";
import { encodeTaskProgressMarker } from "../src/domain/taskProgress.ts";
import { parseHash, routeToHash } from "../src/router.tsx";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const PM = "ip-pm-test";

function issue(number: number, body = "", title = `NEH 1:${number} · TPL`): DcsIssue {
  return { id: number * 10, number, title, body, state: "open" } as unknown as DcsIssue;
}

const prBody = encodePortionPrMarker({
  schema: "gateway-portion-pr-1",
  owner: "es-419_sandbox",
  repo: "es-419_tpl",
  number: 7,
  htmlUrl: "https://git.door43.org/es-419_sandbox/es-419_tpl/pulls/7",
  head: "tas/neh/tpl/w/ana/41",
  base: "neh/tpl-draft",
  issueNumber: 41,
});

test("parseIssueUrl: issue API URL, pull web URL, other host", () => {
  assert.deepEqual(parseIssueUrl("https://git.door43.org/api/v1/repos/o/r/issues/12"), {
    owner: "o",
    repo: "r",
    kind: "issues",
    number: 12,
  });
  assert.equal(
    issueNumberFromUrl("https://qa.door43.org/es-419_sandbox/es-419_tpl/pulls/7#issuecomment-99"),
    7,
  );
  assert.equal(issueNumberFromUrl("https://example.org/a/b/issues/3/"), 3);
  assert.equal(issueNumberFromUrl("https://git.door43.org/o/r/commits/abc"), null);
  assert.equal(issueNumberFromUrl(undefined), null);
});

test("mapCommentToIssue: PM issue, PR via marker, foreign PR, wrong repo", () => {
  const prIndex = buildPrIndex([issue(41, prBody), issue(42)]);
  const pm = { owner: PM, repo: "gateway-tasks" };
  const content = { owner: "es-419_sandbox", repo: "es-419_tpl" };
  assert.deepEqual(
    mapCommentToIssue(
      { issue_url: `https://git.door43.org/api/v1/repos/${PM}/gateway-tasks/issues/42` },
      pm,
      { pmOrg: PM, prIndex },
    ),
    { issue: 42, source: "pm" },
  );
  assert.deepEqual(
    mapCommentToIssue(
      { pull_request_url: "https://git.door43.org/es-419_sandbox/es-419_tpl/pulls/7" },
      content,
      { pmOrg: PM, prIndex },
    ),
    { issue: 41, source: "pr" },
  );
  // PR #42 in the content repo is not issue #42 of the PM repo.
  assert.equal(
    mapCommentToIssue(
      { html_url: "https://git.door43.org/es-419_sandbox/es-419_tpl/pulls/42" },
      content,
      { pmOrg: PM, prIndex },
    ),
    null,
  );
  assert.equal(
    mapCommentToIssue(
      { issue_url: "https://git.door43.org/api/v1/repos/other/repo/issues/42" },
      pm,
      { pmOrg: PM, prIndex },
    ),
    null,
  );
  assert.deepEqual(contentReposOf([issue(41, prBody), issue(42)]), [content]);
});

function c(issueNo: number, id: number, author: string, source: "pm" | "pr" = "pm", body = "hola"): MappedComment {
  return { issue: issueNo, source, id, createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString(), author, body };
}

const opts = { me: "ana", preview: rowPreview };

test("own comments never raise the dot", () => {
  const doc = seedIfEmpty(recordLatest(emptyCursor(), [], opts));
  const next = recordLatest(doc, [c(41, 500, "Ana")], opts);
  assert.equal(hasUnread(next, 41), false);
  assert.equal(latestActivity(next, 41), null);
});

test("seed: first poll marks existing history read; later comments are unread", () => {
  let doc = recordLatest(emptyCursor(), [c(41, 100, "bob"), c(42, 101, "carla")], opts);
  doc = seedIfEmpty(doc);
  assert.equal(doc.seeded, true);
  assert.equal(countUnread(doc, [41, 42]), 0);
  doc = recordLatest(doc, [c(41, 200, "bob")], opts);
  assert.equal(hasUnread(doc, 41), true);
  assert.equal(hasUnread(doc, 42), false);
  assert.equal(seedIfEmpty(doc), doc, "seed runs once");
});

test("markThreadRead touches one thread only and never goes back", () => {
  let doc = seedIfEmpty(emptyCursor());
  doc = recordLatest(doc, [c(41, 200, "bob"), c(42, 201, "bob")], opts);
  doc = markThreadRead(doc, 41, { pm: 200 });
  assert.equal(hasUnread(doc, 41), false);
  assert.equal(hasUnread(doc, 42), true);
  doc = markThreadRead(doc, 41, { pm: 10 });
  assert.equal(doc.threads["41"].pm, 200);
});

test("cursor per source: PR ids are not compared with PM ids", () => {
  let doc = seedIfEmpty(emptyCursor());
  doc = recordLatest(doc, [c(41, 900, "bob", "pm")], opts);
  doc = markThreadRead(doc, 41, { pm: 900 });
  // A PR comment with a lower id than the PM cursor is still new.
  doc = recordLatest(doc, [c(41, 50, "revisor", "pr")], opts);
  assert.equal(hasUnread(doc, 41), true);
  doc = markThreadRead(doc, 41, { pr: 50 });
  assert.equal(hasUnread(doc, 41), false);
});

test("new repo after seeding is seeded for its own source only", () => {
  let doc = seedIfEmpty(recordLatest(emptyCursor(), [c(41, 10, "bob")], opts));
  doc = recordLatest(doc, [c(41, 20, "bob", "pm"), c(41, 5, "revisor", "pr")], opts);
  doc = seedRead(doc, { issues: [41], sources: ["pr"] });
  assert.equal(doc.threads["41"].pr, 5);
  assert.equal(hasUnread(doc, 41), true, "PM comment 20 stays unread");
});

test("corrupt JSON resets without throwing", () => {
  assert.deepEqual(parseCursor("{not json"), emptyCursor());
  assert.deepEqual(parseCursor(JSON.stringify({ v: 9 })), emptyCursor());
  assert.deepEqual(parseCursor(null), emptyCursor());
  const ok = parseCursor(JSON.stringify({ v: 1, seeded: true, threads: "x" }));
  assert.equal(ok.seeded, true);
  assert.deepEqual(ok.threads, {});
});

test("storage key is per host, user and PM org", () => {
  assert.equal(
    cursorStorageKey({ host: "https://git.door43.org/", username: "Ana", pmOrg: "IP-PM" }),
    "tas-chat:git.door43.org:ana:ip-pm",
  );
});

test("mergeCursors keeps the highest read id from either tab", () => {
  let a = seedIfEmpty(recordLatest(emptyCursor(), [c(41, 10, "bob")], opts));
  a = recordLatest(a, [c(41, 30, "bob")], opts);
  const b = markThreadRead(a, 41, { pm: 30 });
  const polled = recordLatest(a, [c(42, 31, "bob")], opts);
  const merged = mergeCursors(polled, b);
  assert.equal(hasUnread(merged, 41), false);
  assert.equal(hasUnread(merged, 42), true);
});

test("rowPreview: conflict comment has no markers, base64, SHAs or refs", () => {
  const body = formatVerseConflictsComment({
    issueNumber: 41,
    bookRef: "neh/tpl-draft",
    trunkSha: "0123456789abcdef0123456789abcdef01234567",
    book: "NEH",
    conflicts: [
      {
        chapter: 1,
        from: 10,
        to: 10,
        kind: "texto",
        kept: "ultimo",
        candidates: [
          { source: "tronco", sideIndex: 0, from: 10, to: 10, text: "siervo -->" },
          { source: "entrante", sideIndex: 1, from: 10, to: 10, text: "criado" },
        ],
      },
    ] as never,
  });
  const preview = rowPreview(body);
  assert.equal(preview, "Conflicto de versículos al cerrar");
  assert.ok(!/<!--|tas:|[A-Za-z0-9_-]{32,}/.test(preview));
});

test("rowPreview: merged / approved system lines in plain words", () => {
  const merged =
    "Versículos 1:10–11 de #41 fusionados en «neh/tpl-draft» (solo los versículos que cambiaron). El PR se cierra sin fusión Git; los commits de «tas/neh/tpl/w/ana/41» (0123456789abcdef0123) quedan en la ref «archivo/neh/41».";
  assert.equal(rowPreview(merged), "Versículos 1:10–11 guardados en el borrador grupal");
  assert.equal(
    rowPreview(portionPrApprovalReviewBody({ stepName: "Revisión", issueNumber: 41 })),
    "Aprobado: Revisión",
  );
});

test("rowPreview: human text keeps words, drops refs and SHAs", () => {
  const out = rowPreview(
    "> cita\n¿Seguro de **siervo**? Mira archivo/neh/41 y `abc1234def` en «tas/neh/tpl/w/ana/41» commit 9f8e7d6c5b4a",
  );
  assert.ok(out.includes("¿Seguro de siervo?"));
  assert.ok(!/archivo\/|tas\/|9f8e7d6c5b4a|abc1234def|«/.test(out), out);
  assert.equal(rowPreview("<!-- gt:en-curso -->"), "");
  assert.ok(rowPreview("a".repeat(10) + " " + "palabra ".repeat(40)).endsWith("…"));
});

test("formatRelativeEs: minutes, yesterday, date", () => {
  const now = new Date(2026, 8, 25, 12, 0, 0);
  assert.equal(formatRelativeEs(new Date(2026, 8, 25, 11, 59, 40), now), "ahora");
  assert.match(formatRelativeEs(new Date(2026, 8, 25, 11, 55), now), /^hace 5 min/);
  assert.match(formatRelativeEs(new Date(2026, 8, 25, 9, 0), now), /^hace 3 h/);
  assert.equal(formatRelativeEs(new Date(2026, 8, 24, 20, 0), now), "ayer");
  assert.match(formatRelativeEs(new Date(2026, 8, 12, 9, 0), now), /^12 sept?/);
  assert.match(formatRelativeEs(new Date(2025, 8, 12, 9, 0), now), /2025/);
  assert.equal(formatRelativeEs("no es fecha", now), "");
});

test("attention order: unread first, most recent first; generic rows work", () => {
  let doc = seedIfEmpty(emptyCursor());
  doc = recordLatest(doc, [c(1, 10, "bob"), c(2, 20, "bob"), c(3, 30, "bob")], opts);
  doc = markThreadRead(doc, 3, { pm: 30 });
  const rows = [1, 2, 3, 4].map((n) => ({ n, a: rowActivity(doc, n) }));
  rows.sort((x, y) => attentionRank(x.a, y.a));
  assert.deepEqual(rows.map((r) => r.n), [2, 1, 3, 4]);
  assert.equal(previewLine(rowActivity(doc, 2).latest), "bob: hola");
  assert.equal(previewLine(null), "");
  // A thematic subtarea (no verse range) has the same shape.
  const thematic = issue(4, "", "Artículo: Perdón");
  assert.equal(rowActivity(doc, thematic.number).needsAttention, false);
});

// ── Slice 3: thread timeline, typed events, local mark-read ────────────────

const PM_REPO = { owner: PM, repo: "gateway-tasks" };
const PR_REPO = { owner: "es-419_sandbox", repo: "es-419_tpl" };
const FORBIDDEN_VISIBLE = /<!--|-->|tas:|archivo\/|\bw\/|\btas\/|[A-Za-z0-9_-]{32,}|\b[0-9a-f]{10,40}\b/;

const realConflictBody = formatVerseConflictsComment({
  issueNumber: 41,
  bookRef: "neh/tpl-draft",
  trunkSha: "0123456789abcdef0123456789abcdef01234567",
  book: "NEH",
  conflicts: [
    {
      chapter: 1,
      from: 10,
      to: 10,
      kind: "texto",
      kept: "ultimo",
      candidates: [
        { source: "tronco", sideIndex: 0, from: 10, to: 10, text: "siervo -->" },
        { source: "entrante", sideIndex: 1, from: 10, to: 10, text: "criado" },
      ],
    },
  ] as never,
});

test("stripHtmlComments: real tas:verse-conflicts marker and unterminated comment", () => {
  const out = stripHtmlComments(realConflictBody);
  assert.ok(!/<!--|tas:verse-conflicts/.test(out), out);
  assert.ok(out.includes("Conflictos de versículo"));
  assert.equal(stripHtmlComments("hola\n\n<!-- a -->\n\n\nadiós"), "hola\n\nadiós");
  assert.equal(stripHtmlComments("texto <!-- sin cerrar eyJhIjoxfQ"), "texto");
});

test("classifyComment: every row of plan §6.1", () => {
  const known = formatChatEvent({ type: "verses-merged", emitter: "tas", issue: 41, summary: "Versículos 1:10 guardados en el borrador grupal" });
  assert.deepEqual(
    [classifyComment(known).kind, classifyComment(known).event?.type, classifyComment(known).text],
    ["sistema", "verses-merged", "Versículos 1:10 guardados en el borrador grupal"],
  );
  const legacy = classifyComment(realConflictBody);
  assert.equal(legacy.kind, "sistema");
  assert.equal(legacy.event?.type, "verse-conflicts-recorded");
  assert.ok(!FORBIDDEN_VISIBLE.test(legacy.text), legacy.text);

  const merged = classifyComment(
    "Versículos 1:10–11 de #41 fusionados en «neh/tpl-draft» (solo los versículos que cambiaron). El PR se cierra sin fusión Git; los commits de «w/neh/tpl-draft/ana/41» (0123456789abcdef0123456789abcdef01234567) quedan en la ref «archivo/neh/41».",
  );
  assert.equal(merged.event?.type, "verses-merged");
  assert.equal(merged.text, "Versículos 1:10–11 guardados en el borrador grupal");
  assert.ok(!FORBIDDEN_VISIBLE.test(merged.text));
  assert.equal(
    classifyComment("Versículos 1:10 de #41 ya estaban en «neh/tpl-draft»: sin cambios en el tronco.").text,
    "Versículos 1:10 ya estaban en el borrador grupal",
  );
  const approved = classifyComment(portionPrApprovalReviewBody({ stepName: "Revisión", issueNumber: 41 }));
  assert.equal(approved.event?.type, "step-approved");
  assert.equal(approved.event?.issue, 41);
  assert.equal(approved.text, "Aprobado: Revisión");
  const human = classifyComment("¿Seguro de **siervo**?\n<!-- gt:en-curso -->");
  assert.equal(human.kind, "humano");
  assert.equal(human.text, "¿Seguro de **siervo**?");
  const decision = classifyComment(
    formatChatEvent({
      type: "algo",
      emitter: "x",
      issue: 1,
      summary: "Decidir",
      decision: { id: "d1", options: [{ id: "a", label: "A" }], state: "pendiente" },
    }),
  );
  assert.equal(decision.kind, "decision");
});

test("unknown event type renders as a system line with its summary", () => {
  const body = formatChatEvent({
    type: "note-quote-mismatch",
    emitter: "tn-app",
    issue: 7,
    summary: "La cita ya no aparece en el versículo",
    decision: { id: "x", options: [{ id: "a", label: "Actualizar" }], state: "pendiente" },
  });
  const item = commentToItem({ id: 1, body, created_at: "2026-09-25T10:00:00Z", user: { login: "bob" } }, "issue", PM_REPO);
  const resolved = resolveChatEvent(item.event!);
  assert.equal(resolved.known, false);
  assert.equal(resolved.render, "system");
  assert.equal(resolved.title, "La cita ya no aparece en el versículo");
  assert.deepEqual(resolved.panels, []);
  assert.equal(parseChatEvent("<!-- tas:chat-event bm90LWpzb24 -->"), null, "bad JSON → null");
});

test("mergeTimeline: created_at order, source tie-break, same id in two repos, dedupe", () => {
  const t = "2026-09-25T10:00:00Z";
  const pmItem = commentToItem({ id: 5, body: "pm", created_at: t, user: { login: "bob" } }, "issue", PM_REPO);
  const prItem = commentToItem({ id: 5, body: "pr", created_at: t, user: { login: "bob" } }, "pr", PR_REPO);
  const earlier = commentToItem({ id: 99, body: "antes", created_at: "2026-09-25T09:00:00Z", user: { login: "bob" } }, "pr", PR_REPO);
  const out = mergeTimeline([prItem, pmItem, earlier, pmItem]);
  assert.deepEqual(out.map((i) => i.text), ["antes", "pm", "pr"]);
  assert.notEqual(pmItem.key, prItem.key, "same id in PM and content repo stays two items");
});

test("save commits: only this issue, grouped per author", () => {
  assert.equal(parseSaveCommit("TAS: NEH 1:10–11 (tpl) · #41", 41), "1:10–11");
  assert.equal(parseSaveCommit("TAS: NEH 1:10–11 (tpl) · #42", 41), null);
  assert.equal(parseSaveCommit("TAS: fusionar versículos 1:10 de #41 (@ana)", 41), null);
  const saves = ["a", "b", "c"].map((sha, i) =>
    commitToItem({ sha, created: `2026-09-25T09:0${i}:00Z`, commit: { message: "TAS: NEH 1:10 (tpl) · #41" }, author: { login: "ana" } }, 41, PR_REPO)!,
  );
  const grouped = groupSaves(mergeTimeline(saves));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].count, 3);
  assert.equal(grouped[0].text, "Guardado 1:10");
});

test("threadReadIds: per-source max; a failed comment source blocks the cursor", () => {
  const pmItems = [3, 9].map((id) => commentToItem({ id, body: "x", created_at: "2026-09-25T10:00:00Z", user: { login: "bob" } }, "issue", PM_REPO));
  const prItems = [4].map((id) => commentToItem({ id, body: "x", created_at: "2026-09-25T10:00:00Z", user: { login: "bob" } }, "pr", PR_REPO));
  const ok: ThreadSourceState[] = [
    { kind: "issue", cursorSource: "pm", status: "ok", items: pmItems },
    { kind: "pr", cursorSource: "pr", status: "ok", items: prItems },
    { kind: "commit", status: "ok", items: [] },
  ];
  assert.deepEqual(threadReadIds(ok), { pm: 9, pr: 4 });
  assert.equal(threadReadIds([ok[0], { ...ok[1], status: "error", items: [] }]), null);
  assert.deepEqual(threadReadIds([ok[0]]), { pm: 9 }, "issue without PR: PM source only");
  assert.equal(threadReadIds([]), null);

  // Opening #41 marks #41 only.
  let doc = seedIfEmpty(emptyCursor());
  doc = recordLatest(doc, [c(41, 9, "bob"), c(41, 4, "bob", "pr"), c(42, 10, "bob")], opts);
  doc = markThreadRead(doc, 41, threadReadIds(ok)!);
  assert.equal(hasUnread(doc, 41), false);
  assert.equal(hasUnread(doc, 42), true);
});

test("canOpenConversation: own, step role, gestor; not others", () => {
  const own = issue(41);
  (own as { assignees: unknown }).assignees = [{ login: "Ana" }];
  assert.equal(canOpenConversation(own, "ana", false), true);
  assert.equal(canOpenConversation(own, "carla", false), false);
  assert.equal(canOpenConversation(own, "carla", true), true);
  const reviewer = issue(
    43,
    encodeTaskProgressMarker({ schema: "gateway-task-progress-2", doneStepIds: [], steps: { rev: { assignees: ["bob"], approvals: [] } } } as never),
  );
  assert.equal(canOpenConversation(reviewer, "bob", false), true);
  assert.equal(canOpenConversation(reviewer, "", false), false);
});

test("route #/mis-tareas/{n} ↔ conversation", () => {
  assert.deepEqual(parseHash("#/mis-tareas/41"), { name: "conversacion", issue: 41 });
  assert.deepEqual(parseHash("#/mis-tareas/41?demo=1"), { name: "conversacion", issue: 41, demo: true });
  assert.deepEqual(parseHash("#/mis-tareas/abc"), { name: "mis-tareas" });
  assert.deepEqual(parseHash("#/mis-tareas/0"), { name: "mis-tareas" });
  assert.equal(routeToHash({ name: "conversacion", issue: 41 }), "#/mis-tareas/41");
});

test("demo thread: no markers, SHAs, branches or archivo refs in any visible text", () => {
  const sources = demoThreadSources(41, "ana", Date.parse("2026-09-25T12:00:00Z"));
  const items = groupSaves(mergeTimeline(sources.flatMap((s) => s.items)));
  assert.ok(items.length >= 7);
  for (const item of items) {
    const visible = item.event ? resolveChatEvent(item.event).title : item.text;
    assert.ok(!FORBIDDEN_VISIBLE.test(visible), `${item.key}: ${visible}`);
  }
  assert.ok(items.some((i) => i.kind === "humano"));
  assert.ok(items.some((i) => i.event?.type === "tipo-que-esta-version-no-conoce"));
});

// ── Slice 4: reply and cite ────────────────────────────────────────────────

test("reply payload: POST on the PM issue, never the PR", () => {
  const req = buildThreadReplyRequest("ip-pm-test", 41, "  > **NEH 1:10** siervo\n\n¿Así?  ");
  assert.deepEqual(req, {
    method: "POST",
    path: "/repos/ip-pm-test/gateway-tasks/issues/41/comments",
    body: { body: "> **NEH 1:10** siervo\n\n¿Así?" },
  });
  assert.ok(!/pulls|es-419_tpl/.test(req.path));
  assert.throws(() => buildThreadReplyRequest("ip-pm-test", 41, "   "), /vacío/);
  assert.throws(() => buildThreadReplyRequest("", 41, "hola"), /organización/);
  assert.throws(() => buildThreadReplyRequest("ip-pm-test", 0, "hola"), /inválida/);
});

test("cite: short quote, inserted before the draft", () => {
  assert.equal(quoteVerse("NEH 1:10", "  Ellos   son tus siervos "), "> **NEH 1:10** Ellos son tus siervos\n\n");
  const long = quoteVerse("NEH 1:11", "palabra ".repeat(60));
  assert.ok(long.length < 200 && long.includes("…"), long);
  assert.equal(insertQuote("", "> q\n\n"), "> q\n\n");
  assert.equal(insertQuote("\n¿seguro?", "> q\n\n"), "> q\n\n¿seguro?");
});

test("scriptureCiteTargets: verses in range, footnotes stripped for display", () => {
  const usfm = "\\id NEH\n\\c 1\n\\p\n\\v 9 nueve\n\\v 10 Ellos son tus siervos\\f + \\ft nota\\f*\n\\v 11 Oh Señor\n\\v 12 fuera";
  const out = scriptureCiteTargets(usfm, "neh", "1:10-11");
  assert.deepEqual(out.map((t) => t.ref), ["NEH 1:10", "NEH 1:11"]);
  assert.ok(!out[0].text.includes("nota") && !out[0].text.includes("\\"), out[0].text);
});

test("mentions: participants only; teams and outsiders do not notify", () => {
  const own = issue(41);
  (own as { assignees: unknown }).assignees = [{ login: "ana" }, { login: "bob" }];
  const items = [
    { author: "carla", kind: "humano" as const },
    { author: "tas-bot", kind: "sistema" as const },
  ];
  const allowed = mentionCandidates(own, items, "ana");
  assert.deepEqual(allowed, ["bob", "carla"]);
  assert.equal(
    sanitizeMentions("@bob mira, @carla. Y @es-419_gl/traductores y @dora", allowed),
    "@bob mira, @carla. Y `@es-419_gl/traductores` y `@dora`",
  );
  assert.equal(sanitizeMentions("correo ana@x.org", allowed), "correo ana@x.org");
  assert.deepEqual(activeMention("hola @bo", 8), { start: 5, query: "bo" });
  assert.equal(activeMention("ana@x", 5), null);
});

test("optimistic send: local item reconciles when the real comment arrives", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const local: ThreadItem = {
    key: "local:reply:1",
    source: "local",
    id: 0,
    createdAt: new Date(now).toISOString(),
    author: "ana",
    kind: "humano",
    text: "hola",
    pending: "enviando",
  };
  let doc = pushLocal(parsePending(null), 41, local);
  assert.equal(listLocal(doc, 41, now).length, 1);
  assert.equal(listLocal(doc, 42, now).length, 0);
  const real = commentToItem({ id: 77, body: "hola", created_at: "2026-09-25T12:00:01Z", user: { login: "ana" } }, "issue", PM_REPO);
  doc = updateLocal(doc, 41, local.key, { pending: undefined, reconcileKey: real.key });
  assert.equal(reconcile(listLocal(doc, 41, now), []).length, 1, "still shown until the poll returns");
  assert.deepEqual(reconcile(listLocal(doc, 41, now), [real]), []);
  assert.equal(mergeTimeline([real, ...reconcile(listLocal(doc, 41, now), [real])]).length, 1, "no duplicate");

  // Guardar: reconciled by commit SHA.
  const saved = localSavedItem("TAS: NEH 1:10 (tpl) · #41", 41, "ana", "abc123", new Date(now))!;
  assert.equal(saved.text, "Guardado 1:10");
  const commit = commitToItem({ sha: "abc123", created: "2026-09-25T12:00:05Z", commit: { message: "TAS: NEH 1:10 (tpl) · #41" }, author: { login: "ana" } }, 41, PR_REPO)!;
  assert.deepEqual(reconcile([{ ...saved, source: "local" }], [commit]), []);
  assert.equal(localSavedItem("TAS: NEH 1:10 (tpl) · #42", 41, "ana", "x"), null);

  // TTL: sent items expire; failed ones stay until retried or discarded.
  const closed = { ...localClosedItem(41, "ana", new Date(now)), source: "local" as const };
  const failed = { ...local, key: "local:reply:2", pending: "error" as const };
  doc = pushLocal(pushLocal(parsePending(null), 41, closed), 41, failed);
  const later = pruneExpired(doc, now + PENDING_TTL_MS + 1);
  assert.deepEqual(listLocal(later, 41, now + PENDING_TTL_MS + 1).map((i) => i.key), ["local:reply:2"]);
  assert.equal(parsePending("{bad").v, 1);
  assert.equal(
    pendingStorageKey({ host: "https://qa.door43.org/", username: "Ana", pmOrg: "IP-PM" }),
    "tas-chat-pending:qa.door43.org:ana:ip-pm",
  );
});

// ── Slice 5: persistent verse conflict in both threads ─────────────────────

test("formatChatEvent/parseChatEvent: text with --> and }, unknown type", () => {
  const body = formatChatEvent({
    type: "otro-tipo",
    emitter: "x",
    issue: 3,
    summary: "Cita «a --> b» }",
    data: { t: "} --> <!-- {" },
  });
  const parsed = parseChatEvent(body)!;
  assert.equal(parsed.summary, "Cita «a --> b» }");
  assert.equal((parsed.data as { t: string }).t, "} --> <!-- {");
  assert.equal(resolveChatEvent(parsed).render, "system");
});

test("parseTrunkMergeCommit reads the real trunkMergeCommitMessage", () => {
  const msg = trunkMergeCommitMessage({
    issueNumber: 37,
    verses: "1:9–10",
    translator: "bob",
    pullNumber: 5,
    workBranch: "tas/neh/tpl/w/bob/37",
    workSha: "0123456789abcdef0123456789abcdef01234567",
    archiveRef: "archivo/neh/37",
  });
  assert.deepEqual(parseTrunkMergeCommit(msg), {
    issue: 37,
    login: "bob",
    verses: "1:9–10",
    chapter: 1,
    from: 9,
    to: 10,
    pull: 5,
    workBranch: "tas/neh/tpl/w/bob/37",
    workSha: "0123456789abcdef0123456789abcdef01234567",
    archiveRef: "archivo/neh/37",
  });
  assert.equal(parseTrunkMergeCommit("TAS: NEH 1:10 (tpl) · #41"), null);
  const single = parseTrunkMergeCommit(
    trunkMergeCommitMessage({ issueNumber: 8, verses: "2:3", translator: "", pullNumber: 1, workBranch: "b", workSha: "abc1234" }),
  )!;
  assert.deepEqual([single.chapter, single.from, single.to, single.login], [2, 3, 3, null]);
});

test("findDisplacedAuthor: newest other subtarea overlapping the range; skips the closer", () => {
  const msg = (issueNumber: number, verses: string, who: string) => ({
    commit: {
      message: trunkMergeCommitMessage({ issueNumber, verses, translator: who, pullNumber: 1, workBranch: "b", workSha: "abc1234" }),
    },
  });
  const commits = [msg(41, "1:10", "ana"), { commit: { message: "otro commit" } }, msg(37, "1:9–10", "bob"), msg(30, "1:10", "dora")];
  assert.deepEqual(findDisplacedAuthor(commits, { issueNumber: 41, chapter: 1, from: 10, to: 10 }), {
    otherIssue: 37,
    otherLogin: "bob",
  });
  assert.equal(findDisplacedAuthor(commits, { issueNumber: 41, chapter: 2, from: 10, to: 10 }), null);
  assert.equal(findDisplacedAuthor([msg(41, "1:10", "ana")], { issueNumber: 41, chapter: 1, from: 10, to: 10 }), null);
});

const conflictPayload = {
  issue: 41,
  bookRef: "neh/tpl-draft",
  trunkSha: "0123456789abcdef0123456789abcdef01234567",
  conflicts: [
    {
      chapter: 1,
      from: 10,
      to: 10,
      kind: "texto" as const,
      kept: "ultimo" as const,
      candidates: [
        { source: "tronco" as const, sideIndex: -1, from: 10, to: 10, text: "Tus criados, dijo @carla <!-- x" },
        { source: "entrante" as const, sideIndex: 0, from: 10, to: 10, text: "Tus siervos -->" },
      ],
    },
  ],
};
const conflictBase = {
  payload: conflictPayload,
  closer: "ana",
  pr: { owner: "es-419_sandbox", repo: "es-419_tpl", number: 7 },
  book: "neh",
  usfmPath: "16-NEH.usfm",
  stamp: "0123456789ab",
};

test("verse-conflict comments: Ana's thread plus Bob's with @bob only", () => {
  const posts = buildVerseConflictPosts({ ...conflictBase, others: [{ otherIssue: 37, otherLogin: "bob" }] });
  assert.deepEqual(posts.map((p) => p.issue), [41, 37]);
  const [ana, bob] = posts;
  const mentionsIn = (body: string) => [...stripHtmlComments(body).matchAll(/(^|[^\w`])@([A-Za-z0-9][\w.-]*)/g)].map((m) => m[2]);
  assert.deepEqual(mentionsIn(ana!.body), [], "no notification from the closer's thread");
  assert.deepEqual(mentionsIn(bob!.body), ["bob"], "only Bob is mentioned");
  assert.deepEqual(bob!.event.mentions, ["bob"]);
  assert.match(bob!.event.summary, /^@bob: ana \(#41\) cerró NEH 1:10 y su versión reemplazó la tuya\.$/);
  assert.equal(ana!.event.summary, "El versículo NEH 1:10 también lo escribió bob (#37). Quedó tu versión.");
  for (const post of posts) {
    const visible = stripHtmlComments(post.body);
    assert.ok(!/<!--|tas:|[A-Za-z0-9_-]{32,}|archivo\//.test(visible), visible);
    assert.ok(visible.includes("Tus siervos") && visible.includes("Tus criados"));
    assert.equal(post.event.decision?.id, "41:1:10-10:0123456789ab", "same decision in both threads");
  }
  const labels = (i: number) => posts[i]!.event.decision!.options.map((o) => o.label);
  assert.deepEqual(labels(0), ["Quedarme con esta", "Volver a la otra"]);
  assert.deepEqual(labels(1), ["Mantener la de @ana", "Volver a la mía"]);
});

test("verse-conflict card parses back after reload; bad data is a system line", () => {
  const [ana, bob] = buildVerseConflictPosts({ ...conflictBase, others: [{ otherIssue: 37, otherLogin: "bob" }] });
  const item = commentToItem({ id: 5, body: ana!.body, created_at: "2026-09-25T10:00:00Z", user: { login: "ana" } }, "issue", PM_REPO);
  assert.equal(item.kind, "decision");
  const data = verseConflictData(item.event!)!;
  assert.deepEqual([data.side, data.otherIssue, data.otherLogin, data.range.kept, data.bookRef], ["entrante", 37, "bob", "ultimo", "neh/tpl-draft"]);
  assert.equal(data.texts.entrante, "Tus siervos -->", "raw normalized text kept in the marker");
  const resolved = resolveChatEvent(item.event!);
  assert.equal(resolved.render, "decision");
  assert.equal(resolved.title, "El versículo NEH 1:10 también lo escribió @bob (#37). Quedó tu versión.");
  assert.deepEqual(resolved.panels.map((p) => [p.label, p.tag ?? ""]), [
    ["Tu versión", "grupal"],
    ["Versión de @bob", ""],
  ]);
  const bobResolved = resolveChatEvent(parseChatEvent(bob!.body)!);
  assert.equal(bobResolved.title, "@ana (#41) cerró NEH 1:10 y su versión reemplazó la tuya.");
  assert.deepEqual(bobResolved.panels.map((p) => [p.label, p.tag ?? ""]), [
    ["Tu versión", ""],
    ["Versión de @ana", "grupal"],
  ]);
  const broken = { ...item.event!, data: { side: "entrante" } };
  assert.equal(resolveChatEvent(broken).render, "system");
  assert.equal(resolveChatEvent(broken).title, item.event!.summary);
});

test("verse-conflict: unknown other author → card on the closer's thread only", () => {
  const posts = buildVerseConflictPosts({ ...conflictBase, others: [null] });
  assert.deepEqual(posts.map((p) => p.issue), [41]);
  assert.equal(posts[0]!.event.summary, "El versículo NEH 1:10 también lo escribió otra subtarea. Quedó tu versión.");
  assert.equal(verseConflictData(posts[0]!.event)!.otherIssue, null);
  const panels = resolveChatEvent(posts[0]!.event).panels;
  assert.equal(panels[1]!.label, "Borrador grupal anterior");
});

// ── Slice 6: Quedarme con esta / Volver a la otra ──────────────────────────

const [anaCard, bobCard] = buildVerseConflictPosts({ ...conflictBase, others: [{ otherIssue: 37, otherLogin: "bob" }] });
const anaData = verseConflictData(anaCard!.event)!;
const bobData = verseConflictData(bobCard!.event)!;
const okPrepared = { trunkText: "Tus siervos -->", sourceReason: null };
const anaViewer = { username: "ana", canManage: false, assignees: ["ana"] };

test("choiceBlockReason: enabled, wrong person, trunk changed, unreadable, no source, loading", () => {
  assert.equal(choiceBlockReason({ data: anaData, option: "tronco", viewer: anaViewer, prepared: okPrepared }), null);
  assert.equal(choiceBlockReason({ data: anaData, option: "desplazado", viewer: anaViewer, prepared: okPrepared }), null);
  assert.equal(
    choiceBlockReason({ data: anaData, option: "desplazado", viewer: { ...anaViewer, username: "carla" }, prepared: okPrepared }),
    "Solo @ana o un gestor puede decidir.",
  );
  assert.equal(
    choiceBlockReason({ data: anaData, option: "desplazado", viewer: { username: "gestor", canManage: true, assignees: ["ana"] }, prepared: okPrepared }),
    null,
  );
  const changed = { trunkText: "Otra persona lo cambió", sourceReason: null };
  for (const option of ["tronco", "desplazado"] as const) {
    assert.equal(
      choiceBlockReason({ data: anaData, option, viewer: anaViewer, prepared: changed }),
      "El versículo 1:10 cambió después del conflicto. Ábrelo en el editor.",
    );
  }
  assert.match(choiceBlockReason({ data: anaData, option: "tronco", viewer: anaViewer, prepared: { trunkText: null, sourceReason: null } })!, /borrador grupal/);
  const noSource = { ...okPrepared, sourceReason: sourceBlockReason({ ...anaData, trunkSha: undefined, otherIssue: null }) };
  assert.ok(noSource.sourceReason);
  assert.equal(choiceBlockReason({ data: anaData, option: "desplazado", viewer: anaViewer, prepared: noSource }), noSource.sourceReason);
  assert.equal(choiceBlockReason({ data: anaData, option: "tronco", viewer: anaViewer, prepared: noSource }), null);
  assert.equal(choiceBlockReason({ data: anaData, option: "tronco", viewer: anaViewer }), "Comprobando el versículo…");
  // Bob's side: the kept text is Ana's too (kept: "ultimo").
  assert.equal(
    choiceBlockReason({ data: bobData, option: "desplazado", viewer: { username: "bob", canManage: false, assignees: ["bob"] }, prepared: okPrepared }),
    null,
  );
  const options = resolveChatEvent(anaCard!.event).definition!.options!(anaCard!.event, { viewer: anaViewer, prepared: changed });
  assert.deepEqual(options.map((o) => [o.label, Boolean(o.blockReason)]), [
    ["Quedarme con esta", true],
    ["Volver a la otra", true],
  ]);
  const enabled = resolveChatEvent(anaCard!.event).definition!.options!(anaCard!.event, { viewer: anaViewer, prepared: okPrepared });
  assert.equal(enabled[1]!.confirm, "¿Volver a la versión de @bob en 1:10? Se guarda en el borrador grupal.");
});

const NL = "\r\n";
const trunkCrlf = ["\\id NEH", "\\c 1", "\\p", "\\v 9 nueve", "\\v 10 Tus siervos -->", "\\v 11 once", "\\q1", "\\v 12 doce", ""].join(NL);
const beforeClose = ["\\id NEH", "\\c 1", "\\p", "\\v 9 nueve VIEJO", "\\v 10 Tus criados\\f + \\ft nota de Bob\\f*", "\\v 11 once", "\\q1", "\\v 12 doce VIEJO", ""].join("\n");

test("computeChoicePatch: only the range changes, CRLF kept, footnote copied from the real file", () => {
  const patch = computeChoicePatch({ trunk: trunkCrlf, source: beforeClose, range: { chapter: 1, from: 10, to: 10 }, expectedSourceText: "Tus criados" });
  assert.ok(patch.ok, JSON.stringify(patch));
  if (!patch.ok) return;
  assert.equal(patch.changed, true);
  assert.equal(
    patch.usfm,
    ["\\id NEH", "\\c 1", "\\p", "\\v 9 nueve", "\\v 10 Tus criados\\f + \\ft nota de Bob\\f*", "\\v 11 once", "\\q1", "\\v 12 doce", ""].join(NL),
  );
  const start = trunkCrlf.indexOf("\\v 10");
  const end = trunkCrlf.indexOf("\\v 11");
  assert.equal(patch.usfm.slice(0, start), trunkCrlf.slice(0, start), "bytes before the range identical");
  assert.equal(patch.usfm.slice(patch.usfm.indexOf("\\v 11")), trunkCrlf.slice(end), "bytes after the range identical");
});

test("computeChoicePatch: choosing what is there does not write; refusals", () => {
  const same = computeChoicePatch({ trunk: trunkCrlf, source: trunkCrlf, range: { chapter: 1, from: 10, to: 10 }, expectedSourceText: "Tus siervos -->" });
  assert.deepEqual(same, { ok: true, usfm: trunkCrlf, changed: false });
  const wrongSource = computeChoicePatch({ trunk: trunkCrlf, source: beforeClose, range: { chapter: 1, from: 10, to: 10 }, expectedSourceText: "otro texto" });
  assert.equal(wrongSource.ok, false);
  // Multi-line verse with a footnote: the engine would write normalized text → refuse.
  const poetry = ["\\id NEH", "\\c 1", "\\p", "\\v 9 nueve", "\\v 10 Tus criados", "\\q2 y tu gente\\f + \\ft nota\\f*", "\\v 11 once", ""].join("\n");
  const refused = computeChoicePatch({ trunk: trunkCrlf, source: poetry, range: { chapter: 1, from: 10, to: 10 }, expectedSourceText: "Tus criados y tu gente" });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.reason, /notas o formato/);
});

test("trunkChoiceCommitMessage round-trips through parseTrunkMergeCommit", () => {
  const msg = trunkChoiceCommitMessage({ data: anaData, option: "desplazado", by: "ana", source: "blob:0123456789abcdef" });
  assert.match(msg, /^TAS: elegir versión de 1:10 en #41 \(@ana\) — quedó #37 \(@bob\)\n\nDecidió: @ana\nArchivo: 16-NEH\.usfm\nFuente: blob:/);
  const info = parseTrunkMergeCommit(msg)!;
  assert.deepEqual([info.issue, info.login, info.chapter, info.from, info.to], [37, "bob", 1, 10, 10]);
  const keep = trunkChoiceCommitMessage({ data: anaData, option: "tronco", by: "ana", source: "-" });
  assert.equal(parseTrunkMergeCommit(keep)!.issue, 41);
});

test("verse-choice: both threads, mention the other person, card collapses; older card is history", () => {
  const posts = buildVerseChoicePosts({ data: anaData, decisionId: anaCard!.event.decision!.id, option: "desplazado", by: "ana", wrote: true, commit: "c0ffee" });
  assert.deepEqual(posts.map((p) => p.issue), [41, 37]);
  assert.equal(posts[0]!.event.summary, "Resuelto por ana: en NEH 1:10 quedó la versión de bob.");
  assert.equal(posts[1]!.event.summary, "@bob: Resuelto por ana: en NEH 1:10 quedó la versión de bob.");
  assert.equal(posts[0]!.event.mentions, undefined);
  for (const post of posts) assert.ok(!/<!--|tas:|c0ffee/.test(stripHtmlComments(post.body)));

  const t = (m: number) => `2026-09-25T10:${String(m).padStart(2, "0")}:00Z`;
  const older = buildVerseConflictPosts({ ...conflictBase, stamp: "old", others: [{ otherIssue: 37, otherLogin: "bob" }] })[0]!;
  const card = (id: number, body: string, m: number) => commentToItem({ id, body, created_at: t(m), user: { login: "ana" } }, "issue", PM_REPO);
  const items = mergeTimeline([card(1, older.body, 1), card(2, anaCard!.body, 2)]);
  let statuses = decisionStatuses(items);
  assert.equal(statuses.get(items[0]!.key)!.superseded, true);
  assert.equal(statuses.get(items[1]!.key)!.superseded, false);
  assert.deepEqual(pendingDecisionIds(statuses), [anaCard!.event.decision!.id]);

  const choice = card(3, posts[0]!.body, 3);
  assert.equal(resolveChatEvent(choice.event!).title, "Resuelto por @ana: quedó la versión de @bob");
  statuses = decisionStatuses(mergeTimeline([...items, choice]));
  assert.ok(statuses.get(items[1]!.key)!.resolution);
  assert.deepEqual(pendingDecisionIds(statuses), []);

  assert.deepEqual([...resolutionsOnCards(mergeTimeline([...items, choice]))], [choice.key], "card shows it; no second line");
  assert.equal(resolutionsOnCards([choice]).size, 0, "without its card (other thread) the line stays");
});

test("decided card after «Volver a la otra»: badge, sentence and restore follow who won", () => {
  const bobText = "Tus criados, dijo @carla <!-- x";
  const posts = buildVerseChoicePosts({ data: anaData, decisionId: anaCard!.event.decision!.id, option: "desplazado", by: "ana", wrote: true });
  assert.equal(posts[0]!.event.data!.kept, "tronco", "choice records what the trunk holds now");
  const def = resolveChatEvent(anaCard!.event).definition!;
  const bobViewer = { username: "bob", canManage: false, assignees: ["ana"] };
  const afterPrepared = { trunkText: bobText, sourceReason: null };
  // QA comments posted before `kept` existed resolve the same way from `choice`.
  const { kept: _kept, ...legacyData } = posts[1]!.event.data!;
  for (const [label, resolution] of [
    ["new", posts[1]!.event],
    ["legacy", { ...posts[1]!.event, data: legacyData }],
  ] as const) {
    const bob = def.decided!(bobCard!.event, resolution)!;
    assert.equal(bob.title, "En NEH 1:10 quedó tu versión.", label);
    assert.doesNotMatch(bob.title, /reemplazó/, label);
    assert.deepEqual(resolveChatEvent(bob.event).panels.map((p) => [p.label, p.tag ?? ""]), [
      ["Tu versión", "grupal"],
      ["Versión de @ana", ""],
    ], label);
    assert.deepEqual(bob.options, [], `${label}: winner sees a decided card, no action`);

    const ana = def.decided!(anaCard!.event, resolution)!;
    assert.equal(ana.title, "En NEH 1:10 quedó la versión de @bob (#37).", label);
    assert.deepEqual(resolveChatEvent(ana.event).panels.map((p) => [p.label, p.tag ?? ""]), [
      ["Tu versión", ""],
      ["Versión de @bob", "grupal"],
    ], label);
    assert.deepEqual(ana.options, ["desplazado"], `${label}: only the loser may restore`);
    const restore = def.options!(ana.event, { viewer: anaViewer, prepared: afterPrepared }).find((o) => o.id === "desplazado")!;
    assert.deepEqual([restore.label, restore.blockReason, restore.primary], ["Volver a la mía", null, false]);
    assert.equal(restore.confirm, "¿Volver a la versión de @ana en 1:10? Se guarda en el borrador grupal.");
    const blocked = (trunkText: string) =>
      def.options!(ana.event, { viewer: anaViewer, prepared: { trunkText, sourceReason: null } }).find((o) => o.id === "desplazado")!.blockReason;
    assert.equal(blocked("Tus siervos -->"), "Esa versión ya está en el borrador grupal.");
    assert.equal(blocked("Otra cosa"), "El versículo 1:10 cambió después del conflicto. Ábrelo en el editor.");
    assert.ok(def.options!(ana.event, { viewer: bobViewer, prepared: afterPrepared })[1]!.blockReason, "bob cannot act on ana's card");
  }

  // Ana restores: same patch path on the decided data; both threads flip.
  const anaNow = verseConflictData(def.decided!(anaCard!.event, posts[0]!.event)!.event)!;
  const back = buildVerseChoicePosts({ data: anaNow, decisionId: anaCard!.event.decision!.id, option: "desplazado", by: "ana", wrote: true });
  assert.deepEqual(back.map((p) => [p.issue, p.event.data!.owner, p.event.data!.kept]), [[41, "ana", "ultimo"], [37, "ana", "ultimo"]]);
  assert.deepEqual(def.decided!(anaCard!.event, back[0]!.event)!.options, []);
  assert.deepEqual(def.decided!(bobCard!.event, back[1]!.event)!.options, ["desplazado"]);
  assert.equal(def.decided!(bobCard!.event, back[1]!.event)!.title, "En NEH 1:10 quedó la versión de @ana (#41).");

  // On Bob's thread the newest choice is the resolution the card reads.
  const t = (m: number) => `2026-09-25T10:${String(m).padStart(2, "0")}:00Z`;
  const row = (id: number, body: string, m: number) => commentToItem({ id, body, created_at: t(m), user: { login: "ana" } }, "issue", PM_REPO);
  const thread = mergeTimeline([row(1, bobCard!.body, 1), row(2, posts[1]!.body, 2), row(3, back[1]!.body, 3)]);
  const status = decisionStatuses(thread).get(thread[0]!.key)!;
  assert.equal(status.resolution!.data!.kept, "ultimo");
});

// --- Slice 7: unseen new task -------------------------------------------------

test("seen-set: first load marks every assigned subtarea seen; a later id shows nueva until opened", () => {
  const seeded = seedSeenIfEmpty(emptyCursor(), [41, 37], "2026-09-25T10:00:00Z");
  assert.equal(seeded.seenSeeded, true);
  assert.equal(isNewTask(seeded, 41), false);
  assert.equal(isNewTask(seeded, 37), false);
  const again = seedSeenIfEmpty(seeded, [41, 37, 52]);
  assert.equal(again, seeded, "seed runs once");
  assert.equal(isNewTask(again, 52), true);
  const row = rowActivity(again, 52);
  assert.deepEqual([row.isNew, row.unread, row.needsAttention], [true, false, true]);
  assert.equal(countAttention(again, [41, 37, 52, 52]), 1);
  const opened = markSeen(again, 52, "2026-09-25T11:00:00Z");
  assert.equal(isNewTask(opened, 52), false);
  assert.equal(rowActivity(opened, 52).needsAttention, false);
  assert.equal(markSeen(opened, 52), opened, "opening twice is a no-op");
  assert.equal(countAttention(opened, [41, 37, 52]), 0);
});

test("seen-set: nothing is new before the seed; survives parse, merge and corrupt JSON", () => {
  assert.equal(isNewTask(emptyCursor(), 99), false);
  const doc = markSeen(seedSeenIfEmpty(emptyCursor(), [1]), 2);
  const round = parseCursor(JSON.stringify(doc));
  assert.equal(round.seenSeeded, true);
  assert.equal(isNewTask(round, 2), false);
  assert.equal(isNewTask(round, 3), true);
  const merged = mergeCursors(emptyCursor(), round);
  assert.equal(merged.seenSeeded, true);
  assert.equal(isNewTask(merged, 1), false);
  const broken = parseCursor("{not json");
  assert.equal(broken.seenSeeded, false);
  assert.equal(isNewTask(broken, 3), false);
  assert.notEqual(
    cursorStorageKey({ host: "qa.door43.org", username: "ana", pmOrg: "lab_gl" }),
    cursorStorageKey({ host: "qa.door43.org", username: "bob", pmOrg: "lab_gl" }),
  );
});

test("seen-set: unread and new count once per subtarea in the badge", () => {
  let doc = seedSeenIfEmpty(emptyCursor(), [41]);
  doc = recordLatest(
    doc,
    [{ issue: 52, source: "pm", id: 900, createdAt: "2026-09-25T12:00:00Z", author: "gestor", body: "hola" }],
    { me: "ana", preview: rowPreview },
  );
  assert.equal(hasUnread(doc, 52) && isNewTask(doc, 52), true);
  assert.equal(countAttention(doc, [41, 52]), 1);
});

// --- Pending decision (DECIDIR) dot -------------------------------------------

const decisionBody = formatChatEvent({
  type: "verse-conflict",
  emitter: "tas",
  issue: 146,
  summary: "@abelperez: abelper8 (#1) cerró NEH 1:10 y su versión reemplazó la tuya.",
  decision: {
    id: "1:1:10-10:abc",
    options: [
      { id: "tronco", label: "Mantener la de @abelper8" },
      { id: "desplazado", label: "Volver a la mía" },
    ],
    state: "pendiente",
  },
});

test("decision: pending decision is unread until the cursor passes that comment", () => {
  assert.equal(isDecisionComment(decisionBody), true);
  assert.equal(isDecisionComment("hola"), false);
  assert.equal(
    rowActivity(seedIfEmpty(emptyCursor()), 146, { decision: true }).unread,
    true,
    "no card recorded, thread never opened: dot",
  );
  // Seeded 30 days of history before the decision arrived.
  let doc = seedIfEmpty(recordLatest(emptyCursor(), [c(146, 100, "gestor")], opts));
  const card = c(146, 300, "abelper8", "pm", decisionBody);
  doc = recordDecisions(doc, [card], isDecisionComment);
  doc = recordLatest(doc, [card], opts);
  assert.equal(doc.decisions["146"]?.pm, 300);
  assert.equal(rowActivity(doc, 146, { decision: true }).unread, true);
  assert.equal(countAttention(doc, [], [146]), 1);
  // Rendering or re-polling never reads it.
  doc = recordDecisions(doc, [card], isDecisionComment);
  assert.equal(seedIfEmpty(doc), doc);
  assert.equal(rowActivity(doc, 146, { decision: true }).unread, true);
  // A cursor below the card is still unread; opening past it clears.
  doc = markThreadRead(doc, 146, { pm: 299 });
  assert.equal(hasDecisionUnread(doc, 146), true);
  doc = markThreadRead(doc, 146, { pm: 300 });
  assert.equal(rowActivity(doc, 146, { decision: true }).unread, false);
  assert.equal(countAttention(doc, [], [146]), 0);
  // Survives storage and merge with another tab.
  const round = parseCursor(JSON.stringify(recordDecisions(emptyCursor(), [card], isDecisionComment)));
  assert.equal(round.decisions["146"]?.pm, 300);
  assert.equal(mergeCursors(emptyCursor(), round).decisions["146"]?.pm, 300);
});

test("decision: the closer's own card counts; own chat comments still do not", () => {
  let doc = seedIfEmpty(emptyCursor());
  const own = c(1, 400, "ana", "pm", decisionBody);
  doc = recordDecisions(doc, [own, c(1, 401, "ana")], isDecisionComment);
  doc = recordLatest(doc, [own, c(1, 401, "ana")], opts);
  assert.equal(hasUnread(doc, 1), false, "own comments never raise the ordinary dot");
  assert.equal(doc.decisions["1"]?.pm, 400, "plain own comment is not a decision");
  assert.equal(rowActivity(doc, 1, { decision: true }).unread, true);
  assert.equal(rowActivity(doc, 1).unread, false, "only DECIDIR rows use the card");
  doc = markThreadRead(doc, 1, { pm: 401 });
  assert.equal(rowActivity(doc, 1, { decision: true }).unread, false);
});

test("decision: first-visit seed does not swallow a card, before or after the seed", () => {
  // Card already there on the very first poll, with a later comment on top.
  let first = recordDecisions(emptyCursor(), [c(146, 300, "abelper8", "pm", decisionBody)], isDecisionComment);
  first = recordLatest(first, [c(146, 300, "abelper8", "pm", decisionBody), c(146, 310, "gestor")], opts);
  first = seedIfEmpty(first);
  assert.equal(first.threads["146"]?.pm, 299);
  assert.equal(hasDecisionUnread(first, 146), true);
  // Card arriving after the seed: newer than the cursor, so unread.
  let later = seedIfEmpty(recordLatest(emptyCursor(), [c(146, 100, "gestor")], opts));
  later = recordDecisions(later, [c(146, 500, "abelper8", "pm", decisionBody)], isDecisionComment);
  assert.equal(hasDecisionUnread(later, 146), true);
  // A new repo seeded after the card does not pass it either.
  later = recordLatest(later, [c(146, 500, "abelper8", "pm", decisionBody)], opts);
  later = seedRead(later, { issues: [146], sources: ["pm"] });
  assert.equal(hasDecisionUnread(later, 146), true);
});

test("decision: a comment newer than the cursor surfaces attention", () => {
  let doc = seedIfEmpty(recordLatest(emptyCursor(), [c(146, 100, "gestor")], opts));
  doc = markThreadRead(doc, 146, { pm: 100 });
  assert.equal(rowActivity(doc, 146).needsAttention, false);
  assert.equal(countAttention(doc, [146]), 0);
  // The card lands on an issue that was not in my list yet (label/search lag):
  // it is kept, and counts as soon as the issue joins the list.
  const card = c(146, 700, "abelper8", "pm", decisionBody);
  doc = recordDecisions(doc, [card], isDecisionComment);
  assert.equal(countAttention(doc, [], [146]), 1);
  doc = recordLatest(doc, [card], opts);
  const row = rowActivity(doc, 146, { decision: true });
  assert.deepEqual([row.unread, row.needsAttention], [true, true]);
  assert.equal(countAttention(doc, [146]), 1);
});

// --- Fictional conflict sandbox (#/mis-tareas/prueba) ------------------------

test("sandbox: route parses and round-trips; never a numeric issue", () => {
  assert.deepEqual(parseHash("#/mis-tareas/prueba"), { name: "conflicto-prueba" });
  assert.equal(routeToHash({ name: "conflicto-prueba" }), "#/mis-tareas/prueba");
  assert.deepEqual(parseHash("#/mis-tareas/1?demo=1"), { name: "conversacion", issue: 1, demo: true });
});

test("sandbox: pending card shows both texts and the two production options", () => {
  const state = initialSandbox(Date.parse("2026-09-25T10:00:00Z"));
  assert.equal(sandboxVerseText(state), SANDBOX_TEXTS.mine);
  const [source] = sandboxThreadSources(state, "ana");
  const card = source!.items.find((i) => i.event?.decision)!;
  const resolved = resolveChatEvent(card.event!);
  assert.equal(resolved.render, "decision");
  assert.deepEqual(resolved.panels.map((p) => p.text), [SANDBOX_TEXTS.mine, SANDBOX_TEXTS.theirs]);
  const options = resolved.definition!.options!(card.event!, {
    viewer: { username: "ana", canManage: false, assignees: ["ana"] },
    prepared: sandboxPrepared(state),
  });
  assert.deepEqual(options.map((o) => [o.label, o.blockReason]), [
    ["Quedarme con esta", null],
    ["Volver a la otra", null],
  ]);
  for (const item of source!.items) assert.ok(!/neh\/|tpl-draft|[0-9a-f]{12,}/.test(item.text), "no branches or SHAs");
  assert.equal(card.event!.decision!.id, sandboxDecisionId());
});

test("sandbox: pending → chosen (Volver a la otra) patches only 1:10 in memory → reset", () => {
  const start = initialSandbox(0);
  const chosen = chooseInSandbox(start, "desplazado", "ana");
  assert.ok(chosen.ok);
  if (!chosen.ok) return;
  assert.equal(sandboxVerseText(chosen.state), SANDBOX_TEXTS.theirs);
  assert.deepEqual(chosen.state.choice, { option: "desplazado", by: "ana", wrote: true });
  assert.equal(chosen.state.trunk.replace(SANDBOX_TEXTS.theirs, "X"), start.trunk.replace(SANDBOX_TEXTS.mine, "X"), "outside 1:10 identical");
  assert.equal(chosen.posts.length, 1, "only the sandbox thread");
  const line = sandboxPostsToItems(chosen.posts, "ana", 1)[0]!;
  assert.equal(resolveChatEvent(line.event!).title, "Resuelto por @ana: quedó la versión de @bob");
  const statuses = decisionStatuses(mergeTimeline([...sandboxThreadSources(start, "ana")[0]!.items, line]));
  assert.deepEqual(pendingDecisionIds(statuses), []);

  const again = chooseInSandbox(chosen.state, "tronco", "ana");
  assert.equal(again.ok, false, "a decided conflict cannot be chosen twice");

  const reset = resetSandbox(chosen.state, 5);
  assert.equal(reset.choice, null);
  assert.equal(reset.round, chosen.state.round + 1);
  assert.equal(sandboxVerseText(reset), SANDBOX_TEXTS.mine);
  assert.notEqual(sandboxThreadSources(reset, "ana")[0]!.items[2]!.key, sandboxThreadSources(start, "ana")[0]!.items[2]!.key, "card remounts");
});

test("sandbox: Quedarme con esta writes nothing; hand edit blocks both buttons with the card reason", () => {
  const kept = chooseInSandbox(initialSandbox(0), "tronco", "ana");
  assert.ok(kept.ok && kept.state.trunk === initialSandbox(0).trunk && kept.state.choice?.wrote === false);
  const edited = editSandboxVerse(initialSandbox(0));
  assert.equal(edited.edited, true);
  const blocked = chooseInSandbox(edited, "desplazado", "ana");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, "El versículo 1:10 cambió después del conflicto. Ábrelo en el editor.");
  const card = sandboxThreadSources(edited, "ana")[0]!.items.find((i) => i.event?.decision)!;
  const options = resolveChatEvent(card.event!).definition!.options!(card.event!, {
    viewer: { username: "ana", canManage: false, assignees: ["ana"] },
    prepared: sandboxPrepared(edited),
  });
  assert.ok(options.every((o) => o.blockReason === "El versículo 1:10 cambió después del conflicto. Ábrelo en el editor."));
  assert.ok(options.every((o) => o.openEditor?.chapter === 1 && o.openEditor.from === 10 && o.openEditor.to === 10));
  const pending = resolveChatEvent(card.event!).definition!.options!(card.event!, {
    viewer: { username: "ana", canManage: false, assignees: ["ana"] },
    prepared: sandboxPrepared(initialSandbox(0)),
  });
  assert.ok(pending.every((o) => !o.openEditor), "no editor link while the buttons work");
});

test("sandbox: decided card absorbs the verse-choice line", () => {
  const start = initialSandbox(0);
  const kept = chooseInSandbox(start, "tronco", "ana");
  assert.ok(kept.ok);
  if (!kept.ok) return;
  const timeline = mergeTimeline([...sandboxThreadSources(start, "ana")[0]!.items, ...sandboxPostsToItems(kept.posts, "ana", 1)]);
  const hidden = resolutionsOnCards(timeline);
  assert.equal(hidden.size, 1);
  assert.equal(timeline.filter((i) => !hidden.has(i.key) && i.event).length, 1, "one card, no system line");
});

test("sandbox: mini-app is the TPL editor as a local lab launch (never DCS)", () => {
  const launch = sandboxLaunch("ana", "es-419")!;
  assert.equal(launch.app.id, "tpl-translate");
  assert.ok(isLabLaunch(launch.ctx));
  assert.equal(labWriteDecision(launch.ctx).mode, "local");
  assert.deepEqual([launch.ctx.book, launch.ctx.chapter, launch.ctx.ref, launch.ctx.issueNumber], ["NEH", 1, "1:10–11", 0]);
  const verse = launchForRange(launch.ctx, { chapter: 1, from: 10, to: 10 });
  assert.equal(verse.ref, "1:10");
  assert.equal(labWriteDecision(verse).mode, "local");
});

function notifyDoc(): ReturnType<typeof emptyCursor> {
  let doc = seedSeenIfEmpty(emptyCursor(), [5, 6]);
  doc = { ...doc, seeded: true };
  doc = recordLatest(
    doc,
    [
      { issue: 5, source: "pm", id: 100, createdAt: "2026-09-01T10:00:00Z", author: "bob", body: "¿Seguro de «siervo»?" },
      { issue: 5, source: "pm", id: 101, createdAt: "2026-09-01T10:01:00Z", author: "ana", body: "mío" },
    ],
    { me: "ana", preview: rowPreview },
  );
  doc = recordDecisions(
    doc,
    [
      { issue: 6, source: "pm", id: 200, createdAt: "2026-09-01T10:02:00Z", author: "bob", body: "card-bob" },
      { issue: 7, source: "pm", id: 300, createdAt: "2026-09-01T10:03:00Z", author: "ana", body: "card-ana" },
    ],
    (body) => body.startsWith("card"),
  );
  return doc;
}

const NOTIFY_TITLES = { "5": "NEH 13:30–31 · TPL", "6": "NEH 1:10–11 · TPL", "7": "NEH 2:1–3 · TPL", "8": "NEH 3:1 · TPL" };

function notifyCandidates(doc = notifyDoc()) {
  return attentionCandidates({
    doc,
    issues: [5, 6, 8],
    decisionIssues: [6, 7],
    titles: NOTIFY_TITLES,
    me: "ana",
    ownCommentIds: [101, 300],
  });
}

test("notify candidates: comment from others, decision, new task; own decision flagged", () => {
  const byId = new Map(notifyCandidates().map((c) => [c.id, c]));
  assert.deepEqual([...byId.keys()].sort(), ["c:pm:100", "d:pm:200", "d:pm:300", "t:8"]);
  assert.equal(byId.get("c:pm:100")!.title, "NEH 13:30–31 · TPL");
  assert.equal(byId.get("c:pm:100")!.body, "bob: ¿Seguro de «siervo»?");
  assert.equal(byId.get("c:pm:100")!.own, false);
  assert.equal(byId.get("d:pm:300")!.own, true, "my own decision card never notifies me");
  assert.equal(byId.get("t:8")!.body, "Tarea nueva asignada");
  assert.equal(notificationHref(byId.get("d:pm:200")!), "#/mis-tareas/6");
  for (const c of byId.values()) {
    assert.doesNotMatch(`${c.title} ${c.body}`, /refs\/|archivo\/|[0-9a-f]{40}|<!--|[A-Za-z0-9+/=]{32,}/);
  }
});

test("notify candidates: reading the thread or opening the task removes them", () => {
  let doc = notifyDoc();
  doc = markThreadRead(doc, 5, { pm: 101 });
  doc = markThreadRead(doc, 6, { pm: 200 });
  doc = markSeen(doc, 8);
  assert.deepEqual(notifyCandidates(doc).map((c) => c.id), ["d:pm:300"]);
});

test("shouldNotify: first run seeds silently, even hidden and granted", () => {
  const { show, notified } = shouldNotify({
    candidates: notifyCandidates(),
    notified: emptyNotified(),
    visibility: "hidden",
    permission: "granted",
  });
  assert.equal(show.length, 0);
  assert.equal(notified.seeded, true);
  assert.equal(notified.ids.length, 4);
});

test("shouldNotify: only hidden + granted shows new items, one per item, never own", () => {
  const seeded = { v: 1 as const, seeded: true, ids: [] as string[] };
  const hidden = shouldNotify({ candidates: notifyCandidates(), notified: seeded, visibility: "hidden", permission: "granted" });
  assert.deepEqual(hidden.show.map((c) => c.id).sort(), ["c:pm:100", "d:pm:200", "t:8"]);
  assert.ok(hidden.notified.ids.includes("d:pm:300"), "own item remembered so it never fires later");
  for (const [visibility, permission] of [
    ["visible", "granted"],
    ["hidden", "default"],
    ["hidden", "denied"],
    ["hidden", "unsupported"],
  ] as const) {
    const r = shouldNotify({ candidates: notifyCandidates(), notified: seeded, visibility, permission });
    assert.equal(r.show.length, 0, `${visibility}/${permission}`);
    assert.equal(r.notified.ids.length, 4, "still remembered: no late burst after switching tabs");
  }
});

test("shouldNotify: same id never notifies twice; a newer comment does", () => {
  const first = shouldNotify({
    candidates: notifyCandidates(),
    notified: { v: 1, seeded: true, ids: [] },
    visibility: "hidden",
    permission: "granted",
  });
  const again = shouldNotify({ candidates: notifyCandidates(), notified: first.notified, visibility: "hidden", permission: "granted" });
  assert.equal(again.show.length, 0);
  const newer = recordLatest(
    notifyDoc(),
    [{ issue: 5, source: "pm", id: 102, createdAt: "2026-09-01T10:05:00Z", author: "bob", body: "Otra cosa" }],
    { me: "ana", preview: rowPreview },
  );
  const third = shouldNotify({ candidates: notifyCandidates(newer), notified: again.notified, visibility: "hidden", permission: "granted" });
  assert.deepEqual(third.show.map((c) => [c.id, c.body]), [["c:pm:102", "bob: Otra cosa"]]);
});

test("notified ids: parse is safe, key sits next to the cursor, list is capped", () => {
  assert.deepEqual(parseNotified("{nope"), emptyNotified());
  assert.deepEqual(parseNotified(JSON.stringify({ v: 2, ids: ["x"] })), emptyNotified());
  assert.deepEqual(parseNotified(JSON.stringify({ v: 1, seeded: true, ids: ["a", 3] })), { v: 1, seeded: true, ids: ["a"] });
  const key = cursorStorageKey({ host: "https://qa.door43.org", username: "Ana", pmOrg: "PM" });
  assert.equal(notifiedStorageKey(key), `${key}:avisos`);
  const many = Array.from({ length: 450 }, (_, i) => ({
    id: `t:${i + 1}`,
    issue: i + 1,
    kind: "task" as const,
    own: false,
    title: "x",
    body: "y",
  }));
  const r = shouldNotify({ candidates: many, notified: { v: 1, seeded: true, ids: [] }, visibility: "visible", permission: "granted" });
  assert.equal(r.notified.ids.length, 400);
  assert.equal(r.notified.ids.at(-1), "t:450");
});

console.log(`\n${passed} verify-conversation checks passed.`);
