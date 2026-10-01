/**
 * The names of the shipped workflow template (phases, tasks, steps) are stored in the plan as written in Spanish, and
 * subtarea titles repeat them. To show them in another interface language we translate the exact factory names
 * when they are displayed; the stored data is never changed, and a name someone edited is left as they wrote it.
 */
import type { UiLanguage } from "../config";

/** Spanish factory name → Portuguese. Names that read the same in both are left out. */
const PT: [string, string][] = [
  // Phases
  ["Traducción", "Tradução"],
  ["Afinación", "Afinação"],
  ["Armonización", "Harmonização"],
  ["Validación", "Validação"],
  // Tasks
  ["Traducir TPL", "Traduzir TPL"],
  ["Traducir TPS", "Traduzir TPS"],
  ["Traducir Notas", "Traduzir Notas"],
  ["Traducir Preguntas", "Traduzir Perguntas"],
  ["Traducir Palabras", "Traduzir Palavras"],
  ["Traducir Academia", "Traduzir Academia"],
  ["Armonizar ", "Harmonizar "],
  // Steps
  ["Borrador", "Rascunho"],
  ["Revisión en pares", "Revisão em pares"],
  ["Revisión grupal", "Revisão em grupo"],
  ["Revisar palabras clave", "Revisar palavras-chave"],
  ["Revisar la alineación", "Revisar o alinhamento"],
  ["Alinear", "Alinhar"],
  ["Ajustar a los textos afinados", "Ajustar aos textos afinados"],
  ["Cierre independiente", "Fechamento independente"],
  ["Decisión pastoral", "Decisão pastoral"],
  // Placeholders the lists use
  ["Sin tarea", "Sem tarefa"],
  ["Sin fase", "Sem fase"],
  ["Sin asignar", "Sem atribuição"],
];

// Longest first, so "Revisar la alineación" is not cut by "Alinear" and the like.
const ORDERED = [...PT].sort((a, b) => b[0].length - a[0].length);

export function localizeName(text: string, language: UiLanguage): string {
  if (language !== "pt" || !text) return text;
  let out = text;
  for (const [es, pt] of ORDERED) if (out.includes(es)) out = out.split(es).join(pt);
  return out;
}
