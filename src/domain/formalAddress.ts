/**
 * How a help speaks to the translator. The team's notes, questions and articles say «usted»; a note written fast,
 * or adapted from one that said «you», says «tú» («Puedes traducir…», «Si fuera útil en tu idioma, podrías…»).
 * Esther had 130 notes like that, found only when the book was read again. This finds those words while the help
 * is written, and says how each would read: the app proposes, the person reads the list and confirms it.
 *
 * Only what the help itself says counts. What is quoted (an alternative translation, what a character says: «como
 * hiciste tú con Vasti») and what is in bold (the words of the text it explains) speak to someone else, and a link
 * is an address. A few words are «tú» only where a sentence starts with them: «Revisa cómo…» speaks to the
 * translator, and «el equipo revisa» does not.
 */

/** The way a team speaks to the translator in its helps. Only Spanish's «usted» is known for now. */
export type HelpsAddress = "usted";

export type InformalWord = {
  /** Where it is in the text, and how long it is. */
  at: number;
  length: number;
  /** As written, and as it reads speaking of «usted» (with the same capital). */
  word: string;
  formal: string;
};

/** The same word wherever it is in a help: listed once, however many times the help says it. */
export type InformalGroup = { word: string; formal: string; count: number };

// Forms that only ever speak to «tú».
const ANYWHERE: Record<string, string> = {
  tu: "su", tus: "sus", "tú": "usted", ti: "usted", contigo: "con usted", te: "le",
  // Present.
  puedes: "puede", debes: "debe", necesitas: "necesita", quieres: "quiere", prefieres: "prefiere", crees: "cree",
  tienes: "tiene", sabes: "sabe", usas: "usa", utilizas: "utiliza", traduces: "traduce", decides: "decide",
  consideras: "considera", piensas: "piensa", eliges: "elige", encuentras: "encuentra", intentas: "intenta",
  "estás": "está", eres: "es", has: "ha",
  // Subjunctive.
  puedas: "pueda", repitas: "repita", uses: "use", utilices: "utilice", traduzcas: "traduzca", pongas: "ponga",
  hagas: "haga", digas: "diga", elijas: "elija", tengas: "tenga", quieras: "quiera", prefieras: "prefiera",
  decidas: "decida", consideres: "considere", incluyas: "incluya", "añadas": "añada", expliques: "explique",
  sepas: "sepa", creas: "crea", veas: "vea", necesites: "necesite", encuentres: "encuentre", combines: "combine",
  omitas: "omita", agregues: "agregue", mantengas: "mantenga", quisieras: "quisiera",
  // Conditional and future.
  "podrías": "podría", "deberías": "debería", "querrías": "querría", "preferirías": "preferiría", "tendrías": "tendría",
  "podrás": "podrá", "deberás": "deberá", "tendrás": "tendrá", "verás": "verá", "encontrarás": "encontrará", "necesitarás": "necesitará",
  // Past.
  tradujiste: "tradujo", hiciste: "hizo", usaste: "usó", utilizaste: "utilizó", elegiste: "eligió", escribiste: "escribió",
  pusiste: "puso", decidiste: "decidió",
  // Commands with the pronoun on: no third person says them.
  "asegúrate": "asegúrese", "fíjate": "fíjese", "exprésalo": "expréselo", "exprésala": "exprésela", "tradúcelo": "tradúzcalo",
  "tradúcela": "tradúzcala", ponlo: "póngalo", dilo: "dígalo", "recuérdalo": "recuérdelo", "explícalo": "explíquelo",
};

// Commands that are also the third person («el TPS usa»): «tú» only where a sentence starts with them.
const AT_START: Record<string, string> = {
  revisa: "revise", repasa: "repase", decide: "decida", utiliza: "utilice", usa: "use", traduce: "traduzca",
  considera: "considere", observa: "observe", recuerda: "recuerde", intenta: "intente", evita: "evite", elige: "elija",
  "añade": "añada", agrega: "agregue", explica: "explique", incluye: "incluya", piensa: "piense", "mantén": "mantenga",
  haz: "haga", pon: "ponga", combina: "combine", omite: "omita", busca: "busque", compara: "compare", mira: "mire",
  lee: "lea", escribe: "escriba", cambia: "cambie", deja: "deje", expresa: "exprese", representa: "represente",
  ve: "vea", indica: "indique", muestra: "muestre", presenta: "presente", coloca: "coloque", escoge: "escoja",
};

