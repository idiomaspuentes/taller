import { useEffect, useState, type FormEvent } from "react";
import { HOST_OPTIONS } from "../dcs/config";
import { signInWithPassword, signInWithToken, type GtSession } from "../dcs/auth";
import { isSessionExpiredError, SESSION_EXPIRED_MESSAGE } from "../dcs/sessionExpiry";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<AuthMode>("password");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const signedIn = Boolean(session && !needsReauth);
  const canSubmit =
    mode === "password" ? Boolean(username.trim() && password) : Boolean(token.trim());

  useEffect(() => {
    if (open) return;
    setBusy(false);
    setError("");
    setPassword("");
    setToken("");
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
          ? "Usuario, contraseña o token incorrectos."
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md" aria-busy={busy || undefined}>
        {signedIn && session ? (
          <SignedInBody session={session} onClose={onClose} onSignOut={onSignOut} />
        ) : busy ? (
          <BusyBody />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {needsReauth || sessionExpired ? "Volver a iniciar sesión" : "Iniciar sesión en DCS"}
              </DialogTitle>
              {sessionExpired ? (
                <DialogDescription>{SESSION_EXPIRED_MESSAGE}</DialogDescription>
              ) : needsReauth ? (
                <DialogDescription>
                  Tu token no tiene los permisos actuales. Vuelve a entrar para renovarlo.
                </DialogDescription>
              ) : null}
            </DialogHeader>
            <form className="grid gap-3" onSubmit={submit}>
              <div className="grid gap-1.5">
                <Label htmlFor="host">Servidor</Label>
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

              <Tabs
                value={mode}
                onValueChange={(value) => {
                  setMode(value as AuthMode);
                  setError("");
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="password" className="flex-1">
                    Contraseña
                  </TabsTrigger>
                  <TabsTrigger value="token" className="flex-1">
                    Token
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="password" className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="user">Usuario</Label>
                    <Input
                      id="user"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      autoFocus
                      required
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="pass">Contraseña</Label>
                    <Input
                      id="pass"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </TabsContent>
                <TabsContent value="token" className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="token">Token</Label>
                    <Input
                      id="token"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      autoComplete="off"
                      autoFocus
                      required
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <button
                type="button"
                className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setHelpOpen((openHelp) => !openHelp)}
              >
                {helpOpen ? "Ocultar permisos" : "¿Qué permisos?"}
              </button>
              {helpOpen ? (
                <p className="text-xs text-muted-foreground">
                  {mode === "password"
                    ? "Al entrar se crea un token con acceso a repositorios, issues, organización y notificaciones."
                    : "Pega un token que ya tenga acceso a repositorios, issues, organización y notificaciones."}
                </p>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <DialogFooter className="px-0">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancelar
                </Button>
                {canSubmit ? (
                  <Button type="submit">Entrar</Button>
                ) : null}
              </DialogFooter>
            </form>
          </>
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
  return (
    <>
      <DialogHeader>
        <DialogTitle>Sesión DCS</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">{session.username}</span>
          {" · "}
          {hostShort(session.host)}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        {onSignOut ? (
          <Button type="button" variant="ghost" onClick={onSignOut}>
            Cerrar sesión
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </DialogFooter>
    </>
  );
}

function BusyBody() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Iniciar sesión en DCS</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        Entrando…
      </p>
    </>
  );
}
