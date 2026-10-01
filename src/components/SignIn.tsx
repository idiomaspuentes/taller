import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { HOST_OPTIONS } from "../dcs/config";
import { isProductionHost } from "../domain/qaAdmin";
import { signInWithPassword, signInWithToken, type GtSession } from "../dcs/auth";
import { isSessionExpiredError } from "../dcs/sessionExpiry";
import { useT } from "../i18n/messages";
import { serverChoiceVisible } from "../serverChoice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AuthMode = "password" | "token";

type Props = {
  open: boolean;
  onClose: () => void;
  host: string;
  onHostChange: (host: string) => void;
  onSession: (session: GtSession) => void;
  session?: GtSession | null;
  needsReauth?: boolean;
  sessionExpired?: boolean;
  onSignOut?: () => void;
};

function hostShort(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host.replace(/^https?:\/\//, "");
  }
}

const withoutSlash = (host: string) => host.replace(/\/$/, "");

export function SignInModal({
  open,
  onClose,
  host,
  onHostChange,
  onSession,
  session,
  needsReauth = false,
  sessionExpired = false,
  onSignOut,
}: Props) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<AuthMode>("password");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const signedIn = Boolean(session && !needsReauth);
  const canSubmit =
    mode === "password" ? Boolean(username.trim() && password) : Boolean(token.trim());
  const notice = sessionExpired ? t("signIn.expired") : needsReauth ? t("signIn.reauth") : "";

  useEffect(() => {
    if (open) return;
    setBusy(false);
    setError("");
    setPassword("");
    setToken("");
    setShowPassword(false);
    setHelpOpen(false);
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const next =
        mode === "password"
          ? await signInWithPassword(host, username.trim(), password)
          : await signInWithToken(host, token.trim());
      onSession(next);
      setPassword("");
      setToken("");
      onClose();
    } catch (err) {
      setHelpOpen(false);
      setError(
        isSessionExpiredError(err)
          ? t("signIn.wrong")
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode((m) => (m === "password" ? "token" : "password"));
    setError("");
    setHelpOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md dialog--signin" aria-busy={busy || undefined}>
        {signedIn && session ? (
          <SignedInBody session={session} onClose={onClose} onSignOut={onSignOut} />
        ) : (
          <form className="signin" onSubmit={submit} noValidate>
            <img className="signin__logo" src="/taller-isotipo.svg" alt="" width={36} height={29} />
            <DialogHeader className="signin__header">
              <DialogTitle>{needsReauth || sessionExpired ? t("signIn.again") : t("signIn.heading")}</DialogTitle>
              {notice ? (
                <DialogDescription className="signin__notice">{notice}</DialogDescription>
              ) : null}
            </DialogHeader>

            {/* Be plain about which Door43 this is: a test server should never pass for the real one. */}
            {!isProductionHost(host) ? (
              <p className="signin__env">
                <span aria-hidden className="signin__env-dot" />
                {t("signIn.testServer")} · {hostShort(host)}
              </p>
            ) : null}

            {mode === "password" ? (
              <div className="signin__fields">
                <div className="signin__field">
                  <Label htmlFor="user">{t("signIn.user")}</Label>
                  <Input
                    id="user"
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    disabled={busy}
                    aria-invalid={error ? true : undefined}
                  />
                </div>
                <div className="signin__field">
                  <Label htmlFor="pass">{t("signIn.password")}</Label>
                  <div className="signin__password">
                    <Input
                      id="pass"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      autoCapitalize="none"
                      spellCheck={false}
                      disabled={busy}
                      aria-invalid={error ? true : undefined}
                    />
                    <button
                      type="button"
                      className="signin__eye"
                      aria-label={showPassword ? t("signIn.hidePassword") : t("signIn.showPassword")}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="signin__fields">
                <div className="signin__field">
                  <Label htmlFor="token">{t("signIn.token")}</Label>
                  <Input
                    id="token"
                    name="token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    disabled={busy}
                    aria-invalid={error ? true : undefined}
                  />
                  <p className="signin__hint">{t("signIn.permsToken")}</p>
                </div>
              </div>
            )}

            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {/* Always there: a button that appears only when the fields are full hides what to do next. */}
            <Button type="submit" size="lg" className="signin__submit" disabled={!canSubmit || busy}>
              {busy ? t("signIn.busy") : t("signIn.submit")}
            </Button>

            <div className="signin__links">
              {mode === "password" ? (
                <a href={`${withoutSlash(host)}/user/forgot_password`} target="_blank" rel="noreferrer">
                  {t("signIn.forgot")}
                </a>
              ) : null}
              <a href={`${withoutSlash(host)}/user/sign_up`} target="_blank" rel="noreferrer">
                {t("signIn.createAccount")}
              </a>
            </div>

            <p className="signin__trust">{t("signIn.trust")}</p>

            <div className="signin__more">
              <button type="button" className="signin__link" onClick={switchMode}>
                {mode === "password" ? t("signIn.useToken") : t("signIn.useUserPass")}
              </button>
              <button type="button" className="signin__link" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
                {helpOpen ? t("signIn.permsHide") : t("signIn.permsAsk")}
              </button>
              {helpOpen ? (
                <p className="signin__hint">{mode === "password" ? t("signIn.permsPassword") : t("signIn.permsToken")}</p>
              ) : null}

              {serverChoiceVisible(isProductionHost(host), Boolean(import.meta.env.DEV)) ? (
              <details className="signin__advanced" open={import.meta.env.DEV || undefined}>
                <summary>{t("signIn.advanced")}</summary>
                <div className="signin__field">
                  <Label htmlFor="host">{t("signIn.server")}</Label>
                  <Select value={host} onValueChange={onHostChange}>
                    <SelectTrigger id="host" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {HOST_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {import.meta.env.DEV && isProductionHost(host) ? (
                  <Alert variant="destructive">
                    <AlertDescription>{t("signIn.devProd")}</AlertDescription>
                  </Alert>
                ) : null}
              </details>
              ) : null}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SignedInBody({
  session,
  onClose,
  onSignOut,
}: {
  session: GtSession;
  onClose: () => void;
  onSignOut?: () => void;
}) {
  const t = useT();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("signIn.session")}</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">{session.username}</span>
          {" · "}
          {hostShort(session.host)}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        {onSignOut ? (
          <Button type="button" variant="ghost" onClick={onSignOut}>
            {t("signIn.signOut")}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("signIn.close")}
        </Button>
      </DialogFooter>
    </>
  );
}
