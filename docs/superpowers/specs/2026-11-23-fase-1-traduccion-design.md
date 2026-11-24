# Fase 1 (Traducción): diagnóstico y diseño

*Escrito el 23 de noviembre de 2026. **Aprobado por Abel el 24 de noviembre**, con las cuatro recomendaciones de la sección 6. Todavía no se ha cambiado código de la app.*

## 1. Para qué es esto

La Fase 1 es donde el equipo escribe el primer borrador de los seis recursos: TPL, TPS, Notas, Preguntas, Palabras y Academia. Lo usa gente que trabaja sobre todo en el teléfono y que no se maneja bien con la tecnología.

Afinación y Armonización ya se rediseñaron para esa persona. Este documento lleva a la Fase 1 lo que allí funcionó, en el orden que Abel fijó el 6 de octubre: «Lo más importante no son los avisos, es todo el proceso que funcione y sea fácil de entender para personas que no son hábiles con la tecnología.»

**El resultado buscado:** una persona abre «Mis tareas», ve una sola cosa obvia que hacer, la hace y la app la lleva a la siguiente, hasta que su texto llega a la lectura del grupo.

**No es parte de este trabajo:**

- Cambiar quién debe hacer o aprobar cada paso, salvo lo que Abel decida en la sección 6.
- La entrada con Door43, que diseña otra sesión. Ninguna propuesta toca esa pantalla.
- Llevar aquí el ritmo de Afinación de «Estudiar, Marcar, Decidir» punto por punto. Sirve para revisar, pero escribir un capítulo necesita fluir de un versículo al siguiente. (El paso «Estudio» de la Fase 1 es otra cosa y sí se mejora, en C1 y C2.)

Los nombres técnicos entre paréntesis son para quien lo construya. Para aprobar el diseño no hace falta leerlos.

## 2. Lo que se recorrió

Se recorrió la fase en el mock (la copia de prueba de Door43), con Ester 1 como libro nuevo y con dos personas (Ana traduce, Bea revisa), a 375 px y después a 1280 px.

- **El camino completo del TPL, de punta a punta:** Estudio, Borrador, Revisión en pares con un pedido de cambios, corrección, aprobación, acuerdo de la autora, entrega y lectura grupal hasta dejar un versículo acordado.
- **Cada recurso:** TPS (mismo editor que el TPL), Notas, Preguntas (también su revisión en pares), Palabras y Academia.

**Lo que no se comprobó, y hay que mirar al construir:**

- Ningún teléfono real. El teclado se simuló con una pantalla de 420 px de alto.
- La interfaz en portugués.
- El cierre de una lectura grupal completa: solo llegó un pasaje de ocho, y no se recorrieron las 72 horas abiertas.
- La revisión en pares de Palabras y Academia. Usa la misma pantalla que la de Preguntas, pero con párrafos.
- Los artículos de Palabras y Academia se marcaron a mano como pendientes, porque los de Ester ya están publicados.
- Una tarjeta de Preguntas ya en revisión apareció en «Para empezar», sin nada que hacer. Esa tarea se abrió por un camino de prueba, así que puede ser efecto de la prueba. Hay que mirarlo al construir B1.

### Medidas a 375 px

Los límites de la filosofía de diseño son 12 cosas para tocar, ninguna de menos de 44 px (el alto cómodo para un dedo), un solo botón lleno y dos alturas de pantalla. «7,96 pantallas» quiere decir que hay que deslizar casi ocho veces el alto del teléfono para llegar al final.

| Pantalla | Controles | Bajo 44 px | Botones llenos | Pantallas de alto |
|---|---|---|---|---|
| Estudio (parte «El pasaje») | 12 | 7 | 2 (uno apagado) | **7,96** |
| Borrador TPL o TPS, sin abrir | 9 | 1 | 1 (apagado) | 1 |
| Borrador TPL, versículo abierto | 12–13 | 3 | 1 (apagado) | 1 |
| Borrador de Notas (primera porción) | **75** | 26 | 1 | **8,69** |
| Borrador de Preguntas | 13 | 6 | 1 (apagado) | 1 |
| Borrador de Palabras | **40** | 23 | 1 (apagado) | 2,76 |
| Borrador de Academia | **46** | 8 | 1 (apagado) | 4,61 |
| Revisión en pares del TPL (4 versículos) | 25–26 | 19–20 | 1 | 2,8–3,0 |
| Revisión en pares de Preguntas | 13 | 8 | 1 | 1,71 |
| Lectura grupal (4 versículos) | 20–21 | 17–18 | 0 | 3,1 |

