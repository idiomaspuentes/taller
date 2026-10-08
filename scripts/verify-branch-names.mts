/**
 * The branches the app keeps in a content repository: each kind under its own readable word, the words taken from
 * the configuration, and a group draft only for the task that translates a resource.
 *
 *   npm run verify:branch-names
 */
import assert from "node:assert/strict";
import { tallerConfig } from "../taller.config";
import { configProblems } from "../src/config";
import type { TallerConfig } from "../src/config/types";
import {
  DEFAULT_BRANCH_NAMES,
  branchNameProblems,
  branchNames,
  draftReadOrder,
  draftTaskId,
  mergeBranchNames,
  setWorkspaceBranchNames,
  taskHasOwnDraft,
} from "../src/domain/branchNames";
import {
  archiveRefName,
  bookBranchName,
  bookCodeFromWorkHead,
  bookTrunkFromWorkHead,
  draftReadBranchNames,
  groupDraftBranchNames,
  isArchiveRefName,
  isGitRefDescendant,
  ownedWorkBranchNames,
  portionPrBranchName,
  readIsOwnWork,
  workUserFromHead,
} from "../src/domain/portionPr";
import { isWorkRefName } from "../src/domain/qaAdmin";
import { shippedWorkflows } from "../src/domain/processes";
import type { AssignmentsDoc } from "../src/domain/types";
import { applyWorkflowToBoard } from "../src/domain/workflows";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const work = { book: "JUD", username: "Valeska", taskId: "tpl", issueNumber: 160 };

test("cada rama dice qué es: borrador, trabajo y archivo, sin letras sueltas", () => {
  setWorkspaceBranchNames(undefined);
  assert.deepEqual(branchNames(), DEFAULT_BRANCH_NAMES);
  assert.equal(bookBranchName("JUD", "tpl"), "borrador/jud/tpl");
  assert.equal(portionPrBranchName(work), "trabajo/jud/tpl/valeska/160");
  assert.equal(archiveRefName("JUD", 160), "archivo/jud/160");
  for (const name of [bookBranchName("JUD", "tpl"), portionPrBranchName(work), archiveRefName("JUD", 160)]) {
    assert.ok(name.split("/").every((part) => part.length > 1), `«${name}» no tiene partes de una letra`);
  }
});

test("ninguna rama puede estorbar a otra: cada clase vive bajo su propia palabra", () => {
  const names = [bookBranchName("JUD", "tpl"), bookBranchName("JUD", "tps"), portionPrBranchName(work), archiveRefName("JUD", 160)];
  for (const a of names) for (const b of names) assert.ok(!isGitRefDescendant(a, b), `«${a}» no cuelga de «${b}»`);
  // What older books left behind (a branch `jud`, `jud/tpl`, `t/jud/tpl`) is never in the way either.
  for (const old of ["jud", "jud/tpl", "t/jud/tpl", "book/jud", "w/jud/tpl/valeska/160"]) {
    for (const name of names) assert.ok(!isGitRefDescendant(name, old) && !isGitRefDescendant(old, name), `«${name}» y «${old}» no chocan`);
  }
});

test("los nombres antiguos se siguen leyendo, y el de hoy va primero", () => {
  assert.deepEqual(groupDraftBranchNames("JUD", "tpl"), ["borrador/jud/tpl", "jud/tpl", "t/jud/tpl"]);
  assert.deepEqual(ownedWorkBranchNames(work).slice(0, 2), ["trabajo/jud/tpl/valeska/160", "w/jud/tpl/valeska/160"]);
  for (const head of ["trabajo/jud/tpl/valeska/160", "w/jud/tpl/valeska/160"]) {
    assert.equal(bookCodeFromWorkHead(head), "jud");
    assert.equal(workUserFromHead(head), "valeska");
    assert.ok(isWorkRefName(head), `«${head}» es una rama de trabajo`);
  }
  assert.equal(bookTrunkFromWorkHead("trabajo/jud/tpl/valeska/160"), "borrador/jud/tpl", "una rama de trabajo de hoy salió del borrador de hoy");
  assert.equal(bookTrunkFromWorkHead("w/jud/tpl/valeska/160"), "jud/tpl", "y una antigua, del tronco antiguo");
  assert.ok(!isWorkRefName("borrador/jud/tpl") && !isWorkRefName("archivo/jud/160") && !isWorkRefName("master"));
});

