import { Bell, FolderKanban, ListChecks, UserRound, Users } from "lucide-react";
import { useT, type MessageKey } from "../i18n/messages";

export type BottomNavId = "mis-tareas" | "avisos" | "hoy" | "proyectos" | "perfil";

/** Who the navigation is for: whoever manages, whoever coordinates a team (without managing), or the team. */
export type NavRole = "manage" | "coordinate" | "team";

type Props = {
  active: BottomNavId | null;
  attentionCount: number;
  /** People who manage start from the team and have projects at hand; whoever coordinates a team has its day too. */
  role: NavRole;
  onSelect: (id: BottomNavId) => void;
};

type Item = { id: BottomNavId; label: MessageKey; Icon: typeof Bell };

const TEAM: Item[] = [
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

/** Whoever coordinates a team: their tasks first, as anybody in the team, and the day of their team beside them. */
const TEAM_COORDINATION: Item[] = [
  { id: "mis-tareas", label: "nav.myTasks", Icon: ListChecks },
  { id: "hoy", label: "nav.teamToday", Icon: Users },
  { id: "avisos", label: "nav.alerts", Icon: Bell },
  { id: "perfil", label: "nav.me", Icon: UserRound },
];

const ITEMS: Record<NavRole, Item[]> = { manage: COORDINATION, coordinate: TEAM_COORDINATION, team: TEAM };

/** Phone navigation: the places a person goes every day, by role. Hidden on wide screens. */
export function itemsFor(role: NavRole): BottomNavId[] {
  return ITEMS[role].map((item) => item.id);
}

export function BottomNav({ active, attentionCount, role, onSelect }: Props) {
  const t = useT();
  return (
    <nav className="bottom-nav" aria-label={t("nav.main")}>
      {ITEMS[role].map(({ id, label: labelKey, Icon }) => {
        const label = t(labelKey);
        return (
          <button
            key={id}
            type="button"
            className="bottom-nav__item"
            data-guide={`nav-${id}`}
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
