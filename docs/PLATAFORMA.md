# Plataforma — TAS sobre issues de DCS

Los **issues de DCS** son la fuente de verdad de persona y estado; el JSON en
`{pmOrg}/gateway-tasks` guarda plan e inventario.

El dominio de producto está en [`MODELO.md`](./MODELO.md)
(**Proyecto → Fase → Tarea → Equipo → Subtarea**). El plan de migración desde
el antiguo “equipo de PM” está en [`PLAN_MIGRACION.md`](./PLAN_MIGRACION.md).

## Namespace `pm` (project-management)

Todo lo que este producto crea en DCS usa el id configurable `namespaceId`
(default **`pm`**):

| Superficie | Convención | Filtro |
|------------|------------|--------|
| Subtareas (issues) | Label raíz `pm` | `searchIssues({ labels: ["pm"] })` |
| Facetas | `pm/recurso:tpl`, `pm/tarea:{taskId}`, `pm/equipo:…`, `pm/cap:1`, `pm/estado:en-curso` | filtros secundarios |
| Equipos de org | Prefijo `pm-` (`teamPrefix`) | nombres `pm-*` |
| Badge | Subtareas `pm` abiertas asignadas a ti | igual que Mis tareas |

DCS descarta labels inexistentes en `labels=`. El cliente re-filtra por label
`pm` / marcador de work-order y repo `gateway-tasks`.

`managers` no lleva prefijo: es capacidad de gestión, no equipo de trabajo.

```json
{
  "namespaceId": "pm",
  "managerTeam": "managers",
  "teamPrefix": "pm-",
  "resourceRepos": {}
}
```

## Rutas (hash)

| Ruta | Quién | Qué |
|------|-------|-----|
| `#/mis-tareas` | Todos | Subtareas propias; con autoasignación del proyecto, cola completa + Tomar |
| `#/equipo/:orgTeam` | Miembros | Subtareas sin assignee (**Tomar** solo si el proyecto lo permite) |
| `#/proyectos` | Gestores | Lista de proyectos |
| `#/proyectos/:projectId` | Gestores | Default → fases y tareas |
| `#/proyectos/:projectId/inventario` | Gestores | Inventario |
| `#/proyectos/:projectId/tareas` | Gestores | Fases y tareas |
| `#/proyectos/:projectId/tareas/:taskId` | Gestores | Editar tarea |
| `#/proyectos/:projectId/asignar` | Gestores | Asignar / autoasignar |
| `#/proyectos/:projectId/entregar` | Gestores | Publicar / guardar |
| `#/organizacion` | Todos | Equipos de org DCS |
| `#/plantillas` | Gestores | Plantillas de flujo (fases/tareas/checklists) |
| `#/plantillas/:workflowId` | Gestores | Editar plantilla |
| `#/lab` (alias `#/solver-lab`) | Dev / prueba | Laboratorio de solvers: abre TPL/TPS/ayudas/Estudiar **sin** Entregar ni issues |

`:projectId` es el id del proyecto (hoy a menudo un código de libro como `NEH`;
no está limitado a libros).

## Plantillas de flujo

Catálogo org `{pmOrg}/gateway-tasks/workflows.json` (`gateway-workflows-1`).
Se editan en `#/plantillas`. En el proyecto (**Fases y tareas**) se **aplica**
una copia (snapshot) a `assignments.json` (`workflowId`, `workflowAppliedAt`).
«Guardar como plantilla» crea/actualiza una entrada desde el plan actual.

Cada tarea de plantilla puede llevar `steps[]` (checklist + política de claim)
y `solverAppId` (tarea o paso). Los ids de tarea se preservan al aplicar.

En el editor de pasos: **Preset pares** / **Preset grupal**, o
«+ Quién puede tomarlo» (Cualquiera · Uno · Varios, mín/máx, excluir priors,
excluir asignado de la subtarea, incluir a quien hizo el paso previo).

## Roles

- `canManage` = Owner de la org **o** miembro de `managers` (capacidad real DCS).
- `viewMode` (`gestor` \| `trabajador`) = preview de chrome para gestores;
  `sessionStorage` `tas-view-mode`. No eleva privilegios.
- `effectiveCanManage` = `canManage && viewMode === "gestor"` — gates de UI
  (nav Proyectos, asistente, CRUD en Organización). El FAB de rol solo se
  monta si `canManage` es verdadero.
