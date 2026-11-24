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

test("una regla partida en varias líneas se lee hasta su llave", () => {
  const css = "html[data-text] .a,\r\n/* html[data-text] .c */\nhtml[data-text] .b { font-size: calc(1rem * var(--ts)); }\n.d { color: red; }";
  const rules = textRules(css);
  assert.equal(rules.length, 1, "una sola regla");
  assert.match(rules[0]!.selector, /\.a,\s*html\[data-text\] \.b$/);
  assert.match(rules[0]!.body, /calc\(1rem \* var\(--ts\)\)/);
  assert.equal(rules.some((rule) => rule.selector.includes(".c")), false, "lo comentado no cuenta");
});

test("cada texto que se lee o se escribe en una herramienta tiene su regla de tamaño", () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "components.css"), "utf8");
  const rules = textRules(css);
  // The translation, what it is read against and the original, in each tool that shows them.
  for (const text of [".scripture-editor__verse textarea", ".se-shown", ".af-draft__words .af-word--tap", ".af-ref .af-word", ".af-orig .af-word", ".gr-text__body", "dl.rv-sources", ".al-word", ".al-ref__word", ".st-word__text", ".pp-original", ".usfm-ro-root", ".tc .al-diff", ".cr-words", ".cr-why", ".pl-note", ".ns-body", ".ns-article", ".ns-quote", ".vc-verse", ".vc .af-orig .af-word", ".word-sheet", ".st-sheet", ".rf-word", ".rf-item", ".chat-decision__text", ".chat-decision__panel .al-diff", ".plt-text", ".st-aligned", ".st-morph", ".ag-question", ".ag-today__text", ".ag-opt__text", ".ag-opt__why", ".ag-opt__who", ".ag-diff", ".tc[data-lines] .al-diff", ".ck-verse", ".ck-quote", ".addr-hint__text", ".crp__cell", ".crp__head", ".af-heading", ".af-about__rule", ".guide__text",
    // The Translation phase: the notes wherever they are read, the box of the helps editor, what is reviewed in pairs, Words and Academy.
    ".scripture-editor__help-md", ".mde-box", ".rv-item__text", ".rv-help__source", ".rv-help__now", ".ab-text", ".ab-peek", ".ab-read", ".fam-notes__body",
    ".fam-notes__quote", ".rv-comment__text", ".scripture-editor__help-quote", ".scripture-editor__help-title", ".scripture-editor__help-head-title", ".scripture-editor__help-body", ".ab-over .hs-quote", ".hs-verse p"]) {
    assert.equal(rules.some((rule) => rule.selector.includes(text)), true, `falta la regla de ${text}`);
  }
  // `var(--ts, 1)` is the same size: a rule that also holds without `data-text` needs the fallback.
  for (const rule of rules) assert.match(rule.body, /calc\([\d.]+rem \* var\(--ts(?:, ?1)?\)\)/, `una regla que no crece con el tamaño elegido: ${rule.selector.slice(0, 80)}`);
});

/**
 * Each rule whose selector starts with `html[data-text]`, as its selector and what is inside its braces. A selector
 * may be split over several lines (one per text), so a rule is read up to its brace, not by the line; comments do not
 * count.
 */
function textRules(css: string): { selector: string; body: string }[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1]!.trim(), body: match[2]! }))
    .filter((rule) => rule.selector.startsWith("html[data-text]"));
}

console.log(`\nverify-text-size: ${passed} checks passed.`);
