/** UI view mode for managers previewing worker chrome. Never elevates privileges. */

export type ViewMode = "gestor" | "trabajador";

const STORAGE_KEY = "tas-view-mode";

export function loadViewMode(): ViewMode {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === "trabajador" || raw === "gestor") return raw;
  } catch {
    /* private mode */
  }
  return "gestor";
}

export function saveViewMode(mode: ViewMode): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* quota */
  }
}

/** Manager surfaces only when real canManage and not previewing trabajador. */
export function effectiveCanManage(canManage: boolean, viewMode: ViewMode): boolean {
  return canManage && viewMode === "gestor";
}
