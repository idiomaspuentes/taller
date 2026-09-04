/**
 * Diffs the TS port (src/status) against the exact expectations Python's
 * fcr_status/selftest.py checks — same fixtures, same article ids, same
 * expected classifications. No network: reads the local scan_translated
 * fixture trees directly.
 *
 *   npm run verify:status
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  KIND_ACADEMIA,
  KIND_PALABRAS,
  collectFromPrep,
  normalizeAcademia,
  normalizePalabras,
  type ArticleRef,
} from "../src/status/collect.ts";
import { checkArticles, STATUS_MISSING } from "../src/status/check.ts";
import { emitJson, statusToDict } from "../src/status/emit.ts";
import { STATUS_ENGLISH, STATUS_INCOMPLETE, STATUS_TRANSLATED } from "../src/status/detect.ts";
import { subjectFromManifest, type ArticleClient, type FetchedArticle } from "../src/status/dcs.ts";
import { runPrep } from "../src/prep/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "src", "status", "__fixtures__", "scan_translated");
const prepFixturesDir = join(here, "..", "src", "prep", "__fixtures__");

let failed = false;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failed = true;
    console.error(`FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

/** Same contract as the Python LocalTreeClient: read articles from a local TA/TW tree, no network. */
class LocalTreeClient implements ArticleClient {
  constructor(private roots: Record<string, string>) {}

  private walk(root: string): Map<string, string> {
    const tree = new Map<string, string>();
    const visit = (dir: string, prefix: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const rel = prefix ? `${prefix}/${name}` : name;
        if (statSync(full).isDirectory()) visit(full, rel);
        else tree.set(rel.replace(/\\/g, "/"), readFileSync(full, "utf-8"));
      }
    };
    visit(root, "");
    return tree;
  }

  async subjectFor(kind: string): Promise<string> {
    const root = this.roots[kind];
    if (!root) return "subject";
    for (const name of ["manifest.yaml", "manifest.yml"]) {
      try {
        const text = readFileSync(join(root, name), "utf-8");
        const value = subjectFromManifest(text);
        if (value) return value;
      } catch {
        continue;
      }
    }
    return "subject";
  }

  async fetchArticle(ref: ArticleRef): Promise<FetchedArticle> {
    const root = this.roots[ref.kind];
    if (!root) return { ref, found: false, path: ref.path || ref.articleId, files: [], htmlUrl: "", apiUrl: "", owner: "local", repo: "", branch: "fixture", fetchMode: "local" };
    const tree = this.walk(root);
    const directory = ref.kind === KIND_ACADEMIA ? (ref.path || `translate/${ref.articleId}`).replace(/^\/+|\/+$/g, "") : null;
    let paths: string[];
    if (directory !== null) {
      paths = [...tree.keys()].filter((k) => k.startsWith(`${directory}/`) && k.toLowerCase().endsWith(".md")).sort();
    } else {
      const slug = ref.articleId;
      let path = (ref.path || "").replace(/^\/+|\/+$/g, "");
      if (path.toLowerCase().endsWith(".md")) path = path.slice(0, -3);
      const candidates = [path, `bible/kt/${slug}`, `bible/names/${slug}`, `bible/other/${slug}`].filter(Boolean);
      paths = [];
      for (const c of candidates) {
        if (tree.has(`${c}.md`)) {
          paths = [`${c}.md`];
          break;
        }
        const folder = [...tree.keys()].filter((k) => k.startsWith(`${c}/`) && k.toLowerCase().endsWith(".md")).sort();
        if (folder.length) {
          paths = folder;
          break;
        }
      }
    }
    const files: [string, string][] = paths.filter((p) => tree.has(p)).map((p) => [p, tree.get(p)!]);
    const resolved = files.length
      ? files[0][0].endsWith(".md") && files.length === 1 && !directory
        ? files[0][0].slice(0, -3)
        : files[0][0].slice(0, files[0][0].lastIndexOf("/"))
      : ref.path || ref.articleId;
    return {
      ref,
      found: files.length > 0,
      path: resolved,
      files,
      htmlUrl: `file://${root}/${resolved}`,
      apiUrl: "",
      owner: "local",
      repo: root,
      branch: "fixture",
      fetchMode: "local",
    };
  }
}

function read(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf-8");
}

const prepPayload = runPrep({
  book: "TIT",
  ultText: read(prepFixturesDir, "57-TIT-sample.usfm"),
  tn: { path: "tn_TIT.tsv", text: read(prepFixturesDir, "tn_TIT.tsv") },
  tq: { path: "tq_TIT.tsv", text: read(prepFixturesDir, "tq_TIT.tsv") },
  twl: { path: "twl_TIT.tsv", text: read(prepFixturesDir, "twl_TIT.tsv") },
});

const refs = collectFromPrep(prepPayload);
check("collect_from_prep finds god in palabras[]", refs.some((r) => r.kind === KIND_PALABRAS && r.articleId === "god"));
const godRef = refs.find((r) => r.kind === KIND_PALABRAS && r.articleId === "god");
check("god path is bible/kt/god", godRef?.path === "bible/kt/god", godRef);
check("collect_from_prep finds figs-metaphor in academia[]", refs.some((r) => r.kind === KIND_ACADEMIA && r.articleId === "figs-metaphor"));

