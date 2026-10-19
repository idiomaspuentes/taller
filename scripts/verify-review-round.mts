/**
 * Consensus of an asynchronous review round: who counts, when an item is
 * agreed, what goes to the meeting. Afinación of one chapter is the example.
 */
import assert from "node:assert/strict";
import type { CheckingDecisionsFile } from "@usfm-tools/types";
import {
  changedStretch,
  decisionsFilePath,
  mergeDecisionFiles,
  reviewersToNotifyAfterEdit,
  standingAnswers,
  summarizeRound,
  tallyItem,
  tcCheckerOf,
  textFingerprint,
  withAnswersGivenHere,
  type ReviewDecision,
} from "../src/domain/reviewRound";
import type { PersonLevel } from "../src/domain/levels";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const levels: Record<string, PersonLevel> = {
  ana: "habilitada",
  bea: "habilitada",
  carla: "habilitada",
  dora: "practicante",
  eva: "aprendiz",
};
const LEVELS = levels;
const thresholds = { minAgree: 3, minIndependent: 2 };
const authors = ["ana"]; // Ana wrote the draft

let t = 0;
function answer(reviewer: string, itemId: string, status: string, o: { hash?: string; note?: string } = {}): ReviewDecision {
  t += 1;
  return {
    itemId,
    reviewer,
    status,
    note: o.note,
    textHash: o.hash,
    ref: { start: { chapter: 1, verse: 2 } },
    sessionId: "s1",
    stageId: "afinacion",
    timestamp: new Date(Date.UTC(2026, 9, 1, 12, t)).toISOString(),
  } as ReviewDecision;
}
const tally = (decisions: ReviewDecision[], extra: { currentHash?: string } = {}) =>
  tallyItem({ itemId: "n1", decisions, levels, authors, thresholds, ...extra });

test("con el mínimo de habilitadas, dos de ellas independientes, el elemento queda acordado", () => {
  const r = tally([answer("ana", "n1", "approved"), answer("bea", "n1", "approved"), answer("carla", "n1", "approved")]);
  assert.equal(r.state, "agreed");
  assert.deepEqual([r.agree, r.agreeIndependent], [3, 2]);
});

test("quien redactó opina pero no cuenta como independiente", () => {
  const r = tally([answer("ana", "n1", "approved"), answer("bea", "n1", "approved")]);
  assert.equal(r.state, "pending", "faltan personas");
  const only = tally([answer("ana", "n1", "approved"), answer("bea", "n1", "approved"), answer("ana2", "n1", "approved")]);
  assert.equal(only.agree, 2, "quien no tiene nivel registrado no cuenta para el mínimo");
});

test("practicantes y aprendices pueden opinar, pero no suman al mínimo", () => {
  const r = tally([
    answer("ana", "n1", "approved"),
    answer("bea", "n1", "approved"),
    answer("dora", "n1", "approved"),
    answer("eva", "n1", "approved"),
  ]);
  assert.equal(r.agree, 2);
  assert.equal(r.state, "pending");
});

test("una objeción o un cambio propuesto abiertos impiden el acuerdo y pasan a la reunión", () => {
  const r = tally([
    answer("ana", "n1", "approved"),
    answer("bea", "n1", "approved"),
    answer("carla", "n1", "approved"),
    answer("dora", "n1", "rejected", { note: "«esperanza» no encaja aquí" }),
  ]);
  assert.equal(r.state, "disputed");
  assert.deepEqual(r.open, ["dora"], "también objeta quien aún no cuenta para el mínimo");
});

