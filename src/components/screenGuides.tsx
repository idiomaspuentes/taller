import { useEffect, useMemo, useState } from "react";
import type { GuideStep } from "../domain/guide";
import { GuideScreen } from "../guide";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { appName } from "../brand";
import { canPromptInstall, isInstalled, onInstallChange, promptInstall } from "../installPrompt";
import { browserPushDeps, enablePush, pushState, type PushState } from "../push";
import { onboardingDone, onboardingKey } from "../onboarding";
import type { GtSession } from "../dcs/auth";

/**
 * The guides of the screens: a few short sentences each, pointing at what to touch. What a step of the process is
 * for is not here: it comes from the process's package (see `useGuidePurpose`). These say how the screen is used,
 * the same for any process.
 */

/** An iPhone or an iPad: their browser never offers to install, the way is its Share menu. */
function isAppleTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * «Mis tareas», the first time: where the work is, where the notices are, and (where they are still to do) installing
 * the app and turning the notices on, each with its button. It replaces the card «Para empezar con buen pie».
 */
export function TasksGuide({ session, ready, hasTasks }: { session: Pick<GtSession, "token" | "host" | "username">; ready: boolean; hasTasks: boolean }) {
  const t = useT();
  const language = useUiLanguage();
  const deps = useMemo(() => browserPushDeps(), []);
  const [push, setPush] = useState<PushState | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    void pushState(deps).then((state) => live && setPush(state));
    return () => {
      live = false;
    };
  }, [deps]);
  useEffect(() => onInstallChange(() => bump((n) => n + 1)), []);
  // Whoever put away the card of first steps has been told about installing and the notices.
  const told = onboardingDone(onboardingKey(session.host, session.username));
  const name = session.username.charAt(0).toUpperCase() + session.username.slice(1);
  const installed = isInstalled();
  const steps: GuideStep[] = [
    { id: "welcome", seenKey: "tasks:welcome", title: t("guide.tasksHello").replace("{name}", name), text: t("guide.tasksWelcome").replace("{app}", appName(language)) },
    { id: "task", seenKey: "tasks:task", target: "task", text: t("guide.tasksCard") },
    { id: "alerts", seenKey: "tasks:alerts", target: "nav-avisos", text: t("guide.tasksAlerts") },
    {
      id: "install",
      seenKey: "tasks:install",
      title: t("guide.installTitle"),
      text: canPromptInstall() ? t("guide.installReady") : isAppleTouch() ? t("guide.installIos") : t("guide.installMenu"),
      when: !installed,
      ...(told ? { seenBefore: true } : {}),
      ...(canPromptInstall() ? { action: { label: t("guide.installButton"), run: () => promptInstall() } } : {}),
    },
    {
      id: "push",
      seenKey: "tasks:push",
      title: t("guide.pushTitle"),
      text: t("guide.pushText"),
      when: push === "off",
      ...(told ? { seenBefore: true } : {}),
      action: {
        label: t("guide.pushButton"),
        run: async () => {
          const state = await enablePush(deps, session);
          setPush(state);
        },
      },
    },
  ];
  return <GuideScreen steps={steps} ready={ready && push !== null} watch={hasTasks ? "tasks" : ""} />;
}

/**
 * The editor of the text: where to write, that it saves by itself, where the sources are, and what «Terminé» does (it
 * was taken for a way to save, and a draft went to review with one verse of three). Without «Terminé» on screen (the
 * step is done, or a trial), that step is left out.
 */
export function EditorGuide({ ready }: { ready: boolean }) {
  const t = useT();
  const steps: GuideStep[] = [
    { id: "verse", seenKey: "editor:verse", target: "verse", text: t("guide.editorVerse") },
    { id: "saved", seenKey: "editor:saved", target: "saved", text: t("guide.editorSaved") },
    { id: "resources", seenKey: "editor:resources", target: "resources", text: t("guide.editorResources") },
    { id: "finish", seenKey: "editor:finish", target: "finish", text: t("guide.editorFinish") },
  ];
  return <GuideScreen steps={steps} ready={ready} />;
}

/** The review of a draft: read what changed, comment where something is not right, and the button at the foot. */
export function ReviewGuide({ ready, watch }: { ready: boolean; watch: string }) {
  const t = useT();
  const steps: GuideStep[] = [
    { id: "item", seenKey: "review:item", target: "rv-item", text: t("guide.reviewItem") },
    { id: "comment", seenKey: "review:comment", target: "rv-comment", text: t("guide.reviewComment") },
    { id: "foot", seenKey: "review:foot", target: "rv-foot", text: t("guide.reviewFoot") },
  ];
  return <GuideScreen steps={steps} ready={ready} watch={watch} />;
}
