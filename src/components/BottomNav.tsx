import { Bell, CheckCircle2, ListChecks } from "lucide-react";
import { useT, type MessageKey } from "../i18n/messages";

export type BottomNavId = "ahora" | "mis-tareas" | "avisos";

type Props = {
  active: BottomNavId | null;
  attentionCount: number;
  onSelect: (id: BottomNavId) => void;
};

const ITEMS: { id: BottomNavId; label: MessageKey; Icon: typeof Bell }[] = [
  { id: "ahora", label: "nav.now", Icon: CheckCircle2 },
  { id: "mis-tareas", label: "nav.myTasks", Icon: ListChecks },
  { id: "avisos", label: "nav.alerts", Icon: Bell },
];

/** Phone navigation: the three places a worker goes. Hidden on wide screens. */
export function BottomNav({ active, attentionCount, onSelect }: Props) {
  const t = useT();
  return (
    <nav className="bottom-nav" aria-label={t("nav.main")}>
      {ITEMS.map(({ id, label: labelKey, Icon }) => {
        const label = t(labelKey);
        return (
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
        );
      })}
    </nav>
  );
}
