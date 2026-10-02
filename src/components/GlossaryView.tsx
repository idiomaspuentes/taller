import { useCallback, useEffect, useMemo, useState } from "react";
import type { OriginalWord } from "@usfm-tools/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { loadGlossary, loadGlossaryChanges, loadPassageContext, saveGlossaryEntry, settleGlossaryChange, type Glossary, type GlossaryChange, type PassageContext } from "../dcs/glossaryStore";
import { loadPmConfig } from "../dcs/issues";
import {
  baseStrong,
  contentSources,
  departuresFrom,
  entriesForPassage,
  entryFromSources,
  groupOfWord,
  isContentWord,
  newGlossaryId,
  renderingsOf,
  searchGlossary,
  type GlossaryEntry,
  type GlossaryScope,
} from "../domain/glossary";
import { useT, type MessageKey } from "../i18n/messages";

type Props = {
  session: GtSession;
  /** The content organization and language of the workspace: where the glossary lives. */
  owner: string;
  lang: string;
  /** Where the levels of the organization are kept: who coordinates, or a qualified person, may confirm an entry as agreed. */
  pmOrg: string;
  canManage: boolean;
  /** The passage the glossary was opened from; without it, the glossary is searched. */
  passage?: { book: string; chapter: number; from: number; to: number };
  onClose: () => void;
  announce: (msg: string) => void;
};

type View = "passage" | "search" | "pending";
const SCOPE_KEY: Record<GlossaryScope, MessageKey> = { all: "gl.scopeAll", tpl: "gl.scopeTpl", tps: "gl.scopeTps", helps: "gl.scopeHelps" };
const join = (items: string[]) => items.join("; ");
const split = (text: string) => text.split(";").map((part) => part.trim()).filter(Boolean);

/**
 * The glossary of translation decisions. It is never read as a list: it opens on the entries of the passage in
 * hand, or is searched. An entry is born from a tap on a word of the aligned English text, which leads to the word
 * of the original under it; nobody needs to know Greek or Hebrew to file it well.
 */
