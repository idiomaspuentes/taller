import { branchNames, isWorkWord } from "../domain/branchNames";
import {
  createOrgRepo,
  createOrUpdateContents,
  DcsApiError,
  getContents,
  getRawContent,
  getRepo,
  type CreateOrUpdateContentsResponse,
} from "@ip-lms/dcs-client";
import { dcsConfig } from "./config";
import type { GtSession } from "./auth";
import { branchExists } from "./pulls";
import { isSessionExpiredError, SESSION_EXPIRED_MESSAGE } from "./sessionExpiry";

export type RepoFileRef = {
  session: GtSession;
  owner: string;
  repo: string;
  filepath: string;
  branch?: string;
};

export type BootstrapStep =
  | "repo"
  | "default-branch"
  | "book-branch"
  | "file-create"
  | "file-copy"
  | "task-branch"
  | "pr-close"
  | "work-branch-delete"
  | "trunk-merge"
  | "principal-pass";

export class BootstrapError extends Error {
  constructor(
    message: string,
    public readonly step: BootstrapStep,
    public readonly status?: number,
    public readonly cause?: unknown,
    public readonly ref?: string,
  ) {
    super(message);
    this.name = "BootstrapError";
  }
}

function dcsMessage(err: unknown): string {
  if (!(err instanceof DcsApiError)) {
    return err instanceof Error ? err.message : String(err);
  }
  const body = err.body;
  if (body && typeof body === "object" && "message" in body) {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  return err.message;
}

function statusSuffix(status?: number): string {
  return status != null ? ` (HTTP ${status})` : "";
}

function stepLabel(step: BootstrapStep): string {
  switch (step) {
    case "repo":
      return "repositorio";
    case "default-branch":
      return "borrador principal";
    case "book-branch":
      return "borrador grupal";
    case "file-create":
      return "alta del archivo";
    case "file-copy":
      return "copia del archivo";
    case "task-branch":
      return "borrador de la subtarea";
    case "pr-close":
      return "cierre de la revisión";
    case "work-branch-delete":
      return "borrador";
    case "trunk-merge":
      return "guardado en el borrador grupal";
    case "principal-pass":
      return "paso al borrador principal";
  }
}

/** Worker-facing name for a ref; the ref itself never reaches the UI. */
function refPlace(ref: string): string {
  const name = ref.trim();
  const first = name.split("/")[0];
  if (first === branchNames().archive) return "el archivo del trabajo";
  if (name === "master" || name === "main") return "el borrador principal";
  if (isWorkWord(first) || first === "tas" || /\/\d+$/.test(name)) return "tu borrador";
  return "el borrador grupal";
}

function technical(detail: string): string {
  return detail ? `Detalle técnico: ${detail}` : "";
}

function gitRefs500Hint(message: string, status?: number): string {
  if (status !== 500) return message;
  if (/Ya existe el borrador|cuelgan de ese nombre|No se pudo crear el borrador|repositorio vacío/i.test(message)) {
    return message;
  }
  if (/\/git\/refs/.test(message) || /HTTP 500/.test(message) || /-> 500/.test(message)) {
    return `${message} Puede que ya exista un borrador con un nombre que choca con este, o que el repositorio esté vacío.`;
  }
  return message;
}

export function explainRepoFileError(
  err: unknown,
  ctx: { owner: string; repo: string; filepath: string; branch?: string; creating?: boolean },
): string {
  const repo = ctx.repo?.trim() && ctx.repo !== "—" ? ctx.repo : "";
  const loc = repo ? `${ctx.owner}/${repo}` : ctx.owner;
  const file = ctx.filepath;
  const branch = ctx.branch ? ` en ${refPlace(ctx.branch)}` : "";
  if (isSessionExpiredError(err)) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof BootstrapError) {
    const http = statusSuffix(err.status);
    const step = stepLabel(err.step);
    const detail = technical(gitRefs500Hint(err.message, err.status));
    if (err.step === "repo") {
      if (err.status === 401 || err.status === 403) {
        return `Sin permiso para acceder a ${loc}${http}. Inicia sesión con una cuenta que pueda editar ese repositorio.`;
      }
      if (err.status === 404) {
        return `No existe el repositorio ${loc}${http}. Crea el repo de TPL o TPS en esa organización, o reintenta si tu sesión puede crearlo.`;
      }
      return `Falló el ${step} ${loc}${http}: ${err.message}`;
    }
    if (err.step === "default-branch") {
      return `El borrador principal de ${loc} no existe o está vacío${http}. ${detail}`;
    }
    if (err.step === "book-branch") {
      return `No se pudo crear o leer el ${step} en ${loc}${http}. ${detail}`;
    }
    if (err.step === "file-create" || err.step === "file-copy") {
      return `No se pudo ${err.step === "file-copy" ? "copiar" : "crear"} «${file}» en ${loc}${branch}${http}. ${detail}`;
    }
    if (err.step === "task-branch") {
      return `No se pudo crear tu borrador de esta subtarea en ${loc}${http}. ${detail}`;
    }
    if (err.step === "pr-close") {
      if (err.status === 401 || err.status === 403) {
        return `Sin permiso para cerrar la revisión de esta subtarea en ${loc}${http}.`;
      }
      return `No se pudo cerrar la revisión anterior de esta subtarea en ${loc}${http}. ${detail}`;
    }
    if (err.step === "work-branch-delete") {
      if (err.status === 401 || err.status === 403) {
        return `Sin permiso para borrar tu borrador en ${loc}${http}.`;
      }
      return `No se pudo borrar tu borrador en ${loc}${http}. ${detail}`;
    }
    return `Falló ${step} en ${loc}${http}: ${detail}`;
  }
  if (!(err instanceof DcsApiError)) {
    return err instanceof Error ? err.message : String(err);
  }
  if (err.status === 401 || err.status === 403) {
    return `Sin permiso para escribir en ${loc}${statusSuffix(err.status)}. Inicia sesión con una cuenta que pueda editar ese repositorio.`;
  }
  if (err.status === 404) {
    if (ctx.creating) {
      return `No se pudo crear «${file}» en ${loc}${branch}${statusSuffix(404)}. El archivo no existía; Door43 rechazó el alta (revisa el repositorio o tu permiso).`;
    }
    return `No se encontró «${file}» en ${loc}${branch}${statusSuffix(404)}.`;
  }
  if (err.status === 409 || err.status === 422) {
    return `No se pudo guardar: «${file}» cambió en Door43 desde que lo abriste. Lo que escribiste sigue en este dispositivo: sal de la tarea, vuelve a entrar y se guardará. Detalle técnico: ${loc}${branch}${statusSuffix(err.status)}: ${dcsMessage(err)}`;
  }
  return `No se pudo guardar «${file}» en ${loc}${branch}${statusSuffix(err.status)}: ${dcsMessage(err)}`;
}

