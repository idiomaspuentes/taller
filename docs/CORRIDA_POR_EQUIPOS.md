# Corrida por equipos: plan

Empezado el 6 de octubre de 2026. Es la segunda corrida dentro de Taller, contra Door43 QA (`es-419_gl`). La
primera ([CORRIDA_EN_FRIO_APP.md](CORRIDA_EN_FRIO_APP.md), 3 de octubre) recorrió Traducción y casi toda la
Afinación de Hageo; **Armonización, Validación y Publicación nunca se han recorrido en la app**. QA se reemplazó
después por una copia de producción y de aquella corrida no queda nada.

Este documento es primero el plan y después, sección por sección, el reporte.

## 1. Qué prueba esta corrida que la primera no probó

1. **Las cinco fases, hasta publicar.**
2. **Cada equipo con el perfil que tiene de verdad.** Las cuentas son las mismas cuatro, pero en cada fase hacen
   de cuatro personas distintas, con lo que esas personas saben y no saben.
3. **Fallos puestos a propósito**, para que cada camino de vuelta se recorra: comentario, pedir cambios, corregir,
   devolver al equipo, objeción, consulta a otro equipo, inquietud del comité.
4. **Dos personas poco hábiles con la tecnología en cada equipo.** Lo que hagan ellas se hace a mano, en un
   teléfono de 375 px, leyendo solo lo que la pantalla dice. Donde no quede claro qué hacer, es un hallazgo.
5. **La conversación.** Afinación y Armonización discuten mucho: se prueba que el chat se sienta como el que ya
   usan, que una mención llegue, y que cada persona reciba un aviso **cada vez** que se espera algo de ella.
6. **Un equipo a la vez.** Al terminar una fase, las cuatro cuentas salen de sus equipos y entran a los de la
   siguiente, para que «Mis tareas» no cargue con trabajo que ya no es suyo.

## 2. El libro

Medido el 6 de octubre de 2026 sobre el paquete en inglés (unfoldingWord, v91):

| | Judas | Hageo |
|---|---|---|
| Capítulos | 1 | 2 |
| Versículos | 25 | 38 |
| Palabras del texto (ULT) | 655 | 1.135 |
| Notas | 160 (6.808 palabras) | 153 (9.177 palabras) |
| Preguntas | 26 | 22 |
| Usos de palabras clave | 124 | 189 |
| Original | griego | hebreo |

Hageo **no es más corto**: tiene un 73 % más de texto, y sus dos capítulos son dos unidades, así que todo lo que
se hace por capítulo (lectura grupal, palabras clave, armonización, validación, publicación) se hace dos veces.

Lo que más pesa no son los versículos sino **en cuántas porciones se parte el libro**, porque cada porción son ocho
subtareas (traducir TPL, TPS, Notas y Preguntas; desafíos y alinear de cada texto) y cada subtarea tiene sus pasos:

| Opción | Porciones | Subtareas | Lo más cargado para una persona |
|---|---|---|---|
| Judas como está hoy en QA | 11 (de 2 o 3 versículos) | 104 | 12 notas |
| **Judas, vuelto a partir en 5** | 1:1–4, 5–11, 12–16, 17–23, 24–25 | **56** | 41 notas (el límite es 40) |
| Judas en 2 (como en la primera corrida) | 1:1–16, 17–25 | 26 | 117 notas: casi el triple del límite |
| Hageo en 4 (como en la primera corrida) | dos por capítulo | 50 | 65 notas |

**Decidido (6 de octubre): Judas en cinco porciones.** Judas vuelto a partir en cinco porciones con sentido propio (saludo y propósito; ejemplos de
juicio; retrato de los falsos maestros; exhortación; doxología). Es la mitad de las subtareas de hoy, un solo
capítulo, y ninguna persona pasa del límite de carga.

Lo que Hageo probaría y Judas no: el **hebreo** (de derecha a izquierda) y el **traspaso por capítulos**. Lo
primero ya se vio en la primera corrida; lo segundo queda pendiente para una corrida corta aparte.

**Qué significa «reiniciar» Judas.** No se borra nada: en el proyecto se cambian las porciones y, al guardar, la app
cierra las subtareas que el plan ya no tiene y crea las nuevas. De las 104 de hoy hay 8 empezadas (2 versículos de
TPL y de TPS, y algo de notas y preguntas, todo de prueba); sus ramas de trabajo quedan sin usar.

