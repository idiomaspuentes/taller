/**
 * Self-test for one-PR-per-subtarea markers and branch names.
 * Run: npx tsx scripts/verify-portion-pr.mts
 */
import {
  archiveRefName,
  isArchiveRefName,
  planArchiveRef,
  planBranchEnsure,
  translatorLoginFromHead,
  trunkMergeCommitMessage,
  workUserFromHead,
  bookBranchLabel,
  bookBranchName,
  bookCodeFromWorkHead,
  groupDraftBranchNames,
  legacyTaskBranchName,
  legacyWorkBranchName,
  bookOnlyBranchName,
  bookTrunkFromWorkHead,
  canonicalWorkBranchName,
  closeIssueBlockReason,
  isSharedBookTrunk,
  taskTrunkBranchName,
  encodePortionPrMarker,
  isGitRefDescendant,
  legacyBookBranchName,
  legacyPhaseBookBranchName,
  legacyPortionPrBranchName,
  nestedPortionPrBranchName,
  parsePortionPrMarker,
  portionPrApprovalReviewBody,
  portionPrBranchFromCtx,
  portionPrBranchName,
  pullReviewNeedsSubmit,
  stepCompletesDraftForReview,
  stepNeedsOpenPortionPr,
  isOwnedWorkBranch,
  portionPrHeadMatchesWork,
  removePortionPrFromBody,
  upsertPortionPrInBody,
  type PortionPrMarker,
} from "../src/domain/portionPr.ts";
import {
  ensurePhaseSlug,
  makePhase,
  resolveTaskPhaseSlug,
  slugifyPhase,
} from "../src/domain/phaseSlug.ts";
import type { TaskStep } from "../src/domain/types.ts";
import { applyHelpsTsvEdits, selectTsvRowsForPortion, tsvRowInPortion } from "../src/domain/helpsDraft.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(slugifyPhase("Revisión") === "revision", "accent-stripped slug");
assert(slugifyPhase("Fase 1") === "fase-1", "default label slug");
assert(ensurePhaseSlug({ id: "phase-default", name: "Fase 1" }) === "fase-1", "derive from name");
assert(
  ensurePhaseSlug({ id: "p1", name: "Revisión", slug: "borrador" }) === "borrador",
  "persisted slug wins over rename",
);
assert(bookBranchName("NEH", "tpl-draft") === "borrador/neh/tpl-draft", "borrador/libro/tarea trunk");
assert(bookBranchName("NEH", "traducir-tpl") === "borrador/neh/traducir-tpl", "board taskId slug");
assert(bookBranchName("NEH") === "borrador/neh/tarea", "missing task fallback is not a phase");
assert(legacyTaskBranchName("NEH", "tpl-draft") === "neh/tpl-draft", "the older libro/tarea trunk is still known");
assert(
  groupDraftBranchNames("NEH", "tpl-draft").join("|") === "borrador/neh/tpl-draft|neh/tpl-draft|t/neh/tpl-draft",
  "a group draft is looked for under today's name first, then the older ones",
);
assert(legacyBookBranchName("NEH") === "book/neh", "legacy book base");
assert(legacyPhaseBookBranchName("NEH", "fase-1") === "fase-1/neh", "old phase/book kept for reuse");
assert(
  portionPrBranchName({ book: "NEH", username: "ana", taskId: "traducir-tpl", issueNumber: 41 }) ===
    "trabajo/neh/traducir-tpl/ana/41",
  "work branch trabajo/libro/tarea/user/issue",
);
assert(
  legacyWorkBranchName({ book: "NEH", username: "ana", taskId: "traducir-tpl", issueNumber: 41 }) ===
    "w/neh/traducir-tpl/ana/41",
  "the older w/ work name is still known",
);
assert(
  !isGitRefDescendant(
    portionPrBranchName({ book: "NEH", username: "ana", taskId: "traducir-tpl", issueNumber: 41 }),
    bookBranchName("NEH", "traducir-tpl"),
  ),
  "work ref is not a git child of the trunk",
);
assert(
  nestedPortionPrBranchName({ book: "NEH", username: "ana", taskId: "traducir-tpl", issueNumber: 41 }) ===
    "neh/traducir-tpl/ana/41",
  "legacy nested name kept for ownership",
);
assert(bookBranchLabel("NEH", "Revisión") === "Revisión · Nehemías", "pretty phase label");
assert(!bookBranchName("NEH", "tpl-draft").includes("es-419"), "no language in branch");
assert(!bookBranchName("NEH", "tpl-draft").includes("glt"), "no resource/repo in branch");
assert(!bookBranchName("NEH", "tpl-draft").includes("fase"), "no phase in new trunk");
for (const parent of ["neh", "neh/tpl-draft", "book/neh", "t/neh/tpl-draft"]) {
  assert(!isGitRefDescendant(bookBranchName("NEH", "tpl-draft"), parent), `no older branch («${parent}») can stand in the way of a draft`);
}
assert(!bookBranchName("NEH", "tpl-draft").includes("revision"), "custom phase not in trunk");

