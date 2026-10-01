import { workspaceById, type TallerConfig, type Workspace } from "./config";

/**
 * Which workspace (team space) this browser works in. Each workspace has its own organization, so its
 * tasks and projects are never mixed with another's: the app only ever reads and writes inside the chosen one.
 */
const KEY = "taller-workspace";

type Store = Pick<Storage, "getItem" | "setItem">;

function safe(store: Store | undefined): Store | undefined {
  try {
    return store ?? localStorage;
  } catch {
    return undefined;
  }
}

export function loadWorkspaceId(store?: Store): string | null {
  try {
    return safe(store)?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveWorkspaceId(id: string, store?: Store): void {
  try {
    safe(store)?.setItem(KEY, id);
  } catch {
    /* blocked storage: the choice is asked again next time */
  }
}

/**
 * The workspace to start in: the one chosen before (if it still exists), or the only one there is.
 * With several and no choice yet it is `undefined` and the welcome screen asks.
 */
export function initialWorkspace(config: TallerConfig, store?: Store): Workspace | undefined {
  const stored = workspaceById(config, loadWorkspaceId(store));
  if (stored) return stored;
  return config.workspaces.length === 1 ? config.workspaces[0] : undefined;
}

/** The saved context with the workspace's fixed values laid over it: language and organizations are not free choices. */
export function contextWith<T extends { lang: string; contentOrg: string; pmOrg: string }>(saved: T, workspace: Workspace): T {
  return { ...saved, lang: workspace.lang, contentOrg: workspace.contentOrg, pmOrg: workspace.pmOrg };
}

/** The workspace to preselect on the welcome screen: the one whose interface language matches the person's. */
export function suggestedWorkspace(config: TallerConfig, uiLanguage: string): Workspace | undefined {
  return config.workspaces.find((w) => w.uiLanguage === uiLanguage) ?? config.workspaces[0];
}
