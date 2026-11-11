/**
 * The step-by-step guide: when it shows, skipping it, repeating it, and how the parts of a screen make one guide.
 * The pointing on screen is tried in the browser; this is the logic under it.
 */
import assert from "node:assert/strict";
import { createGuide, guideKey, readSeen, writeSeen, stepsToShow, type GuideStep } from "../src/domain/guide";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

const step = (id: string, extra: Partial<GuideStep> = {}): GuideStep => ({ id, seenKey: `t:${id}`, text: id, ...extra });

/** A guide over a store, with the targets that are on screen. */
function setup(onScreen: string[] = ["task", "alerts", "guide-button"]) {
  const store = memory();
  const key = guideKey("https://qa.door43.org/", "Ana");
  const guide = createGuide({
    load: () => readSeen(key, store),
    save: (seen) => writeSeen(key, seen, store),
    present: (target) => onScreen.includes(target),
  });
  const ids = () => guide.run()?.steps.map((s) => s.id) ?? null;
  return { guide, store, key, ids, onScreen };
}

const tasksTour = [step("welcome"), step("task", { target: "task" }), step("alerts", { target: "alerts" })];
const end = [step("guide", { seenKey: "guide-button", target: "guide-button" })];

await test("la clave es por persona y servidor, sin barra final ni mayúsculas", () => {
  assert.equal(guideKey("https://qa.door43.org/", "Ana"), guideKey("https://qa.door43.org", "ana"));
  assert.notEqual(guideKey("https://qa.door43.org", "ana"), guideKey("https://qa.door43.org", "bea"));
  assert.notEqual(guideKey("https://qa.door43.org", "ana"), guideKey("https://git.door43.org", "ana"));
});

await test("lo visto se guarda y se lee; un valor dañado o un almacenamiento bloqueado no rompen nada", () => {
  const store = memory();
  writeSeen("k", new Set(["a", "b"]), store);
  assert.deepEqual([...readSeen("k", store)].sort(), ["a", "b"]);
  store.setItem("k", "{no es json");
  assert.equal(readSeen("k", store).size, 0);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readSeen("k", blocked).size, 0);
  writeSeen("k", new Set(["a"]), blocked);
});

await test("la primera vez se muestran todos los pasos; un paso sin lo que señala en pantalla no sale", () => {
  const present = (t: string) => t === "task";
  assert.deepEqual(stepsToShow(tasksTour, new Set(), { present }).map((s) => s.id), ["welcome", "task"]);
});

await test("un paso que no aplica (ya instalada) no sale, ni al repetir", () => {
  const steps = [step("welcome"), step("install", { when: false })];
  assert.deepEqual(stepsToShow(steps, new Set(), { present: () => true }).map((s) => s.id), ["welcome"]);
  assert.deepEqual(stepsToShow(steps, new Set(), { present: () => true, replay: true }).map((s) => s.id), ["welcome"]);
});

await test("lo ya visto no vuelve a salir solo; al repetir sale entero", () => {
  const seen = new Set(["t:welcome", "t:task", "t:alerts"]);
  assert.deepEqual(stepsToShow(tasksTour, seen, { present: () => true }), []);
  assert.deepEqual(stepsToShow(tasksTour, seen, { present: () => true, replay: true }).map((s) => s.id), ["welcome", "task", "alerts"]);
});

await test("un paso visto con la bienvenida de antes («Entendido») cuenta como visto", () => {
  const steps = [step("purpose", { seenBefore: true }), step("verse")];
  assert.deepEqual(stepsToShow(steps, new Set(), { present: () => true }).map((s) => s.id), ["verse"]);
});

await test("sale sola la primera vez en «Mis tareas», y avanza paso a paso hasta el final", () => {
  const { guide, ids, store, key } = setup();
  guide.setPart("screen", tasksTour);
  guide.setPart("end", end);
  assert.equal(guide.autoStart(), true);
  assert.deepEqual(ids(), ["welcome", "task", "alerts", "guide"]);
  assert.equal(guide.run()!.index, 0);
  guide.next();
  guide.next();
  guide.next();
  assert.equal(guide.run()!.index, 3, "el último paso");
  guide.next();
  assert.equal(guide.run(), null, "terminó");
  assert.deepEqual([...readSeen(key, store)].sort(), ["guide-button", "t:alerts", "t:task", "t:welcome"]);
});

