import { appName, appTitle } from "./brand";
import type { UiLanguage } from "./config";
import { getUiLanguage, onUiLanguageChange } from "./i18n/language";
import { translate } from "./i18n/messages";

/**
 * The installed app takes its name from the web app manifest (and, on iPhone, from a meta tag). Both are made
 * from the interface language, so the app is installed as «Taller» for someone using Spanish and as «Ateliê» for
 * someone using Portuguese. The name is taken when the app is installed: changing the language later does not
 * rename an app that is already installed.
 */

/** `base` is the absolute address the app is served from, with a trailing slash. */
export function buildManifest(language: UiLanguage, base: string): Record<string, unknown> {
  const icon = (file: string, size: number, purpose: "any" | "maskable") => ({ src: `${base}${file}`, sizes: `${size}x${size}`, type: "image/png", purpose });
  return {
    name: appTitle(language),
    short_name: appName(language),
    description: translate(language, "app.description"),
    lang: language,
    // A manifest served from a blob has no address of its own to resolve against, so everything is absolute.
    start_url: `${base}#/mis-tareas`,
    scope: base,
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f7fb",
    theme_color: "#f5f7fb",
    icons: [icon("icon-192.png", 192, "any"), icon("icon-512.png", 512, "any"), icon("icon-maskable-512.png", 512, "maskable")],
  };
}

let objectUrl = "";

function apply(language: UiLanguage): void {
  const base = new URL(import.meta.env.BASE_URL, window.location.href).href.replace(/\/?$/, "/");
  const blob = new Blob([JSON.stringify(buildManifest(language, base))], { type: "application/manifest+json" });
  const previous = objectUrl;
  objectUrl = URL.createObjectURL(blob);
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link) link.href = objectUrl;
  if (previous) URL.revokeObjectURL(previous);
  document
    .querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", appName(language));
}

/** Keeps the manifest and the iPhone name in step with the interface language. Call once at start. */
export function startManifest(): void {
  if (typeof document === "undefined") return;
  apply(getUiLanguage());
  onUiLanguageChange(() => apply(getUiLanguage()));
}
