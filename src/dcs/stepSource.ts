import { loadEnglishHelpsForRange, loadEnglishScriptureKindUsfm } from "../domain/referenceResources";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { extractDraftVerses } from "../domain/usfmAst";
import { portionRange } from "../domain/usfmEdit";
import type { GtSession } from "./auth";

/**
 * The source of the passage a step is working on, as plain text: what its checks are matched against (see
 * `domain/stepChecks`). The English literal or simplified text for the two texts; the English notes or questions of
 * the passage for those helps. Null when there is no source to read for that work (an article) or it could not be
 * read: then every check applies.
 */
export async function loadStepSource(session: GtSession, ctx: Pick<SolverLaunchContext, "resource" | "book" | "ref" | "chapter">): Promise<string | null> {
  const resource = (ctx.resource ?? "").toLowerCase();
  const range = portionRange(ctx.ref ?? "", ctx.chapter ?? 0);
  if (!range || !ctx.book) return null;
  try {
    if (resource === "tpl" || resource === "tps") {
      const kind = resource === "tps" ? "ust" : "ult";
      const pane = await loadEnglishScriptureKindUsfm(session, kind, ctx.book);
      if (!pane) return null;
      const text = Object.values(extractDraftVerses(pane.usfm, range).verses).join(" ").trim();
      return text || null;
    }
    if (resource === "notas" || resource === "preguntas") {
      const rows = await loadEnglishHelpsForRange(session, ctx, range);
      const mine = rows.filter((row) => row.kind === (resource === "notas" ? "nota" : "pregunta"));
      const text = mine.map((row) => `${row.title} ${row.body}`).join(" ").trim();
      return text || null;
    }
  } catch {
    return null;
  }
  return null;
}
