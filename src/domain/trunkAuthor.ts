/**
 * Who wrote a verse range on the book trunk, read back from the commit
 * messages TAS writes at Cerrar (`trunkMergeCommitMessage`). The conflict
 * payload does not say whose text was displaced; the last trunk commit
 * from another subtarea that touched the range does.
 */

export type TrunkMergeInfo = {
  issue: number;
  login: string | null;
  verses: string;
  chapter: number;
  from: number;
  to: number;
  pull?: number;
  workBranch?: string;
  workSha?: string;
  archiveRef?: string;
};

const HEAD_RE = /^TAS: fusionar versículos (\d+):(\d+)(?:[–-](\d+))? de #(\d+) \((@[\w.-]+|—)\)/;

/** `trunkChoiceCommitMessage`: the range now holds the text of the kept issue. */
const CHOICE_RE =
  /^TAS: elegir versión de (\d+):(\d+)(?:[–-](\d+))? en #\d+ \((?:@[\w.-]+|—)\) — quedó #(\d+) \((@[\w.-]+|—)\)/;

function field(message: string, name: string): string | undefined {
  const m = new RegExp(`^${name}: (.+)$`, "m").exec(message);
  return m?.[1]?.trim() || undefined;
}

export function parseTrunkMergeCommit(message: string | null | undefined): TrunkMergeInfo | null {
  const text = (message ?? "").replace(/\r\n/g, "\n");
  const head = HEAD_RE.exec(text) ?? CHOICE_RE.exec(text);
  if (!head) return null;
  const chapter = Number(head[1]);
  const from = Number(head[2]);
  const to = head[3] ? Number(head[3]) : from;
  const issue = Number(head[4]);
  if (!chapter || !from || !issue || to < from) return null;
  const login = head[5] === "—" ? null : head[5]!.slice(1);
  const work = field(text, "Rama de trabajo");
  const workMatch = work ? /^(.+) @ ([0-9a-f]{7,64})$/i.exec(work) : null;
  const pull = Number(field(text, "PR")?.replace(/^#/, ""));
  return {
    issue,
    login,
    verses: to > from ? `${chapter}:${from}–${to}` : `${chapter}:${from}`,
    chapter,
    from,
    to,
    ...(pull ? { pull } : {}),
    ...(workMatch ? { workBranch: workMatch[1], workSha: workMatch[2] } : work ? { workBranch: work } : {}),
    ...(field(text, "Archivo") ? { archiveRef: field(text, "Archivo") } : {}),
  };
}

/**
 * Newest-first commits of the trunk → the other subtarea whose merge last
 * touched `range`. Commits of `issueNumber` itself (the closer) are skipped.
 */
export function findDisplacedAuthor(
  commits: Array<{ commit?: { message?: string | null } | null }>,
  params: { issueNumber: number; chapter: number; from: number; to: number },
): { otherIssue: number; otherLogin: string | null } | null {
  for (const row of commits) {
    const info = parseTrunkMergeCommit(row.commit?.message);
    if (!info || info.issue === params.issueNumber) continue;
    if (info.chapter !== params.chapter) continue;
    if (info.to < params.from || info.from > params.to) continue;
    return { otherIssue: info.issue, otherLogin: info.login };
  }
  return null;
}
