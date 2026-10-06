import { useMemo, useState } from "react";
import { namedWordings, type GlossaryEntry } from "../domain/glossary";
import { sourceWords } from "../domain/stepChecks";
import { useT } from "../i18n/messages";

type Props = {
  /** What the comment says: what the rule starts as. */
  text: string;
  /** The source of what the comment is about (a verse, a note, a paragraph); none for a comment on the whole draft. */
  source?: string | null;
  busy: boolean;
  /** What to say when it could not be kept; nothing when it has not failed. */
  failed?: string;
  onSave: (text: string, when: string[]) => void;
  /**
   * What the words touched lead to in the glossary: how the verse says them, and the decision there is already, if
   * any. Null when they cannot be filed there (a word that is not aligned with the original, a comment on a note).
   */
  decide?: (words: string[]) => { english: string; existing?: GlossaryEntry; other?: GlossaryEntry } | null;
  onDecide?: (words: string[], rendering: string, why: string) => void;
  onCancel: () => void;
};

/**
 * A comment of a review kept for the next time. What a reviewer tells one person about one verse («aquí es
 * "Jacobo", no "Santiago"») is often true of every verse that says the same. It is written already: the comment is
 * the rule, to retouch. And which words call for it are in sight: the source of the verse the comment is about, a
 * word at a time to touch, so nobody types a word of another language. With words, the rule is said at every verse
 * that has one of them; without, once for the whole step.
 *
 * Many of those comments are how a word is translated, and that is not a rule of one team: it is a decision of the
 * glossary, for every team and every text. Nobody has to know the difference. When a word is touched the form asks
 * how it is translated, with the wordings the comment names to touch; answered, it goes to the glossary, filed by the
 * word of the original under the one touched. Left unanswered, it is a rule of the team as before.
 */
export function CommentAsRule({ text, source, busy, failed, onSave, decide, onDecide, onCancel }: Props) {
  const t = useT();
  const [rule, setRule] = useState(() => text.trim().replace(/\s+/g, " ").slice(0, 240));
  const [picked, setPicked] = useState<string[]>([]);
  const [rendering, setRendering] = useState("");
  const words = useMemo(() => (source ? sourceWords(source) : []), [source]);
  const options = useMemo(() => namedWordings(text), [text]);
  const toggle = (word: string) => setPicked((now) => (now.includes(word) ? now.filter((other) => other !== word) : [...now, word]));
  // As the source says them and in its order: an entry filed by its English word alone keeps it as it is written.
  const said = words.filter((word) => picked.includes(word.toLowerCase()));
  const target = said.length && decide && onDecide ? decide(said) : null;
  const taken = target?.existing?.rendering.trim() ? target.existing : null;
  const answer = target && !taken ? rendering.trim() : "";
  return (
    <div className="rule-from">
      <label className="rule-from__field">
        <span>{t("rv.ruleText")}</span>
        <textarea className="af-textarea" rows={2} maxLength={240} value={rule} disabled={busy} onChange={(e) => setRule(e.target.value)} />
      </label>
      {words.length ? (
        <>
          {/* Said until a word is touched: after that the form has its own next question, and less to read. */}
          {picked.length ? null : <p className="rule-from__hint">{t("rv.ruleWords")}</p>}
          <div className="rule-from__words">
            {words.map((word) => (
              <button key={word} type="button" className="rule-from__word" aria-pressed={picked.includes(word.toLowerCase())} disabled={busy} onClick={() => toggle(word.toLowerCase())}>
                {word}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="rule-from__hint">{t("rv.ruleAlways")}</p>
      )}
      {taken ? (
        <p className="rule-from__has">
          {t("rv.inGlossary")} «{target!.english}» → «{taken.rendering}»
        </p>
      ) : target ? (
        <div className="rule-from__decide">
          <p className="rule-from__q">{t("rv.howTranslated").replace("{word}", target.english)}</p>
          {/* The same word of the original, as the other English text says it, has its decision: said, not imposed. */}
          {target.other ? <p className="rule-from__hint">{t("rv.otherDecision").replace("{word}", target.other.english[0] ?? target.other.lemma).replace("{rendering}", target.other.rendering)}</p> : null}
          {options.length ? (
            <div className="rule-from__words">
              {options.map((option) => (
                <button key={option} type="button" className="rule-from__word" aria-pressed={rendering === option} disabled={busy} onClick={() => setRendering(rendering === option ? "" : option)}>
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          <input className="af-input" value={options.includes(rendering) ? "" : rendering} maxLength={80} placeholder={t(options.length ? "rv.orWrite" : "rv.writeIt")} aria-label={t("rv.howTranslated").replace("{word}", target.english)} disabled={busy} onChange={(e) => setRendering(e.target.value)} />
          <p className="rule-from__hint">{answer ? t("rv.goesToGlossary").replace("{word}", target.english).replace("{rendering}", answer) : t("rv.glossaryHint")}</p>
        </div>
      ) : null}
      {failed ? <p className="af-stale">{failed}</p> : null}
      <div className="rule-from__acts">
        <button type="button" className="btn" data-size="default" data-variant="ghost" disabled={busy} onClick={onCancel}>
          {t("pj.cancel")}
        </button>
        {answer ? (
          <button type="button" className="btn" data-size="default" data-variant="default" disabled={busy} onClick={() => onDecide!(said, answer, rule.trim())}>
            {busy ? t("sa.saving") : t("rv.decisionSave")}
          </button>
        ) : (
          <button type="button" className="btn" data-size="default" data-variant="default" disabled={busy || !rule.trim()} onClick={() => onSave(rule, picked)}>
            {busy ? t("sa.saving") : t("rv.ruleSave")}
          </button>
        )}
      </div>
    </div>
  );
}
