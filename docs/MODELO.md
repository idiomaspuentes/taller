# Modelo de dominio — TAS (Translation Assistance System)

Vocabulario de producto (español) y forma en código. Sustituye la idea de
“equipo de PM” por una jerarquía clara.

## Jerarquía

```text
Plantilla de flujo (org)     → WorkflowTemplate (reutilizable)
  └── Fase                   → etapa del flujo
        └── Tarea plantilla  → reglas + checklist + solvers

Proyecto                     → projectId (libro NEH o slug temático)
  └── (snapshot) Fases/Tareas ← aplica plantilla
        └── Equipo           → equipo de org DCS (pm-…), reutilizable
              └── Subtarea   → issue / lote (+ progreso de checklist)
```

| Producto | Código | Qué es | Reutilizable |
|----------|--------|--------|--------------|
| **Plantilla de flujo** | `WorkflowTemplate` | Fases + tareas + checklists + solvers | **Sí** — `{pmOrg}/gateway-tasks/workflows.json` |
| **Proyecto** | `Project` / `projectId` | Contenedor: id, título, `kind`, `books[]` | El id es único en la org PM |
| **Fase / Tarea** | `Phase` / `ProjectTask` | Copia en el proyecto tras **Aplicar plantilla** | Snapshot; no se edita la plantilla al vuelo |
| **Paso** | `TaskStep` | Ítem de checklist de la tarea | Viene en la plantilla / snapshot |
| **Equipo** | `DcsTeam` | Personas + acceso a repos | **Sí** entre proyectos |
| **Subtarea** | issue + `WorkOrder` | Lote contiguo | No |

> Inventarios siguen por libro UBS: `{lang}/NEH/inventory.json`. Un proyecto
> temático *referencia* `books[]`; no duplica inventarios bajo su slug.

## Reglas

1. Un **equipo** es solo un conjunto de personas con acceso a ciertos repos de la org.
2. Una **tarea** se asigna a **un** equipo de org (opcional hasta publicar).
3. Solo se puede asignar un equipo que ya tenga acceso a **todos** los repos que la tarea necesita.
4. El mismo equipo puede usarse en varios proyectos.
5. Varias tareas pueden compartir la misma **fase**.
6. Las **subtareas** son la fuente de verdad de persona y estado; el checklist
   de pasos (y asientos/aprobaciones) se guarda en el cuerpo del issue
   (`gateway-task-progress-2`).
7. El **alcance bíblico** de una tarea es `ScriptureScope` (en el snapshot del
   proyecto; al aplicar plantilla suele ser `{ mode: "project" }`).
8. Las plantillas se **aplican como copia** (`workflowId` + `workflowAppliedAt`
   en `assignments.json`). Editar la plantilla no reescribe proyectos ya aplicados.

## Relación con el JSON

### Org — `workflows.json` (`gateway-workflows-1`)

```json
{
  "schema": "gateway-workflows-1",
  "workflows": [
    {
      "id": "…",
      "name": "Flujo estándar",
      "phases": [{ "id": "phase-default", "name": "Fase 1", "order": 0 }],
      "tasks": [
        {
          "id": "tpl",
          "name": "Traducir TPL",
          "phaseId": "phase-default",
          "rules": [{ "resource": "tpl", "articleFilter": "pending" }],
          "solverAppId": "tpl-translate",
          "steps": [
            { "id": "draft", "name": "Borrador", "solverAppId": "tpl-translate" },
            { "id": "review", "name": "Revisión" }
          ]
        }
      ]
    }
  ]
}
```

### Proyecto — `assignments.json`

Sigue escribiendo `phases` + `tasks` (snapshot). Añade opcionalmente
`workflowId`, `workflowAppliedAt`. Cada tarea puede llevar `steps[]` y
`solverAppId`.

Proyectos antiguos sin `workflowId` siguen válidos.

| Campo | Uso |
|-------|-----|
| `solverAppId` | Resolver de **toda** la subtarea |
| `steps[]` | Checklist; cada paso puede tener su propio `solverAppId` y política de claim |

### Pasos (`TaskStep`) — política de claim

Cada paso puede declarar quién lo toma y cómo se completa:

| Campo | Uso |
|-------|-----|
| `claimMode` | `none` (casilla libre), `exclusive` (un asiento), `pool` (varios) |
| `minAssignees` / `maxAssignees` | Solo `pool`; por defecto `min=2`, `max=min` |
| `excludePriorStepIds` | Logins que sentaron en esos pasos no pueden tomar este |
| `excludeIssueAssignee` | Si true, el asignado de la subtarea (issue) no puede tomar este |
| `includeAuthorInApproval` | En `exclusive`: quien hizo el paso previo (primer asiento del prior / assignee del issue) también debe **Aprobar** |

