/**
 * The group review of a deliverable: passages are read as they arrive, and it closes only when all arrived and all
 * is agreed.
 *
 *   npm run verify:group-reading
 */
import assert from "node:assert/strict";
import { openDoubts, passageAgreement, passageAgreers, passageBlocker, passagesOf, readingItemId, readingPassages, readingProgress, verseConversation, type ReadingText } from "../src/domain/groupReading";
import { tallyItem, textFingerprint, type ItemTally, type ReviewDecision } from "../src/domain/reviewRound";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("los pasajes del entregable salen de la subtarea, en orden; sin lista, el capítulo entero", () => {
  assert.deepEqual(passagesOf(["porcion:3JN 1:5-8", "porcion:3JN 1:1-4", "porcion:3JN 2:1-3", "porcion:3JN 1:9–15"], 1, 15), [{ from: 1, to: 4 }, { from: 5, to: 8 }, { from: 9, to: 15 }]);
  assert.deepEqual(passagesOf([], 1, 15), [{ from: 1, to: 15 }]);
});

const tpl = { resource: "tpl", verses: { 1: "El anciano a Gayo.", 2: "Amado, oro por ti." } };
const tps = { resource: "tps", verses: {} };
const passages = readingPassages([{ from: 1, to: 2 }, { from: 3, to: 4 }], [tpl, tps]);
const levels = { ana: "habilitada", bea: "habilitada", carla: "habilitada" } as const;
const answer = (who: string, resource: string, verse: number, text: string, status = "approved"): ReviewDecision =>
  ({ itemId: readingItemId(resource, 1, verse), reviewer: who, status, timestamp: "2026-10-02T10:00:00Z", textHash: textFingerprint(text), ref: { start: { chapter: 1, verse } }, sessionId: "1", stageId: "lectura" }) as ReviewDecision;
const tally = (decisions: ReviewDecision[], texts = [tpl, tps]) => {
  const map = new Map<string, ItemTally>();
  for (const text of texts) {
    for (const [verse, body] of Object.entries(text.verses)) {
      const itemId = readingItemId(text.resource, 1, Number(verse));
      map.set(itemId, tallyItem({ itemId, decisions, currentHash: textFingerprint(body as string), levels: levels as never, authors: ["ana"], thresholds: { minAgree: 2, minIndependent: 1 } }));
    }
  }
  return map;
};

test("un pasaje se lee en cuanto llega; lo que no llegó se espera y no deja cerrar", () => {
  assert.deepEqual(passages.map((p) => [p.from, p.arrived]), [[1, { tpl: true, tps: false }], [3, { tpl: false, tps: false }]]);
  const all = [answer("ana", "tpl", 1, tpl.verses[1]), answer("bea", "tpl", 1, tpl.verses[1]), answer("ana", "tpl", 2, tpl.verses[2]), answer("bea", "tpl", 2, tpl.verses[2])];
  const progress = readingProgress(passages, [tpl, tps], 1, tally(all));
  assert.deepEqual([progress.items, progress.agreed, progress.missing, progress.complete], [2, 2, 3, false]);
});

test("un borrador que parte de un texto que ya existía: llega lo que se entregó, no lo que tiene letras", () => {
  const seeded = { resource: "tpl", verses: { 1: "a", 2: "b", 3: "c", 4: "d" }, pending: [{ from: 3, to: 4 }] };
  assert.deepEqual(readingPassages([{ from: 1, to: 2 }, { from: 3, to: 4 }], [seeded]).map((p) => p.arrived.tpl), [true, false]);
});

test("cuando todo llegó y todo está acordado, se puede cerrar; una duda o una corrección lo reabre", () => {
  const whole = readingPassages([{ from: 1, to: 2 }], [tpl]);
  const all = [answer("ana", "tpl", 1, tpl.verses[1]), answer("bea", "tpl", 1, tpl.verses[1]), answer("ana", "tpl", 2, tpl.verses[2]), answer("bea", "tpl", 2, tpl.verses[2])];
  assert.equal(readingProgress(whole, [tpl], 1, tally(all, [tpl])).complete, true);
  const doubt = [...all, { ...answer("carla", "tpl", 2, tpl.verses[2], "revise"), note: "¿oro o ruego?" }];
  const withDoubt = readingProgress(whole, [tpl], 1, tally(doubt, [tpl]));
  assert.deepEqual([withDoubt.agreed, withDoubt.disputed, withDoubt.complete], [1, 1, false]);
  const fixed = { resource: "tpl", verses: { ...tpl.verses, 2: "Amado, ruego por ti." } };
  const afterFix = readingProgress(readingPassages([{ from: 1, to: 2 }], [fixed]), [fixed], 1, tally(all, [fixed]));
  assert.deepEqual([afterFix.agreed, afterFix.complete], [1, false], "las respuestas sobre el texto viejo ya no cuentan");
});

