/**
 * Names of the translation-note categories and of the kinds of key terms, built in Spanish by
 * `afinacionNotes.ts` / `afinacionWords.ts`. Translated when shown; anything not listed (a category the table does
 * not know yields a capitalized form of its code) is returned as it is.
 */
import type { UiLanguage } from "../config";

const PT: [string, string][] = [
  ["Metáfora", "Metáfora"], ["Símil", "Símile"], ["Modismo", "Expressão idiomática"], ["Pregunta retórica", "Pergunta retórica"],
  ["Sustantivos abstractos", "Substantivos abstratos"], ["Activa o pasiva", "Voz ativa ou passiva"], ["Elipsis", "Elipse"],
  ["«Nosotros» exclusivo", "«Nós» exclusivo"], ["«Nosotros» inclusivo", "«Nós» inclusivo"], ["Formas de «tú»", "Formas de «você»"],
  ["«Tú» singular", "«Você» singular"], ["«Tú» dual", "«Você» dual"], ["«Tú» plural", "«Você» plural"],
  ["Primera, segunda y tercera persona", "Primeira, segunda e terceira pessoa"], ["Aparte", "Aparte"],
  ["Pronombres reflexivos", "Pronomes reflexivos"], ["Fórmula de juramento", "Fórmula de juramento"], ["Metonimia", "Metonímia"],
  ["Sinécdoque", "Sinédoque"], ["Hipérbole", "Hipérbole"], ["Doblete", "Dupleto"], ["Paralelismo", "Paralelismo"], ["Ironía", "Ironia"],
  ["Personificación", "Personificação"], ["Lítotes", "Litotes"], ["Eufemismo", "Eufemismo"], ["Información implícita", "Informação implícita"],
  ["Ir y venir", "Ir e vir"], ["Doble negación", "Dupla negação"], ["Citas", "Citações"], ["Adjetivos como sustantivos", "Adjetivos como substantivos"],
  ["Sustantivos genéricos", "Substantivos genéricos"], ["Orden de los eventos", "Ordem dos eventos"], ["Distinguir", "Distinguir"],
  ["Hendíadis", "Hendíadis"], ["Merismo", "Merismo"], ["Género", "Gênero"], ["Posesión", "Posse"], ["Oraciones declarativas", "Orações declarativas"],
  ["Imperativos", "Imperativos"], ["Exclamaciones", "Exclamações"], ["Informar y recordar", "Informar e lembrar"], ["Pronombres", "Pronomes"],
  ["Oraciones", "Orações"], ["Verbos", "Verbos"], ["Nombres", "Nomes"], ["Cosas desconocidas", "Coisas desconhecidas"], ["Números", "Números"],
  ["Distancias", "Distâncias"], ["Volúmenes", "Volumes"], ["Pesos", "Pesos"], ["Dinero", "Dinheiro"], ["Transliterar", "Transliterar"],
  ["Variantes del texto", "Variantes do texto"], ["Acciones simbólicas", "Ações simbólicas"], ["Meses hebreos", "Meses hebraicos"],
  ["Ordinales", "Ordinais"], ["Fracciones", "Frações"], ["Versículos unidos", "Versículos unidos"], ["Bendiciones", "Bênçãos"], ["Fuentes", "Fontes"],
  ["Información de fondo", "Informação de fundo"], ["Eventos nuevos", "Eventos novos"], ["Participantes", "Participantes"], ["Cortesía", "Cortesia"],
  ["Lenguaje simbólico", "Linguagem simbólica"], ["Sustantivos colectivos", "Substantivos coletivos"], ["Conexiones: resultado", "Conexões: resultado"],
  ["Conexiones: propósito", "Conexões: propósito"], ["Conexiones: contraste", "Conexões: contraste"], ["Conexiones: razón", "Conexões: razão"],
  ["Condiciones", "Condições"], ["Condiciones hipotéticas", "Condições hipotéticas"], ["Condiciones contrarias", "Condições contrárias"],
  ["Tiempo: secuencia", "Tempo: sequência"], ["Tiempo: a la vez", "Tempo: ao mesmo tempo"], ["Tiempo: trasfondo", "Tempo: contexto"],
  ["Conectar palabras y frases", "Conectar palavras e frases"], ["Excepciones", "Exceções"], ["Información general", "Informação geral"],
  ["Términos clave", "Termos-chave"], ["Otros términos", "Outros termos"],
];

const MAP = new Map(PT);

export function localizeAfinacion(text: string, language: UiLanguage): string {
  return language === "pt" ? (MAP.get(text) ?? text) : text;
}