const revision = makePhase({ id: "phase-rev", name: "Revisión", order: 0 });
const armonia = makePhase({ id: "phase-arm", name: "Armonización", slug: "armonizacion", order: 1 });
const board = {
  phases: [revision, armonia],
  teams: [
    { id: "tpl-draft", phaseId: revision.id },
    { id: "helps-notes", phaseId: armonia.id },
  ],
};
assert(resolveTaskPhaseSlug(board, "tpl-draft") === "revision", "TPL uses owning phase");
assert(resolveTaskPhaseSlug(board, "helps-notes") === "armonizacion", "helps use their phase, not a resource map");
assert(resolveTaskPhaseSlug({ phases: [], teams: [] }, "missing") === "phase-default", "empty board fallback");

const a = portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 });
const b = portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 42 });
const c = portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 43 });
assert(a !== b && b !== c && a !== c, "three portions → three branches");
assert(a.endsWith("/41") && b.endsWith("/42"), "issue number suffixes");
assert(a.includes("/ana/"), "username in branch");
assert(a === "trabajo/neh/tpl-draft/ana/41", "trabajo/book/task/user/issue");
assert(!isGitRefDescendant(a, bookBranchName("NEH", "tpl-draft")), "tpl-draft work is not under trunk");
assert(
  !a.includes("fase-1") && !a.includes("revision") && !a.includes("armonizacion"),
  "custom/board phase must not appear in new work branches",
);
assert(
  portionPrBranchName({ book: "NEH", username: "ana", taskId: "helps-notes", issueNumber: 9 }) ===
    "trabajo/neh/helps-notes/ana/9",
  "helps branch is libro/tarea, not the phase slug",
);
assert(resolveTaskPhaseSlug(board, "helps-notes") === "armonizacion", "phase still groups the board");
assert(
  !portionPrBranchName({ book: "NEH", username: "ana", taskId: "helps-notes", issueNumber: 9 }).includes(
    resolveTaskPhaseSlug(board, "helps-notes"),
  ),
  "owning phase slug stays out of the git name",
);
assert(portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 }) === a, "stable name");
assert(
  portionPrBranchFromCtx({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 }) === a,
  "ctx helper",
);
assert(
  legacyPortionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 }) ===
    "tas/neh/ana/tpl-draft/41",
  "legacy task branch",
);

const marker: PortionPrMarker = {
  schema: "gateway-portion-pr-1",
  owner: "org",
  repo: "es-419_glt",
  number: 7,
  htmlUrl: "https://git.example/org/es-419_glt/pulls/7",
  head: a,
  base: "master",
  issueNumber: 41,
};
const body = upsertPortionPrInBody("## NEH 1:1–8\n", marker);
assert(body.includes("gateway-portion-pr"), "marker inserted");
const parsed = parsePortionPrMarker(body);
assert(parsed?.number === 7 && parsed.head === a, "round-trip marker");
assert(parsed?.issueNumber === 41, "issueNumber kept");

const again = upsertPortionPrInBody(body, { ...marker, number: 8 });
assert((again.match(/<!-- gateway-portion-pr/g) ?? []).length === 1, "upsert once");
assert(parsePortionPrMarker(again)?.number === 8, "replaced number");

