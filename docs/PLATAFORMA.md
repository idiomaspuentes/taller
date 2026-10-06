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

**Ramas y revisiones:** solo la tarea que traduce un recurso tiene borrador del grupo
(`borrador/<libro>/<tarea>`), ramas de trabajo (`trabajo/<libro>/<tarea>/<persona>/<subtarea>`) y una revisión por
subtarea. El borrador es offline-first (localStorage) y, en línea, se guarda en la rama de trabajo. La revisión se
abre al terminar el borrador o al tomar un paso de revisión; al **Entregar**, el trabajo pasa al borrador del
grupo, queda la etiqueta `archivo/<libro>/<subtarea>` y la rama de trabajo se borra. Las demás tareas trabajan
sobre el borrador del grupo. Al cerrar una fase queda `fase/<libro>/<fase>`; antes de validar, la unidad pasa a
`validacion/<libro>/<unidad>`; publicar la fusiona en `master` y crea la versión. Tabla y recorrido completos en
[`MODELO.md`](./MODELO.md) § «Ramas y etiquetas».
**Aprobar** un paso con revisión enlazada envía una aprobación a Door43
(`POST …/pulls/{index}/reviews`, y submit si queda pendiente). Sin revisión enlazada, Aprobar solo escribe el
progreso; si la aprobación falla, el paso no se aprueba.
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
artículo. Offline-first (`tas-helps-draft:…`) y guardado en la rama de trabajo de la
subtarea; «Listo para revisión» abre la revisión como el editor de Escritura.

## Textos fuente en el dispositivo

Los textos en inglés (ULT y UST) que una herramienta muestra junto a un pasaje se guardan en el
dispositivo **por capítulo** (IndexedDB, base `taller-sources`). Antes, cada herramienta bajaba el
libro entero de cada texto al abrirse y lo analizaba entero: el editor, otra vez la revisión, otra
vez las notas. Y desde que el glosario se encuentra por la alineación, todas la necesitan.

Medido en QA el 6 de octubre de 2026, desde un computador con buena conexión (en un teléfono, más):

| | Judas | Mateo | Salmos |
|---|---|---|---|
| El libro, como lo mandaba la API de contenidos | 133 KB | 5,1 MB | 6,9 MB |
| El libro, archivo tal cual | 93 KB | 3,6 MB | 4,8 MB |
| Un capítulo (Mateo 5, Salmo 119) | 91 KB | 160 KB | 272 KB |
| Analizar el libro | 22 ms | 1,6 s | 2,6 s |
| Analizar el capítulo | 22 ms | 47 ms | 80 ms |

Cómo funciona (`src/dcs/sourceTexts.ts`):

- **La primera vez** que se abre un libro se baja entero una sola vez (el archivo tal cual, sin
  base64), se corta por capítulos (`src/domain/usfmChapters.ts`) y se guarda. Cada capítulo lleva
  el encabezado del libro, para leerse solo.
- **Las siguientes**, y al día siguiente, la herramienta lee su capítulo del dispositivo: 2–3 ms,
  sin red. Otro capítulo del mismo libro tampoco baja nada.
- **Si el libro cambió en Door43** se pregunta una vez por visita, con el capítulo ya en pantalla:
  una sola consulta por recurso (la lista de sus archivos con el hash de cada uno, 17 KB) sirve
  para todos sus libros. El que cambió se vuelve a bajar y queda para la próxima vez que se abra.
  Si Door43 no puede decirlo, se vuelve a bajar pasado un día.
- **Sin red**, se usa lo guardado: un pasaje ya abierto se puede volver a leer sin conexión.
- Se guarda el texto como lo dio Door43, no lo analizado: un capítulo se analiza en un momento y
  así no hay un formato propio que mantener al día. El análisis se comparte en memoria entre las
  partes de una pantalla (`parseSourceUsfm`).
- Quedan los doce libros abiertos más recientemente; los demás se sueltan.

Lo usan el editor de textos, «Estudio», la revisión, el editor de ayudas, la lectura grupal y el
glosario. **No lo usan todavía:** las herramientas de Afinación (comparan con el libro entero y
leen también el original), ni los textos del propio equipo, que cambian a cada rato y se leen de
su rama. La rama que se lee sigue siendo la de trabajo de cada recurso (`master`), no su última
versión publicada: cambiar eso es otra decisión.

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
| Ramas y etiquetas | `src/domain/branchNames.ts`, `src/domain/portionPr.ts`, `src/dcs/portionPr.ts`, `src/dcs/pulls.ts` |
| Marcas de fase y «Qué cambió» | `src/domain/phaseMarks.ts`, `src/dcs/phaseMarks.ts`, `src/domain/changesSince.ts`, `src/dcs/changesSince.ts`, `src/components/ChangesView.tsx` |
| Validación y publicación de una unidad | `src/domain/unitStage.ts`, `src/dcs/unitStage.ts`, `src/dcs/unitPublish.ts`, `src/dcs/corrections.ts`, `src/dcs/release.ts` |
| Lectura de una unidad por el comité | `src/components/EndorsementView.tsx`, `src/components/UnitReading.tsx`, `src/domain/unitReading.ts`, `src/domain/endorsement.ts` |
| Familiarize / review | `src/components/FamiliarizeView.tsx`, `src/components/PortionReviewView.tsx` |
| Textos fuente en el dispositivo | `src/dcs/sourceTexts.ts`, `src/domain/usfmChapters.ts`, `src/domain/referenceResources.ts` |
| Glosario | `src/domain/glossary.ts`, `src/dcs/glossaryStore.ts`, `src/useGlossary.ts`, `src/components/GlossaryView.tsx`, `docs/GLOSARIO_DOOR43.md` |
| Work orders | `src/domain/workOrder.ts` |
| Mis tareas / claim | `src/domain/myTasks.ts`, `src/dcs/issues.ts` |
| Issues | `src/dcs/issues.ts` |
| Auth | `src/dcs/auth.ts` |
| Vista de rol | `src/viewMode.ts`, `src/components/RoleModeFab.tsx` |
| Router | `src/router.tsx` |