Presets en Plantillas: **Pares** → exclusive + autor aprueba + excluye asignado; **Grupal** → pool 2/2 excluyendo borrador, pares y asignado.

**No hay sub-issues DCS** por paso: un issue por porción×tarea. Asientos y
aprobaciones viven en el marcador de progreso.

### Progreso en el issue — `gateway-task-progress-2`

```html
<!-- gateway-task-progress {"v":2,"doneStepIds":["draft"],"steps":{"pair":{"assignees":["bob"],"approvals":["bob"]}}} -->
```

- `doneStepIds` — checklist hecho (compat v1; UI y “todos los pasos”).
- `steps[stepId].assignees` / `approvals` — asientos y aprobaciones runtime.
- Lectura v1 (`solo doneStepIds`) → seating vacío; escritura siempre v2.
- Pasos `claimMode !== none` se completan con **Tomar** + **Aprobar** (no casilla).

### Un PR por subtarea — `gateway-portion-pr-1`

Un issue (porción×tarea) ↔ **un** PR en el repo de contenido. Tres porciones
del mismo usuario = tres PRs abiertos, no uno compartido.

- Rama: `tas/{projectId}/{taskId}/{issueNumber}`.
- El borrador guarda en esa rama (y en el navegador si no hay red).
- El PR se abre al marcar el borrador (si después hay pares/grupal), al
  **Tomar** reseña, o con «Listo para revisión».
- Sigue abierto durante pares y grupal. Se **fusiona al Cerrar** (Entrega).
- Marcador en el issue PM: `<!-- gateway-portion-pr {…} -->`.
- La reseña comenta el PR. **Aprobar** en un paso exclusive/pool con
  marcador `gateway-portion-pr` también envía un review DCS (`APPROVED`).
  Si no hay PR aún, Aprobar solo actualiza el progreso. Si el review falla,
  el paso no se marca aprobado.

## Herramientas de resolución (solvers)

- Catálogo: `{pmOrg}/gateway-tasks/solvers.json`.
- La subtarea no guarda el solver; se resuelve vía tarea (y paso) del plan.
- Launch: `gateway-solver-launch-1` (+ `stepId` / `stepName` opcionales).
- Completar: marcar / aprobar pasos + **Cerrar** en Mis tareas.
- Ayudas (`helps-review` → `#/solver/helps`): un recurso por launch
  (TN/TQ TSV o TW/TA markdown). Borrador local + rama de la subtarea;
  «Listo para revisión» abre el PR.
- Familiarizar guarda en el navegador (`tas-familiarize:{usuario}:{lang}`) los
  artículos y ayudas ya vistos (id / ruta / recurso). Porciones posteriores
  marcan «Ya visto»; si no queda nada nuevo se muestra «Nada nuevo en esta
  porción» sin completar el paso solo. V1 no sincroniza con DCS.

## Namespace DCS

Sin cambio: label `pm`, facetas `pm/recurso:*`, `pm/tarea:{taskId}`, etc.
Los **ids de tarea** de la plantilla se conservan al aplicar para que
`pm/tarea:{taskId}` sea estable entre libros del mismo flujo.

## Rutas

| Ruta | Contenido |
|------|-----------|
| `#/plantillas` | Plantillas de flujo (org) |
| `#/plantillas/:workflowId` | Editar plantilla |
| `#/proyectos` | Lista / crear proyecto |
| `#/proyectos/:projectId/tareas` | Aplicar plantilla / ver snapshot |
| `#/proyectos/:projectId/inventario` | Inventario |
| `#/proyectos/:projectId/asignar` | Asignar |
| `#/proyectos/:projectId/entregar` | Publicar |
| `#/organizacion` | Equipos de org |
| `#/mis-tareas` | Cola + checklist + Tomar/Aprobar pasos + Resolver |
| `#/solver/scripture` | Borrador USFM (rama por subtarea) |
| `#/solver/helps` | Borrador TN/TQ/TW/TA (un recurso, rama por subtarea) |
| `#/solver/familiarize` | Lectura de fuente |
| `#/solver/review` | Diff / comentarios del PR |

## Ajustes de proyecto

`settings.allowSelfAssign`, `settings.lastPublish` — sin cambio de semántica.
Ver [`PLATAFORMA.md`](./PLATAFORMA.md).
