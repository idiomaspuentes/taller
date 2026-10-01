/** taller.config.ts: it must be usable, spaces must not share an organization, and the language and space logic. */
import assert from "node:assert/strict";
import { tallerConfig, configProblems, workspaceById, workspaceOfOrg, type TallerConfig } from "../src/config";
import { detectUiLanguage } from "../src/i18n/language";
import { translate, MESSAGE_KEYS_ES } from "../src/i18n/messages";
import { localizeHold, localizeName, localizeToday } from "../src/domain/templateNames";
import { localizeScope } from "../src/domain/scopeNames";
import { articleFilterHelp, articleFilterLabel, assignableCountLabel, grainChoiceLabel, grainHelp, scriptureIntro, stayInChapterHelp, DISTRIBUTE_POLICY_HELP, DISTRIBUTE_POLICY_LABEL, DISTRIBUTE_UNIT_HELP, DISTRIBUTE_UNIT_LABEL, SCOPE_KEYS, ARTICLE_FILTERS, ARTICLE_FILTER_LABEL, GRAIN_LABEL } from "../src/domain/types";
import { BOOKS, bookLabel, bookName } from "../src/domain/books";
import { hadWork, hadWorkKey, markHadWork } from "../src/hadWork";
import { markOnboardingDone, onboardingDone, onboardingKey } from "../src/onboarding";
import { contextWith, initialWorkspace, loadWorkspaceId, saveWorkspaceId, suggestedWorkspace } from "../src/workspace";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const clone = (): TallerConfig => JSON.parse(JSON.stringify(tallerConfig)) as TallerConfig;
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test("la configuración que se publica no tiene problemas", () => {
  assert.deepEqual(configProblems(tallerConfig), []);
});

test("se avisa de lo que falta o está mal, en palabras claras", () => {
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

test("varios espacios pueden compartir organización si su scope los distingue", () => {
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

test("español y portugués tienen cada uno su propio espacio, con su organización y su lengua", () => {
  const es = workspaceById(tallerConfig, "es")!;
  const pt = workspaceById(tallerConfig, "pt")!;
  assert.notEqual(es.pmOrg.toLowerCase(), pt.pmOrg.toLowerCase());
  assert.notEqual(es.contentOrg.toLowerCase(), pt.contentOrg.toLowerCase());
  assert.notEqual(es.lang, pt.lang);
  assert.equal(workspaceOfOrg(tallerConfig, "PT-BR_GL")?.id, "pt", "se reconoce la organización sin importar mayúsculas");
});

test("el espacio guardado se respeta; con uno solo se elige solo; con varios y sin elegir se pregunta", () => {
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

test("el espacio fija la lengua y las organizaciones por encima de lo guardado, sin tocar lo demás", () => {
  const stale = { lang: "es-419", contentOrg: "es-419_gl", pmOrg: "BSOJ", book: "NEH", host: "https://qa.door43.org" };
  const pt = workspaceById(tallerConfig, "pt")!;
  assert.deepEqual(contextWith(stale, pt), { lang: pt.lang, contentOrg: pt.contentOrg, pmOrg: pt.pmOrg, book: "NEH", host: "https://qa.door43.org" });
});

test("la pantalla de bienvenida sugiere el equipo que habla el idioma de la persona", () => {
  assert.equal(suggestedWorkspace(tallerConfig, "pt")?.id, "pt");
  assert.equal(suggestedWorkspace(tallerConfig, "es")?.id, "es");
  assert.equal(suggestedWorkspace(tallerConfig, "fr")?.id, "es", "sin coincidencia, el primero");
});

test("el idioma de la interfaz: lo elegido antes, si no el del navegador, si no el de la configuración", () => {
  const supported = ["es", "pt"] as const;
  assert.equal(detectUiLanguage(supported, "pt", ["es-419"], "es"), "pt", "lo elegido gana");
  assert.equal(detectUiLanguage(supported, null, ["pt-BR", "en"], "es"), "pt");
  assert.equal(detectUiLanguage(supported, null, ["en-US", "pt-PT"], "es"), "pt", "se recorre la lista del navegador");
  assert.equal(detectUiLanguage(supported, null, ["fr", "en"], "es"), "es");
  assert.equal(detectUiLanguage(supported, "fr", [], "es"), "es", "un idioma guardado que ya no se soporta se ignora");
});

test("cada texto de la interfaz existe en portugués y no queda ninguno vacío", () => {
  for (const key of MESSAGE_KEYS_ES) {
    assert.ok(translate("es", key).trim(), `es: ${key}`);
    assert.ok(translate("pt", key).trim(), `pt: ${key}`);
  }
  assert.equal(translate("pt", "nav.myTasks"), "Minhas tarefas");
  assert.equal(translate("es", "nav.myTasks"), "Mis tareas");
});

test("los primeros pasos se ocultan por persona y servidor en este dispositivo, y no vuelven", () => {
  const store = memory();
  const ana = onboardingKey("https://qa.door43.org/", "Ana");
  assert.equal(ana, onboardingKey("https://qa.door43.org", "ana"), "sin barra final ni mayúsculas");
  assert.equal(onboardingDone(ana, store), false);
  markOnboardingDone(ana, store);
  assert.equal(onboardingDone(ana, store), true);
  assert.equal(onboardingDone(onboardingKey("https://qa.door43.org", "bea"), store), false, "otra persona los ve");
  assert.equal(onboardingDone(onboardingKey("https://git.door43.org", "ana"), store), false, "otro servidor, otra vez");
});

test("se recuerda si una persona ya tuvo trabajo, por servidor, organización y espacio", () => {
  const store = memory();
  const key = hadWorkKey("https://qa.door43.org/", "Ana", "ES-419_gl", "");
  assert.equal(key, hadWorkKey("https://qa.door43.org", "ana", "es-419_gl", ""), "sin barra final ni mayúsculas");
  assert.equal(hadWork(key, store), false);
  markHadWork(key, store);
  assert.equal(hadWork(key, store), true);
  assert.equal(hadWork(hadWorkKey("https://qa.door43.org", "ana", "es-419_gl", "pt:"), store), false, "otro espacio de la misma organización empieza de cero");
});

test("los nombres de fábrica de las plantillas se traducen al mostrarlos y lo editado se respeta", () => {
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

test("las razones de espera y de nivel se muestran en el idioma de la interfaz", () => {
  assert.equal(localizeHold("Espera a «Traducir TPL» de @ana y 2 más", "pt"), "Aguarda «Traduzir TPL» de @ana e mais 2");
  assert.equal(localizeHold("Espera a «Afinar TPL»", "pt"), "Aguarda «Afinar TPL»");
  assert.equal(localizeHold("Pide nivel persona habilitada", "pt"), "Exige nível pessoa habilitada");
  assert.equal(localizeHold("Pide nivel oyente", "pt"), "Exige nível ouvinte");
  assert.equal(localizeHold("Solo observas", "pt"), "Você só observa");
  assert.equal(localizeHold("Solo observas", "es"), "Solo observas", "en español no cambia");
  assert.equal(localizeHold("Algo que no se conoce", "pt"), "Algo que no se conoce");
});

test("las razones de «Equipo hoy» se muestran en el idioma de la interfaz", () => {
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

test("los 66 libros tienen nombre en portugués y el guardado sigue en español", () => {
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

test("las etiquetas y ayudas del alcance de una tarea se traducen sin dejar frases en español", () => {
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

console.log(`\nverify-config: ${passed} checks passed.`);