test("quien dice que el desafío no aplica queda dicho, y con las que el equipo necesita el equipo lo dice", () => {
  const doubt = (who: string, note?: string) => ({ ...answer(who, "n1", "approved"), challenge: { applies: false, ...(note ? { note } : {}) } }) as ReviewDecision;
  const sure = (who: string) => ({ ...answer(who, "n1", "approved"), challenge: { applies: true } }) as ReviewDecision;
  const two = tally([doubt("bea", "es una sinécdoque"), doubt("carla"), sure("ana")]);
  assert.deepEqual(two.doubted, [{ by: "bea", note: "es una sinécdoque" }, { by: "carla" }]);
  assert.equal(two.notApplicable, false, "dos de tres no bastan");
  assert.equal(two.state, "agreed", "lo que cada una juzgó de la traducción cuenta como siempre");
  const three = tally([doubt("ana"), doubt("bea"), doubt("carla")]);
  assert.equal(three.notApplicable, true);
  const learners = tally([doubt("ana"), doubt("bea"), doubt("dora"), doubt("eva")]);
  assert.equal(learners.notApplicable, false, "quien aún no cuenta para el mínimo lo dice, pero no suma");
  assert.equal(learners.doubted.length, 4);
  assert.deepEqual(tally([answer("ana", "n1", "approved")]).doubted, [], "una respuesta sin ese paso no dice nada del desafío");
});

test("cuenta la última respuesta de cada persona: quien cambia de parecer resuelve su objeción", () => {
  const r = tally([
    answer("ana", "n1", "approved"),
    answer("bea", "n1", "rejected"),
    answer("bea", "n1", "approved", { note: "ya lo vi con Carla" }),
    answer("carla", "n1", "approved"),
    answer("dora", "n1", "approved"),
    answer("eva", "n1", "approved"),
  ]);
  assert.equal(r.state, "agreed");
  assert.equal(r.answers.filter((a) => a.reviewer === "bea").length, 1);
});

test("si el texto cambió, las respuestas anteriores quedan como historial y hay que volver a revisar", () => {
  const hash = textFingerprint("con la esperanza de la vida eterna");
  const before = [
    answer("ana", "n1", "approved", { hash }),
    answer("bea", "n1", "approved", { hash }),
    answer("carla", "n1", "approved", { hash }),
  ];
  assert.equal(tally(before, { currentHash: hash }).state, "agreed");
  const after = tally(before, { currentHash: textFingerprint("con la confianza de la vida eterna") });
  assert.equal(after.state, "pending");
  assert.equal(after.stale.length, 3);
  assert.equal(after.answers.length, 0);
});

test("la huella no cambia por espacios ni por la forma de escribir los acentos", () => {
  assert.equal(textFingerprint("a  b\n c"), textFingerprint("a b c"));
  assert.equal(textFingerprint("esperanza "), textFingerprint(" esperanza"));
  assert.equal(textFingerprint("é"), textFingerprint("é"));
  assert.notEqual(textFingerprint("esperanza"), textFingerprint("confianza"));
});

test("el resumen: cierra cuando todo está acordado y arma la lista para la reunión", () => {
  const decisions = [
    answer("ana", "n1", "approved"), answer("bea", "n1", "approved"), answer("carla", "n1", "approved"),
    answer("bea", "n2", "rejected", { note: "otra palabra" }), answer("carla", "n2", "approved"),
    answer("ana", "n3", "approved"),
  ];
  const s = summarizeRound({ itemIds: ["n1", "n2", "n3"], decisions, levels, authors, thresholds, reviewers: ["ana", "bea", "carla", "dora"] });
  assert.deepEqual([s.agreed, s.disputed, s.pending], [1, 1, 1]);
  assert.equal(s.complete, false);
  assert.deepEqual(s.meeting.map((i) => i.itemId), ["n2"]);
  assert.deepEqual(s.waitingOn, ["dora"], "Dora aún no respondió nada");
  const done = summarizeRound({ itemIds: ["n1"], decisions: decisions.slice(0, 3), levels, authors, thresholds });
  assert.equal(done.complete, true);
  assert.equal(summarizeRound({ itemIds: [], decisions: [], levels, authors, thresholds }).complete, false, "sin elementos no hay cierre");
});

test("cada persona escribe su propio archivo y se leen juntos en orden de tiempo", () => {
  assert.equal(decisionsFilePath("tit", " Ana "), "checkings/decisions/TIT.ana.decisions.json");
  const a = answer("ana", "n1", "approved");
  const b = answer("bea", "n1", "revise");
  const files: CheckingDecisionsFile[] = [
    { book: "TIT", decisions: [b] },
    { book: "TIT", decisions: [a, { ...a, itemId: "" } as ReviewDecision] },
  ];
  assert.deepEqual(mergeDecisionFiles(files).map((d) => d.reviewer), ["ana", "bea"], "sin elemento no es una respuesta de revisión");
});