const WORD = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;
const OPENS_BEFORE = /[\s([{¿¡—–:;"“«*_>-]/;

/**
 * For each character of a help, whether someone other than the help is speaking there: inside quotes, in bold, in
 * a link. A straight «"» opens where a word could start (after a space, at the start, after a bracket) and closes
 * after a word, so quotes typed on a phone are told apart the same way as typographic ones.
 */
function quotedMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  const cover = (from: number, to: number) => {
    for (let k = from; k < to; k++) mask[k] = true;
  };
  // Bold, links and rc links first: they may hold quote marks of their own.
  for (const m of text.matchAll(/\*\*[^*\n]+\*\*|__[^_\n]+__|\[\[[^\]\n]*\]\]|\[[^\]\n]*\]\([^)\n]*\)/g)) cover(m.index!, m.index! + m[0].length);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (mask[i] && depth === 0) continue;
    if (ch === "«" || ch === "“") {
      depth++;
      mask[i] = true;
    } else if (ch === "»" || ch === "”") {
      mask[i] = true;
      depth = Math.max(0, depth - 1);
    } else if (ch === '"') {
      const prev = i === 0 ? " " : text[i - 1]!;
      if (depth > 0 && !OPENS_BEFORE.test(prev)) depth--;
      else depth++;
      mask[i] = true;
    } else if (depth > 0) mask[i] = true;
    if (ch === "\n" && text[i + 1] === "\n") depth = 0; // A quote left open does not swallow the next paragraph.
  }
  return mask;
}

/** Whether a sentence (or a line, or an item of a list) starts right before `at`. */
function startsSentence(text: string, at: number): boolean {
  // What a line starts with: the start of the text or a line end, then the mark of an item, a heading or a quote.
  const line = text.slice(0, at).lastIndexOf("\n");
  if (/^\s*(?:[*+-]\s+|\d+\.\s+|#+\s+|>\s*)?$/.test(text.slice(line + 1, at))) return true;
  return /([.:;!?]\s+|[¿¡(]\s*)$/.test(text.slice(Math.max(0, at - 4), at));
}

const withCase = (written: string, formal: string) => (written[0] === written[0]!.toUpperCase() ? formal[0]!.toUpperCase() + formal.slice(1) : formal);

/** The words of a help that speak to the translator as «tú», where the team says `address`. None without a rule. */
export function informalWords(text: string, address: HelpsAddress | undefined): InformalWord[] {
  if (address !== "usted" || !text) return [];
  const mask = quotedMask(text);
  const found: InformalWord[] = [];
  for (const m of text.matchAll(WORD)) {
    const at = m.index!;
    if (mask[at]) continue;
    const word = m[0];
    const lower = word.toLowerCase();
    const formal = ANYWHERE[lower] ?? (startsSentence(text, at) && AT_START[lower] && speaksToTranslator(text, at, mask) ? AT_START[lower] : undefined);
    if (formal) found.push({ at, length: word.length, word, formal: withCase(word, formal) });
  }
  return found;
}

// What a sentence that tells the translator what to do is about: the translation, the language, its readers.
const ABOUT_TRANSLATING = /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ])(tradu[a-záéíóúñ]*|idiomas?|lenguas?|lenguajes?|lectores?|oyentes?)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/i;

/**
 * Whether the sentence a command-like word starts is said to the translator. «Utiliza la forma que tiene tu lengua»
 * is; «Utiliza una forma interrogativa para enfatizar…», said of the king, is not. A sentence that speaks of the
 * translation, or that says «tú» some other way, is.
 */
function speaksToTranslator(text: string, at: number, mask: boolean[]): boolean {
  const end = text.slice(at).search(/[.!?\n]/);
  const sentence = text.slice(at, end < 0 ? text.length : at + end);
  const own = [...sentence].map((ch, i) => (mask[at + i] ? " " : ch)).join("");
  if (ABOUT_TRANSLATING.test(own)) return true;
  return [...own.matchAll(WORD)].some((m) => m.index! > 0 && ANYWHERE[m[0].toLowerCase()] !== undefined);
}

/** The words found, the same word once, in the order the help first says them. */
export function informalGroups(found: InformalWord[]): InformalGroup[] {
  const groups = new Map<string, InformalGroup>();
  for (const f of found) {
    const key = `${f.word.toLowerCase()}\u0000${f.formal.toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { word: f.word, formal: f.formal, count: 1 });
  }
  return [...groups.values()];
}

/**
 * The help with every word found said of «usted», and everything else as it was written. All at once, as the
 * person reads them listed: one changed before another could make the other no longer read as said to anyone.
 */
export function toFormal(text: string, found: InformalWord[]): string {
  let out = text;
  for (const f of [...found].sort((a, b) => b.at - a.at)) out = out.slice(0, f.at) + f.formal + out.slice(f.at + f.length);
  return out;
}
