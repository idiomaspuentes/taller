# Afinación: análisis de la alineación y próximos pasos

Estado al 30 de septiembre de 2026. Nada de esto está confirmado en git. Todo lo que se dice aquí sobre pantallas sale de verlas funcionando con dos personas (Ana y Bea) contra el Door43 de mentira (`scripts/mock-door43`), en tamaño de teléfono (375 px) y de computador. El arrastre queda fuera de este análisis: no se ha probado en un teléfono real.

## 1. Lo que se vio

**Alineación en teléfono (versículo de 11 palabras y 17 palabras del original)**
- El banco de palabras ocupa 191 px de 812, casi una cuarta parte de la pantalla, y queda fijo arriba.
- Cada caja mide 106 px de alto. Las 17 cajas suman 1033 px. Los botones ("Juntar cajas", "Terminé este versículo", "Guardar y seguir") empiezan a 1494 px: hay que bajar casi dos pantallas para terminar un versículo.
- De 14 a 17 cajas, solo 4 a 6 tienen palabras. Las demás (partículas, nombres repetidos, la forma escrita y la leída del hebreo) quedan vacías. Lo que importa queda escondido entre cajas vacías.
- Debajo de cada palabra hebrea se muestra el lema, también en hebreo. Quien no lee hebreo no recibe ninguna ayuda con eso.
- La × para quitar una palabra y el asa de arrastre miden unos 28 px, por debajo de los 44 px recomendados para el dedo.
- Las palabras ya colocadas se atenúan al 40 %: es difícil leerlas y el contraste es bajo.
- Los superíndices de repetidas ("de¹", "de²") son diminutos.

**Alineación en computador**
- Se ve bien: banco a la izquierda, cajas a la derecha. Pero con versículos largos los botones de acción quedan fuera de la vista y hay que bajar para guardar.
- No hay atajos de teclado.

**Revisión de la alineación (computador)**
- La revisión muestra la misma cuadrícula de 14 cajas, 10 de ellas vacías con un guion. Para revisar hay que recorrer todas con la vista.
- Las tres respuestas están debajo de la cuadrícula. En teléfono quedan lejos.

**Inconsistencias**
- En "Alinear" la pestaña del versículo se pone verde cuando todas las palabras del borrador están colocadas ("completo"), pero el avance dice "terminados" (los que se marcaron con "Terminé"). Son dos cosas distintas y se ven como una.
- Al cambiar de versículo con una pestaña, los cambios sin guardar se quedan solo en memoria. Si se cierra la pantalla, se pierden sin aviso.
- Tras responder en la revisión, salta al versículo siguiente aunque ese todavía no esté terminado y no se pueda responder.

## 2. Mejoras propuestas

Tamaño: S = pocas horas, M = un día, L = varios días. Impacto para quien trabaja en el teléfono y para quien revisa.

