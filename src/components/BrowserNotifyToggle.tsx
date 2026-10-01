import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationPermission } from "../browserNotifications";
import { useT } from "../i18n/messages";
import { loadSession } from "../dcs/auth";
import { browserPushDeps, disablePush, enablePush, pushState, type PushState } from "../push";

/**
 * "Avisos del navegador": asks Notification permission only on click.
 * Local to this browser; no DCS scope involved.
 */
export function BrowserNotifyToggle() {
  const t = useT();
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
      <p className="role-mode-toggle__hint">{t("bn.title")}</p>
      {permission === "unsupported" ? (
        <p className="browser-notify__note">
          <BellOff className="size-3.5" aria-hidden />
          {t("bn.unsupported")}
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
            {asking ? t("bn.waiting") : t("bn.enable")}
          </Button>
          <p className="browser-notify__note">
            {t("bn.enableNote")}
          </p>
        </>
      ) : null}
      {permission === "granted" ? (
        <p className="browser-notify__note browser-notify__note--on" aria-live="polite">
          <BellRing className="size-3.5" aria-hidden />
          {t("bn.on")}
        </p>
      ) : null}
      {permission === "denied" ? (
        <p className="browser-notify__note" aria-live="polite">
          <BellOff className="size-3.5" aria-hidden />
          {t("bn.denied")}
        </p>
      ) : null}
      {push !== "unsupported" ? (
        <div className="browser-notify__push">
          <p className="role-mode-toggle__hint">{t("bn.closedTitle")}</p>
          {push === "off" ? (
            <>
              <Button type="button" size="sm" variant="outline" className="browser-notify__btn" disabled={pushBusy} onClick={() => void togglePush(true)}>
                <Bell className="size-3.5" aria-hidden />
                {pushBusy ? t("bn.activating") : t("bn.enableDevice")}
              </Button>
              <p className="browser-notify__note">{t("bn.deviceNote")}</p>
            </>
          ) : null}
          {push === "on" ? (
            <>
              <p className="browser-notify__note browser-notify__note--on" aria-live="polite">
                <BellRing className="size-3.5" aria-hidden />
                {t("bn.deviceOn")}
              </p>
              <Button type="button" size="sm" variant="ghost" disabled={pushBusy} onClick={() => void togglePush(false)}>
                {t("bn.disable")}
              </Button>
            </>
          ) : null}
          {push === "denied" ? (
            <p className="browser-notify__note" aria-live="polite">
              <BellOff className="size-3.5" aria-hidden />
              {t("bn.deviceDenied")}
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
