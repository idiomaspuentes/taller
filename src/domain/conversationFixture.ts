/**
 * Local demo thread for `#/mis-tareas/{n}?demo=1` (dev builds only). Lets the
 * thread UI be checked on phone and desktop without reading or writing DCS.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import { commentToItem, commitToItem, type ThreadItem, type ThreadSourceState } from "./conversation";
import { buildVerseChoicePosts, type ConflictPrepared } from "./conflictChoice";
import { portionPrApprovalReviewBody } from "./portionPr";
import { formatChatEvent } from "./chatEvent";
import { buildVerseConflictPosts, verseConflictData, type VerseConflictOptionId } from "./verseConflictEvent";

const PM = { owner: "demo-pm-sandbox", repo: "gateway-tasks" };
const PR = { owner: "demo-sandbox", repo: "demo_tpl" };

function at(minutesAgo: number, now: number): string {
  return new Date(now - minutesAgo * 60_000).toISOString();
}

export function demoIssue(issueNumber: number, username: string): DcsIssue {
  return {
    id: issueNumber * 10,
    number: issueNumber,
    title: "NEH 1:10–11 · TPL",
    body: "",
    state: "open",
    html_url: "",
    assignee: { login: username || "ana" },
    assignees: [{ login: username || "ana" }],
    labels: [],
  } as unknown as DcsIssue;
}

export const DEMO_CITES = [
  { id: "1:10", ref: "NEH 1:10", text: "Ellos son tus siervos y tu pueblo, a quienes redimiste con tu gran poder." },
  { id: "1:11", ref: "NEH 1:11", text: "Oh Señor, que tu oído esté atento a la oración de tu siervo." },
];

export function demoThreadSources(
  issueNumber: number,
  username: string,
  now: number = Date.now(),
): ThreadSourceState[] {
  const me = username || "ana";
  const pm = [
    { id: 9001, body: "¿Seguro de «siervo» en 1:10? La ULT dice «servant».", created_at: at(180, now), user: { login: "bob" } },
    { id: 9002, body: "Sí, sigue a la ULT.\n<!-- gt:nota-interna -->", created_at: at(170, now), user: { login: me } },
    {
      id: 9003,
      body: formatChatEvent({
        type: "tipo-que-esta-version-no-conoce",
        emitter: "otra-mini-app",
        issue: issueNumber,
        summary: "La mini-app de notas marcó una cita para revisar",
        data: { x: 1 },
      }),
      created_at: at(60, now),
      user: { login: "bob" },
    },
    {
      id: 9005,
      body: demoConflictBody(issueNumber, me),
      created_at: at(38, now),
      user: { login: me },
    },
    {
      id: 9006,
      body: demoConflictBody(issueNumber, me, 11),
      created_at: at(37, now),
      user: { login: me },
    },
    { id: 9004, body: "Listo, revisé la nota. Gracias.", created_at: at(4, now), user: { login: "bob" } },
  ].map((c) => commentToItem(c, "issue", PM));

  const pr = [
    {
      id: 700,
      body: portionPrApprovalReviewBody({ stepName: "Revisión en pares", issueNumber }),
      created_at: at(120, now),
      user: { login: "bob" },
    },
    {
      id: 701,
      body: `Versículos 1:10–11 de #${issueNumber} fusionados en «neh/tpl-draft» (solo los versículos que cambiaron). El PR se cierra sin fusión Git; los commits de «w/neh/tpl-draft/${me}/${issueNumber}» (0123456789abcdef0123456789abcdef01234567) quedan en la ref «archivo/neh/${issueNumber}».`,
      created_at: at(40, now),
      user: { login: me },
    },
    {
      id: 702,
      body: `### Conflictos de versículo al cerrar #${issueNumber}\n\nLibro **NEH** · borrador grupal\n\n<!-- tas:verse-conflicts eyJzY2hlbWEiOiJ0YXMtdmVyc2UtY29uZmxpY3RzLTEifQ -->`,
      created_at: at(39, now),
      user: { login: me },
    },
  ].map((c) => commentToItem(c, "pr", PR));

  const commits = [
    { sha: "a1", created: at(200, now), commit: { message: `TAS: NEH 1:10–11 (tpl) · #${issueNumber}` }, author: { login: me } },
    { sha: "a2", created: at(195, now), commit: { message: `TAS: NEH 1:10–11 (tpl) · #${issueNumber}` }, author: { login: me } },
    { sha: "a3", created: at(190, now), commit: { message: `TAS: NEH 1:10–11 (tpl) · #${issueNumber}` }, author: { login: me } },
  ]
    .map((c) => commitToItem(c, issueNumber, PR))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  return [
    { kind: "issue", cursorSource: "pm", status: "ok", items: pm },
    { kind: "pr", cursorSource: "pr", status: "ok", items: pr },
    { kind: "commit", status: "ok", items: commits },
  ];
}

const DEMO_TEXTS: Record<number, { tronco: string; entrante: string; other: [number, string] }> = {
  10: {
    tronco: "Estos son tus criados y tu gente, los que rescataste con tu gran fuerza.",
    entrante: "Ellos son tus siervos y tu pueblo, a quienes redimiste con tu gran poder.",
    other: [37, "bob"],
  },
  11: {
    tronco: "Señor, escucha la oración de este siervo tuyo.",
    entrante: "Oh Señor, que tu oído esté atento a la oración de tu siervo.",
    other: [39, "dora"],
  },
};

/** Closer's side of a verse conflict with another subtarea, as Cerrar would post it. */
export function demoConflictBody(issueNumber: number, closer: string, verse = 10): string {
  const texts = DEMO_TEXTS[verse]!;
  const [post] = buildVerseConflictPosts({
    payload: {
      issue: issueNumber,
      bookRef: "neh/tpl-draft",
      trunkSha: "0123456789abcdef0123456789abcdef01234567",
      conflicts: [
        {
          chapter: 1,
          from: verse,
          to: verse,
          kind: "texto",
          kept: "ultimo",
          candidates: [
            { source: "tronco", sideIndex: -1, from: verse, to: verse, text: texts.tronco },
            { source: "entrante", sideIndex: 0, from: verse, to: verse, text: texts.entrante },
          ],
        },
      ],
    },
    closer,
    pr: { owner: PR.owner, repo: PR.repo, number: 7 },
    book: "NEH",
    usfmPath: "16-NEH.usfm",
    others: [{ otherIssue: texts.other[0], otherLogin: texts.other[1] }],
    stamp: "demo",
  });
  return post!.body;
}

