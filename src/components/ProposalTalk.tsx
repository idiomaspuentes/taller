import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ThreadItem } from "../domain/conversation";
import { voteData } from "../domain/chatEvents/alineacionDecision";
import { resolveChatEvent } from "../domain/chatEvents/registry";
import { localizeThread } from "../domain/threadNames";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { ReasonText, type ReasonLinks } from "./ChangeReasons";
import { CiteScope, ReasonField } from "./ReasonField";

/** How many of the last lines are shown before «Ver los anteriores»: a long talk does not push the next verse away. */
const SHOWN = 3;

type Line =
  | { kind: "said"; key: string; at: string; who: string; text: string; label?: string; pending?: boolean }
  | { kind: "line"; key: string; at: string; text: string };

const plainNames = (text: string) => text.replace(/(^|\s)@([\w.-]+)/g, "$1$2");

/**
 * What the conversation of a proposal says, minus its card, which the screen already shows: the comments of the
 * team, the votes (with what was said with them) and what happened to it. A vote with a reason reads as something
 * said, since it is what the talk goes on from.
 */
function linesOf(items: ThreadItem[], language: ReturnType<typeof useUiLanguage>): Line[] {
  const out: Line[] = [];
  for (const item of items) {
    if (item.kind === "humano") {
      out.push({ kind: "said", key: item.key, at: item.createdAt, who: item.author, text: item.text, ...(item.pending ? { pending: true } : {}) });
      continue;
    }
    if (!item.event) continue;
    const resolved = resolveChatEvent(item.event);
    if (resolved.render === "decision") continue;
    const vote = voteData(item.event);
    if (vote?.reason) {
      const head = item.event.summary.split(". «")[0] ?? item.event.summary;
      out.push({ kind: "said", key: item.key, at: item.createdAt, who: vote.by, text: vote.reason, label: plainNames(localizeThread(head, language)) });
      continue;
    }
    out.push({ kind: "line", key: item.key, at: item.createdAt, text: plainNames(localizeThread(resolved.title, language)) });
  }
  return out;
}

function when(iso: string, language: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString(language, { day: "numeric", month: "short" });
}

/**
 * The conversation of one proposal, under its decision: read and answered next to the verse it is about. It was a
 * screen of its own, a step away from the verse whoever had something to say was reading. Writing starts with a
 * touch, so the field and the keyboard do not take the screen from whoever only reads.
 */
export function ProposalTalk({
  items,
  me,
  links,
  onSend,
  onWriting,
}: {
  items: ThreadItem[];
  me: string;
  links?: ReasonLinks;
  onSend: (text: string) => Promise<void>;
  /** The screen gives the field the room its foot takes while something is written. */
  onWriting?: (writing: boolean) => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const scope = useContext(CiteScope);
  const lines = useMemo(() => linesOf(items, language), [items, language]);
  const [all, setAll] = useState(false);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onWriting?.(writing);
    if (writing) field.current?.scrollIntoView({ block: "center" });
  }, [writing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onWriting?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = all ? 0 : Math.max(0, lines.length - SHOWN);
  const shown = lines.slice(hidden);
  const mine = (who: string) => Boolean(me) && who.toLowerCase() === me.toLowerCase();

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      await onSend(text);
      setDraft("");
      setWriting(false);
    } catch (err) {
      setError(t("plt.failed").replace("{why}", err instanceof Error ? err.message : String(err)));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="plt" aria-labelledby="plt-title">
      <h3 id="plt-title" className="pl-why">
        {t("plt.title")}
      </h3>
      {!lines.length ? <p className="plt-empty">{t("plt.empty")}</p> : null}
      {hidden ? (
        <button type="button" className="chat-link plt-earlier" onClick={() => setAll(true)}>
          {t(hidden === 1 ? "plt.earlierOne" : "plt.earlier").replace("{n}", String(hidden))}
        </button>
      ) : null}
      {shown.length ? (
        <ol className="plt-log">
          {shown.map((line) =>
            line.kind === "line" ? (
              <li key={line.key} className="plt-line">
                {line.text}
                {line.at ? <time dateTime={line.at}> · {when(line.at, language)}</time> : null}
              </li>
            ) : (
              <li key={line.key} className="plt-msg" data-mine={mine(line.who) ? "true" : undefined} data-pending={line.pending ? "true" : undefined}>
                <p className="plt-who">
                  <strong>{mine(line.who) ? t("cv.you") : line.who}</strong>
                  {line.label ? <span> · {line.label.startsWith(`${line.who} `) ? line.label.slice(line.who.length + 1) : line.label}</span> : null}
                  {line.pending ? <span> · {t("cv.sending")}</span> : line.at ? <time dateTime={line.at}> · {when(line.at, language)}</time> : null}
                </p>
                <div className="plt-text">{links ? <ReasonText text={line.text} links={links} /> : <p className="rt-p">{line.text}</p>}</div>
              </li>
            ),
          )}
        </ol>
      ) : null}
      {writing ? (
        <div className="plt-write" ref={field}>
          <label className="af-lbl" htmlFor="plt-field">
            {t("plt.fieldLabel")}
          </label>
          <ReasonField id="plt-field" value={draft} onChange={setDraft} session={scope?.session} ctx={scope?.ctx} chapter={scope?.chapter ?? 0} verse={scope?.verse ?? 0} rows={3} autoFocus />
          {error ? (
            <p className="pl-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="plt-actions">
            <Button type="button" disabled={!draft.trim() || sending} onClick={() => void send()}>
              {sending ? t("cv.sending") : t("plt.send")}
            </Button>
            <Button type="button" variant="outline" disabled={sending} onClick={() => setWriting(false)}>
              {t("plt.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="plt-start" onClick={() => setWriting(true)}>
          {t("plt.write")}
        </Button>
      )}
    </section>
  );
}
