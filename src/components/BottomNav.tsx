import { Bell, CheckCircle2, ListChecks } from "lucide-react";

export type BottomNavId = "ahora" | "mis-tareas" | "avisos";

type Props = {
  active: BottomNavId | null;
  attentionCount: number;
  onSelect: (id: BottomNavId) => void;
};

const ITEMS: { id: BottomNavId; label: string; Icon: typeof Bell }[] = [
  { id: "ahora", label: "Ahora", Icon: CheckCircle2 },
  { id: "mis-tareas", label: "Mis tareas", Icon: ListChecks },
  { id: "avisos", label: "Avisos", Icon: Bell },
];

/** Phone navigation: the three places a worker goes. Hidden on wide screens. */
export function BottomNav({ active, attentionCount, onSelect }: Props) {
  return (
    <nav className="bottom-nav" aria-label="Principal">
      {ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className="bottom-nav__item"
          aria-current={active === id ? "page" : undefined}
          aria-label={
            id === "avisos" && attentionCount > 0
              ? `${label}, ${attentionCount} sin atender`
              : label
          }
          onClick={() => onSelect(id)}
        >
          <span className="bottom-nav__icon">
            <Icon aria-hidden />
            {id === "avisos" && attentionCount > 0 ? (
              <span className="bottom-nav__count" aria-hidden>
                {attentionCount > 99 ? "99+" : attentionCount}
              </span>
            ) : null}
          </span>
          <span className="bottom-nav__label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
