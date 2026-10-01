import type { UiLanguage } from "../config";
import type { PersonLevel } from "./levels";

/**
 * Taller shows a person's Door43 profile but never edits it: name, photo, e-mail and password live in Door43, and
 * the profile page sends people there.
 */

const base = (host: string) => host.replace(/\/$/, "");

/** Where a person edits their own profile (name, photo, e-mail, password). */
export const settingsUrl = (host: string) => `${base(host)}/user/settings`;

/** Their public page on Door43. */
export const publicProfileUrl = (host: string, login: string) => `${base(host)}/${encodeURIComponent(login)}`;

type NamedUser = { login?: string; full_name?: string } | null | undefined;

/** The name to show: the full name when they set one, else their login. */
export function displayName(user: NamedUser, fallbackLogin: string): string {
  const full = (user?.full_name ?? "").trim();
  return full || (user?.login ?? fallbackLogin);
}

/** Up to two letters for a picture-less avatar. */
export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!;
  return letters.toUpperCase();
}

/** «octubre de 2026» / «outubro de 2026»: when they joined Door43. Empty when the date is missing or invalid. */
export function memberSince(created: string | undefined, language: UiLanguage): string {
  if (!created) return "";
  const date = new Date(created);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(language, { month: "long", year: "numeric" });
}

const LEVEL_NAMES: Record<UiLanguage, Record<PersonLevel, string>> = {
  es: { oyente: "Oyente", aprendiz: "Aprendiz", practicante: "Practicante", habilitada: "Persona habilitada" },
  pt: { oyente: "Ouvinte", aprendiz: "Aprendiz", practicante: "Praticante", habilitada: "Pessoa habilitada" },
};

export const levelName = (level: PersonLevel, language: UiLanguage): string => LEVEL_NAMES[language][level];

/** A web address that is safe to put in a link: only http(s). Anything else is dropped. */
export function safeLink(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
