/**
 * Development only. Lets a phone open the app as one of the people of the in-memory Door43
 * (scripts/mock-door43) without typing anything: `http://<computer>:5177/?mockUser=bea`.
 * It does nothing in a real build, and only accepts the test people of that server, whose
 * tokens are not real credentials.
 */
const MOCK_USERS = ["ana", "bea", "carla"];
const SCOPES = ["read:user", "read:organization", "write:repository", "write:issue", "write:organization", "read:notification", "write:notification"];

export function applyMockSessionFromUrl(): void {
  if (!import.meta.env.DEV || typeof location === "undefined") return;
  const params = new URLSearchParams(location.search);
  const user = params.get("mockUser")?.toLowerCase();
  if (!user || !MOCK_USERS.includes(user)) return;
  const host = `${location.protocol}//${location.hostname}:8787`;
  try {
    localStorage.setItem(
      "gt-dcs-session",
      JSON.stringify({ host, username: user, token: `token-${user}`, avatarUrl: "", scopes: SCOPES, scopesVersion: 3, isOwner: false, canManage: user === "ana", teams: [] }),
    );
    localStorage.setItem("gt-context", JSON.stringify({ book: "NEH", contentOrg: "es-419_gl", host, lang: "es-419", pmOrg: "BSOJ" }));
    localStorage.setItem("gt-context-confirmed", "1");
    params.delete("mockUser");
    const rest = params.toString();
    history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash || "#/mis-tareas"}`);
  } catch {
    /* private window or blocked storage: the normal sign-in is used */
  }
}
