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
  /** This space's own words for its branches (see `TallerConfig.branchNames`); what it leaves out is the organization's. */
  branchNames?: Partial<BranchNames>;
  /** The interface language this team starts in. */
  uiLanguage: UiLanguage;
  /** How the team is named on the welcome screen, in each interface language. */
  name: Localized;
  /**
   * Where the meaning of a word of the original is read from, in the team's language: lexicon repositories with
   * one file per Strong's number, tried in order. Left out, the app looks in `contentOrg` for `<lang>_ugl`
   * (Greek) and `<lang>_uhl` (Hebrew and Aramaic).
   */
  lexicons?: {
    greek?: LexiconRepo[];
    hebrew?: LexiconRepo[];
    /** The credit the lexicon asks for, shown under an entry, in each interface language. */
    credit?: Localized;
  };
};

/**
 * The first word of each kind of branch or tag the app keeps in a content repository: `borrador/jud/tpl` (the group
 * draft of a translation task), `trabajo/jud/tpl/ana/160` (one person's work on a subtarea), `archivo/jud/160` (what
 * was delivered), `fase/jud/traduccion` (the text as a phase left it), `publicacion/jud/1` (a unit on its way to be
 * published). Lowercase letters, digits and dashes, no slashes, all different. Changing one while a book already
 * has branches is not supported: the app would no longer find them.
 */
export type BranchNames = { draft: string; work: string; archive: string; phase: string; publish: string };

/** A lexicon repository on the same Door43 server: `<owner>/<repo>`, entries in `path` (`content` by default). */
export type LexiconRepo = { owner: string; repo: string; path?: string };

/**
 * A process an organization works with (for Idiomas Puentes, the FCR): its templates of phases, tasks and steps, the
 * tools its steps open, and the words of its older plans. It is a JSON file under `processes/`; the engine has no
 * process of its own, so another organization lists its own packages here.
 */
export type ProcessPackage = {
  schema?: string;
  /** Stable key of the process (`fcr`). */
  id: string;
  name?: string;
  /** Templates offered under «Plantillas» (`WorkflowTemplate`, checked when read). */
  workflows?: unknown[];
  /** Tools the steps can open (`SolverApp`, checked when read). */
  tools?: unknown[];
  /** Names that older plans stored as plain text, by interface language: `{ pt: { "Borrador": "Rascunho" } }`. */
  glossary?: Record<string, Record<string, string>>;
};

export type TallerConfig = {
  brand: {
    /** The app's name, in each interface language. */
    name: Localized;
    /** The organization behind it, shown above the welcome title. */
    organization: string;
    /** The organization's short commercial name, added to the app's name in the site title ("Taller Id"). */
    short: string;
  };
  /**
   * Name of the Door43 repository, in each workspace's organization, that holds the plan, the subtareas and the
   * team settings. Existing deployments that still use `gateway-tasks` keep that name here.
   */
  pmRepo: string;
  uiLanguages: UiLanguage[];
  defaultUiLanguage: UiLanguage;
  /**
   * The Door43 server a published app starts on. People can change it under "Avanzado" when signing in.
   * `VITE_DEFAULT_HOST=qa` in the build environment overrides it (used while testing). People who test open the app
   * with `?server=qa` instead; regular people are never offered the choice.
   */
  defaultServer: "production" | "qa";
  workspaces: Workspace[];
  /** The processes this organization works with. Their templates and tools are data: see `processes/`. */
  processes: ProcessPackage[];
  /**
   * When a step shares its work out badly, shown in red before a project is created: the most items one person
   * should finish alone in a subtarea, and the most people who should wait for one person. Default: 40 and 2.
   */
  workLoad?: { soloItems?: number; waiting?: number };
  /** The words the branches start with. Default: `borrador`, `trabajo`, `archivo`, `fase`, `publicacion`. */
  branchNames?: Partial<BranchNames>;
  welcome: Record<UiLanguage, WelcomeCopy>;
};
