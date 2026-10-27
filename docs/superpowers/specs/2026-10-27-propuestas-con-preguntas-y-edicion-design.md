# Una sola propuesta por nota: se comprueba con las preguntas del paso y se mejora con ajustes

Fecha: 27 de octubre de 2026. Decisiones de Abel en la conversación del mismo día.

## Para qué

En la armonización, cada nota (o pregunta, o palabra) se comprueba con las preguntas del paso, y quien ve algo que
cambiar hace una propuesta. Hoy los demás opinan de una propuesta con un toque («la elijo», «la dejo como está»), sin
mirarla con las preguntas con que se miró la nota. Y quien no está de acuerdo con una propuesta escribe otra: el
equipo termina votando entre dos o tres textos parecidos, en vez de escribir uno juntos.

Lo que se quiere:

1. Que una propuesta se compruebe como se comprueba la nota: cada persona responde, para esa propuesta, las preguntas
   del paso.
2. Que en cada nota haya **una sola propuesta**. Quien quiere cambiar algo de ella no escribe otra que compita: le
   sugiere un **ajuste** a quien la propuso, que lo acepta o no. Es un trabajo de todos sobre un mismo texto, como las
   sugerencias de un documento compartido, y sigue lo que el equipo ya decidió: la armonización es una conversación
   por porción, no una votación.

Funciona igual para notas, preguntas y palabras: el código no conoce ningún paso ni pregunta por su nombre; las
preguntas son las que el paquete del proceso declara para el paso (`processes/fcr.json`).

## Cómo funciona hoy (lo que cambia)

- `proposalsOf` (`src/domain/checkProposal.ts`), en el modo de acuerdo de todos (`consensus`), trata cada propuesta de
  un ítem como una opción, y «Dejarla como está» (`KEEP_OPTION`) como otra. Cada persona elige una: al proponerla, con
  una fila `@acuerdo` «sí», con `@dejar` «sí», o respondiendo «Sí» a una pregunta que una propuesta respondía. El ítem
  se resuelve cuando al menos `needed` eligieron, todos lo mismo, y cada uno eligió la última versión de su opción.
- Cualquiera puede escribir otra propuesta sobre el mismo ítem, y es otra opción.
- Editar una propuesta (propia o ajena) escribe otra propuesta con `replaces`: la anterior queda `replaced`, y quien
  había elegido una versión anterior queda en `staleFor` hasta que vuelva a elegir.
- Quien coordina decide un ítem trabado después de `DISPUTE_DAYS` (3 días) con una fila `@decide`.

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
- **Un «No»** pide decir qué falla: un comentario en la conversación de la propuesta, o un ajuste (Parte 2). Es lo
  mismo que pasa hoy con un «No» sobre la nota. Mientras alguien tenga un «No» sin resolver sobre la propuesta, no
  puede quedar acordada.
- Un «No» se resuelve cuando quien lo dio lo cambia a «Sí», cuando el texto de la propuesta cambia (las marcas se
  piden de nuevo, Parte 2), cuando el autor la retira, o cuando quien coordina decide.

### Elegir y resolver

- Hay dos opciones por ítem: **la propuesta** (en su versión de ahora) y **«Dejarla como está»**. Los ajustes que
  esperan respuesta no son opciones: no se marcan ni se eligen.
- **Elegir la propuesta** es tener «Sí» en todas sus preguntas (las del autor incluyen la pregunta donde nació). Ya no
  hay un «de acuerdo» suelto para las propuestas nuevas.
- **«Dejarla como está»** no cambia: es responder «Sí» a las preguntas de la nota original (o `@dejar`).
- La elección de cada persona es lo último que completó: si termina de marcar «Sí» en todo lo de la propuesta, esa es
  su elección; si después responde «Sí» a todo lo de la nota original, cambia a dejarla.
- **El ítem se resuelve** como hoy: cuando al menos `needed` personas eligieron la misma opción y nadie eligió otra.
  Además, la propuesta no gana con un «No» sin resolver.

### Cómo se guarda

- Una fila por respuesta, en el archivo de cada persona (que solo crece), con la forma de las demás:
  `{ itemId: <id de la versión de la propuesta>, questionId: <id de la pregunta>, value: "yes" | "no", note?, by, at }`.
  Es la forma que ya usan `@acuerdo` y `@dejar` (el `itemId` es el id de la propuesta), así que no hace falta otro
  archivo ni otra rama.
