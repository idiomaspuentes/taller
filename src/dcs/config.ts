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
export const DEFAULT_HOST: string = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ? QA_HOST : PRODUCTION_HOST;

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
