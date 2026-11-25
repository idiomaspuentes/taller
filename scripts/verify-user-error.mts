/**
 * What a person reads when Door43 refuses something: its own words for the common refusals, never the raw request.
 *
 *   npm run verify:user-error
 */
import assert from "node:assert/strict";
import { DcsApiError } from "@ip-lms/dcs-client";
import { explainError } from "../src/dcs/userError";
import { explainRepoFileError } from "../src/dcs/repoFile";

const raw = "DCS request failed: GET /repos/issues/search -> 403";
let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ok  ${name}`);
}

check("an account that is not activated is told to activate it", () => {
  const said = explainError(new DcsApiError(raw, 403, { message: "This account is not activated." }));
  assert.match(said, /no está activada/);
  assert.doesNotMatch(said, /DCS request failed/);
});
check("another refusal speaks of permissions, not of the request", () => {
  const said = explainError(new DcsApiError(raw, 403, { message: "forbidden" }));
  assert.match(said, /permisos/);
  assert.doesNotMatch(said, /GET/);
});
check("a server failure asks to try again later", () => {
  assert.match(explainError(new DcsApiError("DCS request failed: GET /x -> 502", 502)), /unos minutos/);
});
check("no answer at all speaks of the connection", () => {
  assert.match(explainError(new TypeError("Failed to fetch")), /conexión/);
});
check("an expired session keeps its own sentence", () => {
  assert.match(explainError(new DcsApiError("DCS request failed: GET /user -> 401", 401)), /sesión/);
});
check("a message already written for people is left alone", () => {
  assert.equal(explainError(new Error("El equipo no tiene todos los repos de esta tarea.")), "El equipo no tiene todos los repos de esta tarea.");
});
check("a draft that changed in Door43 says what to do, with no branch, repository nor code", () => {
  // Fase 1, C8: Notas saved after the draft's branch was deleted showed the branch next to «Todo guardado».
  const refused = new DcsApiError("DCS request failed: PUT /repos/es-419_gl/es-419_tn/contents/tn_EST.tsv -> 422", 422, { message: "sha does not match" });
  const said = explainError(new Error(explainRepoFileError(refused, { owner: "es-419_gl", repo: "es-419_tn", filepath: "tn_EST.tsv", branch: "trabajo/est/notas-ayuda/ana/5" })));
  assert.match(said, /vuelva a entrar/);
  assert.doesNotMatch(said, /trabajo\/|es-419|tn_EST|HTTP|sha|Detalle/);
  assert.doesNotMatch(said, /abriste|escribiste|\bsal\b|vuelve/, "trata de usted");
});
console.log(`\nverify-user-error: ${passed} checks passed.`);
