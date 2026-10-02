/**
 * Templates are data. This checks, without knowing any process:
 * - the validator says in plain words what is wrong with a template, and nothing when it is fine;
 * - a process that has nothing to do with the shipped one runs through the same engine;
 * - every package listed in `taller.config.ts` is well formed and survives being saved and read back.
 * The last part walks a chapter through the shipped FCR package, read as data like any other.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { tallerConfig } from "../taller.config";
import type { ProcessPackage } from "../src/config/types";
import { localized, processGlossary, shippedWorkflows } from "../src/domain/processes";
import { DEFAULT_SOLVERS_CATALOG, normalizeSolversCatalog, upgradeShippedTools, withShippedTools } from "../src/domain/solvers";
import { resolveSolverLaunchUrl, type SolverLaunchContext } from "../src/domain/solverLaunch";
import { normalizeWorkflowTemplate } from "../src/domain/store";
import { localizeName } from "../src/domain/templateNames";
import type { AssignmentsDoc, ProjectTask, WorkflowTemplate } from "../src/domain/types";
import { newlyEnabled, waitBlocks } from "../src/domain/waits";
import { processProblems, workflowProblems } from "../src/domain/workflowCheck";
import { applyWorkflowToBoard } from "../src/domain/workflows";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const LANGUAGES = tallerConfig.uiLanguages as string[];
const emptyBoard = (): AssignmentsDoc =>
  ({ schema: "gateway-assignments-2", projectId: "TIT", book: "TIT", lang: "es-419", people: [], phases: [], teams: [] }) as unknown as AssignmentsDoc;

// ---------------------------------------------------------------- a process that is not the shipped one
/** Recording a book in audio: nothing of it exists in the app's code. */
const audio: ProcessPackage = {
  id: "audio",
  tools: [{ id: "grabadora", name: "Grabadora", launchUrl: "https://example.org/rec/{book}/{chapter}" }],
  workflows: [
    {
      id: "audio-base",
      name: "Grabación de audio",
      names: { pt: "Gravação de áudio" },
      version: 1,
      phases: [
        { id: "grabar", name: "Grabación", names: { pt: "Gravação" }, order: 0 },
        { id: "escuchar", name: "Escucha", order: 1 },
      ],
      tasks: [
        {
          id: "lectura",
          name: "Leer en voz alta",
          names: { pt: "Ler em voz alta" },
          phaseId: "grabar",
          rules: [{ resource: "tpl", articleFilter: "pending" }],
          steps: [
            { id: "ensayo", name: "Ensayo", closing: "self" },
            { id: "toma", name: "Toma", names: { pt: "Tomada" }, actionLabel: "Grabar", actionLabels: { pt: "Gravar" }, solverAppId: "grabadora", closing: "self" },
          ],
        },
        {
          id: "escucha",
          name: "Escuchar la toma",
          phaseId: "escuchar",
          rules: [{ resource: "tpl", articleFilter: "pending" }],
          waitsFor: [{ taskId: "lectura", scope: "chapter" }],
          steps: [
            {
              id: "oir",
              name: "Escucha en grupo",
              closing: "checklist",
              claimMode: "pool",
              minAssignees: 2,
              maxAssignees: 3,
              checklist: [
                { id: "claro", text: "¿Se entiende cada palabra?", texts: { pt: "Dá para entender cada palavra?" } },
                { id: "ritmo", text: "¿El ritmo es natural?" },
              ],
            },
          ],
        },
      ],
    },
  ],
  glossary: { pt: { "Toma vieja": "Tomada antiga" } },
};
const audioTools = normalizeSolversCatalog({ solvers: audio.tools }).solvers;

