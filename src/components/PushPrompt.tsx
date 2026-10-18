import { useEffect, useMemo, useState } from "react";
import { AtSign, BellRing, CalendarClock, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
 * On «Mis tareas», while this device has the notices off: a window that asks for them, once a visit. A thin line
 * at the top of the page went unread, and a phone then asked for a permission nobody expected and many refused.
 * So it says what the work is for (the peoples waiting for these resources to translate the Bible), what will
 * arrive (a task or a turn, a mention, one reminder a day), and that the phone will ask next, and to allow it.
 * The permission can only be asked from a touch: the window has the button.
 */
export function PushPrompt({ session }: { session: Pick<GtSession, "token" | "host" | "username"> | null }) {
  const t = useT();
  const deps = useMemo(() => browserPushDeps(), []);
  const [state, setState] = useState<PushState>("unsupported");
  const [hidden, setHidden] = useState(dismissedThisVisit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The phone said no: what to do about it is said once, instead of the question. */
  const [refused, setRefused] = useState(false);
  const login = session?.username ?? "";

  useEffect(() => {
    if (!session) return;
    let live = true;
    void pushState(deps).then((s) => live && setState(s));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, login]);

  if (!session || hidden || (state !== "off" && !refused)) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {
      /* the window just comes back next time */
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
      if (next === "denied") setRefused(true);
      else if (next === "on") dismiss();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="sm:max-w-md push-ask">
        <DialogHeader>
          <BellRing className="push-ask__icon" aria-hidden />
          <DialogTitle>{t("push.askTitle")}</DialogTitle>
          <DialogDescription className="push-ask__why">{refused ? t("push.askDenied") : t("push.askWhy")}</DialogDescription>
        </DialogHeader>
        {refused ? null : (
          <>
            <ul className="push-ask__list">
              <li>
                <ListChecks aria-hidden />
                {t("push.askTurn")}
              </li>
              <li>
                <AtSign aria-hidden />
                {t("push.askMention")}
              </li>
              <li>
                <CalendarClock aria-hidden />
                {t("push.askDaily")}
              </li>
            </ul>
            <p className="push-ask__permission">{t("push.askPermission")}</p>
          </>
        )}
        {error ? (
          <p className="push-ask__error" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          {refused ? (
            <Button type="button" size="lg" onClick={dismiss}>
              {t("push.understood")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="lg" onClick={dismiss}>
                {t("push.later")}
              </Button>
              <Button type="button" size="lg" disabled={busy} onClick={() => void activate()}>
                {busy ? t("push.busy") : t("push.enable")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