## 3. Las personas

Los nombres son los de la historia de [CORRIDA_EN_FRIO_FCR.md](CORRIDA_EN_FRIO_FCR.md). **(P)** = poco hábil con
la tecnología: usa el teléfono para WhatsApp y poco más, lee todo lo que hay en pantalla, no abre un menú si nadie
se lo dijo y, ante dos botones, no sabe cuál.

| Cuenta | Traducción | Afinación | Armonización | Validación |
|---|---|---|---|---|
| **abelperez** | **Marta**, coordina. Cuidadosa; revisa mucho | **Rubén**, coordina. Filólogo; registra la decisión cuando no hay acuerdo | **Josué**, coordina. Consultor de traducción | **Pastor Eliseo**, coordina. Bautista, maestro de seminario |
| **abelper8** | **Luis**. Rápido; se salta frases y deja la puntuación del inglés | **Tomás**. Exegeta; propone cambios por la construcción griega y los defiende | **Marcos**. Consultor de campo; prepara Notas | **Pastor Natán**. Presbiteriano, teólogo |
| **valeska** | **Clara (P)**. Maestra jubilada; traduce bien, no encuentra dónde responder un comentario | **Elena (P)**. Profesora de griego; sabe mucho y escribe poco | **Dina (P)**. Lingüista; prepara Preguntas | **Pastora Hulda (P)**. Pentecostal; lee desde su comunidad |
| **Elisha** | **Andrés (P)**. Su inglés es flojo: falsos amigos, y en el TPL explica en vez de conservar la forma | **Priscila (P)**. Objeta con razones largas; escribe en el chat como en WhatsApp | **Abigail (P)**. Lingüista; prepara Palabras | **Pastor Samuel (P)**. Metodista; pastor de iglesia local |

Lo que cada equipo sabe, y por lo tanto qué puede notar:

- **Traducción:** español e inglés como segunda lengua. **No leen griego.** Sus errores son de inglés (un falso
  amigo, una frase que no entendieron), de descuido (una frase omitida) y de método (explicar en el TPL).
- **Afinación:** leen el griego. Notan lo que Traducción no puede: un tiempo verbal, un artículo, una palabra que
  el inglés aplanó. Discuten entre sí.
- **Armonización:** lingüistas y consultores con años en el campo. Miran si la nota **le sirve** a quien va a
  traducir a una lengua minoritaria, y si los recursos se contradicen.
- **Validación:** teólogos, pastores y maestros de distintas denominaciones. No dominan el griego. Miran fidelidad,
  claridad y lo que una comunidad puede leer mal.
- **Publicación:** abelper8 como **Benjamín**, de informática.

Una nota sobre las cuentas: Elisha es la única sin permiso de gestión, así que Andrés, Priscila, Abigail y el
Pastor Samuel ven la app como la ve un integrante. valeska es propietaria de la organización: sus personajes ven
además «Equipo hoy» y «Proyectos», que para alguien poco hábil son dos pestañas que no le sirven.

## 4. Los fallos que se ponen a propósito

**Traducción**

| Dónde | Quién falla y cómo | Qué camino recorre |
|---|---|---|
| TPL | Andrés explica una figura en vez de conservarla, y usa un falso amigo | Comentario en el versículo → «Pedir cambios» → el autor corrige → vuelve a entregar → aprueban los dos |
| TPS | Luis se salta media frase | Comentario → el autor **no está de acuerdo** → se conversa en el hilo → se resuelve |
| TPS | Luis pulsa «Terminé» y se da cuenta de un error | «Corregir mi borrador»: el autor lo toma de vuelta con la revisión abierta |
| Notas | Clara deja dos notas sin traducir y traduce una cita que no se traduce | ¿La app deja entregar con trozos pendientes? Comentario por nota |
| Preguntas | Una respuesta que no coincide con el texto | Comentario → corrección |
| Palabras, Academia | Un artículo con párrafos sin traducir | Revisión por trozos |
| Cualquiera | Una decisión de vocabulario sale de un comentario («Jacobo», no «Santiago») | Guardarla en el glosario → la ve el siguiente traductor junto a su versículo |
| Cualquiera | Andrés toma una subtarea que le queda grande | «Devolver al equipo» |
| Coordinación | Una subtarea se queda quieta | «Equipo hoy»: recordar y reasignar |
| Lectura grupal | Una duda y una corrección con su motivo | Quién se entera de que se resolvió |

