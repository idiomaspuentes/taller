# Procesos: cómo se le dice a Taller cómo trabaja un equipo

Taller no trae ningún proceso dentro del código. Un **proceso** (para Idiomas Puentes, el FCR) es un
archivo JSON en `processes/`, y `taller.config.ts` dice cuáles usa la organización:

```ts
import fcr from "./processes/fcr.json";

export const tallerConfig = {
  // …
  processes: [fcr],
};
```

Para trabajar con otro proceso se escribe otro archivo y se agrega a esa lista. No hay que tocar
`src/`. La prueba `npm run verify:decoupling` falla si el código vuelve a nombrar una plantilla, una
fase, una tarea, un paso o una herramienta de un proceso.

## Dos formas de configurar un proceso

| | Dónde vive | Quién lo cambia | Para qué |
|---|---|---|---|
| **El paquete** | `processes/*.json`, en el repositorio de la app | Quien mantiene la app | Las plantillas y herramientas de fábrica, con sus nombres en cada idioma |
| **Desde la app** | `workflows.json` y `solvers.json`, en el repositorio de tareas de la organización en Door43 | Quien coordina, en **Plantillas** | Copias propias: se copia una plantilla incluida o se empieza de cero, y se ajusta (ver `docs/PROYECTOS.md`) |

Un proyecto guarda una **copia** de la plantilla con la que se creó. Cambiar la plantilla no cambia
los proyectos ya creados.

## Qué trae un paquete

```json
{
  "schema": "taller-process-1",
  "id": "fcr",
  "workflows": [ … ],
  "tools": [ … ],
  "glossary": { "pt": { "Cierre independiente": "Fechamento independente" } }
}
```

### `workflows`: las plantillas

Cada plantilla tiene `id`, `name`, `version`, `phases` y `tasks`.

**Una tarea** (`tasks[]`):

| Campo | Qué dice |
|---|---|
| `id`, `name`, `names` | Identificador estable, nombre y nombre en otros idiomas (`{ "pt": "…" }`) |
| `phaseId` | Su fase |
| `rules` | Sobre qué recurso trabaja |
| `minLevel` | Nivel mínimo para tomarla |
| `waitsFor` | Qué espera: una tarea (`taskId`) o una fase (`phaseId`), y con qué alcance |
| `solverAppId` | Herramienta de toda la tarea, si no tiene pasos |
| `steps` | Sus pasos, en orden |

**Un paso** (`steps[]`):

| Campo | Qué dice |
|---|---|
| `id`, `name`, `names` | Identificador estable y nombre, por idioma |
| `actionLabel`, `actionLabels` | Lo que dice el botón grande («Revisar», «Grabar»). Sin él, la app dice «Empezar» o «Seguir» |
| `solverAppId` | La herramienta que abre |
| `checks` | Lo que la persona comprueba en su propio trabajo antes de entregar el paso: una lista corta que marca para sí (`id`, `text`, `texts` por idioma). Con `when` (palabras de la fuente: enteras, sin importar mayúsculas; `walk*` y `*ed` para el principio o el final de una palabra; `#` para cualquier número; `Aa` para un nombre propio) solo aparece en un pasaje cuya fuente tenga alguna. Recuerda; no cierra el paso |
| `claimMode` | Quién lo toma: `none` (quien tiene la tarea), `exclusive` (una persona), `pool` (varias) |
| `minAssignees`, `maxAssignees`, `minIndependent` | Cuántas personas, y cuántas no deben haber escrito el texto (`pool`) |
| `excludeIssueAssignee`, `excludePriorStepIds`, `includeAuthorInApproval` | Quién no puede tomarlo, y si el autor también confirma |
| `closing` | Cómo se completa: `self`, `approval`, `consensus`, `checklist`, `automatic` |
| `articleFocus` | Los títulos de la sección de un artículo de que trata el paso («Sugerencias de traducción»): el artículo se muestra desde ahí |
| `checklist` | Las preguntas de sí o no de un paso `checklist` (`id`, `text`, `texts`, `per`; `when`: la pregunta solo se hace en los ítems cuyo texto trae uno de esos textos; `linked: true`: solo en los que enlazan un artículo; `about`: frente a qué recurso se lee, ver «Una lista en grupos»; `articleFocus`: la sección del artículo que se abre con ella) |
| `scope` | Qué cubre: una subtarea, la unidad completa (`unit`), o un capítulo una vez por persona (`chapter-once`) |

