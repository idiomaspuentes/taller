# Plan: ramas, trazabilidad por fase y publicación por PR

Estado: **acordado el 4 de octubre de 2026; pendiente del visto bueno para empezar por el paso 1.** Nada de esto está
implementado. Decidido: los nombres de la tabla, configurables por organización y por espacio de trabajo;
`archivo/` y `fase/` como etiquetas; las respuestas de revisión se quedan donde están.

Sale de revisar cómo la app usa las ramas de Door43 durante la fase 1 y qué rama usan las fases siguientes. El
modelo de fondo se queda (una rama de grupo por tarea, una rama de trabajo por persona y subtarea, entrega
versículo por versículo). Lo que cambia: nombres legibles y un solo esquema, limpieza al entregar, marcas por
fase, una vista de «qué cambió», y una publicación que Validación pueda revisar en un PR de verdad.

## 0. Nombres de las ramas

Hoy conviven cinco esquemas (`jud/tpl`, `t/jud/tpl`, `jud`, `w/jud/tpl/ana/160`, el anidado viejo) y las
herramientas buscan en una lista de candidatos. Propuesta: cuatro espacios con nombre, ninguno de una letra, y
ninguno que pueda chocar con otro (Git no deja crear `jud/tpl` si existe una rama `jud`; con un prefijo propio eso
no pasa nunca).

| Rama | Nombre | Ejemplo | Vive en | Quién la crea |
|---|---|---|---|---|
| Borrador del grupo (tronco de una tarea de traducción) | rama `borrador/<libro>/<tarea>` | `borrador/jud/tpl` | el repo del recurso | la app, al empezar la primera subtarea de la tarea |
| Trabajo de una persona en una subtarea | rama `trabajo/<libro>/<tarea>/<persona>/<subtarea>` | `trabajo/jud/tpl/valeska/160` | el repo del recurso | la app, al empezar la subtarea |
| Archivo de lo entregado | **etiqueta** `archivo/<libro>/<subtarea>` | `archivo/jud/160` | el repo del recurso | la app, al entregar o cerrar la subtarea |
| Marca de fase | **etiqueta** `fase/<libro>/<fase>` | `fase/jud/traduccion` | el repo del recurso | la app, al cerrar la última subtarea de la fase |
| Publicación de una unidad | rama `publicacion/<libro>/<unidad>` | `publicacion/jud/1` | el repo del recurso | la app, al empezar Validación de la unidad |
| Publicado | rama `master` | | el repo del recurso | Door43 |

- Los nombres viejos se **siguen leyendo** (la lista de candidatos queda para repositorios antiguos) pero **no se
  crean más**. Hoy no hay ningún libro con ramas en QA (Judas aún no tiene ninguna) ni producción accesible, así
  que no hace falta migrar nada.
- `archivo/` y `fase/` son **etiquetas** (tags), no ramas: son instantáneas que no se editan, y así no engordan la
  lista de ramas de Door43. Volver a apuntar una (una subtarea que se entrega otra vez) es borrarla y crearla; la
  API de Door43 permite las dos cosas (`POST`/`DELETE /repos/{owner}/{repo}/tags`). Todo lo que hoy las lee por
  nombre de ref funciona igual. Las ramas `archivo/…` de libros anteriores se siguen reconociendo.

### Los nombres son configurables

Los cinco prefijos van en `taller.config.ts`, con estos valores por defecto y la posibilidad de cambiarlos por
espacio de trabajo:

```ts
branchNames: { draft: "borrador", work: "trabajo", archive: "archivo", phase: "fase", publish: "publicacion" }
```

- Un espacio de trabajo puede dar los suyos (`workspaces[].branchNames`); el que no diga nada usa los de la
  organización. El espacio en portugués podría usar `rascunho`, `trabalho`, `arquivo`, `fase`, `publicacao`.
- Reglas: minúsculas, letras, números y guion; sin barras; los cinco distintos entre sí. `verify:config` lo
  comprueba, y una configuración inválida impide arrancar como hoy un paquete de proceso inválido.
- **Cambiarlos cuando un libro ya tiene ramas no está soportado**: la app crea con los nombres configurados y lee
  con esos más los esquemas antiguos de fábrica; un prefijo cambiado a mitad de libro deja ramas que nadie busca.
  Se dice en `docs/CONFIGURACION.md`.
