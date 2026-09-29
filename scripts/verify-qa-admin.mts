/**
 * Self-test for the QA admin menu gates.
 * Run: npx tsx scripts/verify-qa-admin.mts
 */
import {
  canShowQaAdmin,
  defaultOtherTester,
  ghostRefDeleteBlock,
  isProductionHost,
  isWorkRefName,
  planTestScenario,
  recreateTrunkBlock,
  recreateWorkRefBlock,
  testIssueBody,
  testIssueLabelIds,
  testRunTag,
  testScenarioRunBlock,
  usfmVerseText,
  workRefRecreateSource,
  type TestScenarioInput,
  type TrunkRefProbe,
} from "../src/domain/qaAdmin.ts";
import { refFromIssueTitle } from "../src/domain/solverLaunch.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

for (const host of [
  "https://git.door43.org",
  "https://git.door43.org/",
  "git.door43.org",
  "HTTPS://Git.Door43.org/api/v1",
  "https://unfoldingword.door43.org",
]) {
  assert(isProductionHost(host), `production: ${host}`);
}
for (const host of [
  "https://qa.door43.org",
  "http://localhost:3000",
  "http://127.0.0.1",
  "https://develop.door43.org",
  "https://git.door43.org.evil.test",
  "",
]) {
  assert(!isProductionHost(host), `not production: ${host}`);
}

assert(canShowQaAdmin({ host: "https://qa.door43.org", canManage: true, viewMode: "gestor" }), "qa gestor");
assert(!canShowQaAdmin({ host: "https://qa.door43.org", canManage: true, viewMode: "trabajador" }), "qa preview trabajador");
assert(!canShowQaAdmin({ host: "https://qa.door43.org", canManage: false, viewMode: "gestor" }), "qa worker");
assert(!canShowQaAdmin({ host: "https://git.door43.org", canManage: true, viewMode: "gestor" }), "prod gestor");
assert(!canShowQaAdmin({ host: undefined, canManage: true, viewMode: "gestor" }), "no session");

const ctx = { defaultBranch: "master", bookOnlyBranch: "neh" };
const ghostName = "t/neh/6f1e771e-2f2d-4987-b516-6455a751405a";
const ghost: TrunkRefProbe = { name: ghostName, gitRefSha: "abc", branchApi: false, fileApi: false };

assert(ghostRefDeleteBlock(ghost, ctx, ghostName) === null, "ghost deletable with typed name");
assert(ghostRefDeleteBlock(ghost, ctx, "") !== null, "ghost needs typed confirm");
assert(ghostRefDeleteBlock({ ...ghost, branchApi: true }, ctx, ghostName) !== null, "listed branch kept");
assert(ghostRefDeleteBlock({ ...ghost, fileApi: true }, ctx, ghostName) !== null, "file-visible kept");
assert(ghostRefDeleteBlock({ ...ghost, gitRefSha: null }, ctx, ghostName) !== null, "missing ref");
assert(ghostRefDeleteBlock({ ...ghost, name: "master" }, ctx, "master") !== null, "master kept");
const neh = { ...ghost, name: "neh" };
assert(ghostRefDeleteBlock(neh, ctx, "") !== null, "neh needs typed name");
assert(ghostRefDeleteBlock(neh, ctx, "neh") === null, "neh with typed name");

const gone: TrunkRefProbe = { name: ghostName, gitRefSha: null, branchApi: false, fileApi: false };
assert(recreateTrunkBlock(gone, ctx) === null, "recreate after delete");
assert(recreateTrunkBlock(ghost, ctx) !== null, "recreate refused while ghost ref exists");
assert(recreateTrunkBlock({ ...gone, branchApi: true }, ctx) !== null, "recreate refused if listed");
assert(recreateTrunkBlock({ ...gone, name: "neh" }, ctx) !== null, "never create neh");

const workName = "w/neh/6f1e771e-2f2d-4987-b516-6455a751405a/abelper8/1";
const ghostSha = "a".repeat(40);
const trunkSha = "b".repeat(40);
assert(isWorkRefName(workName), "w/ ref recognised");
assert(!isWorkRefName(ghostName) && !isWorkRefName("w/") && !isWorkRefName("master"), "non-work refs");
assert(recreateTrunkBlock({ ...gone, name: workName }, ctx) !== null, "trunk action refuses w/ refs");

const workGhost: TrunkRefProbe = { name: workName, gitRefSha: ghostSha, branchApi: false, fileApi: false };
assert(ghostRefDeleteBlock(workGhost, ctx, workName) === null, "w/ ghost deletable with typed name");
assert(ghostRefDeleteBlock(workGhost, ctx, "w/neh") !== null, "w/ ghost needs exact name");
assert(ghostRefDeleteBlock({ ...workGhost, branchApi: true }, ctx, workName) !== null, "real w/ branch kept");
assert(ghostRefDeleteBlock({ ...workGhost, fileApi: true }, ctx, workName) !== null, "file-visible w/ kept");

