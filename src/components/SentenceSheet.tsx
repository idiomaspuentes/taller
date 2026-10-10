import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Workspace } from "../config/types";
import type { OriginalWord } from "../dcs/afinacionLoad";
import type { GtSession } from "../dcs/auth";
import { loadDiagrams, saveDiagram } from "../dcs/diagramStore";
import { lexiconRepos, loadLexiconEntry } from "../dcs/lexicon";
import { loadOriginalWords, loadTrees } from "../dcs/syntaxTree";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import { diagramSentences, dissolveBox, flatSentence, joinSentences, leafOrder, moveBeside, moveOut, nodeAt, splitSentence, sentenceKey, sentencesShown, setBoxKind, wrapKids, type DiagramDoc, type TreePath } from "../domain/diagrams";
import { glossOfWord, strongParts } from "../domain/lexicon";
import { referentKey } from "../domain/referents";
import { clauseKind, isClause, isLeaf, joinedIn, leavesOf, LINK, sentenceFits, sentencesAt, sentenceShape, type TreeLeaf, type TreeFile, type TreeNode, type TreePlace, type TreeSentence } from "../domain/syntaxTree";
import { layoutTree } from "../domain/treeLayout";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";

type Words = Record<string, OriginalWord[]>;

/** What each function of a part is called. One the app has no name for is shown without one. */
const ROLE: Record<string, MessageKey> = { v: "st.v", s: "st.s", o: "st.o", o2: "st.o2", io: "st.io", p: "st.p", vc: "st.vc", adv: "st.adv", pp: "st.pp", aux: "st.aux", [LINK]: "st.link" };

/** The functions a box can be given by hand, in the order they are offered. */
const OFFERED = ["v", "s", "o", "io", "p", "adv", "pp", LINK];

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

/** What is chosen while a diagram is changed: some children of one box, words or boxes, next to one another or not. */
type Picked = { parent: TreePath; items: number[] };

type Shared = {
  book: string;
  words: Words;
  rtl: boolean;
  focus?: TreePlace & { word: number };
  session: GtSession | null;
  workspace: Workspace | undefined;
  onWord: (word: OriginalWord, at: TreePlace) => void;
  /** Given while the diagram is being changed: a touch chooses instead of opening. */
  pick?: { picked: Picked | null; onPick: (path: TreePath) => void };
};

const isPicked = (shared: Shared, path: TreePath) => {
  const picked = shared.pick?.picked;
  return Boolean(picked && path.length === picked.parent.length + 1 && picked.parent.every((step, i) => step === path[i]) && picked.items.includes(path[path.length - 1]!));
};