test("un proceso que no es el de la app es válido y pasa por el mismo motor", () => {
  assert.deepEqual(processProblems(audio, { tools: audioTools, languages: LANGUAGES }), []);
  const [workflow] = shippedWorkflows([audio]);
  const board = applyWorkflowToBoard(emptyBoard(), workflow!);
  assert.deepEqual(board.phases.map((p) => p.id), ["grabar", "escuchar"]);
  assert.deepEqual(board.teams.map((t) => t.id), ["lectura", "escucha"]);
  const oir = board.teams[1]!.steps![0]!;
  assert.equal(oir.closing, "checklist");
  assert.equal(oir.checklist?.length, 2);
  assert.equal(oir.checklist?.[0]?.texts?.pt, "Dá para entender cada palavra?");

  // Its second task waits for the first, per chapter, like any other.
  let n = 0;
  const issue = (taskId: string): DcsIssue =>
    ({ id: ++n, number: n, title: `TIT 1:1–3 · ${taskId}`, state: "open", body: "", labels: [{ name: `pm/tarea:${taskId}` }, { name: "pm/cap:1" }], assignee: null, assignees: [] }) as unknown as DcsIssue;
  const read = issue("lectura");
  const listen = issue("escucha");
  assert.equal(waitBlocks(listen, board, [read, listen]).length > 0, true);
  assert.equal(waitBlocks(listen, board, [listen]).length, 0);
});

test("los nombres y el botón salen del paquete, en el idioma de la persona", () => {
  const [workflow] = shippedWorkflows([audio]);
  const toma = workflow!.tasks[0]!.steps![1]!;
  assert.equal(localized(toma.name, toma.names, "pt"), "Tomada");
  assert.equal(localized(toma.name, toma.names, "es"), "Toma");
  assert.equal(localized(toma.actionLabel!, toma.actionLabels, "pt"), "Gravar");
  const table = new Map(processGlossary("pt", [audio]));
  assert.equal(table.get("Leer en voz alta"), "Ler em voz alta");
  assert.equal(table.get("Toma vieja"), "Tomada antiga", "el glosario del paquete cubre nombres de planes antiguos");
  assert.equal(table.has("Escucha"), false, "sin nombre en ese idioma, queda el guardado");
});

test("el validador dice qué está mal, en palabras claras", () => {
  const broken = {
    id: "roto",
    name: "Roto",
    phases: [{ id: "a", name: "A" }],
    tasks: [
      {
        id: "uno",
        name: "Uno",
        phaseId: "no-existe",
        rules: [{ resource: "video" }],
        minLevel: "experta",
        solverAppId: "fantasma",
        waitsFor: [{ taskId: "dos", scope: "chapter" }, { taskId: "nadie", scope: "chapter" }],
        steps: [
          { id: "p1", name: "P1", closing: "checklist" },
          { id: "p1", name: "Repetido" },
          { id: "p2", name: "P2", closing: "approval" },
          { id: "p3", name: "P3", claimMode: "pool", minAssignees: 3, maxAssignees: 2, minIndependent: 5, excludePriorStepIds: ["p9"] },
          { id: "p4", name: "P4", names: { xx: "?" }, closing: "magia" },
        ],
      },
      { id: "dos", name: "Dos", phaseId: "a", rules: [{ resource: "tpl" }], waitsFor: [{ taskId: "uno", scope: "chapter" }] },
    ],
  };
  const problems = workflowProblems(broken, { tools: audioTools, languages: LANGUAGES }).join("\n");
  for (const expected of [
    "su fase «no-existe» no existe",
    "el recurso «video» no existe",
    "el nivel «experta» no existe",
    "la herramienta «fantasma» no está en el catálogo",
    "espera a la tarea «nadie», que no existe",
    "sus esperas dan la vuelta",
    "el id «p1» está repetido",
    "no tiene preguntas",
    "alguien tiene que poder tomarlo",
    "el máximo de personas es menor que el mínimo",
    "pide más personas independientes",
    "excluye a quien hizo «p9»",
    "el idioma «xx» no es un idioma de la interfaz",
    "«magia» no es una regla de cierre",
  ]) {
    assert.ok(problems.includes(expected), `falta: ${expected}\n${problems}`);
  }
});

