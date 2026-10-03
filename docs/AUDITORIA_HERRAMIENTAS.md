# Auditoría de las interfaces de trabajo del FCR

Fecha: 3 de octubre de 2026. Versión auditada: `106fe01` (la publicada), en el servidor de desarrollo contra QA (`es-419_gl`), sesión `abelperez`, libro 3 Juan.

## Estado de los arreglos

Hecho después de la auditoría, en `main` local (sin publicar):

| # | Hallazgo | Estado |
|---|---|---|
| 1, 1b | Preguntas vacías y notas que faltaban | Arreglado: el pasaje se toma por sus versículos además de por identificador. |
| 2 | Revisión en pares de las ayudas sin interfaz | Arreglado: el paquete (v13) la manda a la herramienta de revisión, que ahora también lee artículos. |
| 3 | Encabezado cortado en el editor de ayudas | Arreglado: Guardar y «Listo para revisión» bajaron a una barra al pie. |
| 4 | Academia en código | Arreglado en su mayor parte: 82 de 89 artículos de muestra abren con formato. Quedan los de listas anidadas. |
| 5 | Peticiones fallidas | Arreglado: se preguntan solo las ramas que existen. Publicar pasó de 108 fallidas a 4. |
| 6 | Encabezados distintos | Arreglado: todas ponen el pasaje como título y «paso · tarea» debajo, también el editor de borrador y el hilo. |
| 7 | Aviso flotante sobre el texto | Arreglado: barra fija al pie en Estudiar, Lectura grupal y Revisión en pares. |
| 8 | Términos en inglés | Arreglado: el término se nombra por el título del artículo del equipo. Se quitó la ruta del archivo. |
| 9 | Escritorio a una columna | Arreglado en el aval y las listas (texto junto a preguntas) y en las de lectura (ancho de línea). |

También: un solo aviso y el botón «Seguir» al revisar una alineación sin terminar; «Todavía no hay reportes» en el comité; el pasaje del aval en su propia caja con desplazamiento; controles de al menos 36 px en el teléfono; la revisión en pares sin borrador ya no muestra dos mensajes contrarios.

Dos hallazgos de la auditoría eran erróneos y se retiran:

- El hilo de la subtarea **sí** tiene botón para abrir la herramienta; solo se muestra a quien tiene asignada la subtarea.
- El TPL de Afinación no va justificado: cada palabra es un botón con su margen.

Queda pendiente:

- Recursos del editor de borrador: franja de notas pequeña, cita en inglés e identificador interno a la vista.
- Pestañas de Estudiar que no caben, sin señal de deslizamiento.
- El aviso «Falta trabajo anterior» de las listas: ocupa mucho y no coincide entre pasos.
- «Acuerdo del equipo» sin resumen de lo comprobado (no se pudo abrir).
- Qué artículos de Academia son los pendientes de la subtarea.
- Confirmar que escribir el borrador sin cerrar «Estudiar» no atasca la subtarea.
- Las subtareas ya creadas en QA usan el plan guardado en su repositorio: la revisión de ayudas con la herramienta nueva llega al subir el proyecto a la v13 del proceso.

## Cómo se hizo

- Se abrió cada paso de cada tarea de `processes/fcr.json` (`fcr-base` v12) con el mismo enlace que arma la app al tocar el botón de la tarjeta, sobre una subtarea real de 3 Juan en QA.
- Cada pantalla se miró en teléfono (375 × 812) y se midió en escritorio (1280 × 800).
- Solo lectura: se registraron las peticiones de cada herramienta y **ninguna escribió nada** al abrirse. No se pulsó ningún botón que guarde, entregue o apruebe.
- En ninguna pantalla hay desborde horizontal en el teléfono.

Lo que **no** se pudo comprobar está al final.

## Resumen: lo más importante

