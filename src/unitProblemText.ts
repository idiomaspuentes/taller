import { scopeLabel } from "./domain/resourceNames";
import type { AssignmentsDoc } from "./domain/types";
import type { UnitCheckId, UnitProblem } from "./domain/unitPublish";
import { translate, type MessageKey } from "./i18n/messages";

/** The sentence of each check a unit can fail. */
export const PROBLEM_KEY: Record<UnitCheckId, MessageKey> = {
  "draft-missing": "pu.p.draftMissing",
  "usfm-invalid": "pu.p.usfmInvalid",
  "verses-missing": "pu.p.versesMissing",
  "verses-empty": "pu.p.versesEmpty",
  "conflict-marks": "pu.p.conflictMarks",
  "not-aligned": "pu.p.notAligned",
  "tsv-header": "pu.p.tsvHeader",
  "rows-none": "pu.p.rowsNone",
  "row-id": "pu.p.rowId",
  "row-id-repeated": "pu.p.rowIdRepeated",
  "row-empty": "pu.p.rowEmpty",
  "row-quote": "pu.p.rowQuote",
  "row-support": "pu.p.rowSupport",
  "changed-since-endorsement": "pu.p.changed",
  "not-endorsed": "pu.p.notEndorsed",
  "article-empty": "pu.p.articleEmpty",
};

/**
 * A failed check as one line of a conversation: «TPL: faltan versículos 3, 4». Written in Spanish, like everything
 * the app posts; the conversation shows it in the reader's language.
 */
export function problemLine(problem: UnitProblem, board: Pick<AssignmentsDoc, "settings"> | null | undefined): string {
  const where = problem.where.length ? ` ${problem.where.slice(0, 12).join(", ")}${problem.where.length > 12 ? "…" : ""}` : "";
  return `${problem.resource ? `${scopeLabel(problem.resource, board?.settings?.resourceNames, "es")}: ` : ""}${translate("es", PROBLEM_KEY[problem.id])}${where}`;
}
