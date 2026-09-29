/**
 * What a reply can quote (plan §8.4 "Citar"). Each mini-app registers a
 * provider; a provider that does not apply to the subtarea returns `[]`.
 * The thread only shows "Citar" when some provider returned targets.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { CiteTarget } from "../conversation";

export type CiteEnv = Record<string, unknown>;

export type CiteProvider = {
  id: string;
  load(issue: DcsIssue, env: CiteEnv): Promise<CiteTarget[]>;
};

const providers = new Map<string, CiteProvider>();

export function registerCiteProvider(provider: CiteProvider): void {
  providers.set(provider.id, provider);
}

export async function loadCiteTargets(issue: DcsIssue, env: CiteEnv): Promise<CiteTarget[]> {
  const lists = await Promise.all(
    [...providers.values()].map((p) => p.load(issue, env).catch(() => [] as CiteTarget[])),
  );
  return lists.flat();
}
