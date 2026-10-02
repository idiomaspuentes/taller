import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uid } from "../domain/assignment";
import type { SolverApp } from "../domain/solvers";
import type { ChecklistQuestion, StepClosing, TaskStep } from "../domain/types";
import { useT, type MessageKey } from "../i18n/messages";
import { StepClaimPolicyPanel } from "./StepClaimPolicyPanel";

type Props = {
  steps: TaskStep[];
  onChange: (next: TaskStep[]) => void;
  /** The tools a step may open. */
  tools: SolverApp[];
  canManage?: boolean;
};

const CLOSINGS: StepClosing[] = ["self", "approval", "consensus", "checklist", "automatic"];
const CLOSING_KEY: Record<StepClosing, MessageKey> = { self: "st.closeSelf", approval: "st.closeApproval", consensus: "st.closeConsensus", checklist: "st.closeChecklist", automatic: "st.closeAutomatic" };
const CLOSING_HELP: Record<StepClosing, MessageKey> = { self: "st.helpSelf", approval: "st.helpApproval", consensus: "st.helpConsensus", checklist: "st.helpChecklist", automatic: "st.helpAutomatic" };
type Scope = NonNullable<TaskStep["scope"]>;
const SCOPES: Scope[] = ["subtask", "unit", "chapter-once"];
const SCOPE_KEY: Record<Scope, MessageKey> = { subtask: "st.scopeSubtask", unit: "st.scopeUnit", "chapter-once": "st.scopeOnce" };

/**
 * The steps of a task: the one editor used by the templates screen and by a project's «Fases y tareas». Every
 * setting a process can give a step is here, so nothing has to be edited in a file: its name and button, the tool
 * it opens, who takes it, how it is completed, what it covers and the questions it asks.
 */