test("quien alineó un versículo no cuenta como independiente en ese versículo, pero sí en los demás", () => {
  const th = { minAgree: 2, minIndependent: 1 };
  const ds = [answer("ana", "v1", "approved"), answer("bea", "v1", "approved"), answer("ana", "v2", "approved"), answer("bea", "v2", "approved")];
  const base = { itemIds: ["v1", "v2"], decisions: ds, levels, authors: [] as string[], thresholds: th };
  assert.equal(summarizeRound(base).agreed, 2, "sin autores los dos versículos se acuerdan");
  const r = summarizeRound({ ...base, authorsByItem: { v1: ["ana", "bea"], v2: ["ana"] } });
  assert.deepEqual(r.items.map((i) => i.state), ["pending", "agreed"], "en v1 las dos son autoras; en v2 Bea es independiente");
});

// Jude 1:3 as the team had it, and after the article was taken out of «la necesidad».
const VERSE = "Amados, haciendo todo esfuerzo por escribirles sobre nuestra salvación común, tengo la necesidad de escribirles, exhortándolos a luchar por la fe.";
const FIXED = VERSE.replace("tengo la necesidad", "tengo necesidad");
const about = (reviewer: string, itemId: string, status: string, words: string, o: { note?: string; final?: boolean } = {}): ReviewDecision =>
  ({ ...answer(reviewer, itemId, status, { hash: textFingerprint(VERSE), note: o.note }), ...(words ? { selectedText: { text: words } } : {}), ...(o.final ? { final: true } : {}) }) as ReviewDecision;

test("solo suman los acuerdos sobre las mismas palabras", () => {
  const same = tally([
    about("ana", "n1", "approved", "En el año"),
    about("bea", "n1", "approved", "en el año,"),
    about("carla", "n1", "approved", "En el año"),
  ]);
  assert.equal(same.state, "agreed", "las mismas palabras, con otra mayúscula o una coma, son el mismo acuerdo");
  assert.equal(same.selections, undefined);
});

test("acuerdos sobre palabras distintas dejan el punto sin acuerdo, con lo que eligió cada grupo", () => {
  const r = tally([
    about("ana", "n1", "approved", "En el año"),
    about("bea", "n1", "approved", "En el primer año"),
    about("carla", "n1", "approved", "En el primer año"),
  ]);
  assert.equal(r.state, "disputed", "tres «de acuerdo» sobre dos selecciones no son un acuerdo");
  assert.equal(r.agree, 2, "cuentan los de la selección con más apoyo");
  assert.deepEqual(r.selections, [
    { words: "En el primer año", by: ["bea", "carla"] },
    { words: "En el año", by: ["ana"] },
  ]);
});

test("un acuerdo sin palabras elegidas va con la selección que más apoyo tiene", () => {
  const r = tally([about("ana", "n1", "approved", "En el año"), answer("bea", "n1", "approved"), about("carla", "n1", "approved", "En el año")]);
  assert.equal(r.state, "agreed");
  assert.equal(r.selections, undefined);
});

test("la decisión final del equipo cierra el punto aunque se hayan elegido palabras distintas", () => {
  const r = tallyItem({
    itemId: "n1",
    decisions: [about("ana", "n1", "approved", "En el año"), about("bea", "n1", "approved", "En el primer año"), { ...about("carla", "n1", "approved", "En el primer año", { final: true }) }],
    levels,
    authors,
    thresholds,
    confirmers: ["carla"],
  });
  assert.equal(r.state, "agreed");
  assert.equal(r.decided?.by, "carla");
});

test("corregir una palabra no hace caducar el acuerdo sobre otras palabras del versículo", () => {
  const given = [
    about("ana", "salvacion", "approved", "sobre nuestra salvación común,"),
    about("ana", "necesidad", "approved", "tengo la necesidad de escribirles,"),
    about("ana", "fe", "approved", "a luchar por la fe."),
  ];
  const now = standingAnswers(given, () => FIXED);
  const stale = (id: string) => tallyItem({ itemId: id, decisions: now, currentHash: textFingerprint(FIXED), levels, authors, thresholds }).stale.length;
  assert.equal(stale("salvacion"), 0, "sus palabras siguen como estaban");
  assert.equal(stale("fe"), 0, "«la» de «la fe» no es la que se quitó");
  assert.equal(stale("necesidad"), 1, "de estas palabras sí se quitó una");
  assert.equal(given[0]!.textHash, textFingerprint(VERSE), "lo que cada quien guardó no se toca");
});

