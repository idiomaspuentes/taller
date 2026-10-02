import { createOrUpdateContents, getContents, getRawContent } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { normalizeStudyNotes, STUDY_NOTES_SCHEMA, studyNotesFolder, studyNotesPath, visibleStudyNotes, type StudyNote } from "../domain/studyNotes";
import { PM_REPO_NAME } from "../domain/types";

type Where = { session: GtSession; pmOrg: string; lang: string; projectId: string };

/** Every study note of a project the signed-in person may see: their own, and what the others shared. */
export async function loadStudyNotes({ session, pmOrg, lang, projectId }: Where): Promise<StudyNote[]> {
  const config = dcsConfig(session.host);
  const listing = await getContents(config, pmOrg, PM_REPO_NAME, studyNotesFolder(lang, projectId), { token: session.token }).catch(() => null);
  if (!Array.isArray(listing)) return [];
  const files = listing.filter((entry) => entry.type === "file" && entry.name.endsWith(".json"));
  const all = await Promise.all(
    files.map(async (entry) => {
      try {
        const raw = await getRawContent(config, pmOrg, PM_REPO_NAME, entry.path, { token: session.token });
        return normalizeStudyNotes(JSON.parse(raw), entry.name.replace(/\.json$/, ""));
      } catch {
        return [] as StudyNote[];
      }
    }),
  );
  return visibleStudyNotes(all.flat(), session.username);
}

/**
 * Write the signed-in person's notes. Their file is read again first and `change` applied to what it has now, so a
 * note written on another device meanwhile is kept.
 */
export async function changeMyStudyNotes(where: Where, change: (mine: StudyNote[]) => StudyNote[]): Promise<StudyNote[]> {
  const { session, pmOrg, lang, projectId } = where;
  const config = dcsConfig(session.host);
  const path = studyNotesPath(lang, projectId, session.username);
  let sha: string | undefined;
  let mine: StudyNote[] = [];
  try {
    const existing = await getContents(config, pmOrg, PM_REPO_NAME, path, { token: session.token });
    if (!Array.isArray(existing) && existing.sha) {
      sha = existing.sha;
      mine = normalizeStudyNotes(JSON.parse(await getRawContent(config, pmOrg, PM_REPO_NAME, path, { token: session.token })), session.username.toLowerCase());
    }
  } catch {
    /* no notes yet */
  }
  const next = change(mine);
  await createOrUpdateContents(config, pmOrg, PM_REPO_NAME, path, {
    content: `${JSON.stringify({ schema: STUDY_NOTES_SCHEMA, notes: next.map(({ by: _owner, ...note }) => note) }, null, 2)}\n`,
    message: `Apuntes de estudio de ${session.username} (${projectId})`,
    sha,
    token: session.token,
  });
  return next;
}
