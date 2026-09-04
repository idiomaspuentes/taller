/**
 * Port of idiomas-puentes-docs/scripts/fcr_status/dcs.py.
 * Fetch Palabras / Academia article files from a public DCS org.
 *
 * Runs against `fetch()` directly — both Door43's Contents API and its raw
 * archive/zip downloads send `Access-Control-Allow-Origin: *`, so no proxy
 * is needed. The Python version's on-disk HTTP cache is dropped: the
 * browser has its own cache, and each DcsClient keeps an in-memory
 * per-session cache of the trees/subjects it has already resolved.
 */

import { unzipSync } from "fflate";
import { KIND_ACADEMIA, type ArticleRef } from "./collect";

export const DEFAULT_BASE = "https://git.door43.org";
export const DEFAULT_ORG = "es-419_gl";
export const DEFAULT_TA_REPO = "es-419_ta";
export const DEFAULT_TW_REPO = "es-419_tw";
export const DEFAULT_BRANCH = "master";
export const DEFAULT_EN_ORG = "unfoldingWord";
export const DEFAULT_EN_TA_REPO = "en_ta";
export const DEFAULT_EN_TW_REPO = "en_tw";
const TA_TRIO = ["title.md", "sub-title.md", "01.md"];
const TW_CATEGORIES = ["kt", "names", "other"];
const BRANCH_FALLBACKS = ["master", "main"];
// Last-resort kind when Subject is unavailable (API field name, not Academia/Palabras).
const SUBJECT_FALLBACK = "subject";

export type DcsTarget = {
  base: string;
  org: string;
  taRepo: string;
  twRepo: string;
  branch: string;
};

export function makeTarget(partial: Partial<DcsTarget> = {}): DcsTarget {
  return {
    base: partial.base ?? DEFAULT_BASE,
    org: partial.org ?? DEFAULT_ORG,
    taRepo: partial.taRepo ?? DEFAULT_TA_REPO,
    twRepo: partial.twRepo ?? DEFAULT_TW_REPO,
    branch: partial.branch ?? DEFAULT_BRANCH,
  };
}

export function repoFor(target: DcsTarget, kind: string): string {
  return kind === KIND_ACADEMIA ? target.taRepo : target.twRepo;
}

export function englishTarget(partial: Partial<DcsTarget> = {}): DcsTarget {
  return makeTarget({
    base: partial.base,
    branch: partial.branch,
    org: partial.org ?? DEFAULT_EN_ORG,
    taRepo: partial.taRepo ?? DEFAULT_EN_TA_REPO,
    twRepo: partial.twRepo ?? DEFAULT_EN_TW_REPO,
  });
}

export type FetchedArticle = {
  ref: ArticleRef;
  found: boolean;
  path: string;
  files: [string, string][];
  htmlUrl: string;
  apiUrl: string;
  owner: string;
  repo: string;
  branch: string;
  fetchMode: string;
};

export interface ArticleClient {
  fetchArticle(ref: ArticleRef): Promise<FetchedArticle>;
  prefetchArchives?(kinds: Set<string>): Promise<void>;
  subjectFor?(kind: string): Promise<string>;
}

function htmlUrl(target: DcsTarget, repo: string, path: string, branch: string): string {
  const base = target.base.replace(/\/+$/, "");
  return path ? `${base}/${target.org}/${repo}/src/branch/${branch}/${path}` : `${base}/${target.org}/${repo}`;
}

function contentsUrl(target: DcsTarget, repo: string, path: string, branch: string): string {
  const base = target.base.replace(/\/+$/, "");
  const suffix = path ? `/${path}` : "";
  return `${base}/api/v1/repos/${target.org}/${repo}/contents${suffix}?ref=${encodeURIComponent(branch)}`;
}

function archiveUrl(target: DcsTarget, repo: string, branch: string): string {
  return `${target.base.replace(/\/+$/, "")}/${target.org}/${repo}/archive/${branch}.zip`;
}