test("una herramienta sirve a dos pasos con parámetros por paso, sin que la pantalla conozca el proceso", () => {
  const [tool] = normalizeSolversCatalog({ solvers: [{ id: "t", name: "T", launchUrl: "/#/x?ctx={context}", stepParams: { repaso: { mode: "revisar" } } }] }).solvers;
  const ctx = { schema: "gateway-solver-launch-1", lang: "es-419", pmOrg: "o", contentOrg: "o", projectId: "TIT", taskId: "t", book: "TIT", chapter: 1, resource: "tpl", ref: "1", portionIds: ["c1"], itemIds: [], issueNumber: 1, username: "ana" } as unknown as SolverLaunchContext;
  assert.ok(resolveSolverLaunchUrl(tool!, { ...ctx, stepId: "repaso" }).endsWith("&mode=revisar"));
  assert.equal(resolveSolverLaunchUrl(tool!, { ...ctx, stepId: "otro" }).includes("mode="), false);
});

test("el catálogo guardado de una organización se pone al día con lo que trae el paquete, sin perder lo suyo", () => {
  const shipped = normalizeSolversCatalog({
    solvers: [
      { id: "editor", name: "Editor", launchUrl: "/#/nuevo?ctx={context}", supersedes: ["/viejo"], stepParams: { repaso: { mode: "revisar" } } },
      { id: "extra", name: "Extra", launchUrl: "/#/extra" },
    ],
  });
  const saved = normalizeSolversCatalog({
    solvers: [
      { id: "editor", name: "Mi editor", launchUrl: "/viejo.html#ctx={context}" },
      { id: "propia", name: "Propia", launchUrl: "https://example.org/x" },
    ],
  });
  const upgraded = upgradeShippedTools(saved, shipped);
  const editor = upgraded.solvers.find((tool) => tool.id === "editor")!;
  assert.equal(editor.launchUrl, "/#/nuevo?ctx={context}");
  assert.equal(editor.name, "Mi editor", "el nombre que puso la organización se conserva");
  assert.deepEqual(editor.stepParams, { repaso: { mode: "revisar" } });
  const later = normalizeSolversCatalog({ solvers: [{ ...shipped.solvers[0]!, stepParams: { repaso: { mode: "revisar" }, otro: { mode: "ambos" } } }] });
  const again = upgradeShippedTools({ ...upgraded, solvers: upgraded.solvers.map((tool) => (tool.id === "editor" ? { ...tool, stepParams: { repaso: { mode: "propio" } } } : tool)) }, later);
  assert.deepEqual(again.solvers.find((tool) => tool.id === "editor")!.stepParams, { repaso: { mode: "propio" }, otro: { mode: "ambos" } }, "llega el parámetro nuevo y se respeta el que la organización cambió");
  assert.ok(upgraded.solvers.some((tool) => tool.id === "propia"));
  assert.equal(upgradeShippedTools(upgraded, shipped), upgraded, "al día: no cambia nada ni se vuelve a guardar");
  assert.deepEqual(withShippedTools(upgraded, shipped).solvers.map((tool) => tool.id), ["editor", "propia", "extra"]);
});

