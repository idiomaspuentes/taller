/**
 * What the places of a draft say (a paragraph of an article, a paragraph of an introduction), by the name a comment
 * of its review is filed under. The conversation shows it with the comment, so that «Párrafo 2» is the paragraph
 * itself and not a number to go and look up. Read-only: the draft as it is where its review is, or where it was
 * kept once delivered.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { readRaw } from "./afinacionLoad";
import { loadLinkedPullFiles } from "./portionPr";
import { readRepoFile } from "./repoFile";
import { articleFilesOf, articleRows, introPieceRef, pieceRef } from "../domain/articleBlocks";
import { helpRowRef, plainLine } from "../domain/commentPlace";
import { noteFromTsv } from "../domain/helpMarkup";
import { tsvRowId } from "../domain/helpsDraft";
import { archiveRefName, bookCodeFromWorkHead, parsePortionPrMarker } from "../domain/portionPr";
import { introItems } from "../domain/reviewItems";
import { bookCodeFromIssueTitle, refFromIssueTitle } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import type { AssignmentsDoc } from "../domain/types";
import { parseRefRange } from "../domain/usfmEdit";
import { parseTsvTable } from "../prep/tsv";

export async function loadPlaceTexts(params: { session: GtSession; issue: DcsIssue; board: AssignmentsDoc | null }): Promise<Record<string, string>> {
  const { session, issue, board } = params;
  const marker = parsePortionPrMarker(issue.body);
  if (!marker) return {};
  const names = (await loadLinkedPullFiles(session, marker).catch(() => [])).map((file) => file.filename);
  const book = bookCodeFromIssueTitle(issue.title) || bookCodeFromWorkHead(marker.head).toUpperCase();
  // The draft where it is being reviewed; once delivered, where it was kept; then the group's text.
  const refs = [marker.head, archiveRefName(book, issue.number), marker.base];
  const read = async (filepath: string): Promise<string> => {
    for (const branch of refs) {
      try {
        return (await readRepoFile({ session, owner: marker.owner, repo: marker.repo, filepath, branch })).text;
      } catch {
        /* the next place it may be */
      }
    }
    return "";
  };
  const pkg = resolveSourcePackage(board?.settings);
  const out: Record<string, string> = {};
  const put = (ref: string, row: { draft: string; source: string }) => {
    const said = plainLine(row.draft.trim() ? row.draft : row.source);
    if (said) out[ref] = said;
  };

  const articles = names.filter((name) => /\.md$/i.test(name));
  if (articles.length && !names.some((name) => /\.(usfm|sfm|tsv)$/i.test(name))) {
    // An article of the Academy is a folder (its title, the line under it, its body); one of the words is a file.
    const academy = articles.some((name) => /\/(?:\d+|title|sub-title)\.md$/i.test(name));
    await Promise.all(
      articleFilesOf(articles, academy).map(async (file) => {
        const [draft, source] = await Promise.all([read(file.filename), readRaw(session, pkg.owner, academy ? pkg.ta : pkg.tw, file.filename).catch(() => null)]);
        (source ? articleRows(source, draft) : null)?.forEach((row, index) => put(pieceRef(file.filename, index), row));
      }),
    );
    return out;
  }

  const notes = names.find((name) => /(^|\/)tn_[^/]*\.tsv$/i.test(name));
  const chapter = parseRefRange(refFromIssueTitle(issue.title))?.chapter;
  // A note or a question a comment names by its row (`helpRowRef`): what it says, as the draft has it.
  const rowsOf = (tsv: string) => {
    for (const row of parseTsvTable(tsv).rows) {
      const place = (row.Reference ?? "").trim().match(/^\d+:\d+/)?.[0];
      const said = plainLine(noteFromTsv(row.Note || row.Question || ""));
      if (place && said && helpRowRef(place, tsvRowId(row)) !== place) out[helpRowRef(place, tsvRowId(row))] = said;
    }
  };
  const questions = names.find((name) => /(^|\/)tq_[^/]*\.tsv$/i.test(name));
  if (questions) rowsOf(await read(questions));
  if (notes && chapter) {
    const [draft, source] = await Promise.all([read(notes), readRaw(session, pkg.owner, pkg.tn, notes.split("/").pop()!).catch(() => null)]);
    rowsOf(draft);
    const original = new Map(introItems(source ?? "", "", chapter, () => true).map((row) => [row.key, row.now]));
    for (const intro of introItems(draft, "", chapter, () => true)) {
      const from = original.get(intro.key);
      (from ? articleRows(from, intro.now) : null)?.forEach((row, index) => put(introPieceRef(intro.chapter, index), row));
    }
  }
  return out;
}
