import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Eye, Menu, MoreHorizontal, Wrench } from "lucide-react";
import type { ViewMode } from "../viewMode";
import { RoleModeToggle } from "./RoleModeToggle";
import { BrowserNotifyToggle } from "./BrowserNotifyToggle";

export type AppNavLink = {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
};

type Props = {
  links: AppNavLink[];
  /** Conversations with activity this user has not opened in TAS. */
  attentionCount: number;
  /** Link that carries the attention badge. */
  attentionLinkId: string;
  /** Real DCS capability — never the preview-demoted flag. */
  canManage: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** Set only for gestores on a non-production DCS host. */
  onOpenQaAdmin?: () => void;
  /** Shows "Avisos del navegador" in the menu. */
  signedIn: boolean;
};

function attentionLabel(count: number): string {
  return count === 1
    ? "1 conversación necesita tu atención"
    : `${count} conversaciones necesitan tu atención`;
}

function AttentionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="app-nav__count" aria-hidden>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AppNav({
  links,
  attentionCount,
  attentionLinkId,
  canManage,
  viewMode,
  onViewModeChange,
  onOpenQaAdmin,
  signedIn,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const previewing = canManage && viewMode === "trabajador";
  const count = Math.max(0, attentionCount);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function selectLink(link: AppNavLink) {
    link.onSelect();
    setOpen(false);
  }

  function changeMode(mode: ViewMode) {
    onViewModeChange(mode);
    setOpen(false);
  }

  function linkAriaLabel(link: AppNavLink): string | undefined {
    if (link.id !== attentionLinkId || count <= 0) return undefined;
    return `${link.label} · ${attentionLabel(count)}`;
  }

  return (
    <nav className="app-nav" aria-label="Principal" ref={rootRef}>
      <div className="app-nav__links">
        {links.map((link) => (
          <button
            key={link.id}
            type="button"
            className="app-nav-btn"
            data-active={link.active ? "true" : "false"}
            aria-label={linkAriaLabel(link)}
            title={link.id === attentionLinkId && count > 0 ? attentionLabel(count) : undefined}
            onClick={() => selectLink(link)}
          >
            {link.label}
            {link.id === attentionLinkId ? <AttentionBadge count={count} /> : null}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="app-nav__menu-btn"
        data-role={canManage ? "true" : "false"}
        data-preview={previewing ? "true" : "false"}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        aria-label={
          [
            previewing ? "Menú · vista trabajador" : "Menú",
            count > 0 ? attentionLabel(count) : "",
          ]
            .filter(Boolean)
            .join(" · ")
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="app-nav__menu-mobile">
          <Menu className="app-nav__icon" aria-hidden />
          Menú
          <AttentionBadge count={count} />
          {previewing ? (
            <span className="app-nav__preview-mark" aria-hidden />
          ) : null}
        </span>
        <span className="app-nav__menu-desktop">
          {previewing ? (
            <>
              <Eye className="app-nav__icon" aria-hidden />
              Trabajador
              <ChevronDown className="app-nav__chevron" aria-hidden />
            </>
          ) : (
            <>
              <MoreHorizontal className="app-nav__icon" aria-hidden />
              <span className="sr-only">Vista de rol</span>
            </>
          )}
        </span>
      </button>

      {open ? (
        <div className="app-nav__panel" id={panelId}>
          <div className="app-nav__panel-links">
            {links.map((link) => (
              <button
                key={link.id}
                type="button"
                className="app-nav__panel-link"
                data-active={link.active ? "true" : "false"}
                aria-label={linkAriaLabel(link)}
                onClick={() => selectLink(link)}
              >
                {link.label}
                {link.id === attentionLinkId ? <AttentionBadge count={count} /> : null}
              </button>
            ))}
          </div>
          {canManage ? <RoleModeToggle mode={viewMode} onChange={changeMode} /> : null}
          {signedIn ? <BrowserNotifyToggle /> : null}
          {onOpenQaAdmin ? (
            <button
              type="button"
              className="app-nav__panel-link app-nav__qa-admin"
              onClick={() => {
                setOpen(false);
                onOpenQaAdmin();
              }}
            >
              <Wrench className="app-nav__icon" aria-hidden />
              Administración (QA)
            </button>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
