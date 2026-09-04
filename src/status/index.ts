/**
 * Orchestrates the fcr_status port end to end — the TS equivalent of
 * `check_article_status.py --from-prep … --org … --ta-repo … --tw-repo …`.
 */

import { collectFromPrep, KIND_ACADEMIA, KIND_PALABRAS } from "./collect";
import { checkArticles } from "./check";
import { emitJson, statusToDict } from "./emit";
import { DcsClient, englishTarget, makeTarget, subjectsForKinds, type DcsTarget } from "./dcs";

export type StatusInput = {
  prep: Record<string, unknown>;
  org?: string;
  taRepo?: string;
  twRepo?: string;
  branch?: string;
  base?: string;
  /** Contents API is capped at 60 anonymous requests/hour; archive (a one-time
   * repo zip) avoids that for anything past a handful of articles. */
  mode?: "auto" | "contents" | "archive";
  onProgress?: (message: string) => void;
  generatedAt?: string;
};

function chooseMode(mode: "auto" | "contents" | "archive", count: number): "contents" | "archive" {
  if (mode !== "auto") return mode;
  return count <= 12 ? "contents" : "archive";
}

export async function runStatus(input: StatusInput): Promise<Record<string, unknown>> {
  const refs = collectFromPrep(input.prep);
  if (!refs.length) {
    throw new Error("El inventario no cita artículos de Academia ni Palabras.");
  }

  const mode = chooseMode(input.mode ?? "auto", refs.length);
  const target = makeTarget({
    base: input.base,
    org: input.org,
    taRepo: input.taRepo,
    twRepo: input.twRepo,
    branch: input.branch,
  });

  const client = new DcsClient(target, { mode });
  const englishClient = new DcsClient(englishTarget({ base: input.base }), { mode });

  const kinds = new Set(refs.map((r) => r.kind));
  input.onProgress?.(
    `Comprobando ${refs.length} artículo(s) único(s) (${refs.filter((r) => r.kind === KIND_PALABRAS).length} Palabras, ` +
      `${refs.filter((r) => r.kind === KIND_ACADEMIA).length} Academia) vía ${mode} en ${target.org}…`,
  );
  if (mode === "archive") {
    await client.prefetchArchives(kinds);
    await englishClient.prefetchArchives(kinds);
  }

  const results = await checkArticles(refs, client, englishClient);
  const subjects = await subjectsForKinds(client, kinds);

  const dcsSubjects: Record<string, string> = {};
  if (kinds.has(KIND_ACADEMIA)) dcsSubjects[target.taRepo] = subjects[KIND_ACADEMIA];
  if (kinds.has(KIND_PALABRAS)) dcsSubjects[target.twRepo] = subjects[KIND_PALABRAS];

  const book = String(input.prep.book ?? "");
  return statusToDict(results, {
    generatedAt: input.generatedAt,
    book,
    dcs: {
      base: target.base,
      org: target.org,
      ta_repo: target.taRepo,
      tw_repo: target.twRepo,
      branch: target.branch,
      fetch: mode,
    },
    subjects,
    prep: input.prep,
  });
}

export { emitJson, statusToDict, type DcsTarget };