const encoded = encodePortionPrMarker(marker);
assert(parsePortionPrMarker(encoded)?.repo === "es-419_glt", "encode parse");
assert(parsePortionPrMarker("no marker") === null, "missing is null");
assert(removePortionPrFromBody(body).includes("## NEH 1:1–8"), "unlink keeps issue text");
assert(!removePortionPrFromBody(body).includes("gateway-portion-pr"), "unlink drops marker");
assert(isOwnedWorkBranch(a, { book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 }), "owned work branch");
assert(
  isOwnedWorkBranch("neh/tpl-draft/ana/41", { book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 }),
  "legacy nested still owned for Recreate",
);
assert(!isOwnedWorkBranch("neh/tpl-draft/otro/9", { book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 }), "foreign work branch");
const ownedAna = { book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 };
assert(portionPrHeadMatchesWork(a, a, ownedAna), "Ver PR when head is current work");
assert(
  portionPrHeadMatchesWork("neh/tpl-draft/ana/41", a, ownedAna),
  "Ver PR when stored head is remapped w/ leftover",
);
assert(
  !portionPrHeadMatchesWork("antique-other-head", a, ownedAna),
  "Ver PR hidden when PR head ≠ current work branch",
);
assert(!portionPrHeadMatchesWork("master", a, ownedAna), "Ver PR hidden for default-branch head");

const uuidTask = "6f1e771e-2f2d-4987-b516-6455a751405a";
assert(bookBranchName("NEH", uuidTask) === `borrador/neh/${uuidTask}`, "board UUID taskId stays in the trunk");
assert(bookOnlyBranchName("NEH") === "neh", "book-only leftover is neh");
assert(taskTrunkBranchName("NEH", uuidTask) === `t/neh/${uuidTask}`, "safe trunk keeps libro+tarea");
assert(!isGitRefDescendant(taskTrunkBranchName("NEH", uuidTask), "neh"), "t/ trunk is not a child of neh");
assert(isSharedBookTrunk("neh", "NEH"), "neh is a shared book leftover");
assert(!isSharedBookTrunk(taskTrunkBranchName("NEH", uuidTask), "NEH"), "t/ trunk is per-task");
const uuidWork = portionPrBranchName({
  book: "NEH",
  username: "abelper8",
  taskId: uuidTask,
  issueNumber: 5,
});
assert(uuidWork === `trabajo/neh/${uuidTask}/abelper8/5`, "UUID work uses the work word");
assert(!isGitRefDescendant(uuidWork, bookBranchName("NEH", uuidTask)), "UUID work is not a child of preferred trunk");
assert(!isGitRefDescendant(uuidWork, taskTrunkBranchName("NEH", uuidTask)), "UUID work is not a child of t/ trunk");
assert(
  canonicalWorkBranchName(
    { book: "NEH", username: "abelper8", taskId: uuidTask, issueNumber: 5 },
    legacyTaskBranchName("NEH", uuidTask),
    `neh/${uuidTask}/abelper8/5`,
  ) === uuidWork,
  "nested leftover remaps to the work name",
);
assert(bookTrunkFromWorkHead(uuidWork) === `borrador/neh/${uuidTask}`, "draft recovered from a work ref");
assert(bookTrunkFromWorkHead(`w/neh/${uuidTask}/abelper8/5`) === `neh/${uuidTask}`, "an older w/ work ref still points at its older trunk");
assert(bookCodeFromWorkHead(uuidWork) === "neh" && bookCodeFromWorkHead(`w/neh/${uuidTask}/abelper8/5`) === "neh", "book read from both work names");
assert(
  portionPrHeadMatchesWork(`w/neh/${uuidTask}/abelper8/5`, uuidWork, { book: "NEH", username: "abelper8", taskId: uuidTask, issueNumber: 5 }),
  "a review opened from an older w/ branch is still this subtarea's",
);

const steps: TaskStep[] = [
  { id: "fam", name: "Familiarizar" },
  { id: "draft", name: "Borrador" },
  { id: "pair", name: "Pares", claimMode: "exclusive" },
  { id: "group", name: "Grupal", claimMode: "pool" },
];
assert(stepCompletesDraftForReview(steps, "draft"), "draft opens PR");
assert(!stepCompletesDraftForReview(steps, "fam"), "familiarize does not");
assert(!stepCompletesDraftForReview(steps, "pair"), "claim step is not draft-complete");
assert(stepNeedsOpenPortionPr(steps[2]), "pair needs PR");
assert(stepNeedsOpenPortionPr(steps[3]), "group needs PR");
assert(!stepNeedsOpenPortionPr(steps[1]), "draft step does not by itself");

