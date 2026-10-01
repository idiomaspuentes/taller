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
  ["Respuesta", "Resposta"],
  // Errors of the review tools
  ["Falta el capítulo en la tarea.", "Falta o capítulo na tarefa."],
  ["Todavía no hay borrador grupal de este libro. Se crea cuando alguien cierra una tarea de traducción.", "Ainda não há rascunho do grupo deste livro. Ele é criado quando alguém fecha uma tarefa de tradução."],
  ["No se encontró el borrador grupal de este libro.", "O rascunho do grupo deste livro não foi encontrado."],
  ["Tu sesión caducó. Vuelve a iniciar sesión.", "Sua sessão expirou. Entre de novo."],
  ["Falta el código de libro en el contexto.", "Falta o código do livro no contexto."],
  ["Falta contentOrg en el contexto.", "Falta contentOrg no contexto."],
  ["Laboratorio: el borrador queda en este navegador. No se escribe en Door43.", "Laboratório: o rascunho fica neste navegador. Nada é escrito no Door43."],
  ["Para escribir indica una organización de prueba (no uses es-419_gl).", "Para escrever, indique uma organização de teste (não use es-419_gl)."],
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

const STEP_PT: Record<string, string> = {
  repositorio: "repositório",
  "borrador principal": "rascunho principal",
  "borrador grupal": "rascunho do grupo",
  "alta del archivo": "criação do arquivo",
  "copia del archivo": "cópia do arquivo",
  "borrador de la subtarea": "rascunho da subtarefa",
  "cierre de la revisión": "fechamento da revisão",
  borrador: "rascunho",
  "guardado en el borrador grupal": "salvamento no rascunho do grupo",
  "paso al borrador principal": "passagem ao rascunho principal",
};
const PLACE_PT: Record<string, string> = {
  "el archivo del trabajo": "no arquivo do trabalho",
  "el borrador principal": "no rascunho principal",
  "tu borrador": "no seu rascunho",
  "el borrador grupal": "no rascunho do grupo",
};
const stepPt = (step: string) => STEP_PT[step] ?? step;
const placePt = (place: string | undefined) => (place ? ` ${PLACE_PT[place] ?? `em ${place}`}` : "");
const DETAIL = "Detalle técnico: ";
const detailPt = (text: string) => text.replace(DETAIL, "Detalhe técnico: ");
const PLACE_RE = "(?: en (el archivo del trabajo|el borrador principal|tu borrador|el borrador grupal))?";
const HTTP_RE = "( \\(HTTP \\d+\\))?";
const repoErr = (body: string) => new RegExp(`^${body}$`, "s");

