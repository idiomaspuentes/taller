# Fase 1, entrega 5: la revisión en pares como conversación (D1)

*Escrito el 25 de noviembre de 2026, con las decisiones que Abel tomó ese día. Lo leyeron tres revisores sin contexto (Sonnet, Opus y Sonnet). **Aprobado por Abel el 25 de noviembre**, con las decisiones marcadas «(mi decisión)».*

Lo marcado «(decidido)» lo decidió Abel; lo marcado «(mi decisión)» lo decidí al escribir, y Abel lo revisa al aprobar.

Parte del diseño de la Fase 1 ([`2026-11-23-fase-1-traduccion-design.md`](2026-11-23-fase-1-traduccion-design.md), propuesta D1) y de su plan ([`2026-11-24-fase-1-traduccion.md`](../plans/2026-11-24-fase-1-traduccion.md), «Entregas 5 y 6»). Los nombres técnicos entre paréntesis son para quien lo construya.

## 1. Para qué

La revisión en pares hoy se siente como un examen: «Aprobar» lleno antes de leer, cuatro acciones por comentario, «nuevo» y «4 de 4 con cambios» por todas partes, y en la segunda vuelta no se ve qué corrigió la autora. Afinación y Armonización ya se sienten como una conversación entre colegas. Esta entrega lleva eso a la revisión en pares.

**Lo que no cambia (decisión 1 de Abel, 24-11):** quién debe estar de acuerdo para cerrar. Quien revisa aprueba, la autora confirma, y nadie aprueba con un comentario abierto. Cambia lo que se ve y cómo se dice.

**Éxito:** quien revisa lee el pasaje como texto, dice lo que no le convence con palabras propuestas o un comentario, y en la segunda vuelta ve solo lo que la autora cambió. La autora recibe las palabras propuestas donde escribe y las usa con un toque.

**Fracaso aunque funcione:** que el pie vuelva a invitar a aprobar sin leer, que una propuesta se pueda aplicar sobre el texto de otra persona, o que se pierda lo que la autora escribió por aplicar una propuesta.

## 2. Alcance

Las seis revisiones en pares de la Fase 1, todas en `PortionReviewView.tsx`: TPL, TPS, Notas, Preguntas, Palabras y Academia (decisión de Abel del 25-11). La lectura grupal (D2) es la entrega 6 y no se toca.

Parte de lo que habrá cuando estén fusionados los PR #61, #62 y #63 (entregas 2 a 4). De ellos importan:

