import { useT, type MessageKey } from "../i18n/messages";

export type AppNavLink = {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
};

type Props = {
  /** The daily destinations of the person's role; everything personal lives in the person menu. */
  links: AppNavLink[];
  /** Conversations with activity this user has not opened. */
  attentionCount: number;
  /** Link that carries the attention badge. */
  attentionLinkId: string;
};

function attentionLabel(count: number, t: (key: MessageKey) => string): string {
  return count === 1 ? t("nav.attentionOne") : t("nav.attentionMany").replace("{n}", String(count));
}

function AttentionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="app-nav__count" aria-hidden>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * The bar of wide screens: a few daily destinations, chosen by role. On phones the same places are in the bottom
 * bar, so this bar is hidden there.
 */
export function AppNav({ links, attentionCount, attentionLinkId }: Props) {
  const t = useT();
  const count = Math.max(0, attentionCount);

  return (
    <nav className="app-nav" aria-label={t("nav.main")}>
      <div className="app-nav__links">
        {links.map((link) => (
          <button
            key={link.id}
            type="button"
            className="app-nav-btn"
            data-active={link.active ? "true" : "false"}
            aria-label={link.id === attentionLinkId && count > 0 ? `${link.label} · ${attentionLabel(count, t)}` : undefined}
            title={link.id === attentionLinkId && count > 0 ? attentionLabel(count, t) : undefined}
            onClick={link.onSelect}
          >
            {link.label}
            {link.id === attentionLinkId ? <AttentionBadge count={count} /> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}
