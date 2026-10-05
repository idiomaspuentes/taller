/**
 * The lines of a conversation that the app builds itself (decision cards, votes, closings, verse conflicts, the
 * summaries of system comments) are written in Spanish by the domain, and the event `summary` is stored in the
 * Door43 comment as such. To show them in another interface language we translate the known sentences when they
 * are displayed, as `templateNames.ts` does for the factory names: nothing stored changes, and what a person
 * wrote is never passed through here (only text the app generated).
 */
import type { UiLanguage } from "../config";
import glossary from "../i18n/locales/glossary.pt.json";

/** Options of an alignment decision; the card may add « (2) ✓» after them. */
const LABELS: [string, string][] = Object.entries(glossary.threadOptions);

/** How an alignment decision ended; it ends a longer line. */
const CLOSINGS: [string, string][] = Object.entries(glossary.threadClosings);

/** The whole string, as it is. */
const EXACT: [string, string][] = Object.entries(glossary.thread);

const SHORT: Record<string, string> = glossary.threadShort;
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
  [/^Comentario resuelto: (.+)$/s, (m) => `Comentário resolvido: ${m[1]}`],
  [/^Comentario reabierto: (.+)$/s, (m) => `Comentário reaberto: ${m[1]}`],
  [/^(\d+) veces$/, (m) => `${m[1]} vezes`],
  [/^Hay decisiones de versículo sin resolver en (.+)\. Resuélvelas primero\.$/, (m) => `Há decisões de versículo sem resolver em ${m[1]}. Resolva-as primeiro.`],
  [/^No se pudo leer el rango de versículos de (#\d+) \((.+)\)\. Corrige el título de la subtarea\.$/, (m) => `Não foi possível ler o intervalo de versículos de ${m[1]} (${m[2]}). Corrija o título da subtarefa.`],
  [/^(.*?): el texto cambió desde que confirmaste la revisión\. Vuelve a pulsar «Pasar al borrador principal» para ver qué versículos se reemplazan\. No se cambió el borrador principal\.$/, (m) => `${m[1]}: o texto mudou desde que você confirmou a revisão. Toque de novo em «Passar ao rascunho principal» para ver quais versículos são substituídos. O rascunho principal não foi alterado.`],
  [/^El borrador grupal no tiene texto en (.+)\. No se cambió el borrador principal\.$/, (m) => `O rascunho do grupo não tem texto em ${m[1]}. O rascunho principal não foi alterado.`],
  [/^(.+?) no reemplaza ningún versículo con otro texto: solo completa los vacíos del borrador principal\. Esto no publica una versión\.$/, (m) => `${m[1] === "Esta revisión" ? "Esta revisão" : m[1]} não substitui nenhum versículo por outro texto: só completa os vazios do rascunho principal. Isto não publica uma versão.`],
  [/^(.+?) reemplaza en el borrador principal (el versículo|los versículos) (.+) con el texto de la revisión\. Los versículos fuera de esta revisión no cambian\. Esto no publica una versión\.$/s, (m) => `${m[1] === "Esta revisión" ? "Esta revisão" : m[1]} substitui no rascunho principal ${m[2] === "el versículo" ? "o versículo" : "os versículos"} ${m[3]} pelo texto da revisão. Os versículos fora desta revisão não mudam. Isto não publica uma versão.`],
  [/^(.*?): (ese versículo tiene|esos versículos tienen) un texto distinto en el borrador grupal y en el borrador principal\. Resuélvelo primero; no se cambió el borrador principal\.$/, (m) => `${m[1]}: ${m[2] === "ese versículo tiene" ? "esse versículo tem" : "esses versículos têm"} um texto diferente no rascunho do grupo e no rascunho principal. Resolva primeiro; o rascunho principal não foi alterado.`],
  [/^No hay repositorio configurado para «(.+)»\.$/, (m) => `Não há repositório configurado para «${m[1]}».`],
  [/^No se encontró el borrador grupal de esta tarea en (\S+)\. No se cambió nada\.$/, (m) => `O rascunho do grupo desta tarefa não foi encontrado em ${m[1]}. Nada foi alterado.`],
  [/^El borrador principal no tiene «(.+)»\. No se cambió nada\.$/, (m) => `O rascunho principal não tem «${m[1]}». Nada foi alterado.`],
  [/^Listo: (.+?) ya está en el borrador principal(?: \((.+) ya estaba\))?\.(?: La revisión reemplazó (.+)\.)?$/s, (m) => `Pronto: ${m[1]} já está no rascunho principal${m[2] ? ` (${m[2]} já estava)` : ""}.${m[3] ? ` A revisão substituiu ${m[3]}.` : ""}`],
  [/^(.+) todavía no está en el borrador principal\.$/, (m) => `${m[1]} ainda não está no rascunho principal.`],
  [/^Elige al menos una fase para «(.+)»\.$/, (m) => `Escolha pelo menos uma fase para «${m[1]}».`],
  [/^Una fase elegida para «(.+)» ya no existe\. Revisa las fases de esta versión\.$/, (m) => `Uma fase escolhida para «${m[1]}» não existe mais. Revise as fases desta versão.`],
  [/^«(.+)» todavía no tiene tareas\.$/, (m) => `«${m[1]}» ainda não tem tarefas.`],
  [/^«(.+?)» no está lista\. (.+?): (.+)$/s, (m) => `«${m[1]}» não está pronta. ${m[2]}: ${m[3]}`],
  [/^La versión «(.+)» ya existe\. No se publicó otra\.$/, (m) => `A versão «${m[1]}» já existe. Nenhuma outra foi publicada.`],
  [/^Versión «(.+)» publicada \(en parte ya existía\)\.$/, (m) => `Versão «${m[1]}» publicada (em parte já existia).`],
  [/^Versión «(.+)» publicada\.$/, (m) => `Versão «${m[1]}» publicada.`],
  [/^Revisión creada: (.+)\.$/, (m) => `Revisão criada: ${m[1]}.`],
  [/^Revisiones creadas: (.+)\.$/, (m) => `Revisões criadas: ${m[1]}.`],
  [/^Esta revisión ya existe \((.+?)\); no se creó otra\.(?: Se cambió la persona asignada en (.+)\.)?$/, (m) => `Esta revisão já existe (${m[1]}); nenhuma outra foi criada.${m[2] ? ` A pessoa atribuída foi trocada em ${m[2]}.` : ""}`],
  [/^No se encontró el borrador principal de (\S+)\. No se publicó nada\.$/, (m) => `O rascunho principal de ${m[1]} não foi encontrado. Nada foi publicado.`],
  [/^Mientras confirmabas se publicó otra versión hoy\. No se publicó «(.+)»; cierra y vuelve a publicar para ver el nombre nuevo\.$/, (m) => `Enquanto você confirmava, outra versão foi publicada hoje. «${m[1]}» não foi publicada; feche e publique de novo para ver o novo nome.`],

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

const STEP_PT: Record<string, string> = glossary.threadSteps;
const PLACE_PT: Record<string, string> = glossary.threadPlaces;
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