test("una palabra elegida no vale por estar dentro de otra, ni un acuerdo sin palabras", () => {
  const given = [about("ana", "a", "approved", "fe."), about("ana", "b", "approved", "")];
  const now = standingAnswers(given, () => VERSE.replace("la fe.", "la confesión de fe.") + " café.");
  assert.equal(now[0]!.textHash === given[0]!.textHash, false, "«fe.» sigue en el versículo como palabra entera");
  const other = standingAnswers(given, () => VERSE.replace("la fe.", "el café."));
  assert.equal(other[0]!.textHash, given[0]!.textHash, "«café.» no es «fe.»");
  assert.equal(other[1]!.textHash, given[1]!.textHash, "sin palabras elegidas no hay de qué sostenerse");
});

test("un signo que cambia junto a las palabras elegidas no las cambia; uno entre ellas, sí", () => {
  const given = [about("ana", "a", "approved", "sobre nuestra salvación común,"), about("ana", "b", "approved", "común, tengo")];
  const now = standingAnswers(given, () => VERSE.replace("común, tengo", "común; tengo"));
  assert.equal(now[0]!.textHash === given[0]!.textHash, false, "la coma de después pasó a punto y coma: las palabras son las mismas");
  assert.equal(now[1]!.textHash, given[1]!.textHash, "el signo estaba entre las palabras elegidas");
});

test("una propuesta, una objeción y la decisión del equipo sí se vuelven a mirar tras una corrección", () => {
  const given = [
    about("bea", "salvacion", "revise", "sobre nuestra salvación común,", { note: "«común» mejor «compartida»" }),
    about("carla", "salvacion", "rejected", "sobre nuestra salvación común,", { note: "no" }),
    about("ana", "salvacion", "approved", "sobre nuestra salvación común,", { note: "se queda", final: true }),
  ];
  const now = standingAnswers(given, () => FIXED);
  const after = tallyItem({ itemId: "salvacion", decisions: now, currentHash: textFingerprint(FIXED), levels, authors, thresholds, confirmers: ["ana"] });
  assert.equal(after.stale.length, 3);
  assert.equal(after.decided, undefined);
});

test("tras una corrección solo se avisa a quien respondió sobre palabras que cambiaron", () => {
  const given = [about("bea", "salvacion", "approved", "sobre nuestra salvación común,"), about("carla", "necesidad", "approved", "tengo la necesidad de escribirles,")];
  const after = standingAnswers(given, () => FIXED);
  const told = (id: string) => reviewersToNotifyAfterEdit({ itemId: id, decisions: after, newHash: textFingerprint(FIXED), editor: "ana" });
  assert.deepEqual(told("salvacion"), []);
  assert.deepEqual(told("necesidad"), ["carla"]);
});

test("lo que cambió una corrección se dice en pocas palabras, con algo alrededor para encontrarlo", () => {
  assert.deepEqual(changedStretch(VERSE, FIXED), { before: "… común, tengo la necesidad de …", now: "… común, tengo necesidad de …" });
  assert.deepEqual(changedStretch("uno dos", "uno tres"), { before: "uno dos", now: "uno tres" });
});