function Word({ leaf, role, path, shared }: { leaf: TreeLeaf; role: string; path: TreePath; shared: Shared }) {
  const t = useT();
  const word = shared.words[`${leaf.chapter}:${leaf.verse}`]?.[leaf.word - 1];
  if (!word) return null;
  const here = shared.focus && shared.focus.chapter === leaf.chapter && shared.focus.verse === leaf.verse && shared.focus.word === leaf.word;
  return (
    <button
      type="button"
      className="st-word"
      data-here={(!shared.pick && here) || undefined}
      data-link={role === LINK || undefined}
      data-picked={isPicked(shared, path) || undefined}
      aria-pressed={shared.pick ? isPicked(shared, path) : undefined}
      onClick={() => (shared.pick ? shared.pick.onPick(path) : shared.onWord(word, leaf))}
    >
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
 * A part of a sentence, drawn as a box: its name on it, and inside its words, or the boxes it is made of, in the
 * order they are read. A clause is a wider box with a heavier edge; one that depends on another is drawn inside
 * the part it fills, and clauses that stand side by side are numbered, with what joins them between.
 */
function Part({ node, parent, nth, path, shared }: { node: TreeNode; parent?: TreeNode; nth?: { n: number; of: number }; path: TreePath; shared: Shared }) {
  const t = useT();
  if (node.role === LINK) {
    // A word that joins is drawn as a word; while the diagram is changed, touching it chooses its box.
    return (
      <>
        {node.kids.filter(isLeaf).map((leaf, i) => (
          <Word key={i} leaf={leaf} role={LINK} path={path} shared={shared} />
        ))}
      </>
    );
  }
  const clause = isClause(node);
  const held = joinedIn(node);
  const name = ROLE[node.role] ? t(ROLE[node.role]!) : "";
  const kind = clause ? clauseKind(node, parent) : undefined;
  const label = !clause
    ? name || (shared.pick ? t("st.noRole") : "")
    : kind === "as"
      ? t("st.subAs").replace("{role}", name.toLowerCase())
      : kind === "describes"
        ? t("st.subDescribes")
        : kind === "joined" && nth
          ? t("st.clauseN").replace("{n}", String(nth.n)).replace("{of}", String(nth.of))
          : // A clause that only holds others together is the whole of them: the line over the diagram names it.
            // While the diagram is changed it has a name all the same, to be chosen by.
            !parent || (held.length > 1 && !shared.pick)
            ? ""
            : t("st.clause");
  let seen = 0;
  const holds = node.kids.some((kid) => !isLeaf(kid) && kid.role !== LINK);
  return (
    <div
      className="st-box"
      data-role={node.role || undefined}
      data-clause={clause || undefined}
      data-kind={kind}
      data-bare={(clause && !label) || undefined}
      data-holds={holds || undefined}
      data-picked={isPicked(shared, path) || undefined}
    >
      {label ? (
        shared.pick ? (
          <button type="button" className="st-label st-label--pick" aria-pressed={isPicked(shared, path)} onClick={() => shared.pick!.onPick(path)}>
            {label}
          </button>
        ) : (
          <p className="st-label">{label}</p>
        )
      ) : null}
      <div className="st-flow" dir={shared.rtl ? "rtl" : undefined}>
        {node.kids.map((kid, i) =>
          isLeaf(kid) ? (
            <Word key={i} leaf={kid} role={node.role} path={[...path, i]} shared={shared} />
          ) : (
            <Part key={i} node={kid} parent={node} path={[...path, i]} nth={held.includes(kid) ? { n: ++seen, of: held.length } : undefined} shared={shared} />
          ),
        )}
      </div>
    </div>
  );
}

/** The tree is drawn in rows of this height; a name is a pill this tall, and the words hang under the last row. */
const ROW = 46;
const PILL = 22;
const LEAF = 52;

/**
 * The sentence as a syntax tree: the sentence at the top, branches down to its parts, and the words in a row at
 * the bottom in the order they are read (from the right, in Hebrew). A long sentence is wider than a phone: the
 * tree is moved sideways with a finger, and opens on the word one came from.
 */
function Tree({ root, shared }: { root: TreeNode; shared: Shared }) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const name = (node: TreeNode, parent: TreeNode | undefined, nth?: number) => {
    const role = ROLE[node.role] ? t(ROLE[node.role]!) : "";
    if (!isClause(node)) return role || "·";
    const kind = clauseKind(node, parent);
    if (kind === "as") return t("st.treeAs").replace("{role}", role);
    if (kind === "describes") return t("st.treeSub");
    return kind === "joined" && nth ? `${t("st.clause")} ${nth}` : t("st.clause");
  };
  const layout = useMemo(
    () =>
      layoutTree(root, {
        // A name is drawn small, in capitals: about seven points a letter, and its pill around it.
        labelWidth: (node, parent) => name(node, parent, 9).length * 7.2 + 18,
        leafWidth: (leaf) => {
          const word = shared.words[`${leaf.chapter}:${leaf.verse}`]?.[leaf.word - 1];
          const letters = (leaf.piece ?? word?.surface ?? "").replace(/[^\p{L}]/gu, "").length;
          return Math.min(120, Math.max(56, letters * 11 + 18));
        },
        gap: 6,
        rtl: shared.rtl,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, shared.words, shared.rtl, t],
  );
  const leavesTop = (layout.depth + 1) * ROW;
  const height = leavesTop + LEAF;
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const here = box.querySelector<HTMLElement>(".st-word[data-here]");
    // On the word one came from; with none, where the sentence begins (the right end, in Hebrew).
    if (here) box.scrollLeft = here.parentElement!.offsetLeft - box.clientWidth / 2 + here.offsetWidth / 2;
    else box.scrollLeft = shared.rtl ? box.scrollWidth : 0;
  }, [layout, shared.rtl]);
  return (
    <>
      <div className="st-tree-scroll" ref={scroller}>
        <div className="st-tree" style={{ width: layout.width, height }}>
          <svg width={layout.width} height={height} aria-hidden>
            {layout.branches.map((branch, i) => (
              <line key={i} x1={branch.from.x} y1={branch.from.depth * ROW + PILL} x2={branch.to.x} y2={"leaf" in branch.to ? leavesTop : branch.to.depth * ROW} />
            ))}
          </svg>
          {layout.nodes.map((placed) => {
            const clause = isClause(placed.node);
            return (
              <span key={placed.path.join(".") || "root"} className="st-node" data-role={placed.node.role || undefined} data-clause={clause || undefined} data-kind={clause ? clauseKind(placed.node, placed.parent) : undefined} style={{ left: placed.x, top: placed.depth * ROW }}>
                {name(placed.node, placed.parent, placed.nth)}
              </span>
            );
          })}
          {layout.leaves.map((placed) => (
            <div key={placed.path.join(".")} className="st-leaf" style={{ left: placed.x - placed.width / 2, top: leavesTop, width: placed.width }}>
              <Word leaf={placed.leaf} role={placed.role} path={placed.path} shared={shared} />
            </div>
          ))}
        </div>
      </div>
      {layout.width > 330 ? <p className="af-hint">{t("st.swipe")}</p> : null}
    </>
  );
}

