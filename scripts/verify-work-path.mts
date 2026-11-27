/** The path a piece of work goes along (the bar on each card of «Mis tareas»), read from the plan's waits. */
import assert from "node:assert/strict";
import { processPlan, stepCardWords } from "../src/domain/processes";
import { chainAfter, handOffTarget, workPath, type WorkPath } from "../src/domain/workPath";
import type { AssignmentsDoc } from "../src/domain/types";
import { readFileSync } from "node:fs";
import { deliveredNotice } from "../src/components/cardWords";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const fcr = processPlan("fcr-base", { lang: "es-419", contentOrg: "x", pmOrg: "y" })!;
const names = (p: WorkPath) => p.segments.map((s) => `${s.step.name}:${s.state}`);

await test("Traducir TPL en el borrador: estudio hecho, borrador ahora, y siguen la revisión en pares y la lectura", () => {
  const p = workPath("tpl", fcr, ["familiarizar"])!;
  assert.deepEqual(names(p), ["Estudio:done", "Borrador:now", "Revisión en pares:todo", "Lectura grupal:todo"]);
  assert.equal(p.now?.name, "Borrador");
  assert.equal(p.next?.kind === "step" && p.next.step.name, "Revisión en pares");
});

await test("la lectura grupal muestra hechos los pasos de antes, aunque nadie de esta subtarea los cerró, y sigue Afinación", () => {
  const p = workPath("revision-grupal-tpl", fcr, [])!;
  assert.deepEqual(names(p), ["Estudio:done", "Borrador:done", "Revisión en pares:done", "Lectura grupal:now"]);
  assert.equal(p.next?.kind === "phase" && p.next.phase.name, "Afinación");
});

await test("Traducir Notas: sin lectura después; al final de la barra sigue Armonización", () => {
  const start = workPath("notas-ayuda", fcr, [])!;
  assert.equal(start.now?.name, "Estudio");
  assert.equal(start.next?.kind === "step" && start.next.step.name, "Borrador");
  const end = workPath("notas-ayuda", fcr, ["familiarizar", "borrador"])!;
  assert.equal(end.now?.name, "Revisión en pares");
  assert.equal(end.next?.kind === "phase" && end.next.phase.name, "Armonización");
});

await test("Afinación no trae los pasos de Traducción: la cadena es solo de la misma fase", () => {
  assert.deepEqual(names(workPath("palabras-tpl", fcr, [])!), ["Revisar frases con nota:done", "Revisar palabras clave:now", "Alinear y revisar:todo"]);
});

await test("con todos los pasos hechos no hay «Ahora», y «Sigue» dice adónde va (una regla por fase también cuenta)", () => {
  const p = workPath("alinear-tpl", fcr, ["alinear"])!;
  assert.equal(p.now, undefined);
  assert.equal(p.next?.kind === "phase" && p.next.phase.name, "Armonización");
});

await test("al entregar Traducir TPL, el trabajo pasa a la lectura grupal; al entregar la lectura, a Afinación", () => {
  const t = handOffTarget("tpl", fcr);
  assert.equal(t?.kind === "step" && t.step.name, "Lectura grupal");
  const after = handOffTarget("revision-grupal-tpl", fcr);
  assert.equal(after?.kind === "phase" && after.phase.name, "Afinación");
});

await test("lo último del proceso no pasa a ninguna parte, y no inventa un «Sigue»", () => {
  assert.equal(handOffTarget("publicar", fcr), undefined);
  const p = workPath("publicar", fcr, ["comprobar"])!;
  assert.equal(p.now?.name, "Publicar");
  assert.equal(p.next, undefined);
});

await test("una tarea que no está en el plan no tiene barra", () => {
  assert.equal(workPath("no-existe", fcr, []), undefined);
});

await test("una cadena que vuelve sobre sí misma se detiene, y de dos que esperan a la misma va la primera del plan", () => {
  const step = (id: string) => ({ id, name: id.toUpperCase() });
  const task = (id: string, waits: string[]) => ({ id, name: id, phaseId: "f", memberIds: [], scope: [], rules: [], description: "", steps: [step(`${id}1`)], waitsFor: waits.map((taskId) => ({ taskId, scope: "chapter" as const })) });
  const loop = { phases: [{ id: "f", name: "F", slug: "f", order: 0 }], teams: [task("a", ["b"]), task("b", ["a"]), task("d", ["a"]), task("c", ["a"])] } as unknown as AssignmentsDoc;
  const p = workPath("a", loop, [])!;
  assert.ok(p.segments.length <= 4, "the bar is finite");
  assert.deepEqual(chainAfter("a", loop).map((t) => t.id)[0], "b");
  const fork = { ...loop, teams: [task("a", []), task("d", ["a"]), task("c", ["a"])] } as unknown as AssignmentsDoc;
  assert.deepEqual(chainAfter("a", fork).map((t) => t.id), ["d"]);
});