/** Messages of `explainRepoFileError` and the helpers it frames: the sentence around the technical detail. */
const REPO_SENTENCES: [RegExp, (m: RegExpExecArray) => string][] = [
  [repoErr(`Sin permiso para acceder a (\\S+?)${HTTP_RE}\\. Inicia sesión con una cuenta que pueda editar ese repositorio\\.`), (m) => `Sem permissão para acessar ${m[1]}${m[2] ?? ""}. Entre com uma conta que possa editar esse repositório.`],
  [repoErr(`No existe el repositorio (\\S+?)${HTTP_RE}\\. Crea el repo de TPL o TPS en esa organización, o reintenta si tu sesión puede crearlo\\.`), (m) => `O repositório ${m[1]} não existe${m[2] ?? ""}. Crie o repositório de TPL ou TPS nessa organização, ou tente de novo se a sua sessão puder criá-lo.`],
  [repoErr(`Falló el repositorio (\\S+?)${HTTP_RE}: (.*)`), (m) => `Falhou o repositório ${m[1]}${m[2] ?? ""}: ${m[3]}`],
  [repoErr(`El borrador principal de (\\S+?) no existe o está vacío${HTTP_RE}\\. (.*)`), (m) => `O rascunho principal de ${m[1]} não existe ou está vazio${m[2] ?? ""}. ${detailPt(m[3]!)}`],
  [repoErr(`No se pudo crear o leer el (.+?) en (\\S+?)${HTTP_RE}\\. (.*)`), (m) => `Não foi possível criar ou ler o ${stepPt(m[1]!)} em ${m[2]}${m[3] ?? ""}. ${detailPt(m[4]!)}`],
  [repoErr(`No se pudo (copiar|crear) «(.+?)» en (\\S+?)${PLACE_RE}${HTTP_RE}\\. (.*)`), (m) => `Não foi possível ${m[1] === "copiar" ? "copiar" : "criar"} «${m[2]}» em ${m[3]}${placePt(m[4])}${m[5] ?? ""}. ${detailPt(m[6]!)}`],
  [repoErr(`No se pudo crear tu borrador de esta subtarea en (\\S+?)${HTTP_RE}\\. (.*)`), (m) => `Não foi possível criar o seu rascunho desta subtarefa em ${m[1]}${m[2] ?? ""}. ${detailPt(m[3]!)}`],
  [repoErr(`Sin permiso para cerrar la revisión de esta subtarea en (\\S+?)${HTTP_RE}\\.`), (m) => `Sem permissão para fechar a revisão desta subtarefa em ${m[1]}${m[2] ?? ""}.`],
  [repoErr(`No se pudo cerrar la revisión anterior de esta subtarea en (\\S+?)${HTTP_RE}\\. (.*)`), (m) => `Não foi possível fechar a revisão anterior desta subtarefa em ${m[1]}${m[2] ?? ""}. ${detailPt(m[3]!)}`],
  [repoErr(`Sin permiso para borrar tu borrador en (\\S+?)${HTTP_RE}\\.`), (m) => `Sem permissão para apagar o seu rascunho em ${m[1]}${m[2] ?? ""}.`],
  [repoErr(`No se pudo borrar tu borrador en (\\S+?)${HTTP_RE}\\. (.*)`), (m) => `Não foi possível apagar o seu rascunho em ${m[1]}${m[2] ?? ""}. ${detailPt(m[3]!)}`],
  [repoErr(`Falló (.+?) en (\\S+?)${HTTP_RE}: (.*)`), (m) => `Falhou ${stepPt(m[1]!)} em ${m[2]}${m[3] ?? ""}: ${detailPt(m[4]!)}`],
  [repoErr(`Sin permiso para escribir en (\\S+?)${HTTP_RE}\\. Inicia sesión con una cuenta que pueda editar ese repositorio\\.`), (m) => `Sem permissão para escrever em ${m[1]}${m[2] ?? ""}. Entre com uma conta que possa editar esse repositório.`],
  [repoErr(`No se pudo crear «(.+?)» en (\\S+?)${PLACE_RE}${HTTP_RE}\\. El archivo no existía; Door43 rechazó el alta \\(revisa el repositorio o tu permiso\\)\\.`), (m) => `Não foi possível criar «${m[1]}» em ${m[2]}${placePt(m[3])}${m[4] ?? ""}. O arquivo não existia; o Door43 recusou a criação (verifique o repositório ou a sua permissão).`],
  [repoErr(`No se encontró «(.+?)» en (\\S+?)${PLACE_RE}${HTTP_RE}\\.`), (m) => `«${m[1]}» não foi encontrado em ${m[2]}${placePt(m[3])}${m[4] ?? ""}.`],
  [repoErr(`Conflicto al guardar «(.+?)» en (\\S+?)${PLACE_RE}${HTTP_RE}: (.*)\\. Vuelve a cargar y reintenta\\.`), (m) => `Conflito ao salvar «${m[1]}» em ${m[2]}${placePt(m[3])}${m[4] ?? ""}: ${m[5]}. Recarregue e tente de novo.`],
  [repoErr(`No se pudo guardar «(.+?)» en (\\S+?)${PLACE_RE}${HTTP_RE}: (.*)`), (m) => `Não foi possível salvar «${m[1]}» em ${m[2]}${placePt(m[3])}${m[4] ?? ""}: ${m[5]}`],
  [/^El repositorio (\S+) no existe\.$/, (m) => `O repositório ${m[1]} não existe.`],
  [/^Sin permiso para acceder a (\S+)\.$/, (m) => `Sem permissão para acessar ${m[1]}.`],
  [/^Sin permiso para crear (\S+)\.$/, (m) => `Sem permissão para criar ${m[1]}.`],
  [/^No se pudo crear el repositorio (\S+?)( \(HTTP \d+\))?\.$/, (m) => `Não foi possível criar o repositório ${m[1]}${m[2] ?? ""}.`],
  [/^Falta el borrador «(.+)»; no se puede crear el archivo ahí\.$/, (m) => `Falta o rascunho «${m[1]}»; não é possível criar o arquivo ali.`],
  [/^No hay repo configurado para «(.+?)»\. Añade resourceRepos\.(\S+) en config\.json(?: \(p\. ej\. "(.+)"\))?\.$/, (m) => `Não há repositório configurado para «${m[1]}». Adicione resourceRepos.${m[2]} em config.json${m[3] ? ` (p. ex. "${m[3]}")` : ""}.`],
  [/^«(.+?)» no es una ayuda \(notas, preguntas, palabras o academia\)\.$/, (m) => `«${m[1]}» não é um auxílio (notas, perguntas, palavras ou academia).`],
  [/^«(.+)» parece de producción\. Usa una org de prueba o confirma escritura insegura\.$/, (m) => `«${m[1]}» parece ser de produção. Use uma org de teste ou confirme a escrita insegura.`],
];

function lookup(text: string): string | undefined {
  const hit = EXACT_MAP.get(text);
  if (hit) return hit;
  for (const [re, fn] of SENTENCES) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  for (const [re, fn] of REPO_SENTENCES) {
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

