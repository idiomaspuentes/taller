/**
 * Which version of its sources a step was done against: the files it is done against, how a noted version is said,
 * and which of them are no longer what Door43 has.
 */
import assert from "node:assert/strict";
import { DEFAULT_SOURCE_PACKAGE } from "../src/domain/sourcePackage";
import { changedKinds, changedSources, sourceFilesFor, sourceKindsFor, stampKey, stampVersion, versionsByKind, type SourceStamp } from "../src/domain/sourceVersions";
import { emptyTaskProgress, encodeTaskProgressMarker, markStepDone, parseTaskProgressMarker, stampDoneSteps, withStepRuntime, withStepSources } from "../src/domain/taskProgress";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const pkg = DEFAULT_SOURCE_PACKAGE;
const paths = (files: ReturnType<typeof sourceFilesFor>) => files.map((file) => `${file.kind}:${file.owner}/${file.repo}/${file.path}${file.folder ? "/" : ""}`);

test("cada trabajo se hace contra lo que traduce, salvo que su herramienta diga otra cosa", () => {
  assert.deepEqual(sourceKindsFor("tpl"), ["ult"]);
  assert.deepEqual(sourceKindsFor("TPS"), ["ust"]);
  assert.deepEqual(sourceKindsFor("notas"), ["tn"]);
  assert.deepEqual(sourceKindsFor("palabras"), ["tw"]);
  assert.deepEqual(sourceKindsFor("otra-cosa"), []);
  // A tool that reads more says so in its process: refining a text is done on the original, with its notes and terms.
  assert.deepEqual(sourceKindsFor("tpl", ["original", "tn", "twl"]), ["original", "tn", "twl"]);
  assert.deepEqual(sourceKindsFor("tpl", ["no-existe"]), ["ult"], "lo que no es una fuente no cuenta");
});

test("un pasaje se hace contra el archivo de su libro; un artículo, contra ese artículo", () => {
  assert.deepEqual(paths(sourceFilesFor({ kinds: ["ult", "ust", "tn", "tq", "twl"], pkg, book: "jud" })), [
    "ult:unfoldingWord/en_ult/66-JUD.usfm",
    "ust:unfoldingWord/en_ust/66-JUD.usfm",
    "tn:unfoldingWord/en_tn/tn_JUD.tsv",
    "tq:unfoldingWord/en_tq/tq_JUD.tsv",
    "twl:unfoldingWord/en_twl/twl_JUD.tsv",
  ]);
  assert.deepEqual(paths(sourceFilesFor({ kinds: ["original"], pkg, book: "JUD" })), ["original:unfoldingWord/el-x-koine_ugnt/66-JUD.usfm"]);
  assert.deepEqual(paths(sourceFilesFor({ kinds: ["original"], pkg, book: "EST" })), ["original:unfoldingWord/hbo_uhb/17-EST.usfm"]);
  assert.deepEqual(paths(sourceFilesFor({ kinds: ["tw"], pkg, book: "JUD", articles: ["bible/kt/altar", "/bible/other/servant.md"] })), ["tw:unfoldingWord/en_tw/bible/kt/altar.md", "tw:unfoldingWord/en_tw/bible/other/servant.md"]);
  // An article of the Academy is a folder of three files: all of them are its source.
  assert.deepEqual(paths(sourceFilesFor({ kinds: ["ta"], pkg, articles: ["translate/figs-idiom"] })), ["ta:unfoldingWord/en_ta/translate/figs-idiom/"]);
  assert.deepEqual(sourceFilesFor({ kinds: ["ult", "tw"], pkg }), [], "sin libro ni artículos no hay contra qué");
});

const stamp = (over: Partial<SourceStamp>): SourceStamp => ({ kind: "ult", repo: "unfoldingWord/en_ult", path: "66-JUD.usfm", sha: "923d5888e5aa", release: "v91", released: true, ...over });

test("una versión se dice como la dice una persona", () => {
  assert.equal(stampVersion(stamp({})), "v91");
  assert.equal(stampVersion(stamp({ released: false })), "v91+", "el archivo ya había cambiado después de esa versión");
  assert.equal(stampVersion(stamp({ release: undefined, released: undefined })), "923d588", "un recurso sin versiones se dice por su huella");
  const notes = stamp({ kind: "tn", repo: "unfoldingWord/en_tn", path: "tn_JUD.tsv", sha: "f5924aaa" });
  assert.deepEqual(versionsByKind([stamp({}), notes]), [{ kind: "ult", version: "v91" }, { kind: "tn", version: "v91" }]);
  // The three files of one article, or several articles of one kind, are said once when they agree.
  const article = (path: string, over: Partial<SourceStamp> = {}) => stamp({ kind: "ta", repo: "unfoldingWord/en_ta", path, ...over });
  assert.deepEqual(versionsByKind([article("translate/figs-idiom/01.md"), article("translate/figs-idiom/title.md")]), [{ kind: "ta", version: "v91" }]);
  assert.deepEqual(versionsByKind([article("a/01.md"), article("b/01.md", { released: false })]), [{ kind: "ta", version: "v91, v91+" }]);
});

