import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localized, stepPurpose } from "../domain/processes";
import { localizeName } from "../domain/templateNames";
import type { ProjectTask, TaskStep } from "../domain/types";

/**
 * What the window of a review says to whoever translated the draft: who already read it, and what is asked of her.
 * The purpose of the step, in the process's package, speaks to the reviewer («Compruebe que la traducción de su
 * compañero…»); said to the author about her own text it is wrong. Names as the cards show them («@bea»).
 */
export function authorPurpose(readers: string[], language: string, t: (key: MessageKey) => string): string {
  if (!readers.length) return t("intro.authorWaiting");
  const who = new Intl.ListFormat(language, { type: "conjunction" }).format(readers.map((login) => `@${login}`));
  return t(readers.length === 1 ? "intro.authorReadOne" : "intro.authorReadMany").replace("{who}", who);
}

/**
 * «De qué trata esta tarea»: the first time a step of a task is opened from its card, what it is for, how it is
 * done and the rule it keeps, in big type, before its tool (Abel, 9 November). Everything comes from the process's
 * package. «Empezar con la guía» opens the tool with its walk; «Empezar sin guía» opens it without.
 */
export function TaskIntro({
  task,
  step,
  onStart,
  onCancel,
  forAuthor,
}: {
  task: ProjectTask | null;
  step: TaskStep | null;
  /** The person opening it is the author of the draft under review: the window speaks to her about it. */
  forAuthor?: { readers: string[] };
  onStart: (withGuide: boolean) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const open = Boolean(task && step);
  const said = task && step ? stepPurpose(task.id, step, language) : {};
  const purpose = forAuthor ? authorPurpose(forAuthor.readers, language, t) : said.purpose;
  const steps = task?.steps ?? [];
  const stepName = (row: TaskStep) => (row.names?.[language] ? localized(row.name, row.names, language) : localizeName(row.name, language));
  const lines = (forAuthor ? "" : said.howTo ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="task-intro" data-state={open ? "open" : "closed"} aria-labelledby="task-intro-title">
        {task && step ? (
          <>
            <DialogTitle id="task-intro-title" className="task-intro__title">
              {localizeName(task.name, language)}
            </DialogTitle>
            {purpose ? (
              <section className="task-intro__group">
                <h3 className="task-intro__label">{t("intro.about")}</h3>
                <p className="task-intro__text">{purpose}</p>
              </section>
            ) : null}
            {/* A task of several steps says which one is opened now. */}
            {steps.length > 1 ? (
              <section className="task-intro__group">
                <h3 className="task-intro__label">{t("intro.steps")}</h3>
                <ol className="task-intro__list">
                  {steps.map((row) => (
                    <li key={row.id} data-here={row.id === step.id ? "true" : undefined}>
                      {stepName(row)}
                      {row.id === step.id ? <span className="task-intro__here"> · {t("intro.here")}</span> : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {lines.length ? (
              <section className="task-intro__group">
                <h3 className="task-intro__label">{t("intro.how")}</h3>
                <ol className="task-intro__list">
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </section>
            ) : null}
            {said.criterion ? (
              <section className="task-intro__group">
                <h3 className="task-intro__label">{t("intro.rule")}</h3>
                <p className="task-intro__text">{said.criterion}</p>
              </section>
            ) : null}
            <div className="task-intro__actions">
              <Button type="button" size="lg" onClick={() => onStart(true)}>
                {t("intro.withGuide")}
              </Button>
              <p className="task-intro__note">{t("intro.guideNote")}</p>
              <Button type="button" size="lg" variant="outline" onClick={() => onStart(false)}>
                {t("intro.withoutGuide")}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