test("el texto de una subtarea se busca primero en su rama, luego en el borrador del grupo, y lo publicado al final", () => {
  // A subtarea opened for the first time has no branch of its own: what is shown is the group's draft, which is
  // what that branch is cut from. With nothing remembered on the device, the published book came second.
  const fresh = draftReadBranchNames(work);
  assert.equal(fresh[0], "trabajo/jud/tpl/valeska/160");
  assert.equal(fresh.indexOf(undefined), fresh.length - 1, "lo publicado (la rama por defecto) solo al final");
  assert.ok(fresh.indexOf("borrador/jud/tpl") < fresh.indexOf(undefined) && fresh.indexOf("jud/tpl") < fresh.indexOf(undefined));
  assert.deepEqual(fresh.filter((name) => name === undefined).length, 1);
  // The branch this device remembered goes right after the person's own, as before.
  const remembered = draftReadBranchNames({ ...work, remembered: "w/jud/tpl/valeska/160" });
  assert.deepEqual(remembered.slice(0, 2), ["trabajo/jud/tpl/valeska/160", "w/jud/tpl/valeska/160"]);
  assert.equal(remembered.indexOf(undefined), remembered.length - 1);
  assert.equal(draftReadBranchNames({ ...work, remembered: "  " }).indexOf(undefined), fresh.length - 1, "un nombre vacío no es la rama por defecto");
});

test("lo que el editor leyó primero se conserva solo si era la rama de la persona", () => {
  // The group's draft answers after the first read. Kept over it, a text read from the draft a moment before was
  // saved with the hash of the new one: over the person's branch, without the chunk marks just put in the draft.
  for (const own of ["trabajo/jud/tpl/valeska/160", "w/jud/tpl/valeska/160"]) assert.ok(readIsOwnWork(own, work), `«${own}» es su trabajo`);
  for (const other of ["borrador/jud/tpl", "jud/tpl", "t/jud/tpl", "jud", "master", "trabajo/jud/tpl/elisha/160", "trabajo/jud/tpl/valeska/161", "", undefined]) {
    assert.ok(!readIsOwnWork(other, work), `«${other}» no es su trabajo`);
  }
});

test("un espacio de trabajo puede dar sus propias palabras, y lo que calla es de la organización", () => {
  const organization = { draft: "esbozo" };
  assert.deepEqual(mergeBranchNames(organization), { ...DEFAULT_BRANCH_NAMES, draft: "esbozo" });
  assert.deepEqual(mergeBranchNames(organization, { draft: "rascunho", work: "trabalho" }), { ...DEFAULT_BRANCH_NAMES, draft: "rascunho", work: "trabalho" });
  setWorkspaceBranchNames({ draft: "rascunho", work: "trabalho", archive: "arquivo" });
  try {
    assert.equal(bookBranchName("JUD", "tpl"), "rascunho/jud/tpl");
    assert.equal(portionPrBranchName(work), "trabalho/jud/tpl/valeska/160");
    assert.equal(archiveRefName("JUD", 160), "arquivo/jud/160");
    assert.equal(bookTrunkFromWorkHead("trabalho/jud/tpl/valeska/160"), "rascunho/jud/tpl");
    assert.ok(isArchiveRefName("arquivo/jud/160"), "la guarda del archivo sigue a la palabra configurada");
    assert.ok(!isArchiveRefName("archivo/jud/160") && !isArchiveRefName("rascunho/jud/160"), "y no deja pasar otra");
    assert.ok(isWorkRefName("trabalho/jud/tpl/valeska/160") && isWorkRefName("w/jud/tpl/valeska/160") && !isWorkRefName("trabajo/jud/tpl/valeska/160"));
  } finally {
    setWorkspaceBranchNames(undefined);
  }
});

