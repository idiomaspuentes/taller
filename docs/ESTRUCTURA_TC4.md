# La estructura de translationCore 4, aplicada a Taller

*14 de octubre de 2026. Las seis preguntas de la sección 7 están decididas; nada de esto está hecho todavía en el código.*

Abel pidió que Taller se parezca a translationCore 4 (tC4) también en la estructura, no solo en el aspecto: tC4 tiene muchísimas funciones y aun así el texto sigue siendo lo principal. Este documento dice cómo lo logra tC4, con el archivo donde se ve; cómo están hoy cuatro pantallas de Taller en un teléfono; y qué cambiar en cada una, por partes.

El aspecto (colores, Mulish, Charis SIL, botones de 44 px) ya está en el commit `567c94b` de la rama `claude/blissful-chaum-538199`. Las capturas de este documento se tomaron sobre ese commit, así que muestran Taller tal como quedaría antes de cambiar la estructura.

Las reglas del equipo que guían todo lo que sigue:

- cada pantalla se juzga como la vería alguien poco hábil con la tecnología: una sola cosa obvia que hacer, pocas opciones a la vez, medida a 375 px;
- tocar antes que escribir;
- las ayudas se leen pegadas a su texto, nunca en una lista larga;
- en el teléfono no queda nada fijo que no haga falta (Abel, 8 de octubre: lo fijo «quita mucho espacio vertical»).

Y los límites que ya fija [`UI_UX_PRINCIPLES.md`](UI_UX_PRINCIPLES.md): la acción principal se alcanza sin bajar, la pantalla no pasa de dos alturas y hay **12 controles o menos** a la vista antes de abrir nada.

## 1. Cómo lo hace tC4

Lo leído es el código de `github.com/unfoldingWord/translationCore4`, rama `main`, commit `34eaa49` (14 de octubre de 2026). La app no se pudo abrir: necesita un servidor Pankosmia en el puerto 19998 (`README.md`, «Install and test»), así que todo lo que sigue sale del código y de sus documentos, no de verla funcionar.

tC4 es una aplicación de escritorio (`docs/VISION.md`: «offline-first desktop workspace»). No tiene reglas para pantallas estrechas: la única consulta de medios del código es la de movimiento reducido (`src/ds/components/primitives/Layer.jsx`). Eso importa en la sección 2.

### 1.1 El armazón: el texto al centro, todo lo demás a los lados

| Patrón | Dónde se ve |
|---|---|
| **Tres columnas.** A la izquierda, los libros y capítulos (230 px); al centro, el texto; a la derecha, las ayudas (340 px). | `src/views/Draft.jsx` (`BookRail`, `main`, `HelpsPanel`); medidas en `src/ds/tokens/spacing.css` (`--rail-width`, `--helps-width`). |
| **El centro es el texto, en dos columnas por sección:** la fuente a la izquierda y la traducción a la derecha, fila por fila. | `Draft.jsx`, `SourceCell` y `TargetCell` dentro de una rejilla `1fr 1fr`. |
| **Las columnas laterales se ocultan** con un botón cada una; el panel de ayudas se puede ensanchar arrastrando su borde (280–720 px). | `Draft.jsx` (`toggleRail`), `src/views/HelpsPanel.jsx` (`HelpsToggleButton`, `HelpsDivider`). Las dos empiezan abiertas: `rail: true, helps: true` en `src/state.jsx`. |
| **Una barra superior para toda la app**, con tres cosas: el proyecto (vuelve al inicio), los tres modos de trabajo (Entender · Traducir · Revisar) y, a la derecha, el estado de guardado y el menú de la cuenta. | `src/App.jsx`, `TopBar`. |
| **Una sola línea de herramienta** sobre el texto: mostrar libros, «Tito 1», y a la derecha conflictos (solo si los hay) y ayudas. | `Draft.jsx`, líneas 328–334. |
| **Publicar dejó de ser una pestaña** y pasó a estar dentro de Revisar: menos modos arriba. | `docs/DECISIONS.md`, D63; comentario en `App.jsx`, `TopBar`. |

