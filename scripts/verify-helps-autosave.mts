/**
 * The helps editor saves by itself on the person's own draft, a moment after the last key, and never on the team's
 * draft. After a failure it waits for another key, the connection or «Reintentar»: it does not knock on Door43 every
 * few seconds.
 *
 *   npm run verify:helps-autosave
 */
import assert from "node:assert/strict";
import { AUTOSAVE_DELAY_MS, autosaveDue, type AutosaveState } from "../src/domain/helpsAutosave";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** Ana typed a note on her own draft, and nothing else is going on. */
const typed: AutosaveState = {
  shared: false,
  hasSession: true,
  dirty: true,
  saving: false,
  finishing: false,
  openingPr: false,
  busy: false,
  hasItems: true,
  confirming: false,
  blocked: false,
  failedSinceEdit: false,
};

test("se guarda solo con algo por guardar en el borrador propio", () => {
  assert.equal(autosaveDue(typed), true);
  assert.equal(AUTOSAVE_DELAY_MS, 3500, "como el editor del texto");
  assert.equal(autosaveDue({ ...typed, dirty: false }), false, "sin nada por guardar, nada");
  assert.equal(autosaveDue({ ...typed, hasItems: false }), false, "sin ayudas en pantalla, nada");
});

test("el borrador del equipo nunca se guarda solo", () => {
  assert.equal(autosaveDue({ ...typed, shared: true }), false);
});

test("sin sesión, guardando, terminando, abriendo la revisión, con la pregunta de entregar abierta o bloqueado, no", () => {
  const not: Partial<AutosaveState>[] = [
    { hasSession: false },
    { saving: true },
    { finishing: true },
    { openingPr: true },
    { busy: true },
    { confirming: true },
    { blocked: true },
  ];
  for (const over of not) assert.equal(autosaveDue({ ...typed, ...over }), false, JSON.stringify(over));
});

test("tras un fallo no se reintenta hasta otra tecla o hasta que vuelva la red", () => {
  assert.equal(autosaveDue({ ...typed, failedSinceEdit: true }), false);
});

console.log(`\nverify-helps-autosave: ${passed} checks passed.`);
