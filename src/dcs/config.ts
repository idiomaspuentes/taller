import {
  PRODUCTION_HOST,
  QA_HOST,
  type DcsClientConfig,
} from "@ip-lms/dcs-client";

export { PRODUCTION_HOST, QA_HOST };

/**
 * The server a new session starts on. While the app runs in development it is QA,
 * so nobody signs in to production by accident; the published app starts on production.
 */
type ViteEnv = { DEV?: boolean; VITE_DEFAULT_HOST?: string };
const env = (import.meta as { env?: ViteEnv }).env;
/** `VITE_DEFAULT_HOST=qa` makes a published build start on QA (used until the app is launched). */
export const DEFAULT_HOST: string = env?.VITE_DEFAULT_HOST === "qa" || env?.DEV ? QA_HOST : PRODUCTION_HOST;

export function dcsConfig(host: string): DcsClientConfig {
  return {
    host: host.replace(/\/$/, ""),
    userAgent: "GatewayTasks/0.1",
  };
}

export const HOST_OPTIONS = [
  { value: PRODUCTION_HOST, label: "git.door43.org (producción)" },
  { value: QA_HOST, label: "qa.door43.org (QA)" },
] as const;
