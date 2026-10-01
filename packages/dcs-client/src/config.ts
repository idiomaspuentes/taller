export interface DcsClientConfig {
  /** e.g. `https://qa.door43.org` or `https://git.door43.org` — the *host*, without `/api/v1` (API_DCS.md §1). */
  host: string;
  /** Sent as `User-Agent` on every request (API_DCS.md §2, best practice #3). */
  userAgent?: string;
}

/**
 * API_DCS.md §1/§6.6: all LMS development targets QA — reused here as
 * the default so a caller has to opt into production explicitly rather
 * than accidentally pointing dev/test traffic at real user data.
 */
export const QA_HOST = "https://qa.door43.org";
export const PRODUCTION_HOST = "https://git.door43.org";

export function apiBase(config: DcsClientConfig): string {
  return `${config.host}/api/v1`;
}

export function resolvedUserAgent(config: DcsClientConfig): string {
  return config.userAgent ?? "IdiomasPuentesLMS/1.0";
}
