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
        <Label htmlFor={langInputId}>Lengua</Label>
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
            <Label htmlFor={contentId}>Organización de contenido</Label>
            {!isCustomContentOrg ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setAdvancedOpen(false)}
              >
                Ocultar
              </button>
            ) : null}
          </div>
          {useSelect ? (
            <Select value={contentOrg} onValueChange={onContentOrgChange}>
              <SelectTrigger
                id={contentId}
                className="w-full"
                aria-label="Organización de contenido"
              >
                <SelectValue placeholder="Elige una organización" />
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
              title="Donde viven los recursos públicos (TPL, TPS, Notas, Palabras, Preguntas, Academia)."
              autoComplete="off"
              spellCheck={false}
            />
          )}
          {useSelect ? (
            customOpen ? (
              <Input
                value={contentOrg}
                onChange={(e) => onContentOrgChange(e.target.value.trim())}
                title="Donde viven los recursos públicos (TPL, TPS, Notas, Palabras, Preguntas, Academia)."
                autoComplete="off"
                spellCheck={false}
                placeholder="nombre corto, p. ej. es-419_gl"
              />
            ) : (
              <button
                type="button"
                className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setCustomOpen(true)}
              >
                Otra…
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
          Avanzado: organización de contenido ({contentLabel})
        </button>
      )}
    </div>
  );
}
