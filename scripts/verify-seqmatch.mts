import { sequenceMatcherRatio } from "../src/status/sequenceMatcher.ts";

const pairs: [string, string][] = [
  ["hello world", "hello world"],
  ["hello world", "goodbye earth"],
  ["the quick brown fox jumps over the lazy dog", "the quick brown fox leaps over a lazy dog"],
  ["a".repeat(250) + "unique tail one", "a".repeat(250) + "unique tail two"],
  ["metaphor", "metáfora"],
  ["", ""],
  ["x", ""],
  ["", "y"],
];

console.log(JSON.stringify(pairs.map(([a, b]) => sequenceMatcherRatio(a, b))));
