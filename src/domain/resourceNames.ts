import { SCOPE_LABEL, type ResourceNames, type ScopeKey } from "./types";

/**
 * What a resource is called where it is shown. The process of the project says it (`settings.resourceNames`, copied
 * from its template); a project without those names, or a resource the process does not rename, keeps the usual one.
 * `translate` turns the usual name into the interface language (it is written in Spanish).
 */
export function scopeLabel(resource: string, names?: ResourceNames | null, language?: string, translate: (text: string) => string = (text) => text): string {
  const own = names?.[resource as ScopeKey];
  if (own) return (language && own.names?.[language]?.trim()) || own.name;
  const usual = SCOPE_LABEL[resource as ScopeKey];
  return usual ? translate(usual) : resource;
}
