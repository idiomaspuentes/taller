/** taller.config.ts: it must be usable, spaces must not share an organization, and the language and space logic. */
import { PRINCIPAL_PASS_ACTION, principalReviewConfirmText } from "../src/domain/principalPass";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tallerConfig, configProblems, workspaceById, workspaceOfOrg, type TallerConfig } from "../src/config";
import { detectUiLanguage } from "../src/i18n/language";
import { translate, MESSAGE_KEYS_ES } from "../src/i18n/messages";
import { appTitle } from "../src/brand";
import { buildManifest } from "../src/manifest";
import { displayName, initialsOf, levelName, memberSince, publicProfileUrl, safeLink, settingsUrl } from "../src/domain/profile";
import { parseServerParam, readServerFromUrl, serverChoiceVisible } from "../src/serverChoice";
import { localizeHold, localizeName, localizeToday } from "../src/domain/templateNames";
import { localizeScope } from "../src/domain/scopeNames";
import { articleFilterHelp, articleFilterLabel, assignableCountLabel, grainChoiceLabel, grainHelp, scriptureIntro, stayInChapterHelp, DISTRIBUTE_POLICY_HELP, DISTRIBUTE_POLICY_LABEL, DISTRIBUTE_UNIT_HELP, DISTRIBUTE_UNIT_LABEL, SCOPE_KEYS, ARTICLE_FILTERS, ARTICLE_FILTER_LABEL, GRAIN_LABEL } from "../src/domain/types";
import { localizeThread } from "../src/domain/threadNames";
import { OPTION_LABEL } from "../src/domain/alignmentDecision";
import {
  decidedConflictSentence, verseConflictOptionLabels, verseConflictPanels, verseConflictTitle,
  type VerseConflictData,
} from "../src/domain/verseConflictEvent";
import { localizeAfinacion } from "../src/domain/afinacionNames";
import { categoryLabel } from "../src/domain/afinacionNotes";
import { BootstrapError, explainRepoFileError, type BootstrapStep } from "../src/dcs/repoFile";
import { DcsApiError } from "@ip-lms/dcs-client";
import { BOOKS, bookLabel, bookName } from "../src/domain/books";
import { hadWork, hadWorkKey, markHadWork } from "../src/hadWork";
import { markOnboardingDone, onboardingDone, onboardingKey } from "../src/onboarding";
import { contextWith, initialWorkspace, loadWorkspaceId, saveWorkspaceId, suggestedWorkspace } from "../src/workspace";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const clone = (): TallerConfig => JSON.parse(JSON.stringify(tallerConfig)) as TallerConfig;
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

await test("la configuración que se publica no tiene problemas", () => {
  assert.deepEqual(configProblems(tallerConfig), []);
});

await test("se avisa de lo que falta o está mal, en palabras claras", () => {
  const noSpaces = clone();
  noSpaces.workspaces = [];
  assert.match(configProblems(noSpaces).join(" "), /al menos un espacio/);

  const shared = clone();
  shared.workspaces[1]!.pmOrg = shared.workspaces[0]!.pmOrg.toUpperCase();
  assert.match(configProblems(shared).join(" "), /comparten la organización .* sin scope/, "dos espacios en una misma organización sin scope mezclarían sus tareas");

  const noName = clone();
  noName.workspaces[0]!.name.pt = " ";
  assert.match(configProblems(noName).join(" "), /no tiene nombre en "pt"/);

  const noWelcome = clone();
  noWelcome.welcome.pt.points[1] = "";
  assert.match(configProblems(noWelcome).join(" "), /bienvenida en "pt" tiene campos vacíos/);

  const dupId = clone();
  dupId.workspaces[1]!.id = dupId.workspaces[0]!.id;
  assert.match(configProblems(dupId).join(" "), /repetido/);
});

