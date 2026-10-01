/**
 * The lines of a conversation that the app builds itself (decision cards, votes, closings, verse conflicts, the
 * summaries of system comments) are written in Spanish by the domain, and the event `summary` is stored in the
 * Door43 comment as such. To show them in another interface language we translate the known sentences when they
 * are displayed, as `templateNames.ts` does for the factory names: nothing stored changes, and what a person
 * wrote is never passed through here (only text the app generated).
 */
import type { UiLanguage } from "../config";

/** Options of an alignment decision; the card may add « (2) ✓» after them. */
const LABELS: [string, string][] = [
  ["Aceptar la propuesta", "Aceitar a proposta"],
  ["Rechazar la propuesta", "Rejeitar a proposta"],
  ["Hay que cambiar la alineación", "É preciso mudar o alinhamento"],
  ["Mantener la alineación", "Manter o alinhamento"],
];

/** How an alignment decision ended; it ends a longer line. */
const CLOSINGS: [string, string][] = [
  ["Se aceptó la propuesta y la alineación quedó cambiada.", "A proposta foi aceita e o alinhamento foi alterado."],
  ["Se rechazó la propuesta; la alineación sigue igual.", "A proposta foi rejeitada; o alinhamento continua igual."],
  ["La objeción prospera: hay que ajustar la alineación.", "A objeção procede: é preciso ajustar o alinhamento."],
  ["La objeción no prospera; la alineación se mantiene.", "A objeção não procede; o alinhamento é mantido."],
  ["La alineación cambió mientras se decidía, así que la propuesta ya no aplica.", "O alinhamento mudou enquanto se decidia, então a proposta não se aplica mais."],
];

/** The whole string, as it is. */
const EXACT: [string, string][] = [
  ["Confirmar el consenso y cerrar", "Confirmar o consenso e encerrar"],
  // Panels
  ["Texto del versículo", "Texto do versículo"],
  ["Alineación ahora", "Alinhamento agora"],
  ["Alineación propuesta", "Alinhamento proposto"],
  ["Palabras señaladas", "Palavras indicadas"],
  ["cambia", "muda"],
  ["lo que cambia va resaltado", "o que muda está destacado"],
  ["propuesta", "proposta"],
  ["lo objetado va en amarillo", "o que foi contestado está em amarelo"],
  ["grupal", "do grupo"],
  ["(vacío)", "(vazio)"],
  ["Tu versión", "Sua versão"],
  ["Borrador grupal anterior", "Rascunho do grupo anterior"],
  // What the card says while it works or why it cannot
  ["Guardando…", "Salvando…"],
  ["Guardando tu voto…", "Salvando seu voto…"],
  ["Cerrando la decisión…", "Encerrando a decisão…"],
  ["Guardando la decisión…", "Salvando a decisão…"],
  ["Guardando en el borrador grupal…", "Salvando no rascunho do grupo…"],
  ["Comprobando los votos…", "Verificando os votos…"],
  ["Esta decisión ya se cerró.", "Esta decisão já foi encerrada."],
  ["Es tuya: ya cuenta a favor.", "É sua: já conta a favor."],
  ["Comprobando el versículo…", "Verificando o versículo…"],
  ["No se encontró el borrador grupal. No se puede decidir desde aquí.", "O rascunho do grupo não foi encontrado. Não é possível decidir daqui."],
  ["Esa versión ya está en el borrador grupal.", "Essa versão já está no rascunho do grupo."],
  ["No se sabe de dónde recuperar la otra versión (falta la subtarea que la escribió).", "Não se sabe de onde recuperar a outra versão (falta a subtarefa que a escreveu)."],
  ["Solo quien tiene la subtarea o un gestor puede decidir.", "Somente quem tem a subtarefa ou um gestor pode decidir."],
  ["Esta opción ya no está disponible.", "Esta opção não está mais disponível."],
  ["Hay un conflicto más reciente para estos versículos; decide allí.", "Há um conflito mais recente para estes versículos; decida lá."],
  // Verse conflicts
  ["Dejar la mía", "Manter a minha"],
  ["Usar la anterior", "Usar a anterior"],
  ["Usar la mía", "Usar a minha"],
  ["otra subtarea", "outra subtarefa"],
  // System comments
  ["Conflicto de versículos al cerrar", "Conflito de versículos ao fechar"],
  ["Mensaje nuevo", "Mensagem nova"],
  // Buttons that open a tool
  ["Estudiar", "Estudar"],
  ["Abrir editor", "Abrir editor"],
  ["Falta el capítulo para abrir el estudio.", "Falta o capítulo para abrir o estudo."],
  ["Falta el libro para abrir el estudio.", "Falta o livro para abrir o estudo."],
];

