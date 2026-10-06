import { Hints, StepAsk, useItemHints, useVerseDecisions } from "./StepAsk";
import { toolHeading } from "./toolHeading";
import { loadReviewComments, type ReviewComment } from "../dcs/reviewComments";
import { openComments } from "../domain/reviewComments";
import { studyNotesProps } from "./StudyNotesDrawer";
import { StudyNotesPanel } from "./StudyNotesPanel";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { useStepWork } from "../dcs/stepWork";
import { goOnAfterStep } from "../dcs/nextStep";
import { bookLabel } from "../domain/books";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadPmConfig } from "../dcs/issues";
import { applyVerseEditsKeepingAlignment } from "../domain/alignmentKeep";
import {
  closeOwnedPortionPrIfSafe,
  ensurePortionPr,
  getPmIssue,
  resolveVisiblePortionPr,
  saveUsfmOnPortionBranch,
} from "../dcs/portionPr";
import { recordOwnSave } from "../domain/pendingEvents";
import {
  ensureBookUsfm,
  ensureTaskBranchFromBook,
  inspectRecreateBookWorkspace,
  recreateBookWorkspace,
  tryReadExistingBookUsfm,
  type RecreateBookWorkspacePlan,
} from "../dcs/bookBootstrap";
import { BootstrapError, explainRepoFileError } from "../dcs/repoFile";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { resolveScriptureTarget, type ScriptureTarget } from "../domain/scriptureTarget";
import {
  decodeSolverLaunchContext,
  encodeSolverLaunchContext,
  type SolverLaunchContext,
} from "../domain/solverLaunch";
import { isLabLaunch, labWriteDecision, launchDraftSlot } from "../domain/solverLab";
import {
  bookBranchLabel,
  bookBranchName,
  bookOnlyBranchName,
  ownedWorkBranchNames,
  portionPrBranchFromCtx,
  groupDraftBranchNames,
} from "../domain/portionPr";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { loadDraftCache, saveDraftCache } from "../domain/draftCache";
import {
  portionRange,
  skeletonUsfm,
  type RefRange,
} from "../domain/usfmEdit";
import { extractDraftVerses, parseSourceUsfm, type VerseTextMap } from "../domain/usfmAst";
import {
  englishScriptureKindRef,
  loadEnglishQuestionsForRange,
  loadEnglishScriptureChapterUsfm,
  loadEnglishWordsForRange,
  loadNotesForRange,
  looksLikeMarkdown,
  type EnglishScriptureRef,
  type ReferenceHelpRow,
} from "../domain/referenceResources";
import {
  alignedGatewayQuoteForHelpQuote,
  compareHelpQuoteScriptureOrder,
  helpQuoteMatchesWord,
  helpQuoteScriptureOrderKey,
  isOriginalLanguageScript,
  tokenIndicesForHelpQuote,
} from "../domain/helpQuoteMatch";
import type { AlignmentMap } from "@usfm-tools/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Info,
  Link2,
  MoreHorizontal,
  RefreshCw,
  Save,
  Unlink2,
} from "lucide-react";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { UsfmReferencePane, type QuoteHighlight } from "./UsfmReferencePane";
import { cn } from "@/lib/utils";

type ScripturePane = {
  usfm: string;
  verses: VerseTextMap;
  meta: EnglishScriptureRef | null;
  alignments?: AlignmentMap;
  bookCode?: string;
};

import { tNow, useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { localizeName } from "../domain/templateNames";
import { explainError } from "../dcs/userError";

const EMPTY_PANE: ScripturePane = { usfm: "", verses: {}, meta: null };

type Props = {
  ctxEncoded: string;
  onClose: () => void;
  announce: (msg: string) => void;
};

type VerseDraft = { from: number; to: number; text: string };

function slotKey(d: { from: number; to: number }): string {
  return d.from === d.to ? String(d.from) : `${d.from}-${d.to}`;
}

function slotLabel(d: { from: number; to: number }): string {
  return d.from === d.to ? String(d.from) : `${d.from}–${d.to}`;
}

function rowInRange(d: VerseDraft, range: RefRange | null): boolean {
  return Boolean(range && d.from >= range.from && d.to <= range.to);
}

function canJoinRows(cur: VerseDraft, next: VerseDraft, range: RefRange | null): boolean {
  return next.from === cur.to + 1 && rowInRange(cur, range) && rowInRange(next, range);
}

function sameDrafts(a: VerseDraft[], b: VerseDraft[]): boolean {
  return a.length === b.length && a.every((d, i) => slotKey(d) === slotKey(b[i]!) && d.text === b[i]!.text);
}
/** The helps beside the draft. The source texts are no longer a tab: they stay on screen above the helps. */
type ResourceTab = "notas" | "preguntas" | "apuntes" | "revision";
/** Which source text is shown above the helps. */
type SourceView = "both" | "ult" | "ust";
type MobilePanel = "editor" | "recursos";
function bootBranchHint(err: unknown, fallback: string): string {
  if (err instanceof BootstrapError && err.ref) return err.ref;
  if (err instanceof BootstrapError && (err.step === "book-branch" || err.step === "file-create" || err.step === "file-copy")) {
    const match = err.message.match(/«([^»]+)»/);
    if (match) return match[1];
  }
  return fallback;
}

function RecreateActionButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onClick}>
      <RefreshCw className="scripture-editor__action-icon" aria-hidden />
      {t("se.recreateBtn")}
    </Button>
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function RecreatePlanDetails({ plan }: { plan: RecreateBookWorkspacePlan }) {
  const t = useT();
  const work = t("se.recreateWork");
  const why =
    plan.trunkReason === "missing"
      ? t("se.whyMissing")
      : plan.trunkReason === "invalid"
        ? t("se.whyInvalid")
        : t("se.whySkeleton");
  const keep = !plan.willWipeTrunkFile ? (plan.trunkReason === "filled" ? t("se.keepFilled") : t("se.keepOther")) : null;
  return (
    <ul className="scripture-editor__recreate-list">
      <li>{t("se.closePrevReview")}</li>
      <li>
        {plan.willWipeTrunkFile
          ? t("se.alsoRecreate").replace("{work}", work).replace("{why}", why)
          : work}
      </li>
      {keep ? <li>{keep}</li> : null}
    </ul>
  );
}

type WordClickInfo = {
  verse: number;
  wordIndex: number;
  word: string;
  gatewayTokenIndex?: number;
};
type WordFilter = WordClickInfo & { source: "ult" | "ust" };

function helpKindKey(kind: ReferenceHelpRow["kind"]): "se.kindNote" | "se.kindWord" | "se.kindQuestion" {
  if (kind === "nota") return "se.kindNote";
  if (kind === "palabra") return "se.kindWord";
  return "se.kindQuestion";
}

function helpKindRank(kind: ReferenceHelpRow["kind"]): number {
  if (kind === "nota") return 0;
  if (kind === "palabra") return 1;
  return 2;
}

function helpChapter(item: ReferenceHelpRow, range: RefRange | null): number {
  if (item.chapter != null) return item.chapter;
  const match = /^(\d+)\s*:/.exec(item.ref.trim());
  if (match) return Number(match[1]);
  return range?.chapter ?? 0;
}

function firstGatewayTokenIndex(
  item: ReferenceHelpRow,
  ult: ScripturePane,
  ust: ScripturePane,
  range: RefRange | null,
): number | null {
  if (!item.quote?.trim() || !range) return null;
  if (paneHasText(ult)) {
    const idxs = gatewayMatchForHelp(item, ult, range).tokenIndices;
    if (idxs.length) return idxs[0]!;
  }
  if (paneHasText(ust)) {
    const idxs = gatewayMatchForHelp(item, ust, range).tokenIndices;
    if (idxs.length) return idxs[0]!;
  }
  return null;
}

function scriptureOrderKeyForHelp(
  item: ReferenceHelpRow,
  ult: ScripturePane,
  ust: ScripturePane,
  range: RefRange | null,
) {
  return helpQuoteScriptureOrderKey({
    chapter: helpChapter(item, range),
    verse: item.verse,
    hasQuote: Boolean(item.quote?.trim()),
    firstTokenIndex: firstGatewayTokenIndex(item, ult, ust, range),
    occurrence: item.occurrence,
  });
}

function sortHelpByScriptureOrder(
  items: ReferenceHelpRow[],
  ult: ScripturePane,
  ust: ScripturePane,
  range: RefRange | null,
): ReferenceHelpRow[] {
  return [...items].sort((a, b) => {
    const byQuote = compareHelpQuoteScriptureOrder(
      scriptureOrderKeyForHelp(a, ult, ust, range),
      scriptureOrderKeyForHelp(b, ult, ust, range),
    );
    return byQuote || helpKindRank(a.kind) - helpKindRank(b.kind);
  });
}

function HelpKindBadge({ kind }: { kind: ReferenceHelpRow["kind"] }) {
  const t = useT();
  return (
    <Badge variant="outline" className="scripture-editor__help-kind">
      {t(helpKindKey(kind))}
    </Badge>
  );
}

function paneHasText(pane: ScripturePane): boolean {
  return Boolean(pane.usfm.trim() || Object.keys(pane.verses).length);
}

function rangeFromLaunch(decoded: SolverLaunchContext | null): RefRange | null {
  if (!decoded) return null;
  return portionRange(decoded.ref, decoded.chapter);
}

function verseSlots(range: RefRange | null): number[] {
  if (!range) return [];
  const slots: number[] = [];
  for (let v = range.from; v <= range.to; v++) slots.push(v);
  return slots;
}

