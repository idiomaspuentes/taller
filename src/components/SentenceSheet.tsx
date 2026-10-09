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
import { clauseKind, isClause, isLeaf, joinedIn, LINK, sentenceFits, sentencesAt, sentenceShape, type TreeFile, type TreeLeaf, type TreeNode, type TreePlace, type TreeSentence } from "../domain/syntaxTree";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";

type Words = Record<string, OriginalWord[]>;

/** What each function of a part is called. One the app has no name for is shown without one. */
const ROLE: Record<string, MessageKey> = { v: "st.v", s: "st.s", o: "st.o", o2: "st.o2", io: "st.io", p: "st.p", vc: "st.vc", adv: "st.adv", pp: "st.pp", aux: "st.aux" };

/** What a word means in its verse, under it: the diagram is read by people who do not read the original. */
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

type Shared = { book: string; words: Words; rtl: boolean; focus?: TreePlace & { word: number }; session: GtSession | null; workspace: Workspace | undefined; onWord: (word: OriginalWord, at: TreePlace) => void };

function Word({ leaf, role, shared }: { leaf: TreeLeaf; role: string; shared: Shared }) {
  const t = useT();
  const word = shared.words[`${leaf.chapter}:${leaf.verse}`]?.[leaf.word - 1];
  if (!word) return null;
  const here = shared.focus && shared.focus.chapter === leaf.chapter && shared.focus.verse === leaf.verse && shared.focus.word === leaf.word;
  return (
    <button type="button" className="st-word" data-here={here || undefined} data-link={role === LINK || undefined} onClick={() => shared.onWord(word, leaf)}>
      <span className="st-word__text" lang={shared.rtl ? "hbo" : "grc"}>
        {leaf.piece ?? word.surface}
      </span>
      {/* Of a word two parts share, the meaning is the verb's: under the «me» of «me rodearon» it would say
          «rodear». The «and» Hebrew joins to the next word is the one piece that is always the same word. */}
      {!leaf.piece || role === "v" ? (
        <Gloss word={word} at={{ book: shared.book, chapter: leaf.chapter, verse: leaf.verse }} session={shared.session} workspace={shared.workspace} />
      ) : role === LINK && shared.rtl ? (
        <span className="st-gloss">{t("st.and")}</span>
      ) : null}
    </button>
  );
}

/**
 * A part of a sentence, drawn as a box: its name on its edge, and inside its words, or the boxes it is made of,
 * in the order they are read. A clause is a wider box with a heavier edge; one that depends on another is drawn
 * inside the part it fills, and clauses that stand side by side are numbered, with what joins them between.
 */
function Part({ node, parent, nth, shared }: { node: TreeNode; parent?: TreeNode; nth?: { n: number; of: number }; shared: Shared }) {
  const t = useT();
  if (node.role === LINK) {
    return (
      <>
        {node.kids.filter(isLeaf).map((leaf) => (
          <Word key={`${leaf.chapter}:${leaf.verse}:${leaf.word}`} leaf={leaf} role={LINK} shared={shared} />
        ))}
      </>
    );
  }
  const clause = isClause(node);
  const held = joinedIn(node);
  const name = ROLE[node.role] ? t(ROLE[node.role]!) : "";
  const kind = clause ? clauseKind(node, parent) : undefined;
  const label = !clause
    ? name
    : kind === "as"
      ? t("st.subAs").replace("{role}", name.toLowerCase())
      : kind === "describes"
        ? t("st.subDescribes")
        : kind === "joined" && nth
          ? t("st.clauseN").replace("{n}", String(nth.n)).replace("{of}", String(nth.of))
          : // A clause that only holds others together is the whole of them: the line over the diagram names it.
            held.length > 1 || !parent
            ? ""
            : t("st.clause");
  let seen = 0;
  const holds = node.kids.some((kid) => !isLeaf(kid) && kid.role !== LINK);
  return (
    <div className="st-box" data-role={node.role || undefined} data-clause={clause || undefined} data-kind={kind} data-bare={(clause && !label) || undefined} data-holds={holds || undefined}>
      {label ? <p className="st-label">{label}</p> : null}
      <div className="st-flow" dir={shared.rtl ? "rtl" : undefined}>
        {node.kids.map((kid, i) =>
          isLeaf(kid) ? (
            <Word key={i} leaf={kid} role={node.role} shared={shared} />
          ) : (
            <Part key={i} node={kid} parent={node} nth={held.includes(kid) ? { n: ++seen, of: held.length } : undefined} shared={shared} />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * How the sentence of a verse is put together, as a diagram of boxes one inside another: each clause a box, each
 * part of it (the verb, the subject, the object) a smaller one of its own colour, with its words in the order
 * they are read. Boxes and not branches, since a tree of sixty words does not fit a phone and this does. Over it,
 * whether the sentence is simple, compound or complex. Each word says what it means and opens its sheet.
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

  /** «Oración compuesta: 3 oraciones unidas», «Oración compleja: 5 oraciones, 3 de ellas subordinadas». */
  const kindOf = (sentence: TreeSentence) => {
    const shape = sentenceShape(sentence.root);
    const fill = (key: MessageKey) => t(key).replace("{n}", String(shape.clauses)).replace("{sub}", String(shape.subordinate)).replace("{joined}", String(shape.joined));
    if (shape.subordinate && shape.joined > 1) return fill("st.both");
    if (shape.subordinate) return fill("st.complex");
    if (shape.joined > 1) return fill("st.compound");
    return t("st.simple");
  };

  const rtl = Boolean(loaded && Object.values(loaded.words).some((verse) => verse.some((word) => word.strong.includes("H"))));

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
                  <p className="st-kind">{kindOf(sentence)}</p>
                  <Part node={sentence.root} shared={{ book: at.book, words: loaded.words, rtl, focus: focused, session, workspace, onWord }} />
                </section>
              ))
            : null}
          {loaded?.sentences.length ? (
            <>
              <ul className="st-legend" aria-label={t("st.legend")}>
                {(["v", "s", "o", "adv"] as const).map((role) => (
                  <li key={role} data-role={role}>
                    {t(ROLE[role]!)}
                  </li>
                ))}
                <li data-clause>{t("st.clause")}</li>
              </ul>
              <p className="af-hint">{t("pp.touch")}</p>
            </>
          ) : null}
          <p className="pp-credit">{t("st.credit")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
