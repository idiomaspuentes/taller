/**
 * The labels and help texts of how a task's scope is cut and shared out (`types.ts`, `stepClaim.ts`, `reviewTask.ts`)
 * are built in Spanish by the domain. To show them in another interface language we translate the exact sentences
 * when they are displayed, as `templateNames.ts` does for the factory names; the domain and the stored data keep
 * their Spanish. Anything not listed is returned as it is.
 */
import type { UiLanguage } from "../config";
import glossary from "../i18n/locales/glossary.pt.json";

const PT: [string, string][] = Object.entries(glossary.scope);

const EXACT = new Map(PT);

// «Solo lo que falta traducir de Academia (…)», «Todo el catálogo de Palabras del libro.»
const PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [
    /^Solo lo que falta traducir de (.+) \(aún en inglés, incompleto o sin artículo\)\.$/,
    (m) => `Somente o que falta traduzir de ${m[1]} (ainda em inglês, incompleto ou sem artigo).`,
  ],
  [/^Todo el catálogo de (.+) del libro\.$/, (m) => `Todo o catálogo de ${m[1]} do livro.`],
  [/^Varios (\d+)$/, (m) => `Vários ${m[1]}`],
  [/^(\d+) (porciones|porción|notas|nota|preguntas|pregunta|citas|cita|artículos|artículo|ítems|ítem|academia|palabras)$/, (m) => `${m[1]} ${NOUN_PT[m[2]!] ?? m[2]}`],
  [/^Porción (.+)$/, (m) => `Porção ${m[1]}`],
  [/^Porciones (.+)$/, (m) => `Porções ${m[1]}`],
  // What «Autoasignar» answers (built by `autoAssign` in assignment.ts)
  [/^Añade integrantes a (.+) antes de autoasignar\.$/, (m) => `Adicione integrantes a ${m[1]} antes de autoatribuir.`],
  [/^(.+) está en modo solo manual: elige persona a persona en Asignar\.$/, (m) => `${m[1]} está no modo somente manual: escolha pessoa por pessoa em Atribuir.`],
  [/^No queda un lote sin asignar en el alcance de (.+)\.$/, (m) => `Não resta nenhum lote sem atribuição no alcance de ${m[1]}.`],
  [/^No queda trabajo sin asignar en el alcance de (.+)\.$/, (m) => `Não resta trabalho sem atribuição no alcance de ${m[1]}.`],
  [
    /^Autoasignados (\d+) (lote|lotes) de (.+) entre (\d+) personas \((.+)\)\.$/,
    (m) => `Autoatribuídos ${m[1]} ${m[2] === "lote" ? "lote" : "lotes"} de ${m[3]} entre ${m[4]} pessoas (${UNIT_PT[m[5]!] ?? m[5]}).`,
  ],
  [
    /^Autoasignados (\d+) (capítulos\/bloques|porciones\/bloques) \((\d+) ítems\) de (.+) entre (\d+) personas \((.+)\)\.$/,
    (m) =>
      `Autoatribuídos ${m[1]} ${m[2] === "capítulos/bloques" ? "capítulos/blocos" : "porções/blocos"} (${m[3]} itens) de ${m[4]} entre ${m[5]} pessoas (${UNIT_PT[m[6]!] ?? m[6]}).`,
  ],
];

const UNIT_PT: Record<string, string> = glossary.scopeUnits;

const NOUN_PT: Record<string, string> = glossary.scopeNouns;

export function localizeScope(text: string, language: UiLanguage): string {
  if (language !== "pt" || !text) return text;
  const exact = EXACT.get(text);
  if (exact) return exact;
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  // `scopeRuleLabel` lowercases the filter and grain names: look them up capitalized, then lowercase the answer.
  const first = text[0]!;
  if (first !== first.toUpperCase()) {
    const cap = first.toUpperCase() + text.slice(1);
    const hit = localizeScope(cap, language);
    if (hit !== cap) return hit[0]!.toLowerCase() + hit.slice(1);
  }
  if (text.includes(" · ")) return text.split(" · ").map((part) => localizeScope(part, language)).join(" · ");
  return text;
}