assert(
  portionPrApprovalReviewBody({ stepName: "Pares", issueNumber: 41 }) ===
    "Aprobado en TAS: «Pares» · subtarea #41",
  "approval review body",
);
assert(pullReviewNeedsSubmit("PENDING"), "pending needs submit");
assert(pullReviewNeedsSubmit("pending"), "pending lowercase");
assert(!pullReviewNeedsSubmit("APPROVED"), "approved is done");
assert(!pullReviewNeedsSubmit("COMMENT"), "comment is done");

const tsv = "Reference\tID\tNote\n1:1\tn001\told\n1:2\tn002\tkeep\n";
const patched = applyHelpsTsvEdits(tsv, [{ id: "n001", fields: { Note: "nuevo" } }]);
assert(patched.includes("nuevo") && patched.includes("keep"), "tsv edit one row");
assert(tsvRowInPortion({ Reference: "1:2" }, { ref: "1:1–3", chapter: 1 }), "row in range");
assert(!tsvRowInPortion({ Reference: "2:1" }, { ref: "1:1–3", chapter: 1 }), "row other chapter");

{
  // The plan lists the ids of the source helps; the file in the team's language has its own.
  const inventory = { portions: [{ id: "3JN-01-01", ref: "3JN 1:1-4", preguntasItems: [{ id: "r3ao" }, { id: "yuwd" }], notasItems: [{ id: "w99t" }, { id: "intr" }] }], articles: [] } as never;
  const launch = { portionIds: ["3JN-01-01"], itemIds: ["porcion:3JN 1:1-4"], ref: "1:1–4", chapter: 1 };
  const questions = [{ Reference: "1:1", ID: "h8qz" }, { Reference: "1:4", ID: "ktw5" }, { Reference: "1:5", ID: "zzzz" }];
  const picked = selectTsvRowsForPortion(questions, { ...launch, resource: "preguntas" }, inventory).map((r) => r.ID);
  assert(picked.join() === "h8qz,ktw5", "las preguntas del pasaje salen aunque sus ids no sean los del inventario");
  const notes = [{ Reference: "1:intro", ID: "intr" }, { Reference: "1:1", ID: "rni7" }, { Reference: "1:1", ID: "w99t" }, { Reference: "1:9", ID: "far1" }, { Reference: "1:intro", ID: "otra" }];
  const pickedNotes = selectTsvRowsForPortion(notes, { ...launch, resource: "notas" }, inventory).map((r) => r.ID);
  assert(pickedNotes.join() === "intr,rni7,w99t", "las notas de sus versículos y las que el plan le da por id; no la introducción de otro");
}

for (const resource of ["tpl", "TPS"]) {
  assert(closeIssueBlockReason(resource, "none"), `${resource}: sin PR no cierra el issue`);
  assert(closeIssueBlockReason(resource, "closed"), `${resource}: PR cerrado sin USFM no cierra el issue`);
  assert(closeIssueBlockReason(resource, "verses") === null, `${resource}: versículos en el tronco cierran`);
  assert(closeIssueBlockReason(resource, "already") === null, `${resource}: PR ya fusionado cierra`);
}
assert(closeIssueBlockReason("notas", "none") === null, "notas sin PR siguen cerrando");
assert(closeIssueBlockReason("preguntas", "closed") === null, "helps con PR cerrado a mano siguen cerrando");
assert(closeIssueBlockReason(undefined, "none") === null, "sin recurso: comportamiento previo");

// ── Option B: archive ref + Cerrar commit message ───────────────────────