**Afinación**

| Dónde | Qué pasa | Qué camino recorre |
|---|---|---|
| Desafíos | Tomás propone un cambio; Elena de acuerdo; Priscila objeta | Sin acuerdo → Rubén registra la decisión final |
| Desafíos | Se corrige un versículo ya contestado | Las respuestas caducan; aviso a quienes contestaron; registro de la corrección con su motivo |
| Palabras clave | El mismo término traducido de dos maneras | Término preferido; glosario |
| Alinear | Elena alinea mal un versículo | Quien revisa propone → decisión del equipo con voto y plazo → recordatorio |
| Chat | Una discusión larga, con menciones, y alguien que no contesta | Avisos, menciones, recordatorio |

**Armonización**

| Dónde | Qué pasa | Qué camino recorre |
|---|---|---|
| Notas frente al TPL | Una nota explica una redacción que Afinación cambió | Modificar la nota |
| Notas frente al TPL | Una dificultad sin nota | Crear la nota |
| Notas frente al TPS | El TPS parece alejarse del griego | **Pedir el cambio al dueño** (Afinación), con la razón; la nota queda en consulta |
| Palabras | Un término difícil sin artículo enlazado | Enlazarlo |
| Preguntas | La respuesta ya no coincide con el texto afinado | Ajustarla |
| Acuerdo del equipo | Un «no» en el que no todos están de acuerdo | Discusión en el chat hasta el consenso |

**Validación**

| Dónde | Qué pasa | Qué camino recorre |
|---|---|---|
| Revisión pastoral | Cada pastor lee y anota por su cuenta | ¿De verdad no ve lo de los demás hasta entregar? |
| Revisión pastoral | La Pastora Hulda objeta una palabra que su comunidad leería mal | Inquietud en su lugar exacto |
| Decisión del comité | La objeción es del texto | Vuelve al dueño como subtarea de corrección → regresa al **mismo** comité |
| Decisión del comité | No hay consenso | Mayoría |

## 5. La conversación y los avisos

Lo que se mira en cada fase, y sobre todo en Afinación y Armonización:

1. ¿El hilo de una subtarea se lee como un chat: quién dijo qué, en orden, con lo propio a un lado?
2. Al escribir «@», ¿se ofrece a quién mencionar? ¿Le llega un aviso a esa persona, y la lleva al mensaje?
3. ¿Llega un aviso **cada vez** que se espera algo de alguien? La lista que se comprueba: me piden cambios; me
   contestan un comentario; el autor volvió a entregar; me toca aprobar; me toca confirmar; se abrió una decisión y
   falta mi voto; corrigieron algo que yo ya había contestado; me consultan desde otro equipo; lo que esperaba ya
   puede empezar.
4. ¿El aviso dice qué hacer, o solo que algo pasó?
5. ¿Qué pasa con un comentario puesto en un versículo o en una nota: se ve ahí mismo y también en el hilo?

Lo que **no** se puede probar aquí: los avisos con la app cerrada en un teléfono (necesitan el teléfono).

## 6. Un equipo a la vez

| Fase | Equipos de Door43 | Estado |
|---|---|---|
| Traducción | Traductores TPL, Traductores TPS, Traductores de Ayudas | Existen, con las cuatro cuentas |
| Afinación | Afinadores TPL, Afinadores TPS | Por crear |
| Armonización | Armonizadores | Por crear |
| Validación | Comité pastoral | Por crear |
| Publicación | Publicación | Por crear |

Los nombres de las fases 2 a 5 se confirmaron el 6 de octubre. Al cerrar una fase:
se crean los equipos de la siguiente desde «Organización», se les ponen las cuatro cuentas con su nivel y su
coordinador, se asignan a sus tareas en el proyecto y se saca a las cuatro de los equipos de la fase que terminó.
Ningún equipo se borra.

Lo que se vigila al mover: que lo que quedó a medias no se pierda de vista, y que quien ya no está en un equipo
todavía pueda atender lo que vuelve a ese equipo (una corrección que Validación devuelve a Afinación).

## 7. Cómo se hace

