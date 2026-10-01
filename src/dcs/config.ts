import {
  PRODUCTION_HOST,
  QA_HOST,
  type DcsClientConfig,
} from "@ip-lms/dcs-client";

import { tallerConfig } from "../config";

export { PRODUCTION_HOST, QA_HOST };

type ViteEnv = { DEV?: boolean; VITE_DEFAULT_HOST?: string };
const env = (import.meta as { env?: ViteEnv }).env;

/**
 * The server a new session starts on: the one in taller.config.ts. While the app runs in development it is
 * QA so nobody signs in to production by accident, and `VITE_DEFAULT_HOST=qa` does the same for a test build.
 */
export const DEFAULT_HOST: string =
  env?.VITE_DEFAULT_HOST === "qa" || env?.DEV || tallerConfig.defaultServer === "qa" ? QA_HOST : PRODUCTION_HOST;

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
