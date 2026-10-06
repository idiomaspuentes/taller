import { StepAsk } from "./StepAsk";
import { helpsTsvFilename } from "../domain/helpsTarget";
import { ensureHelpsFileFromSource } from "../dcs/bookBootstrap";
import { readRaw } from "../dcs/afinacionLoad";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { bookLabel, bookNamesIn } from "../domain/books";
import { localPassages } from "../domain/passageLinks";
import { storiesIn, storyRefOf, termsOf } from "../domain/storyFrames";
import { loadStoryFrames, sourceStoriesRepo, teamStoriesRepo } from "../dcs/storyFrames";
import { ChapterSources, NoteQuote, useHelpSources, useSourceHelps } from "./HelpSources";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { ToolHeader } from "./ToolHeader";
import { portionRange } from "../domain/usfmEdit";
import { MarkdownEditor } from "./MarkdownEditor";
import { ArticleBlocks } from "./ArticleBlocks";
import { ConfirmDialog } from "./ConfirmDialog";
import { StoryExample } from "./StoryExample";
import { usePieces, type ActivePiece } from "./usePieces";
import { articleRows, introPieceRef, pieceRef, rowsPossible, startingText } from "../domain/articleBlocks";
import { answerTextId, helpTexts, helpsLeft, type HelpText } from "../domain/helpTexts";
import { loadReviewComments, type ReviewComment } from "../dcs/reviewComments";
import { openComments } from "../domain/reviewComments";
import { noteFromTsv, noteToTsv } from "../domain/helpMarkup";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getContents, getRawContent } from "@ip-lms/dcs-client";
import { loadSession, type GtSession } from "../dcs/auth";
import { dcsConfig } from "../dcs/config";
import { loadPmConfig } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { goOnAfterStep } from "../dcs/nextStep";
import {
  ensurePortionPr,
  getPmIssue,
  resolveVisiblePortionPr,
  saveTextOnPortionBranch,
} from "../dcs/portionPr";
import { recordOwnSave } from "../domain/pendingEvents";
import { loadAssignmentsFromDcs, loadInventoryFromDcs } from "../dcs/persist";
import {
  applyHelpsTsvEdits,
  articleRefsToDraftItems,
  collectHelpsArticleRefs,
  selectTsvRowsForPortion,
  tsvFieldsForItem,
  tsvRowsToDraftItems,
  type HelpsDraftItem,
} from "../domain/helpsDraft";
import { loadHelpsDraftCache, saveHelpsDraftCache } from "../domain/helpsDraftCache";
import { resolveHelpsTarget, type HelpsTarget } from "../domain/helpsTarget";
import { portionPrBranchFromCtx, type PortionPrMarker } from "../domain/portionPr";
import {
  decodeSolverLaunchContext,
  type SolverLaunchContext,
} from "../domain/solverLaunch";
import {
  isLabLaunch,
  labPlaceholderHelpsItems,
  labWriteDecision,
  launchDraftSlot,
} from "../domain/solverLab";
import type { InventoryDoc } from "../domain/types";
import { parseTsvTable } from "../prep/tsv";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { localizeName } from "../domain/templateNames";
import { tNow, useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { explainError } from "../dcs/userError";

type Props = {
  ctxEncoded: string;
  onClose: () => void;
  announce: (msg: string) => void;
};

type FileMeta = { text: string; sha?: string };

/** How a person likes to see an article is kept on their device; without storage it lasts as long as the screen. */
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked storage */
  }
}

async function readFileOnRef(
  session: GtSession,
  owner: string,
  repo: string,
  filepath: string,
  ref?: string,
): Promise<FileMeta> {
  const config = dcsConfig(session.host);
  const meta = await getContents(config, owner, repo, filepath, {
    token: session.token,
    ref,
  });
  if (Array.isArray(meta)) {
    throw new Error(tNow("he.dirNotFile").replace("{f}", filepath));
  }
  const text = await getRawContent(config, owner, repo, filepath, {
    token: session.token,
    ref,
  });
  return { text, sha: ref ? meta.sha : undefined };
}

async function readFilePreferBranch(
  session: GtSession,
  owner: string,
  repo: string,
  filepath: string,
  branch: string,
): Promise<FileMeta> {
  try {
    return await readFileOnRef(session, owner, repo, filepath, branch);
  } catch {
    return readFileOnRef(session, owner, repo, filepath);
  }
}