test("quien tradujo el versículo puede estar de acuerdo, pero hace falta alguien más", () => {
  const whole = readingPassages([{ from: 1, to: 1 }], [{ resource: "tpl", verses: { 1: tpl.verses[1] } }]);
  const one = { resource: "tpl", verses: { 1: tpl.verses[1] } };
  const map = new Map<string, ItemTally>();
  const itemId = readingItemId("tpl", 1, 1);
  map.set(itemId, tallyItem({ itemId, decisions: [answer("ana", "tpl", 1, tpl.verses[1]), answer("bea", "tpl", 1, tpl.verses[1])], currentHash: textFingerprint(tpl.verses[1]), levels: levels as never, authors: ["ana", "bea"], thresholds: { minAgree: 2, minIndependent: 1 } }));
  assert.equal(readingProgress(whole, [one], 1, map).complete, false);
});

test("la lectura grupal no se puede cerrar mientras un versículo acordado sigue abierto", () => {
  const whole = readingPassages([{ from: 1, to: 2 }], [tpl]);
  const all = [answer("ana", "tpl", 1, tpl.verses[1]), answer("bea", "tpl", 1, tpl.verses[1]), answer("ana", "tpl", 2, tpl.verses[2]), answer("bea", "tpl", 2, tpl.verses[2])];
  const map = tally(all, [tpl]);
  const iso = "2026-10-05T10:00:00.000Z";
  const itemId = readingItemId("tpl", 1, 2);
  map.set(itemId, { ...map.get(itemId)!, state: "agreed", openUntil: iso });
  const progress = readingProgress(whole, [tpl], 1, map);
  assert.equal(progress.allAgreed, true);
  assert.equal(progress.complete, false, "el versículo 2 sigue abierto para los demás");
  assert.equal(progress.closesAt, iso);
  const closed = readingProgress(whole, [tpl], 1, tally(all, [tpl]));
  assert.deepEqual([closed.allAgreed, closed.complete, closed.closesAt], [true, true, undefined]);
});

// ---- The passage as a unit: who agrees with it, what one tap would save, why it is not agreed, the open doubts ----
const base = { resource: "tpl", verses: { 1: "Uno.", 2: "Dos.", 3: "Tres." } as Record<number, string> };
const wholePassage = (text: ReadingText) => readingPassages([{ from: 1, to: 3 }], [text])[0]!;
const say = (who: string, verse: number, minute: number, status = "approved", note?: string, text = base.verses[verse] ?? "", resource = "tpl"): ReviewDecision =>
  ({
    itemId: readingItemId(resource, 1, verse), reviewer: who, status, timestamp: `2026-10-02T10:${String(minute).padStart(2, "0")}:00Z`,
    textHash: textFingerprint(text), ref: { start: { chapter: 1, verse } }, sessionId: "1", stageId: "lectura", ...(note ? { note } : {}),
  }) as ReviewDecision;
const tallyOf = (text: ReadingText, decisions: ReviewDecision[], opts: { authors?: string[]; confirmers?: string[]; levels?: Record<string, string> } = {}) => {
  const map = new Map<string, ItemTally>();
  for (const [verse, body] of Object.entries(text.verses)) {
    if (!body.trim()) continue;
    const itemId = readingItemId(text.resource, 1, Number(verse));
    map.set(itemId, tallyItem({ itemId, decisions, currentHash: textFingerprint(body), levels: (opts.levels ?? levels) as never, authors: opts.authors ?? ["ana"], confirmers: opts.confirmers, thresholds: { minAgree: 2, minIndependent: 1 } }));
  }
  return map;
};
const everyone = [1, 2, 3].flatMap((v) => [say("bea", v, 1), say("carla", v, 2 + v)]);