Con los 22 versículos del capítulo, la lectura grupal mediría unas 16 pantallas. Es una estimación a partir de los cuatro medidos.

A 1280 px ninguna pantalla se rompe ni se desborda.

### Lo que ya funciona y se conserva

- «Terminé de estudiar» lleva directo al borrador.
- La ventana «De qué se trata» con los pasos y «usted está aquí».
- El versículo abierto del editor: ULT, caja y «Fíjese en esto» en una línea discreta.
- La nota abierta, que es el mejor patrón de la fase: la frase en ULT y UST, «Ver 1:1 completo», la nota, la caja vacía, «Copiar el original» y «Siguiente».
- La pregunta antes de entregar incompleto («Quedan 3 versículos sin traducir»), y que «Seguir traduciendo» abra el que falta.
- Las tarjetas que dicen a quién le toca («@ana ya corrigió su borrador. Míralo otra vez»).
- «Para mí está bien», que ya suena a colaborar.
- La lectura grupal espera sola a que llegue el primer pasaje: mientras tanto, su tarjeta queda «En espera».

El 6 de octubre ya se habían arreglado cinco cosas de esta fase: ayudas que venían llenas de inglés, volver al inicio de la lista tras cada paso, un «Terminé» antes de escribir nada, tarjetas en orden inverso y dos botones con dos nombres para tomar una revisión. Las cinco siguen arregladas. Lo que falta es que la lista, además de no perder el lugar, ofrezca lo siguiente (B1 y B2).

## 3. Lo que más importa

Cinco cosas, en palabras de quien usa la app:

1. **Lo urgente queda abajo.** Cuando me piden cambios, esa tarjeta puede quedar cuarta y el botón grande me lleva a otra tarea (B1).
2. **Al terminar no sé qué sigue.** Vuelvo a la lista y el siguiente pasaje está plegado (B1 y B2).
3. **Mi texto no llega si no encuentro un enlace.** Con la revisión completa falta «Entregar», un enlace pequeño. Si nadie lo toca, el grupo nunca recibe el texto (B3).
4. **Pierdo lo que escribí.** Un comentario a medio escribir se borra al tocar «Comentar» en otro versículo (A1).
5. **Me hacen resolver un mensaje que no escribí.** Para aprobar hay que marcar como resuelto un aviso que escribió la app (A2).

## 4. Las propuestas

Cada una dice qué vio la persona, qué se cambia, de dónde viene la idea y cuánto cuesta.

**Costo:** *pequeño* es una función o un componente con su prueba; *mediano*, varias partes de una pantalla; *grande*, rehacer cómo se ve una pantalla.

### A. Dos fallos que hay que arreglar primero

Ninguno depende del resto del diseño.

**A1. Un comentario a medio escribir se pierde.**
- *Qué vio la persona:* Bea escribió un comentario en 1:2, tocó «Comentar» en 1:3 y su texto desapareció sin aviso. Se reprodujo con el teclado.
- *Causa:* la pantalla solo admite una caja abierta y, al cerrarla, se pierde lo escrito (`PortionReviewView.tsx:888`).
- *Qué cambia:* cada caja abierta se queda abierta con su texto hasta enviarlo o cerrarla. Se conserva mientras la pantalla siga abierta. Guardarlo en el aparato para sobrevivir a una recarga queda fuera de esta entrega.
- *De dónde viene:* «El trabajo no se pierde» (filosofía, principio 9).
- *Costo:* pequeño.

**A2. El mensaje automático bloquea la aprobación, en español.**
- *Qué vio la persona:* Bea dejó un comentario y pidió cambios. Al volver, la app decía «Tiene 2 comentarios sin resolver» y no dejaba aprobar hasta marcar también el mensaje «Pido cambios: Le dejé 1 comentario». A Ana le decía «Hay 2 comentarios», y ese mensaje traía «Cambiar» y «Borrar».
- *Causa:* la app reconoce ese mensaje buscando las palabras «Te dejé» (`reviewComments.ts:130`). El 9 de noviembre el texto pasó a «Le dejé» (commit `4ac2945`) y dejó de reconocerlo. En portugués funciona.
- *Qué cambia:* reconoce las dos formas. Como se comprueba al leer, también se arreglan los mensajes que ya existen. Se agrega una prueba que falle si el texto y el reconocimiento se separan otra vez.
- *De dónde viene:* es lo que la app ya pretendía hacer.
- *Costo:* pequeño.

