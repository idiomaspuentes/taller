/** The size of the texts of the tools: what a device kept is read back, and the styles have a rule for each text. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asTextSize, TEXT_SCALE, TEXT_SIZES } from "../src/domain/textSize";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("lo guardado en el dispositivo se lee de vuelta, y cualquier otra cosa es el tamaño de siempre", () => {
  assert.deepEqual(TEXT_SIZES.map(asTextSize), ["normal", "large", "larger"]);
  assert.equal(asTextSize(null), "normal");
  assert.equal(asTextSize("enorme"), "normal");
  assert.equal(TEXT_SCALE.normal, 1, "el tamaño de siempre no cambia nada");
  assert.equal(TEXT_SCALE.large < TEXT_SCALE.larger, true);
});

test("cada texto que se lee o se escribe en una herramienta tiene su regla de tamaño", () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "components.css"), "utf8");
  const rules = css.split("\n").filter((line) => line.startsWith("html[data-text]"));
  // The translation, what it is read against and the original, in each tool that shows them.
  for (const text of [".scripture-editor__verse textarea", ".se-shown", ".af-draft__words .af-word--tap", ".af-ref .af-word", ".af-orig .af-word", ".gr-text__body", "dl.rv-sources", ".al-word", ".al-ref__word", ".st-word__text", ".pp-original", ".usfm-ro-root"]) {
    assert.equal(rules.some((rule) => rule.includes(text)), true, `falta la regla de ${text}`);
  }
  for (const rule of rules) assert.match(rule, /calc\([\d.]+rem \* var\(--ts\)\)/, `una regla que no crece con el tamaño elegido: ${rule.slice(0, 80)}`);
});

console.log(`\nverify-text-size: ${passed} checks passed.`);