test("quienes ya están de acuerdo con todo el pasaje salen en orden de su primera respuesta", () => {
  const p = wholePassage(base);
  const decisions = [say("carla", 1, 5), say("bea", 1, 6), say("carla", 2, 7), say("bea", 2, 8), say("carla", 3, 9), say("bea", 3, 10), say("dora", 1, 1)];
  assert.deepEqual(passageAgreers(p, base, 1, tallyOf(base, decisions)), ["carla", "bea"], "dora solo contestó un versículo");
  assert.deepEqual(passageAgreers(p, base, 1, new Map()), [], "sin respuestas no hay nadie");
});

test("quien escribió el texto cuenta como de acuerdo, pero el pasaje sigue sin cerrarse si solo ellos coinciden", () => {
  const p = wholePassage(base);
  const decisions = [1, 2, 3].flatMap((v) => [say("ana", v, 1), say("bea", v, 2)]);
  const tallies = tallyOf(base, decisions, { authors: ["ana", "bea"] });
  assert.deepEqual(passageAgreers(p, base, 1, tallies), ["ana", "bea"]);
  assert.deepEqual(passageBlocker(p, base, 1, tallies, 2), { kind: "independent" });
});

test("alguien cuyo nivel no cuenta aparece igual entre quienes están de acuerdo", () => {
  const p = wholePassage(base);
  const tallies = tallyOf(base, [1, 2, 3].map((v) => say("nico", v, v)), { levels: { ...levels, nico: "aprendiz" } });
  assert.equal(tallies.get(readingItemId("tpl", 1, 1))!.agree, 0, "su acuerdo no suma al mínimo");
  assert.deepEqual(passageAgreers(p, base, 1, tallies), ["nico"]);
});

test("un acuerdo sobre un texto que cambió ya no cuenta: sale de la lista y el versículo vuelve a los que se guardarían, marcado como cambiado", () => {
  const edited = { resource: "tpl", verses: { ...base.verses, 2: "Dos, corregido." } };
  const p = wholePassage(edited);
  const decisions = [1, 2, 3].map((v) => say("bea", v, v)); // bea answered 2 on the old text
  const tallies = tallyOf(edited, decisions);
  assert.deepEqual(passageAgreers(p, edited, 1, tallies), [], "bea ya no está de acuerdo con todo");
  assert.deepEqual(passageAgreement(p, edited, 1, tallies, "bea"), { verses: [2], othersDoubt: [], myDoubt: [], changed: [2] });
});

test("la duda de otra persona deja el versículo fuera de lo que se guardaría; mi propia respuesta ya hecha no se toca", () => {
  const p = wholePassage(base);
  const decisions = [say("bea", 1, 1), say("carla", 2, 2, "revise", "¿oro o ruego?"), say("carla", 3, 3), say("bea", 3, 4, "revise", "mejor así")];
  const tallies = tallyOf(base, decisions);
  assert.deepEqual(passageAgreement(p, base, 1, tallies, "Bea "), { verses: [], othersDoubt: [2], myDoubt: [3], changed: [] }, "el 1 ya lo respondí; el 2 lo duda carla; el 3 es mi duda");
  assert.deepEqual(passageAgreement(p, base, 1, tallies, "dora"), { verses: [1], othersDoubt: [2, 3], myDoubt: [], changed: [] }, "dora no respondió nada: el 1 sí, el 2 y el 3 tienen dudas de otros");
});

test("mi duda sobre un texto anterior se guardaría como acuerdo con el texto nuevo, marcada como cambiada", () => {
  const edited = { resource: "tpl", verses: { ...base.verses, 1: "Uno, otra vez." } };
  const p = wholePassage(edited);
  const decisions = [say("bea", 1, 1, "revise", "no suena bien", base.verses[1])];
  const tallies = tallyOf(edited, decisions);
  assert.deepEqual(passageAgreement(p, edited, 1, tallies, "bea"), { verses: [1, 2, 3], othersDoubt: [], myDoubt: [], changed: [1] });
});

