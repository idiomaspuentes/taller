import { getRawContent } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { storyFrames, storyPath } from "../domain/storyFrames";

/** Where a team keeps the Bible stories it has translated: `{lang}_obs`, beside its other resources. */
export function teamStoriesRepo(ctx: Pick<SolverLaunchContext, "lang" | "contentOrg">): { owner: string; repo: string } {
  const base = ctx.lang.trim().toLowerCase().replace(/_gl$/, "");
  return { owner: ctx.contentOrg.trim(), repo: `${base}_obs` };
}

/** A story is read once: an article quotes several frames of the same one. */
const read = new Map<string, Promise<string[]>>();

/**
 * The frames of one story as the team has them, the first at `[0]`. Empty when the team has no such story (or no
 * stories at all): the example is then translated from its source alone, as before.
 */
export function loadStoryFrames(session: GtSession, owner: string, repo: string, story: number): Promise<string[]> {
  const key = `${session.host}|${owner}/${repo}|${story}`;
  let frames = read.get(key);
  if (!frames) {
    frames = getRawContent(dcsConfig(session.host), owner, repo, storyPath(story), { token: session.token })
      .then((text) => storyFrames(text))
      .catch(() => {
        // Not kept: it may be there next time (the connection failed, or the story was added since).
        read.delete(key);
        return [];
      });
    read.set(key, frames);
  }
  return frames;
}
