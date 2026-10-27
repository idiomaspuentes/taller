# Propuestas: se comprueban con las preguntas del paso, y se editan sin multiplicarse

Fecha: 27 de octubre de 2026. Decisiones de Abel en la conversación del mismo día.

## Para qué

En la armonización, cada nota (o pregunta, o palabra) se comprueba con las preguntas del paso, y quien ve algo que
cambiar hace una propuesta. Hoy los demás opinan de una propuesta con un toque («la elijo», «la dejo como está»), sin
mirarla con las preguntas con que se miró la nota. Y cada edición de una propuesta crea otra versión que obliga a
volver a mirarla a quien ya la había elegido, aunque nadie más la hubiera tocado.

Lo que se quiere:

1. Que una propuesta se compruebe como se comprueba la nota: cada persona responde, para esa propuesta, las preguntas
   del paso.
2. Que corregir una propuesta que nadie más tocó la corrija ahí mismo, y que solo aparezca como propuesta nueva
   cuando otra persona ya hizo algo con ella.

Funciona igual para notas, preguntas y palabras: el código no conoce ningún paso ni pregunta por su nombre; las
preguntas son las que el paquete del proceso declara para el paso (`processes/fcr.json`).

## Cómo funciona hoy (lo que cambia)

- `proposalsOf` (`src/domain/checkProposal.ts`), en el modo de acuerdo de todos (`consensus`), trata cada propuesta de
  un ítem como una opción, y «Dejarla como está» (`KEEP_OPTION`) como otra. Cada persona elige una: al proponerla, con
  una fila `@acuerdo` «sí», con `@dejar` «sí», o respondiendo «Sí» a una pregunta que una propuesta respondía. El ítem
  se resuelve cuando al menos `needed` eligieron, todos lo mismo, y cada uno eligió la última versión de su opción.
- Editar una propuesta (propia o ajena) escribe otra propuesta con `replaces`: la anterior queda `replaced`, y quien
  había elegido una versión anterior queda en `staleFor` hasta que vuelva a elegir.
- No se guarda quién solo vio algo.

## Parte 1: comprobar una propuesta con las preguntas

### Qué se pregunta

- Todas las preguntas del paso que se hacen **por ítem** (`per` ausente o `"item"`), de todos sus grupos (TPL, TPS,
  Academia): la propuesta es una versión nueva de la nota y se comprueba entera. Las que se responden una vez por
  versículo o por artículo (`per: "verse"`, `per: "article"`) no se repiten por propuesta.
- Las condiciones de una pregunta (`when`, `linked`) se leen sobre el texto de la propuesta (`after`), no sobre el de
  la nota original.
- Si la propuesta parte la nota en dos o más (`split`), se responden sobre la nota como queda y las nuevas juntas,
  como una sola propuesta (así se acuerda hoy).

### Quién marca qué

- **Quien propone**: la pregunta en la que nació su propuesta (`questionId` de su fila, si no es `@propuesta`) cuenta
  como «Sí» suyo, sin marcarla. Las demás preguntas las marca como cualquiera, para ver que su cambio no rompe lo del
  TPS o lo de Academia.
- **Los demás**: marcan todas.
- **Un «No»** pide decir qué falla: un comentario en la conversación de esa opción, o un ajuste (que sigue las reglas
  de la Parte 2). Es lo mismo que pasa hoy con un «No» sobre la nota. Mientras alguien tenga un «No» sin resolver
  sobre una propuesta, esa propuesta no puede quedar acordada.
- Un «No» se resuelve cuando quien lo dio lo cambia a «Sí», o cuando el autor retira la propuesta. Un ajuste hecho
  después de un «No» de otra persona es una propuesta nueva (Parte 2: esa persona ya interactuó), que se comprueba
  desde cero.

### Elegir y resolver

- **Elegir una propuesta** es tener «Sí» en todas sus preguntas (las del autor incluyen la pregunta donde nació). Ya no
  hay un «de acuerdo» suelto para las propuestas nuevas.
- **«Dejarla como está»** no cambia: es responder «Sí» a las preguntas de la nota original (o `@dejar`).
- La elección de cada persona es lo último que completó: si termina de marcar «Sí» en todo lo de una propuesta, esa es
  su elección; si después responde «Sí» a todo lo de otra, cambia a esa.
- **El ítem se resuelve** como hoy: cuando al menos `needed` personas eligieron la misma opción y nadie eligió otra.
  Además, una propuesta con un «No» sin resolver no gana.
- Quien coordina puede seguir decidiendo una propuesta trabada (`@decide`, `DISPUTE_DAYS`), sin cambios.

### Cómo se guarda

- Una fila por respuesta, en el archivo de cada persona (que solo crece), con la forma de las demás:
  `{ itemId: <id de la propuesta>, questionId: <id de la pregunta>, value: "yes" | "no", note?, by, at }`.
  Es la forma que ya usan `@acuerdo` y `@dejar` (el `itemId` es el id de la propuesta), así que no hace falta otro
  archivo ni otra rama.
- Se lee la última fila de cada persona para cada pregunta de cada propuesta, como hoy con las de los ítems
  (`cleared` deshace una respuesta).