await test("ya vista, no vuelve a salir sola, ni en otra visita", () => {
  const { guide, store, key } = setup();
  writeSeen(key, new Set(["t:welcome", "t:task", "t:alerts", "guide-button"]), store);
  guide.setPart("screen", tasksTour);
  guide.setPart("end", end);
  assert.equal(guide.autoStart(), false);
  assert.equal(guide.run(), null);
});

await test("«Saltar la guía» la cierra y cuenta como vista", () => {
  const { guide, store, key } = setup();
  guide.setPart("screen", tasksTour);
  guide.setPart("end", end);
  guide.autoStart();
  guide.skip();
  assert.equal(guide.run(), null);
  assert.equal(readSeen(key, store).size, 4);
  assert.equal(guide.autoStart(), false, "no vuelve");
});

await test("«Guía» la repite entera, aunque ya se haya visto", () => {
  const { guide, ids } = setup();
  guide.setPart("screen", tasksTour);
  guide.setPart("end", end);
  guide.autoStart();
  guide.skip();
  guide.replay();
  assert.deepEqual(ids(), ["welcome", "task", "alerts", "guide"]);
});

await test("un paso cuyo objetivo falta hoy (sin tareas) no se marca visto: sale solo cuando aparece", () => {
  const { guide, ids, onScreen } = setup(["alerts", "guide-button"]);
  guide.setPart("screen", tasksTour);
  guide.setPart("end", end);
  guide.autoStart();
  assert.deepEqual(ids(), ["welcome", "alerts", "guide"]);
  guide.skip();
  onScreen.push("task");
  guide.setPart("screen", [...tasksTour]);
  assert.equal(guide.autoStart(), true);
  assert.deepEqual(ids(), ["task"]);
});

await test("una pantalla sin guía no tiene botón «Guía» ni saca el paso del botón solo", () => {
  const { guide } = setup();
  guide.setPart("end", end);
  assert.equal(guide.hasGuide(), false);
  assert.equal(guide.autoStart(), false);
  guide.replay();
  assert.equal(guide.run(), null);
});

await test("en una herramienta: primero para qué sirve el paso, luego la pantalla, al final el botón", () => {
  const { guide, ids } = setup(["verse", "saved", "finish", "guide-button"]);
  guide.setPart("screen", [step("verse", { target: "verse" }), step("saved", { target: "saved" }), step("finish", { target: "finish" })]);
  guide.setPart("end", end);
  guide.setPart("purpose", [step("purpose-tpl", { seenKey: "purpose:tpl:borrador" })]);
  assert.equal(guide.hasGuide(), true);
  guide.autoStart();
  assert.deepEqual(ids(), ["purpose-tpl", "verse", "saved", "finish", "guide"]);
});

await test("del borrador TPL al TPS: la misma pantalla, solo sale lo nuevo (para qué sirve el paso)", () => {
  const { guide, ids } = setup(["verse", "guide-button"]);
  const screen = [step("verse", { target: "verse" })];
  guide.setPart("purpose", [step("p1", { seenKey: "purpose:tpl:borrador" })]);
  guide.setPart("screen", screen);
  guide.setPart("end", end);
  guide.autoStart();
  guide.skip();
  guide.setPart("purpose", [step("p2", { seenKey: "purpose:tps:borrador" })]);
  assert.equal(guide.autoStart(), true);
  assert.deepEqual(ids(), ["p2"]);
});

await test("no arranca mientras la pantalla no está lista (las tareas o los versículos aún cargan)", () => {
  const { guide } = setup();
  guide.setPart("screen", tasksTour, false);
  guide.setPart("end", end);
  assert.equal(guide.autoStart(), false);
  guide.setPart("screen", tasksTour, true);
  assert.equal(guide.autoStart(), true);
});

await test("si la persona se va de la pantalla a mitad de la guía, la guía se cierra sin darla por vista", () => {
  const { guide, store, key } = setup();
  guide.setPart("screen", tasksTour);
  guide.setPart("end", end);
  guide.autoStart();
  guide.next();
  guide.setPart("screen", null);
  assert.equal(guide.run(), null);
  assert.equal(readSeen(key, store).size, 0);
});

await test("«Ver la guía» desde el menú, en otra pantalla: se repite al llegar a la que tiene guía", () => {
  const { guide, ids, store, key } = setup();
  writeSeen(key, new Set(["t:welcome", "t:task", "t:alerts", "guide-button"]), store);
  guide.replaySoon();
  guide.setPart("end", end);
  assert.equal(guide.run(), null, "todavía no hay guía en pantalla");
  guide.setPart("screen", tasksTour);
  assert.equal(guide.autoStart(), true);
  assert.deepEqual(ids(), ["welcome", "task", "alerts", "guide"]);
});

