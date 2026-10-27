/** The short link to one help of a checklist, to send to the team (27 October): written, read back, and refused. */
import assert from "node:assert/strict";
import { helpLinkHash, parseHelpLink } from "../src/domain/helpLink";
import { parseHash, routeToHash } from "../src/router";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const link = { org: "es-419_gl", project: "EST", issue: 1424, step: "notas-textos", item: "jd31" };

test("el enlace corto dice la organización, el libro, la subtarea, el paso y la nota, y nada más", () => {
  assert.equal(helpLinkHash(link), "#/n/es-419_gl/EST/1424/notas-textos/jd31");
});

test("se lee de vuelta tal cual", () => {
  assert.deepEqual(parseHelpLink(["es-419_gl", "EST", "1424", "notas-textos", "jd31"]), link);
});

test("la app lo reconoce como ruta y la vuelve a escribir igual", () => {
  const route = parseHash("#/n/es-419_gl/EST/1424/notas-textos/jd31");
  assert.deepEqual(route, { name: "nota", ...link });
  assert.equal(routeToHash(route), "#/n/es-419_gl/EST/1424/notas-textos/jd31");
});

test("un enlace cortado o con algo raro no se toma por una nota", () => {
  assert.equal(parseHelpLink(["es-419_gl", "EST", "1424", "notas-textos"]), null, "sin la nota");
  assert.equal(parseHelpLink(["es-419_gl", "EST", "abc", "notas-textos", "jd31"]), null, "la subtarea es un número");
  assert.equal(parseHelpLink(["es-419_gl", "EST", "0", "notas-textos", "jd31"]), null);
  assert.equal(parseHelpLink(["es-419_gl", "EST", "1424", "notas textos", "jd31"]), null, "sin espacios");
  assert.equal(parseHelpLink(["es-419_gl", "EST", "1424", "notas-textos", "jd31<script>"]), null);
  assert.notEqual(parseHash("#/n/es-419_gl/EST/1424").name, "nota");
});

test("la parada de todo un versículo también se comparte (su id es «verse:1:19»)", () => {
  const verse = { ...link, item: "verse:1:19" };
  const hash = helpLinkHash(verse);
  assert.deepEqual(parseHash(hash), { name: "nota", ...verse });
});

console.log(`\nverify-help-link: ${passed} checks passed.`);