/**
 * Stand-ins for `prepare` / `run` in the demo: 1:10 still matches the
 * conflict (buttons enabled); 1:11 changed afterwards (buttons disabled).
 */
export function demoDecisions(issueNumber: number, username: string) {
  const prepared: Record<string, ConflictPrepared> = {
    [`${issueNumber}:1:10-10:demo`]: { trunkText: DEMO_TEXTS[10]!.entrante, sourceReason: null },
    [`${issueNumber}:1:11-11:demo`]: { trunkText: "Señor, oye a tu siervo (editado después).", sourceReason: null },
  };
  const decide = async (optionId: string, item: ThreadItem): Promise<ThreadItem[]> => {
    const data = item.event ? verseConflictData(item.event) : null;
    if (!data || !item.event?.decision) return [];
    await new Promise((resolve) => setTimeout(resolve, 900));
    const posts = buildVerseChoicePosts({
      data,
      decisionId: item.event.decision.id,
      option: optionId as VerseConflictOptionId,
      by: username || "ana",
      wrote: optionId === "desplazado",
    });
    return posts
      .filter((post) => post.issue === issueNumber)
      .map((post) =>
        commentToItem(
          { id: Date.now(), body: post.body, created_at: new Date().toISOString(), user: { login: username || "ana" } },
          "issue",
          PM,
        ),
      );
  };
  return { prepared, decide };
}
