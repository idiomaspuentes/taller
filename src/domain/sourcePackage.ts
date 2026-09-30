import { bookUsfmName } from "../prep/discover";

/**
 * The source package a review reads its notes, words, articles and texts
 * from. The administrator chooses it once per project; in this team it is
 * unfoldingWord's English package. The original-language texts are always
 * unfoldingWord's (UHB for the Old Testament, UGNT for the New).
 */
export type SourcePackage = {
  owner: string;
  /** Translation notes, words links, words and academy repositories. */
  tn: string;
  twl: string;
  tw: string;
  ta: string;
  /** Aligned gateway texts shown beside the draft: ULT for the TPL, UST for the TPS. */
  ult: string;
  ust: string;
};

export const DEFAULT_SOURCE_PACKAGE: SourcePackage = {
  owner: "unfoldingWord",
  tn: "en_tn",
  twl: "en_twl",
  tw: "en_tw",
  ta: "en_ta",
  ult: "en_ult",
  ust: "en_ust",
};

/** The package of one organization and language: `en` → `en_tn`, `en_twl`, `en_tw`, `en_ta`, `en_ult`, `en_ust`. */
export function sourcePackageFor(owner: string, lang: string): SourcePackage {
  const code = lang.trim().toLowerCase();
  return { owner: owner.trim(), tn: `${code}_tn`, twl: `${code}_twl`, tw: `${code}_tw`, ta: `${code}_ta`, ult: `${code}_ult`, ust: `${code}_ust` };
}

/** Language code a package was built for (`en_tn` → `en`). */
export function sourcePackageLang(pkg: SourcePackage): string {
  return pkg.tn.replace(/_tn$/, "");
}

const PACKAGE_KEYS: (keyof SourcePackage)[] = ["owner", "tn", "twl", "tw", "ta", "ult", "ust"];

/** A package saved in the project settings; missing or empty fields fall back to the default. `undefined` when it is the default. */
export function normalizeSourcePackage(raw: unknown): SourcePackage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const pkg = { ...DEFAULT_SOURCE_PACKAGE };
  for (const key of PACKAGE_KEYS) {
    const value = typeof row[key] === "string" ? (row[key] as string).trim() : "";
    if (value && /^[A-Za-z0-9._-]+$/.test(value)) pkg[key] = value;
  }
  return PACKAGE_KEYS.every((k) => pkg[k] === DEFAULT_SOURCE_PACKAGE[k]) ? undefined : pkg;
}

/** The package a project reads from: its own, or the default. */
export function resolveSourcePackage(settings?: { sourcePackage?: SourcePackage }): SourcePackage {
  return settings?.sourcePackage ?? DEFAULT_SOURCE_PACKAGE;
}

export const ORIGINAL_OWNER = "unfoldingWord";

/** USFM book numbers 41 to 67 are the New Testament. */
export function isNewTestament(book: string): boolean {
  const num = Number(/^(\d+)-/.exec(bookUsfmName(book))?.[1] ?? 0);
  return num >= 41;
}

export type OriginalTextRef = { owner: string; repo: string; filepath: string; label: string };

export function originalTextRef(book: string): OriginalTextRef {
  const nt = isNewTestament(book);
  return {
    owner: ORIGINAL_OWNER,
    repo: nt ? "el-x-koine_ugnt" : "hbo_uhb",
    filepath: bookUsfmName(book),
    label: nt ? "Griego (UGNT)" : "Hebreo (UHB)",
  };
}
