import { toolHeading } from "./toolHeading";
import { ToolHeader } from "./ToolHeader";
import { StepAsk } from "./StepAsk";
import { HelpMessages } from "./HelpMessages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { articlePathOf, categoryFromSupportRef, categoryLabel } from "../domain/afinacionNotes";
import { bookLabel } from "../domain/books";
import { localizeAfinacion } from "../domain/afinacionNames";
import { missingWork, verseIsAligned, verseList, type MissingWork } from "../domain/checklistReady";
import { termMessageKey } from "../domain/studyNotes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { appendCheckAnswers, loadCheckAnswers } from "../dcs/checkStore";
import { loadTermTitles } from "../dcs/afinacionLoad";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { articleBody, termArticlePath, termLabel, type TermKind } from "../domain/afinacionWords";
import { loadChecklist, type ChecklistData, type ChecklistItem, type ChecklistKind, type ChecklistText } from "../dcs/checklistLoad";
import { commentOnIssue } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { goOnAfterStep } from "../dcs/nextStep";
import { useStepWork } from "../dcs/stepWork";
import { helpRowRef } from "../domain/commentPlace";
import { consultReply, groupInView, groupsOf, helpAtWord, questionsFor, summarizeChecklist, verseCoverage, type CheckAnswer, type CheckItem, type CheckOutcome, type ThreadLine } from "../domain/checklist";
import { PROPOSAL_FREE, loadTrialChecks, proposalAnswer, proposalSaying, proposalsOf, saveTrialChecks, withoutWithdrawn, type ProposalPayload } from "../domain/checkProposal";
import { uid } from "../domain/assignment";
import { ownerTaskOf } from "../domain/resourceOwner";
import { PROPOSAL_STATE_KEY, ProposalDiff, ProposalSheet, type ProposalDraft, type ProposalTarget } from "./ProposalSheet";
import { listIssueComments } from "@ip-lms/dcs-client";
import { dcsConfig } from "../dcs/config";
import { PM_REPO_NAME } from "../domain/types";
import { alignedGatewayQuoteForHelpQuote, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { coordinatorsOf } from "../domain/levels";
import { localized } from "../domain/processes";
import { decodeSolverLaunchContext, encodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { textFingerprint } from "../domain/reviewRound";
import { closesInItsTool, stepMinAssignees } from "../domain/stepClaim";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { scopeLabel } from "../domain/resourceNames";
import { originalTokens, quoteFromSelection } from "../domain/quoteFromSelection";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { verseFromSid } from "../domain/usfmAst";
import { readTeamArticle, saveNoteQuote, type TeamArticle } from "../dcs/teamHelps";
import { explainError } from "../dcs/userError";

type Props = {
  ctxEncoded: string;
  /** What the checklist goes over, and the text each item is checked against: the process says it per step. */
  kind: ChecklistKind;
  texts: ChecklistText[];
  /** Go over only the items that link to a support article. */
  onlyLinked?: boolean;
  onClose: () => void;
  announce: (msg: string) => void;
};

const OUTCOME_KEY: Record<CheckOutcome, MessageKey> = { fixed: "ck.fixed", created: "ck.created", consult: "ck.consult", proposal: "ck.proposal" };
const excerpt = (text: string) => (text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text);
const verseKeyOf = (item: Pick<ChecklistItem, "chapter" | "verse">) => `${item.chapter}:${item.verse}`;

/**
 * A verse with the words a quote points at marked. With `onToggle`, each word can be marked or unmarked. `covered`:
 * the words another help of the verse is about (see `verseCoverage`); they are underlined, and a touch on one goes
 * to that help (`onOpen`). The words of the help in view are touched too when another help shares them.
 */
function Verse({ text, marked, onToggle, covered, onOpen }: { text: string; marked: number[]; onToggle?: (index: number) => void; covered?: (index: number) => boolean; onOpen?: (index: number) => void }) {
  const tokens = tokenizeVersePlainText(text);
  const on = new Set(marked);
  return (
    <span className="ck-verse">
      {tokens.map((token, index) =>
        onToggle ? (
          <button key={index} type="button" className="ck-word" aria-pressed={on.has(index)} onClick={() => onToggle(index)}>
            {token}
          </button>
        ) : covered?.(index) && onOpen ? (
          <span key={index}>
            <button type="button" className="ck-covered" data-here={on.has(index) || undefined} onClick={() => onOpen(index)}>
              {token}
            </button>{" "}
          </span>
        ) : (
          <span key={index}>
            {on.has(index) ? <mark>{token}</mark> : token}{" "}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * A step that closes by a checklist: every item of the passage, with the yes/no questions the process declares for
 * the step. The screen knows how to show notes, questions and terms beside a text; which questions are asked, and of
 * what, comes from the template.
 */
export function ChecklistView({ ctxEncoded, kind, texts, onlyLinked, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<ChecklistData | null>(null);
  const [answers, setAnswers] = useState<CheckAnswer[]>([]);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [closing, setSaving] = useState(false);
  /** Answers on their way to Door43. */
  const [writing, setWriting] = useState(0);
  const saving = closing || writing > 0;
  const [error, setError] = useState("");
  const [stepDone, setStepDone] = useState(false);
  /**
   * A change being proposed: the question that was answered «no» (or none: something seen in passing), and the
   * reason it starts with. `onlyVerse`: the question is about the verse as a whole, not about the help in view.
   */
  const [proposing, setProposing] = useState<{ answerItemId: string; questionId: string; reason: string; onlyVerse?: boolean } | null>(null);
  /** Fixing the quote of the note in view: the words marked in the text so far. */
  const [picking, setPicking] = useState<number[] | null>(null);

  const textsKey = texts.join(",");
  /** A note's quote is fixed on the first text of the step, the one its quote is read against. */
  const canPick = (resource: ChecklistText) => kind === "notas" && resource === texts[0] && Boolean(data?.original) && !data?.fromSource;
  /** What the project's process calls each text. */
  const textLabel = (resource: ChecklistText) => scopeLabel(resource, data?.board?.settings?.resourceNames, language);
  const storeKey = ctx ? `${(ctx.book || ctx.projectId).toUpperCase()}.${ctx.issueNumber || ctx.taskId}.${ctx.stepId || "paso"}` : "";
  /**
   * Opened to try it (see `trialLaunchContext`): what is answered stays on this screen. Opened that way it wrote
   * every answer to the project all the same, under the name of the task, where no subtarea would ever read it.
   */
  const trying = Boolean(ctx?.lab && !ctx.labAllowWrite);

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) return setError(tNow("af.badLink"));
    setCtx(decoded);
    if (!session?.token) return setError(tNow("af.expired"));
    setBusy(true);
    setError("");
    try {
      const loaded = await loadChecklist({ session, ctx: decoded, kind, texts: textsKey.split(",").filter(Boolean) as ChecklistText[], onlyLinked });
      setData(loaded);
      const key = `${(decoded.book || decoded.projectId).toUpperCase()}.${decoded.issueNumber || decoded.taskId}.${decoded.stepId || "paso"}`;
      // A trial keeps its answers in this tab (see `loadTrialChecks`), so the agreement can be tried after it.
      setAnswers(decoded.lab && !decoded.labAllowWrite ? loadTrialChecks(key) : await loadCheckAnswers(session, loaded.target, key));
      if (decoded.pmOrg && decoded.issueNumber && decoded.stepId) {
        setStepDone(await stepIsDone({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId }).catch(() => false));
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session, kind, textsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const questions = data?.step?.checklist ?? [];
  const checkItems: CheckItem[] = useMemo(() => (data?.items ?? []).map((item) => ({ id: item.id, verseKey: verseKeyOf(item), text: item.body, linked: Boolean(item.supportRef) })), [data]);
  // What each verse reads now in the texts on screen: an answer given before a change of the text is checked again.
  const hashes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of data?.items ?? []) out[verseKeyOf(row)] = textFingerprint(texts.map((x) => data?.texts[x]?.verses[row.verse] ?? "").join("|"));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, textsKey]);
  const summary = useMemo(() => summarizeChecklist({ items: checkItems, questions, answers: withoutWithdrawn(answers), currentHashes: hashes }), [checkItems, questions, answers, hashes]);
  useStepWork(session, ctx, summary.done, data?.items.length ?? 0, { on: !stepDone && !closing });
  // What was said in the conversation of the subtarea, read while a consultation waits: its answer is shown here.
  const [thread, setThread] = useState<ThreadLine[]>([]);
  const consulting = summary.consulting.length;
  useEffect(() => {
    if (!consulting || !session || !ctx?.pmOrg || !ctx.issueNumber) return;
    let alive = true;
    void listIssueComments(dcsConfig(session.host), ctx.pmOrg, PM_REPO_NAME, ctx.issueNumber, session.token)
      .then((rows) => alive && setThread(rows.map((row) => ({ by: row.user?.login ?? "", at: row.created_at ?? "", body: row.body ?? "" }))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulting, session?.token, ctx?.pmOrg, ctx?.issueNumber]);
  const replyTo = (answer: CheckAnswer | undefined) => (answer?.outcome === "consult" && !answer.resolved ? consultReply(answer, thread) : null);
  const item = data?.items[Math.min(position, Math.max((data?.items.length ?? 1) - 1, 0))];
  const tally = item ? summary.items.find((row) => row.itemId === item.id) : undefined;
  /**
   * The questions of the help in view. A list that checks a help against several things (two texts, its article)
   * asks them a group at a time: what the group is read against is put on screen, its few questions are answered,
   * and the next group follows. They were a list for each, and every note of a unit was read three times.
   */
  const rowsHere = item ? questionsFor({ id: item.id, verseKey: verseKeyOf(item), text: item.body, linked: Boolean(item.supportRef) }, checkItems, questions) : [];
  const groups = groupsOf(rowsHere);
  const grouped = groups.length > 1;
  /** The group somebody asked for, of the help it was asked for: another help starts at what it has left. */
  const [asked, setAsked] = useState<{ itemId: string; about: string } | null>(null);
  const group = groupInView(groups, (id) => Boolean(tally?.answers[id]), asked && asked.itemId === item?.id ? asked.about : undefined);
  const rowsShown = grouped ? (group?.rows ?? []) : rowsHere;
  const pendingHere = rowsShown.filter(({ question }) => !tally?.answers[question.id]);
  /** Another group of this help has something left to answer. */
  const pendingElsewhere = grouped && groups.some((other) => other !== group && other.rows.some((row) => !tally?.answers[row.question.id]));
  /** The texts on screen: up to the one the group is read against; all of them when the list is not asked in groups. */
  const aboutText = texts.indexOf((group?.about ?? "") as ChecklistText);
  const textsShown = !grouped ? texts : aboutText >= 0 ? texts.slice(0, aboutText + 1) : texts.slice(0, 1);
  /** The group is read against the article of the help, not against a text. */
  const aboutArticle = grouped && aboutText < 0 && Boolean(group?.about);
  // A key term is shown by the name the team gives it (the title of its article), not by its code in English.
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    const sess = loadSession();
    if (!sess?.token || !ctx || data?.kind !== "palabras" || !data.items.length) return;
    let cancelled = false;
    const uses = data.items.flatMap((row) => {
      const [termKind, ...slug] = (row.supportRef ?? "").split("/");
      return termKind && slug.length ? [{ termKind: termKind as TermKind, termSlug: slug.join("/") }] : [];
    });
    void loadTermTitles(sess, null, uses, ctx)
      .then((titles) => !cancelled && setTermTitles(titles))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.kind, data?.items]);
  // A message about a key term names the term (it holds for every use of it); about a note or a question, that row.
  const [termKind, ...termSlug] = (item?.supportRef ?? "").split("/");
  // The article of the term in view. The checklist asks whether its definition is right for this verse, and showed
  // only its title: whoever checked had to know the article, or go and find it. Read once per term, as it comes up.
  const [articles, setArticles] = useState<Record<string, string | null>>({});
  // The article of the item opens on the section the step is about, when the process names one.
  const focusHeads = (rowsShown.find((row) => row.question.articleFocus?.length)?.question.articleFocus ?? data?.step?.articleFocus ?? []).join("\u0000");
  const shownArticle = `${position}|${Object.keys(articles).length}|${group?.about ?? ""}`;
  useEffect(() => {
    const box = document.querySelector<HTMLElement>(".ck-article");
    // A group with no section of its own reads the article from its beginning.
    if (!focusHeads) {
      if (box && grouped) box.scrollTop = 0;
      return;
    }
    const wanted = focusHeads.split("\u0000").map((head) => head.toLowerCase());
    const head = box ? [...box.querySelectorAll<HTMLElement>("h1, h2, h3, h4")].find((el) => wanted.includes((el.textContent ?? "").trim().toLowerCase())) : undefined;
    if (box && head) box.scrollTop = head.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 4;
  }, [focusHeads, shownArticle]);
  const slug = kind === "palabras" && termKind ? termSlug.join("/") : "";
  // The Academy article a note points to. Its checklist asks whether the article teaches the difficulty of the
  // note and whether it is published in this language, and showed its name alone: neither could be answered here.
  const articlePath = kind === "notas" && item?.supportRef ? articlePathOf(item.supportRef) : "";
  const [academy, setAcademy] = useState<Record<string, TeamArticle | null>>({});
  useEffect(() => {
    if (!articlePath || !session?.token || !ctx || !data || articlePath in academy) return;
    let cancelled = false;
    void readTeamArticle({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, pkg: resolveSourcePackage(data.board?.settings), resource: "academia", path: articlePath })
      .catch(() => null)
      .then((article) => !cancelled && setAcademy((prev) => ({ ...prev, [articlePath]: article })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articlePath, session?.token, ctx?.issueNumber, data]);
  useEffect(() => {
    if (!slug || !session?.token || !ctx || !data || slug in articles) return;
    let cancelled = false;
    // As the team has it now: an article it translated for this book is on its draft, not published yet.
    void readTeamArticle({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, pkg: resolveSourcePackage(data.board?.settings), resource: "palabras", path: termArticlePath(termKind as TermKind, slug) })
      .catch(() => null)
      .then((article) => !cancelled && setArticles((prev) => ({ ...prev, [slug]: article?.text?.trim() ? article.text : null })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, Boolean(data)]);
  // On to another group of the same help: its questions are brought over the bar at the foot. The text it is read
  // against had come on screen above, and the questions were left under the bar (the first at 788 px of 812). A
  // new help is read from its beginning first: it is only kept from starting under the text, which stays on top.
  const checksRef = useRef<HTMLUListElement>(null);
  const shownFor = useRef("");
  const groupKey = `${group?.about ?? ""}|${aboutArticle ? Object.keys(academy).length : 0}`;
  useEffect(() => {
    const was = shownFor.current;
    shownFor.current = item?.id ?? "";
    const list = checksRef.current;
    // The screen scrolls inside itself (`.af`), not in the window.
    const screen = list?.closest<HTMLElement>(".af");
    if (!grouped || !item || !list || !screen || !was) return;
    if (was !== item.id) {
      const under = (screen.querySelector(".af-dock")?.getBoundingClientRect().bottom ?? 0) + 8 - (list.closest(".af-card")?.getBoundingClientRect().top ?? window.innerHeight);
      if (under > 0) screen.scrollBy({ top: -under });
      return;
    }
    const floor = (screen.querySelector<HTMLElement>(".ck-go[data-on]")?.getBoundingClientRect().top ?? window.innerHeight) - 8;
    const over = list.getBoundingClientRect().bottom - floor;
    if (over > 0) screen.scrollBy({ top: over });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, item?.id]);
  const messageKey = kind === "palabras" && termKind && termSlug.length ? termMessageKey(termKind, termSlug.join("/")) : (item?.id ?? "");
  const closesHere = Boolean(data?.step && closesInItsTool(data.step) && ctx?.issueNumber);

  // What this checklist needs done before it: the helps translated and each text aligned. What is missing is said,
  // and its team told, instead of checking against half-done work.
  const missing = useMemo<MissingWork[]>(
    () => (data ? missingWork({ helps: kind, fromSource: data.fromSource, chapter: data.chapter, verses: data.items.map((row) => row.verse), texts: texts.map((resource) => ({ resource, ...data.texts[resource] })) }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, kind, textsKey],
  );
  /** The coordinators of the teams whose work a missing piece is: of the tasks, among those this one waits for, that work on that resource. */
  const ownersOf = (resource: string) => {
    if (!data?.board || !data.task) return [] as string[];
    const awaited = (data.task.waitsFor ?? []).flatMap((rule) => (rule.taskId ? data.board!.teams.filter((task) => task.id === rule.taskId) : data.board!.teams.filter((task) => task.phaseId === rule.phaseId)));
    return [...new Set(awaited.filter((task) => task.rules.some((rule) => rule.resource === resource)).flatMap((task) => coordinatorsOf(data.levelBook, task.orgTeamName)))];
  };
  const missingText = (row: MissingWork) =>
    row.kind === "helps"
      ? t("ck.missHelps").replace("{what}", scopeLabel(row.resource, data?.board?.settings?.resourceNames, language))
      : t(row.kind === "text" ? (row.verses.length === 1 ? "ck.missTextOne" : "ck.missText") : row.verses.length === 1 ? "ck.missAlignmentOne" : "ck.missAlignment").replace("{text}", scopeLabel(row.resource, data?.board?.settings?.resourceNames, language)).replace("{verses}", verseList(row.verses));
  const missingKey = `taller.ck-told.${storeKey}.${missing.map((row) => `${row.kind}:${row.resource}:${"verses" in row ? row.verses.join(",") : ""}`).join("|")}`;
  const [told, setTold] = useState(false);
  useEffect(() => {
    try {
      setTold(Boolean(missing.length) && window.localStorage.getItem(missingKey) === "1");
    } catch {
      setTold(false);
    }
  }, [missingKey, missing.length]);

  /** Tell the teams whose work is missing, in the conversation of this subtarea: each coordinator is named with what is theirs. */
  async function tellMissing() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !data || !missing.length) return;
    setSaving(true);
    setError("");
    try {
      const lines = missing.map((row) => `- ${ownersOf(row.resource).map((login) => `@${login}`).join(" ")} ${missingText(row)}`.replace("-  ", "- "));
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, `${t("ck.missComment").replace("{where}", `${data.book} ${ctx.ref || data.chapter}`)}\n${lines.join("\n")}`);
      try {
        window.localStorage.setItem(missingKey, "1");
      } catch {
        /* told all the same */
      }
      setTold(true);
      announce(t("ck.missTold"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * An answer shows at once and is written behind: the person goes on to the next question without waiting for
   * Door43. If the write fails the answer is taken back and the error is said.
   */
  async function save(next: CheckAnswer[], said: string) {
    if (!session || !data) return;
    if (trying) {
      setAnswers((prev) => {
        const all = [...prev, ...next];
        saveTrialChecks(storeKey, all);
        return all;
      });
      announce(t("ck.tryKept"));
      return;
    }
    setAnswers((prev) => [...prev, ...next]);
    setWriting((n) => n + 1);
    setError("");
    try {
      await appendCheckAnswers(session, data.target, storeKey, next);
      announce(said);
    } catch (err) {
      setAnswers((prev) => prev.filter((row) => !next.includes(row)));
      setError(explainError(err));
    } finally {
      setWriting((n) => n - 1);
    }
  }

  const stamp = (answerItemId: string, questionId: string, value: "yes" | "no", extra: Partial<CheckAnswer> = {}): CheckAnswer => ({
    itemId: answerItemId,
    questionId,
    value,
    by: session?.username ?? "",
    at: new Date().toISOString(),
    textHash: hashes[answerItemId.startsWith("verse:") ? answerItemId.slice("verse:".length) : (checkItems.find((row) => row.id === answerItemId)?.verseKey ?? "")],
    ...extra,
  });

  /**
   * How many of the team have to be for a proposal, its author among them: what the step where the team agrees
   * asks for. And whether the team maintains a resource; what it does not is asked of whoever does.
   */
  const agreement = data?.task?.steps?.find((step) => step.closing === "consensus");
  const needed = agreement ? stepMinAssignees(agreement) : 2;
  const ours = (resource: string) => Boolean(data?.task?.rules.some((rule) => rule.resource === resource));
  const teamOf = (resource: string) => {
    const owner = ownerTaskOf(resource, data?.board, data?.task);
    return owner ? owner.orgTeamName || localized(owner.name, owner.names, language) : "";
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const proposals = useMemo(() => proposalsOf(answers, needed, ours), [answers, needed, data?.task]);

  /**
   * The new version still to be settled of something, the latest: another one about the same thing starts from it
   * and takes its place. Two answers of the same note could each rewrite it from the words as they are, and of two
   * versions agreed on, the second written wiped what the first had changed.
   */
  const priorOf = (target: Pick<ProposalTarget, "resource" | "rowId" | "path" | "field">, where: string) =>
    [...proposals]
      .reverse()
      .find((view) => (view.state === "open" || view.state === "agreed") && Boolean(view.proposal.after) && view.proposal.resource === target.resource && view.proposal.rowId === target.rowId && view.proposal.path === target.path && view.proposal.field === target.field && (Boolean(target.rowId || target.path) || view.proposal.where === where));
  /** What is proposed for the help in view itself: read with it, since the next group checks the help as it would be. */
  const proposedHelp = item && kind !== "palabras" ? priorOf({ resource: kind, rowId: item.id, field: kind === "notas" ? "Note" : "Response" }, "") : undefined;

  /** What a proposal about the help in view can be about: the help, its article, and the texts it is checked against. */
  const targets = useMemo<ProposalTarget[]>(() => {
    if (!item || !data) return [];
    const where = `${item.chapter}:${item.verse}`;
    const whose = (resource: string) => (ours(resource) ? {} : { team: teamOf(resource) });
    const help: ProposalTarget[] = proposing?.onlyVerse
      ? [{ id: "verse", label: t("pr.targetVerse").replace("{what}", scopeLabel(kind, data.board?.settings?.resourceNames, language)).replace("{ref}", where), resource: kind, commentOnly: true, ...whose(kind) }]
      : kind === "notas"
        ? [{ id: "help", label: t("pr.targetNote"), resource: kind, rowId: item.id, field: "Note", text: item.body, ...whose(kind) }]
        : kind === "preguntas"
          ? [
              { id: "answer", label: t("pr.targetAnswer"), resource: kind, rowId: item.id, field: "Response", text: item.body, ...whose(kind) },
              { id: "question", label: t("pr.targetQuestion"), resource: kind, rowId: item.id, field: "Question", text: item.title, ...whose(kind) },
            ]
          : [];
    const article: ProposalTarget[] = proposing?.onlyVerse
      ? []
      : articlePath
        ? [{ id: "article", label: t("pr.targetArticle"), resource: "academia", path: `${articlePath}/01.md`, text: academy[articlePath]?.text ?? undefined, ...whose("academia") }]
        : slug
          ? [{ id: "article", label: t("pr.targetArticle"), resource: kind, path: termArticlePath(termKind as TermKind, slug), text: articles[slug] ?? undefined, ...whose(kind) }]
          : [];
    const read = texts.map<ProposalTarget>((resource) => ({ id: resource, label: t("pr.targetText").replace("{name}", textLabel(resource)), resource, text: data.texts[resource]?.verses[item.verse], ...whose(resource) }));
    // A step, or a group, that goes over the articles starts from the article.
    return [...(onlyLinked || aboutArticle ? [...article, ...help] : [...help, ...article]), ...read].map((target) => {
      const prior = target.commentOnly ? undefined : priorOf(target, where);
      return prior ? { ...target, start: prior.proposal.after } : target;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, data, proposing?.onlyVerse, academy, articles, articlePath, slug, textsKey, language, proposals, aboutArticle]);

  async function sendProposal(draft: ProposalDraft) {
    if (!proposing || !item || !session) return;
    const payload: ProposalPayload = {
      id: `pr-${uid()}`,
      resource: draft.target.resource,
      where: `${item.chapter}:${item.verse}`,
      ...(draft.target.field ? { field: draft.target.field } : {}),
      ...(draft.target.path ? { path: draft.target.path } : {}),
      ...(draft.target.rowId ? { rowId: draft.target.rowId } : {}),
      ...(draft.target.text !== undefined ? { before: draft.target.text } : {}),
      ...(draft.after ? { after: draft.after } : {}),
      ...(draft.after && draft.target.start ? { replaces: priorOf(draft.target, `${item.chapter}:${item.verse}`)?.proposal.id } : {}),
    };
    const base = stamp(proposing.answerItemId, proposing.questionId, "no");
    await save([proposalAnswer({ itemId: base.itemId, questionId: base.questionId, by: base.by, at: base.at, reason: draft.reason, proposal: payload, textHash: base.textHash })], draft.target.team ? t("ck.proposedOther").replace("{team}", draft.target.team) : t("ck.proposed"));
    setProposing(null);
  }

  /** Whoever made a proposal takes it back: its «no» is unanswered again. */
  const withdraw = (proposalId: string) => save([proposalSaying(proposalId, session?.username ?? "", new Date().toISOString(), false)], t("ck.withdrawn"));

  /** The quote of the note in view becomes the words of the original under the words marked in the text. */
  async function saveQuote(resource: ChecklistText) {
    if (!session || !ctx || !data || !item || !picking?.length) return;
    const text = data.texts[resource];
    const sid = Object.keys(text?.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const found = quoteFromSelection({
      verseTokens: tokenizeVersePlainText(text?.verses[item.verse] ?? ""),
      selected: picking,
      groups: sid ? text!.alignments![sid]! : [],
      original: originalTokens(data.original ?? "", item.chapter, item.verse),
    });
    if (!found) return setError(t("ck.quoteNotAligned"));
    if (trying) {
      setData({ ...data, items: data.items.map((row) => (row.id === item.id ? { ...row, quote: found.quote, occurrence: found.occurrence } : row)) });
      setPicking(null);
      announce(t("ck.tryKept"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveNoteQuote({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, noteId: item.id, quote: found.quote, occurrence: found.occurrence });
      setData({ ...data, items: data.items.map((row) => (row.id === item.id ? { ...row, quote: found.quote, occurrence: found.occurrence } : row)) });
      setPicking(null);
      announce(t("ck.quoteSaved"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  async function closeStep() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !ctx.stepId) return;
    setSaving(true);
    try {
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      setStepDone(true);
      announce(t("ck.stepClosed"));
      // On to what follows, as the other tools do: the next list of the same task when it is this person's, or
      // their tasks. The screen stayed on a list with every answer given, «Paso cerrado», and nothing to press.
      await goOnAfterStep(session, ctx, onClose);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  const jump = (itemId: string) => {
    const at = data?.items.findIndex((row) => row.id === itemId) ?? -1;
    if (at >= 0) setPosition(at);
  };

  // What the verse in view has a help for, in each text on screen. The checklist goes note by note, and a note
  // marks its own words; but «does every difficulty of this verse have a note?» is answered by looking at the
  // verse. Every word some help of the verse is about is underlined, and a touch on it goes to that help.
  const verseOf = item ? verseKeyOf(item) : "";
  const coverage = useMemo(() => {
    const out: Partial<Record<ChecklistText, Map<number, string[]>>> = {};
    if (!data || !item) return out;
    const helps = data.items.filter((row) => row.quote && row.chapter === item.chapter && row.verse === item.verse);
    for (const resource of texts) {
      const text = data.texts[resource];
      const verse = text?.verses[item.verse] ?? "";
      if (!verse || helps.length < 2) continue;
      out[resource] = verseCoverage(helps.map((row) => ({ id: row.id, words: alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: row.quote!, occurrence: row.occurrence ?? 1, alignments: text?.alignments, book: data.book, chapter: row.chapter, verse: row.verse }).tokenIndices })));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, verseOf, textsKey]);
  const others = (resource: ChecklistText, index: number) => helpAtWord(coverage[resource]?.get(index), item?.id);
  const anyCovered = textsShown.some((resource) => [...(coverage[resource]?.values() ?? [])].some((ids) => ids.some((id) => id !== item?.id)));
  const nextPending = () => {
    if (!data) return;
    // What this help has left, in another group, comes before the next help.
    if (pendingElsewhere) return setAsked(null);
    const order = [...data.items.slice(position + 1), ...data.items.slice(0, position + 1)];
    const found = order.find((row) => summary.items.find((s) => s.itemId === row.id)?.state !== "ok");
    if (found) jump(found.id);
  };
  /**
   * Nothing wrong in what is asked of the help in view: every question on screen still to be answered is «yes»,
   * and on to its next group, or to the next help. It was a touch for each question: 1,274 answers in one task of
   * the run, nearly all of them «yes».
   */
  const allGood = () => {
    if (!data || !item) return;
    if (pendingHere.length) void save(pendingHere.map(({ question, answerItemId }) => stamp(answerItemId, question.id, "yes")), t("ck.saved"));
    setAsked(null);
    if (pendingElsewhere) return;
    const order = [...data.items.slice(position + 1), ...data.items.slice(0, position)];
    const found = order.find((row) => summary.items.find((s) => s.itemId === row.id)?.state !== "ok");
    if (found) jump(found.id);
  };
  const labelOf = (itemId: string) => {
    const found = data?.items.find((row) => row.id === itemId);
    return found ? `${found.chapter}:${found.verse}${found.title ? ` · ${found.title}` : ""}` : itemId;
  };

  const stepName = data?.step ? localized(data.step.name, data.step.names, language) : t("ck.title");
  // The helps editor opens for one resource: this checklist's.
  // On the note or the question in view: whoever goes to correct one of 160 does not look for it again.
  const editorHref = ctx && kind !== "palabras" ? `#/solver/helps?ctx=${encodeURIComponent(encodeSolverLaunchContext({ ...ctx, resource: kind, ...(item ? { focus: helpRowRef(`${item.chapter}:${item.verse}`, item.id) } : {}) }))}` : "";

  return (
    <div className="af ck">
      <ToolHeader
        title={toolHeading(ctx, language, stepName).title}
        onBack={onClose}
        meta={toolHeading(ctx, language, stepName).where}
      >
        {data ? (
          <div className="af-progress" aria-label={t("ck.progressAria")}>
            <span>{t("ck.nChecked").replace("{a}", String(summary.done)).replace("{n}", String(data.items.length))}</span>
            <span className="af-bar">
              <i style={{ width: `${data.items.length ? (summary.done / data.items.length) * 100 : 0}%` }} />
            </span>
          </div>
        ) : null}
      </ToolHeader>
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx} />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("af.loading")}</p> : null}
      {trying ? (
        <p className="ck-trying" role="status">
          {t("ck.trying")}
        </p>
      ) : null}
      {data && missing.length ? (
        <div className="ck-missing" role="status">
          <p className="ck-missing__title">{t("ck.missTitle")}</p>
          <ul>
            {missing.map((row) => (
              <li key={`${row.kind}-${row.resource}`}>{missingText(row)}</li>
            ))}
          </ul>
          {ctx?.issueNumber ? (
            told ? (
              <p className="af-hint">{t("ck.missAlreadyTold")}</p>
            ) : (
              <Button type="button" size="sm" disabled={saving} onClick={() => void tellMissing()}>
                {t("ck.missTell")}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      {data && !questions.length ? <p className="af-stale">{t("ck.noQuestions")}</p> : null}
      {data && !data.items.length ? <p className="hub-hint">{t("ck.noItems")}</p> : null}

      {data && data.items.length ? (
        <section className="round" aria-label={t("ck.standingAria")}>
          {stepDone ? (
            // Opened again once closed: there is nothing left to do here, and the way out is said.
            <div className="round__done round__done--leave">
              <p>{t("ck.stepClosed")}</p>
              <Button type="button" size="lg" variant="outline" onClick={onClose}>
                {t("fa.back")}
              </Button>
            </div>
          ) : summary.complete && closesHere ? (
            <div className="round__ready">
              <p>{t("ck.allChecked")}</p>
              <Button type="button" size="lg" disabled={saving} onClick={() => void closeStep()}>
                {t("ck.closeStep")}
              </Button>
            </div>
          ) : null}
          {(
            [
              ["ck.openList", summary.open],
              ["ck.consultList", summary.consulting],
              ["ck.changedList", summary.changed],
            ] as const
          ).map(([key, rows]) =>
            rows.length ? (
              <details key={key} className="ck-list" data-kind={key}>
                <summary>{t(key).replace("{n}", String(rows.length))}</summary>
                <ul className="round__list">
                  {rows.map((row) => (
                    <li key={row.itemId}>
                      <button type="button" className="round__item" onClick={() => jump(row.itemId)}>
                        <span>{labelOf(row.itemId)}</span>
                        <span className="round__who">
                          {Object.values(row.answers).filter((a) => a?.value === "no").map((a) => a!.note).filter(Boolean).join(" · ")}
                          {Object.values(row.answers).some((a) => replyTo(a)) ? <b> · {t("ck.repliedShort")}</b> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null,
          )}
        </section>
      ) : null}

      {data && item ? (
        <>
          <section className="af-dock" aria-label={t("ck.textsAria")}>
            <div className="af-dock__bar">
              <strong>
                {bookLabel(data.book, language)} {item.chapter}:{item.verse}
                {item.verseTo ? `–${item.verseTo}` : ""}
              </strong>
              {/* Beside the verse's name, not as one more line under two texts that already take half a phone. */}
              {anyCovered && !picking ? <span className="af-hint ck-covered-hint">{t(kind === "palabras" ? "ck.coveredTerms" : "ck.coveredNotes")}</span> : null}
            </div>
            {textsShown.map((resource) => {
              const text = data.texts[resource];
              // A question about verses 22 and 23 is checked against both: with the first alone, «¿se puede
              // responder con los textos?» had no honest answer.
              const verse = item.verseTo
                ? Array.from({ length: item.verseTo - item.verse + 1 }, (_, i) => text?.verses[item.verse + i] ?? "").filter(Boolean).join(" ")
                : (text?.verses[item.verse] ?? "");
              // The item's quote is in the original language: its words in this text come from the alignment.
              const hit = item.quote && verse ? alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: text?.alignments, book: data.book, chapter: item.chapter, verse: item.verse }) : null;
              return (
                <div key={resource} className="af-row">
                  <span className="af-lbl">{textLabel(resource)}</span>
                  {verse ? (
                    <Verse
                      text={verse}
                      marked={canPick(resource) && picking ? picking : hit?.tokenIndices ?? []}
                      onToggle={canPick(resource) && picking ? (index) => setPicking(picking.includes(index) ? picking.filter((i) => i !== index) : [...picking, index]) : undefined}
                      covered={(index) => Boolean(others(resource, index))}
                      onOpen={(index) => {
                        const next = others(resource, index);
                        if (next) jump(next);
                      }}
                    />
                  ) : (
                    <span className="af-hint">{t("ck.noText").replace("{text}", textLabel(resource))}</span>
                  )}
                  {item.quote && verse ? (
                    <span className="ck-quote" data-found={hit?.gatewayText ? "true" : "false"}>
                      {hit?.gatewayText ? t("ck.quoteIs").replace("{quote}", hit.gatewayText) : t("ck.quoteMissing").replace("{text}", textLabel(resource))}
                    </span>
                  ) : null}
                  {canPick(resource) && verse && !stepDone && !verseIsAligned(data.texts[resource]?.alignments, item.chapter, item.verse) ? (
                    <span className="af-hint">{t("ck.quoteNeedsAlignment")}</span>
                  ) : canPick(resource) && verse && !stepDone ? (
                    picking ? (
                      <span className="af-buttons">
                        <span className="af-hint">{t("ck.quotePickHint")}</span>
                        <Button type="button" size="sm" disabled={closing || !picking.length} onClick={() => void saveQuote(resource)}>
                          {t("ck.quoteSave")}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={closing} onClick={() => setPicking(null)}>
                          {t("af.cancel")}
                        </Button>
                      </span>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(hit?.tokenIndices ?? [])}>
                        {t("ck.quoteFix")}
                      </Button>
                    )
                  ) : null}
                </div>
              );
            })}
          </section>

          <section className="af-card" aria-label={t("ck.itemAria")}>
            <div className="af-card__top">
              <span className="af-chip">{t(kind === "notas" ? "ck.kindNote" : kind === "preguntas" ? "ck.kindQuestion" : "ck.kindTerm")}</span>
              {tally ? <span className="af-state" data-state={tally.state === "ok" ? "agreed" : tally.state === "pending" ? "pending" : "disputed"}>{t(`ck.state.${tally.state}` as MessageKey)}</span> : null}
            </div>
            {item.title ? <h2 className="af-phrase">{kind === "palabras" ? termLabel(item.title, termTitles) : item.title}</h2> : null}
            {item.body ? <HelpMarkdownView className="af-note af-note--md" content={item.body} /> : null}
            {proposedHelp ? (
              <p className="ck-proposed">
                <b>{t("ck.proposedHere")}</b>{" "}
                <span className="ag-diff">
                  <ProposalDiff before={proposedHelp.proposal.before ?? ""} after={proposedHelp.proposal.after ?? ""} />
                </span>
              </p>
            ) : null}
            {slug ? articles[slug] === undefined ? <p className="af-hint">{t("ur.readingArticle")}</p> : articles[slug] === null ? <p className="af-hint">{t("ur.noArticle")}</p> : <HelpMarkdownView className="ur-md ur-article ck-article" content={articleBody(articles[slug]!)} /> : null}
            {/* A term is already named by its title above: the path of its article says nothing to who checks it. */}
            {articlePath ? (
              // Closed until asked for: an article is several screens long, and the questions come after it.
              <details key={`${item.id}|${aboutArticle}`} className="ck-read" open={aboutArticle}>
                <summary>{t("ck.support").replace("{ref}", academy[articlePath]?.title || localizeAfinacion(categoryLabel(categoryFromSupportRef(item.supportRef ?? "")), language))}</summary>
                {academy[articlePath] === undefined ? (
                  <p className="af-hint">{t("ur.readingArticle")}</p>
                ) : academy[articlePath]?.text ? (
                  <HelpMarkdownView className="ur-md ur-article ck-article" content={academy[articlePath]!.text!} />
                ) : (
                  <p className="af-hint">{t("ur.noArticle")}</p>
                )}
              </details>
            ) : item.supportRef && kind !== "palabras" ? (
              <p className="af-hint">{t("ck.support").replace("{ref}", kind === "notas" ? localizeAfinacion(categoryLabel(categoryFromSupportRef(item.supportRef)), language) : item.supportRef)}</p>
            ) : null}
            {articlePath && academy[articlePath] ? (
              <p className="af-hint ck-read__where" data-where={academy[articlePath]!.where}>
                {t(`ck.article.${academy[articlePath]!.where}` as MessageKey)}
              </p>
            ) : null}
            {session && ctx?.pmOrg && ctx.projectId && data ? (
              // What the teams before this one said about this very help (those who refined the text, say): read
              // before answering. With nothing said, «Mensajes de equipos anteriores… Puedes responder» stood over
              // an empty box, and with the link to the editor it pushed the questions under the first screen of
              // a phone (the first one at 863 px of 812).
              <HelpMessages key={item.id} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={messageKey} resource={kind} taskName={ctx.taskName} lede={t("hm.ledeRead")} onlyIfAny />
            ) : null}

            {/* What is checked of this help, in a line each: a touch on one says it is not right, and opens the
                proposal. Each was a block of its own with two buttons, 440 px of them under a note. */}
            <p className="af-lbl">{t(grouped ? "ck.checksWith" : "ck.checks")}</p>
            {grouped ? (
              <div className="ck-groups" role="tablist" aria-label={t("ck.checksWith")}>
                {groups.map((row) => {
                  const said = row.rows.map(({ question }) => tally?.answers[question.id]);
                  const state = said.some((answer) => answer?.value === "no") ? "no" : said.every(Boolean) ? "yes" : "none";
                  return (
                    <button key={row.about} type="button" role="tab" aria-selected={row === group} data-state={state} onClick={() => setAsked({ itemId: item.id, about: row.about })}>
                      {state === "yes" ? <Check size={14} aria-hidden /> : state === "no" ? <X size={14} aria-hidden /> : null}
                      {scopeLabel(row.about, data.board?.settings?.resourceNames, language)}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <ul className="ck-checks" ref={checksRef}>
              {rowsShown.map(({ question, answerItemId }) => {
                const answer = tally?.answers[question.id];
                const proposal = answer?.outcome === "proposal" ? proposals.find((view) => view.proposal.id === answer.proposal?.id) : undefined;
                const name = localized(question.text, question.texts, language);
                return (
                  <li key={question.id} data-state={answer?.value ?? "none"}>
                    <button type="button" className="ck-check" disabled={closing || stepDone} onClick={() => setProposing({ answerItemId, questionId: question.id, reason: name, onlyVerse: question.per === "verse" })}>
                      <span className="ck-check__mark" aria-hidden="true">
                        {answer?.value === "yes" ? <Check size={18} /> : answer?.value === "no" ? <X size={18} /> : <Circle size={12} />}
                      </span>
                      <span className="ck-check__text">
                        {name}
                        {question.per === "verse" ? <span className="ck-question__scope"> {t("ck.perVerse")}</span> : null}
                      </span>
                      <span className="sr-only">{t(answer?.value === "yes" ? "ck.yes" : answer?.value === "no" ? "ck.no" : "ck.notYet")}</span>
                    </button>
                    {answer?.value === "no" ? (
                      <div className="ck-question__outcome" data-outcome={answer.outcome ?? "none"}>
                        {proposal ? (
                          <>
                            <b>{t(PROPOSAL_STATE_KEY[proposal.state]).replace("{team}", teamOf(proposal.proposal.resource))}</b>
                            <span className="ag-diff">{proposal.proposal.after ? <ProposalDiff before={proposal.proposal.before ?? ""} after={proposal.proposal.after} /> : excerpt(proposal.reason)}</span>
                            {proposal.state === "open" && proposal.by.toLowerCase() === (session?.username ?? "").toLowerCase() && !stepDone ? (
                              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void withdraw(proposal.proposal.id)}>
                                {t("ck.withdraw")}
                              </Button>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {answer.outcome ? t(OUTCOME_KEY[answer.outcome]) : t("ck.noOutcome")}
                            {answer.note ? `: ${answer.note}` : ""}
                            {replyTo(answer) ? (
                              <span className="ck-question__reply">
                                {t("ck.replied").replace("{who}", replyTo(answer)!.by)} «{replyTo(answer)!.text}»
                              </span>
                            ) : null}
                            {answer.outcome === "consult" && !answer.resolved ? (
                              <Button type="button" size="sm" variant={replyTo(answer) ? "default" : "outline"} disabled={saving} onClick={() => void save([{ ...answer, resolved: true, by: session?.username ?? "", at: new Date().toISOString() }], t("ck.saved"))}>
                                {t("ck.answered")}
                              </Button>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {stepDone ? null : <p className="af-hint">{t("ck.tapWrong")}</p>}
            {/* What to do when the answer is «No»: after the questions, not before them. */}
            {editorHref ? (
              <a className="af-link" href={editorHref} target="_blank" rel="noopener noreferrer">
                {t("ck.openEditor")}
              </a>
            ) : null}
          </section>

          <nav className="af-nav" aria-label={t("ck.navAria")}>
            <Button type="button" variant="secondary" disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
              {t("af.prev")}
            </Button>
            <span className="af-count">{t("af.countOf").replace("{a}", String(position + 1)).replace("{b}", String(data.items.length))}</span>
            <Button type="button" variant="secondary" disabled={position >= data.items.length - 1} onClick={() => setPosition((p) => p + 1)}>
              {t("af.next")}
            </Button>
          </nav>
          {/* What to do next stays in reach, at the foot of the screen. After the last answer of a help the button
              to go on was under the fold (at 878 px of 812), and after the last help of all, «Cerrar este paso» was
              at the top of a list the person was at the bottom of. */}
          {stepDone ? null : (
            <div className="ck-go" data-on>
              <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => setProposing({ answerItemId: item.id, questionId: PROPOSAL_FREE, reason: "" })}>
                {t("ck.propose")}
              </Button>
              {pendingHere.length ? (
                <Button type="button" size="lg" disabled={saving} onClick={allGood}>
                  {t(pendingHere.length < rowsShown.length ? "ck.restGood" : "ck.allGood")}
                </Button>
              ) : !summary.complete ? (
                <Button type="button" size="lg" onClick={nextPending}>
                  {t("ck.nextPending")}
                </Button>
              ) : closesHere ? (
                <Button type="button" size="lg" disabled={saving} onClick={() => void closeStep()}>
                  {t("ck.closeStep")}
                </Button>
              ) : null}
            </div>
          )}
        </>
      ) : null}
      <ProposalSheet open={Boolean(proposing)} onClose={() => setProposing(null)} targets={targets} reason={proposing?.reason ?? ""} saving={saving} onSend={(draft) => void sendProposal(draft)} />
    </div>
  );
}