await test("varios espacios pueden compartir organización si su scope los distingue", () => {
  const ok = clone();
  ok.workspaces[1]!.pmOrg = ok.workspaces[0]!.pmOrg;
  ok.workspaces[0]!.scope = "es";
  ok.workspaces[1]!.scope = "pt";
  assert.deepEqual(configProblems(ok), [], "dos scopes distintos en una organización");

  const oneBare = clone();
  oneBare.workspaces[1]!.pmOrg = oneBare.workspaces[0]!.pmOrg;
  oneBare.workspaces[1]!.scope = "pt";
  assert.deepEqual(configProblems(oneBare), [], "uno sin scope (el de siempre) y otro con scope");

  const same = clone();
  same.workspaces[1]!.pmOrg = same.workspaces[0]!.pmOrg;
  same.workspaces[0]!.scope = "x";
  same.workspaces[1]!.scope = "X";
  assert.match(configProblems(same).join(" "), /mismo scope/);

  const bad = clone();
  bad.workspaces[0]!.scope = "con espacios/y barras";
  assert.match(configProblems(bad).join(" "), /solo puede tener minúsculas/);
});

await test("español y portugués tienen cada uno su propio espacio, con su organización y su lengua", () => {
  const es = workspaceById(tallerConfig, "es")!;
  const pt = workspaceById(tallerConfig, "pt")!;
  assert.notEqual(es.pmOrg.toLowerCase(), pt.pmOrg.toLowerCase());
  assert.notEqual(es.contentOrg.toLowerCase(), pt.contentOrg.toLowerCase());
  assert.notEqual(es.lang, pt.lang);
  assert.equal(workspaceOfOrg(tallerConfig, "PT-BR_GL")?.id, "pt", "se reconoce la organización sin importar mayúsculas");
});

await test("el espacio guardado se respeta; con uno solo se elige solo; con varios y sin elegir se pregunta", () => {
  const store = memory();
  assert.equal(initialWorkspace(tallerConfig, store), undefined, "dos espacios y ninguna elección: se pregunta");
  saveWorkspaceId("pt", store);
  assert.equal(loadWorkspaceId(store), "pt");
  assert.equal(initialWorkspace(tallerConfig, store)?.id, "pt");
  saveWorkspaceId("ya-no-existe", store);
  assert.equal(initialWorkspace(tallerConfig, store), undefined, "un espacio que ya no está en la configuración no se usa");
  const one = clone();
  one.workspaces = [one.workspaces[0]!];
  assert.equal(initialWorkspace(one, memory())?.id, "es", "con un solo espacio no hay nada que elegir");
});

await test("el espacio fija la lengua y las organizaciones por encima de lo guardado, sin tocar lo demás", () => {
  const stale = { lang: "es-419", contentOrg: "es-419_gl", pmOrg: "BSOJ", book: "NEH", host: "https://qa.door43.org" };
  const pt = workspaceById(tallerConfig, "pt")!;
  assert.deepEqual(contextWith(stale, pt), { lang: pt.lang, contentOrg: pt.contentOrg, pmOrg: pt.pmOrg, book: "NEH", host: "https://qa.door43.org" });
});

await test("la pantalla de bienvenida sugiere el equipo que habla el idioma de la persona", () => {
  assert.equal(suggestedWorkspace(tallerConfig, "pt")?.id, "pt");
  assert.equal(suggestedWorkspace(tallerConfig, "es")?.id, "es");
  assert.equal(suggestedWorkspace(tallerConfig, "fr")?.id, "es", "sin coincidencia, el primero");
});

await test("el idioma de la interfaz: lo elegido antes, si no el del navegador, si no el de la configuración", () => {
  const supported = ["es", "pt"] as const;
  assert.equal(detectUiLanguage(supported, "pt", ["es-419"], "es"), "pt", "lo elegido gana");
  assert.equal(detectUiLanguage(supported, null, ["pt-BR", "en"], "es"), "pt");
  assert.equal(detectUiLanguage(supported, null, ["en-US", "pt-PT"], "es"), "pt", "se recorre la lista del navegador");
  assert.equal(detectUiLanguage(supported, null, ["fr", "en"], "es"), "es");
  assert.equal(detectUiLanguage(supported, "fr", [], "es"), "es", "un idioma guardado que ya no se soporta se ignora");
});