Los **ids no se cambian nunca**: las subtareas y su avance en Door43 los usan. Los nombres sí se
pueden cambiar.

### `tools`: las herramientas

Lo que un paso puede abrir: una pantalla de Taller o un sitio de fuera.

| Campo | Qué dice |
|---|---|
| `id`, `name`, `description` | Identificador y nombre |
| `launchUrl` | Adónde va, con marcadores como `{context}`, `{book}`, `{chapter}` |
| `resources` | Para qué recursos sirve |
| `kind`, `openMode`, `lang` | Pantalla de la app o sitio externo, y en qué idioma lee un sitio externo |
| `needsIssue` | Necesita una subtarea real (no se puede probar en el laboratorio) |
| `stepParams` | Parámetros extra según el paso: una misma pantalla sirve a dos pasos (`{ "revisar-alineacion": { "mode": "revisar" } }`) |
| `supersedes` | Trozos de direcciones viejas: la copia guardada de una organización se pone al día sola |
| `walks` | Qué recorre una persona, uno por uno, en la herramienta: `unit` (`verses`, `notes`, `questions` o `items`), `times` (cuántos hay por cada uno, si el libro no lo dice), `approx` y `label` / `labels` (cómo los llama). Con eso se calcula la carga de un paso; ver «Carga por persona» |
| `sources` | Contra qué fuentes se trabaja en ella, cuando lee más que lo que traduce: `ult`, `ust`, `tn`, `tq`, `twl`, `tw`, `ta`, `original`. Al cerrarse un paso que la abre, se anota la versión de cada una (ver `docs/PLATAFORMA.md` § «Con qué versión de las fuentes se hizo cada paso»). Sin este campo, se anota la fuente del recurso de la tarea |
| `stagesUnit` | La herramienta trabaja sobre la unidad **en validación**: `resources` (qué recursos de la unidad se llevan a la rama de validación) y `aligned` (qué textos deben estar alineados antes). Cuando una subtarea de una tarea que abre esta herramienta ya puede empezar, la app lleva sola su unidad a `validacion/<libro>/<unidad>`; ver `docs/PLAN_RAMAS.md` § 5 |

### Carga por persona: cómo se ve un proceso mal repartido

Un proceso puede estar bien armado y aun así repartir mal el trabajo: una persona sola con 110 términos mientras
otras tres esperan. Eso solo se ve cuando el proceso se encuentra con un libro, así que se calcula ahí
(`src/domain/processLoad.ts`): para cada paso, cuántas personas lo toman, cuánto mide su subtarea más grande y
cuántas personas esperan a que termine.

- **Dónde se ve:** en «Subtareas que se crearán», antes de crear el proyecto, y en la pantalla «Subtareas» de un
  proyecto. Arriba, en rojo, los pasos que cargan demasiado a una persona; dentro de cada tarea, la carga de cada
  paso.
- **Las reglas:** ningún paso que toma **una sola persona** debe pasar de **40 ítems** en una subtarea, y no deben
  quedar **más de 2 personas** esperando a una. Una organización cambia esos números con `workLoad` en
  `taller.config.ts`.
- **Cuánto mide una subtarea:** lo que su herramienta dice que recorre (`walks`); si no lo dice, de qué está hecha
  la subtarea: los versículos de un texto, las notas o las preguntas de sus pasajes, sus artículos.
- **Qué no cuenta:** un paso que se hace una vez por capítulo o por unidad, una lista de comprobación y un paso
  que completa su herramienta sola.
- **Con el proyecto en marcha solo pesa lo asignado sin entregar.** Antes de crear el proyecto la carga de un paso
  es su subtarea más grande: lo que le podría tocar a una persona. Una vez creado, cuenta lo que cada persona
  tiene de verdad: para un paso de una sola persona, todo lo que tiene asignado y no ha entregado, sumando sus
  subtareas. Lo entregado no es carga de nadie, y lo que nadie ha tomado todavía tampoco.