### B. Que el proceso funcione de un paso al siguiente

**B1. El botón grande de «Mis tareas» señala lo que toca ahora.**
- *Qué vio la persona:* a Ana le pidieron cambios en 1:5–6. Esa tarjeta quedó cuarta en «En curso», como un enlace, y el botón lleno la llevó a un artículo que apenas había abierto. Y cuando ya no tiene nada en curso, lo siguiente queda plegado en «Libres para tu equipo».
- *Qué cambia:* no hace falta clasificar las tarjetas de otra forma, solo ordenarlas (`myTasksBoard.ts`, grupos y `nextCard`):
  1. dentro de «En curso», primero lo que volvió a mí: me pidieron cambios, falta mi acuerdo o falta entregar;
  2. después, mi otro trabajo en curso;
  3. dentro de «Puedes sumarte», primero la revisión en pares, porque alguien espera por ella, y después la lectura grupal (se distinguen por su regla de cierre, sin nombrar pasos en `src/`);
  4. si lo siguiente es un pasaje libre, ese grupo se abre solo y el botón lleno queda en él.
- *De dónde viene:* «Una sola cosa obvia» y la preocupación de Abel de que la persona se pierda entre pasos.
- *Costo:* pequeño a mediano.

**B2. Al terminar un borrador, la app ofrece lo que sigue.**
- *Qué vio la persona:* tras «Terminé» vuelve a la lista, con un aviso arriba, y el siguiente pasaje sigue plegado.
- *Qué cambia:* una ventana corta, igual a las de Afinación (`StageWindow`): «Su borrador quedó listo. Ahora lo lee otra persona del equipo.» Un botón «Traducir 1:5–6» y, debajo, el enlace «Volver a mis tareas». Si no queda otro pasaje, solo «Volver a mis tareas».
- *De dónde viene:* «Siguiente frase» tras guardar en Afinación.
- *Costo:* mediano.

**B3. Entregar queda a la vista, donde termina la revisión.**
- *Qué vio la persona:* tras «Para mí está bien» hacen falta tres toques más, fuera de la pantalla: «Volver a mis tareas», el enlace «Entregar» y «Sí, entregar».
- *Qué cambia (con la opción recomendada de la decisión 2):* en la misma pantalla, el botón lleno pasa a ser «Entregar al grupo», con una línea: «Su texto pasa a la lectura del equipo». No cambia quién debe estar de acuerdo, solo dónde está el botón. Si Abel elige la entrega automática, este botón no existe y «falta entregar» sale de B1.
- *De dónde viene:* «Al terminar algo, el botón lleno pasa a ser el que lleva al siguiente paso» (principio 7).
- *Costo:* pequeño a mediano.

**B4. Pasar al versículo siguiente sin cerrar el teclado.**
- *Qué vio la persona:* con el teclado abierto no hay forma visible de seguir. Hay que bajarlo, desplazarse y tocar el otro versículo.
- *Qué cambia:* dos flechas redondas de color suave, de 44 px, flotando en los márgenes, sin barra ni palabras, como en las propuestas de cambio. Están en los dos editores y abren el versículo o la ayuda anterior y siguiente, sin cerrar el teclado.
- *De dónde viene:* «Avanzar siempre a la vista, nunca lleno».
- *Costo:* mediano. Se prueba en un teléfono real. Si las flechas tapan la caja, van junto a ella, en la línea de «Fíjese en esto».

**B5. Al corregir, el comentario está junto a su versículo.**
- *Qué vio la persona:* Ana tocó «Verlos» y llegó a otra pestaña, debajo de todo el texto fuente. Al abrir el 1:3, el comentario de Bea no estaba allí.
- *Qué cambia:* el comentario se muestra encima del versículo abierto, como ya hacen las ayudas. Los versículos con comentario llevan una marca, y el editor abre en el primero.
- *De dónde viene:* «Las ayudas se leen pegadas a su texto» y la plantilla (3.3).
- *Costo:* mediano.

### C. Que lo entienda alguien poco hábil

