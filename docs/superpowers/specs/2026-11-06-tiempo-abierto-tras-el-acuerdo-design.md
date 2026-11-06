# Tiempo abierto tras el acuerdo

Fecha: 6 de noviembre de 2026. Decisión de Abel, con sus palabras: «Taller debería permitir que aun si ya se alcanzó
la votación mínima necesaria, siga abierta por un tiempo para que otros puedan votar; si después de ese tiempo no hay
otras evaluaciones y ya se alcanzó el mínimo, se cierra. Sin embargo se puede reabrir si alguien decide algo diferente
después.» Los detalles de abajo los eligió Abel el mismo día.

## Para qué

Hoy un ítem queda acordado en cuanto llega al mínimo (3 personas de acuerdo en Afinación y en Armonización, 2 en la
Lectura grupal), y el paso se puede cerrar en el momento en que el último ítem lo alcanza. Quien llega una hora
después a opinar encuentra la revisión cerrada, y el texto ya pasó a la tarea siguiente. El mínimo protege la
decisión, pero no tiene por qué dejar fuera al resto del equipo.

Lo que se quiere: que alcanzar el mínimo **no cierre el ítem en el acto**. El ítem queda abierto un tiempo para que
otros también respondan. Si en ese tiempo nadie opina distinto, se cierra, y mientras el paso siga abierto se puede
reabrir.

Se mide así: tres personas de un paso de seis están de acuerdo en un ítem a las 10:00 del lunes. La cuarta lo ve el
martes, «De acuerdo · puedes opinar hasta el jueves a las 10:00», y deja una objeción: el ítem vuelve a «en
disputa». Si nadie más opina, el jueves a las 10:00 el ítem está cerrado y, con todos los demás cerrados, el paso se
puede cerrar.

## La regla

1. **Un ítem acordado queda abierto `openHours` horas** desde la hora en que quedó de acuerdo. En el FCR son
   **72 horas**.
2. **Termina antes si ya opinaron todos los que tomaron el paso.** Si cada persona sentada en el paso (las que lo
   tomaron en la subtarea) ya respondió ese ítem sobre el texto como está, no queda nadie a quien esperar: se cierra
   en el acto. Si alguien se suma al paso mientras corren las 72 horas, el ítem vuelve a estar abierto hasta que esa
   persona responda o venza el plazo.
3. **Solo un desacuerdo cambia algo.** Un «de acuerdo» más dentro del plazo no lo alarga. Una objeción, una propuesta
   de cambio o una corrección del texto lo sacan del acuerdo, como hoy («en disputa» o «pendiente»). Cuando vuelve a
   haber acuerdo, empiezan otras 72 horas desde ese momento.
4. **La decisión de la reunión se cierra en el acto.** Lo que quien coordina (o una persona habilitada que puede
   confirmar) registra como decisión final del equipo no tiene plazo: la reunión ya fue el momento de opinar. Lo mismo
   vale para lo que el equipo acordó fuera de Taller y una migración trajo (`@acordado`).
5. **Reabrir, hasta cerrar el paso.** Mientras el paso no esté cerrado, cualquiera del paso reabre un ítem cerrado con
   una objeción o una propuesta, igual que hoy. Ya cerrado el paso, no se reabre en la herramienta: lo que se vea
   después va como corrección a la fase dueña del texto, como hoy («Toda corrección posterior entra directamente en
   Afinación»).
6. **El paso se completa cuando todos sus ítems están cerrados**: acordados y sin plazo abierto. «Un capítulo a la
   vez» no cambia: el capítulo siguiente espera al cierre del paso, que ahora puede llegar hasta 72 horas después del
   último acuerdo.

«La hora en que quedó de acuerdo» es la de la respuesta con la que el ítem alcanzó el acuerdo y desde la que no dejó
de estarlo. Se calcula leyendo las respuestas en orden; no se guarda nada nuevo.

## Dónde aplica

