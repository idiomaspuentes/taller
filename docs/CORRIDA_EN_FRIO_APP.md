# Corrida en frío en la app: Hageo y Judas

Empezada el 3 de octubre de 2026. A diferencia de [CORRIDA_EN_FRIO_FCR.md](CORRIDA_EN_FRIO_FCR.md), que cuenta el
proceso sin suponer ninguna app, esta se hizo **dentro de Taller**, contra Door43 QA (`es-419_gl`), con cuatro
cuentas reales de prueba. Cada sección es el reporte de un equipo: qué recibió, qué hizo cada persona en la app y qué
entregó. Lo que se trabó o confundió va marcado con **⚠**.

## El caso

| | Libro | Capítulos y versículos | Original | Porciones |
|---|---|---|---|---|
| Primero | **Hageo** | 2 capítulos: 15 y 23 versículos | hebreo | 1:1–11, 1:12–15, 2:1–9, 2:10–23 |
| En cola | **Judas** | 1 capítulo: 25 versículos | griego | (ver Coordinación) |

Hageo es el único libro de dos capítulos de la Biblia; el primero tiene los 15 versículos del caso hipotético y el
segundo 23. Ninguno de los dos libros existía en español en QA (ni TPL, ni TPS, ni notas, ni preguntas).

Lo que hay que producir de Hageo, según el paquete en inglés: 38 versículos de TPL y de TPS, 153 notas, 22 preguntas
y 189 usos de palabras clave. De Judas: 25 versículos, 160 notas, 26 preguntas y 124 usos.

## Las personas

Las cuatro cuentas están en los cuatro equipos de QA (Prueba Traducción, Prueba Afinación, Prueba Armonización,
Prueba Validación). Para que la corrida se parezca a un equipo real, cada una tomó un papel principal:

| Cuenta | Papel principal en la corrida |
|---|---|
| **abelperez** | Coordina. Traduce TPL. |
| **abelper8** | Traduce TPS y Notas. |
| **valeska** | Traduce Preguntas, Palabras y Academia. Revisa. |
| **Elisha** | Revisa en pares. Es la única cuenta sin permiso de gestión. |

## Cómo se hizo

- Todo se hizo en la app, en cuatro pestañas (una por cuenta). Lo repetitivo (contestar decenas de ítems, colocar
  palabras) se hizo con un guion que pulsa los mismos botones de la pantalla; la primera vez de cada paso se hizo a
  mano y mirando la pantalla.
- Las traducciones son de trabajo: sirven para recorrer el proceso, no para publicarse.

---

## Reporte · Coordinación

**Quién:** abelperez.

### Crear el proyecto de Hageo

1. Proyectos → **Empezar un libro** → Hageo → plantilla «FCR: Flujo de Creación de Recursos» → **Ajustar antes de
   crear**. Se abre un borrador; nada se escribe todavía en Door43.
2. Pantalla «Subtareas que se crearán»: la app leyó el libro y propuso **14 porciones y 128 subtareas** (porciones de
   2 o 3 versículos).
3. «Cambiar las porciones»: unió hasta dejar dos por capítulo y pulsó «Aplicar y volver a leer». Quedaron **4
   porciones y 50 subtareas**.
4. Pantalla «Proceso»: la tarea «Revisión grupal» venía **sin equipo**. Le puso Prueba Traducción.
5. **Crear proyecto**. Tardó unos 35 segundos y terminó en «Hageo está en marcha · Se crearon 50 subtareas».

Lo que quedó creado:

| Fase | Subtareas |
|---|---|
| Traducción | TPL 4, TPS 4, Notas 4, Preguntas 4, Palabras 1, Academia 1, Revisión grupal 2 |
| Afinación | Desafíos TPL 4, Palabras clave TPL 2, Alinear TPL 4, y lo mismo para el TPS |
| Armonización | Notas y Academia 2, Palabras 2, Preguntas 2 |
| Validación | Validar 2 |
| Publicación | Publicar 2 |

**⚠ Lo que se trabó**

- La barra flotante «Crear proyecto» tapa el panel «Cambiar las porciones» que está justo debajo.
- Unir porciones no cambia los números de arriba hasta pulsar «Aplicar y volver a leer», que queda al final de la
  lista y fuera de la vista. Al unir, el conteo seguía diciendo 14 porciones y 128 subtareas.
