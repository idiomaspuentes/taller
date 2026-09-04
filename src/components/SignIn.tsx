import { useState, type FormEvent } from "react";
import { HOST_OPTIONS } from "../dcs/config";
import { signInWithPassword, signInWithToken, type GtSession } from "../dcs/auth";
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

type Props = {
  open: boolean;
  onClose: () => void;
  host: string;
  onHostChange: (host: string) => void;
  onSession: (session: GtSession) => void;
};

export function SignInModal({ open, onClose, host, onHostChange, onSession }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"password" | "token">("password");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
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
      setError(err instanceof Error ? err.message : String(err));
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Iniciar sesión en DCS</DialogTitle>
          <DialogDescription>
            Necesario para elegir la organización PM y guardar asignaciones. Sin sesión puedes
            trabajar en local y exportar JSON.
          </DialogDescription>
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
          <div className="grid gap-1.5">
            <Label htmlFor="mode">Método</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "password" | "token")}>
              <SelectTrigger id="mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="password">Usuario y contraseña</SelectItem>
                <SelectItem value="token">Token (PAT)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "password" ? (
            <>
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
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="token">Token</Label>
              <Input
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="px-0">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
