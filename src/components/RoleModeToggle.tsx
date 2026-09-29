import { Eye, Shield, Users } from "lucide-react";
import type { ViewMode } from "../viewMode";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
};

/**
 * Admin-only control to preview worker chrome.
 * Visible only when the parent mounts it (real `canManage`).
 */
export function RoleModeToggle({ mode, onChange }: Props) {
  const previewing = mode === "trabajador";

  return (
    <div className="role-mode-toggle">
      {previewing ? (
        <p className="role-mode-toggle__hint" aria-live="polite">
          Vista trabajador
        </p>
      ) : (
        <p className="role-mode-toggle__hint">Vista de rol</p>
      )}
      <div className="role-mode-toggle__group" role="group" aria-label="Cambiar vista de rol">
        <Button
          type="button"
          size="sm"
          variant={mode === "gestor" ? "default" : "ghost"}
          className={cn(
            "role-mode-toggle__btn role-mode-toggle__btn--left",
            mode !== "gestor" && "text-muted-foreground",
          )}
          aria-pressed={mode === "gestor"}
          onClick={() => onChange("gestor")}
        >
          <Shield className="size-3.5" aria-hidden />
          Gestor
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "trabajador" ? "default" : "ghost"}
          className={cn(
            "role-mode-toggle__btn role-mode-toggle__btn--right",
            mode !== "trabajador" && "text-muted-foreground",
          )}
          aria-pressed={mode === "trabajador"}
          onClick={() => onChange("trabajador")}
        >
          {previewing ? (
            <Eye className="size-3.5" aria-hidden />
          ) : (
            <Users className="size-3.5" aria-hidden />
          )}
          Trabajador
        </Button>
      </div>
    </div>
  );
}