// ---------------------------------------------------------------- the packages of taller.config.ts
for (const pack of tallerConfig.processes) {
  test(`paquete «${pack.id}»: sin problemas`, () => {
    assert.deepEqual(processProblems(pack, { tools: DEFAULT_SOLVERS_CATALOG.solvers, languages: LANGUAGES }), []);
  });

  test(`paquete «${pack.id}»: al guardar y volver a leer no se pierde nada`, () => {
    for (const raw of pack.workflows ?? []) {
      const once = normalizeWorkflowTemplate(raw)!;
      const twice = normalizeWorkflowTemplate(JSON.parse(JSON.stringify(once)))!;
      assert.deepEqual(twice, once);
      const source = raw as WorkflowTemplate;
      assert.equal(once.tasks.length, source.tasks.length, "tareas");
      assert.equal(once.phases.length, source.phases.length, "fases");
      assert.equal(once.version, source.version);
      for (const task of source.tasks) {
        const back = once.tasks.find((t) => t.id === task.id)!;
        assert.deepEqual(back.names, task.names, `${task.id}: nombres`);
        assert.deepEqual(back.waitsFor, task.waitsFor, `${task.id}: esperas`);
        assert.equal(back.minLevel, task.minLevel, `${task.id}: nivel`);
        assert.deepEqual(back.steps?.map((s) => s.id), task.steps?.map((s) => s.id), `${task.id}: pasos`);
        for (const step of task.steps ?? []) {
          const stepBack = back.steps!.find((s) => s.id === step.id)!;
          assert.equal(stepBack.closing, step.closing, `${task.id}/${step.id}: cierre`);
          assert.deepEqual(stepBack.checklist, step.checklist, `${task.id}/${step.id}: preguntas`);
          assert.equal(stepBack.actionLabel, step.actionLabel, `${task.id}/${step.id}: botón`);
          assert.equal(stepBack.scope, step.scope, `${task.id}/${step.id}: alcance`);
        }
      }
    }
  });

  test(`paquete «${pack.id}»: todo nombre y todo botón está en cada idioma de la interfaz`, () => {
    const missing: string[] = [];
    const others = LANGUAGES.filter((lang) => lang !== tallerConfig.defaultUiLanguage);
    const need = (where: string, names: Record<string, string | undefined> | undefined) => {
      for (const lang of others) if (!names?.[lang]?.trim()) missing.push(`${where} [${lang}]`);
    };
    for (const workflow of shippedWorkflows([pack])) {
      need(workflow.name, workflow.names);
      for (const phase of workflow.phases) need(`fase ${phase.name}`, phase.names);
      for (const task of workflow.tasks) {
        need(`tarea ${task.name}`, task.names);
        for (const step of task.steps ?? []) {
          need(`${task.name} / ${step.name}`, step.names);
          if (step.actionLabel) need(`${task.name} / ${step.name} (botón)`, step.actionLabels);
          for (const question of step.checklist ?? []) need(`${task.name} / ${step.name} / ${question.id}`, question.texts);
        }
      }
    }
    assert.deepEqual(missing, []);
  });
}

