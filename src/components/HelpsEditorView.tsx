import { StepAsk } from "./StepAsk";
import { helpsTsvFilename } from "../domain/helpsTarget";
import { ensureHelpsFileFromSource } from "../dcs/bookBootstrap";
import { readRaw } from "../dcs/afinacionLoad";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { bookLabel } from "../domain/books";
import { ChapterSources, NoteQuote, useHelpSources, useSourceHelps } from "./HelpSources";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { ToolHeader } from "./ToolHeader";
import { portionRange } from "../domain/usfmEdit";
import { MarkdownEditor } from "./MarkdownEditor";
import { ArticleBlocks } from "./ArticleBlocks";
import { holdAt, placesOf, reveal, slideFrom } from "./pieceMotion";
import { rowsPossible, startingText } from "../domain/articleBlocks";
import { noteFromTsv, noteToTsv } from "../domain/helpMarkup";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { getContents, getRawContent } from "@ip-lms/dcs-client";
import { loadSession, type GtSession } from "../dcs/auth";
import { dcsConfig } from "../dcs/config";
import { loadPmConfig } from "../dcs/issues";
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
import { portionPrBranchFromCtx } from "../domain/portionPr";
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
/** Put the caret where writing goes on: at the end of what a box holds, or in its empty first line. */
function caretInto(box: HTMLElement): void {
  let target: Node = box;
  while (target.lastChild instanceof HTMLElement && target.lastChild.tagName !== "BR" && target.lastChild.contentEditable !== "false") target = target.lastChild;
  const range = document.createRange();
  range.selectNodeContents(target);
  // An empty piece holds only the line a browser writes on: the caret goes before it, not after.
  range.collapse(!(target.textContent ?? "").trim());
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
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
  const [pane, setPane] = useState<"edit" | "chapter">("edit");
  /** An article is worked piece by piece, each under its source; «todo junto» is the whole text in one box. */
  const [view, setView] = useState<"rows" | "whole">(() => (readPref("taller-article-view") === "whole" ? "whole" : "rows"));
  /** The piece of the article being written: the only one open, with its source over it. */
  const [active, setActive] = useState<{ id: string; index: number } | null>(null);
  /** Whether the first piece still to be translated was already opened for whoever came in. */
  const autoOpened = useRef(false);
  const editPane = useRef<HTMLDivElement | null>(null);
  /** Per article file: how many pieces there are to translate and how many are. */
  const [progress, setProgress] = useState<Record<string, { done: number; total: number; firstPending: number; count: number }>>({});
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
    setActive(null);
    setProgress({});
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
          } else {
            setPrUrl("");
          }
        } catch {
          /* offline / missing issue */
        }
      }
      setBranch(head);

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

  async function save() {
    if (!ctx || !target) return;
    persistLocal(items, branch);
    if (!session) {
      announce(tNow("se.savedLocalAnnounce"));
      return;
    }
    if (isLabLaunch(ctx)) {
      const decision = labWriteDecision(ctx);
      if (decision.mode === "local") {
        announce(loc(decision.reason));
        return;
      }
      if (decision.mode === "blocked") {
        setError(decision.reason);
        return;
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
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  async function openPr() {
    if (!session || !ctx) return;
    setOpeningPr(true);
    setError("");
    try {
      if (dirty) await save();
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
    } catch (err) {
      setError(explainError(err));
    } finally {
      setOpeningPr(false);
    }
  }

  // A note or a question is translated beside the source texts of its chapter; an article is not of one passage.
  const isNotes = target?.resource === "notas";
  const wantsSources = target?.kind === "tsv";
  const range = ctx ? portionRange(ctx.ref, ctx.chapter) : null;
  const { helps: sourceHelps, lang: sourceLang, loaded: sourceRead } = useSourceHelps(session, ctx, target, items);
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
  const byRows = (item: HelpsDraftItem) => view === "rows" && Boolean(sourceHelps[item.id]?.text) && rowsPossible(sourceHelps[item.id]!.text, item.text);
  const canUseRows = articles.some((item) => Boolean(sourceHelps[item.id]?.text) && rowsPossible(sourceHelps[item.id]!.text, item.text));
  const pending = articles.reduce((sum, item) => sum + (byRows(item) && progress[item.id] ? progress[item.id]!.total - progress[item.id]!.done : 0), 0);
  const partLabel = (item: HelpsDraftItem) => (item.part === "title" ? t("he.partTitle") : item.part === "sub-title" ? t("he.partSubtitle") : articles.some((other) => other.part) ? t("he.partBody") : item.label);
  const setProgressOf = useCallback(
    (id: string, done: number, total: number, firstPending: number, count: number) =>
      setProgress((prev) => (prev[id]?.done === done && prev[id]?.total === total && prev[id]?.firstPending === firstPending && prev[id]?.count === count ? prev : { ...prev, [id]: { done, total, firstPending, count } })),
    [],
  );

  // Whoever comes in finds the first piece still to be translated already open: where to start, and how it is done.
  // It is not focused: on a phone that would raise the keyboard over an article nobody has looked at yet.
  useEffect(() => {
    if (autoOpened.current || view !== "rows") return;
    const inRows = articles.filter(byRows);
    if (!inRows.length || inRows.some((item) => !progress[item.id])) return;
    autoOpened.current = true;
    const first = inRows.find((item) => progress[item.id]!.firstPending >= 0);
    if (first) setActive({ id: first.id, index: progress[first.id]!.firstPending });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, view]);

  /** A piece was touched: it opens, the one that was open closes, and the box is ready to be written in. */
  function openPiece(itemId: string, index: number, element: HTMLElement) {
    const pane = editPane.current;
    const top = element.getBoundingClientRect().top;
    const before = pane ? placesOf(pane) : null;
    flushSync(() => setActive({ id: itemId, index }));
    const row = document.getElementById(`help-${itemId}-row-${index}`);
    const box = document.getElementById(`help-${itemId}-${index}`);
    // The piece that closed gave back its room: the one touched stays where the finger is.
    if (row && pane) holdAt(pane, row, top);
    if (box) {
      box.focus({ preventScroll: true });
      caretInto(box);
      if (pane) {
        reveal(pane, box);
        // On a phone the keyboard comes up after this: once it has, the box is brought over it.
        const viewport = window.visualViewport;
        const again = () => document.activeElement === box && reveal(pane, box);
        viewport?.addEventListener("resize", again, { once: true });
        window.setTimeout(() => viewport?.removeEventListener("resize", again), 1500);
      }
    }
    // What could not be kept still (at the top of the article there is nowhere to scroll to) slides instead of jumping.
    if (pane && before) slideFrom(pane, before);
  }

  /** The piece after one, in its own text or in the next text of the article (its title, then its sub-title, then its body). */
  function pieceAfter(itemId: string, index: number): { id: string; index: number } | null {
    if (index + 1 < (progress[itemId]?.count ?? 0)) return { id: itemId, index: index + 1 };
    const inRows = articles.filter(byRows);
    const next = inRows.slice(inRows.findIndex((item) => item.id === itemId) + 1).find((item) => (progress[item.id]?.count ?? 0) > 0);
    return next ? { id: next.id, index: 0 } : null;
  }

  function openNext(itemId: string, index: number) {
    const next = pieceAfter(itemId, index);
    const element = next ? document.getElementById(`help-${next.id}-row-${next.index}`) : null;
    if (next && element) openPiece(next.id, next.index, element);
  }
  const sources = useHelpSources(session, (ctx?.book || "").toUpperCase(), range?.chapter ?? 0, Boolean(wantsSources));

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
        <div className="fam-tabs" role="tablist">
          <button type="button" role="tab" className="fam-tab" aria-selected={pane === "edit"} onClick={() => setPane("edit")}>
            {t("hs.tabEdit")}
          </button>
          <button type="button" role="tab" className="fam-tab" aria-selected={pane === "chapter"} onClick={() => setPane("chapter")}>
            {t("hs.tabChapter").replace("{n}", String(range.chapter))}
          </button>
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
        <div className="fam__body" role="tabpanel" hidden={wantsSources && pane !== "edit"} ref={editPane}>
          {!session ? (
            <p className="text-sm text-muted-foreground">
              {t("he.offlineHint")}
            </p>
          ) : canUseRows && view === "rows" ? (
            <p className="ab-hint">{t("he.rowsHint")}</p>
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
          {articles.length && !sourceReady ? <p className="text-sm text-muted-foreground" aria-busy="true">{t("he.sourceLoading")}</p> : null}
          {items.map((item) =>
            item.kind === "markdown" && !sourceReady ? null : item.kind === "markdown" && byRows(item) ? (
              // An article reads as one text: its title, the line under it and its body follow one another.
              <ArticleBlocks
                key={item.id}
                id={`help-${item.id}`}
                part={item.part}
                source={sourceHelps[item.id]!.text}
                value={item.text}
                onChange={(text) => updateItem(item.id, { text })}
                book={ctx?.book}
                open={active?.id === item.id ? active.index : null}
                onOpen={(index, element) => openPiece(item.id, index, element)}
                onProgress={(done, total, firstPending, count) => setProgressOf(item.id, done, total, firstPending, count)}
                hasNext={active?.id === item.id ? Boolean(pieceAfter(item.id, active.index)) : false}
                onNext={(index) => openNext(item.id, index)}
              />
            ) : (
            <div key={item.id} className="scripture-editor__verse">
              <div className="scripture-editor__verse-head">
                {isNotes && item.chapter && item.verse ? (
                  // A note is named by where it is; what it is about is said in the source texts, below.
                  <Label htmlFor={`help-${item.id}`}>{`${item.chapter}:${item.verse}`}</Label>
                ) : (
                  <>
                    <Label htmlFor={`help-${item.id}`}>{item.kind === "markdown" ? partLabel(item) : item.label}</Label>
                    {/* An article is named by its title: the path of its file says nothing to who translates it. */}
                    {item.kind === "tsv" ? <p className="scripture-editor__source">{item.meta}</p> : null}
                  </>
                )}
              </div>
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
              {item.secondaryLabel ? (
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">{loc(item.secondaryLabel)}</span>
                  <textarea
                    className="scripture-editor__input"
                    rows={3}
                    value={item.secondary ?? ""}
                    onChange={(e) => updateItem(item.id, { secondary: e.target.value })}
                    placeholder={loc(item.secondaryLabel)}
                  />
                </label>
              ) : null}
            </div>
            ),
          )}
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
          <p>{!session ? t("he.footOffline") : dirty ? t("he.footUnsaved") : pending ? t(pending === 1 ? "he.footPendingOne" : "he.footPendingMany").replace("{n}", String(pending)) : prUrl ? t("he.footInReview") : t("he.footSaved")}</p>
          <div className="tool-foot__actions">
            {ctx && isLabLaunch(ctx) ? null : prUrl ? null : (
              <Button type="button" variant="outline" disabled={openingPr || !session || !ctx?.issueNumber} onClick={() => void openPr()}>
                {openingPr ? t("se.opening") : t("se.readyForReview")}
              </Button>
            )}
            <Button type="button" disabled={saving || !items.length || (!dirty && Boolean(session))} onClick={() => void save()}>
              {saving ? t("se.saving") : t("he.save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
