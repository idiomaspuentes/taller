/**
 * Fictional verse conflict for `#/mis-tareas/prueba`: one portion (NEH 1:10–11
 * · TPL) where two people wrote different text for 1:10. Pure and in memory:
 * no inventory, no PM issue, no PR, nothing read from or written to Door43.
 * Deciding reuses `choiceBlockReason` / `computeChoicePatch` (and so
 * `patchTrunkByVerse`) on an in-memory USFM, exactly like production.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import { commentToItem, type ThreadItem, type ThreadSourceState } from "./conversation";
import {
  buildVerseChoicePosts,
  choiceBlockReason,
  computeChoicePatch,
  displacedText,
  rangeText,
  type ConflictPrepared,
  type VerseChoicePost,
} from "./conflictChoice";
import { buildLabSolverLaunchContext, labWriteDecision } from "./solverLab";
import type { SolverLaunchContext } from "./solverLaunch";
import { DEFAULT_SOLVERS_CATALOG, scriptureSolverFor, type SolverApp } from "./solvers";
import {
  buildVerseConflictPosts,
  verseConflictData,
  type VerseConflictData,
  type VerseConflictOptionId,
} from "./verseConflictEvent";

export const SANDBOX_ISSUE = 1;
export const SANDBOX_OTHER_ISSUE = 2;
export const SANDBOX_OTHER_LOGIN = "bob";
export const SANDBOX_TITLE = "Prueba · NEH 1:10–11 · TPL";
export const SANDBOX_RANGE = { chapter: 1, from: 10, to: 10 } as const;

const PM = { owner: "prueba-local", repo: "gateway-tasks" };
const STAMP = "prueba";

export const SANDBOX_TEXTS = {
  /** What the signed-in person closed with (now in the trunk). */
  mine: "Ellos son tus siervos y tu pueblo, a quienes redimiste con tu gran poder y con tu mano fuerte.",
  /** What the other person had in the trunk before (displaced). */
  theirs: "Estos son tus criados y tu gente, los que rescataste con tu gran fuerza y tu brazo poderoso.",
  /** Someone edited 1:10 by hand after the conflict. */
  edited: "Son tus siervos, tu pueblo; los salvaste con tu poder (editado a mano después).",
};

function bookUsfm(verse10: string): string {
  return [
    "\\id NEH Prueba local",
    "\\c 1",
    "\\p",
    "\\v 9 pero si se vuelven a mí y obedecen mis mandamientos, yo los reuniré.",
    `\\v 10 ${verse10}`,
    "\\v 11 Oh Señor, que tu oído esté atento a la oración de tu siervo.",
    "",
  ].join("\n");
}

/** The other person's side: the trunk as it was before the conflicting close. */
export const SANDBOX_SOURCE_USFM = bookUsfm(SANDBOX_TEXTS.theirs);

export type ConflictSandboxState = {
  /** In-memory trunk (USFM). */
  trunk: string;
  /** Someone changed 1:10 by hand after the conflict. */
  edited: boolean;
  choice: { option: VerseConflictOptionId; by: string; wrote: boolean } | null;
  /** Bumped on reset / hand edit so the thread remounts and re-checks the verse. */
  round: number;
  startedAt: number;
};

export function initialSandbox(now: number = Date.now(), round = 0): ConflictSandboxState {
  return { trunk: bookUsfm(SANDBOX_TEXTS.mine), edited: false, choice: null, round, startedAt: now };
}

/** Back to the pending conflict. Local only. */
export function resetSandbox(state: ConflictSandboxState, now: number = Date.now()): ConflictSandboxState {
  return initialSandbox(now, state.round + 1);
}

/** Simulates a hand edit of 1:10 so the card blocks, as in production. */
export function editSandboxVerse(state: ConflictSandboxState): ConflictSandboxState {
  if (state.choice || state.edited) return state;
  return { ...state, trunk: bookUsfm(SANDBOX_TEXTS.edited), edited: true, round: state.round + 1 };
}

/** Current text of 1:10 in the in-memory trunk. */
export function sandboxVerseText(state: ConflictSandboxState): string {
  return rangeText(state.trunk, SANDBOX_RANGE);
}

export function sandboxPrepared(state: ConflictSandboxState): ConflictPrepared {
  return { trunkText: sandboxVerseText(state), sourceReason: null };
}

