/**
 * Verse conflicts recorded at Cerrar: a readable Spanish comment on the
 * subtarea PR plus a machine marker `<!-- tas:verse-conflicts BASE64URL -->`.
 * Base64url because verse text may contain `}` or `-->`.
 */

import { decodeBase64Url, encodeBase64Url } from "./markerCodec";
import type { VerseConflict, VerseConflictCandidate } from "./usfmVerseMerge";

export const VERSE_CONFLICTS_SCHEMA = "tas-verse-conflicts-1";

export type VerseConflictsPayload = {
  schema: typeof VERSE_CONFLICTS_SCHEMA;
  issue: number;
  bookRef: string;
  trunkSha?: string;
  conflicts: VerseConflict[];
};

const MARKER_RE = /<!-- tas:verse-conflicts ([A-Za-z0-9_-]+) -->/g;

function rangeLabel(chapter: number, from: number, to: number): string {
  return to > from ? `${chapter}:${from}–${to}` : `${chapter}:${from}`;
}

function quote(chapter: number, row: VerseConflictCandidate): string {
  const text = row.text.trim() || "(vacío)";
  return `> ${text} _(${rangeLabel(chapter, row.from, row.to)})_`;
}

function keptAndDisplaced(conflict: VerseConflict): {
  kept: VerseConflictCandidate[];
  displaced: VerseConflictCandidate[];
} {
  if (conflict.kept === "tronco") {
    const kept = conflict.candidates.filter((c) => c.source === "tronco");
    return { kept, displaced: conflict.candidates.filter((c) => c.source !== "tronco") };
  }
  const winner = conflict.candidates[conflict.candidates.length - 1];
  return {
    kept: winner ? [winner] : [],
    displaced: conflict.candidates.slice(0, -1),
  };
}

export function formatVerseConflictsComment(params: {
  issueNumber: number;
  bookRef: string;
  trunkSha?: string;
  book: string;
  conflicts: VerseConflict[];
}): string {
  const { issueNumber, bookRef, trunkSha, book, conflicts } = params;
  const lines: string[] = [
    `### Conflictos de versículo al cerrar #${issueNumber}`,
    "",
    `Libro **${book || "—"}** · tronco «${bookRef}»${trunkSha ? ` (\`${trunkSha.slice(0, 10)}\`)` : ""}`,
  ];
  for (const conflict of conflicts) {
    const { kept, displaced } = keptAndDisplaced(conflict);
    lines.push("", `**${rangeLabel(conflict.chapter, conflict.from, conflict.to)} · ${conflict.kind}**`, "");
    lines.push("Quedó en el tronco:");
    lines.push(...(kept.length ? kept.map((c) => quote(conflict.chapter, c)) : ["> (vacío)"]));
    const fromTrunk = displaced.filter((c) => c.source === "tronco");
    const fromIssue = displaced.filter((c) => c.source === "entrante");
    if (fromIssue.length) {
      lines.push("", `Desplazado (#${issueNumber}):`, ...fromIssue.map((c) => quote(conflict.chapter, c)));
    }
    if (fromTrunk.length) {
      lines.push("", "Del tronco:", ...fromTrunk.map((c) => quote(conflict.chapter, c)));
    }
  }
  const payload: VerseConflictsPayload = {
    schema: VERSE_CONFLICTS_SCHEMA,
    issue: issueNumber,
    bookRef,
    ...(trunkSha ? { trunkSha } : {}),
    conflicts,
  };
  lines.push(
    "",
    "El tronco no tiene marcadores de conflicto. Para resolver, edita el tronco con el texto elegido.",
    "",
    `<!-- tas:verse-conflicts ${encodeBase64Url(JSON.stringify(payload))} -->`,
  );
  return lines.join("\n");
}

/** One line for Mis tareas, e.g. `1:10–11 estructura (quedó el tronco) · 1:12 texto (quedó #42)`. */
export function summarizeVerseConflicts(payload: Pick<VerseConflictsPayload, "issue" | "conflicts">): string {
  return payload.conflicts
    .map((c) => {
      const kept = c.kept === "tronco" ? "quedó el tronco" : `quedó #${payload.issue}`;
      return `${rangeLabel(c.chapter, c.from, c.to)} ${c.kind} (${kept})`;
    })
    .join(" · ");
}

export function parseVerseConflictsComment(body: string | null | undefined): VerseConflictsPayload | null {
  const matches = [...(body ?? "").matchAll(MARKER_RE)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(last[1]!)) as Partial<VerseConflictsPayload>;
    if (parsed.schema !== VERSE_CONFLICTS_SCHEMA || !Array.isArray(parsed.conflicts)) return null;
    return {
      schema: VERSE_CONFLICTS_SCHEMA,
      issue: Number(parsed.issue) || 0,
      bookRef: String(parsed.bookRef ?? ""),
      ...(parsed.trunkSha ? { trunkSha: String(parsed.trunkSha) } : {}),
      conflicts: parsed.conflicts,
    };
  } catch {
    return null;
  }
}