### 1.2 Dónde viven las funciones secundarias

| Función | Dónde está | Fuente |
|---|---|---|
| Cuenta, internet, ayuda, idioma, informar un problema, «Acerca de», cerrar sesión | **Menú de la cuenta**, arriba a la derecha. Cada fila tiene dos líneas: la acción y una frase que dice qué hace. | `src/views/AccountMenu.jsx`, `Row` («A two-line menu row: the action, and one line that says what it does»). |
| Ayuda de la app | Un **panel que entra desde el borde** sobre la pantalla, con su cierre. | `AccountMenu.jsx`, `Layer … placement="end"`. |
| Ajustes del proyecto, compartir en Door43 | **En la pantalla de inicio**, junto a cada proyecto, no dentro de las pantallas de trabajo. | `src/views/Home.jsx`, `ProjectCard`; `DECISIONS.md`, D84. |
| Guardar | **No hay botón**: se guarda al salir del versículo. Arriba se lee una palabra («Guardado», «Guardando», «Sin guardar») y solo si falla aparece «Reintentar». | `App.jsx`, `SaveIndicator`; `DECISIONS.md`, D9. |
| Notas, palabras, preguntas, texto simplificado, comentarios | **Panel de ayudas**, con pestañas. | `HelpsPanel.jsx`, `tabOptions`. |
| Artículo de Academia | **Encima del panel de ayudas** (con ✕), o en un **cajón** de 440 px que entra desde la derecha en Revisar. | `HelpsPanel.jsx`, `ArticleView`; `src/views/Check.jsx`, `AcademyDrawer`; `src/ds/components/surfaces/Drawer.jsx`. |
| Filtros y orden | **En la columna de la lista**, no sobre el texto: «Todo · Pendiente · No válido · Marcado · Comentado», cada uno con su número. | `Check.jsx`, `CheckRail`; `src/views/checkFilters.js`. |
| Historial | No hay una pantalla de historial. Lo que se marcó o comentó se ve como un punto o un icono en cada fila de la lista. | `Check.jsx`, `CheckRail` (`row-bookmark`, `row-comment`). |

### 1.3 Abrir una función solo cuando hace falta

| Patrón | Dónde se ve |
|---|---|
| **Las ayudas siguen al versículo abierto.** Sin nada abierto, el panel muestra el capítulo; al abrir un versículo o una sección, solo sus notas, palabras y preguntas. | `src/views/helpsFocus.js` (`editingFocus`, `inFocus`), usado en `Draft.jsx`. |
| **El versículo se abre en una tarjeta** solo al tocarlo, con Guardar y Cancelar dentro. Un versículo vacío muestra una píldora punteada «Redactar versículo N». | `src/views/draftChrome.jsx` (`EditingCard`, `DraftPill`); `Draft.jsx` (`VerseEditor`). |
| **La unidad con foco se levanta**: en Entender, la sección que se lee es una tarjeta y las demás quedan planas; la caja de apuntes aparece en esa tarjeta. | `src/views/Understand.jsx` (`UNIT_FOCUSED`, `UNIT_REST`, `ComprehensionBox`). |
| **Las notas largas se cortan** a 400 caracteres con «Ver más». | `HelpsPanel.jsx`, `ExpandableNote`. |
| **«Cómo funciona la alineación»** está plegado. | `src/views/Align.jsx`, `HowToggle`. |
| **El comentario de una revisión** se abre en línea solo al pedirlo. | `Check.jsx`, `CheckMarks`. |
| **Los avisos solo cuando algo falla.** La tarjeta de una herramienta lista dice qué hace y cuánto falta; el estado del recurso aparece solo si hay un problema. | `Check.jsx`, comentario sobre `TONE` («Exception-based») y `ToolCard`. |
| **El botón de conflictos** existe solo cuando hay conflictos. | `Draft.jsx`, `ConflictsButton`. |