const src = workRefRecreateSource({ ghostSha, trunkSha });
assert(src?.origin === "ghost" && src.sha === ghostSha, "ghost SHA wins over trunk");
assert(workRefRecreateSource({ ghostSha: null, trunkSha })?.origin === "trunk", "trunk only without ghost");
assert(workRefRecreateSource({ ghostSha: "abc", trunkSha: null }) === null, "short SHA rejected");

const workGone: TrunkRefProbe = { ...workGhost, gitRefSha: null };
assert(recreateWorkRefBlock(workGone, ctx, ghostSha) === null, "recreate w/ after delete");
assert(recreateWorkRefBlock(workGhost, ctx, ghostSha) !== null, "recreate w/ refused while ref exists");
assert(recreateWorkRefBlock({ ...workGone, branchApi: true }, ctx, ghostSha) !== null, "real w/ untouched");
assert(recreateWorkRefBlock(workGone, ctx, "") !== null, "needs source SHA");
assert(recreateWorkRefBlock({ ...workGone, name: ghostName }, ctx, ghostSha) !== null, "only w/ refs");
assert(recreateWorkRefBlock({ ...workGone, name: "master" }, ctx, ghostSha) !== null, "never master");

const usfm = "\\id NEH\n\\c 1\n\\p\n\\v 1 Estas son las \\add palabras\\add* de Nehemías.\n\\v 2 Otro.\n\\c 2\n\\v 1 Capítulo dos.";
assert(usfmVerseText(usfm, 1, 1) === "Estas son las palabras de Nehemías.", `verse 1:1: ${usfmVerseText(usfm, 1, 1)}`);
assert(usfmVerseText(usfm, 2, 1) === "Capítulo dos.", "verse 2:1");
assert(usfmVerseText(usfm, 1, 9) === null, "missing verse");

// ── Preparar una prueba ──
assert(defaultOtherTester("abelper8") === "abelperez", "abelper8 → abelperez");
assert(defaultOtherTester("ana") === "", "no default for others");
assert(testRunTag(new Date(2026, 8, 26, 0, 7)) === "260926-0007", `run tag: ${testRunTag(new Date(2026, 8, 26, 0, 7))}`);

const taskId = "6f1e771e-2f2d-4987-b516-6455a751405a";
const trunkName = `t/neh/${taskId}`;
const realTrunk: TrunkRefProbe = { name: trunkName, gitRefSha: trunkSha, branchApi: true, fileApi: true };
const base: TestScenarioInput = {
  host: "https://qa.door43.org",
  book: "NEH",
  ref: "1:1–3",
  resourceLabel: "TPL",
  taskId,
  me: "abelper8",
  other: "abelperez",
  runTag: "260926-0007",
  filepath: "16-NEH.usfm",
  ctx,
  trunk: realTrunk,
  defaultHasFile: true,
  ghostHasFile: null,
  nextIssueNumber: 147,
  existingTitles: [],
};

const plan = planTestScenario(base);
assert(plan.block === null, `plan ok: ${plan.block}`);
assert(plan.trunkName === trunkName, "trunk name kept");
assert(plan.trunk?.kind === "reuse" && plan.trunk.sha === trunkSha, "real trunk reused at its SHA");
assert(plan.issues.length === 2, "exactly two issues");
assert(plan.issues[0]!.title === "NEH 1:1–3 · TPL · prueba 260926-0007 · @abelper8", `title 1: ${plan.issues[0]!.title}`);
assert(plan.issues[1]!.title === "NEH 1:1–3 · TPL · prueba 260926-0007 · @abelperez", `title 2: ${plan.issues[1]!.title}`);
assert(refFromIssueTitle(plan.issues[0]!.title) === "1:1–3", "Cerrar still reads the portion from the title");
assert(plan.issues[0]!.assignee === "abelper8" && plan.issues[1]!.assignee === "abelperez", "assignees");
assert(plan.issues[0]!.workRef === `w/neh/${taskId}/abelper8/147`, `work ref 1: ${plan.issues[0]!.workRef}`);
assert(plan.issues[1]!.workRef === `w/neh/${taskId}/abelperez/148`, `work ref 2: ${plan.issues[1]!.workRef}`);
assert(plan.issues.every((row) => isWorkRefName(row.workRef)), "work refs live under w/");
assert(plan.issues[0]!.verseText.includes("versión de abelper8"), "verse text names login 1");
assert(plan.issues[1]!.verseText.includes("versión de abelperez"), "verse text names login 2");
assert(plan.issues[0]!.verseText !== plan.issues[1]!.verseText, "texts differ");
assert(plan.scope?.chapter === 1 && plan.scope.from === 1, "first verse 1:1");
assert(!plan.needsTypedConfirm && testScenarioRunBlock(plan, "") === null, "reuse needs no typed confirm");

const unknownNext = planTestScenario({ ...base, nextIssueNumber: null });
assert(unknownNext.issues[0]!.workRef.endsWith("/abelper8/{nº}"), `unknown number: ${unknownNext.issues[0]!.workRef}`);