await test("cada texto de la interfaz existe en portugués y no queda ninguno vacío", () => {
  for (const key of MESSAGE_KEYS_ES) {
    assert.ok(translate("es", key).trim(), `es: ${key}`);
    assert.ok(translate("pt", key).trim(), `pt: ${key}`);
  }
  assert.equal(translate("pt", "nav.myTasks"), "Minhas tarefas");
  assert.equal(translate("es", "nav.myTasks"), "Mis tareas");
});

await test("los primeros pasos se ocultan por persona y servidor en este dispositivo, y no vuelven", () => {
  const store = memory();
  const ana = onboardingKey("https://qa.door43.org/", "Ana");
  assert.equal(ana, onboardingKey("https://qa.door43.org", "ana"), "sin barra final ni mayúsculas");
  assert.equal(onboardingDone(ana, store), false);
  markOnboardingDone(ana, store);
  assert.equal(onboardingDone(ana, store), true);
  assert.equal(onboardingDone(onboardingKey("https://qa.door43.org", "bea"), store), false, "otra persona los ve");
  assert.equal(onboardingDone(onboardingKey("https://git.door43.org", "ana"), store), false, "otro servidor, otra vez");
});

await test("se recuerda si una persona ya tuvo trabajo, por servidor, organización y espacio", () => {
  const store = memory();
  const key = hadWorkKey("https://qa.door43.org/", "Ana", "ES-419_gl", "");
  assert.equal(key, hadWorkKey("https://qa.door43.org", "ana", "es-419_gl", ""), "sin barra final ni mayúsculas");
  assert.equal(hadWork(key, store), false);
  markHadWork(key, store);
  assert.equal(hadWork(key, store), true);
  assert.equal(hadWork(hadWorkKey("https://qa.door43.org", "ana", "es-419_gl", "pt:"), store), false, "otro espacio de la misma organización empieza de cero");
});

await test("los nombres de fábrica de las plantillas se traducen al mostrarlos y lo editado se respeta", () => {
  assert.equal(localizeName("FCR: Flujo de Creación de Recursos 1", "pt"), "FCR: Fluxo de Criação de Recursos 1");
  assert.equal(localizeName("Afinación", "pt"), "Afinação");
  assert.equal(localizeName("Afinación", "es"), "Afinación", "en español no cambia nada");
  assert.equal(localizeName("2 · Traducir TPL 1", "pt"), "2 · Traduzir TPL 1", "también dentro del título de una subtarea");
  assert.equal(localizeName("Revisar la alineación", "pt"), "Revisar o alinhamento", "la más larga gana a «Alinear»");
  assert.equal(localizeName("Alinear", "pt"), "Alinhar");
  assert.equal(localizeName("Armonizar Tpl", "pt"), "Harmonizar Tpl");
  assert.equal(localizeName("Sin asignar", "pt"), "Sem atribuição");
  assert.equal(localizeName("Mi paso propio", "pt"), "Mi paso propio", "un nombre editado se deja como está");
  assert.equal(localizeName("", "pt"), "");
});

await test("las razones de espera y de nivel se muestran en el idioma de la interfaz", () => {
  assert.equal(localizeHold("Espera a «Traducir TPL» de @ana y 2 más", "pt"), "Aguarda «Traduzir TPL» de @ana e mais 2");
  assert.equal(localizeHold("Espera a «Afinar TPL»", "pt"), "Aguarda «Afinar TPL»");
  assert.equal(localizeHold("Pide nivel persona habilitada", "pt"), "Exige nível pessoa habilitada");
  assert.equal(localizeHold("Pide nivel observador", "pt"), "Exige nível observador");
  assert.equal(localizeHold("Solo observas", "pt"), "Você só observa");
  assert.equal(localizeHold("Solo observas", "es"), "Solo observas", "en español no cambia");
  assert.equal(localizeHold("Algo que no se conoce", "pt"), "Algo que no se conoce");
});