| Paso | Herramienta | Motor | Mínimo |
|------|-------------|-------|--------|
| Lectura grupal (TPL, TPS) | `GroupReadingView` | `reviewRound.ts` | 2, uno que no lo tradujo |
| Frases con nota / Desafíos (TPL, TPS) | `AfinacionView` | `reviewRound.ts` | 3, dos independientes |
| Palabras clave (TPL, TPS) | `AfinacionView` | `reviewRound.ts` | 3, dos independientes |
| Revisar la alineación (TPL, TPS) | `AlineacionView` | `reviewRound.ts` | 2 que no alinearon |
| Notas, Palabras y Preguntas frente a los textos | `ChecklistView` | `checklist.ts` + `checkProposal.ts` | 3 |

**Fuera:** Validación (el comité pastoral decide por mayoría; es otra regla) y las tarjetas de decisión de una
propuesta de alineación (`alignmentDecision.ts`), que ya tienen su propio plazo de 3 días.

## El paquete

Un campo nuevo por paso, **`openHours`**: cuántas horas sigue abierto un ítem acordado. Vale para los pasos que
cierran por acuerdo (`closing: "consensus"`) y para las listas que decide un equipo (`closing: "checklist"` con
`claimMode: "pool"`). Sin el campo, o con 0, el ítem se cierra al acordarse, como hoy: el motor no trae un valor
propio, porque el código no conoce ningún proceso.

`processes/fcr.json` lo pone en **72** en los pasos de la tabla de arriba y sube de versión (53 → 54). Un proyecto ya
creado lo recibe con «Traer lo nuevo» en «Proceso»; hasta entonces sigue como hoy. `verify:templates` comprueba que
sea un número entero no negativo y que solo esté en pasos de esos dos tipos. `docs/PROCESOS.md` lo agrega a su tabla
de campos.

## Cómo se calcula

**Afinación y Lectura grupal (`reviewRound.ts`).** `tallyItem` y `summarizeRound` reciben tres datos más: las horas
del paso (`openHours`), las personas sentadas (`seated`) y la hora de quien mira (`now`). Para un ítem acordado, el
recuento lee las respuestas en orden de hora y busca la última vez que pasó de no acordado a acordado; esa es
`agreedAt`. El ítem queda:

- `state: "agreed"` como hoy, más **`openUntil`** (`agreedAt` + `openHours`) cuando ese momento todavía no llegó, no
  respondieron todos los sentados y no lo cerró una decisión final;
- sin `openUntil` cuando está cerrado.

`RoundSummary.complete` pasa a ser «todos acordados y ninguno con `openUntil`». Un dato nuevo, **`closesAt`**, dice
cuándo se cierra lo último que sigue abierto, para decirlo en pantalla. Las respuestas que ya no valen (un texto
corregido) no cuentan, como hoy: el ítem queda pendiente y su acuerdo vuelve a empezar.

**Armonización (`checklist.ts`, `checkProposal.ts`).** Cada pregunta de una nota (`CheckSlot`) queda resuelta como
hoy (`settled`), con su `openUntil` cuando el plazo no venció:

- resuelta por «sí» de `people` personas: desde la respuesta con la que llegó a esas `people`, y desde la que no
  hubo una propuesta abierta;
- resuelta por una propuesta acordada (todos eligieron la misma, o dejarla como está): desde el momento en que la
  elección quedó unánime. `byChoice` ya lee las respuestas en orden para saber desde cuándo hay desacuerdo
  (`disputedSince`); ahí mismo se anota desde cuándo hay acuerdo;
- resuelta por quien coordina (`@decide`) o acordada fuera de Taller (`@acordado`): sin plazo.

Una nota sigue abierta hasta el `openUntil` más tardío de sus preguntas. `ChecklistSummary.complete` espera también a
que ninguna nota tenga plazo abierto, y `closesAt` dice cuándo.

**La hora.** El plazo se mide con la hora de quien mira, contra la hora que cada respuesta lleva guardada. Unos
minutos de diferencia entre dos aparatos no cambian nada en 72 horas. La pantalla vuelve a contar sola al vencer el
plazo más próximo, sin tener que recargar.

## Cómo se ve