for (const host of ["https://git.door43.org", "https://unfoldingword.door43.org"]) {
  const prod = planTestScenario({ ...base, host });
  assert(prod.block?.includes("producción"), `production rejected: ${host}`);
}

const absentTrunk: TrunkRefProbe = { name: trunkName, gitRefSha: null, branchApi: false, fileApi: false };
const missing = planTestScenario({ ...base, trunk: absentTrunk });
assert(missing.block === null && missing.trunk?.kind === "create" && missing.trunk.fromBranch === "master", "missing trunk → POST /branches from master");
assert(planTestScenario({ ...base, trunk: absentTrunk, defaultHasFile: false }).block !== null, "master without the book file");

const ghostTrunk: TrunkRefProbe = { name: trunkName, gitRefSha: ghostSha, branchApi: false, fileApi: false };
const ghostPlan = planTestScenario({ ...base, trunk: ghostTrunk, ghostHasFile: true });
assert(ghostPlan.block === null, `ghost plan: ${ghostPlan.block}`);
assert(ghostPlan.trunk?.kind === "recreate-ghost" && ghostPlan.trunk.sha === ghostSha, "ghost recreated from the SHA it pointed at");
assert(ghostPlan.needsTypedConfirm, "ghost needs typed confirm");
assert(testScenarioRunBlock(ghostPlan, "") !== null, "ghost refused without typed name");
assert(testScenarioRunBlock(ghostPlan, "t/neh") !== null, "ghost refused with wrong name");
assert(testScenarioRunBlock(ghostPlan, trunkName) === null, "ghost allowed with exact name");
assert(planTestScenario({ ...base, trunk: ghostTrunk, ghostHasFile: false }).block !== null, "ghost commit without the file");
assert(planTestScenario({ ...base, trunk: { ...ghostTrunk, gitRefSha: "abc" } }).block !== null, "ghost with short SHA");
assert(planTestScenario({ ...base, trunk: { ...ghostTrunk, name: "neh" } }).block !== null, "book-only ghost untouched");

assert(planTestScenario({ ...base, trunk: { ...realTrunk, fileApi: false } }).block !== null, "trunk without file refused");
assert(planTestScenario({ ...base, trunk: { ...realTrunk, name: "master" } }).block !== null, "never on master");
assert(planTestScenario({ ...base, trunk: { ...realTrunk, name: `w/neh/${taskId}/x/1` } }).block !== null, "never a w/ trunk");
assert(planTestScenario({ ...base, other: "" }).block !== null, "second user required");
assert(planTestScenario({ ...base, other: "AbelPer8" }).block !== null, "second user differs from me");
assert(planTestScenario({ ...base, other: "a b" }).block !== null, "login shape");
assert(planTestScenario({ ...base, taskId: "" }).block !== null, "task id required");
assert(planTestScenario({ ...base, ref: "uno" }).block !== null, "portion must parse");
assert(planTestScenario({ ...base, existingTitles: [plan.issues[1]!.title] }).block !== null, "duplicate title refused");

const sourceBody = [
  "<!-- gt:en-curso -->",
  "## 1:1–3 · TPL",
  "",
  "- Tarea: **Traducir TPL**",
  "- Asignado a: **Abel E. Pérez** (@abelper8)",
  "",
  `<!-- gateway-work-order {"schema":"gateway-work-order-1","key":"NEH|${taskId}|tpl|NEH-01-01","book":"NEH","teamId":"${taskId}"} -->`,
  "",
  `<!-- gateway-task-progress {"schema":"gateway-task-progress-2","done":[]} -->`,
  "",
  `<!-- gateway-portion-pr {"schema":"gateway-portion-pr-1","owner":"o","repo":"r","number":40,"head":"w/x","base":"t/x","issueNumber":1} -->`,
].join("\n");
const cloned = testIssueBody(sourceBody, { keySuffix: "prueba-260926-0007-abelperez", login: "abelperez" });
assert(!cloned.includes("gt:en-curso"), "en-curso marker dropped");
assert(!cloned.includes("gateway-portion-pr"), "source PR link dropped");
assert(!cloned.includes("gateway-task-progress"), "source progress dropped");
assert(cloned.includes("- Asignado a: @abelperez"), "assignee line replaced");
assert(cloned.includes(`"key":"NEH|${taskId}|tpl|NEH-01-01|prueba-260926-0007-abelperez"`), "work-order key suffixed");
assert(cloned.includes(`"teamId":"${taskId}"`), "task id kept");

const labelIds = testIssueLabelIds([
  { id: 1, name: "pm" },
  { id: 2, name: "pm/estado:conflicto" },
  { id: 3, name: "pm/estado:en-curso" },
  { id: 4, name: `pm/tarea:${taskId}` },
]);
assert(labelIds.join(",") === "1,4", `state labels dropped: ${labelIds}`);

console.log("verify-qa-admin: ok");