### 1.4 Cuántas acciones a la vez, y cuál es la principal

| Pantalla de tC4 | Lo que se ve | La acción principal |
|---|---|---|
| Inicio | Título, una banda de color con el último lugar trabajado y «Continuar →», «+ Agregar un proyecto», las tarjetas de proyecto. | «Continuar →», que lleva al versículo y al modo donde se dejó (`Home.jsx`, `ResumeCard`). |
| Elegir herramienta de Revisar | Una tarjeta por herramienta: qué hace, barra de progreso, «Siguiente: …» y un solo enlace. | «Empezar →», «Continuar →» o «Revisar →» según lo hecho (`Check.jsx`, `ctaFor`, `nextLineFor`). |
| Revisar un elemento | Referencia y «3 de 40 ← →»; la frase en grande; «Qué revisar» en una caja; «Más información»; una tarjeta que compara original, texto puente y tu traducción; tres botones grandes. | Los tres botones: Válido, No válido, Pendiente (`Check.jsx`, `CheckDetail`, `TRIAGE_TONES`). Marcar y Comentar van debajo, más pequeños. |
| Alinear un versículo | Referencia y «n de N ← →», «Cómo funciona» plegado, una tarjeta con el modo (puente u original), el versículo, el banco de palabras y las cajas. | «Marcar válido» al pie (`Align.jsx`, `MarkValidBar`). |

### 1.5 Pasar de un elemento al siguiente

- **Lista a la izquierda, detalle al centro.** Revisar y Alinear usan la misma forma: una columna de 300 px con el progreso, los filtros y la lista con un punto de color por estado; al centro, un solo elemento. (`Check.jsx`, `CheckSession`, `CheckRail`, `AlignWorkspace`, `AlignRail`.)
- **Arriba del detalle, una línea:** «Tito 1:2», «3 de 40» y las flechas ← →. (`CheckDetail`, `AlignHeader`.)
- **Decidir no lleva al siguiente solo.** `recordDecision` guarda y deja el mismo elemento (`state.jsx`, `recordDecision`); se avanza con la flecha o con la lista.
- **Siempre hay salida a la vista:** «← Volver» arriba de la lista y «← Volver a traducir» al pie. (`CheckRail`, `AlignRail`.)

## 2. Lo que no conviene copiar de tC4

- **Las columnas laterales no caben en un teléfono.** 230 + 340 px de paneles se comen 375 px. En el teléfono, cada columna lateral tiene que ser otra cosa: una hoja que sube, o la pestaña «Recursos» que Taller ya tiene.
- **Botones de solo icono.** Mostrar y ocultar los paneles son iconos con un `title` (`Draft.jsx`, línea 329; `HelpsPanel.jsx`, `HelpsToggleButton`). En un teléfono no hay `title`, y para el equipo un icono suelto no dice que ahí hay algo.
- **Controles pequeños.** Las flechas ← → miden 30 × 30 px (`Check.jsx`, `navStyle`) y los filtros son píldoras de unos 24 px de alto (`railChip`). En Taller se queda la regla de 44 px.
- **Pasar el ratón por encima.** En tC4, pasar el ratón sobre una nota marca sus palabras en la fuente (`HelpsPanel.jsx`, `onMouseEnter`). En el teléfono no existe: en Taller eso tiene que pasar al tocar.
- **Demasiado junto en la lista de Revisar.** Cinco filtros, dos órdenes, la versión del recurso y la lista en la misma columna: en un teléfono serían más de 12 controles antes de ver un elemento.

## 3. Las cuatro pantallas de Taller hoy, y qué cambiar