await test("el título del sitio es el nombre de la app más el nombre corto de la organización", () => {
  assert.equal(appTitle("es"), "Taller Id");
  assert.equal(appTitle("pt"), "Ateliê Id");
  const noShort = clone();
  noShort.brand.short = " ";
  assert.match(configProblems(noShort).join(" "), /brand\.short/);
});

await test("el nombre con que se instala la app sigue el idioma de la interfaz", () => {
  const es = buildManifest("es", "https://taller.example/") as { name: string; short_name: string; lang: string; start_url: string; scope: string; icons: { src: string }[] };
  const pt = buildManifest("pt", "https://taller.example/") as typeof es;
  assert.equal(es.name, "Taller Id");
  assert.equal(es.short_name, "Taller");
  assert.equal(pt.name, "Ateliê Id");
  assert.equal(pt.short_name, "Ateliê");
  assert.equal(pt.lang, "pt");
  assert.equal(pt.start_url, "https://taller.example/#/mis-tareas", "todo absoluto: un manifest en memoria no tiene dónde resolver rutas");
  assert.equal(pt.scope, "https://taller.example/");
  assert.ok(pt.icons.every((i) => i.src.startsWith("https://taller.example/")));
});

await test("el servidor de Door43 no se ofrece a la gente normal: solo con ?server= en ese dispositivo", () => {
  assert.equal(parseServerParam("?server=qa"), "qa");
  assert.equal(parseServerParam("?x=1&server=PRODUCTION"), "production");
  assert.equal(parseServerParam("?server=otro"), null);
  assert.equal(parseServerParam(""), null);
  const store = memory();
  assert.equal(serverChoiceVisible(true, false, store), false, "producción y nadie lo pidió: no se ve");
  assert.equal(serverChoiceVisible(false, false, store), true, "si el servidor no es producción, se ve para poder volver");
  assert.equal(serverChoiceVisible(true, true, store), true, "en desarrollo siempre");
  assert.equal(readServerFromUrl("?server=qa", store), "https://qa.door43.org");
  assert.equal(serverChoiceVisible(true, false, store), true, "tras pedirlo, ese dispositivo lo ve");
});

await test("el repositorio del plan se configura en taller.config.ts", async () => {
  assert.equal(tallerConfig.pmRepo, "taller");
  const { PM_REPO_NAME } = await import("../src/domain/types");
  assert.equal(PM_REPO_NAME, tallerConfig.pmRepo, "el código lee la configuración, no un nombre escrito a mano");
  const bad = clone();
  bad.pmRepo = "con espacios/y barra";
  assert.match(configProblems(bad).join(" "), /pmRepo/);
  const legacy = clone();
  legacy.pmRepo = "gateway-tasks";
  assert.deepEqual(configProblems(legacy), [], "quien ya usa gateway-tasks lo conserva");
});

await test("el perfil: lo que se muestra viene de Door43 y para cambiarlo se envía a Door43", () => {
  assert.equal(settingsUrl("https://git.door43.org/"), "https://git.door43.org/user/settings");
  assert.equal(publicProfileUrl("https://qa.door43.org", "abel perez"), "https://qa.door43.org/abel%20perez");
  assert.equal(displayName({ login: "abelperez", full_name: " Abel Pérez " }, "x"), "Abel Pérez");
  assert.equal(displayName({ login: "abelperez", full_name: "" }, "x"), "abelperez", "sin nombre completo, el usuario");
  assert.equal(displayName(null, "ana"), "ana");
  assert.equal(initialsOf("Abel Pérez"), "AP");
  assert.equal(initialsOf("abelperez"), "AB");
  assert.equal(initialsOf("ana.maria_lopez"), "AL");
  assert.equal(initialsOf("  "), "?");
  assert.match(memberSince("2024-03-05T10:00:00Z", "es"), /marzo.*2024/i);
  assert.match(memberSince("2024-03-05T10:00:00Z", "pt"), /março.*2024/i);
  assert.equal(memberSince("no es fecha", "es"), "");
  assert.equal(memberSince(undefined, "es"), "");
  assert.equal(levelName("habilitada", "pt"), "Pessoa habilitada");
  assert.equal(levelName("oyente", "es"), "Observador");
  assert.equal(safeLink("https://example.org/a"), "https://example.org/a");
  assert.equal(safeLink("example.org"), "https://example.org/", "sin protocolo se asume https");
  assert.equal(safeLink("javascript:alert(1)"), "", "nunca un enlace que ejecute código");
  assert.equal(safeLink(""), "");
});

