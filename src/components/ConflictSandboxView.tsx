import { useCallback, useMemo, useRef, useState } from "react";
import type { GtSession } from "../dcs/auth";
import type { ThreadItem } from "../domain/conversation";
import type { ReadCursorDoc } from "../domain/readCursor";
import {
  SANDBOX_ISSUE,
  SANDBOX_OTHER_LOGIN,
  chooseInSandbox,
  editSandboxVerse,
  initialSandbox,
  resetSandbox,
  sandboxDecisionId,
  sandboxIssue,
  sandboxLaunch,
  sandboxPostsToItems,
  sandboxPrepared,
  sandboxThreadSources,
  sandboxVerseText,
  type ConflictSandboxState,
} from "../domain/conflictSandbox";
import type { VerseConflictOptionId } from "../domain/verseConflictEvent";
import { Button } from "@/components/ui/button";
import { ConversationView, type ConversationDemo } from "./ConversationView";

type Props = {
  session: GtSession | null;
  /** Workspace language for the lab editor launch. */
  lang?: string;
  canManage: boolean;
  cursor: ReadCursorDoc;
  onBack: () => void;
  onSignIn: () => void;
  announce: (msg: string) => void;
};

const NOOP = () => {};

/** `#/mis-tareas/prueba`: fictional conflict, all in memory. Never reads or writes Door43. */
export function ConflictSandboxView({ session, lang, canManage, cursor, onBack, onSignIn, announce }: Props) {
  const me = session?.username || "ana";
  const [state, setState] = useState<ConflictSandboxState>(() => initialSandbox());
  const stateRef = useRef(state);
  stateRef.current = state;

  const decide = useCallback(
    async (optionId: string, _item: ThreadItem): Promise<ThreadItem[]> => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const result = chooseInSandbox(stateRef.current, optionId as VerseConflictOptionId, me);
      if (!result.ok) throw new Error(result.reason);
      stateRef.current = result.state;
      setState(result.state);
      return sandboxPostsToItems(result.posts, me);
    },
    [me],
  );

  const reset = useCallback(() => {
    setState((prev) => resetSandbox(prev));
    announce("Prueba reiniciada: el conflicto vuelve a estar pendiente");
  }, [announce]);

  const edit = useCallback(() => {
    setState((prev) => editSandboxVerse(prev));
    announce("Se simuló una edición a mano de 1:10");
  }, [announce]);

  const verse = sandboxVerseText(state);
  const status = state.choice
    ? state.choice.option === "desplazado"
      ? `Decidido: volvió la versión de @${SANDBOX_OTHER_LOGIN}.`
      : "Decidido: se quedó tu versión."
    : state.edited
      ? "Pendiente, pero 1:10 cambió después: los botones se bloquean."
      : "Pendiente de decidir.";

  const toolbar = (
    <div className="chat-sandbox" role="note" aria-label="Prueba local">
      <p className="chat-sandbox__banner">Prueba local: nada de esto se escribe en Door43.</p>
      <p className="chat-sandbox__status">{status}</p>
      <figure className="chat-sandbox__verse">
        <figcaption className="chat-decision__label">NEH 1:10 en el libro de prueba (memoria)</figcaption>
        <blockquote className="chat-decision__text">{verse || "(vacío)"}</blockquote>
      </figure>
      <div className="chat-sandbox__actions">
        <Button type="button" size="sm" variant="outline" onClick={reset}>
          Reiniciar prueba
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={Boolean(state.choice) || state.edited}
          onClick={edit}
        >
          Simular edición de 1:10
        </Button>
      </div>
    </div>
  );

  const launch = useMemo(() => sandboxLaunch(me, lang || "es-419"), [me, lang]);

  const demo = useMemo<ConversationDemo>(
    () => ({
      issue: sandboxIssue(me),
      launch,
      sources: sandboxThreadSources(state, me),
      prepared: { [sandboxDecisionId()]: sandboxPrepared(state) },
      decide,
      viewer: me,
      notice: `Tarea ficticia con @${SANDBOX_OTHER_LOGIN}: sin inventario, sin issue y sin revisión.`,
    }),
    // Sources and the pre-check only change on reset / hand edit (`round`); a choice keeps the thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me, state.round, decide, launch],
  );

  return (
    <ConversationView
      key={`prueba:${state.round}`}
      session={session}
      pmOrg=""
      lang=""
      contentOrg=""
      issueNumber={SANDBOX_ISSUE}
      canManage={canManage}
      cursor={cursor}
      demo={{ ...demo, toolbar }}
      siblings={[]}
      onMarkRead={NOOP}
      onMarkSeen={NOOP}
      onBack={onBack}
      onOpenThread={NOOP}
      onSignIn={onSignIn}
      announce={announce}
    />
  );
}
