import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Eye, Menu, MoreHorizontal, Wrench } from "lucide-react";
import type { ViewMode } from "../viewMode";
import { RoleModeToggle } from "./RoleModeToggle";
import { BrowserNotifyToggle } from "./BrowserNotifyToggle";
import { useT, type MessageKey } from "../i18n/messages";

export type AppNavLink = {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
  /** Listed in the phone menu only: on a wide screen it has its own button elsewhere. */
  menuOnly?: boolean;
  /** Links that share a group name sit under one dropdown button on wide screens (the phone menu lists them all). */
  group?: string;
};

type NavEntry = { kind: "link"; link: AppNavLink } | { kind: "group"; name: string; links: AppNavLink[] };

/** The inline bar: ungrouped links as they are, each group once, at the place of its first link. */
export function navEntries(links: AppNavLink[]): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const link of links.filter((l) => !l.menuOnly)) {
    if (!link.group) {
      entries.push({ kind: "link", link });
      continue;
    }
    const existing = entries.find((e): e is Extract<NavEntry, { kind: "group" }> => e.kind === "group" && e.name === link.group);
    if (existing) existing.links.push(link);
    else entries.push({ kind: "group", name: link.group, links: [link] });
  }
  return entries;
}

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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState<string | null>(null);
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

  useEffect(() => {
    if (!groupOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setGroupOpen(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setGroupOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [groupOpen]);

  function selectLink(link: AppNavLink) {
    link.onSelect();
    setOpen(false);
    setGroupOpen(null);
  }

  function changeMode(mode: ViewMode) {
    onViewModeChange(mode);
    setOpen(false);
  }

  function linkAriaLabel(link: AppNavLink): string | undefined {
    if (link.id !== attentionLinkId || count <= 0) return undefined;
    return `${link.label} · ${attentionLabel(count, t)}`;
  }

  return (
    <nav className="app-nav" aria-label={t("nav.main")} ref={rootRef}>
      <div className="app-nav__links">
        {navEntries(links).map((entry) =>
          entry.kind === "link" ? (
            <button
              key={entry.link.id}
              type="button"
              className="app-nav-btn"
              data-active={entry.link.active ? "true" : "false"}
              aria-label={linkAriaLabel(entry.link)}
              title={entry.link.id === attentionLinkId && count > 0 ? attentionLabel(count, t) : undefined}
              onClick={() => selectLink(entry.link)}
            >
              {entry.link.label}
              {entry.link.id === attentionLinkId ? <AttentionBadge count={count} /> : null}
            </button>
          ) : (
            <div key={`group:${entry.name}`} className="app-nav__group">
              <button
                type="button"
                className="app-nav-btn"
                data-active={entry.links.some((l) => l.active) ? "true" : "false"}
                aria-expanded={groupOpen === entry.name}
                aria-haspopup="true"
                onClick={() => setGroupOpen((current) => (current === entry.name ? null : entry.name))}
              >
                {entry.name}
                <ChevronDown className="app-nav__chevron" aria-hidden />
              </button>
              {groupOpen === entry.name ? (
                <div className="app-nav__dropdown">
                  {entry.links.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      className="app-nav__panel-link"
                      data-active={link.active ? "true" : "false"}
                      onClick={() => selectLink(link)}
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ),
        )}
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
            previewing ? t("nav.menuWorker") : t("nav.menu"),
            count > 0 ? attentionLabel(count, t) : "",
          ]
            .filter(Boolean)
            .join(" · ")
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="app-nav__menu-mobile">
          <Menu className="app-nav__icon" aria-hidden />
          {t("nav.menu")}
          <AttentionBadge count={count} />
          {previewing ? (
            <span className="app-nav__preview-mark" aria-hidden />
          ) : null}
        </span>
        <span className="app-nav__menu-desktop">
          {previewing ? (
            <>
              <Eye className="app-nav__icon" aria-hidden />
              {t("nav.workerShort")}
              <ChevronDown className="app-nav__chevron" aria-hidden />
            </>
          ) : (
            <>
              <MoreHorizontal className="app-nav__icon" aria-hidden />
              <span className="sr-only">{t("nav.roleView")}</span>
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
              {t("nav.qaAdmin")}
            </button>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
