import { rememberTemplateUsed, usualTemplate } from "../lastTemplate";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { StartStage } from "../dcs/startBook";
import { BOOKS, bookLabel } from "../domain/books";
import { bookSize, phasesAtStart, startNotices, type StartNotice } from "../domain/startBook";
import { PhaseTeamsPanel } from "./PhaseTeamsPanel";
import type { AssignmentsDoc, InventoryDoc } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { localizeName } from "../domain/templateNames";
import { explainError } from "../dcs/userError";

export type StartTemplateOption = {
  id: string;
  name: string;
  description?: string;
  phases: number;
  tasks: number;
  /** A walkthrough of a process: done on one chapter, on a test server. */
  trial?: boolean;
};
export type StartedProject = { board: AssignmentsDoc; inventory: InventoryDoc; created: number };

type Props = {
  templates: StartTemplateOption[];
  /** Books that already have a project: they are opened, not started again. */
  taken: string[];
  onStart: (input: { book: string; workflowId: string; chapter?: number }, onStage: (stage: StartStage, detail?: string) => void) => Promise<StartedProject>;
  /** Prepare the project without creating it: the process can be adjusted first. An empty `workflowId` starts from nothing. */
  onAdjust?: (input: { book: string; workflowId: string }) => Promise<void>;
  onOpen: (projectId: string, step: "subtareas" | "tareas") => void;
  onGoToTasks: () => void;
  onCancel: () => void;
  /** Choosing one team per phase right after starting. Absent = the project's own screen is the only way. */
  phaseTeams?: Pick<Parameters<typeof PhaseTeamsPanel>[0], "loadTeams" | "onSave" | "onAllowEdit">;
};

const STAGES: StartStage[] = ["process", "reading", "saving", "tasks"];
const STAGE_KEY: Record<StartStage, MessageKey> = { process: "sb.stageProcess", reading: "sb.stageReading", saving: "sb.stageSaving", tasks: "sb.stageTasks" };
const NOTICE_KEY: Record<StartNotice, MessageKey> = { "no-notes": "sb.noNotes", "no-questions": "sb.noQuestions", "no-second-text": "sb.noSecondText" };

/**
 * «Empezar un libro»: which book and how the team works. Everything else a process repeats for every book (its
 * phases, tasks, steps and teams) comes with the process; the app reads the book and lays out the work by itself.
 */