// ---------------------------------------------------------------- a chapter through the shipped FCR, read as data
const fcr = shippedWorkflows().find((workflow) => workflow.id === "fcr-base");
if (fcr) {
  const board = applyWorkflowToBoard(emptyBoard(), fcr);
  const team = (id: string) => board.teams.find((t) => t.id === id) as ProjectTask;
  let n = 0;
  const issue = (taskId: string, chapter: number): DcsIssue =>
    ({ id: ++n, number: n, title: `TIT ${chapter}:1–3 · ${taskId}`, state: "open", body: "", labels: [{ name: `pm/tarea:${taskId}` }, { name: `pm/cap:${chapter}` }], assignee: null, assignees: [] }) as unknown as DcsIssue;

  test("FCR: Traducción se familiariza, hace el borrador y lo revisa; los artículos no se familiarizan", () => {
    assert.deepEqual(team("tpl").steps!.map((s) => s.id), ["familiarizar", "borrador", "pares", "grupal"]);
    assert.deepEqual(team("notas-ayuda").steps!.map((s) => s.id), ["familiarizar", "borrador", "pares"]);
    assert.deepEqual(team("palabras-ayuda").steps!.map((s) => s.id), ["borrador", "pares"]);
    assert.equal(team("tpl").steps![0]!.scope, "chapter-once");
  });

  test("FCR: la Afinación cierra por consenso; nadie alinea un capítulo entero: se toman versículos y se revisan al terminar", () => {
    for (const id of ["afinar-tpl", "afinar-tps"]) {
      const steps = team(id).steps!;
      assert.deepEqual(steps.map((s) => s.id), ["notas", "palabras", "alineacion"]);
      assert.deepEqual(steps.map((s) => s.closing), ["consensus", "consensus", "consensus"]);
      assert.equal(steps[2]!.claimMode, "pool", "la alineación es de todo el equipo: cada quien toma versículos y los demás revisan");
      assert.equal(steps[0]!.minAssignees, 3);
      assert.equal(steps[0]!.minIndependent, 2);
      assert.equal(steps[1]!.scope, "unit", "las palabras clave se revisan por capítulo, no por porción");
    }
  });

  test("FCR: la Armonización tiene tres pistas, con sus listas de comprobación y el acuerdo del equipo", () => {
    const tracks = board.teams.filter((t) => t.phaseId === team("armonizar-notas").phaseId);
    assert.deepEqual(tracks.map((t) => t.id), ["armonizar-notas", "armonizar-palabras", "armonizar-preguntas"]);
    for (const track of tracks) {
      const steps = track.steps!;
      assert.equal(steps.at(-1)!.closing, "consensus", `${track.id}: se cierra por acuerdo`);
      for (const step of steps.slice(0, -1)) {
        assert.equal(step.closing, "checklist");
        assert.ok(step.checklist!.length > 0);
      }
    }
    assert.deepEqual(team("armonizar-notas").rules.map((r) => r.resource), ["notas", "academia"]);
  });

  test("FCR: un capítulo recorre el flujo en orden", () => {
    const tpl1 = issue("tpl", 1), tps1 = issue("tps", 1), tpl2 = issue("tpl", 2);
    const notas = issue("notas-ayuda", 1), academia = issue("academia-ayuda", 1);
    const afTpl1 = issue("afinar-tpl", 1), afTps1 = issue("afinar-tps", 1), afTpl2 = issue("afinar-tpl", 2);
    const arm = issue("armonizar-notas", 1), armQ = issue("armonizar-preguntas", 1);
    const val = issue("validar", 1);
    const all = [tpl1, tps1, tpl2, notas, academia, afTpl1, afTps1, afTpl2, arm, armQ, val];
    const waiting = (i: DcsIssue, open = all) => waitBlocks(i, board, open).length > 0;

    assert.ok(waiting(afTpl1) && waiting(afTps1), "la Afinación espera a su Traducción");
    const afterTpl1 = all.filter((i) => i !== tpl1);
    assert.equal(waiting(afTpl1, afterTpl1), false, "cerrado el TPL del capítulo 1 se habilita Afinar TPL");
    assert.equal(waiting(afTps1, afterTpl1), true, "Afinar TPS sigue esperando al TPS");
    assert.equal(waiting(afTpl2, afterTpl1), true, "el capítulo 2 espera a su propio TPL");
    assert.deepEqual(newlyEnabled(tpl1, board, all).map((i) => i.number), [afTpl1.number]);

    const tuned = all.filter((i) => ![tpl1, tps1, afTpl1, afTps1].includes(i));
    assert.equal(waiting(arm, tuned), true, "Notas y Academia esperan también a sus ayudas");
    const ready = tuned.filter((i) => i !== notas && i !== academia);
    assert.equal(waiting(arm, ready), false, "con los dos textos afinados y sus ayudas, la pista arranca");
    assert.equal(waiting(val, ready), true, "Validación espera a las tres pistas");
    assert.equal(waiting(val, ready.filter((i) => i !== arm && i !== armQ)), false);
  });

  test("FCR: quién puede tomar cada cosa", () => {
    assert.equal(team("afinar-tpl").minLevel, "aprendiz");
    assert.equal(team("tpl").minLevel, "practicante");
    for (const id of ["armonizar-notas", "armonizar-preguntas", "armonizar-palabras", "validar"]) assert.equal(team(id).minLevel, "habilitada", id);
  });

  test("FCR: los nombres se muestran en portugués desde el paquete, también los de planes antiguos", () => {
    assert.equal(localizeName("Traducir TPL", "pt"), "Traduzir TPL");
    assert.equal(localizeName("NEH 2 · Revisar la alineación", "pt"), "NEH 2 · Revisar o alinhamento");
    assert.equal(localizeName("Desafíos de traducción", "pt"), "Desafios de tradução");
    assert.equal(localizeName("Cierre independiente", "pt"), "Fechamento independente", "nombre de un plan antiguo");
    assert.equal(localizeName("Traducir TPL", "es"), "Traducir TPL");
  });
}

console.log(`\nverify-templates: ${passed} checks passed.`);
