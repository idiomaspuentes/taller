/** taller.config.ts: it must be usable, spaces must not share an organization, and the language and space logic. */
import assert from "node:assert/strict";
import { tallerConfig, configProblems, workspaceById, workspaceOfOrg, type TallerConfig } from "../src/config";
import { detectUiLanguage } from "../src/i18n/language";
import { translate, MESSAGE_KEYS_ES } from "../src/i18n/messages";
import { appTitle } from "../src/brand";
import { buildManifest } from "../src/manifest";
import { displayName, initialsOf, levelName, memberSince, publicProfileUrl, safeLink, settingsUrl } from "../src/domain/profile";
import { parseServerParam, readServerFromUrl, serverChoiceVisible } from "../src/serverChoice";
import { localizeHold, localizeName } from "../src/domain/templateNames";
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
  assert.equal(localizeHold("Pide nivel oyente", "pt"), "Exige nível ouvinte");
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
  assert.equal(levelName("oyente", "es"), "Oyente");
  assert.equal(safeLink("https://example.org/a"), "https://example.org/a");
  assert.equal(safeLink("example.org"), "https://example.org/", "sin protocolo se asume https");
  assert.equal(safeLink("javascript:alert(1)"), "", "nunca un enlace que ejecute código");
  assert.equal(safeLink(""), "");
});

console.log(`\nverify-config: ${passed} checks passed.`);
