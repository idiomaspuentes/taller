/**
 * Writes `processes/fcr-prueba.json`: the FCR as it is, with one number lowered so that three people can walk a book
 * from end to end on a test server. Same phases, tasks, steps and tools; only the group review asks for fewer. Run it again whenever `processes/fcr.json` changes:
 *
 *   node scripts/make-test-process.mjs
 */
import fs from "node:fs";

const here = new URL("../processes/", import.meta.url);
const fcr = JSON.parse(fs.readFileSync(new URL("fcr.json", here), "utf8"));
const source = fcr.workflows[0];

// Three people cover everything the FCR asks for except one step: a review by «two others» besides the author and
// the pair reviewer needs four. Here the one person left does it; nothing else changes, so the rest is the real FCR.
const tasks = source.tasks.map((task) => ({
  ...task,
  steps: (task.steps ?? []).map((step) => {
    const others = step.claimMode === "pool" && (step.excludePriorStepIds?.length ?? 0) > 1;
    return others ? { ...step, minAssignees: 1, maxAssignees: 1 } : step;
  }),
}));

const pack = {
  schema: fcr.schema,
  id: "fcr-prueba",
  name: "FCR de prueba",
  workflows: [
    {
      ...source,
      id: "fcr-prueba",
      name: "FCR de prueba (tres personas)",
      names: { pt: "FCR de teste (três pessoas)" },
      version: source.version,
      description: "El FCR con la revisión grupal a cargo de una sola persona, para recorrerlo entre tres en un servidor de pruebas. No es para trabajo real.",
      descriptions: { pt: "O FCR com a revisão em grupo a cargo de uma só pessoa, para percorrê-lo entre três em um servidor de testes. Não é para trabalho real." },
      tasks,
    },
  ],
  // The tools are those of the FCR package, which is always listed beside this one.
  tools: [],
  glossary: fcr.glossary,
};
fs.writeFileSync(new URL("fcr-prueba.json", here), `${JSON.stringify(pack, null, 2)}\n`);
console.log(`fcr-prueba.json: ${tasks.length} tareas, versión ${source.version}`);
