import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { uid } from "../domain/assignment";
import { formatWhen, parseWhen } from "../domain/stepChecks";
import type { StepCheck } from "../domain/types";
import { useT } from "../i18n/messages";

type Props = {
  checks: StepCheck[];
  onChange: (next: StepCheck[]) => void;
  canEdit: boolean;
  language: string;
};

/**
 * The checks of a step, as a list to read first and edit one at a time. Each one is a line: what it asks, and whether
 * it always shows or only where the source has certain words. Touching a line opens it; only one is open. On a phone
 * eleven checks are eleven lines, not twenty-two boxes.
 */
export function ChecksEditor({ checks, onChange, canEdit, language }: Props) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const textOf = (check: StepCheck) => check.texts?.[language] ?? check.text;
  const patch = (id: string, next: Partial<StepCheck>) => onChange(checks.map((check) => (check.id === id ? { ...check, ...next } : check)));
  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= checks.length) return;
    const next = [...checks];
    [next[index], next[to]] = [next[to]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="ce">
      {checks.length ? (
        <ol className="ce-list">
          {checks.map((check, index) => {
            const isOpen = open === check.id;
            return (
              <li key={check.id} className="ce-item" data-open={isOpen ? "true" : undefined}>
                <button type="button" className="ce-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : check.id)}>
                  {isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                  <span className="ce-row__text">{textOf(check) || t("st.checkEmpty")}</span>
                  <span className="ce-row__when" data-always={check.when?.length ? undefined : "true"}>
                    {check.when?.length ? t("st.checkIf").replace("{words}", formatWhen(check.when)) : t("st.checkAlways")}
                  </span>
                </button>
                {isOpen ? (
                  <div className="ce-edit">
                    <label className="ce-field">
                      <span>{t("st.checkText")}</span>
                      <textarea
                        className="af-textarea"
                        rows={3}
                        value={textOf(check)}
                        disabled={!canEdit}
                        autoFocus={canEdit && !textOf(check)}
                        onChange={(e) => patch(check.id, check.texts?.[language] !== undefined ? { texts: { ...check.texts, [language]: e.target.value } } : { text: e.target.value })}
                      />
                    </label>
                    <label className="ce-field">
                      <span>{t("st.checkWhenLabel")}</span>
                      {/* Kept as typed until the person leaves the field, so that a comma can be written. */}
                      <input
                        className="af-input"
                        key={`${check.id}-${formatWhen(check.when)}`}
                        defaultValue={formatWhen(check.when)}
                        disabled={!canEdit}
                        placeholder={t("st.checkWhenExample")}
                        autoCapitalize="none"
                        spellCheck={false}
                        onBlur={(e) => patch(check.id, { when: parseWhen(e.target.value) })}
                      />
                      <small>{t("st.checkWhenHint")}</small>
                    </label>
                    {canEdit ? (
                      <div className="ce-actions">
                        <button type="button" className="pe-icon" disabled={index === 0} aria-label={t("st.checkUp").replace("{n}", String(index + 1))} title={t("st.checkUp").replace("{n}", String(index + 1))} onClick={() => move(index, -1)}>
                          <ArrowUp size={16} aria-hidden />
                        </button>
                        <button type="button" className="pe-icon" disabled={index === checks.length - 1} aria-label={t("st.checkDown").replace("{n}", String(index + 1))} title={t("st.checkDown").replace("{n}", String(index + 1))} onClick={() => move(index, 1)}>
                          <ArrowDown size={16} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="ce-remove"
                          onClick={() => {
                            onChange(checks.filter((row) => row.id !== check.id));
                            setOpen(null);
                          }}
                        >
                          <Trash2 size={16} aria-hidden /> {t("st.checkRemoveShort")}
                        </button>
                        <button type="button" className="btn ce-done" data-size="sm" onClick={() => setOpen(null)}>
                          {t("st.checkDone")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="pe-hint">{t("st.checksNone")}</p>
      )}
      {canEdit ? (
        <button
          type="button"
          className="pe-add"
          onClick={() => {
            const id = `c-${uid().slice(0, 6)}`;
            onChange([...checks, { id, text: "" }]);
            setOpen(id);
          }}
        >
          <Plus size={14} aria-hidden /> {t("st.checkAdd")}
        </button>
      ) : null}
    </div>
  );
}