test("con el paso cerrado, lo comprobado en translationCore muestra el punto cerrado, aunque lo haya traído alguien que no coordina, y sigue cerrado tras corregir otras palabras", () => {
  const tc = { ...about("dora", "necesidad", "approved", "tengo la necesidad de escribirles,", { note: "Comprobación hecha en translationCore (Keneramk)", final: true }) };
  const fixedNow = (d: ReviewDecision) => (d.itemId === "necesidad" ? undefined : FIXED);
  // Dora imported it; she is no confirmer, and no level of hers counts.
  const closed = tallyItem({ itemId: "necesidad", decisions: [tc], levels, authors: [], thresholds, currentHash: textFingerprint(VERSE), confirmers: ["carla"], tcCloses: true });
  assert.deepEqual(closed.decided, { by: "Keneramk", at: tc.timestamp, inTc: true });
  // «salvación» was checked there too; a correction elsewhere in the verse leaves those words, and the point closed.
  const other = about("dora", "salvacion", "approved", "sobre nuestra salvación común,", { note: "Comprobación hecha en translationCore (Keneramk)", final: true });
  const standing = standingAnswers([other], fixedNow);
  const after = tallyItem({ itemId: "salvacion", decisions: standing, levels, authors: [], thresholds, currentHash: textFingerprint(FIXED), confirmers: ["carla"], tcCloses: true });
  assert.equal(after.decided?.inTc, true, "sigue cerrado");
  // An objection after it opens it again.
  const objection = { ...answer("bea", "salvacion", "rejected", { hash: textFingerprint(FIXED), note: "No es común a todos." }) };
  const reopened = tallyItem({ itemId: "salvacion", decisions: [...standing, objection], levels, authors: [], thresholds, currentHash: textFingerprint(FIXED), confirmers: ["carla"], tcCloses: true });
  assert.equal(reopened.decided, undefined);
  assert.equal(reopened.state, "disputed");
  // What was half done there, not final, is an ordinary answer.
  const half = { ...tc, final: undefined };
  assert.equal(tallyItem({ itemId: "necesidad", decisions: [half], levels, authors: [], thresholds, currentHash: textFingerprint(VERSE), confirmers: ["carla"], tcCloses: true }).decided, undefined);
});

test("con el paso abierto, lo comprobado en translationCore no es voto de nadie ni cierra el punto: todos lo responden de nuevo", () => {
  // Brought over by abelper8, who coordinates: under his name, and it counted as his vote and closed the point.
  const levels = { ...LEVELS, abelper8: "habilitada" as const };
  const tc ={ ...about("abelper8", "necesidad", "approved", "tengo la necesidad de escribirles,", { note: "Comprobación hecha en translationCore (Keneramk)", final: true }) };
  const open = tallyItem({ itemId: "necesidad", decisions: [tc], levels, authors: [], thresholds, currentHash: textFingerprint(VERSE), confirmers: ["abelper8"] });
  assert.equal(open.decided, undefined, "no lo cierra");
  assert.equal(open.state, "pending");
  assert.equal(open.agree, 0, "no cuenta como voto");
  assert.deepEqual(open.answers, [], "ni como respuesta de quien lo trajo");
  // Marked as brought from translationCore, without the note, the same.
  const marked = { ...tc, note: undefined, source: "translationCore" as const, checkedBy: "Keneramk" };
  assert.equal(tallyItem({ itemId: "necesidad", decisions: [marked], levels, authors: [], thresholds, currentHash: textFingerprint(VERSE), confirmers: ["abelper8"] }).agree, 0);
  assert.equal(tcCheckerOf(marked), "Keneramk");
  // The answers given here count as always, beside it.
  const ana = answer("ana", "necesidad", "approved", { hash: textFingerprint(VERSE) });
  assert.equal(tallyItem({ itemId: "necesidad", decisions: [tc, ana], levels, authors: [], thresholds, currentHash: textFingerprint(VERSE), confirmers: ["abelper8"] }).agree, 1);
});

test("al releer las respuestas se ven las de los demás, y no se pierde la que se acaba de dar aquí", () => {
  const ana = answer("ana", "n1", "approved");
  const mine = answer("bea", "n1", "approved");
  const carla = answer("carla", "n2", "rejected", { note: "No hay personificación." });
  // Bea's own answer is not in the files yet; Carla answered meanwhile somewhere else.
  const now = withAnswersGivenHere([ana, carla], [ana, mine]);
  assert.deepEqual(now.map((d) => `${d.reviewer}:${d.itemId}`), ["ana:n1", "bea:n1", "carla:n2"]);
  // Once the files have it, it is not counted twice.
  assert.equal(withAnswersGivenHere([ana, mine, carla], [ana, mine]).length, 3);
});

console.log(`\nverify-review-round: ${passed} checks passed.`);
