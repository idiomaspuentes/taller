import type { UiLanguage } from "../config";
import { getUiLanguage, useUiLanguage } from "./language";

/** Texts of the app that are not specific to one organization. The organization's own words live in taller.config.ts. */
const es = {
  "nav.now": "Ahora",
  "nav.myTasks": "Mis tareas",
  "nav.alerts": "Avisos",
  "nav.teamToday": "Equipo hoy",
  "nav.projects": "Proyectos",
  "nav.organization": "Organización",
  "nav.lab": "Laboratorio",
  "header.signIn": "Iniciar sesión",
  "welcome.language": "Idioma",
  "welcome.continue": "Continuar",
  "workspace.title": "Espacio de trabajo",
  "workspace.help": "Cada equipo tiene su propio espacio, con sus tareas y proyectos. Al cambiar, la app se recarga.",
  "push.text": "Activa los avisos para enterarte de menciones y asignaciones aunque la app esté cerrada.",
  "push.enable": "Activar avisos",
  "push.busy": "Activando…",
  "push.later": "Ahora no",
  "signIn.title": "Iniciar sesión",
  "signIn.again": "Volver a iniciar sesión",
  "signIn.expired": "Tu sesión caducó. Vuelve a iniciar sesión.",
  "signIn.reauth": "Tu token no tiene los permisos actuales. Vuelve a entrar para renovarlo.",
  "signIn.server": "Servidor",
  "signIn.advanced": "Avanzado: servidor",
  "signIn.devProd": "Esta es la versión de desarrollo y el servidor elegido es producción. Si estás probando, elige QA.",
  "signIn.tabPassword": "Contraseña",
  "signIn.tabToken": "Token",
  "signIn.user": "Usuario",
  "signIn.password": "Contraseña",
  "signIn.token": "Token",
  "signIn.wrong": "Usuario, contraseña o token incorrectos.",
  "signIn.permsAsk": "¿Qué permisos?",
  "signIn.permsHide": "Ocultar permisos",
  "signIn.permsPassword": "Al entrar se crea un token con acceso a repositorios, subtareas, organización y notificaciones.",
  "signIn.permsToken": "Pega un token que ya tenga acceso a repositorios, subtareas, organización y notificaciones.",
  "signIn.cancel": "Cancelar",
  "signIn.submit": "Entrar",
  "signIn.busy": "Entrando…",
  "signIn.session": "Tu sesión",
  "signIn.signOut": "Cerrar sesión",
  "signIn.close": "Cerrar",
} as const;

export type MessageKey = keyof typeof es;

const pt: Record<MessageKey, string> = {
  "nav.now": "Agora",
  "nav.myTasks": "Minhas tarefas",
  "nav.alerts": "Avisos",
  "nav.teamToday": "Equipe hoje",
  "nav.projects": "Projetos",
  "nav.organization": "Organização",
  "nav.lab": "Laboratório",
  "header.signIn": "Entrar",
  "welcome.language": "Idioma",
  "welcome.continue": "Continuar",
  "workspace.title": "Espaço de trabalho",
  "workspace.help": "Cada equipe tem seu próprio espaço, com suas tarefas e projetos. Ao trocar, o app recarrega.",
  "push.text": "Ative os avisos para saber de menções e atribuições mesmo com o app fechado.",
  "push.enable": "Ativar avisos",
  "push.busy": "Ativando…",
  "push.later": "Agora não",
  "signIn.title": "Entrar",
  "signIn.again": "Entrar novamente",
  "signIn.expired": "Sua sessão expirou. Entre novamente.",
  "signIn.reauth": "Seu token não tem as permissões atuais. Entre novamente para renová-lo.",
  "signIn.server": "Servidor",
  "signIn.advanced": "Avançado: servidor",
  "signIn.devProd": "Esta é a versão de desenvolvimento e o servidor escolhido é produção. Se estiver testando, escolha QA.",
  "signIn.tabPassword": "Senha",
  "signIn.tabToken": "Token",
  "signIn.user": "Usuário",
  "signIn.password": "Senha",
  "signIn.token": "Token",
  "signIn.wrong": "Usuário, senha ou token incorretos.",
  "signIn.permsAsk": "Quais permissões?",
  "signIn.permsHide": "Ocultar permissões",
  "signIn.permsPassword": "Ao entrar, é criado um token com acesso a repositórios, subtarefas, organização e notificações.",
  "signIn.permsToken": "Cole um token que já tenha acesso a repositórios, subtarefas, organização e notificações.",
  "signIn.cancel": "Cancelar",
  "signIn.submit": "Entrar",
  "signIn.busy": "Entrando…",
  "signIn.session": "Sua sessão",
  "signIn.signOut": "Sair",
  "signIn.close": "Fechar",
};

const TABLE: Record<UiLanguage, Record<MessageKey, string>> = { es, pt };

export function translate(language: UiLanguage, key: MessageKey): string {
  return TABLE[language]?.[key] ?? es[key];
}

/** For code outside components. */
export const tNow = (key: MessageKey): string => translate(getUiLanguage(), key);

/** For components: re-renders when the interface language changes. */
export function useT(): (key: MessageKey) => string {
  const language = useUiLanguage();
  return (key) => translate(language, key);
}

export { MESSAGE_KEYS_ES };
const MESSAGE_KEYS_ES = Object.keys(es) as MessageKey[];