- La comprobación que hoy se niega a tocar cualquier ref fuera de `archivo/` (`isArchiveRefName`) pasa a usar el
  prefijo configurado, y lo mismo para `trabajo/` al borrar ramas de trabajo.

### Para qué sirve `archivo/`

Al entregar una porción de texto, el tronco no recibe una fusión de Git: se copian solo los versículos que
cambiaron y el PR se cierra sin fusionar, así que la historia del tronco nunca apunta a los commits de quien
tradujo. `archivo/<libro>/<subtarea>` es el único puntero con nombre a **exactamente lo que esa persona
entregó**: el archivo completo tal como lo dejó, sus commits, quién y cuándo. Hoy lo usan la resolución de
conflictos de versículo (`verseChoice.ts` lee cada versión de su archivo), la conversación de la subtarea y el
comentario de entrega; y es la red de seguridad si la copia por versículos saliera mal. Se fija **antes** de
cerrar el PR: si no se puede fijar, la entrega falla y la subtarea sigue abierta. Con este plan pasa además a ser
la base de «qué cambió desde que se entregó» y se extiende a las subtareas que trabajan sobre el tronco.

## 1. Un solo esquema, y la tarea declara si tiene borrador

**Qué.** Leer los prefijos de la configuración (`branchNames`, con los valores por defecto de arriba) y generar
solo los nombres de la tabla; resolver los viejos solo para leer. Y cambiar la regla de «qué
tarea tiene borrador propio»: hoy es «todos sus pasos se cierran en su herramienta», una heurística que creó
`hag/alinear-tpl`. La regla pasa a ser: **una tarea tiene borrador propio si es la tarea de traducción de su
recurso** (`draftTaskId(teams, resource) === task.id`); cualquier otra tarea del mismo recurso (revisión grupal,
desafíos, palabras clave, alinear, armonizar) trabaja sobre ese tronco y nunca abre PR ni tronco propio.

**Dónde.** `src/config/types.ts` y `taller.config.ts` (`branchNames`, por organización y por espacio),
`src/domain/branchNames.ts` (nuevo: los nombres a partir de la configuración, y la lista de lectura con los esquemas
antiguos), `src/domain/portionPr.ts` (hoy `bookBranchName`, `taskTrunkBranchName`, `portionPrBranchName`,
`archiveRefName`, `isArchiveRefName`, `taskWorksOnSharedDraft`: pasan a leer de `branchNames`),
`src/dcs/bookBootstrap.ts` (`resolveBookBranchName`: candidatos), `src/dcs/portionPr.ts` (`ensurePortionPr`),
`src/dcs/afinacionLoad.ts` (`groupDraftBranches`), `src/dcs/teamHelps.ts`, `src/dcs/refRepair.ts`,
`src/components/QaAdminDialog.tsx`, `src/components/ScriptureEditorView.tsx`, `docs/CONFIGURACION.md`.

**Pruebas.** `verify-config` (prefijos válidos, distintos, por espacio), `verify-portion-pr` (nombres nuevos, viejos
solo de lectura), prueba nueva `verify-branch-names` (cada tarea del FCR: cuál tiene borrador y cuál no; ninguna
crea tronco para Afinación; con otros prefijos configurados salen otros nombres), `verify-decoupling`.

**Riesgo.** Bajo: no hay ramas que migrar. Hay que revisar `QaAdminDialog` y el reparador de refs
(`refRepair.ts`), que conocen los nombres viejos.

**Resuelve:** nombres legibles; punto 4 (un esquema); punto 6 (`hag/alinear-tpl`).

## 2. Limpieza al entregar, y archivo de toda entrega

**Qué.**
- `archivo/` pasa a ser una **etiqueta**: se crea con `POST /repos/{owner}/{repo}/tags` apuntando al commit; para
  volver a apuntarla se borra y se crea. Las ramas `archivo/…` de libros anteriores se siguen leyendo.
- Al entregar una subtarea con rama de trabajo: después de fijar la etiqueta y cerrar el PR, **borrar la rama de
  trabajo**. Hoy quedan las dos apuntando al mismo commit (visto en Hageo: `w/hag/tpl/valeska/86` y
  `archivo/hag/86`).
