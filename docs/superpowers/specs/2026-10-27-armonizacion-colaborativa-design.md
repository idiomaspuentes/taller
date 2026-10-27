# Armonización colaborativa: abrir una nota o colaborar en ella

Fecha: 27 de octubre de 2026. Decisiones de Abel en la conversación del mismo día. Sigue a
[`2026-10-27-propuestas-con-preguntas-y-edicion-design.md`](2026-10-27-propuestas-con-preguntas-y-edicion-design.md)
(una sola propuesta por nota, ajustes que su autor acepta o no, marcas por pregunta): las reglas de ese documento no
cambian; este dice cómo se ven y reemplaza su apartado «En pantalla».

## Para qué

Con la propuesta única ya hecha, la pantalla seguía sintiéndose como una votación (Abel: «el hecho de que se tenga
que seleccionar entre dejarlo como está y la propuesta de alguien hace que se siga sintiendo como que no es un
trabajo colaborativo, sino un trabajo de votación»). Lo que se vio en el simulador, a 375 px:

- Una nota que nadie revisó y una que Ana ya revisó se ven casi iguales: el mismo título («Comprueba la nota frente
  al TPL») y las mismas preguntas con «Sí / No». Lo de Ana es una línea diminuta bajo cada pregunta («✓ @ana · 1/3»)
  y una caja al final, «Opiniones de acuerdo: TPL 1/3 · TPS 1/3 · Academia 0/3», que se lee como un recuento.
- Con una propuesta, la pantalla pide dos decisiones sobre dos textos: arriba «Sí / No» sobre la nota original y
  abajo elegir entre «Dejarla como está» y «Cambio de @ana».
- Un comentario de Ana no se ve al entrar: está dentro de «Abrir la conversación (1)».

Lo que se quiere: que al entrar a una nota, en cualquiera de sus pasos (TPL, TPS, Academia), se sepa en un segundo
si **uno la abre** (nadie dio todavía su criterio y el de uno es el primero) o **colabora** (alguien ya dio el suyo:
todo bien, una propuesta o una pregunta, y el trabajo es construir sobre eso); y que nada se parezca a elegir entre
textos ni a contar votos. Se mide así: alguien poco hábil con la tecnología, a 375 px, dice en qué situación está y
cuál es la única cosa que tiene que hacer.

## Las situaciones de un paso

Para la persona que mira, cada paso de una nota está en una de estas situaciones. Se calcula en una función pura,
`noteSituation` (`src/domain/noteSituation.ts`), con las respuestas de la lista, las propuestas (`proposalsOf` por
acuerdo de todos) y los mensajes de la nota. Se mira en este orden; la primera que se cumple es la situación:

1. **Te preguntan** (`asked`): el último mensaje de la conversación de la nota es de otra persona y es posterior a lo
   último que hizo esta persona en la nota (un mensaje, una marca, una propuesta). Lo principal es responder.
2. **Hay una propuesta** (`proposal`): la nota tiene una propuesta viva (la opción única de la propuesta, empezada
   desde `SINGLE_PROPOSAL_FROM`). En todos los pasos se revisa la propuesta, no la nota.
   - Si la propuesta es de esta persona, es su variante `ownProposal`: no se pregunta si está de acuerdo, se muestra
     cómo va y lo que le piden (ajustes por responder, un «no» por contestar).
3. **Alguien ya la revisó** (`confirm`): otra persona respondió «Sí» a todas las preguntas de este paso sobre la nota
   como está, y no hay propuesta.
4. **La abres tú** (`first`): nada de lo anterior. Nadie más dio su criterio en este paso.

Una nota con dos o más propuestas de antes de `SINGLE_PROPOSAL_FROM` (Ester, `asf7`) se queda como hoy, con su lista
de opciones (`NoteOptions`), hasta resolverse: ya tiene elecciones guardadas.

## Cómo se ve cada paso

Lo de siempre se queda: los pasos arriba (TPL → TPS → Academia), el texto del paso con lo que cita la nota marcado, y
la nota. Cambian cuatro cosas, según la situación.

### 1. Una línea arriba dice la situación

Bajo los pasos, antes del título, una línea con las caras (foto o iniciales, como en la lista del capítulo) y una
frase. Reemplaza el «@ana · 1/3» bajo cada pregunta y la caja «Opiniones de acuerdo: TPL 1/3…».

