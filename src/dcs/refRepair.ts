import { DcsApiError, getContents, request } from "@ip-lms/dcs-client";
import {
  ghostRefDeleteBlock,
  isProductionHost,
  recreateTrunkBlock,
  recreateWorkRefBlock,
  type RefRepairContext,
  type TrunkRefProbe,
} from "../domain/qaAdmin";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { deleteGitRef, getBranchSha } from "./pulls";
import { readRepoFile } from "./repoFile";

export type RefRepairTarget = {
  session: GtSession;
  owner: string;
  repo: string;
  /** Book USFM path, e.g. `16-NEH.usfm`. */
  filepath: string;
};

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function branchPath(branch: string): string {
  return branch.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function refuseProduction(session: GtSession): void {
  if (isProductionHost(session.host)) {
    throw new DcsApiError(`Administración (QA) no opera sobre ${session.host}.`, 403);
  }
}

async function branchApiSees(target: RefRepairTarget, branch: string): Promise<boolean> {
  const config = dcsConfig(target.session.host);
  try {
    await request<unknown>(config, {
      path: `${repoPath(target.owner, target.repo)}/branches/${branchPath(branch)}`,
      token: target.session.token,
    });
    return true;
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return false;
    throw err;
  }
}

export async function fileApiSees(target: RefRepairTarget, branch: string): Promise<boolean> {
  const config = dcsConfig(target.session.host);
  try {
    const meta = await getContents(config, target.owner, target.repo, target.filepath, {
      token: target.session.token,
      ref: branch,
    });
    return !Array.isArray(meta);
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return false;
    throw err;
  }
}

export async function probeTrunkRef(
  target: RefRepairTarget,
  name: string,
): Promise<TrunkRefProbe> {
  const config = dcsConfig(target.session.host);
  const [gitRefSha, branchApi, fileApi] = await Promise.all([
    getBranchSha(config, target.owner, target.repo, name, target.session.token),
    branchApiSees(target, name),
    fileApiSees(target, name),
  ]);
  return { name, gitRefSha, branchApi, fileApi };
}

/**
 * Re-probes, then `DELETE git/refs/heads/{name}` only if it is still a ghost.
 * `before.gitRefSha` is the commit the ghost pointed at (needed to rebuild a work ref).
 */
export async function deleteGhostTrunkRef(
  target: RefRepairTarget,
  name: string,
  ctx: RefRepairContext,
  typedConfirm: string,
): Promise<{ before: TrunkRefProbe; after: TrunkRefProbe }> {
  refuseProduction(target.session);
  const before = await probeTrunkRef(target, name);
  const block = ghostRefDeleteBlock(before, ctx, typedConfirm);
  if (block) throw new DcsApiError(block, 409);
  await deleteGitRef(
    dcsConfig(target.session.host),
    target.owner,
    target.repo,
    name,
    target.session.token,
  );
  return { before, after: await probeTrunkRef(target, name) };
}

/** Book file at an exact commit (works while the ref is a ghost), or `null` on 404. */
export async function readFileAtSha(target: RefRepairTarget, sha: string): Promise<string | null> {
  try {
    const { text } = await readRepoFile({
      session: target.session,
      owner: target.owner,
      repo: target.repo,
      filepath: target.filepath,
      branch: sha,
    });
    return text;
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return null;
    throw err;
  }
}

/** `POST /branches` with `old_ref_name={sourceSha}` for a `w/…` ref; never `POST git/refs`. */
export async function recreateWorkRefFromSha(
  target: RefRepairTarget,
  name: string,
  ctx: RefRepairContext,
  sourceSha: string,
): Promise<TrunkRefProbe> {
  refuseProduction(target.session);
  const fresh = await probeTrunkRef(target, name);
  const block = recreateWorkRefBlock(fresh, ctx, sourceSha);
  if (block) throw new DcsApiError(block, 409);
  await request<unknown>(dcsConfig(target.session.host), {
    method: "POST",
    path: `${repoPath(target.owner, target.repo)}/branches`,
    token: target.session.token,
    body: { new_branch_name: name, old_ref_name: sourceSha.trim() },
  });
  return probeTrunkRef(target, name);
}

/** `POST /branches` with `old_ref_name={sourceSha}` for a trunk whose ghost ref was deleted. */
export async function recreateTrunkFromSha(
  target: RefRepairTarget,
  name: string,
  ctx: RefRepairContext,
  sourceSha: string,
): Promise<TrunkRefProbe> {
  refuseProduction(target.session);
  if (!/^[0-9a-f]{40}$/i.test(sourceSha.trim())) {
    throw new DcsApiError("Falta el SHA completo de origen (40 caracteres hex).", 400);
  }
  const fresh = await probeTrunkRef(target, name);
  const block = recreateTrunkBlock(fresh, ctx);
  if (block) throw new DcsApiError(block, 409);
  await request<unknown>(dcsConfig(target.session.host), {
    method: "POST",
    path: `${repoPath(target.owner, target.repo)}/branches`,
    token: target.session.token,
    body: { new_branch_name: name, old_ref_name: sourceSha.trim() },
  });
  return probeTrunkRef(target, name);
}

/** `POST /branches` with `old_ref_name={defaultBranch}`; returns the post-create probe. */
export async function recreateTrunkFromDefault(
  target: RefRepairTarget,
  name: string,
  ctx: RefRepairContext,
): Promise<TrunkRefProbe> {
  refuseProduction(target.session);
  const fresh = await probeTrunkRef(target, name);
  const block = recreateTrunkBlock(fresh, ctx);
  if (block) throw new DcsApiError(block, 409);
  await request<unknown>(dcsConfig(target.session.host), {
    method: "POST",
    path: `${repoPath(target.owner, target.repo)}/branches`,
    token: target.session.token,
    body: {
      new_branch_name: name,
      old_ref_name: ctx.defaultBranch,
      old_branch_name: ctx.defaultBranch,
    },
  });
  return probeTrunkRef(target, name);
}