function conflictPost(me: string) {
  const [post] = buildVerseConflictPosts({
    payload: {
      issue: SANDBOX_ISSUE,
      bookRef: "prueba",
      conflicts: [
        {
          chapter: SANDBOX_RANGE.chapter,
          from: SANDBOX_RANGE.from,
          to: SANDBOX_RANGE.to,
          kind: "texto",
          kept: "ultimo",
          candidates: [
            { source: "tronco", sideIndex: -1, from: 10, to: 10, text: SANDBOX_TEXTS.theirs },
            { source: "entrante", sideIndex: 0, from: 10, to: 10, text: SANDBOX_TEXTS.mine },
          ],
        },
      ],
    },
    closer: me,
    pr: { owner: PM.owner, repo: "prueba", number: 0 },
    book: "NEH",
    usfmPath: "16-NEH.usfm",
    others: [{ otherIssue: SANDBOX_OTHER_ISSUE, otherLogin: SANDBOX_OTHER_LOGIN }],
    stamp: STAMP,
  });
  return post!;
}

export function sandboxConflictData(me: string): VerseConflictData {
  return verseConflictData(conflictPost(me).event)!;
}

export function sandboxDecisionId(): string {
  return conflictPost("ana").event.decision!.id;
}

export function sandboxIssue(me: string): DcsIssue {
  return {
    id: SANDBOX_ISSUE,
    number: SANDBOX_ISSUE,
    title: SANDBOX_TITLE,
    body: "",
    state: "open",
    html_url: "",
    assignee: { login: me },
    assignees: [{ login: me }],
    labels: [],
  } as unknown as DcsIssue;
}

/**
 * Mini-app for the fictional portion: the TPL editor as a lab launch (no
 * content org, no write opt-in), so it keeps the draft in this browser and
 * never creates branches, PRs or issues.
 */
export function sandboxLaunch(me: string, lang: string): { app: SolverApp; ctx: SolverLaunchContext } | null {
  const app = scriptureSolverFor(DEFAULT_SOLVERS_CATALOG, "tpl");
  if (!app) return null;
  const ctx = buildLabSolverLaunchContext({
    username: me,
    lang,
    book: "NEH",
    chapter: SANDBOX_RANGE.chapter,
    verseFrom: 10,
    verseTo: 11,
    resource: "tpl",
  });
  return labWriteDecision(ctx).mode === "local" ? { app, ctx } : null;
}

function at(state: ConflictSandboxState, minutesAgo: number): string {
  return new Date(state.startedAt - minutesAgo * 60_000).toISOString();
}

export function sandboxThreadSources(state: ConflictSandboxState, me: string): ThreadSourceState[] {
  const base = 9100 + state.round * 10;
  const items = [
    {
      id: base + 1,
      body: "Terminé 1:10 y 1:11 de mi porción. Cierro ya.",
      created_at: at(state, 12),
      user: { login: me },
    },
    {
      id: base + 2,
      body: `Yo también traduje 1:10 en mi porción, con otras palabras. Decide tú cuál queda.`,
      created_at: at(state, 9),
      user: { login: SANDBOX_OTHER_LOGIN },
    },
    { id: base + 3, body: conflictPost(me).body, created_at: at(state, 8), user: { login: me } },
  ].map((c) => commentToItem(c, "issue", PM));
  return [{ kind: "issue", status: "ok", items }];
}

export type SandboxChoice =
  | { ok: true; state: ConflictSandboxState; posts: VerseChoicePost[] }
  | { ok: false; reason: string };

/**
 * Pending → chosen. Same guard as the card (`choiceBlockReason`) and the same
 * patch as production (`computeChoicePatch` → `patchTrunkByVerse`), on memory.
 */
export function chooseInSandbox(
  state: ConflictSandboxState,
  option: VerseConflictOptionId,
  by: string,
): SandboxChoice {
  if (state.choice) return { ok: false, reason: "Ya se decidió. Reinicia la prueba para volver a probar." };
  const data = sandboxConflictData(by);
  const blocked = choiceBlockReason({
    data,
    option,
    viewer: { username: by, canManage: false, assignees: [by] },
    prepared: sandboxPrepared(state),
  });
  if (blocked) return { ok: false, reason: blocked };
  let trunk = state.trunk;
  let wrote = false;
  if (option === "desplazado") {
    const patch = computeChoicePatch({
      trunk: state.trunk,
      source: SANDBOX_SOURCE_USFM,
      range: SANDBOX_RANGE,
      expectedSourceText: displacedText(data),
    });
    if (!patch.ok) return { ok: false, reason: patch.reason };
    trunk = patch.usfm;
    wrote = patch.changed;
  }
  const posts = buildVerseChoicePosts({
    data,
    decisionId: sandboxDecisionId(),
    option,
    by,
    wrote,
  }).filter((post) => post.issue === SANDBOX_ISSUE);
  return { ok: true, state: { ...state, trunk, choice: { option, by, wrote } }, posts };
}

export function sandboxPostsToItems(posts: VerseChoicePost[], by: string, now: number = Date.now()): ThreadItem[] {
  return posts.map((post, index) =>
    commentToItem({ id: now + index, body: post.body, created_at: new Date(now).toISOString(), user: { login: by } }, "issue", PM),
  );
}
