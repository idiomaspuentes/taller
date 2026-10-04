import type { ViewMode } from "../viewMode";
import { portionPrBranchName, removePortionPrFromBody } from "./portionPr";
import { branchNames, isWorkWord } from "./branchNames";
import { parseRefRange, type RefRange } from "./usfmEdit";

/** DCS hosts where the QA admin menu must never appear. */
export const PRODUCTION_HOSTNAMES = ["git.door43.org", "unfoldingword.door43.org"] as const;

function hostnameOf(host: string): string {
  const raw = host.trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return raw.replace(/^[a-z]+:\/\//, "").split(/[/:]/)[0] ?? "";
  }
}

export function isProductionHost(host: string): boolean {
  const name = hostnameOf(host);
  return (PRODUCTION_HOSTNAMES as readonly string[]).includes(name);
}

/** Gestor (real capability, not previewing trabajador) on a non-production DCS host. */
export function canShowQaAdmin(params: {
  host: string | undefined;
  canManage: boolean;
  viewMode: ViewMode;
}): boolean {
  if (!params.host || isProductionHost(params.host)) return false;
  return params.canManage && params.viewMode === "gestor";
}

export type TrunkRefProbe = {
  name: string;
  /** `GET git/refs/heads/{name}` — what `branchExists` and the editor see. */
  gitRefSha: string | null;
  /** `GET branches/{name}` returned 200. */
  branchApi: boolean;
  /** `GET contents/{file}?ref={name}` returned 200. */
  fileApi: boolean;
};

export type RefRepairContext = {
  defaultBranch: string;
  /** Book-only leftover (`neh`): deletable only after typing its exact name. */
  bookOnlyBranch: string;
};

/** Why the ghost-ref delete is refused, or `null` if it may run. */
export function ghostRefDeleteBlock(
  probe: TrunkRefProbe,
  ctx: RefRepairContext,
  typedConfirm: string,
): string | null {
  const name = probe.name.trim();
  if (!name) return "Falta el nombre de la ref.";
  if (name === ctx.defaultBranch || name === "master" || name === "main") {
    return `«${name}» es la rama por defecto; nunca se borra aquí.`;
  }
  if (!probe.gitRefSha) return `No existe la ref git «${name}»; no hay nada que borrar.`;
  if (probe.branchApi) return `La API de ramas lista «${name}»; no es una ref fantasma.`;
  if (probe.fileApi) return `La API de archivos ve contenido en «${name}»; no es una ref fantasma.`;
  if (typedConfirm.trim() !== name) {
    return name === ctx.bookOnlyBranch
      ? `«${name}» es la rama del libro; escribe su nombre exacto para confirmar.`
      : `Escribe «${name}» para confirmar.`;
  }
  return null;
}