- **La prueba:** `npm run verify:process-load` corre las reglas sobre el proceso de fábrica con un libro del
  tamaño de Hageo y guarda la lista de lo que hoy se marca. Un cambio al proceso que agregue una línea a esa lista
  es una decisión que alguien toma, no algo que se cuela.

### `glossary`: nombres de planes antiguos

Los proyectos y los títulos de las subtareas guardan nombres como texto. Si un nombre cambió o se
quitó de la plantilla, el glosario del paquete permite seguir mostrándolo en otro idioma.

## Comprobar un paquete

```bash
npm run verify:templates    # el paquete está bien formado, completo en cada idioma, y recorre el motor
npm run verify:decoupling   # el código no nombra nada del proceso
```

`verify:templates` incluye un proceso inventado de **grabación de audio** que no existe en la app:
si el motor lo acepta y lo recorre, el motor es genérico.

Un paquete con errores no se arregla en silencio: en desarrollo la consola dice qué está mal, con
frases como «tarea «Validar»: espera a la fase «x», que no existe».

## Lo que el paquete todavía no puede cambiar

Lo que sigue dentro del código, y en qué fase del plan sale
([PLAN_PLANTILLAS.md](PLAN_PLANTILLAS.md)):

| Qué | Dónde está | Cuándo sale |
|---|---|---|
| **Los recursos** (TPL, TPS, notas, preguntas, palabras, academia) y que el trabajo se reparta en porciones de un libro de la Biblia | `ScopeKey`, el inventario, `workOrder.ts` | Fase 8, «tipo de trabajo» |
| **Las pantallas de las herramientas** (editor de texto, ayudas, afinación, alineación). El paquete elige cuáles usa y cómo se llaman; las pantallas son código | `src/components/*View.tsx` | Se agregan pantallas nuevas según haga falta; una herramienta externa no necesita código |
| **Los cuatro niveles** y sus nombres. Quién tiene cada nivel sí es dato: se asigna por equipo en Organización | `levels.ts` | Fase 8 |
| **El motor todavía no obedece `closing`, `checklist` ni `scope`**: los lee, los valida y los guarda, pero un paso se sigue completando con «Terminé» o «Aprobar» | `stepClaim.ts` | Fases 3 a 5 |
| **Publicar una versión** del texto | `PublishView`, `release.ts` | Fase 6 |
| Textos de ayuda en español dentro del modelo | `types.ts` | Fase 8 |

## Ajustes agregados el 2 de octubre de 2026

| Dónde | Campo | Qué dice |
|---|---|---|
| Plantilla | `resourceNames` | Cómo llama el proceso a cada recurso: `{ "tpl": { "name": "Biblia", "names": { "pt": "Bíblia" } } }`. Se copia al proyecto; lo que no se nombra conserva el nombre usual. |
| Plantilla | `nextBookAt` | Qué parte de la primera fase debe estar entregada (entre 0 y 1) para avisar a quien coordina de empezar el libro siguiente. Si no se dice, 0.7. |
| Tarea | `redoAfter: ["tpl"]` | Los recursos cuyo texto, **al corregirse**, piden a esta tarea volver a mirar los versículos que cambiaron. Una revisión de un texto nombra ese texto; armonizar las ayudas y avalar nombran todos los textos contra los que se leen. Ver «Cuando se corrige un texto ya revisado». |
| Tarea | `everyUnit: true` | La tarea recorre **cada unidad** de su alcance (cada capítulo o tramo), tenga o no artículos pendientes. Para revisiones de lo que ya existe. |
| Tarea | `waitsFor[].source: true` | La tarea que se espera es del **proyecto fuente**: el mismo libro, en la organización del paquete de recursos de origen. Libre solo cuando ese proyecto la cerró para el mismo capítulo. |
| Tarea | `waitsFor[].partial: true` | Basta **una parte** de lo esperado para empezar: la tarea queda libre cuando se cierra la primera porción de las que cubre, y sigue mientras llega el resto. Varias reglas parciales cuentan juntas (basta lo de cualquiera). Cuándo se puede terminar lo decide la herramienta. |
| Paso | `closing: "automatic"` | Lo completa su herramienta, sin que nadie lo marque. Una tarea con todos sus pasos automáticos se entrega sola. |
| Herramienta | `stepParams.<paso>.only: "linked"` | (Lista de comprobación) Recorre solo los ítems que enlazan un artículo. |
| Herramienta | `stepParams.<paso>.aligned: "tpl,tps"` | (Publicación) Textos que deben estar alineados para publicarse. |
| Herramienta | `stepParams.<paso>.endorsed: "no"` | (Publicación) El proceso no tiene comité: no se exige el aval. |

