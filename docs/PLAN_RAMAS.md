# Plan: ramas, trazabilidad por fase y publicación por PR

Estado: **en marcha (4 de octubre de 2026).** Hechos y probados en QA con Judas: el **paso 1** (nombres legibles y
configurables; solo la tarea de traducción tiene borrador) y el **paso 2** (archivo como etiqueta, la rama de trabajo
se borra al entregar, archivo de las subtareas sobre el borrador del grupo). Hecho con pruebas automáticas, sin
verlo aún en QA (hace falta cerrar una fase entera de un libro): el **paso 3** (marcas de fase). Hecho y visto en QA
con Judas: el **paso 4** («Qué cambió» por fase y por subtarea; sin la marca dentro de las herramientas). Hecho, con una
prueba de punta a punta contra el Door43 simulado y sin recorrerlo aún en QA: el **paso 5** (rama de validación por
unidad, correcciones como subtareas, publicar = fusionar y crear la versión). Hecho el **paso 7** (`MODELO.md` y `PLATAFORMA.md` al día).
El plan está completo; queda recorrer en QA lo que aún no se vio (pasos 3 y 5) y publicar la app. Decidido:
los nombres de la tabla, configurables por organización y por espacio de trabajo; `archivo/` y `fase/` como
etiquetas; las respuestas de revisión se quedan donde están.

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

**Como quedó.** La entrega de la subtarea 159 de Judas en QA dejó la etiqueta `archivo/jud/159` en el commit del
trabajo, el PR cerrado, los versículos en `borrador/jud/tpl` y ninguna rama `trabajo/…`. Volver a entregar una
subtarea ya cerrada lee el trabajo de su etiqueta. El archivo de una subtarea sobre el borrador del grupo y la
limpieza al devolver una subtarea **no detienen** el cierre ni la devolución si fallan: solo dejan esa subtarea sin
marca. Al devolver una subtarea sin revisión abierta, lo que tenía la rama queda en la etiqueta y quien la tome
(aunque sea la misma persona) empieza del borrador del grupo.

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

**Como quedó.** `src/domain/phaseMarks.ts` decide si la subtarea que se cierra era la última de su fase para su
libro (las subtareas de otro libro del mismo proyecto no cuentan) y `src/dcs/phaseMarks.ts` fija la etiqueta en el
borrador de cada recurso de la fase; un recurso sin borrador en ese libro se salta. Se llama después de cerrar, desde
«Entregar» y desde el paso automático de Publicar, y si falla no deshace el cierre. `npm run verify:phase-marks`.

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

**Como quedó.** `src/domain/changesSince.ts` (qué piezas cambiaron entre dos estados; un versículo se compara por
sus palabras, así que alinearlo no cuenta como cambio) y `src/dcs/changesSince.ts` (lee los dos estados).
`src/components/ChangesView.tsx` lo muestra plegado y solo lee al abrirlo: en **Versiones**, una fila por fase; en la
**conversación de una subtarea cerrada**, «Qué cambió desde que se entregó». Una fase abierta cuya fase anterior
tampoco cerró no se puede separar y lo dice. Quedan fuera: los artículos de Palabras y Academia (un archivo cada
uno, no se comparan por piezas) y la marca «cambió desde que se entregó» dentro de las herramientas de Afinación y
Armonización, que era opcional. `npm run verify:changes-since`.

**Resuelve:** punto 1 (la otra mitad).

## 5. Rama de validación por unidad; `master` solo recibe lo avalado; publicar es el release

**Replanteado el 4 de octubre de 2026**, dos veces. El plan original trataba «llegar a `master`» como publicar. No
lo es: **publicar es hacer el release** de `master`. Y como un release lleva todo lo que hay en `master`, **a
`master` solo puede llegar lo que el comité ya avaló**. Por eso lo que Armonización termina no va a `master` sino a
una rama de validación de esa unidad.

**Hoy.** La herramienta del paso «Publicar» del FCR (`fcr-publicar`, `publishUnit`) copia la unidad del borrador del
grupo a `master` y lo llama «Unidad publicada»: ese es el error. El release de verdad lo hace aparte «Publicar
versión» (`src/dcs/release.ts`), en Versiones. Validación lee del borrador del grupo.

**Qué.**
- **Armonización termina una unidad → la unidad pasa sola a su rama de validación** en cada recurso:
  `validacion/<libro>/<unidad>` (`validacion/jud/1`), creada desde `master` con solo esa unidad encima, y con una
  solicitud abierta hacia `master` sin fusionar. Ocurre al cerrar la última subtarea de Armonización de la unidad,
  con la cuenta de quien la cierra (que sí puede escribir). Las comprobaciones que hoy corren antes de «Publicar»
  (versículos completos, alineación, tablas válidas) corren aquí.
- **Validación lee de la rama de validación** de cada repositorio y muestra los recursos juntos para el capítulo o
  la porción, como tC Study pero de un libro y sin release, con lo que cambia frente a `master` a la vista (la
  comparación del paso 4). Nadie necesita permiso de escritura para validar.
- **Lo que el comité anota se devuelve al equipo que corresponde:** Afinación para el TPL y el TPS, Armonización para
  las ayudas. La corrección queda en la rama de validación, para que el comité la vuelva a ver. El equipo corrige
  con sus herramientas de siempre, que escriben en el borrador del grupo; al cerrar la corrección la app vuelve a
  copiar la unidad a la rama de validación. Así el borrador y la rama de validación nunca dicen cosas distintas.
