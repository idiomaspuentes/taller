import { applyGroupReviewPreset, applyPairReviewPreset } from "./stepPresets";
import { makePhase } from "./phaseSlug";
import type { ScopeKey, ScopeRule, TaskStep, TaskTemplate, WaitRule, WorkflowTemplate } from "./types";

/**
 * Base template of the FCR (Flujo de Creación de Recursos) of Idiomas Puentes.
 *
 * It is data, not logic: phases, tasks, the steps of each task, who may take
 * them (level, claim policy) and what each one waits for. Another process
 * would be another template. Preparación is the app's own Preparar stage
 * (inventory), so the template starts at Traducción.
 *
 * Waiting is per chapter because the team works chapter by chapter:
 * Afinación of a resource starts when that resource's Traducción of the
 * chapter is closed, and Validación waits for all of a chapter's Armonización.
 */

export const FCR_TEMPLATE_ID = "fcr-base";

/** Solver ids of the Afinación steps (registered in `solvers.json` when each one exists). */
export const AFINACION_SOLVERS = {
  notas: "afinar-notas",
  palabras: "afinar-palabras",
  alineacion: "afinar-alineacion",
} as const;

const PH = {
  traduccion: "fcr-traduccion",
  afinacion: "fcr-afinacion",
  armonizacion: "fcr-armonizacion",
  validacion: "fcr-validacion",
} as const;

const rule = (resource: ScopeKey): ScopeRule => ({ resource, articleFilter: "pending" });
const waitTask = (taskId: string): WaitRule => ({ taskId, scope: "chapter" });
const waitPhase = (phaseId: string): WaitRule => ({ phaseId, scope: "chapter" });

/** Borrador, revisión en pares y revisión grupal (TPL / TPS). */
function scriptureSteps(solverAppId: string): TaskStep[] {
  const draft: TaskStep = { id: "borrador", name: "Borrador", solverAppId };
  const pair = applyPairReviewPreset({ id: "pares", name: "Revisión en pares", solverAppId: "fcr-pair-review" }, draft.id);
  const group = applyGroupReviewPreset({ id: "grupal", name: "Revisión grupal", solverAppId: "fcr-group-review" }, [draft.id, pair.id]);
  return [draft, pair, group];
}

/** Ayudas: traducción desde el inglés y revisión en pares, sin consultar el TPL ni el TPS. */
function helpsSteps(): TaskStep[] {
  const draft: TaskStep = { id: "borrador", name: "Borrador", solverAppId: "helps-review" };
  const pair = applyPairReviewPreset({ id: "pares", name: "Revisión en pares", solverAppId: "helps-review" }, draft.id);
  return [draft, pair];
}

/** The three steps of a Afinación (TPL or TPS): notas, palabras and alineación, each with its own crew. */
function afinacionSteps(): TaskStep[] {
  const notas: TaskStep = {
    id: "notas",
    name: "Revisar notas",
    description: "Cada nota del capítulo: marca las palabras del borrador y responde.",
    solverAppId: AFINACION_SOLVERS.notas,
    claimMode: "pool",
    minAssignees: 3,
    maxAssignees: 6,
    minIndependent: 2,
  };
  const palabras: TaskStep = {
    id: "palabras",
    name: "Revisar palabras clave",
    description: "Cada término: compara cómo se tradujo en todo el libro.",
    solverAppId: AFINACION_SOLVERS.palabras,
    claimMode: "pool",
    minAssignees: 3,
    maxAssignees: 6,
    minIndependent: 2,
  };
  const alinear: TaskStep = {
    id: "alinear",
    name: "Alinear",
    description: "Una persona une el borrador con el original, versículo por versículo.",
    solverAppId: AFINACION_SOLVERS.alineacion,
    claimMode: "exclusive",
    excludeIssueAssignee: true,
  };
  const revisarAlineacion: TaskStep = {
    id: "revisar-alineacion",
    name: "Revisar la alineación",
    description: "Otras personas revisan lo alineado y responden por versículo.",
    solverAppId: AFINACION_SOLVERS.alineacion,
    claimMode: "pool",
    minAssignees: 2,
    maxAssignees: 4,
    minIndependent: 2,
    excludePriorStepIds: [alinear.id],
    excludeIssueAssignee: true,
  };
  return [notas, palabras, alinear, revisarAlineacion];
}

