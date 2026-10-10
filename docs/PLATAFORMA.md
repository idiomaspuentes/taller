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
artículo. Offline-first (`tas-helps-draft-v2:…`) y guardado en la rama de trabajo de la
subtarea; «Listo para revisión» abre la revisión como el editor de Escritura.

**Lo que los dos editores guardan en el navegador** (`src/domain/draftCache.ts`,
`helpsDraftCache.ts`): cada borrador se guarda con el nombre de aquello para lo
que se escribió —servidor, organización y número de la subtarea, persona,
organización de contenido, idioma, recurso, libro y pasaje— y solo lo lee un
lanzamiento que coincida en todo. Los números de subtarea se repiten (QA se
reemplaza por una copia de producción; un mock nuevo en la misma dirección), y
con el número solo, un pasaje recibía los versículos de otro libro y los
guardaba en la rama recordada de ese otro. Reglas:

- La rama recordada solo se usa si es una de las propias de la subtarea
  (`ownedWorkBranchNames`); si no, se guarda en la rama propia.
- Una entrada de antes de este cambio (`tas-draft:{org}:{n}`, sin nada de eso)
  se restaura solo si su rama es de esta subtarea y, en Escritura, si contiene
  justo los versículos del pasaje; al guardar pasa a su nombre nuevo. Con la
  rama de otro libro o de otra persona se deja donde está, sin tocarla.
- Lo que puede ser de la subtarea y no se usa (otro pasaje del mismo libro con
  el mismo número; una entrada de antes cuya rama no dice de quién es) no se
  pone en el editor ni se borra: se avisa sobre el borrador («Hay otro borrador
  guardado en este navegador») y la persona lo ve, copia lo que le sirva y lo
  descarta ella. `npm run verify:draft-cache`.

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

## Cómo se escribe el texto bíblico

Un libro es un archivo USFM y cada guardado lo escribe entero. Lo que no se tocó tiene que quedar
como estaba, y lo que se tocó, en el formato en que lo escriben las herramientas de unfoldingWord,
para que el archivo del equipo y el del original se puedan comparar línea por línea.

- **Formato.** Con alineación, un grupo por línea (`\zaln-s … \w palabra\w* \zaln-e\*`), cada
  palabra más de un grupo en su propia línea, la puntuación después del grupo y la marca de trozo
  (`\ts\*`) sola en su línea tras una vacía. Un grupo cuyas palabras no van seguidas se escribe otra
  vez con el mismo original, nunca uno dentro de otro (los archivos antiguos, anidados, se siguen
  leyendo). Lo hace `usfm-ast` (`mergeAlignmentIntoUsfm`, `layoutAlignedUsfm`).
- **Un versículo es sus renglones.** En poesía un versículo ocupa varios, cada uno con su marca
  (`\q1`, `\q2`; `\b` es la línea en blanco entre estrofas). `verseParts` (`src/domain/usfmEdit.ts`)
  lo lee así y el editor lo muestra así: un renglón del cuadro por renglón del versículo. Lo que
  sigue al texto de un versículo (la marca que abre el siguiente, un título, la marca de trozo, la
  etiqueta del capítulo que viene) no es suyo: ni se muestra con él ni se mueve al guardarlo.
- **Qué es de un versículo, para la biblioteca.** `usfm-ast` tiene una sola regla (`verse-reach.ts`)
  para quien lee el texto de un versículo, numera sus palabras, lee su alineación o la escribe; eran
  tres, y donde no coincidían una palabra tenía un número para quien leía y otro para quien
  escribía. Un versículo llega hasta el siguiente `\v` y no pasa de su capítulo. Un título, una
  referencia o la etiqueta de un capítulo (`\s1`, `\ms`, `\r`, `\sp`, `\qa`, `\cl`…) no son suyos,
  aunque estén escritos en medio: el versículo sigue después y sus palabras se numeran sin las del
  título. Una nota al pie tampoco; lo marcado dentro del versículo (`\nd`, el `\qs` de un «Selah»)
  sí. Lo que un capítulo trae antes de su primer versículo —el título de un salmo, `\d`— es el
  **versículo 0** de ese capítulo (`PSA 3:0`), con sus palabras numeradas aparte, como las numera
  el ULT; un `\d` escrito después del `\v 1` es texto de ese versículo, como también lo trae el ULT.
  Los paneles que muestran un texto fuente leen por ahí (`extractDraftVerses().verses`,
  `verseTextsFromUsj`) y ya dicen lo mismo que los renglones del editor.
