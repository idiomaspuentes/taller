/**
 * Publishing one unit: the checks that run before, the endorsement it must still match, and the patch that puts the
 * unit into the published file without touching the rest.
 */
import assert from "node:assert/strict";
import {
  checkAgainstEndorsement,
  checkUnitTable,
  checkUnitText,
  publishUnitTsv,
  publishUnitUsfm,
  tableFingerprints,
  textFingerprints,
  unalignedWords,
  unitSlug,
} from "../src/domain/unitPublish";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const aligned = (greek: string, word: string) => `\\zaln-s |x-strong="G1" x-content="${greek}"\\*\\w ${word}|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*`;
const HEAD = "\\id TIT\n\\usfm 3.0\n\\h Tito\n\\mt Tito\n";
const draft = `${HEAD}\\c 1\n\\p\n\\v 1 ${aligned("a", "Pablo")}\n\\c 2\n\\p\n\\v 1 ${aligned("b", "Pero")} ${aligned("c", "tú")}\n\\v 2 ${aligned("d", "Nuevo")}\n\\v 3 ${aligned("e", "Tres")}\n\\c 3\n\\p\n\\v 1 ${aligned("f", "Recuérdales")}\n`;
const published = `${HEAD}\\c 1\n\\p\n\\v 1 Publicado uno\n\\c 2\n\\p\n\\v 1 Viejo uno\n\\v 2 Viejo dos\n\\v 3 Viejo tres\n\\c 3\n\\p\n\\v 1 Publicado tres\n`;
const chapter2 = { chapter: 2, from: 1, to: 200 };

test("las palabras fuera de toda marca de alineación se detectan", () => {
  assert.deepEqual(unalignedWords(`${aligned("a", "Pero")} \\w suelta|x-occurrence="1"\\w* ${aligned("b", "tú")}`), ["suelta"]);
  assert.deepEqual(unalignedWords(`${aligned("a", "Pero")}`), []);
});

test("un texto completo y alineado pasa; lo que falta se dice por versículo", () => {
  assert.deepEqual(checkUnitText({ resource: "tpl", usfm: draft, range: chapter2, expectedVerses: [1, 2, 3], aligned: true }), []);
  const found = checkUnitText({ resource: "tpl", usfm: draft, range: chapter2, expectedVerses: [1, 2, 3, 4], aligned: true });
  assert.deepEqual(found, [{ id: "verses-missing", resource: "tpl", where: ["2:4"] }]);
  assert.equal(checkUnitText({ resource: "tpl", usfm: null, range: chapter2, expectedVerses: [1], aligned: true })[0]!.id, "draft-missing");
});

test("un versículo vacío o sin alinear detiene la publicación; sin exigir alineación, no", () => {
  const loose = draft.replace(`\\v 2 ${aligned("d", "Nuevo")}`, "\\v 2 Nuevo sin alinear").replace(`\\v 3 ${aligned("e", "Tres")}`, "\\v 3 ");
  const found = checkUnitText({ resource: "tpl", usfm: loose, range: chapter2, expectedVerses: [1, 2, 3], aligned: true });
  assert.deepEqual(found.map((p) => [p.id, p.where.join()]), [["verses-empty", "2:3"], ["not-aligned", "2:2"]]);
  assert.deepEqual(checkUnitText({ resource: "tps", usfm: loose, range: chapter2, expectedVerses: [1, 2], aligned: false }), []);
});

test("publicar un capítulo cambia solo ese capítulo y conserva lo demás byte a byte", () => {
  const out = publishUnitUsfm(published, draft, chapter2);
  assert.ok(out.includes("\\v 1 Publicado uno\n\\c 2"), "el capítulo 1 queda igual");
  assert.ok(out.endsWith("\\c 3\n\\p\n\\v 1 Publicado tres\n"), "el capítulo 3 queda igual");
  assert.ok(out.includes(`\\v 2 ${aligned("d", "Nuevo")}`) && !out.includes("Viejo"), "el capítulo 2 viene del borrador, con sus marcas");
  assert.equal(publishUnitUsfm(out, draft, chapter2), out, "publicar dos veces no cambia nada");
});

test("publicar un tramo cambia solo sus versículos", () => {
  const out = publishUnitUsfm(published, draft, { chapter: 2, from: 2, to: 3 });
  assert.ok(out.includes("\\v 1 Viejo uno\n") && out.includes(aligned("d", "Nuevo")) && out.includes(aligned("e", "Tres")));
  assert.ok(!out.includes("Viejo dos") && !out.includes("Viejo tres"));
});

test("un capítulo que aún no está publicado entra en su lugar; sin archivo, nace con el encabezado y la unidad", () => {
  const without = `${HEAD}\\c 1\n\\p\n\\v 1 Publicado uno\n\\c 3\n\\p\n\\v 1 Publicado tres\n`;
  const out = publishUnitUsfm(without, draft, chapter2);
  assert.ok(out.indexOf("\\c 1") < out.indexOf("\\c 2") && out.indexOf("\\c 2") < out.indexOf("\\c 3"), "en orden");
  assert.ok(out.includes(aligned("b", "Pero")));
  const fresh = publishUnitUsfm(null, draft, chapter2);
  assert.ok(fresh.startsWith(HEAD) && fresh.includes("\\c 2") && !fresh.includes("\\c 1") && !fresh.includes("\\c 3"));
  assert.equal(publishUnitUsfm("\\id TIT\r\n\\c 2\r\n\\p\r\n\\v 1 Viejo\r\n", draft, chapter2).includes("\r\n\\v 2"), true, "respeta los saltos de línea del publicado");
});

