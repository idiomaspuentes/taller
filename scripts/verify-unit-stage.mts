/**
 * A unit on its way to be published: it goes to its validation branch when the work before validation ends, the
 * committee's corrections go back as subtareas, and only an endorsed unit reaches the published branch and gets its
 * version. The rules are checked on their own; the path through Door43 is walked against the mock, which this test
 * starts on a port of its own.
 *
 *   npm run verify:unit-stage
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createOrUpdateContents, listReleases, type DcsIssue } from "@ip-lms/dcs-client";
import { readRepoFile } from "../src/dcs/afinacionStore";
import { dcsConfig } from "../src/dcs/config";
import { getBranchSha, getPullByBranches } from "../src/dcs/pulls";
import { releaseUnit } from "../src/dcs/release";
import { eachFew, publishUnit, stageUnit, type UnitResource, type UnitToPublish } from "../src/dcs/unitPublish";
import { setWorkspaceBranchNames } from "../src/domain/branchNames";
import { correctionRows, correctionTitle, portionOfAsk } from "../src/domain/corrections";
import { shippedWorkflows } from "../src/domain/processes";
import type { AssignmentsDoc } from "../src/domain/types";
import { validationBranchName } from "../src/domain/unitPublish";
import { stagingSubtasks, stagingTasks } from "../src/domain/unitStage";
import { applyWorkflowToBoard } from "../src/domain/workflows";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const empty = { projectId: "JUD", book: "JUD", books: ["JUD"], teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const board = applyWorkflowToBoard(empty, shippedWorkflows()[0]!);
const phases = [...board.phases].sort((a, b) => a.order - b.order);

await test("los archivos de una unidad se leen unos pocos a la vez, y quedan en su orden", async () => {
  let running = 0;
  let most = 0;
  const out = await eachFew(
    Array.from({ length: 30 }, (_, i) => i),
    async (n) => {
      most = Math.max(most, ++running);
      await new Promise((done) => setTimeout(done, n % 3));
      running--;
      return n * 2;
    },
    8,
  );
  assert.deepEqual(out, Array.from({ length: 30 }, (_, i) => i * 2));
  assert.equal(most, 8, "ocho a la vez: ni uno por uno, ni todos de golpe");
  assert.deepEqual(await eachFew([], async (n: number) => n), []);
});

await test("la rama de validación se llama por el libro y la unidad, bajo su propia palabra", () => {
  assert.equal(validationBranchName("JUD", { chapter: 1, from: 1, to: 200 }), "validacion/jud/1", "un capítulo entero");
  assert.equal(validationBranchName("JUD", { chapter: 2, from: 1, to: 15 }), "validacion/jud/2-1-15", "un tramo");
  setWorkspaceBranchNames({ validation: "validacao" });
  try {
    assert.equal(validationBranchName("JUD", { chapter: 1, from: 1, to: 200 }), "validacao/jud/1");
  } finally {
    setWorkspaceBranchNames(undefined);
  }
});

const staging = stagingTasks(board);
const validating = staging[0]!;

await test("el proceso dice qué tarea trabaja sobre la unidad en validación, y qué recursos lleva", () => {
  assert.equal(staging.length, 1, "una sola tarea valida");
  assert.ok(validating.resources.includes("tpl") && validating.resources.includes("notas"));
  assert.deepEqual(validating.aligned, ["tpl", "tps"]);
  assert.deepEqual(stagingTasks({ teams: board.teams.filter((task) => task.id !== validating.task.id) }), [], "sin esa tarea, nada se lleva a validación");
});

let n = 0;
const issue = (taskId: string, state: "open" | "closed", chapter = 1): DcsIssue => {
  const task = board.teams.find((row) => row.id === taskId)!;
  const marker = { schema: "gateway-work-order-1", key: `JUD|${taskId}|${chapter}|${n}`, book: "JUD", teamId: taskId, resource: task.rules[0]?.resource ?? "bundle", portionIds: [`JUD-0${chapter}-01`], itemIds: [] };
  return { number: ++n, title: `${task.name} · JUD ${chapter}`, state, labels: [{ name: `pm/cap:${chapter}` }], body: `<!-- gateway-work-order ${JSON.stringify(marker)} -->` } as DcsIssue;
};
const before = board.teams.filter((task) => (board.phases.find((phase) => phase.id === task.phaseId)?.order ?? 0) < (board.phases.find((phase) => phase.id === validating.task.phaseId)?.order ?? 0));
/** The phase the committee waits for (the last one before it), chapter by chapter. */
const lastPhase = phases[phases.findIndex((phase) => phase.id === validating.task.phaseId) - 1]!;
const lastTasks = before.filter((task) => task.phaseId === lastPhase.id);

