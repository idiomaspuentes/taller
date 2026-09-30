/**
 * DCS side of «Publicar versión» (gestor only). Re-checks the role and the
 * phase gate (including verse decisions written after each pass, read from
 * the subtareas' comments), then creates one normal release per content repo, cut from the
 * default branch tip. Never writes files, never moves the borrador grupal.
 */
import { createRelease, listReleases } from "@ip-lms/dcs-client";
import type { AssignmentsDoc, ReleaseProfile, ScopeKey } from "../domain/types";
import { canManageOrg, resolveResourceRepo } from "../domain/roles";
import {
  publishVersion,
  releaseBody,
  releaseGate,
  releaseResources,
  resolveReleaseIdentity,
  type ReleaseIdentity,
  type ReleaseOutcome,
  type ReleaseWriter,
} from "../domain/release";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { listProjectIssues, loadPmConfig } from "./issues";
import { loadPassDecisionComments } from "./principalPass";
import { getBranchSha, getDefaultBranch } from "./pulls";

const RELEASE_PAGE = 50;
const RELEASE_MAX_PAGES = 20;

type ReleaseTarget = {
  profile: ReleaseProfile;
  repos: string[];
  writer: ReleaseWriter;
};

async function releaseTarget(params: {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  profileId: string;
}): Promise<ReleaseTarget> {
  const { session, pmOrg, board } = params;
  const pmConfig = await loadPmConfig(session, pmOrg);
  if (!canManageOrg(session.teams ?? [], pmOrg, pmConfig.managerTeam)) {
    throw new Error("Solo un gestor puede publicar una versión.");
  }
  const profile = board.settings?.releaseProfiles?.find((p) => p.id === params.profileId);
  if (!profile) throw new Error("Esa versión ya no existe en el proyecto.");
  const owner = (board.contentOrg || "").trim();
  if (!owner) throw new Error("Falta la organización de contenido del proyecto.");

  const repos = [
    ...new Set(
      releaseResources(profile, board.teams)
        .map((r) => resolveResourceRepo(r as ScopeKey, board.lang, pmConfig))
        .filter((r): r is string => Boolean(r)),
    ),
  ];
  if (!repos.length) throw new Error("Las fases elegidas no tienen recursos que publicar.");

  const config = dcsConfig(session.host);
  const token = session.token;
  const writer: ReleaseWriter = {
    async listTags(repo) {
      const tags: string[] = [];
      for (let page = 1; page <= RELEASE_MAX_PAGES; page++) {
        const rows = await listReleases(config, owner, repo, { page, limit: RELEASE_PAGE, token });
        tags.push(...rows.map((r) => r.tag_name));
        if (rows.length < RELEASE_PAGE) break;
      }
      return tags;
    },
    async principalTip(repo) {
      const branch = await getDefaultBranch(config, owner, repo, token);
      const sha = await getBranchSha(config, owner, repo, branch, token);
      if (!sha) throw new Error(`No se encontró el borrador principal de ${repo}. No se publicó nada.`);
      return sha;
    },
    async create(repo, release) {
      await createRelease(config, owner, repo, {
        tagName: release.tag,
        name: release.name,
        body: release.body,
        targetCommitish: release.target,
        token,
      });
    },
  };
  return { profile, repos, writer };
}

/**
 * Name of the version the next publish would create (read only): the day's
 * first one, or «· 2», «· 3»… when earlier versions exist today.
 */
export async function previewReleaseIdentity(params: {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  profileId: string;
  now: Date;
}): Promise<ReleaseIdentity> {
  const { profile, repos, writer } = await releaseTarget(params);
  return resolveReleaseIdentity(writer, { repos, profile, now: params.now });
}

export async function runPublishVersion(params: {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  profileId: string;
  /** Identity shown in the confirm dialog; reused so the gestor gets exactly that name. */
  identity: ReleaseIdentity;
  /** Date the identity was computed for (see `previewReleaseIdentity`). */
  now: Date;
}): Promise<ReleaseOutcome> {
  const { session, pmOrg, board } = params;
  const { profile, repos, writer } = await releaseTarget(params);

  const projectId = board.projectId || board.book;
  const { issues, namespaceId } = await listProjectIssues(session, pmOrg, projectId);
  const principalPasses = board.settings?.principalPasses;
  const decisions = await loadPassDecisionComments({ session, pmOrg, issues, namespaceId, marks: principalPasses });
  const gate = releaseGate({
    profile,
    phases: board.phases,
    tasks: board.teams,
    issues,
    book: board.book,
    namespaceId,
    principalPasses,
    decisions,
  });
  if (gate.blockReason) throw new Error(gate.blockReason);

  const current = await resolveReleaseIdentity(writer, { repos, profile, now: params.now });
  if (current.tag !== params.identity.tag) {
    throw new Error(
      `Mientras confirmabas se publicó otra versión hoy. No se publicó «${params.identity.name}»; cierra y vuelve a publicar para ver el nombre nuevo.`,
    );
  }

  return publishVersion(writer, {
    repos,
    tag: params.identity.tag,
    name: params.identity.name,
    body: releaseBody({ profileName: profile.name, phaseNames: gate.phaseNames, by: session.username }),
  });
}
