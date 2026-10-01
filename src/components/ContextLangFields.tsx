import { useState } from "react";
import type { DcsOrg } from "@ip-lms/dcs-client";
import { defaultContentOrg } from "../domain/books";
import type { LanguageOption } from "../domain/languages";
import {
  orgDisplayNameBySlug,
  orgOptionLabel,
  orgSlug,
  withSelectedOrg,
} from "../domain/orgs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "../i18n/messages";
import { LanguagePicker } from "./LanguagePicker";

type Props = {
  lang: string;
  contentOrg: string;
  languages?: LanguageOption[];
  orgs?: DcsOrg[];
  onLangChange: (lang: string) => void;
  onContentOrgChange: (org: string) => void;
  langInputId?: string;
};

export function ContextLangFields({
  lang,
  contentOrg,
  languages,
  orgs = [],
  onLangChange,
  onContentOrgChange,
  langInputId = "ctx-lang",
}: Props) {
  const t = useT();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const isCustomContentOrg = contentOrg !== defaultContentOrg(lang);
  const showContentOrg = advancedOpen || isCustomContentOrg;
  const contentOptions = withSelectedOrg(orgs, contentOrg);
  const useSelect = contentOptions.length > 0;
  const contentLabel = orgDisplayNameBySlug(contentOrg, contentOptions);
  const contentId = `${langInputId}-content`;

  return (
    <div className="context-lang">
      <div className="grid gap-1.5">
        <Label htmlFor={langInputId}>{t("cl.lang")}</Label>
        <LanguagePicker
          id={langInputId}
          value={lang}
          onChange={onLangChange}
          languages={languages}
        />
      </div>

      {showContentOrg ? (
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={contentId}>{t("cl.contentOrg")}</Label>
            {!isCustomContentOrg ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setAdvancedOpen(false)}
              >
                {t("cl.hide")}
              </button>
            ) : null}
          </div>
          {useSelect ? (
            <Select value={contentOrg} onValueChange={onContentOrgChange}>
              <SelectTrigger
                id={contentId}
                className="w-full"
                aria-label={t("cl.contentOrg")}
              >
                <SelectValue placeholder={t("cl.pickOrg")} />
              </SelectTrigger>
              <SelectContent position="popper">
                {contentOptions.map((org) => {
                  const slug = orgSlug(org);
                  return (
                    <SelectItem key={slug} value={slug}>
                      {orgOptionLabel(org)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={contentId}
              value={contentOrg}
              onChange={(e) => onContentOrgChange(e.target.value.trim())}
              title={t("cl.where")}
              autoComplete="off"
              spellCheck={false}
            />
          )}
          {useSelect ? (
            customOpen ? (
              <Input
                value={contentOrg}
                onChange={(e) => onContentOrgChange(e.target.value.trim())}
                title={t("cl.where")}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("cl.shortName")}
              />
            ) : (
              <button
                type="button"
                className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setCustomOpen(true)}
              >
                {t("cl.other")}
              </button>
            )
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setAdvancedOpen(true)}
        >
          {t("cl.advanced").replace("{org}", contentLabel)}
        </button>
      )}
    </div>
  );
}