- La plantilla incluida deja «Revisión grupal» sin equipo. El aviso dice «1 tareas no tienen equipo» sin decir cuál.
- Mientras crea (35 s) la pantalla no dice qué está haciendo.

### Dejar Judas en cola

Mismo camino: Judas → «Ajustar antes de crear» → unió las 11 porciones propuestas en dos (1:1–16 y 1:17–25) →
«Crear proyecto» (24 segundos, **26 subtareas**). Esta vez «Revisión grupal» ya traía su equipo.

En «Mis tareas» de cada persona, lo de Judas aparece en un grupo aparte, **«Del siguiente libro»**, debajo de lo
libre de Hageo. Así nadie se queda sin nada que hacer y se ve qué va primero.

**⚠** La lista de quien creó el proyecto no mostró Judas hasta pulsar «Actualizar».

---

## Reporte · Equipo de Traducción

Las subtareas de Hageo, por número en Door43: TPL 83–86, TPS 87–90, Notas 91–94.

### TPL (4 porciones)

| Porción | Tradujo | Revisó | Resultado |
|---|---|---|---|
| 1:1–11 | abelperez | Elisha | Elisha pidió un cambio en 1:11; corregido, aprobado y entregado |
| 1:12–15 | valeska | Elisha | Aprobado y entregado |
| 2:1–9 | abelperez | abelper8 | Aprobado y entregado |
| 2:10–23 | valeska | Elisha | Aprobado y entregado |

Lo que hace cada persona, en orden:

1. **Estudiar.** «Mis tareas» → tarjeta de la subtarea → «Estudiar». Cuatro partes: introducción al libro, al
   capítulo, el pasaje y las notas (45 en 1:1–11). «Leído, seguir» en cada una y «Terminé de estudiar». La
   introducción al libro se pide una vez por persona; en la segunda porción ya sale leída.
2. **Borrador.** La tarjeta pasa a «En curso» con el botón «Traducir». El editor trae un campo por versículo; arriba
   dice «0 de 11 con texto». Al escribir todos, «Terminé» guarda y abre la revisión (9 a 24 segundos).
3. **Revisión en pares.** A quien no escribió el borrador le aparece la tarjeta en «Puedes sumarte» con «Sumarme a
   Revisión en pares». Al tocarla la toma; un segundo toque («Revisar») abre el borrador versículo por versículo,
   con ULT, UST y las notas al lado. «Comentar» en un versículo, «Pedir cambios» o «Aprobar».
4. **Cambios pedidos.** Al autor la tarjeta le dice «Te pidieron cambios» y, dentro del editor, «Hay 2 comentarios
   de la revisión. Verlos». Corrige y pulsa «Terminé» otra vez.
5. **Acuerdo del autor.** Aprobado por el revisor, el autor abre la misma revisión y pulsa «Lo dejo así» (o «Corregir mi borrador», si va a cambiar el texto).
6. **Entregar.** La tarjeta queda en «3 de 3 pasos» con el botón «Entregar» y una confirmación: «Tu trabajo pasa al
   borrador del grupo y la tarea queda terminada» (13 a 19 segundos).

Comprobado en Door43: los 38 versículos están en la rama `hag/tpl` de `es-419_glt`.

**⚠ Lo que se trabó**

- Estudiar abre siempre en la primera parte aunque ya esté leída; hay que buscar la primera sin leer.
- Tomar la revisión y abrirla son dos toques; el aviso dice «Tomaste Revisión en pares en #83», con un número que
  no dice nada.
- Después de corregir, el revisor ve «11 de 11 con cambios»: no puede ver qué cambió desde su comentario.
- La tarjeta del autor sigue mostrando «Pido cambios…» como último mensaje cuando ya está resuelto y aprobado.
- La tarjeta del revisor que ya aprobó sigue en «En curso» con el botón «Revisar».
- Son seis acciones para tres pasos: el acuerdo del autor y «Entregar» no figuran como pasos.

### TPS (4 porciones)

