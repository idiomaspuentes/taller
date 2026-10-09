import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Workspace } from "../config/types";
import type { OriginalWord } from "../dcs/afinacionLoad";
import type { GtSession } from "../dcs/auth";
import { lexiconRepos, loadLexiconEntry } from "../dcs/lexicon";
import { loadOriginalWords, loadTrees } from "../dcs/syntaxTree";
import { bookLabel } from "../domain/books";
import { glossOfWord, strongParts } from "../domain/lexicon";
import { referentKey } from "../domain/referents";
import { isLeaf, sentenceFits, sentencesAt, type TreeFile, type TreeLeaf, type TreeNode, type TreePlace, type TreeSentence } from "../domain/syntaxTree";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";

type Words = Record<string, OriginalWord[]>;

/** What each function of a part is called. One the app has no name for is shown without one. */
const ROLE: Record<string, MessageKey> = { v: "st.v", s: "st.s", o: "st.o", o2: "st.o2", io: "st.io", p: "st.p", vc: "st.vc", adv: "st.adv", pp: "st.pp", aux: "st.aux" };

/** What a word means in its verse, under it: the tree is read by people who do not read the original. */
function Gloss({ word, at, session, workspace }: { word: OriginalWord; at: { book: string } & TreePlace; session: GtSession | null; workspace: Workspace | undefined }) {
  const [gloss, setGloss] = useState("");
  useEffect(() => {
    setGloss("");
    const part = strongParts(word.strong)[0];
    if (!part || !session) return;
    let alive = true;
    void loadLexiconEntry(session, lexiconRepos(workspace, part.kind), part.number).then((entry) => {
      if (alive && entry) setGloss(glossOfWord(entry.file, at, part.letter));
    });
    return () => {
      alive = false;
    };
  }, [word.strong, at.book, at.chapter, at.verse, session, workspace]);
  return gloss ? <span className="st-gloss">{gloss}</span> : null;
}

type Shared = { book: string; words: Words; focus?: TreePlace & { word: number }; session: GtSession | null; workspace: Workspace | undefined; onWord: (word: OriginalWord, at: TreePlace) => void };

function Word({ leaf, role, shared }: { leaf: TreeLeaf; role: string; shared: Shared }) {
  const word = shared.words[`${leaf.chapter}:${leaf.verse}`]?.[leaf.word - 1];
  if (!word) return null;
  const hebrew = word.strong.includes("H");
  const here = shared.focus && shared.focus.chapter === leaf.chapter && shared.focus.verse === leaf.verse && shared.focus.word === leaf.word;
  return (
    <button type="button" className="st-word" data-here={here || undefined} onClick={() => shared.onWord(word, leaf)}>
      <span className="st-word__text" lang={hebrew ? "hbo" : "grc"}>
        {leaf.piece ?? word.surface}
      </span>
      {/* Of a word two parts share, the meaning is the verb's: under the «me» of «me rodearon» it would say «rodear». */}
      {!leaf.piece || role === "v" ? <Gloss word={word} at={{ book: shared.book, chapter: leaf.chapter, verse: leaf.verse }} session={shared.session} workspace={shared.workspace} /> : null}
    </button>
  );
}