- **El paso «Publicar» del FCR**, con todo avalado: fusiona la rama de validación en `master` y **hace el release**.
  Si `master` está protegida, la solicitud queda abierta para quien pueda confirmarla.
- En `branchNames`, la palabra `publish` (`publicacion`) pasa a ser `validation` (`validacion`): es lo que la rama es.

**Decidido (4 de octubre de 2026).**
- **Una anotación del comité es una subtarea de corrección** para la tarea que mantiene ese recurso (la última que
  lo trabajó antes de validar), sobre el pasaje de la unidad. Queda en el plan como subtarea añadida a mano.
- **Si la unidad no pasa las comprobaciones** al cerrar Armonización, la subtarea se cierra igual, la unidad no pasa
  a validación y en la conversación de la subtarea de validación queda escrito qué falta, para quien coordina cada
  recurso.
- **Un release por unidad avalada.** `master` solo tiene lo avalado, así que cada release es seguro.

**Como quedó.**
- La herramienta del comité declara en el paquete `stagesUnit` (qué recursos lleva la unidad y cuáles deben estar
  alineados); el motor no sabe qué tarea valida. `src/domain/unitStage.ts` dice qué unidades toca llevar al cerrar
  una subtarea: las de una tarea de validación del mismo libro y capítulo que ya nada detiene. Eso cubre la llegada
  (cierra el último trabajo antes de validar) y la renovación (cierra una corrección).
- `src/dcs/unitPublish.ts`: `stageUnit` (rama de validación + solicitud abierta, sin tocar `master`) y `publishUnit`
  (vuelve a llevarla y fusiona). `src/dcs/release.ts`: `releaseUnit` (una versión por repositorio de la unidad;
  reintentar no crea otra; algo nuevo el mismo día es «· 2»).
- Validar muestra «Qué cambia respecto a lo publicado», comparando lo publicado con la unidad del borrador del grupo
  (lo mismo que la app copia a la rama de validación), así que quien solo puede leer valida igual. Quien puede
  escribir renueva la rama al abrir la pantalla. El enlace a la solicitud de Door43 queda pequeño, al final.
- «Dejar pendiente y pedir las correcciones» crea las subtareas (`src/dcs/corrections.ts`) y las lista en la
  conversación de la unidad.
- El paso Publicar fusiona y crea la versión; si la versión falla, el mismo botón la termina.
- «Publicar versión» de la pestaña Versiones (un release del libro entero, por perfil) sigue como estaba.

**Sin resolver.**
- Una corrección del TPL o el TPS se abre con las herramientas de la tarea de Afinación que la recibe, con todos
  sus pasos. Puede ser mucho para corregir una palabra: se revisa con la plantilla de la fase 2.
- Una corrección de Afinación abierta no detiene al comité (Validar solo espera a Armonización); la unidad se
  renueva cuando se cierra.
- El aval no se anota todavía como revisión aprobada en la solicitud de Door43.

**Dónde.** `src/config/types.ts`, `taller.config.ts` y `src/domain/branchNames.ts` (`validation`),
`src/dcs/unitPublish.ts` (`publishUnit` se parte en «llevar la unidad a validación» y «fusionar en `master`»),
`src/dcs/closeSubtask.ts` y `src/domain/phaseMarks.ts` (saber que la unidad terminó Armonización, o una corrección),
`src/components/EndorsementView.tsx` (leer de la rama de validación, recursos juntos, anotar),
`src/components/PublishUnitView.tsx` y `src/dcs/release.ts` (el paso Publicar fusiona y hace el release),
`processes/fcr.json` (la tarea `publicar`, sus pasos y botones; qué fase lleva a validación, como dato del paquete
y no del código), `src/i18n/locales/*.json` («publicar» deja de decirse de lo que no es el release).

**Pruebas.** `verify-unit-publish`: cerrar la última subtarea de Armonización de una unidad crea su rama de
validación con esa unidad y nada más; cerrar una que no es la última, no; una corrección cerrada actualiza la rama;
`master` no cambia hasta Publicar; Publicar fusiona y crea el release.

**Riesgo.** Medio-alto. Cambia el proceso (la plantilla), tres pantallas y la salida a `master`. Se prueba en QA
con Judas antes de publicar la app.

**Resuelve:** punto 2, y el error de llamar publicar a lo que no lo es.

## 6. Dónde viven las respuestas de revisión (decidido: se quedan)

Las respuestas de Afinación (`checkings/decisions/<LIBRO>.<persona>.decisions.json`, `checkings/preferred-terms.json`,
propuestas y resultados de alineación) se guardan en el tronco del **repositorio de contenido**. Con la publicación
por unidad (paso 5) nunca llegan a `master`. **Se quedan ahí.** Moverlas al repositorio del plan sería una migración
de tres almacenes sin ganancia visible para el equipo; si algún día se quieren los repositorios de contenido limpios
de metadata, se hace entonces.

## 7. Documentos

Hecho. `docs/MODELO.md` tiene la sección «Ramas y etiquetas en los repositorios de contenido» (la tabla de nombres y
el recorrido de una porción, de la traducción a la versión) y `docs/PLATAFORMA.md` remite a ella. Lo demás de esos
dos documentos sigue siendo de una etapa anterior de la app y no se revisó aquí.

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
