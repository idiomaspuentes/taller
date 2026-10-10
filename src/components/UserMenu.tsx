import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Check, ChevronRight, FlaskConical, FolderOpen, Globe2, LogOut, Settings2, UserRound, Users, Wrench } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { tallerConfig, type UiLanguage, type Workspace } from "../config";
import { initialsOf } from "../domain/profile";
import { setUiLanguage, useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { BrowserNotifyToggle } from "./BrowserNotifyToggle";
import { TEXT_SIZES, type TextSize } from "../domain/textSize";
import { setTextSize, useTextSize } from "../textSize";
import type { MessageKey } from "../i18n/messages";

const TEXT_SIZE_NAME: Record<TextSize, MessageKey> = { normal: "menu.textNormal", large: "menu.textLarge", larger: "menu.textLarger" };

const LANGUAGE_NAMES: Record<UiLanguage, string> = { es: "Español", pt: "Português" };

type Props = {
  session: GtSession;
  /** Shown as the person's name in the menu head (full name when known). */
  displayName?: string;
  /** People who coordinate see the team settings. */
  coordinator: boolean;
  workspaces: Workspace[];
  workspaceId?: string;
  onChooseWorkspace: (workspace: Workspace) => void;
  onOpenProfile: () => void;
  onOpenOrganization: () => void;
  onOpenTemplates: () => void;
  /** Coordinators: open a project that already exists in Door43. */
  onOpenFromDoor43?: () => void;
  /** Without workspaces in taller.config.ts: the old session dialog (language and organizations by hand). */
  onOpenSessionSettings?: () => void;
  /** Testing only (development or QA): see the app as a person of the team. */
  preview?: { on: boolean; toggle: () => void };
  onOpenQaAdmin?: () => void;
  onOpenLab?: () => void;
  onSignOut: () => void;
};

function Item({ icon, children, onClick, trailing }: { icon: ReactNode; children: ReactNode; onClick: () => void; trailing?: ReactNode }) {
  return (
    <button type="button" role="menuitem" className="user-menu__item" onClick={onClick}>
      <span className="user-menu__icon" aria-hidden>
        {icon}
      </span>
      <span className="user-menu__text">{children}</span>
      {trailing}
    </button>
  );
}

/**
 * Everything about the person in one place: their profile, team space, language, notices, the team settings (for
 * coordinators) and signing out. It replaces the session chip, the «···» menu and the role switch.
 */
export function UserMenu(props: Props) {
  const { session, coordinator, workspaces, workspaceId } = props;
  const t = useT();
  const language = useUiLanguage();
  const textSize = useTextSize();
  const [open, setOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    setNoticesOpen(false);
    fn();
  };
  const name = props.displayName?.trim() || session.username;

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("menu.open")}
        title={t("menu.open")}
        onClick={() => setOpen((v) => !v)}
      >
        {session.avatarUrl ? <img src={session.avatarUrl} alt="" width={30} height={30} /> : <span aria-hidden>{initialsOf(name)}</span>}
      </button>

      {open ? (
        <div className="user-menu__panel" role="menu" aria-label={t("menu.open")}>
          <div className="user-menu__head">
            <span className="user-menu__name">{name}</span>
            <span className="user-menu__login">@{session.username}</span>
          </div>

          <Item icon={<UserRound />} onClick={run(props.onOpenProfile)}>
            {t("menu.profile")}
          </Item>

          {workspaces.length > 1 ? (
            <div className="user-menu__group" role="group" aria-label={t("profile.workspace")}>
              <span className="user-menu__label">{t("profile.workspace")}</span>
              {workspaces.map((w) => (
                <Item
                  key={w.id}
                  icon={<Users />}
                  onClick={run(() => props.onChooseWorkspace(w))}
                  trailing={w.id === workspaceId ? <Check className="user-menu__check" aria-hidden /> : undefined}
                >
                  {w.name[language]}
                </Item>
              ))}
            </div>
          ) : null}

          {tallerConfig.uiLanguages.length > 1 ? (
            <div className="user-menu__row">
              <span className="user-menu__icon" aria-hidden>
                <Globe2 />
              </span>
              <span className="user-menu__text">{t("welcome.language")}</span>
              <span className="user-menu__langs" role="group" aria-label={t("welcome.language")}>
                {tallerConfig.uiLanguages.map((code) => (
                  <button key={code} type="button" lang={code} aria-pressed={code === language} onClick={() => setUiLanguage(code)}>
                    {LANGUAGE_NAMES[code] ?? code}
                  </button>
                ))}
              </span>
            </div>
          ) : null}

          {/* The size of the texts of the tools: chosen once here, and every tool follows. */}
          <div className="user-menu__row">
            <span className="user-menu__icon user-menu__icon--letters" aria-hidden>
              Aa
            </span>
            <span className="user-menu__text">{t("menu.textSize")}</span>
            <span className="user-menu__langs user-menu__sizes" role="group" aria-label={t("menu.textSize")}>
              {TEXT_SIZES.map((size) => (
                <button key={size} type="button" data-size={size} aria-pressed={size === textSize} aria-label={t(TEXT_SIZE_NAME[size])} title={t(TEXT_SIZE_NAME[size])} onClick={() => setTextSize(size)}>
                  A
                </button>
              ))}
            </span>
          </div>

          <Item
            icon={<Bell />}
            onClick={() => setNoticesOpen((v) => !v)}
            trailing={<ChevronRight className="user-menu__chevron" data-open={noticesOpen || undefined} aria-hidden />}
          >
            {t("menu.notifications")}
          </Item>
          {noticesOpen ? (
            <div className="user-menu__inset">
              <BrowserNotifyToggle />
            </div>
          ) : null}

          <div className="user-menu__group" role="group" aria-label={t("menu.teamSettings")}>
            <span className="user-menu__label">{coordinator ? t("menu.teamSettings") : t("menu.team")}</span>
            <Item icon={<Users />} onClick={run(props.onOpenOrganization)}>
              {t("nav.organization")}
            </Item>
            {coordinator ? (
              <Item icon={<Settings2 />} onClick={run(props.onOpenTemplates)}>
                {t("nav.templates")}
              </Item>
            ) : null}
            {coordinator && props.onOpenFromDoor43 ? (
              <Item icon={<FolderOpen />} onClick={run(props.onOpenFromDoor43)}>
                {t("menu.openFromDoor43")}
              </Item>
            ) : null}
            {props.onOpenSessionSettings ? (
              <Item icon={<Settings2 />} onClick={run(props.onOpenSessionSettings)}>
                {t("menu.sessionSettings")}
              </Item>
            ) : null}
          </div>

          {props.preview || props.onOpenQaAdmin || props.onOpenLab ? (
            <div className="user-menu__group" role="group" aria-label={t("menu.testing")}>
              <span className="user-menu__label">{t("menu.testing")}</span>
              {props.preview ? (
                <Item
                  icon={<UserRound />}
                  onClick={run(props.preview.toggle)}
                  trailing={props.preview.on ? <Check className="user-menu__check" aria-hidden /> : undefined}
                >
                  {t("menu.previewTeam")}
                </Item>
              ) : null}
              {props.onOpenQaAdmin ? (
                <Item icon={<Wrench />} onClick={run(props.onOpenQaAdmin)}>
                  {t("nav.qaAdmin")}
                </Item>
              ) : null}
              {props.onOpenLab ? (
                <Item icon={<FlaskConical />} onClick={run(props.onOpenLab)}>
                  {t("nav.lab")}
                </Item>
              ) : null}
            </div>
          ) : null}

          <div className="user-menu__sep" />
          <Item icon={<LogOut />} onClick={run(props.onSignOut)}>
            {t("signIn.signOut")}
          </Item>
        </div>
      ) : null}
    </div>
  );
}
