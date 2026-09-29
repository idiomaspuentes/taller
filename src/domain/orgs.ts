import type { DcsOrg } from "@ip-lms/dcs-client";

/** DCS/Gitea org: `name` / `username` are the slug (`es-419_gl`). */
export type OrgFields = Pick<DcsOrg, "name" | "full_name"> & { username?: string };

/** Stable slug for paths and APIs. */
export function orgSlug(org: OrgFields): string {
  return String(org.name || org.username || "").trim();
}

/** `full_name` when set; otherwise `name`, then slug. */
export function orgDisplayName(org: OrgFields): string {
  const full = String(org.full_name ?? "").trim();
  if (full) return full;
  const named = String(org.name ?? "").trim();
  if (named) return named;
  return String(org.username ?? "").trim();
}

/** Dropdown label: friendly name, slug secondary when they differ. */
export function orgOptionLabel(org: OrgFields): string {
  const slug = orgSlug(org);
  const display = orgDisplayName(org);
  if (!display || display === slug) return slug;
  return `${display} (${slug})`;
}

export function findOrg(slug: string, orgs: OrgFields[] = []): OrgFields | undefined {
  const clean = slug.trim();
  if (!clean) return undefined;
  return orgs.find((org) => orgSlug(org) === clean);
}

export function orgDisplayNameBySlug(slug: string, orgs: OrgFields[] = []): string {
  const clean = slug.trim();
  if (!clean) return "";
  const hit = findOrg(clean, orgs);
  return hit ? orgDisplayName(hit) : clean;
}

const CHIP_NAME_MAX = 24;

/** Compact header: friendly name when it fits, else slug. */
export function orgChipLabel(slug: string, orgs: OrgFields[] = []): string {
  const clean = slug.trim();
  if (!clean) return "";
  const display = orgDisplayNameBySlug(clean, orgs);
  if (display === clean || display.length <= CHIP_NAME_MAX) return display;
  return clean;
}

/** Keep the current slug visible even if it is not in the fetched list. */
export function withSelectedOrg(orgs: DcsOrg[], slug: string): DcsOrg[] {
  const clean = slug.trim();
  if (!clean || orgs.some((org) => orgSlug(org) === clean)) return orgs;
  return [{ id: 0, name: clean }, ...orgs];
}

export function mergeOrgs(base: DcsOrg[], extra: DcsOrg[]): DcsOrg[] {
  const seen = new Set(base.map(orgSlug));
  const next = [...base];
  for (const org of extra) {
    const slug = orgSlug(org);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    next.push(org);
  }
  return next;
}
