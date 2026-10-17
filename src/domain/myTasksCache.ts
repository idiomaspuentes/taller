import type { DcsIssue } from "@ip-lms/dcs-client";
import type { MyTasksProjectBucket } from "./myTasks";
import type { SolversCatalog } from "./solvers";
import { scopeKey } from "./scope";

/**
 * «Mis tareas» as it was last read, kept in this device: shown at once while it is read again, which takes seconds
 * (the 210 open subtareas of Esdras, 17 October). What it shows meanwhile may be a few seconds old, so nothing is
 * done from it: the screen waits for the list read now before taking, opening or handing anything in.
 */
export type KeptTasks = {
  at: string;
  projects: MyTasksProjectBucket[];
  catalog: SolversCatalog;
  conflicted: DcsIssue[];
  closed: DcsIssue[];
};

const PREFIX = "taller-mis-tareas:";
/** A list older than this is not shown: after days away it would show work long gone. */
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

type Where = { host: string; username: string; pmOrg: string; lang: string; contentOrg: string; mode: string };

/** One list per person, server, organization, language and space. */
export const keptTasksKey = (where: Where): string =>
  `${PREFIX}${scopeKey()}${[where.host, where.username.toLowerCase(), where.pmOrg, where.lang, where.contentOrg, where.mode].join("|")}`;

type Ref = Record<string, unknown>;
const REF_KEYS = ["id", "login", "full_name", "name", "title", "color", "state"];
/** A person, a label, a milestone or a repository, by what the screen reads of it: avatars and links are left out. */
const slimRef = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const ref = value as Ref;
  const out: Ref = {};
  for (const key of REF_KEYS) if (ref[key] !== undefined) out[key] = ref[key];
  if (ref.owner && typeof ref.owner === "object") out.owner = { login: (ref.owner as Ref).login };
  return out;
};

/** A subtarea as kept: everything of its own (title, body with its markers, dates), the rest by name. A third the size. */
export function slimIssue(issue: DcsIssue): DcsIssue {
  const out: Ref = {};
  for (const [key, value] of Object.entries(issue as unknown as Ref)) {
    if (value === null || typeof value !== "object") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.map(slimRef);
    else out[key] = slimRef(value);
  }
  return out as unknown as DcsIssue;
}

type KeptProject = Omit<MyTasksProjectBucket, "openIssues"> & { openIssues?: DcsIssue[]; openSame?: boolean };

export function keepTasks(key: string, value: KeptTasks, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  if (!storage) return;
  // A queue that is browsed is its open subtareas too: kept once.
  const projects: KeptProject[] = value.projects.map(({ openIssues, ...bucket }) => {
    const issues = bucket.issues.map(slimIssue);
    const sourceIssues = bucket.sourceIssues?.map(slimIssue);
    if (openIssues && openIssues === bucket.issues) return { ...bucket, issues, sourceIssues, openSame: true };
    return { ...bucket, issues, sourceIssues, ...(openIssues ? { openIssues: openIssues.map(slimIssue) } : {}) };
  });
  try {
    storage.setItem(key, JSON.stringify({ ...value, projects, conflicted: value.conflicted.map(slimIssue), closed: value.closed.map(slimIssue) }));
  } catch {
    // Full, or not allowed in this window: the list is simply read every time, as before.
  }
}

export function keptTasks(key: string, now: Date = new Date(), storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): KeptTasks | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const kept = JSON.parse(raw) as Omit<KeptTasks, "projects"> & { projects: KeptProject[] };
    if (!kept.at || !Array.isArray(kept.projects) || now.getTime() - Date.parse(kept.at) > KEEP_MS) return null;
    const projects = kept.projects.map(({ openSame, ...bucket }) => (openSame ? { ...bucket, openIssues: bucket.issues } : bucket)) as MyTasksProjectBucket[];
    return { ...kept, projects };
  } catch {
    return null;
  }
}
