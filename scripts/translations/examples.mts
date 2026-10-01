/**
 * Sentences with variable parts (names, numbers, references). Their Portuguese is written in code (regular
 * expressions in src/domain/*Names.ts), so they cannot be edited from the review tool: they are listed with
 * their current translation so the reviewer can comment, and the changes are applied by hand.
 */
import { localizeThread } from "../../src/domain/threadNames";
import { localizeScope } from "../../src/domain/scopeNames";
import { OPTION_LABEL } from "../../src/domain/alignmentDecision";
import { decidedConflictSentence, verseConflictOptionLabels, verseConflictPanels, verseConflictTitle, type VerseConflictData } from "../../src/domain/verseConflictEvent";
import { assignableCountLabel, articleFilterHelp } from "../../src/domain/types";
import { BootstrapError, explainRepoFileError } from "../../src/dcs/repoFile";
import { DcsApiError } from "@ip-lms/dcs-client";

export type Example = { es: string; pt: string };

const both = (es: string): Example => {
  const viaThread = localizeThread(es, "pt");
  return { es, pt: viaThread !== es ? viaThread : localizeScope(es, "pt") };
};

export function buildExamples(): Example[] {
  const out: string[] = [];
  const base: VerseConflictData = {
    pr: { owner: "org", repo: "repo", number: 1 }, bookRef: "NEH", book: "NEH", usfmPath: "x",
    range: { chapter: 1, from: 2, to: 3, kind: "texto", kept: "ultimo" },
    conflictIssue: 10, closer: "ana", otherIssue: 11, otherLogin: "bea", side: "entrante", texts: { entrante: "a", tronco: "b" },
  };
  for (const side of ["entrante", "desplazado"] as const) {
    for (const kept of ["ultimo", "tronco"] as const) {
      const data = { ...base, side, range: { ...base.range, kept } };
      out.push(verseConflictTitle(data), decidedConflictSentence(data), ...Object.values(verseConflictOptionLabels(data)));
      for (const p of verseConflictPanels(data)) out.push(p.label);
    }
  }
  out.push(
    "Propuesta de @ana para NEH 1:2", "Propuesta de @ana para cambiar el texto de NEH 1:2", "Objeción de @ana en NEH 1:2",
    ...Object.values(OPTION_LABEL).map((l) => `@bea votó: ${l}`),
    "Hay consenso: Aceptar la propuesta (@ana, @bea). @ana: falta que una persona lo confirme para cerrar la decisión.",
    "Decidido por el equipo; @ana confirmó el consenso. Se aceptó la propuesta y la alineación quedó cambiada.",
    "Decidido por @ana, quien coordina. La objeción no prospera; la alineación se mantiene.",
    "Hay consenso en «Aceptar la propuesta». Aceptar la propuesta: @ana, @bea. Rechazar la propuesta: nadie. ¿Confirmas que el equipo está de acuerdo y se cierra?",
    "Pasó el plazo sin consenso. Vas a decidir aceptar en nombre del equipo.", "Decidir yo: aceptar",
    "Resuelto por @ana: quedó la versión de @bea", "Versículos 1:2 guardados en el borrador grupal", "Aprobado: Revisión grupal",
    "Añade integrantes a Traducir TPL antes de autoasignar.",
    "No queda trabajo sin asignar en el alcance de Traducir TPL.",
    "Autoasignados 1 lote de Traducir TPL entre 3 personas (por porción).",
    "Autoasignados 6 porciones/bloques (12 ítems) de Traducir TPL entre 3 personas (por capítulo entero).",
    assignableCountLabel("notas", "item", 1), assignableCountLabel("notas", "item", 5), assignableCountLabel("tpl", "portion", 12),
    articleFilterHelp("academia", "pending"), articleFilterHelp("palabras", "all", "item"),
    "Cerrada hoy", "Cerrada hace 3 días", "Se decide antes de mañana", "Se decide antes de 2 días", "El plazo vence hoy",
    "El plazo venció hace 1 día: decide quien coordina", "Nadie la ha tomado en 4 días", "Sin movimiento hace 6 días",
    "Último movimiento hoy", "Espera a «Traducir TPL» de @ana y 2 más", "Pide nivel persona habilitada",
  );
  const ctx = { owner: "pt-br_gl", repo: "pt-br_glt", filepath: "16-NEH.usfm", branch: "w/neh/1" };
  for (const step of ["repo", "default-branch", "book-branch", "file-create", "task-branch", "pr-close"] as const) {
    out.push(explainRepoFileError(new BootstrapError("(detalle que envía Door43)", step, 404), ctx));
  }
  for (const status of [403, 404, 409, 500]) out.push(explainRepoFileError(new DcsApiError("x", status, { message: "(mensaje de Door43)" }), ctx));
  return [...new Set(out)].map(both);
}
