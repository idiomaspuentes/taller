import {
  DcsApiError,
  apiBase,
  getRepo,
  request,
  type DcsClientConfig,
} from "@ip-lms/dcs-client";
import {
  gitRefParentNames,
  isArchiveRefName,
  planArchiveRef,
  planBranchEnsure,
  type ArchiveRefAction,
} from "../domain/portionPr";
import { isSessionExpiredError } from "./sessionExpiry";
import { forgetBranches } from "./branchList";

export type DcsGitRef = {
  ref: string;
  url?: string;
  object: { sha: string; type?: string; url?: string };
};

export type DcsPull = {
  number: number;
  title: string;
  body?: string;
  state: string;
  html_url: string;
  merged?: boolean;
  /** Who opened it. */
  user?: { login?: string };
  mergeable?: boolean;
  draft?: boolean;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; sha?: string };
  merge_base?: string;
};

export type DcsPullFile = {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
};

function gitRefSuffix(branch: string): string {
  return `heads/${branch
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")}`;
}

export async function getDefaultBranch(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  token: string,
): Promise<string> {
  const info = await getRepo(config, owner, repo, token);
  return info.default_branch?.trim() || "master";
}

async function fetchGitRefs(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<DcsGitRef[]> {
  try {
    const result = await request<DcsGitRef | DcsGitRef[]>(config, {
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/${gitRefSuffix(branch)}`,
      token,
    });
    if (Array.isArray(result)) return result.filter((row) => row?.ref);
    return result?.ref ? [result] : [];
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return [];
    throw err;
  }
}

export async function getGitRef(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<DcsGitRef> {
  const rows = await fetchGitRefs(config, owner, repo, branch, token);
  const exact = rows.find((r) => r.ref === `refs/heads/${branch}`);
  if (!exact?.object?.sha) {
    throw new DcsApiError(`No git ref for ${branch}`, 404);
  }
  return exact;
}

/** Refs that sit under `branch/` — they block creating `branch` itself. */
export async function listGitRefChildren(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<string[]> {
  const rows = await fetchGitRefs(config, owner, repo, branch, token);
  return rows
    .map((row) => (row.ref || "").replace(/^refs\/heads\//, ""))
    .filter((name) => name.startsWith(`${branch}/`));
}

export async function findBlockingParentRef(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<string | null> {
  for (const parent of gitRefParentNames(branch)) {
    if (await branchExists(config, owner, repo, parent, token)) return parent;
  }
  return null;
}

export function diagnoseGitRefCreateFailure(params: {
  branch: string;
  sourceBranch?: string;
  sourceSha?: string | null;
  parent?: string | null;
  children?: string[];
  status?: number;
}): string {
  const { branch, sourceBranch, sourceSha, parent, children, status } = params;
  if (!sourceSha) {
    return `No se pudo crear el borrador «${branch}»${
      sourceBranch ? ` desde «${sourceBranch}»` : ""
    } (repositorio vacío o falta el borrador de origen).`;
  }
  if (parent) {
    return `Ya existe el borrador «${parent}»; no se puede crear «${branch}».`;
  }
  if (children && children.length) {
    const sample = children.slice(0, 3).join(", ");
    return `No se puede crear «${branch}» porque ya existen borradores que cuelgan de ese nombre (${sample}).`;
  }
  if (status === 500) {
    return `Door43 rechazó crear «${branch}» (HTTP 500). Suele ser un nombre que choca con otro borrador, o un repositorio vacío.`;
  }
  return `No se pudo crear la ref «${branch}».`;
}

function branchPath(branch: string): string {
  return branch.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

/**
 * `POST /repos/{owner}/{repo}/branches` from a commit. `POST git/refs` leaves
 * a ref the branch and contents APIs 404 on (ghost), so never create with it.
 */
export async function createBranchAt(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  token: string,
): Promise<void> {
  await request<unknown>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    token,
    body: { new_branch_name: branch, old_ref_name: sha },
  });
  forgetBranches(config, owner, repo);
}

/** `GET /branches/{name}`: false for a missing branch and for a ghost git ref. */
export async function branchApiSees(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<boolean> {
  try {
    await request<unknown>(config, {
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${branchPath(branch)}`,
      token,
    });
    return true;
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return false;
    throw err;
  }
}

/** Ghost ref → delete it and `POST /branches` at the commit it pointed at. */
async function repairGhostBranch(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  token: string,
): Promise<void> {
  await deleteGitRef(config, owner, repo, branch, token);
  await createBranchAt(config, owner, repo, branch, sha, token);
  await assertBranchAt(config, owner, repo, branch, sha, token);
}

async function assertBranchAt(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  token: string,
): Promise<void> {
  const [landed, visible] = await Promise.all([
    getBranchSha(config, owner, repo, branch, token),
    branchApiSees(config, owner, repo, branch, token),
  ]);
  if (!visible || (landed ?? "").toLowerCase() !== sha.trim().toLowerCase()) {
    throw new DcsApiError(
      `Se pidió crear «${branch}» en ${owner}/${repo} en ${sha}, pero Door43 muestra ${landed ?? "nada"}${
        visible ? "" : " y la API de ramas no la ve"
      }.`,
      500,
    );
  }
}

/** PATCH /repos/{owner}/{repo}/git/refs/{ref} — move a branch ref to `sha`. */
export async function updateGitRef(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  token: string,
): Promise<DcsGitRef> {
  return request<DcsGitRef>(config, {
    method: "PATCH",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/${gitRefSuffix(branch)}`,
    token,
    body: { target: sha, sha },
  });
}

/**
 * Point `archivo/{book}/{issue}` at `sha`. Same SHA: nothing. Other SHA:
 * PATCH, and if DCS refuses, delete and recreate that archive ref only.
 * Refuses any name outside `archivo/`, so a trunk or `w/` ref is never touched.
 */
export async function ensureArchiveRef(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  name: string,
  sha: string,
  token: string,
): Promise<{ action: ArchiveRefAction }> {
  if (!isArchiveRefName(name)) {
    throw new DcsApiError(`«${name}» no es una ref de archivo (archivo/libro/issue).`, 400);
  }
  if (!sha.trim()) {
    throw new DcsApiError(`Falta el SHA de la rama de trabajo para «${name}».`, 400);
  }
  const action = planArchiveRef(await getBranchSha(config, owner, repo, name, token), sha);

  if (action === "create") {
    const parent = await findBlockingParentRef(config, owner, repo, name, token);
    if (parent) {
      throw new DcsApiError(
        diagnoseGitRefCreateFailure({ branch: name, sourceSha: sha, parent, status: 500 }),
        500,
      );
    }
    try {
      await createBranchAt(config, owner, repo, name, sha, token);
    } catch (err) {
      if (!(err instanceof DcsApiError) || err.status !== 409) throw err;
      const raced = await getBranchSha(config, owner, repo, name, token);
      if (planArchiveRef(raced, sha) !== "noop") {
        await updateGitRef(config, owner, repo, name, sha, token);
      }
    }
  } else if (action === "update") {
    try {
      await updateGitRef(config, owner, repo, name, sha, token);
    } catch (err) {
      if (isSessionExpiredError(err)) throw err;
      if (err instanceof DcsApiError && err.status === 403) throw err;
      await deleteGitRef(config, owner, repo, name, token);
      await createBranchAt(config, owner, repo, name, sha, token);
    }
  }

  const landed = await getBranchSha(config, owner, repo, name, token);
  if (planArchiveRef(landed, sha) !== "noop") {
    throw new DcsApiError(
      `La ref «${name}» apunta a ${landed ?? "nada"} y no a ${sha}.`,
      500,
    );
  }
  if (!(await branchApiSees(config, owner, repo, name, token))) {
    await repairGhostBranch(config, owner, repo, name, sha, token);
  }
  return { action };
}

/** Delete a branch ref. 404 = already gone. Never force-pushes. */
export async function deleteGitRef(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<{ deleted: boolean }> {
  try {
    await request<void>(config, {
      method: "DELETE",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/${gitRefSuffix(branch)}`,
      token,
    });
    return { deleted: true };
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return { deleted: false };
    throw err;
  }
}

