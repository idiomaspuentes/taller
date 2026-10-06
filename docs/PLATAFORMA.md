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

## Con qué versión de las fuentes se hizo cada paso

Las fuentes cambian: el 6 de octubre de 2026, 9 de los 67 libros del ULT en `master` ya no eran los
de su última versión publicada (v91). Un borrador hecho contra el texto de ayer puede no decir lo
que la fuente dice hoy, y nada lo avisaba: Taller lee la rama de trabajo de cada recurso y no
guardaba contra qué se había trabajado.

Ahora, **al cerrarse un paso** queda anotado en su subtarea quién lo cerró, cuándo, y la versión de
cada fuente con la que se hizo:

```html
<!-- gateway-task-progress {"v":2,"doneStepIds":["borrador"],"steps":{"borrador":{"assignees":[],"approvals":[],
  "done":{"by":"Elisha","at":"2026-10-06T19:38:12.746Z"},
  "sources":[{"kind":"ust","repo":"unfoldingWord/en_ust","path":"66-JUD.usfm","sha":"2ee94a0d…","release":"v91","released":true}]}}} -->
```

- **Qué se anota.** De cada archivo fuente, la huella de su contenido (`sha`: la misma que usa
  Door43) y la última versión publicada del recurso (`release`). `released` dice si el archivo era
  todavía el de esa versión; si ya había cambiado después, se muestra «v91+».
- **Qué fuentes.** Las de lo que el paso traduce (`src/domain/sourceVersions.ts`): el TPL contra el
  ULT, el TPS contra el UST, las notas contra las notas, un artículo contra ese artículo. Una
  herramienta que lee más lo declara en su proceso con `sources` (afinar se hace con el original,
  las notas y la lista de palabras); ver [`PROCESOS.md`](./PROCESOS.md) § `tools`.
- **Dónde se anota.** En un solo sitio: `setIssueTaskProgress` (`src/dcs/issues.ts`), por donde pasa
  todo cambio del avance de una subtarea. Las herramientas no saben nada de esto. Preguntar cuesta
  la lista de archivos del recurso (17 KB, compartida con los textos del dispositivo) y el nombre de
  su última versión (menos de 1 KB). Si Door43 tarda más de 4 segundos, el paso se cierra igual y
  no dice nada de sus fuentes, que es mejor que decir algo falso.
- **Dónde se ve.** En la tarjeta de la subtarea, al tocar la barra de avance se despliegan los pasos: «Hecho por @Elisha · 6
  oct» y debajo «UST v91». Y si una fuente **cambió después** de cerrarse el paso, la tarjeta lo
  dice sin que nadie lo pida: «Cambió en la fuente después de «Borrador»: UST. Conviene volver a
  mirarlo.» Se pregunta una vez por visita para todas las tarjetas (`src/useSourcesNow.ts`).
- **Si el paso se devuelve** a su autor, deja de estar cerrado y olvida con qué se hizo: al
  cerrarse otra vez se anota lo de ese día.
- Los pasos cerrados antes de este cambio no tienen nada anotado y se muestran como siempre
  («Hecho»).

**No hace todavía:** decir *qué* cambió en la fuente (qué versículos), ni fijar un proyecto a una
versión publicada. Con la huella anotada, lo primero es comparar dos contenidos que Door43 guarda
(`git/blobs/<sha>`).

## Avance, ritmo y trabajo de cada persona

Un paso estaba hecho o no. Un borrador de cuarenta versículos se veía igual con uno escrito que con
treinta y nueve, y quien coordina lo veía «sin movimiento» mientras su autor lo escribía cada día.
Tampoco se podía decir a qué ritmo iba un libro ni cuánto había trabajado cada persona.

Todo sale de **dos fuentes que ya existían**; Taller no guarda nada aparte:

| Qué | De dónde |
|---|---|
| Cuánto lleva un paso | Lo dice su herramienta en la subtarea: `steps[paso].work = { done, total }` |
| Cuánto lleva una subtarea, una tarea, una fase, un proyecto | Se calcula de las subtareas (`src/domain/workProgress.ts`) |
| El ritmo de un proyecto | De cuándo se cerró cada subtarea (`closed_at`), que Door43 guarda desde el principio |
| Cuándo trabajó cada persona | De Door43: `GET /users/{persona}/heatmap`, tramos de 15 minutos |
| Qué cerró cada persona | De `steps[paso].done` y de las subtareas terminadas |

**Las barras.** Una sola (`ProgressBar`) para todo, para que se lean igual:

- **Paso**: lo que su herramienta cuenta (versículos con texto, notas traducidas, secciones leídas,
  ítems comprobados o acordados, versículos alineados). Cerrado, vale entero.
- **Subtarea**: sus pasos, cada uno vale lo mismo, y el que está abierto cuenta por lo que lleva.
  En la tarjeta la barra va partida en pasos: «1 de 3 pasos · 42 %».
- **Tarea, fase y proyecto**: la media de sus subtareas. En «Avance» del proyecto y en «Equipo hoy».
- No cuentan las decisiones del equipo ni las subtareas que el plan retiró (cerradas con pasos sin
  hacer). Un porcentaje nunca dice «100 %» de algo sin terminar ni «0 %» de algo empezado.

