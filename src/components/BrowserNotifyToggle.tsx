import { useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationPermission } from "../browserNotifications";

/**
 * "Avisos del navegador": asks Notification permission only on click.
 * Local to this browser; no DCS scope involved.
 */
export function BrowserNotifyToggle() {
  const { permission, request } = useNotificationPermission();
  const [asking, setAsking] = useState(false);

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
            Te avisa de mensajes, decisiones y tareas nuevas cuando TAS está en otra pestaña.
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
    </div>
  );
}