/** Armonización / cierre: one independent habilitada closes each resource. */
function closeSteps(): TaskStep[] {
  const ajuste: TaskStep = { id: "ajuste", name: "Ajustar a los textos afinados", solverAppId: "helps-review" };
  const cierre: TaskStep = {
    id: "cierre",
    name: "Cierre independiente",
    description: "Lo cierra una persona habilitada que no lo tradujo ni lo editó.",
    claimMode: "exclusive",
    excludePriorStepIds: [ajuste.id],
    excludeIssueAssignee: true,
  };
  return [ajuste, cierre];
}

export function fcrWorkflowTemplate(): WorkflowTemplate {
  const phases = [
    makePhase({ id: PH.traduccion, name: "Traducción", slug: "traduccion", order: 0 }),
    makePhase({ id: PH.afinacion, name: "Afinación", slug: "afinacion", order: 1 }),
    makePhase({ id: PH.armonizacion, name: "Armonización", slug: "armonizacion", order: 2 }),
    makePhase({ id: PH.validacion, name: "Validación", slug: "validacion", order: 3 }),
  ];

  const tasks: TaskTemplate[] = [
    // Traducción — TPL y TPS, y las cuatro Ayudas (sin depender del TPL ni del TPS).
    { id: "tpl", name: "Traducir TPL", phaseId: PH.traduccion, rules: [rule("tpl")], solverAppId: "tpl-translate", steps: scriptureSteps("tpl-translate"), minLevel: "practicante" },
    { id: "tps", name: "Traducir TPS", phaseId: PH.traduccion, rules: [rule("tps")], solverAppId: "tps-translate", steps: scriptureSteps("tps-translate"), minLevel: "practicante" },
    { id: "notas-ayuda", name: "Traducir Notas", phaseId: PH.traduccion, rules: [rule("notas")], solverAppId: "helps-review", steps: helpsSteps(), minLevel: "practicante" },
    { id: "preguntas-ayuda", name: "Traducir Preguntas", phaseId: PH.traduccion, rules: [rule("preguntas")], solverAppId: "helps-review", steps: helpsSteps(), minLevel: "practicante" },
    { id: "palabras-ayuda", name: "Traducir Palabras", phaseId: PH.traduccion, rules: [rule("palabras")], solverAppId: "helps-review", steps: helpsSteps(), minLevel: "practicante" },
    { id: "academia-ayuda", name: "Traducir Academia", phaseId: PH.traduccion, rules: [rule("academia")], solverAppId: "helps-review", steps: helpsSteps(), minLevel: "practicante" },

    // Afinación — una por recurso; cada una espera solo a su propia Traducción del capítulo.
    { id: "afinar-tpl", name: "Afinar TPL", phaseId: PH.afinacion, rules: [rule("tpl")], steps: afinacionSteps(), waitsFor: [waitTask("tpl")], minLevel: "aprendiz" },
    { id: "afinar-tps", name: "Afinar TPS", phaseId: PH.afinacion, rules: [rule("tps")], steps: afinacionSteps(), waitsFor: [waitTask("tps")], minLevel: "aprendiz" },

    // Armonización — ajusta cada recurso a los textos afinados; Palabras tiene su propia pista.
    ...(["notas", "preguntas", "academia", "palabras"] as const).map<TaskTemplate>((resource) => ({
      id: `armonizar-${resource}`,
      name: `Armonizar ${resource.charAt(0).toUpperCase()}${resource.slice(1)}`,
      phaseId: PH.armonizacion,
      rules: [rule(resource)],
      steps: closeSteps(),
      waitsFor: [waitTask(`${resource}-ayuda`), waitPhase(PH.afinacion)],
      minLevel: "habilitada",
    })),

    // Validación — el comité pastoral decide con toda la Armonización del capítulo cerrada.
    {
      id: "validar",
      name: "Validar",
      phaseId: PH.validacion,
      rules: [rule("tpl"), rule("tps")],
      steps: [
        {
          id: "decision",
          name: "Decisión pastoral",
          description: "Fidelidad, claridad y utilidad. Deciden al menos dos pastores habilitados.",
          claimMode: "pool",
          minAssignees: 2,
          maxAssignees: 4,
          minIndependent: 2,
        },
      ],
      waitsFor: [waitPhase(PH.armonizacion)],
      minLevel: "habilitada",
    },
  ];

  return {
    id: FCR_TEMPLATE_ID,
    name: "FCR: Flujo de Creación de Recursos",
    description: "Traducción, Afinación, Armonización y Validación, capítulo por capítulo.",
    phases,
    tasks,
    releaseProfiles: [{ id: "version-validada", name: "Versión validada", requiredPhaseIds: [PH.validacion] }],
  };
}