| # | Mejora | Dónde | Tamaño | Por qué |
|---|--------|-------|--------|---------|
| 1 | **Barra de acciones fija abajo** ("Terminé", "Guardar y seguir", "Deshacer"; en revisión, las tres respuestas) | Alinear, Revisar | S | Quita el desplazamiento de casi dos pantallas. Es la mejora de más efecto. |
| 2 | **Guardar solo al cambiar de versículo o salir**, insignia "Sin guardar" en la pestaña y aviso al cerrar | Alinear | S | Hoy se pueden perder cambios sin darse cuenta. |
| 3 | **Deshacer y rehacer**, y "Limpiar versículo" | Alinear | S | Un toque equivocado en el teléfono no tiene vuelta atrás. El editor original sí tiene "Limpiar". |
| 4 | **Cajas vacías compactas**: una línea "sin palabras" (se expanden al tocarlas), o un grupo plegable "10 palabras del original sin traducción" | Alinear, Revisar | M | Deja a la vista lo que tiene palabras y acorta la pantalla a la mitad. |
| 5 | **Glosa en inglés en cada caja** (de la alineación del ULT, que ya leemos) en lugar del lema hebreo | Alinear, Revisar | M | Quien no lee hebreo sabe qué palabra es. Es la mayor ayuda para el equipo. |
| 6 | **Línea de referencia ULT/UST** (texto en inglés del versículo) sobre el borrador | Alinear | S | Las notas ya muestran original, inglés y borrador. La alineación solo original y borrador. |
| 7 | **Revisión en lista de pares** ("דִּבְרֵי → Las palabras de") con las palabras del original sin traducción plegadas y las del borrador sin colocar marcadas en rojo | Revisar | M | Se revisa leyendo una lista corta, no mirando una cuadrícula. |
| 8 | **Objeción con ubicación**: en la revisión, tocar la(s) caja(s) a las que se refiere "Propongo un cambio" u "Objeción" y guardarlas con la nota | Revisar | M | La nota libre no dice dónde. Para quien alineó, saber qué caja es lo que más ayuda. |
| 9 | **Qué cambió desde tu respuesta**: resaltar las cajas distintas de cuando respondiste | Revisar | M | Hoy solo dice "Cambió la alineación". Hay que volver a revisar todo. |
| 10 | **Tres estados claros del versículo**: pendiente, completo (falta terminar), terminado; con icono, no solo color | Alinear | S | Quita la confusión entre "completo" y "terminado". |
| 11 | **"Siguiente pendiente para mí"** en vez de pasar al siguiente a ciegas; "Te faltan N versículos por responder" | Revisar | S | Evita caer en versículos que no se pueden responder. |
| 12 | **Avisar al autor**: "Eres quien alineó este versículo: tu respuesta no cuenta como independiente" | Revisar | S | Hoy puede responder sin saber que no suma al mínimo. |
| 13 | **Botón de "Cómo funciona"** y tres pistas la primera vez (elegir palabras, tocar la caja, juntar cajas); cambiar "Juntar cajas" por "Unir palabras del original" | Alinear | S | La interacción de dos toques no se descubre sola. |
| 14 | **Zonas táctiles de 44 px**: × de las fichas, asa, botones; quitar × en teléfono y usar un menú al tocar la ficha ("Quitar", "Mover a…") | Alinear | S | Menos errores de dedo. |
| 15 | **Palabras ya colocadas**: texto legible con una marca ✓ en vez de atenuarlas al 40 % | Alinear | S | Contraste y claridad. |
| 16 | **Tamaño de letra** (A−, A+) guardado por persona | Alinear, Revisar | S | Importante para personas mayores. |
| 17 | **Banco más bajo en teléfono**: una sola línea que se desliza, con "quedan N palabras" y el banco completo al tocar | Alinear | M | Devuelve casi 150 px a las cajas. |
| 18 | **Atajos de teclado en computador**: flechas para moverse entre cajas, 1-9 para elegir palabras del banco, Enter para colocar, Esc para soltar, Ctrl+Z | Alinear | M | Acelera a quien alinea mucho. |
| 19 | **Accesibilidad**: estados que no dependan solo del color, orden de foco, anuncios para lectores de pantalla, contraste revisado | Todo | M | Hoy solo hay etiquetas básicas. |
| 20 | **Sugerencia automática de alineación** a partir del ULT y de las palabras ya alineadas en otros versículos (solo proponer, nunca guardar sola) | Alinear | L | Ahorra trabajo, pero necesita diseño y prueba cuidadosos. |
| 21 | **Propuestas y objeciones con alineación**: quien propone un cambio lo hace sobre una copia de la alineación del versículo (las mismas cajas) y lo envía con su nota; quien alineó o quien coordina lo acepta (se aplica y el proponente queda de acuerdo) o lo rechaza con motivo. Las objeciones indican la caja y se resuelven al cambiar la alineación, al retirarlas quien las puso o con una decisión de la reunión | Revisar | L | Hoy "Propongo un cambio" y "Tengo una objeción" son solo una nota: no se puede aplicar y nadie la acepta. Ver la sección 5. |