**C1. Estudio: seguir siempre a la vista.**
- *Qué vio la persona:* lo único que queda siempre a la vista abajo es un botón apagado. «Leído, seguir» está al final del texto, a 6.486 px en «El pasaje» (casi ocho pantallas).
- *Qué cambia:* abajo, siempre a la vista, un solo botón con lo que toca: «Leído, seguir» y, en la última parte, «Terminé de estudiar». «Apuntes» pasa a «Más», para que las cuatro partes quepan. Las notas no muestran códigos («1:intro · v1fp») ni repiten la introducción ya leída. «El pasaje» sigue mostrando el capítulo entero, como pide la plantilla, pero abre en el pasaje de la persona.
- *De dónde viene:* «Avanzar siempre a la vista».
- *Costo:* mediano.

**C2. Estudio ya hecho: decirlo y seguir.**
- *Qué vio la persona:* en el segundo recurso del mismo capítulo, todo aparece leído y hay que encontrar «Terminé de estudiar».
- *Qué cambia:* una ventana corta: «Ya estudió este capítulo», con «Seguir al borrador» y el enlace «Leerlo otra vez».
- *De dónde viene:* «Decir qué se hace antes de hacerlo».
- *Costo:* pequeño.

**C3. La ventana del paso le habla a quien la lee.**
- *Qué vio la persona:* a la autora le dijo «Compruebe que la traducción de su compañero…», sobre su propio texto.
- *Qué cambia:* cuando quien entra a una revisión es quien tradujo, la ventana le dice: «Bea ya leyó su borrador. Léalo y diga si está de acuerdo.» El propósito del paso sigue en el paquete del proceso. Esta frase habla del papel de la persona en la revisión, no de un proceso, así que va en `es.json` y `pt.json`, sin cambiar el formato del paquete.
- *De dónde viene:* la ventana de Afinación (`StageWindow`) y Armonización, que distingue abrir un punto de colaborar en lo que otro dijo.
- *Costo:* pequeño.

**C4. «Empezar con la guía» cumple lo que dice.**
- *Qué vio la persona:* en Estudio y en el editor de ayudas la guía no señala nada: repite el propósito. En la lectura grupal tampoco señala «De acuerdo», «Corregir» ni «Tengo una duda».
- *Qué cambia:* cada una de esas pantallas tiene una guía corta que señala lo que se toca y espera a que la persona lo haga. Usa el mismo mecanismo de Afinación, que sirve para cualquier pantalla (`GuideScreen`, `data-guide`).
- *De dónde viene:* la guía de Afinación (`tuningGuides.tsx`).
- *Costo:* mediano.

**C5. «Terminé» no compite con escribir.**
- *Qué vio la persona:* con un solo versículo escrito de cuatro, «Terminé» ya es el botón lleno, fijo junto a la caja. Es lo que confundió a una traductora en Nehemías, que lo tocó creyendo que guardaba.
- *Qué cambia:* va con borde hasta que todo tiene texto. Entonces se llena. Tocarlo antes sigue preguntando, como hoy.
- *De dónde viene:* «Solo la acción de decidir va en botón lleno».
- *Costo:* pequeño.

**C6. Las ayudas, de una en una.**
- *Qué vio la persona:* bajo la nota abierta siguen las otras 26 en gris: 75 controles y casi nueve pantallas.
- *Qué cambia:* se ve una sola ayuda, con la línea «Ester 1:2 · nota 3 de 27». Al tocarla se abre la lista de todas, y tocar una lleva a ella. Las introducciones del libro y del capítulo son una entrada cada una, y sus párrafos se recorren igual. Palabras y Academia conservan el artículo a la vista, porque allí leerlo seguido sirve para traducir.
- *De dónde viene:* «Las ayudas se leen pegadas a su texto, de una en una» y el principio 10.
- *Costo:* grande.

**C7. Preguntas muestra su versículo.**
- *Qué vio la persona:* la pregunta sin el versículo del que habla.
- *Qué cambia:* el mismo «Ver 1:1 completo» de las notas.
- *De dónde viene:* la nota abierta.
- *Costo:* pequeño.