| Situación | Frase |
|---|---|
| `first` | «Eres la primera persona en revisar esta nota. Tu revisión abre la conversación.» |
| `confirm` | «Ana ya revisó esta nota. Falta: tú y Carla.» |
| `proposal` | «Ana propone un cambio. Falta: tú y Carla.» Si ya hay acuerdos: «Ana y Bea están de acuerdo con la propuesta. Falta: tú.» |
| `ownProposal` | «Tu propuesta. Bea está de acuerdo; falta Carla.» |
| `asked` | «Ana dejó una pregunta sobre esta nota.» / «Bea te respondió.» |

Cuando alguien dijo «no» o tiene una duda abierta, la frase lo resume: «Ana y Bea están de acuerdo. Carla tiene una
duda.» Así se entiende en qué va la nota sin leer la conversación.

### 2. El título le pregunta a una persona

| Situación | Título |
|---|---|
| `first` | «Comprueba la nota frente al TPL» (como hoy) |
| `confirm` | «¿Estás de acuerdo con Ana?» |
| `proposal` | «¿La propuesta de Ana cumple frente al TPL?» |
| `ownProposal` | «Tu propuesta frente al TPL» |
| `asked` | sin título: lo primero es el mensaje |

### 3. La tarjeta de la nota muestra lo que se revisa

- En `proposal` y `ownProposal`, la tarjeta de la nota muestra **la propuesta**, con lo que cambia marcado, y su
  razón debajo («Ana: “La nota no explicaba la expresión”»). La nota como está queda a un toque, «Ver como está»
  (el mismo conmutador «Juntos / Separados» de hoy). El título de la tarjeta lo dice: «La nota con la propuesta de
  Ana».
- Si la propuesta tomó ajustes, lo dice: «La nota con la propuesta de Ana, ajustada por Bea».
- Los ajustes que esperan respuesta, y los que el autor no aceptó, van bajo la tarjeta, como ya están hechos
  («Bea sugiere este ajuste», «Aceptar» / «No aceptar» para el autor, «Escribirlo de nuevo» para quien lo escribió).

### 4. Una sola cosa llena para responder

| Situación | Botón lleno | Lo demás (con borde o enlace) |
|---|---|---|
| `first` | «Sí, todo se cumple» | «Proponer un cambio», «Comentar» |
| `confirm` | «Estoy de acuerdo» | «No del todo…» |
| `proposal` | «Estoy de acuerdo con la propuesta» | «No del todo…», «Sugerir un ajuste», «Comentar» |
| `ownProposal` | lo que le piden: «Responder» (si alguien dijo «no» o preguntó), si no, nada lleno | «Cambiar mi propuesta», «Retirar» |
| `asked` | «Responder a Ana» | «También puedes revisar los puntos» |

- En `first`, las preguntas se responden una por una, como hoy.
- En `confirm` y `proposal`, las preguntas del paso se ven con la respuesta de quien ya revisó al lado, en letra que
  se lee («✓ Ana: sí»), sin botones. «Estoy de acuerdo» responde «Sí» a todas las preguntas del paso: sobre la nota
  en `confirm`, sobre la versión de la propuesta en `proposal` (`proposalMark`, como el recorrido «Comprobar esta
  propuesta», que se quita).
- «No del todo…» pone los botones «Sí / No» en cada pregunta, con la respuesta del otro al lado. Un «No» pide decir
  qué falla, como hoy: un comentario, o un cambio (en `confirm`, una propuesta; en `proposal`, un ajuste). Lo que se
  escribe va a la conversación con la etiqueta del paso.
- No hay «Dejarla como está» ni ninguna lista de opciones. Quien piensa que la nota ya estaba bien lo dice con un «No»
  y su razón; de ahí sale la conversación, y el autor puede retirar su propuesta o, tras `DISPUTE_DAYS`, decide quien
  coordina (que sigue pudiendo dejarla como está).

## La conversación de la nota

Una sola conversación por nota, para todos sus pasos.

- **Qué tiene:** los mensajes de todos y, como líneas cortas y quietas, lo que cada quien hizo:
  «Ana revisó: todo se cumple», «Bea está de acuerdo», «Ana propuso un cambio · ver», «Bea sugirió un ajuste»,
  «Ana aceptó el ajuste de Bea · ver», «Carla dijo que no: “…”», «Tito decidió». Cada mensaje o línea que habla de un
  paso lleva su etiqueta (TPL, TPS, Academia). Se arma en una función pura, `noteTimeline`
  (`src/domain/noteTimeline.ts`), a partir de las mismas filas; es lo que hoy arma `ChecklistView` para
  `NoteConversation` (`TalkLine`), con las líneas de ajustes, de marcas y de «no» que faltan.