export async function assertRepoExists(
  session: GtSession,
  owner: string,
  repo: string,
): Promise<void> {
  const config = dcsConfig(session.host);
  try {
    await getRepo(config, owner, repo, session.token);
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) {
      throw new BootstrapError(
        `El repositorio ${owner}/${repo} no existe.`,
        "repo",
        404,
        err,
      );
    }
    if (err instanceof DcsApiError && (err.status === 401 || err.status === 403)) {
      throw new BootstrapError(
        `Sin permiso para acceder a ${owner}/${repo}.`,
        "repo",
        err.status,
        err,
      );
    }
    throw err;
  }
}

/**
 * Same pattern as `ensurePmRepo`: get the repo, and if the org exists but
 * the repo does not, create it with `auto_init` so the default branch has a SHA.
 */
export async function ensureContentRepo(
  session: GtSession,
  owner: string,
  repo: string,
): Promise<{ created: boolean }> {
  const config = dcsConfig(session.host);
  try {
    await getRepo(config, owner, repo, session.token);
    return { created: false };
  } catch (err) {
    if (err instanceof DcsApiError && (err.status === 401 || err.status === 403)) {
      throw new BootstrapError(
        `Sin permiso para acceder a ${owner}/${repo}.`,
        "repo",
        err.status,
        err,
      );
    }
    if (!(err instanceof DcsApiError) || err.status !== 404) throw err;
  }
  try {
    await createOrgRepo(config, owner, {
      name: repo,
      description: `TAS · ${repo}`,
      private: false,
      auto_init: true,
      token: session.token,
    });
    return { created: true };
  } catch (err) {
    const status = err instanceof DcsApiError ? err.status : undefined;
    if (status === 401 || status === 403) {
      throw new BootstrapError(
        `Sin permiso para crear ${owner}/${repo}.`,
        "repo",
        status,
        err,
      );
    }
    throw new BootstrapError(
      `No se pudo crear el repositorio ${owner}/${repo}${statusSuffix(status)}.`,
      "repo",
      status,
      err,
    );
  }
}