| Porción | Tradujo | Revisó | Resultado |
|---|---|---|---|
| 1:1–11 | abelper8 | valeska | Aprobado y entregado |
| 1:12–15 | Elisha | abelperez | Aprobado y entregado |
| 2:1–9 | abelper8 | valeska | Aprobado y entregado |
| 2:10–23 | Elisha | abelperez | Aprobado y entregado |

Mismo recorrido que el TPL, sin tropiezos. Los 38 versículos están en la rama `hag/tps` de `es-419_gst`.

### Notas (4 porciones)

**⚠ Bloqueo encontrado y corregido durante la corrida.** «Traducir Notas» de un libro nuevo no abría: el editor de
ayudas pedía `tn_HAG.tsv` en español, que todavía no existe, y mostraba el error técnico («DCS request failed … 404»).
El editor de Escritura sí crea el libro desde la fuente; el de ayudas no. Se corrigió: la primera persona que abre
la tarea pone las notas de la fuente en el borrador del grupo y cada pasaje las traduce en su sitio.

| Porción | Notas | Tradujo | Revisó | Resultado |
|---|---|---|---|---|
| 1:1–11 | 44 | valeska | Elisha | Aprobado y entregado |

Lo que hace cada persona:

1. **Estudiar** (dos partes: el capítulo y el pasaje; el libro ya estaba leído).
2. **Borrador.** Cada nota trae su cita en ULT y UST, la nota en inglés plegable y un editor con formato. Abajo,
   «Guardar» (12 s) y «Listo para revisión» (9 s).
3. Volver a la tarjeta y pulsar **«Terminé Borrador»**.
4. **Revisión en pares**, en la misma herramienta que el TPL: nota por nota, con lo que cambió.
5. Acuerdo del autor y «Entregar».

**⚠ Lo que se trabó**

- «Listo para revisión» abre la revisión pero no cierra el paso: hay que volver a la tarjeta y pulsar «Terminé
  Borrador». En el editor de Escritura un solo botón hace las dos cosas.
- En la revisión cada nota muestra columnas internas (`rc://*/ta/man/translate/figs-explicit`, la cita en hebreo, el
  número de ocurrencia) y repite el versículo entero en ULT y UST, nota tras nota.
- La comparación tacha el inglés y resalta el español: como la base es la fuente, todo sale como cambio.
- El editor llega con la nota en inglés ya escrita en el campo: una nota sin traducir cuenta como hecha.

Las otras tres porciones de notas:

| Porción | Notas | Tradujo | Revisó | Resultado |
|---|---|---|---|---|
| 1:12–15 | 9 | abelper8 | valeska | Aprobado y entregado |
| 2:1–9 | 32 | valeska | Elisha | Aprobado; **la entrega falló** (ver abajo) y se entregó tras el arreglo |
| 2:10–23 | 65 | abelper8 | abelperez | Aprobado y entregado |

**⚠ Segundo bloqueo, corregido durante la corrida.** Al entregar la tercera porción, Door43 rechazó la fusión
(«No se pudo guardar la subtarea en el borrador grupal … merge → 405»). Todas las porciones trabajan sobre el mismo
archivo de notas, cada una en sus filas; dos porciones vecinas cambian líneas pegadas y Git lo toma por conflicto
aunque nadie tocó la misma fila. Se corrigió: cuando la fusión se rechaza, la entrega pone en el archivo del grupo
las filas que cambió ese borrador, una por una, como ya se hace con los versículos.

Comprobado en Door43: las 150 notas de los cuatro pasajes están en español en `hag/notas-ayuda`.

**⚠ Más cosas que se trabaron**

- **Las notas de introducción no son de nadie.** La introducción al libro y las de los dos capítulos (`front:intro`,
  `1:intro`, `2:intro`) no caen en ninguna porción: siguen en inglés y ninguna subtarea las pide.
- Con 65 notas el editor se vuelve lento: cada cambio tarda cerca de un segundo en reflejarse.

### Preguntas (4 porciones, 22 preguntas)

| Porción | Preguntas | Tradujo | Revisó | Resultado |
|---|---|---|---|---|
| 1:1–11 | 6 | Elisha | abelper8 | Aprobado y entregado |
| 1:12–15 | 3 | abelperez | valeska | Aprobado y entregado |
| 2:1–9 | 4 | Elisha | abelper8 | Aprobado y entregado |
| 2:10–23 | 9 | abelperez | valeska | Aprobado y entregado |