export function GlossaryView({ session, owner, lang, pmOrg, canManage, passage, onClose, announce }: Props) {
  const [canAgree, setCanAgree] = useState(canManage);
  const t = useT();
  const [glossary, setGlossary] = useState<Glossary | null>(null);
  const [context, setContext] = useState<PassageContext | null>(null);
  const [view, setView] = useState<View>(passage ? "passage" : "search");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ ref: string; word: string; sources: OriginalWord[]; offered: OriginalWord[] }[]>([]);
  const [draft, setDraft] = useState<{ entry: GlossaryEntry; before?: GlossaryEntry } | null>(null);
  const [changes, setChanges] = useState<GlossaryChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const passageKey = passage ? `${passage.book}.${passage.chapter}.${passage.from}.${passage.to}` : "";

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [loaded, ctx] = await Promise.all([
        loadGlossary(session, owner, lang),
        passage ? loadPassageContext({ session, owner, lang, ...passage }).catch(() => null) : Promise.resolve(null),
      ]);
      setGlossary(loaded);
      setContext(ctx);
      setChanges(await loadGlossaryChanges(session, loaded).catch(() => []));
      if (!canManage && pmOrg) {
        const book = await loadPmConfig(session, pmOrg).catch(() => null);
        const me = session.username.toLowerCase();
        setCanAgree(Boolean(book) && (book!.levels?.[me] === "habilitada" || Object.values(book!.coordinators ?? {}).some((list) => list.includes(me))));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, owner, lang, passageKey, pmOrg, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = glossary?.entries ?? [];
  const passageWords = useMemo(() => (context?.verses ?? []).flatMap((verse) => verse.groups.flatMap((group) => group.sources)), [context]);
  const passageText = useMemo(() => (context?.verses ?? []).map((verse) => verse.words.map((w) => w.text).join(" ")).join(" "), [context]);
  const shown = useMemo(() => {
    if (view === "pending") return entries.filter((entry) => entry.status === "proposed");
    if (view === "passage") return entriesForPassage(entries, passageWords, passageText);
    return query.trim() ? searchGlossary(entries, query) : [];
  }, [view, entries, passageWords, passageText, query]);

  /** Tap a word of the English text: the word(s) of the original under it, small words left out. */
  function pick(ref: string, word: string, occurrence: number) {
    const verse = context?.verses.find((v) => v.ref === ref);
    const group = verse ? groupOfWord(verse.groups, word, occurrence) : undefined;
    if (!group) return announce(t("gl.notAligned"));
    const key = `${ref}|${word}|${occurrence}`;
    setPicked((prev) => (prev.some((p) => `${p.ref}|${p.word}` === `${ref}|${word}`) ? prev.filter((p) => `${p.ref}|${p.word}` !== `${ref}|${word}`) : [...prev, { ref, word: word.replace(/[^\p{L}\p{N}\p{M}'’-]/gu, ""), sources: contentSources(group), offered: group.sources }]));
    void key;
  }

  /** The entry of what was tapped: the one that exists for that word, or a new one. Several taps make an expression. */
  function openPicked() {
    if (!picked.length) return;
    const sources = picked.flatMap((p) => p.sources).filter((s, i, all) => all.findIndex((x) => baseStrong(x.strong) === baseStrong(s.strong)) === i);
    const strong = sources.map((s) => baseStrong(s.strong)).filter(Boolean).join(";");
    const existing = entries.find((entry) => entry.strong === strong && strong);
    if (existing) setDraft({ entry: existing, before: existing });
    else setDraft({ entry: entryFromSources({ id: newGlossaryId(entries.map((e) => e.id)), sources, english: picked.map((p) => p.word).join(" "), example: picked[0]!.ref }) });
    setPicked([]);
  }

  async function save(status?: GlossaryEntry["status"]) {
    if (!draft) return;
    const entry = { ...draft.entry, status: status ?? draft.entry.status };
    setSaving(true);
    setError("");
    try {
      const result = await saveGlossaryEntry({ session, owner, lang, entry, before: draft.before, reason: entry.note });
      if (result.status === "saved") {
        setGlossary((prev) => (prev ? { ...prev, exists: true, entries: prev.entries.some((e) => e.id === entry.id) ? prev.entries.map((e) => (e.id === entry.id ? entry : e)) : [...prev.entries, entry] } : prev));
        announce(t("gl.saved"));
      } else {
        announce(t("gl.proposed"));
      }
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /** Who may agree settles a proposed change: it becomes the decision, or it is dropped. */
  async function settle(change: GlossaryChange, accept: boolean) {
    if (!glossary) return;
    setSaving(true);
    setError("");
    try {
      await settleGlossaryChange(session, glossary, change, accept);
      setChanges((prev) => prev.filter((row) => row.number !== change.number));
      if (accept) setGlossary({ ...glossary, entries: glossary.entries.map((entry) => (entry.id === change.after.id ? change.after : entry)) });
      announce(t(accept ? "gl.changeAccepted" : "gl.changeDropped"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const field = (label: MessageKey, value: string, onChange: (value: string) => void, hint?: MessageKey, rows = 1) => (
    <label className="gl-field">
      <span className="af-lbl">{t(label)}</span>
      {rows > 1 ? <textarea className="af-textarea" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /> : <input className="af-input" value={value} onChange={(e) => onChange(e.target.value)} />}
      {hint ? <span className="af-hint">{t(hint)}</span> : null}
    </label>
  );

  const before = (entry: GlossaryEntry) => (context ? renderingsOf(entry.strong.split(";")[0] ?? "", context.teamVerses) : []);

  return (
    <div className="af gl">
      <header className="af-head">
        <button type="button" className="af-back" onClick={onClose} aria-label={t("af.back")}>
          {t("af.backArrow")}
        </button>
        <div className="af-title">
          <h1>{t("gl.title")}</h1>
          <p>{passage ? `${passage.book} ${passage.chapter}${passage.to >= 200 ? "" : passage.from === passage.to ? `:${passage.from}` : `:${passage.from}–${passage.to}`}` : t("gl.lede")}</p>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("gl.loading")}</p> : null}

      {glossary && !draft ? (
        <>
          <div className="gl-views" role="tablist" aria-label={t("gl.title")}>
            {([...(passage ? (["passage"] as View[]) : []), "search", "pending"] as View[]).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}>
                {t(id === "passage" ? "gl.viewPassage" : id === "search" ? "gl.viewSearch" : "gl.viewPending")}
                {id === "pending" ? ` (${entries.filter((e) => e.status === "proposed").length + changes.length})` : ""}
              </button>
            ))}
          </div>

          {view === "search" ? (
            <label className="gl-field">
              <span className="af-lbl">{t("gl.search")}</span>
              <input className="af-input" type="search" value={query} placeholder={t("gl.searchHint")} onChange={(e) => setQuery(e.target.value)} />
            </label>
          ) : null}

          {view === "passage" && context ? (
            <section className="af-card" aria-label={t("gl.tapTitle")}>
              <h2 className="af-phrase">{t("gl.tapTitle")}</h2>
              <p className="af-hint">{t("gl.tapHint")}</p>
              {context.verses.map((verse) => (
                <p key={verse.ref} className="gl-verse">
                  <b>{verse.verse}</b>{" "}
                  {verse.words.map((word, index) => {
                    const group = groupOfWord(verse.groups, word.text, word.occurrence);
                    const on = picked.some((p) => p.ref === verse.ref && p.word === word.text.replace(/[^\p{L}\p{N}\p{M}'’-]/gu, ""));
                    // A small word standing alone is plain text: tapping it would only make a noisy entry.
                    return group && group.sources.some(isContentWord) ? (
                      <button key={index} type="button" className="gl-word" aria-pressed={on} onClick={() => pick(verse.ref, word.text, word.occurrence)}>
                        {word.text}
                      </button>
                    ) : (
                      <span key={index}>{word.text} </span>
                    );
                  })}
                </p>
              ))}
              {picked.length ? (
                <div className="af-buttons">
                  <Button type="button" onClick={openPicked}>
                    {t("gl.openPicked").replace("{words}", picked.map((p) => p.word).join(" "))}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setPicked([])}>
                    {t("af.cancel")}
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {view === "pending" && changes.length ? (
            <ul className="gl-list">
              {changes.map((change) => (
                <li key={change.number} className="af-card">
                  <p className="gl-entry__head">
                    <b>{change.before.rendering} → {change.after.rendering}</b>
                    <span className="af-lbl">{t("gl.changeBy").replace("{who}", change.by)}</span>
                  </p>
                  <p className="af-hint">{change.after.lemma}{change.after.english.length ? ` · ${change.after.english.join(", ")}` : ""}</p>
                  {change.after.note && change.after.note !== change.before.note ? <p className="af-note">{change.after.note}</p> : null}
                  {canAgree ? (
                    <div className="af-buttons">
                      <Button type="button" size="sm" disabled={saving} onClick={() => void settle(change, true)}>
                        {t("gl.changeAccept")}
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void settle(change, false)}>
                        {t("gl.changeDrop")}
                      </Button>
                    </div>
                  ) : (
                    <p className="af-hint">{t("gl.changeWaits")}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {!shown.length && !(view === "pending" && changes.length) ? (
            <p className="hub-hint">{t(view === "search" ? (query.trim() ? "gl.noneFound" : "gl.typeToSearch") : view === "pending" ? "gl.nonePending" : "gl.nonePassage")}</p>
          ) : (
            <ul className="gl-list">
              {shown.map((entry) => {
                const used = before(entry);
                const away = context ? departuresFrom(entry, context.teamVerses) : [];
                return (
                  <li key={entry.id} className="af-card" data-status={entry.status}>
                    <p className="gl-entry__head">
                      <b>{entry.rendering || t("gl.noRendering")}</b>
                      <span className="af-lbl">{t(entry.status === "agreed" ? "gl.agreed" : "gl.proposal")} · {t(SCOPE_KEY[entry.scope])}</span>
                    </p>
                    <p className="af-hint">
                      {entry.lemma}
                      {entry.english.length ? ` · ${entry.english.join(", ")}` : ""}
                      {entry.sense ? ` · ${entry.sense}` : ""}
                    </p>
                    {entry.alternatives.length ? <p>{t("gl.also")} {join(entry.alternatives)}</p> : null}
                    {entry.avoid.length ? <p>{t("gl.avoid")} {join(entry.avoid)}</p> : null}
                    {entry.note ? <p className="af-note">{entry.note}</p> : null}
                    {used.length ? (
                      <p className="af-hint">
                        {t("gl.before")} {used.slice(0, 5).map((r) => `${r.rendering} (${r.count})`).join(", ")}
                      </p>
                    ) : null}
                    {away.length ? <p className="af-stale">{t("gl.departs")} {away.map((r) => `${r.rendering} · ${r.examples.join(", ")}`).join("; ")}</p> : null}
                    <div className="af-buttons">
                      <Button type="button" size="sm" variant="outline" onClick={() => setDraft({ entry, before: entry })}>
                        {t(entry.status === "agreed" ? "gl.proposeChange" : "gl.edit")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {draft ? (
        <section className="af-card" aria-label={t("gl.entry")}>
          <h2 className="af-phrase">
            {draft.entry.lemma} {draft.entry.english.length ? `· ${draft.entry.english.join(", ")}` : ""}
          </h2>
          {draft.before?.status === "agreed" ? <p className="af-stale">{t("gl.agreedHint")}</p> : null}
          {context && before(draft.entry).length ? (
            <p className="af-hint">
              {t("gl.before")} {before(draft.entry).slice(0, 6).map((r) => `${r.rendering} (${r.count})`).join(", ")}
            </p>
          ) : null}
          {field("gl.fRendering", draft.entry.rendering, (rendering) => setDraft({ ...draft, entry: { ...draft.entry, rendering } }))}
          {field("gl.fSense", draft.entry.sense, (sense) => setDraft({ ...draft, entry: { ...draft.entry, sense } }))}
          {field("gl.fAlternatives", join(draft.entry.alternatives), (text) => setDraft({ ...draft, entry: { ...draft.entry, alternatives: split(text) } }), "gl.fAlternativesHint")}
          {field("gl.fAvoid", join(draft.entry.avoid), (text) => setDraft({ ...draft, entry: { ...draft.entry, avoid: split(text) } }), "gl.fAvoidHint")}
          <label className="gl-field">
            <span className="af-lbl">{t("gl.fScope")}</span>
            <select className="af-input" value={draft.entry.scope} onChange={(e) => setDraft({ ...draft, entry: { ...draft.entry, scope: e.target.value as GlossaryScope } })}>
              {(Object.keys(SCOPE_KEY) as GlossaryScope[]).map((scope) => (
                <option key={scope} value={scope}>{t(SCOPE_KEY[scope])}</option>
              ))}
            </select>
          </label>
          {field("gl.fNote", draft.entry.note, (note) => setDraft({ ...draft, entry: { ...draft.entry, note } }), undefined, 3)}
          <div className="af-buttons">
            <Button type="button" size="lg" disabled={saving || !draft.entry.rendering.trim()} onClick={() => void save()}>
              {saving ? t("af.saving") : t(draft.before?.status === "agreed" ? "gl.sendProposal" : "gl.save")}
            </Button>
            {canAgree && draft.entry.status === "proposed" ? (
              <Button type="button" size="lg" variant="outline" disabled={saving || !draft.entry.rendering.trim()} onClick={() => void save("agreed")}>
                {t("gl.saveAgreed")}
              </Button>
            ) : null}
            <Button type="button" size="lg" variant="secondary" disabled={saving} onClick={() => setDraft(null)}>
              {t("af.cancel")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