test("unas palabras que no sirven se dicen antes de arrancar", () => {
  const ok = mergeBranchNames();
  assert.deepEqual(branchNameProblems(ok), []);
  assert.match(branchNameProblems({ ...ok, draft: "Borrador" }).join(" "), /branchNames\.draft .*minúsculas/);
  assert.match(branchNameProblems({ ...ok, work: "mi/trabajo" }).join(" "), /branchNames\.work .*sin barras/);
  assert.match(branchNameProblems({ ...ok, phase: "archivo" }).join(" "), /son iguales/);
  assert.match(branchNameProblems({ ...ok, work: "w" }).join(" "), /ramas antiguas/, "una palabra de las antiguas confundiría lo viejo con lo nuevo");
  assert.throws(() => setWorkspaceBranchNames({ draft: "con espacio" }), /branchNames\.draft/);
  setWorkspaceBranchNames(undefined);

  const config = JSON.parse(JSON.stringify(tallerConfig)) as TallerConfig;
  assert.deepEqual(configProblems(config), []);
  config.workspaces[1]!.branchNames = { draft: "trabajo" };
  assert.match(configProblems(config).join(" "), new RegExp(`Espacio "${config.workspaces[1]!.id}": .*son iguales`), "también lo de un solo espacio");
  config.workspaces[1]!.branchNames = { draft: "rascunho", work: "trabalho" };
  assert.deepEqual(configProblems(config), []);
});

const empty = { projectId: "JUD", book: "JUD", books: ["JUD"], teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;

test("solo la tarea que traduce un recurso tiene borrador propio; las demás trabajan sobre ese", () => {
  const workflows = shippedWorkflows();
  assert.ok(workflows.length > 0, "hay al menos una plantilla");
  for (const workflow of workflows) {
    const board = applyWorkflowToBoard(empty, workflow);
    const firstPhase = [...board.phases].sort((a, b) => a.order - b.order)[0]!.id;
    const resources = [...new Set(board.teams.flatMap((task) => task.rules.map((rule) => rule.resource)))];
    const owners = board.teams.filter((task) => taskHasOwnDraft(board.teams, task.id));
    for (const resource of resources) {
      const translating = owners.filter((task) => task.rules.some((rule) => rule.resource === resource && draftTaskId(board.teams, resource) === task.id));
      assert.equal(translating.length, 1, `${workflow.id}: «${resource}» tiene un solo borrador (${translating.map((task) => task.id).join(", ")})`);
    }
    for (const task of board.teams) {
      const own = taskHasOwnDraft(board.teams, task.id);
      // Refining, aligning, harmonizing, validating and publishing read and correct the draft of the translation.
      if (task.phaseId !== firstPhase) assert.equal(own, false, `${workflow.id}: «${task.id}» es de una fase posterior y no abre borrador ni revisión propios`);
      if (!own) {
        for (const rule of task.rules) {
          const source = draftTaskId(board.teams, rule.resource);
          assert.ok(source && source !== task.id, `${workflow.id}: «${task.id}» trabaja sobre el borrador de «${source}»`);
        }
      }
    }
    console.log(`    ${workflow.id}: con borrador propio → ${owners.map((task) => task.id).join(", ")}`);
  }
  assert.equal(taskHasOwnDraft(undefined, "x"), false);
  assert.equal(taskHasOwnDraft([], "x"), false, "una tarea que el plan no conoce no abre nada");
});

test("lo del equipo se busca primero en el borrador de quien lo traduce, aunque una tarea posterior tenga una rama", () => {
  const teams = [
    { id: "notas-ayuda", rules: [{ resource: "notas" }] },
    { id: "desafios", rules: [{ resource: "tpl" }, { resource: "notas" }] },
    { id: "armonizar-notas", rules: [{ resource: "notas" }, { resource: "academia" }] },
    { id: "validar", rules: [{ resource: "tpl" }, { resource: "notas" }] },
  ];
  assert.deepEqual(draftReadOrder(teams, "notas"), ["notas-ayuda", "validar", "armonizar-notas", "desafios"], "quien traduce, y después las demás, la última primero (libros de antes)");
  assert.equal(draftReadOrder(teams, "notas")[0], draftTaskId(teams, "notas"));
  assert.deepEqual(draftReadOrder(teams, "academia"), ["armonizar-notas"]);
  assert.deepEqual(draftReadOrder(teams, "preguntas"), []);
  assert.deepEqual(draftReadOrder(undefined, "notas"), []);
});

console.log(`\nverify-branch-names: ${passed} checks passed.`);