function catalogV5EntryUrl(target: DcsTarget, repo: string): string {
  return `${target.base.replace(/\/+$/, "")}/api/catalog/v5/entry/${target.org}/${repo}`;
}

function catalogV5SearchUrl(target: DcsTarget, repo: string): string {
  const query = new URLSearchParams({ owner: target.org, repo }).toString();
  return `${target.base.replace(/\/+$/, "")}/api/catalog/v5/search?${query}`;
}

function repoApiUrl(target: DcsTarget, repo: string): string {
  return `${target.base.replace(/\/+$/, "")}/api/v1/repos/${target.org}/${repo}`;
}

function asSubject(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Subject from a catalog entry, catalog search, or Gitea repo JSON. */
export function extractSubject(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = (payload as Record<string, unknown>).data;
  if (Array.isArray(data) && data.length) {
    const first = data[0];
    if (first && typeof first === "object") {
      const value = asSubject((first as Record<string, unknown>).subject);
      if (value) return value;
      const repo = (first as Record<string, unknown>).repo;
      if (repo && typeof repo === "object") {
        const repoValue = asSubject((repo as Record<string, unknown>).subject);
        if (repoValue) return repoValue;
      }
    }
  }
  return asSubject((payload as Record<string, unknown>).subject);
}

function unquoteYaml(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && text[0] === text[text.length - 1] && (text[0] === "'" || text[0] === '"')) {
    return text.slice(1, -1);
  }
  return text;
}

/** Read dublin_core.subject from a Resource Container manifest.yaml (line-based, not a full YAML parser). */
export function subjectFromManifest(text: string): string {
  let inDc = false;
  let dcIndent = 0;
  for (const raw of text.split(/\r?\n/)) {
    const stripped = raw.replace(/^\s+/, "");
    if (!stripped || stripped.startsWith("#")) continue;
    const indent = raw.length - stripped.length;
    const sepIdx = stripped.indexOf(":");
    if (sepIdx === -1) continue;
    const key = stripped.slice(0, sepIdx);
    const rest = stripped.slice(sepIdx + 1);
    if (!inDc && key === "dublin_core") {
      inDc = true;
      dcIndent = indent;
      continue;
    }
    if (inDc) {
      if (indent <= dcIndent) {
        inDc = false;
      } else if (key === "subject") {
        const value = unquoteYaml(rest);
        if (value) return value;
      }
    }
  }
  return "";
}

export async function subjectsForKinds(client: ArticleClient, kinds: Set<string>): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const kind of kinds) {
    resolved[kind] = client.subjectFor ? (await client.subjectFor(kind)) || SUBJECT_FALLBACK : SUBJECT_FALLBACK;
  }
  return resolved;
}

function subjectFromTree(tree: Map<string, Uint8Array> | null): string {
  if (!tree) return "";
  for (const name of ["manifest.yaml", "manifest.yml"]) {
    const blob = tree.get(name);
    if (!blob) continue;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(blob);
      const value = subjectFromManifest(text);
      if (value) return value;
    } catch {
      continue;
    }
  }
  return "";
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeContentsFile(payload: Record<string, unknown>): string {
  const encoding = String(payload.encoding ?? "").toLowerCase();
  const content = payload.content;
  if (encoding === "base64" && typeof content === "string" && content) {
    return decodeUtf8(base64ToBytes(content));
  }
  return typeof content === "string" ? content : "";
}

function stripZipRoot(name: string): string {
  const parts = name.replace(/\\/g, "/").split("/");
  if (parts.length <= 1) return "";
  return parts.slice(1).join("/");
}

function extractZipTree(blob: Uint8Array): Map<string, Uint8Array> {
  const tree = new Map<string, Uint8Array>();
  const entries = unzipSync(blob);
  for (const [name, bytes] of Object.entries(entries)) {
    const cleanName = name.replace(/\\/g, "/");
    if (cleanName.startsWith("/") || cleanName.split("/").includes("..")) continue;
    const rel = stripZipRoot(cleanName);
    if (!rel || rel.endsWith("/")) continue;
    tree.set(rel, bytes);
  }
  return tree;
}

