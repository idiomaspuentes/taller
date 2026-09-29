import { cn } from "@/lib/utils";

export type ChoiceOption = {
  value: string;
  label: string;
  description: string;
};

type Props = {
  name: string;
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  className?: string;
};

/**
 * Radio-style list that keeps each option's description visible while choosing —
 * native <select> cannot show rich option content.
 */
export function ChoiceGroup({ name, label, value, options, onChange, className }: Props) {
  return (
    <fieldset className={cn("grid gap-1.5", className)}>
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="grid gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value;
          const id = `${name}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                "grid cursor-pointer gap-0.5 rounded-lg border px-2.5 py-2 transition",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  id={id}
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={selected}
                  onChange={() => onChange(option.value)}
                  className="size-3.5 shrink-0 accent-[var(--primary)]"
                />
                <span className="text-sm font-medium">{option.label}</span>
              </span>
              <span className="pl-5 text-xs text-muted-foreground">{option.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