export async function getBranchSha(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<string | null> {
  try {
    const ref = await getGitRef(config, owner, repo, branch, token);
    return ref.object?.sha?.trim() || null;
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return null;
    throw err;
  }
}

export async function branchExists(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<boolean> {
  return (await getBranchSha(config, owner, repo, branch, token)) !== null;
}

export async function ensureBranchFrom(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
  sourceBranch: string,
  options: { fallbackSource?: () => Promise<string> } = {},
): Promise<{ branch: string; base: string; created: boolean; repaired?: boolean }> {
  const probe = async () => {
    const [gitRefSha, branchApi] = await Promise.all([
      getBranchSha(config, owner, repo, branch, token),
      branchApiSees(config, owner, repo, branch, token),
    ]);
    return { gitRefSha, branchApi };
  };
  const own = await probe();
  const sources: Array<{ name: string; sha: string | null }> = [];
  if (!own.gitRefSha && !own.branchApi) {
    sources.push({ name: sourceBranch, sha: await getBranchSha(config, owner, repo, sourceBranch, token) });
    if (!sources[0]!.sha && options.fallbackSource) {
      const fallback = (await options.fallbackSource()).trim();
      if (fallback && fallback !== sourceBranch) {
        sources.push({ name: fallback, sha: await getBranchSha(config, owner, repo, fallback, token) });
      }
    }
  }
  const step = planBranchEnsure({ ...own, sources });
  if (step.kind === "exists") return { branch, base: sourceBranch, created: false };
  if (step.kind === "repair") {
    await repairGhostBranch(config, owner, repo, branch, step.sha, token);
    return { branch, base: sourceBranch, created: false, repaired: true };
  }
  if (step.kind === "no-source") {
    throw new DcsApiError(
      diagnoseGitRefCreateFailure({ branch, sourceBranch, sourceSha: null, status: 404 }),
      404,
    );
  }
  const sourceSha = step.sha;
  const parent = await findBlockingParentRef(config, owner, repo, branch, token);
  if (parent) {
    throw new DcsApiError(
      diagnoseGitRefCreateFailure({ branch, sourceBranch, sourceSha, parent, status: 500 }),
      500,
    );
  }
  const children = await listGitRefChildren(config, owner, repo, branch, token);
  if (children.length) {
    throw new DcsApiError(
      diagnoseGitRefCreateFailure({ branch, sourceBranch, sourceSha, children, status: 500 }),
      500,
    );
  }
  try {
    await createBranchAt(config, owner, repo, branch, sourceSha, token);
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 409) {
      const raced = await probe();
      if (raced.branchApi) return { branch, base: step.from, created: false };
      if (raced.gitRefSha) {
        await repairGhostBranch(config, owner, repo, branch, raced.gitRefSha, token);
        return { branch, base: step.from, created: false, repaired: true };
      }
      throw new DcsApiError(
        `DCS respondió 409 al crear «${branch}» en ${owner}/${repo}, pero la ref no existe.`,
        409,
        err.body,
      );
    }
    if (err instanceof DcsApiError && err.status === 500) {
      const laterParent = parent || await findBlockingParentRef(config, owner, repo, branch, token);
      const laterChildren = children.length
        ? children
        : await listGitRefChildren(config, owner, repo, branch, token);
      throw new DcsApiError(
        diagnoseGitRefCreateFailure({
          branch,
          sourceBranch: step.from,
          sourceSha,
          parent: laterParent,
          children: laterChildren,
          status: 500,
        }),
        500,
        err.body,
      );
    }
    throw err;
  }
  await assertBranchAt(config, owner, repo, branch, sourceSha, token);
  return { branch, base: step.from, created: true };
}

export async function ensureBranchFromDefault(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<{ branch: string; base: string; created: boolean; repaired?: boolean }> {
  const base = await getDefaultBranch(config, owner, repo, token);
  return ensureBranchFrom(config, owner, repo, branch, token, base);
}

/** GET /repos/{owner}/{repo}/pulls: the open pull requests of a repository. */
export async function listOpenPulls(config: DcsClientConfig, owner: string, repo: string, token: string): Promise<DcsPull[]> {
  return request<DcsPull[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    query: { state: "open", limit: "50" },
    token,
  });
}

export async function closePull(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  token: string,
): Promise<DcsPull> {
  return request<DcsPull>(config, {
    method: "PATCH",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${index}`,
    token,
    body: { state: "closed" },
  });
}

export async function getPull(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  token: string,
): Promise<DcsPull> {
  return request<DcsPull>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${index}`,
    token,
  });
}

/** GET /repos/{owner}/{repo}/pulls/{base}/{head} */
export async function getPullByBranches(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  base: string,
  head: string,
  token: string,
): Promise<DcsPull | null> {
  try {
    return await request<DcsPull>(config, {
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(base)}/${encodeURIComponent(head)}`,
      token,
    });
  } catch (err) {
    if (err instanceof DcsApiError && (err.status === 404 || err.status === 409)) {
      return null;
    }
    throw err;
  }
}

export async function createPull(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  params: {
    title: string;
    body?: string;
    head: string;
    base: string;
    token: string;
  },
): Promise<DcsPull> {
  return request<DcsPull>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    token: params.token,
    body: {
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
    },
  });
}

export async function mergePull(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  token: string,
  message?: string,
): Promise<void> {
  await request<void>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${index}/merge`,
    token,
    body: {
      Do: "merge",
      do: "merge",
      merge_title_field: message,
      merge_message_field: message,
    },
  });
}

export async function listPullFiles(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  token: string,
): Promise<DcsPullFile[]> {
  return request<DcsPullFile[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${index}/files`,
    token,
  });
}

export type DcsPullReview = {
  id: number;
  body?: string;
  state?: string;
  html_url?: string;
  commit_id?: string;
};

export type PullReviewEvent =
  | "APPROVED"
  | "PENDING"
  | "COMMENT"
  | "REQUEST_CHANGES"
  | "REQUEST_REVIEW";

export async function createPullReview(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  token: string,
  params: { body?: string; event?: PullReviewEvent; commit_id?: string },
): Promise<DcsPullReview> {
  return request<DcsPullReview>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${index}/reviews`,
    token,
    body: {
      body: params.body,
      event: params.event,
      commit_id: params.commit_id,
    },
  });
}