await test("las razones de «Equipo hoy» se muestran en el idioma de la interfaz", () => {
  const cases: [string, string][] = [
    ["Cerrada hoy", "Fechada hoje"],
    ["Cerrada hace 3 días", "Fechada há 3 dias"],
    ["Se decide antes de mañana", "Decide-se antes de amanhã"],
    ["Se decide antes de 2 días", "Decide-se antes de 2 dias"],
    ["El plazo vence hoy", "O prazo vence hoje"],
    ["El plazo venció hace 1 día: decide quien coordina", "O prazo venceu há 1 dia: decide quem coordena"],
    ["Nadie la ha tomado en 4 días", "Ninguém pegou há 4 dias"],
    ["Libre para el equipo", "Livre para a equipe"],
    ["Sin movimiento hace 6 días", "Sem movimento há 6 dias"],
    ["Último movimiento hoy", "Último movimento hoje"],
    ["Espera a «Traducir TPL» de @ana", "Aguarda «Traduzir TPL» de @ana"],
  ];
  for (const [es, pt] of cases) {
    assert.equal(localizeToday(es, "pt"), pt);
    assert.equal(localizeToday(es, "es"), es, "en español no cambia");
  }
  assert.equal(localizeToday("Algo que no se conoce", "pt"), "Algo que no se conoce");
});

await test("los 66 libros tienen nombre en portugués y el guardado sigue en español", () => {
  for (const b of BOOKS) {
    assert.notEqual(bookLabel(b.code, "pt"), "", b.code);
    assert.ok(/[a-zA-Z]/.test(bookLabel(b.code, "pt")), b.code);
  }
  assert.equal(BOOKS.length, 66);
  assert.equal(bookLabel("JHN", "pt"), "João");
  assert.equal(bookLabel("JHN", "es"), "Juan");
  assert.equal(bookName("JHN"), "Juan", "lo que se escribe en Door43 no cambia con la interfaz");
  assert.equal(bookLabel("pentateuco-r1", "pt"), "pentateuco-r1", "un proyecto temático conserva su identificador");
});

await test("las etiquetas y ayudas del alcance de una tarea se traducen sin dejar frases en español", () => {
  const texts: string[] = [
    ...Object.values(DISTRIBUTE_UNIT_LABEL), ...Object.values(DISTRIBUTE_UNIT_HELP),
    ...Object.values(DISTRIBUTE_POLICY_LABEL), ...Object.values(DISTRIBUTE_POLICY_HELP),
    ...Object.values(ARTICLE_FILTER_LABEL), ...Object.values(GRAIN_LABEL),
    stayInChapterHelp("notas"), scriptureIntro("tpl"), scriptureIntro("tps"),
  ];
  const grains = ["item", "portion", "portionRefs"] as const;
  for (const key of SCOPE_KEYS) {
    for (const f of ARTICLE_FILTERS) {
      texts.push(articleFilterLabel(key, f), articleFilterHelp(key, f), articleFilterHelp(key, f, "portionRefs"));
    }
    for (const g of grains) texts.push(grainChoiceLabel(key, g), grainHelp(key, g));
    for (const n of [1, 5]) for (const g of grains) texts.push(assignableCountLabel(key, g, n));
  }
  const missing = [...new Set(texts.filter((t) => t && localizeScope(t, "pt") === t))];
  // Words spelled the same in both languages are fine; anything with a Spanish-only mark or word is not.
  const sameInBoth = ["Nota por nota"];
  const spanish = missing.filter((t) => !sameInBoth.includes(t) && /[ñ¿¡]|ción|\b(el|la|los|las|de|del|en|con|solo|cada|una|uno|por|para)\b/i.test(t));
  assert.deepEqual(spanish, [], "faltan en scopeNames.ts");
  assert.equal(localizeScope("12 porciones", "pt"), "12 porções");
  assert.equal(localizeScope("Notas · Solo con notas · Nota por nota", "pt"), "Notas · Somente com notas · Nota por nota");
  assert.equal(localizeScope("Solo con notas", "es"), "Solo con notas");
});

