/** The shape of `taller.config.ts` (repo root). Everything an organization adapts lives there. */

/** Languages the interface speaks. Add a code here and a column in `src/i18n/messages.ts` to support another. */
export type UiLanguage = "es" | "pt";

/** A text in every interface language. */
export type Localized = Record<UiLanguage, string>;

/** What the first screen says, in one interface language. */
export type WelcomeCopy = {
  title: string;
  subtitle: string;
  /** Short lines about what the person will find; shown with an icon each. */
  points: [string, string, string];
  /** Shown above the choice of team, when there is more than one. */
  workspacePrompt: string;
  enter: string;
  /** A line of reassurance next to the sign-in button. */
  trust: string;
};

/**
 * One team's own space. Its tasks, projects and notices live in its own organization and are never
 * mixed with another space's: the app only reads and writes inside the chosen one.
 */
export type Workspace = {
  /** Stable key kept in the browser; never change it once people use the app. */
  id: string;
  /** Door43 language code of the project (`es-419`, `pt-br`). */
  lang: string;
  /** Door43 organization that holds the project's content repositories. */
  contentOrg: string;
  /** Door43 organization that holds the `gateway-tasks` repository (the plan and its subtareas). */
  pmOrg: string;
  /**
   * What keeps this space apart from another one in the SAME organization (even in the same language): its issues,
   * milestones, plan files and local copies are marked with it. Letters, digits and dashes. Leave it out for a space
   * that is alone in its organization; at most one space per organization may leave it out.
   */
  scope?: string;
  /** The interface language this team starts in. */
  uiLanguage: UiLanguage;
  /** How the team is named on the welcome screen, in each interface language. */
  name: Localized;
};

export type TallerConfig = {
  brand: {
    /** The app's name, in each interface language. */
    name: Localized;
    /** The organization behind it, shown above the welcome title. */
    organization: string;
  };
  uiLanguages: UiLanguage[];
  defaultUiLanguage: UiLanguage;
  /**
   * The Door43 server a published app starts on. People can change it under "Avanzado" when signing in.
   * `VITE_DEFAULT_HOST=qa` in the build environment overrides it (used while testing).
   */
  defaultServer: "production" | "qa";
  workspaces: Workspace[];
  welcome: Record<UiLanguage, WelcomeCopy>;
};