function twPathCandidates(ref: ArticleRef): string[] {
  const slug = ref.articleId;
  let path = (ref.path || "").trim().replace(/^\/+|\/+$/g, "");
  if (path.toLowerCase().endsWith(".md")) path = path.slice(0, -3);
  const candidates: string[] = [];
  if (path) candidates.push(path);
  if (slug && path !== `bible/kt/${slug}`) {
    for (const category of TW_CATEGORIES) candidates.push(`bible/${category}/${slug}`);
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of candidates) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function articleFilePaths(ref: ArticleRef, tree: Map<string, Uint8Array>): string[] {
  const keys = tree;
  if (ref.kind === KIND_ACADEMIA) {
    const directory = (ref.path || `translate/${ref.articleId}`).replace(/^\/+|\/+$/g, "");
    const hits = [...keys.keys()]
      .filter((name) => name.startsWith(`${directory}/`) && name.toLowerCase().endsWith(".md"))
      .sort();
    if (hits.length) return hits;
    return TA_TRIO.map((name) => `${directory}/${name}`).filter((p) => keys.has(p));
  }
  for (const candidate of twPathCandidates(ref)) {
    const filePath = `${candidate}.md`;
    if (keys.has(filePath)) return [filePath];
    const folder = [...keys.keys()]
      .filter((name) => name.startsWith(`${candidate}/`) && name.toLowerCase().endsWith(".md"))
      .sort();
    if (folder.length) return folder;
  }
  return [];
}

function decodeTreeFiles(tree: Map<string, Uint8Array>, paths: string[]): [string, string][] {
  const files: [string, string][] = [];
  for (const rel of paths) {
    const blob = tree.get(rel);
    if (blob === undefined) continue;
    files.push([rel, decodeUtf8(blob)]);
  }
  return files;
}

function resolvedPath(ref: ArticleRef, paths: string[]): string {
  if (!paths.length) return ref.path || ref.articleId;
  const first = paths[0];
  if (first.endsWith(".md") && first.includes("/")) {
    const parent = first.slice(0, first.lastIndexOf("/"));
    const stems = new Set(paths.map((p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "")));
    const onlyKnownStems = [...stems].every((s) => ["01", "title", "sub-title", "subtitle"].includes(s));
    if (onlyKnownStems || paths.length > 1) return parent;
    return first.slice(0, -3);
  }
  if (first.endsWith(".md")) return first.slice(0, -3);
  return first.includes("/") ? first.slice(0, first.lastIndexOf("/")) : first;
}

type FetchMode = "auto" | "contents" | "archive";

export class DcsClient implements ArticleClient {
  private target: DcsTarget;
  private mode: FetchMode;
  private trees = new Map<string, Map<string, Uint8Array>>();
  private archiveOk = new Map<string, boolean>();
  private subjects = new Map<string, string>();

  constructor(target: DcsTarget, options: { mode?: FetchMode } = {}) {
    this.target = target;
    this.mode = options.mode ?? "auto";
  }

  async fetchArticle(ref: ArticleRef): Promise<FetchedArticle> {
    if (this.mode === "contents") return this.fetchContents(ref);
    if (this.mode === "archive") return this.fetchArchive(ref);
    const tree = await this.ensureArchive(ref.kind);
    if (tree) return this.fromTree(ref, tree, "archive");
    return this.fetchContents(ref);
  }

  async prefetchArchives(kinds: Set<string>): Promise<void> {
    for (const kind of kinds) await this.ensureArchive(kind);
  }

  async subjectFor(kind: string): Promise<string> {
    const repo = repoFor(this.target, kind);
    const cacheKey = `${this.target.org}/${repo}`;
    const cached = this.subjects.get(cacheKey);
    if (cached !== undefined) return cached;
    const value = await this.lookupSubject(repo);
    this.subjects.set(cacheKey, value);
    return value;
  }

  private async lookupSubject(repo: string): Promise<string> {
    const urls = [catalogV5EntryUrl(this.target, repo), catalogV5SearchUrl(this.target, repo), repoApiUrl(this.target, repo)];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.status !== 200) continue;
        const value = extractSubject(await res.json());
        if (value) return value;
      } catch {
        continue;
      }
    }
    const tree = this.trees.get(`${this.target.org}/${repo}`) ?? null;
    const value = subjectFromTree(tree);
    if (value) return value;
    return SUBJECT_FALLBACK;
  }

  private branches(): string[] {
    const preferred = this.target.branch;
    const extras = BRANCH_FALLBACKS.filter((name) => name !== preferred);
    return [preferred, ...extras];
  }

  private async ensureArchive(kind: string): Promise<Map<string, Uint8Array> | null> {
    const repo = repoFor(this.target, kind);
    const cacheKey = `${this.target.org}/${repo}`;
    if (this.trees.has(cacheKey)) return this.trees.get(cacheKey)!;
    if (this.archiveOk.get(cacheKey) === false) return null;
    for (const branch of this.branches()) {
      const url = archiveUrl(this.target, repo, branch);
      try {
        const res = await fetch(url);
        if (res.status !== 200) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf[0] !== 0x50 || buf[1] !== 0x4b) continue; // "PK" zip signature
        const tree = extractZipTree(buf);
        if (tree.size) {
          this.trees.set(cacheKey, tree);
          this.target = { ...this.target, branch };
          this.archiveOk.set(cacheKey, true);
          return tree;
        }
      } catch {
        continue;
      }
    }
    this.archiveOk.set(cacheKey, false);
    return null;
  }

  private fromTree(ref: ArticleRef, tree: Map<string, Uint8Array>, fetchMode: string): FetchedArticle {
    const repo = repoFor(this.target, ref.kind);
    const paths = articleFilePaths(ref, tree);
    const files = decodeTreeFiles(tree, paths);
    const resolved = resolvedPath(ref, paths);
    return {
      ref,
      found: files.length > 0,
      path: resolved,
      files,
      htmlUrl: htmlUrl(this.target, repo, resolved, this.target.branch),
      apiUrl: contentsUrl(this.target, repo, resolved, this.target.branch),
      owner: this.target.org,
      repo,
      branch: this.target.branch,
      fetchMode,
    };
  }

  private async fetchArchive(ref: ArticleRef): Promise<FetchedArticle> {
    const tree = await this.ensureArchive(ref.kind);
    if (!tree) return this.empty(ref, { fetchMode: "archive" });
    return this.fromTree(ref, tree, "archive");
  }

  private async fetchContents(ref: ArticleRef): Promise<FetchedArticle> {
    const repo = repoFor(this.target, ref.kind);
    if (ref.kind === KIND_ACADEMIA) return this.fetchTaContents(ref, repo);
    return this.fetchTwContents(ref, repo);
  }

  private async fetchTaContents(ref: ArticleRef, repo: string): Promise<FetchedArticle> {
    const directory = ref.path || `translate/${ref.articleId}`;
    const { listing, branch } = await this.listDir(repo, directory);
    if (listing === null) return this.empty(ref, { path: directory, repo, fetchMode: "contents" });
    const names = listing.filter((item) => item.type === "file").map((item) => String(item.name ?? ""));
    let wanted = names.filter((name) => name.toLowerCase().endsWith(".md"));
    if (!wanted.length) wanted = [...TA_TRIO];
    const files: [string, string][] = [];
    for (const name of wanted) {
      const rel = `${directory.replace(/\/+$/, "")}/${name}`;
      const text = await this.getFileText(repo, rel, branch);
      if (text !== null) files.push([rel, text]);
    }
    return {
      ref,
      found: files.length > 0,
      path: directory,
      files,
      htmlUrl: htmlUrl(this.target, repo, directory, branch),
      apiUrl: contentsUrl(this.target, repo, directory, branch),
      owner: this.target.org,
      repo,
      branch,
      fetchMode: "contents",
    };
  }

  private async fetchTwContents(ref: ArticleRef, repo: string): Promise<FetchedArticle> {
    for (const candidate of twPathCandidates(ref)) {
      const filePath = candidate.endsWith(".md") ? candidate : `${candidate}.md`;
      const { text, branch } = await this.getFileTextWithBranch(repo, filePath);
      if (text !== null) {
        const stem = filePath.slice(0, -3);
        return {
          ref,
          found: true,
          path: stem,
          files: [[filePath, text]],
          htmlUrl: htmlUrl(this.target, repo, filePath, branch),
          apiUrl: contentsUrl(this.target, repo, filePath, branch),
          owner: this.target.org,
          repo,
          branch,
          fetchMode: "contents",
        };
      }
      const { listing, branch: listBranch } = await this.listDir(repo, candidate);
      if (listing === null) continue;
      const files: [string, string][] = [];
      for (const item of listing) {
        if (item.type !== "file") continue;
        const name = String(item.name ?? "");
        if (!name.toLowerCase().endsWith(".md")) continue;
        const rel = `${candidate.replace(/\/+$/, "")}/${name}`;
        const body = await this.getFileText(repo, rel, listBranch);
        if (body !== null) files.push([rel, body]);
      }
      if (files.length) {
        return {
          ref,
          found: true,
          path: candidate,
          files,
          htmlUrl: htmlUrl(this.target, repo, candidate, listBranch),
          apiUrl: contentsUrl(this.target, repo, candidate, listBranch),
          owner: this.target.org,
          repo,
          branch: listBranch,
          fetchMode: "contents",
        };
      }
    }
    const fallback = ref.path || ref.articleId;
    return this.empty(ref, { path: fallback, repo, fetchMode: "contents" });
  }

  private async listDir(repo: string, path: string): Promise<{ listing: Record<string, unknown>[] | null; branch: string }> {
    for (const branch of this.branches()) {
      try {
        const res = await fetch(contentsUrl(this.target, repo, path, branch));
        if (res.status === 404) continue;
        if (res.status === 200) {
          const payload = await res.json();
          if (Array.isArray(payload)) {
            return { listing: payload.filter((item) => item && typeof item === "object"), branch };
          }
        }
      } catch {
        continue;
      }
    }
    return { listing: null, branch: this.target.branch };
  }

  private async getFileText(repo: string, path: string, branch: string): Promise<string | null> {
    try {
      const res = await fetch(contentsUrl(this.target, repo, path, branch));
      if (res.status !== 200) return null;
      const payload = await res.json();
      if (payload && typeof payload === "object" && (payload as Record<string, unknown>).type === "file") {
        return decodeContentsFile(payload as Record<string, unknown>);
      }
      return null;
    } catch {
      return null;
    }
  }

  private async getFileTextWithBranch(repo: string, path: string): Promise<{ text: string | null; branch: string }> {
    for (const branch of this.branches()) {
      const text = await this.getFileText(repo, path, branch);
      if (text !== null) return { text, branch };
    }
    return { text: null, branch: this.target.branch };
  }

  private empty(ref: ArticleRef, options: { path?: string; repo?: string; fetchMode: string }): FetchedArticle {
    const repo = options.repo || repoFor(this.target, ref.kind);
    const resolved = options.path || ref.path || ref.articleId;
    return {
      ref,
      found: false,
      path: resolved,
      files: [],
      htmlUrl: htmlUrl(this.target, repo, resolved, this.target.branch),
      apiUrl: contentsUrl(this.target, repo, resolved, this.target.branch),
      owner: this.target.org,
      repo,
      branch: this.target.branch,
      fetchMode: options.fetchMode,
    };
  }
}
