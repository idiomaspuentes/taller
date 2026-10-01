import { useState } from "react";
import { BellRing, Check, ListChecks, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ORGANIZATION } from "../brand";
import { tallerConfig, type TallerConfig, type UiLanguage, type Workspace } from "../config";
import { setUiLanguage, useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { suggestedWorkspace } from "../workspace";
import { BrandMark } from "./BrandMark";

type Props = {
  /** The first workspace to show as chosen (the one used before, if any). */
  initialWorkspaceId?: string;
  /** Called with the chosen workspace when the person presses the sign-in button. */
  onEnter: (workspace: Workspace) => void;
  /** Already signed in (only the team is missing): the button says "continue" instead of "sign in". */
  signedIn?: boolean;
  config?: TallerConfig;
};

const POINT_ICONS = [ListChecks, Users, BellRing] as const;
const LANGUAGE_NAMES: Record<UiLanguage, string> = { es: "Español", pt: "Português" };

/**
 * The first screen for someone who is not signed in. Everything it says comes from taller.config.ts,
 * in the interface language, so another organization adapts it by editing that file.
 */
export function Welcome({ initialWorkspaceId, onEnter, signedIn = false, config = tallerConfig }: Props) {
  const language = useUiLanguage();
  const t = useT();
  const copy = config.welcome[language];
  const several = config.workspaces.length > 1;
  const [chosenId, setChosenId] = useState<string | undefined>(initialWorkspaceId);
  // Until the person picks one, the team whose language matches the interface is the one shown as chosen.
  const chosen = config.workspaces.find((w) => w.id === chosenId) ?? suggestedWorkspace(config, language);

  return (
    <div className="welcome">
      <header className="welcome__bar">
        <BrandMark />
        {config.uiLanguages.length > 1 ? (
          <div className="welcome__lang" role="group" aria-label={t("welcome.language")}>
            {config.uiLanguages.map((code) => (
              <button key={code} type="button" lang={code} aria-pressed={code === language} onClick={() => setUiLanguage(code)}>
                {LANGUAGE_NAMES[code] ?? code}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <main className="welcome__main">
        <img className="welcome__logo" src="/brand/puentes-isotipo.svg" alt="" width={64} height={56} />
        <p className="welcome__kicker">{ORGANIZATION}</p>
        <h1 className="welcome__title">{copy.title}</h1>
        <p className="welcome__lead">{copy.subtitle}</p>

        <ul className="welcome__points">
          {copy.points.map((point, index) => {
            const Icon = POINT_ICONS[index] ?? Check;
            return (
              <li key={point}>
                <span className="welcome__point-icon" aria-hidden>
                  <Icon />
                </span>
                <span>{point}</span>
              </li>
            );
          })}
        </ul>

        {several ? (
          <fieldset className="welcome__choose">
            <legend>{copy.workspacePrompt}</legend>
            <div className="welcome__cards" role="radiogroup" aria-label={copy.workspacePrompt}>
              {config.workspaces.map((workspace) => {
                const selected = workspace.id === chosen?.id;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className="welcome__card"
                    data-selected={selected || undefined}
                    onClick={() => setChosenId(workspace.id)}
                  >
                    <span className="welcome__card-name">{workspace.name[language]}</span>
                    {selected ? <Check className="welcome__card-check" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <Button type="button" size="lg" className="welcome__enter" disabled={!chosen} onClick={() => chosen && onEnter(chosen)}>
          {signedIn ? t("welcome.continue") : copy.enter}
        </Button>
        <p className="welcome__trust">{copy.trust}</p>
      </main>
    </div>
  );
}
