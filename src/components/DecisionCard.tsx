import { useCallback, useContext, useEffect, useState } from "react";
import { CiteScope, ReasonField } from "./ReasonField";
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
import { explainError } from "../dcs/userError";

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
  /** Runs the option on `event` (the card's, or its decided form) and shows its items; `input` is what was written for it. */
  onRun?: (optionId: string, event: ChatEvent, input?: string, second?: string) => Promise<void>;
  /** Opens the editor on a range; offered next to a block reason that is fixed there. */
  onOpenEditor?: (range: { chapter: number; from: number; to: number }) => void;
  /** The screen shows what is decided its own way: the card is its votes and buttons. */
  hidePanels?: boolean;
  /** The screen already names what is decided: the card does not say it again. */
  compact?: boolean;
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
  hidePanels = false,
  compact = false,
}: Props) {
  const t = useT();
  const language = useUiLanguage();
  const cite = useContext(CiteScope);
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
  /** The option that is being written for (another wording, the reason of a no), and what is written so far. */
  const [writing, setWriting] = useState<{ id: string; text: string; second?: string } | null>(null);
  const [busy, setBusy] = useState<DecisionOption | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const prepare = useCallback(async (): Promise<{ prepared?: unknown; prepareError?: string }> => {
    if (demoPrepared !== undefined || !definition?.prepare) return { prepared: demoPrepared };
    try {
      return { prepared: await definition.prepare(target, env) };
    } catch (err) {
      return { prepareError: explainError(err) };
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

  async function run(option: DecisionOption, input?: string, second?: string) {
    setConfirming(null);
    setWriting(null);
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
      await onRun!(option.id, target, input, second);
      // What the card says is read again. A vote just given was not counted on it until the page was opened
      // again: the button went on reading «(1)», and when it made the consensus, nothing offered to confirm it.
      const after = await prepare().catch(() => null);
      if (after) {
        setPrepared(after.prepared);
        setPrepareError(after.prepareError);
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(null);
    }
  }

  const allPanels = decided ? resolveChatEvent(decided.event).panels : resolved.panels;
  const shownPanels = allPanels.filter((panel) => !panel.fold);
  const foldedPanels = allPanels.filter((panel) => panel.fold);
  // A card that draws alignment boxes is taller than a phone: its buttons stay in reach while it is read. Any other
  // card has them at its end, where they covered nothing.
  const tall = allPanels.some((panel) => panel.custom?.kind === "cajas");
  const panelOf = (panel: (typeof allPanels)[number]) => (
    <figure key={panel.label} className={`chat-decision__panel${panel.custom?.kind === "cajas" ? " chat-decision__panel--wide" : ""}`}>
      <figcaption className="chat-decision__label">
        <span>{loc(panel.label)}</span>
        {panel.tag ? <span className="chat-decision__tag">{loc(panel.tag)}</span> : null}
      </figcaption>
      {panel.custom ? <DecisionCustomPanel custom={panel.custom} /> : <blockquote className="chat-decision__text">{panel.text || t("dc.empty")}</blockquote>}
    </figure>
  );
  const panels = allPanels.length && !hidePanels ? (
    <div className="chat-decision__panels">
      {shownPanels.map(panelOf)}
      {foldedPanels.length ? (
        <details className="chat-decision__fold">
          <summary>{t("dc.seeAlignment")}</summary>
          {foldedPanels.map(panelOf)}
        </details>
      ) : null}
    </div>
  ) : null;
  const confirmOption = confirming ? options.find((o) => o.id === confirming) : undefined;
  const writeOption = writing ? options.find((o) => o.id === writing.id && o.input) : undefined;
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
      ) : writeOption && writing ? (
        // Words of the person's own, asked for before the option runs: what is written goes with it.
        <div className="chat-decision__confirm chat-decision__write" role="group" aria-label={loc(writeOption.input!.label)}>
          <label className="chat-decision__confirm-text" htmlFor={`write-${item.key}`}>
            {loc(writeOption.input!.label)}
          </label>
          {cite && writing.id !== "version" && !writeOption.input!.verse ? (
            // A reason, said with what it cites: the words of the original, the texts, the notes.
            <ReasonField id={`write-${item.key}`} rows={3} value={writing.text} autoFocus session={cite.session} ctx={cite.ctx} chapter={cite.chapter} verse={cite.verse} onChange={(text) => setWriting({ ...writing, text })} />
          ) : (
            <textarea id={`write-${item.key}`} className="af-textarea" rows={3} value={writing.text} autoFocus onChange={(e) => setWriting({ ...writing, text: e.target.value })} />
          )}
          {writeOption.input!.second ? (
            <>
              <label className="chat-decision__confirm-text" htmlFor={`write2-${item.key}`}>
                {loc(writeOption.input!.second.label)}
              </label>
              {cite ? (
                <ReasonField id={`write2-${item.key}`} rows={4} value={writing.second ?? ""} session={cite.session} ctx={cite.ctx} chapter={cite.chapter} verse={cite.verse} onChange={(second) => setWriting({ ...writing, second })} />
              ) : (
                <textarea id={`write2-${item.key}`} className="af-textarea" rows={4} value={writing.second ?? ""} onChange={(e) => setWriting({ ...writing, second: e.target.value })} />
              )}
            </>
          ) : null}
          <div className="chat-decision__actions">
            <Button type="button" disabled={!writing.text.trim() || (writeOption.input!.second ? !(writing.second ?? "").trim() : false)} onClick={() => void run(writeOption, writing.text.trim(), writing.second?.trim())}>
              {t("dc.send")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setWriting(null)}>
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
              onClick={() => (option.input ? setWriting({ id: option.id, text: option.input.initial ?? "", ...(option.input.second ? { second: option.input.second.initial ?? "" } : {}) }) : option.confirm ? setConfirming(option.id) : void run(option))}
            >
              {loc(option.label)}
            </Button>
          ))}
        </div>
      ) : null}
      {!busy && !confirmOption && !writeOption && reasons.length ? (
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
        {compact ? null : <p className="chat-decision__sub">{loc(decided?.title ?? resolved.title)}</p>}
        {expanded ? panels : null}
        {hidePanels ? null : (
          <button
            type="button"
            className="chat-link chat-decision__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t("dc.hideTexts") : t("dc.seeTexts")}
          </button>
        )}
        {controls}
      </section>
    );
  }

  return (
    <section className={`chat-decision${tall ? " chat-decision--tall" : ""}`} data-key={item.key} aria-label={t("dc.pendingAria")} aria-busy={Boolean(busy)}>
      <p className="chat-decision__eyebrow">{t("dc.decide")}</p>
      {compact ? null : <p className="chat-decision__title">{loc(resolved.title)}</p>}
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
