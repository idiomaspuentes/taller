/**
 * The photos of the people: where each is kept, how a picture is cut, who may put one, and that the repository they
 * are kept in is never the public one of the plan.
 */
import assert from "node:assert/strict";
import { canSetPhoto, centeredSquare, loginOfPhotoFile, photoPath } from "../src/domain/photos";
import { configProblems, tallerConfig } from "../src/config";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("cada persona tiene un archivo por su usuario, sin mayúsculas, y del nombre del archivo se sabe de quién es", () => {
  assert.equal(photoPath(" Keneramk "), "avatares/keneramk.jpg");
  assert.equal(loginOfPhotoFile("keneramk.jpg"), "keneramk");
  assert.equal(loginOfPhotoFile("Ana.JPG"), "ana");
  assert.equal(loginOfPhotoFile("README.md"), undefined);
});

test("una foto se recorta al cuadrado de su centro, tan ancho como su lado más corto", () => {
  assert.deepEqual(centeredSquare(4000, 3000), { x: 500, y: 0, side: 3000 });
  assert.deepEqual(centeredSquare(1080, 1920), { x: 0, y: 420, side: 1080 });
  assert.deepEqual(centeredSquare(256, 256), { x: 0, y: 0, side: 256 });
});

test("pone la foto quien gestiona, para cualquiera; quien coordina, para la gente de su equipo; nadie más", () => {
  const levelBook = { coordinators: { "pm-afinadores-tps": ["keneramk"] } };
  assert.equal(canSetPhoto({ me: "abelper8", canManage: true, levelBook, teamsOfPerson: ["pm-armonizadores"] }), true);
  assert.equal(canSetPhoto({ me: "Keneramk", canManage: false, levelBook, teamsOfPerson: ["pm-afinadores-tps"] }), true);
  assert.equal(canSetPhoto({ me: "keneramk", canManage: false, levelBook, teamsOfPerson: ["pm-armonizadores"] }), false, "de otro equipo, no");
  assert.equal(canSetPhoto({ me: "ana", canManage: false, levelBook, teamsOfPerson: ["pm-afinadores-tps"] }), false, "un miembro, no");
});

test("las fotos van en su propio repositorio, nunca en el del plan, que es público", () => {
  assert.ok(tallerConfig.photoRepo, "la configuración nombra un repositorio de fotos");
  assert.notEqual(tallerConfig.photoRepo!.toLowerCase(), tallerConfig.pmRepo.toLowerCase());
  assert.ok(configProblems({ ...tallerConfig, photoRepo: tallerConfig.pmRepo }).some((p) => p.includes("photoRepo")));
  assert.ok(configProblems({ ...tallerConfig, photoRepo: "con espacio" }).some((p) => p.includes("photoRepo")));
});

console.log(`\nverify-photos: ${passed} checks passed.`);
