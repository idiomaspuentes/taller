import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";

/**
 * A single entry from the DCS catalog (API_DCS.md §4a) — one published
 * resource (e.g. a Bible translation, a translation-notes set) for one
 * language/owner. Only the fields the LMS actually reads are typed;
 * DCS returns more.
 */
export interface CatalogEntry {
  id: number;
  self_url: string;
  name: string;
  full_name: string;
  owner: string;
  repo: {
    name: string;
    owner: string;
  };
  title: string;
  subject: string;
  language: string;
  language_title?: string;
  language_direction?: "ltr" | "rtl";
  language_is_gl?: boolean;
  stage: "prod" | "preprod" | "draft" | "latest";
  released?: string;
  zipball_url?: string;
  tarball_url?: string;
}

export interface CatalogSearchParams {
  subject?: string | string[];
  lang?: string | string[];
  owner?: string;
  /** Filter by repo topic — multiple values are ORed by DCS (ARQUITECTURA.md §20.1: how a course repo is meant to be discovered). */
  topic?: string | string[];
  stage?: "prod" | "preprod" | "draft" | "latest";
  q?: string;
  page?: number;
  limit?: number;
}

export interface CatalogSearchResponse {
  ok: boolean;
  data: CatalogEntry[];
}

/** GET /catalog/search — the main "what content exists for this language" entry point (API_DCS.md §4a). */
export function searchCatalog(config: DcsClientConfig, params: CatalogSearchParams = {}): Promise<CatalogSearchResponse> {
  return request<CatalogSearchResponse>(config, {
    path: "/catalog/search",
    query: {
      subject: params.subject,
      lang: params.lang,
      owner: params.owner,
      topic: params.topic,
      stage: params.stage,
      q: params.q,
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

export interface CatalogLanguage {
  identifier: string;
  title: string;
  direction: "ltr" | "rtl";
  is_gl: boolean;
}

/** GET /catalog/list/languages (API_DCS.md §4a). */
export function listCatalogLanguages(config: DcsClientConfig): Promise<CatalogLanguage[]> {
  return request<CatalogLanguage[]>(config, { path: "/catalog/list/languages" });
}

/** GET /catalog/list/subjects (API_DCS.md §4a). */
export function listCatalogSubjects(config: DcsClientConfig): Promise<string[]> {
  return request<string[]>(config, { path: "/catalog/list/subjects" });
}

/** GET /catalog/list/owners (API_DCS.md §4a). */
export function listCatalogOwners(config: DcsClientConfig): Promise<string[]> {
  return request<string[]>(config, { path: "/catalog/list/owners" });
}

/**
 * GET a single catalog entry by owner/repo (and optionally a specific
 * release tag) — the "give me the record for this exact resource" call
 * that a course author's DCS-picker step would use after `searchCatalog`
 * narrows the list down (API_DCS.md §4a).
 */
export function getCatalogEntry(config: DcsClientConfig, owner: string, repo: string, ref?: string): Promise<CatalogEntry> {
  return request<CatalogEntry>(config, {
    path: `/catalog/entry/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${ref ? `/${encodeURIComponent(ref)}` : ""}`,
  });
}
