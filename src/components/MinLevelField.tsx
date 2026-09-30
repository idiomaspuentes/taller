import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { LEVEL_LABEL, type PersonLevel } from "../domain/levels";

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
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Nivel mínimo</Label>
      <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? undefined : (v as PersonLevel))}>
        <SelectTrigger id={id} className="w-full" aria-label="Nivel mínimo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sin mínimo</SelectItem>
          {CHOICES.map((level) => (
            <SelectItem key={level} value={level}>
              {LEVEL_LABEL[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Quien no llegue a este nivel ve la tarea como «Todavía no» y no recibe aviso.
      </p>
    </div>
  );
}
