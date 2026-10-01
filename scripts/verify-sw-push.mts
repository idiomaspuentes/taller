/** The service worker's push handling: replace quietly, count, and fold many into one summary. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

type Shown = { tag: string; title: string; body: string; data: { url: string; count: number }; silent: boolean; closed: boolean; close(): void };
let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

function worker() {
  const shown: Shown[] = [];
  const handlers: Record<string, (event: unknown) => void> = {};
  const self = {
    registration: {
      scope: "https://taller.example/",
      async getNotifications() {
        return shown.filter((n) => !n.closed);
      },
      async showNotification(title: string, o: { body: string; tag?: string; silent: boolean; data: { url: string; count: number } }) {
        const old = shown.find((n) => n.tag === o.tag && !n.closed);
        if (old) old.closed = true;
        shown.push({ tag: o.tag ?? "", title, body: o.body, data: o.data, silent: o.silent, closed: false, close() { this.closed = true; } });
      },
    },
    addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
    clients: {},
    skipWaiting() {},
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, caches: {}, fetch: async () => new Response(), Promise, String, Number, Error, console });
  const push = async (notice: object) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers.push!({ data: { json: () => notice }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  const visible = () => shown.filter((n) => !n.closed);
  return { push, visible };
}

const sub = (n: number, extra = {}) => ({ title: `Te mencionaron en #${n} Tarea ${n}`, body: "ana: hola", url: `https://taller.example/#/mis-tareas/${n}`, tag: `subtarea-${n}`, grouped: `{n} avisos nuevos en #${n} Tarea ${n}`, ...extra });
const assigned = (n: number) => ({ title: "Te asignaron una subtarea", body: `#${n} Tarea`, url: `https://taller.example/#/mis-tareas/${n}`, tag: "asignaciones", grouped: "Te asignaron {n} subtareas" });

await test("el primer aviso suena y los siguientes de la misma subtarea lo reemplazan en silencio, contando", async () => {
  const w = worker();
  await w.push(sub(7));
  assert.equal(w.visible().length, 1);
  assert.equal(w.visible()[0]!.silent, false, "el primero suena");
  await w.push(sub(7));
  await w.push(sub(7));
  assert.equal(w.visible().length, 1, "no se apilan");
  assert.equal(w.visible()[0]!.title, "3 avisos nuevos en #7 Tarea 7");
  assert.equal(w.visible()[0]!.silent, true, "los reemplazos no suenan");
});

await test("cien asignaciones seguidas son un solo aviso que lleva a Mis tareas", async () => {
  const w = worker();
  for (let i = 1; i <= 100; i++) await w.push(assigned(i));
  assert.equal(w.visible().length, 1);
  assert.equal(w.visible()[0]!.title, "Te asignaron 100 subtareas");
  assert.equal(w.visible()[0]!.data.url, "https://taller.example/#/mis-tareas");
});

await test("pasados cuatro avisos distintos se juntan en un resumen, y lo nuevo se suma a él en silencio", async () => {
  const w = worker();
  for (let i = 1; i <= 4; i++) await w.push(sub(i));
  assert.equal(w.visible().length, 4, "hasta cuatro se ven por separado");
  await w.push(sub(5));
  assert.equal(w.visible().length, 1);
  assert.equal(w.visible()[0]!.title, "5 avisos nuevos en Taller");
  assert.equal(w.visible()[0]!.silent, true);
  await w.push(sub(6));
  await w.push(assigned(9));
  assert.equal(w.visible().length, 1);
  assert.equal(w.visible()[0]!.title, "7 avisos nuevos en Taller");
  assert.equal(w.visible()[0]!.data.url, "https://taller.example/#/mis-tareas");
});

await test("un aviso sin etiqueta o sin datos igual se muestra", async () => {
  const w = worker();
  await w.push({ body: "hola" });
  assert.equal(w.visible().length, 1);
  assert.equal(w.visible()[0]!.title, "Taller");
});

console.log(`\nverify-sw-push: ${passed} checks passed.`);