- B5 (#61): el editor de la autora muestra cada comentario encima de su versículo abierto (`commentsOnVerses`, `ScriptureEditorView.tsx`; en ayudas, `HelpsEditorView.tsx` con `helpRowRef`).
- C3 (#62): la ventana del paso le habla a la autora (`StepAsk` con `forAuthor`).
- A1 (entrega 0, en `main`): cada caja de comentario conserva lo escrito (`boxes`).
- B3 (entrega 1, en `main`): «Entregar al grupo» en la misma pantalla.

## 3. Lo que ve quien revisa

### 3.1 Se lee como texto (decidido)

A 375 px:

```
 Ester 1:1–4 · TPL
 ─────────────────────────────
 1  Y aconteció en los días de
    Asuero, el Asuero que reinaba…
 2  En aquellos días, cuando el     •   ← tiene conversación
    rey Asuero se sentó…
 ┌ 3  En el año tercero de su ────┐   ← abierto
 │   ULT  In the third year…      │
 │   @bea: «banquete» o «fiesta»? │
 │                 No del todo…   │
 └────────────────────────────────┘
 4  Cuando él mostró las riquezas…
 ─────────────────────────────
 [ Estoy de acuerdo ]
```

- Cada pieza (versículo, fila de Notas o Preguntas, párrafo de un artículo o de una introducción) se ve solo con su lugar y su texto. Sin botón «Comentar», sin etiquetas «nuevo» / «cambiado», sin fuentes.
- Un punto discreto marca la pieza que tiene conversación; otro, distinto, la que tiene algo abierto (un comentario o una propuesta sin resolver; una propuesta usada no cuenta).
- Un puente que ya está en el borrador (`1:3–4`) es una sola pieza, con ese lugar; se propone sobre el puente entero.
- Tocar una pieza la abre debajo, de una en una (abrir otra cierra la anterior, salvo que tenga una caja con texto: A1). Abierta muestra:
  1. la fuente con la que se compara (la de hoy en `versesOf`, la cita y el inglés de una nota, el inglés de un párrafo);
  2. «Fíjese en esto» (`Hints`), como hoy;
  3. la conversación de esa pieza;
  4. el enlace discreto **«No del todo…»**.
- Se van de la barra de arriba: «Mostrar fuentes» (la fuente está en la pieza abierta) y el conteo «N de M con cambios». En Notas y Preguntas se queda el enlace a las que faltan por traducir («Ver las 3 que faltan»), solo si faltan.
- Los comentarios sobre todo el pasaje quedan al final, después de la última pieza, con un enlace «Decir algo sobre todo el pasaje» que abre su caja. Esa caja ya no trae «Pedir cambios»: eso está en el pie.
- Palabras y Academia siguen leyéndose por párrafos contra el inglés (`ArticleBlocks` en modo lectura). Lo que se agrega en el párrafo abierto (`below`) es lo mismo: conversación y «No del todo…».

### 3.2 «No del todo…» (decidido)

Abre dos caminos. Los dos piden escribir algo.

- **«Proponer otras palabras».** La caja abre con el texto de la pieza ya escrito (decisión de Abel), y quien revisa cambia solo lo que quiere. En Preguntas, abre con la pregunta y la respuesta, cada una en su caja, y se propone y se aplica junto. Debajo, el enlace «Decir por qué», que abre una caja más solo si se toca (con el teclado abierto, la caja de la propuesta queda arriba de todo). Botón: «Enviar propuesta», apagado mientras el texto sea igual al de la pieza **o difiera solo en espacios o comillas** (un cambio solo de comillas no es una propuesta: se ajusta solo al publicar).
  - **La forma del texto (mi decisión):** el de la caja del editor de la autora, no el archivo crudo. En un versículo, sus líneas (las de la poesía, una por renglón) con solo las palabras: sin `\q1`, sin notas al pie ni marcas de palabras, que el editor no muestra. En una nota o pregunta, su texto como lo muestra el editor de ayudas. En un párrafo de artículo, su markdown. La revisión obtiene esa forma con la misma función que usa el editor, para que lo propuesto y lo que la autora ve en su caja se puedan comparar.
  - **No se ofrece «Proponer otras palabras» (mi decisión)** donde la propuesta no tendría un lugar seguro: un versículo partido en segmentos (`1:3a`) y una fila de ayuda sin id (su lugar es solo el versículo, `helpRowRef`, y varias filas lo comparten). Ahí «No del todo…» abre directamente «Comentar algo».
- **«Comentar algo».** La caja de comentario de hoy (`Composer`), con lo escrito conservado (A1).

### 3.3 El pie (decidido)

Un solo botón lleno, según el momento:

| Momento | Botón lleno | Además |
|---|---|---|
| Leyendo, sin nada abierto mío | «Estoy de acuerdo», **con borde** hasta que se vio la última pieza; entonces lleno | — |
| Dejé algo abierto | «Pedir cambios» | La línea dice cuántas cosas dejé, con enlace a la primera |
| Otra persona que revisa dejó algo abierto | ninguno | La línea dice quién y lleva a lo suyo. Ya no se ve «Aprobar» lleno y apagado (lo visto en la entrega 3) |
| Faltan partes sin traducir (`askFinish`) | «Pedir que lo termine» | «Estoy de acuerdo así», con borde |
| Ya estoy de acuerdo, o se cerró | «Volver a mis tareas» | «Cambiar mi revisión», como hoy |

- «Estoy de acuerdo» es lo que hoy es «Aprobar» (`approve`, `approveStep`), sin otro cambio de reglas.
- **Se vio la última pieza:** el último versículo, fila o párrafo estuvo en la pantalla al menos una vez en esta visita (`IntersectionObserver` sobre el contenedor que se desplaza, no la ventana). No hace falta abrir cada pieza. Si todo el pasaje cabe en la pantalla, se llena al abrir: es un empujón para leer, no un candado (mi decisión).
- En la segunda vuelta, para quien estaba en la vuelta anterior (3.5), cuenta la última pieza **que cambió**. Si nada cambió, o si esa persona no estaba, sigue la regla de la primera vuelta: estar sentada no prueba haber leído.
- Tocar «Estoy de acuerdo» con borde no se bloquea: pregunta «Todavía no llegó al final. ¿Está de acuerdo con todo el pasaje?», con «Sí, estoy de acuerdo» y «Seguir leyendo».
- La autora conserva «Para mí está bien» y, después, «Entregar al grupo» (B3).

### 3.4 Después de «Pedir cambios» (decidido)

Una ventana corta como las de Afinación (`StageWindow`): «Le pidió cambios a Ana. Cuando los haga, esta revisión vuelve a su lista.» Un solo botón lleno: «Volver a mis tareas». El mensaje automático «Le dejé N comentarios» se sigue escribiendo como hoy (desde A2 no bloquea nada).

### 3.5 La segunda vuelta: solo lo que cambió (decidido)

Cuando la autora entrega otra vez, quien leyó la vuelta anterior ve el pasaje igual que en la primera vuelta, pero:

- Las piezas que cambiaron desde que el borrador volvió a la autora llevan la marca de lo cambiado (`diffWords`, `<ins>` / `<del>`), a la vista sin tocar ningún interruptor.
- Arriba, una línea: «Ana cambió 2 versículos desde que se lo devolvieron», que lleva al primero. Si no cambió nada: «Ana no cambió el texto. Vea lo que respondió.»
- Las demás piezas se leen sin marca.
- **Con qué se compara:** ver 5.2.
- **Quién leyó la vuelta anterior (mi decisión):** quien estaba sentado en la revisión cuando el borrador volvió a la autora (5.2 lo anota). Quien se sentó después ve una primera vuelta, sin marcas: no leyó nada antes.
- Las revisiones que ya estaban abiertas al publicar no tienen esa versión anotada, ni la tienen si se perdió (5.2): en ellas no se marca nada y se leen como una primera vuelta.

**La primera vuelta no marca nada.** Hoy se compara con el texto del equipo, que en un libro nuevo está vacío: todo sale «nuevo». Donde el texto del equipo ya tenía algo traducido en esa pieza (el estado `changed` de hoy, con `rowCorrected` en las ayudas), se conserva el interruptor «Ver lo que cambió», apagado al empezar.

### 3.6 El menú «…» de un comentario (decidido)

```
 @bea · hace 2 h
 «banquete» suena mejor que «fiesta»
 [ Resuelto ]                      …
```

- A la vista, solo «Resuelto» (o «Abrir otra vez»), para quien puede (`canResolveComment`).
- En «…»: «Cambiar» y «Borrar» (con las reglas de hoy, `canEditComment`), «Guardar como regla del equipo» y «Llevar al glosario» (hoy `rv.asRule` y `CommentAsRule`), para quien hoy los tiene.
- Si a esa persona no le toca nada, no hay «…».
- El menú es una hoja o lista de botones de 44 px de alto como mínimo.

## 4. Lo que ve la autora

### 4.1 En la revisión (decidido)

- Lee las mismas piezas como texto. Al abrir una, ve la fuente, la conversación y **«Responder»** (no «No del todo…»: no se propone a sí misma).
- Una propuesta se ve con lo cambiado marcado contra su texto, y debajo «Corregir mi borrador», que abre el editor en esa pieza (`openDraft` con `focus`).
- Al pie, mientras haya algo abierto, «Corregir mi borrador» lleva al primer lugar con algo abierto. Cuando todo está resuelto, el pie es el de hoy: «Para mí está bien» y después «Entregar al grupo».

### 4.2 En su editor: «Usar estas palabras» (decidido)

Solo en el editor de la autora (decisión de Abel), donde B5 ya muestra cada comentario encima de su pieza abierta: el TPL y el TPS en `ScriptureEditorView`, y las Notas, Preguntas, Palabras y Academia en `HelpsEditorView`.

- La propuesta se ve con lo cambiado marcado **contra lo que la caja dice ahora**, no contra lo que decía cuando se escribió.
- «Usar estas palabras» hace lo mismo que si la autora escribiera esas palabras en la caja: cambia las palabras de cada línea y deja lo que el editor conserva al escribir (la marca de cada línea de poesía, las notas al pie y las palabras marcadas, como hoy al teclear). Se guarda como guarda ese editor: solo, unos segundos después, en el TPL y el TPS y, desde la entrega 8, también en las ayudas. La autora puede seguir ajustándolo.
- **Solo se ofrece si la pieza sigue siendo la misma (mi decisión):** el mismo lugar, con el mismo número de líneas que el texto propuesto. Si la autora unió versículos en un puente (`1:3–4`), partió uno o cambió sus líneas de poesía, la propuesta se ve, pero sin el botón, con la línea «El versículo cambió de forma; escriba los cambios a mano». Así nunca se pierde el versículo 4 de un puente ni una línea de un poema.
- Solo lo ve la autora del borrador (`author`, quien tiene la incidencia asignada), en su propio borrador: nunca en el borrador del grupo (`onTeamDraft`), ni otra persona.
- Si hay dos propuestas sobre la misma pieza, cada una tiene su botón; usar una deja la otra abierta, marcada contra el texto nuevo.
- Por qué no en la revisión: el editor guarda en el aparato lo que todavía no subió. Si la revisión escribiera en Door43 por su cuenta, al abrir el editor podría volver un texto viejo y pisarla (la clase de fallo que arregló el PR #48).

### 4.3 Una propuesta usada se resuelve sola (decidido)

Si la pieza del borrador dice exactamente las palabras propuestas, la propuesta cuenta como resuelta y se ve «Usada por @ana». Se calcula al leer, comparando con el borrador: nadie tiene que tocar nada, y la autora no marca como resuelto lo que otra persona dijo (la regla de `reviewCommentsFrom` sigue igual).

- «Exactamente» ignora diferencias de espacios y de comillas («», “”, ‘’, "" y ' se cuentan iguales): los editores convierten las comillas solos. Se compara en la forma de 3.2.
- Si la autora la usó y luego la retocó, o no la usó, la propuesta sigue abierta como cualquier comentario y quien revisa decide. Quien la propuso puede darla por resuelta cuando quiera, como un comentario (`canResolveComment`).
- Si después la autora cambia otra vez la pieza, la propuesta vuelve a estar abierta.
- **Con qué texto se compara (mi decisión):** en la revisión y al aprobar, con el borrador entregado (la cabeza del PR). En el editor de la autora, con lo que dice su caja, para que vea «Usada» al tocar el botón. Mientras lo que usó no se guarde (unos segundos después de tocar el botón, o al tocar «Terminé el borrador»), la revisión la sigue viendo abierta: es lo correcto, porque el borrador entregado todavía no la tiene. (Hasta la entrega 8, en las ayudas eso duraba hasta tocar «Guardar»; issue #69.)
- **Se congela al cerrar (mi decisión):** cuando el paso de la revisión ya está cerrado, la propuesta no se vuelve a comparar con nada: se ve como un comentario más, sin «Usada» ni marca de abierta. Un paso posterior que cambie esa pieza en el borrador del grupo no reabre una revisión cerrada. Si quien aprobó vuelve con «Cambiar mi revisión» (`changeReview`), el paso se abre y se vuelve a comparar.
- **En los editores** (`ScriptureEditorView`, `HelpsEditorView`, que hoy llaman a `openComments` para mostrar lo abierto junto a cada pieza), el texto con que se compara es el de cada caja. No hay otro lugar que cuente comentarios abiertos (ni el tablero ni las tarjetas).
- **En un párrafo de artículo**, «el texto de la pieza» es la traducción de la fila de `articleRows(source, value)` con ese índice de la fuente: las filas emparejan cada párrafo de la fuente con el suyo del borrador. Si la autora agregó o quitó párrafos y la fila ya no empareja, la pieza cuenta como cambiada de forma (4.2).
- **Si la pieza ya no está** (una fila de ayuda borrada, un versículo que dejó de existir), la propuesta se muestra con los comentarios sobre todo el pasaje, con su lugar, y cuenta como abierta: quien la propuso la da por resuelta. Nunca queda una propuesta abierta que nadie pueda ver.

## 5. Cómo se guardan los datos

### 5.1 Una propuesta de palabras: un comentario de la revisión con sus datos dentro (decidido)

Se escribe en la conversación de la revisión (el PR de la porción), como cualquier comentario:

```
**EST 1:3** — Propongo: «En el año tercero de su reinado hizo un banquete…»

<!-- taller-proposal eyJzY2hlbWEiOiJ0YWxsZXItcHJvcG9zYWwtMSIs… -->
```

- La primera línea es lo que se lee también en Door43, con el lugar al principio, como hoy (`refComment`). En Preguntas, pregunta y respuesta en dos líneas. Si quien propone escribió por qué, va en una línea más.
- El marcador lleva, en base64url como `chatEvent`, `{ schema: "taller-proposal-1", ref, over: { text, secondary? }, words: { text, secondary? }, why? }`, los textos en la forma de 3.2. `words` es lo propuesto. `over` es cómo estaba la pieza al escribir la propuesta: con él, quien revisa ve en su propia propuesta qué cambió respecto de lo que leyó (la autora la ve contra su caja, 4.2).
- **No es un `tas:chat-event`** ni empieza por `tas:` / `gateway-`: esos se leen como mensajes de la app (`classifyComment`, `isMachineComment`) y desaparecerían de la conversación. Es un marcador propio que lee un analizador puro nuevo, junto a `reviewComments.ts`. Una versión vieja de la app lo muestra como un comentario normal: `classifyComment` ya quita los comentarios HTML del texto (`conversation.ts`), y en `reviewCommentsFrom` hay que quitarlo también de `text`.
- `ReviewComment` gana `proposal?: { over, words, why? }`. `text` es la frase visible, sin el marcador.
- El lugar (`ref`) es el que ya usan los comentarios: `1:3` para un versículo, el de `helpRowRef` para una fila de ayuda (con id: ver 3.2), `pieceRef` / `introPieceRef` para un párrafo. Estos dos últimos cuentan los párrafos de la fuente, no del borrador (`articleBlocks.ts`, `pieceRef`): un párrafo agregado por la autora no corre las propuestas.
- **Cambiar** una propuesta (desde «…») abre la caja con las palabras propuestas y escribe el cuerpo entero de nuevo: lugar, frase visible y marcador. Un comentario con marcador no pasa por `editedCommentBody`, que toma el lugar con `raw.endsWith(text)` y lo perdería. Queda «editado», como cualquier comentario cambiado. **Borrar** es igual que hoy.
- Una propuesta usada (4.3) ya no se puede cambiar ni borrar, como un comentario resuelto: `canEditComment` recibe en `opts` si está usada, porque «usada» se calcula y no está en `resolved`.
- **Cuenta como abierta** igual que un comentario (`openComments`), salvo que esté usada. Por eso `openComments` recibe el texto actual de cada pieza (función `(ref) => { text, secondary? } | undefined`; `undefined`: la pieza no está, 4.3). La pantalla lo saca de lo que ya cargó de la cabeza del PR. **`approve()` vuelve a leer la cabeza** de los archivos que tienen propuestas, igual que ya vuelve a leer los comentarios: la autora pudo corregir mientras tanto.

Opciones descartadas: guardarla en la marca de la tarea (la incidencia se reescribe entera, dos personas se pisan, y no se vería en la conversación), o que quien revisa escriba en una rama propia (Door43 no tiene sugerencias; mucho más pesado).

### 5.2 La versión con que se compara la segunda vuelta: anotada en la tarea (decidido)

- `StepRuntime` (la marca de la tarea en la incidencia, `taskProgress.ts`) gana `returned?: { sha: string; seated: string[] }`: el commit de la cabeza del PR (`getBranchSha` sobre `marker.head`) en el momento en que el borrador volvió a la autora, y quiénes estaban sentados en la revisión en ese momento (`assignees`), que son quienes leyeron esa versión (3.5).
- **La marca reconstruye cada paso campo por campo:** `normalizeStepRuntimes` (con su `kept()`) y `withStepRuntime` descartan lo que no conocen. Hay que agregar `returned` en los dos, o cualquier `claimStep`, `approveStep` o `withStepWork` lo borra. Una versión vieja de la app que escriba la marca (un teléfono que aún no se actualizó) lo borrará igual: esa vuelta se lee entonces sin marcas. Se acepta: se pierde una ayuda, no un dato.
- Se anota en los dos caminos que la devuelven: `askForChanges` (quien revisa pide cambios) y `takeBack` (la autora toma su borrador con «Corregir mi borrador»). Las dos funciones reciben el sha como parámetro y siguen siendo puras. Se lee el sha justo antes de escribir, como ya se relee la incidencia.
- `changeReview` (quien aprobó vuelve a su revisión) no devuelve el borrador: no lo toca ni lo borra.
- Si se devuelve más de una vez, se queda el último: la segunda vuelta muestra lo cambiado desde la última vez que volvió. No se borra al entregar otra vez: se usa justamente después. Sobrevive hasta que el paso se cierra; cerrado, nadie lo lee.
- Si no se puede leer el sha (la rama no está), se escribe sin `returned` y esa vuelta no marca nada. Si el sha ya no existe al leerlo (la rama se reescribió), lo mismo.
- En la segunda vuelta la pantalla lee el archivo (o los archivos, en un artículo) en ese sha además de en la cabeza, y compara pieza por pieza con las mismas funciones de hoy (`reviewItems`, `articleItems`, filas por id). Un commit cubre todos los archivos del borrador.
- Lo que hoy se compara con el texto del equipo (la base del PR) se sigue leyendo solo para el interruptor de 3.5 y para saber qué falta traducir.

Opciones descartadas: que cada persona guarde en su aparato qué versión leyó (se pierde al cambiar de teléfono y sale distinta para cada una), o anotarla en el mensaje «Pido cambios» (cuando la autora toma su borrador no se escribe ninguno).

### 5.3 Lo que no cambia

- Los comentarios, resoluciones y eventos ya escritos se leen igual.
- La regla de cierre: quién aprueba, quién confirma y que nada se apruebe con algo abierto.
- El guardado de los editores (PR #48). «Usar estas palabras» escribe en la caja; guardar sigue siendo cosa del editor.
- Los nombres de procesos fuera de `src/` (`verify:decoupling`).

## 6. Límites de pantalla

A 375 px: como mucho 12 controles, ninguno de menos de 44 px, un solo botón lleno y dos pantallas de alto.

**Cómo se cuenta (mi decisión, para que Abel la vea):** las piezas cerradas son el texto que se lee, como en la lectura grupal; tocar una no es una decisión, y se miden aparte (cada una de 44 px de alto como mínimo). Los 12 se cuentan en lo que rodea a la pieza abierta: su fuente, sus comentarios, «No del todo…», el pie y la barra de arriba. Para que una pieza con muchos comentarios no pase de 12, se ven los dos últimos y, encima, «Ver 3 comentarios antes»; los resueltos se pliegan primero. Las dos pantallas de alto se miden con la pieza abierta, sin contar el resto del pasaje. Cada texto nuevo que se lee o se escribe lleva su regla `html[data-text] … { font-size: calc(Xrem * var(--ts)); }`. La autora y quien revisa se miden por separado, también en portugués.

## 7. Cómo se sabrá que quedó bien

**Pruebas automáticas** (lógica pura, `scripts/verify-*.mts`):

- Escribir y leer una propuesta da los mismos datos, con `text` sin marcador. Un comentario de antes se lee igual. Cambiar una propuesta conserva su lugar.
- Una propuesta usada (con espacios y comillas distintas) no cuenta como abierta. Retocada, o cambiada otra vez después de usarla, sí. Con la pieza borrada, cuenta como abierta. Con el paso cerrado, no se compara.
- `askForChanges` y `takeBack` anotan `returned` (sha y sentados) y dejan lo demás igual. `changeReview`, `claimStep`, `approveStep` y `withStepWork` lo conservan. Una marca sin `returned` (vieja) se lee sin error.
- Lo que cambió entre dos versiones: un versículo, una fila de ayuda (por id) y un párrafo de un artículo.
- «Usar estas palabras» no se ofrece cuando la pieza cambió de forma (un puente, otras líneas).
- `canEditComment`: una propuesta usada no se cambia ni se borra.
- Siguen pasando `tsc`, `verify:decoupling`, `verify:config`, `verify:guide`, `verify:review-items`, `verify:review-changes`, `verify:my-tasks-board` y `verify:text-size`.

**En el navegador, contra el mock**, con Ana (autora) y Bea (revisa), a 375 y 1280 px:

1. Bea lee Ester 1:1–4 del TPL: el pie está con borde y se llena al ver el 1:4.
2. Bea propone otras palabras en el 1:3 y comenta el 1:2. El pie pasa a «Pedir cambios»; al tocarlo, la ventana y «Volver a mis tareas».
3. Ana abre la revisión, ve la propuesta y toca «Corregir mi borrador»: el editor abre en el 1:3 con «Usar estas palabras». La usa y entrega otra vez.
4. Bea vuelve: solo el 1:3 está marcado, la propuesta dice «Usada por @ana» y el comentario del 1:2 sigue abierto. Lo da por resuelto, «Estoy de acuerdo». Ana, «Para mí está bien» y «Entregar al grupo».
5. Lo mismo, más corto, en Notas, en Preguntas (pregunta y respuesta) y en un párrafo de Palabras o Academia (con el artículo marcado a mano como pendiente).
6. Una revisión abierta antes del cambio (sin `returned`) se abre sin errores y sin marcas.
7. Carla se sienta en la revisión después de que Bea pidió cambios: ve una primera vuelta, sin marcas, y su pie sigue la regla de la primera vuelta.
8. En un versículo de poesía (varias líneas) con una nota al pie: proponer y usar conserva las líneas y la nota.

## 8. Lo que queda para quien construye

- Las frases exactas en `es.json` y `pt.json` (las de este documento son la guía), con `translations:review`.
- La forma y el color de los dos puntos de las piezas, y del menú «…», dentro de la filosofía de diseño.
- Si la guía de la revisión (`ReviewGuide`) cambia los lugares que señala: debe señalar una pieza, «No del todo…» y el pie.
- Cómo `ArticleBlocks` en modo edición recibe «Usar estas palabras» para un párrafo (hoy cada fila tiene su caja: reemplazar el valor de esa fila).
- Si conviene dividir la construcción en dos PR (quien revisa / la autora), siempre que cada uno se pueda publicar solo.
