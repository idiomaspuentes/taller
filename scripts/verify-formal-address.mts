/** The helps speak to the translator as «usted»: what says «tú» is found while it is written, and how it would read. */
import assert from "node:assert/strict";
import { informalGroups, informalWords, toFormal } from "../src/domain/formalAddress";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}
const words = (text: string) => informalWords(text, "usted").map((f) => `${f.word}→${f.formal}`);
const fixed = (text: string) => toFormal(text, informalWords(text, "usted"));

test("las notas de Ester que trataban de «tú» se leen de «usted»", () => {
  assert.equal(fixed("Puedes traducir los sustantivos abstractos **esplendor** y **belleza**."), "Puede traducir los sustantivos abstractos **esplendor** y **belleza**.");
  assert.equal(fixed("Si fuera útil en tu idioma, podrías decir esto explícitamente."), "Si fuera útil en su idioma, podría decir esto explícitamente.");
  assert.equal(fixed("No necesitas repetir ambas frases en tu traducción si esto pudiera causar confusión a tus lectores."), "No necesita repetir ambas frases en su traducción si esto pudiera causar confusión a sus lectores.");
  assert.equal(fixed("Aparece varias veces en la historia. Asegúrate de traducirlo con coherencia."), "Aparece varias veces en la historia. Asegúrese de traducirlo con coherencia.");
  assert.equal(fixed("Revisa cómo tradujiste esta expresión en [Ester 5:3](../05/03.md)."), "Revise cómo tradujo esta expresión en [Ester 5:3](../05/03.md).");
  assert.equal(fixed("Repasa las explicaciones si te resultan útiles."), "Repase las explicaciones si le resultan útiles.");
});

test("lo que está entre comillas lo dice otro, y se queda como está", () => {
  assert.deepEqual(words('Traducción alternativa: "Él puede desterrarla, como hiciste tú con Vasti".'), []);
  assert.deepEqual(words("Traducción alternativa: «¿Por qué no te inclinas?»."), []);
  assert.deepEqual(words("Traducción alternativa: “tus sirvientes”."), []);
  // A quote typed with straight marks opens after a space and closes after a word, also twice in one note.
  assert.deepEqual(words('Podrías decir "sirvientes" o "tus sirvientes". Asegúrate de expresarlo.'), ["Podrías→Podría", "Asegúrate→Asegúrese"]);
});

test("lo que está en negritas son palabras del texto, y un enlace es una dirección", () => {
  assert.deepEqual(words("Aquí, **tu rostro** se refiere a la presencia del rey."), []);
  assert.deepEqual(words("Vea [tu nota](rc://*/tn/help/est/01/01) y [[rc://*/ta/man/translate/figs-you]]."), []);
});

test("«revisa», «usa», «decide» tutean solo al empezar la frase: dichos de otro, son la tercera persona", () => {
  assert.deepEqual(words("El rey Asuero usa la repetición para enfatizar. Si su idioma no utiliza la forma pasiva, puede cambiarla."), []);
  assert.deepEqual(words("Utiliza la forma que tiene tu lengua de presentar a un nuevo personaje."), ["Utiliza→Utilice", "tu→su"]);
  assert.deepEqual(words("* Decide una forma coherente de traducir estos nombres."), ["Decide→Decida"]);
});

test("lo que ya dice «usted» no se toca", () => {
  const formal = "Si fuera útil en su idioma, puede decir esto explícitamente. Asegúrese de que esto quede claro en su traducción.";
  assert.deepEqual(words(formal), []);
  assert.equal(fixed(fixed("Si fuera útil en tu idioma, podrías decirlo.")), "Si fuera útil en su idioma, podría decirlo.", "corregirlo dos veces es lo mismo que una");
});

test("la misma palabra se lista una sola vez, y se cambia donde aparezca", () => {
  const text = "Puedes decir esto con una forma activa, y puedes decir quién hizo la acción. Podrías decir: «Entonces»";
  const found = informalWords(text, "usted");
  assert.deepEqual(informalGroups(found).map((g) => `${g.word}→${g.formal} ×${g.count}`), ["Puedes→Puede ×2", "Podrías→Podría ×1"]);
  assert.equal(toFormal(text, found), "Puede decir esto con una forma activa, y puede decir quién hizo la acción. Podría decir: «Entonces»");
});

test("una frase que empieza como orden pero habla de un personaje no recibe aviso", () => {
  // Esther 6:6: the king's question is described, not something the translator is told to do.
  assert.deepEqual(words("El rey quería tratar de averiguar la respuesta. Utiliza una forma interrogativa para enfatizar lo cierta que cree que es la afirmación."), []);
  // The same word telling the translator, once the rest of the note already says «usted».
  assert.deepEqual(words("Utilice su idioma. Utiliza la forma que tiene su lengua de presentar a un nuevo personaje."), ["Utiliza→Utilice"]);
  assert.deepEqual(words("Revisa cómo tradujo esta expresión en 5:3."), ["Revisa→Revise"]);
});

test("un equipo sin regla de trato no recibe avisos", () => {
  assert.deepEqual(informalWords("Puedes traducir esto.", undefined), []);
});

console.log(`\nverify-formal-address: ${passed} checks passed.`);