- Landing: gestores en vista Gestor → `#/proyectos`; resto → `#/mis-tareas`.
- Scopes: `read:user`, `read:organization`, `write:repository`, `write:issue`,
  `write:organization`, `read:notification`.

## Tarea ↔ Equipo

1. La **tarea** declara recursos → repos necesarios (`resourceRepos` + defaults TA/TW).
2. Solo se asigna un **equipo** cuyo `listTeamRepos` cubra esos repos
   (`assignOrgTeamToTask` / `filterTeamsEligibleForTask`). Gestores pueden
   **conceder repos faltantes** al asignar.
3. No se crea un equipo `pm-*` al guardar la tarea; los equipos se crean en
   Organización (o bajo demanda explícita).
4. Publicar genera **subtareas** (issues) etiquetadas `pm` + `pm/tarea:{taskId}`
   (+ facetas recurso/equipo/cap); milestone = **projectId**. Puede publicar el
   alcance **sin personas** (cola libre); con `allowSelfAssign`, trabajadores
   toman desde Mis tareas.

## Órdenes de trabajo ↔ subtareas

Un work order es un lote contiguo (persona + rango + recurso). Marcador HTML
idempotente `<!-- gateway-work-order {…} -->`. El array `assignments[]` es caché offline.

## Autoasignación (por proyecto)

`assignments.json` → `settings.allowSelfAssign`. Gestores lo activan en Fases y
tareas. Con el flag:

- Mis tareas lista proyectos donde el usuario está en un equipo vinculado.
- Filtros Mías / Todas / Disponibles; **Tomar** en libres; **Liberar** propias.
- Liberar subtareas de otros exige `canManage`.
- `#/equipo/:orgTeam` solo ofrece Tomar si el proyecto del issue lo permite.

## Herramientas de resolución (solvers)

Catálogo en `{pmOrg}/gateway-tasks/solvers.json` (si falta, TAS escribe el
catálogo por defecto). **TPL/TPS** abren el editor USFM en la misma app
(`#/solver/scripture?ctx=…`); **ayudas** (TN/TQ/TW/TA) abren
`#/solver/helps?ctx=…`. Si un catálogo antiguo aún apunta TPL/TPS/ayudas al
stub, TAS lo actualiza al cargar.

```json
{
  "schema": "gateway-solvers-1",
  "solvers": [
    {
      "id": "tpl-translate",
      "name": "Traducir TPL",
      "description": "Editor USFM → repo GLT (porciones TPL).",
      "launchUrl": "/#/solver/scripture?ctx={context}",
      "resources": ["tpl"],
      "openMode": "tab"
    }
  ]
}
```

| Campo | Uso |
|-------|-----|
| `id` | Estable; la tarea guarda `solverAppId` |
| `launchUrl` | Plantilla; `{context}` = JSON `gateway-solver-launch-1` en base64url; también `{lang}`, `{book}`, `{ref}`, `{resource}`, …; rutas `/…` = mismo origen |
| `resources` | Opcional: filtrar en el selector de Fases y tareas |
| `openMode` | `tab` (v1) |

En la tarea (`assignments.json` → `tasks[]`): `solverAppId?: string`,
`steps?: TaskStep[]` (nombre, solver opcional, `claimMode` / asientos).

**Mis tareas:** checklist por subtarea cuando hay `steps`. Pasos `none` se
marcan con casilla; al marcarlos se sienta el trabajador en el marcador para
exclusiones posteriores. Pasos `exclusive` / `pool` aparecen en **Revisiones**
(Tomar / Aprobar) y en la checklist de la subtarea (casilla bloqueada).
Progreso: `<!-- gateway-task-progress … -->` schema v2 (`doneStepIds` +
`steps.assignees/approvals`). **Resolver** abre la herramienta de la tarea o
del paso. **Cerrar** cuando todos los pasos están hechos (o sin checklist).

