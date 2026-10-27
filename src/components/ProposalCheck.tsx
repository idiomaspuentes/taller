import { useState, type ReactNode } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { useT } from "../i18n/messages";

/** The questions of one step of the note (TPL, TPS, Academia…), with what they are read against. */
export type ProposalCheckGroup = { about: string; label: string; reference?: string; questions: { id: string; text: string }[] };

/**
 * A proposal checked as the note is (Abel, 27 October): the same steps, one at a time, each with its text and its
 * questions, the proposal instead of the note. It was chosen with a touch, without looking at it with the questions
 * the note had been looked at with. A «no» says what fails, or leads to suggesting an adjustment instead.
 */
export function ProposalCheck({
  lead,
  groups,
  mine,
  change,
  saving,
  onMark,
  onAdjust,
  onDone,
}: {
  /** «Comprobando la propuesta de @ana» */
  lead: string;
  groups: ProposalCheckGroup[];
  /** What this person already marked of the proposal, by question. */
  mine: Record<string, "yes" | "no">;
  /** The proposal against the note as it is, as the list of options shows it. */
  change: ReactNode;
  saving?: boolean;
  onMark: (questionId: string, value: "yes" | "no", note?: string) => Promise<void> | void;
  onAdjust?: () => void;
  onDone: () => void;
}) {
  const t = useT();
  // It starts at the first step with something left to mark.
  const [at, setAt] = useState(() => Math.max(0, groups.findIndex((group) => group.questions.some((q) => mine[q.id] !== "yes"))));
  const [why, setWhy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const group = groups[Math.min(at, groups.length - 1)];
  if (!group) return null;
  const last = at >= groups.length - 1;
  const saveNo = async (questionId: string) => {
    if (!draft.trim()) return;
    await onMark(questionId, "no", draft.trim());
    setWhy(null);
    setDraft("");
  };
  return (
    <section className="ck-pcheck" aria-label={lead}>
      <p className="ck-pcheck__lead">{lead}</p>
      <p className="ck-pcheck__step">
        {t("ck.checkStep").replace("{label}", group.label).replace("{a}", String(at + 1)).replace("{b}", String(groups.length))}
      </p>
      {group.reference ? <p className="ck-pcheck__ref">{group.reference}</p> : null}
      <div className="ck-pcheck__change">{change}</div>
      <ul className="ck-pcheck__questions">
        {group.questions.map((question) => {
          const said = mine[question.id];
          return (
            <li key={question.id} className="ck-pcheck__q">
              <p className="ck-pcheck__text">{question.text}</p>
              <div className="ck-pcheck__answers" role="group" aria-label={question.text}>
                <button type="button" className="btn" data-variant={said === "yes" ? "default" : "outline"} data-size="default" aria-pressed={said === "yes"} disabled={saving} onClick={() => {
                  if (why === question.id) setWhy(null);
                  void onMark(question.id, "yes");
                }}>
                  <Check size={16} aria-hidden /> {t("ck.checkYes")}
                </button>
                <button type="button" className="btn" data-variant={said === "no" ? "default" : "outline"} data-size="default" aria-pressed={said === "no"} aria-expanded={why === question.id} disabled={saving} onClick={() => setWhy(why === question.id ? null : question.id)}>
                  <X size={16} aria-hidden /> {t("ck.checkNo")}
                </button>
              </div>
              {why === question.id ? (
                // A «no» says what fails: the team reads it in the conversation of the proposal.
                <form
                  className="ck-pcheck__why"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveNo(question.id);
                  }}
                >
                  <label className="ck-pcheck__whyLabel" htmlFor={`ck-why-${question.id}`}>
                    {t("ck.checkNoWhy")}
                  </label>
                  <textarea id={`ck-why-${question.id}`} className="af-textarea" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} />
                  <div className="ck-pcheck__whyActs">
                    <button type="submit" className="btn" data-variant="default" data-size="default" disabled={!draft.trim() || saving}>
                      {t("ck.checkNoSave")}
                    </button>
                    {onAdjust ? (
                      <button type="button" className="af-link" onClick={onAdjust}>
                        {t("ck.checkAdjustInstead")}
                      </button>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="ck-pcheck__nav">
        <button
          type="button"
          className="btn"
          data-variant="outline"
          data-size="lg"
          disabled={saving}
          onClick={() => {
            setWhy(null);
            if (last) onDone();
            else setAt(at + 1);
          }}
        >
          {last ? t("ck.checkDone") : t("ck.checkNext")} {last ? null : <ChevronRight size={18} aria-hidden />}
        </button>
      </div>
    </section>
  );
}
