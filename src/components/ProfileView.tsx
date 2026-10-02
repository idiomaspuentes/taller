import { useEffect, useState } from "react";
import { ExternalLink, LogOut } from "lucide-react";
import { getAuthenticatedUser, type DcsUser } from "@ip-lms/dcs-client";
import { Button } from "@/components/ui/button";
import { dcsConfig } from "../dcs/config";
import type { GtSession } from "../dcs/auth";
import { loadPmConfig } from "../dcs/issues";
import { isCoordinatorOf, resolveLevel, type LevelBook } from "../domain/levels";
import { displayName, initialsOf, levelName, memberSince, publicProfileUrl, safeLink, settingsUrl } from "../domain/profile";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

type Props = {
  session: GtSession;
  pmOrg: string;
  /** The name of the workspace (team space) the person is in, already in the interface language. */
  workspaceName: string;
  onSignOut: () => void;
};

function hostShort(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host.replace(/^https?:\/\//, "");
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="profile__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The person's Door43 profile, read-only. Changing anything about it (name, photo, e-mail, password) happens in
 * Door43, which the page points to; when they come back the page reads the profile again.
 */
export function ProfileView({ session, pmOrg, workspaceName, onSignOut }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [user, setUser] = useState<DcsUser | null>(null);
  const [failed, setFailed] = useState(false);
  const [levelBook, setLevelBook] = useState<LevelBook | undefined>(undefined);
  const [pictureFailed, setPictureFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => {
      void getAuthenticatedUser(dcsConfig(session.host), session.token)
        .then((next) => {
          if (!live) return;
          setUser(next);
          setFailed(false);
          setPictureFailed(false);
        })
        .catch(() => live && setFailed(true));
    };
    load();
    // Coming back from Door43 after editing the profile: show what changed.
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session.host, session.token]);

  useEffect(() => {
    if (!pmOrg) return;
    let live = true;
    void loadPmConfig(session, pmOrg)
      .then((config) => live && setLevelBook(config))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [session, pmOrg]);

  const name = displayName(user, session.username);
  const picture = user?.avatar_url || session.avatarUrl || "";
  const since = memberSince(user?.created, language);
  const website = safeLink(user?.website);
  const teams = (session.teams ?? []).map((team) => team.name).filter(Boolean);

  return (
    <div className="profile">
      <section className="profile__card" aria-labelledby="profile-name">
        <div className="profile__head">
          {picture && !pictureFailed ? (
            <img className="profile__avatar" src={picture} alt="" width={88} height={88} onError={() => setPictureFailed(true)} />
          ) : (
            <span className="profile__avatar profile__avatar--initials" aria-hidden>
              {initialsOf(name)}
            </span>
          )}
          <div className="profile__who">
            <h1 id="profile-name" className="profile__name">
              {name}
            </h1>
            <p className="profile__login">@{session.username}</p>
            {since ? <p className="profile__since">{t("profile.memberSince").replace("{date}", since)}</p> : null}
          </div>
        </div>

        {failed && !user ? <p className="profile__note">{t("profile.loadError")}</p> : null}
        {user && !user.full_name?.trim() ? <p className="profile__note">{t("profile.noName")}</p> : null}
        {user?.description?.trim() ? <p className="profile__bio">{user.description.trim()}</p> : null}

        <div className="profile__actions">
          <a className="btn" data-variant="default" href={settingsUrl(session.host)} target="_blank" rel="noreferrer">
            {t("profile.edit")}
            <ExternalLink aria-hidden />
          </a>
          <a className="btn" data-variant="outline" href={publicProfileUrl(session.host, session.username)} target="_blank" rel="noreferrer">
            {t("profile.public")}
          </a>
        </div>
        <p className="profile__help">{t("profile.editHelp")}</p>
      </section>

      <section className="profile__card" aria-labelledby="profile-account">
        <h2 id="profile-account" className="profile__title">
          {t("profile.account")}
        </h2>
        <p className="profile__source">{t("profile.fromDoor43")}</p>
        <dl className="profile__list">
          {user?.email ? <Row label={t("profile.email")}>{user.email}</Row> : null}
          {user?.location?.trim() ? <Row label={t("profile.location")}>{user.location.trim()}</Row> : null}
          {website ? (
            <Row label={t("profile.website")}>
              <a href={website} target="_blank" rel="noreferrer">
                {website.replace(/^https?:\/\//, "")}
              </a>
            </Row>
          ) : null}
          <Row label={t("profile.server")}>{hostShort(session.host)}</Row>
        </dl>
      </section>

      <section className="profile__card" aria-labelledby="profile-here">
        <h2 id="profile-here" className="profile__title">
          {t("profile.inApp")}
        </h2>
        <dl className="profile__list">
          {workspaceName ? <Row label={t("profile.workspace")}>{workspaceName}</Row> : null}
          <Row label={t("profile.role")}>{session.canManage ? t("profile.roleCoordination") : t("profile.roleMember")}</Row>
          {teams.length ? (
            <Row label={t("profile.teams")}>
              <span className="profile__chips">
                {teams.map((team) => {
                  // The level is the one in that team: each team has its own ladder.
                  const level = resolveLevel(levelBook, team, session.username);
                  const extra = [isCoordinatorOf(levelBook, team, session.username) ? t("org.coordinator") : "", level ? levelName(level, language) : ""].filter(Boolean).join(" · ");
                  return (
                    <span key={team} className="profile__chip">
                      {team}
                      {extra ? <span className="profile__chip-note"> · {extra}</span> : null}
                    </span>
                  );
                })}
              </span>
            </Row>
          ) : null}
        </dl>
      </section>

      <div className="profile__foot">
        <Button type="button" variant="ghost" onClick={onSignOut}>
          <LogOut aria-hidden />
          {t("signIn.signOut")}
        </Button>
      </div>
    </div>
  );
}
