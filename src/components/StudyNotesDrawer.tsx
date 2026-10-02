import { useMemo, useState } from "react";
import { NotebookPen, X } from "lucide-react";
import { loadSession } from "../dcs/auth";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { localizeName } from "../domain/templateNames";
import { SCOPE_KEYS, SCOPE_LABEL, type ScopeKey } from "../domain/types";
import { portionRange } from "../domain/usfmEdit";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { StudyNotesPanel } from "./StudyNotesPanel";

/** What the notes need to know of the tool they are opened from: which passage, which resource, which task. */
export function studyNotesProps(ctx: SolverLaunchContext, language: string) {
  const range = portionRange(ctx.ref, ctx.chapter);
  // A task of several resources (a lot) is of none in particular.
  const resource = (SCOPE_KEYS as string[]).includes(ctx.resource) ? ctx.resource : undefined;
  return {
    pmOrg: ctx.pmOrg,
    lang: ctx.lang,
    projectId: ctx.projectId,
    book: ctx.book,
    chapter: range?.chapter ?? ctx.chapter,
    from: range?.from,
    to: range?.to,
    resource,
    resourceName: resource ? ctx.resourceName || SCOPE_LABEL[resource as ScopeKey] : undefined,
    taskName: ctx.taskName ? localizeName(ctx.taskName, language as never) : undefined,
    issueNumber: ctx.issueNumber || undefined,
  };
}

/**
 * The notes of the passage, reachable from any tool: a button that stays in a corner, with how many there are, and a
 * panel that opens over the tool. The tools of the later phases (reviews, refining, checks, endorsement) get the
 * notes this way without each one making room for them.
 */
export function StudyNotesDrawer({ ctxEncoded }: { ctxEncoded: string }) {
  const t = useT();
  const language = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const ctx = useMemo(() => decodeSolverLaunchContext(ctxEncoded), [ctxEncoded]);
  const session = useMemo(() => loadSession(), []);
  if (!ctx?.projectId || !ctx.pmOrg || !ctx.book || !session?.token || ctx.lab) return null;
  return (
    <>
      <button type="button" className="snd-button" aria-label={t("sn.tab")} aria-expanded={open} onClick={() => setOpen(!open)}>
        <NotebookPen size={16} aria-hidden /> <span className="snd-label">{t("sn.tab")}</span>
        {count ? <span className="snd-count">{count}</span> : null}
      </button>
      {/* Kept mounted, so that the count is known before it is opened. */}
      <aside className="snd-panel" hidden={!open} aria-label={t("sn.tab")}>
        <header className="snd-panel__head">
          <h2>{t("sn.tab")}</h2>
          <button type="button" className="pe-icon" aria-label={t("se.close")} onClick={() => setOpen(false)}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <p className="pe-hint">{t("sn.ledeAny")}</p>
        <StudyNotesPanel session={session} {...studyNotesProps(ctx, language)} onCount={setCount} />
      </aside>
    </>
  );
}