- Todo en la app, con las cuatro pestañas. **La primera vez de cada paso se hace a mano**, con el personaje poco
  hábil, en 375 px. Lo repetitivo (las demás notas, los demás desafíos) se hace con un guion que pulsa los mismos
  botones.
- Las traducciones son de trabajo, pero se hacen como las haría cada perfil: quien traduce no mira el griego;
  quien afina sí.
- Cada hallazgo se anota con **⚠**: dónde, a quién le pasó, qué leyó en pantalla y qué esperaba. Lo que impida
  seguir se corrige en el momento (un commit local por arreglo); lo demás se deja anotado para decidir.
- Al cerrar cada fase, su reporte queda en este documento.

El tamaño, para no engañarse: en la primera corrida, solo los desafíos de Hageo fueron 1.800 respuestas. Judas
tiene 160 notas por texto: 960 respuestas de desafíos, más 124 usos de palabras clave por texto contestados por
tres personas, más 25 versículos alineados y revisados dos veces. **Son varias sesiones de trabajo.**

## 8. Lo que no se hace sin confirmar

- **Publicar** la unidad al final (fusiona en `master` y crea una versión en los repositorios de QA).
- Borrar cualquier cosa: equipos, ramas, proyectos.
- Tocar producción.

## 9. Orden

0. Preparar: el libro y sus porciones (la decisión del apartado 2).
1. Traducción → reporte → mover las cuentas.
2. Afinación → reporte → mover las cuentas.
3. Armonización → reporte → mover las cuentas.
4. Validación → reporte → mover las cuentas.
5. Publicación: se detiene antes de publicar, para confirmar.

---

# Reporte

## Fase 0 · Preparación (6 de octubre)

**Quién:** abelperez, como quien coordina el libro.

1. Proyectos → Judas → **Subtareas**. Arriba: 1 capítulo, 11 porciones, 102 subtareas.
2. **«Cambiar las porciones»** → capítulo 1 → «Unir con la siguiente» seis veces, hasta dejar 1:1–4, 1:5–11,
   1:12–16, 1:17–23 y 1:24–25 → **«Aplicar y volver a leer»** (9 segundos).
3. La pantalla pasó a 5 porciones y 56 subtareas, y al pie avisó: «Con estas porciones se cierran 89 subtareas
   abiertas; 6 ya tienen a alguien, y lo que hayan escrito queda sin entregar».
4. **«Guardar cambios»**: 108 segundos, con un contador («Actualizando las subtareas · 43 / 56»). Terminó en
   «Proyecto guardado. Se crearon 41 subtareas. Se cerraron 89 subtareas».

Cómo quedó Judas en QA: **56 subtareas abiertas**, cinco por cada tarea que va por porción. Solo dos tienen
persona, porque no dependen de las porciones: el artículo de Palabras «call…» (#48, Elisha, en revisión) y el de
Academia «Blessings» (#53, abelper8). Las 89 cerradas siguen en Door43 como cerradas; nada se borró.

**⚠ Lo que se trabó**

- **Un proyecto en marcha no dejaba cambiar las porciones.** «Cambiar las porciones» solo existía antes de crear
  el proyecto: quien descubre después que las porciones le quedaron chicas no tenía cómo unirlas. *Arreglado:* la
  pantalla «Subtareas» del proyecto ya lo ofrece, y antes de guardar dice cuántas subtareas se cierran y cuántas
  tienen a alguien.
- **El plan seguía pidiendo las porciones viejas a quien las tenía.** Al probarlo, tres subtareas de «1:1–2» (las
  que el plan sabía de Elisha) quedaban vivas junto a la nueva «1:1–4», con los mismos versículos en dos subtareas.
  *Arreglado:* lo que alguien tenía de una porción que ya no existe sale del plan con ella. Tiene prueba.
- Antes de tocar nada, la pantalla decía «2 subtareas del plan todavía no existen en Door43», y había 104 en
  Door43 contra 102 en el plan. No se investigó: al guardar, las dos listas quedaron iguales.
- Los 108 segundos se pasan mirando un contador que llega a «56 / 56» y sigue medio minuto más sin decir qué hace
  (está cerrando las 89). Quien no lo sepa cree que se quedó pegado.
- Quedaron sin dueño las ramas de trabajo y las revisiones abiertas de las seis subtareas empezadas (por ejemplo,
  la revisión 31 de `es-419_gst`). Cerrar una subtarea no cierra su revisión.