/** Work refs live under their own word, `trabajo/` (see `portionPrBranchName`), or the `w/` of older books. */
export function isWorkRefName(name: string): boolean {
  const parts = name.trim().split("/");
  return parts.length >= 3 && isWorkWord(parts[0]) && parts.every(Boolean);
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

export type WorkRefSource = { sha: string; origin: "ghost" | "trunk" };

/**
 * Commit a repaired work ref starts from. The SHA the ghost ref already
 * pointed at wins so the person's saved text survives; the trunk tip is
 * only used when no ghost SHA was recorded.
 */
export function workRefRecreateSource(params: {
  ghostSha: string | null | undefined;
  trunkSha: string | null | undefined;
}): WorkRefSource | null {
  const ghost = params.ghostSha?.trim() ?? "";
  if (FULL_SHA_RE.test(ghost)) return { sha: ghost, origin: "ghost" };
  const trunk = params.trunkSha?.trim() ?? "";
  if (FULL_SHA_RE.test(trunk)) return { sha: trunk, origin: "trunk" };
  return null;
}

/** Plain text of `\v {verse}` in `\c {chapter}`, markers stripped; `null` if absent. */
export function usfmVerseText(usfm: string, chapter: number, verse: number): string | null {
  const chapters = usfm.split(/\\c\s+/);
  const head = new RegExp(`^${chapter}(\\s|$)`);
  const body = chapters.find((part, i) => i > 0 && head.test(part));
  if (!body) return null;
  const match = new RegExp(`\\\\v\\s+${verse}(?:-\\d+)?\\s+([\\s\\S]*?)(?=\\\\v\\s+\\d|$)`).exec(body);
  if (!match) return null;
  return match[1].replace(/\\[a-z0-9-]+\*?\s?/gi, " ").replace(/\s+/g, " ").trim();
}

/** Why recreating a work ref with `POST /branches` from `sourceSha` is refused, or `null`. */
export function recreateWorkRefBlock(
  probe: TrunkRefProbe,
  ctx: RefRepairContext,
  sourceSha: string | null | undefined,
): string | null {
  const name = probe.name.trim();
  if (!name) return "Falta el nombre de la ref.";
  if (!isWorkRefName(name)) return `«${name}» no es una ref de trabajo (${branchNames().work}/…).`;
  if (name === ctx.defaultBranch || name === "master" || name === "main") {
    return `«${name}» es la rama por defecto.`;
  }
  if (probe.branchApi) return `«${name}» ya existe según la API de ramas; no se toca.`;
  if (probe.gitRefSha) {
    return `La ref git «${name}» sigue existiendo; bórrala primero si es fantasma.`;
  }
  if (!sourceSha || !FULL_SHA_RE.test(sourceSha.trim())) {
    return "Falta el SHA completo de origen (40 caracteres hex).";
  }
  return null;
}

/** Why recreating the trunk from the default branch is refused, or `null`. */
export function recreateTrunkBlock(probe: TrunkRefProbe, ctx: RefRepairContext): string | null {
  const name = probe.name.trim();
  if (!name) return "Falta el nombre de la ref.";
  if (name === ctx.defaultBranch) return `«${name}» ya es la rama por defecto.`;
  if (isWorkRefName(name)) return `«${name}» es una ref de trabajo; créala desde su SHA.`;
  if (name === ctx.bookOnlyBranch) {
    return `«${name}» bloquearía los troncos por tarea; no se crea desde aquí.`;
  }
  if (probe.branchApi) return `«${name}» ya existe según la API de ramas.`;
  if (probe.gitRefSha) {
    return `La ref git «${name}» sigue existiendo; bórrala primero si es fantasma.`;
  }
  return null;
}

/* ── Preparar una prueba: two PM issues, two work branches, one conflict ── */

/** Second tester proposed for a known QA account pair; empty otherwise. */
export function defaultOtherTester(me: string): string {
  return me.trim().toLowerCase() === "abelper8" ? "abelperez" : "";
}

/** Short tag that keeps each prepared scenario's titles and verse texts unique. */
export function testRunTag(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(now.getFullYear() % 100)}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** `NEH 1:1–3 · TPL` — the portion title the source issue carries. */
export function sourceIssueTitle(book: string, ref: string, resourceLabel: string): string {
  return `${book.trim().toUpperCase()} ${ref.trim()} · ${resourceLabel.trim().toUpperCase()}`;
}

/** `refFromIssueTitle` still reads the portion (text before the first `·`). */
export function testIssueTitle(params: {
  book: string;
  ref: string;
  resourceLabel: string;
  runTag: string;
  login: string;
}): string {
  return `${sourceIssueTitle(params.book, params.ref, params.resourceLabel)} · prueba ${params.runTag} · @${params.login.trim()}`;
}

export function testVerseText(params: {
  book: string;
  chapter: number;
  verse: number;
  login: string;
  runTag: string;
}): string {
  return `Texto de prueba de ${params.book.trim().toUpperCase()} ${params.chapter}:${params.verse}, versión de ${params.login.trim()} (${params.runTag}).`;
}

const STATE_MARKER_RE = /<!--\s*gt:[a-z-]+\s*-->\n?/g;
const TASK_PROGRESS_RE = /<!--\s*gateway-task-progress\s+\{[\s\S]*?\}\s*-->\n?/g;

/**
 * Clone a PM issue body for a test issue: new work-order key (`|{keySuffix}`),
 * new assignee line, and none of the source's run state (en-curso, progress, PR link).
 */
export function testIssueBody(sourceBody: string, params: { keySuffix: string; login: string }): string {
  const login = params.login.trim();
  return removePortionPrFromBody(sourceBody)
    .replace(STATE_MARKER_RE, "")
    .replace(TASK_PROGRESS_RE, "")
    .replace(/("key":"[^"]+)"/, `$1|${params.keySuffix}"`)
    .replace(/^- (Asignado a: .*|Sin asignar)$/m, `- Asignado a: @${login}`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Source labels minus `{ns}/estado:*` so the test issues start clean. */
export function testIssueLabelIds(
  labels: { id: number; name: string }[],
  namespaceId = "pm",
): number[] {
  const state = `${namespaceId}/estado:`;
  return labels.filter((l) => !l.name.startsWith(state)).map((l) => l.id);
}

export type TrunkSetupAction =
  | { kind: "reuse"; sha: string }
  | { kind: "create"; fromBranch: string }
  | { kind: "recreate-ghost"; sha: string };

export type TestScenarioInput = {
  host: string;
  book: string;
  /** Portion like `1:1–3`. */
  ref: string;
  resourceLabel: string;
  taskId: string;
  me: string;
  other: string;
  runTag: string;
  filepath: string;
  ctx: RefRepairContext;
  /** Probe of the trunk name the editor resolves for this task. */
  trunk: TrunkRefProbe;
  /** File API sees the book on the default branch. */
  defaultHasFile: boolean;
  /** Book file readable at the ghost ref's commit (`null` = not checked / no ghost). */
  ghostHasFile: boolean | null;
  /** Next PM repo index (issues and PRs share it); `null` if unknown. */
  nextIssueNumber: number | null;
  /** Titles of open issues already in the PM repo that match the planned ones. */
  existingTitles: string[];
};

export type TestScenarioIssuePlan = {
  title: string;
  assignee: string;
  predictedNumber: number | null;
  /** Work ref with the predicted number, or `{nº}` when unknown. */
  workRef: string;
  verseText: string;
};

export type TestScenarioPlan = {
  trunkName: string;
  trunk: TrunkSetupAction | null;
  scope: RefRange | null;
  issues: TestScenarioIssuePlan[];
  /** The ghost path deletes a ref: the gestor must type its name. */
  needsTypedConfirm: boolean;
  block: string | null;
};

/** How the trunk becomes a real Gitea branch; a string explains why it cannot. */
export function trunkSetupAction(
  probe: TrunkRefProbe,
  ctx: RefRepairContext,
  facts: { filepath: string; defaultHasFile: boolean; ghostHasFile: boolean | null },
): TrunkSetupAction | string {
  const name = probe.name.trim();
  if (!name) return "No se pudo resolver el nombre del tronco.";
  if (isWorkRefName(name)) return `«${name}» es una ref de trabajo, no un tronco.`;
  if (name === ctx.defaultBranch || name === "master" || name === "main") {
    return `El tronco resuelto es la rama por defecto «${name}»; no se prepara sobre ella.`;
  }
  if (probe.branchApi) {
    if (!probe.fileApi) {
      return `El tronco «${name}» existe pero la API de archivos no ve ${facts.filepath}. Ábrelo en el editor antes de preparar la prueba.`;
    }
    const sha = probe.gitRefSha?.trim() ?? "";
    if (!FULL_SHA_RE.test(sha)) return `No se pudo leer el SHA del tronco «${name}».`;
    return { kind: "reuse", sha };
  }
  if (name === ctx.bookOnlyBranch) {
    return `«${name}» es la rama del libro; no se crea ni se borra desde aquí.`;
  }
  if (probe.gitRefSha) {
    const sha = probe.gitRefSha.trim();
    if (probe.fileApi) return `La API de archivos ve «${name}» aunque la de ramas no; no se toca.`;
    if (!FULL_SHA_RE.test(sha)) return `La ref fantasma «${name}» no tiene un SHA completo.`;
    if (facts.ghostHasFile === false) {
      return `La ref fantasma «${name}» apunta a ${sha.slice(0, 12)}, que no tiene ${facts.filepath}.`;
    }
    return { kind: "recreate-ghost", sha };
  }
  if (!facts.defaultHasFile) {
    return `«${ctx.defaultBranch}» no tiene ${facts.filepath}; no hay de dónde crear el tronco.`;
  }
  return { kind: "create", fromBranch: ctx.defaultBranch };
}

export function planTestScenario(input: TestScenarioInput): TestScenarioPlan {
  const trunkName = input.trunk.name.trim();
  const scope = parseRefRange(input.ref);
  const me = input.me.trim();
  const other = input.other.trim();
  const logins = [me, other];
  const issues: TestScenarioIssuePlan[] = logins.map((login, i) => {
    const predicted = input.nextIssueNumber != null ? input.nextIssueNumber + i : null;
    const workRef = login && input.taskId
      ? portionPrBranchName({
          book: input.book,
          username: login,
          taskId: input.taskId,
          issueNumber: predicted ?? 0,
        })
      : "";
    return {
      title: testIssueTitle({ ...input, login }),
      assignee: login,
      predictedNumber: predicted,
      workRef: predicted == null && workRef ? workRef.replace(/\/0$/, "/{nº}") : workRef,
      verseText: scope
        ? testVerseText({ book: input.book, chapter: scope.chapter, verse: scope.from, login, runTag: input.runTag })
        : "",
    };
  });
  const action = trunkSetupAction(input.trunk, input.ctx, input);
  const trunk = typeof action === "string" ? null : action;

  const block = ((): string | null => {
    if (!input.host.trim()) return "Falta la sesión.";
    if (isProductionHost(input.host)) return `No se preparan pruebas en ${input.host}: es producción.`;
    if (!me) return "Falta el usuario de la sesión.";
    if (!other) return "Escribe el login del segundo usuario.";
    if (other.toLowerCase() === me.toLowerCase()) return "El segundo usuario debe ser distinto de ti.";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(other)) return `«${other}» no parece un login de DCS.`;
    if (!input.taskId.trim()) return "La issue de origen no tiene id de tarea.";
    if (!scope) return `No se entiende la porción «${input.ref}» (p. ej. 1:1–3).`;
    if (typeof action === "string") return action;
    const dup = issues.find((row) => input.existingTitles.includes(row.title));
    if (dup) return `Ya existe una issue abierta «${dup.title}».`;
    return null;
  })();

  return {
    trunkName,
    trunk,
    scope,
    issues,
    needsTypedConfirm: trunk?.kind === "recreate-ghost",
    block,
  };
}

/** Plan block, or the typed-name rule when the trunk ghost ref will be deleted. */
export function testScenarioRunBlock(plan: TestScenarioPlan, typedConfirm: string): string | null {
  if (plan.block) return plan.block;
  if (plan.needsTypedConfirm && typedConfirm.trim() !== plan.trunkName) {
    return `Escribe «${plan.trunkName}» para borrar la ref fantasma y recrearla.`;
  }
  return null;
}
