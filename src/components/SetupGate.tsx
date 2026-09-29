import type { DcsOrg } from "@ip-lms/dcs-client";
import type { LanguageOption } from "../domain/languages";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ContextLangFields } from "./ContextLangFields";

type Props = {
  lang: string;
  contentOrg: string;
  languages?: LanguageOption[];
  orgs?: DcsOrg[];
  onLangChange: (lang: string) => void;
  onContentOrgChange: (org: string) => void;
  onContinue: () => void;
};

export function SetupGate({
  lang,
  contentOrg,
  languages,
  orgs,
  onLangChange,
  onContentOrgChange,
  onContinue,
}: Props) {
  const valid = Boolean(lang.trim());

  return (
    <Card className="mx-auto max-w-lg" size="sm">
      <CardHeader>
        <CardTitle>Contexto</CardTitle>
        <CardDescription>
          Elige la lengua del proyecto. El libro se elige al crear o abrir un proyecto.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ContextLangFields
          lang={lang}
          contentOrg={contentOrg}
          languages={languages}
          orgs={orgs}
          onLangChange={onLangChange}
          onContentOrgChange={onContentOrgChange}
          langInputId="setup-lang"
        />
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" disabled={!valid} onClick={onContinue}>
          Continuar
        </Button>
      </CardFooter>
    </Card>
  );
}
