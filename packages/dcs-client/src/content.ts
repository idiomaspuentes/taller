import { encodeBase64, decodeBase64 } from "./base64.js";
import type { DcsClientConfig } from "./config.js";
import { apiBase, resolvedUserAgent } from "./config.js";
import { DcsApiError } from "./errors.js";
import { request } from "./http.js";

export interface ContentsResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  /** Base64-encoded, per API_DCS.md §4c. Use `decodeBase64` to read it as text. */
  content?: string;
  encoding?: string;
  type: "file" | "dir";
}

export interface GetContentsParams {
  ref?: string;
  token?: string;
}

/**
 * GET a file or directory listing from a repo (API_DCS.md §4c). For a
 * file, `content` comes back base64-encoded — pass it through
 * `decodeBase64` to get text. For a directory, DCS returns an array
 * instead of a single object, so this is typed as `unknown` and the
 * caller narrows.
 */
export function getContents(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  filepath: string,
  params: GetContentsParams = {},
): Promise<ContentsResponse | ContentsResponse[]> {
  return request<ContentsResponse | ContentsResponse[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filepath}`,
    query: { ref: params.ref },
    token: params.token,
  });
}

/**
 * Convenience wrapper over `getContents` for the common case of "I just
 * want the text of this file" — decodes base64 for the caller.
 * Throws `DcsApiError` (via `getContents`) if the path is a directory
 * or doesn't exist.
 */
export async function getRawContent(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  filepath: string,
  params: GetContentsParams = {},
): Promise<string> {
  const result = await getContents(config, owner, repo, filepath, params);
  if (Array.isArray(result)) {
    throw new DcsApiError(`Path is a directory, not a file: ${filepath}`, 400);
  }
  if (result.content === undefined) {
    throw new DcsApiError(`No content returned for file: ${filepath}`, 500);
  }
  return decodeBase64(result.content);
}

export interface CreateOrUpdateContentsParams {
  /** Plain text — this function handles the base64 encoding. */
  content: string;
  message: string;
  /**
   * Required to *update* an existing file (the blob SHA it currently
   * has); omit to *create* a new file. API_DCS.md §4c: passing the
   * wrong/stale sha on an update is what produces the 409/422 conflict
   * this doc's §5 table describes — reread the file, get its current
   * sha, and retry.
   */
  sha?: string;
  branch?: string;
  /**
   * Gitea: create this new branch from `branch` (or the default) and
   * commit the file there. Omit to write on `branch` itself.
   */
  new_branch?: string;
  token: string;
}

export interface CreateOrUpdateContentsResponse {
  content: ContentsResponse;
  commit: { sha: string; message: string };
}

/**
 * Create or update a file. Gitea uses POST to create and PUT to update
 * (sha present). Some DCS hosts 404 a POST to a missing path; those
 * accept GitHub-style PUT create (no sha). We retry PUT once on that 404.
 */
async function writeContents(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  filepath: string,
  params: { content: string; message: string; sha?: string; branch?: string; new_branch?: string; token: string },
): Promise<CreateOrUpdateContentsResponse> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filepath}`;
  const body = {
    content: params.content,
    message: params.message,
    sha: params.sha,
    branch: params.branch,
    new_branch: params.new_branch,
  };
  if (params.sha) {
    return request<CreateOrUpdateContentsResponse>(config, {
      method: "PUT",
      path,
      token: params.token,
      body,
    });
  }
  try {
    return await request<CreateOrUpdateContentsResponse>(config, {
      method: "POST",
      path,
      token: params.token,
      body,
    });
  } catch (err) {
    if (!(err instanceof DcsApiError) || err.status !== 404) throw err;
    return request<CreateOrUpdateContentsResponse>(config, {
      method: "PUT",
      path,
      token: params.token,
      body,
    });
  }
}

export function createOrUpdateContents(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  filepath: string,
  params: CreateOrUpdateContentsParams,
): Promise<CreateOrUpdateContentsResponse> {
  return writeContents(config, owner, repo, filepath, {
    content: encodeBase64(params.content),
    message: params.message,
    sha: params.sha,
    branch: params.branch,
    new_branch: params.new_branch,
    token: params.token,
  });
}

export interface CreateOrUpdateBinaryContentsParams {
  /** Already base64-encoded raw bytes (e.g. `buffer.toString("base64")`) — unlike `createOrUpdateContents`, nothing here re-encodes from UTF-8 text, so this is safe for images and any other non-text file. */
  contentBase64: string;
  message: string;
  /** Same as `CreateOrUpdateContentsParams.sha` — required to update, omitted to create. */
  sha?: string;
  branch?: string;
  new_branch?: string;
  token: string;
}

/** Binary-safe sibling of `createOrUpdateContents` — for a file whose bytes aren't valid UTF-8 text (images, etc.), where `encodeBase64`'s `Buffer.from(text, "utf-8")` round-trip would corrupt them. Same create-vs-update-by-sha behavior. */
export function createOrUpdateBinaryContents(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  filepath: string,
  params: CreateOrUpdateBinaryContentsParams,
): Promise<CreateOrUpdateContentsResponse> {
  return writeContents(config, owner, repo, filepath, {
    content: params.contentBase64,
    message: params.message,
    sha: params.sha,
    branch: params.branch,
    new_branch: params.new_branch,
    token: params.token,
  });
}

export interface DeleteContentsParams {
  message: string;
  /** Required — DCS refuses a delete without the blob sha it currently holds (API_DCS.md §4c). */
  sha: string;
  branch?: string;
  token: string;
}

export function deleteContents(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  filepath: string,
  params: DeleteContentsParams,
): Promise<void> {
  return request<void>(config, {
    method: "DELETE",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filepath}`,
    token: params.token,
    body: {
      message: params.message,
      sha: params.sha,
      branch: params.branch,
    },
  });
}

// Re-exported so a caller doesn't need a second import just for the base host helpers.
export { apiBase, resolvedUserAgent };