/** Rows from the cache structure (`"10"` / `"10-11"` keys); gaps from `fallback` or empty. */
function placeholderDrafts(
  range: RefRange | null,
  cache: { verses: Record<string, string> } | null,
  fallback: VerseDraft[] = [],
): VerseDraft[] {
  if (!range) return [];
  const next: VerseDraft[] = [];
  for (const [key, text] of Object.entries(cache?.verses ?? {})) {
    const [from, to = from] = key.split("-").map(Number);
    if (!from || from > range.to || to < range.from) continue;
    if (next.some((d) => d.from <= to && from <= d.to)) continue;
    next.push({ from, to, text });
  }
  for (const row of fallback) {
    if (!next.some((d) => d.from <= row.to && row.from <= d.to)) next.push(row);
  }
  for (let v = range.from; v <= range.to; v++) {
    if (!next.some((d) => d.from <= v && v <= d.to)) next.push({ from: v, to: v, text: "" });
  }
  return next.sort((a, b) => a.from - b.from);
}

function draftReadBranches(
  decoded: SolverLaunchContext,
  cacheBranch: string | undefined,
  username: string,
): Array<string | undefined> {
  const owned = ownedWorkBranchNames({
    book: decoded.book || decoded.projectId || "book",
    username,
    taskId: decoded.taskId,
    issueNumber: decoded.issueNumber,
  });
  return [
    portionPrBranchFromCtx({ ...decoded, username }),
    cacheBranch,
    ...owned,
    ...groupDraftBranchNames(decoded.book, decoded.taskId),
    bookOnlyBranchName(decoded.book),
    undefined,
  ];
}

const SKEL_LINE_WIDTHS = ["92%", "76%", "58%"] as const;