test("una respuesta mía con nota a la duda de otra persona no deja nada pendiente; quien dudó la ve contestada", () => {
  const p = wholePassage(base);
  const doubt = say("carla", 2, 5, "revise", "¿oro o ruego?");
  const reply = say("bea", 2, 6, "approved", "oro es lo que dice el original");
  const decisions = [say("bea", 1, 1), say("carla", 1, 2), say("bea", 3, 1), say("carla", 3, 2), doubt, reply];
  const tallies = tallyOf(base, decisions);
  assert.deepEqual(passageAgreement(p, base, 1, tallies, "bea"), { verses: [], othersDoubt: [], myDoubt: [], changed: [] });
  assert.deepEqual(openDoubts([p], base, 1, tallies, decisions, "carla"), [{ verse: 2, mine: true, answered: true }]);
  assert.deepEqual(openDoubts([p], base, 1, tallies, decisions, "dora"), [{ verse: 2, mine: false, answered: false }]);
  const early = [say("bea", 2, 4, "approved", "una nota anterior a la duda"), doubt];
  assert.deepEqual(openDoubts([p], base, 1, tallyOf(base, early), early, "carla"), [{ verse: 2, mine: true, answered: false }], "una respuesta anterior a la duda no la contesta");
  const ownNote = [doubt, say("carla", 2, 7, "revise", "sigo creyendo lo mismo")];
  assert.deepEqual(openDoubts([p], base, 1, tallyOf(base, ownNote), ownNote, "carla"), [{ verse: 2, mine: true, answered: false }], "solo contesta otra persona, con un acuerdo");
  const onOlder = [doubt, say("bea", 2, 6, "approved", "sobre el texto de antes", "Dos, antes.")];
  assert.deepEqual(openDoubts([p], base, 1, tallyOf(base, onOlder), onOlder, "carla"), [{ verse: 2, mine: true, answered: false }], "una respuesta sobre otro texto no contesta la duda");
});

test("un versículo vacío dentro del pasaje no se pide ni bloquea en ninguna lista", () => {
  const gap = { resource: "tpl", verses: { 1: "Uno.", 2: "  ", 3: "Tres." } };
  const p = wholePassage(gap);
  const decisions = [1, 3].flatMap((v) => [say("bea", v, 1), say("carla", v, 2)]);
  const tallies = tallyOf(gap, decisions);
  assert.deepEqual(passageAgreers(p, gap, 1, tallies), ["bea", "carla"]);
  assert.deepEqual(passageAgreement(p, gap, 1, tallies, "dora"), { verses: [1, 3], othersDoubt: [], myDoubt: [], changed: [] });
  assert.equal(passageBlocker(p, gap, 1, tallies, 2), null);
  assert.deepEqual(openDoubts([p], gap, 1, tallies, decisions, "dora"), []);
});

test("un versículo cerrado por una decisión final no bloquea ni se pide, aunque nadie haya respondido", () => {
  const p = wholePassage(base);
  const final = { ...say("carla", 2, 9, "approved", "así lo dejamos"), final: true } as ReviewDecision;
  const decisions = [say("bea", 1, 1), say("ana", 1, 2), say("bea", 3, 1), say("ana", 3, 2), final];
  const tallies = tallyOf(base, decisions, { confirmers: ["carla"] });
  const closed = tallies.get(readingItemId("tpl", 1, 2))!;
  assert.deepEqual([closed.decided?.by, closed.agree < 2, closed.state], ["carla", true, "agreed"], "cerrado sin llegar al mínimo de acuerdos");
  assert.deepEqual(passageAgreers(p, base, 1, tallies), ["bea", "ana"], "el 2 no le pide nada a nadie");
  assert.deepEqual(passageAgreement(p, base, 1, tallies, "eva"), { verses: [1, 3], othersDoubt: [], myDoubt: [], changed: [] });
  assert.equal(passageBlocker(p, base, 1, tallies, 2), null);
  assert.deepEqual(openDoubts([p], base, 1, tallies, decisions, "eva"), []);
});

