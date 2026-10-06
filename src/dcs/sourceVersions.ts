import { getContents, request } from "@ip-lms/dcs-client";
import { stampKey, type SourceFile, type SourceStamp } from "../domain/sourceVersions";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { stampsOf } from "./sourceTexts";

/**
 * The version of each source file as Door43 has it: the hash of its content, and the release it belongs to. Asked
 * with as little as it takes: the list of a resource's files answers for every book of it (17 KB, once per visit),
 * and the name of its last release is under 1 KB. See `domain/sourceVersions.ts` for what it is kept for.
 */

const enc = encodeURIComponent;
const repoPath = (owner: string, repo: string) => `/repos/${enc(owner)}/${enc(repo)}`;
const once = <T>(cache: Map<string, Promise<T>>, key: string, ask: () => Promise<T>): Promise<T> => {
  let asked = cache.get(key);
  if (!asked) {
    asked = ask();
    cache.set(key, asked);
  }
  return asked;
};

const releases = new Map<string, Promise<string | null>>();

/** The name of the last release of a resource («v91»); null when it has none or it cannot be asked. */
function lastRelease(session: GtSession, owner: string, repo: string): Promise<string | null> {
  return once(releases, `${session.host}|${owner}/${repo}`.toLowerCase(), () =>
    request<{ name?: string }[]>(dcsConfig(session.host), { path: `${repoPath(owner, repo)}/tags`, query: { limit: "1" }, token: session.token })
      .then((tags) => tags?.[0]?.name?.trim() || null)
      .catch(() => null),
  );
}

const trees = new Map<string, Promise<Map<string, string> | null>>();

/** The files at the root of a resource as a release has them, each with the hash of its content. */
function releaseTree(session: GtSession, owner: string, repo: string, tag: string): Promise<Map<string, string> | null> {
  return once(trees, `${session.host}|${owner}/${repo}|${tag}`.toLowerCase(), () =>
    request<{ tree?: { path?: string; sha?: string }[] }>(dcsConfig(session.host), { path: `${repoPath(owner, repo)}/git/trees/${enc(tag)}`, token: session.token })
      .then((found) => new Map((found.tree ?? []).flatMap((entry) => (entry.path && entry.sha ? [[entry.path, entry.sha] as const] : []))))
      .catch(() => null),
  );
}

const nested = new Map<string, Promise<{ path: string; sha: string }[]>>();

/** A file inside folders, or every file of a folder, with its hash; at a release when `ref` names one. */
function nestedShas(session: GtSession, file: SourceFile, ref?: string): Promise<{ path: string; sha: string }[]> {
  return once(nested, `${session.host}|${file.owner}/${file.repo}|${file.path}|${ref ?? ""}`.toLowerCase(), () =>
    getContents(dcsConfig(session.host), file.owner, file.repo, file.path, { token: session.token, ref })
      .then((found) => (Array.isArray(found) ? found : [found]).filter((row) => row.type === "file" && row.sha).map((row) => ({ path: row.path, sha: row.sha })))
      .catch(() => []),
  );
}

/** The files a source file stands for (itself, or those of its folder), each with its hash now or at a release. */
async function shasOf(session: GtSession, file: SourceFile, tag?: string): Promise<{ path: string; sha: string }[]> {
  if (file.folder || file.path.includes("/")) return nestedShas(session, file, tag);
  const tree = tag ? await releaseTree(session, file.owner, file.repo, tag) : await stampsOf(session, file);
  const sha = tree?.get(file.path);
  return sha ? [{ path: file.path, sha }] : [];
}

/**
 * Each source file as it is now, to be noted with the step that is being closed. A file that cannot be read is left
 * out: a step closes all the same, and says nothing of that source rather than something false.
 */
export async function stampSources(session: GtSession, files: SourceFile[]): Promise<SourceStamp[]> {
  const out: SourceStamp[] = [];
  await Promise.all(
    files.map(async (file) => {
      const [now, release] = await Promise.all([shasOf(session, file), lastRelease(session, file.owner, file.repo)]);
      const then = release && now.length ? await shasOf(session, file, release) : [];
      for (const row of now) {
        out.push({ kind: file.kind, repo: `${file.owner}/${file.repo}`, path: row.path, sha: row.sha, ...(release ? { release, released: then.find((other) => other.path === row.path)?.sha === row.sha } : {}) });
      }
    }),
  );
  // In the order they were asked for, whichever answered first.
  const order = files.map((file) => `${file.owner}/${file.repo}/${file.path}`.toLowerCase());
  return out.sort((a, b) => order.findIndex((key) => stampKey(a).startsWith(key)) - order.findIndex((key) => stampKey(b).startsWith(key)) || a.path.localeCompare(b.path));
}

/** The hash each noted file has today, by `stampKey`: what `changedSources` compares the notes against. */
export async function currentShas(session: GtSession, noted: SourceStamp[]): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  await Promise.all(
    noted.map(async (stamp) => {
      const [owner, repo] = stamp.repo.split("/");
      if (!owner || !repo) return;
      const rows = await shasOf(session, { kind: stamp.kind, owner, repo, path: stamp.path });
      out[stampKey(stamp)] = rows.find((row) => row.path === stamp.path)?.sha;
    }),
  );
  return out;
}