const ta = normalizeAcademia("figs-metaphor");
const ta2 = normalizeAcademia("translate/figs-metaphor");
check("normalize TA", ta.path === "translate/figs-metaphor" && ta2.articleId === "figs-metaphor", { ta, ta2 });
const tw = normalizePalabras("god");
const tw2 = normalizePalabras("bible/kt/god.md");
check("normalize TW", tw.articleId === "god" && tw2.path === "bible/kt/god", { tw, tw2 });

const client = new LocalTreeClient({ [KIND_ACADEMIA]: join(fixturesDir, "ta"), [KIND_PALABRAS]: join(fixturesDir, "tw") });
const englishClient = new LocalTreeClient({ [KIND_ACADEMIA]: join(fixturesDir, "en_ta"), [KIND_PALABRAS]: join(fixturesDir, "en_tw") });

const results = await checkArticles(refs, client, englishClient);
const got = new Map(results.map((r) => [`${r.ref.kind} ${r.ref.articleId}`, r.status]));

const EXPECTED: Record<string, string> = {
  "Palabras god": STATUS_TRANSLATED,
  "Palabras christ": STATUS_ENGLISH,
  "Palabras life": STATUS_ENGLISH,
  "Academia figs-metaphor": STATUS_TRANSLATED,
  "Academia figs-explicit": STATUS_ENGLISH,
  "Academia figs-yousingular": STATUS_INCOMPLETE,
};
for (const [key, expected] of Object.entries(EXPECTED)) {
  check(`${key} = ${expected}`, got.get(key) === expected, got.get(key));
}

const missingIds = new Set(["teach", "woman", "authority", "translate-unknown"]);
const missingResults = results.filter((r) => missingIds.has(r.ref.articleId));
check(
  "ids absent from fixture are missing",
  missingResults.length > 0 && missingResults.every((r) => r.status === STATUS_MISSING),
  missingResults.map((r) => [r.ref.articleId, r.status]),
);

const ghost = await checkArticles([normalizeAcademia("no-such-article")], client);
check("nonexistent article is missing", ghost[0]?.status === STATUS_MISSING);

const sense = await checkArticles([normalizePalabras("bible/kt/call-speakloudly")], client);
check("call-speakloudly is missing", sense[0]?.status === STATUS_MISSING);
check("call-speakloudly notes parent bible/kt/call", sense[0]?.evidence.parent === "bible/kt/call", sense[0]?.evidence);

const copied = await checkArticles([normalizeAcademia("translate/figs-copied")], client, englishClient);
check("figs-copied (layer 2) is english", copied[0]?.status === STATUS_ENGLISH, copied[0]?.status);
const copiedFiles = (copied[0]?.evidence.files as Record<string, unknown>[] | undefined) ?? [];
check("figs-copied has near_duplicate evidence", copiedFiles.some((f) => f.near_duplicate === true));

const hasArt = await checkArticles([normalizePalabras("bible/kt/has")], client, englishClient);
check("tú has (bible/kt/has) is translated", hasArt[0]?.status === STATUS_TRANSLATED, hasArt[0]?.status);

// --- emit.ts: final JSON shape ---
const subjects = { [KIND_ACADEMIA]: await client.subjectFor(KIND_ACADEMIA), [KIND_PALABRAS]: await client.subjectFor(KIND_PALABRAS) };
check("TA subject from fixture manifest", subjects[KIND_ACADEMIA] === "Translation Academy", subjects);
check("TW subject from fixture manifest", subjects[KIND_PALABRAS] === "Translation Words", subjects);

const withoutPortions = statusToDict(results, { book: "TIT", subjects });
check("schema is article-status-1", withoutPortions.schema === "article-status-1");
check("no portions without prep", !("portions" in withoutPortions));

const withPortions = JSON.parse(emitJson(results, { book: "TIT", subjects, prep: prepPayload }));
check("--from-prep emits portions", Array.isArray(withPortions.portions) && withPortions.portions.length > 0);
const firstPortion = withPortions.portions?.[0];
check("first portion ref is TIT 1:1-2", firstPortion?.ref === "TIT 1:1-2", firstPortion?.ref);
check("first portion counts (2 notas, 2 preguntas)", firstPortion?.notas === 2 && firstPortion?.preguntas === 2, firstPortion);
check(
  "first portion cites figs-metaphor in academia[]",
  (firstPortion?.academia ?? []).some((row: { id?: string }) => row.id === "figs-metaphor"),
  firstPortion?.academia,
);
check("preguntas_sin_asignar is 0", withPortions.preguntas_sin_asignar === 0, withPortions.preguntas_sin_asignar);

const metaphorRow = withPortions.articles.find((row: { id?: string }) => row.id === "figs-metaphor");
check("figs-metaphor kind is Subject DCS", metaphorRow?.kind === "Translation Academy", metaphorRow?.kind);
check("figs-metaphor title is Metáfora", metaphorRow?.title === "Metáfora", metaphorRow?.title);
check("succinct article has no evidence/dcs", !("evidence" in (metaphorRow ?? {})) && !("dcs" in (metaphorRow ?? {})));

const godRow = withPortions.articles.find((row: { id?: string }) => row.id === "god");
check("god kind is Subject DCS", godRow?.kind === "Translation Words", godRow?.kind);
check("god title is Dios", godRow?.title === "Dios", godRow?.title);

if (failed) {
  console.error("\nSTATUS PORT: FAIL");
  process.exit(1);
}
console.log("\nSTATUS PORT: OK — matches fcr_status/selftest.py's expectations.");