await test("al cerrar el último trabajo antes de validar, la unidad de ese capítulo pasa a validación; antes, no", () => {
  const work = lastTasks.map((task) => issue(task.id, "open", 1));
  const validate1 = issue(validating.task.id, "open", 1);
  const validate2 = issue(validating.task.id, "open", 2);
  const other = lastTasks.map((task) => issue(task.id, "open", 2));
  const all = [...work, validate1, validate2, ...other];
  assert.deepEqual(stagingSubtasks(board, all, work[0]!), [], "quedan otras subtareas del capítulo abiertas");
  for (const row of work.slice(0, -1)) row.state = "closed";
  const last = work[work.length - 1]!;
  const staged = stagingSubtasks(board, all, last);
  assert.deepEqual(staged.map((row) => row.issue.number), [validate1.number], "solo la del capítulo 1: el 2 sigue en trabajo");
  assert.deepEqual(staged[0]!.resources, validating.resources);
});

await test("una corrección que se cierra mientras se valida renueva la unidad, y otra pendiente del mismo equipo la detiene", () => {
  const work = lastTasks.map((task) => issue(task.id, "closed", 1));
  const validate = issue(validating.task.id, "open", 1);
  const fix = issue(lastTasks[0]!.id, "open", 1);
  const fix2 = issue(lastTasks[0]!.id, "open", 1);
  assert.deepEqual(stagingSubtasks(board, [...work, validate, fix], fix).map((row) => row.issue.number), [validate.number], "cerrada la corrección, el comité la vuelve a ver");
  assert.deepEqual(stagingSubtasks(board, [...work, validate, fix, fix2], fix), [], "con otra corrección abierta todavía no");
});

await test("lo que el comité anota vuelve como subtarea a la tarea que mantiene cada recurso", () => {
  const asks = [
    { about: "tpl", where: "1:3", text: "Dice «siervo» y la nota habla de «esclavo».", by: "pastor1" },
    { about: "notas", where: "1:5", text: "La nota no se entiende.", by: "pastor2" },
    { about: "tpl", where: "", text: "   " },
  ];
  const { settings, added } = correctionRows(board, validating.task, asks, "JUD-01-01");
  assert.equal(added.length, 2, "una por inquietud; la vacía no cuenta");
  const order = new Map(board.phases.map((phase) => [phase.id, phase.order]));
  const phaseOf = (taskId: string) => board.teams.find((task) => task.id === taskId)!.phaseId;
  const [text, help] = added;
  assert.ok(board.teams.find((task) => task.id === text!.taskId)!.rules.some((rule) => rule.resource === "tpl"), "la del texto va a una tarea que trabaja el texto");
  assert.ok(board.teams.find((task) => task.id === help!.taskId)!.rules.some((rule) => rule.resource === "notas"), "la de la nota, a una que trabaja las notas");
  assert.ok(order.get(phaseOf(help!.taskId))! > order.get(phaseOf(text!.taskId))!, "el texto vuelve a quien lo afinó; la ayuda, a quien la armonizó después");
  assert.ok(order.get(phaseOf(help!.taskId))! < order.get(validating.task.phaseId)!, "nunca al propio comité");
  assert.equal(text!.title, "Corrección 1:3: Dice «siervo» y la nota habla de «esclavo».");
  assert.equal(text!.portionId, "JUD-01-01", "se abre sobre el pasaje de la unidad");
  assert.equal(correctionRows({ ...board, settings }, validating.task, asks, "JUD-01-01").added.length, 0, "pedida dos veces, no se duplica");
  assert.ok(correctionTitle({ about: "tpl", text: "x".repeat(400) }).length <= 140, "un título largo se recorta");
});

