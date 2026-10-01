import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationPermission } from "../browserNotifications";
import { loadSession } from "../dcs/auth";
import { browserPushDeps, disablePush, enablePush, pushState, type PushState } from "../push";

/**
 * "Avisos del navegador": asks Notification permission only on click.
 * Local to this browser; no DCS scope involved.
 */
export function BrowserNotifyToggle() {
  const { permission, request } = useNotificationPermission();
  const [asking, setAsking] = useState(false);
  const pushDeps = useMemo(() => browserPushDeps(), []);
  const [push, setPush] = useState<PushState>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  useEffect(() => {
    void pushState(pushDeps).then(setPush);
  }, [pushDeps, permission]);

  async function togglePush(on: boolean) {
    const session = loadSession();
    if (!session) return;
    setPushBusy(true);
    setPushError("");
    try {
      setPush(on ? await enablePush(pushDeps, session) : await disablePush(pushDeps, session));
    } catch (err) {
      setPushError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="browser-notify" data-state={permission}>
      <p className="role-mode-toggle__hint">Avisos del navegador</p>
      {permission === "unsupported" ? (
        <p className="browser-notify__note">
          <BellOff className="size-3.5" aria-hidden />
          Este navegador no admite avisos.
        </p>
      ) : null}
      {permission === "default" ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="browser-notify__btn"
            disabled={asking}
            onClick={async () => {
              setAsking(true);
              try {
                await request();
              } finally {
                setAsking(false);
              }
            }}
          >
            <Bell className="size-3.5" aria-hidden />
            {asking ? "Esperando permiso…" : "Activar avisos"}
          </Button>
          <p className="browser-notify__note">
            Te avisa de mensajes, decisiones y tareas nuevas cuando Taller está en otra pestaña.
          </p>
        </>
      ) : null}
      {permission === "granted" ? (
        <p className="browser-notify__note browser-notify__note--on" aria-live="polite">
          <BellRing className="size-3.5" aria-hidden />
          Avisos activados
        </p>
      ) : null}
      {permission === "denied" ? (
        <p className="browser-notify__note" aria-live="polite">
          <BellOff className="size-3.5" aria-hidden />
          Bloqueados en este navegador. Para activarlos, permite las notificaciones de este sitio
          en la configuración del navegador.
        </p>
      ) : null}
      {push !== "unsupported" ? (
        <div className="browser-notify__push">
          <p className="role-mode-toggle__hint">Avisos con la app cerrada</p>
          {push === "off" ? (
            <>
              <Button type="button" size="sm" variant="outline" className="browser-notify__btn" disabled={pushBusy} onClick={() => void togglePush(true)}>
                <Bell className="size-3.5" aria-hidden />
                {pushBusy ? "Activando…" : "Activar en este dispositivo"}
              </Button>
              <p className="browser-notify__note">Te llega un aviso al teléfono cuando te mencionan o te asignan algo, aunque no tengas Taller abierto.</p>
            </>
          ) : null}
          {push === "on" ? (
            <>
              <p className="browser-notify__note browser-notify__note--on" aria-live="polite">
                <BellRing className="size-3.5" aria-hidden />
                Activados en este dispositivo
              </p>
              <Button type="button" size="sm" variant="ghost" disabled={pushBusy} onClick={() => void togglePush(false)}>
                Desactivar
              </Button>
            </>
          ) : null}
          {push === "denied" ? (
            <p className="browser-notify__note" aria-live="polite">
              <BellOff className="size-3.5" aria-hidden />
              Bloqueados en este navegador. Permite las notificaciones de este sitio para activarlos.
            </p>
          ) : null}
          {pushError ? (
            <p className="browser-notify__note" role="alert">
              {pushError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
