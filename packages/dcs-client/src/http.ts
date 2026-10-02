import { apiBase, resolvedUserAgent, type DcsClientConfig } from "./config.js";
import { DcsApiError } from "./errors.js";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** Sent as `Authorization: token {token}` — the literal DCS prefix, never `Bearer` (API_DCS.md §2). */
  token?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

const RETRYABLE_STATUSES = new Set([423, 429, 500, 502, 503]);
const MAX_RETRIES = 3;

function buildQueryString(query: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.append(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * The single place every DCS call goes through (API_DCS.md §6, best
 * practice #1). Applies the required headers, retries with exponential
 * backoff on the statuses API_DCS.md §5 marks as transient (423/429/5xx),
 * and turns anything else non-2xx into a `DcsApiError` the caller can
 * switch on by `.status`.
 */
export async function request<T>(config: DcsClientConfig, options: RequestOptions): Promise<T> {
  const url = `${apiBase(config)}${options.path}${buildQueryString(options.query)}`;
  const headers: Record<string, string> = {
    "User-Agent": resolvedUserAgent(config),
  };
  if (options.token) {
    headers.Authorization = `token ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let attempt = 0;
  for (;;) {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      // Some operations answer 200 or 201 with no body at all (merging a pull request is one): that is a success,
      // not unreadable JSON.
      const text = await response.text();
      if (!text.trim()) return undefined as T;
      return JSON.parse(text) as T;
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
      attempt++;
      const delayMs = 2 ** attempt * 250;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw new DcsApiError(`DCS request failed: ${options.method ?? "GET"} ${options.path} -> ${response.status}`, response.status, body);
  }
}