Mismo recorrido que las notas: estudiar, escribir pregunta y respuesta en dos campos, «Guardar», «Listo para
revisión», «Terminé Borrador» en la tarjeta, revisión, acuerdo y entrega. Con los dos arreglos de las notas ya
hechos no hubo tropiezos; el aviso «Este libro todavía no tenía estas ayudas: se empezó con las de la fuente» salió
al abrir la primera.

### Palabras (1 subtarea, 2 artículos)

**Quién:** valeska tradujo, abelper8 revisó.

**⚠ Tercer arreglo durante la corrida.** La subtarea pide los dos artículos que faltan en español
(`age-timeperiod` y `bear-carryburden`). El editor mostraba los **27 artículos de la primera porción**, 26 de ellos
ya traducidos, y **no mostraba** el segundo pendiente porque pertenece a otro pasaje. Se corrigió: el editor lista
los artículos que la subtarea nombra.

Después del arreglo: dos artículos vacíos, traducidos y guardados (16 s), revisados artículo por artículo y
entregados.

**⚠ Lo que se trabó**

- La subtarea se llama «Traducir Palabras · Hageo 1:1–11» aunque es una sola para todo el libro.
- Un artículo que no existe en español se muestra por su código (`age-timeperiod`), sin título.

### Academia (1 subtarea, 8 artículos)

**Quién:** valeska tradujo, abelper8 revisó.

Ocho artículos: siete existen en el repositorio en español **con el texto todavía en inglés** y uno
(`grammar-collectivenouns`) no existe. Cada uno tiene entre 4.000 y 7.500 caracteres. Se tradujeron los ocho en el
editor (pegando el texto en «Ver el código»; todos volvieron a la vista con formato), se guardó en tres tandas y se
entregó.

**⚠ Lo que se trabó**

- El editor solo trae el cuerpo del artículo (`01.md`). El **título** y la **pregunta** (`title.md`,
  `sub-title.md`) no se pueden traducir aquí: los siete artículos siguen titulándose en inglés («Biblical Volume»)
  y el nuevo se queda sin título.
- El primer guardado de un artículo nuevo tardó 29 segundos sin indicar avance.
- Ocho artículos largos en una sola subtarea es mucho trabajo para una persona y una revisión.

### Revisión grupal (2 capítulos)

| Capítulo | Leyeron | Resultado |
|---|---|---|
| 1 (30 ítems: 15 versículos × TPL y TPS) | abelperez y valeska | 1 duda, 1 corrección, cerrada y entregada |
| 2 (46 ítems) | abelper8 y Elisha | Cerrada y entregada |

Lo que pasó en el capítulo 1:

1. abelperez se sumó y abrió la lectura: cada versículo con ULT, UST, TPL y TPS, y por texto «De acuerdo»,
   «Corregir» y «Tengo una duda».
2. Dejó una **duda** en el TPL de 1:9 («¿Por causa de qué?» suena forzado) y pulsó «De acuerdo con el pasaje» en
   los dos pasajes. Pie: «0 de 30 acordados · 1 duda abierta».
3. valeska abrió la misma lectura, vio la duda bajo el versículo, pulsó **«Corregir»**, cambió a «¿Por qué?» y
   escribió el motivo. La duda se cerró sola y el acuerdo de abelperez sobre ese versículo se reinició.
4. valeska dio su acuerdo a los dos pasajes («29 de 30»). abelperez volvió, acordó 1:9 y apareció «Todo llegó y
   todo está acordado · **Cerrar la revisión grupal**».
5. En «Mis tareas» la tarjeta quedó en «1 de 1 pasos» con **«Entregar»**.

Al entregar las dos, se abrieron en «Puedes sumarte» las ocho subtareas de «Desafíos» de Afinación.

**⚠ Lo que se trabó**

- Tras «Cerrar la revisión grupal» todavía hay que volver a la tarjeta y pulsar «Entregar».
- Quien dejó la duda no recibe señal de que la resolvieron con una corrección; lo ve al volver a entrar.

### Lo que pasó con la cola

