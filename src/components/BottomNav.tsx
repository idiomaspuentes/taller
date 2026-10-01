import { Bell, CheckCircle2, FolderKanban, ListChecks, UserRound, Users } from "lucide-react";
import { useT, type MessageKey } from "../i18n/messages";

export type BottomNavId = "ahora" | "mis-tareas" | "avisos" | "hoy" | "proyectos" | "perfil";

type Props = {
  active: BottomNavId | null;
  attentionCount: number;
  /** People who coordinate start from the team and have projects at hand; the rest from their next task. */
  coordinator: boolean;
  onSelect: (id: BottomNavId) => void;
};

type Item = { id: BottomNavId; label: MessageKey; Icon: typeof Bell };

const TEAM: Item[] = [
  { id: "ahora", label: "nav.now", Icon: CheckCircle2 },
  { id: "mis-tareas", label: "nav.myTasks", Icon: ListChecks },
  { id: "avisos", label: "nav.alerts", Icon: Bell },
  { id: "perfil", label: "nav.me", Icon: UserRound },
];

const COORDINATION: Item[] = [
  { id: "hoy", label: "nav.teamToday", Icon: Users },
  { id: "mis-tareas", label: "nav.myTasks", Icon: ListChecks },
  { id: "avisos", label: "nav.alerts", Icon: Bell },
  { id: "proyectos", label: "nav.projects", Icon: FolderKanban },
];

/** Phone navigation: the four places a person goes every day, by role. Hidden on wide screens. */
export function itemsFor(coordinator: boolean): BottomNavId[] {
  return (coordinator ? COORDINATION : TEAM).map((item) => item.id);
}

export function BottomNav({ active, attentionCount, coordinator, onSelect }: Props) {
  const t = useT();
  return (
    <nav className="bottom-nav" aria-label={t("nav.main")}>
      {(coordinator ? COORDINATION : TEAM).map(({ id, label: labelKey, Icon }) => {
        const label = t(labelKey);
        return (
          <button
            key={id}
            type="button"
            className="bottom-nav__item"
            aria-current={active === id ? "page" : undefined}
            aria-label={id === "avisos" && attentionCount > 0 ? `${label}, ${attentionCount}` : label}
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
