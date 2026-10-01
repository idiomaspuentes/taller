import { tallerConfig, type UiLanguage } from "./config";

/** Product brand. The names come from taller.config.ts; the DCS repo path stays `gateway-tasks` for compatibility. */
export const appName = (language: UiLanguage): string => tallerConfig.brand.name[language];
export const appTitle = (language: UiLanguage): string => `${appName(language)} ${tallerConfig.brand.short}`;
export const ORGANIZATION = tallerConfig.brand.organization;
