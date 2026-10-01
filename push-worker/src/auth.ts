import { list, type FetchFn } from "./env";

/** The host a person says they belong to, if this Worker serves it. */
export function allowedHost(host: string | null | undefined, allowed: string): string | null {
  const clean = (host ?? "").trim().replace(/\/$/, "");
  return clean && list(allowed).includes(clean) ? clean : null;
}

/**
 * Who a Door43 token belongs to, asked to Door43 itself. The token is used once and never stored:
 * the Worker only keeps the login it answers with.
 */
export async function loginOf(fetchFn: FetchFn, host: string, token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const res = await fetchFn(`${host}/api/v1/user`, { headers: { Authorization: `token ${token}`, "User-Agent": "tas-push/0.1" } });
    if (!res.ok) return null;
    const user = (await res.json()) as { login?: string };
    return user.login ? user.login.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function tokenOf(request: Request): string {
  return /^token\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
}