const SHORT: Record<string, string> = { aceptar: "aceitar", rechazar: "rejeitar", cambiarla: "mudá-lo", mantenerla: "mantê-lo" };
const OWNER = "(la versión de (.+?)|la otra versión)";

/** A whole sentence with parts to carry over, tried in order; the first that matches wins. */
const SENTENCES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Objeción de (@\S+) en (.+)$/, (m) => `Objeção de ${m[1]} em ${m[2]}`],
  [/^Propuesta de (@\S+) para cambiar el texto de (.+)$/, (m) => `Proposta de ${m[1]} para mudar o texto de ${m[2]}`],
  [/^Propuesta de (@\S+) para (.+)$/, (m) => `Proposta de ${m[1]} para ${m[2]}`],
  [/^Lo que dice (@\S+)$/, (m) => `O que diz ${m[1]}`],
  [/^Decidir yo: (aceptar|rechazar|cambiarla|mantenerla)$/, (m) => `Decidir eu: ${SHORT[m[1]!]}`],
  [/^Versión de (.+)$/, (m) => `Versão de ${m[1]}`],
  [/^Dejar la de (.+)$/, (m) => `Manter a de ${m[1]}`],
  [/^Usar la de (.+)$/, (m) => `Usar a de ${m[1]}`],
  [/^No se pudieron leer los votos: (.+)$/s, (m) => `Não foi possível ler os votos: ${m[1]}`],
  [/^Solo (.+) o un gestor puede decidir\.$/, (m) => `Somente ${m[1].replace(/ o /g, " ou ")} ou um gestor pode decidir.`],
  [/^El versículo (.+?) cambió después del conflicto\. Ábrelo en el editor\.$/, (m) => `O versículo ${m[1]} mudou depois do conflito. Abra-o no editor.`],
  [/^La otra versión de (.+?) ya no está donde se guardó\. Ábrelo en el editor\.$/, (m) => `A outra versão de ${m[1]} não está mais onde foi salva. Abra-a no editor.`],
  [/^El versículo (.+?) tiene notas o formato que no se pueden copiar solos\. Ábrelo en el editor\.$/, (m) => `O versículo ${m[1]} tem notas ou formatação que não podem ser copiadas sozinhas. Abra-o no editor.`],
  [/^Elegir (.+?) cambiaría otros versículos\. No se escribió nada\.$/, (m) => `Escolher ${m[1]} mudaria outros versículos. Nada foi escrito.`],
  [/^El versículo (.+?) también lo escribió (.+?)\. Quedó tu versión\.$/, (m) => `O versículo ${m[1]} também foi escrito por ${m[2]}. Ficou a sua versão.`],
  [/^El versículo (.+?) ya tenía la versión de (.+?) y quedó esa\.$/, (m) => `O versículo ${m[1]} já tinha a versão de ${m[2]} e ficou essa.`],
  [/^(.+?) cerró (.+?) y su versión reemplazó la tuya\.$/, (m) => `${m[1]} fechou ${m[2]} e a versão ${m[1].startsWith("@") ? "dessa pessoa" : "da outra subtarefa"} substituiu a sua.`],
  [/^(.+?) cerró (.+?) con otra versión; quedó la tuya\.$/, (m) => `${m[1]} fechou ${m[2]} com outra versão; ficou a sua.`],
  [/^En (.+?) quedó tu versión\.$/, (m) => `Em ${m[1]} ficou a sua versão.`],
  [new RegExp(`^En (.+?) quedó ${OWNER}\\.$`), (m) => `Em ${m[1]} ficou ${m[3] ? `a versão de ${m[3]}` : "a outra versão"}.`],
  [new RegExp(`^Resuelto por (.+?): en (.+?) quedó ${OWNER}\\.$`), (m) => `Resolvido por ${m[1]}: em ${m[2]} ficou ${m[4] ? `a versão de ${m[4]}` : "a outra versão"}.`],
  [new RegExp(`^Resuelto por (.+?): quedó ${OWNER}$`), (m) => `Resolvido por ${m[1]}: ficou ${m[3] ? `a versão de ${m[3]}` : "a outra versão"}`],
  [/^(@\S+): Resuelto por /, (m) => `${m[1]}: Resolvido por `],
  [/^¿Volver a (.+?) en (.+?)\? Se guarda en el borrador grupal\.$/, (m) => `Voltar para ${m[1].replace("la versión de", "a versão de").replace("la otra versión", "a outra versão")} em ${m[2]}? Será salvo no rascunho do grupo.`],
  [/^Versículos (.+) guardados en el borrador grupal$/, (m) => `Versículos ${m[1]} salvos no rascunho do grupo`],
  [/^Versículos (.+) ya estaban en el borrador grupal$/, (m) => `Versículos ${m[1]} já estavam no rascunho do grupo`],
  [/^Aprobado: (.+)$/, (m) => `Aprovado: ${m[1]}`],
  [/^(\d+) veces$/, (m) => `${m[1]} vezes`],
];