**Ya hecho (30 de septiembre de 2026), comprobado con dos personas en el Door43 de mentira:** 1 (barra de acciones fija abajo, con deshacer, rehacer y guardar/terminar; en la revisión, las tres respuestas y el campo de la nota), 2 (se guarda al cambiar de versículo con las pestañas, con "Volver" y con el pager; marca "Sin guardar" y aviso del navegador al cerrar), 3 (deshacer, rehacer y "Limpiar versículo"), 10 (tres estados por versículo con marca y texto), 11 ("Siguiente por responder" y contador "Te faltan N versículos por responder"), 12 (aviso al autor), 14 (zonas táctiles de 44 px en pantallas táctiles) y 15 (palabras colocadas legibles con ✓), y además 4 (cajas vacías compactas: 56 px en vez de 106), 5 (glosa en inglés tomada del ULT o el UST alineado, que se acorta en una palabra entera), 6 (texto del versículo en inglés, abierto en computador y cerrado en teléfono) y 7 (revisión como lista de pares, con las palabras sin traducción plegadas y las del borrador sin colocar avisadas arriba).

**Error encontrado al hacerlo:** las tres pantallas de la Afinación (notas, palabras y alineación) **no se podían desplazar** en una pantalla completa de herramienta: el contenedor tenía `overflow: hidden` y las pantallas no traían su propio desplazamiento, así que no se llegaba al resto del versículo. Corregido en `.af`. Las pruebas anteriores no lo vieron porque leían la página con código, no con el dedo: conviene que toda prueba de pantalla incluya desplazarse hasta el final.

**Orden recomendado para lo que falta:** 21 (propuestas con alineación, junto con 8 y 9, porque son parte del mismo flujo); después 13, 16, 17; al final 18, 19, 20.

## Decisiones tomadas (30 de septiembre de 2026)

1. **Versículo terminado con cajas vacías del original:** solo se avisa ("Quedan N cajas del original sin palabras; está bien si no tienen traducción"), sin pedir confirmación. El hebreo trae a veces dos formas de la misma palabra y una nunca tendrá traducción; pedir confirmación cada vez frenaría el trabajo sin evitar errores. Lo que sí es obligatorio: todas las palabras del borrador colocadas.
2. **Servidor con el que empieza una sesión nueva:** QA cuando la app corre en desarrollo y producción en la versión publicada (`DEFAULT_HOST` en `src/dcs/config.ts`). En desarrollo, si alguien elige producción en el inicio de sesión, aparece un aviso en rojo. Quien ya tenía un servidor guardado lo conserva.
3. **Auditoría de producción:** la hace una persona del equipo, no el asistente. `scripts/audit-gateway-tasks-history.mjs` lista, solo con lecturas, quién cambió `solvers.json` y `config.json` de `gateway-tasks` y cuándo. Se ejecuta con el token propio:
   `DCS_TOKEN=... node scripts/audit-gateway-tasks-history.mjs https://git.door43.org es-419_gl 2026-09-01`

## 3. Próximos pasos generales

**A. Mismo análisis para las otras pantallas de la Afinación**
1. Notas: original, inglés y borrador en una sola pantalla de teléfono; cuánto hay que desplazarse; textos largos de las notas.
2. Palabras clave: la comparación "En todo el libro" en teléfono; el selector de traducción preferida; mostrar el artículo del término (no solo el título).
3. Equipo hoy: lo mismo, y avisar cuando alguien asigna.