Mientras Hageo tuvo subtareas libres de Traducción, las de Judas estuvieron en «Del siguiente libro». En cuanto se
tomaron todas las de Hageo, las de Judas pasaron solas a «Libres para tu equipo». Nadie se quedó sin trabajo.

---

## Reporte · Equipo de Afinación

La Afinación de Hageo se abrió sola en «Puedes sumarte» cuando se entregaron las dos lecturas grupales. Tiene tres
tareas por texto, en cadena: **Desafíos → Palabras clave → Alinear**, cada una con dos pasos (una persona revisa o
alinea; otras confirman).

### Desafíos (8 subtareas: 4 porciones × TPL y TPS)

Un «desafío» es cada nota de traducción del pasaje, vista contra el texto del equipo. Por cada una se contesta:

1. **¿Qué traduce lo resaltado?** Arriba, la referencia (Original, ULT o UST) con la frase de la nota resaltada;
   abajo, el TPL o el TPS con cada palabra tocable. Se tocan las palabras que la traducen y «Esto lo traduce», o
   «No está en la traducción».
2. **¿Cumple la regla?** «¿… reproduce la forma de [la figura] tal como está en el original?» → «De acuerdo» u
   «Otra respuesta». Al contestar pasa sola a la siguiente.

| Subtarea | Desafíos | Revisó | Confirmaron | Cerró y entregó |
|---|---|---|---|---|
| TPL 1:1–11 | 44 | Elisha | abelper8, valeska | valeska |
| TPL 1:12–15 | 9 | abelper8 | Elisha, abelperez | abelperez |
| TPL 2:1–9 | 32 | Elisha | abelper8, valeska | valeska |
| TPL 2:10–23 | 65 | abelper8 | Elisha, abelperez | abelperez |
| TPS 1:1–11 | 44 | valeska | abelperez, Elisha | Elisha |
| TPS 1:12–15 | 9 | abelperez | valeska, abelper8 | abelper8 |
| TPS 2:1–9 | 32 | valeska | abelperez, abelper8 | abelper8 |
| TPS 2:10–23 | 65 | abelperez | valeska, Elisha | Elisha |

Cómo fluye:

- **Revisar.** «Sumarme a Revisar desafíos» y, con un segundo toque, la herramienta. Al contestar el último,
  el paso se cierra solo: «Terminaste la revisión. Ahora la confirman otras dos personas».
- **Confirmar.** A los demás les aparece «Sumarme a Confirmar desafíos». Quien confirma ve **ya marcadas** las
  palabras que eligió quien revisó y una línea «Equipo: 1 de 3 de acuerdo». Confirma con los mismos dos botones.
- Con el tercer acuerdo el encabezado pasa a «44 de 44 acordadas» y aparece «Todo quedó de acuerdo · **Cerrar la
  revisión**». Después, en la tarjeta, **«Entregar»**.

El volumen: 300 desafíos por texto, 600 en total, contestados tres veces cada uno (una revisión y dos
confirmaciones): **1.800 respuestas de dos toques**. Con el guion, entre 1,6 y 2,4 segundos por respuesta.

**⚠ Cuarto arreglo durante la corrida: dos personas a la vez.** Cuando dos personas contestaban desafíos del mismo
texto al mismo tiempo, a una le salía «**Door43 no permite hacer esto con tu cuenta. Pide a quien coordina que
revise tus permisos**» al segundo desafío. No era un permiso: Door43 responde 403 a uno de dos guardados simultáneos
en la misma rama. Le pasó a valeska, que es propietaria de la organización. Se corrigió: el guardado espera un
momento y reintenta.

**⚠ Lo que se trabó**

- Al volver a entrar, la herramienta abre en el desafío 1, no en el primero sin contestar («Respondiste 34 de 44»
  lo dice, pero hay que avanzar a mano).
- El encabezado dice «0 de 44 acordadas» durante toda la revisión y la primera confirmación: no distingue
  «contestado por mí» de «acordado por el equipo».
- Al terminar de revisar se leen juntos «0 de 44 acordadas» y «Revisión cerrada: todo quedó de acuerdo».
- Dos categorías salen sin traducir en el filtro: «Quotesinquotes» (luego «Citas dentro de Citas») y «Litany».
- La pregunta del paso 2 nombra la figura como si fuera una forma («¿reproduce la forma de Conocimiento asumido e
  información implícita…?»), que no se entiende para varias categorías.