- **En la nota:** los dos últimos mensajes, un campo «Escribe al equipo…» y «Ver toda la conversación (n)». Va entre
  la tarjeta de la nota y los botones para responder, para que una conversación larga no empuje la decisión fuera de
  la pantalla.
- **Toda la conversación:** una hoja que sube, con el campo de escribir abajo (pegado al teclado) y una marca
  «nuevo para ti» antes de lo que llegó después de lo último que hizo la persona en esa nota. Se abre en esa marca.
  En escritorio (1280 px o más) puede ir en una columna al lado.
- **Escribir no obliga a decidir:** un mensaje se guarda, la persona se queda en la nota, y la conversación sigue.
- **Cómo se guarda:** los mensajes son las filas `@conversacion` de hoy (`itemSaying`), con un campo nuevo opcional
  `step` (el `about` del grupo de preguntas: el paso). Los mensajes de antes, sin `step`, se ven sin etiqueta.
- Los mensajes de otros equipos sobre la nota (`HelpMessages`) siguen al final de la hoja, plegados.

## A dónde lleva la app

- Tras «Sí, todo se cumple» o «Estoy de acuerdo» en un paso: al paso siguiente de la nota; desde el último, a la
  siguiente nota donde hace falta (`nextNeeding`, como hoy).
- Si lo que se respondió deja la nota acordada, se dice una vez: «Quedó acordada: Ana, Bea y tú.»
- Tras escribir un mensaje: se queda en la nota. Las flechas a la siguiente nota siguen a la vista.

## La lista del capítulo y «Mis tareas»

En `ChapterHelpsList` (y donde «Mis tareas» resume lo mismo):

| Hoy | Ahora |
|---|---|
| «Lista» / «Listas» | «Acordada» / «Acordadas» |
| «Esperando a otros» | «Esperando a Bea y Carla» (los nombres de quienes faltan; «Esperando a otros» en el filtro) |
| «Sin revisar» | «Nadie la revisó aún» |
| «Te toca» | «Te toca», con el porqué debajo, en una línea: «Ana propone un cambio», «Ana te respondió», «Ana ya la revisó», «Bea sugiere un ajuste a tu propuesta» |

El porqué sale de `noteSituation` del paso que le toca a la persona.

## Fuera de esto

- No cambian las reglas de acuerdo (tres personas, cada pregunta, quien coordina tras `DISPUTE_DAYS`), ni el paquete
  del proceso, ni cómo se aplica una propuesta acordada.
- No se agregan avisos nuevos ni notificaciones: «Te toca» y la lista siguen siendo el aviso.
- La pantalla aparte del acuerdo (`ProposalsView`, por mayoría) no cambia.

## Pruebas

- `scripts/verify-note-situation.mts` (nuevo, `npm run verify:note-situation`): cada situación con filas de ana, bea y
  carla: nota sin nada (`first`); Ana con «Sí» en todo el TPL (`confirm` para Bea en el TPL, `first` en el TPS); una
  propuesta de Ana (`proposal` para Bea en los tres pasos, `ownProposal` para Ana); un mensaje de Ana sin respuesta
  (`asked` para Bea, y deja de serlo cuando Bea escribe o marca); una nota con dos propuestas antiguas (fuera de estas
  situaciones: lista de opciones); «Estoy de acuerdo» guarda «Sí» en todas las preguntas del paso, sobre la nota o
  sobre la versión de la propuesta.
- `scripts/verify-note-timeline.mts` (nuevo): el orden de mensajes y líneas, la etiqueta del paso, la marca «nuevo
  para ti» después de lo último de quien mira, un mensaje antiguo sin `step`.
- `scripts/verify-chapter-roster.mts`: los nuevos nombres de estado y el porqué de «Te toca».
- En el navegador, con el simulador y tres personas, a 375 px y a 1280 px, en español y portugués: abrir una nota
  nueva; confirmar la de otra; revisar una propuesta y decir «No del todo…» con un ajuste; una conversación de más de
  diez mensajes (la decisión sigue a la vista); la lista del capítulo con sus porqués. Con los números de la lista de
  comprobación de `docs/FILOSOFIA_DE_DISENO.md`.
