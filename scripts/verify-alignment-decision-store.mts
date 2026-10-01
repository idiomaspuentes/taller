/**
 * A proposal or objection as a decision of the team, against a fake Door43 in memory:
 * opening it, voting, closing (applying the alignment only if the verse did not change),
 * and what is written where.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { OriginalWordToken, WordToken } from "@usfm-tools/editor-core";
import { addSourcesToBox } from "@usfm-ast/alignment-box-model";
import type { GtSession } from "../src/dcs/auth";
import { closeAlignmentDecision, currentVerseHash, loadProposalFiles, openAlignmentDecision, postVote, readDecisionVotes, remindDecisionVoters, resetDecisionSweep, sweepDecisionReminders } from "../src/dcs/alignmentDecisionStore";
import { saveVerseAlignment } from "../src/dcs/alignmentStore";
import { loadDecisionFiles } from "../src/dcs/afinacionStore";
import { tallyOf, alineacionDecisionData, DECISION_EVENT } from "../src/domain/chatEvents/alineacionDecision";
import { getChatEventType } from "../src/domain/chatEvents/registry";
import "../src/dcs/alignmentDecisionThread";
import { parseChatEvent } from "../src/domain/chatEvent";
import { mergeDecisionFiles } from "../src/domain/reviewRound";
import { tokensFromText, viewFromTokens } from "../src/domain/verseEditView";
import { resolveChatEvent } from "../src/domain/chatEvents/registry";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

// ---- a tiny Door43: files by repo/branch/path, issues, labels, milestones and comments ----
const files = new Map<string, { text: string; sha: string }>();
let counter = 0;
const fkey = (repo: string, branch: string, path: string) => `${repo}@${branch}::${path}`;
const put = (repo: string, branch: string, path: string, text: string) => files.set(fkey(repo, branch, path), { text, sha: `sha${++counter}` });
type FakeIssue = { id: number; number: number; title: string; body: string; state: string; labels: { id: number; name: string }[]; assignees: unknown[]; milestone?: unknown };
const issues: FakeIssue[] = [];
const comments = new Map<number, { id: number; body: string; created_at: string; user: { login: string } }[]>();
const labels: { id: number; name: string }[] = [];
const milestones: { id: number; title: string }[] = [];
let clock = Date.parse("2026-10-01T12:00:00Z");
let actor = "bea";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const c = /\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(url.pathname);
  if (c) {
    const repo = `${c[1]}/${c[2]}`;
    const path = decodeURIComponent(c[3]!);
    const branch = method === "GET" ? (url.searchParams.get("ref") ?? "main") : String(body.branch ?? "main");
    if (method === "GET") {
      const hit = files.get(fkey(repo, branch, path));
      if (hit) return json({ name: path.split("/").pop(), path, sha: hit.sha, size: hit.text.length, type: "file", content: Buffer.from(hit.text, "utf-8").toString("base64"), encoding: "base64" });
      const prefix = `${repo}@${branch}::${path}/`;
      const inDir = [...files.entries()].filter(([k]) => k.startsWith(prefix));
      if (inDir.length) return json(inDir.map(([k, v]) => ({ name: k.slice(prefix.length), path: k.slice(`${repo}@${branch}::`.length), sha: v.sha, size: v.text.length, type: "file" })));
      return json({ message: "not found" }, 404);
    }
    const target = fkey(repo, branch, path);
    const current = files.get(target);
    if (current && body.sha !== current.sha) return json({ message: "sha mismatch" }, current ? 422 : 404);
    if (!current && body.sha) return json({ message: "not found" }, 404);
    files.set(target, { text: Buffer.from(String(body.content), "base64").toString("utf-8"), sha: `sha${++counter}` });
    return json({ content: { sha: files.get(target)!.sha }, commit: { sha: "c" } });
  }
  if (/\/repos\/BSOJ\/taller\/labels$/.test(url.pathname)) {
    if (method === "POST") {
      const l = { id: labels.length + 1, name: String(body.name) };
      labels.push(l);
      return json(l, 201);
    }
    return json(labels);
  }
  if (/\/repos\/BSOJ\/taller\/milestones$/.test(url.pathname)) {
    if (method === "POST") {
      const m = { id: milestones.length + 1, title: String(body.title) };
      milestones.push(m);
      return json(m, 201);
    }
    return json(milestones);
  }
  if (/\/repos\/BSOJ\/taller\/issues$/.test(url.pathname) && method === "POST") {
    const number = issues.length + 10;
    const ids = (body.labels as number[] | undefined) ?? [];
    const issue: FakeIssue = { id: number, number, title: String(body.title), body: String(body.body), state: "open", labels: labels.filter((l) => ids.includes(l.id)), assignees: [] };
    issues.push(issue);
    return json(issue, 201);
  }
  const im = /\/repos\/BSOJ\/taller\/issues\/(\d+)(?:\/(comments))?$/.exec(url.pathname);
  if (im) {
    const number = Number(im[1]);
    if (im[2] === "comments") {
      const list = comments.get(number) ?? [];
      if (method === "POST") {
        clock += 60_000;
        const cm = { id: list.length + 1, body: String(body.body), created_at: new Date(clock).toISOString(), user: { login: actor } };
        comments.set(number, [...list, cm]);
        return json(cm, 201);
      }
      return json(list);
    }
    const issue = issues.find((i) => i.number === number);
    if (!issue && number >= 10) return json({ message: "not found" }, 404);
    if (method === "PATCH" && issue) {
      if (typeof body.state === "string") issue.state = body.state;
      return json(issue);
    }
    // parent subtarea (number < 10) accepts comments only
    return json({ number });
  }
  return json({ message: "not found" }, 404);
}) as typeof fetch;

const session = (username: string) => ({ host: "http://fake.local", token: "t", username, canManage: username === "ana" }) as unknown as GtSession;
const target = { owner: "es-419_gl", repo: "es-419_glt", branch: "neh" };
const REPO = "es-419_gl/es-419_glt";
const draftPath = "16-NEH.usfm";
const source = { id: "unfoldingWord/hbo_uhb", layerDir: "hbo_uhb" };
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const draftUsfm = ["id NEH", "c 1", "p", "v 1 Las palabras de Nehemías", ""].map((l) => (l ? BS + l : l)).join(NL);
const draftNow = () => files.get(fkey(REPO, "neh", draftPath))!.text;
const wordsIn = (usfm: string) => [...usfm.matchAll(new RegExp(BS + BS + "w ([^|]+)" + BS + "|", "g"))].map((m) => m[1]);

const src = (index: number, surface: string) => ({ verseSid: "NEH 1:1", surface, strong: "H" + index, lemma: surface, occurrence: 1, occurrences: 1, index }) as OriginalWordToken;
const tw = (index: number, surface: string) => ({ verseSid: "NEH 1:1", surface, occurrence: 1, occurrences: 1, index }) as WordToken;
const so = [src(0, "דִּבְרֵי"), src(1, "נְחֶמְיָה")];
const tr = [tw(0, "Las"), tw(1, "palabras"), tw(2, "de"), tw(3, "Nehemías")];
// Ana's alignment: «דִּבְרֵי» = Las palabras de, «נְחֶמְיָה» = Nehemías
const anas = addSourcesToBox(so, tr, addSourcesToBox(so, tr, [], "u0", [0, 1, 2]), "u1", [3]);
// Bea's proposal: «דִּבְרֵי» = Las palabras, «נְחֶמְיָה» = de Nehemías
const beas = addSourcesToBox(so, tr, addSourcesToBox(so, tr, [], "u0", [0, 1]), "u1", [2, 3]);

const task = { projectId: "NEH", taskId: "afinar-tpl-1", taskName: "Afinar TPL 1", resource: "tpl" as const, parentIssue: 1 };
const view = viewFromTokens({ rtl: true, original: so, gloss: ["The words of", "Nehemiah"], draftBefore: tr });
const common = { pmOrg: "BSOJ", task, target, draftFilepath: draftPath, source, book: "NEH", chapter: 1, verse: 1, aligners: ["ana"], thresholds: { minAgree: 2, minIndependent: 1 }, view, oldText: "Las palabras de Nehemías" };

const cardOf = async (issueNumber: number) => {
  const first = (comments.get(issueNumber) ?? [])[0]!;
  return parseChatEvent(first.body)!;
};

put("BSOJ/taller", "main", "config.json", JSON.stringify({ levels: { ana: "habilitada", bea: "habilitada", carla: "habilitada" } }));
put(REPO, "neh", draftPath, draftUsfm);
actor = "ana";
await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "NEH", chapter: 1, verse: 1, groups: anas, source });
const baseHash = currentVerseHash(draftNow(), "NEH", 1, 1, source);

await test("una propuesta se guarda en el repositorio del texto y abre una subtarea libre para el equipo", async () => {
  actor = "bea";
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "«de» va con Nehemías", baseHash, before: anas, proposed: beas, now: new Date("2026-10-01T12:00:00Z") });
  assert.match(opened.id, /^bea-/);
  assert.equal(opened.issue.state, "open");
  assert.ok(files.has(fkey(REPO, "neh", `checkings/proposals/NEH.1-1.${opened.id}.proposal.json`)), "el archivo de la propuesta");
  assert.ok(opened.issue.labels?.some((l) => l.name === "pm/tarea:afinar-tpl-1"), "queda en la misma tarea");
  assert.match(opened.issue.body ?? "", /gateway-work-order/, "tiene el marcador de subtarea");
  assert.deepEqual(opened.issue.assignees ?? [], [], "nadie la tiene: es libre para el equipo");
  const card = await cardOf(opened.issue.number);
  const data = alineacionDecisionData(card)!;
  assert.equal(data.baseHash, baseHash);
  assert.deepEqual(card.mentions, ["ana"], "se avisa a quien alineó");
  assert.ok(data.before[0]!.includes("דִּבְרֵי") && data.after[0]!.includes("Las palabras"), "la tarjeta muestra antes y después");
  const mine = mergeDecisionFiles(await loadDecisionFiles(session("bea"), target, "NEH")).filter((d) => d.reviewer === "bea");
  assert.equal(mine[0]!.status, "revise");
  assert.equal(mine[0]!.proposalId, opened.id, "la respuesta de quien propone lleva el número de la propuesta");
  assert.equal((await loadProposalFiles(session("bea"), target, "NEH")).proposals.length, 1);
});

await test("cada voto es un comentario; con el mínimo de habilitadas, una independiente y nadie en contra se decide y se aplica", async () => {
  const issue = issues[0]!;
  const data = alineacionDecisionData(await cardOf(issue.number))!;
  actor = "carla";
  await postVote(session("carla"), "BSOJ", issue.number, data, "aceptar");
  const read = await readDecisionVotes(session("carla"), "BSOJ", issue.number, `ad:${data.id}`);
  assert.deepEqual(read.votes.map((v) => `${v.by}:${v.option}`), ["carla:aceptar"]);
  const levels = { ana: "habilitada", bea: "habilitada", carla: "habilitada" } as const;
  const tally = tallyOf(data, { votes: read.votes, levels: { ...levels }, now: "2026-10-02T00:00:00Z" });
  assert.equal(tally.winner, "aceptar");

  const closed = await closeAlignmentDecision({ session: session("carla"), pmOrg: "BSOJ", threadIssue: issue.number, data, option: "aceptar", how: "consenso" });
  assert.equal(closed.outcome, "aceptada");
  assert.equal(issue.state, "closed", "la subtarea se cierra");
  assert.deepEqual(wordsIn(draftNow()), ["Las", "palabras", "de", "Nehemías"], "las palabras siguen, con la nueva alineación");
  assert.notEqual(currentVerseHash(draftNow(), "NEH", 1, 1, source), baseHash, "la alineación cambió");
  const { results } = await loadProposalFiles(session("carla"), target, "NEH");
  assert.equal(results[0]!.outcome, "aceptada");
  assert.equal(results[0]!.newHash, currentVerseHash(draftNow(), "NEH", 1, 1, source), "el resultado guarda la huella de la versión nueva");
  const thread = await readDecisionVotes(session("carla"), "BSOJ", issue.number, `ad:${data.id}`);
  assert.ok(thread.closed, "el hilo muestra que se cerró");
  // the words are still the same; only the links changed
  assert.equal(wordsIn(draftNow()).length, 4);
});

await test("si la alineación cambió mientras se decidía, la propuesta caduca y no se aplica", async () => {
  actor = "bea";
  const freshHash = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "otra idea", baseHash: freshHash, before: beas, proposed: anas, now: new Date("2026-10-01T13:00:00Z") });
  actor = "ana";
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "NEH", chapter: 1, verse: 1, groups: addSourcesToBox(so, tr, [], "u0", [0]), source });
  const before = draftNow();
  const data = alineacionDecisionData(await cardOf(opened.issue.number))!;
  const closed = await closeAlignmentDecision({ session: session("carla"), pmOrg: "BSOJ", threadIssue: opened.issue.number, data, option: "aceptar", how: "consenso" });
  assert.equal(closed.outcome, "caducada");
  assert.equal(draftNow(), before, "el borrador no se toca");
});

await test("una propuesta rechazada deja la alineación como estaba y se registra", async () => {
  actor = "bea";
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "otra", baseHash: h, before: anas, proposed: beas, now: new Date("2026-10-01T14:00:00Z") });
  const before = draftNow();
  const data = alineacionDecisionData(await cardOf(opened.issue.number))!;
  const closed = await closeAlignmentDecision({ session: session("ana"), pmOrg: "BSOJ", threadIssue: opened.issue.number, data, option: "rechazar", how: "coordinacion" });
  assert.equal(closed.outcome, "rechazada");
  assert.equal(draftNow(), before);
  const { results } = await loadProposalFiles(session("ana"), target, "NEH");
  const mine = results.find((r) => r.id === opened.id)!;
  assert.deepEqual([mine.outcome, mine.how, mine.by], ["rechazada", "coordinacion", "ana"]);
});

await test("una objeción no lleva alineación; si prospera se le pide a quien alineó que la ajuste", async () => {
  actor = "bea";
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "objection", note: "«Nehemías» está mal unida", baseHash: h, before: anas, words: ["נְחֶמְיָה#1"], now: new Date("2026-10-01T15:00:00Z") });
  const fileText = files.get(fkey(REPO, "neh", `checkings/proposals/NEH.1-1.${opened.id}.proposal.json`))!.text;
  assert.ok(!fileText.includes('"proposed"') && fileText.includes("נְחֶמְיָה#1"));
  const mine = mergeDecisionFiles(await loadDecisionFiles(session("bea"), target, "NEH")).filter((d) => d.proposalId === opened.id);
  assert.equal(mine[0]!.status, "rejected");
  const data = alineacionDecisionData(await cardOf(opened.issue.number))!;
  const before = draftNow();
  const closed = await closeAlignmentDecision({ session: session("carla"), pmOrg: "BSOJ", threadIssue: opened.issue.number, data, option: "cambiar", how: "consenso" });
  assert.equal(closed.outcome, "realinear");
  assert.equal(draftNow(), before, "una objeción nunca cambia la alineación");
  const last = (comments.get(opened.issue.number) ?? []).at(-1)!;
  assert.deepEqual(parseChatEvent(last.body)?.mentions, ["ana"]);
});

await test("sin nota no se abre nada", async () => {
  actor = "bea";
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  const before = issues.length;
  await assert.rejects(() => openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "  ", baseHash: h, before: anas, proposed: beas }), /qué quieres cambiar/);
  assert.equal(issues.length, before);
});

const cardType = () => getChatEventType(DECISION_EVENT)!;
const envFor = (login: string, issueNumber: number) => ({ session: session(login), pmOrg: "BSOJ", issueNumber });
const viewerFor = (login: string) => ({ username: login, canManage: login === "ana", assignees: [] as string[] });
const optionsNow = async (login: string, issueNumber: number) => {
  const event = await cardOf(issueNumber);
  const prepared = await cardType().prepare!(event, envFor(login, issueNumber));
  return { event, options: cardType().options!(event, { viewer: viewerFor(login), prepared }) };
};

await test("los votos solo registran: al llegar al consenso se avisa, pero nada se cierra ni se aplica hasta que una persona lo confirma", async () => {
  actor = "bea";
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "unir distinto", baseHash: h, before: anas, proposed: beas, now: new Date("2026-10-01T16:00:00Z") });
  const n = opened.issue.number;
  const event = await cardOf(n);
  const before = draftNow();

  actor = "carla";
  const items = await cardType().run!("aceptar", event, envFor("carla", n));
  assert.equal(items.length, 2, "el voto y el aviso de consenso");
  assert.equal(issues.find((i) => i.number === n)!.state, "open", "sigue abierta");
  assert.equal(draftNow(), before, "la alineación no se tocó");
  const notice = parseChatEvent((comments.get(n) ?? []).at(-1)!.body)!;
  assert.equal(notice.type, "alineacion-consenso");
  assert.deepEqual([...notice.mentions!].sort(), ["ana", "bea"], "se avisa a quien propuso y a quien alineó");

  // A second vote for the same option does not repeat the notice.
  actor = "carla";
  const again = await cardType().run!("aceptar", event, envFor("carla", n));
  assert.equal(again.length, 1);

  const { options } = await optionsNow("ana", n);
  assert.equal(options[0]!.id, "confirmar", "lo primero que se ofrece es confirmar");
  assert.match(options[0]!.confirm ?? "", /@carla/);
  assert.match(options[0]!.confirm ?? "", /Se aplicará la alineación propuesta/);
  assert.match(options[0]!.confirm ?? "", /¿Confirmas/);

  actor = "ana";
  const closed = await cardType().run!("confirmar", event, envFor("ana", n));
  assert.equal(issues.find((i) => i.number === n)!.state, "closed");
  assert.notEqual(draftNow(), before, "ahora sí se aplicó");
  assert.equal(closed.length, 1, "el cierre");
  assert.match(parseChatEvent((comments.get(n) ?? []).at(-1)!.body)!.summary, /@ana confirmó el consenso/);
});

await test("si alguien cambia su voto antes de confirmar, ya no hay consenso y confirmar falla", async () => {
  actor = "bea";
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "de nuevo", baseHash: h, before: anas, proposed: beas, now: new Date("2026-10-01T17:00:00Z") });
  const n = opened.issue.number;
  const event = await cardOf(n);
  actor = "carla";
  await cardType().run!("aceptar", event, envFor("carla", n));
  actor = "ana";
  await cardType().run!("rechazar", event, envFor("ana", n));
  const { options } = await optionsNow("ana", n);
  assert.ok(!options.some((o) => o.id === "confirmar"), "ya no se ofrece confirmar");
  const before = draftNow();
  await assert.rejects(() => cardType().run!("confirmar", event, envFor("ana", n)), /Ya no hay consenso/);
  assert.equal(draftNow(), before);
  assert.equal(issues.find((i) => i.number === n)!.state, "open");
});

await test("quien propone no puede votar su propia propuesta", async () => {
  actor = "bea";
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "y otra", baseHash: h, before: anas, proposed: beas, now: new Date("2026-10-01T18:00:00Z") });
  const event = await cardOf(opened.issue.number);
  await assert.rejects(() => cardType().run!("aceptar", event, envFor("bea", opened.issue.number)), /Es tu propuesta/);
  const { options } = await optionsNow("bea", opened.issue.number);
  assert.ok(options.every((o) => o.blockReason), "sus botones salen bloqueados con el motivo");
});

await test("una propuesta puede cambiar el texto: la tarjeta muestra el diff y las cajas resaltadas, y al aceptarla se escribe el texto y la alineación", async () => {
  // start from a known state: the draft as Ana left it, aligned
  put(REPO, "neh", draftPath, draftUsfm);
  actor = "ana";
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "NEH", chapter: 1, verse: 1, groups: anas, source });
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  const newText = "Las palabras de Nehemías el profeta";
  const newTokens = tokensFromText(newText, "NEH 1:1");
  const wanted = addSourcesToBox(so, newTokens, addSourcesToBox(so, newTokens, [], "u0", [0, 1, 2]), "u1", [3]);
  actor = "bea";
  const opened = await openAlignmentDecision({
    ...common,
    session: session("bea"),
    kind: "proposal",
    note: "falta decir quién es",
    baseHash: h,
    before: anas,
    proposed: wanted,
    oldText: "Las palabras de Nehemías",
    newText,
    view: viewFromTokens({ rtl: true, original: so, gloss: ["The words of", "Nehemiah"], draftBefore: tr, draftAfter: newTokens }),
    now: new Date("2026-10-01T19:00:00Z"),
  });
  const event = await cardOf(opened.issue.number);
  const panels = resolveChatEvent(event).panels;
  const diff = panels.find((p) => p.custom?.kind === "diff");
  assert.ok(diff, "hay un panel con el diff");
  assert.match(JSON.stringify(diff!.custom), /"ins".*el profeta|el profeta.*"ins"/);
  const proposed = panels.find((p) => p.label === "Alineación propuesta")!;
  assert.equal((proposed.custom!.data as { draft: string }).draft, "after", "la alineación propuesta se dibuja con las palabras del texto nuevo");
  assert.equal(panels.filter((p) => p.custom?.kind === "cajas").length, 2, "las uniones de ahora y las propuestas, en cajas");

  const file = JSON.parse(files.get(fkey(REPO, "neh", `checkings/proposals/NEH.1-1.${opened.id}.proposal.json`))!.text);
  assert.equal(file.newText, newText);
  assert.equal(file.oldText, "Las palabras de Nehemías");

  const before = draftNow();
  const data = alineacionDecisionData(event)!;
  const closed = await closeAlignmentDecision({ session: session("carla"), pmOrg: "BSOJ", threadIssue: opened.issue.number, data, option: "aceptar", how: "consenso" });
  assert.equal(closed.outcome, "aceptada");
  assert.notEqual(draftNow(), before);
  assert.match(draftNow().replace(/\s+/g, " "), /el profeta/, "el texto nuevo quedó escrito");
  assert.deepEqual(wordsIn(draftNow()), ["Las", "palabras", "de", "Nehemías"], "las palabras alineadas siguen; las nuevas quedan sin unir");
  const { results } = await loadProposalFiles(session("carla"), target, "NEH");
  assert.equal(results.find((r) => r.id === opened.id)!.newHash, currentVerseHash(draftNow(), "NEH", 1, 1, source));
});

await test("una propuesta que solo cambia la alineación no muestra diff de texto, y una objeción resalta sus cajas en amarillo", async () => {
  actor = "bea";
  put(REPO, "neh", draftPath, draftUsfm);
  actor = "ana";
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "NEH", chapter: 1, verse: 1, groups: anas, source });
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  actor = "bea";
  const p = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "solo unión", baseHash: h, before: anas, proposed: beas, now: new Date("2026-10-01T20:00:00Z") });
  const pp = resolveChatEvent(await cardOf(p.issue.number)).panels;
  assert.ok(!pp.some((x) => x.custom?.kind === "diff"), "sin cambio de texto no hay diff");
  const changed = (pp.find((x) => x.label === "Alineación propuesta")!.custom!.data as { highlight: { tone: string; keys: string[] } }).highlight;
  assert.equal(changed.tone, "changed");
  assert.deepEqual([...changed.keys].sort(), ["0", "1"], "cambian las dos primeras cajas");
  const o = await openAlignmentDecision({ ...common, session: session("bea"), kind: "objection", note: "mal unida", baseHash: h, before: anas, words: ["נְחֶמְיָה#1"], now: new Date("2026-10-01T21:00:00Z") });
  const op = resolveChatEvent(await cardOf(o.issue.number)).panels.find((x) => x.custom?.kind === "cajas")!;
  const hl = (op.custom!.data as { highlight: { tone: string; keys: string[] } }).highlight;
  assert.deepEqual([hl.tone, hl.keys], ["objected", ["1"]]);
});

await test("el recordatorio menciona solo a quien falta por votar, y deja de hacerlo cuando ya votaron todas o se cerró", async () => {
  actor = "bea";
  put(REPO, "neh", draftPath, draftUsfm);
  actor = "ana";
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "NEH", chapter: 1, verse: 1, groups: anas, source });
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  actor = "bea";
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "recordar", baseHash: h, before: anas, proposed: beas, now: new Date("2026-10-01T22:00:00Z") });
  const n = opened.issue.number;
  const data = alineacionDecisionData(await cardOf(n))!;
  const team = ["ana", "bea", "carla", "dora"];
  actor = "carla";
  await postVote(session("carla"), "BSOJ", n, data, "aceptar");
  actor = "ana";
  const who = await remindDecisionVoters({ session: session("ana"), pmOrg: "BSOJ", issue: n, team });
  assert.deepEqual(who, ["ana"], "ni bea (propuso) ni carla (votó); dora no es habilitada");
  const last = (comments.get(n) ?? []).at(-1)!;
  assert.deepEqual(parseChatEvent(last.body)?.mentions, ["ana"]);
  assert.match(parseChatEvent(last.body)!.summary, /@ana falta su voto en NEH 1:1/);
  await postVote(session("ana"), "BSOJ", n, data, "aceptar");
  assert.deepEqual(await remindDecisionVoters({ session: session("ana"), pmOrg: "BSOJ", issue: n, team }), [], "ya votaron todas");
  await closeAlignmentDecision({ session: session("carla"), pmOrg: "BSOJ", threadIssue: n, data, option: "aceptar", how: "consenso" });
  assert.deepEqual(await remindDecisionVoters({ session: session("ana"), pmOrg: "BSOJ", issue: n, team: ["ana", "bea", "carla", "eva"] }), [], "cerrada: no se recuerda nada");
});

await test("la app recuerda sola cuando alguien la abre: una sola vez al día, solo a quien falta y solo cerca del plazo", async () => {
  resetDecisionSweep();
  actor = "ana";
  put(REPO, "neh", draftPath, draftUsfm);
  await saveVerseAlignment({ session: session("ana"), target, filepath: draftPath, book: "NEH", chapter: 1, verse: 1, groups: anas, source });
  const h = currentVerseHash(draftNow(), "NEH", 1, 1, source);
  actor = "bea";
  const created = new Date("2026-10-10T12:00:00Z");
  const opened = await openAlignmentDecision({ ...common, session: session("bea"), kind: "proposal", note: "automático", baseHash: h, before: anas, proposed: beas, now: created });
  const fakeIssue = { ...issues.find((i) => i.number === opened.issue.number)!, created_at: created.toISOString() } as never;
  const sweep = (now: string) => {
    clock = Date.parse(now); // the comments are dated with this clock
    return sweepDecisionReminders({ session: session("carla"), pmOrg: "BSOJ", issues: [fakeIssue], teamOf: () => ["ana", "bea", "carla"], isDecision: () => true, now: new Date(now) });
  };
  const countReminders = () => (comments.get(opened.issue.number) ?? []).filter((c) => parseChatEvent(c.body)?.type === "alineacion-recordatorio").length;

  actor = "carla";
  assert.deepEqual(await sweep("2026-10-11T12:00:00Z"), [], "al día siguiente todavía falta mucho");
  assert.equal(countReminders(), 0);

  // two days and a bit: less than a day left; ana and carla have not voted, bea proposed
  assert.deepEqual(await sweep("2026-10-12T13:00:00Z"), [{ issue: opened.issue.number, who: ["ana", "carla"] }]);
  assert.equal(countReminders(), 1);
  assert.match(parseChatEvent((comments.get(opened.issue.number) ?? []).at(-1)!.body)!.summary, /mañana vence el plazo/);

  // opening the app again soon does not repeat it, and neither does another person a bit later
  assert.deepEqual(await sweep("2026-10-12T13:30:00Z"), []);
  resetDecisionSweep();
  assert.deepEqual(await sweep("2026-10-12T20:00:00Z"), [], "hubo uno hace menos de un día");
  assert.equal(countReminders(), 1);

  // the deadline passes: one more, telling them it is over
  resetDecisionSweep();
  assert.deepEqual((await sweep("2026-10-13T14:00:00Z")).map((r) => r.who), [["ana", "carla"]]);
  assert.match(parseChatEvent((comments.get(opened.issue.number) ?? []).at(-1)!.body)!.summary, /venció/);

  // once carla has voted she is no longer reminded
  resetDecisionSweep();
  const data = alineacionDecisionData(await cardOf(opened.issue.number))!;
  await postVote(session("carla"), "BSOJ", opened.issue.number, data, "aceptar");
  assert.deepEqual((await sweep("2026-10-14T16:00:00Z")).map((r) => r.who), [["ana"]]);
});

console.log(`\nverify-alignment-decision-store: ${passed} checks passed.`);