Cómo se tomaron las capturas: Edge sin interfaz por el protocolo de DevTools, a 375 × 812 (×2) y a 1280 × 900, contra un Door43 de prueba sembrado con Tito, como «ana». Los números son de la primera pantalla, sin tocar nada: los controles que se pueden tocar y cuántos miden menos de 44 px. Las capturas no entran en el repositorio (sección 7): las de 375 px están en la carpeta de notas compartidas de la sesión, en `estructura-tc4/`, y abajo se nombra cada una; las de 1280 px y las medidas, en la carpeta de notas de la sesión que hizo este estudio.

### 3.1 Mis tareas (`MyTasksView`, `TaskCard`)

*Mis tareas a 375 px* (`mis-tareas-375.png`)

**Lo que se ve sin tocar nada (375 px):** la barra con el logo y el menú; la tarjeta «Hola, ana · Para empezar con buen pie», con dos consejos y «Listo, ocultar esto»; el título «Mis tareas» con otro «Hola, Ana» y «Actualizar»; el grupo «Para decidir» y su tarjeta con «Decidir»; el comienzo de «Para empezar»; la barra de abajo con cuatro secciones.

- 12 controles; 3 miden menos de 44 px: el menú (32 px), «Listo, ocultar esto» (19 px de alto) y «Actualizar» (28 px).
- La primera tarea empieza a 513 px de 812: más de la mitad de la pantalla se va antes de llegar a ella.
- Con tres tareas, la página mide 1,8 pantallas.
- A 1280 px es igual: la bienvenida ocupa todo el ancho y las tarjetas van en una columna de 720 px con el lado derecho vacío.

**Qué compite con lo principal:** la tarjeta de bienvenida (unos 290 px, más de un tercio de la pantalla), el saludo dicho dos veces y «Actualizar», que parece un título más.

**La tarjeta de tarea ya sigue a tC4.** Tiene un solo botón principal y lo demás («Ver los pasos», «Comentar», «Abrir en otra pestaña», «Entregar», «Soltar») está en «⋯» (`TaskCard.tsx`, `menuItems`). No hace falta cambiarla.

| | Propuesta |
|---|---|
| **Queda a la vista** | Los grupos y sus tarjetas, empezando por la primera. |
| **Pasa a un menú** | La bienvenida, cuando ya no hace falta: la tarjeta se queda arriba hasta que la persona abre su primera tarea, y desde entonces vive en el menú de la cuenta como «Cómo empezar — instalar la app y encontrar tus tareas» (decidido, sección 7). |
| **Se quita** | El segundo «Hola». «Actualizar» deja de ser un título: la lista se actualiza sola al volver a la app, y abajo de todo queda una línea «Actualizado hace 2 min · Actualizar» con un botón de 44 px. |
| **Acción principal** | El botón de la primera tarjeta del primer grupo (hoy «Decidir»). Copiando la banda «Continuar →» de tC4 (`Home.jsx`, `ResumeCard`), esa primera tarjeta puede ser la única destacada: «Sigue aquí». |
| **1280 px** | La columna de tarjetas queda centrada; si hace falta usar el ancho, a la derecha pueden ir los avisos que hoy viven en «Avisos». Esto es opcional. |

### 3.2 Las propuestas (`ProposalListView`, `TextChangeView`, `ChangeReasons`, `DecisionCard`)

Hay dos formas: una lista de propuestas de un capítulo (con la tira de versículos y «Anterior · 1 de 4 · Siguiente») y una propuesta sola.

| Arriba | Bajando | Al final |
|---|---|---|
| *Lista de propuestas, arriba* (`propuestas-lista-375-1.png`) | *Lista de propuestas, razones* (`propuestas-lista-375-2.png`) | *Lista de propuestas, decidir* (`propuestas-lista-375-3.png`) |

*Una propuesta sola a 375 px* (`propuestas-una-375.png`)

