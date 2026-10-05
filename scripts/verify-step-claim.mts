/**
 * Self-test for step claim + progress v2.
 * Run: npx tsx scripts/verify-step-claim.mts
 */
import {
  canApproveStep,
  canClaimStep,
  claimStep,
  approveStep,
  askForChanges,
  canAskForChanges,
  canTakeBack,
  changesPending,
  takeBack,
  takenBackByAuthor,
  reviewedStepId,
  isStepComplete,
  isStepUnlocked,
  stepClaimMode,
  formatStepClaimLabel,
  formatTaskClaimSummary,
} from "../src/domain/stepClaim.ts";
import {
  parseTaskProgressMarker,
  encodeTaskProgressMarker,
  emptyTaskProgress,
  upsertTaskProgressInBody,
} from "../src/domain/taskProgress.ts";
import { normalizeTaskSteps } from "../src/domain/store.ts";
import type { TaskStep } from "../src/domain/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const draft: TaskStep = { id: "draft", name: "Borrador", claimMode: "none" };
const pair: TaskStep = {
  id: "pair",
  name: "Pares",
  claimMode: "exclusive",
  includeAuthorInApproval: true,
  excludePriorStepIds: ["draft"],
};
const group: TaskStep = {
  id: "group",
  name: "Grupal",
  claimMode: "pool",
  minAssignees: 2,
  maxAssignees: 2,
  excludePriorStepIds: ["draft", "pair"],
};
const steps = [draft, pair, group];

// normalize
const normalized = normalizeTaskSteps([
  { id: "pair", name: "Pares", claimMode: "exclusive", includeAuthorInApproval: true },
  { id: "group", name: "G", claimMode: "pool" },
]);
assert(normalized[0].claimMode === "exclusive", "normalize exclusive");
assert(normalized[0].includeAuthorInApproval === true, "normalize author flag");
assert(normalized[1].claimMode === "pool", "normalize pool");
assert(normalized[1].minAssignees === 2 && normalized[1].maxAssignees === 2, "pool defaults");

// v1 parse → v2 shape
const v1Body = `hello\n\n<!-- gateway-task-progress ${JSON.stringify({
  schema: "gateway-task-progress-1",
  doneStepIds: ["draft"],
})} -->\n`;
const parsed = parseTaskProgressMarker(v1Body);
assert(parsed.doneStepIds.includes("draft"), "v1 doneStepIds");
assert(parsed.schema === "gateway-task-progress-2" || parsed.doneStepIds.length === 1, "parsed");

let progress = emptyTaskProgress();
progress = {
  ...progress,
  doneStepIds: ["draft"],
  steps: { draft: { assignees: ["alice"], approvals: [] } },
};

assert(isStepUnlocked(steps, progress, "pair"), "pair unlocked after draft");
assert(!isStepUnlocked(steps, progress, "group"), "group still locked");
assert(canClaimStep("bob", steps, progress, pair), "bob can claim pair");
assert(!canClaimStep("alice", steps, progress, pair), "drafter excluded from pair");

const pairExcludeAssignee: TaskStep = {
  ...pair,
  excludePriorStepIds: undefined,
  excludeIssueAssignee: true,
};
assert(
  !canClaimStep("alice", steps, progress, pairExcludeAssignee, undefined, "alice"),
  "issue assignee excluded by flag",
);
assert(
  canClaimStep("bob", steps, progress, pairExcludeAssignee, undefined, "alice"),
  "non-assignee can claim with flag",
);

progress = claimStep(progress, pair, "bob");
assert(!canClaimStep("carol", steps, progress, pair), "exclusive hidden after claim");
assert(stepClaimMode(pair) === "exclusive", "mode");

assert(canApproveStep("bob", progress, pair), "claimer can approve");
assert(canApproveStep("alice", progress, pair), "author can approve");
assert(!canApproveStep("carol", progress, pair), "outsider cannot approve");

progress = approveStep(progress, pair, "bob");
assert(!isStepComplete(progress, pair), "need author too");
progress = approveStep(progress, pair, "alice");
assert(isStepComplete(progress, pair), "pair complete");
assert(progress.doneStepIds.includes("pair"), "pair in doneStepIds");

assert(isStepUnlocked(steps, progress, "group"), "group unlocked");
assert(canClaimStep("carol", steps, progress, group), "carol can claim group");
assert(!canClaimStep("alice", steps, progress, group), "drafter excluded from group");
assert(!canClaimStep("bob", steps, progress, group), "pair reviewer excluded");

progress = claimStep(progress, group, "carol");
assert(canClaimStep("dave", steps, progress, group), "pool still open for dave");
progress = claimStep(progress, group, "dave");
assert(!canClaimStep("erin", steps, progress, group), "pool full at max 2");

progress = approveStep(progress, group, "carol");
assert(!isStepComplete(progress, group), "need min 2 approvals");
progress = approveStep(progress, group, "dave");
assert(isStepComplete(progress, group), "group complete");
assert(progress.doneStepIds.includes("group"), "group done");

const encoded = encodeTaskProgressMarker(progress);
const roundTrip = parseTaskProgressMarker(upsertTaskProgressInBody("body", progress));
assert(roundTrip.doneStepIds.includes("group"), "round-trip done");
assert(roundTrip.steps?.pair?.assignees.includes("bob"), "round-trip seating");
assert(encoded.includes("gateway-task-progress-2"), "encode v2 schema");