await test("lo que muestra «Asignar» (estados, tipos, lotes y mensajes de autoasignar) se traduce", () => {
  const cases: [string, string][] = [
    ["Sin asignar", "Sem atribuição"],
    ["En curso", "Em andamento"],
    ["Pregunta", "Pergunta"],
    ["Capítulo 3 · 4 TPL · 2 notas · 1 pregunta · 5 palabras", "Capítulo 3 · 4 TPL · 2 notas · 1 pergunta · 5 palavras"],
    ["Porciones NEH 1:1-3 · NEH 1:4-6", "Porções NEH 1:1-3 · NEH 1:4-6"],
    ["Añade integrantes a Traducir TPL antes de autoasignar.", "Adicione integrantes a Traducir TPL antes de autoatribuir."],
    ["Traducir TPL está en modo solo manual: elige persona a persona en Asignar.", "Traducir TPL está no modo somente manual: escolha pessoa por pessoa em Atribuir."],
    ["No queda trabajo sin asignar en el alcance de Traducir TPL.", "Não resta trabalho sem atribuição no alcance de Traducir TPL."],
    ["Autoasignados 1 lote de X entre 3 personas (por porción).", "Autoatribuídos 1 lote de X entre 3 pessoas (por porção)."],
    ["Autoasignados 6 porciones/bloques (12 ítems) de X entre 3 personas (por capítulo entero).", "Autoatribuídos 6 porções/blocos (12 itens) de X entre 3 pessoas (por capítulo inteiro)."],
    ["tpl · todas las porciones · porciones", "tpl · todas as porções · porções"],
  ];
  for (const [es, pt] of cases) assert.equal(localizeScope(es, "pt"), pt);
});

await test("el avance de «Inventariar» y los estados de los artículos se traducen", () => {
  for (const [es, pt] of [
    ["Descargando…", "Baixando…"], ["Descargando ULT y compañeros…", "Baixando ULT e companheiros…"],
    ["Preparando porciones…", "Preparando porções…"], ["Revisando artículos…", "Revisando artigos…"], ["Listo.", "Pronto."],
    ["Inglés", "Inglês"], ["Traducido", "Traduzido"], ["Incompleto", "Incompleto"],
  ] as const) assert.equal(localizeScope(es, "pt"), pt);
});