/** Fields DCS sends on the Contents API that `@ip-lms/dcs-client` does not type. */
type ContentsServerDates = { last_committer_date?: string };
type FileCommitServerDates = { committer?: { date?: string }; created?: string };

function serverDate(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

/** `lastCommitAt`: Door43 committer date of the file's last commit on `branch`. */
export async function readRepoFile(
  params: RepoFileRef,
): Promise<{ text: string; sha?: string; lastCommitAt?: string }> {
  const config = dcsConfig(params.session.host);
  const meta = await getContents(config, params.owner, params.repo, params.filepath, {
    token: params.session.token,
    ref: params.branch,
  });
  if (Array.isArray(meta)) {
    throw new Error(`«${params.filepath}» es un directorio, no un archivo.`);
  }
  const text = await getRawContent(config, params.owner, params.repo, params.filepath, {
    token: params.session.token,
    ref: params.branch,
  });
  const lastCommitAt = serverDate((meta as ContentsServerDates).last_committer_date);
  return { text, sha: meta.sha, ...(lastCommitAt ? { lastCommitAt } : {}) };
}

function savedResult(saved: CreateOrUpdateContentsResponse): { sha?: string; commitSha?: string; commitAt?: string } {
  const commit = saved.commit as (CreateOrUpdateContentsResponse["commit"] & FileCommitServerDates) | undefined;
  const commitAt = serverDate(commit?.committer?.date) ?? serverDate(commit?.created);
  return { sha: saved.content?.sha, commitSha: commit?.sha, ...(commitAt ? { commitAt } : {}) };
}

export async function writeRepoFile(params: RepoFileRef & {
  content: string;
  message: string;
  sha?: string;
  newBranch?: string;
  step?: BootstrapStep;
}): Promise<{ sha?: string; commitSha?: string; commitAt?: string }> {
  const { session, owner, repo, filepath, content, message } = params;
  const branch = params.branch;
  const config = dcsConfig(session.host);
  let sha = params.sha;
  if (!sha) {
    try {
      const existing = await getContents(config, owner, repo, filepath, {
        token: session.token,
        ref: branch,
      });
      if (!Array.isArray(existing) && existing.sha) sha = existing.sha;
    } catch (err) {
      if (!(err instanceof DcsApiError) || err.status !== 404) {
        throw wrapWriteError(err, { owner, repo, filepath, branch, creating: false, step: params.step });
      }
      sha = undefined;
    }
  }
  try {
    const saved: CreateOrUpdateContentsResponse = await createOrUpdateContents(
      config,
      owner,
      repo,
      filepath,
      { content, message, sha, branch, new_branch: params.newBranch, token: session.token },
    );
    return savedResult(saved);
  } catch (err) {
    if (err instanceof DcsApiError && (err.status === 409 || err.status === 422) && !params.sha) {
      try {
        const again = await getContents(config, owner, repo, filepath, {
          token: session.token,
          ref: branch,
        });
        if (!Array.isArray(again) && again.sha) {
          const saved = await createOrUpdateContents(config, owner, repo, filepath, {
            content,
            message,
            sha: again.sha,
            branch,
            token: session.token,
          });
          return savedResult(saved);
        }
      } catch {
        /* fall through */
      }
    }
    if (err instanceof DcsApiError && err.status === 404 && !sha && branch) {
      const exists = await branchExists(config, owner, repo, branch, session.token).catch(() => false);
      if (!exists) {
        const missingStep: BootstrapStep =
          params.step === "file-create" || params.step === "file-copy" || params.step === "book-branch"
            ? "book-branch"
            : params.step || "task-branch";
        throw new BootstrapError(
          `Falta el borrador «${branch}»; no se puede crear el archivo ahí.`,
          missingStep,
          404,
          err,
          branch,
        );
      }
    }
    throw wrapWriteError(err, {
      owner,
      repo,
      filepath,
      branch,
      creating: !sha,
      step: params.step || (sha ? undefined : "file-create"),
    });
  }
}

function wrapWriteError(
  err: unknown,
  ctx: {
    owner: string;
    repo: string;
    filepath: string;
    branch?: string;
    creating?: boolean;
    step?: BootstrapStep;
  },
): Error {
  if (err instanceof BootstrapError) return err;
  const status = err instanceof DcsApiError ? err.status : undefined;
  if (ctx.step) {
    return new BootstrapError(
      explainRepoFileError(err, ctx),
      ctx.step,
      status,
      err,
      ctx.branch,
    );
  }
  return new Error(explainRepoFileError(err, ctx));
}
