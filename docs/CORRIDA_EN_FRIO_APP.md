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
5. **Acuerdo del autor.** Aprobado por el revisor, el autor abre la misma revisión y pulsa «Estoy de acuerdo».
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

