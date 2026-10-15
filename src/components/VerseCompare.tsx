import { useEffect, useState } from "react";
import { BookOpen, ListTree } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { chapterTextOf, draftTaskId, groupDraftBranches, loadChapterTexts, type ChapterText, type OriginalWord } from "../dcs/afinacionLoad";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChapterReader } from "./ChapterReader";
import { bookLabel } from "../domain/books";
import { useUiLanguage } from "../i18n/language";
import { tryReadExistingBookUsfm } from "../dcs/bookBootstrap";
import type { AlignedTextRef } from "../dcs/alignedWords";
import { bookUsfmName } from "../prep/discover";
import { loadOriginalWords } from "../dcs/syntaxTree";
import { tallerConfig, workspaceOfOrg } from "../config";
import { resolveScriptureTarget } from "../domain/scriptureTarget";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import type { AssignmentsDoc } from "../domain/types";
import { useT } from "../i18n/messages";
import { OriginalWords } from "./OriginalWords";
import { ParallelLink } from "./ParallelSheet";
import { SentenceSheet } from "./SentenceSheet";
import { WordSheet } from "./WordSheet";

type Texts = { rows: ChapterText[]; other: string };

/**
 * The verse of a proposal in the texts it is weighed against: the original (each word opens its meaning, and from
 * there how the sentence is built), the literal and the simple English, and the team's other text (the TPS for a
 * change to the TPL). A proposal read alone was judged against the wording it changes, and the reason it gives
 * could not be checked where it was read.
 */
