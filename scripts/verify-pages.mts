/**
 * Every page of a listing, a few at a time: the same issues as one page after another, in fewer round trips.
 */
import assert from "node:assert/strict";
import { allPages } from "../src/domain/pages";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** A listing of `total` items, pages of `limit`, that records which pages were asked and how many at once. */
function listing(total: number, limit: number) {
  const asked: number[] = [];
  let inFlight = 0;
  let most = 0;
  let rounds = 0;
  const fetchPage = async (page: number) => {
    asked.push(page);
    inFlight++;
    most = Math.max(most, inFlight);
    if (inFlight === 1) rounds++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    const from = (page - 1) * limit;
    return Array.from({ length: Math.max(0, Math.min(limit, total - from)) }, (_, i) => from + i);
  };
  return { fetchPage, asked, stats: () => ({ most, rounds }) };
}

await test("una lista que cabe en una página se pide una sola vez", async () => {
  const l = listing(12, 50);
  const items = await allPages(l.fetchPage, { limit: 50, maxPages: 10 });
  assert.equal(items.length, 12);
  assert.deepEqual(l.asked, [1]);
});

await test("las 210 subtareas de Esdras llegan todas, en orden y sin repetir, en dos vueltas en vez de cinco", async () => {
  const l = listing(210, 50);
  const items = await allPages(l.fetchPage, { limit: 50, maxPages: 10 });
  assert.deepEqual(items, Array.from({ length: 210 }, (_, i) => i));
  assert.equal(l.stats().rounds, 2);
  assert.equal(l.stats().most, 4);
});

await test("lo que llega después de la primera página corta no se toma", async () => {
  const l = listing(120, 50);
  const items = await allPages(l.fetchPage, { limit: 50, maxPages: 10 });
  assert.equal(items.length, 120);
  assert.ok(l.asked.length <= 5, `pidió ${l.asked.length} páginas`);
});

await test("una lista justo de páginas llenas termina con la primera vacía", async () => {
  const l = listing(100, 50);
  const items = await allPages(l.fetchPage, { limit: 50, maxPages: 10 });
  assert.equal(items.length, 100);
});

await test("nunca pide más páginas que el límite", async () => {
  const l = listing(10_000, 50);
  const items = await allPages(l.fetchPage, { limit: 50, maxPages: 10 });
  assert.equal(items.length, 500);
  assert.equal(Math.max(...l.asked), 10);
});

console.log(`\nverify-pages: ${passed} checks passed.`);