await test("las palabras de un paso salen del paquete aunque el plan del proyecto no las tenga", () => {
  const borrador = { id: "borrador" }; // as in a plan saved before the process said them
  assert.equal(stepCardWords("tpl", borrador, "es").line, "Escriba su traducción del pasaje.");
  assert.equal(stepCardWords("tpl", borrador, "es").continue, "Seguir con mi borrador");
  assert.equal(stepCardWords("palabras-ayuda", borrador, "es").line, "Escriba su traducción del artículo.");
  assert.equal(stepCardWords("tps", { id: "familiarizar" }, "pt").continue, "Continuar o estudo");
  assert.equal(stepCardWords("revision-grupal-tpl", { id: "lectura" }, "pt").join, "Entrar na revisão");
  assert.equal(stepCardWords("revision-grupal-tps", { id: "lectura" }, "es").offer, "El capítulo {n} se revisa en grupo.");
});

await test("la revisión grupal dice «revisar», también en un libro que ya tenía las palabras de leer (#80)", () => {
  // Ezra and Esther keep the card they were made with: «Seguir con la lectura» and the rest, which the process said then.
  const old = { id: "lectura", card: { line: "Lea con su equipo los pasajes que llegaron.", continue: "Seguir con la lectura", join: "Unirse a la lectura", joins: { pt: "Entrar na leitura" }, offer: "El capítulo {n} se lee en grupo." } };
  const es = stepCardWords("revision-grupal-tpl", old, "es");
  assert.equal(es.continue, "Seguir revisando");
  assert.equal(es.join, "Unirse a la revisión");
  assert.equal(es.offer, "El capítulo {n} se revisa en grupo.");
  assert.equal(es.line, "Lea con su equipo los pasajes que llegaron.", "lo que no cambió sigue como estaba");
  assert.equal(stepCardWords("revision-grupal-tpl", old, "pt").join, "Entrar na revisão");
  const mine = { id: "lectura", card: { continue: "Seguir con lo nuestro" } };
  assert.equal(stepCardWords("revision-grupal-tpl", mine, "es").continue, "Seguir con lo nuestro", "una palabra propia del proyecto no se toca");
});

await test("toda revisión que se retoma dice «Seguir revisando» (#80)", () => {
  for (const [task, step] of [["tpl", "pares"], ["notas-ayuda", "pares"], ["desafios-tpl", "revisar"], ["palabras-tps", "revisar"], ["validar", "revision"]] as const) {
    assert.equal(stepCardWords(task, { id: step }, "es").continue, "Seguir revisando", `${task} › ${step}`);
    assert.equal(stepCardWords(task, { id: step }, "pt").continue, "Continuar revisando", `${task} › ${step}`);
  }
});

await test("lo que el proyecto escribió manda sobre el paquete, y una tarea que el paquete no tiene no da palabras", () => {
  assert.equal(stepCardWords("tpl", { id: "borrador", card: { line: "Propia" } }, "es").line, "Propia");
  assert.deepEqual(stepCardWords("tarea-propia", { id: "borrador" }, "es"), {});
  assert.deepEqual(stepCardWords("tpl", undefined, "es"), {});
});

await test("al entregar, «Mis tareas» dice adónde pasó el trabajo, en el idioma de la persona", () => {
  const es = JSON.parse(readFileSync(new URL("../src/i18n/locales/es.json", import.meta.url), "utf8")) as Record<string, string>;
  const pt = JSON.parse(readFileSync(new URL("../src/i18n/locales/pt.json", import.meta.url), "utf8")) as Record<string, string>;
  const draft = { title: "EZR 3:1–6 · Traducir TPL", labels: [] } as never;
  assert.equal(deliveredNotice(draft, "tpl", fcr, (key) => es[key]!, "es"), "Entregado. Pasa a «Lectura grupal» del capítulo 3.");
  assert.equal(deliveredNotice(draft, "tpl", fcr, (key) => pt[key]!, "pt"), "Entregue. Passa para «Leitura em grupo» do capítulo 3.");
  const reading = { title: "EZR 3 · Revisión grupal TPL", labels: [] } as never;
  assert.equal(deliveredNotice(reading, "revision-grupal-tpl", fcr, (key) => es[key]!, "es"), "Entregado. Pasa a Afinación.");
  assert.equal(deliveredNotice(reading, "publicar", fcr, (key) => es[key]!, "es"), undefined, "sin destino, el aviso de siempre");
});

console.log(`\n${passed} pruebas pasaron.`);
