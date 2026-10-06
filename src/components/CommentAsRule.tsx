import { useMemo, useState } from "react";
import { sourceWords } from "../domain/stepChecks";
import { useT } from "../i18n/messages";

type Props = {
  /** What the comment says: what the rule starts as. */
  text: string;
  /** The source of what the comment is about (a verse, a note, a paragraph); none for a comment on the whole draft. */
  source?: string | null;
  busy: boolean;
  failed: boolean;
  onSave: (text: string, when: string[]) => void;
  onCancel: () => void;
};

/**
 * A comment of a review turned into a rule of the team. What a reviewer tells one person about one verse («aquí es
 * "Jacobo", no "Santiago"») is often true of every verse that says the same, and that is where a team's rules come
 * from. It is written already: the comment is the rule, to retouch. And which words call for it are in sight: the
 * source of the verse the comment is about, a word at a time to touch, so nobody types a word of another language.
 * With words, the rule is said at every verse that has one of them; without, once for the whole step.
 */
export function CommentAsRule({ text, source, busy, failed, onSave, onCancel }: Props) {
  const t = useT();
  const [rule, setRule] = useState(() => text.trim().replace(/\s+/g, " ").slice(0, 240));
  const [picked, setPicked] = useState<string[]>([]);
  const words = useMemo(() => (source ? sourceWords(source) : []), [source]);
  const toggle = (word: string) => setPicked((now) => (now.includes(word) ? now.filter((other) => other !== word) : [...now, word]));
  return (
    <div className="rule-from">
      <label className="rule-from__field">
        <span>{t("rv.ruleText")}</span>
        <textarea className="af-textarea" rows={3} maxLength={240} value={rule} disabled={busy} onChange={(e) => setRule(e.target.value)} />
      </label>
      {words.length ? (
        <>
          <p className="rule-from__hint">{t("rv.ruleWords")}</p>
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
      {failed ? <p className="af-stale">{t("sa.ruleError")}</p> : null}
      <div className="rule-from__acts">
        <button type="button" className="btn" data-size="default" data-variant="ghost" disabled={busy} onClick={onCancel}>
          {t("pj.cancel")}
        </button>
        <button type="button" className="btn" data-size="default" data-variant="default" disabled={busy || !rule.trim()} onClick={() => onSave(rule, picked)}>
          {busy ? t("sa.saving") : t("rv.ruleSave")}
        </button>
      </div>
    </div>
  );
}
