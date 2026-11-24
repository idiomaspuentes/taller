/**
 * The boxes a screen scrolls in hold what is placed absolutely inside them (the hidden texts for screen readers,
 * `.sr-only`). Left `static`, those were placed against the whole page instead: the page grew as tall as the list,
 * and centring a card or a field moved the whole page up, with the top menu half out of the screen and no way to
 * bring it back by hand (24 November: «Mis tareas» with many tasks).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");

/** The declarations of every rule that ends its selector list with exactly `selector`, at the top level. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  assert.ok(matches.length, `no rule for ${selector}`);
  return matches.map((match) => match[1]!).join("\n");
}

/**
 * Every box a whole screen scrolls in: the pages (`.app-main`), the tools (`.af`), Estudiar and the screens built on
 * it (`.fam__body`: group reading, helps editor, pair review), and the two panes of the text editor. A small panel
 * that scrolls inside one of these needs nothing: what escapes it stays in the screen's box.
 */
const SCREEN_BOXES = [
  ".app-main",
  ".af",
  ".fam__body",
  ".scripture-editor--split .scripture-editor__draft",
  ".scripture-editor--split .scripture-editor__tab-pane",
];

let passed = 0;
for (const box of SCREEN_BOXES) {
  const body = rule(box);
  assert.match(body, /overflow(-y)?:\s*auto/, `${box} is a box the screen scrolls in`);
  assert.match(body, /position:\s*relative/, `${box} holds what is placed absolutely inside it`);
  passed++;
  console.log(`ok  ${box} scrolls and holds what is placed inside it`);
}
console.log(`\nverify-scroll-boxes: ${passed} checks passed.`);