**B. Pruebas que faltan**
1. Pulsación larga para arrastrar en un teléfono real (queda pendiente desde el principio).
2. Una ronda con tres personas y el mínimo real de la tarea, en el Door43 de mentira, y después en QA si se pide.
3. Que el aviso por mención llegue a "Avisos" de la persona (hoy solo se comprobó que el comentario se escribe con la mención).
4. Convertir el escenario de dos personas en un script repetible (`verify:dos-personas`) que use el servidor de mentira.
5. Prueba de ida y vuelta del USFM alineado (guardar, releer, guardar) para cualquier palabra con puntuación, comillas o guiones; el fallo del punto doble salió por no tenerla.
6. Abrir en el usfm-editor real un borrador alineado desde TAS y confirmar que ve las mismas alineaciones.

**C. Producto y flujo**
1. Notificaciones push (web push, etapa 2) para nuevas tareas y respuestas pendientes.
2. Mostrar en Mis tareas cuánto falta de la Afinación por capítulo y por persona.
3. "Asignar a otra persona": mostrar también el nivel de cada candidata y la carga de trabajo.
4. Ampliar el servidor de mentira con ramas y fusiones para probar también el paso de Traducción.
5. Ajustes de proyecto: poder cambiar el paquete de recursos y ver de inmediato que carga (hoy solo se ha probado el inglés).

**D. Seguridad, datos y orden del trabajo**
1. **Producción (`es-419_gl/gateway-tasks`): auditada el 30 de septiembre de 2026 sobre un clon local, solo lectura.** Tenía 4 commits: creación del repositorio, creación de `solvers.json` con el catálogo estándar, un commit que agregó la herramienta `afinar-notas` (guardado automático hecho por error desde una sesión abierta en producción; ya quitado) y otro sin cambios. No había `config.json` ni planes. **Decisión de Abel: ese repositorio se borra porque la app aún no se ha lanzado y sus datos allí fueron por error.** Lo borra él, cuando quiera; no hace falta revertir nada antes.
2. Decidido: QA por defecto en desarrollo (ver decisiones).
3. Nada de lo hecho está en git. Conviene partir el trabajo en varios commits revisables: flujo FCR y esperas, niveles, Equipo hoy, Afinación (notas, palabras, alineación), servidor de mentira. Hay que pedirlo para hacerlo.
4. `verify:prep` falla desde antes; hay que decidir si se arregla o se retira.

## 4. Riesgos conocidos

- Guardar alineaciones reescribe el borrador grupal. La regla de quitar la puntuación de las palabras alineadas es crítica; si se toca, repetir la prueba de ida y vuelta.
- La huella de "terminado" depende del texto del borrador y de las uniones; si cambia cómo se calcula, todas las marcas de "terminado" quedan sin valor.
- El servidor de mentira no reproduce todo Door43 (por ejemplo, rechazos de permisos o ramas protegidas). Antes de usar esto con el equipo, una prueba corta en QA.

## 5. Propuestas y objeciones: cada una es una decisión del equipo

**Antes de esta tanda.** "Propongo un cambio" y "Tengo una objeción" solo guardaban una nota. El versículo pasaba a "en discusión" y nadie podía aceptar nada: quien alineó leía la nota y corregía a mano. Quien proponía no podía mostrar el cambio.

