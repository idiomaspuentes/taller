import { useState } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { loadPhaseChanges, loadSubtaskChanges, type ResourceChanges } from "../dcs/changesSince";
import { explainError } from "../dcs/userError";
import { diffWords } from "../domain/reviewItems";
import { scopeLabel } from "../domain/resourceNames";
import { localizeName } from "../domain/templateNames";
import type { AssignmentsDoc } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

type Where = { session: GtSession; pmOrg: string; lang: string; contentOrg: string; board: AssignmentsDoc };

/** What changed, resource by resource: each piece with its words struck out and put in. */
function ChangeGroups({ groups, board }: { groups: ResourceChanges[]; board: AssignmentsDoc }) {
  const t = useT();
  const language = useUiLanguage();
  if (!groups.length) return <p className="pe-hint">{t("ch.nothingToCompare")}</p>;
  return (
    <div className="ch-groups">
      {groups.map((group) => (
        <section key={group.resource} className="ch-group">
          <h4 className="ch-group__title">
            {scopeLabel(group.resource, board.settings?.resourceNames, language)}
            {group.status === "closed" || group.status === "open" ? <span className="ch-group__count">{t(group.items.length === 1 ? "ch.countOne" : "ch.countMany").replace("{n}", String(group.items.length))}</span> : null}
          </h4>
          {group.status === "waiting" ? <p className="pe-hint">{t("ch.waiting")}</p> : null}
          {group.status === "none" ? <p className="pe-hint">{t("ch.noDraft")}</p> : null}
          {group.status === "open" || group.status === "closed" ? (
            group.items.length ? (
              <ol className="rv-list">
                {group.items.map((item) => (
                  <li key={item.key} className="rv-item" data-state={item.state}>
                    <div className="rv-item__head">
                      <span className="rv-item__ref">{item.ref}</span>
                      <span className="rv-item__state">{t(`rv.state.${item.state}`)}</span>
                    </div>
                    <p className="rv-item__text">
                      {diffWords(item.before, item.now).map((part, index) => (part.kind === "same" ? part.text : part.kind === "added" ? <ins key={index}>{part.text}</ins> : <del key={index}>{part.text}</del>))}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="pe-hint">{t("ch.same")}</p>
            )
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** Reads only when it is opened: comparing costs a few requests nobody needs until they ask. */
function Lazy({ summary, load, board }: { summary: string; load: () => Promise<ResourceChanges[]>; board: AssignmentsDoc }) {
  const t = useT();
  const [state, setState] = useState<{ status: "idle" | "loading" } | { status: "ready"; groups: ResourceChanges[] } | { status: "error"; message: string }>({ status: "idle" });
  const open = () => {
    if (state.status !== "idle") return;
    setState({ status: "loading" });
    load()
      .then((groups) => setState({ status: "ready", groups }))
      .catch((err) => setState({ status: "error", message: explainError(err) }));
  };
  return (
    <details className="ch-fold" onToggle={(event) => (event.currentTarget.open ? open() : undefined)}>
      <summary className="ch-fold__summary">{summary}</summary>
      {state.status === "loading" ? <p className="pe-hint" aria-busy="true">{t("ch.loading")}</p> : null}
      {state.status === "error" ? <p className="af-stale">{state.message}</p> : null}
      {state.status === "ready" ? <ChangeGroups groups={state.groups} board={board} /> : null}
    </details>
  );
}

/** In «Versiones»: what each phase changed in the book, from the mark of the phase before it to its own. */
export function PhaseChangesPanel(props: Where) {
  const t = useT();
  const language = useUiLanguage();
  const { board } = props;
  const book = board.book || board.projectId;
  const phases = [...board.phases].sort((a, b) => a.order - b.order).filter((phase) => board.teams.some((task) => task.phaseId === phase.id));
  if (!book || !phases.length) return null;
  return (
    <section className="advance-section ch-panel" aria-labelledby="ch-phases">
      <h2 id="ch-phases" className="advance-section__title">
        {t("ch.phasesTitle")}
      </h2>
      <p className="pe-hint">{t("ch.phasesHint")}</p>
      {phases.map((phase) => (
        <Lazy key={phase.id} board={board} summary={phase.names?.[language]?.trim() || localizeName(phase.name, language)} load={() => loadPhaseChanges({ ...props, book, phaseId: phase.id })} />
      ))}
    </section>
  );
}

/** In the conversation of a delivered subtarea: what the later work changed in its passage. */
export function SubtaskChangesPanel(props: Where & { issue: DcsIssue }) {
  const t = useT();
  return (
    <div className="ch-panel ch-panel--thread">
      <Lazy board={props.board} summary={t("ch.sinceDelivered")} load={async () => (await loadSubtaskChanges(props)) ?? []} />
    </div>
  );
}
