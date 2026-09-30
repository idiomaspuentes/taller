/** The source package of a project: default, custom, and what is kept when saved. */
import assert from "node:assert/strict";
import { DEFAULT_SOURCE_PACKAGE, normalizeSourcePackage, resolveSourcePackage, sourcePackageFor, sourcePackageLang } from "../src/domain/sourcePackage";
import { normalizeAssignmentsDoc } from "../src/domain/store";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("sin ajuste se usa el paquete en inglés de unfoldingWord", () => {
  assert.deepEqual(resolveSourcePackage(undefined), DEFAULT_SOURCE_PACKAGE);
  assert.equal(sourcePackageLang(DEFAULT_SOURCE_PACKAGE), "en");
});

test("una organización e idioma dan todos los recursos de ese paquete", () => {
  const pkg = sourcePackageFor("es-419_gl", "es-419");
  assert.deepEqual([pkg.owner, pkg.tn, pkg.twl, pkg.ult, pkg.ust], ["es-419_gl", "es-419_tn", "es-419_twl", "es-419_ult", "es-419_ust"]);
  assert.equal(sourcePackageLang(pkg), "es-419");
});

test("el paquete por defecto no se guarda y uno propio sí, rellenando lo que falte", () => {
  assert.equal(normalizeSourcePackage(DEFAULT_SOURCE_PACKAGE), undefined);
  assert.equal(normalizeSourcePackage(null), undefined);
  const pkg = normalizeSourcePackage({ owner: "miOrg", tn: "xx_tn" });
  assert.equal(pkg?.owner, "miOrg");
  assert.equal(pkg?.tn, "xx_tn");
  assert.equal(pkg?.ult, DEFAULT_SOURCE_PACKAGE.ult);
});

test("un nombre con caracteres raros se descarta", () => {
  assert.equal(normalizeSourcePackage({ owner: "a/b", tn: "../x" }), undefined);
});

test("el paquete del proyecto sobrevive a guardar y leer el plan", () => {
  const doc = normalizeAssignmentsDoc(
    { projectId: "NEH", book: "NEH", settings: { sourcePackage: sourcePackageFor("otraOrg", "fr") } },
    { book: "NEH", lang: "es-419", contentOrg: "es-419_gl", pmOrg: "BSOJ" },
  );
  assert.equal(doc.settings?.sourcePackage?.owner, "otraOrg");
  assert.equal(doc.settings?.sourcePackage?.ult, "fr_ult");
});

console.log(`\nverify-source-package: ${passed} checks passed.`);