test("una fuente cambió cuando su huella de hoy es otra; lo que no se pudo preguntar no se da por cambiado", () => {
  const notes = stamp({ kind: "tn", repo: "unfoldingWord/en_tn", path: "tn_JUD.tsv", sha: "f5924aaa" });
  const noted = [stamp({}), notes];
  assert.equal(stampKey(stamp({})), "unfoldingword/en_ult/66-jud.usfm");
  assert.deepEqual(changedSources(noted, { [stampKey(stamp({}))]: "923d5888e5aa", [stampKey(notes)]: "f5924aaa" }), []);
  assert.deepEqual(changedSources(noted, { [stampKey(stamp({}))]: "923d5888e5aa", [stampKey(notes)]: "0000beef" }).map((s) => s.kind), ["tn"]);
  assert.deepEqual(changedSources(noted, { [stampKey(notes)]: "f5924aaa" }), [], "sin red para una de ellas");
  assert.deepEqual(changedSources(noted, {}), []);
  assert.deepEqual(changedKinds([stamp({ path: "a" }), stamp({ path: "b" }), notes], { "unfoldingword/en_ult/a": "x", "unfoldingword/en_ult/b": "y", [stampKey(notes)]: "z" }), ["ult", "tn"]);
});

test("al guardar el avance, el paso que se cierra dice quién, cuándo y con qué; el que vuelve a su autor lo olvida", () => {
  const empty = emptyTaskProgress();
  const drafted = markStepDone(withStepRuntime(empty, "pares", { assignees: ["bea"], approvals: [] }), "borrador");
  const first = stampDoneSteps(empty, drafted, "ana", "2026-10-06T10:00:00Z");
  assert.deepEqual(first.closed, ["borrador"]);
  assert.deepEqual(first.marker.steps?.borrador?.done, { by: "ana", at: "2026-10-06T10:00:00Z" });
  assert.equal(first.marker.steps?.pares?.done, undefined, "solo el que se cerró");
  // Its sources are noted on it, and all of it survives being written to the subtarea and read back.
  const noted = withStepSources(first.marker, "borrador", [stamp({}), stamp({ kind: "tn", repo: "unfoldingWord/en_tn", path: "tn_JUD.tsv", sha: "f5924aaa", released: false })]);
  const read = parseTaskProgressMarker(encodeTaskProgressMarker(noted));
  assert.deepEqual(read.steps?.borrador, { assignees: [], approvals: [], done: { by: "ana", at: "2026-10-06T10:00:00Z" }, sources: noted.steps!.borrador!.sources });
  assert.deepEqual(versionsByKind(read.steps!.borrador!.sources!), [{ kind: "ult", version: "v91" }, { kind: "tn", version: "v91+" }]);
  // Somebody taking a seat on a step later does not touch when it was closed or against what.
  const seated = withStepRuntime(read, "borrador", { assignees: ["ana"], approvals: [] });
  assert.deepEqual(seated.steps?.borrador?.done, { by: "ana", at: "2026-10-06T10:00:00Z" });
  assert.equal(seated.steps?.borrador?.sources?.length, 2);
  // Saving again without closing anything changes nothing; a second step closed later is stamped with its own day.
  assert.deepEqual(stampDoneSteps(read, read, "bea", "2026-10-07T09:00:00Z"), { marker: read, closed: [] });
  const reviewed = stampDoneSteps(read, markStepDone(read, "pares"), "bea", "2026-10-07T09:00:00Z");
  assert.deepEqual([reviewed.marker.steps?.pares?.done?.by, reviewed.marker.steps?.borrador?.done?.by], ["bea", "ana"]);
  // The draft goes back to its author: it is not closed any more, and what it was done against is no longer true of it.
  const back = stampDoneSteps(reviewed.marker, { ...reviewed.marker, doneStepIds: [] }, "bea", "2026-10-08T09:00:00Z");
  assert.equal(back.marker.steps?.borrador?.done, undefined);
  assert.equal(back.marker.steps?.borrador?.sources, undefined);
  assert.deepEqual(parseTaskProgressMarker(encodeTaskProgressMarker(back.marker)).steps?.pares, { assignees: ["bea"], approvals: [] });
  // What is badly formed in a subtarea is not kept.
  assert.equal(parseTaskProgressMarker('<!-- gateway-task-progress {"doneStepIds":["a"],"steps":{"a":{"done":{"by":"x"},"sources":[{"kind":"ult"}]}}} -->').steps?.a?.done, undefined);
});

console.log(`\nverify-source-versions: ${passed} checks passed.`);
