import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { levelLabel, type PersonLevel } from "../domain/levels";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";

const CHOICES: PersonLevel[] = ["aprendiz", "practicante", "habilitada"];

/** «Nivel mínimo»: the lowest person level that is told about, and can take, this task. */
export function MinLevelField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: PersonLevel | undefined;
  onChange: (next: PersonLevel | undefined) => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{t("ml.label")}</Label>
      <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? undefined : (v as PersonLevel))}>
        <SelectTrigger id={id} className="w-full" aria-label={t("ml.label")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("ml.none")}</SelectItem>
          {CHOICES.map((level) => (
            <SelectItem key={level} value={level}>
              {levelLabel(level, language)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t("ml.help")}
      </p>
    </div>
  );
}