### Lo que ya está guardado

- Una fila `@acuerdo` «sí» anterior a este cambio cuenta como «Sí» de esa persona en todas las preguntas de esa
  propuesta. Así no se reabre nada de lo que el equipo ya eligió en Ester y Esdras.
- Una propuesta antigua sin marcas sigue como hoy: su autor la eligió al proponerla.

### En pantalla

- En «¿Cómo debe quedar la nota?» (`NoteOptions`), cada propuesta muestra quién ya la comprobó y un botón
  «Comprobar esta propuesta».
- Ese botón abre los mismos pasos que la nota (TPL → TPS → Academia), con la propuesta en lugar de la nota: el texto
  que se lee es el de la propuesta, con lo que cambia marcado, y se marcan sus preguntas como se marcan las de la nota.
  Al terminar se vuelve a las opciones.
- La pantalla del acuerdo aparte (`ProposalsView`), donde se usa, pide lo mismo en vez del voto.

## Parte 2: editar una propuesta

### Interactuar

Otra persona **interactuó** con una propuesta si, después de que existía, hizo alguna de estas cosas: marcó alguna
de sus preguntas, la eligió (`@acuerdo` «sí», incluso de antes de este cambio), o la comentó en su conversación
(`@conversacion` con `about` igual a esa opción). Abrir la nota no cuenta: no se guarda nada al abrir.

### El autor edita su propuesta

- **Nadie más interactuó**: se corrige ahí mismo. Por dentro se escribe otra fila con `replaces` (los archivos solo
  crecen), pero se muestra como la misma propuesta: sin «Versiones (n)» ni nada que volver a mirar.
- **Alguien más ya interactuó**: la edición es una **propuesta nueva** del autor, sin `replaces`, otra opción. La
  original queda como estaba, con sus marcas y quienes la eligieron.

### Otra persona edita la propuesta de alguien

- **Nadie más que el autor interactuó**: es una **sugerencia** al autor. Se guarda como una propuesta con
  `suggests: <id de la propuesta>`. El autor ve «Ana sugiere este ajuste» y:
  - **la acepta**: su propuesta se corrige ahí mismo con el texto de la sugerencia (otra fila con `replaces`, escrita
    por el autor, con `adjustedBy: <quien sugirió>`), y se muestra como «de María, ajustada por Ana»;
  - **no la acepta**: la sugerencia pasa a ser una propuesta de Ana, otra opción.
  - Mientras espera, los demás no la marcan ni la eligen; se ve como sugerencia bajo la propuesta del autor.
- **Alguien más ya interactuó**: es directamente una propuesta nueva de quien edita, otra opción.
- **Si alguien interactúa mientras la sugerencia espera**, aceptarla ya no puede corregir la propuesta ahí mismo:
  al aceptarla (o al no aceptarla) pasa a ser una propuesta de quien la sugirió. La regla es una sola: lo que otra
  persona ya tocó no se cambia.
- Las filas nuevas: aceptar es la fila con `replaces` del autor; no aceptar es una fila
  `{ itemId: <id de la sugerencia>, questionId: "@sugerencia", value: "no" }` del autor.

### Cuando una corrección ahí mismo deja marcas viejas

Corregir ahí mismo solo pasa cuando nadie más interactuó, así que solo pueden quedar marcas del autor (y de quien
sugirió, si se aceptó su sugerencia): esas se vuelven a pedir sobre el texto nuevo, salvo la pregunta donde nació,
que sigue contando como «Sí» del autor.

## Fuera de esto

- No se guarda nada al abrir una nota.
- No cambia cómo se aplica una propuesta acordada (`applyProposal`), ni la regla de cuántas personas deciden.
- No cambian las preguntas de los pasos ni el paquete del proceso.

## Pruebas

En `scripts/verify-check-proposal.mts` y `scripts/verify-checklist.mts`, con nombres que digan lo que se comprueba:

- Marcas por pregunta sobre una propuesta: con «Sí» en todas, la persona la elige; con una sin marcar, no.
- Un «No» sin resolver impide que la propuesta se acuerde aunque tres la elijan; al cambiarlo a «Sí», se acuerda.
- El autor: la pregunta donde nació cuenta como «Sí» suyo; las demás las tiene que marcar.
- Las preguntas por versículo o por artículo no se piden por propuesta; `when` se lee sobre el texto propuesto.
- Un `@acuerdo` «sí» antiguo cuenta como «Sí» en todas las preguntas.
- El autor edita sin interacción de otros: una sola propuesta, sin `staleFor`. Con interacción: dos opciones, la
  original con sus marcas.
- Otra persona edita: sugerencia; aceptada, corrige la del autor («ajustada por»); no aceptada, propuesta de quien
  sugirió; con interacción en medio, propuesta de quien sugirió.
- `summarizeChecklist`: el ítem se resuelve con la opción comprobada por `needed` personas y nadie en otra.

En el navegador, con el mock y tres personas (ana, bea, carla), a 375 px y en escritorio: proponer, comprobar la
propuesta, marcar un «No» con comentario, editar con y sin interacción, sugerir y aceptar.