- **Archivar también las subtareas que no tienen rama de trabajo** (revisión grupal, Afinación, Armonización): al
  cerrarlas, fijar `archivo/<libro>/<subtarea>` al commit del tronco en ese momento. Así toda subtarea deja «cómo
  estaba el texto cuando esta subtarea terminó», que es lo que necesita la vista del paso 4.
- Si una rama de trabajo quedó sin PR (subtarea devuelta, persona que la soltó): borrarla al reasignar; la nueva
  persona empieza del tronco.

**Dónde.** `src/dcs/pulls.ts` (`ensureArchiveRef`: etiquetas; `deleteGitRef` ya existe, hoy solo borra refs viejas),
`src/dcs/portionPr.ts` (`mergePortionPrIfOpen`, `closeOwnedPortionPrIfSafe`), `src/dcs/closeSubtask.ts` (rama
compartida: fijar archivo), `src/dcs/issues.ts` (`unclaimIssue`), `src/dcs/verseChoice.ts` y
`src/dcs/scriptureThread.ts` (leen el archivo: por nombre de ref, sirve igual), `src/dcs/branchList.ts`
(`knownBranches` debe incluir etiquetas donde se busque un archivo).

**Pruebas.** `verify-portion-pr`: tras entregar queda la etiqueta `archivo/` y no queda `trabajo/`; cerrar una
subtarea de Afinación fija `archivo/` al tronco; una re-entrega vuelve a apuntar la etiqueta.

**Riesgo.** Borrar una rama es definitivo; se borra **solo después** de comprobar que la etiqueta `archivo/` apunta
al mismo commit. Si fijar el archivo falla, no se borra nada (ya es así para cerrar). Si la organización tuviera
etiquetas protegidas con ese patrón, la creación fallaría y la entrega no se completaría: se comprueba en QA y se
documenta.

**Resuelve:** punto 3 (higiene).

## 3. Marcas de fase

**Qué.** Cuando se cierra la **última subtarea de una fase para un libro**, fijar la **etiqueta** `fase/<libro>/<fase>`
al commit del tronco de cada recurso de esa fase (`fase/jud/traduccion` en `es-419_glt`, `es-419_gst`, `es-419_tn`,
…). Si la fase se reabre y se vuelve a cerrar, se vuelve a apuntar (borrar y crear).

**Límite, dicho de antemano.** Las fases se encadenan **por capítulo**: Afinación del capítulo 1 escribe en el
tronco mientras Traducción del capítulo 2 sigue entregando en el mismo tronco. Por eso la marca de fase es del
**libro entero** (cuando toda la fase cerró) y sirve para dos cosas: la base del PR de publicación y volver atrás.
El «qué cambió» fino (por porción) no sale de la marca sino de los archivos del paso 2.

**Dónde.** Un gancho donde ya se detecta el cierre (`src/dcs/notices.ts` escucha `closeIssue`; conviene un módulo
hermano `src/dcs/phaseMarks.ts`), `src/domain/waits.ts` o un `phaseProgress.ts` para «¿quedó alguna subtarea
abierta de esta fase y libro?».

**Pruebas.** Prueba nueva: con las subtareas de un libro, cerrar la última de Traducción pide la marca; cerrar una
que no es la última, no.

**Riesgo.** Bajo. Si una subtarea se reabre después, la marca queda vieja: se vuelve a fijar al cerrar de nuevo.

**Resuelve:** punto 1 (mitad).

## 4. Vista «Qué cambió»

**Qué.** Que se pueda ver lo que cada fase cambió, sin PR:
- **Por subtarea cerrada**, en su conversación y en la pestaña **Versiones** del proyecto: la diferencia entre su
  `archivo/` y el tronco de hoy, limitada a su porción (versículos, notas o artículos). Para una subtarea de
  Traducción eso es «lo que Afinación y Armonización le cambiaron después».
- **Por fase**, en Versiones: entre `fase/<libro>/<fase anterior>` y `fase/<libro>/<fase>` (o el tronco de hoy, si
  la fase está abierta), por capítulo.
- **En las herramientas de Afinación y Armonización** (opcional, segundo tiempo): junto a cada versículo o nota, una
  marca «cambió desde que se entregó», con el antes y el después a un toque.

Reutiliza `diffWords` y los lectores de porción que ya tiene `PortionReviewView`.

**Dónde.** `src/components/ProjectPlanView.tsx` (pestaña Versiones), `src/domain/reviewItems.ts`, un
`src/dcs/changesSince.ts` que lea dos refs y recorte a la porción.