- Tres personas repiten los mismos dos toques sobre cada nota. Para quien confirma, 65 desafíos seguidos de «Esto
  lo traduce» y «De acuerdo» invitan a confirmar sin mirar.
- Cerrar la revisión y entregar siguen siendo dos acciones más después del último acuerdo.

### Palabras clave (4 subtareas: 2 capítulos × TPL y TPS)

Misma herramienta que Desafíos, con cada **aparición** de un término clave: 79 en el capítulo 1 y 110 en el 2, por
texto. Paso 1, qué palabras lo traducen; paso 2, «¿Este término mantiene el mismo sentido que en el resto del
libro?».

| Subtarea | Términos | Revisó | Confirmaron | Estado |
|---|---|---|---|---|
| TPL capítulo 1 | 79 | Elisha | abelperez, abelper8 | Cerrada y entregada |
| TPL capítulo 2 | 110 | abelper8 | valeska (108 de 110) | Falta el segundo confirmador |
| TPS capítulo 1 | 79 | valeska | abelperez | Falta el segundo confirmador |
| TPS capítulo 2 | 110 | abelperez | abelper8, valeska (empezó) | En confirmación |

**⚠ Lo que se trabó, y el cambio que salió de aquí**

- Con el proceso como estaba, **una persona debía contestar los 110 términos** antes de que nadie pudiera
  confirmar, y los demás esperaban.
- En el capítulo 2 del TPS, con versículos largos, cada respuesta tardó el doble que en el capítulo 1.
- La corrida se detuvo aquí para cambiarlo. Desde la versión 14 del proceso, Palabras clave es **una ronda
  abierta** (cualquiera es el primero en cualquier término), la lista se ordena **por término o por el texto**, la
  herramienta abre en el primero que a la persona le falta, y las apariciones iguales se acuerdan de un toque. El
  detalle está en [PLANTILLA_FCR.md](PLANTILLA_FCR.md), «Cómo se revisan las palabras clave».
- **Un proyecto ya creado no recibe ese cambio solo.** «Traer lo nuevo» agrega pasos y tareas, pero no quita ni
  cambia los que el proyecto ya tiene. Hageo y Judas siguen con los dos pasos hasta que alguien edite su proceso.

### Alinear (8 subtareas: 4 porciones × TPL y TPS)

**Se probó como ronda abierta y se deshizo.** Después de Desafíos y Palabras clave, Alinear también pasó a ser un
solo paso en el que cada persona tomaba un versículo (versión 16 del proceso). Al verlo en pantalla se decidió
volver atrás (versión 17): la alineación ya llega repartida en porciones pequeñas, una subtarea por porción y no
por capítulo, así que una persona alinea pocos versículos (14 en la porción más larga) y tomar cada uno aparte
solo añadía pasos. Quedó como estaba: **una persona alinea la porción y otras dos la revisan**.

El resumen de carga lo confirma: con un libro como Hageo, «Alinear» no pasa de 14 versículos para una persona, con
dos esperando; el límite es 40.

De la prueba quedó en la herramienta lo que sirve en cualquier caso: un versículo sin alinear se lee como un
versículo (borrador, original e inglés, sin avisos en amarillo), y un paso compartido, si un proyecto lo quiere,
se reconoce por el paso mismo.

Se devolvió el proceso de Hageo y de Judas a los dos pasos en su pantalla «Proceso».

**⚠ Lo que se trabó**

- **El editor del proceso no deja poner «cuántas personas de acuerdo»** (`minAgree`). En Alinear no hace falta
  (quien alineó más dos que revisan dan tres), pero en una ronda de otro tipo sí.
- **Al cambiar el nombre de un paso en español, su nombre en portugués queda como estaba** («Revisar o
  alinhamento» para un paso que ahora alinea y revisa), y el editor no lo avisa: hay que cambiar el idioma de la
  aplicación y corregirlo aparte.
- Al sumarse a un paso desde «Mis tareas», la aplicación llevó a «Avisos» en vez de abrir la herramienta; hubo que
  volver a «Mis tareas» y tocar «Alinear».

