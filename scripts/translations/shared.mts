import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");
export const LOCALES = join(ROOT, "src", "i18n", "locales");

export type Glossary = Record<string, Record<string, string>>;
export type ReviewState = { reviewed: Record<string, { by: string; at: string }> };

export const readJson = <T,>(file: string, fallback?: T): T => {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Falta ${file}`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as T;
};

export const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

export const loadAll = () => ({
  es: readJson<Record<string, string>>(join(LOCALES, "es.json")),
  pt: readJson<Record<string, string>>(join(LOCALES, "pt.json")),
  glossary: readJson<Glossary>(join(LOCALES, "glossary.pt.json")),
  review: readJson<ReviewState>(join(LOCALES, "pt.review.json"), { reviewed: {} }),
});

/** `{n}`, `{name}`: what a translation must keep. */
export const placeholdersOf = (text: string): string[] => [...(text.match(/\{[A-Za-z0-9_]+\}/g) ?? [])].sort();

export const samePlaceholders = (a: string, b: string): boolean => placeholdersOf(a).join(",") === placeholdersOf(b).join(",");

/** What a person sees as the name of each part of the app (Portuguese, for the reviewer). */
export const AREA_NAMES: Record<string, string> = {
  nav: "Menu e navegação", header: "Cabeçalho", welcome: "Boas-vindas", thread: "Conversa (avisos)", workspace: "Espaço de trabalho",
  push: "Avisos no celular", signIn: "Entrar", onboarding: "Primeiros passos", empty: "Telas vazias", mt: "Minhas tarefas e Agora",
  td: "Equipe hoje", app: "Mensagens gerais", pj: "Projetos", tb: "Quadro da equipe", org: "Organização", tv: "Fases e tarefas",
  ml: "Nível mínimo", wa: "Esperar por outra tarefa", sc: "Quem pode pegar uma etapa", st: "Etapas do projeto", sg: "Fases do projeto",
  wf: "Modelos de fluxo", as: "Atribuir pessoas", bk: "Inventário do livro", bx: "Explorador do inventário", pb: "Criar subtarefas",
  cv: "Conversa", dc: "Cartões de decisão", rv: "Respostas de revisão", af: "Revisar notas e palavras-chave", al: "Alinhar e revisar o alinhamento",
  ab: "Caixas de alinhamento", se: "Editor de versículos", he: "Editor de auxílios", pr: "Revisão de porções",
};

export const GLOSSARY_NAMES: Record<string, string> = {
  templates: "Nomes dos modelos (fases, tarefas, passos)", levels: "Níveis das pessoas (em frases)", scope: "Alcance, filtros e ajudas das tarefas",
  scopeNouns: "Substantivos de contagem (porções, notas…)", scopeUnits: "Unidades de distribuição", threadOptions: "Opções das decisões de alinhamento",
  threadClosings: "Como termina uma decisão de alinhamento", thread: "Conversas, cartões e erros", threadSteps: "Etapas de erro ao salvar",
  threadPlaces: "Onde ocorre o erro ao salvar", threadShort: "Formas curtas (aceitar, rejeitar…)", afinacion: "Categorias das notas e termos",
  books: "Nomes dos livros da Bíblia", levelNames: "Nomes dos níveis", languages: "Nomes curtos dos idiomas",
};

export const ID = { ui: (key: string) => `ui:${key}`, gl: (section: string, es: string) => `gl:${section}:${es}` };
