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
}: Props) {
  const pmOptions = withSelectedOrg(orgs, pmOrg);
  const showPmSelect = pmOptions.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="dialog--workspace">
        <DialogHeader>
          <DialogTitle>Sesión</DialogTitle>
          <DialogDescription>
            Identidad en DCS, lengua y organización PM para este espacio de trabajo.
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
                <Label htmlFor="ws-pm">Organización PM</Label>
                <Select value={pmOrg} onValueChange={onPmOrgChange}>
                  <SelectTrigger id="ws-pm" className="w-full" aria-label="Organización PM">
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

            {pmOrg ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={onOpenFromDcs}
              >
                Abrir DCS
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