assert(formatStepClaimLabel(draft) === null, "none has no claim label");
assert(formatStepClaimLabel(pair) === "Pares", "exclusive+author → Pares");
assert(formatStepClaimLabel({ id: "e", name: "E", claimMode: "exclusive" }) === "Uno", "exclusive → Uno");
assert(formatStepClaimLabel(group) === "Grupal", "pool 2 → Grupal");
assert(
  formatStepClaimLabel({ id: "p", name: "P", claimMode: "pool", minAssignees: 3 }) === "Varios 3",
  "pool 3 → Varios 3",
);
assert(formatTaskClaimSummary(steps) === "Pares · Grupal", "task mix Pares · Grupal");
assert(
  formatTaskClaimSummary([
    draft,
    { id: "e", name: "E", claimMode: "exclusive" },
    { id: "p", name: "P", claimMode: "pool", minAssignees: 3 },
  ]) === "Uno · Varios 3",
  "task mix Uno · Varios 3",
);

// Asking for changes: the draft goes back to its author, the approvals no longer count, the reviewer keeps the seat.
{
  const done = (ids: string[], seats: Record<string, { assignees: string[]; approvals: string[] }>) => ({ ...parseTaskProgressMarker(""), doneStepIds: ids, steps: seats });
  const reviewing = done(["draft"], { pair: { assignees: ["bob"], approvals: ["alice"] } });
  assert(reviewedStepId(steps, pair) === "draft" && reviewedStepId(steps, group) === "draft", "a review looks at the draft");
  assert(canAskForChanges("bob", steps, reviewing, pair), "the seated reviewer may ask for changes");
  assert(!canAskForChanges("carol", steps, reviewing, pair), "somebody who did not take the review may not");
  assert(!canAskForChanges("bob", steps, done([], { pair: { assignees: ["bob"], approvals: [] } }), pair), "nothing to send back before the draft is handed in");
  const back = askForChanges(reviewing, steps, pair, "bob");
  assert(!back.doneStepIds.includes("draft"), "the draft is open again");
  assert(back.steps?.pair?.assignees.includes("bob") && back.steps.pair.approvals.length === 0, "seat kept, approvals dropped");
  assert(!isStepUnlocked(steps, back, "pair") && changesPending(steps, back, pair), "the review waits for the draft");
  assert(askForChanges(reviewing, steps, pair, "carol") === reviewing, "asking without a seat changes nothing");
  const again = { ...back, doneStepIds: [...back.doneStepIds, "draft"] };
  assert(!changesPending(steps, again, pair) && canApproveStep("bob", again, pair, "alice"), "handed in again, the same reviewer approves");
  // The author takes the draft back to correct it: what a reviewer's request does, by the author's own hand.
  assert(canTakeBack("alice", steps, reviewing, pair, "alice"), "the author may take the draft back while its review is open");
  assert(!canTakeBack("bob", steps, reviewing, pair, "alice"), "nobody but the author takes it back");
  assert(!canTakeBack("alice", steps, done(["draft", "pair"], { pair: { assignees: ["bob"], approvals: ["bob", "alice"] } }), pair, "alice"), "not once the review is finished");
  assert(!canTakeBack("alice", steps, done([], { pair: { assignees: ["bob"], approvals: [] } }), pair, "alice"), "a draft not handed in is already the author's");
  const taken = takeBack(reviewing, steps, pair, "alice", "alice");
  assert(!taken.doneStepIds.includes("draft") && taken.steps?.pair?.assignees.includes("bob") && taken.steps.pair.approvals.length === 0, "draft open again, seat kept, approvals dropped");
  assert(changesPending(steps, taken, pair) && takenBackByAuthor(steps, taken, pair, "alice"), "the review waits, and it is the author who took it");
  assert(!takenBackByAuthor(steps, back, pair, "alice"), "sent back by a reviewer is not taken back by the author");
  assert(takeBack(reviewing, steps, pair, "bob", "alice") === reviewing, "taking back without being the author changes nothing");
  assert(parseTaskProgressMarker(encodeTaskProgressMarker(taken)).steps?.pair?.returnedBy === "alice", "who sent the work back is kept with the subtarea");
  const takenAgain = { ...taken, doneStepIds: [...taken.doneStepIds, "draft"] };
  assert(!takenBackByAuthor(steps, takenAgain, pair, "alice") && canApproveStep("bob", takenAgain, pair, "alice"), "handed in again, the review goes on");
  // A review somebody sat on before anybody took the work (an exclusive step nobody claimed): nothing was sent back.
  const early = [{ id: "do", name: "Do", claimMode: "exclusive" }, { id: "check", name: "Check", claimMode: "pool", minAssignees: 2, excludePriorStepIds: ["do"] }] as TaskStep[];
  assert(!changesPending(early, done([], { check: { assignees: ["bob"], approvals: [] } }), early[1]!), "sitting early on a review is not a request for changes");
  assert(changesPending(early, done([], { do: { assignees: ["alice"], approvals: [] }, check: { assignees: ["bob"], approvals: [] } }), early[1]!), "with an author, an undone step under a seated review is work sent back");
  // From the group review the draft goes back too, and the pair review already done stays done.
  const inGroup = done(["draft", "pair"], { pair: { assignees: ["bob"], approvals: ["bob", "alice"] }, group: { assignees: ["carol", "dave"], approvals: ["dave"] } });
  const fromGroup = askForChanges(inGroup, steps, group, "carol");
  assert(!fromGroup.doneStepIds.includes("draft") && fromGroup.doneStepIds.includes("pair") && fromGroup.steps?.group?.approvals.length === 0, "group review sends the draft back");
}

console.log("verify-step-claim: ok");
