/**
 * The labels and help texts of how a task's scope is cut and shared out (`types.ts`, `stepClaim.ts`, `reviewTask.ts`)
 * are built in Spanish by the domain. To show them in another interface language we translate the exact sentences
 * when they are displayed, as `templateNames.ts` does for the factory names; the domain and the stored data keep
 * their Spanish. Anything not listed is returned as it is.
 */
import type { UiLanguage } from "../config";

const PT: [string, string][] = [
  // Distribute unit and policy
  ["Por porción", "Por porção"],
  ["Por capítulo entero", "Por capítulo inteiro"],
  ["Porciones por capítulo", "Porções por capítulo"],
  ["Automático · bloques contiguos", "Automático · blocos contíguos"],
  ["Solo manual", "Somente manual"],
  [
    "Parte todas las porciones del libro en bloques contiguos entre el equipo (quien lleva varias, las lleva seguidas).",
    "Divide todas as porções do livro em blocos contíguos entre a equipe (quem pega várias, pega em sequência).",
  ],
  [
    "Cada capítulo completo va a una persona. Si alguien recibe varios, serán capítulos contiguos.",
    "Cada capítulo completo vai para uma pessoa. Se alguém receber vários, serão capítulos contíguos.",
  ],
  [
    "En cada capítulo se reparten las porciones entre todos; luego se pasa al siguiente. El libro avanza capítulo a capítulo.",
    "Em cada capítulo as porções são distribuídas entre todos; depois passa-se ao seguinte. O livro avança capítulo a capítulo.",
  ],
  [
    "Parte las unidades en el orden del libro, lo más parejo posible. Si no hay el mismo número de unidades que de personas, algunos llevan una más.",
    "Divide as unidades na ordem do livro, da forma mais igual possível. Se o número de unidades não for múltiplo do de pessoas, algumas ficam com uma a mais.",
  ],
  ["No autoasignar. En Asignar eliges persona a persona.", "Sem autoatribuição. Em Atribuir você escolhe pessoa por pessoa."],
  // Filters
  ["Todas las porciones", "Todas as porções"],
  ["Con TPL", "Com TPL"],
  ["Con TPS (UST)", "Com TPS (UST)"],
  ["Solo con notas", "Somente com notas"],
  ["Solo con preguntas", "Somente com perguntas"],
  ["Todos los citados", "Todos os citados"],
  ["Todo el catálogo", "Todo o catálogo"],
  ["Pendientes", "Pendentes"],
  ["Todos", "Todos"],
  ["Traducido", "Traduzido"],
  ["En inglés", "Em inglês"],
  ["Incompleto", "Incompleto"],
  ["Faltante / sin artículo", "Faltando / sem artigo"],
  ["Solo porciones donde hay notas que asignar.", "Somente porções que têm notas para atribuir."],
  [
    "También incluye porciones sin notas (útiles si mezclas con otros recursos).",
    "Inclui também porções sem notas (úteis se você combinar com outros recursos).",
  ],
  ["Solo porciones donde hay preguntas que asignar.", "Somente porções que têm perguntas para atribuir."],
  ["También incluye porciones sin preguntas.", "Inclui também porções sem perguntas."],
  ["Todo lo citado en las porciones, aunque ya esté traducido.", "Tudo o que é citado nas porções, mesmo já traduzido."],
  ["Solo artículos ya traducidos.", "Somente artigos já traduzidos."],
  ["Solo artículos que siguen en inglés.", "Somente artigos que continuam em inglês."],
  ["Solo artículos a medias.", "Somente artigos pela metade."],
  ["Solo referencias sin artículo en el destino.", "Somente referências sem artigo no destino."],
  // Grain
  ["Ítems / lista", "Itens / lista"],
  ["Porciones", "Porções"],
  ["Capítulo", "Capítulo"],
  ["Porciones del capítulo", "Porções do capítulo"],
  ["Por referencias en porciones", "Por referências em porções"],
  ["Nota por nota", "Nota por nota"],
  ["Pregunta por pregunta", "Pergunta por pergunta"],
  ["Porción completa", "Porção completa"],
  ["Artículo único", "Artigo único"],
  ["Una fila por cita", "Uma linha por citação"],
  [
    "En Asignar verás cada nota suelta. Puedes dar notas distintas de la misma porción a personas distintas.",
    "Em Atribuir você verá cada nota solta. Pode dar notas diferentes da mesma porção a pessoas diferentes.",
  ],
  [
    "En Asignar verás la porción entera. Quien la reciba traduce todas las notas de ese bloque.",
    "Em Atribuir você verá a porção inteira. Quem a receber traduz todas as notas desse bloco.",
  ],
  [
    "En Asignar verás cada pregunta suelta. Puedes repartirlas entre varias personas.",
    "Em Atribuir você verá cada pergunta solta. Pode distribuí-las entre várias pessoas.",
  ],
  [
    "En Asignar verás la porción entera. Quien la reciba responde todas las preguntas de ese bloque.",
    "Em Atribuir você verá a porção inteira. Quem a receber responde todas as perguntas desse bloco.",
  ],
  [
    "Cada artículo de Academia aparece una sola vez, aunque el libro lo cite muchas veces.",
    "Cada artigo da Academia aparece uma só vez, mesmo que o livro o cite muitas vezes.",
  ],
  [
    "Si el mismo artículo se cita en 3 porciones, pueden salir hasta 3 filas (una por cita).",
    "Se o mesmo artigo é citado em 3 porções, podem aparecer até 3 linhas (uma por citação).",
  ],
  [
    "Cada artículo de Palabras aparece una sola vez, aunque el libro lo cite muchas veces.",
    "Cada artigo de Palavras aparece uma só vez, mesmo que o livro o cite muitas vezes.",
  ],
  [
    "Si la misma palabra se cita en 3 porciones, pueden salir hasta 3 filas (una por cita).",
    "Se a mesma palavra é citada em 3 porções, podem aparecer até 3 linhas (uma por citação).",
  ],
  [
    "Al repartir en Asignar, cada persona recibe bloques que no saltan de un capítulo a otro. No cambia el Ámbito del libro (arriba).",
    "Ao distribuir em Atribuir, cada pessoa recebe blocos que não saltam de um capítulo a outro. Não muda o Âmbito do livro (acima).",
  ],
  [
    "Cada porción se asignará a una persona para traducirla al Texto Puente Literal (TPL), a partir del texto fuente en inglés.",
    "Cada porção será atribuída a uma pessoa para traduzi-la ao Texto Ponte Literal (TPL), a partir do texto-fonte em inglês.",
  ],
  [
    "Cada porción se asignará a una persona para traducirla al Texto Puente Simple (TPS), a partir del UST. Solo cuenta si el inventario tiene UST.",
    "Cada porção será atribuída a uma pessoa para traduzi-la ao Texto Ponte Simples (TPS), a partir do UST. Só vale se o inventário tiver UST.",
  ],
  // Claim labels of the steps
  ["Uno", "Um"],
  ["Pares", "Pares"],
  ["Grupal", "Em grupo"],
  ["Sin recursos", "Sem recursos"],
  ["Preguntas", "Perguntas"],
  ["Palabras", "Palavras"],
];

