/**
 * The editor of the text (TPL, TPS) saves by itself a moment after the last key. After a failure it waits for
 * another key, the connection or «Guardar»: it does not knock on Door43 every few seconds (#89).
 *
 *   npm run verify:text-autosave
 */
import assert from "node:assert/strict";
import { AUTOSAVE_DELAY_MS, failedWithNothingTyped, textAutosaveDue, type TextAutosaveState } from "../src/domain/textAutosave";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** Ana typed a verse, and nothing else is going on. */
const typed: TextAutosaveState = {
  hasSession: true,
  dirty: true,
  saving: false,
  recreating: false,
  openingPr: false,
  finishing: false,
  hasDrafts: true,
  blocked: false,
  failedSinceEdit: false,
};

test("se guarda solo con algo por guardar, 3,5 s después de la última tecla", () => {
  assert.equal(textAutosaveDue(typed), true);
  assert.equal(AUTOSAVE_DELAY_MS, 3500);
  assert.equal(textAutosaveDue({ ...typed, dirty: false }), false, "sin nada por guardar, nada");
  assert.equal(textAutosaveDue({ ...typed, hasDrafts: false }), false, "sin versículos, nada");
});

test("sin sesión, guardando, rehaciendo, abriendo la revisión, terminando o bloqueado, no", () => {
  const not: Partial<TextAutosaveState>[] = [
    { hasSession: false },
    { saving: true },
    { recreating: true },
    { openingPr: true },
    { finishing: true },
    { blocked: true },
  ];
  for (const over of not) assert.equal(textAutosaveDue({ ...typed, ...over }), false, JSON.stringify(over));
});

test("tras un fallo no se intenta de nuevo solo (#89): espera otra tecla, la conexión o «Guardar»", () => {
  assert.equal(textAutosaveDue({ ...typed, failedSinceEdit: true }), false);
});

test("un guardado fallido sin teclas desde que empezó deja de intentar; con una tecla en medio, no", () => {
  assert.equal(failedWithNothingTyped({ ok: false, hasSession: true, editsAtStart: 4, editsNow: 4 }), true);
  assert.equal(failedWithNothingTyped({ ok: false, hasSession: true, editsAtStart: 4, editsNow: 5 }), false, "la tecla en medio vuelve a intentar sola");
  assert.equal(failedWithNothingTyped({ ok: true, hasSession: true, editsAtStart: 4, editsNow: 4 }), false, "un guardado que llegó no es un fallo");
  assert.equal(failedWithNothingTyped({ ok: false, hasSession: false, editsAtStart: 4, editsNow: 4 }), false, "sin sesión no hay a dónde guardar: no es un fallo");
});

console.log(`verify-text-autosave: ${passed} ok`);