await test("las líneas de la conversación (decisiones, votos, conflictos de versículo) se traducen y los textos de las personas no", () => {
  const spanishMarks = /[ñ¿¡]|\b(el|la|los|las|del|con|quedó|versión|propuesta|alineación|cerrar|decisión|votó|tu|tuya|otra)\b/i;
  for (const label of Object.values(OPTION_LABEL)) {
    const pt = localizeThread(label, "pt");
    assert.notEqual(pt, label);
    assert.equal(localizeThread(`${label} (2) ✓`, "pt"), `${pt} (2) ✓`, "con el contador y la marca");
  }
  const base: VerseConflictData = {
    pr: { owner: "o", repo: "r", number: 1 }, bookRef: "NEH", book: "NEH", usfmPath: "x",
    range: { chapter: 1, from: 2, to: 3, kind: "texto", kept: "ultimo" },
    conflictIssue: 10, closer: "ana", otherIssue: 11, otherLogin: "bea", side: "entrante",
    texts: { entrante: "a", tronco: "b" },
  };
  const samples: string[] = [];
  for (const side of ["entrante", "desplazado"] as const) {
    for (const kept of ["ultimo", "tronco"] as const) {
      for (const otherLogin of ["bea", null]) {
        const data: VerseConflictData = { ...base, side, otherLogin, range: { ...base.range, kept } };
        samples.push(verseConflictTitle(data), decidedConflictSentence(data), ...Object.values(verseConflictOptionLabels(data)));
        for (const panel of verseConflictPanels(data)) samples.push(panel.label, ...(panel.tag ? [panel.tag] : []));
      }
    }
  }
  for (const es of new Set(samples)) {
    const pt = localizeThread(es, "pt");
    assert.ok(pt !== es || !spanishMarks.test(es), `sin traducir: ${es}`);
    assert.ok(!/\b(quedó|versión|cerró|Dejar|Usar la)\b/.test(pt), `quedó español: ${pt}`);
    assert.equal(localizeThread(es, "es"), es);
  }
  assert.equal(localizeThread("Propuesta de @ana para NEH 1:2", "pt"), "Proposta de @ana para NEH 1:2");
  assert.equal(localizeThread("@bea votó: Aceptar la propuesta", "pt"), "@bea votou: Aceitar a proposta");
  assert.equal(
    localizeThread("Decidido por el equipo; @ana confirmó el consenso. Se aceptó la propuesta y la alineación quedó cambiada.", "pt"),
    "Decidido pela equipe; @ana confirmou o consenso. A proposta foi aceita e o alinhamento foi alterado.",
  );
  assert.equal(
    localizeThread("Hay consenso: Aceptar la propuesta (@ana, @bea). @ana: falta que una persona lo confirme para cerrar la decisión.", "pt"),
    "Há consenso: Aceitar a proposta (@ana, @bea). @ana: falta uma pessoa confirmar para encerrar a decisão.",
  );
  assert.equal(localizeThread("Resuelto por @ana: quedó la versión de @bea", "pt"), "Resolvido por @ana: ficou a versão de @bea");
  assert.equal(localizeThread("Versículos 1:2 guardados en el borrador grupal", "pt"), "Versículos 1:2 salvos no rascunho do grupo");
});

await test("las categorías de las notas se traducen y las que no se conocen se dejan", () => {
  for (const code of ["figs-metaphor", "figs-rquestion", "translate-names", "grammar-connect-logic-reason", "writing-background", ""]) {
    const es = categoryLabel(code);
    assert.notEqual(localizeAfinacion(es, "pt"), "", code);
    assert.equal(localizeAfinacion(es, "es"), es);
  }
  assert.equal(localizeAfinacion(categoryLabel("figs-metaphor"), "pt"), "Metáfora");
  assert.equal(localizeAfinacion(categoryLabel("figs-youplural"), "pt"), "«Você» plural");
  assert.equal(localizeAfinacion(categoryLabel(""), "pt"), "Informação geral");
  assert.equal(localizeAfinacion(categoryLabel("figs-algo-nuevo"), "pt"), categoryLabel("figs-algo-nuevo"), "una categoría nueva se muestra como viene");
});