| # | Hallazgo | Dónde | Gravedad |
|---|---|---|---|
| 1 | «Traducir Preguntas» abre vacío: «No hay ítems de esta ayuda en la porción» | Traducción · Preguntas · Borrador y Revisión en pares | Bloquea |
| 1b | «Traducir Notas» muestra 5 de las 14 notas del pasaje, por la misma causa | Traducción · Notas | Alta |
| 2 | La revisión en pares de las ayudas abre el mismo editor que el borrador, sin nada para revisar ni aprobar | Traducción · Notas, Preguntas, Palabras, Academia · Revisión en pares | Alta |
| 3 | En el teléfono el encabezado del editor de ayudas queda en «3 J…» y «Trad…» | Editor de ayudas | Alta |
| 4 | Los artículos de Academia se muestran como código (Markdown crudo) | Traducción · Academia | Alta |
| 5 | Publicación tarda unos 20 s en abrir y hace más de 100 peticiones fallidas | Publicación · los dos pasos | Media |
| 6 | Tres formas distintas de encabezado y de «terminar» según la herramienta | Todas | Media |
| 7 | El aviso de «te falta…» flota sobre el texto que se está leyendo | Estudiar, Lectura grupal, Revisión en pares | Media |
| 8 | Términos y títulos en inglés o con rutas de archivo | Palabras clave, Armonizar Palabras, Academia, Recursos | Media |
| 9 | En escritorio casi todo es una sola columna, con líneas de hasta 140 caracteres | Todas menos Borrador y Alinear | Media |

## 1. Traducción

### Familiarizarse (Estudiar) — TPL, TPS, Notas, Preguntas

Funciona: tres partes (El libro, El pasaje, Notas), contador «0 de 3 leído», botón «Leído, seguir».

- La barra «Te falta leer 3 partes · Terminé de estudiar» es una tarjeta que flota encima del texto y tapa una línea de lo que se lee. Debería ser una barra pegada al borde inferior, como en Alinear.
- La fila de pestañas no cabe: «Apuntes» queda cortada a la derecha sin señal de que se puede deslizar.
- En el texto hay enlaces con el nombre en inglés («Translate Names»). Viene del contenido, no de la app.
- Botones de 32 px de alto. El resto de la app usa 36 o más.

### Borrador de TPL y TPS (editor de Escritura)

Funciona: versículos editables, «Unir 5 y 6», pestañas Editor / Recursos abajo.

- Es la única herramienta con otro encabezado: título sin negrita «3 Juan 1:5–8 · TPL», sin la línea de paso y tarea, y con «Terminé» arriba. Las demás lo llevan abajo o no lo llevan.
- En Recursos, las notas quedan en una franja de tres líneas debajo del texto fuente. La cita de la nota sale en inglés («Beloved») y junto a ella el identificador interno («1:5 · tmh1»).
- Al abrir hace 74 peticiones, 8 de ellas fallidas, y tarda unos 5 s.

### Revisión en pares de TPL y TPS

- Con el borrador sin entregar muestra dos mensajes que se contradicen: «Este pasaje todavía no tiene un borrador para revisar» y, en una tarjeta flotante, «Puedes leerlo y comentar». No hay nada que leer.
- La subtarea 2 tenía los cuatro versículos escritos y aun así figuraba en el paso «Familiarizarse». Es estado de prueba, pero conviene confirmar que escribir el borrador sin cerrar «Estudiar» no deja la subtarea atascada.

### Borrador de Notas

Funciona: fuente en inglés plegable, editor con formato, pestaña del capítulo.

- **Encabezado cortado en el teléfono.** «Listo para revisión» y «Guardar» ocupan el encabezado y el pasaje queda en «3 J…».
- **Faltan notas.** El inventario del plan decide qué notas se muestran. En 3 Juan 1:1–4 el archivo en español tiene 14 notas y solo 5 coinciden con los identificadores del inventario; las otras 9 (`rni7`, `mp9w`, `v6dv`…) no aparecen. Es la misma causa que deja vacías las Preguntas.
- 20 textos por debajo de 12 px (etiquetas ULT / UST y referencias).

### Borrador de Preguntas — bloqueado

- Abre con «No hay ítems de esta ayuda en la porción», pero el archivo `tq_3JN.tsv` en español tiene cuatro preguntas en 1:1–4.
- Causa: `tsvIdsForLaunch` (`src/domain/helpsDraft.ts`) filtra por los identificadores del inventario (`r3ao`, `yuwd`, …) y el archivo en español usa otros (`h8qz`, `nrw9`, …). Cuando hay identificadores pero ninguno coincide, no se recurre al rango de versículos.
- La lista de comprobación de Armonización sí encuentra esas preguntas, porque lee por versículo.

### Borrador de Academia