**C8. Un mismo trato y palabras honestas.**
- *Qué vio la persona:* la guía la trata de «usted» y las pantallas de «tú» («Ya leíste todo», «Toca una nota»). Un error mostró nombres de ramas y, al lado, «Todo guardado».
- *Qué cambia:* toda la fase de «usted». Los errores dicen qué hacer, sin datos técnicos, y no se dice «guardado» si algo falló. Sale «Lo demás del archivo no cambia» (`he.oneResource`), que nombra un riesgo.
- *De dónde viene:* «Tranquilizar por el propósito» y «Honestidad» (principio 8).
- *Costo:* mediano, casi todo en `es.json` y `pt.json`.

### D. La revisión como conversación

Es el cambio más grande y depende de la decisión 1. Aquí se aprueba la dirección. Cada una de estas dos entregas tendrá su propio diseño corto antes de construirla, porque puede cambiar cómo se guardan los datos: cómo se guarda una propuesta de palabras y contra qué versión se compara «lo que cambió».

**D1. Revisión en pares.**
- *Qué vio la persona:* «Aprobar» lleno desde el primer segundo, antes de leer. Cada comentario propio trae cuatro acciones. Todo dice «nuevo» y «4 de 4 con cambios». En la segunda vuelta no se ve qué corrigió la autora.
- *Qué cambia:*
  - Cada versículo se lee como texto. Al tocarlo se abren la fuente y la conversación.
  - Al pie, «Estoy de acuerdo» y «No del todo…». Esta abre dos caminos, y cualquiera de los dos pide escribir algo: «Proponer otras palabras» o «Comentar algo».
  - Una propuesta de palabras llega a quien tradujo con «Usar estas palabras». Solo esa persona la aplica, en su propio borrador.
  - Las acciones sobre un comentario van en un menú «…», salvo «Resuelto».
  - En la segunda vuelta se marca solo lo que cambió desde la última lectura.
  - Tras pedir cambios, «Volver a mis tareas» como botón claro.
- *De dónde viene:* Armonización («Colaborar, no votar») y Decidir en Afinación.
- *Costo:* grande.

**D2. Lectura grupal.**
- *Qué vio la persona:* tres acciones por versículo, «0 de 2 de acuerdo» y «De acuerdo con el pasaje» arriba, antes de leer.
- *Qué cambia:*
  - El pasaje se lee de corrido, solo en TPL o TPS. Tocar un versículo abre la fuente, la conversación y las respuestas.
  - Al final de cada pasaje, «Estoy de acuerdo con este pasaje» y «No del todo…».
  - En vez de contar, las caras de quienes ya están de acuerdo.
  - Los versículos con una duda se ven marcados y se llega a ellos desde arriba.
- *De dónde viene:* Armonización.
- *Costo:* grande.

### E. Los avisos de Taller mientras se escribe

Van al final, como pidió Abel.

**E1. Taller avisa solo.**
- *Qué vio la persona:* hoy el editor no señala errores mecánicos ni reglas del equipo.
- *Qué cambia:* los dos editores muestran lo que Taller encuentra, como ya hacen Afinación y Armonización (`HelpChecksHint`, con `verseChecks` para versículos y `mechanicalChecks` y `ruleChecks` para ayudas). Va en letra pequeña, junto a «Fíjese en esto», para no competir con la caja, y ofrece «Arreglar» solo cuando es seguro.
- *De dónde viene:* Afinación y Armonización.
- *Costo:* pequeño a mediano.

## 5. Lo que no se toca

