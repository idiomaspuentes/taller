/**
 * Sections of an article left out where it is read to understand a point (afinación): the translation suggestions
 * of Translation Words and the strategies of Translation Academy, by their titles in the process package.
 */
import assert from "node:assert/strict";
import { headingKey, withoutSections, articleLead } from "../src/domain/articleSections";
import { readingOmits } from "../src/domain/processes";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const omit = readingOmits();

test("el paquete del FCR nombra las secciones en inglés, español y portugués", () => {
  for (const title of ["Translation Suggestions", "Sugerencias de traducción", "Translation Strategies", "Estrategias de traducción", "Examples of Translation Strategies Applied", "Ejemplos de estrategias de traducción aplicadas", "Sugestões de tradução"]) {
    assert.ok(omit.map(headingKey).includes(headingKey(title)), title);
  }
});

test("de una palabra se quitan sus sugerencias de traducción, hasta las referencias bíblicas", () => {
  const article = ["# arca", "", "## Definición:", "", "Un arca es una caja grande.", "", "## Sugerencias de Traducción:", "", "* Se puede traducir como «caja».", "", "## Referencias bíblicas:", "", "* Génesis 6:14"].join("\n");
  const { text, omitted } = withoutSections(article, omit);
  assert.equal(omitted, true);
  assert.ok(text.includes("Un arca es una caja grande.") && text.includes("Génesis 6:14"));
  assert.ok(!text.includes("«caja»") && !/Sugerencias/i.test(text));
});

test("de un artículo de la Academia se quitan las estrategias y sus ejemplos aplicados, con lo que tengan dentro", () => {
  const article = [
    "### Description",
    "A metaphor is a figure of speech.",
    "### Examples From the Bible",
    "> The Lord is my shepherd.",
    "### Translation Strategies",
    "1. Use a simile.",
    "#### For example",
    "A strategy example.",
    "### Examples of Translation Strategies Applied",
    "(1) The Lord is like a shepherd.",
  ].join("\n");
  const { text, omitted } = withoutSections(article, omit);
  assert.equal(omitted, true);
  assert.deepEqual(text.split("\n"), ["### Description", "A metaphor is a figure of speech.", "### Examples From the Bible", "> The Lord is my shepherd."]);
});

test("una sección que sigue, del mismo nivel, se queda", () => {
  const article = ["### Translation Strategies", "Use a simile.", "### When the unit of measure is implied", "Keep it."].join("\n");
  assert.equal(withoutSections(article, omit).text, ["### When the unit of measure is implied", "Keep it."].join("\n"));
});

test("una sugerencia dentro de la definición, como viñeta, se deja donde está; sin esas secciones no se quita nada", () => {
  const article = ["# ark", "## Definition:", "* Ways to translate this term could include “very large boat”.", "## Bible References:", "* Genesis 6:14"].join("\n");
  assert.deepEqual(withoutSections(article, omit), { text: article, omitted: false });
});

test("el título se reconoce con dos puntos, mayúsculas o espacios de más; un «#» dentro de un bloque de código no es título", () => {
  assert.equal(headingKey("  Sugerencias de Traducción: "), headingKey("sugerencias de traducción"));
  const code = ["## Definición", "```", "## Sugerencias de traducción", "```", "fin"].join("\n");
  assert.equal(withoutSections(code, omit).omitted, false);
});

test("lo que enseña un artículo es su primera sección, sin el título, y unos pocos párrafos", () => {
  const ta = "### Descripción\n\nUn evento nuevo empieza un relato.\n\nOtra línea.\n\n### Ejemplos\n\nNo.";
  assert.equal(articleLead(ta), "Un evento nuevo empieza un relato.\n\nOtra línea.");
  const tw = "# Ira, furia\n\n## Definición\n\nLa ira es una emoción.\n\n## Sugerencias\n\nNo.";
  assert.equal(articleLead(tw), "La ira es una emoción.");
  const long = "Primero.\n\n" + "x".repeat(700);
  assert.equal(articleLead(long), "Primero.", "no más de unos párrafos");
});

console.log(`\nverify-article-sections: ${passed} checks passed.`);
