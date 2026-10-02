import { useT } from "../i18n/messages";

/** «Recorre cada unidad»: the task has a subtarea for every chapter (or stretch), whatever is pending in it. */
export function EveryUnitField({ value, onChange, disabled }: { value: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <label className="grid gap-1 text-sm">
      <span className="inline-flex items-center gap-2 font-medium">
        <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {t("tv.everyUnit")}
      </span>
      <span className="text-xs text-muted-foreground">{t("tv.everyUnitHelp")}</span>
    </label>
  );
}
