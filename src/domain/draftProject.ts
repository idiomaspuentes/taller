/**
 * A project that is being prepared and does not exist yet: its plan as the person left it, kept on this device so
 * that leaving the screen does not lose it. Nothing of a draft is in Door43; «Crear proyecto» is what writes it.
 */
import { scopeKey } from "./scope";
import { normalizeAssignmentsDoc, toPersistDoc } from "./store";
import type { AssignmentsDoc } from "./types";

const DRAFT_PREFIX = "gt-project-draft:";
const key = (lang: string) => `${DRAFT_PREFIX}${scopeKey()}${lang.trim().toLowerCase()}`;

export function loadProjectDraft(lang: string, contentOrg: string, pmOrg: string): AssignmentsDoc | null {
  try {
    const raw = localStorage.getItem(key(lang));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { projectId?: string };
    if (!parsed?.projectId) return null;
    return normalizeAssignmentsDoc(parsed, { book: parsed.projectId, lang, contentOrg, pmOrg });
  } catch {
    return null;
  }
}

export function saveProjectDraft(doc: AssignmentsDoc): void {
  try {
    localStorage.setItem(key(doc.lang), JSON.stringify(toPersistDoc(doc)));
  } catch {
    /* no room: the draft lives while the screen is open */
  }
}

export function clearProjectDraft(lang: string): void {
  try {
    localStorage.removeItem(key(lang));
  } catch {
    /* nothing to clear */
  }
}
