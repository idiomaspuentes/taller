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
- `steps[stepId].work` (`done`, `total`) — cuánto lleva un paso abierto, como lo cuenta su herramienta; de ahí
  salen las barras de avance (ver `PLATAFORMA.md` § «Avance, ritmo y trabajo de cada persona»).
- `steps[stepId].done` (`by`, `at`) y `sources` — quién cerró el paso, cuándo y con qué versión de cada fuente;
  los pone `setIssueTaskProgress` al guardarse un paso recién cerrado, y se quitan si el paso vuelve a abrirse
  (ver `PLATAFORMA.md` § «Con qué versión de las fuentes se hizo cada paso»).
- Lectura v1 (`solo doneStepIds`) → seating vacío; escritura siempre v2.
- Pasos `claimMode !== none` se completan con **Tomar** + **Aprobar** (no casilla).

### Una revisión por subtarea — `gateway-portion-pr-1`

Una subtarea de una tarea **de traducción** (porción × tarea) ↔ **una** revisión (PR) en el repositorio del
recurso. Tres porciones de la misma persona son tres revisiones abiertas, no una compartida.

- Solo la tarea que **traduce** un recurso (la primera del proceso con ese recurso) tiene borrador propio, ramas de
  trabajo y revisiones. Las demás tareas del mismo recurso (lectura grupal, afinación, armonización, validación)
  trabajan sobre ese borrador y entregan cerrando la subtarea (`taskHasOwnDraft`, `src/domain/branchNames.ts`).
- El trabajo de la persona se guarda en su rama de trabajo (y en el navegador si no hay red).
- La revisión se abre al terminar el borrador (si después hay revisión en pares) o al **tomar** un paso de revisión.
- Sigue abierta durante la revisión. Al **Entregar**, el trabajo pasa al borrador del grupo y la revisión se cierra.
- Marcador en la subtarea: `<!-- gateway-portion-pr {…} -->`.
- **Aprobar** un paso con revisión enlazada envía también una aprobación a Door43 (`APPROVED`). Si no hay revisión
  aún, Aprobar solo actualiza el progreso. Si la aprobación falla, el paso no se marca aprobado.

## Ramas y etiquetas en los repositorios de contenido

Cada clase vive bajo su propia palabra, para que ninguna estorbe a otra (Git no deja crear `jud/tpl` si existe una
rama `jud`) y para que quien abra el repositorio entienda qué es cada una. Las palabras se configuran en
`taller.config.ts` (`branchNames`, por organización y por espacio de trabajo; ver
[`CONFIGURACION.md`](./CONFIGURACION.md)).

| Qué | Nombre | Ejemplo | Quién la crea y cuándo |
|---|---|---|---|
| Borrador del grupo de una tarea de traducción | rama `borrador/<libro>/<tarea>` | `borrador/jud/tpl` | la app, al empezar la primera subtarea de la tarea |
| Trabajo de una persona en una subtarea | rama `trabajo/<libro>/<tarea>/<persona>/<subtarea>` | `trabajo/jud/tpl/valeska/159` | la app, al empezar la subtarea; se borra al entregarla |
| Lo que se entregó, tal como quedó | **etiqueta** `archivo/<libro>/<subtarea>` | `archivo/jud/159` | la app, al entregar o cerrar la subtarea |
| El texto al cerrar una fase | **etiqueta** `fase/<libro>/<fase>` | `fase/jud/traduccion` | la app, al cerrarse la última subtarea de la fase para ese libro |
| Una unidad tal como la valida el comité | rama `validacion/<libro>/<unidad>` | `validacion/jud/1` | la app, al cerrarse el último trabajo antes de validar esa unidad; se borra al publicarla |
| Lo publicado | rama `master` y sus versiones (releases) | | Door43; solo recibe unidades avaladas |

Los libros empezados antes (`jud/tpl`, `t/jud/tpl`, `w/jud/tpl/…`, ramas `archivo/…`) se siguen leyendo donde
están; esos nombres no se crean más.

### El recorrido de una porción

1. **Traducción.** La persona empieza la subtarea: la app crea `borrador/jud/tpl` (si no existe) y su rama
   `trabajo/jud/tpl/valeska/159`. Escribe ahí. Al terminar el borrador se abre la revisión hacia el borrador del
   grupo; quien revisa en pares lee esa revisión.
2. **Entrega.** Los versículos que cambiaron se copian al borrador del grupo (para un texto no hay fusión de Git:
   así dos personas en porciones vecinas no se pisan). Antes de cerrar la revisión se fija `archivo/jud/159` en el
   commit del trabajo; si no se puede fijar, la entrega falla y la subtarea sigue abierta. Cerrada la revisión, la
   rama de trabajo se borra: la etiqueta guarda lo que tenía.
3. **Lectura grupal, Afinación, Armonización.** Trabajan sobre `borrador/jud/tpl` (y los borradores de las ayudas),
   sin ramas propias. Al cerrar cada subtarea se fija su `archivo/jud/<n>` en el borrador tal como está.
4. **Marca de fase.** Al cerrarse la última subtarea de una fase para el libro, cada borrador de esa fase recibe
   `fase/jud/<fase>`.
5. **Validación.** Al cerrarse el último trabajo antes de validar la unidad, la app crea `validacion/jud/1` desde
   `master` con solo esa unidad encima y deja abierta una solicitud hacia `master`. El comité ve lo que cambia
   frente a lo publicado. Lo que no avala vuelve como subtarea de corrección a quien mantiene ese recurso; al
   cerrarse, la rama de validación se renueva.
6. **Publicación.** Con el aval, la solicitud se fusiona en `master`, la rama de validación se borra y se crea la
   **versión** (release) de esa unidad en cada repositorio. Publicar es crear la versión; a `master` no llega nada
   sin aval.

«Qué cambió» (pestaña Versiones y conversación de una subtarea cerrada) se lee de las etiquetas: entre dos marcas
de fase, o entre el `archivo/` de una subtarea y el borrador de hoy.

## Herramientas de resolución (solvers)

- Catálogo: `{pmOrg}/gateway-tasks/solvers.json`.
- La subtarea no guarda el solver; se resuelve vía tarea (y paso) del plan.
- Launch: `gateway-solver-launch-1` (+ `stepId` / `stepName` opcionales).
- Completar: marcar / aprobar pasos + **Cerrar** en Mis tareas.
- Ayudas (`helps-review` → `#/solver/helps`): un recurso por launch
  (TN/TQ TSV o TW/TA markdown). Borrador local + rama de trabajo de la subtarea;
  «Listo para revisión» abre la revisión.
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
| `#/solver/scripture` | Borrador USFM (rama de trabajo por subtarea) |
| `#/solver/helps` | Borrador TN/TQ/TW/TA (un recurso, rama de trabajo por subtarea) |
| `#/solver/familiarize` | Lectura de fuente |
| `#/solver/review` | Lo que cambió en la porción y los comentarios de la revisión |

## Ajustes de proyecto

`settings.allowSelfAssign`, `settings.lastPublish` — sin cambio de semántica.
Ver [`PLATAFORMA.md`](./PLATAFORMA.md).