{
  const archive = archiveRefName("NEH", 41);
  assert(archive === "archivo/neh/41", `archivo: nombre (${archive})`);
  assert(/^[\x20-\x7e]+$/.test(archive), "archivo: ASCII");
  assert(isArchiveRefName(archive), "archivo: reconocido como ref de archivo");
  for (const parent of ["neh", "neh/tpl-draft", "w", "w/neh", "w/neh/tpl-draft", "t/neh/tpl-draft", "trabajo", "trabajo/neh", "borrador", "borrador/neh", "borrador/neh/tpl-draft"]) {
    assert(!isGitRefDescendant(archive, parent), `archivo: no cuelga de «${parent}»`);
  }
  assert(!archive.startsWith("neh/") && !archive.startsWith("w/"), "archivo: no es hija de neh/ ni de w/");
  assert(!isGitRefDescendant(a, archive) && !isGitRefDescendant(bookBranchName("NEH", "tpl-draft"), archive), "archivo: no es padre de tronco ni de w/");
  assert(!isArchiveRefName(a), "archivo: una rama w/ no pasa la guarda");
  assert(!isArchiveRefName(bookBranchName("NEH", "tpl-draft")), "archivo: un tronco no pasa la guarda");
  assert(!isArchiveRefName("archivo/neh/0") && !isArchiveRefName("archivo/neh"), "archivo: exige issue > 0");

  assert(planArchiveRef(null, "abc") === "create", "archivo: no existe → crear");
  assert(planArchiveRef("ABC", "abc") === "noop", "archivo: mismo SHA → nada");
  assert(planArchiveRef("def", "abc") === "update", "archivo: otro SHA → actualizar");

  assert(workUserFromHead("trabajo/neh/tpl-draft/ana/41") === "ana", "login: desde trabajo/");
  assert(workUserFromHead("w/neh/tpl-draft/ana/41") === "ana", "login: desde w/");
  assert(workUserFromHead("neh/tpl-draft/ana/41") === "ana", "login: desde ref anidada");
  assert(workUserFromHead("tas/neh/ana/tpl-draft/41") === "ana", "login: desde tas/");
  assert(
    translatorLoginFromHead("w/neh/tpl-draft/ana-p/41", ["coord", "Ana.P"]) === "Ana.P",
    "login: el slug de la rama se resuelve al login real",
  );
  assert(translatorLoginFromHead("w/neh/tpl-draft/ana/41", ["coord"]) === "ana", "login: sin candidato, el slug");

  const workSha = "0123456789abcdef0123456789abcdef01234567";
  const message = trunkMergeCommitMessage({
    issueNumber: 41,
    verses: "1:10–12",
    translator: "ana",
    pullNumber: 7,
    workBranch: a,
    workSha,
    archiveRef: archive,
  });
  assert(message.includes(workSha), "mensaje: SHA de la rama de trabajo");
  assert(message.includes("@ana"), "mensaje: login del traductor");
  assert(message.includes("#41"), "mensaje: issue");
  assert(message.includes("1:10–12"), "mensaje: rango");
  assert(message.includes("PR: #7"), "mensaje: número de PR");
  assert(message.includes(archive), "mensaje: ref de archivo");
}

{
  const grupal = { name: "neh/tpl-draft", sha: "trunksha" };
  const principal = { name: "master", sha: "mastersha" };
  const exists = planBranchEnsure({ gitRefSha: "abc", branchApi: true, sources: [grupal] });
  assert(exists.kind === "exists", "rama visible: no se toca");
  const ghost = planBranchEnsure({ gitRefSha: "ghostsha", branchApi: false, sources: [grupal, principal] });
  assert(ghost.kind === "repair" && ghost.sha === "ghostsha", "fantasma: se rehace desde su propio SHA");
  const fresh = planBranchEnsure({ gitRefSha: null, branchApi: false, sources: [grupal, principal] });
  assert(fresh.kind === "create" && fresh.sha === "trunksha" && fresh.from === grupal.name, "nueva: desde el borrador grupal");
  const noGrupal = planBranchEnsure({
    gitRefSha: null,
    branchApi: false,
    sources: [{ name: grupal.name, sha: null }, principal],
  });
  assert(
    noGrupal.kind === "create" && noGrupal.sha === "mastersha" && noGrupal.from === "master",
    "sin borrador grupal: desde el borrador principal",
  );
  const none = planBranchEnsure({ gitRefSha: "  ", branchApi: false, sources: [{ name: "x", sha: null }] });
  assert(none.kind === "no-source", "sin SHA en ningún lado: no se crea nada");
}

{
  // Only the branches a repository has are asked for a text.
  const { branchNamesFromRefs, onlyExisting } = await import("../src/dcs/branchList.ts");
  const names = branchNamesFromRefs([{ ref: "refs/heads/master" }, { ref: "refs/heads/3jn/tpl" }, { ref: "refs/tags/v1" }, {}]);
  assert([...names].join() === "master,3jn/tpl", "las ramas salen de refs/heads, con sus barras");
  assert(onlyExisting(["3jn/tpl", "t/3jn/tpl", "3jn", undefined], names).join("|") === "3jn/tpl|", "solo se preguntan las que existen, en su orden, y la rama por defecto");
  assert(onlyExisting(["a", "b"], null).length === 2, "sin lista se preguntan todas, como antes");
}