**Lo que se ve sin tocar nada, en la lista (375 px):** la cabecera «Tito 1 · Propuestas al TPL · 4 por decidir»; la tira 1:1 · 1:2 · 1:3 · 1:4; «¿Cómo se decide?»; el título «Tito 1:1»; las tres formas de ver el cambio (Juntos, Uno bajo otro, Lado a lado); el versículo, que empieza a unos 355 px; y la barra fija de abajo con «Anterior · 1 de 4 · Siguiente». «Comparar con el original», «Por qué se propone», las razones, los botones de decidir y «Ver la conversación» quedan más abajo: los botones de decidir aparecen después de bajar más de una pantalla.

**En una propuesta sola:** 10 controles, 2 de menos de 44 px; los botones de decidir sí se ven en la primera pantalla (empiezan a 640 px), porque no hay tira ni razones numeradas.

**Qué compite con lo principal:** cuatro cosas antes del versículo (la tira, «¿Cómo se decide?», el título repetido y el selector de forma); «Comparar con el original» entre el versículo y sus razones; y, al pie, «Siguiente» fijo y con borde, que se ve antes que «Aceptar».

| | Propuesta |
|---|---|
| **Queda a la vista** | En este orden: una línea con «Tito 1:1 · 1 de 4 ‹ ›» (como `CheckDetail` de tC4); el versículo con el cambio marcado; las razones, pegadas debajo, en una caja como «Qué revisar» de tC4; los botones de decidir. |
| **Pasa a un panel o menú** | La tira de versículos, cuando la lista tiene más de seis propuestas: tocar «1 de 4» abre la lista entera en una hoja, con un punto por estado (por decidir, decidida, tuya). Con seis o menos, la tira se queda a la vista (decidido, sección 7). A 1280 px esa lista es una columna a la izquierda, como `CheckRail`. La forma de ver el cambio pasa a «⋯ Cómo ver los cambios», y se recuerda (ya se guarda en `gt-change-layout`). «¿Cómo se decide?» queda plegado debajo de los botones de decidir, donde surge la duda. |
| **Se mueve** | «Comparar con el original y otros textos» queda plegado, pero después de las razones, no entre el versículo y ellas. |
| **Se quita** | El título «Tito 1:1» dentro de la tarjeta, que repite la cabecera. |
| **Acción principal** | Aceptar o rechazar. Después de votar, «Siguiente» pasa a ser el botón lleno: lleva de un paso al siguiente, como pide la regla del equipo. tC4 no avanza solo, y aquí tampoco hace falta: basta con que el siguiente paso sea lo más visible. |
| **1280 px** | Ya está en dos columnas (el versículo a la izquierda; las razones y decidir a la derecha): se queda así, con la lista a la izquierda. |

### 3.3 El editor del texto bíblico (`ScriptureEditorView`)

| El borrador | Un versículo abierto | Recursos, con el versículo abierto |
|---|---|---|
| *Editor a 375 px* (`editor-375.png`) | *Escribiendo el versículo 2* (`editor-375-escribiendo.png`) | *Recursos del versículo 2* (`editor-375-recursos-foco.png`) |

| Recursos sin versículo abierto | El menú «⋯» |
|---|---|
| *Recursos a 375 px* (`editor-375-recursos.png`) | *Menú de detalles* (`editor-375-mas.png`) |

**Lo que se ve sin tocar nada (375 px):** la cabecera con «‹», «Tito 1:1–4», debajo otra vez «Tito 1:1–4 · TPL · TPL», «⋯» y «Terminé»; «Qué se pide en «Borrador»» y «Introducción del libro y del capítulo», los dos plegados; «Tu borrador · TPL — 4 de 4 con texto»; los versículos, cada uno para tocar; «Unir 1 y 2», «Unir 2 y 3», «Unir 3 y 4» entre ellos (36 px de alto); y abajo las pestañas Editor y Recursos. Son 14 controles a la vista.

