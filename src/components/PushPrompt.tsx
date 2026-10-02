import { useEffect, useMemo, useState } from "react";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { browserPushDeps, enablePush, pushState, type PushState } from "../push";
import type { GtSession } from "../dcs/auth";
import { useT } from "../i18n/messages";
import { explainError } from "../dcs/userError";

const DISMISSED = "taller-push-prompt-dismissed";

function dismissedThisVisit(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

/**
 * After signing in, offers the notices with the app closed while this device has them off.
 * The permission can only be asked from a tap, so this is a banner with a button, not a prompt.
 */
export function PushPrompt({ session }: { session: Pick<GtSession, "token" | "host" | "username"> | null }) {
  const t = useT();
  const deps = useMemo(() => browserPushDeps(), []);
  const [state, setState] = useState<PushState>("unsupported");
  const [hidden, setHidden] = useState(dismissedThisVisit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const login = session?.username ?? "";

  useEffect(() => {
    if (!session) return;
    let live = true;
    void pushState(deps).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [deps, login]);

  if (!session || hidden || state !== "off") return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {
      /* the banner just comes back next time */
    }
    setHidden(true);
  }

  async function activate() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const next = await enablePush(deps, session);
      setState(next);
      if (next === "denied") dismiss();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-prompt" role="region" aria-label={t("push.region")}>
      <BellRing className="size-4" aria-hidden />
      <p>{t("push.text")}</p>
      <Button type="button" size="sm" disabled={busy} onClick={() => void activate()}>
        {busy ? t("push.busy") : t("push.enable")}
      </Button>
      <button type="button" className="push-prompt__close" aria-label={t("push.later")} onClick={dismiss}>
        <X className="size-4" aria-hidden />
      </button>
      {error ? <p className="push-prompt__error">{error}</p> : null}
    </div>
  );
}
