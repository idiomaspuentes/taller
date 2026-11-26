import { useEffect, useMemo, useState } from "react";
import type { GuideStep } from "../domain/guide";
import { GuideScreen } from "../guide";
import { useT, type MessageKey } from "../i18n/messages";
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

/** Fills the names of the buttons a guide's sentence speaks of, so they read as the screen says them. */
function useFill() {
  const t = useT();
  return (key: MessageKey, values: Record<string, string>) => Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), t(key));
}

/**
 * «Estudiar»: where the reading is, the button at the foot that marks a part read and goes on (a step to do, not to
 * touch: the part is read first, so the screen is not held), and, once all are
 * read, the same place to finish. The last step waits for its button: it is shown when there is nothing left to read
 * (`watch` says what the foot offers now).
 */
export function StudyGuide({ ready, watch }: { ready: boolean; watch: string }) {
  const t = useT();
  const fill = useFill();
  const steps: GuideStep[] = [
    { id: "body", seenKey: "study:body", target: "fam-body", text: t("guide.studyBody") },
    { id: "next", seenKey: "study:next", target: "study-next", kind: "do", until: ["study:read"], text: fill("guide.studyNext", { button: t("fa.readNext") }) },
    { id: "finish", seenKey: "study:finish", target: "study-finish", text: fill("guide.studyFinish", { button: t("fa.finish") }) },
  ];
  return <GuideScreen steps={steps} ready={ready} watch={watch} />;
}

/**
 * The editor of notes and questions: a piece to open (when none is), the phrase of the source, the box under it (the
 * guide waits for something to be written), the way on to the next piece (it waits for it to be touched), and
 * «Terminé». The steps about the open piece wait for it (`flow`): with none open when the guide starts, they come once
 * the person opens one, before «Terminé».
 */
export function HelpsGuide({ ready, watch, open }: { ready: boolean; watch: string; open: boolean }) {
  const t = useT();
  const fill = useFill();
  const steps: GuideStep[] = [
    { id: "piece", seenKey: "helps:piece", target: "ab-piece", kind: "tap", when: !open, done: open, text: t("guide.helpsPiece") },
    { id: "source", seenKey: "helps:source", target: "he-source", flow: true, text: t("guide.helpsSource") },
    { id: "box", seenKey: "helps:box", target: "he-box", flow: true, kind: "do", until: ["he:wrote"], text: t("guide.helpsBox") },
    { id: "next", seenKey: "helps:next", target: "ab-next", flow: true, kind: "tap", until: ["he:next"], text: fill("guide.helpsNext", { done: t("ab.done") }) },
    { id: "finish", seenKey: "helps:finish", target: "he-finish", text: fill("guide.helpsFinish", { button: t("se.finish") }) },
  ];
  return <GuideScreen steps={steps} ready={ready} watch={watch} />;
}

/**
 * The group reading: the first verse, and what each of its three buttons does. Each is only pointed at and said: the
 * guide does not ask for «De acuerdo», so as not to give an agreement on a text the person has not read yet. (To be
 * remade with the reading as a conversation, delivery 6 of Phase 1.)
 */
export function ReadingGuide({ ready }: { ready: boolean }) {
  const t = useT();
  const fill = useFill();
  const steps: GuideStep[] = [
    { id: "verse", seenKey: "reading:verse", target: "gr-verse", text: t("guide.readingVerse") },
    { id: "agree", seenKey: "reading:agree", target: "gr-agree", text: fill("guide.readingAgree", { button: t("gr.agree") }) },
    { id: "fix", seenKey: "reading:fix", target: "gr-fix", text: fill("guide.readingFix", { button: t("gr.fix") }) },
    { id: "doubt", seenKey: "reading:doubt", target: "gr-doubt", text: fill("guide.readingDoubt", { button: t("gr.doubt") }) },
  ];
  return <GuideScreen steps={steps} ready={ready} />;
}

/** The review of a draft: touch a piece to open it, «No del todo…» inside it, and the button at the foot. */
export function ReviewGuide({ ready, watch, open, mine }: { ready: boolean; watch: string; open: boolean; mine: boolean }) {
  const t = useT();
  const fill = useFill();
  const steps: GuideStep[] = [
    // «No del todo…» lives inside an open piece: the guide first has a piece touched, and waits for it.
    { id: "item", seenKey: "review:item", target: "rv-item", kind: "tap", when: !open, done: open, text: t("guide.reviewItem") },
    { id: "comment", seenKey: "review:comment", target: "rv-comment", flow: true, text: fill(mine ? "guide.reviewCommentMine" : "guide.reviewComment", { button: t(mine ? "rv.reply" : "rv.notQuite") }) },
    { id: "foot", seenKey: "review:foot", target: "rv-foot", text: fill(mine ? "guide.reviewFootMine" : "guide.reviewFoot", { button: t(mine ? "rv.correct" : "rv.iAgree") }) },
  ];
  return <GuideScreen steps={steps} ready={ready} watch={watch} />;
}