await test("otra persona en el mismo aparato la ve desde el principio", () => {
  const store = memory();
  writeSeen(guideKey("https://qa.door43.org", "ana"), new Set(["t:welcome"]), store);
  assert.equal(readSeen(guideKey("https://qa.door43.org", "bea"), store).size, 0);
});

await test("avisa a quien escucha cuando cambia, y dice si ya corrió en esta visita", () => {
  const { guide } = setup();
  let calls = 0;
  const off = guide.subscribe(() => calls++);
  assert.equal(guide.ranThisVisit(), false);
  guide.setPart("screen", tasksTour);
  guide.autoStart();
  guide.next();
  assert.ok(calls >= 3);
  assert.equal(guide.ranThisVisit(), true);
  off();
  const before = calls;
  guide.next();
  assert.equal(calls, before);
});

// A walk through the first point of a tuning task, as `screenGuides.tsx` gives it: one seenKey for the whole of it.
const walk = (state: { studied?: boolean; doubting?: boolean; marked?: boolean; confirmed?: boolean } = {}): GuideStep[] => {
  const w = (id: string, extra: Partial<GuideStep>) => step(id, { seenKey: "flow:notas", flow: true, ...extra });
  return [
    w("steps", { target: "af-steps", done: state.studied, hide: ["af-ref", "af-answer"] }),
    w("ref", { target: "af-ref", done: state.studied }),
    w("tab", { kind: "tap", target: "af-tabs", until: ["af:ref-tab"], done: state.studied }),
    // The question, or, once «No» is touched, the box to say what one sees: one step, two shapes.
    state.doubting
      ? w("answer", { kind: "do", target: "af-doubt", text: "Escriba qué ve", done: state.studied })
      : w("answer", { kind: "tap", target: "af-answer", text: "Toque su respuesta", done: state.studied }),
    w("mark", { kind: "do", target: "af-words", done: state.confirmed || state.marked }),
    w("confirm", { kind: "tap", target: "af-confirm", done: state.confirmed }),
    w("decide", { kind: "tap", target: "af-decide", until: ["af:answered"] }),
    w("saved", { target: "af-count", after: ["af:answered"] }),
  ];
};
const idNow = (guide: ReturnType<typeof setup>["guide"]) => {
  const run = guide.run();
  return run ? run.steps[run.index]!.id : null;
};

await test("una caminata se toma entera aunque lo que señala aún no esté en pantalla", () => {
  assert.deepEqual(stepsToShow(walk(), new Set(), { present: () => false }).map((s) => s.id), ["steps", "ref", "tab", "answer", "mark", "confirm", "decide", "saved"]);
  assert.deepEqual(stepsToShow(walk(), new Set(["flow:notas"]), { present: () => true }), [], "vista, no vuelve sola");
});

await test("«Mire» sigue con su botón; «Toque» espera a que se toque lo iluminado", () => {
  const { guide } = setup();
  guide.setPart("screen", walk());
  guide.autoStart();
  assert.equal(idNow(guide), "steps");
  assert.equal(guide.run()!.flow, true);
  guide.next();
  guide.next();
  assert.equal(idNow(guide), "tab");
  guide.setPart("screen", walk());
  assert.equal(idNow(guide), "tab", "nada cambió: sigue esperando");
  guide.did("af:ref-tab");
  assert.equal(idNow(guide), "answer");
});

await test("una rama: «No» cambia el mismo paso a «Escriba qué ve»; «Cancelar» lo devuelve a la pregunta", () => {
  const { guide } = setup();
  guide.setPart("screen", walk());
  guide.autoStart();
  guide.next();
  guide.next();
  guide.did("af:ref-tab");
  guide.setPart("screen", walk({ doubting: true }));
  assert.equal(idNow(guide), "answer");
  assert.equal(guide.run()!.steps[guide.run()!.index]!.target, "af-doubt");
  guide.setPart("screen", walk());
  assert.equal(guide.run()!.steps[guide.run()!.index]!.target, "af-answer");
  guide.setPart("screen", walk({ studied: true }));
  assert.equal(idNow(guide), "mark", "respondió: a marcar");
});

await test("«Haga» espera la primera palabra marcada; lo que el trabajo ya dejó atrás se salta", () => {
  const { guide } = setup();
  guide.setPart("screen", walk({ studied: true }));
  guide.autoStart();
  assert.equal(idNow(guide), "mark", "la frase ya estaba estudiada: empieza en marcar");
  guide.setPart("screen", walk({ studied: true, marked: true }));
  assert.equal(idNow(guide), "confirm");
  guide.setPart("screen", walk({ studied: true, marked: true, confirmed: true }));
  assert.equal(idNow(guide), "decide");
});

