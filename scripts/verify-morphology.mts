/** The grammar of a word of the original, read from the code the UGNT and the UHB tag it with. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeMorph, MORPH_KEYS, type MorphLabel } from "../src/domain/morphology";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const es = JSON.parse(readFileSync(new URL("../src/i18n/locales/es.json", import.meta.url), "utf8")) as Record<string, string>;
const pt = JSON.parse(readFileSync(new URL("../src/i18n/locales/pt.json", import.meta.url), "utf8")) as Record<string, string>;
const say = (labels: MorphLabel[], texts = es) => labels.map((l) => ("key" in l ? texts[`mo.${l.key}`] : l.text)).join(", ");
const read = (morph: string, texts = es) => describeMorph(morph).map((part) => say(part, texts));

test("un verbo griego dice modo, tiempo, voz, persona y número", () => {
  assert.deepEqual(read("Gr,V,IPA3,,S,"), ["verbo, indicativo, presente, activa, 3.ª persona, singular"]);
});

test("un participio griego dice caso, género y número en lugar de persona", () => {
  assert.deepEqual(read("Gr,V,PPA,NMS,"), ["verbo, participio, presente, activa, nominativo, masculino, singular"]);
});

test("un sustantivo y un artículo griegos dicen caso, género y número", () => {
  assert.deepEqual(read("Gr,N,,,,,DFS,"), ["sustantivo, dativo, femenino, singular"]);
  assert.deepEqual(read("Gr,EA,,,,AMP,"), ["determinante, artículo, acusativo, masculino, plural"]);
});

test("un adjetivo usado como sustantivo se dice una sola vez, y su grado al final", () => {
  assert.deepEqual(read("Gr,NS,,,,DMPC"), ["adjetivo sustantivado, dativo, masculino, plural, comparativo"]);
});

test("una preposición griega dice el caso que rige, y una conjunción su tipo", () => {
  assert.deepEqual(read("Gr,P,,,,,G,,,"), ["preposición, genitivo"]);
  assert.deepEqual(read("Gr,CC,,,,,,,,"), ["conjunción, coordinante"]);
  assert.deepEqual(read("Gr,D,,,,,,,,,"), ["adverbio"]);
});

test("un pronombre personal griego dice persona, caso y número", () => {
  assert.deepEqual(read("Gr,RP,,,2G,S,"), ["pronombre, personal, 2.ª persona, genitivo, singular"]);
});

test("una palabra hebrea unida a una conjunción tiene una parte por cada pieza", () => {
  assert.deepEqual(read("He,C:Vqw3ms"), ["conjunción", "verbo, qal, imperfecto secuencial (wayyiqtol), 3.ª persona, masculino, singular"]);
});

test("un sustantivo hebreo dice tipo, género, número y estado; con sufijo, la persona del sufijo", () => {
  assert.deepEqual(read("He,Ncmsc"), ["sustantivo, común, masculino, singular, constructo"]);
  assert.deepEqual(read("He,Ncfsc:Sp3ms"), ["sustantivo, común, femenino, singular, constructo", "sufijo, pronominal, 3.ª persona, masculino, singular"]);
  assert.deepEqual(read("He,Np"), ["sustantivo, nombre propio"]);
});

test("un participio hebreo no tiene persona", () => {
  assert.deepEqual(read("He,Vqrmsa"), ["verbo, qal, participio activo, masculino, singular, absoluto"]);
});

test("en arameo los troncos tienen sus propios nombres", () => {
  assert.deepEqual(read("Ar,Vqp3ms"), ["verbo, peal, perfecto (qatal), 3.ª persona, masculino, singular"]);
  assert.deepEqual(read("Ar,Ncmsd:Td"), ["sustantivo, común, masculino, singular, determinado", "partícula, artículo definido"]);
});

test("la misma gramática se lee en portugués", () => {
  assert.deepEqual(read("Gr,V,IPA3,,S,", pt), ["verbo, indicativo, presente, ativa, 3.ª pessoa, singular"]);
  assert.deepEqual(read("He,Ncmsc", pt), ["substantivo, comum, masculino, singular, construto"]);
});

test("sin código no hay nada que decir, y un código desconocido se muestra tal cual", () => {
  assert.deepEqual(describeMorph(undefined), []);
  assert.deepEqual(describeMorph(""), []);
  assert.deepEqual(read("Gr,Z,,,,,,,,,"), ["Z"]);
});

test("todo nombre que el lector puede dar tiene su texto en español y en portugués", () => {
  assert.ok(MORPH_KEYS.length > 80);
  assert.deepEqual(MORPH_KEYS.filter((name) => !es[`mo.${name}`] || !pt[`mo.${name}`]), []);
});

console.log(`\nverify-morphology: ${passed} checks passed.`);