- Se lee la última fila de cada persona para cada pregunta de cada versión, como hoy con las de los ítems (`cleared`
  deshace una respuesta). Una marca vale para la versión que nombra: si el texto cambia, la marca queda vieja.

### Lo que ya está guardado

- Una fila `@acuerdo` «sí» anterior a este cambio cuenta como «Sí» de esa persona en todas las preguntas de esa
  propuesta. Así no se reabre nada de lo que el equipo ya eligió en Ester y Esdras.
- Una propuesta antigua sin marcas sigue como hoy: su autor la eligió al proponerla.

### En pantalla

- En «¿Cómo debe quedar la nota?» (`NoteOptions`), la propuesta muestra quién ya la comprobó y un botón «Comprobar esta
  propuesta».
- Ese botón abre los mismos pasos que la nota (TPL → TPS → Academia), con la propuesta en lugar de la nota: el texto
  que se lee es el de la propuesta, con lo que cambia marcado, y se marcan sus preguntas como se marcan las de la nota.
  Al terminar se vuelve a las opciones.
- La pantalla del acuerdo aparte (`ProposalsView`), donde se usa, pide lo mismo en vez del voto.

## Parte 2: una sola propuesta, y ajustes a ella

### La propuesta de un ítem

- **La propuesta** de un ítem es la primera que se escribió y sigue viva (ni retirada, ni aplicada, ni rechazada por
  quien coordina). Su autor es quien la escribió; sus versiones se encadenan con `replaces`, como hoy.
- Cuando un ítem ya tiene propuesta, la app no ofrece «Proponer un cambio» sino **«Sugerir un ajuste a la propuesta de
  María»**: el editor se abre con el texto de la propuesta, no con el de la nota.
- **Dos personas que proponen casi a la vez** (cada una sin ver la otra todavía): la que se escribió después se lee
  como ajuste a la primera, con las mismas reglas de abajo.
- **Si el autor retira su propuesta**, la propuesta pasa a ser el primer ajuste que seguía esperando, y su autor es
  quien lo sugirió; los demás ajustes pendientes pasan a ser ajustes a ella. Si no queda ninguno, el ítem vuelve a no
  tener propuesta.

### El autor cambia su propuesta

- Se cambia ahí mismo: otra fila con `replaces` (los archivos solo crecen) y se muestra como la misma propuesta.
- Si nadie más la había marcado, no hay nada más que hacer.
- Si otros ya la habían marcado, sus marcas quedan viejas (Parte 1) y la app les dice «María cambió su propuesta», con
  lo que cambió marcado, para que la comprueben de nuevo. Es el «Te toca» que hoy sale cuando cambia la propuesta que
  uno había elegido.

### Otra persona sugiere un ajuste

- Se guarda como una propuesta con `suggests: <id de la versión de la propuesta sobre la que se escribió>`. Se ve bajo
  la propuesta, como «Ana sugiere este ajuste», con lo que cambia marcado y su razón.
- **Solo el autor lo acepta o no.** El resto del equipo opina en la conversación de la propuesta, o marca la propuesta
  (un «No» con el comentario «prefiero el ajuste de Ana» es la forma de apoyarlo).
- **El autor lo acepta**: su propuesta toma el texto del ajuste. Es otra versión suya con `replaces`, escrita por el
  autor, con `adjustedBy: <quien lo sugirió>` y `accepts: <id del ajuste>`, y se muestra como «de María, ajustada por
  Ana» (o «ajustada por Ana y Bea»). Las marcas de todos quedan viejas y se piden de nuevo, como en «El autor cambia su
  propuesta», salvo la pregunta donde nació la propuesta, que sigue contando como «Sí» del autor.
- **El autor no lo acepta**: escribe una fila `{ itemId: <id del ajuste>, questionId: "@ajuste", value: "no", note? }`,
  con la razón si quiere. El ajuste queda a la vista como «María no lo aceptó», con su conversación.
