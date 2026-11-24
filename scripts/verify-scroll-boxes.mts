/**
 * The boxes a screen scrolls in hold what is placed absolutely inside them (the hidden texts for screen readers,
 * `.sr-only`). Left `static`, those were placed against the whole page instead: the page grew as tall as the list,
 * and centring a card or a field moved the whole page up, with the top menu half out of the screen and no way to
 * bring it back by hand (24 November: «Mis tareas» with many tasks).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/components.css", import.meta.url), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `no rule for ${selector}`);
  return match[1]!;
}

let passed = 0;
for (const box of [".app-main", ".af"]) {
  const body = rule(box);
  assert.match(body, /overflow-y:\s*auto/, `${box} is a box the screen scrolls in`);
  assert.match(body, /position:\s*relative/, `${box} holds what is placed absolutely inside it`);
  passed++;
  console.log(`ok  ${box} scrolls and holds what is placed inside it`);
}
console.log(`\nverify-scroll-boxes: ${passed} checks passed.`);