**PRs:** un PR por subtarea (`tas/{proyecto}/{tarea}/{issue}`). Borrador
offline-first (localStorage) y, en línea, commits a esa rama. El PR se abre
al salir del borrador o al Tomar pares/grupal; se fusiona al **Cerrar**.
Familiarizar es solo lectura. Pares/grupal leen el diff y comentan el PR.
**Aprobar** en un paso exclusive/pool con PR enlazado envía un review DCS
(`POST …/pulls/{index}/reviews`, y submit si queda pendiente). Sin marcador
de PR, Aprobar solo escribe el progreso; si el review falla, TAS no aprueba.
La caché local de familiarización
(`tas-familiarize:{usuario}:{lang}`) recuerda artículos y ayudas ya vistos
entre porciones; no salta el paso salvo que no quede nada nuevo (vacío
«Nada nuevo en esta porción»).

Fuera de alcance (por ahora): comentarios en línea del diff, sub-issues DCS por paso.

Contexto de lanzamiento (`gateway-solver-launch-1`): `lang`, `pmOrg`,
`contentOrg`, `projectId`, `taskId`, `taskName`, `book`, `chapter`, `resource`,
`ref`, `portionIds`, `itemIds`, `workOrderKey`, `issueNumber`, `issueUrl`,
`username`, `stepId?`, `stepName?`. El laboratorio añade `lab`,
`labAllowWrite?`, `labUnsafeWrite?` y deja `taskId` / `issueNumber` vacíos.

**Editor de Escritura** (`#/solver/scripture`): lee/escribe el USFM en
`{contentOrg}/{lang}_glt` o `{lang}_gst` (o `resourceRepos` en `config.json`),
archivo `NN-BOOK.usfm`. Edita solo el rango de `ref`; opcionalmente muestra
`en_ult` como referencia. Requiere sesión TAS en el mismo origen (el token no
va en el `ctx`).

**Laboratorio** (`#/lab`): formulario para armar el mismo `ctx` que Mis tareas
(`lab: true`, sin `taskId` / `issueNumber`). No crea subtareas. Por defecto el
borrador es local; Guardar en DCS exige org de prueba (o confirmación
«insegura» si el slug parece `{lang}_gl` / `es-419_gl`). No crea ramas de
libro en el GL de producción salvo ese opt-in. El ítem **Laboratorio** del
menú ⋯ solo aparece con `import.meta.env.DEV`; la ruta funciona si se escribe
a mano.

**Editor de ayudas** (`#/solver/helps`): un recurso por lanzamiento
(`ctx.resource`). Notas/preguntas editan las filas TSV de la porción
(`tn_BOOK.tsv` / `tq_BOOK.tsv`); palabras/academia editan el markdown del
artículo. Offline-first (`tas-helps-draft:…`) y guardado en la rama de la
subtarea; «Listo para revisión» abre el PR como el editor de Escritura.

## Archivos clave

| Área | Archivo |
|------|---------|
| Modelo | `docs/MODELO.md` |
| Plan migración | `docs/PLAN_MIGRACION.md` |
| Roles / repos | `src/domain/roles.ts` |
| Workflows | `src/domain/workflows.ts`, `src/components/WorkflowsView.tsx` |
| Checklist progress | `src/domain/taskProgress.ts` |
| Step claim / approve | `src/domain/stepClaim.ts`, `src/domain/stepPresets.ts` |
| Solvers / launch | `src/domain/solverLaunch.ts`, `src/domain/solvers.ts`, `src/domain/solverLab.ts` |
| Laboratorio | `src/components/SolverLabView.tsx`, `#/lab` |
| Scripture editor | `src/components/ScriptureEditorView.tsx`, `src/domain/usfmEdit.ts`, `src/domain/scriptureTarget.ts` |
| Helps editor | `src/components/HelpsEditorView.tsx`, `src/domain/helpsDraft.ts`, `src/domain/helpsTarget.ts` |
| Portion PR | `src/domain/portionPr.ts`, `src/dcs/portionPr.ts`, `src/dcs/pulls.ts` |
| Familiarize / review | `src/components/FamiliarizeView.tsx`, `src/components/PortionReviewView.tsx` |
| Work orders | `src/domain/workOrder.ts` |
| Mis tareas / claim | `src/domain/myTasks.ts`, `src/dcs/issues.ts` |
| Issues | `src/dcs/issues.ts` |
| Auth | `src/dcs/auth.ts` |
| Vista de rol | `src/viewMode.ts`, `src/components/RoleModeFab.tsx` |
| Router | `src/router.tsx` |
