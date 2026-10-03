import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BellRing, Check, ListChecks, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { useT } from "../i18n/messages";
import { canPromptInstall, isInstalled, onInstallChange, promptInstall } from "../installPrompt";
import { browserPushDeps, enablePush, pushState, type PushState } from "../push";
import { explainError } from "../dcs/userError";

type Props = {
  session: Pick<GtSession, "token" | "host" | "username">;
  onHide: () => void;
};

function Step({ done, icon, title, text, children }: { done: boolean; icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <li className="onboarding__step" data-done={done || undefined}>
      <span className="onboarding__icon" aria-hidden>
        {done ? <Check /> : icon}
      </span>
      <div className="onboarding__body">
        <p className="onboarding__step-title">{title}</p>
        <p className="onboarding__step-text">{text}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * The first thing someone sees after signing in for the first time: three small steps instead of an empty screen.
 * The person hides it when they are done; it never comes back for them on this device.
 */
export function Onboarding({ session, onHide }: Props) {
  const t = useT();
  const deps = useMemo(() => browserPushDeps(), []);
  const [push, setPush] = useState<PushState>("unsupported");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, bump] = useState(0);
  const installed = isInstalled();

  useEffect(() => {
    let live = true;
    void pushState(deps).then((state) => live && setPush(state));
    return () => {
      live = false;
    };
  }, [deps]);
  useEffect(() => onInstallChange(() => bump((n) => n + 1)), []);

  async function activate() {
    setBusy(true);
    setError("");
    try {
      setPush(await enablePush(deps, session));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="onboarding" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title" className="onboarding__title">
        {t("onboarding.greeting").replace("{name}", session.username)}
      </h2>
      <p className="onboarding__lead">{t("onboarding.lead")}</p>
      <ul className="onboarding__steps">
        <Step done={installed} icon={<MonitorSmartphone />} title={t("onboarding.installTitle")} text={installed ? t("onboarding.installDone") : t("onboarding.installText")}>
          {!installed && canPromptInstall() ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void promptInstall()}>
              {t("onboarding.installButton")}
            </Button>
          ) : null}
        </Step>
        {push !== "unsupported" ? (
          <Step done={push === "on"} icon={<BellRing />} title={t("onboarding.pushTitle")} text={push === "on" ? t("onboarding.pushDone") : push === "denied" ? t("onboarding.pushDenied") : t("onboarding.pushText")}>
            {push === "off" ? (
              <Button type="button" size="sm" disabled={busy} onClick={() => void activate()}>
                {busy ? t("push.busy") : t("push.enable")}
              </Button>
            ) : null}
            {error ? <p className="onboarding__error">{error}</p> : null}
          </Step>
        ) : null}
        <Step done={false} icon={<ListChecks />} title={t("onboarding.tasksTitle")} text={t("onboarding.tasksText")} />
      </ul>
      <button type="button" className="onboarding__hide" onClick={onHide}>
        {t("onboarding.hide")}
      </button>
    </section>
  );
}