await test("cada corrección se abre sobre el pasaje de su versículo, no sobre el primero de la unidad", () => {
  const unit = [
    { id: "JUD-01-01", chapter: 1, verses: [1, 2, 3, 4] },
    { id: "JUD-01-03", chapter: 1, verses: [12, 13, 14, 15, 16] },
  ];
  assert.equal(portionOfAsk({ where: "1:12" }, unit), "JUD-01-03");
  assert.equal(portionOfAsk({ where: "1:1 «Judas»" }, unit), "JUD-01-01", "con la frase de la nota detrás");
  assert.equal(portionOfAsk({ where: "1:9" }, unit), undefined, "un versículo que ningún pasaje de la unidad tiene");
  assert.equal(portionOfAsk({ where: "" }, unit), undefined, "sin versículo");
  const asks = [
    { about: "tpl", where: "1:12", text: "«arrecifes ocultos» no se entiende." },
    { about: "tpl", where: "", text: "En general, muy largo." },
  ];
  const { added } = correctionRows(board, validating.task, asks, (ask) => portionOfAsk(ask, unit) ?? "JUD-01-01");
  assert.deepEqual(added.map((row) => row.portionId), ["JUD-01-03", "JUD-01-01"], "la de 1:12, en 1:12–16; la que no dice dónde, en el primero");
});

// ---------------------------------------------------------------- through Door43 (the mock)

