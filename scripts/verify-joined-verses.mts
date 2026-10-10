/** Verses a draft writes as one: which of them a passage has, so the alignment screen can say it does not offer them. */
import assert from "node:assert/strict";
import { joinedVerses } from "../src/domain/joinedVerses";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const SIDS = ["JUD 1:3", "JUD 1:4-5", "JUD 1:6", "JUD 1:12–13", "JUD 2:1-2", "JUD 1:20-21"];

test("de los versículos de un capítulo se dan los que el borrador escribe como uno solo, en orden", () => {
  assert.deepEqual(joinedVerses(SIDS, 1, null), [{ from: 4, to: 5 }, { from: 12, to: 13 }, { from: 20, to: 21 }], "con guion o con raya; los de otro capítulo no");
  assert.deepEqual(joinedVerses(["JUD 1:3", "JUD 1:6"], 1, null), []);
});

test("de un pasaje, solo los que lo tocan, aunque empiecen antes o terminen después", () => {
  assert.deepEqual(joinedVerses(SIDS, 1, { from: 5, to: 8 }), [{ from: 4, to: 5 }], "4–5 toca un pasaje que empieza en el 5");
  assert.deepEqual(joinedVerses(SIDS, 1, { from: 6, to: 11 }), []);
  assert.deepEqual(joinedVerses(SIDS, 1, { from: 13, to: 20 }), [{ from: 12, to: 13 }, { from: 20, to: 21 }]);
});

console.log(`\nverify-joined-verses: ${passed} checks passed.`);
