import { createOrUpdateContents, getContents, getRawContent } from "@ip-lms/dcs-client";
import { diagramsPath, emptyDiagramDoc, normalizeDiagramDoc, withDiagram, type DiagramDoc } from "../domain/diagrams";
import type { TreeNode } from "../domain/syntaxTree";
import { PM_REPO_NAME } from "../domain/types";
import { isWriteRace, raceDelay } from "./afinacionStore";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";

/** The diagrams a team made its own (see `domain/diagrams`), kept in the plan repository of its space. */

export async function loadDiagrams(session: GtSession, org: string, book: string, chapter: number): Promise<DiagramDoc> {
  try {
    const raw = await getRawContent(dcsConfig(session.host), org, PM_REPO_NAME, diagramsPath(book, chapter), { token: session.token });
    return normalizeDiagramDoc(JSON.parse(raw), book, chapter);
  } catch {
    return emptyDiagramDoc(book, chapter);
  }
}

/**
 * Leaves a sentence of a chapter as `root` (or, with `null`, without the team's diagram). The file is read again
 * before it is written: two people may each correct a sentence of the same chapter in the same minute, and the
 * one that arrives second must not write over the first.
 */
export async function saveDiagram(session: GtSession, org: string, book: string, chapter: number, key: string, root: TreeNode | null): Promise<DiagramDoc> {
  const config = dcsConfig(session.host);
  const path = diagramsPath(book, chapter);
  for (let attempt = 1; ; attempt++) {
    let sha: string | undefined;
    let doc = emptyDiagramDoc(book, chapter);
    try {
      const existing = await getContents(config, org, PM_REPO_NAME, path, { token: session.token });
      if (!Array.isArray(existing) && existing.sha) {
        sha = existing.sha;
        doc = await loadDiagrams(session, org, book, chapter);
      }
    } catch {
      /* no file yet */
    }
    const next = withDiagram(doc, key, root, { by: session.username, at: new Date().toISOString() });
    try {
      await createOrUpdateContents(config, org, PM_REPO_NAME, path, {
        content: `${JSON.stringify(next)}\n`,
        message: `Diagrama de ${next.book} ${chapter}`,
        sha,
        token: session.token,
      });
      return next;
    } catch (err) {
      if (!isWriteRace(err) || attempt === 4) throw err;
      await raceDelay(attempt);
    }
  }
}