- **Qué texto se abre.** El de la rama de la persona; si la subtarea se abre por primera vez y aún
  no la tiene, el del borrador del grupo, que es de donde esa rama sale; lo publicado, solo si no
  hay ninguno de los dos (`draftReadBranchNames`, `src/domain/portionPr.ts`). Se abría lo publicado
  en esa primera vez, y quien escribía ahí escribía sobre lo publicado, no sobre lo del equipo.
  Cuando el borrador del grupo responde después de esa primera lectura, lo leído se conserva solo
  si era la rama de la persona (`readIsOwnWork`); si no, vale el archivo del que su rama acaba de
  salir.
- **Los trozos** (`\ts\*`, las «translator's sections»). El TPL y el TPS los usan traductores en
  herramientas que trabajan por trozos, y ningún archivo del equipo los traía: ni los empezados
  aquí ni los hechos con translationCore. El borrador del grupo lleva los de su original, el ULT
  para el TPL y el UST para el TPS, ante los mismos versículos (`withChunkMarksOf`,
  `src/domain/usfmEdit.ts`): un libro nuevo nace con ellos, uno que se copia de lo publicado los
  toma al copiarse, y un borrador de antes, que no tiene ninguno, los recibe una vez, la primera vez
  que alguien abre el editor en ese libro (`ensureBookUsfm`, un commit «marcas de trozo del
  original»). Cada marca va sola en su línea tras una vacía, justo después del texto del versículo
  anterior: antes del `\c`, del título y del párrafo que el trozo abre. No se quita ninguna: las que
  el equipo tenga se quedan, y a un borrador que ya tiene alguna no se le agregan. Guardar un
  versículo, corregirlo o entregarlo no las mueve.
- **Cómo se ve.** Mientras nadie escribe en él, un versículo con texto se muestra con la forma que
  le dan sus marcas (`src/domain/verseShape.ts`, `VerseShown`): cada renglón de un poema es un
  bloque con una raya a su izquierda, tan alta como el renglón por muchas veces que doble, y metido
  hacia dentro según su marca (`\q1` al borde, `\q2` 1 rem adentro); `\b` deja una línea vacía. Las
  rayas se cuentan: dos renglones son dos rayas. Primero se marcaron solo con sangrías (dónde
  empieza un renglón, dónde uno más profundo y dónde sigue cualquiera al doblar), y en un teléfono
  un versículo de dos renglones doblaba en cinco, a tres profundidades: parecían más. Al tocarlo
  vuelve el cuadro para escribir, con el cursor donde se tocó. Lo que se muestra es lo que se va a
  guardar (`leadsFor`, la misma regla que escribe), también antes de guardar: en un libro nuevo los
  renglones toman la forma que el original tiene en ese versículo. El texto del que se traduce usa
  la misma regla de formato (un solo bloque de estilos para `.usfm-para[data-marker]`), en todas
  las pantallas que lo muestran: antes todos sus renglones empezaban en el mismo sitio.
- **Un campo por renglón.** Un versículo de un poema se escribe en tantos campos como renglones
  tiene su original, cada uno dibujado como su renglón: la raya a la izquierda y su profundidad
  (`VerseLines`, `src/domain/verseLines.ts`). Enter empieza un renglón (o «Otro renglón», bajo los
  campos) y Retroceso al inicio de uno lo une al anterior; lo pegado con saltos de línea se reparte.
  En un solo cuadro, un renglón nuevo era una tecla que había que conocer, con un aviso debajo para
  decirlo, y la forma del versículo no se veía hasta salir del cuadro. El versículo sigue siendo un
  solo texto con sus renglones separados por saltos de línea; un versículo de prosa es un cuadro,
  como antes, y uno de un poema vacío y sin tocar también, hasta que se entra en él.
- **¿Se guardó?** Bajo el cuadro del versículo que se escribe se dice «Sin guardar», «Guardando…»
  o «Guardado». En un teléfono no se decía en ningún sitio: el estado junto al título se oculta a
  ese ancho.
- **El versículo que se escribe.** En su fila mandan dos cosas: el texto del que se traduce y el
  cuadro donde se escribe, que es lo único con aspecto de campo. Lo demás va en voz baja: el paso
  al otro texto, junto al nombre de este; bajo el cuadro, si se guardó y «Fíjate en esto»; los botones de unir
  versículos, sin recuadro, y ocultos junto al versículo en el que se está escribiendo. Lo que pide
  el paso («Qué se pide en…») va a la cabeza del borrador y sube con él al desplazar: fijo arriba
  ocupaba una franja de la pantalla del teléfono (queda fijo solo cuando la subtarea trae un
  pedido de corrección, como en las demás herramientas).
- **La fuente, legible.** En un teléfono el texto del que se traduce va a 16 px (iba a 14, bajo una
  traducción a 17) y a todo el ancho de la fila: el número del versículo pasa junto al nombre de la
  fuente («3 ULT») y deja libre su columna de 31 px. Las palabras de las que habla una nota o una
  palabra clave se subrayan por frases (`linkedPhrases`): una línea seguida bajo la frase, que es
  también un solo sitio que tocar; palabra por palabra, un versículo con cuatro notas tenía dieciséis
  trazos. Lo secundario de la fila se dice en un tamaño (13 px), con un paso de 8 px entre sus
  partes, y «Fíjate en esto» se lee entero en dos líneas. La raya de un renglón tiene contraste 3:1
  o más con el fondo: dice cuántos renglones hay.
- **Guardar** (`applyVerseEdits`, y con alineación `applyVerseEditsKeepingAlignment`). Un versículo
  que dice lo que ya decía no se vuelve a escribir: queda como estaba, byte por byte.
  El que cambió se escribe en los renglones que la persona dejó, cada uno con la marca que tenía;
  un renglón de más toma la marca que el original tiene en ese lugar (`verseLeads`), o la del
  anterior. Las palabras que no cambiaron conservan su enlace con el original. Con alineación, del
  libro escrito de nuevo solo se toman los versículos editados (`editedVersesInto`): los demás
  quedan como el archivo los tiene, aunque los haya escrito otra herramienta a su manera. Antes de
  guardar se comprueba que ningún otro versículo cambió de palabras ni perdió alineación
  (`versesChangedBesides`); si pasara, no se guarda y se avisa.
- **Alinear** (`saveVerseAlignment`). Guardar la alineación de un versículo escribe el libro entero
  con la alineación puesta de nuevo, y de ese libro solo se toma el versículo que se alineó
  (`editedVersesInto`, el mismo paso que al guardar texto). Antes se guardaba el libro escrito de
  nuevo: en un Jonás hecho con translationCore, alinear un versículo cambiaba 73 líneas de 1317, en
  versículos que nadie había tocado (dónde va una marca en su línea, dos grupos vecinos del mismo
  original vueltos uno, espacios al final). El versículo alineado queda en sus renglones, con cada
  grupo en su línea, y lo que le sigue (la marca de trozo, la marca que abre el siguiente) no se
  mueve. Dos versículos unidos en uno (`\v 4-5`) no se ofrecen todavía para alinear, y la pantalla lo dice
  (`joinedVerses`); tampoco el título de un salmo. Si aun así llegara uno sin versículo propio que tomar, ahí se
  guarda el libro escrito de nuevo.
- **Lo que un versículo tiene además de sus palabras** (`src/domain/verseMarkup.ts`): una nota al
  pie o una referencia cruzada (`\f … \f*`, `\x … \x*`), palabras marcadas (`\nd Jehová\nd*`,
  `\add …\add*`, `\qs Selah\qs*`), un hito (`\qt-s … \qt-e\*`). Quien edita ve y escribe solo las
  palabras. Al guardar, lo demás se lleva al texto nuevo comparando, palabra por palabra, el
  versículo de antes con el de ahora (`carryMarkup`):
  - Una **nota** sigue a la palabra a la que seguía, con su coma o su punto. Si esa palabra se
    cambió por otra, sigue a la nueva; si se quitó, a la anterior. Nunca se pierde: un versículo
    que se borra entero conserva su nota, y al escribirlo de nuevo le queda al final.
  - Una **marca** sigue alrededor de sus palabras mientras estén. Lo que se escribe dentro de un
    tramo marcado queda marcado; lo que se escribe junto a él, no. Una palabra marcada que se
    cambia por otra sigue marcada («Jehová» → «el Señor», «de Jehová» → «del Señor»). La marca se
    quita cuando no queda nada de lo que marcaba, y también cuando sus palabras se escribieron de
    nuevo mezcladas con otras sin que se pueda decir cuál es cuál: una marca en la palabra
    equivocada no se ve en la app, y nadie podría quitarla.
  - Un tramo marcado que pasa de un renglón al siguiente se cierra al final del renglón y se abre
    en el otro.
  - Al leer, una nota o una marca no ocupan lugar: «al `\add pueblo\add*`.» se lee «al pueblo.»
    (se leía «al pueblo .», con un espacio que la persona veía en el editor).
  - Con alineación, una palabra marcada conserva también su enlace con el original cuando se edita
    su versículo (`\qs \zaln-s … \w Selah\w* \zaln-e\*\qs*`): `usfm-ast` escribe los grupos que
    están dentro de una marca. Un libro con palabras marcadas no se podía guardar («cambiarían
    también los versículos…»).

  En el editor, bajo el versículo se dice que tiene una nota, qué dice, y junto a qué palabra
  quedará con el texto como va escrito en ese momento. La entrega (`patchTrunkByVerse`) copia el
  versículo con todo eso, también cuando lo tiene que componer desde su texto (`\v 10a` y
  `\v 10b`).
- **Una corrección que llega como texto corrido** (al afinar, al alinear, en la lectura grupal: quien
  corrige ve el versículo en una sola línea) se parte donde el versículo se parte, después de las
  mismas palabras (`textInLines`). Todas pasan por `saveCorrection`, que lo pide con `flat`.
- **La entrega** (`patchTrunkByVerse`) lleva al borrador del grupo el versículo con sus renglones
  y sus grupos, y deja lo que le sigue en el borrador como esté allí.
- **El paso al borrador principal** (`computePrincipalPass`) usa esa misma entrega, que compara lo
  que los versículos dicen. Un versículo que el grupo alineó después de que su texto ya estaba en
  el borrador principal dice lo mismo en los dos lados: «ya estaba», y la alineación de una tarea
  entera no llegaba. Ahora, de los versículos de la tarea que dicen lo mismo y que el borrador del
  grupo tiene alineados de otra manera, se toma el del grupo (`withAlignmentOf`), con sus renglones.
  Si el borrador del grupo no tiene alineación en un versículo, el del principal se deja: no hay
  nada que traer.
- **Un libro nuevo** (`skeletonUsfmFromSource`) nace con los capítulos, los versículos, los
  párrafos y los renglones de poesía del texto del que se traduce, y con su nombre en el idioma del
  equipo (`\h`, `\toc1`–`\toc3`, `\mt`), y con sus trozos. No copia los títulos del original.

**Pruebas.** `npm run verify:usfm-poetry` recorre todo esto con Jonás 2 (leer, guardar, corregir,
entregar, empezar el libro) y, si `../usfm-ast` está al lado, con el Jonás entero de un equipo:
cambiar una palabra de 2:2 no cambia ninguna otra línea de los otros 47 versículos.
`npm run verify:usfm-notes` hace lo mismo con una nota y con palabras marcadas: una palabra
cambiada antes de la nota, después y debajo de ella, la palabra marcada cambiada o quitada, con y
sin alineación, en un versículo de varios renglones, en la entrega, y con el Judas que publica
unfoldingWord (cambiar una palabra de 1:5 conserva su nota y no toca ningún otro versículo). En
cada caso comprueba que el resto del libro quedó igual, byte por byte.
`npm run verify:alignment-store` alinea versículos de un libro en traducción (prosa, poesía, una
nota, una palabra marcada, sus trozos) y de tres archivos reales (el Judas del ULT, el Jonás de un
equipo hecho con translationCore, los salmos 3, 4 y 11 del ULT): el resto del libro queda igual,
byte por byte. `npm run verify:principal-pass` pasa al borrador principal un versículo alineado
después de que su texto ya estaba allí.
`npm run verify:alignment-keep` corrige un versículo de un salmo y comprueba que su título, y el
del salmo siguiente, conservan sus enlaces, y que un título en medio de un versículo no se queda
con el de una palabra que repite. En `usfm-ast`, `alignment-real-books.test.ts` escribe de vuelta
seis libros enteros (entre ellos los salmos 3, 4 y 11 del ULT, con sus títulos y sus «Selah») y
compara texto, grupos, atributos y estructura; `verse-reach.test.ts` y
`alignment-verse-reach.test.ts` cubren lo que es de un versículo y lo que no, y
`alignment-reconcile.test.ts` qué enlaces sobreviven a un cambio.

**No hace todavía.**

- Una nota o una marca no se pueden agregar, quitar, cambiar ni mover desde la app: solo se
  conservan. Para eso hay que editar el archivo en Door43.
- Un título en medio de un versículo, o una marca que no se cierra y no es de párrafo, se pierden
  al editar ese versículo, como antes.
- En un versículo de prosa que alguien escribe en varias líneas, el cuadro las muestra como se
  teclearon; se guarda en una.
- Un párrafo que empieza (`\p`) se ve igual que uno que sigue: solo la poesía, las listas y los
  párrafos sangrados tienen forma propia.
- El título de un salmo (el versículo 0 de su capítulo) se conserva con su alineación al guardar
  cualquier versículo, pero ninguna pantalla lo enseña: ni el editor lo ofrece para traducirlo
  (`usfmEdit` lee por `\v`), ni los paneles de texto fuente lo muestran (`verseFromSid`,
  `bookVerses`), ni se puede alinear (`loadAlineacion`). Hay que decidir dónde se traduce y se
  alinea antes de trabajar Salmos.
- Una palabra alineada dentro de un título (`\s1`) o de una nota pierde su enlace al escribirse el
  libro: no es de ningún versículo. Los textos de unfoldingWord no alinean ahí.
- Un archivo alineado que trae la marca del renglón y el número en la misma línea (`\q1 \v 1 …`,
  como los Salmos del ULT) se escribe con la marca sola en su línea: no cambia ninguna palabra,
  pero sí esas líneas, la primera vez que se guarda.

## Cómo se escriben las ayudas

Las notas y las preguntas son tablas (un archivo TSV por libro) y los artículos de la Academia y de
las palabras, un archivo Markdown cada uno. Igual que con el texto bíblico: lo que no se tocó queda
como estaba, byte por byte, y lo que se tocó, en el formato en que el recurso está escrito.

- **Una tabla se lee como Door43 la escribe** (`parseTsvTable`, `src/prep/tsv.ts`): una fila por
  línea, una tabulación entre dos celdas y nada entre comillas. Una comilla es una letra del texto.
  Se leía como un CSV: una celda que empezaba con comilla la perdía (la respuesta de Ester 9:13 en
  las preguntas del equipo) y una que no la cerraba se habría llevado las filas siguientes. Un
  archivo con comas sí se lee como CSV.
- **Guardar una fila escribe esa línea** (`applyHelpsTsvEdits`, `src/domain/helpsDraft.ts`). Las
  demás líneas quedan como se leyeron, con su fin de línea, y de la fila que se guarda solo cambia
  la celda que cambió. Antes se escribía la tabla entera a partir de lo leído: en las notas que el
  equipo tiene publicadas (14 libros, 22.280 filas), guardar una fila envolvía entre comillas, con
  cada comilla duplicada, otras 852 que nadie había tocado, y a 145 les quitaba un espacio al
  final de una celda. Lo que la persona escribe se guarda como lo escribió (`tsvCell`): con sus
  comillas, un salto de línea con sus dos letras (`\n`, como lo escriben las notas) y una
  tabulación vuelta espacio, que partiría la fila. Pasa por aquí todo lo que corrige una ayuda: el
  editor de ayudas, las correcciones al afinar y las propuestas acordadas (`saveTeamHelpsRows`).
- **La entrega de las filas de un pasaje** (`mergeTsvRows`) pone en el archivo del grupo la línea
  que el borrador tiene y deja las demás como están. La cita de una nota (`withQuote`) y la
  publicación de una unidad (`publishUnitTsv`) ya escribían así.
- **Un artículo se guarda en las líneas que su archivo tiene** (`articleAsWritten`,
  `src/domain/helpMarkup.ts`). El editor trabaja sobre un árbol que devuelve el texto sin lo que no
  cambia lo que dice, y eso era lo que se guardaba: un artículo con una palabra corregida perdía el
  fin de línea del final (102 de los 178 de la Academia que el equipo tiene publicados), los
  espacios al final de sus líneas y las líneas vacías de más. Ahora una línea que dice lo que decía
  se escribe como el archivo la tiene, con su fin de línea; también las líneas vacías entre dos
  bloques que siguen ahí, y lo que el archivo tiene antes de su primera línea y después de la
  última. Lo que alguien teclea en la fuente del artículo (dos espacios al final de una línea, otro
  número de líneas vacías) se guarda como lo tecleó. Un artículo que el equipo no tenía termina con
  un fin de línea.
- **Un renglón cortado se escribe con sus dos espacios.** En Markdown un renglón se corta con dos
  espacios al final de la línea; sin ellos, otro programa muestra las dos líneas seguidas. Así
  escriben los artículos de la Academia en inglés un poema dentro de una cita y las opciones
  «(1) …», «(2) …» de un párrafo: 433 renglones en 92 de sus 186 artículos. El árbol los leía y los
  escribía como un salto simple. Ahora los distingue (`br` con `hard`): los lee, los muestra y los
  escribe donde cortan un renglón (no junto a una línea vacía ni al final de un bloque, donde no
  son nada). Un renglón que alguien corta al escribir es uno de esos; uno que el archivo trae sin
  los dos espacios se queda como está. «Copiar el original» conserva los del original.
- **En un párrafo que es una cita, Intro es el siguiente renglón de la misma cita**
  (`MarkdownEditor`, solo en las piezas de un artículo). El navegador hacía otra cita, que se
  guardaba aparte con una línea vacía delante, y un teléfono no tiene otra tecla para un renglón.
  Dos veces Intro deja una línea vacía: otro párrafo de la cita (`>`).

**Pruebas.** `npm run verify:helps-table` (leer, guardar una fila, una fila nueva, la entrega; con
fin de línea de Windows, sin fin de línea al final, con una línea vacía en medio) y
`npm run verify:help-markup` (un artículo sin cambios, una palabra corregida, un párrafo que entra
o sale, un renglón cortado). Comprobado además, solo leyendo, con lo publicado en `es-419_gl`: 18
tablas y 465 artículos se guardan idénticos sin cambios, y con una corrección cambia una sola
línea. Y con los 186 artículos de la Academia en inglés: los 169 que el árbol entiende se guardan
idénticos, y corregir una palabra de un renglón cortado le deja su corte.

**No hace todavía.**

- Los artículos que el equipo ya tiene publicados no cortan sus renglones con dos espacios (se
  tradujeron sin ellos): un poema en una cita se ve renglón por renglón en Taller y seguido en
  otros programas. Taller no los cambia; habría que cortarlos uno por uno, o con una acción aparte.
- Fuera de una cita, Intro sigue siendo un párrafo nuevo: «(1) …» y «(2) …» quedan en dos párrafos
  y no en uno con un corte, salvo que se copie el original y se escriba encima.
- Una fila que ya estuviera guardada con comillas duplicadas se leería con ellas. No hay ninguna en
  las ramas de `es-419_tn` ni `es-419_tq`, ni en producción ni en QA (revisado el 8 de octubre de
  2026).

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
| Escribir el texto bíblico (renglones, notas y marcas, alineación, entrega, libro nuevo) | `src/domain/usfmEdit.ts`, `src/domain/verseMarkup.ts`, `src/domain/alignmentKeep.ts`, `src/domain/usfmTrunkPatch.ts`, `src/dcs/bookBootstrap.ts`, `scripts/verify-usfm-poetry.mts`, `scripts/verify-usfm-notes.mts` |
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