- **Un ítem acordado dentro del plazo:** «De acuerdo · puedes opinar hasta el jueves 12 a las 10:00». Es la fecha y la
  hora, no una cuenta regresiva. En Armonización no se muestran recuentos, como hoy: solo esa línea.
- **Para quien está en el paso y no opinó**, el ítem sigue apareciendo como suyo, porque se le invita a opinar. No le
  impide terminar: su parte queda hecha igual cuando respondió lo que le tocaba.
- **Todo acordado, con plazos abiertos:** donde hoy aparece «Cerrar la revisión», se lee «Todo está de acuerdo. Se
  puede cerrar desde el jueves 12 a las 10:00», sin botón. El aviso que hoy recibe quien coordina al acordarse todo
  lleva esa fecha.
- **Vencido el plazo:** el botón de siempre, para quien puede cerrar. Al cerrar, Armonización aplica lo acordado como
  hoy, y la subtarea se entrega.
- Los textos nuevos van en `es.json` y `pt.json`; la fecha se escribe con el idioma de la interfaz.

## Qué pasa con lo que ya se hizo

- **Afinación:** un cambio acordado se escribe en el borrador del grupo cuando se acuerda, como hoy. Si el ítem se
  reabre, se discute sobre el texto como quedó.
- **Armonización:** lo acordado se aplica solo al cerrar el paso. Mientras tanto no se escribió nada, así que reabrir
  no deshace nada.
- **Pasos ya cerrados** antes de este cambio: siguen cerrados. Un paso abierto de un proyecto que ya trajo lo nuevo
  aplica la regla también a los ítems acordados antes del cambio. Si ya pasaron 72 horas desde su acuerdo, están
  cerrados.

## Pruebas

- `verify:review-round` con casos nombrados por lo que comprueban (y `verify:group-reading`, `verify:consensus`,
  que deben seguir pasando):
  - acordado hace una hora → abierto hasta `agreedAt` + 72 h, y el paso no está completo;
  - acordado hace 73 horas → cerrado;
  - acordado, y respondieron todos los sentados → cerrado en el acto;
  - una cuarta persona se sienta dentro del plazo → abierto otra vez;
  - un «de acuerdo» más dentro del plazo → el mismo `openUntil`;
  - una objeción dentro del plazo → en disputa; retirada, el plazo empieza de nuevo;
  - decisión final de quien coordina → cerrado en el acto;
  - un paso sin `openHours` → como hoy.
- Los mismos casos para Armonización, en `verify:checklist` y `verify:check-proposal`, incluido `@acordado`; con el
  mock sembrado, `verify:proposals-mock`.
- `verify:templates` con el campo nuevo, `verify:workflow-upgrade` (que «Traer lo nuevo» lo agrega a un proyecto
  viejo) y `verify:decoupling`.
- En el mock, con ana, bea y carla en una ronda de Desafíos y en una nota de Armonización, en el teléfono (375 px) y en
  el escritorio. Para probar el vencimiento sin esperar 72 horas, un `openHours` corto en el proyecto del mock, o la
  hora adelantada en la página.

## Documentación

- `docs/PLANTILLA_FCR.md`: la regla en la sección 4 («Quién entra y cuándo queda acordado»), en la Lectura grupal
  («Cómo se acuerda un versículo») y en la 5.4 («Con tres de acuerdo»).
- `docs/PROCESOS.md`: el campo `openHours`.
- **Curso del LMS** (`idiomas-puentes-lms`, `afinacion-es-419/modules/m1.md`, tarjeta «Cuándo queda acordado un
  ítem»): las 72 horas encajan con lo que enseña. Una frase dice más que la regla: «Si después alguien ve algo
  diferente, puede reabrirlo». Propuesta: «…puede reabrirlo mientras la revisión siga abierta; ya cerrada, se pide
  como corrección a Afinación». Se cambia solo con el OK de Abel.

## Fuera de este cambio

- Avisar con la app cerrada (`push-worker`) cuando vence el plazo y el paso ya se puede cerrar.
- Validación y las tarjetas de decisión de la alineación.
- Reabrir un paso ya cerrado desde su herramienta.
