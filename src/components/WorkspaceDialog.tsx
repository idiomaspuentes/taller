import type { DcsOrg } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import type { LanguageOption } from "../domain/languages";
import { orgOptionLabel, orgSlug, withSelectedOrg } from "../domain/orgs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContextLangFields } from "./ContextLangFields";
import type { Workspace } from "../config";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

type Props = {
  open: boolean;
  onClose: () => void;
  lang: string;
  contentOrg: string;
  languages: LanguageOption[];
  pmOrg: string;
  orgs: DcsOrg[];
  /** Member orgs plus resolved labels (content org may not be a membership). */
  knownOrgs?: DcsOrg[];
  session: GtSession;
  onLangChange: (lang: string) => void;
  onContentOrgChange: (org: string) => void;
  onPmOrgChange: (org: string) => void;
  onSignOut: () => void;
  onOpenFromDcs: () => void;
  /** When the organization fixes its team spaces (taller.config.ts), language and organizations are not free fields. */
  workspaces?: Workspace[];
  workspaceId?: string;
  onWorkspaceChange?: (workspace: Workspace) => void;
};

function hostShort(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host.replace(/^https?:\/\//, "");
  }
}

export function WorkspaceDialog({
  open,
  onClose,
  lang,
  contentOrg,
  languages,
  pmOrg,
  orgs,
  knownOrgs,
  session,
  onLangChange,
  onContentOrgChange,
  onPmOrgChange,
  onSignOut,
  onOpenFromDcs,
  workspaces,
  workspaceId,
  onWorkspaceChange,
}: Props) {
  const t = useT();
  const uiLanguage = useUiLanguage();
  const fixed = Boolean(workspaces && workspaces.length > 0 && workspaceId);
  const pmOptions = withSelectedOrg(orgs, pmOrg);
  const showPmSelect = pmOptions.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="dialog--workspace">
        <DialogHeader>
          <DialogTitle>Sesión</DialogTitle>
          <DialogDescription>
            Tu identidad, lengua y organización del equipo para este espacio de trabajo.
          </DialogDescription>
        </DialogHeader>

        <div className="workspace-dialog__body">
          <div className="grid gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.username}</p>
                <p className="truncate text-xs text-muted-foreground">{hostShort(session.host)}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={onSignOut}>
                Cerrar sesión
              </Button>
            </div>

            {fixed && workspaces ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ws-space">{t("workspace.title")}</Label>
                {workspaces.length > 1 ? (
                  <Select
                    value={workspaceId}
                    onValueChange={(id) => {
                      const next = workspaces.find((w) => w.id === id);
                      if (next) onWorkspaceChange?.(next);
                    }}
                  >
                    <SelectTrigger id="ws-space" className="w-full" aria-label={t("workspace.title")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {workspaces.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name[uiLanguage]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-medium">{workspaces[0]?.name[uiLanguage]}</p>
                )}
                {workspaces.length > 1 ? <p className="text-xs text-muted-foreground">{t("workspace.help")}</p> : null}
              </div>
            ) : (
              <>
            <ContextLangFields
              lang={lang}
              contentOrg={contentOrg}
              languages={languages}
              orgs={knownOrgs ?? orgs}
              onLangChange={onLangChange}
              onContentOrgChange={onContentOrgChange}
              langInputId="ws-lang"
            />

            {showPmSelect ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ws-pm">Organización del equipo</Label>
                <Select value={pmOrg} onValueChange={onPmOrgChange}>
                  <SelectTrigger id="ws-pm" className="w-full" aria-label="Organización del equipo">
                    <SelectValue placeholder="Elige una organización" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {!pmOrg ? (
                      <SelectItem value="" disabled>
                        Elige una organización
                      </SelectItem>
                    ) : null}
                    {pmOptions.map((org) => {
                      const slug = orgSlug(org);
                      return (
                        <SelectItem key={slug} value={slug}>
                          {orgOptionLabel(org)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
              </>
            )}

            {pmOrg ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={onOpenFromDcs}
              >
                Abrir desde Door43
              </Button>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