export function StartBookPanel({ templates, taken, onStart, onAdjust, onOpen, onGoToTasks, onCancel, phaseTeams }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const free = BOOKS.filter((b) => !taken.includes(b.code));
  const [book, setBook] = useState(free[0]?.code ?? "");
  // A walkthrough is never the one offered first: it is chosen on purpose.
  const [workflowId, setWorkflowId] = useState(() => usualTemplate(templates.filter((row) => !row.trial)));
  const trial = Boolean(templates.find((row) => row.id === workflowId)?.trial);
  const [chapter, setChapter] = useState("1");
  const chapterNumber = Math.floor(Number(chapter));
  const [stage, setStage] = useState<{ at: StartStage; detail?: string } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<StartedProject | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  async function adjust() {
    if (!book || !onAdjust) return;
    setError("");
    setAdjusting(true);
    try {
      rememberTemplateUsed(workflowId);
      await onAdjust({ book, workflowId });
    } catch (err) {
      setError(explainError(err));
    } finally {
      setAdjusting(false);
    }
  }
  const name = book ? bookLabel(book, language) : "";

  async function start() {
    if (!book || !workflowId) return;
    setError("");
    setStage({ at: "process" });
    try {
      // Only the count of subtareas is worth showing; what the reader reports while it works is for developers.
      if (!trial) rememberTemplateUsed(workflowId);
      setDone(await onStart({ book, workflowId, ...(trial ? { chapter: chapterNumber } : {}) }, (at, detail) => setStage({ at, detail: at === "tasks" ? detail : undefined })));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setStage(null);
    }
  }

  if (done) {
    const size = bookSize(done.inventory);
    const process = templates.find((row) => row.id === done.board.workflowId)?.name ?? "";
    return (
      <div className="hub-panel sb">
        <h2 className="sb-title">{t("sb.doneTitle").replace("{book}", name)}</h2>
        <p className="text-sm text-muted-foreground">
          {[t(size.chapters === 1 ? "sb.chapterOne" : "sb.chapterMany").replace("{n}", String(size.chapters)), t(size.portions === 1 ? "sb.portionOne" : "sb.portionMany").replace("{n}", String(size.portions)), process].filter(Boolean).join(" · ")}
        </p>
        <ul className="sb-phases" aria-label={t("sb.phasesAria")}>
          {phasesAtStart(done.board).map((phase) => (
            <li key={phase.id} data-ready={phase.ready ? "true" : "false"}>
              <span>{localizeName(phase.name, language)}</span>
              <span>{phase.ready ? t("sb.ready") : phase.waitsFor.length ? t("sb.waitsFor").replace("{what}", phase.waitsFor.map((n) => localizeName(n, language)).join(", ")) : t("sb.waits")}</span>
            </li>
          ))}
        </ul>
        {startNotices(done.inventory).map((notice) => (
          <p key={notice} className="af-stale">{t(NOTICE_KEY[notice])}</p>
        ))}
        {phaseTeams ? <PhaseTeamsPanel board={done.board} {...phaseTeams} onSaved={(board) => setDone({ ...done, board })} /> : null}
        <div className="grid gap-2">
          <Button type="button" size="lg" onClick={onGoToTasks}>
            {t("sb.goToTasks")}
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={() => onOpen(done.board.projectId, "subtareas")}>
            {t("sb.split")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpen(done.board.projectId, "tareas")}>
            {t("sb.adjust")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="hub-panel sb">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="sb-title">{t("sb.title")}</h2>
        {!stage ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("pj.cancel")}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="sb-book">{t("pj.book")}</Label>
        {/* The phone's own picker: sixty-six books scroll better there than in a custom list. */}
        <select id="sb-book" className="af-input" value={book} disabled={Boolean(stage)} onChange={(e) => setBook(e.target.value)}>
          {free.map((b) => (
            <option key={b.code} value={b.code}>
              {bookLabel(b.code, language)}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="m-0 grid gap-2 border-0 p-0" disabled={Boolean(stage)}>
        <legend className="mb-1.5 p-0 text-sm font-medium">{t("sb.how")}</legend>
        {templates.map((row) => (
          <label key={row.id} className="sb-template" data-on={row.id === workflowId ? "true" : "false"}>
            <input type="radio" name="sb-template" checked={row.id === workflowId} onChange={() => setWorkflowId(row.id)} />
            <span>
              <b>{row.name}</b>
              <small>{t("sb.templateSize").replace("{phases}", String(row.phases)).replace("{tasks}", String(row.tasks))}</small>
            </span>
          </label>
        ))}
        {onAdjust ? (
          <label className="sb-template" data-on={workflowId === "" ? "true" : "false"}>
            <input type="radio" name="sb-template" checked={workflowId === ""} onChange={() => setWorkflowId("")} />
            <span>
              <b>{t("sb.blank")}</b>
              <small>{t("sb.blankHint")}</small>
            </span>
          </label>
        ) : null}
        {!templates.length && !onAdjust ? <p className="af-stale">{t("sb.noTemplates")}</p> : null}
      </fieldset>

      {trial ? (
        <div className="grid gap-1.5">
          <Label htmlFor="sb-chapter">{t("sb.chapter")}</Label>
          <input id="sb-chapter" className="af-input" type="number" inputMode="numeric" min={1} value={chapter} disabled={Boolean(stage)} onChange={(e) => setChapter(e.target.value)} />
          <p className="text-sm text-muted-foreground">{templates.find((row) => row.id === workflowId)?.description}</p>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {stage ? (
        <ol className="sb-stages" aria-live="polite">
          {STAGES.map((id) => {
            const at = STAGES.indexOf(stage.at);
            const mine = STAGES.indexOf(id);
            return (
              <li key={id} data-state={mine < at ? "done" : mine === at ? "now" : "next"}>
                {t(STAGE_KEY[id])}
                {mine === at && stage.detail ? ` · ${stage.detail}` : ""}
              </li>
            );
          })}
        </ol>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t(workflowId ? "sb.what" : "sb.whatBlank")}</p>
          {workflowId ? (
            <Button type="button" size="lg" disabled={!book || adjusting || (trial && !(chapterNumber > 0))} onClick={() => void start()}>
              {trial ? t("sb.startTrial").replace("{book}", name).replace("{n}", String(chapterNumber > 0 ? chapterNumber : "")) : t("sb.start").replace("{book}", name)}
            </Button>
          ) : null}
          {onAdjust && !trial ? (
            <Button type="button" size="lg" variant={workflowId ? "outline" : "default"} disabled={!book || adjusting} onClick={() => void adjust()}>
              {adjusting ? t("sb.preparing") : t(workflowId ? "sb.adjustFirst" : "sb.build")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