/** Parts inside longer text (votes, consensus, closings, confirmations), replaced wherever they appear. */
const PHRASES: [RegExp, string][] = [
  [/(@\S+) votó: /g, "$1 votou: "],
  [/Hay consenso: /g, "Há consenso: "],
  [/: falta que una persona lo confirme para cerrar la decisión\./g, ": falta uma pessoa confirmar para encerrar a decisão."],
  [/Decidido por el equipo; (@\S+) confirmó el consenso\./g, "Decidido pela equipe; $1 confirmou o consenso."],
  [/Decidido por (@\S+), quien coordina\./g, "Decidido por $1, quem coordena."],
  [/ por favor ajústenla\./g, " por favor ajustem."],
  [/Hay consenso en «/g, "Há consenso em «"],
  [/: nadie\b/g, ": ninguém"],
  [/ Se aplicará la alineación propuesta\./g, " O alinhamento proposto será aplicado."],
  [/ Se le pedirá a quien alineó que la ajuste\./g, " Será pedido a quem alinhou que o ajuste."],
  [/¿Confirmas que el equipo está de acuerdo y se cierra\?/g, "Você confirma que a equipe está de acordo e que a decisão se encerra?"],
  [/Pasó el plazo sin consenso\. Vas a decidir (aceptar|rechazar|cambiarla|mantenerla) en nombre del equipo\./g, "O prazo passou sem consenso. Você vai decidir $1 em nome da equipe."],
];

function lookup(text: string): string | undefined {
  const hit = EXACT_MAP.get(text);
  if (hit) return hit;
  for (const [re, fn] of SENTENCES) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  return undefined;
}

const EXACT_MAP = new Map([...LABELS, ...CLOSINGS, ...EXACT]);

export function localizeThread(text: string, language: UiLanguage): string {
  if (language !== "pt" || !text) return text;
  const whole = lookup(text);
  if (whole) return whole;
  let out = text;
  for (const [es, pt] of LABELS) if (out.includes(es)) out = out.split(es).join(pt);
  for (const [re, pt] of PHRASES) out = out.replace(re, pt);
  for (const [es, pt] of CLOSINGS) if (out.includes(es)) out = out.split(es).join(pt);
  return out;
}

