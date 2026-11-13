/** The messages of a tuning task gathered by the point they are about, read from the conversation of EZR 4:11–13. */
import assert from "node:assert/strict";
import { groupTopics, isAgreement, topicOf } from "../src/domain/conversationTopics";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("el tema de un mensaje se lee de su cabeza, como se escribe ahora y como se escribía", () => {
  assert.deepEqual(topicOf("Nota «Marcas de cita», en «Esto es lo que escribieron»\n\nEsta nota no corresponde.\n\n@AnerG @Keneramk"), {
    title: "Marcas de cita",
    phrase: "Esto es lo que escribieron",
    body: "Esta nota no corresponde.",
  });
  assert.deepEqual(topicOf("Nota «Doblete»\n\nPropongo cambiar el versículo."), { title: "Doblete", body: "Propongo cambiar el versículo." });
  assert.deepEqual(topicOf("Em «la carta»\n\nConcordo."), { phrase: "la carta", body: "Concordo." });
  assert.deepEqual(
    topicOf("@anerg @keneramk Quote Markings · «Esto es lo que escribieron en la carta que le enviaron». Tengo una observación: Esta nota no corresponde."),
    { title: "Quote Markings", phrase: "Esto es lo que escribieron en la carta que le enviaron", body: "Esta nota no corresponde." },
    "la observación no dice «Tengo una observación»",
  );
  assert.equal(topicOf("@AnerG Doblete · «ellos dejarán de pagar». Propongo un cambio: Propuesta en la tarea #1474: «…»")!.body, "Propongo un cambio: Propuesta en la tarea #1474: «…»", "una propuesta se dice como tal");
  assert.equal(topicOf("Corregí el versículo: «a» → «b». Vuelvan a revisarlo."), null, "lo que no tiene cabeza no es un tema");
  assert.equal(topicOf("Estoy totalmente de acuerdo con ustedes"), null);
});

test("un acuerdo se reconoce para decirlo en una línea; lo que dice algo más, no", () => {
  for (const said of ["Estoy de acuerdo con @miguelcordero.", "De acuerdo con @miguelcordero.", "De acuerdo con ustedes", "Estou de acordo com @ana."]) assert.ok(isAgreement(said), said);
  assert.ok(!isAgreement("De acuerdo con @ana, pero falta la coma."));
  assert.ok(!isAgreement("Esta nota no corresponde."));
});

// EZR 4:11–13 as the team wrote it, from 22 October to 10 November.
const msg = (key: string, text: string, kind = "humano") => ({ key, text, kind });
const thread = [
  msg("m1", "**EZR 4:11** — @anerg @keneramk Quote Markings · «Esto es lo que escribieron en la carta que le enviaron». Tengo una observación: Esta nota no corresponde ya que hay un contenido de carta en los versículos previos."),
  msg("a1", "**EZR 4:11** — @miguelcordero @keneramk Quote Markings · «Esto es lo que escribieron en la carta que le enviaron». Tengo una observación: De acuerdo con @miguelcordero."),
  msg("k0", "Estoy totalmente e acuerdo con ustedes"),
  msg("k1", "**EZR 4:11** — @miguelcordero @AnerG @anerg Quote Markings · «Esto es lo que escribieron en la carta que le enviaron». Tengo una observación: De acuerdo con ustedes"),
  msg("k2", "**EZR 4:11** — @miguelcordero @AnerG @anerg Primera, Segunda o Tercera Persona · «Viene de los funcionarios a su servicio». Tengo una observación: En el ULT en inglés falta sombrear la provincia"),
  msg("k3", "**EZR 4:12** — @miguelcordero @AnerG @anerg Metonimia · «la ciudad de … son malvadas». Tengo una observación: quizás podemos poner: serán en vez de serían."),
  msg("k4", "Se abrió una decisión del equipo sobre EZR 4:13: #1474."),
  msg("k5", "**EZR 4:13** — @AnerG @anerg Doblete · «ellos dejarán de pagar todo tipo de impuestos». Propongo un cambio: Propuesta en la tarea #1474: «…»"),
  msg("a2", "**EZR 4:11** — @miguelcordero @Keneramk @keneramk Primera, Segunda o Tercera Persona · «Viene de los funcionarios a su servicio». Tengo una observación: De acuerdo con @Keneramk."),
  msg("b1", "**EZR 4:13** — Se aceptó la propuesta de @Keneramk: el texto de EZR 4:13 ya está cambiado. Lo confirmó @bismarck por el equipo. Se decidió en #1474."),
];

test("cada punto en una tarjeta, donde está su último mensaje; lo demás en su lugar", () => {
  const rows = groupTopics(thread);
  const shape = rows.map((row) => (row.kind === "item" ? row.item.key : `${row.ref} ${row.title}: ${row.entries.map((e) => e.item.key).join(",")}`));
  assert.deepEqual(shape, [
    "k0",
    "4:11 Quote Markings: m1,a1,k1",
    "4:12 Metonimia: k3",
    "k4",
    "4:11 Primera, Segunda o Tercera Persona: k2,a2",
    "4:13 Doblete: k5,b1",
  ]);
  const marks = rows.find((row) => row.kind === "topic" && row.title === "Quote Markings");
  assert.ok(marks && marks.kind === "topic");
  assert.deepEqual(marks.entries.map((e) => e.agree), [false, true, true], "dos acuerdos con lo dicho");
  assert.equal(marks.phrase, "Esto es lo que escribieron en la carta que le enviaron");
});

test("una conversación sin mensajes de la herramienta queda tal cual", () => {
  const plain = [msg("x", "Hola"), msg("y", "**EZR 4:1** — Corregí el versículo: «a» → «b»."), msg("z", "votó", "sistema")];
  assert.deepEqual(groupTopics(plain).map((row) => row.kind === "item" && row.item.key), ["x", "y", "z"]);
});

test("la cabeza de antes solo se lee en mensajes de antes del 13 de noviembre: después, una frase cualquiera no es una nota", () => {
  const said = "Gracias. Propongo un cambio: mejor «carta»";
  assert.equal(topicOf(said, "2026-11-14T10:00:00Z"), null, "«Gracias» no es el nombre de una nota");
  assert.equal(topicOf(said, "2026-11-10T10:00:00Z")?.title, "Gracias", "antes, la herramienta escribía así");
  assert.equal(topicOf("Nota «Doblete»\n\nDe acuerdo.", "2026-11-14T10:00:00Z")?.title, "Doblete", "la cabeza de ahora se lee siempre");
});

console.log(`\nverify-conversation-topics: ${passed} checks passed.`);
