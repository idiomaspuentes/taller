# Fase 1, entrega 6: la lectura grupal como conversación (D2)

*Escrito el 26 de noviembre de 2026. Lo leyeron tres revisores sin contexto (Sonnet), dos sobre la primera versión y uno sobre las correcciones. Pendiente de la aprobación de Abel.*

Lo marcado «(decidido)» ya lo decidió Abel, en el diseño de la fase o en la entrega 5. Lo marcado «(mi decisión)» lo decidí al escribir, y Abel lo revisa al aprobar.

Parte del diseño de la Fase 1 ([`2026-11-23-fase-1-traduccion-design.md`](2026-11-23-fase-1-traduccion-design.md), propuesta D2) y de su plan ([`2026-11-24-fase-1-traduccion.md`](../plans/2026-11-24-fase-1-traduccion.md), «Entregas 5 y 6»). Sigue la forma de la entrega 5 ([`2026-11-25-fase-1-entrega-5-design.md`](2026-11-25-fase-1-entrega-5-design.md)). Los nombres técnicos entre paréntesis son para quien lo construya.

## 1. Para qué

La lectura grupal hoy se siente como una planilla de votos: cada versículo trae tres botones («De acuerdo», «Corregir», «Tengo una duda») y un conteo «0 de 2 de acuerdo». «De acuerdo con el pasaje» está arriba, antes de leer. Los dos textos en inglés van encima de cada versículo. Esta entrega hace que se lea como la revisión en pares de la entrega 5: el pasaje de corrido, la conversación al tocar un versículo, y el acuerdo al final.

**Lo que no cambia (decisión 1 de Abel, 24-11):** la regla de cierre. Cada versículo queda acordado con `minAssignees` personas de acuerdo (hoy 2), al menos `minIndependent` que no lo tradujeron (hoy 1), y ninguna duda abierta. La lectura sigue abierta `openHours` (72 h) después del último acuerdo. Cambia lo que se ve y cómo se dice.

**Éxito:** quien entra lee el pasaje como texto, toca solo el versículo que le hace dudar, y al final dice «Estoy de acuerdo con este pasaje». Ve quiénes ya están de acuerdo por su cara, y llega a cada duda abierta con un toque desde arriba.

**Fracaso aunque funcione:** que el acuerdo con el pasaje se pueda dar sin pasar por el texto, que tape una duda que otra persona dejó, o que alguien no sepa por qué la lectura no se cierra.

## 2. Alcance