export function StepsEditor({ steps, onChange, tools, canManage = true }: Props) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState<string | null>(null);

  const patch = (id: string, next: Partial<TaskStep>) => onChange(steps.map((step) => (step.id === id ? { ...step, ...next } : step)));
  const move = (id: string, dir: -1 | 1) => {
    const at = steps.findIndex((step) => step.id === id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= steps.length) return;
    const next = [...steps];
    [next[at], next[to]] = [next[to]!, next[at]!];
    onChange(next);
  };
  const questionsOf = (step: TaskStep): ChecklistQuestion[] => step.checklist ?? [];
  const setQuestions = (step: TaskStep, next: ChecklistQuestion[]) => patch(step.id, { checklist: next.length ? next : undefined });

  return (
    <div className="grid gap-2">
      {steps.length ? (
        <ol className="wf-steps">
          {steps.map((step, index) => {
            const n = String(index + 1);
            const closing: StepClosing = step.closing ?? (step.claimMode === "exclusive" || step.claimMode === "pool" ? "approval" : "self");
            const asksQuestions = closing === "checklist" || (closing === "approval" && Boolean(step.solverAppId));
            const isOpen = open === step.id;
            return (
              <li key={step.id} className="wf-step">
                <div className="wf-step__lead">
                  <span className="wf-step__index" aria-hidden>
                    {n}
                  </span>
                  {canManage && steps.length > 1 ? (
                    <div className="wf-step__reorder">
                      <button type="button" className="wf-step__reorder-btn" disabled={index === 0} aria-label={t("tv.stepUp").replace("{n}", n)} onClick={() => move(step.id, -1)}>
                        ↑
                      </button>
                      <button type="button" className="wf-step__reorder-btn" disabled={index >= steps.length - 1} aria-label={t("tv.stepDown").replace("{n}", n)} onClick={() => move(step.id, 1)}>
                        ↓
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="wf-step__body">
                  <Input value={step.name} disabled={!canManage} className="wf-step__name" aria-label={t("tv.stepN").replace("{n}", n)} placeholder={t("tv.stepN").replace("{n}", n)} onChange={(e) => patch(step.id, { name: e.target.value })} />
                  <div className="wf-step__tool">
                    <Select value={step.solverAppId || "none"} disabled={!canManage} onValueChange={(value) => patch(step.id, { solverAppId: value === "none" ? undefined : value })}>
                      <SelectTrigger className="h-9 w-full max-w-[16rem]" aria-label={t("tv.toolAria")}>
                        <SelectValue placeholder={t("tv.toolAria")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("tv.noTool")}</SelectItem>
                        {tools.map((app) => (
                          <SelectItem key={app.id} value={app.id}>
                            {app.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <StepClaimPolicyPanel step={step} steps={steps} stepIndex={index} expanded={claimOpen === step.id} onExpandedChange={(on) => setClaimOpen(on ? step.id : null)} onChange={(next) => patch(step.id, next)} canManage={canManage} />

                  <p className="text-xs text-muted-foreground">
                    {t("st.closesWhen")} {t(CLOSING_KEY[closing])}
                    {canManage ? (
                      <>
                        {" · "}
                        <button type="button" className="underline" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : step.id)}>
                          {t(isOpen ? "st.less" : "st.more")}
                        </button>
                      </>
                    ) : null}
                  </p>

                  {isOpen && canManage ? (
                    <div className="st-settings">
                      <label className="st-field">
                        <span>{t("st.closing")}</span>
                        <select className="af-input" value={closing} onChange={(e) => patch(step.id, { closing: e.target.value as StepClosing })}>
                          {CLOSINGS.map((id) => (
                            <option key={id} value={id}>
                              {t(CLOSING_KEY[id])}
                            </option>
                          ))}
                        </select>
                        <small>{t(CLOSING_HELP[closing])}</small>
                      </label>

                      {closing === "consensus" ? (
                        <label className="st-field">
                          <span>{t("st.rule")}</span>
                          <select className="af-input" value={step.decisionRule ?? "unanimous"} onChange={(e) => patch(step.id, { decisionRule: e.target.value as TaskStep["decisionRule"] })}>
                            <option value="unanimous">{t("st.ruleUnanimous")}</option>
                            <option value="majority">{t("st.ruleMajority")}</option>
                          </select>
                        </label>
                      ) : null}

                      <label className="st-field">
                        <span>{t("st.scope")}</span>
                        <select className="af-input" value={step.scope ?? "subtask"} onChange={(e) => patch(step.id, { scope: e.target.value === "subtask" ? undefined : (e.target.value as Scope) })}>
                          {SCOPES.map((id) => (
                            <option key={id} value={id}>
                              {t(SCOPE_KEY[id])}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="st-field">
                        <span>{t("st.button")}</span>
                        <input className="af-input" value={step.actionLabel ?? ""} placeholder={t("st.buttonHint")} onChange={(e) => patch(step.id, { actionLabel: e.target.value || undefined })} />
                      </label>

                      <label className="st-field">
                        <span>{t("st.description")}</span>
                        <textarea className="af-textarea" rows={2} value={step.description ?? ""} onChange={(e) => patch(step.id, { description: e.target.value || undefined })} />
                      </label>

                      {asksQuestions ? (
                        <div className="st-field">
                          <span>{t("st.questions")}</span>
                          <small>{t("st.questionsHint")}</small>
                          {questionsOf(step).map((question, at) => (
                            <div key={question.id} className="st-question">
                              <textarea
                                className="af-textarea"
                                rows={2}
                                value={question.text}
                                aria-label={t("st.questionN").replace("{n}", String(at + 1))}
                                onChange={(e) => setQuestions(step, questionsOf(step).map((row) => (row.id === question.id ? { ...row, text: e.target.value } : row)))}
                              />
                              <label className="st-check">
                                <input type="checkbox" checked={question.per === "verse"} onChange={(e) => setQuestions(step, questionsOf(step).map((row) => (row.id === question.id ? { ...row, per: e.target.checked ? "verse" : undefined } : row)))} />
                                {t("st.questionPerVerse")}
                              </label>
                              <Button type="button" size="sm" variant="ghost" aria-label={t("st.questionRemove").replace("{n}", String(at + 1))} onClick={() => setQuestions(step, questionsOf(step).filter((row) => row.id !== question.id))}>
                                ×
                              </Button>
                            </div>
                          ))}
                          <button type="button" className="wf-add-step" onClick={() => setQuestions(step, [...questionsOf(step), { id: `q-${uid().slice(0, 6)}`, text: "" }])}>
                            {t("st.questionAdd")}
                          </button>
                        </div>
                      ) : null}

                      <Button type="button" size="sm" variant="ghost" className="justify-self-start text-destructive" onClick={() => onChange(steps.filter((row) => row.id !== step.id))}>
                        {t("wf.removeStep")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {canManage ? (
        <button type="button" className="wf-add-step" onClick={() => onChange([...steps, { id: uid(), name: t("tv.stepDefault") }])}>
          {t("wf.addStep")}
        </button>
      ) : null}
    </div>
  );
}
