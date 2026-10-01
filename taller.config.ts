import type { TallerConfig } from "./src/config/types";

/**
 * Taller's settings for one organization. To reuse this app for another team, change this file:
 * the name, the welcome text, and the workspaces (one per language/project team).
 * Nothing here is a secret.
 */
export const tallerConfig: TallerConfig = {
  brand: {
    name: { es: "Taller", pt: "Ateliê" },
    organization: "Idiomas Puentes",
    // "Id": the I and the d of Idiomas, and the first word of «Id y haced discípulos». The site title reads "Taller Id".
    short: "Id",
  },

  // Interface languages. The first visit follows the browser's language; people can switch on the welcome screen.
  uiLanguages: ["es", "pt"],
  defaultUiLanguage: "es",

  defaultServer: "production",

  // Each workspace is a separate space: its own organization, its own tasks, never mixed with another.
  // One workspace skips the choice on the welcome screen; several show a card for each.
  workspaces: [
    {
      id: "es",
      lang: "es-419",
      contentOrg: "es-419_gl",
      pmOrg: "es-419_gl",
      uiLanguage: "es",
      name: { es: "Español (América Latina)", pt: "Espanhol (América Latina)" },
    },
    {
      id: "pt",
      lang: "pt-br",
      contentOrg: "pt-br_gl",
      pmOrg: "pt-br_gl",
      uiLanguage: "pt",
      name: { es: "Portugués (Brasil)", pt: "Português (Brasil)" },
    },
  ],

  // The first screen, per interface language.
  welcome: {
    es: {
      title: "Te damos la bienvenida",
      subtitle: "Aquí trabajamos juntos en el equipo FCR: cada tarea, cada revisión y cada decisión, en un solo lugar.",
      points: [
        "Te mostramos lo que te toca hoy, sin buscar en otros sitios.",
        "Revisa y decide con tu equipo, sin necesidad de reuniones.",
        "Te avisamos en el teléfono cuando alguien te necesita.",
      ],
      workspacePrompt: "¿Con qué equipo trabajas?",
      enter: "Entrar con Door43",
      trust: "Entras con tu cuenta de Door43. Solo pedimos los permisos necesarios para leer y guardar tus tareas, y tu contraseña no se guarda.",
    },
    pt: {
      title: "Boas-vindas",
      subtitle: "Aqui trabalhamos juntos na equipe FCR: cada tarefa, cada revisão e cada decisão, em um só lugar.",
      points: [
        "Mostramos o que cabe a você hoje, sem procurar em outros lugares.",
        "Revise e decida com sua equipe, sem precisar de reuniões.",
        "Avisamos no seu celular quando alguém precisar de você.",
      ],
      workspacePrompt: "Com qual equipe você trabalha?",
      enter: "Entrar com Door43",
      trust: "Você entra com sua conta do Door43. Pedimos só as permissões necessárias para ler e guardar suas tarefas, e sua senha não é guardada.",
    },
  },
};