- Solo `GroupReadingView.tsx`, su guía (`ReadingGuide`) y sus textos. La revisión en pares no se toca.
- **No cambia cómo se guarda nada (mi decisión).** Cada respuesta sigue siendo una `ReviewDecision` por versículo y por texto, en el archivo de decisiones de cada persona (`appendMyDecisions`). Una propuesta de otras palabras sigue abriendo una decisión del equipo (`openTextProposal`). Ver 5.
- La regla `partial` de `waitBlocks` (`src/domain/waits.ts`) ya hace que la lectura espere sola al primer pasaje entregado: no se construye (decidido, plan de la fase).
- Van en esta entrega dos comprobaciones que el plan dejó pendientes (issue #67): el cierre completo de una lectura con sus 72 h en el mock (`?mockHoursAhead`), y la revisión en pares de Palabras y Academia.

## 3. Lo que se ve

### 3.1 El pasaje se lee de corrido, en un solo texto (decidido)

A 375 px:

```
 Ester 1 · Lectura grupal · TPL
 ─────────────────────────────
 Hay una duda en 1:3                  ← lleva al 1:3 y lo abre
 ─────────────────────────────
 1:1–4
 1  Y aconteció en los días de
    Asuero, el Asuero que reinaba…
 2  En aquellos días, cuando el
    rey Asuero se sentó…
 ┌ 3  En el año tercero de su ────┐   ← abierto
 │   ULT  In the third year…      │
 │   @bea: ¿«banquete» o «fiesta»?│
 │   (Ana) (Carla) de acuerdo     │
 │     Responder    No del todo…  │
 └────────────────────────────────┘
 4  Cuando él mostró las riquezas…

 (Ana) (Carla)  están de acuerdo
 [ Estoy de acuerdo con este pasaje ]
              No del todo…
 ─────────────────────────────
 1:5–8   Todavía en traducción
```

- **Un solo texto a la vez.** En el FCR cada lectura lee un texto (la de TPL o la de TPS), y así se ve. Si un proceso pone dos textos en la misma lectura (`data.texts` con más de uno), arriba hay un selector con sus nombres; el que tiene algo por hacer para mí lleva un punto. Los versículos, las dudas de arriba, las caras y el acuerdo con el pasaje son del texto elegido; el pie y el cierre cuentan todos los textos, como hoy (`readingProgress`), y el pie nombra el otro texto si me falta algo en él: «Le falta leer el TPS» (mi decisión). Se abre en el primero que tiene algo por hacer para mí.
- **Cada versículo se ve solo con su número y su texto**, como una pieza de la revisión en pares (`.rv-piece`, `.rv-piece__read`): sin botones, sin conteo, sin fuentes. Cada pieza mide al menos 44 px de alto.
- **Un versículo vacío dentro de un pasaje entregado** (su texto quedó unido al anterior en un puente) no se muestra ni cuenta, como hoy (`readingProgress` lo salta). Si el borrador marca el puente, la pieza anterior lleva su lugar entero (`1:3–4`); si no, solo el suyo.
- **Las marcas de un versículo cerrado** son los dos puntos de la entrega 5 (`.rv-dot`): «tiene conversación» (alguien escribió algo sobre ese versículo, aunque sea sobre un texto anterior) y «hay algo abierto» (una duda sin cerrar). Uno más, «cambió desde que usted lo leyó», cuando mi respuesta quedó vieja porque el texto cambió (`tally.stale`) (mi decisión: hoy eso solo se dice dentro del versículo abierto; con el punto se ve sin abrirlo). Cada punto tiene su `aria-label` y su color, dentro de la filosofía de diseño.
- **Se van:** la frase larga de arriba (`gr.lede`, «Cada versículo queda acordado cuando…»: lo dice `StepAsk`), el interruptor «Mostrar fuentes» y el estado de cada versículo («0 de 2 de acuerdo», «acordado», «hay una duda»).
- **Un pasaje que todavía no llegó** se ve con su lugar y «Todavía en traducción», como hoy, sin versículos.

### 3.2 Un versículo abierto (decidido)

Tocar un versículo lo abre debajo, de uno en uno (abrir otro cierra el anterior, salvo que tenga una caja con texto, como en la entrega 5). Abierto muestra, en este orden:

1. **La fuente con que se compara:** el ULT para el TPL, el UST para el TPS, como hoy. El enlace «Ver también UST» (o ULT) queda, y también el de los pasajes paralelos (`ParallelLink`).
2. **La conversación:** todo lo que se escribió sobre ese versículo (dudas, respuestas, propuestas), en orden de fecha, con la cara y el nombre de quien habló (`door43Person`, con `@login` de respaldo). **Sale de todas las respuestas guardadas con nota de ese versículo** (`data.decisions` filtradas por `itemId`), no del conteo: el conteo (`tally.answers`) guarda solo la última respuesta de cada persona, y una duda retirada o una respuesta vieja desaparecerían. Lo dicho sobre un texto anterior (su `textHash` no es el de ahora) lleva la línea «Sobre el texto anterior». Una propuesta se lee como hoy: «Propuse otra redacción (decisión #12): …». Se ven las dos últimas y, encima, «Ver 3 antes».
3. **Las caras de quienes están de acuerdo con ese versículo** y, si falta algo para acordarlo, la línea de 3.4.
4. **Lo que puedo hacer**, como mucho dos enlaces discretos (ninguno lleno: lo lleno está al final del pasaje):
   - Si otra persona tiene una duda abierta: **«Responder»**, también si ya estoy de acuerdo (mi decisión: con el acuerdo al final del pasaje, lo normal es acordar primero y que la duda llegue después). Abre la caja «Por qué está bien así», que aquí **pide escribir algo**, y guarda el acuerdo con ese motivo (`reply`, con el aviso a quien preguntó). Mi respuesta sigue siendo un acuerdo, ahora con nota.
   - Si la duda es mía: **«Ya no tengo la duda»**, como hoy. Cambiar lo que dije es «No del todo…» → «Comentar algo», que abre con mi duda escrita (hoy «Cambiar mi duda»: se va como botón aparte).
   - Siempre que la lectura no esté cerrada: **«No del todo…»** (3.3).

No hay «De acuerdo» por versículo (mi decisión): se está de acuerdo con el pasaje (3.5), y en un versículo con duda se responde. Quien quiere decir algo de un versículo sin estar en desacuerdo usa «No del todo…» → «Comentar algo», y eso cuenta como duda hasta que la retire: es lo que hoy hace «Tengo una duda».

### 3.3 «No del todo…» (decidido)

Abre los dos caminos de la entrega 5, con las cajas de hoy:

- **«Proponer otras palabras»**: la caja abre con el texto del versículo ya escrito, y «Por qué lo cambia» con los motivos (`CorrectionReasons`, `ReasonField`), como hoy «Corregir». Botón «Enviar propuesta», apagado mientras el texto sea igual o difiera solo en espacios o comillas (la regla de la entrega 5). Abre una decisión del equipo (`openTextProposal`), y mi respuesta al versículo queda como duda con lo propuesto, como hoy. Un texto que ya tiene otra fase no se propone desde aquí (`heldByLaterPhase`), como hoy.
- **«Comentar algo»**: la caja «¿Cuál es su duda?» de hoy. Se guarda como duda (`status: "revise"` con `note`).

Las dos piden escribir algo. Lo escrito en una caja se conserva al cerrar y abrir el versículo (A1).

**«No del todo…» al final del pasaje** (mi decisión) es un enlace de 44 px de alto debajo del botón, no un botón. Abre una hoja corta: «¿En qué versículo?», con los números de los versículos con texto del pasaje como botones de 44 px. Tocar uno cierra la hoja, abre ese versículo y despliega sus dos caminos. Es la misma puerta que el versículo, para quien llegó al final sin saber que se toca un versículo: el diseño de la fase pide «No del todo…» al final de cada pasaje.

### 3.4 Las caras en vez de contar (decidido)

- **Al final de cada pasaje**, las caras (`PersonPhoto`, tamaño pequeño) de quienes están de acuerdo con **todos** sus versículos con texto, en el texto elegido, con respuesta vigente (`tally.answers` con `status: "approved"`; una vieja está en `stale` y no cuenta), y la línea «están de acuerdo» (o «está de acuerdo»). Si nadie, no hay caras ni línea. Con más de cinco, cinco caras y «+3».
- **En un versículo abierto**, las caras de quienes están de acuerdo con ese versículo, con la misma regla.
- **Las caras son de todas las personas que están de acuerdo**, cuenten o no para cerrar (una persona de un nivel que no cuenta, `levelsForTeam`, también está de acuerdo, y se ve) (mi decisión). Por eso la línea de abajo no se deduce de las caras: sale del conteo.
- **Sin números (mi decisión).** Cuando el pasaje todavía no está acordado, una sola línea dice por qué. Se deduce del conteo de cada versículo (`tallyItem`), del primer versículo no acordado, en este orden:
  1. Tiene una duda abierta (`tally.open` no vacío): «Hay una duda en 1:3» (o «Hay dudas en 1:2 y 1:3»), con enlace al primero.
  2. Tiene `selections` (en translationCore se marcaron palabras distintas): «En 1:3 hay palabras por decidir en translationCore». Abierto, ese versículo lo dice con la misma frase; se decide allí, no aquí.
  3. `tally.agree` es menor que `minAssignees`: «Falta que lo lea alguien más».
  4. Si no (`state` sigue `pending` con `agree` suficiente), falta `minIndependent`: «Falta que lo lea alguien que no lo tradujo».
  Un versículo con `tally.state === "agreed"` (también uno cerrado por decisión final, `decided`) no bloquea nada, tenga las caras que tenga.
- Cuando el pasaje está acordado: las caras y «Acordado». Mientras sigue abierto el tiempo (`openUntil`), lo dice como hoy (`round.openUntil`).

### 3.5 «Estoy de acuerdo con este pasaje» (decidido)

Va al final de cada pasaje que llegó, después del último versículo.

- **Qué guarda:** lo que hoy guarda «De acuerdo con el pasaje» (`answer(unanswered(passage))`), menos lo de abajo: un acuerdo por cada versículo con texto del pasaje que todavía no respondí, o cuyo acuerdo mío quedó viejo. Nada nuevo.
- **No tapa las dudas de otros (mi decisión).** Un versículo donde otra persona tiene una duda abierta y yo no tengo respuesta vigente no entra: esa duda se responde en su versículo (3.2). Si ya respondí (mi acuerdo vigente, con o sin nota), no queda nada pendiente para mí allí.
- **Mis dudas tampoco:** un versículo donde tengo una duda vigente no pasa a acuerdo por tocar el pasaje. Para eso está «Ya no tengo la duda».
- **Mi duda sobre un texto que ya cambió** (vieja, `stale`) ya no está abierta para el conteo, como hoy: lo más probable es que el cambio la haya atendido. Ese versículo entra en lo que guarda el botón, lleva el punto «cambió», y la línea dice «1:3 cambió desde su duda», con enlace, para que lo lea antes de tocar (mi decisión).
- Un versículo cerrado por una decisión final (`decided`) no le pide nada a nadie.
- **Si queda algo así**, debajo del botón (o en su lugar, si no queda ningún versículo que el botón pueda guardar) la línea dice qué me toca, con enlace al versículo: «Le queda responder la duda de 1:3», o «Su duda de 1:3 sigue abierta».
- **Con borde hasta llegar al final (decidido en la entrega 5):** el botón va con borde hasta que el último versículo con texto del pasaje estuvo en la pantalla al menos una vez en esta visita (`IntersectionObserver` con `root` en `.fam__body`, como `seen` en `PortionReviewView`). Se cuenta por visita, como en la entrega 5: quien vuelve otro día pasa otra vez por el pasaje, que es lo que se le pide. Si el pasaje cabe en la pantalla, se llena al abrir. Tocarlo con borde pregunta «Todavía no llegó al final del pasaje. ¿Está de acuerdo con todo?», con «Sí, estoy de acuerdo» y «Seguir leyendo».
- **Un solo botón lleno en la pantalla (mi decisión):** si hay varios pasajes por acordar, solo el primero que me falta lleva el botón lleno (cuando ya lo vi); los demás van con borde. Mientras haya uno lleno, el pie no tiene botón lleno (3.7). Excepción: si la lectura ya se puede cerrar (`progress.complete`), «Cerrar la lectura grupal» es el lleno y los botones de los pasajes van con borde.
- **Ya estoy de acuerdo con el pasaje:** en vez del botón, mi cara junto a las otras. Si un versículo cambió después (mi acuerdo quedó viejo, `stale`), el botón vuelve, y la línea dice «1:3 cambió desde que usted estuvo de acuerdo», con enlace.
- **Quien tradujo el pasaje** también lo ve y responde: su acuerdo cuenta, pero no como independiente, como hoy (`authorsByItem`).

### 3.6 Arriba: las dudas a un toque (decidido)

- **Una sola línea** arriba, solo si hay dudas abiertas en lo que llegó del texto elegido. Cada número es un enlace que desplaza `.fam__body` hasta ese versículo y lo abre.
- La línea empieza por lo mío y sigue con lo demás, sin repetir versículos: «Le respondieron en 1:3 · Hay dudas en 1:2 y 1:7». «Le respondieron» es una duda mía con un acuerdo con nota posterior (hoy `gr.doubtAnswered`); si mi duda no tiene respuesta, va con las demás.
- Sin dudas, no hay línea: arriba queda solo la barra con el lugar y `StepAsk`.

### 3.7 El pie (mi decisión)

La línea del pie dice dónde está la lectura, sin números. Gana la primera fila que se cumple:

| Momento | Línea | Botón |
|---|---|---|
| Cerrada | «Esta lectura grupal ya está cerrada.» | «Volver a mis tareas», lleno |
| Todo llegó, acordado y sin tiempo abierto (`progress.complete`) | «Todo llegó y todo está acordado.» | «Cerrar la lectura grupal», lleno, como hoy: lo puede cerrar cualquiera, haya leído o no |
| No llegó nada | «Todavía no llegó ningún pasaje. Aparecen aquí a medida que se entregan.» | «Volver a mis tareas», lleno |
| Me falta acordar un pasaje (el botón de 3.5 puede guardar algo) | «Le falta leer 1:5–8» (el primero), o «Le falta leer el TPS» si es en el otro texto | «Volver a mis tareas», con borde: lo lleno está al final del pasaje |
| Solo me quedan dudas: mías vigentes, o de otros sin responder | La línea de 3.5 («Le queda responder la duda de 1:3», «Su duda de 1:3 sigue abierta»), con enlace | «Volver a mis tareas», lleno |
| Hice todo; falta que lleguen pasajes | «Ya leyó todo lo que llegó. Los demás pasajes aparecen aquí cuando se entreguen.» | «Volver a mis tareas», lleno |
| Hice todo; todo llegó, pero no está acordado | La razón del primer pasaje sin acordar (3.4): «Falta que lo lea alguien más», «Falta que lo lea alguien que no lo tradujo», «Hay una duda en 1:3» | «Volver a mis tareas», lleno |
| Todo acordado, con tiempo abierto | `round.allAgreedOpen`, como hoy | «Volver a mis tareas», lleno |

Así en la pantalla hay un solo botón lleno: el del pasaje, o el del pie. «Volver a mis tareas» es `onClose`. El cierre sigue siendo `completeStepFromTool`.

**Cerrada:** los versículos se leen igual, con su conversación, sin «Responder» ni «No del todo…», sin botón al final de los pasajes y sin línea de dudas arriba. Una duda que quedó abierta al cerrar (la cerró una decisión final) se ve en la conversación, como un comentario más.

### 3.8 La guía (mi decisión)

`ReadingGuide` señala tres cosas, como `ReviewGuide`: un versículo («Toque un versículo para ver su fuente y lo que dijo el equipo»), y espera a que se abra (`kind: "tap"`, `when`, `done`, `watch`, como `ReviewGuide`; `ReadingGuide` gana esas props); «No del todo…» dentro de él; y el botón del final del pasaje. Las claves de «visto» cambian (`reading:piece`, `reading:notQuite`, `reading:passage`), para que quien ya vio la guía vieja vea la nueva.

### 3.9 Con el teclado abierto (decidido en la entrega 5)

En «Proponer otras palabras», «Comentar algo» y «Responder», la caja queda arriba de todo con el teclado abierto, y lo escrito se conserva al cerrar y abrir el versículo. «Por qué lo cambia» y los motivos van debajo de la caja de la propuesta.

### 3.10 Las 72 h

Nada cambia en la regla. Si mi acuerdo con un versículo queda viejo porque el equipo aplicó una propuesta durante el tiempo abierto, el versículo lleva el punto «cambió» y el pasaje me vuelve a pedir el acuerdo (3.5), como hoy pide «Mírelo de nuevo».

## 4. Lo que se queda de `GroupReadingView`

- La carga (`loadGroupReading`), los pasajes y lo que espera (`readingPassages`), el conteo de cada versículo (`tallyItem`) y el avance (`readingProgress`), el tiempo abierto (`useOpenWindow`, `wakeAt`) y `useStepWork`.
- `answer`, `reply` (con el aviso a quien preguntó), `correct` (que pasa a llamarse por lo que hace: proponer) y `close`.
- La fuente propia de cada texto, con la otra a pedido (`support`), y `ParallelLink`.
- Todo lo que se escribe en Door43, sin cambios.

## 5. Los datos: no cambia nada (mi decisión)

- **El acuerdo de cada persona** sigue en su archivo de decisiones, en el repositorio del borrador del grupo (`appendMyDecisions`, `decisionsFilePath`): una `ReviewDecision` por versículo y texto, con `textHash` para saber si quedó vieja. El acuerdo con el pasaje son varias de esas, como hoy.
- **Una duda** es una `ReviewDecision` con `status: "revise"` y su `note`. **Una respuesta** es un acuerdo con `note` (`reply`). Las caras salen de las mismas respuestas.
- **Una propuesta** es una decisión del equipo (`openTextProposal`) más mi duda con lo propuesto, como hoy. No se usa el marcador `taller-proposal` de la entrega 5: aquí no hay una autora que la aplique en su borrador, sino el equipo que decide sobre el borrador del grupo.
- Por eso una versión vieja de la app (un teléfono sin actualizar) y la nueva leen y escriben lo mismo, y no hay nada que migrar.

Opción descartada: guardar un «acuerdo con el pasaje» como una sola respuesta nueva. Rompería `tallyItem`, que cuenta por versículo, y las 72 h de cada uno, sin ganar nada que se vea.

## 6. Límites de pantalla

A 375 px: como mucho 12 controles, ninguno de menos de 44 px, un solo botón lleno y dos pantallas de alto. Se cuenta como en la entrega 5: los versículos cerrados son el texto que se lee (cada uno de 44 px de alto como mínimo); los 12 se cuentan en lo que rodea al versículo abierto (fuente, conversación, sus acciones), el final de ese pasaje, el pie y la barra de arriba. Con muchas respuestas en un versículo, se ven las dos últimas y «Ver 3 antes». Las dos pantallas de alto se miden con un versículo abierto, sin contar el resto del capítulo. Cada texto nuevo lleva su regla `html[data-text] … { font-size: calc(Xrem * var(--ts)); }`. Se mide también en portugués.

## 7. Cómo se sabrá que quedó bien

**Pruebas automáticas** (lógica pura, en `scripts/verify-group-reading.mts`, que ya existe):

- Quiénes están de acuerdo con un pasaje: todos sus versículos con texto con acuerdo vigente; una respuesta vieja o una duda no cuentan; un versículo vacío se salta.
- Lo que guarda «Estoy de acuerdo con este pasaje»: deja fuera los versículos con duda de otra persona que no respondí y los míos con duda (vigente o vieja); incluye los que tenían mi acuerdo viejo.
- Por qué no se puede acordar un pasaje: duda, falta alguien, falta alguien que no lo tradujo, en ese orden; un versículo cerrado por decisión final no bloquea.
- Las dudas de arriba, con las mías primero y «le respondieron» cuando hay un acuerdo con nota después de mi duda.
- La conversación de un versículo: todo lo dicho con nota, en orden, también lo retirado y lo dicho sobre un texto anterior.
- Siguen pasando `tsc`, `verify:group-reading`, `verify:reading-arrivals`, `verify:review-round`, `verify:decoupling`, `verify:config`, `verify:guide` y `verify:text-size`.

**En el navegador, contra el mock**, con Ana (tradujo el TPL de Ester 1:1–4), Bea y Carla, a 375 y 1280 px, en español y en portugués:

1. Ana lleva su TPL 1:1–4 hasta «Entregar al grupo». Bea abre la lectura del TPL: el pasaje se lee de corrido, el 1:5 en adelante dice «Todavía en traducción», el botón del final está con borde y se llena al ver el 1:4.
2. Bea toca el 1:3, «No del todo…» → «Comentar algo», y deja una duda. Arriba aparece «Hay una duda en 1:3». Toca «Estoy de acuerdo con este pasaje»: la línea dice que le queda la duda del 1:3 (la suya no se tapa).
3. Carla entra: ve la duda arriba, la toca y llega al 1:3 abierto. «Responder», con un motivo. Toca el acuerdo con el pasaje: entran 1:1, 1:2, 1:3 (ya respondido) y 1:4. Ve su cara al final.
4. Bea vuelve: arriba, «Le respondieron en 1:3». «Ya no tengo la duda»: como ya había acordado lo demás, el botón del pasaje desaparece. Al final, las caras de Bea y Carla, y el pasaje acordado.
5. Con `?mockHoursAhead=73`: el pie dice que todo está acordado y ofrece «Cerrar la lectura grupal». Se cierra, y la tarea sale de la lista de todos (#67).
6. Una propuesta: Carla propone otras palabras en el 1:2. Se abre la decisión del equipo; el versículo queda con su duda. (Aplicarla es de Afinación y no cambia aquí.)
7. Una lectura con respuestas guardadas por la versión de hoy se abre sin errores y con las mismas caras y dudas.
8. La revisión en pares de Palabras y de Academia (#67), con un artículo marcado a mano como pendiente: proponer, usar y aprobar.

## 8. Lo que queda para quien construye

- Las frases exactas en `es.json` y `pt.json` (las de aquí son la guía), con `translations:review`. Las claves `gr.*` que ya no se usan se borran.
- Si el versículo abierto reutiliza piezas de `PortionReviewView` (los puntos, la hoja «…», la caja que conserva lo escrito) moviéndolas a un componente común, o las copia. Mejor común, si no cambia la revisión en pares.
- Cómo se ve la lista de caras cuando son muchas (hasta `maxAssignees`, 8): por ejemplo, cinco y «+3».
