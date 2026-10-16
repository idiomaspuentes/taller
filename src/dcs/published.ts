import { getRawContent, listReleases } from "@ip-lms/dcs-client";
import { latestReleaseTag } from "../domain/release";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";

/**
 * What a team has published of a resource: a file as its last release has it. A help translated in a first pass and
 * not yet harmonized and published (with this book or another) can be wrong, and is read in the source's language
 * where this answers nothing; one the team published is read in theirs.
 */

const releaseTags = new Map<string, Promise<string | null>>();

/** The tag of the last published release of a repository, once per visit. */
export function lastPublishedTag(session: GtSession, owner: string, repo: string): Promise<string | null> {
  const key = `${session.host}|${owner}/${repo}`.toLowerCase();
  let asked = releaseTags.get(key);
  if (!asked) {
    asked = listReleases(dcsConfig(session.host), owner, repo, { limit: 50, token: session.token })
      .then((releases) => latestReleaseTag(releases as never))
      .catch(() => null);
    releaseTags.set(key, asked);
  }
  return asked;
}

/** A file of the team's repository as its last published release has it; null when it is not in one. */
export async function readPublished(session: GtSession, owner: string, repo: string, filepath: string): Promise<string | null> {
  const tag = await lastPublishedTag(session, owner, repo);
  if (!tag) return null;
  try {
    return await getRawContent(dcsConfig(session.host), owner, repo, filepath, { token: session.token, ref: tag });
  } catch {
    return null;
  }
}