await test("los mensajes de error al guardar el borrador se traducen alrededor del detalle técnico", () => {
  const ctx = { owner: "pt-br_gl", repo: "pt-br_glt", filepath: "16-NEH.usfm", branch: "w/neh/1" };
  const steps: BootstrapStep[] = ["repo", "default-branch", "book-branch", "file-create", "file-copy", "task-branch", "pr-close", "work-branch-delete", "trunk-merge", "principal-pass"];
  const messages: string[] = [];
  for (const step of steps) {
    for (const status of [undefined, 404, 403, 500]) {
      messages.push(explainRepoFileError(new BootstrapError("detalle crudo", step, status), ctx));
    }
  }
  for (const status of [401, 404, 409, 500]) {
    messages.push(explainRepoFileError(new DcsApiError("x", status, { message: "algo" }), ctx));
    messages.push(explainRepoFileError(new DcsApiError("x", status), { ...ctx, creating: true }));
  }
  for (const branch of ["master", "w/x/1", "archivo/neh", "otra"]) {
    messages.push(explainRepoFileError(new DcsApiError("x", 404), { ...ctx, branch }));
  }
  const frames = /\b(No se pudo|Sin permiso|Falló|Inicia sesión|No existe|No se encontró|Conflicto al|Vuelve a|Detalle técnico|está vacío|reintenta)\b/;
  for (const es of new Set(messages)) {
    const pt = localizeThread(es, "pt");
    assert.ok(!frames.test(pt), `sin traducir: ${es}\n→ ${pt}`);
    assert.ok(pt.includes("detalle crudo") || !es.includes("detalle crudo"), "el detalle técnico se conserva tal cual");
  }
  assert.equal(
    localizeThread("No se pudo guardar «16-NEH.usfm» en pt-br_gl/pt-br_glt en tu borrador (HTTP 500): algo", "pt"),
    "Não foi possível salvar «16-NEH.usfm» em pt-br_gl/pt-br_glt no seu rascunho (HTTP 500): algo",
  );
});

await test("los archivos de traducción tienen las mismas claves y conservan los {marcadores}", () => {
  const dir = new URL("../src/i18n/locales/", import.meta.url);
  const esJson = JSON.parse(readFileSync(new URL("es.json", dir), "utf8")) as Record<string, string>;
  const ptJson = JSON.parse(readFileSync(new URL("pt.json", dir), "utf8")) as Record<string, string>;
  const marks = (t: string) => [...(t.match(/\{[A-Za-z0-9_]+\}/g) ?? [])].sort().join(",");
  assert.deepEqual(Object.keys(ptJson).sort(), Object.keys(esJson).sort(), "pt.json y es.json deben tener las mismas claves");
  for (const key of Object.keys(esJson)) assert.equal(marks(ptJson[key]!), marks(esJson[key]!), `«${key}» debe conservar sus {marcadores}`);
  const glossary = JSON.parse(readFileSync(new URL("glossary.pt.json", dir), "utf8")) as Record<string, Record<string, string>>;
  for (const [section, table] of Object.entries(glossary)) {
    for (const [source, target] of Object.entries(table)) assert.ok(target.trim() !== "", `glosario ${section}: «${source}» sin traducción`);
  }
});

await test("el pase al borrador principal se traduce (acción y confirmación)", () => {
  const texts = [
    PRINCIPAL_PASS_ACTION,
    principalReviewConfirmText({ taskName: "Rev A", replaced: [{ book: "TIT", verses: [{ chapter: 1, from: 2, to: 2 }] }] }),
    principalReviewConfirmText({ taskName: "Rev A", replaced: [] }),
  ];
  for (const text of texts) {
    const pt = localizeThread(text, "pt");
    assert.notEqual(pt, text);
    assert.doesNotMatch(pt, /borrador|revisión|Esto no|Solo /);
  }
});

await test("los avisos de revisión y de publicar versión se traducen", () => {
  const cases: [string, string][] = [
    ["Crear la revisión", "Criar a revisão"],
    ["Publicar versión", "Publicar versão"],
    ["Elige al menos una fase para «Traducción».", "Escolha pelo menos uma fase para «Traducción»."],
    ["Traducir TPL todavía no está en el borrador principal.", "Traducir TPL ainda não está no rascunho principal."],
    ["Versión «Traducción · 1 oct» publicada.", "Versão «Traducción · 1 oct» publicada."],
    ["Revisiones creadas: #4, #5.", "Revisões criadas: #4, #5."],
    ["Esta revisión ya existe (#4); no se creó otra. Se cambió la persona asignada en #4.", "Esta revisão já existe (#4); nenhuma outra foi criada. A pessoa atribuída foi trocada em #4."],
  ];
  for (const [es, pt] of cases) assert.equal(localizeThread(es, "pt"), pt);
});

console.log(`\nverify-config: ${passed} checks passed.`);