test("lo que impide acordar el pasaje, desde su primer versículo sin acordar: duda, luego tC, luego faltan acuerdos, luego independiente", () => {
  const p = wholePassage(base);
  assert.equal(passageBlocker(p, base, 1, tallyOf(base, everyone), 2), null, "todo acordado");
  // doubt: from the first verse not agreed, lists every verse with an open doubt, in order
  const withDoubts = [...everyone.filter((d) => d.itemId.endsWith(":1")), say("dora", 2, 20, "revise", "x"), say("dora", 3, 21, "revise", "y")];
  assert.deepEqual(passageBlocker(p, base, 1, tallyOf(base, withDoubts), 2), { kind: "doubt", verses: [2, 3] });
  const laterDoubt = [...everyone.filter((d) => d.itemId.endsWith(":3")), say("dora", 3, 21, "revise", "y")];
  assert.deepEqual(passageBlocker(p, base, 1, tallyOf(base, laterDoubt), 2), { kind: "more" }, "el primero sin acordar (el 1) no tiene duda: manda él, no la duda del 3");
  // tc: two agreements on different words, no doubts
  const sel = (who: string, minute: number, words: string) => ({ ...say(who, 1, minute), selectedText: { text: words } }) as ReviewDecision;
  const split = [sel("bea", 1, "Uno"), sel("carla", 2, "Uno.")]; // same words once normalised: no split
  assert.notEqual(passageBlocker(p, base, 1, tallyOf(base, [...split, ...everyone.filter((d) => !d.itemId.endsWith(":1"))]), 2)?.kind, "tc");
  const differ = [sel("bea", 1, "Uno"), sel("carla", 2, "Otra"), ...everyone.filter((d) => !d.itemId.endsWith(":1"))];
  assert.deepEqual(passageBlocker(p, base, 1, tallyOf(base, differ), 2), { kind: "tc", verse: 1 });
  // more: a single agreement
  assert.deepEqual(passageBlocker(p, base, 1, tallyOf(base, [say("bea", 1, 1)]), 2), { kind: "more" });
  assert.deepEqual(passageBlocker(p, base, 1, new Map(), 2), { kind: "more" }, "sin tally = ningún acuerdo");
});

test("un pasaje que no llegó no tiene lista de acuerdos, ni bloqueo, ni dudas", () => {
  const waiting = { ...base, pending: [{ from: 1, to: 3 }] };
  const p = wholePassage(waiting);
  assert.equal(p.arrived.tpl, false);
  const tallies = tallyOf(base, everyone);
  assert.deepEqual(passageAgreers(p, waiting, 1, tallies), []);
  assert.deepEqual(passageAgreement(p, waiting, 1, tallies, "bea"), { verses: [], othersDoubt: [], myDoubt: [], changed: [] });
  assert.equal(passageBlocker(p, waiting, 1, tallies, 2), null);
  assert.deepEqual(openDoubts([p], waiting, 1, tallies, [], "bea"), []);
});

test("las dudas abiertas: primero las mías, luego las demás, cada grupo por versículo", () => {
  const p = wholePassage(base);
  const decisions = [say("carla", 1, 1, "revise", "a"), say("bea", 2, 2, "revise", "b"), say("bea", 3, 3, "revise", "c"), say("carla", 3, 4, "revise", "d")];
  const rows = openDoubts([p], base, 1, tallyOf(base, decisions), decisions, "bea");
  assert.deepEqual(rows.map((r) => [r.verse, r.mine]), [[2, true], [3, true], [1, false]]);
});

test("la conversación de un versículo guarda lo dicho con nota, también una duda retirada y lo dicho sobre un texto anterior", () => {
  const item = readingItemId("tpl", 1, 2);
  const old = say("carla", 2, 1, "revise", "¿oro o ruego?", "Dos viejo.");
  const withdrawn = say("carla", 2, 7, "approved", "tienes razón, retiro la duda");
  const reply = say("bea", 2, 5, "approved", "el original dice oro");
  const noNote = say("dora", 2, 6);
  const other = say("bea", 3, 5, "approved", "otro versículo");
  const rows = verseConversation([withdrawn, noNote, other, reply, old, say("eva", 2, 8, "revise", "   ")], item, textFingerprint(base.verses[2]!));
  assert.deepEqual(rows.map((r) => [r.reviewer, r.status, r.note, r.earlier]), [
    ["carla", "revise", "¿oro o ruego?", true],
    ["bea", "approved", "el original dice oro", false],
    ["carla", "approved", "tienes razón, retiro la duda", false],
  ]);
  assert.equal(rows[0]!.timestamp, old.timestamp);
  assert.equal(verseConversation([old], item, undefined)[0]!.earlier, false, "sin texto actual no se puede decir que es anterior");
});

console.log(`\nverify-group-reading: ${passed} checks passed.`);