- **Quien lo sugirió no está de acuerdo**: lo dice en la conversación y, si sigue sin estarlo, marca «No» en la
  propuesta con su razón. Ese «No» la traba (Parte 1). Pasados `DISPUTE_DAYS` (3 días) sin acuerdo, quien coordina
  decide, como hoy, entre la propuesta, los ajustes no aceptados y «Dejarla como está». Su fila `@decide` puede nombrar
  un ajuste: entonces se aplica el texto de ese ajuste.
- **El autor no responde**: pasados `DISPUTE_DAYS` desde el ajuste, quien coordina puede aceptarlo o no por el autor,
  con las mismas filas y `by` de quien coordina.
- **Quien sugirió lo retira**: como se retira hoy una propuesta (`@acuerdo` «no» de su autor sobre su id).

### Varios ajustes a la vez

- Un ajuste se escribe sobre una versión de la propuesta (`suggests`). Si el autor acepta otro antes, la propuesta ya
  dice otra cosa: `proposalFit(ajuste, texto de ahora)` da `changed`, y el ajuste no se puede aceptar a ciegas.
- Entonces el ajuste se muestra como «Se escribió sobre otra versión de la propuesta» y quien lo sugirió tiene un botón
  «Escribirlo de nuevo», que abre el editor con el texto de ahora. En esta primera versión no se intenta juntar dos
  ajustes que tocan palabras distintas.
- Si da `done` (el texto de ahora ya dice lo mismo que el ajuste), el ajuste se da por aceptado y no se muestra.

### Lo que ya está guardado

- Las notas que hoy tienen dos o más propuestas vivas (por ejemplo `asf7`, con la de María y nuestra contrapropuesta)
  siguen como opciones hasta resolverse, como hoy. Para distinguirlas de dos propuestas casi simultáneas, la regla de
  «la que se escribió después es un ajuste» vale solo para propuestas escritas desde `SINGLE_PROPOSAL_FROM`, la fecha
  en que se publica este cambio, que se guarda en `checkProposal.ts`.
- En esas notas, la app no deja agregar otra opción: lo nuevo que alguien escriba es un ajuste a la propuesta que esté
  cambiando.

## Fuera de esto

- No se guarda nada al abrir una nota.
- No cambia cómo se aplica una propuesta acordada (`applyProposal`), ni la regla de cuántas personas deciden.
- No cambian las preguntas de los pasos ni el paquete del proceso.
- No se juntan solos dos ajustes que tocan palabras distintas (ver «Varios ajustes a la vez»).

## Pruebas

En `scripts/verify-check-proposal.mts` y `scripts/verify-checklist.mts`, con nombres que digan lo que se comprueba:

- Marcas por pregunta sobre una propuesta: con «Sí» en todas, la persona la elige; con una sin marcar, no.
- Un «No» sin resolver impide que la propuesta se acuerde aunque tres la elijan; al cambiarlo a «Sí», se acuerda.
- El autor: la pregunta donde nació cuenta como «Sí» suyo; las demás las tiene que marcar.
- Las preguntas por versículo o por artículo no se piden por propuesta; `when` se lee sobre el texto propuesto.
- Un `@acuerdo` «sí» antiguo cuenta como «Sí» en todas las preguntas.
- Una propuesta nueva sobre un ítem que ya tiene propuesta se lee como ajuste; una de antes de `SINGLE_PROPOSAL_FROM`,
  como otra opción.
- El autor cambia su propuesta: una sola propuesta; las marcas de otros quedan viejas y les toca comprobarla.
- Ajuste aceptado: la propuesta toma su texto, «ajustada por», marcas viejas salvo la pregunta donde nació. Ajuste no
  aceptado: la propuesta no cambia y el ajuste queda con su `@ajuste` «no».
- `@decide` sobre un ajuste aplica su texto.
- Dos ajustes sobre la misma versión: al aceptar uno, el otro da `changed` y no se puede aceptar.
- El autor retira su propuesta: el primer ajuste pendiente pasa a ser la propuesta, y los demás, ajustes a ella.
- `summarizeChecklist`: el ítem se resuelve con la opción comprobada por `needed` personas y nadie en otra.

En el navegador, con el mock y tres personas (ana, bea, carla), a 375 px y en escritorio: proponer, comprobar la
propuesta, marcar un «No» con comentario, sugerir un ajuste, aceptarlo y no aceptarlo, y dos ajustes a la vez.