**Pruebas.** Prueba de dominio sobre textos de ejemplo: qué versículos cambiaron entre dos estados, recortado a
una porción; lo mismo con filas TSV.

**Resuelve:** punto 1 (la otra mitad).

## 5. Publicación por un PR que Validación revisa

**Hoy.** `publishUnit` crea por cada unidad una rama desde `master` con los archivos de la unidad, abre un PR y lo
fusiona en el acto. El PR existe pero nadie lo ve antes de fusionarse. Validación aprueba en la app (el aval), no
sobre el PR.

**Qué.**
- Al **empezar Validación** de una unidad: crear `publicacion/<libro>/<unidad>` desde `master` con los archivos de
  la unidad tomados del tronco (lo que hoy hace `publishUnit` al final), y abrir el PR hacia `master` **sin
  fusionarlo**. El PR enlaza la subtarea de Validación y muestra la diferencia completa frente a lo publicado.
- La herramienta de **Validar** trabaja con ese PR a la vista: cada aprobación del aval se refleja como revisión
  aprobada en el PR (ya hay `portionPrApprovalReviewBody`); una objeción, como comentario.
- Si el tronco cambia después de abierto el PR (Armonización corrigió algo tras una objeción): la app vuelve a
  copiar la unidad sobre `publicacion/…` y el PR se actualiza solo.
- **Publicar** fusiona el PR. Si la rama está protegida, queda abierto para quien pueda, como hoy.
- Se mantiene la publicación **por unidad** (capítulo o tramo): un PR único de `borrador/jud/tpl` a `master` no
  sirve, porque publicaría capítulos a medio afinar.

**Dónde.** `src/dcs/unitPublish.ts` (`publishUnit` se parte en «preparar» y «fusionar»), `src/dcs/release.ts`,
`src/components/EndorsementView.tsx` (Validar), `src/components/PublishUnitView.tsx`, el paquete `processes/fcr.json`
(la herramienta `fcr-aval` recibe el PR por `stepParams`, sin que la app conozca el proceso).

**Pruebas.** `verify-unit-publish`: preparar abre el PR sin fusionar; publicar fusiona; un cambio del tronco
después de preparar actualiza la rama de publicación; una unidad ya publicada no vuelve a abrir PR.

**Riesgo.** Medio. Es el cambio con más partes móviles y toca la salida a `master`. Se prueba en QA con Judas
(un capítulo, una unidad) antes de publicar la app.

**Resuelve:** punto 2.

## 6. Dónde viven las respuestas de revisión (decidido: se quedan)

Las respuestas de Afinación (`checkings/decisions/<LIBRO>.<persona>.decisions.json`, `checkings/preferred-terms.json`,
propuestas y resultados de alineación) se guardan en el tronco del **repositorio de contenido**. Con la publicación
por unidad (paso 5) nunca llegan a `master`. **Se quedan ahí.** Moverlas al repositorio del plan sería una migración
de tres almacenes sin ganancia visible para el equipo; si algún día se quieren los repositorios de contenido limpios
de metadata, se hace entonces.

## 7. Documentos

`docs/MODELO.md` (§ «Un PR por subtarea» y rutas: aún dice `tas/{projectId}/{taskId}/{issueNumber}`) y
`docs/PLATAFORMA.md` describen el esquema anterior. Se reescriben con la tabla del punto 0 y el recorrido de una
porción por las fases (borrador → trabajo → archivo → tronco → marca de fase → publicación → master).

## Orden y dependencias

```
1 nombres y regla de borrador  ──►  2 limpieza y archivo de toda entrega  ──►  4 vista «qué cambió»
                                ──►  3 marcas de fase                       ──►  5 publicación por PR
7 documentos: al final de cada paso que cambie lo que describen
```

Tamaño aproximado, en sesiones de trabajo: 1 → una; 2 → una; 3 → media; 4 → una y media; 5 → dos; 7 → media.

## Decisiones tomadas (4 de octubre de 2026)

1. Los nombres del punto 0, **configurables** por organización y por espacio de trabajo.
2. `archivo/` y `fase/` son **etiquetas**.
3. Las respuestas de revisión **se quedan** en el repositorio de contenido.
4. El orden es el del plan: se empieza por el paso 1.

Pendiente: el visto bueno para empezar.