**Lo que Taller ya hace como tC4.** Al tocar un versículo se abre una tarjeta con el ULT de ese versículo, la caja para escribir y «Fíjate en esto» debajo; los pliegues de arriba y los «Unir» de alrededor desaparecen. Y en Recursos, con un versículo abierto, la lista se reduce a ese versículo («Solo lo del versículo 1:2», 8 notas en vez de 50). Es lo mismo que `EditingCard` y `helpsFocus.js` de tC4.

**Qué compite con lo principal:**

- en el teléfono, la fuente no se ve junto al borrador hasta abrir un versículo;
- dos pliegues encima del texto;
- tres «Unir» entre cuatro versículos;
- el nombre del pasaje dicho dos veces en la cabecera;
- el menú «⋯» mezcla datos técnicos (tarea #4, la ruta del archivo, la fase) con acciones (Glosario, Estudio, Rehacer mi borrador);
- a 1280 px, seis controles en la cabecera (Cerrar, ⋯, Glosario, Estudio, «Sin cambios», «Terminé el borrador») y, sin versículo abierto, la lista de 50 ayudas del capítulo bajo la fuente.

| | Propuesta |
|---|---|
| **Queda a la vista** | Los versículos del borrador; al tocar uno, su tarjeta tal como está hoy. La cabecera: «‹», «Tito 1:1–4 · TPL» en una línea, el estado de guardado como una palabra debajo («Guardado»), y «Terminé». |
| **Pasa a un menú** | Glosario, Estudio y «Rehacer mi borrador» van a un solo «⋯ Más», con filas de dos líneas como el menú de tC4 («Glosario — las palabras que el equipo ya decidió»). Los datos técnicos (tarea, archivo, fase) van al final de ese menú, en gris. |
| **Se junta** | «Qué se pide» e «Introducción» en un solo pliegue, «Antes de empezar», que se abre solo la primera vez que la persona entra a ese paso. |
| **Se mueve** | «Unir» pasa a la tarjeta del versículo abierto («Unir con el 3»): aparece cuando hace falta, como las funciones de la tarjeta de tC4. |
| **A 1280 px** | Sin versículo abierto, el panel de ayudas muestra el primer versículo que falta, no las 50 del capítulo; «Todo el capítulo» queda como una opción, igual que hoy queda «Solo lo del versículo». |
| **Acción principal** | Tocar un versículo para escribir; al final, «Terminé». |

### 3.4 La herramienta de alinear (`AlineacionView`)

El encargo nombraba `AfinacionView`, pero en el código la herramienta de alinear es `AlineacionView` (`App.tsx`, ruta `solver-afinar` con `step=alineacion`). `AfinacionView` es la de afinar notas y palabras; se ve al final de esta sección.

| Arriba | Bajando |
|---|---|
| *Alinear a 375 px* (`alinear-375.png`) | *Alinear, las cajas* (`alinear-375-2.png`) |

**Lo que se ve sin tocar nada (375 px):**

- la cabecera, con «‹», «Tito 1:1–4», «Alinear · Alinear TPL · 0 de 4 terminad…» cortado, y dos iconos sin palabra (Apuntes y Leer el capítulo, 40 × 40 px);
- dos pliegues;
- los versículos 1 · 2 · 3 · 4 con su estado (42 × 36 px);
- una tarjeta fija con «Borrador · Original · ULT», «Todo colocado», las palabras del borrador (32 px de alto, algunas de 16 px de ancho), «Corregir o comentar», un tirador y «Ampliar»;
- un hueco vacío;
- las cajas del original con sus palabras, cada una con su ×;
- la barra de abajo con deshacer, rehacer, borrar (solo iconos), «Terminé» y «Seguir».

En total hay 85 controles y 80 miden menos de 44 px; la página mide 1,7 pantallas. A 1280 px son 126.

**Qué compite con lo principal:** dos pliegues, la fila de versículos y el selector de tres textos antes de las palabras; dos iconos sin nombre arriba; tres iconos sin nombre abajo; y dos botones grandes juntos («Terminé» y «Seguir»). Por el código, «Terminé» es el principal y «Seguir» guarda y pasa al siguiente (`AlineacionView.tsx`, `al-actionbar__main`), pero en la pantalla se parecen.

| | Propuesta |
|---|---|
| **Queda a la vista** | Una línea «Tito 1:2 · 2 de 4 ‹ ›» con los puntos de estado (lo que hoy es la fila de versículos); la tarjeta con las palabras por colocar; las cajas; «Terminé este versículo». |
| **Se junta** | Los dos pliegues en uno, «Cómo se alinea», como `HowToggle` de tC4. La introducción del capítulo va a «Leer el capítulo». |
| **Pasa a un menú** | «Borrar todo», que se usa poco y deshace mucho, va a «⋯ Más». Apuntes y Leer el capítulo llevan su palabra debajo del icono o pasan a ese menú. |
| **Se aclara** | «Borrador · Original · ULT» queda dentro de la tarjeta, como `ModeBar` de tC4, con una línea que dice qué se ve. «Seguir» se queda solo como enlace hasta que el versículo esté terminado. |
| **Para medir aparte** | Las palabras de 32 px de alto y las × dentro de cada palabra. Arrastrar y tocar necesitan otra medida que los botones, y conviene probarlo en un teléfono antes de cambiarlo. |
| **Acción principal** | «Terminé este versículo», que lleva al siguiente que falta. |

**La herramienta de afinar (`AfinacionView`) ya tiene la forma de tC4:** pestañas Revisar · Ayudas · Capítulo · Introducción, un filtro «Todo · 0/16» con «1 de 16 ‹ ›», el desafío con su categoría y «Paso 1 de 2», la referencia y la traducción, y dos botones al pie. Es el modelo a seguir en las otras. Eso sí, a 375 px **se sale por la derecha**: el contenedor `.af` mide 418 px de ancho (`af-focus__top`, `af-category`, `af-stepname` llegan a 404 px). Se vio en la rama del estilo; falta comprobar si pasa también en `main`.

*Afinar a 375 px* (`afinar-375.png`)

## 4. Piezas comunes

Varias propuestas son la misma en todas las herramientas. Conviene hacerlas una vez, en los componentes que ya comparten:

1. **La cabecera de herramienta** (`ToolHeader.tsx`, que usan 12 herramientas; el editor tiene la suya en `ScriptureEditorView`). Lleva «‹», el título en una línea, el estado de guardado como palabra, un solo botón lleno y «⋯ Más». Nunca un icono sin palabra.
2. **El menú «Más»** con filas de dos líneas: qué es y para qué sirve, como `AccountMenu.jsx`, `Row`.
3. **«Cómo se hace» plegado, uno por pantalla** (`StepAsk.tsx`, que usan 13 pantallas): «Qué se pide» e «Introducción» juntos.
4. **La línea de posición** «Tito 1:2 · 2 de 4 ‹ ›». Tocar el número abre la lista con el estado de cada elemento: una hoja en el teléfono y una columna a 1280 px.
5. **Hoja o cajón para lo largo** (artículos, el capítulo, la conversación): en el teléfono sube a toda la altura con «Cerrar»; a 1280 px entra desde la derecha, de 440 px, como `Drawer` de tC4.
6. **Avisos solo cuando algo falla**, como las tarjetas de herramienta de tC4.

## 5. Riesgos para el equipo

El equipo usa el teléfono y no se maneja bien con la tecnología. Mover algo a un menú le puede quitar una función sin que se dé cuenta.

- **Nada escondido sin que se note.** Cada menú lleva una palabra («Más»), no solo «⋯». Una pestaña dice cuánto hay dentro («Notas 3»). La primera vez que algo cambia de lugar, una línea lo dice una sola vez: «Glosario y Estudio están ahora en Más».
- **Lo que el equipo ya aprendió cambia de lugar.** Hay que avisarle en la app y en la reunión antes de publicar cada parte, y no mover lo mismo dos veces.
- **Toques de 44 px.** No se copian las flechas de 30 px ni los filtros pequeños de tC4. Hoy no llegan a 44 px: el menú de la cuenta (32), «Actualizar» (28), «Listo, ocultar esto» (19 de alto), «Unir» (36), la fila de versículos de alinear (36) y los iconos de alinear (40). Las palabras de alinear se miden aparte (sección 3.4).
- **Una cosa obvia.** Un solo botón lleno por pantalla; lo demás va con borde o como enlace. Al terminar algo, el botón lleno pasa a ser el que lleva al siguiente paso.
- **El teclado.** Con el teclado abierto quedan unos 400 px. Las barras fijas (la de abajo de propuestas, la tarjeta fija de alinear) no deben tapar la caja donde se escribe.
- **Sin ratón.** Lo que tC4 hace al pasar el ratón por encima, aquí pasa al tocar.
- **Portugués.** Las palabras son más largas: cada cabecera y cada menú se miden también en `pt` a 375 px.
- **Dos maneras de hacer lo mismo confunden.** Al mover algo, se quita del lugar viejo en el mismo cambio.

## 6. Orden para hacerlo por partes

Cada parte es un cambio aparte, que se prueba solo, con capturas de antes y después a 375 y a 1280 px (también en portugués), `npx tsc --noEmit -p .`, `npm run verify:config` (claves nuevas en `es.json` y `pt.json`) y `npm run verify:decoupling`. Después, Abel la prueba en su teléfono.

1. **La cabecera común y el menú «Más»** (`ToolHeader`, la cabecera del editor). Es lo que más se repite y cambia poco en cada pantalla.
2. **Mis tareas:** la bienvenida al menú después de la primera tarea, un solo saludo y «Actualizar» abajo. Es pequeño, se ve enseguida y no toca datos.
3. **Un solo «Antes de empezar»** (`StepAsk`, `PassageIntroText`) en todas las herramientas.
4. **Propuestas:** el versículo primero, la lista en una hoja cuando pasa de seis, la forma del cambio al menú y «Siguiente» lleno después de votar. *Hecho el 14 de octubre, con la conversación de cada propuesta debajo de «Decidir».*
5. **Editor:** «Unir» dentro de la tarjeta y, a 1280 px, las ayudas del versículo que falta.
6. **Alinear:** la línea de posición, las palabras en los iconos, «Borrar todo» al menú y la medida de las palabras en un teléfono.
7. **La hoja y el cajón** para artículos y textos largos, cuando los pasos anteriores ya estén.

Antes del paso 1 conviene arreglar que afinar se salga por la derecha a 375 px, si también pasa en `main`.

## 7. Decidido con Abel (14 de octubre de 2026)

1. **La bienvenida** se queda arriba de «Mis tareas» hasta que la persona abre su primera tarea; desde entonces vive en el menú de la cuenta. Quien empieza no la pierde, y a quien ya trabaja no le quita la pantalla.
2. **«Actualizar»:** la lista se actualiza sola al volver a la app, y abajo de todo queda «Actualizado hace 2 min · Actualizar», con un botón de 44 px, por si acaso.
3. **La tira de versículos** de las propuestas se queda a la vista con seis propuestas o menos; con más, pasa a una hoja que se abre al tocar «1 de N».
4. **Después de votar**, «Siguiente» pasa a ser el botón lleno, y la pantalla no avanza sola: quien acaba de votar ve que su voto quedó.
5. **La forma de ver el cambio** (Juntos, Uno bajo otro, Lado a lado) va al menú «Más» como «Cómo ver los cambios»: se elige una vez y se recuerda.
6. **Las capturas** no entran en el repositorio (quedarían en su historia para siempre): están en la carpeta de notas compartidas, y el documento las nombra.