/** A part of a sentence: what it is, and under it its words, or the parts it is made of. */
function Part({ node, shared, top }: { node: TreeNode; shared: Shared; top?: boolean }) {
  const t = useT();
  const name = ROLE[node.role] ? t(ROLE[node.role]!) : "";
  // The whole sentence needs no name: the title of the sheet says what it is.
  const label = top && !name ? "" : node.clause ? (name ? t("st.asClause").replace("{role}", name) : t("st.clause")) : name;
  // Words that stand loose between two parts (an «and», a «because») are shown together, in their place.
  const rows: ({ words: TreeLeaf[] } | { part: TreeNode })[] = [];
  for (const kid of node.kids) {
    const last = rows[rows.length - 1];
    if (!isLeaf(kid)) rows.push({ part: kid });
    else if (last && "words" in last) last.words.push(kid);
    else rows.push({ words: [kid] });
  }
  const hebrew = Object.values(shared.words)[0]?.[0]?.strong.includes("H");
  return (
    <div className="st-part" data-role={node.role || undefined} data-clause={node.clause || undefined} data-top={top || undefined}>
      {label ? <p className="st-label">{label}</p> : null}
      <div className="st-kids">
        {rows.map((row, i) =>
          "part" in row ? (
            <Part key={i} node={row.part} shared={shared} />
          ) : (
            <div key={i} className="st-words" dir={hebrew ? "rtl" : undefined}>
              {row.words.map((leaf) => (
                <Word key={`${leaf.chapter}:${leaf.verse}:${leaf.word}:${leaf.piece ?? ""}`} leaf={leaf} role={node.role} shared={shared} />
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * How the sentence of a verse is put together: its clauses one inside another, and in each which words are the
 * verb, the subject, the object. A list that is read from top to bottom, since a diagram does not fit a phone.
 * Each word says what it means and opens its sheet.
 */
export function SentenceSheet({
  at,
  focus,
  session,
  workspace,
  onWord,
  onClose,
}: {
  /** The verse whose sentence is shown, or `null` while the sheet is closed. */
  at: ({ book: string } & TreePlace) | null;
  /** The word the sheet was opened from: it is marked. Which one it is among the like words of its verse, from 0. */
  focus?: { surface: string; occurrence?: number };
  session: GtSession | null;
  workspace: Workspace | undefined;
  onWord: (word: OriginalWord, at: TreePlace) => void;
  onClose: () => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const [loaded, setLoaded] = useState<{ file: TreeFile | null; sentences: TreeSentence[]; words: Words } | null>(null);

  useEffect(() => {
    setLoaded(null);
    if (!at || !session) return;
    let alive = true;
    void (async () => {
      const file = await loadTrees(at.book);
      const found = sentencesAt(file, at);
      // A sentence may begin in the chapter before, or end in the next one.
      const chapters = [...new Set(found.flatMap((sentence) => sentence.verses.map((verse) => verse.chapter)))];
      const words: Words = Object.assign({}, ...(await Promise.all(chapters.map((chapter) => loadOriginalWords(session, at.book, chapter)))));
      const sentences = file ? found.filter((sentence) => sentenceFits(file, sentence, (verse) => words[`${verse.chapter}:${verse.verse}`]?.length)) : [];
      if (alive) setLoaded({ file, sentences, words });
    })();
    return () => {
      alive = false;
    };
  }, [at?.book, at?.chapter, at?.verse, session]);

  /** The place in its verse (from 1) of the word the sheet was opened from, when it can be told. */
  const focused = (() => {
    if (!at || !focus || !loaded) return undefined;
    const like = (loaded.words[`${at.chapter}:${at.verse}`] ?? []).map((word, i) => (referentKey(word.surface) === referentKey(focus.surface) ? i + 1 : 0)).filter(Boolean);
    const word = focus.occurrence !== undefined ? like[focus.occurrence] : like.length === 1 ? like[0] : undefined;
    return word ? { chapter: at.chapter, verse: at.verse, word } : undefined;
  })();

  const span = (sentence: TreeSentence) => {
    const first = sentence.verses[0]!;
    const last = sentence.verses[sentence.verses.length - 1]!;
    const end = last.chapter !== first.chapter ? `–${last.chapter}:${last.verse}` : last.verse !== first.verse ? `–${last.verse}` : "";
    return `${bookLabel(at?.book ?? "", language)} ${first.chapter}:${first.verse}${end}`;
  };

  return (
    <Dialog open={Boolean(at)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="fix-sheet help-sheet pp-sheet st-sheet" aria-label={t("st.title")}>
        <header className="fx-head">
          <DialogTitle className="fx-title">{t("st.title")}</DialogTitle>
          {at ? <p className="ws-meta">{loaded?.sentences.length === 1 ? span(loaded.sentences[0]!) : `${bookLabel(at.book, language)} ${at.chapter}:${at.verse}`}</p> : null}
        </header>
        <div className="fx-body pp-body">
          {!loaded ? <p className="af-hint">{t("st.loading")}</p> : null}
          {loaded && !loaded.sentences.length ? <p className="af-hint">{t("st.none")}</p> : null}
          {at && loaded
            ? loaded.sentences.map((sentence, i) => (
                <section key={i} className="st-sentence">
                  {loaded.sentences.length > 1 ? <h3 className="pp-passage__ref">{span(sentence)}</h3> : null}
                  <Part node={sentence.root} top shared={{ book: at.book, words: loaded.words, focus: focused, session, workspace, onWord }} />
                </section>
              ))
            : null}
          {loaded?.sentences.length ? <p className="af-hint">{t("pp.touch")}</p> : null}
          <p className="pp-credit">{t("st.credit")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