Un catálogo de herramientas guardado por la organización recibe solo los parámetros que le falten; lo que la
organización cambió se respeta.

## Ajustes agregados el 7 de octubre de 2026

| Dónde | Campo | Qué dice |
|---|---|---|
| Paso | `closing: "consensus"` con `solverAppId`, sin ítems | El acuerdo del equipo se da **en la herramienta del paso**, no en la tarjeta: quien lo da se sienta en el paso, y el paso se cierra cuando todas las personas sentadas lo dieron, son al menos `minAssignees` y en la herramienta no queda nada por resolver (`agreeInTool`). En el FCR es «Acuerdo del equipo», que abre la pantalla de las propuestas de cambio. |
| Pregunta | `about: "tpl"` | **Una lista en grupos.** Cuando las preguntas de un paso dicen frente a qué recurso se lee cada una (`about`: un texto, o el recurso de los artículos), la lista recorre cada ítem una sola vez y las pregunta por grupos, en el orden en que el proceso nombra cada recurso: en pantalla quedan los textos del paso hasta el del grupo (o el artículo abierto, si el grupo no es de un texto) y solo sus preguntas. O todas dicen `about`, o ninguna. Un ítem que no tiene preguntas de un grupo (sin artículo, sin lo que pide `when`) no lo muestra. |
| Paso | `closing: "checklist"` | Un «No» de la lista se resuelve con una **propuesta de cambio** (la nueva versión, o un comentario), que se acuerda en el paso de acuerdo de la misma tarea. Lo que es de la tarea se escribe en su borrador al acordarse; lo que mantiene otra tarea se le pide como corrección. |

**Un proyecto y la versión de su proceso.** El proyecto recuerda con qué versión se creó (`workflowVersion`). Cuando el
paquete sube de versión, «Proceso» ofrece traer lo nuevo: se agregan fases, tareas y pasos nuevos y se completan
ajustes que faltaban. Nada se cambia ni se quita.

**Otro proceso.** `processes/lengua-minoritaria.json` es un segundo paquete de ejemplo. Para usarlo se importa en
`taller.config.ts` y se agrega a `processes`. `npm run verify:second-process` comprueba que el motor lo ejecuta.

## Cuando se corrige un texto ya revisado

Un texto pasa por varias tareas, una tras otra: se revisan sus desafíos, sus palabras clave y su alineación; luego
las ayudas se armonizan contra él; luego un comité lo avala. Si se corrige un versículo cuando parte de eso ya se
entregó, lo entregado queda hecho sobre un texto que ya no existe.

Por eso, cuando el equipo **acepta una propuesta de corrección** y el texto llega al borrador, la app crea una
subtarea «Revisar de nuevo 2:3: se corrigió el texto» en cada tarea que:

1. el paquete nombra para ese recurso con `redoAfter`, y
2. **ya había entregado** su trabajo sobre ese versículo.

Una tarea que todavía trabaja en ese pasaje no recibe ninguna: lo hará sobre el texto como está, y su herramienta
ya muestra qué cambió. Una que aún no empezó, tampoco.

Las subtareas nuevas son subtareas añadidas al plan, como las correcciones que pide un comité: abren las
herramientas de su tarea solo en ese versículo, salen primero en «Mis tareas» con la etiqueta «Revisar de nuevo», y
**esperan su turno con las mismas reglas `waitsFor` de su tarea**. En el FCR eso da el orden: primero afinación,
luego armonización, luego el aval. No se reabre nada de lo ya entregado.