const EXACT = new Map(PT);

// «Solo lo que falta traducir de Academia (…)», «Todo el catálogo de Palabras del libro.»
const PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [
    /^Solo lo que falta traducir de (.+) \(aún en inglés, incompleto o sin artículo\)\.$/,
    (m) => `Somente o que falta traduzir de ${m[1]} (ainda em inglês, incompleto ou sem artigo).`,
  ],
  [/^Todo el catálogo de (.+) del libro\.$/, (m) => `Todo o catálogo de ${m[1]} do livro.`],
  [/^Varios (\d+)$/, (m) => `Vários ${m[1]}`],
  [/^(\d+) (porciones|porción|notas|nota|preguntas|pregunta|citas|cita|artículos|artículo|ítems|ítem)$/, (m) => `${m[1]} ${NOUN_PT[m[2]!] ?? m[2]}`],
];

const NOUN_PT: Record<string, string> = {
  porciones: "porções",
  "porción": "porção",
  notas: "notas",
  nota: "nota",
  preguntas: "perguntas",
  pregunta: "pergunta",
  citas: "citações",
  cita: "citação",
  "artículos": "artigos",
  "artículo": "artigo",
  "ítems": "itens",
  "ítem": "item",
};

export function localizeScope(text: string, language: UiLanguage): string {
  if (language !== "pt" || !text) return text;
  const exact = EXACT.get(text);
  if (exact) return exact;
  if (text.includes(" · ")) return text.split(" · ").map((part) => localizeScope(part, language)).join(" · ");
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  return text;
}