const TN_HEAD = "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote";
const tnDraft = [TN_HEAD, "front:intro\tab12\t\t\t\t0\tIntroducción", "1:1\taaaa\t\t\tq\t1\tNota uno", "2:intro\tin22\t\t\t\t0\tIntro dos", "2:1\tbbbb\t\trc://*/ta/man/translate/figs-you\tσὺ\t1\tNota nueva", "2:9\tcccc\t\t\tδούλους\t1\tOtra nueva", "3:1\tdddd\t\t\tq\t1\tNota tres", ""].join("\n");
const tnPublished = [TN_HEAD, "1:1\taaaa\t\t\tq\t1\tPublicada uno", "2:1\tbbbb\t\t\tσὺ\t1\tVieja", "2:5\tzzzz\t\t\tq\t1\tQue ya no existe", "3:1\tdddd\t\t\tq\t1\tPublicada tres", ""].join("\n");

test("una tabla de la unidad pasa cuando sus filas están completas; cada falta se dice por fila", () => {
  assert.deepEqual(checkUnitTable({ resource: "notas", tsv: tnDraft, range: chapter2, content: ["Note"], quoted: true }), []);
  const broken = tnDraft.replace("2:1\tbbbb\t\trc://*/ta/man/translate/figs-you\tσὺ\t1\tNota nueva", "2:1\tb\t\tfigs-you\t\t1\t").replace("2:9\tcccc", "2:9\taaaa");
  const found = checkUnitTable({ resource: "notas", tsv: broken, range: chapter2, content: ["Note"], quoted: true });
  assert.deepEqual(found.map((p) => p.id), ["row-id", "row-id-repeated", "row-empty", "row-quote", "row-support"]);
  assert.equal(checkUnitTable({ resource: "notas", tsv: "A\tB\n1\t2\n", range: chapter2, content: ["Note"], quoted: true })[0]!.id, "tsv-header");
  assert.equal(checkUnitTable({ resource: "preguntas", tsv: tnDraft, range: { chapter: 9, from: 1, to: 200 }, content: ["Note"], quoted: false })[0]!.id, "rows-none");
});

test("publicar las filas de un capítulo reemplaza las suyas (también las que ya no existen) y deja las demás", () => {
  const out = publishUnitTsv(tnPublished, tnDraft, chapter2);
  assert.deepEqual(out.trim().split("\n").map((line) => line.split("\t").slice(0, 2).join(" ")), ["Reference ID", "1:1 aaaa", "2:intro in22", "2:1 bbbb", "2:9 cccc", "3:1 dddd"]);
  assert.ok(out.includes("Publicada uno") && out.includes("Publicada tres") && out.includes("Nota nueva") && !out.includes("zzzz"));
  assert.equal(publishUnitTsv(out, tnDraft, chapter2), out, "publicar dos veces no cambia nada");
  const tail = publishUnitTsv(tnPublished, tnDraft, { chapter: 2, from: 9, to: 15 });
  assert.ok(tail.includes("Vieja") && tail.includes("Otra nueva") && tail.includes("zzzz"), "un tramo deja el resto del capítulo");
  assert.ok(publishUnitTsv(null, tnDraft, chapter2).startsWith(`${TN_HEAD}\n2:intro`));
});

test("lo que cambió después del aval se detecta por versículo y por fila", () => {
  const endorsed = { tpl: textFingerprints(draft, chapter2), notas: tableFingerprints(tnDraft, chapter2) };
  assert.deepEqual(checkAgainstEndorsement({ tpl: textFingerprints(draft, chapter2), notas: tableFingerprints(tnDraft, chapter2) }, endorsed), []);
  const edited = draft.replace("Nuevo", "Cambiado");
  const now = { tpl: textFingerprints(edited, chapter2), notas: tableFingerprints(tnDraft.replace("Otra nueva", "Otra, retocada"), chapter2) };
  assert.deepEqual(checkAgainstEndorsement(now, endorsed), [
    { id: "changed-since-endorsement", resource: "tpl", where: ["2:2"] },
    { id: "changed-since-endorsement", resource: "notas", where: ["2:9 · cccc"] },
  ]);
  assert.equal(checkAgainstEndorsement(now, null)[0]!.id, "not-endorsed");
  // Re-aligning a verse does not change its words: the endorsement still holds.
  assert.deepEqual(textFingerprints(draft.replace('x-content="d"', 'x-content="otra"'), chapter2), textFingerprints(draft, chapter2));
});

test("el nombre de la unidad", () => {
  assert.equal(unitSlug({ chapter: 119, from: 89, to: 176 }), "119.89-176");
});

console.log(`\nverify-unit-publish: ${passed} checks passed.`);