{
  // Two passages of one help file, delivered one after the other: each one's rows go in, nobody's are lost.
  const { mergeTsvRows } = await import("../src/domain/helpsDraft.ts");
  const T = (rows: string[][]) => ["Reference\tID\tNote", ...rows.map((r) => r.join("\t"))].join("\n") + "\n";
  const source = T([["1:15", "a1", "in English"], ["2:1", "b1", "in English"], ["2:9", "b2", "in English"], ["2:10", "c1", "in English"]]);
  const trunk = T([["1:15", "a1", "en español"], ["2:1", "b1", "in English"], ["2:9", "b2", "in English"], ["2:10", "c1", "en español"]]);
  const work = T([["1:15", "a1", "in English"], ["2:1", "b1", "nota uno"], ["2:1", "nueva", "añadida"], ["2:9", "b2", "nota dos"], ["2:10", "c1", "in English"]]);
  const merged = mergeTsvRows(trunk, work, source);
  assert(merged === T([["1:15", "a1", "en español"], ["2:1", "b1", "nota uno"], ["2:1", "nueva", "añadida"], ["2:9", "b2", "nota dos"], ["2:10", "c1", "en español"]]), "las filas del pasaje entran y las de los vecinos se conservan");
  assert(mergeTsvRows(merged, work, source) === merged, "entregar dos veces no cambia nada");
}

{
  // A subtarea of articles lists the articles it names, not every article of its passage.
  const { collectHelpsArticleRefs } = await import("../src/domain/helpsDraft.ts");
  const inventory = { portions: [{ id: "HAG-01-01", ref: "HAG 1:1-11", palabras: [{ id: "king" }, { id: "bear" }, { id: "age-timeperiod" }] }], articles: [{ id: "king", path: "bible/other/king", title: "rey" }, { id: "bear", path: "bible/other/bear" }, { id: "age-timeperiod", path: "bible/other/age-timeperiod" }, { id: "bear-carryburden", path: "bible/other/bear-carryburden" }] } as never;
  const named = collectHelpsArticleRefs({ resource: "palabras", portionIds: ["HAG-01-01"], itemIds: ["articulo:age-timeperiod", "articulo:bear-carryburden"] }, inventory);
  assert(named.map((r) => r.path).join() === "bible/other/age-timeperiod,bible/other/bear-carryburden", "solo los artículos que la subtarea nombra, también el de otro pasaje");
  const all = collectHelpsArticleRefs({ resource: "palabras", portionIds: ["HAG-01-01"], itemIds: ["porcion:HAG 1:1-11"] }, inventory);
  assert(all.length === 3, "sin artículos nombrados, los del pasaje");
}

{
  // A note is on a verse, or is the introduction of the book or of a chapter: each is named as what it is.
  const { tsvRowsToDraftItems } = await import("../src/domain/helpsDraft.ts");
  const long = "# Introduction to Jude\\n\\n## Part 1: General introduction";
  const [book, chapter, verse] = tsvRowsToDraftItems("notas", "tn_JUD.tsv", [
    { Reference: "front:intro", ID: "xh5n", Quote: "", Note: long },
    { Reference: "1:intro", ID: "ab1c", Quote: "", Note: "# Jude 1 General Notes" },
    { Reference: "1:2", ID: "q2w3", Quote: "ἔλεος", Occurrence: "1", Note: "Mercy is..." },
  ]);
  assert(book!.intro === "book" && book!.chapter === undefined, "front:intro es la introducción del libro");
  assert(chapter!.intro === "chapter" && chapter!.chapter === 1 && chapter!.verse === undefined, "1:intro es la del capítulo 1");
  assert(verse!.intro === undefined && verse!.chapter === 1 && verse!.verse === 2, "una nota de un versículo no es una introducción");
  assert(book!.label === "xh5n" && book!.text === long, "una introducción no lleva de nombre su propio texto");
}

console.log("verify-portion-pr: ok");