En la conversación donde se decidió la corrección queda dicho qué se pidió revisar y qué tareas siguen en curso. Una
propuesta rechazada, o una que solo cambia la alineación, no pide nada.

### Una propuesta se conversa hasta decidirse

Una propuesta de cambiar un versículo tiene su propia conversación. Mientras no se decide:

- Cualquiera de **los dos equipos que la propuesta toca** puede **escribirla de otra forma**: el equipo desde el
  que se propuso y el equipo que tiene el texto (el de la primera fase que lo revisa). Cuando un equipo propone
  sobre su propio texto son el mismo. También quien alineó el versículo y quien coordina. Cada versión es una tarjeta de la misma decisión en la misma conversación: las
  anteriores quedan a la vista, sin botones, y se vota la más nueva.
- **Quien la propuso la edita** (el versículo y el porqué) **mientras nadie haya votado esa versión**: se corrige en
  el mismo lugar, sin versión nueva, y la conversación dice que se editó. Con un voto dado ya no se edita: se propone
  otra versión, para que ningún voto cuente por palabras que quien votó no vio.
- Se puede **volver a una versión anterior**: se propone de nuevo como la versión siguiente.
- Con cada versión **los votos empiezan de nuevo** y el plazo vuelve a contar. Quien la escribió ya cuenta a favor.
- Un **no** a una propuesta **dice por qué**, y se le avisa a quien propuso.

Se cierra solo de dos maneras: antes del plazo (3 días), cuando reúne todas las aprobaciones que pide el paso;
después del plazo, cuando reúne al menos dos aprobaciones de fuera (o las que pida el paso, si son menos) y nadie
en contra. Sin eso sigue abierta: nadie la cierra en nombre del equipo, tampoco quien coordina. «Caducada» no es
vencida por tiempo: quiere decir que el versículo cambió mientras se decidía y la propuesta ya no se aplica.

Al borrador llega la versión de la tarjeta que se confirmó. Las tareas de «Revisar de nuevo» se piden una sola
vez, entonces.

### Muchas propuestas a la vez: una lista por capítulo

Cuando llegan muchas propuestas juntas (las 248 del TPL de Esdras, por ejemplo), cada una suelta sería una tarjeta y un
aviso más entre el trabajo del equipo. Van en **una corrección por capítulo que es una lista de propuestas**
(`proposals: true` en la corrección del plan):

- Cada versículo es **una** propuesta con todos sus cambios, cada cambio con su causa y su porqué. Dos propuestas
  del mismo versículo serían dos versiones del versículo entero, y al aceptarse la primera caducaría la otra.
- Cada propuesta es una decisión como cualquier otra, con sus votos, su plazo y su conversación, pero **se lee en
  su lista**: en «Mis tareas» se ve la tarjeta del capítulo con cuántas faltan («9 propuestas por decidir»), y al
  abrirla aparecen una a una: arriba la línea «‹ 3:4 · 3:7 3 de 9 · 3:8 ›», que se queda arriba al bajar (quien ya
  había pasado de ella no sabía que había una siguiente); con más de seis, tocar «3 de 9» abre la lista en una hoja,
  y a 1280 px la lista es una columna. Luego el versículo con el cambio, el porqué en su caja y los botones de la
  decisión, en una caja sin color: el amarillo llamaba demasiado. El único botón lleno es votar; después de votar,
  «3:8 ›» se tiñe más fuerte (`waitsOnVote`), sin parecer lo que hay que decidir, y la pantalla no avanza sola.
  Cómo se ve el cambio (junto, uno bajo otro, lado a lado) se elige en «Más».
- **La conversación de cada propuesta está en la misma pantalla**, bajo «Decidir»: los comentarios, los votos (el
  porqué de un voto se lee como algo dicho) y lo que le pasó; se ven los tres últimos y «Ver los anteriores».
  «Escribir un comentario» abre el campo con «Citar». Un versículo del que se habló después de leerlo lleva un punto
  en la tira, en «3 de 9» y en la lista («Mensajes nuevos»; `talkMoved`: lo dice la hora
  en que Door43 tocó la propuesta, porque los avisos solo siguen las tareas de cada uno). `ProposalTalk.tsx`.
