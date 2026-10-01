import { useCallback, useEffect, useState } from "react";
import type { ChatEvent } from "../domain/chatEvent";
import type { ThreadItem } from "../domain/conversation";
import {
  resolveChatEvent,
  type ChatEventEnv,
  type DecisionOption,
  type DecisionStatus,
  type DecisionViewer,
  type ResolvedChatEvent,
} from "../domain/chatEvents/registry";
import { formatLaunchRef } from "../domain/solverLab";
import { DecisionCustomPanel } from "./DecisionCustomPanel";
import { Button } from "@/components/ui/button";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";

type Props = {
  item: ThreadItem;
  resolved: ResolvedChatEvent;
  time: string;
  status?: DecisionStatus;
  resolutionTime?: string;
  viewer: DecisionViewer;
  env: ChatEventEnv;
  /** Demo only: stands in for `prepare` (no DCS read). */
  demoPrepared?: unknown;
  /** Runs the option on `event` (the card's, or its decided form) and shows its items. */
  onRun?: (optionId: string, event: ChatEvent) => Promise<void>;
  /** Opens the editor on a range; offered next to a block reason that is fixed there. */
  onOpenEditor?: (range: { chapter: number; from: number; to: number }) => void;
};

export function DecisionCard({
  item,
  resolved,
  time,
  status,
  resolutionTime,
  viewer,
  env,
  demoPrepared,
  onRun,
  onOpenEditor,
}: Props) {
  const t = useT();
  const language = useUiLanguage();
  const loc = (text: string) => localizeThread(text, language);
  const event = item.event!;
  const definition = resolved.definition;
  const resolution = status?.resolution;
  const active = !resolution && !status?.superseded && event.decision?.state !== "resuelta";
  const decided = resolution ? (definition?.decided?.(event, resolution) ?? null) : null;
  const target = decided?.event ?? event;
  const restoreIds = decided && !status?.superseded ? decided.options : [];
  const canAct = active || restoreIds.length > 0;
  const [prepared, setPrepared] = useState<unknown>(demoPrepared);
  const [prepareError, setPrepareError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<DecisionOption | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const prepare = useCallback(async (): Promise<{ prepared?: unknown; prepareError?: string }> => {
    if (demoPrepared !== undefined || !definition?.prepare) return { prepared: demoPrepared };
    try {
      return { prepared: await definition.prepare(target, env) };
    } catch (err) {
      return { prepareError: err instanceof Error ? err.message : String(err) };
    }
  }, [demoPrepared, definition, target, env]);

  useEffect(() => {
    if (!canAct) return;
    let cancelled = false;
    void prepare().then((next) => {
      if (cancelled) return;
      setPrepared(next.prepared);
      setPrepareError(next.prepareError);
    });
    return () => {
      cancelled = true;
    };
    // Prepare once per card; `env` identity changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAct, item.key, resolution]);

  const offered = (all: DecisionOption[]) => (active ? all : all.filter((o) => restoreIds.includes(o.id)));
  const options =
    canAct && onRun ? offered(definition?.options?.(target, { viewer, prepared, prepareError }) ?? []) : [];
  const reasons = [...new Set(options.map((o) => o.blockReason).filter((r): r is string => Boolean(r)))];
  const editorRange = options.find((o) => o.blockReason && o.openEditor)?.openEditor;

  async function run(option: DecisionOption) {
    setConfirming(null);
    setError("");
    setBusy(option);
    try {
      // Guard again right before writing (plan §7.4).
      const fresh = await prepare();
      setPrepared(fresh.prepared);
      setPrepareError(fresh.prepareError);
      const again = offered(definition?.options?.(target, { viewer, ...fresh }) ?? []).find((o) => o.id === option.id);
      if (!again || again.blockReason) {
        setError(loc(again?.blockReason || "") || t("dc.unavailable"));
        return;
      }
      await onRun!(option.id, target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const shownPanels = decided ? resolveChatEvent(decided.event).panels : resolved.panels;
  const panels = shownPanels.length ? (
    <div className="chat-decision__panels">
      {shownPanels.map((panel) => (
        <figure key={panel.label} className={`chat-decision__panel${panel.custom?.kind === "cajas" ? " chat-decision__panel--wide" : ""}`}>
          <figcaption className="chat-decision__label">
            <span>{loc(panel.label)}</span>
            {panel.tag ? <span className="chat-decision__tag">{loc(panel.tag)}</span> : null}
          </figcaption>
          {panel.custom ? <DecisionCustomPanel custom={panel.custom} /> : <blockquote className="chat-decision__text">{panel.text || t("dc.empty")}</blockquote>}
        </figure>
      ))}
    </div>
  ) : null;

  const confirmOption = confirming ? options.find((o) => o.id === confirming) : undefined;
  const controls = (
    <>
      {busy ? (
        <p className="chat-decision__busy" role="status">
          {busy.busyLabel ? loc(busy.busyLabel) : t("dc.saving")}
        </p>
      ) : confirmOption ? (
        <div className="chat-decision__confirm" role="group" aria-label={t("dc.confirmAria")}>
          <p className="chat-decision__confirm-text">{loc(confirmOption.confirm ?? "")}</p>
          <div className="chat-decision__actions">
            <Button type="button" onClick={() => void run(confirmOption)}>
              {t("dc.confirm")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              {t("dc.cancel")}
            </Button>
          </div>
        </div>
      ) : options.length ? (
        <div className="chat-decision__actions">
          {options.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant={option.primary ? "default" : "outline"}
              disabled={Boolean(option.blockReason)}
              onClick={() => (option.confirm ? setConfirming(option.id) : void run(option))}
            >
              {loc(option.label)}
            </Button>
          ))}
        </div>
      ) : null}
      {!busy && !confirmOption && reasons.length ? (
        <p className="chat-decision__reason">
          {reasons.map(loc).join(" ")}
          {editorRange && onOpenEditor ? (
            <>
              {" "}
              <button type="button" className="chat-link chat-decision__editor" onClick={() => onOpenEditor(editorRange)}>
                {t("dc.openInEditor").replace("{ref}", formatLaunchRef(editorRange.chapter, editorRange.from, editorRange.to))}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <p className="chat-decision__error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );

  if (resolution) {
    return (
      <section
        className="chat-decision chat-decision--resolved"
        data-key={item.key}
        aria-label={t("dc.resolvedAria")}
        aria-busy={Boolean(busy)}
      >
        <p className="chat-decision__eyebrow">{t("dc.decided")}</p>
        <p className="chat-decision__title">
          {loc(resolveChatEvent(resolution).title)}
          {resolutionTime ? <span className="chat-decision__when"> · {resolutionTime}</span> : null}
        </p>
        <p className="chat-decision__sub">{loc(decided?.title ?? resolved.title)}</p>
        {expanded ? panels : null}
        <button
          type="button"
          className="chat-link chat-decision__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("dc.hideTexts") : t("dc.seeTexts")}
        </button>
        {controls}
      </section>
    );
  }

  return (
    <section className="chat-decision" data-key={item.key} aria-label={t("dc.pendingAria")} aria-busy={Boolean(busy)}>
      <p className="chat-decision__eyebrow">{t("dc.decide")}</p>
      <p className="chat-decision__title">{loc(resolved.title)}</p>
      {panels}
      {status?.superseded ? (
        <p className="chat-decision__reason">{t("dc.superseded")}</p>
      ) : null}
      {controls}
      {item.createdAt ? (
        <p className="chat-decision__meta">
          <time dateTime={item.createdAt}>{time}</time>
        </p>
      ) : null}
    </section>
  );
}
