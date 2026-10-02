import { listIssueComments } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import type { PortionPrMarker } from "../domain/portionPr";
import { parseRefComment } from "../domain/reviewItems";

/** What somebody said about a draft in its review: about one piece of it (`ref`), or about all of it. */
export type ReviewComment = { id: number; by: string; ref: string; text: string; at: string };

/** Comments the app leaves for itself on the review (markers): not part of the conversation. */
const isMachineComment = (body: string) => /<!--\s*(tas|gateway)[:-]/.test(body);

/** The conversation of a draft's review, oldest first. Read by the review tool and by the editor of the draft. */
export async function loadReviewComments(session: GtSession, marker: PortionPrMarker): Promise<ReviewComment[]> {
  const rows = await listIssueComments(dcsConfig(session.host), marker.owner, marker.repo, marker.number, session.token);
  return rows.filter((row) => row.body && !isMachineComment(row.body)).map((row) => ({ id: row.id, by: row.user?.login ?? "", at: row.created_at ?? "", ...parseRefComment(row.body ?? "") }));
}
