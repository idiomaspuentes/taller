import { request, type DcsIssueComment } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { PM_REPO_NAME } from "../domain/types";

export type ThreadReplyRequest = {
  method: "POST";
  path: string;
  body: { body: string };
};

/**
 * Replies always go to the PM issue (`{pmOrg}/gateway-tasks#{n}`), never to
 * the subtarea PR (plan §6.2): it exists from day one and the worker can
 * always comment there.
 */
export function buildThreadReplyRequest(pmOrg: string, issueNumber: number, text: string): ThreadReplyRequest {
  const body = text.trim();
  if (!pmOrg.trim()) throw new Error("Falta la organización PM.");
  if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new Error("Subtarea inválida.");
  if (!body) throw new Error("El mensaje está vacío.");
  return {
    method: "POST",
    path: `/repos/${encodeURIComponent(pmOrg.trim())}/${PM_REPO_NAME}/issues/${issueNumber}/comments`,
    body: { body },
  };
}

export async function postThreadReply(
  session: GtSession,
  pmOrg: string,
  issueNumber: number,
  text: string,
): Promise<DcsIssueComment> {
  const req = buildThreadReplyRequest(pmOrg, issueNumber, text);
  return request<DcsIssueComment>(dcsConfig(session.host), { ...req, token: session.token });
}