**Cómo lo dice una herramienta** (`useStepWork`, `src/dcs/stepWork.ts`): cuando la cuenta lleva 20
segundos quieta, y al salir. Lee la subtarea otra vez antes de escribir (para no pisar un asiento o
una aprobación) y no escribe si ya dice lo mismo. No dice nada desde el laboratorio, ni con el paso
cerrado, ni mientras se está cerrando. Tampoco si quien abre la herramienta **no tiene la subtarea
ni un asiento en el paso**, ni un «cero» de un paso que nunca dijo nada: quien coordina abre una
herramienta para mirar, y una subtarea que nadie toca hace una semana no debe parecer movida hoy
por eso. Medido en QA: una lectura y una escritura de la subtarea.
La revisión en pares no tiene qué contar: su paso va de 0 a hecho.

**El ritmo** (`src/domain/pace.ts`): subtareas terminadas por semana, sobre las últimas 4 (un
proyecto más joven se mide por las semanas que tiene). Con lo que falta —una subtarea a medias
cuenta por media— da una fecha: «A este ritmo, termina hacia el 18 de octubre». Sin nada terminado
en esas semanas no promete fecha.

**Cada persona** (`src/domain/activity.ts`): en «Equipo hoy» → «Personas», y cada quien ve lo suyo
en «Yo» → «Tu trabajo». Días trabajados y tiempo aproximado de las últimas 4 semanas, un calendario
de 12 semanas (una columna por semana, un cuadro por día, más oscuro cuanto más se trabajó) y los
últimos 7 días en palabras («3 h 15 min · entre las 8:45 y las 15:45»), porque un cuadro no se
puede tocar en un teléfono para preguntarle. Junto a eso, lo que el plan dice que cerró.

Lo que hay que saber al leerlo:

- Door43 cuenta **lo que se guarda**: una hora de estudio sin escribir nada no deja rastro. El
  tiempo es un mínimo, no un cronómetro.
- Cuenta lo que la persona hace **en todo Door43**, no solo en este equipo.
- «Pasos cerrados» solo existe desde que se anota quién cierra cada paso (octubre de 2026); las
  subtareas terminadas y el calendario sí alcanzan hacia atrás.
- Todos los pasos de una subtarea valen lo mismo, aunque uno sea de cinco minutos y otro de horas.

## Registro de correcciones del texto

Corregir un versículo del borrador del grupo (al afinar notas o palabras clave, al alinear, en la
lectura grupal o al aceptarse una propuesta) ya pedía un motivo, pero quedaba como una frase en el
mensaje del commit, y lo que el versículo decía antes solo estaba en la historia del archivo. Nada
de eso se puede contar: cuántas correcciones tomó un libro, de qué clase, qué notas o palabras
trajeron más. translationCore guarda un registro por cada edición; ahora Taller también.

- **Dónde.** Un archivo por persona y libro en el repositorio del texto, junto a sus respuestas:
  `checkings/corrections/<LIBRO>.<persona>.corrections.json`, en la rama del borrador del grupo. Dos
  personas nunca escriben el mismo archivo.
- **Qué guarda cada corrección** (`src/domain/correctionLog.ts`): capítulo y versículo, `before` y
  `after`, `reasons` (las clases de motivo: `spelling`, `punctuation`, `wordChoice`, `meaning`,
  `grammar`, `other`), `note` (lo que la persona escribió), `from` (la subtarea, la tarea y el paso
  en que estaba, y la nota o palabra que tenía a la vista, con su nombre), `by` y `at`.
- **Quién lo escribe.** `saveCorrection` (`src/dcs/afinacionStore.ts`), por donde pasa toda
  corrección del borrador del grupo: las herramientas solo le dicen el motivo. Primero se corrige el
  texto y después se anota; si el registro no se puede escribir, la corrección no se deshace.
- **El motivo se toca, no se escribe.** Los mismos seis botones en todas las herramientas
  (`CorrectionReasons`), de 44 px, con un campo opcional para lo que un toque no dice.
- **Dónde se ve.** Bajo el versículo, al afinar: «Corregido 2 veces», plegado; al abrirlo, quién,
  cuándo, por qué, qué cambió palabra por palabra y qué se estaba revisando.

**No hace todavía:** un resumen para quien coordina (cuántas correcciones, por motivo, por persona,
qué notas trajeron más). La cuenta ya existe y está probada (`summarizeCorrections`); falta la
pantalla, que necesita saber en qué rama está el borrador del grupo de cada texto del proyecto.

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
| Registro de correcciones del texto | `src/domain/correctionLog.ts`, `src/dcs/correctionLog.ts`, `src/components/CorrectionReasons.tsx`, `src/components/CorrectionSheet.tsx` (no confundir con `corrections.ts`: lo que un comité pide corregir) |
| Avance, ritmo y trabajo de cada persona | `src/domain/workProgress.ts`, `src/domain/pace.ts`, `src/domain/activity.ts`, `src/dcs/stepWork.ts`, `src/dcs/activity.ts`, `src/components/ProgressBar.tsx`, `src/components/ActivityCalendar.tsx` |
| Versión de las fuentes de cada paso | `src/domain/sourceVersions.ts`, `src/dcs/sourceVersions.ts`, `src/dcs/stepSources.ts`, `src/useSourcesNow.ts` |
| Glosario | `src/domain/glossary.ts`, `src/dcs/glossaryStore.ts`, `src/useGlossary.ts`, `src/components/GlossaryView.tsx`, `docs/GLOSARIO_DOOR43.md` |
| Work orders | `src/domain/workOrder.ts` |
| Mis tareas / claim | `src/domain/myTasks.ts`, `src/dcs/issues.ts` |
| Issues | `src/dcs/issues.ts` |
| Auth | `src/dcs/auth.ts` |
| Vista de rol | `src/viewMode.ts`, `src/components/RoleModeFab.tsx` |
| Router | `src/router.tsx` |
