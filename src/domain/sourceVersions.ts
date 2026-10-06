import { bookUsfmName } from "../prep/discover";
import { helpsTsvFilename } from "./helpsTarget";
import { originalTextRef, type SourcePackage } from "./sourcePackage";

/**
 * Which version of its sources a piece of work was done against.
 *
 * A text is translated from the English literal text, a note from the English note, an alignment is made on the
 * Greek. Those sources go on changing after the work is done: a note is rewritten, a verse of the literal text is
 * corrected. Nothing said which version a step had been done with, so nobody could tell what there was to look at
 * again when a source moved on. translationCore writes it in its project (`tc_en_check_version_translationNotes:
 * v84.1`); a book of ours kept nothing.
 *
 * When a step is closed, each file of the sources it was done against is noted by the hash of its content, with the
 * release it then belonged to. The hash is the fact (the app reads the working branch of each resource, which runs
 * ahead of its releases); the release is how a person says it («ULT v91»). Later the hash is compared with what
 * Door43 has: the same, nothing to do; another, the source of that step changed. Pure.
 */

/** A kind of source a piece of work is done against. */
export type SourceKind = "ult" | "ust" | "tn" | "tq" | "twl" | "tw" | "ta" | "original";

export const SOURCE_KINDS: SourceKind[] = ["ult", "ust", "tn", "tq", "twl", "tw", "ta", "original"];

/** A file of a source; with `folder`, every file in that folder (an Academy article is three). */
export type SourceFile = { kind: SourceKind; owner: string; repo: string; path: string; folder?: boolean };

/**
 * A source file as it was when a step was done. `release`: the last release of its resource at that time;
 * `released`: the file was then as that release has it (if not, it had already changed after it).
 */
export type SourceStamp = { kind: SourceKind; repo: string; path: string; sha: string; release?: string; released?: boolean };

/** The sources a step was done against, as noted when it was closed. */
export type StepSources = { at: string; by: string; files: SourceStamp[] };

/**
 * What the work on each resource is done against when its tool does not say (`sources` of a tool in its process):
 * the text it translates.
 */
const DEFAULT_KINDS: Record<string, SourceKind[]> = { tpl: ["ult"], tps: ["ust"], notas: ["tn"], preguntas: ["tq"], palabras: ["tw"], academia: ["ta"] };

export function sourceKindsFor(resource: string | undefined, declared?: string[]): SourceKind[] {
  const named = (declared ?? []).filter((kind): kind is SourceKind => (SOURCE_KINDS as string[]).includes(kind));
  return named.length ? named : (DEFAULT_KINDS[(resource ?? "").trim().toLowerCase()] ?? []);
}

/**
 * The files of the source package a subtarea is done against. A passage is done against the book's file of each
 * text or table; an article, against that article (`articles`: their paths, «bible/kt/altar», «translate/figs-idiom»).
 */
export function sourceFilesFor(params: { kinds: SourceKind[]; pkg: SourcePackage; book?: string; articles?: string[] }): SourceFile[] {
  const { pkg } = params;
  const book = (params.book ?? "").trim().toUpperCase();
  const articles = (params.articles ?? []).map((path) => path.trim().replace(/^\/+|\/+$/g, "").replace(/\.md$/i, "")).filter(Boolean);
  const out: SourceFile[] = [];
  for (const kind of params.kinds) {
    if (kind === "tw") for (const path of articles) out.push({ kind, owner: pkg.owner, repo: pkg.tw, path: `${path}.md` });
    else if (kind === "ta") for (const path of articles) out.push({ kind, owner: pkg.owner, repo: pkg.ta, path, folder: true });
    else if (!book) continue;
    else if (kind === "ult") out.push({ kind, owner: pkg.owner, repo: pkg.ult, path: bookUsfmName(book) });
    else if (kind === "ust") out.push({ kind, owner: pkg.owner, repo: pkg.ust, path: bookUsfmName(book) });
    else if (kind === "tn") out.push({ kind, owner: pkg.owner, repo: pkg.tn, path: helpsTsvFilename("notas", book) });
    // The questions repository sits beside the notes one: `en_tn` → `en_tq`.
    else if (kind === "tq") out.push({ kind, owner: pkg.owner, repo: pkg.tn.replace(/_tn$/, "_tq"), path: helpsTsvFilename("preguntas", book) });
    else if (kind === "twl") out.push({ kind, owner: pkg.owner, repo: pkg.twl, path: `twl_${book}.tsv` });
    else if (kind === "original") {
      const original = originalTextRef(book);
      out.push({ kind, owner: original.owner, repo: original.repo, path: original.filepath });
    }
  }
  return out;
}

export const stampKey = (stamp: Pick<SourceStamp, "repo" | "path">): string => `${stamp.repo}/${stamp.path}`.toLowerCase();

/**
 * The noted files that are no longer what Door43 has. `now`: the hash of each file today, by `stampKey`; a file
 * whose hash is not known today (no network, a resource that cannot be read) is not said to have changed.
 */
export function changedSources(noted: SourceStamp[], now: Record<string, string | undefined>): SourceStamp[] {
  return noted.filter((stamp) => {
    const current = now[stampKey(stamp)];
    return Boolean(current) && current !== stamp.sha;
  });
}

/** The kinds of source that changed, each once, in the order they were noted. */
export function changedKinds(noted: SourceStamp[], now: Record<string, string | undefined>): SourceKind[] {
  return [...new Set(changedSources(noted, now).map((stamp) => stamp.kind))];
}

/**
 * The version of a noted source as a person says it: «v91» when the file was as that release has it, «v91+» when it
 * had already changed after it, and the start of its hash when its resource has no release.
 */
export function stampVersion(stamp: Pick<SourceStamp, "sha" | "release" | "released">): string {
  if (!stamp.release) return stamp.sha.slice(0, 7);
  return stamp.released === false ? `${stamp.release}+` : stamp.release;
}

/** One version per kind of source, for a line: several articles of one kind are said once when they agree. */
export function versionsByKind(files: SourceStamp[]): { kind: SourceKind; version: string }[] {
  const out: { kind: SourceKind; version: string }[] = [];
  for (const stamp of files) {
    const version = stampVersion(stamp);
    const row = out.find((other) => other.kind === stamp.kind);
    if (!row) out.push({ kind: stamp.kind, version });
    else if (row.version !== version && !row.version.includes(version)) row.version = `${row.version}, ${version}`;
  }
  return out;
}