await test("al responder, la app pasa a la frase siguiente: la guía dice «¡Guardado!» y no vuelve atrás", () => {
  const { guide, store, key } = setup();
  guide.setPart("screen", walk({ studied: true, marked: true, confirmed: true }));
  guide.autoStart();
  assert.equal(idNow(guide), "decide");
  assert.deepEqual(guide.run()!.steps.map((s) => s.id).includes("saved"), false, "«¡Guardado!» aún no");
  // The answer is saved and the next point opens at its first stage, all in one go.
  guide.did("af:answered");
  guide.setPart("screen", walk());
  assert.equal(idNow(guide), "saved", "no vuelve a «estudiar» en la frase 2");
  guide.next();
  assert.equal(guide.run(), null, "terminó");
  assert.deepEqual([...readSeen(key, store)], ["flow:notas"]);
  guide.setPart("screen", walk());
  assert.equal(guide.autoStart(), false, "vista, no vuelve sola");
  guide.replay();
  assert.equal(idNow(guide), "steps", "«Guía» la repite desde el principio");
});

await test("«Saltar la guía» a mitad de la caminata la da por vista, entera", () => {
  const { guide, store, key } = setup();
  guide.setPart("screen", walk());
  guide.setPart("end", end);
  guide.autoStart();
  guide.skip();
  assert.deepEqual([...readSeen(key, store)].sort(), ["flow:notas", "guide-button"]);
});

await test("terminada la caminata sigue lo demás: el paso del botón «Guía»", () => {
  const { guide } = setup();
  guide.setPart("screen", walk({ studied: true, marked: true, confirmed: true }));
  guide.setPart("end", end);
  guide.autoStart();
  guide.did("af:answered");
  assert.equal(idNow(guide), "saved");
  guide.next();
  assert.equal(idNow(guide), "guide");
});

await test("lo que pasa sin la guía puesta no cuenta para la próxima vez", () => {
  const { guide } = setup();
  guide.setPart("screen", walk({ studied: true, marked: true, confirmed: true }));
  guide.did("af:answered");
  guide.autoStart();
  assert.equal(idNow(guide), "decide");
});

await test("un aviso suelto que ya no está en pantalla cuando le llega el turno se salta, sin darse por visto", () => {
  const { guide, store, key, onScreen } = setup(["agree", "guide-button"]);
  const agree = step("agree", { seenKey: "afinar:agree", target: "agree" });
  guide.setPart("screen", [...walk({ studied: true, marked: true, confirmed: true }), agree]);
  guide.autoStart();
  guide.did("af:answered");
  onScreen.splice(onScreen.indexOf("agree"), 1);
  guide.setPart("screen", [...walk(), agree]);
  guide.next();
  assert.equal(guide.run(), null);
  assert.deepEqual([...readSeen(key, store)], ["flow:notas"]);
});

await test("«Empezar sin guía»: la caminata no sale sola, pero «Guía» la muestra", () => {
  const { guide } = setup();
  guide.setPart("purpose", [step("purpose", { seenKey: "purpose:desafios-tpl:revisar", seenBefore: true, quiet: true })]);
  guide.setPart("screen", walk());
  guide.setPart("end", end);
  assert.equal(guide.autoStart(), true, "solo el paso del botón «Guía»");
  assert.equal(idNow(guide), "guide");
  guide.skip();
  assert.equal(guide.autoStart(), false);
  guide.replay();
  assert.equal(idNow(guide), "purpose", "al repetir, todo");
});

await test("los pasos que esperan a que se pidan no salen solos, ni el del botón «Guía» por ellos; «Guía» los muestra", () => {
  const { guide } = setup();
  guide.setPart("screen", walk().map((one) => ({ ...one, manual: true })));
  guide.setPart("end", end);
  assert.equal(guide.autoStart(), false);
  assert.equal(guide.run(), null);
  guide.replay();
  assert.equal(guide.run()?.steps[0]?.id, walk()[0]!.id, "al pedirla, la caminata desde su primer paso");
  guide.replay(["screen"]);
  assert.ok(!guide.run()?.steps.some((one) => one.id === "guide"), "«Muéstreme cómo»: solo la caminata, sin el paso de «Guía»");
});

console.log(`\n${passed} pruebas de la guía pasaron.`);
