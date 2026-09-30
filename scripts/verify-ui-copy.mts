/**
 * Fails when text the team can read names Git/Door43 internals.
 * Scans string literals and JSX text in src/components (and the domain
 * files that build visible text). Administración (QA) and dev-only
 * screens may stay technical.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN =
  /\b(tronco|rama|ramas|SHA|master|tags?|releases?|PRs?|issues?|DCS|roster|presets?|slug|commits?|backlog)\b|Organización PM|organización PM/i;

const SKIP_FILES = /(QaAdminDialog|QaTestScenarioSection|SolverLabView|ConflictSandboxView)\.tsx$/;
const EXTRA = ["src/domain/verseConflictEvent.ts", "src/domain/attention.ts", "src/domain/conversation.ts", "src/domain/release.ts", "src/domain/principalPass.ts", "src/domain/reviewTask.ts", "src/domain/waits.ts"];

const files = readdirSync("src/components")
  .filter((f) => f.endsWith(".tsx") && !SKIP_FILES.test(f))
  .map((f) => join("src/components", f))
  .concat(EXTRA, ["src/App.tsx"]);

/** Spanish-looking visible text: quoted strings and JSX text nodes. */
function visibleStrings(source: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || /^(\/\/|\*|\/\*|import\b|export type|type\b)/.test(line)) return;
    const strings = [...line.matchAll(/(["'`])((?:\.|(?!\1).)*)\1/g)].map((m) => m[2]!);
    for (const raw of strings) {
      const s = raw.replace(/\$\{[^}]*\}/g, " ");
      if (/^[a-z][\w:.\/-]*$/.test(s)) continue; // ids, classes, keys
      if (/^(\.|#|@|\/|https?:|--|data-|aria-)/.test(s)) continue;
      if (/\s/.test(s) || /[áéíóúñÁÉÍÓÚ¿¡…]/.test(s)) out.push({ text: s, line: i + 1 });
    }
    const bare = line.replace(/\$\{[^}]*\}/g, " ");
    const jsx = bare.match(/^[^<>{}=]*[A-Za-zÁÉÍÓÚáéíóúñ¿¡][^<>{}=]*$/);
    if (jsx && /\s/.test(line) && !/[;(){}]|=>|\bconst\b|\breturn\b/.test(line)) out.push({ text: line, line: i + 1 });
  });
  return out;
}

/** Tailwind-like class lists and code fragments are not visible text. */
function isCode(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const tokens = t.split(/\s+/);
  if (tokens.every((w) => /^[\w:\[\]\/.%()#!-]+$/.test(w)) && tokens.some((w) => /[-:\/\[]/.test(w)) && !/[áéíóúñ]/i.test(t)) return true;
  return /^[:?&]/.test(t) || /^\w+\??:/.test(t) || /\w\.\w/.test(t) || /[,|]\s*$/.test(t) || /\?\s*$/.test(t);
}

let bad = 0;
for (const file of files) {
  for (const { text, line } of visibleStrings(readFileSync(file, "utf8"))) {
    if (isCode(text)) continue;
    const hit = FORBIDDEN.exec(text);
    if (hit) {
      bad++;
      console.error(`${file}:${line}  «${hit[0]}»  ${text.slice(0, 100)}`);
    }
  }
}
if (bad) {
  console.error(`\nverify-ui-copy: ${bad} visible text(s) use technical words.`);
  process.exit(1);
}
console.log("verify-ui-copy: ok");