- Todos los artículos abren como código, con el aviso «Este texto tiene un formato que el editor visual no maneja». Para un traductor no técnico es Markdown crudo (`### Descripción`).
- Se muestra la ruta del archivo (`translate/figs-explicit/01.md`) y los enlaces aparecen como «Relative link: ../translate-…».
- La subtarea lista dos artículos (`writing-pronouns`, `translate-blessing`) y la herramienta muestra además los cinco de la porción según el inventario. No queda claro cuáles son los pendientes.
- Tarda unos 7 s; lee los artículos uno tras otro.

### Borrador de Palabras

- No se pudo abrir: en QA no hay ninguna subtarea de «Traducir Palabras» para 3 Juan. Usa el mismo editor que Academia.

### Revisión en pares de Notas, Preguntas, Palabras y Academia

- Abre exactamente el mismo editor que el borrador: título «Traducir Notas», botones «Listo para revisión» y «Guardar». `HelpsEditorView` no lee el paso.
- Quien revisa no tiene dónde aprobar, comentar ni ver qué cambió. La aprobación queda fuera de la herramienta, en la tarjeta de Mis tareas.

### Lectura grupal

Funciona: fuentes, TPL por versículo, «estás de acuerdo», «Corregir», «Tengo una duda», estado «3 de 4 acordados».

- La tarjeta de estado flota en medio de la lectura y tapa texto.
- Encabezado largo cortado: «Lectura grupal · Revisión grupal · 3 de 4 acor…».
- «Falta que llegue: TPS» es la única señal de que la lectura está incompleta. Merece más peso.

## 2. Afinación

### Desafíos TPL y TPS — Revisar y Confirmar

Funciona: filtro por figura, «1 de 14», referencia Original / ULT / UST, tocar palabras.

- El título es el nombre de la herramienta («Desafíos de traducción») y debajo «3JN 1:5–8 · TPL», con el código del libro. En Traducción el título es «3 Juan 1:5–8».
- «Revisar» y «Confirmar» solo se distinguen por una línea gris «Equipo: 0 de 3 de acuerdo». Quien confirma no ve qué respondió quien revisó.
- El TPL va justificado y deja huecos grandes entre palabras.
- Es la herramienta más lenta de la fase: 100 peticiones, 18 fallidas, unos 10 s.

### Palabras clave TPL y TPS — Revisar y Confirmar

- El término sale en inglés como título («elder»), aunque el equipo trabaja «anciano».
- El título del encabezado es «Revisar palabras clave» también en el paso «Confirmar».
- La subtarea abarca todo el capítulo (40 términos). No hay forma de ver cuánto falta por pasaje.

### Alinear TPL y TPS — Alinear

Revisado a fondo en las últimas sesiones. Sin hallazgos nuevos.

### Alinear — Revisar la alineación

- Cuando el versículo no está terminado se ven dos avisos seguidos («todavía no está completo» y «todavía no está terminado») y debajo los tres botones de respuesta. «De acuerdo» sale atenuado, los otros dos parecen activos.
- La barra de respuesta ocupa 105 px con tres botones en dos filas.

## 3. Armonización

### Listas de comprobación (Notas frente al TPL / TPS, Academia, Palabras, Sugerencias, Preguntas)

Funciona: cita del texto, ítem, mensajes de equipos anteriores, preguntas Sí / No, «Siguiente pendiente».

- El título es el nombre del paso y debajo «3JN 1:1–15». No dice la tarea ni el libro en palabras.
- El aviso «Falta trabajo anterior» ocupa la primera pantalla entera y aun así deja contestar. No queda claro si se puede seguir.
- El aviso no coincide entre pasos: Notas dice «falta alinear los versículos 3, 5» y Preguntas «el versículo 5».
- En «Academia» cada ítem lleva la etiqueta «Nota». Es correcto (notas con artículo enlazado), pero confunde.
- En Palabras: título «elder» y «Artículo: other/elder».
- Notas frente al TPL hace 81 peticiones y 44 fallan.

### Acuerdo del equipo

- No tiene herramienta: se aprueba desde la tarjeta. Quien acuerda no ve un resumen de lo que se comprobó. No se pudo abrir, porque las tres subtareas están en su primer paso.

## 4. Validación

### Revisión pastoral

- El pasaje completo (TPL y TPS de los 15 versículos) va antes del reporte. En el teléfono hay que bajar varias pantallas para llegar a las tres preguntas.
- 30 textos por debajo de 12 px (las etiquetas TPL / TPS).
- «Entregar mi reporte» y «Guardar y seguir después» están al final del contenido, no en una barra fija.

### Decisión del comité