**Decisiones de diseño (acordadas el 1 de octubre de 2026).**
- **Dónde vive la conversación: un issue de Door43 por decisión.** Es una subtarea más del mismo proyecto y de la misma tarea, libre para todo el equipo: aparece en Mis tareas y en Equipo hoy y avisa a todos. La discusión son comentarios normales. Los votos son tarjetas de un clic (una por persona; vale la última). Al decidir se deja un resumen y se cierra.
- **Dónde viven los datos que deben viajar con el texto: el repositorio del texto.** La propuesta completa (la alineación propuesta, la huella de la versión sobre la que se hizo y la nota) va en `checkings/proposals/`, escrita solo por quien propone. El resultado de la decisión va en un archivo aparte, escrito una sola vez. No se guardan comentarios en JSON temporales.
- **Proponer un cambio:** se edita una copia de la alineación del versículo con las mismas cajas y se envía con una nota. No toca el borrador grupal. La persona que propone cuenta como un voto a favor, no independiente.
- **Objeción:** no se aplica; señala las palabras del original a las que se refiere y el motivo.
- **Quién vota:** las habilitadas del equipo de la tarea. Quien alineó y quien propone cuentan para el mínimo, pero no como independientes. Los mínimos vienen de la tarea (los mismos de la revisión).
- **Cuándo se decide:** cuando una opción reúne el mínimo de habilitadas, con el mínimo de independientes y sin votos de la opción contraria. Plazo de 3 días; vencido, decide quien coordina con un botón. La reunión queda solo para lo que ni así se resuelva.
- **Nada se cierra ni se aplica solo:** los votos solo registran. Al llegar al consenso se avisa a quien propuso y a quien alineó, y una persona debe **confirmarlo** viendo quién votó qué y qué se va a aplicar. Si alguien cambia su voto antes, el consenso se deshace y confirmar falla.
- **Qué ocurre al decidir:**
  - *Propuesta aceptada:* se aplica la alineación propuesta (solo si la alineación no cambió desde que se propuso; si cambió, la propuesta caduca), el versículo queda terminado con esa versión y las demás respuestas pasan a desactualizadas con aviso.
  - *Propuesta rechazada:* la alineación queda igual; la respuesta abierta de quien propuso deja de bloquear el versículo.
  - *Objeción que prospera:* se le pide a quien alineó que lo ajuste (aviso con la objeción); al cambiar la alineación, las respuestas se vuelven a pedir.
  - *Objeción que no prospera:* se cierra con el motivo y deja de bloquear.
- **Cambios del texto del borrador** siguen siendo correcciones inmediatas; esto es solo para la alineación.

**Hecho (1 de octubre de 2026), comprobado con Ana, Bea y Carla en el Door43 de mentira:**
- "Propongo un cambio" abre la alineación en las mismas cajas sobre una copia; se envía con una nota y abre la decisión del equipo. "Tengo una objeción" deja tocar las palabras del original a las que se refiere.
- La decisión es una subtarea libre del equipo (abre a cualquier integrante de la tarea, aunque nadie la tenga asignada), con una tarjeta de votos, la confirmación del consenso y el cierre que aplica la alineación y guarda el resultado en `checkings/proposals/`.
- El versículo muestra "en discusión del equipo" con el enlace a la decisión; una objeción que prospera aparece como petición de ajuste para quien alineó; una propuesta aceptada deja el versículo terminado con la versión nueva.
- Equipo hoy tiene un grupo "Decisiones del equipo" con el plazo y "Recordar a quien falta" (menciona solo a las habilitadas de la tarea que no han votado ni propusieron). En Mis tareas una decisión dice "Decisión del equipo" y "Votar", sin la lista de pasos de la tarea, y llega como libre a toda la gente de la tarea, sin filtro de nivel.
- Pendiente: aviso automático a quien no ha votado al acercarse el plazo (hoy el recordatorio es manual, desde Equipo hoy) y cómo se ven las tarjetas en un teléfono real.

**Cómo se ven las decisiones (1 de octubre de 2026):**
- La alineación se ve siempre en cajas, las mismas que usa quien alinea, pero compactas y de solo lectura (con la glosa en inglés y las palabras sin traducción plegadas). En la revisión ya no hay lista de pares: las cajas la reemplazan.
- En la tarjeta de una **propuesta** se ve la alineación de ahora y la propuesta, y en esta última la caja que cambia va resaltada en otro color.
- En la tarjeta de una **objeción** las cajas objetadas van en amarillo; se eligen tocando las cajas en la revisión.
- Una propuesta también puede **cambiar el texto del borrador**: quien propone edita el texto del versículo, las uniones siguen a las palabras que se quedan y las nuevas quedan por colocar. La tarjeta muestra el diff del versículo (lo que sale tachado, lo nuevo en verde) y la alineación nueva en cajas con todas las palabras. Al aceptarse se escribe primero el texto y después la alineación.