/** POST /repos/{owner}/{repo}/pulls/{index}/reviews/{id} — submit a pending review. */
export async function submitPullReview(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  reviewId: number,
  token: string,
  params: { body?: string; event: PullReviewEvent },
): Promise<DcsPullReview> {
  return request<DcsPullReview>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${index}/reviews/${reviewId}`,
    token,
    body: {
      body: params.body,
      event: params.event,
    },
  });
}

export async function getPullDiff(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  token: string,
): Promise<string> {
  const base = `${apiBase(config)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${index}.diff`;
  const headers: Record<string, string> = {
    "User-Agent": "GatewayTasks/0.1",
  };
  if (token) headers.Authorization = `token ${token}`;
  const response = await fetch(base, { headers });
  if (!response.ok) {
    throw new DcsApiError(
      `DCS request failed: GET pulls/${index}.diff -> ${response.status}`,
      response.status,
    );
  }
  return response.text();
}

/** `GET git/blobs/{sha}`: the conflict payload's `trunkSha` is a blob SHA, not a commit. */
export async function readGitBlob(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<string> {
  const blob = await request<{ content?: string; encoding?: string }>(config, {
    method: "GET",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(sha)}`,
    token,
  });
  const content = (blob.content ?? "").replace(/\s+/g, "");
  if ((blob.encoding ?? "base64") !== "base64") return blob.content ?? "";
  const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}