- «0 de 0 apoyan» cuando no hay reportes. Mejor «Todavía no hay reportes».
- Los dos botones se ven atenuados sin decir quiénes faltan por reportar.

## 5. Publicación

### Comprobaciones y Publicar

Funciona: dice con claridad qué detiene la publicación y qué se publicará por recurso.

- **Lentitud.** Unos 20 s con «Leyendo lo que tiene el equipo…». Prueba cada archivo en cada rama posible (`3jn/<tarea>` y `t/3jn/<tarea>`): 162 peticiones, 108 fallidas.
- Los dos pasos muestran las mismas comprobaciones. «Publicar» solo añade la lista por recurso.
- El encabezado dice «Publicación» mientras carga y cambia a «Comprobaciones» o «Publicar» al terminar.

## 6. Lo que se repite en todas

- **Encabezado.** Tres modelos: pasaje como título y «paso · tarea» debajo (Estudiar, pares, lectura, ayudas); nombre de la herramienta o del paso como título y «3JN 1:5–8» debajo (Afinación, listas, aval, publicar); y el del editor de Escritura. El libro sale a veces como «3 Juan» y a veces como «3JN».
- **Dónde se termina.** Arriba en el encabezado (Escritura, ayudas), en tarjeta flotante (Estudiar, lectura), en barra fija abajo (Alinear), al final del contenido (aval, listas).
- **Hilo de la subtarea.** `#/mis-tareas/N` muestra el paso actual pero no tiene botón para abrir su herramienta. Hay que volver a la lista.
- **Peticiones fallidas.** Todas las herramientas que leen un texto prueban varias ramas hasta dar con la buena. Va de 2 fallos (Alinear) a 108 (Publicar). Un solo lugar que recuerde la rama buena por recurso lo resolvería para todas.
- **Tamaño de toque.** Botones secundarios de 28 a 32 px en casi todas (Guardar, Corregir, Original / ULT / UST, Sí / No de navegación).
- **Escritorio.** Tres anchos distintos: 960 px (Estudiar, ayudas, lectura), 832 px (Afinación, listas, aval, publicar) y ancho completo (Escritura, Alinear). Salvo estas dos, todo es una columna. En Estudiar las líneas llegan a 140 caracteres. En el aval y las listas el texto y las preguntas podrían ir lado a lado.

## Tiempos de carga medidos (teléfono, QA)

| Herramienta | Segundos | Peticiones | Fallidas |
|---|---|---|---|
| Estudiar | 2,3 | 22 | 0 |
| Borrador TPL | 5,3 | 74 | 8 |
| Revisión en pares | 2,6 | 20 | 0 |
| Notas | 3,9 | 27 | 2 |
| Preguntas | 2,6 | 16 | 1 |
| Academia | 7,1 | 32 | 5 |
| Lectura grupal | 7,0 | 47 | 10 |
| Desafíos | 10,2 | 100 | 18 |
| Palabras clave | 4,7 | 77 | 6 |
| Alinear | 3,7 | 35 | 4 |
| Revisar alineación | 3,2 | 22 | 2 |
| Notas frente al TPL | 6,0 | 81 | 44 |
| Revisión pastoral | 3,6 | 88 | 58 |
| Publicar | unos 20 | 162 | 108 |

## Lo que no se comprobó

- Ningún guardado, entrega, aprobación ni voto: la auditoría fue de solo lectura.
- «Traducir Palabras» (no hay subtarea en QA) y «Acuerdo del equipo» (ninguna subtarea ha llegado a ese paso).
- La revisión en pares con un borrador entregado, y «Decisión del comité» con reportes.
- La interfaz en portugués y el Antiguo Testamento (hebreo).
- En escritorio se midieron anchos y columnas; las capturas a 1280 px salían demasiado pequeñas para juzgar el detalle visual.
- La entrada a cada paso desde la lista de Mis tareas y el tablero del equipo.

## Orden sugerido

1. Preguntas vacías (1): recurrir al rango de versículos cuando los identificadores del inventario no coinciden. Vale también para las notas que faltan.
2. Revisión en pares de las ayudas (2) y encabezado del editor de ayudas (3).
3. Un solo encabezado y un solo lugar para «terminar» en todas las herramientas (6, 7).
4. Artículos de Academia con formato (4) y términos en español (8).
5. Recordar la rama de cada recurso para quitar las peticiones fallidas (5).
6. Escritorio a dos columnas donde hay texto y preguntas (9).