- Las propuestas de una lista no salen como tarjetas sueltas, ni en «Equipo hoy», ni como avisos ni recordatorios:
  la marca `listed` de su subtarea lo dice.
- Cuando todas están decididas, la lista ofrece **«Terminar la corrección»**, que la cierra con sus pasos hechos.

Código: `src/domain/proposalList.ts`, `src/dcs/proposalList.ts`, `src/components/ProposalListView.tsx`; pruebas,
`npm run verify:proposal-list`.

El porqué de una propuesta (al corregir en afinación o en la alineación, en la lectura en grupo, o al rechazar una)
**cita con un toque**: bajo el campo, «Citar» ofrece las palabras del original, de la ULT y de la UST del versículo
para tocarlas, sus notas y los artículos de Academia a los que remiten. Se escriben como se leen después
(`reasonInsert.ts`), y quien lee la propuesta abre cada palabra del original, cada nota y cada artículo
(`reasonText.ts`, `ReasonField.tsx`). Se escribe en el idioma de quien escribe («la nota n3m4», «a nota n3m4»: las
claves `rf.noteSnippet` y `rf.articleSnippet`) y se reconoce en cualquiera: las palabras con que se nombra una nota
(`rt.noteWords`, `rt.and`) se leen de todos los idiomas de la app, y un artículo se reconoce por su ruta. Un idioma
nuevo solo tiene que traducir esas claves.

Esa misma pantalla abre **cualquier decisión del equipo sobre el texto** desde «Mis tareas»: el cambio se lee junto, uno
bajo otro o lado a lado, y se compara con el original (cada palabra abre su significado y el diagrama de la oración),
la ULT, la UST y el otro texto del equipo (`TextChangeView.tsx`, `VerseCompare.tsx`).

### Sugerencias de fuera

Quien no es de la organización (traductores que usan estos recursos, personas que estudian el texto con ellos) sugiere
cambios desde **Door43**, en el repositorio público del texto (`es-419_glt`, `es-419_gst`):

1. Quien gestiona prepara cada repositorio desde «Equipo hoy» → «Sugerencias de fuera». Se agregan un formulario
   (`.gitea/ISSUE_TEMPLATE/sugerencia.yaml`) y las etiquetas `sugerencia` y `en-taller`. Desde entonces, cualquiera con
   cuenta en Door43 abre ahí una sugerencia: qué versículo, cómo quedaría y por qué. La página de esa pantalla da el
   enlace para compartir.
2. En «Sugerencias de fuera» se ve cada una con su cambio marcado sobre el texto del equipo. **Llevar al equipo** la
   abre como propuesta de la tarea que tiene el texto (la primera de las que lo revisan otra vez, `redoAfter`), con su
   autor y el enlace en lo que dice. **No procede** le responde a su autor con el porqué y la cierra.
3. Al llevarla, su autor recibe un aviso en su issue; cuando el equipo decide, la respuesta (aceptada, como queda el
   versículo; o rechazada; o caducada) y el issue se cierra.

Código: `src/domain/outsideSuggestion.ts`, `src/dcs/outsideSuggestions.ts`, `src/components/SuggestionsView.tsx`;
pruebas, `npm run verify:outside-suggestions`.

### Desde qué fase se propone

Un texto se propone cambiar **desde la fase que lo tiene o desde una posterior, nunca desde una anterior**. Lo
tiene la primera fase, de las que lo vuelven a mirar (`redoAfter`), que ya empezó su trabajo sobre ese versículo:
lo entregó, o lo tiene abierto y no espera a nada. Antes de eso, quien lo lee en una fase anterior todavía puede
proponer. Hoy la única pantalla de una fase anterior que propone es la lectura grupal, y es la que lo comprueba.

Código: `src/domain/redoAfterCorrection.ts`, `src/dcs/redoAfterCorrection.ts`,
`src/domain/chatEvents/alineacionDecision.ts`; pruebas, `npm run verify:redo-after-correction`,
`verify:alignment-decision-store` y, contra el mock, `verify:redo-mock`.
