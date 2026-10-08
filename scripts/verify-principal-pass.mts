/**
 * «Pasar al borrador principal»: gate + verse splice + write loop, offline.
 * Run: npm run verify:principal-pass
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import {
  computePrincipalPass,
  passIntoPrincipal,
  passTaskIntoPrincipal,
  previewPrincipalReview,
  principalPassCommitMessage,
  principalPassGate,
  principalReviewConfirmText,
  type PrincipalPassIo,
} from "../src/domain/principalPass.ts";
import { encodeWorkOrderMarker } from "../src/domain/workOrder.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function rejects(fn: () => Promise<unknown>, re: RegExp, msg: string): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    assert(re.test(text), `${msg}: unexpected error «${text}»`);
    return text;
  }
  throw new Error(`${msg}: expected a rejection`);
}

const principal = `\\id NEH Borrador
\\usfm 3.0
\\ide UTF-8
\\h Nehemías
\\c 1
\\s1 Oración de Nehemías
\\p
\\v 1 Palabras de Nehemías.
\\v 2
\\v 3
\\q1
\\v 4
\\v 5 Texto que ya estaba.
\\c 2
\\p
\\v 1 En el mes de Nisán.
\\v 2
`;

const grupal = `\\id NEH Borrador
\\usfm 3.0
\\ide UTF-8
\\h Nehemías
\\c 1
\\p
\\v 1 Palabras de Nehemías.
\\v 2 Hananí vino de Judá.
\\v 3 Me dijeron esto.
\\v 4
\\v 5
\\c 2
\\p
\\v 1 Otro texto del capítulo dos.
\\v 2 Relleno fuera de la tarea.
`;

const range = { chapter: 1, from: 1, to: 4 };

// 1. Empty principal slots take the grupal text; bytes outside the range stay.
{
  const r = computePrincipalPass({ principal, grupal, ranges: [range] });
  assert(r.status === "write", `empty slots: expected write, got ${r.status}`);
  assert(/\\v 2 Hananí vino de Judá\./.test(r.usfm), "1:2 filled from grupal");
  assert(/\\v 3 Me dijeron esto\./.test(r.usfm), "1:3 filled from grupal");
  assert(/\\v 5 Texto que ya estaba\./.test(r.usfm), "1:5 (outside) kept");
  assert(!/Otro texto del capítulo dos/.test(r.usfm), "2:1 (outside) not taken from grupal");
  assert(!/Relleno fuera de la tarea/.test(r.usfm), "2:2 (outside) not taken from grupal");
  const head = principal.slice(0, principal.indexOf("\\v 2"));
  const tail = principal.slice(principal.indexOf("\\q1"));
  assert(r.usfm.startsWith(head), "bytes before the first changed verse are identical");
  assert(r.usfm.endsWith(tail), "bytes after the last changed verse are identical (\\q1, 1:4–2:2)");
  assert(!/^(<{7}|={7}|>{7})/m.test(r.usfm), "no conflict markers");
  console.log("ok  empty principal slot takes grupal text; outside bytes identical");
}

// 1b. CRLF principal: splice keeps CRLF and the untouched bytes.
{
  const crlf = principal.replace(/\n/g, "\r\n");
  const r = computePrincipalPass({ principal: crlf, grupal, ranges: [range] });
  assert(r.status === "write", "crlf: write");
  assert(!/[^\r]\n/.test(r.usfm), "crlf: every newline stays CRLF");
  assert(r.usfm.endsWith(crlf.slice(crlf.indexOf("\\q1"))), "crlf: tail identical");
  console.log("ok  CRLF preserved outside the splice");
}

// 2. Identical text on the range is a no-op (and no write happens).
{
  const same = computePrincipalPass({ principal: grupal, grupal, ranges: [range] });
  assert(same.status === "same", `identical: expected same, got ${same.status}`);
  const filledPrincipal = computePrincipalPass({ principal, grupal, ranges: [range] });
  assert(filledPrincipal.status === "write", "precondition");
  const again = computePrincipalPass({ principal: filledPrincipal.usfm, grupal, ranges: [range] });
  assert(again.status === "same", "second pass is idempotent");

  let writes = 0;
  const io: PrincipalPassIo = {
    readPrincipal: async () => ({ text: filledPrincipal.usfm, sha: "p1" }),
    readGrupal: async () => grupal,
    write: async () => {
      writes++;
    },
    isShaConflict: () => false,
  };
  const out = await passIntoPrincipal(io, { book: "NEH", ranges: [range] });
  assert(out.status === "already" && writes === 0, "already in principal: no commit");
  console.log("ok  identical text is a no-op (no commit)");
}

// 3. Same occupied verse, different non-empty text: abort, principal unchanged.
{
  const conflicting = principal.replace("\\v 1 Palabras de Nehemías.", "\\v 1 Las palabras de Nehemías, hijo de Hacalías.");
  const r = computePrincipalPass({ principal: conflicting, grupal, ranges: [range] });
  assert(r.status === "differ", `differ: expected differ, got ${r.status}`);
  assert(r.verses.length === 1 && r.verses[0]!.chapter === 1 && r.verses[0]!.from === 1, "differ names 1:1");

  const store = { text: conflicting, sha: "p1" };
  const before = store.text;
  let writes = 0;
  const io: PrincipalPassIo = {
    readPrincipal: async () => ({ ...store }),
    readGrupal: async () => grupal,
    write: async (text, sha) => {
      writes++;
      store.text = text;
      store.sha = `${sha}+`;
    },
    isShaConflict: () => false,
  };
  const msg = await rejects(
    () => passIntoPrincipal(io, { book: "NEH", ranges: [range] }),
    /NEH 1:1: ese versículo tiene un texto distinto.*no se cambió el borrador principal/,
    "differ aborts",
  );
  assert(writes === 0 && store.text === before, "principal bytes unchanged after abort");
  assert(!/tronco|rama|fusion|PR\b|SHA|master|\bref\b/i.test(msg), "abort copy has no git jargon");
  console.log("ok  differing non-empty verse aborts; principal bytes unchanged");
}

// 3b. Bridge vs split with text on both sides also aborts.
{
  const bridged = principal.replace("\\v 2\n\\v 3\n", "\\v 2-3 Hananí vino y me dijo esto.\n");
  const r = computePrincipalPass({ principal: bridged, grupal, ranges: [range] });
  assert(r.status === "differ", `bridge vs split: expected differ, got ${r.status}`);
  console.log("ok  bridge vs split with text on both sides aborts");
}

// 4. Disjoint verses: principal filled elsewhere keeps its text; grupal fills the rest.
{
  const partial = principal.replace("\\v 3\n", "\\v 3 Me dijeron esto.\n");
  const r = computePrincipalPass({ principal: partial, grupal, ranges: [range] });
  assert(r.status === "write", "disjoint: write");
  assert(/\\v 2 Hananí vino de Judá\./.test(r.usfm) && /\\v 3 Me dijeron esto\./.test(r.usfm), "disjoint fill");
  const grupalEmpty4 = computePrincipalPass({
    principal: principal.replace("\\v 4\n", "\\v 4 El principal ya lo tenía.\n"),
    grupal,
    ranges: [range],
  });
  assert(grupalEmpty4.status === "write" && /\\v 4 El principal ya lo tenía\./.test(grupalEmpty4.usfm), "empty grupal loses to filled principal");
  console.log("ok  disjoint verses fill; empty loses to filled");
}

// 4b. Grupal has nothing in the range: error, no write.
{
  const r = computePrincipalPass({ principal, grupal, ranges: [{ chapter: 3, from: 1, to: 5 }] });
  assert(r.status === "empty", "empty grupal range");
  console.log("ok  empty grupal range reports and does not write");
}

// 4c. SHA race: retry reads again and writes once.
{
  let reads = 0;
  let writes = 0;
  const io: PrincipalPassIo = {
    readPrincipal: async () => ({ text: principal, sha: `p${++reads}` }),
    readGrupal: async () => grupal,
    write: async (_text, sha) => {
      writes++;
      if (sha === "p1") throw Object.assign(new Error("409"), { status: 409 });
    },
    isShaConflict: (err) => (err as { status?: number }).status === 409,
  };
  const out = await passIntoPrincipal(io, { book: "NEH", ranges: [range] });
  assert(out.status === "written" && writes === 2 && reads === 2, "retry after SHA conflict");
  console.log("ok  SHA conflict retries with a fresh read");
}

// 4d. Task with two files (TPL + TPS): one differing file blocks both; no write, no mark.
{
  let writes = 0;
  const io = (principalText: string): PrincipalPassIo => ({
    readPrincipal: async () => ({ text: principalText, sha: "p" }),
    readGrupal: async () => grupal,
    write: async () => {
      writes++;
    },
    isShaConflict: () => false,
  });
  const differing = principal.replace("\\v 1 Palabras de Nehemías.", "\\v 1 Otro texto.");
  const target = (resource: string) => ({ resource, book: "NEH", ranges: [range], issues: [1] });
  await rejects(
    () =>
      passTaskIntoPrincipal(
        [
          { io: io(principal), target: target("tpl"), label: "TPL" },
          { io: io(differing), target: target("tps"), label: "TPS" },
        ],
        { taskId: "tpl-draft", book: "NEH", by: "gestora", issues: [] },
      ),
    /texto distinto/,
    "second file differs",
  );
  assert(writes === 0, "first file not written when the second differs");
  console.log("ok  multi-file task: one differing file aborts the whole pass");
}

// 4e. Revisión: normal vs review task on a differing verse, confirm copy.
{
  const reviewed = principal.replace("\\v 1 Palabras de Nehemías.", "\\v 1 Palabras de Nehemías, primera versión.");
  const target = { resource: "tpl", book: "NEH", ranges: [range], issues: [1] };
  const store = (text: string) => {
    const s = { text, sha: "p1", writes: 0 };
    const io: PrincipalPassIo = {
      readPrincipal: async () => ({ text: s.text, sha: s.sha, serverAt: "2026-09-01T10:00:00Z" }),
      readGrupal: async () => grupal,
      write: async (next, sha) => {
        s.writes++;
        s.text = next;
        s.sha = `${sha}+`;
        return { serverAt: "2026-09-29T12:00:00Z" };
      },
      isShaConflict: () => false,
    };
    return { s, io };
  };
  const ctx = { taskId: "revision", book: "NEH", by: "gestora", issues: [] as DcsIssue[] };

  // Normal task: abort, principal bytes unchanged, no mark.
  {
    const { s, io } = store(reviewed);
    let mark: unknown;
    await rejects(
      async () => {
        mark = (await passTaskIntoPrincipal([{ io, target, label: "NEH 1:1–4" }], ctx)).mark;
      },
      /NEH 1:1: ese versículo tiene un texto distinto/,
      "normal task differing verse",
    );
    assert(s.writes === 0 && s.text === reviewed && mark === undefined, "normal task: principal unchanged, no mark");
    console.log("ok  normal task: differing verse aborts, principal unchanged, no mark");
  }

  // Preview (read-only) names the verse the review replaces.
  const { s: ps, io: pio } = store(reviewed);
  const preview = await previewPrincipalReview([{ io: pio, target, label: "NEH 1:1–4" }]);
  assert(ps.writes === 0, "preview does not write");
  assert(
    preview.length === 1 && preview[0]!.replaced.length === 1 && preview[0]!.replaced[0]!.from === 1 && preview[0]!.replaced[0]!.to === 1,
    `preview names 1:1: ${JSON.stringify(preview)}`,
  );

  // Review task, confirmed: only 1:1 replaced (and empty 1:2–3 filled); outside bytes identical; mark from the write.
  {
    const { s, io } = store(reviewed);
    const run = await passTaskIntoPrincipal(
      [{ io, target, label: "NEH 1:1–4", confirmedReplace: preview[0]!.replaced }],
      ctx,
    );
    assert(s.writes === 1, "review: one write");
    assert(/\\v 1 Palabras de Nehemías\.\n/.test(s.text), "review: 1:1 takes the review text");
    assert(!/primera versión/.test(s.text), "review: old 1:1 text gone");
    assert(/\\v 2 Hananí vino de Judá\./.test(s.text) && /\\v 3 Me dijeron esto\./.test(s.text), "review: empty slots filled");
    const head = reviewed.slice(0, reviewed.indexOf("\\v 1"));
    const tail = reviewed.slice(reviewed.indexOf("\\q1"));
    assert(s.text.startsWith(head), "review: bytes before 1:1 identical");
    assert(s.text.endsWith(tail), "review: bytes after the range identical (1:4–2:2, 1:5 text kept)");
    assert(run.mark.serverAt === "2026-09-29T12:00:00Z", `review: mark from the write time, got ${run.mark.serverAt}`);
    assert(run.replaced?.length === 1 && run.replaced[0] === "NEH 1:1", `review: replaced list ${run.replaced}`);
    console.log("ok  review task: only the confirmed verse changes; outside bytes identical; pass mark set");

    // Second pass: identical text, no write, mark from the principal file time.
    const again = await passTaskIntoPrincipal(
      [{ io, target, label: "NEH 1:1–4", confirmedReplace: [] }],
      ctx,
    );
    assert(s.writes === 1 && again.already.length === 1, "review again: no write");
    assert(again.mark.serverAt === "2026-09-01T10:00:00Z", "review again: no-write server time rule");
    console.log("ok  review task: identical text is a no-op; mark uses the read time");
  }

  // Review task whose differing verse was not confirmed: abort, no write.
  {
    const { s, io } = store(reviewed);
    await rejects(
      () => passTaskIntoPrincipal([{ io, target, label: "NEH 1:1–4", confirmedReplace: [] }], ctx),
      /NEH 1:1: el texto cambió desde que confirmaste la revisión/,
      "unconfirmed replace",
    );
    assert(s.writes === 0 && s.text === reviewed, "unconfirmed: principal unchanged");
    console.log("ok  review task: a verse not confirmed aborts without writing");
  }

  // Bridge vs split with text on both sides: the review form wins inside the range.
  {
    const bridged = principal.replace("\\v 2\n\\v 3\n", "\\v 2-3 Hananí vino y me dijo esto.\n");
    const r = computePrincipalPass({ principal: bridged, grupal, ranges: [range], replace: true });
    assert(r.status === "write" && r.replaced?.length === 1, `bridge review: write, got ${r.status}`);
    assert(/\\v 2 Hananí vino de Judá\.\n\\v 3 Me dijeron esto\./.test(r.usfm) && !/\\v 2-3/.test(r.usfm), "bridge review: split form");
    assert(r.usfm.endsWith(bridged.slice(bridged.indexOf("\\q1"))), "bridge review: tail identical");
    console.log("ok  review task: bridge vs split takes the review form");
  }

  // Confirm copy.
  const text = principalReviewConfirmText({
    taskName: "Revisión NEH 1",
    replaced: preview.map((row) => ({ book: row.book, verses: row.replaced })),
  });
  assert(/NEH 1:1\b/.test(text), `confirm names the verse: ${text}`);
  assert(/reemplaza en el borrador principal/.test(text), "confirm says the review replaces it in the borrador principal");
  assert(/no publica una versión/.test(text), "confirm says it does not publish a version");
  assert(!/publica/.test(text.replace("no publica una versión", "")), "confirm never claims to publish");
  assert(!/tronco|rama|SHA|master|\btag\b|release|\bPR\b/i.test(text), "confirm has no git jargon");
  console.log(`ok  confirm copy: «${text}»`);
}

// 5. Gate: completion, open decisions, range parsing.
function issue(n: number, opts: { state?: "open" | "closed"; title?: string; conflict?: boolean; taskId?: string; resource?: string }): DcsIssue {
  const taskId = opts.taskId ?? "tpl-draft";
  const body = encodeWorkOrderMarker({
    key: `NEH|${taskId}|${n}`,
    book: "NEH",
    teamId: taskId,
    resource: opts.resource ?? "tpl",
    portionIds: [],
    itemIds: [],
  } as unknown as Parameters<typeof encodeWorkOrderMarker>[0]);
  return {
    number: n,
    state: opts.state ?? "closed",
    title: opts.title ?? `NEH 1:${n * 4 - 3}–${n * 4} · TPL`,
    body,
    labels: [
      { name: "pm" },
      { name: `pm/tarea:${taskId}` },
      ...(opts.conflict ? [{ name: "pm/estado:conflicto" }] : []),
    ],
    milestone: { title: "NEH" },
  } as unknown as DcsIssue;
}

{
  const done = principalPassGate({ issues: [issue(1, {}), issue(2, {})], taskId: "tpl-draft", book: "NEH" });
  assert(done.blockReason === null, `complete task enabled: ${done.blockReason}`);
  assert(done.targets.length === 1 && done.targets[0]!.ranges.length === 1, "adjacent portions merge to one range");
  assert(done.targets[0]!.ranges[0]!.from === 1 && done.targets[0]!.ranges[0]!.to === 8, "range 1:1–8");

  const open = principalPassGate({ issues: [issue(1, {}), issue(2, { state: "open" })], taskId: "tpl-draft", book: "NEH" });
  assert(open.blockReason && /Falta 1 subtarea por terminar \(1 de 2 listas\)/.test(open.blockReason), `incomplete: ${open.blockReason}`);

  const deciding = principalPassGate({ issues: [issue(1, {}), issue(2, { conflict: true })], taskId: "tpl-draft", book: "NEH" });
  assert(deciding.blockReason && /decisiones de versículo sin resolver en #2/.test(deciding.blockReason), `open decision: ${deciding.blockReason}`);

  const badRange = principalPassGate({ issues: [issue(1, { title: "NEH capítulo uno · TPL" })], taskId: "tpl-draft", book: "NEH" });
  assert(badRange.blockReason && /No se pudo leer el rango de versículos de #1/.test(badRange.blockReason), `bad range: ${badRange.blockReason}`);
  assert(!badRange.targets.length, "bad range: no targets to write");

  const other = principalPassGate({ issues: [issue(1, { taskId: "otra" })], taskId: "tpl-draft", book: "NEH" });
  assert(other.blockReason && /no tiene subtareas/.test(other.blockReason), "other task issues ignored");

  const notes = principalPassGate({ issues: [issue(1, { resource: "notas" })], taskId: "tpl-draft", book: "NEH" });
  assert(notes.blockReason && /no tiene subtareas de texto bíblico/.test(notes.blockReason), "non-scripture ignored");
  console.log("ok  gate: complete / incomplete / open decision / bad range");
}

{
  const msg = principalPassCommitMessage({
    book: "NEH",
    resource: "tpl",
    taskName: "Borrador TPL",
    taskId: "tpl-draft",
    verses: [range],
    by: "gestora",
    issues: [1, 2],
    grupalRef: "neh/tpl-draft",
    grupalSha: "abc123",
  });
  assert(/^TAS: pasar NEH 1:1–4 al borrador principal \(@gestora\)/.test(msg), "commit subject");
  assert(/Borrador grupal: neh\/tpl-draft @ abc123/.test(msg), "commit keeps audit detail");
  console.log("ok  commit message keeps audit detail");
}

// A verse the group aligned after its text had reached the principal: the words are the same, the work is new.
{
  const link = (strong: string, word: string) =>
    `\\zaln-s |x-strong="${strong}" x-occurrence="1" x-occurrences="1" x-content="א"\\*\\w ${word}|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*`;
  const plain = `\\id JON Borrador
\\usfm 3.0
\\c 2
\\p
\\v 1 Y Jonás oró a su Dios.
\\v 2 Y dijo:
\\q1 Clamé en mi angustia,
\\q2 y él me respondió.

\\ts\\*
\\q1
\\v 3 Me echaste a lo profundo.
\\v 4 Yo dije: fui expulsado.
`;
  const aligned = plain
    .replace("\\v 1 Y Jonás oró", `\\v 1 Y\n${link("H3124", "Jonás")}\n${link("H6419", "oró")}`)
    .replace("\\q1 Clamé en", `\\q1 ${link("H7121", "Clamé")} en`)
    .replace("\\v 4 Yo dije:", `\\v 4 Yo ${link("H0559", "dije")}:`);
  const task = { chapter: 2, from: 1, to: 3 };
  // 2:4 is not of the task: it stays as the principal has it.
  const expected = aligned.replace(`\\v 4 Yo ${link("H0559", "dije")}:`, "\\v 4 Yo dije:");

  const r = computePrincipalPass({ principal: plain, grupal: aligned, ranges: [task] });
  assert(r.status === "write", `aligned after the text was passed: expected write, got ${r.status}`);
  assert(r.usfm === expected, `the verses of the task are written as the group aligned them, and nothing else changes:\n${r.usfm}`);
  console.log("ok  a verse aligned after its text was passed takes its alignment; lines, chunk mark and the rest stay");

  const again = computePrincipalPass({ principal: r.usfm, grupal: aligned, ranges: [task] });
  assert(again.status === "same", `passed twice: expected same, got ${again.status}`);
  console.log("ok  passing it again finds nothing to write");

  const behind = computePrincipalPass({ principal: expected, grupal: plain, ranges: [task] });
  assert(behind.status === "same", `group draft with no alignment: expected same, got ${behind.status}`);
  console.log("ok  a group draft with no alignment does not take the principal's away");

  const refined = aligned.replace('x-strong="H7121"', 'x-strong="H7122"');
  const better = computePrincipalPass({ principal: expected, grupal: refined, ranges: [task] });
  assert(better.status === "write" && better.usfm === expected.replace('x-strong="H7121"', 'x-strong="H7122"'), "a word linked to another original word reaches the principal");
  console.log("ok  an alignment that was changed reaches the principal");

  const crlf = computePrincipalPass({ principal: plain.replace(/\n/g, "\r\n"), grupal: aligned, ranges: [task] });
  assert(crlf.status === "write" && crlf.usfm === expected.replace(/\n/g, "\r\n"), "a principal with CRLF keeps its line ends");
  console.log("ok  a principal with CRLF keeps its line ends");

  const empty3 = plain.replace("\\v 3 Me echaste a lo profundo.", "\\v 3");
  const both = computePrincipalPass({ principal: empty3, grupal: aligned, ranges: [task] });
  assert(both.status === "write" && both.usfm === expected, `a verse to fill and a verse to align in one pass:\n${both.status === "write" ? both.usfm : both.status}`);
  console.log("ok  one pass fills an empty verse and brings the alignment of another");

  const other = plain.replace("Clamé en mi angustia,", "Grité en mi angustia,");
  const differs = computePrincipalPass({ principal: other, grupal: aligned, ranges: [task] });
  assert(differs.status === "differ", `another wording in the principal still stops the pass: got ${differs.status}`);
  console.log("ok  another wording in the principal still stops the pass");
}

console.log("\nverify-principal-pass: all checks passed");