export function VerseCompare({ session, ctx, board, chapter, verse }: { session: GtSession; ctx: SolverLaunchContext; board: AssignmentsDoc; chapter: number; verse: number }) {
  const t = useT();
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  const proposed = (ctx.resource || "").toLowerCase() === "tps" ? "tps" : "tpl";
  const other = proposed === "tps" ? "tpl" : "tps";
  const [texts, setTexts] = useState<Texts | null | undefined>(undefined);
  const [words, setWords] = useState<Record<string, OriginalWord[]>>({});
  const [tab, setTab] = useState<string>("orig");
  const [sheet, setSheet] = useState<{ word: OriginalWord; chapter: number; verse: number; inDiagram?: boolean } | null>(null);
  const [sentence, setSentence] = useState(false);
  const workspace = workspaceOfOrg(tallerConfig, ctx.pmOrg);
  // Under each word of the diagram: how the text being decided says it, or its English where it is not aligned.
  const [aligned, setAligned] = useState<AlignedTextRef[] | undefined>(undefined);
  // The text being decided, whole, for the chapter: read once where the diagram looks for its words.
  const [own, setOwn] = useState<ChapterText | null>(null);
  const [chapterOpen, setChapterOpen] = useState(false);
  const language = useUiLanguage();
  useEffect(() => {
    let alive = true;
    const pkg = resolveSourcePackage(board.settings);
    const gateway: AlignedTextRef = { owner: pkg.owner, repo: proposed === "tps" ? pkg.ust : pkg.ult, filepath: bookUsfmName(book), label: proposed === "tps" ? "UST" : "ULT" };
    setAligned([gateway]);
    void (async () => {
      const target = resolveScriptureTarget({ ...ctx, resource: proposed });
      if ("error" in target) return;
      const found = await tryReadExistingBookUsfm({ session, owner: target.owner, repo: target.repo, filepath: target.filepath, branches: [...groupDraftBranches(target.book, draftTaskId(board.teams, proposed) ?? ""), undefined] }).catch(() => null);
      if (!found || !alive) return;
      setOwn(chapterTextOf("own", proposed.toUpperCase(), found.text));
      setAligned([{ owner: target.owner, repo: target.repo, filepath: target.filepath, ...(found.branch ? { branch: found.branch } : {}), label: proposed.toUpperCase() }, gateway]);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, book, proposed]);

  // The texts of the whole book, read once for every proposal of the list.
  useEffect(() => {
    let alive = true;
    setTexts(undefined);
    void (async () => {
      const target = resolveScriptureTarget({ ...ctx, resource: other });
      if ("error" in target) return alive && setTexts(null);
      const found = await tryReadExistingBookUsfm({ session, owner: target.owner, repo: target.repo, filepath: target.filepath, branches: [...groupDraftBranches(target.book, draftTaskId(board.teams, other) ?? ""), undefined] }).catch(() => null);
      const draft = { owner: target.owner, repo: target.repo, branch: found?.branch ?? "", filepath: target.filepath };
      const label = other.toUpperCase();
      const rows = await loadChapterTexts({ session, book, pkg: resolveSourcePackage(board.settings), draft, draftLabel: label }).catch(() => [] as ChapterText[]);
      if (alive) setTexts({ rows, other: label });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, book, other]);

  useEffect(() => {
    let alive = true;
    void loadOriginalWords(session, book, chapter)
      .then((found) => alive && setWords(found))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, book, chapter]);

  if (texts === undefined) return <p className="af-hint">{t("vc.loading")}</p>;
  if (!texts || !texts.rows.length) return <p className="af-hint">{t("vc.none")}</p>;
  const key = `${chapter}:${verse}`;
  const shown = texts.rows.find((row) => row.id === tab) ?? texts.rows[0]!;
  const name = (row: ChapterText) => (row.id === "orig" ? t("af.tabOriginal") : row.id === "draft" ? texts.other : row.label);

  return (
    <div className="vc">
      <div className="af-ref__bar">
        <div className="af-ref__texts" role="tablist" aria-label={t("vc.textsAria")}>
          {texts.rows.map((row) => (
            <button key={row.id} type="button" role="tab" aria-selected={shown.id === row.id} onClick={() => setTab(row.id)}>
              {name(row)}
            </button>
          ))}
        </div>
      </div>
      {shown.id === "orig" ? (
        <>
          <span className="af-orig">
            <OriginalWords text={shown.book[key] ?? ""} words={words[key]} onOpen={(word) => setSheet({ word, chapter, verse })} />
          </span>
          <p className="af-hint vc-hint">{t("vc.tapWord")}</p>
        </>
      ) : (
        <p className="vc-verse">{shown.book[key] || t("af.noText")}</p>
      )}
      {/* Two ways to read the verse further, side by side, each with its word: two bare links one under the other
          looked like leftovers of another screen. */}
      <div className="vc-actions">
        {shown.id === "orig" ? (
          <button type="button" className="vc-action" onClick={() => setSentence(true)}>
            <ListTree aria-hidden size={16} />
            {t("vc.sentence")}
          </button>
        ) : null}
        {/* The verse in its chapter, in the text being read here: a proposal is weighed against what comes around it. */}
        <button type="button" className="vc-action" onClick={() => setChapterOpen(true)}>
          <BookOpen aria-hidden size={16} />
          {t("vc.readChapter")}
        </button>
      </div>
      <ParallelLink book={book} chapter={chapter} from={verse} session={session} workspace={workspace} />
      <Dialog open={chapterOpen} onOpenChange={setChapterOpen}>
        <DialogContent className="word-sheet vc-chapter-sheet" aria-describedby={undefined}>
          <DialogTitle className="ns-title">{`${bookLabel(book, language)} ${chapter}`}</DialogTitle>
          {chapterOpen ? <ChapterReader session={session} book={book} texts={[...texts.rows.filter((row) => row.id === "orig"), ...(own ? [own] : []), ...texts.rows.filter((row) => row.id !== "orig")]} initial={shown.id} chapter={chapter} from={verse} /> : null}
        </DialogContent>
      </Dialog>
      <WordSheet word={sheet?.word ?? null} at={{ book, chapter: sheet?.chapter ?? chapter, verse: sheet?.verse ?? verse }} session={session} workspace={workspace} onClose={() => setSheet(null)} readOnly inDiagram={sheet?.inDiagram} />
      <SentenceSheet
        at={sentence ? { book, chapter, verse } : null}
        session={session}
        workspace={workspace}
        aligned={aligned}
        // Over the diagram, which stays open under the word: closing the word goes back to it.
        onWord={(word, place) => setSheet({ word, chapter: place.chapter, verse: place.verse, inDiagram: true })}
        onClose={() => setSentence(false)}
      />
    </div>
  );
}
