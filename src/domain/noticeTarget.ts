/**
 * Which subtarea a notice on the phone is about, from the address it opens: the push Worker sends `#/mis-tareas/<n>`
 * for a notice of one subtarea. Its tag does not always say it: «es su turno» is tagged `turno` for every subtarea,
 * so that a newer one replaces the older, and was never closed once the person had opened the task (#84).
 */
export function noticeIssue(url: string | undefined): number | undefined {
  const at = /#\/mis-tareas\/(\d+)(?:[/?]|$)/.exec(url ?? "");
  return at ? Number(at[1]) : undefined;
}

/** Whether a notice shown is to be closed: its tag is one of `tags`, or it opens one of `issues`. */
export function noticeToClose(notice: { tag?: string; data?: { url?: string } | null }, tags: string[], issues: number[]): boolean {
  if (notice.tag && tags.includes(notice.tag)) return true;
  const issue = noticeIssue(notice.data?.url);
  return issue !== undefined && issues.includes(issue);
}