export function HelpsEditorView({ ctxEncoded, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const loc = (text: string) => localizeThread(text, language);
  const [session, setSession] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [target, setTarget] = useState<HelpsTarget | null>(null);
  const [items, setItems] = useState<HelpsDraftItem[]>([]);
  const [files, setFiles] = useState<Record<string, FileMeta>>({});
  const [branch, setBranch] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingPr, setOpeningPr] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  /** Whether the step this editor was opened for is already completed: finishing it is then not offered again. */
  const [stepDone, setStepDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  /** Asked once more before handing in an article with pieces still to be translated. */
  const [confirming, setConfirming] = useState(false);
  /** What the reviewers said about this draft: shown where the author corrects it. */
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  /** Whether that was read (there is nothing to read while the draft is not in review): the piece found open depends on it. */
  const [reviewRead, setReviewRead] = useState(false);
  const loading = useRef(0);
  const [pane, setPane] = useState<"edit" | "chapter">("edit");
  /** An article is worked piece by piece, each under its source; «todo junto» is the whole text in one box. */
  const [view, setView] = useState<"rows" | "whole">(() => (readPref("taller-article-view") === "whole" ? "whole" : "rows"));
  /** The pieces of the article: the one being written is the only one open, with its source over it. */
  const pieces = usePieces((id) => `help-${id}`);
  const { active, counts: progress } = pieces;
  /** Whether the first piece still to be translated was already opened for whoever came in. */
  const autoOpened = useRef(false);
  /** The files whose starting text was already settled in this opening (see `startingText`). */
  const started = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError(tNow("se.badContext"));
      return;
    }
    setCtx(decoded);
    started.current = new Set();
    autoOpened.current = false;
    pieces.reset();
    const thisLoad = ++loading.current;
    setReviewComments([]);
    setReviewRead(false);
    const slot = launchDraftSlot(decoded);
    const cache = loadHelpsDraftCache(slot.pmOrg, slot.issueNumber);
    const lab = isLabLaunch(decoded);
    const fallbackBranch = portionPrBranchFromCtx(decoded);

    const sess = loadSession();
    setSession(sess);

    let inventory: InventoryDoc | null = null;
    let pmConfig = undefined;
    if (sess?.token) {
      try {
        pmConfig = await loadPmConfig(sess, decoded.pmOrg);
      } catch {
        pmConfig = undefined;
      }
      try {
        inventory = await loadInventoryFromDcs(
          sess,
          decoded.pmOrg,
          decoded.lang,
          decoded.book,
        );
      } catch {
        inventory = null;
      }
    }

    const resolved = resolveHelpsTarget(
      lab && !decoded.contentOrg.trim()
        ? { ...decoded, contentOrg: "local" }
        : decoded,
      pmConfig,
    );
    if ("error" in resolved) {
      setError(resolved.error);
      return;
    }
    setTarget(resolved);

    if (!sess?.token) {
      if (cache) {
        const restored: HelpsDraftItem[] = Object.entries(cache.texts).map(
          ([id, text]) => ({
            id,
            label: id,
            meta: resolved.kind === "tsv" ? "local" : id,
            text,
            secondary: cache.secondary?.[id],
            secondaryLabel: resolved.resource === "preguntas" ? "Respuesta" : undefined,
            filepath: resolved.filepath || id,
            kind: resolved.kind,
          }),
        );
        setItems(restored);
        setBranch(cache.branch || fallbackBranch);
        setDirty(true);
      } else if (lab) {
        setItems(labPlaceholderHelpsItems(decoded, resolved));
        setBranch(fallbackBranch);
      }
      setError(
        lab
          ? tNow("he.labNoSession")
          : tNow("se.noSession"),
      );
      return;
    }

    setBusy(true);
    setError("");
    try {
      let head = cache?.branch || fallbackBranch;
      let review: PortionPrMarker | null = null;
      if (!lab && decoded.issueNumber > 0 && decoded.pmOrg) {
        try {
          const issue = await getPmIssue(sess, decoded.pmOrg, decoded.issueNumber);
          const visible = await resolveVisiblePortionPr({
            session: sess,
            pmOrg: decoded.pmOrg,
            issue,
            workBranch: fallbackBranch,
            username: decoded.username || sess.username,
            book: decoded.book || decoded.projectId,
            taskId: decoded.taskId,
          });
          if (visible.marker) {
            head = visible.marker.head;
            setPrUrl(visible.marker.htmlUrl);
            review = visible.marker;
          } else {
            setPrUrl("");
          }
        } catch {
          /* offline / missing issue */
        }
      }
      setBranch(head);
      // What the reviewers said is shown in the draft: the author corrects with it in view.
      if (review) {
        // Only what is still open: a comment given as resolved, and the author's own answers, ask nothing more.
        const owner = decoded.username || sess.username;
        void loadReviewComments(sess, review, owner)
          .then((rows) => thisLoad === loading.current && setReviewComments(openComments(rows, owner)))
          .catch(() => undefined)
          .finally(() => thisLoad === loading.current && setReviewRead(true));
      } else setReviewRead(true);

      if (resolved.kind === "tsv" && resolved.filepath) {
        try {
          const filepath = resolved.filepath;
          const file = await readFilePreferBranch(sess, resolved.owner, resolved.repo, filepath, head).catch(async (err) => {
            if (lab) throw err;
            // A book the team has not worked yet: its rows are taken from the source and translated in place.
            const board = await loadAssignmentsFromDcs(sess, decoded.pmOrg, decoded.lang, decoded.projectId, decoded.contentOrg).catch(() => null);
            const pkg = resolveSourcePackage(board?.settings);
            const questions = resolved.resource === "preguntas";
            const started = await ensureHelpsFileFromSource({
              session: sess,
              owner: resolved.owner,
              repo: resolved.repo,
              filepath,
              book: resolved.book,
              taskId: decoded.taskId,
              phaseSlug: decoded.phaseSlug,
              source: () => readRaw(sess, pkg.owner, questions ? pkg.tn.replace(/_tn$/, "_tq") : pkg.tn, helpsTsvFilename(questions ? "preguntas" : "notas", resolved.book)),
            });
            if (!started) throw err;
            if (started.created) announce(tNow("he.startedFromSource"));
            return { text: started.text, sha: started.sha } as FileMeta;
          });
          setFiles({ [resolved.filepath]: file });
          const { rows } = parseTsvTable(file.text);
          const tsvResource = resolved.resource === "preguntas" ? "preguntas" : "notas";
          let next = tsvRowsToDraftItems(
            tsvResource,
            resolved.filepath,
            selectTsvRowsForPortion(rows, decoded, inventory),
          );
          let usedCache = false;
          if (cache) {
            next = next.map((item) => {
              const cached = cache.texts[item.id];
              const cachedSec = cache.secondary?.[item.id];
              if (cached != null && cached !== item.text) usedCache = true;
              if (cachedSec != null && cachedSec !== (item.secondary ?? "")) usedCache = true;
              return {
                ...item,
                text: cached ?? item.text,
                secondary: cachedSec ?? item.secondary,
              };
            });
          }
          if (!next.length && lab) next = labPlaceholderHelpsItems(decoded, resolved);
          setItems(next);
          setDirty(usedCache);
          if (usedCache) announce(tNow("se.restored"));
          return;
        } catch (err) {
          if (lab) {
            setItems(labPlaceholderHelpsItems(decoded, resolved));
            setError("");
            return;
          }
          throw err;
        }
      }

      const refs = collectHelpsArticleRefs(decoded, inventory);
      const mdResource = resolved.resource === "academia" ? "academia" : "palabras";
      const drafts = articleRefsToDraftItems(mdResource, refs);
      const nextFiles: Record<string, FileMeta> = {};
      const nextItems: HelpsDraftItem[] = [];
      let usedCache = false;
      for (const item of drafts) {
        let remote = "";
        try {
          const file = await readFilePreferBranch(
            sess,
            resolved.owner,
            resolved.repo,
            item.filepath,
            head,
          );
          nextFiles[item.filepath] = file;
          remote = file.text;
        } catch {
          nextFiles[item.filepath] = { text: "" };
        }
        const cached = cache?.texts[item.id];
        if (cached != null && cached !== remote) usedCache = true;
        nextItems.push({ ...item, text: cached ?? remote });
      }
      setFiles(nextFiles);
      setItems(nextItems.length || !lab ? nextItems : labPlaceholderHelpsItems(decoded, resolved));
      setDirty(usedCache);
      if (usedCache) announce(tNow("se.restored"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, announce]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = useMemo(() => {
    if (!ctx) return "Ayudas";
    // An article is named apart from its book; a passage follows it.
    return [bookLabel(ctx.book, language), ctx.ref].filter(Boolean).join(/^\d/.test(ctx.ref ?? "") ? " " : " · ");
  }, [ctx, language]);

  function persistLocal(nextItems: HelpsDraftItem[], nextBranch: string) {
    if (!ctx) return;
    const texts: Record<string, string> = {};
    const secondary: Record<string, string> = {};
    for (const item of nextItems) {
      texts[item.id] = item.text;
      if (item.secondary != null) secondary[item.id] = item.secondary;
    }
    const slot = launchDraftSlot(ctx);
    saveHelpsDraftCache(slot.pmOrg, slot.issueNumber, {
      texts,
      secondary: Object.keys(secondary).length ? secondary : undefined,
      savedAt: Date.now(),
      branch: nextBranch,
    });
  }

  function updateItem(id: string, patch: Partial<Pick<HelpsDraftItem, "text" | "secondary">>) {
    setItems((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      persistLocal(next, branch);
      return next;
    });
    setDirty(true);
  }

  /** Returns whether what is written reached Door43. */
  async function save(): Promise<boolean> {
    if (!ctx || !target) return false;
    persistLocal(items, branch);
    if (!session) {
      announce(tNow("se.savedLocalAnnounce"));
      return false;
    }
    if (isLabLaunch(ctx)) {
      const decision = labWriteDecision(ctx);
      if (decision.mode === "local") {
        announce(loc(decision.reason));
        return false;
      }
      if (decision.mode === "blocked") {
        setError(decision.reason);
        return false;
      }
    }
    const head = branch || portionPrBranchFromCtx(ctx);
    const ownAction = { host: session.host, username: session.username, pmOrg: ctx.pmOrg };
    setSaving(true);
    setError("");
    try {
      const nextFiles = { ...files };
      if (target.kind === "tsv" && target.filepath) {
        const original = files[target.filepath]?.text ?? "";
        const resource = target.resource === "preguntas" ? "preguntas" : "notas";
        const content = applyHelpsTsvEdits(
          original,
          items.map((item) => ({
            id: item.id,
            fields: tsvFieldsForItem(resource, item),
          })),
        );
        const message = `TAS: ${target.book} ${ctx.ref} (${ctx.resource}) · #${ctx.issueNumber || "—"}`;
        const saved = await saveTextOnPortionBranch({
          session,
          owner: target.owner,
          repo: target.repo,
          filepath: target.filepath,
          content,
          message,
          branch: head,
          sha: files[target.filepath]?.sha,
          book: ctx.book,
          resource: ctx.resource,
          taskId: ctx.taskId,
          phaseSlug: ctx.phaseSlug,
          username: ctx.username || session.username,
          issueNumber: ctx.issueNumber,
        });
        recordOwnSave(ownAction, ctx.issueNumber, message, saved.commitSha);
        nextFiles[target.filepath] = { text: content, sha: saved.sha };
      } else {
        for (const item of items) {
          const remote = files[item.filepath]?.text ?? "";
          // Nothing changed; or nothing was written in a file that does not exist yet, which is not to be made empty.
          if (item.text === remote && (files[item.filepath]?.sha || !item.text.trim())) continue;
          const message = `TAS: ${item.label}${item.part ? ` (${item.part})` : ""} (${ctx.resource}) · #${ctx.issueNumber || "—"}`;
          const saved = await saveTextOnPortionBranch({
            session,
            owner: target.owner,
            repo: target.repo,
            filepath: item.filepath,
            content: item.text,
            message,
            branch: head,
            sha: files[item.filepath]?.sha,
            book: ctx.book,
            resource: ctx.resource,
            taskId: ctx.taskId,
            phaseSlug: ctx.phaseSlug,
            username: ctx.username || session.username,
            issueNumber: ctx.issueNumber,
          });
          recordOwnSave(ownAction, ctx.issueNumber, message, saved.commitSha);
          nextFiles[item.filepath] = { text: item.text, sha: saved.sha };
        }
      }
      setFiles(nextFiles);
      setBranch(head);
      setDirty(false);
      persistLocal(items, head);
      announce(tNow("se.savedIn").replace("{where}", `${target.owner}/${target.repo} @ ${head}`));
      return true;
    } catch (err) {
      setError(explainError(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** «Listo para revisión»: what is not saved yet is saved first. Returns whether the review is open. */
  async function openPr(): Promise<boolean> {
    if (dirty && !(await save())) return false;
    return openReview();
  }

  /**
   * Opens the review of what is saved in Door43; returns whether it is open. It does not save: whoever calls it has.
   * Saving here too made «Terminé el borrador» save twice, and the second time, with what this screen knew of the
   * file before the first, was refused as a conflict.
   */
  async function openReview(): Promise<boolean> {
    if (!session || !ctx) return false;
    setOpeningPr(true);
    setError("");
    try {
      const issue = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
      const board = await loadAssignmentsFromDcs(
        session,
        ctx.pmOrg,
        ctx.lang,
        ctx.projectId,
        ctx.contentOrg,
      );
      if (!board) {
        throw new Error(tNow("se.noPlan"));
      }
      const result = await ensurePortionPr({
        session,
        pmOrg: ctx.pmOrg,
        lang: ctx.lang,
        contentOrg: ctx.contentOrg,
        board,
        issue,
      });
      setPrUrl(result.marker.htmlUrl);
      setBranch(result.marker.head);
      announce(
        result.created
          ? tNow("se.reviewOpened")
          : tNow("se.reviewWasOpen"),
      );
      return true;
    } catch (err) {
      setError(explainError(err));
      return false;
    } finally {
      setOpeningPr(false);
    }
  }

  // Whether the step this editor was opened for is already completed.
  useEffect(() => {
    setStepDone(false);
    if (!session || !ctx?.stepId || !ctx.issueNumber || isLabLaunch(ctx)) return;
    let alive = true;
    stepIsDone({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId })
      .then((done) => alive && setStepDone(done))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, ctx?.issueNumber, ctx?.stepId]);

  /**
   * «Terminé el borrador»: what is written is saved, the review is opened in Door43 and the step is completed, in
   * one action, as in the editor of the text. Before, these were three (save, «Listo para revisión», and «Terminé»
   * back in the list), and whoever stopped after the second left a subtarea in review that still said «Borrador».
   */
  async function finish(left: number, meant = false) {
    if (!session || !ctx?.stepId || !ctx.issueNumber) return;
    // An article with pieces still in the source language is handed in only by somebody who means to. They are
    // asked apart from the button: asked in the bar itself, pressing it twice was the answer, read or not.
    if (left && !meant) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setFinishing(true);
    setError("");
    try {
      if (dirty && !(await save())) return;
      if (!(await openReview())) return;
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      announce(tNow("se.finished"));
      await goOnAfterStep(session, ctx, onClose);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setFinishing(false);
      setConfirming(false);
    }
  }

  // A note or a question is translated beside the source texts of its chapter; an article is not of one passage.
  const isNotes = target?.resource === "notas";
  const wantsSources = target?.kind === "tsv";
  const range = ctx ? portionRange(ctx.ref, ctx.chapter) : null;
  const { helps: sourceHelps, lang: sourceLang, owner: sourceOwner, loaded: sourceRead } = useSourceHelps(session, ctx, target, items);
  // Without a session nothing is read: the article is then edited whole, as before.
  const sourceReady = sourceRead || !session;

  // An article with nothing translated yet starts from the source as it is today (see `startingText`). It is not a
  // change of whoever opened it: nothing is saved until something is written.
  useEffect(() => {
    if (!sourceRead || target?.kind !== "markdown") return;
    // Settled once for each file, with the text it has when its source arrives.
    const fresh: Record<string, string> = {};
    for (const item of items) {
      if (item.kind !== "markdown" || started.current.has(item.id)) continue;
      started.current.add(item.id);
      const from = sourceHelps[item.id]?.text;
      const text = from ? startingText(from, item.text) : null;
      if (text !== null) fresh[item.id] = text;
    }
    if (Object.keys(fresh).length) setItems((prev) => prev.map((item) => (item.id in fresh ? { ...item, text: fresh[item.id]! } : item)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceRead, sourceHelps, target?.kind]);

  const articles = items.filter((item) => item.kind === "markdown");
  // What is worked piece by piece: an article, and each note and question of a passage, a question with its answer
  // (see `helpTexts`). The rest is edited whole, in a box.
  const texts = useMemo(() => helpTexts(items, sourceHelps, { articlesWhole: view === "whole" }), [items, sourceHelps, view]);
  const textOf = new Map(texts.map((text) => [text.id, text]));
  const introName = (item: HelpsDraftItem) => (item.intro === "book" ? t("fa.bookIntro") : t("fa.chapterIntro").replace("{n}", String(item.chapter ?? "")));
  const canUseRows = articles.some((item) => Boolean(sourceHelps[item.id]?.text) && rowsPossible(sourceHelps[item.id]!.text, item.text));
  // Counted, and named, as whoever translates counts: the paragraphs of an article, the notes or the questions of a passage.
  const unit = target?.kind !== "tsv" ? "" : target.resource === "preguntas" ? "Questions" : "Notes";
  const { left: pending, total: toTranslate } = helpsLeft(texts, progress, unit ? "help" : "piece");
  const countKnown = sourceReady && texts.every((text) => progress[text.id]);
  /** Whether the notes or the questions of the passage are worked by pieces: how is said once, over them all. */
  const helpsHint = Boolean(unit) && texts.some((text) => !text.item.intro);
  // A draft nobody has translated a piece of is not a draft yet: there is nothing to hand in.
  const allByPieces = items.length > 0 && items.every((item) => textOf.has(item.id) && (item.secondary === undefined || textOf.has(answerTextId(item.id))));
  const nothingDone = allByPieces && toTranslate > 0 && texts.every((text) => progress[text.id]) && texts.every((text) => progress[text.id]!.done === 0);
  const partLabel = (item: HelpsDraftItem) => (item.part === "title" ? t("he.partTitle") : item.part === "sub-title" ? t("he.partSubtitle") : articles.some((other) => other.part) ? t("he.partBody") : item.label);
  /** The texts worked by pieces, as they follow one another: the title of an article, the line under it, its body. */
  // The references to passages of an article are written by the app, in the language the team translates into.
  const makePiece = useMemo(() => {
    const nameOf = bookNamesIn(ctx?.lang);
    return nameOf ? (piece: string) => localPassages(piece, nameOf) : undefined;
  }, [ctx?.lang]);
  // The examples an article takes from the Bible stories: each is translated from its frame as the team already
  // has it. A story is read once the source is, as the team has it and as the source does, the two together: the
  // source's says which sentences of the frame an example is, to propose the team's. A team with no stories is
  // shown nothing.
  const [stories, setStories] = useState<Record<number, { team: string[]; source: string[] }>>({});
  const quoted = target?.kind === "markdown" && sourceRead ? [...new Set(items.flatMap((item) => storiesIn(sourceHelps[item.id]?.text ?? "")))].join(",") : "";
  useEffect(() => {
    if (!session || !ctx || !quoted) return;
    let alive = true;
    const ours = teamStoriesRepo(ctx);
    const theirs = sourceOwner && sourceLang ? sourceStoriesRepo(sourceOwner, sourceLang) : null;
    for (const story of quoted.split(",").map(Number)) {
      void Promise.all([loadStoryFrames(session, ours.owner, ours.repo, story), theirs ? loadStoryFrames(session, theirs.owner, theirs.repo, story) : Promise.resolve([] as string[])]).then(
        ([team, source]) => alive && team.length && setStories((prev) => (prev[story] ? prev : { ...prev, [story]: { team, source } })),
      );
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoted, session?.token, ctx?.lang, ctx?.contentOrg, sourceOwner, sourceLang]);
  /** The frame of the team's stories that goes with a piece of the source, when it is an example that quotes one. */
  const frameOf = (sourcePiece: string) => {
    const ref = storyRefOf(sourcePiece);
    const story = ref ? stories[ref.story] : undefined;
    const frame = story?.team[ref!.frame - 1];
    return ref && frame ? { ref, frame, sourceFrame: story!.source[ref.frame - 1] ?? "" } : null;
  };
  // Such a piece is made by touching words of the frame: it opens without the keyboard. The pieces of each source are worked
  // out here because a piece is opened by its place, from outside the article («Siguiente» of the one before it).
  const sourcePieces = useMemo(
    () => Object.fromEntries(items.filter((item) => item.kind === "markdown").map((item) => [item.id, (articleRows(sourceHelps[item.id]?.text ?? "", "") ?? []).map((row) => row.source)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceRead, items.length],
  );
  const opensQuiet = (id: string, index: number) => Boolean(frameOf(sourcePieces[id]?.[index] ?? ""));
  const inPieces = texts.map((text) => text.id);
  /** The first piece still to be translated is opened and brought onto the screen: where to go on from. */
  function toFirstPending() {
    const first = texts.find((text) => (progress[text.id]?.firstPending ?? -1) >= 0);
    if (first) pieces.show(first.id, progress[first.id]!.firstPending);
  }

  // What a reviewer said is shown where it is about: with its paragraph in an article or an introduction, with its
  // verse in the notes and the questions (their pieces have no name of their own). The rest (about the whole draft,
  // or about something that is no longer here) goes over the draft.
  const refOfPiece = (text: HelpText, index: number) => (text.item.kind === "markdown" ? pieceRef(text.item.filepath, index) : text.item.intro ? introPieceRef(text.item.chapter, index) : null);
  const commentsOn = (text: HelpText, index: number) => {
    const ref = refOfPiece(text, index);
    return ref ? reviewComments.filter((row) => row.ref === ref) : [];
  };
  const verseOf = (item: HelpsDraftItem) => (item.kind === "tsv" && item.chapter && item.verse ? `${item.chapter}:${item.verse}` : "");
  // Several notes may be of one verse, and a comment names only the verse: it is shown once, with the first of them.
  const firstOfVerse = new Map<string, string>();
  for (const item of items) if (verseOf(item) && !firstOfVerse.has(verseOf(item))) firstOfVerse.set(verseOf(item), item.id);
  const commentsOfVerse = (item: HelpsDraftItem) => (firstOfVerse.get(verseOf(item)) === item.id ? reviewComments.filter((row) => row.ref === verseOf(item)) : []);
  // Until the pieces of the article are known, no comment can be said to be about none of them.
  const placesKnown = countKnown;
  const places = new Set([
    ...firstOfVerse.keys(),
    ...texts.flatMap((text) => Array.from({ length: progress[text.id]?.count ?? 0 }, (_, index) => refOfPiece(text, index)).flatMap((ref) => (ref ? [ref] : []))),
  ]);
  const generalComments = placesKnown ? reviewComments.filter((row) => !places.has(row.ref)) : [];
  const placedComments = placesKnown ? reviewComments.length - generalComments.length : 0;
  /** The first piece somebody commented on, as the draft reads: a paragraph, or the first help of a verse. */
  const firstCommented = (): ActivePiece | null => {
    for (const text of texts) {
      for (let index = 0; index < (progress[text.id]?.count ?? 0); index++) if (commentsOn(text, index).length) return { id: text.id, index };
      if (text.field === "text" && commentsOfVerse(text.item).length) return { id: text.id, index: 0 };
    }
    return null;
  };
  const toFirstComment = () => {
    const piece = firstCommented();
    if (piece) return pieces.show(piece.id, piece.index);
    const first = items.find((item) => commentsOfVerse(item).length);
    if (first) document.getElementById(`help-at-${first.id}`)?.scrollIntoView({ block: "center" });
  };
  const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short" }) : "");
  const commentRow = (row: ReviewComment, withRef = false) => (
    <li key={row.id} className="rv-comment">
      <p className="rv-comment__text">{row.text}</p>
      <p className="rv-comment__meta">{[withRef ? row.ref : "", row.by ? `@${row.by}` : "", when(row.at)].filter(Boolean).join(" · ")}</p>
    </li>
  );

  // Whoever comes in finds a piece already open: where to start, and how it is done. Somebody who was told something
  // about a paragraph comes to correct it, and finds that one; otherwise, the first still to be translated. It is
  // not focused: on a phone that would raise the keyboard over an article nobody has looked at yet.
  useEffect(() => {
    if (autoOpened.current || !sourceReady || !(reviewRead || !session)) return;
    if (!texts.length || texts.some((text) => !progress[text.id])) return;
    autoOpened.current = true;
    // Opened from a comment about a paragraph, or about a verse (the conversation): that one, before any other.
    const ofVerse = ctx?.focus ? texts.find((text) => text.field === "text" && verseOf(text.item) === ctx.focus) : undefined;
    const focused = ctx?.focus
      ? (texts.map((text) => ({ id: text.id, index: Array.from({ length: progress[text.id]?.count ?? 0 }, (_, at) => refOfPiece(text, at)).indexOf(ctx.focus!) })).find((piece) => piece.index >= 0) ??
        (ofVerse ? { id: ofVerse.id, index: 0 } : undefined))
      : undefined;
    const commented = firstCommented();
    const first = texts.find((text) => progress[text.id]!.firstPending >= 0);
    if (focused) pieces.show(focused.id, focused.index);
    else if (commented) pieces.show(commented.id, commented.index);
    else if (first) pieces.show(first.id, progress[first.id]!.firstPending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, view, reviewRead, sourceReady]);

  // Opened from a comment about a verse: the first note or question of that verse is brought into view.
  const verseFocused = useRef(false);
  useEffect(() => {
    if (verseFocused.current || busy || !ctx?.focus) return;
    const first = items.find((item) => verseOf(item) === ctx.focus);
    if (!first) return;
    verseFocused.current = true;
    requestAnimationFrame(() => document.getElementById(`help-at-${first.id}`)?.scrollIntoView({ block: "center" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, busy, ctx?.focus]);

  const sources = useHelpSources(session, (ctx?.book || "").toUpperCase(), range?.chapter ?? 0, Boolean(wantsSources));

  /** A text worked by pieces, tied to the piece that is open on the screen, the way on from it and what is left. */
  const piecesOf = (text: HelpText, extra: Partial<React.ComponentProps<typeof ArticleBlocks>> = {}, key?: string) => (
    <ArticleBlocks
      key={key}
      id={`help-${text.id}`}
      source={text.source}
      value={text.value}
      // A table file keeps the line breaks of a text written out; an article is markdown as it is.
      onChange={(md) => updateItem(text.item.id, text.field === "secondary" ? { secondary: noteToTsv(md) } : { text: text.item.kind === "markdown" ? md : noteToTsv(md) })}
      book={ctx?.book}
      open={active?.id === text.id ? active.index : null}
      onOpen={(index, element) => pieces.open(text.id, index, element, opensQuiet(text.id, index))}
      onProgress={(done, total, firstPending, count, made) => pieces.report(text.id, done, total, firstPending, count, made)}
      hasNext={active?.id === text.id ? Boolean(pieces.after(inPieces, text.id, active.index)) : false}
      onNext={(index) => pieces.next(inPieces, text.id, index, opensQuiet)}
      onDone={pieces.close}
      marksOf={(index) => commentsOn(text, index).length}
      above={(index) => (commentsOn(text, index).length ? <ul className="rv-comments">{commentsOn(text, index).map((row) => commentRow(row))}</ul> : null)}
      {...extra}
    />
  );
  /** The answer of a question that is not worked by pieces: a plain sentence, in a box. */
  const answerBox = (item: HelpsDraftItem) =>
    item.secondaryLabel ? (
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">{loc(item.secondaryLabel)}</span>
        <textarea className="scripture-editor__input" rows={3} value={item.secondary ?? ""} onChange={(e) => updateItem(item.id, { secondary: e.target.value })} placeholder={loc(item.secondaryLabel)} />
      </label>
    ) : null;

  return (
    <div className="scripture-editor fam">
      <ToolHeader
        title={title}
        onBack={onClose}
        meta={[ctx?.stepName ? localizeName(ctx.stepName, language) : "", ctx?.taskName ? localizeName(ctx.taskName, language) : ""].filter(Boolean).join(" · ") || undefined}
      />
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx} />
      </div>

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{loc(error)}</AlertDescription>
        </Alert>
      ) : null}

      {wantsSources && range && !busy ? (
        // What is long and only read (the chapter in the source texts) has its own tab: the work area keeps to the helps.
        <div className="fam-tabs">
          <div className="fam-tabs__set" role="tablist">
            <button type="button" role="tab" className="fam-tab" aria-selected={pane === "edit"} onClick={() => setPane("edit")}>
              {t("hs.tabEdit")}
            </button>
            <button type="button" role="tab" className="fam-tab" aria-selected={pane === "chapter"} onClick={() => setPane("chapter")}>
              {t("hs.tabChapter").replace("{n}", String(range.chapter))}
            </button>
          </div>
          {/* How far along the passage is, in sight wherever its list is scrolled to: the bar at the foot says other things while there is something to save. */}
          {unit && countKnown && toTranslate > 0 ? (
            <span className="fam-tabs__count">{t(`he.count${unit}`).replace("{done}", String(toTranslate - pending)).replace("{total}", String(toTranslate))}</span>
          ) : null}
        </div>
      ) : null}
      {wantsSources && range && !busy ? (
        <div className="fam__body" role="tabpanel" hidden={pane !== "chapter"}>
          <ChapterSources sources={sources} chapter={range.chapter} from={range.from} to={range.to} />
        </div>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">{t("he.loading")}</p>
      ) : (
        // Kept mounted under the other tab, so that what is being written is not lost by going to read.
        <div className="fam__body" role="tabpanel" hidden={wantsSources && pane !== "edit"} ref={pieces.pane}>
          {!session ? (
            <p className="text-sm text-muted-foreground">
              {t("he.offlineHint")}
            </p>
          ) : canUseRows && view === "rows" ? (
            <p className="ab-hint">{t("he.rowsHint")}</p>
          ) : wantsSources && !sourceReady ? null : helpsHint ? (
            <p className="ab-hint">{t(isNotes ? "he.notesHint" : "he.questionsHint")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {articles.length && articles.length === items.length ? t("he.oneArticleWhole") : t("he.oneResource")}{" "}
              {canUseRows ? (
                <button
                  type="button"
                  className="ab-switch"
                  onClick={() => {
                    setView("rows");
                    writePref("taller-article-view", "rows");
                  }}
                >
                  {t("he.editRows")}
                </button>
              ) : null}
            </p>
          )}
          {reviewComments.length && placesKnown ? (
            <div className="he-review">
              {placedComments ? (
                // The comments are with what they are about, down the draft: said here, where the author comes in.
                <button type="button" className="se-review-note" onClick={toFirstComment}>
                  {t(reviewComments.length === 1 ? "se.reviewNoteOne" : "se.reviewNoteMany").replace("{n}", String(reviewComments.length))}
                </button>
              ) : null}
              {/* With nothing over it to say what the list is, the list says so itself. */}
              {generalComments.length && !placedComments ? <p className="pe-hint">{t("se.reviewLede")}</p> : null}
              {generalComments.length ? <ul className="rv-comments">{[...generalComments].reverse().map((row) => commentRow(row, true))}</ul> : null}
            </div>
          ) : null}
          {articles.length && !sourceReady ? <p className="text-sm text-muted-foreground" aria-busy="true">{t("he.sourceLoading")}</p> : null}
          {wantsSources && items.length && !sourceReady ? <p className="text-sm text-muted-foreground" aria-busy="true">{t("he.loading")}</p> : null}
          {items.map((item) => {
            const main = textOf.get(item.id);
            const answer = textOf.get(answerTextId(item.id));
            // The source says how a help is shown (by pieces, or whole in a box): until it is read, none is.
            if (!sourceReady) return null;
            if (item.kind === "markdown" && main)
              // An article reads as one text: its title, the line under it and its body follow one another.
              return piecesOf(
                main,
                {
                  part: item.part,
                  make: makePiece,
                  beside: (row, box) => {
                    const ours = frameOf(row.source);
                    return ours ? (
                      <StoryExample
                        key={row.source}
                        name={t("ab.storyName").replace("{ref}", `${ours.ref.story}:${ours.ref.frame}`)}
                        frame={ours.frame}
                        sourceFrame={ours.sourceFrame}
                        sourcePiece={row.source}
                        // What the article is about, as its title says it in the team's language.
                        terms={termsOf(item.text)}
                        text={box.text}
                        onWrite={box.write}
                        hand={box.hand}
                        onHand={box.setHand}
                        goOn={box.goOn}
                        next={box.next}
                      />
                    ) : null;
                  },
                },
                item.id,
              );
            if (item.intro && main)
              return (
                // An introduction is pages long: it reads as text and is translated a paragraph at a time, as an article.
                <section key={item.id} className="he-intro">
                  <h2 className="he-intro__name">{introName(item)}</h2>
                  {/* Said once: over the notes of the passage when there are any, here when the introduction is all there is. */}
                  {helpsHint ? null : <p className="ab-hint">{t("he.rowsHint")}</p>}
                  {piecesOf(main)}
                </section>
              );
            if (main)
              return (
                // A note or a question reads as the source has it until it is translated; touched, it opens with its
                // source over an empty box. Its verse is said once, over the first help of that verse.
                <div key={item.id} id={`help-at-${item.id}`} className="he-note">
                  {verseOf(item) ? firstOfVerse.get(verseOf(item)) === item.id ? <h2 className="he-note__ref">{verseOf(item)}</h2> : null : <p className="scripture-editor__source">{item.meta}</p>}
                  {commentsOfVerse(item).length ? <ul className="rv-comments">{commentsOfVerse(item).map((row) => commentRow(row))}</ul> : null}
                  {piecesOf(main, {
                    plain: !isNotes,
                    // What the note is about in each source text goes with the note being written: over every note
                    // of a passage it was most of what the screen held.
                    ...(isNotes && item.chapter && item.verse
                      ? { above: () => <NoteQuote sources={sources} book={(ctx?.book || "").toUpperCase()} chapter={item.chapter!} verse={item.verse!} quote={item.quote ?? ""} occurrence={item.occurrence ?? 1} /> }
                      : {}),
                  })}
                  {answer ? (
                    <>
                      <p className="he-note__label">{loc(item.secondaryLabel ?? "")}</p>
                      {piecesOf(answer, { plain: true })}
                    </>
                  ) : (
                    answerBox(item)
                  )}
                </div>
              );
            return (
            <div key={item.id} id={`help-at-${item.id}`} className="scripture-editor__verse">
              <div className="scripture-editor__verse-head">
                {item.kind === "tsv" && item.chapter && item.verse ? (
                  // A note or a question is named by where it is: what it is about is said below, in the source. Its
                  // own text as a title said it twice, and the id of its row says nothing to who translates it.
                  <Label htmlFor={`help-${item.id}`}>{`${item.chapter}:${item.verse}`}</Label>
                ) : (
                  <>
                    <Label htmlFor={`help-${item.id}`}>{item.kind === "markdown" ? partLabel(item) : item.intro ? introName(item) : item.label}</Label>
                    {/* An article is named by its title: the path of its file says nothing to who translates it. */}
                    {item.kind === "tsv" && !item.intro ? <p className="scripture-editor__source">{item.meta}</p> : null}
                  </>
                )}
              </div>
              {commentsOfVerse(item).length ? <ul className="rv-comments">{commentsOfVerse(item).map((row) => commentRow(row))}</ul> : null}
              {isNotes && item.chapter && item.verse ? <NoteQuote sources={sources} book={(ctx?.book || "").toUpperCase()} chapter={item.chapter} verse={item.verse} quote={item.quote ?? ""} occurrence={item.occurrence ?? 1} /> : null}
              {sourceHelps[item.id]?.text ? (
                // What is being translated: the help as the source package has it.
                <details className="hs-source" open={item.kind === "tsv"}>
                  <summary>{t(item.kind === "tsv" ? "hs.sourceHelp" : "hs.sourceArticle").replace("{lang}", sourceLang.toUpperCase())}</summary>
                  <HelpMarkdownView className="af-note af-note--md" content={noteFromTsv(sourceHelps[item.id]!.text)} />
                  {sourceHelps[item.id]!.secondary ? <HelpMarkdownView className="af-note af-note--md" content={noteFromTsv(sourceHelps[item.id]!.secondary!)} /> : null}
                </details>
              ) : null}
              {item.secondaryLabel ? (
                // A question and its answer are plain sentences.
                <textarea
                  id={`help-${item.id}`}
                  className="scripture-editor__input"
                  rows={4}
                  value={item.text}
                  onChange={(e) => updateItem(item.id, { text: e.target.value })}
                  placeholder={t("he.textPlaceholder")}
                />
              ) : (
                <MarkdownEditor
                  id={`help-${item.id}`}
                  rows={item.kind === "markdown" ? 8 : 4}
                  book={ctx?.book}
                  // A note keeps its line breaks written out in its table file; an article is markdown as it is.
                  value={item.kind === "tsv" ? noteFromTsv(item.text) : item.text}
                  onChange={(text) => updateItem(item.id, { text: item.kind === "tsv" ? noteToTsv(text) : text })}
                  placeholder={t("he.textPlaceholder")}
                />
              )}
              {answerBox(item)}
            </div>
            );
          })}
          {canUseRows && view === "rows" ? (
            // For a text that has to be seen whole (to paste one in, to look at its code): the same article in one box.
            <button
              type="button"
              id="help-whole"
              data-slide
              className="ab-switch ab-switch--end"
              onClick={() => {
                setView("whole");
                writePref("taller-article-view", "whole");
              }}
            >
              {t("he.editWhole")}
            </button>
          ) : null}
          {!items.length && !error ? (
            <p className="text-sm text-muted-foreground">
              {t("he.noItems")}
            </p>
          ) : null}
        </div>
      )}

      {/* Saving and handing in sit at the foot, as in the other tools: in the header they left no room for the passage. */}
      {busy ? null : (
        <div className="tool-foot">
          <p>
            {!session
              ? t("he.footOffline")
              : dirty
                  ? t("he.footUnsaved")
                  : pending
                    ? t(`he.footPending${unit}${pending === 1 ? "One" : "Many"}`).replace("{n}", String(pending))
                    : prUrl
                      ? t("he.footInReview")
                      : t("he.footSaved")}
          </p>
          <div className="tool-foot__actions">
            {ctx && !isLabLaunch(ctx) && ctx.stepId && !stepDone ? (
              // The step this editor was opened for is still to be finished: one action does it.
              <>
                {dirty ? (
                  <Button type="button" variant="outline" disabled={saving || finishing || !items.length} onClick={() => void save()}>
                    {saving ? t("se.saving") : t("he.save")}
                  </Button>
                ) : null}
                <Button type="button" disabled={finishing || saving || openingPr || !session || !ctx.issueNumber || !items.length || nothingDone} onClick={() => void finish(pending)}>
                  {finishing ? t("se.finishing") : t("se.finish")}
                </Button>
              </>
            ) : (
              <>
                {ctx && isLabLaunch(ctx) ? null : prUrl ? null : (
                  <Button type="button" variant="outline" disabled={openingPr || !session || !ctx?.issueNumber} onClick={() => void openPr()}>
                    {openingPr ? t("se.opening") : t("se.readyForReview")}
                  </Button>
                )}
                <Button type="button" disabled={saving || !items.length || (!dirty && Boolean(session))} onClick={() => void save()}>
                  {saving ? t("se.saving") : t("he.save")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirming && pending > 0}
        safe
        title={t(`he.pendingTitle${unit}${pending === 1 ? "One" : "Many"}`).replace("{n}", String(pending))}
        text={t("he.pendingText")}
        yes={t("he.finishAnyway")}
        no={t("he.keepTranslating")}
        onYes={() => void finish(pending, true)}
        onNo={() => {
          setConfirming(false);
          toFirstPending();
        }}
        onDismiss={() => setConfirming(false)}
      />
    </div>
  );
}