function VerseSkeletonList({ verses }: { verses: number[] }) {
  const slots = verses.length ? verses : [0, 0];
  return (
    <div className="scripture-editor__skel" aria-hidden>
      {slots.map((verse, index) => (
        <div
          key={`${verse}-${index}`}
          className="scripture-editor__verse scripture-editor__verse--skel"
        >
          <div className="scripture-editor__verse-num">
            <span>{verse || "·"}</span>
          </div>
          <div className="scripture-editor__skel-lines">
            {SKEL_LINE_WIDTHS.map((width) => (
              <span key={width} className="scripture-editor__skel-bar" style={{ width }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HelpSkeletonList() {
  return (
    <div className="scripture-editor__skel scripture-editor__skel--help" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className="scripture-editor__skel-help">
          <span className="scripture-editor__skel-bar scripture-editor__skel-bar--chip" />
          <span className="scripture-editor__skel-bar" style={{ width: "88%" }} />
          <span className="scripture-editor__skel-bar" style={{ width: "70%" }} />
        </div>
      ))}
    </div>
  );
}

function emptyPaneFor(kind: "ult" | "ust", book: string): ScripturePane {
  return { ...EMPTY_PANE, meta: englishScriptureKindRef(kind, book), bookCode: book };
}

function paneFromLoaded(
  loaded: { usfm: string; meta: EnglishScriptureRef } | null,
  kind: "ult" | "ust",
  book: string,
  range: RefRange,
): ScripturePane {
  if (!loaded) return emptyPaneFor(kind, book);
  return {
    usfm: loaded.usfm,
    verses: extractDraftVerses(loaded.usfm, range).verses,
    meta: loaded.meta,
    alignments: parseSourceUsfm(loaded.usfm)?.alignments,
    bookCode: book,
  };
}

function helpKey(item: ReferenceHelpRow): string {
  return `${item.kind}-${item.id}`;
}

function isIntroHelpRef(ref: string): boolean {
  return /(?:^|:)intro(?:$|[^a-z])/i.test(ref.trim());
}

/** TW articles and chapter/book intros start folded so the list stays scannable. */
function helpStartsCollapsed(item: ReferenceHelpRow): boolean {
  return item.kind === "palabra" || (item.kind === "nota" && isIntroHelpRef(item.ref));
}

function gatewayMatchForHelp(
  item: ReferenceHelpRow,
  pane: ScripturePane,
  range: RefRange,
) {
  const quote = item.quote?.trim() ?? "";
  if (!quote) return { gatewayText: null as string | null, tokenIndices: [] as number[] };
  const verse = item.verse ?? range.from;
  return alignedGatewayQuoteForHelpQuote({
    verseText: pane.verses[verse] ?? "",
    quote,
    occurrence: item.occurrence ?? 1,
    alignments: pane.alignments,
    book: pane.bookCode || item.ref,
    chapter: item.chapter ?? range.chapter,
    verse,
  });
}

/** ULT English span first; UST if ULT has no alignment hit; never raw Hebrew. */
function displayQuoteForHelp(
  item: ReferenceHelpRow,
  ult: ScripturePane,
  ust: ScripturePane,
  range: RefRange | null,
): string | null {
  const raw = item.quote?.trim() ?? "";
  if (!raw || !range) return null;
  const fromUlt = paneHasText(ult) ? gatewayMatchForHelp(item, ult, range).gatewayText : null;
  const fromUst =
    !fromUlt && paneHasText(ust) ? gatewayMatchForHelp(item, ust, range).gatewayText : null;
  const gateway = fromUlt || fromUst;
  if (gateway && !isOriginalLanguageScript(gateway)) return gateway;
  if (!isOriginalLanguageScript(raw) && !looksLikeMarkdown(raw)) return raw;
  return null;
}

function helpMatchesWordFilter(
  item: ReferenceHelpRow,
  pane: ScripturePane,
  range: RefRange | null,
  filter: WordFilter,
): boolean {
  const quote = item.quote?.trim() ?? "";
  if (!quote || !range) return false;
  const verse = item.verse ?? range.from;
  if (verse !== filter.verse) return false;
  return helpQuoteMatchesWord({
    verseText: pane.verses[verse] ?? "",
    quote,
    occurrence: item.occurrence ?? 1,
    alignments: pane.alignments,
    book: pane.bookCode || item.ref,
    chapter: item.chapter ?? range.chapter,
    verse,
    wordIndex: filter.wordIndex,
    word: filter.word,
    extraTokenIndices: [
      ...(filter.gatewayTokenIndex != null ? [filter.gatewayTokenIndex] : []),
      Math.max(0, filter.wordIndex - 1),
    ],
  });
}

function highlightForHelp(
  item: ReferenceHelpRow | null,
  pane: ScripturePane,
  range: RefRange | null,
  active: boolean,
): QuoteHighlight | null {
  if (!item?.quote?.trim() || !range) return null;
  const verse = item.verse ?? range.from;
  const tokenIndices = tokenIndicesForHelpQuote({
    verseText: pane.verses[verse] ?? "",
    quote: item.quote,
    occurrence: item.occurrence ?? 1,
    alignments: pane.alignments,
    book: pane.bookCode || item.ref,
    chapter: item.chapter ?? range.chapter,
    verse,
  });
  if (!tokenIndices.length) return null;
  return { verse, tokenIndices, active };
}

function ScriptureTab({
  title,
  range,
  pane,
  activeVerse,
  loggedIn,
  loading,
  highlight,
  onWordClick,
}: {
  title: string;
  range: RefRange | null;
  pane: ScripturePane;
  activeVerse?: number;
  loggedIn: boolean;
  loading?: boolean;
  highlight?: QuoteHighlight | null;
  onWordClick?: (info: WordClickInfo) => void;
}) {
  const t = useT();
  return (
    <div className="scripture-editor__tab-body" aria-busy={loading || undefined}>
      {loading ? (
        <VerseSkeletonList verses={verseSlots(range)} />
      ) : paneHasText(pane) && range ? (
        <UsfmReferencePane
          usfm={pane.usfm}
          range={range}
          label={pane.meta?.label || title}
          activeVerse={activeVerse}
          fallbackVerses={pane.verses}
          highlight={highlight}
          onWordClick={onWordClick}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {loggedIn
            ? t("se.loadFailed").replace("{what}", pane.meta?.short || title)
            : t("se.loginForRefs")}
        </p>
      )}
    </div>
  );
}

function HelpQuote({
  quote,
  origTooltip,
  compact,
  onActivate,
}: {
  quote: string;
  origTooltip?: string;
  compact?: boolean;
  onActivate?: () => void;
}) {
  return (
    <p
      className={cn(
        "scripture-editor__help-quote",
        compact && "scripture-editor__help-quote--head",
      )}
      title={origTooltip}
      dir="ltr"
      onClick={(event) => {
        if (!onActivate) return;
        event.stopPropagation();
        onActivate();
      }}
    >
      <span className="scripture-editor__help-quote-mark">“</span>
      {quote}
      <span className="scripture-editor__help-quote-mark">”</span>
    </p>
  );
}

function HelpItem({
  item,
  displayQuotes,
  active,
  onHover,
  onActivate,
}: {
  item: ReferenceHelpRow;
  displayQuotes: Map<string, string>;
  active: boolean;
  onHover?: (item: ReferenceHelpRow | null) => void;
  onActivate?: (item: ReferenceHelpRow) => void;
}) {
  const t = useT();
  const key = helpKey(item);
  const collapsible = helpStartsCollapsed(item);
  const [open, setOpen] = useState(!collapsible);
  const rawQuote = item.quote?.trim() ?? "";
  const quote = displayQuotes.get(key) ?? "";
  const title = item.title.trim();
  const showQuote = Boolean(quote);
  const origTooltip =
    rawQuote && rawQuote !== quote && isOriginalLanguageScript(rawQuote)
      ? rawQuote
      : undefined;
  const showTitle = Boolean(
    title &&
      title !== rawQuote &&
      title !== quote &&
      !looksLikeMarkdown(title) &&
      !isOriginalLanguageScript(title) &&
      !item.body.includes(`# ${title}`),
  );
  const headerLabel = showQuote ? quote : title || item.ref;
  const canActivate = Boolean(rawQuote || quote);

  function toggleOpen() {
    setOpen((prev) => !prev);
  }

  function activate() {
    onActivate?.(item);
  }

  return (
    <li
      className={cn(
        "scripture-editor__help-item",
        collapsible && "scripture-editor__help-item--fold",
        collapsible && !open && "scripture-editor__help-item--collapsed",
      )}
      data-kind={item.kind}
      data-active={active || undefined}
      data-open={collapsible ? (open ? "true" : "false") : undefined}
      tabIndex={!collapsible && canActivate ? 0 : undefined}
      onMouseEnter={() => onHover?.(item)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={!collapsible ? activate : undefined}
      onClick={!collapsible ? activate : undefined}
      onKeyDown={
        !collapsible
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate();
              }
            }
          : undefined
      }
    >
      {collapsible ? (
        <div className="scripture-editor__help-head">
          <button
            type="button"
            className="scripture-editor__help-fold"
            aria-expanded={open}
            aria-label={open ? t("se.hide") : t("se.show")}
            onClick={(event) => {
              event.stopPropagation();
              toggleOpen();
            }}
          >
            <ChevronDown
              className={cn(
                "scripture-editor__help-chevron",
                !open && "scripture-editor__help-chevron--collapsed",
              )}
              aria-hidden
            />
          </button>
          <div
            className="scripture-editor__help-head-main"
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={toggleOpen}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleOpen();
              }
            }}
          >
            <HelpKindBadge kind={item.kind} />
            {item.ref ? (
              <span className="scripture-editor__help-ref">{item.ref}</span>
            ) : null}
            {showQuote ? (
              <HelpQuote
                quote={quote}
                origTooltip={origTooltip}
                compact
                onActivate={activate}
              />
            ) : headerLabel ? (
              <span className="scripture-editor__help-head-title">{headerLabel}</span>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="scripture-editor__help-meta">
            <HelpKindBadge kind={item.kind} />
            {item.ref ? (
              <span className="text-xs text-muted-foreground">{item.ref}</span>
            ) : null}
          </div>
          {showQuote ? (
            <HelpQuote quote={quote} origTooltip={origTooltip} onActivate={activate} />
          ) : null}
          {showTitle ? <p className="scripture-editor__help-title">{title}</p> : null}
        </>
      )}
      {open && showTitle && collapsible && showQuote ? (
        <p className="scripture-editor__help-title">{title}</p>
      ) : null}
      {open && item.body ? <HelpMarkdownView content={item.body} /> : null}
    </li>
  );
}

function HelpList({
  items,
  displayQuotes,
  activeId,
  onHover,
  onActivate,
}: {
  items: ReferenceHelpRow[];
  displayQuotes: Map<string, string>;
  activeId?: string | null;
  onHover?: (item: ReferenceHelpRow | null) => void;
  onActivate?: (item: ReferenceHelpRow) => void;
}) {
  return (
    <ul className="scripture-editor__help-list">
      {items.map((item) => {
        const key = helpKey(item);
        return (
          <HelpItem
            key={key}
            item={item}
            displayQuotes={displayQuotes}
            active={activeId === key}
            onHover={onHover}
            onActivate={onActivate}
          />
        );
      })}
    </ul>
  );
}

function HelpBlock({
  title,
  items,
  displayQuotes,
  loggedIn,
  failed,
  loading,
  loginHint,
  emptyHint,
  errorHint,
  activeId,
  onHover,
  onActivate,
}: {
  title: string;
  items: ReferenceHelpRow[];
  displayQuotes: Map<string, string>;
  loggedIn: boolean;
  failed: boolean;
  loading?: boolean;
  loginHint: string;
  emptyHint: string;
  errorHint: string;
  activeId?: string | null;
  onHover?: (item: ReferenceHelpRow | null) => void;
  onActivate?: (item: ReferenceHelpRow) => void;
}) {
  let hint = emptyHint;
  if (!loggedIn) hint = loginHint;
  else if (failed) hint = errorHint;
  return (
    <section className="scripture-editor__help-section" aria-busy={loading || undefined}>
      <h2 className="scripture-editor__ref-title">{title}</h2>
      {loading && !items.length ? (
        <HelpSkeletonList />
      ) : items.length ? (
        <HelpList
          items={items}
          displayQuotes={displayQuotes}
          activeId={activeId}
          onHover={onHover}
          onActivate={onActivate}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{hint}</p>
      )}
    </section>
  );
}

export function ScriptureEditorView({ ctxEncoded, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const loc = (text: string) => localizeThread(text, language);
  const [session, setSession] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(() =>
    decodeSolverLaunchContext(ctxEncoded),
  );
  const [range, setRange] = useState<RefRange | null>(() =>
    rangeFromLaunch(decodeSolverLaunchContext(ctxEncoded)),
  );
  const [drafts, setDrafts] = useState<VerseDraft[]>(() => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    const slot = decoded ? launchDraftSlot(decoded) : null;
    return placeholderDrafts(
      rangeFromLaunch(decoded),
      slot ? loadDraftCache(slot.pmOrg, slot.issueNumber) : null,
    );
  });
  const [usfm, setUsfm] = useState("");
  const [sha, setSha] = useState<string | undefined>();
  const [targetLabel, setTargetLabel] = useState("");
  const [branch, setBranch] = useState("");
  const [targetRepo, setTargetRepo] = useState<{ owner: string; repo: string } | null>(null);
  const [prUrl, setPrUrl] = useState("");
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [ult, setUlt] = useState<ScripturePane>(EMPTY_PANE);
  const [ust, setUst] = useState<ScripturePane>(EMPTY_PANE);
  const [notes, setNotes] = useState<ReferenceHelpRow[]>([]);
  const [words, setWords] = useState<ReferenceHelpRow[]>([]);
  const [questions, setQuestions] = useState<ReferenceHelpRow[]>([]);
  const [notesFailed, setNotesFailed] = useState(false);
  const [wordsFailed, setWordsFailed] = useState(false);
  const [questionsFailed, setQuestionsFailed] = useState(false);
  const [studyNoteCount, setStudyNoteCount] = useState(0);
  const [resourceTab, setResourceTab] = useState<ResourceTab>("notas");
  const [sourceView, setSourceView] = useState<SourceView>("both");
  /** Show the source of the whole passage instead of only the verse being written. */
  const [wholeSource, setWholeSource] = useState(false);
  /** Show only the helps of the verse being written; off = the whole passage. */
  const [onlyVerse, setOnlyVerse] = useState(true);
  const [stepDone, setStepDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  /** Counts edits, so that a save that ends while the person kept typing does not call the draft saved. */
  const editCount = useRef(0);
  const [hoveredHelp, setHoveredHelp] = useState<ReferenceHelpRow | null>(null);
  const [activeHelp, setActiveHelp] = useState<ReferenceHelpRow | null>(null);
  const [wordFilter, setWordFilter] = useState<WordFilter | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("editor");
  const [draftVia, setDraftVia] = useState<"ast" | "plain">("plain");
  const [activeVerse, setActiveVerse] = useState<number | undefined>();
  // What the verse in hand calls for by its own words, among what the step and the team ask.
  const hintsFor = useItemHints(session, ctx);
  // The English text this draft is translated from: its alignment with the original is what a decision of the
  // glossary is found by.
  const english = ctx?.resource === "tps" ? ust : ult;
  const decisionsAt = useVerseDecisions(session, ctx, english.alignments);
  const [draftLoading, setDraftLoading] = useState(() => Boolean(loadSession()));
  const [ultLoading, setUltLoading] = useState(() => Boolean(loadSession()));
  const [ustLoading, setUstLoading] = useState(() => Boolean(loadSession()));
  const [notesLoading, setNotesLoading] = useState(() => Boolean(loadSession()));
  const [wordsLoading, setWordsLoading] = useState(() => Boolean(loadSession()));
  const [questionsLoading, setQuestionsLoading] = useState(() => Boolean(loadSession()));
  const [saving, setSaving] = useState(false);
  const [openingPr, setOpeningPr] = useState(false);
  const [error, setError] = useState("");
  const [createdNew, setCreatedNew] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [loadStuck, setLoadStuck] = useState(false);
  const [recreateOpen, setRecreateOpen] = useState(false);
  const [recreatePlan, setRecreatePlan] = useState<RecreateBookWorkspacePlan | null>(null);
  const [recreatePlanError, setRecreatePlanError] = useState("");
  const [recreating, setRecreating] = useState(false);
  const loadGen = useRef(0);
  const recreateInspectGen = useRef(0);
  const usfmSource = useRef<"none" | "remote" | "boot">("none");
  const editedVerses = useRef<Set<string>>(new Set());
  const announcedCache = useRef(false);
  const [bootPending, setBootPending] = useState(false);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    const stillThisLoad = () => gen === loadGen.current;
    const stopRefLoading = () => {
      setUltLoading(false);
      setUstLoading(false);
      setNotesLoading(false);
      setWordsLoading(false);
      setQuestionsLoading(false);
    };
    const stopAllLoading = () => {
      setDraftLoading(false);
      setBootPending(false);
      stopRefLoading();
      setLoadStuck(false);
    };
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError(tNow("se.badContext"));
      stopAllLoading();
      return;
    }
    setCtx(decoded);
    setWordFilter(null);
    const refRange = rangeFromLaunch(decoded);
    if (!refRange) {
      setError(tNow("se.badRef").replace("{ref}", decoded.ref));
      stopAllLoading();
      return;
    }
    setRange(refRange);

    const sess = loadSession();
    setSession(sess);
    const slot = launchDraftSlot(decoded);
    const cache = loadDraftCache(slot.pmOrg, slot.issueNumber);
    const lab = isLabLaunch(decoded);
    const write = labWriteDecision(decoded);
    const fallbackBranch = portionPrBranchFromCtx({
      ...decoded,
      username: decoded.username || sess?.username || "",
    });

    if (!sess?.token) {
      setDrafts(placeholderDrafts(refRange, cache));
      setBranch(cache?.branch || fallbackBranch);
      setUlt(emptyPaneFor("ult", decoded.book));
      setUst(emptyPaneFor("ust", decoded.book));
      setNotes([]);
      setWords([]);
      setQuestions([]);
      setNotesFailed(false);
      setWordsFailed(false);
      setQuestionsFailed(false);
      setDirty(Boolean(cache));
      setError(tNow("se.noSession"));
      stopAllLoading();
      return;
    }

    usfmSource.current = "none";
    editedVerses.current = new Set();
    announcedCache.current = false;
    setDraftLoading(true);
    setBootPending(false);
    setUltLoading(true);
    setUstLoading(true);
    setNotesLoading(true);
    setWordsLoading(true);
    setQuestionsLoading(true);
    setLoadStuck(false);
    setError("");
    setDirty(false);
    setDrafts(placeholderDrafts(refRange, cache));
    setBranch(cache?.branch || fallbackBranch);
    setUlt(emptyPaneFor("ult", decoded.book));
    setUst(emptyPaneFor("ust", decoded.book));
    setNotes([]);
    setWords([]);
    setQuestions([]);
    setNotesFailed(false);
    setWordsFailed(false);
    setQuestionsFailed(false);

    void loadEnglishScriptureChapterUsfm(sess, "ult", decoded.book, refRange.chapter)
      .then((loaded) => {
        if (!stillThisLoad()) return;
        setUlt(paneFromLoaded(loaded, "ult", decoded.book, refRange));
      })
      .catch(() => {
        if (!stillThisLoad()) return;
        setUlt(emptyPaneFor("ult", decoded.book));
      })
      .finally(() => {
        if (stillThisLoad()) setUltLoading(false);
      });

    void loadEnglishScriptureChapterUsfm(sess, "ust", decoded.book, refRange.chapter)
      .then((loaded) => {
        if (!stillThisLoad()) return;
        setUst(paneFromLoaded(loaded, "ust", decoded.book, refRange));
      })
      .catch(() => {
        if (!stillThisLoad()) return;
        setUst(emptyPaneFor("ust", decoded.book));
      })
      .finally(() => {
        if (stillThisLoad()) setUstLoading(false);
      });

    void loadEnglishQuestionsForRange(sess, decoded, refRange)
      .then((result) => {
        if (!stillThisLoad()) return;
        setQuestions(result.items);
        setQuestionsFailed(result.failed);
      })
      .catch(() => {
        if (!stillThisLoad()) return;
        setQuestions([]);
        setQuestionsFailed(true);
      })
      .finally(() => {
        if (stillThisLoad()) setQuestionsLoading(false);
      });

    void loadEnglishWordsForRange(sess, decoded, refRange)
      .then((result) => {
        if (!stillThisLoad()) return;
        setWords(result.items);
        setWordsFailed(result.failed);
      })
      .catch(() => {
        if (!stillThisLoad()) return;
        setWords([]);
        setWordsFailed(true);
      })
      .finally(() => {
        if (stillThisLoad()) setWordsLoading(false);
      });

    const applyFetchedUsfm = (
      text: string,
      fileSha: string | undefined,
      head: string | undefined,
      source: "remote" | "boot",
      createdFile = false,
    ) => {
      if (!stillThisLoad()) return;
      if (source === "boot" && usfmSource.current === "remote") {
        if (head) setBranch(head);
        if (fileSha) setSha(fileSha);
        setCreatedNew(false);
        return;
      }
      usfmSource.current = source;
      setUsfm(text);
      setSha(fileSha);
      if (head) setBranch(head);
      setCreatedNew(createdFile);
      const extracted = extractDraftVerses(text, refRange);
      setDraftVia(extracted.via);
      const remote = extracted.slots;
      const cached =
        cache && Object.keys(cache.verses).length
          ? placeholderDrafts(refRange, cache, remote)
          : null;
      const usedCache = Boolean(cached && !sameDrafts(cached, remote));
      const chosen = usedCache && cached ? cached : remote;
      setDrafts((prev) => {
        if (!editedVerses.current.size) return chosen;
        return prev.map((d) => {
          const key = slotKey(d);
          if (editedVerses.current.has(key)) return d;
          const hit = chosen.find((s) => slotKey(s) === key);
          return hit ? { ...d, text: hit.text } : d;
        });
      });
      if (usedCache) {
        setDirty(true);
        if (!announcedCache.current) {
          announcedCache.current = true;
          announce(tNow("se.restored"));
        }
      } else if (!editedVerses.current.size) {
        setDirty(false);
        if (extracted.via === "plain" && source === "remote") {
          announce(tNow("se.plainEditor"));
        }
      }
    };

    const readExisting = (target: ScriptureTarget, extraBranches: Array<string | undefined> = []) =>
      tryReadExistingBookUsfm({
        session: sess,
        owner: target.owner,
        repo: target.repo,
        filepath: target.filepath,
        branches: [
          ...extraBranches,
          ...draftReadBranches(decoded, cache?.branch, decoded.username || sess.username),
        ],
      }).then((found) => {
        if (!stillThisLoad()) return found;
        if (!found) {
          const hasCache = Object.values(cache?.verses ?? {}).some((text) => text.trim());
          if (hasCache && usfmSource.current === "none" && !editedVerses.current.size) {
            setDirty(true);
            if (!announcedCache.current) {
              announcedCache.current = true;
              announce(tNow("se.restored"));
            }
          }
          return found;
        }
        applyFetchedUsfm(found.text, found.sha, found.branch, "remote");
        return found;
      });

    const speculative = resolveScriptureTarget(decoded, DEFAULT_PM_CONFIG);
    if (!("error" in speculative)) {
      setTargetLabel(`${speculative.owner}/${speculative.repo}/${speculative.filepath}`);
      setTargetRepo({ owner: speculative.owner, repo: speculative.repo });
      void readExisting(speculative).finally(() => {
        if (stillThisLoad()) setDraftLoading(false);
      });
    } else {
      setDraftLoading(false);
    }

    const bootstrapWorkspace = (target: ScriptureTarget, head: string) => {
      setBootPending(true);
      void (async () => {
        try {
          const boot = await ensureBookUsfm({
            session: sess,
            owner: target.owner,
            repo: target.repo,
            filepath: target.filepath,
            book: target.book,
            resource: target.resource,
            taskId: decoded.taskId,
            phaseSlug: decoded.phaseSlug,
            fallbackRange: refRange,
          });
          if (!stillThisLoad()) return;
          const task = await ensureTaskBranchFromBook({
            session: sess,
            owner: target.owner,
            repo: target.repo,
            book: target.book,
            resource: target.resource,
            taskId: decoded.taskId,
            phaseSlug: decoded.phaseSlug,
            filepath: target.filepath,
            taskBranch: head,
            username: decoded.username || sess.username,
            issueNumber: decoded.issueNumber,
          });
          if (!stillThisLoad()) return;
          setBranch(task.workBranch);
          applyFetchedUsfm(boot.usfm, boot.sha, task.workBranch, "boot", boot.createdFile);
        } catch (err) {
          if (stillThisLoad() && usfmSource.current === "none") {
            setError(
              explainRepoFileError(err, {
                owner: target.owner,
                repo: target.repo,
                filepath: target.filepath,
                branch: bootBranchHint(err, head),
                creating: true,
              }),
            );
          }
        } finally {
          if (stillThisLoad()) {
            setBootPending(false);
            setLoadStuck(false);
          }
        }
      })();
    };

    try {
      let pmConfig = DEFAULT_PM_CONFIG;
      if (decoded.pmOrg) {
        try {
          pmConfig = await loadPmConfig(sess, decoded.pmOrg);
        } catch {
          pmConfig = DEFAULT_PM_CONFIG;
        }
      }
      if (!stillThisLoad()) return;

      void loadNotesForRange(sess, decoded, refRange, pmConfig)
        .then((notesLoaded) => {
          if (!stillThisLoad()) return;
          if (notesLoaded) {
            setNotes(notesLoaded.notes);
            setNotesFailed(false);
          } else {
            setNotes([]);
            setNotesFailed(true);
          }
        })
        .catch(() => {
          if (!stillThisLoad()) return;
          setNotes([]);
          setNotesFailed(true);
        })
        .finally(() => {
          if (stillThisLoad()) setNotesLoading(false);
        });

      const target = resolveScriptureTarget(decoded, pmConfig);
      if ("error" in target) {
        if (lab) {
          applyFetchedUsfm(
            skeletonUsfm(decoded.book, refRange.chapter, refRange.from, refRange.to),
            undefined,
            fallbackBranch,
            "boot",
            false,
          );
          if (stillThisLoad()) {
            setDraftLoading(false);
            setBootPending(false);
            setNotesLoading(false);
          }
          return;
        }
        if (stillThisLoad()) setError(target.error);
        return;
      }
      setTargetLabel(`${target.owner}/${target.repo}/${target.filepath}`);
      setTargetRepo({ owner: target.owner, repo: target.repo });

      if (
        "error" in speculative ||
        speculative.owner !== target.owner ||
        speculative.repo !== target.repo ||
        speculative.filepath !== target.filepath
      ) {
        void readExisting(target).finally(() => {
          if (stillThisLoad()) setDraftLoading(false);
        });
      }

      let head = cache?.branch || fallbackBranch;
      if (!lab && decoded.issueNumber > 0 && decoded.pmOrg) {
        void (async () => {
          try {
            const issue = await getPmIssue(sess, decoded.pmOrg, decoded.issueNumber);
            const visible = await resolveVisiblePortionPr({
              session: sess,
              pmOrg: decoded.pmOrg,
              issue,
              workBranch: fallbackBranch,
              username: decoded.username || sess.username,
              book: target.book,
              taskId: decoded.taskId,
            });
            if (!stillThisLoad()) return;
            if (visible.marker) {
              head = visible.marker.head;
              setPrUrl(visible.marker.htmlUrl);
              // What the reviewers said is shown next to the draft: the author corrects with it in view.
              // Only what is still open: a comment given as resolved, and the author's own answers, ask nothing more.
              const owner = decoded.username || sess.username;
              void loadReviewComments(sess, visible.marker, owner)
                .then((all) => {
                  if (!stillThisLoad()) return;
                  const rows = openComments(all, owner);
                  setReviewComments(rows);
                  if (rows.length) setResourceTab("revision");
                })
                .catch(() => undefined);
              setBranch(head);
              await readExisting(target, [head]);
            } else {
              setPrUrl("");
            }
          } catch {
            /* issue may be unavailable offline */
          }
        })();
      }

      if (write.mode === "dcs") {
        bootstrapWorkspace(target, head);
      } else if (usfmSource.current === "none") {
        applyFetchedUsfm(
          skeletonUsfm(target.book, refRange.chapter, refRange.from, refRange.to),
          undefined,
          head,
          "boot",
          false,
        );
        if (lab && stillThisLoad()) {
          setError("");
        }
      }
    } catch (err) {
      if (stillThisLoad()) {
        setError(explainError(err));
        setNotesLoading(false);
        setDraftLoading(false);
        setBootPending(false);
      }
    }
  }, [ctxEncoded, announce]);

  // ULT/UST are GETs of existing Door43 files. Draft USFM often does not
  // exist yet: ensureBookUsfm/ensureTaskBranchFromBook create the group draft and the work branch
  // with sequential writes. The editor paints empty (or cached) verses at
  // once and GETs any existing 16-*.usfm in parallel; bootstrap stays in
  // the background so Guardar can still create the real branch/file.
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const next = decodeSolverLaunchContext(ctxEncoded);
    setCtx(next);
    setRange(rangeFromLaunch(next));
  }, [ctxEncoded]);

  useEffect(() => {
    if (!draftLoading && !recreating && !bootPending) {
      setLoadStuck(false);
      return;
    }
    // On a real server the helps beside the draft take well over eight seconds; offering to redo a draft that is
    // already on screen reads as if something had gone wrong.
    const timer = window.setTimeout(() => setLoadStuck(true), 25000);
    return () => window.clearTimeout(timer);
  }, [draftLoading, recreating, bootPending]);

  const title = useMemo(() => {
    if (!ctx) return t("se.draft");
    const res = ctx.resourceName || (ctx.resource || "tpl").toUpperCase();
    return `${bookLabel(ctx.book, language)} ${ctx.ref} · ${res}`;
  }, [ctx, language]);
  const written = drafts.filter((d) => d.text.trim()).length;
  // How far the draft is, for the card of its subtarea and for whoever coordinates.
  useStepWork(session, ctx, written, drafts.length, { on: !draftLoading && !stepDone && !finishing });
  // The source shown follows the verse being written (a bridge shows all its verses); with none in hand, the passage.
  const activeRow = drafts.find((d) => d.from === activeVerse);
  const sourceRange = range && activeVerse && !wholeSource ? { chapter: range.chapter, from: activeVerse, to: activeRow?.to ?? activeVerse } : range;
  /** The same passage in the study tool, without the step: reading it again completes nothing. */
  const studyHref = ctx && !isLabLaunch(ctx) ? `#/solver/familiarize?ctx=${encodeURIComponent(encodeSolverLaunchContext({ ...ctx, stepId: undefined, stepName: undefined }))}` : "";

  const lab = Boolean(ctx && isLabLaunch(ctx));
  const write = ctx ? labWriteDecision(ctx) : null;
  const draftUrl =
    session && targetRepo && branch && !lab
      ? `${session.host.replace(/\/$/, "")}/${targetRepo.owner}/${targetRepo.repo}/src/branch/${branch
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`
      : "";
  const hasGitDetails = Boolean(targetLabel || branch || ctx?.taskName || ctx?.issueNumber || createdNew || lab);
  const canRecreate = Boolean(
    session?.token && ctx && (!lab || write?.mode === "dcs"),
  );
  const showDetails = hasGitDetails || canRecreate;
  const loggedIn = Boolean(session);
  const resourceCode = ctx?.resourceName || (ctx?.resource || "tpl").toUpperCase();
  const labLocal = lab && write?.mode !== "dcs";
  const saveState: { tone: "busy" | "dirty" | "saved" | "idle"; text: string } =
    recreating
      ? { tone: "busy", text: t("se.recreating") }
      : draftLoading
        ? { tone: "busy", text: t("se.loadingDraft") }
        : saving
          ? { tone: "busy", text: t("se.saving") }
          : dirty
            ? { tone: "dirty", text: t("se.unsaved") }
            : !session
              ? { tone: "idle", text: t("se.onlyHere") }
              : savedOnce
                ? { tone: "saved", text: labLocal ? t("se.savedHere") : t("se.saved") }
                : { tone: "idle", text: t("se.noChanges") };
  const labNote = !lab
    ? ""
    : write?.mode === "dcs"
      ? t("se.labDcs")
      : write?.mode === "blocked"
        ? loc(write.reason)
        : t("se.labLocal");
  const focusedHelp = activeHelp ?? hoveredHelp;
  const pinned = Boolean(activeHelp && focusedHelp && activeHelp.id === focusedHelp.id);
  // Both source texts are on screen, so the phrase a help is about is marked in each.
  const ultHighlight = highlightForHelp(focusedHelp, ult, range, pinned);
  const ustHighlight = highlightForHelp(focusedHelp, ust, range, pinned);
  const activeHelpKey = activeHelp ? helpKey(activeHelp) : null;
  const displayQuotes = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of [...notes, ...words, ...questions]) {
      const text = displayQuoteForHelp(item, ult, ust, range);
      if (text) map.set(helpKey(item), text);
    }
    return map;
  }, [notes, words, questions, ult, ust, range]);
  const filterPane = wordFilter?.source === "ust" ? ust : ult;
  const mixedHelps = useMemo(() => {
    const notesShown = wordFilter
      ? notes.filter((item) => helpMatchesWordFilter(item, filterPane, range, wordFilter))
      : notes;
    const wordsShown = wordFilter
      ? words.filter((item) => helpMatchesWordFilter(item, filterPane, range, wordFilter))
      : words;
    return sortHelpByScriptureOrder([...notesShown, ...wordsShown], ult, ust, range);
  }, [notes, words, wordFilter, filterPane, range, ult, ust]);
  /** The helps of the verse in hand (a help of no verse, like a chapter note, is of every verse). */
  const ofVerse = <T extends ReferenceHelpRow>(items: T[]): T[] => (onlyVerse && activeVerse && !wordFilter ? items.filter((item) => !item.verse || item.verse === activeVerse) : items);
  const shownHelps = ofVerse(mixedHelps);
  const shownQuestions = ofVerse(questions);

  function activateHelp(item: ReferenceHelpRow) {
    setActiveHelp(item);
    setActiveVerse(item.verse);
  }

  function selectHelpFromWord(info: WordClickInfo, source: "ult" | "ust") {
    const pane = source === "ust" ? ust : ult;
    const next: WordFilter = { ...info, source };
    const matches = [...notes, ...words].filter((item) =>
      helpMatchesWordFilter(item, pane, range, next),
    );
    setWordFilter(next);
    setActiveVerse(info.verse);
    setResourceTab("notas");
    setMobilePanel("recursos");
    setActiveHelp(matches[0] ?? null);
  }

  function clearWordFilter() {
    setWordFilter(null);
  }

  function persistLocal(nextDrafts: VerseDraft[], nextBranch: string) {
    if (!ctx) return;
    const verses: Record<string, string> = {};
    for (const d of nextDrafts) verses[slotKey(d)] = d.text;
    const slot = launchDraftSlot(ctx);
    saveDraftCache(slot.pmOrg, slot.issueNumber, {
      verses,
      savedAt: Date.now(),
      branch: nextBranch,
    });
  }

  function updateVerse(key: string, text: string) {
    editCount.current += 1;
    editedVerses.current.add(key);
    setDrafts((prev) => {
      const next = prev.map((d) => (slotKey(d) === key ? { ...d, text } : d));
      persistLocal(next, branch);
      return next;
    });
    setDirty(true);
  }

  function replaceRows(index: number, count: number, rows: VerseDraft[]) {
    editCount.current += 1;
    for (const row of rows) editedVerses.current.add(slotKey(row));
    const next = [...drafts.slice(0, index), ...rows, ...drafts.slice(index + count)];
    setDrafts(next);
    persistLocal(next, branch);
    setDirty(true);
  }

  function joinWithNext(index: number) {
    const cur = drafts[index];
    const next = drafts[index + 1];
    if (!cur || !next || !canJoinRows(cur, next, range)) return;
    const text = [cur.text.trim(), next.text.trim()].filter(Boolean).join(" ");
    replaceRows(index, 2, [{ from: cur.from, to: next.to, text }]);
  }

  function splitRow(index: number) {
    const cur = drafts[index];
    if (!cur || cur.to <= cur.from || !rowInRange(cur, range)) return;
    const rows: VerseDraft[] = [];
    for (let v = cur.from; v <= cur.to; v++) {
      rows.push({ from: v, to: v, text: v === cur.from ? cur.text : "" });
    }
    replaceRows(index, 1, rows);
    announce(t("se.splitAnnounce").replace("{a}", String(cur.from)).replace("{b}", String(cur.to)));
  }

  /** `quiet`: a save the app does by itself while the person writes says nothing; the state beside the title does. */
  async function save(quiet = false): Promise<boolean> {
    if (!ctx || !range) return false;
    const editsAtStart = editCount.current;
    persistLocal(drafts, branch);
    if (!session) {
      if (!quiet) announce(t("se.savedLocalAnnounce"));
      return false;
    }
    if (isLabLaunch(ctx)) {
      const decision = labWriteDecision(ctx);
      if (decision.mode === "local") {
        setDirty(false);
        setSavedOnce(true);
        if (!quiet) announce(t("se.savedLocalAnnounce"));
        return true;
      }
      if (decision.mode === "blocked") {
        setError(decision.reason);
        return false;
      }
    }
    const pmConfig = ctx.pmOrg
      ? await loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG)
      : DEFAULT_PM_CONFIG;
    const target = resolveScriptureTarget(ctx, pmConfig);
    if ("error" in target) {
      setError(target.error);
      return false;
    }
    const head = branch || portionPrBranchFromCtx(ctx);
    setSaving(true);
    setError("");
    try {
      // Saving text must not erase the word alignment of the words that did not change.
      const kept = applyVerseEditsKeepingAlignment(
        usfm || skeletonUsfm(target.book, range.chapter, range.from, range.to),
        range.chapter,
        drafts,
      );
      const nextUsfm = kept.usfm;
      if (kept.clearedVerses.length && !quiet) {
        announce(t("se.alignmentLost").replace("{list}", kept.clearedVerses.join(", ")));
      }
      const message = `TAS: ${target.book} ${ctx.ref} (${ctx.resource || "tpl"}) · #${ctx.issueNumber || "—"}`;
      const saved = await saveUsfmOnPortionBranch({
        session,
        owner: target.owner,
        repo: target.repo,
        filepath: target.filepath,
        content: nextUsfm,
        message,
        branch: head,
        sha,
        book: target.book,
        resource: target.resource,
        taskId: ctx.taskId,
        phaseSlug: ctx.phaseSlug,
        username: ctx.username || session.username,
        issueNumber: ctx.issueNumber,
      });
      recordOwnSave(
        { host: session.host, username: session.username, pmOrg: ctx.pmOrg },
        ctx.issueNumber,
        message,
        saved.commitSha,
      );
      setUsfm(nextUsfm);
      setSha(saved.sha ?? sha);
      setBranch(saved.branch || head);
      setCreatedNew(false);
      // What was written while this save was on its way is still to be saved.
      if (editCount.current === editsAtStart) setDirty(false);
      setSavedOnce(true);
      persistLocal(drafts, saved.branch || head);
      if (!quiet) announce(t("se.savedIn").replace("{where}", `${target.owner}/${target.repo} @ ${saved.branch || head}`));
      return true;
    } catch (err) {
      setError(
        explainRepoFileError(err, {
          owner: target.owner,
          repo: target.repo,
          filepath: target.filepath,
          branch: err instanceof BootstrapError && err.ref ? err.ref : head,
          creating: !sha,
        }),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  // The draft saves itself a moment after the person stops writing. Nothing is lost by closing the screen.
  useEffect(() => {
    if (!dirty || saving || recreating || openingPr || finishing || !session || !ctx || !drafts.length) return;
    const timer = window.setTimeout(() => void save(true), 3500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, drafts, recreating, openingPr, finishing]);

  // Whether the step this editor was opened for is already completed: «Terminé» is then not offered again.
  useEffect(() => {
    if (!session || !ctx?.stepId || !ctx.issueNumber || lab) return;
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
   * one action. Before, these were three (save, «Listo para revisión», and «Terminé» back in the list).
   */
  async function finish() {
    if (!session || !ctx?.stepId || !ctx.issueNumber) return;
    setFinishing(true);
    setError("");
    try {
      if (dirty && !(await save(true))) return;
      const opened = await openReview();
      if (!opened) return;
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      announce(t("se.finished"));
      await goOnAfterStep(session, ctx, onClose);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setFinishing(false);
    }
  }

  /** «Listo para revisión»: what is not saved yet is saved first. */
  async function openPr(): Promise<boolean> {
    if (dirty) await save(true);
    return openReview();
  }

  /**
   * Opens the review of what is saved in Door43. It does not save: whoever calls it has. Saving here too made
   * «Terminé el borrador» save twice, the second time with what this screen knew of the file before the first.
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
        throw new Error(t("se.noPlan"));
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
          ? t("se.reviewOpened")
          : t("se.reviewWasOpen"),
      );
      return true;
    } catch (err) {
      setError(explainError(err));
      return false;
    } finally {
      setOpeningPr(false);
    }
  }

  async function buildRecreateParams() {
    if (!session || !ctx) return null;
    const pmConfig = await loadPmConfig(session, ctx.pmOrg);
    const target = resolveScriptureTarget(ctx, pmConfig);
    if ("error" in target) {
      setError(target.error);
      return null;
    }
    const workBranch = portionPrBranchFromCtx(ctx);
    return {
      session,
      owner: target.owner,
      repo: target.repo,
      filepath: target.filepath,
      book: target.book,
      resource: target.resource,
      taskId: ctx.taskId,
      phaseSlug: ctx.phaseSlug,
      fallbackRange: range || undefined,
      workBranch,
      username: ctx.username || session.username,
      issueNumber: ctx.issueNumber,
      extraWorkBranches: branch && branch !== workBranch ? [branch] : [],
      createdFileThisSession: createdNew,
      closeOwnedPr: () =>
        closeOwnedPortionPrIfSafe({
          session,
          pmOrg: ctx.pmOrg,
          issueNumber: ctx.issueNumber,
          owner: target.owner,
          repo: target.repo,
          workBranch,
          bookBranch: bookBranchName(target.book, ctx.taskId),
          username: ctx.username || session.username,
          book: target.book,
          taskId: ctx.taskId,
        }),
    };
  }

  async function openRecreateDialog() {
    if (!session || !ctx) return;
    const inspectGen = ++recreateInspectGen.current;
    setRecreateOpen(true);
    setRecreatePlan(null);
    setRecreatePlanError("");
    let params: Awaited<ReturnType<typeof buildRecreateParams>> = null;
    try {
      params = await buildRecreateParams();
      if (!params) {
        if (inspectGen === recreateInspectGen.current) {
          setRecreatePlanError(t("se.noTarget"));
        }
        return;
      }
      const plan = await withTimeout(
        inspectRecreateBookWorkspace(params),
        12000,
        t("se.timeout"),
      );
      if (inspectGen === recreateInspectGen.current) setRecreatePlan(plan);
    } catch (err) {
      if (inspectGen !== recreateInspectGen.current) return;
      setRecreatePlanError(
        explainRepoFileError(err, {
          owner: params?.owner || ctx.contentOrg,
          repo: params?.repo || "",
          filepath: params?.filepath || "—",
          branch: err instanceof BootstrapError && err.ref
            ? err.ref
            : params?.workBranch || portionPrBranchFromCtx(ctx),
        }),
      );
    }
  }

  async function confirmRecreate() {
    if (!session || !ctx) return;
    loadGen.current += 1;
    setRecreating(true);
    setDraftLoading(true);
    setBootPending(false);
    usfmSource.current = "none";
    editedVerses.current = new Set();
    setDrafts([]);
    setLoadStuck(false);
    setError("");
    setDirty(false);
    let params: Awaited<ReturnType<typeof buildRecreateParams>> = null;
    try {
      params = await buildRecreateParams();
      if (!params) {
        setDraftLoading(false);
        return;
      }
      const result = await recreateBookWorkspace(params);
      setBranch(result.workBranch);
      setCreatedNew(result.createdFile);
      setPrUrl("");
      setRecreateOpen(false);
      setRecreatePlan(null);
      announce(
        result.reusedTrunk
          ? t("se.recreatedKeep")
          : t("se.recreatedFile"),
      );
      await load();
    } catch (err) {
      setDraftLoading(false);
      setError(
        explainRepoFileError(err, {
          owner: params?.owner || ctx.contentOrg,
          repo: params?.repo || "",
          filepath: params?.filepath || "—",
          branch: err instanceof BootstrapError && err.ref
            ? err.ref
            : params?.workBranch || portionPrBranchFromCtx(ctx),
          creating: true,
        }),
      );
    } finally {
      setRecreating(false);
    }
  }

  return (
    <div className="scripture-editor scripture-editor--split" data-panel={mobilePanel}>
      <header className="scripture-editor__head">
        <div className="scripture-editor__head-main min-w-0">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="scripture-editor__icon-btn scripture-editor__back"
            aria-label={t("se.close")}
            onClick={onClose}
          >
            <ChevronLeft className="scripture-editor__back-icon" aria-hidden />
            <span className="scripture-editor__action-label">{t("se.close")}</span>
          </Button>
          <span className="scripture-editor__head-rule" aria-hidden />
          {/* The same name as the other tools: the passage, and under it the step and the task. */}
          <div className="th-name">
            <h1>{toolHeading(ctx, language, title).title}</h1>
            {toolHeading(ctx, language, title).where ? <p>{toolHeading(ctx, language, title).where}</p> : null}
          </div>
          {lab ? (
            <Badge variant="outline" className="scripture-editor__status">
              {t("se.lab")}
            </Badge>
          ) : null}
        </div>
        <div className="scripture-editor__actions">
          {showDetails ? (
            <details className="scripture-editor__details">
              <summary
                className="scripture-editor__details-toggle"
                title={t("se.details")}
                aria-label={t("se.details")}
              >
                <MoreHorizontal className="scripture-editor__details-icon" aria-hidden />
              </summary>
              <div className="scripture-editor__details-panel">
                {ctx?.taskName || ctx?.issueNumber ? (
                  <p className="scripture-editor__details-row">
                    <span className="scripture-editor__details-key">{t("se.task")}</span>
                    <span>
                      {ctx?.taskName ? localizeName(ctx.taskName, language) : t("se.translateDefault")}
                      {ctx?.issueNumber ? ` · #${ctx.issueNumber}` : ""}
                    </span>
                  </p>
                ) : null}
                {createdNew ? (
                  <p className="scripture-editor__details-row">
                    <span className="scripture-editor__details-key">{t("se.status")}</span>
                    <span>{t("se.fileCreated")}</span>
                  </p>
                ) : null}
                {targetLabel ? (
                  <p className="scripture-editor__details-row">
                    <span className="scripture-editor__details-key">{t("se.file")}</span>
                    <span className="scripture-editor__details-mono">{targetLabel}</span>
                  </p>
                ) : null}
                {lab ? (
                  <p className="scripture-editor__details-row">
                    <span className="scripture-editor__details-key">{t("se.savedKey")}</span>
                    <span>
                      {write?.mode === "dcs"
                        ? t("se.labCanSave")
                        : loc(write?.reason || "") || t("se.labLocalDraft")}
                    </span>
                  </p>
                ) : null}
                {ctx?.book ? (
                  <p className="scripture-editor__details-row">
                    <span className="scripture-editor__details-key">{t("se.phase")}</span>
                    <span>{bookBranchLabel(ctx.book, ctx.phaseName)}</span>
                  </p>
                ) : null}
                {draftUrl ? (
                  <p className="scripture-editor__details-row">
                    <span className="scripture-editor__details-key">{t("se.yourDraft")}</span>
                    <a href={draftUrl} target="_blank" rel="noopener noreferrer">
                      {t("se.openDoor43")}
                    </a>
                  </p>
                ) : null}
                {!lab && ctx && range ? (
                  // On a phone the header has no room for these two: they are here.
                  <p className="scripture-editor__details-row se-details-links">
                    <a href={`#/glosario?libro=${encodeURIComponent(ctx.book)}&c=${range.chapter}&de=${range.from}&a=${range.to}${ctx.resource === "tps" ? "&texto=tps" : ""}`} target="_blank" rel="noreferrer">
                      {t("gl.open")}
                    </a>
                    {studyHref ? (
                      <a href={studyHref} target="_blank" rel="noreferrer">
                        {t("se.study")}
                      </a>
                    ) : null}
                  </p>
                ) : null}
                {canRecreate ? (
                  <div className="scripture-editor__details-actions">
                    <RecreateActionButton
                      disabled={recreating}
                      onClick={() => void openRecreateDialog()}
                    />
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
          {!lab && ctx && range ? (
            // In another tab, so the draft in hand stays as it is.
            <a className="scripture-editor__glossary" href={`#/glosario?libro=${encodeURIComponent(ctx.book)}&c=${range.chapter}&de=${range.from}&a=${range.to}${ctx.resource === "tps" ? "&texto=tps" : ""}`} target="_blank" rel="noreferrer">
              {t("gl.open")}
            </a>
          ) : null}
          {studyHref ? (
            <a className="scripture-editor__glossary" href={studyHref} target="_blank" rel="noreferrer">
              {t("se.study")}
            </a>
          ) : null}
          <p className="scripture-editor__save-state se-head-state" data-tone={saveState.tone} role="status">
            <span className="scripture-editor__save-dot" aria-hidden />
            {saveState.text}
          </p>
          {dirty || !session ? (
            <Button type="button" size="sm" variant="ghost" className="scripture-editor__icon-btn" aria-label={saving ? t("se.savingAria") : t("se.save")} disabled={recreating || saving || !drafts.length} onClick={() => void save()}>
              <Save className="scripture-editor__action-icon" aria-hidden />
              <span className="scripture-editor__action-label">{saving ? t("se.saving") : t("se.save")}</span>
            </Button>
          ) : null}
          {lab ? null : ctx?.stepId && !stepDone ? (
            <Button type="button" size="sm" className="scripture-editor__save" disabled={recreating || finishing || openingPr || saving || !session || !ctx.issueNumber || !written} onClick={() => void finish()}>
              <Check className="scripture-editor__action-icon" aria-hidden />
              <span className="se-finish-label">{finishing ? t("se.finishing") : t("se.finish")}</span>
              <span className="se-finish-short">{finishing ? "…" : t("se.finishShort")}</span>
            </Button>
          ) : prUrl ? (
            <Button type="button" size="sm" variant="outline" className="scripture-editor__icon-btn" aria-label={t("se.openDoor43")} onClick={() => window.open(prUrl, "_blank", "noopener,noreferrer")}>
              <ExternalLink className="scripture-editor__action-icon" aria-hidden />
              <span className="scripture-editor__action-label">{t("se.openDoor43")}</span>
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" className="scripture-editor__icon-btn" aria-label={openingPr ? t("se.openingReview") : t("se.readyForReview")} disabled={recreating || openingPr || !session || !ctx?.issueNumber} onClick={() => void openPr()}>
              <Check className="scripture-editor__action-icon" aria-hidden />
              <span className="scripture-editor__action-label">{openingPr ? t("se.opening") : t("se.readyForReview")}</span>
            </Button>
          )}
        </div>
      </header>
      {lab ? null : (
        <div className="step-ask-bar">
          <StepAsk session={session} ctx={ctx} />
        </div>
      )}

      {error ? (
        <Alert variant="destructive" className="scripture-editor__alert">
          <AlertDescription>
            <p>{loc(error)}</p>
            {canRecreate ? (
              <div className="scripture-editor__alert-actions">
                <RecreateActionButton
                  disabled={recreating}
                  onClick={() => void openRecreateDialog()}
                />
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : canRecreate && loadStuck ? (
        <Alert className="scripture-editor__alert scripture-editor__alert--quiet">
          <AlertDescription>
            <p>{t("se.stuck")}</p>
            <div className="scripture-editor__alert-actions">
              <RecreateActionButton
                disabled={recreating}
                onClick={() => void openRecreateDialog()}
              />
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="scripture-editor__workspace">
        <aside className="scripture-editor__refs" aria-label={t("se.refsAria")}>
          <div className="se-sources">
            <div className="se-sources__head">
              <span className="se-sources__title">
                {activeVerse && range && !wholeSource ? t("se.sourceOfVerse").replace("{ref}", `${range.chapter}:${activeVerse}`) : t("se.source")}
                {activeVerse && range ? (
                  <button type="button" className="se-sources__whole" onClick={() => setWholeSource(!wholeSource)}>
                    {t(wholeSource ? "se.sourceVerseOnly" : "se.sourceWhole")}
                  </button>
                ) : null}
              </span>
              <div className="pe-seg se-sources__seg" role="radiogroup" aria-label={t("se.sourceWhich")}>
                {(["both", "ult", "ust"] as const).map((id) => (
                  <button key={id} type="button" role="radio" aria-checked={sourceView === id} className="pe-seg__opt" onClick={() => setSourceView(id)}>
                    {id === "both" ? t("se.sourceBoth") : id === "ult" ? "ULT" : "UST"}
                  </button>
                ))}
              </div>
            </div>
            <div className="se-sources__texts" data-view={sourceView}>
              {sourceView !== "ust" ? (
                <div className="se-source">
                  <p className="se-source__name">{t("se.literal")}</p>
                  <ScriptureTab title={t("se.ultEnglish")} range={sourceRange} pane={ult} activeVerse={activeVerse} loggedIn={loggedIn} loading={ultLoading} highlight={ultHighlight} onWordClick={(info) => selectHelpFromWord(info, "ult")} />
                </div>
              ) : null}
              {sourceView !== "ult" ? (
                <div className="se-source">
                  <p className="se-source__name">{t("se.simple")}</p>
                  <ScriptureTab title={t("se.ustEnglish")} range={sourceRange} pane={ust} activeVerse={activeVerse} loggedIn={loggedIn} loading={ustLoading} highlight={ustHighlight} onWordClick={(info) => selectHelpFromWord(info, "ust")} />
                </div>
              ) : null}
            </div>
          </div>
          <Tabs
            value={resourceTab}
            onValueChange={(value) => setResourceTab(value as ResourceTab)}
            className="scripture-editor__ref-tabs se-helps"
          >
            <TabsList className="scripture-editor__ref-tablist">
              <TabsTrigger value="notas">
                <span className="scripture-editor__tab-full">{t("se.tabNotesFull")}</span>
                <span className="scripture-editor__tab-short">{t("se.tabNotesShort")}</span>
                {shownHelps.length ? <span className="scripture-editor__tab-count">{shownHelps.length}</span> : null}
              </TabsTrigger>
              <TabsTrigger value="preguntas">
                <span className="scripture-editor__tab-full">{t("se.tabQuestionsFull")}</span>
                <span className="scripture-editor__tab-short">{t("se.tabQuestionsShort")}</span>
                {shownQuestions.length ? <span className="scripture-editor__tab-count">{shownQuestions.length}</span> : null}
              </TabsTrigger>
              {reviewComments.length ? (
                <TabsTrigger value="revision">
                  {t("se.tabReview")}
                  <span className="scripture-editor__tab-count">{reviewComments.length}</span>
                </TabsTrigger>
              ) : null}
              {session && ctx?.projectId && ctx.pmOrg && range ? (
                <TabsTrigger value="apuntes">
                  {t("sn.tab")}
                  {studyNoteCount ? <span className="scripture-editor__tab-count">{studyNoteCount}</span> : null}
                </TabsTrigger>
              ) : null}
            </TabsList>
            {activeVerse && range && resourceTab !== "apuntes" && resourceTab !== "revision" && !wordFilter ? (
              <label className="se-only">
                <input type="checkbox" checked={onlyVerse} onChange={(e) => setOnlyVerse(e.target.checked)} />
                <span>{t("se.onlyVerse").replace("{ref}", `${range.chapter}:${activeVerse}`)}</span>
              </label>
            ) : null}
            <TabsContent value="revision" className="scripture-editor__tab-pane">
              <p className="pe-hint">{t("se.reviewLede")}</p>
              <ul className="rv-comments">
                {[...reviewComments].reverse().map((row) => (
                  <li key={row.id} className="rv-comment">
                    <p className="rv-comment__text">{row.text}</p>
                    <p className="rv-comment__meta">{[row.ref, row.by ? `@${row.by}` : "", row.at ? new Date(row.at).toLocaleDateString(language, { day: "numeric", month: "short" }) : ""].filter(Boolean).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            </TabsContent>
            {session && ctx?.projectId && ctx.pmOrg && range ? (
              // Kept mounted so that its count shows on the tab before it is opened.
              <div role="tabpanel" hidden={resourceTab !== "apuntes"} className="scripture-editor__tab-pane">
                <StudyNotesPanel session={session} {...studyNotesProps(ctx, language)} onCount={setStudyNoteCount} />
              </div>
            ) : null}
            <TabsContent value="notas" className="scripture-editor__tab-pane">
              {wordFilter ? (
                <div className="scripture-editor__help-filter">
                  <p className="scripture-editor__help-filter-label">
                    {wordFilter.word
                      ? t("se.filteredBy").replace("{w}", wordFilter.word)
                      : t("se.filteredBySel")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={clearWordFilter}
                  >
                    {t("se.seeAll")}
                  </Button>
                </div>
              ) : null}
              <HelpBlock
                title={t("se.notesAndWords")}
                items={shownHelps}
                displayQuotes={displayQuotes}
                loggedIn={loggedIn}
                failed={notesFailed && wordsFailed}
                loading={notesLoading || wordsLoading}
                loginHint={t("se.loginNotes")}
                emptyHint={
                  wordFilter
                    ? t("se.noMatchNotes")
                    : t("se.noNotes")
                }
                errorHint={t("se.notesError")}
                activeId={activeHelpKey}
                onHover={setHoveredHelp}
                onActivate={activateHelp}
              />
            </TabsContent>
            <TabsContent value="preguntas" className="scripture-editor__tab-pane">
              <HelpBlock
                title={t("se.questions")}
                items={shownQuestions}
                displayQuotes={displayQuotes}
                loggedIn={loggedIn}
                failed={questionsFailed}
                loading={questionsLoading}
                loginHint={t("se.loginQuestions")}
                emptyHint={t("se.noQuestions")}
                errorHint={t("se.questionsError")}
                activeId={activeHelpKey}
                onHover={setHoveredHelp}
                onActivate={activateHelp}
              />
            </TabsContent>
          </Tabs>
        </aside>

        <section
          className="scripture-editor__draft"
          aria-label={t("se.draftAria")}
          aria-busy={draftLoading || recreating || undefined}
        >
          <div className="scripture-editor__draft-head">
            <p className="scripture-editor__eyebrow">{t("se.yourDraftRes").replace("{res}", resourceCode)}</p>
            {drafts.length ? <p className="se-written">{t("se.written").replace("{n}", String(written)).replace("{total}", String(drafts.length))}</p> : null}
          </div>
          {reviewComments.length && !stepDone ? (
            // On a phone the comments are behind «Recursos»: said here, where the author is writing.
            <button
              type="button"
              className="se-review-note"
              onClick={() => {
                setResourceTab("revision");
                setMobilePanel("recursos");
              }}
            >
              {t(reviewComments.length === 1 ? "se.reviewNoteOne" : "se.reviewNoteMany").replace("{n}", String(reviewComments.length))}
            </button>
          ) : null}
          {labNote ? (
            <p className="scripture-editor__lab-note">
              <Info className="scripture-editor__lab-icon" aria-hidden />
              <span>{labNote}</span>
            </p>
          ) : null}
          {!drafts.length ? (
            <VerseSkeletonList verses={verseSlots(range)} />
          ) : (
            <div className="scripture-editor__verses">
              {drafts.map((d, index) => {
                const key = slotKey(d);
                const label = slotLabel(d);
                const next = drafts[index + 1];
                const inside = rowInRange(d, range);
                const joinable = Boolean(next && canJoinRows(d, next, range));
                const row = (
                  <div
                    key={key}
                    className="scripture-editor__verse"
                    data-active={activeVerse === d.from || undefined}
                  >
                    <div className="scripture-editor__verse-num">
                      <label
                        htmlFor={`v-${key}`}
                        title={range ? `${range.chapter}:${label}` : label}
                      >
                        {label}
                      </label>
                    </div>
                    <div className="scripture-editor__verse-body">
                      {activeVerse === d.from && (ult.verses[d.from] || ust.verses[d.from]) ? (
                        // On a phone the source texts are on another panel: the verse being written brings its own.
                        <div className="se-peek">
                          {ult.verses[d.from] ? (
                            <p>
                              <b>ULT</b> {ult.verses[d.from]}
                            </p>
                          ) : null}
                          {ust.verses[d.from] ? (
                            <p>
                              <b>UST</b> {ust.verses[d.from]}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {/* What this verse calls for by its own words («you»: one person or several), while it is the one being
                          written. First what the glossary decided about them: it answers before the reminders ask. */}
                      {activeVerse === d.from ? <Hints lead={t("sa.mind")} lines={[...decisionsAt(range?.chapter, d.from, english.verses[d.from]), ...hintsFor(english.verses[d.from])]} /> : null}
                      <textarea
                        id={`v-${key}`}
                        className="scripture-editor__input"
                        rows={3}
                        value={d.text}
                        onFocus={() => setActiveVerse(d.from)}
                        onChange={(e) => updateVerse(key, e.target.value)}
                        placeholder={t("se.translationPlaceholder")}
                        disabled={recreating}
                      />
                      {!inside ? (
                        <p className="scripture-editor__verse-note">
                          {t("se.bridgeOutside")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
                const splittable = inside && d.to > d.from;
                if (!joinable && !splittable) return row;
                return (
                  <Fragment key={key}>
                    {row}
                    <div
                      className="scripture-editor__seam"
                      data-last={!next || undefined}
                    >
                      {splittable ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          className="scripture-editor__seam-btn scripture-editor__seam-btn--split"
                          disabled={recreating}
                          title={t("se.splitTitle").replace("{l}", label.replace("–", "-"))}
                          onClick={() => splitRow(index)}
                        >
                          <Unlink2 aria-hidden />
                          <span>{t("se.splitLabel").replace("{l}", label)}</span>
                        </Button>
                      ) : null}
                      {joinable && next ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          className="scripture-editor__seam-btn scripture-editor__seam-btn--join"
                          disabled={recreating}
                          title={t("se.joinTitle").replace("{a}", String(d.from)).replace("{b}", String(next.to))}
                          onClick={() => joinWithNext(index)}
                        >
                          <Link2 aria-hidden />
                          <span>
                            {t("se.joinLabel").replace("{a}", label).replace("{b}", slotLabel(next))}
                          </span>
                        </Button>
                      ) : null}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          )}
          {!draftLoading && !drafts.length && !error ? (
            <p className="text-sm text-muted-foreground">{t("se.noVerses")}</p>
          ) : null}
          {!session ? (
            <p className="scripture-editor__hint">
              {t("se.offlineHint")}
            </p>
          ) : null}
          {draftVia === "plain" && usfm.trim() && drafts.length ? (
            <p className="scripture-editor__hint">
              {t("se.plainHint")}
            </p>
          ) : null}
        </section>
      </div>

      <div
        className="scripture-editor__panel-toggle"
        role="tablist"
        aria-label={t("se.panelAria")}
      >
        <button
          type="button"
          role="tab"
          className="scripture-editor__panel-btn"
          data-active={mobilePanel === "editor"}
          aria-selected={mobilePanel === "editor"}
          onClick={() => setMobilePanel("editor")}
        >
          {t("se.panelEditor")}
        </button>
        <button
          type="button"
          role="tab"
          className="scripture-editor__panel-btn"
          data-active={mobilePanel === "recursos"}
          aria-selected={mobilePanel === "recursos"}
          onClick={() => setMobilePanel("recursos")}
        >
          {t("se.panelResources")}
        </button>
      </div>

      <Dialog
        open={recreateOpen}
        onOpenChange={(open) => {
          if (recreating) return;
          setRecreateOpen(open);
          if (!open) {
            recreateInspectGen.current += 1;
            setRecreatePlan(null);
            setRecreatePlanError("");
          }
        }}
      >
        <DialogContent className="max-w-md" showCloseButton={!recreating}>
          <DialogHeader>
            <DialogTitle>{t("se.recreateTitle")}</DialogTitle>
            <DialogDescription>
              {t("se.recreateDesc")}
            </DialogDescription>
          </DialogHeader>
          {recreatePlanError ? (
            <Alert variant="destructive">
              <AlertDescription>{loc(recreatePlanError)}</AlertDescription>
            </Alert>
          ) : recreatePlan ? (
            <RecreatePlanDetails plan={recreatePlan} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("se.checkingDraft")}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={recreating}
              onClick={() => setRecreateOpen(false)}
            >
              {t("se.cancel")}
            </Button>
            <Button
              type="button"
              disabled={recreating || (!recreatePlan && !recreatePlanError)}
              onClick={() => void confirmRecreate()}
            >
              {recreating ? t("se.recreateBusy") : t("se.recreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