const PORT = 8797;
const HOST = `http://localhost:${PORT}`;
const session = { host: HOST, username: "ana", token: "token-ana", scopes: [], scopesVersion: 3 } as never;
const server = spawn(process.execPath, ["scripts/mock-door43/server.mjs"], { env: { ...process.env, MOCK_PORT: String(PORT), MOCK_PM_ORG: "es-419_gl", MOCK_NO_SEED: "1" }, stdio: "ignore" });
const up = async () => {
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${HOST}/api/v1/user`, { headers: { authorization: "token token-ana" } }).then((r) => r.ok, () => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
};

try {
  assert.ok(await up(), "el Door43 simulado no arrancó");
  const config = dcsConfig(HOST);
  const OWNER = "es-419_gl";
  const range = { chapter: 1, from: 1, to: 200 };
  const head = validationBranchName("JUD", range);
  const text = (one: string, two: string) => `\\id JUD\n\\usfm 3.0\n\\h Judas\n\\c 1\n\\p\n\\v 1 ${one}\n\\c 2\n\\p\n\\v 1 ${two}\n`;
  const table = (note: string) => `Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote\n1:1\tab12\t\t\t\t1\t${note}\n`;
  const put = (repo: string, path: string, content: string) => createOrUpdateContents(config, OWNER, repo, path, { content, message: "publicado", branch: "master", token: "token-ana" });
  await put("es-419_glt", "66-JUD.usfm", text("Publicado uno.", "Publicado dos."));
  await put("es-419_tn", "tn_JUD.tsv", table("Nota publicada."));

  const read = (repo: string, branch: string, path: string) => readRepoFile(session, { owner: OWNER, repo, branch }, path);
  /** The unit as the screens load it: what the team has in its draft and what is published now. */
  const unitOf = async (draftText: string, draftNote: string): Promise<UnitToPublish> => {
    const resource = async (name: string, kind: "usfm" | "tsv", repo: string, filepath: string, draft: string | null): Promise<UnitResource> => ({
      resource: name, kind, owner: OWNER, repo, filepath, draft: draft === null ? null : { text: draft, branch: "borrador/jud/x" }, defaultBranch: "master", published: await read(repo, "master", filepath), expectedVerses: [1],
    });
    return {
      book: "JUD", chapter: 1, range,
      resources: [await resource("tpl", "usfm", "es-419_glt", "66-JUD.usfm", draftText), await resource("notas", "tsv", "es-419_tn", "tn_JUD.tsv", draftNote), await resource("preguntas", "tsv", "es-419_tq", "tq_JUD.tsv", null)],
      store: { owner: OWNER, repo: "es-419_glt" }, levelBook: {} as never, board: null, task: null, step: null,
    };
  };
  const master = async () => [(await read("es-419_glt", "master", "66-JUD.usfm"))!.text, (await read("es-419_tn", "master", "tn_JUD.tsv"))!.text];
  const publishedBefore = await master();

  await test("llevar la unidad a validación crea su rama y deja la solicitud abierta, sin tocar lo publicado", async () => {
    const outcomes = await stageUnit({ session, unit: await unitOf(text("Del equipo uno.", "Del equipo dos, a medias."), table("Nota del equipo.")), note: "#1" });
    assert.deepEqual(outcomes.map((row) => [row.resource, row.status]), [["tpl", "staged"], ["notas", "staged"], ["preguntas", "nothing"]]);
    assert.deepEqual(await master(), publishedBefore, "lo publicado sigue igual");
    const staged = (await read("es-419_glt", head, "66-JUD.usfm"))!.text;
    assert.ok(staged.includes("Del equipo uno.") && staged.includes("Publicado dos.") && !staged.includes("a medias"), "lleva el capítulo 1 del equipo y nada del 2, que sigue en trabajo");
    assert.ok((await read("es-419_tn", head, "tn_JUD.tsv"))!.text.includes("Nota del equipo."));
    const pull = await getPullByBranches(config, OWNER, "es-419_glt", "master", head, "token-ana");
    assert.ok(pull && pull.state === "open" && !pull.merged, "la solicitud queda abierta, sin fusionar");
  });

  await test("una corrección después de validar renueva la misma rama y la misma solicitud", async () => {
    const first = await getPullByBranches(config, OWNER, "es-419_glt", "master", head, "token-ana");
    const outcomes = await stageUnit({ session, unit: await unitOf(text("Del equipo uno, corregido.", "Del equipo dos, a medias."), table("Nota del equipo.")), note: "#1" });
    assert.equal(outcomes[0]!.status, "staged");
    assert.ok((await read("es-419_glt", head, "66-JUD.usfm"))!.text.includes("corregido"), "el comité ve la corrección");
    const again = await getPullByBranches(config, OWNER, "es-419_glt", "master", head, "token-ana");
    assert.equal(again?.number, first?.number, "sin abrir otra solicitud");
    assert.deepEqual(await master(), publishedBefore, "y lo publicado sigue igual");
  });

  await test("publicar fusiona lo avalado en lo publicado, quita la rama de validación y crea la versión de la unidad", async () => {
    const unit = await unitOf(text("Del equipo uno, corregido.", "Del equipo dos, a medias."), table("Nota del equipo."));
    const outcomes = await publishUnit({ session, unit, note: "#2" });
    assert.deepEqual(outcomes.map((row) => [row.resource, row.status]), [["tpl", "published"], ["notas", "published"], ["preguntas", "nothing"]]);
    const [textNow, notesNow] = await master();
    assert.ok(textNow!.includes("Del equipo uno, corregido.") && textNow!.includes("Publicado dos."), "el capítulo 1 avalado, y el 2 como estaba");
    assert.ok(notesNow!.includes("Nota del equipo."));
    assert.equal(await getBranchSha(config, OWNER, "es-419_glt", head, "token-ana"), null, "la rama de validación ya no hace falta");

    const now = new Date(2026, 9, 4);
    const released = await releaseUnit({ session, owner: OWNER, repos: ["es-419_glt", "es-419_tn"], versionName: "Versión validada", unitName: "JUD 1", fresh: true, now });
    assert.deepEqual(released.created.sort(), ["es-419_glt", "es-419_tn"]);
    assert.equal(released.identity.tag, "version-validada-jud-1-2026-10-04");
    const releases = await listReleases(config, OWNER, "es-419_glt", { token: "token-ana" });
    assert.deepEqual(releases.map((row) => row.tag_name), [released.identity.tag], "una versión, cortada de lo publicado");

    const retry = await releaseUnit({ session, owner: OWNER, repos: ["es-419_glt", "es-419_tn"], versionName: "Versión validada", unitName: "JUD 1", fresh: false, now });
    assert.deepEqual([retry.created, retry.identity.tag], [[], released.identity.tag], "reintentar sin nada nuevo no crea otra versión");
    const later = await releaseUnit({ session, owner: OWNER, repos: ["es-419_glt", "es-419_tn"], versionName: "Versión validada", unitName: "JUD 1", fresh: true, now });
    assert.equal(later.identity.tag, `${released.identity.tag}-2`, "publicar algo nuevo el mismo día es la versión siguiente");
  });

  await test("una unidad ya publicada no vuelve a abrir solicitud", async () => {
    const outcomes = await stageUnit({ session, unit: await unitOf(text("Del equipo uno, corregido.", "Del equipo dos, a medias."), table("Nota del equipo.")), note: "#3" });
    assert.deepEqual(outcomes.map((row) => row.status), ["unchanged", "unchanged", "nothing"]);
    assert.equal(await getBranchSha(config, OWNER, "es-419_glt", head, "token-ana"), null);
  });
} finally {
  server.kill();
}

console.log(`\nverify-unit-stage: ${passed} checks passed.`);
