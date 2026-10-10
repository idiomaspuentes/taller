/**
 * Verse-ordered merge: two task branches fill different NEH portions.
 * Run: npx tsx scripts/verify-usfm-merge.mts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyVerseEdits,
  buildBookUsfmSkeleton,
  draftSlots,
  listVerseSpans,
  parseRefRange,
  portionRange,
  skeletonUsfmFromSource,
} from "../src/domain/usfmEdit.ts";
import { rangeLabelForPortions } from "../src/domain/workOrder.ts";
import { draftLaunch, loadDraftCache, saveDraftCache } from "../src/domain/draftCache.ts";
import type { SolverLaunchContext } from "../src/domain/solverLaunch.ts";
import { mergeUsfmBranchesWithGit } from "../src/domain/usfmGitMerge.ts";
import { mergeIntoTrunkWithRetry } from "../src/domain/trunkMerge.ts";
import {
  formatVerseConflictsComment,
  parseVerseConflictsComment,
  summarizeVerseConflicts,
} from "../src/domain/verseConflicts.ts";
import { mergeUsfmByVerse, verseSlotsOf } from "../src/domain/usfmVerseMerge.ts";
import { patchTrunkByVerse } from "../src/domain/usfmTrunkPatch.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ultNehemiah = `\\id NEH unfoldingWord Literal Text
\\usfm 3.0
\\ide UTF-8
\\h Nehemiah
\\c 1
\\p
\\v 1 The words of Nehemiah.
\\v 2 Hanani came with men from Judah.
\\v 3 They said to me.
\\c 2
\\p
\\v 1 In the month of Nisan.
\\v 2 The king said to me.
`;

const skeleton = skeletonUsfmFromSource("NEH", ultNehemiah);
assert(/\\id NEH/.test(skeleton) && /\\c 1/.test(skeleton) && /\\p/.test(skeleton), "id/c/p present");
assert(/\\usfm 3.0/.test(skeleton) && /\\ide UTF-8/.test(skeleton), "identification markers");
assert(listVerseSpans(skeleton).map((s) => `${s.chapter}:${s.verse}`).join(",") === "1:1,1:2,1:3,2:1,2:2", "all ULT verses slotted");
assert(!/The words of Nehemiah/.test(skeleton), "does not copy English text");

const branchA = applyVerseEdits(skeleton, 1, [
  { verse: 1, text: "Palabras de Nehemías." },
  { verse: 2, text: "Hanani vino de Judá." },
]);
const branchB = applyVerseEdits(skeleton, 1, [
  { verse: 3, text: "Me dijeron esto." },
]);
const branchBch2 = applyVerseEdits(branchB, 2, [
  { verse: 1, text: "En el mes de Nisán." },
]);

const merged = mergeUsfmByVerse(skeleton, [branchA, branchBch2]);
const verses = listVerseSpans(merged.usfm);
assert(verses.map((s) => `${s.chapter}:${s.verse}`).join(",") === "1:1,1:2,1:3,2:1,2:2", "merged keeps book order");
assert(verses.find((s) => s.chapter === 1 && s.verse === 1)?.text.includes("Nehemías"), "keeps A 1:1");
assert(verses.find((s) => s.chapter === 1 && s.verse === 2)?.text.includes("Hanani"), "keeps A 1:2");
assert(verses.find((s) => s.chapter === 1 && s.verse === 3)?.text.includes("dijeron"), "keeps B 1:3");
assert(verses.find((s) => s.chapter === 2 && s.verse === 1)?.text.includes("Nisán"), "keeps B 2:1");
assert(verses.find((s) => s.chapter === 2 && s.verse === 2)?.text === "", "empty 2:2 not dropped");

const fallback = buildBookUsfmSkeleton({
  book: "NEH",
  fallbackRange: { chapter: 1, from: 10, to: 11 },
});
assert(/\\v 10/.test(fallback) && /\\v 11/.test(fallback) && /\\p/.test(fallback), "portion fallback skeleton");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tas-usfm-merge-"));
try {
  const gitMerged = await mergeUsfmBranchesWithGit({
    fs,
    dir,
    filepath: "16-NEH.usfm",
    baseUsfm: skeleton,
    oursUsfm: branchA,
    theirsUsfm: branchBch2,
  });
  const gitVerses = listVerseSpans(gitMerged.usfm);
  assert(
    gitVerses.map((s) => `${s.chapter}:${s.verse}`).join(",") === "1:1,1:2,1:3,2:1,2:2",
    "git+verse merge keeps order",
  );
  assert(gitVerses.some((s) => s.text.includes("Nehemías")), "git merge kept A");
  assert(gitVerses.some((s) => s.text.includes("Nisán")), "git merge kept B");
  assert(!gitMerged.conflicts.length, "different verses are not conflicts");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── Slice 1: three-way + portion scope + trunk retry ────────────────────

const outputs: string[] = [merged.usfm];

function book1(verses: Record<number, string>): string {
  const lines = ["\\id NEH", "\\usfm 3.0", "\\c 1", "\\p"];
  for (const [v, text] of Object.entries(verses)) {
    lines.push(text ? `\\v ${v} ${text}` : `\\v ${v}`);
  }
  return `${lines.join("\n")}\n`;
}

function textAt(usfm: string, chapter: number, verse: number): string | undefined {
  return listVerseSpans(usfm).find((s) => s.chapter === chapter && s.verse === verse)?.text;
}

function track<T extends { usfm: string }>(result: T): T {
  outputs.push(result.usfm);
  return result;
}

{
  // libro-lleno-no-sobrescribe
  const ancestor = book1({ 10: "O10", 11: "O11", 12: "O12", 13: "O13" });
  const trunk = book1({ 10: "A10", 11: "A11", 12: "O12", 13: "O13" });
  const bob = book1({ 10: "O10", 11: "O11", 12: "B12", 13: "B13" });
  const scope = { chapter: 1, from: 12, to: 13 };
  for (const [label, opts] of [
    ["ancestro", { ancestor }],
    ["alcance", { scope }],
    ["ambos", { ancestor, scope }],
  ] as const) {
    const r = track(mergeUsfmByVerse(trunk, [bob], opts));
    assert(textAt(r.usfm, 1, 10) === "A10", `libro-lleno-no-sobrescribe (${label}): 1:10 = A10`);
    assert(textAt(r.usfm, 1, 12) === "B12", `libro-lleno-no-sobrescribe (${label}): 1:12 = B12`);
    if ("ancestor" in opts) {
      assert(r.conflicts.length === 0, `libro-lleno-no-sobrescribe (${label}): sin conflictos`);
    } else {
      // Without an ancestor every filled text competes: O12/O13 vs B12/B13
      // are two-way conflicts inside the portion, never on 1:10–11.
      assert(
        r.conflicts.every((c) => c.chapter === 1 && c.from >= 12 && c.to <= 13),
        `libro-lleno-no-sobrescribe (${label}): conflictos solo en la porción`,
      );
    }
  }
  // Documents the two-way bug: without options, Bob's stale 1:10 wins.
  const bug = track(mergeUsfmByVerse(trunk, [bob]));
  assert(textAt(bug.usfm, 1, 10) === "O10", "libro-lleno-no-sobrescribe: sin opciones gana el texto viejo");
}

{
  // solape-sin-tocar / solape-con-cambio
  const ancestor = book1({ 11: "O11" });
  const trunk = book1({ 11: "A11" });
  const untouched = track(mergeUsfmByVerse(trunk, [book1({ 11: "O11" })], { ancestor }));
  assert(textAt(untouched.usfm, 1, 11) === "A11", "solape-sin-tocar: queda A11");
  assert(untouched.conflicts.length === 0, "solape-sin-tocar: sin conflicto");
  const changed = track(mergeUsfmByVerse(trunk, [book1({ 11: "B11" })], { ancestor }));
  assert(textAt(changed.usfm, 1, 11) === "B11", "solape-con-cambio: gana B11");
  assert(changed.conflicts.length === 1, "solape-con-cambio: un conflicto");
}

{
  // vaciar-no-propaga
  const ancestor = book1({ 12: "X" });
  const r = track(mergeUsfmByVerse(ancestor, [book1({ 12: "" })], { ancestor }));
  assert(textAt(r.usfm, 1, 12) === "X", "vaciar-no-propaga: queda X");
}

{
  // identico-trim-nfc
  const composed = "caf\u00e9";
  const decomposed = "cafe\u0301";
  const r = track(mergeUsfmByVerse(book1({ 1: composed }), [book1({ 1: `${decomposed}   ` })]));
  assert(r.conflicts.length === 0, "identico-trim-nfc: sin conflicto");
  assert(r.usfm === r.usfm.normalize("NFC"), "identico-trim-nfc: salida NFC");
  assert(textAt(r.usfm, 1, 1) === composed, "identico-trim-nfc: texto NFC");
}

function shaError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

{
  // reintento-sha
  const incoming = book1({ 1: "", 2: "Entrante 2" });
  const scope = { chapter: 1, from: 2, to: 2 };
  const reads = [book1({ 1: "", 2: "" }), book1({ 1: "Ajeno 1", 2: "" })];
  let readCount = 0;
  const writes: string[] = [];
  let writeCalls = 0;
  const out = await mergeIntoTrunkWithRetry(
    {
      read: async () => ({ text: reads[Math.min(readCount++, reads.length - 1)]!, sha: `sha${readCount}` }),
      write: async (text) => {
        writeCalls++;
        if (writeCalls === 1) throw shaError(409);
        writes.push(text);
      },
      isShaConflict: (err) => (err as { status?: number }).status === 409,
    },
    (t) => mergeUsfmByVerse(t, [incoming], { scope }),
  );
  track(out.result);
  assert(writes.length === 1, "reintento-sha: una escritura efectiva");
  assert(out.attempts === 2 && out.wrote, "reintento-sha: attempts === 2");
  assert(textAt(writes[0]!, 1, 1) === "Ajeno 1", "reintento-sha: conserva 1:1 ajeno");
  assert(textAt(writes[0]!, 1, 2) === "Entrante 2", "reintento-sha: escribe el entrante");
}

{
  // reintento-agotado
  let writeCalls = 0;
  let rejected = false;
  try {
    await mergeIntoTrunkWithRetry(
      {
        read: async () => ({ text: book1({ 1: "" }), sha: "s" }),
        write: async () => {
          writeCalls++;
          throw shaError(409);
        },
        isShaConflict: (err) => (err as { status?: number }).status === 409,
      },
      (t) => mergeUsfmByVerse(t, [book1({ 1: "x" })]),
    );
  } catch {
    rejected = true;
  }
  assert(rejected && writeCalls === 3, "reintento-agotado: rechaza tras 3 escrituras");
}

{
  // error-no-sha-se-propaga
  let writeCalls = 0;
  let rejected = false;
  try {
    await mergeIntoTrunkWithRetry(
      {
        read: async () => ({ text: book1({ 1: "" }), sha: "s" }),
        write: async () => {
          writeCalls++;
          throw shaError(500);
        },
        isShaConflict: (err) => (err as { status?: number }).status === 409,
      },
      (t) => mergeUsfmByVerse(t, [book1({ 1: "x" })]),
    );
  } catch {
    rejected = true;
  }
  assert(rejected && writeCalls === 1, "error-no-sha-se-propaga: rechaza a la primera");
}

{
  // sin-cambios-no-escribe
  let writeCalls = 0;
  const same = book1({ 1: "igual" });
  const out = await mergeIntoTrunkWithRetry(
    {
      read: async () => ({ text: same, sha: "s" }),
      write: async () => {
        writeCalls++;
      },
      isShaConflict: () => false,
    },
    (t) => ({ usfm: t, conflicts: [], warnings: [] }),
  );
  assert(!out.wrote && writeCalls === 0, "sin-cambios-no-escribe");
}

// ── Slice 2: range slots (P1–P9) ────────────────────────────────────────

function ch1(lines: string[]): string {
  return `${["\\id NEH", "\\usfm 3.0", "\\c 1", "\\p", ...lines].join("\n")}\n`;
}

function verseLines(usfm: string): string[] {
  return usfm.split("\n").filter((l) => l.startsWith("\\v "));
}

{
  // span-parse
  const spans = listVerseSpans(ch1(["\\v 10-11 X", "\\v 12 Y"]));
  assert(
    spans.map((s) => `${s.verse}-${s.verseTo}`).join(",") === "10-11,12-12",
    "span-parse: (10,11) y (12,12)",
  );
  const dash = listVerseSpans(ch1(["\\v 10–11 X"]));
  assert(dash[0]?.verseTo === 11, "span-parse: tolera guion largo");
  const bad = listVerseSpans(ch1(["\\v 11-10 X"]));
  assert(bad[0]?.verse === 11 && bad[0].verseTo === 11 && bad[0].rangeInvalid, "span-parse: rango inválido");
}

{
  // span-vs-esqueleto (P2)
  const r = track(mergeUsfmByVerse(ch1(["\\v 10", "\\v 11"]), [ch1(["\\v 10-11 X"])]));
  assert(verseLines(r.usfm).join("|") === "\\v 10-11 X", "span-vs-esqueleto: una línea \\v 10-11 X");
  assert(r.conflicts.length === 0, "span-vs-esqueleto: sin conflicto");
}

{
  // span-lleno-vs-sueltos-vacios (P3)
  const r = track(mergeUsfmByVerse(ch1(["\\v 10-11 X"]), [ch1(["\\v 10", "\\v 11"])]));
  assert(verseLines(r.usfm).join("|") === "\\v 10-11 X", "span-lleno-vs-sueltos-vacios: queda el puente");
  assert(r.conflicts.length === 0, "span-lleno-vs-sueltos-vacios: sin conflicto");
}

{
  // span-disjunto (P1)
  const base = ch1(["\\v 10", "\\v 11", "\\v 12"]);
  const r = track(mergeUsfmByVerse(base, [ch1(["\\v 10-11 X", "\\v 12"]), ch1(["\\v 10", "\\v 11", "\\v 12 Y"])]));
  assert(verseLines(r.usfm).join("|") === "\\v 10-11 X|\\v 12 Y", "span-disjunto: ambos en orden");
  assert(r.conflicts.length === 0, "span-disjunto: sin conflicto");
}

{
  // span-igual (P4) / span-mismo-rango-distinto-texto (P5)
  const same = track(mergeUsfmByVerse(ch1(["\\v 10-11 X"]), [ch1(["\\v 10-11 X"])]));
  assert(verseLines(same.usfm).join("|") === "\\v 10-11 X" && !same.conflicts.length, "span-igual");
  const diff = track(mergeUsfmByVerse(ch1(["\\v 10-11 X"]), [ch1(["\\v 10-11 Z"])]));
  assert(verseLines(diff.usfm).join("|") === "\\v 10-11 Z", "span-mismo-rango-distinto-texto: último lado");
  assert(
    diff.conflicts.length === 1 && diff.conflicts[0]!.kind === "texto" && diff.conflicts[0]!.kept === "ultimo",
    "span-mismo-rango-distinto-texto: kind texto",
  );
}

{
  // span-vs-dos-llenos (P8)
  const r = track(mergeUsfmByVerse(ch1(["\\v 10-11 X"]), [ch1(["\\v 10 a", "\\v 11 b"])]));
  assert(verseLines(r.usfm).join("|") === "\\v 10-11 X", "span-vs-dos-llenos: el tronco sigue igual");
  assert(r.conflicts.length === 1 && r.conflicts[0]!.kind === "estructura", "span-vs-dos-llenos: estructura");
  assert(r.conflicts[0]!.kept === "tronco", "span-vs-dos-llenos: kept tronco");
  assert(!/\\v 1[01] [ab]\b/.test(r.usfm) && !/X a|a b/.test(r.usfm), "span-vs-dos-llenos: ni a ni b");
}

{
  // span-vs-uno-lleno
  const r = track(mergeUsfmByVerse(ch1(["\\v 10-11 X"]), [ch1(["\\v 10", "\\v 11 b"])]));
  assert(verseLines(r.usfm).join("|") === "\\v 10-11 X", "span-vs-uno-lleno: el tronco sigue igual");
  assert(r.conflicts.length === 1 && r.conflicts[0]!.kind === "estructura", "span-vs-uno-lleno: estructura");
}

{
  // spans-solapados (P9)
  const r = track(mergeUsfmByVerse(ch1(["\\v 10-11 X", "\\v 12"]), [ch1(["\\v 10", "\\v 11-12 Y"])]));
  assert(verseLines(r.usfm).join("|") === "\\v 10-11 X|\\v 12", "spans-solapados: el tronco sigue igual");
  const c = r.conflicts[0];
  assert(r.conflicts.length === 1 && c?.kind === "estructura" && c.from === 10 && c.to === 12, "spans-solapados: estructura 10–12");
}

{
  // span-vacio-pierde (P7)
  const r = track(
    mergeUsfmByVerse(ch1(["\\v 10-11"]), [ch1(["\\v 10 a", "\\v 11"]), ch1(["\\v 10", "\\v 11 b"])]),
  );
  assert(verseLines(r.usfm).join("|") === "\\v 10 a|\\v 11 b", "span-vacio-pierde: 10 a, 11 b");
  assert(r.conflicts.length === 0, "span-vacio-pierde: sin conflicto");
}

{
  // separar-con-ancestro
  const ancestor = ch1(["\\v 10-11 X"]);
  const r = track(mergeUsfmByVerse(ancestor, [ch1(["\\v 10 a", "\\v 11 b"])], { ancestor }));
  assert(verseLines(r.usfm).join("|") === "\\v 10 a|\\v 11 b", "separar-con-ancestro: gana la separación");
  assert(r.conflicts.length === 0, "separar-con-ancestro: sin conflicto");
}

{
  // span-fuera-de-porcion
  const r = track(
    mergeUsfmByVerse(ch1(["\\v 10", "\\v 11", "\\v 12", "\\v 13"]), [ch1(["\\v 10-11 Z", "\\v 12", "\\v 13"])], {
      scope: { chapter: 1, from: 11, to: 13 },
    }),
  );
  assert(verseLines(r.usfm).join("|") === "\\v 10-11 Z|\\v 12|\\v 13", "span-fuera-de-porcion: entra por intersección");
}

{
  // segmentos-10a-10b
  const r = track(mergeUsfmByVerse(ch1(["\\v 10a a1", "\\v 10b a2", "\\v 11"]), []));
  assert(verseLines(r.usfm).join("|") === "\\v 10 a1 a2|\\v 11", "segmentos-10a-10b: un solo \\v 10");
  assert(r.warnings.some((w) => w.kind === "segmento" && w.verse === 10), "segmentos-10a-10b: aviso segmento");
  const dup = track(mergeUsfmByVerse(ch1(["\\v 3 uno", "\\v 3 dos"]), []));
  assert(verseLines(dup.usfm).join("|") === "\\v 3 dos", "verso-duplicado: gana el último");
  assert(dup.warnings.some((w) => w.kind === "duplicado" && w.verse === 3), "verso-duplicado: aviso");
}

{
  // nota-y-titulo-no-entran
  const marked = ch1(["\\v 1 Texto base \\f + \\ft nota\\f* sigue.", "\\s1 Título", "\\v 2 Dos"]);
  const plain = ch1(["\\v 1 Texto base sigue.", "\\v 2 Dos"]);
  const r = track(mergeUsfmByVerse(marked, [plain]));
  assert(!/nota|Título/.test(r.usfm), "nota-y-titulo-no-entran: sin nota ni título");
  assert(r.conflicts.length === 0, "nota-y-titulo-no-entran: sin conflicto");
}

// ── Slice 3: conflicts comment + beforeWrite ────────────────────────────

{
  // comentario-roundtrip / comentario-legible
  const tricky = "texto con } y --> y <<<<<<< dentro";
  const conflicts = mergeUsfmByVerse(ch1(["\\v 10-11 Del tronco"]), [ch1([`\\v 10-11 ${tricky}`])]).conflicts;
  assert(conflicts.length === 1, "comentario: hay un conflicto de texto");
  const x = { schema: "tas-verse-conflicts-1" as const, issue: 42, bookRef: "neh/tpl-draft", trunkSha: "abc123", conflicts };
  const body = formatVerseConflictsComment({
    issueNumber: x.issue,
    bookRef: x.bookRef,
    trunkSha: x.trunkSha,
    book: "NEH",
    conflicts,
  });
  const parsed = parseVerseConflictsComment(body);
  assert(JSON.stringify(parsed) === JSON.stringify(x), "comentario-roundtrip: parse(format(x)) === x");
  assert(body.includes("Quedó en el borrador grupal"), "comentario-legible: «Quedó en el borrador grupal»");
  assert(body.includes("Del tronco") && body.includes(tricky), "comentario-legible: ambos textos");
  assert((body.match(/tas:verse-conflicts/g) ?? []).length === 1, "comentario-legible: un solo marcador");
}

{
  // reintento-no-pierde-conflicto
  const events: string[] = [];
  const conflictsSeen: number[] = [];
  let writeCalls = 0;
  const reads = [ch1(["\\v 10 A"]), ch1(["\\v 10 A2", "\\v 11 C"])];
  let readCount = 0;
  await mergeIntoTrunkWithRetry(
    {
      read: async () => ({ text: reads[Math.min(readCount++, 1)]!, sha: "s" }),
      beforeWrite: async (result) => {
        events.push("before");
        conflictsSeen.push(result.conflicts.length);
      },
      write: async () => {
        events.push("write");
        writeCalls++;
        if (writeCalls === 1) throw shaError(409);
      },
      isShaConflict: (err) => (err as { status?: number }).status === 409,
    },
    (t) => mergeUsfmByVerse(t, [ch1(["\\v 10 B", "\\v 11 D"])]),
  );
  assert(events.join(",") === "before,write,before,write", "reintento-no-pierde-conflicto: beforeWrite antes de cada write");
  assert(conflictsSeen[1] === 2, "reintento-no-pierde-conflicto: la última llamada lleva los conflictos del intento que escribió");
}

{
  // before-write-falla
  let writeCalls = 0;
  let rejected = false;
  try {
    await mergeIntoTrunkWithRetry(
      {
        read: async () => ({ text: ch1(["\\v 10 A"]), sha: "s" }),
        beforeWrite: async () => {
          throw new Error("comentario falló");
        },
        write: async () => {
          writeCalls++;
        },
        isShaConflict: () => false,
      },
      (t) => mergeUsfmByVerse(t, [ch1(["\\v 10 B"])]),
    );
  } catch {
    rejected = true;
  }
  assert(rejected && writeCalls === 0, "before-write-falla: no escribe y rechaza");
}

// ── Slice 4: Unir / Separar (applyVerseEdits, draftSlots, cache) ────────

{
  // unir-separar-roundtrip
  const skel = ch1(["\\v 9", "\\v 10", "\\v 11", "\\v 12"]);
  const joined = applyVerseEdits(skel, 1, [{ from: 10, to: 11, text: "X" }]);
  assert(verseLines(joined).join("|") === "\\v 9|\\v 10-11 X|\\v 12", "unir-separar-roundtrip: un \\v 10-11 X entre 9 y 12");
  const split = applyVerseEdits(joined, 1, [
    { from: 10, to: 10, text: "X" },
    { from: 11, to: 11, text: "" },
  ]);
  assert(verseLines(split).join("|") === "\\v 9|\\v 10 X|\\v 11|\\v 12", "unir-separar-roundtrip: separa en su sitio");
}

{
  // unir-puente-existente
  const out = applyVerseEdits(ch1(["\\v 10-11 X", "\\v 12 Y"]), 1, [{ from: 10, to: 12, text: "X Y" }]);
  assert(verseLines(out).join("|") === "\\v 10-12 X Y", "unir-puente-existente: \\v 10-12 X Y");
}

{
  // insertar-en-orden
  const out = applyVerseEdits(ch1(["\\v 9 a", "\\v 11 c", "\\v 12 d"]), 1, [{ verse: 10, text: "b" }]);
  assert(verseLines(out).join("|") === "\\v 9 a|\\v 10 b|\\v 11 c|\\v 12 d", "insertar-en-orden: 10 entre 9 y 11");
  const first = applyVerseEdits(ch1(["\\v 11 c"]), 1, [{ verse: 10, text: "b" }]);
  assert(verseLines(first).join("|") === "\\v 10 b|\\v 11 c", "insertar-en-orden: antes del primer mayor");
}

{
  // esqueleto-con-puente-fuente
  const source = `\\id NEH\n\\c 1\n\\p\n\\v 9 Nine.\n\\v 10-11 Ten and eleven.\n\\v 12 Twelve.\n`;
  const skel = skeletonUsfmFromSource("NEH", source);
  assert(verseLines(skel).join("|") === "\\v 9|\\v 10-11|\\v 12", "esqueleto-con-puente-fuente: conserva \\v 10-11 vacío");
}

{
  // draft-slots-fuera-de-porcion
  const rows = draftSlots(ch1(["\\v 10-11 X", "\\v 12", "\\v 13"]), { chapter: 1, from: 11, to: 13 });
  assert(
    rows.map((r) => `${r.from}-${r.to}`).join(",") === "10-11,12-12,13-13",
    "draft-slots-fuera-de-porcion: fila (10,11)",
  );
  const seg = draftSlots(ch1(["\\v 10a uno", "\\v 10b dos"]), { chapter: 1, from: 10, to: 10 });
  assert(seg.length === 1 && seg[0]!.text === "uno dos", "draft-slots: une segmentos 10a/10b");
}

{
  // cache-claves-rango
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const launch = draftLaunch(
    { pmOrg: "org", issueNumber: 7, taskId: "tpl", contentOrg: "org", lang: "es-419", resource: "tpl", book: "NEH", projectId: "NEH", chapter: 1, ref: "1:9–12" } as SolverLaunchContext,
    "https://door43.test",
    { book: "NEH", username: "ana", taskId: "tpl", issueNumber: 7 },
  );
  saveDraftCache(launch, { verses: { "9": "a", "10-11": "b", "x": "no" }, savedAt: 1 });
  const loaded = loadDraftCache(launch).own;
  assert(loaded?.verses["10-11"] === "b" && loaded.verses["9"] === "a", "cache-claves-rango: conserva \"10-11\"");
  assert(!("x" in (loaded?.verses ?? {})), "cache-claves-rango: descarta claves inválidas");
}

{
  // Encadenado con el slice 2: rama con puente guardado sobre el esqueleto (P2)
  const skel = ch1(["\\v 9", "\\v 10", "\\v 11", "\\v 12"]);
  const branch = applyVerseEdits(skel, 1, [{ from: 10, to: 11, text: "Puente" }]);
  const r = track(mergeUsfmByVerse(skel, [branch], { ancestor: skel, scope: { chapter: 1, from: 10, to: 11 } }));
  assert(verseLines(r.usfm).join("|") === "\\v 9|\\v 10-11 Puente|\\v 12", "encadenado: el puente llega al tronco");
  assert(r.conflicts.length === 0, "encadenado: sin conflicto");
}

// ── Slice 5: isomorphic-git is transport, not resolution ────────────────

async function withGitDir<T>(run: (gitDir: string) => Promise<T>): Promise<T> {
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "tas-usfm-git-"));
  try {
    return await run(gitDir);
  } finally {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
}

{
  // git-choca-verso-no
  const base = "\\c 1\n\\p\n\\v 1\n";
  const ours = "\\c 1\n\\p\n\\v 1\n\\v 2 a\n";
  const theirs = "\\c 1\n\\p\n\\v 1\n\\v 3 b\n";
  const r = await withGitDir((gitDir) =>
    mergeUsfmBranchesWithGit({ fs, dir: gitDir, filepath: "16-NEH.usfm", baseUsfm: base, oursUsfm: ours, theirsUsfm: theirs }),
  );
  track(r);
  assert(r.gitLineConflict === true, "git-choca-verso-no: Git choca por líneas");
  assert(r.conflicts.length === 0, "git-choca-verso-no: sin conflicto de versículo");
  assert(verseLines(r.usfm).join("|") === "\\v 1|\\v 2 a|\\v 3 b", "git-choca-verso-no: 1, 2 a, 3 b en orden");
}

{
  // git-tres-vias
  const ancestor = book1({ 10: "O10", 11: "O11", 12: "O12", 13: "O13" });
  const trunk = book1({ 10: "A10", 11: "A11", 12: "O12", 13: "O13" });
  const bob = book1({ 10: "O10", 11: "O11", 12: "B12", 13: "B13" });
  const r = await withGitDir((gitDir) =>
    mergeUsfmBranchesWithGit({ fs, dir: gitDir, filepath: "16-NEH.usfm", baseUsfm: ancestor, oursUsfm: trunk, theirsUsfm: bob }),
  );
  track(r);
  assert(textAt(r.usfm, 1, 10) === "A10", "git-tres-vias: 1:10 = A10");
  assert(textAt(r.usfm, 1, 12) === "B12", "git-tres-vias: 1:12 = B12");
  assert(r.conflicts.length === 0, "git-tres-vias: sin conflictos");
}

// ── Cerrar hardening: strict range, lot titles, head re-read, summary ───

{
  // rango-estricto
  const eq = (r: unknown, s: string) => JSON.stringify(r) === s;
  assert(eq(parseRefRange("1:10–11"), '{"chapter":1,"from":10,"to":11}'), "rango: 1:10–11");
  assert(eq(parseRefRange("NEH 13:30 · TPL"), '{"chapter":13,"from":30,"to":30}'), "rango: 13:30");
  assert(parseRefRange("NEH") === null && parseRefRange("") === null, "rango: sin c:v es null");
  assert(eq(parseRefRange("1:1–8–9–12"), '{"chapter":1,"from":1,"to":12}'), "rango: lote viejo encadenado");
  assert(parseRefRange("1:9–11–1–4") === null, "rango: cadena que retrocede es null");
  assert(parseRefRange("1:9–11–2:1–4") === null, "rango: dos capítulos es null");
  assert(eq(portionRange("1:9–11–2:1–4", 1), '{"chapter":1,"from":9,"to":11}'), "editor: muestra el primer tramo");
  assert(eq(portionRange("NEH", 3), '{"chapter":3,"from":1,"to":1}'), "editor: 3:1 solo para mostrar");
}

{
  // titulo-de-lote
  const portions = [
    { ref: "NEH 1:1-8", chapter: 1, verses: [1, 8] },
    { ref: "NEH 1:9-12", chapter: 1, verses: [9, 12] },
    { ref: "NEH 2:1-4", chapter: 2, verses: [1, 4] },
  ] as unknown as Parameters<typeof rangeLabelForPortions>[2];
  const same = rangeLabelForPortions("NEH", ["NEH 1:1-8", "NEH 1:9-12"], portions);
  assert(same === "1:1–12", `titulo-de-lote: mismo capítulo (${same})`);
  assert(JSON.stringify(parseRefRange(same)) === '{"chapter":1,"from":1,"to":12}', "titulo-de-lote: Cerrar lee todo el lote");
  const cross = rangeLabelForPortions("NEH", ["NEH 1:9-12", "NEH 2:1-4"], portions);
  assert(parseRefRange(cross) === null, `titulo-de-lote: entre capítulos no se fusiona a ciegas (${cross})`);
  assert(rangeLabelForPortions("NEH", ["NEH 2:1-4"], portions) === "2:1–4", "titulo-de-lote: una porción");
}

{
  // reintento-relee-rama
  let headReads = 0;
  let writeCalls = 0;
  const heads = [book1({ 1: "viejo" }), book1({ 1: "nuevo" })];
  const writes: string[] = [];
  await mergeIntoTrunkWithRetry(
    {
      read: async () => ({ text: book1({ 1: "" }), sha: "s" }),
      write: async (text) => {
        if (++writeCalls === 1) throw shaError(409);
        writes.push(text);
      },
      isShaConflict: (err) => (err as { status?: number }).status === 409,
    },
    async (t) => mergeUsfmByVerse(t, [heads[Math.min(headReads++, 1)]!]),
  );
  assert(headReads === 2, "reintento-relee-rama: una lectura de la rama por intento");
  assert(textAt(writes[0]!, 1, 1) === "nuevo", "reintento-relee-rama: escribe el texto releído");
}

{
  // resumen-conflictos
  const conflicts = mergeUsfmByVerse(ch1(["\\v 10-11 X"]), [ch1(["\\v 10 a", "\\v 11 b"])]).conflicts;
  const line = summarizeVerseConflicts({ issue: 42, conflicts });
  assert(line === "1:10–11 estructura (quedó el borrador grupal)", `resumen-conflictos: ${line}`);
  const body = formatVerseConflictsComment({ issueNumber: 42, bookRef: "neh/t", book: "NEH", conflicts });
  assert(summarizeVerseConflicts(parseVerseConflictsComment(body)!) === line, "resumen-conflictos: desde el comentario");
}

// ── Option A: Cerrar patches the trunk instead of rebuilding the book ───

const poetryTrunk = [
  "\\id NEH unfoldingWord Literal Text",
  "\\usfm 3.0",
  "\\h Nehemías",
  "\\c 1",
  "\\p",
  "\\v 1 Palabras de Nehemías.",
  ...Array.from({ length: 8 }, (_, i) => `\\v ${i + 2} Verso ${i + 2}.`),
  "\\q1",
  "\\v 10 Viejo diez.",
  "\\q2 Sigue el diez.",
  "\\q1",
  "\\v 11 Once poético,",
  "\\q2 segunda línea del once.",
  "\\s1 Oración",
  "\\p",
  "\\v 12 Doce.",
  "",
].join("\n");
const oldTen = "\\v 10 Viejo diez.\n\\q2 Sigue el diez.\n";

{
  // parche-1-10: only 1:10 changes; 1:1, poetry and headings stay byte-identical
  const sideLine = "\\v 10 Nuevo \\w diez|x-strong=\"H1\"\\w* aquí.";
  const side = poetryTrunk.replace(oldTen, `${sideLine}\n`);
  const r = track(patchTrunkByVerse(poetryTrunk, [side], {
    ancestor: poetryTrunk,
    scope: { chapter: 1, from: 10, to: 10 },
  }));
  const expected = poetryTrunk.replace(oldTen, `${sideLine}\n`);
  assert(r.usfm === expected, "parche-1-10: solo cambia la línea del 1:10");
  assert(r.usfm.startsWith("\\id NEH unfoldingWord Literal Text\n\\usfm 3.0\n\\h Nehemías\n"), "parche-1-10: cabecera intacta");
  assert(r.usfm.includes("\\v 1 Palabras de Nehemías.\n"), "parche-1-10: 1:1 intacto");
  assert(r.usfm.includes("\\v 11 Once poético,\n\\q2 segunda línea del once.\n\\s1 Oración\n\\p\n"), "parche-1-10: poesía fuera de la porción intacta");
  assert(r.usfm.includes(`${sideLine}\n`), "parche-1-10: la línea ganadora es idéntica a la del lado");
  assert(r.patched.length === 1 && r.patched[0]!.from === 10 && r.patched[0]!.to === 10, "parche-1-10: un grupo parcheado");
}

{
  // parche-fuera-de-porcion-ignorado: a side edit outside the scope never lands
  const side = poetryTrunk
    .replace(oldTen, "\\v 10 Nuevo diez.\n")
    .replace("\\v 1 Palabras de Nehemías.", "\\v 1 Otro uno.");
  const r = track(patchTrunkByVerse(poetryTrunk, [side], {
    ancestor: poetryTrunk,
    scope: { chapter: 1, from: 10, to: 10 },
  }));
  assert(r.usfm.includes("\\v 1 Palabras de Nehemías.\n") && !r.usfm.includes("Otro uno"), "parche-fuera-de-porcion: 1:1 sigue igual");
}

{
  // parche-crlf: CRLF trunk stays CRLF, synthesized lines too
  const crlf = poetryTrunk.replace(/\n/g, "\r\n");
  const side = poetryTrunk.replace(oldTen, "\\v 10 Nuevo diez.\n");
  const r = track(patchTrunkByVerse(crlf, [side], {
    ancestor: crlf,
    scope: { chapter: 1, from: 10, to: 10 },
  }));
  assert(!/(^|[^\r])\n/.test(r.usfm), "parche-crlf: ningún LF suelto");
  assert(r.usfm === crlf.replace(oldTen.replace(/\n/g, "\r\n"), "\\v 10 Nuevo diez.\r\n"), "parche-crlf: solo cambia el 1:10");
}

{
  // parche-sin-cambios: unchanged portion → identical text → no content write
  const r = track(patchTrunkByVerse(poetryTrunk, [poetryTrunk], {
    ancestor: poetryTrunk,
    scope: { chapter: 1, from: 10, to: 11 },
  }));
  assert(r.usfm === poetryTrunk && r.patched.length === 0, "parche-sin-cambios: mismo texto");
  let writeCalls = 0;
  const out = await mergeIntoTrunkWithRetry(
    {
      read: async () => ({ text: poetryTrunk, sha: "s" }),
      write: async () => {
        writeCalls++;
      },
      isShaConflict: () => false,
    },
    (t) => patchTrunkByVerse(t, [poetryTrunk], { ancestor: poetryTrunk, scope: { chapter: 1, from: 10, to: 11 } }),
  );
  assert(!out.wrote && writeCalls === 0, "parche-sin-cambios: no escribe");
}

{
  // parche-trunk-ajeno: someone else's 1:12 on the trunk survives
  const ancestor = poetryTrunk;
  const trunk = poetryTrunk.replace("\\v 12 Doce.", "\\v 12 Doce de otro.");
  const side = poetryTrunk.replace(oldTen, "\\v 10 Nuevo diez.\n");
  const r = track(patchTrunkByVerse(trunk, [side], { ancestor, scope: { chapter: 1, from: 10, to: 10 } }));
  assert(r.usfm === trunk.replace(oldTen, "\\v 10 Nuevo diez.\n"), "parche-trunk-ajeno: conserva 1:12 del tronco");
}

{
  // parche-estructura: bridge vs split with text on both sides keeps trunk bytes
  const trunk = ch1(["\\v 9 Nueve.", "\\v 10-11 Puente del tronco.", "\\v 12 Doce."]);
  const side = ch1(["\\v 9 Nueve.", "\\v 10 a", "\\v 11 b", "\\v 12 Doce."]);
  const r = track(patchTrunkByVerse(trunk, [side], { scope: { chapter: 1, from: 10, to: 11 } }));
  assert(r.usfm === trunk, "parche-estructura: el tronco queda byte a byte");
  assert(r.conflicts.length === 1 && r.conflicts[0]!.kind === "estructura", "parche-estructura: conflicto de estructura");
}

{
  // parche-sintetiza: new verse and new span are written as single lines, in order
  const trunk = ch1(["\\v 9 Nueve.", "\\v 12 Doce."]);
  const side = ch1(["\\v 9 Nueve.", "\\v 10-11   Puente   nuevo.", "\\v 12 Doce."]);
  const r = track(patchTrunkByVerse(trunk, [side], { ancestor: trunk, scope: { chapter: 1, from: 10, to: 11 } }));
  assert(verseLines(r.usfm).join("|") === "\\v 9 Nueve.|\\v 10-11   Puente   nuevo.|\\v 12 Doce.", "parche-sintetiza: puente nuevo en su sitio");
  const split = track(patchTrunkByVerse(
    ch1(["\\v 9 Nueve.", "\\v 10-11 X", "\\v 12 Doce."]),
    [ch1(["\\v 9 Nueve.", "\\v 10 a", "\\v 11 b", "\\v 12 Doce."])],
    { ancestor: ch1(["\\v 9 Nueve.", "\\v 10-11 X", "\\v 12 Doce."]), scope: { chapter: 1, from: 10, to: 11 } },
  ));
  assert(verseLines(split.usfm).join("|") === "\\v 9 Nueve.|\\v 10 a|\\v 11 b|\\v 12 Doce.", "parche-sintetiza: separar puente");
  const empty = track(patchTrunkByVerse("\\id NEH\n\\c 1\n\\p\n", [ch1(["\\v 3 Tres."])], { scope: { chapter: 1, from: 3, to: 3 } }));
  assert(empty.usfm === "\\id NEH\n\\c 1\n\\p\n\\v 3 Tres.\n", `parche-sintetiza: capítulo sin versos (${JSON.stringify(empty.usfm)})`);
  const noChapter = track(patchTrunkByVerse("\\id NEH\n\\c 1\n\\p\n\\v 1 Uno.\n", [
    "\\id NEH\n\\c 2\n\\p\n\\v 1 Dos uno.\n",
  ], { scope: { chapter: 2, from: 1, to: 1 } }));
  assert(noChapter.usfm === "\\id NEH\n\\c 1\n\\p\n\\v 1 Uno.\n\\c 2\n\\p\n\\v 1 Dos uno.\n", "parche-sintetiza: capítulo nuevo al final");
}

{
  // parche-igual-al-merge: patched slots equal the full verse merge
  const trunk = ch1(["\\v 1 T1", "\\v 2 T2", "\\v 3", "\\v 4 T4"]);
  const ancestor = ch1(["\\v 1 T1", "\\v 2 O2", "\\v 3", "\\v 4 T4"]);
  const side = ch1(["\\v 1 T1", "\\v 2 B2", "\\v 3 B3", "\\v 4 T4"]);
  const opts = { ancestor, scope: { chapter: 1, from: 2, to: 3 } };
  const p = track(patchTrunkByVerse(trunk, [side], opts));
  const m = mergeUsfmByVerse(trunk, [side], opts);
  assert(JSON.stringify(verseSlotsOf(p.usfm)) === JSON.stringify(verseSlotsOf(m.usfm)), "parche-igual-al-merge: mismos versículos");
  assert(p.conflicts.length === m.conflicts.length, "parche-igual-al-merge: mismos conflictos");
}

{
  // parche-sin-marcadores: conflicting texts never produce Git markers
  const trunk = poetryTrunk.replace(oldTen, "\\v 10 Del tronco.\n");
  const side = poetryTrunk.replace(oldTen, "\\v 10 Del lado.\n");
  const r = track(patchTrunkByVerse(trunk, [side], { ancestor: poetryTrunk, scope: { chapter: 1, from: 10, to: 10 } }));
  assert(!/<<<<<<<|=======|>>>>>>>/.test(r.usfm), "parche-sin-marcadores: sin marcadores Git");
  assert(r.usfm.includes("\\v 10 Del lado.\n") && r.conflicts.length === 1, "parche-sin-marcadores: gana el lado, conflicto anotado");
}

// ── Generic: each number once per chapter; no Git markers ───────────────

for (const usfm of outputs) {
  assert(!/<<<<<<<|=======|>>>>>>>/.test(usfm), "sin-marcadores: ninguna salida tiene marcadores Git");
  const seen = new Set<string>();
  for (const span of listVerseSpans(usfm)) {
    for (let v = span.verse; v <= span.verseTo; v++) {
      const key = `${span.chapter}:${v}`;
      assert(!seen.has(key), `número repetido ${key} en una salida`);
      seen.add(key);
    }
  }
}

console.log("verify-usfm-merge: ok");