type Shown = TreeSentence & { key?: string; by?: { by: string; at: string } };

/**
 * How the sentence of a verse is put together, as a diagram of boxes one inside another: each clause a box, each
 * part of it (the verb, the subject, the object) a smaller one of its own colour, with its words in the order
 * they are read. Boxes and not branches, since a tree of sixty words does not fit a phone and this does. Over it,
 * whether the sentence is simple, compound or complex. Each word says what it means and opens its sheet.
 *
 * A team can make a diagram its own (`teamOrg`): correct the one that comes with the app, or make one for a verse
 * that has none. It is done by touching: words or boxes are chosen and put into a new box, a box is told what it
 * is, or is taken away. What the team leaves is kept with its plan and shown to everyone in place of the other.
 */
export function SentenceSheet({
  at,
  focus,
  session,
  workspace,
  teamOrg,
  onWord,
  onClose,
}: {
  /** The verse whose sentence is shown, or `null` while the sheet is closed. */
  at: ({ book: string } & TreePlace) | null;
  /** The word the sheet was opened from: it is marked. Which one it is among the like words of its verse, from 0. */
  focus?: { surface: string; occurrence?: number };
  session: GtSession | null;
  workspace: Workspace | undefined;
  /** The organization whose plan repository keeps the team's diagrams. Without it they are only read. */
  teamOrg?: string;
  onWord: (word: OriginalWord, at: TreePlace) => void;
  onClose: () => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const [loaded, setLoaded] = useState<{ file: TreeFile | null; shipped: TreeSentence[]; words: Words; docs: Record<number, DiagramDoc> } | null>(null);
  /**
   * The sentences before and after the ones of the verse, shown when asked for: a sentence that begins with «y» or
   * «porque» is joined to what came before, and that may be in another verse or another chapter.
   */
  const [around, setAround] = useState<{ before: TreeSentence[]; after: TreeSentence[] }>({ before: [], after: [] });
  const [editing, setEditing] = useState<{
    key: string;
    root: TreeNode;
    /** The second sentence, when the one being changed was parted in two: both are kept on saving. */
    tail?: TreeNode;
    /** Diagrams of the team that were joined into this one: they are taken away on saving. */
    absorbed?: string[];
    history: { root: TreeNode; tail?: TreeNode; absorbed?: string[] }[];
    picked: Picked | null;
    wrapping: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /** A tree, as grammars draw it, or boxes one inside another, which fit a phone and are what is changed. */
  const [view, setView] = useState<"tree" | "boxes">("tree");

  useEffect(() => {
    setLoaded(null);
    setAround({ before: [], after: [] });
    setEditing(null);
    setError("");
    if (!at || !session) return;
    let alive = true;
    void (async () => {
      const file = await loadTrees(at.book);
      const found = sentencesAt(file, at);
      // A sentence may begin in the chapter before, or end in the next one.
      const chapters = [...new Set([at.chapter, ...found.flatMap((sentence) => sentence.verses.map((verse) => verse.chapter))])];
      const [words, docs] = await Promise.all([
        Promise.all(chapters.map((chapter) => loadOriginalWords(session, at.book, chapter))).then((all): Words => Object.assign({}, ...all)),
        teamOrg ? Promise.all(chapters.map((chapter) => loadDiagrams(session, teamOrg, at.book, chapter))) : Promise.resolve([] as DiagramDoc[]),
      ]);
      const shipped = file ? found.filter((sentence) => sentenceFits(file, sentence, (verse) => words[`${verse.chapter}:${verse.verse}`]?.length)) : [];
      if (alive) setLoaded({ file, shipped, words, docs: Object.fromEntries(docs.map((doc) => [doc.chapter, doc])) });
    })();
    return () => {
      alive = false;
    };
  }, [at?.book, at?.chapter, at?.verse, session, teamOrg]);

  const team = loaded ? Object.values(loaded.docs).flatMap(diagramSentences) : [];
  // A diagram of the team whose words our text no longer has (the text changed under it) is not shown.
  const sound = team.filter((sentence) => leavesOf(sentence.root).every((leaf) => loaded?.words[`${leaf.chapter}:${leaf.verse}`]?.[leaf.word - 1]));
  const shown: Shown[] = at && loaded ? sentencesShown(loaded.shipped, sound, at) : [];

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
  const kindOf = (root: TreeNode) => {
    const shape = sentenceShape(root);
    const fill = (key: MessageKey) => t(key).replace("{n}", String(shape.clauses)).replace("{sub}", String(shape.subordinate)).replace("{joined}", String(shape.joined));
    if (shape.subordinate && shape.joined > 1) return fill("st.both");
    if (shape.subordinate) return fill("st.complex");
    if (shape.joined > 1) return fill("st.compound");
    return t("st.simple");
  };

  const rtl = Boolean(loaded && Object.values(loaded.words).some((verse) => verse.some((word) => word.strong.includes("H"))));
  const shared = (pick?: Shared["pick"]): Shared => ({ book: at?.book ?? "", words: loaded?.words ?? {}, rtl, focus: focused, session, workspace, onWord, pick });

  // ---- changing a diagram

  const change = (root: TreeNode, more: { tail?: TreeNode; absorbed?: string[] } = {}) =>
    setEditing((now) => (now ? { ...now, root, ...more, history: [...now.history, { root: now.root, tail: now.tail, absorbed: now.absorbed }], picked: null, wrapping: false } : now));
  const onPick = (path: TreePath) =>
    setEditing((now) => {
      if (!now || !path.length) return now;
      const parent = path.slice(0, -1);
      const item = path[path.length - 1]!;
      const same = now.picked && now.picked.parent.length === parent.length && now.picked.parent.every((step, i) => step === parent[i]);
      // What is chosen together is in one box: a touch in another box starts over there.
      const items = same ? (now.picked!.items.includes(item) ? now.picked!.items.filter((other) => other !== item) : [...now.picked!.items, item]) : [item];
      return { ...now, picked: items.length ? { parent, items } : null, wrapping: false };
    });
  const picked = editing?.picked ?? null;
  const one = editing && picked?.items.length === 1 ? nodeAt(editing.root, [...picked.parent, picked.items[0]!]) : undefined;
  const box = one && !isLeaf(one) ? one : undefined;
  /** Where the one thing chosen may go in one touch: into the box before it, into the one after, or out of its own. */
  const moves = (() => {
    if (!editing || !picked || !one) return null;
    const holder = nodeAt(editing.root, picked.parent);
    if (!holder || isLeaf(holder)) return null;
    const index = picked.items[0]!;
    const before = holder.kids[index - 1];
    const after = holder.kids[index + 1];
    return { index, before: Boolean(before && !isLeaf(before)), after: Boolean(after && !isLeaf(after)), out: picked.parent.length > 0 && (index === 0 || index === holder.kids.length - 1) };
  })();
  /** What a touch on a function does: says what the chosen box is, or puts what is chosen into a new box of it. */
  const give = (role: string) => {
    if (!editing || !picked) return;
    if (box && !editing.wrapping) change(setBoxKind(editing.root, [...picked.parent, picked.items[0]!], { role: box.role === role ? "" : role, clause: box.clause }));
    else change(wrapKids(editing.root, picked.parent, Math.min(...picked.items), Math.max(...picked.items), { role, clause: false }));
  };
  const giveClause = () => {
    if (!editing || !picked) return;
    if (box && !editing.wrapping) change(setBoxKind(editing.root, [...picked.parent, picked.items[0]!], { role: box.role, clause: !box.clause }));
    else change(wrapKids(editing.root, picked.parent, Math.min(...picked.items), Math.max(...picked.items), { role: "", clause: true }));
  };

  /**
   * The sentence that follows the one being changed, to join it: the team's own diagram of it, or the app's when
   * it fits our text. None when the one in hand has already been parted, or nothing that can be drawn follows.
   */
  const following = (() => {
    if (!editing || editing.tail || !loaded) return undefined;
    const end = Math.max(...leavesOf(editing.root).map(leafOrder));
    const start = (sentence: TreeSentence) => Math.min(...leavesOf(sentence.root).map(leafOrder));
    const candidates: Shown[] = [...sound, ...(loaded.file?.sentences ?? [])].filter((sentence) => start(sentence) > end);
    const first = candidates.sort((a, b) => start(a) - start(b))[0];
    const drawn = first && (first.key || (loaded.file && sentenceFits(loaded.file, first, (verse) => loaded.words[`${verse.chapter}:${verse.verse}`]?.length)));
    return first && drawn ? first : undefined;
  })();

  async function keep(key: string, root: TreeNode | null, more: { tail?: TreeNode; absorbed?: string[] } = {}) {
    if (!at || !session || !teamOrg) return;
    setSaving(true);
    setError("");
    try {
      const chapterOf = (id: string) => Math.floor(Number(id) / 1e6) || at.chapter;
      const docs: Record<number, DiagramDoc> = {};
      // The sentence itself, the second one when it was parted, and the team's diagrams it took in, each in turn.
      const writes: [string, TreeNode | null][] = [[key, root], ...(more.tail ? [[sentenceKey(more.tail), more.tail] as [string, TreeNode]] : []), ...(more.absorbed ?? []).filter((id) => id !== key).map((id): [string, null] => [id, null])];
      for (const [id, tree] of writes) docs[chapterOf(id)] = await saveDiagram(session, teamOrg, at.book, chapterOf(id), id, tree);
      setLoaded((now) => (now ? { ...now, docs: { ...now.docs, ...docs } } : now));
      setEditing(null);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  const wordsHere = at ? (loaded?.words[`${at.chapter}:${at.verse}`]?.length ?? 0) : 0;

  /** The sentence next to what is shown, on one side (-1 before, 1 after), in the order the book has them. */
  const neighbour = (side: -1 | 1): TreeSentence | undefined => {
    const all = loaded?.file?.sentences ?? [];
    const edge = side < 0 ? (around.before[0] ?? loaded?.shipped[0]) : (around.after[around.after.length - 1] ?? loaded?.shipped[loaded.shipped.length - 1]);
    const at = edge ? all.indexOf(edge) : -1;
    return at < 0 ? undefined : all[at + side];
  };
  async function widen(side: -1 | 1) {
    const next = neighbour(side);
    if (!next || !loaded || !session || !at) return;
    // Its words, when it is of a chapter not read yet.
    const missing = [...new Set(next.verses.map((verse) => verse.chapter))].filter((chapter) => !Object.keys(loaded.words).some((key) => key.startsWith(`${chapter}:`)));
    const more: Words = Object.assign({}, ...(await Promise.all(missing.map((chapter) => loadOriginalWords(session, at.book, chapter)))));
    setLoaded((now) => (now ? { ...now, words: { ...now.words, ...more } } : now));
    setAround((now) => (side < 0 ? { ...now, before: [next, ...now.before] } : { ...now, after: [...now.after, next] }));
  }
  const fits = (sentence: TreeSentence) => Boolean(loaded?.file && sentenceFits(loaded.file, sentence, (verse) => loaded.words[`${verse.chapter}:${verse.verse}`]?.length));
  const beside = (sentence: TreeSentence, i: number) => (
    <section key={`around-${i}-${span(sentence)}`} className="st-sentence st-sentence--around">
      <h3 className="pp-passage__ref">{span(sentence)}</h3>
      {fits(sentence) ? (
        <>
          <p className="st-kind">{kindOf(sentence.root)}</p>
          {view === "tree" ? <Tree root={sentence.root} shared={shared()} /> : <Part node={sentence.root} path={[]} shared={shared()} />}
        </>
      ) : (
        <p className="af-hint">{t("st.none")}</p>
      )}
    </section>
  );

  return (
    <Dialog open={Boolean(at)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="fix-sheet help-sheet pp-sheet st-sheet" aria-label={t("st.title")} showCloseButton={!saving}>
        <header className="fx-head">
          <DialogTitle className="fx-title">{t(editing ? "st.editTitle" : "st.title")}</DialogTitle>
          {at ? <p className="ws-meta">{shown.length === 1 ? span(shown[0]!) : `${bookLabel(at.book, language)} ${at.chapter}:${at.verse}`}</p> : null}
        </header>
        <div className="fx-body pp-body">
          {!loaded ? <p className="af-hint">{t("st.loading")}</p> : null}
          {editing ? (
            <section className="st-sentence">
              <p className="st-kind">{kindOf(editing.root)}</p>
              <Part node={editing.root} path={[]} shared={shared({ picked, onPick })} />
              {editing.tail ? (
                // The second of the two the sentence was parted in: shown as it will be kept; it is changed on its own later.
                <div className="st-tail">
                  <p className="af-lbl">{t("st.second")}</p>
                  <p className="st-kind">{kindOf(editing.tail)}</p>
                  <Part node={editing.tail} path={[]} shared={{ ...shared(), onWord: () => undefined }} />
                </div>
              ) : null}
            </section>
          ) : (
            <>
              {loaded && !shown.length ? <p className="af-hint">{t("st.none")}</p> : null}
              {shown.length ? (
                <div className="st-views" role="tablist" aria-label={t("st.title")}>
                  {(["tree", "boxes"] as const).map((which) => (
                    <button key={which} type="button" role="tab" aria-selected={view === which} onClick={() => setView(which)}>
                      {t(which === "tree" ? "st.viewTree" : "st.viewBoxes")}
                    </button>
                  ))}
                </div>
              ) : null}
              {loaded && !shown.length && teamOrg && wordsHere && at ? (
                <Button type="button" variant="outline" onClick={() => {
                  const root = flatSentence([{ chapter: at.chapter, verse: at.verse, words: wordsHere }]);
                  setEditing({ key: sentenceKey(root), root, history: [], picked: null, wrapping: false });
                }}>
                  {t("st.create")}
                </Button>
              ) : null}
              {loaded?.shipped.length && neighbour(-1) ? (
                <button type="button" className="af-link st-around" onClick={() => void widen(-1)}>
                  {t("st.before")}
                </button>
              ) : null}
              {around.before.map(beside)}
              {shown.map((sentence, i) => (
                <section key={i} className="st-sentence">
                  {shown.length > 1 ? <h3 className="pp-passage__ref">{span(sentence)}</h3> : null}
                  <p className="st-kind">{kindOf(sentence.root)}</p>
                  {view === "tree" ? <Tree root={sentence.root} shared={shared()} /> : <Part node={sentence.root} path={[]} shared={shared()} />}
                  {sentence.key ? <p className="ws-meta">{t("st.teamMade").replace("{who}", sentence.by?.by ?? "")}</p> : null}
                  {teamOrg ? (
                    <div className="st-actions">
                      <button type="button" className="af-link" disabled={saving} onClick={() => setEditing({ key: sentence.key ?? sentenceKey(sentence.root), root: sentence.root, history: [], picked: null, wrapping: false })}>
                        {t("st.edit")}
                      </button>
                      {sentence.key ? (
                        <button type="button" className="af-link" disabled={saving} onClick={() => void keep(sentence.key!, null)}>
                          {t("st.restore")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ))}
              {around.after.map(beside)}
              {loaded?.shipped.length && neighbour(1) ? (
                <button type="button" className="af-link st-around" onClick={() => void widen(1)}>
                  {t("st.after")}
                </button>
              ) : null}
            </>
          )}
          {error ? <p className="st-error" role="alert">{error}</p> : null}
          {shown.length && !editing ? (
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
          {!editing ? <p className="pp-credit">{t("st.credit")}</p> : null}
        </div>
        {editing ? (
          // Under the thumb: what is done to what was chosen, and leaving.
          <footer className="st-tools">
            {!picked ? (
              <>
                <p className="af-hint">{t("st.editHint")}</p>
                {following ? (
                  <div className="st-actions">
                    <button type="button" className="af-link" onClick={() => change(joinSentences(editing.root, following.root), { absorbed: [...(editing.absorbed ?? []), ...(following.key ? [following.key] : [])] })}>
                      {t("st.joinNext")}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="af-lbl">{t(box && !editing.wrapping ? "st.boxIs" : "st.wrapAs")}</p>
                <div className="st-chips">
                  {OFFERED.map((role) => (
                    <button key={role} type="button" className="st-chip" data-role={role} aria-pressed={box && !editing.wrapping ? box.role === role : undefined} onClick={() => give(role)}>
                      {t(ROLE[role]!)}
                    </button>
                  ))}
                  <button type="button" className="st-chip" data-clause aria-pressed={box && !editing.wrapping ? box.clause : undefined} onClick={giveClause}>
                    {t("st.clause")}
                  </button>
                </div>
                {moves && (moves.before || moves.after || moves.out) ? (
                  <div className="st-actions">
                    {moves.before ? (
                      <button type="button" className="af-link" onClick={() => change(moveBeside(editing.root, picked.parent, moves.index, -1))}>
                        {t("st.toBefore")}
                      </button>
                    ) : null}
                    {moves.after ? (
                      <button type="button" className="af-link" onClick={() => change(moveBeside(editing.root, picked.parent, moves.index, 1))}>
                        {t("st.toAfter")}
                      </button>
                    ) : null}
                    {moves.out ? (
                      <button type="button" className="af-link" onClick={() => change(moveOut(editing.root, [...picked.parent, moves.index]))}>
                        {t("st.takeOut")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {moves && !picked.parent.length && moves.index > 0 && !editing.tail ? (
                  <div className="st-actions">
                    <button
                      type="button"
                      className="af-link"
                      onClick={() => {
                        const parts = splitSentence(editing.root, moves.index);
                        if (parts) change(parts[0], { tail: parts[1] });
                      }}
                    >
                      {t("st.splitHere")}
                    </button>
                  </div>
                ) : null}
                {box && !editing.wrapping ? (
                  <div className="st-actions">
                    <button type="button" className="af-link" onClick={() => change(dissolveBox(editing.root, [...picked.parent, picked.items[0]!]))}>
                      {t("st.remove")}
                    </button>
                    <button type="button" className="af-link" onClick={() => setEditing({ ...editing, wrapping: true })}>
                      {t("st.wrapBox")}
                    </button>
                  </div>
                ) : null}
              </>
            )}
            <div className="st-tools__end">
              <Button type="button" variant="ghost" size="sm" disabled={saving || !editing.history.length} onClick={() => setEditing({ ...editing, ...editing.history[editing.history.length - 1]!, history: editing.history.slice(0, -1), picked: null, wrapping: false })}>
                {t("st.undo")}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setEditing(null)}>
                {t("st.cancel")}
              </Button>
              <Button type="button" size="sm" disabled={saving || !editing.history.length} onClick={() => void keep(editing.key, editing.root, { tail: editing.tail, absorbed: editing.absorbed })}>
                {t(saving ? "st.saving" : "st.save")}
              </Button>
            </div>
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