- Quién debe estar de acuerdo para cerrar cada paso, salvo lo que se decida abajo.
- **La lógica de guardar borradores**, arreglada el 23 de noviembre tras un fallo en producción (PR #48). Solo se tocaría si Abel aprueba la decisión 3.
- Los datos ya guardados. Las entregas 0 a 4 y la 7 no cambian cómo se guarda nada.
- Los nombres de fases, tareas, pasos y herramientas siguen en el paquete del proceso (`npm run verify:decoupling`).
- No se agregan rachas, puntos ni comparaciones entre personas.

## 6. Decisiones de Abel

**Decidido el 24 de noviembre: las cuatro recomendaciones.** (1) La misma regla de cierre, dicha como conversación. (2) Entregar con un toque en la misma pantalla. (3) Las ayudas se guardan solas, en una entrega aparte al final y solo en el borrador propio. (4) Fuente y caja juntas en Taller.

**Decisión 1. ¿Cómo convive el cierre con «colaborar, no votar»?** Hoy la revisión en pares termina con la aprobación de otra persona y la confirmación del autor. La grupal, con dos personas de acuerdo (al menos una que no tradujo), sin dudas abiertas y tras 72 horas.

- **Opción A (recomendada): la misma regla, dicha como conversación.** No cambia quién debe estar de acuerdo. Cambia lo que se ve: «Estoy de acuerdo» / «No del todo…», caras en vez de «1 de 2», y sugerencias de palabras en vez de solo comentarios. Protege la calidad y evita migrar datos.
- **Opción B: aflojar la regla.** Por ejemplo, que en pares baste quien revisa. Es más rápido, pero la autora deja de ver lo que se aprobó de su texto.
- **Opción C: dejar la revisión como está** y hacer solo A, B y C. Es lo más barato, pero la fase seguiría sintiéndose distinta de las otras dos.

**Decisión 2. ¿Entregar sola o con un toque?**

- **Un toque en la misma pantalla (recomendada).** Conserva el momento en que quien revisó aún puede «Cambiar mi revisión» (plantilla, 3.3).
- **Automática al darse el último acuerdo.** Es un toque menos, pero esa posibilidad desaparece y la entrega ocurre sin que nadie la pida.

**Decisión 3. ¿El editor de ayudas se guarda solo?** El TPL dice «Se guarda solo»; las ayudas piden tocar «Guardar» (tras nueve segundos seguían «sin guardar»). Quien aprende en uno se confunde en el otro. La regla de esta etapa es no tocar el guardado sin una razón fuerte, porque se arregló el 23 de noviembre tras un fallo en producción.

- **Hacerlo, como entrega aparte y al final (recomendada).** La razón es que la misma persona tiene dos reglas distintas y lo no guardado no llega a Door43. Se guardaría solo en el borrador propio de la persona: nada llega al grupo hasta entregar. Cuando el mismo editor corrige el borrador del grupo, en fases posteriores, seguiría pidiendo «Guardar», porque ahí escribir es cambiar el texto de todos.
- **No tocarlo** y solo hacer más claro el aviso de «sin guardar».

**Decisión 4. En el teléfono, ¿fuente y caja juntas o separadas?** Hay dos decisiones anteriores que chocan. En Taller, Abel pidió el 8 de octubre poder ver «la fuente y la caja», y la filosofía de diseño las pone pegadas, que es como funciona el editor. Probando Servos, el 14 de octubre, Abel pidió lo contrario: «editor o fuente, nunca ambos», a un deslizamiento.

- **Dejarlas juntas en Taller (recomendada).** Se abre un solo versículo: a 420 px de alto caben su ULT y la caja. Este diseño no cambia esa parte.
- **Separarlas con un deslizamiento**, como Servos. Da más lugar a la caja, pero obliga a cambiar de panel para leer cada frase.

## 7. Entregas

Cada una se puede publicar sola y se prueba en el navegador, en móvil y escritorio. Van en orden de importancia: **las entregas 0 a 3 son las que resuelven que la persona se pierda**. De la 4 en adelante se puede decidir después de ver cómo le va al equipo con las primeras.

| Entrega | Qué trae | Depende de |
|---|---|---|
| 0. Fallos | A1, A2 | nada |
| 1. De un paso al siguiente | B1, B2, B3 | decisión 2 |
| 2. Escribir sin perderse | B4, B5, C5, C7 | decisión 4 |
| 3. Entender cada paso | C1, C2, C3, C4, C8 | nada |
| 4. Ayudas de una en una | C6 | entrega 2 |
| 5. Revisión en pares | D1 | decisión 1 |
| 6. Lectura grupal | D2 | decisión 1 |
| 7. Avisos | E1 | entregas 2 y 4 |
| 8. Guardado de ayudas, si se aprueba | decisión 3 | entrega 4 |

## 8. Cómo se sabrá que quedó bien

- Una persona llega de «Mis tareas» a la lectura grupal tocando en cada pantalla solo el botón evidente.
- A 375 px, cada pantalla cumple los límites de la sección 2, o el plan dice por qué no. Se mide también en portugués.
- En un teléfono real, con el teclado abierto, se ven la fuente, la caja y la forma de seguir.
- Pruebas automáticas para A1, A2 y el orden de `nextCard`. `verify:decoupling`, `verify:config` y `verify:guide` siguen pasando. `verify:text-size` y `verify:review-items` ya fallan en `main`: no deben fallar en nada nuevo.
