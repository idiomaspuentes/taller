# «Mis tareas»: tarjetas que se entienden

Diseño, 24 de noviembre de 2026. Aprobado por Abel en la conversación («ve con tu recomendación»). Trabajo de Idiomas Puentes.

## Para qué

Abel: «Las tarjetas de tareas para la fase 1 son confusas». Hoy una persona de la Fase 1 puede ver unos 23 estados de tarjeta, repartidos en nueve grupos. Pidió además información que ayude a entender, por ejemplo:

- en la revisión grupal, cuántos pasajes del capítulo ya llegaron y cuántos faltan;
- en qué punto del camino va cada trabajo: una lectura en grupo va más adelante que un borrador o una revisión en pares.

Las tarjetas las usan personas poco hábiles con la tecnología, en el teléfono y muchas con la letra agrandada.

Lo que confunde hoy (detalle en `docs/superpowers/specs/tarjetas-pasadas/`):

1. «Revisar» significa cuatro cosas: tomar una revisión en pares, seguir la propia, unirse a la lectura en grupo y, en Afinación, revisar frases o palabras.
2. «En curso» mezcla lo que le toca a la persona («Le pidieron cambios») con lo que espera a otros («Ahora la revisan otras personas»).
3. «En espera» mezcla lo que no se puede empezar con lo que ya hizo y espera a los demás.
4. Una tarjeta dice «la revisan otras personas» cuando nadie la tomó.
5. Cada tarjeta se lee en tres lugares que a veces se contradicen: el botón, la línea y la barra («0 %» junto a «Todos los pasos están hechos»).
6. Nada dice en qué punto del camino va el trabajo.

## Cómo se llegó aquí

Tres pasadas de subagentes, cada una con una skill especializada: crítica de diseño (`design:design-critique`), textos de interfaz (`design:ux-copy`), y accesibilidad con un recorrido por personas (`design:accessibility-review`). Sus informes están en `tarjetas-pasadas/pasada-{1,2,3}.md`. La tercera fue la más estricta, y donde chocan manda ella, salvo la barra del camino (ver «Decisiones»).

## Enfoques considerados

1. **Solo ordenar** (la decisión B1 del diseño de la Fase 1, `2026-11-23-fase-1-traduccion-design.md`). Pone primero lo que volvió a la persona. No resuelve que lo que espera a otros esté junto a lo que le toca. **Se corrige** con este diseño; su orden se conserva dentro de «Le toca a usted».
2. **Cinco situaciones a la vista** (pasada 1). Cinco cabeceras repiten el cansancio de las nueve de hoy.
3. **Tres secciones a la vista y una plegada con el resto** (pasada 3). **Elegido.**

## Diseño

### Secciones del tablero

| Sección | Qué lleva | Abierta |
|---|---|---|
| **Le toca a usted** | Lo que la persona puede mover ahora; también «Para decidir», primero, con su marca | Sí |
| **Esperan a otras personas** | Lo que la persona ya hizo y espera a alguien | Sí |
| **Para tomar** | Trabajo libre de sus equipos y revisiones a las que puede unirse | Solo si «Le toca a usted» está vacía; si no, plegada con su número |
| **Más** | Lo que todavía no se puede empezar, lo del libro siguiente, lo pausado y lo terminado, cada parte con su subtítulo | Plegada |

- Cada sección abierta muestra como mucho tres tarjetas y después «Ver las demás ({n})».
- El botón lleno sigue siendo uno solo en la pantalla: el de la primera tarjeta de «Le toca a usted». Si esa sección está vacía, el de la primera de «Para tomar».
- El borde azul de la izquierda marca «le toca a usted», no «tiene algo abierto».
- Dentro de «Le toca a usted» va primero lo que volvió a la persona: le pidieron cambios, falta su acuerdo, falta entregar, o le pidieron una corrección. Es el B1 del diseño de la Fase 1.

### La cara de la tarjeta

De arriba abajo:

1. **Fila de marcas** (solo si hay algo que poner): la fase, que ya hace el [PR #54](https://github.com/idiomaspuentes/taller/pull/54), y «nueva», «Corrección pedida» o «Revisar de nuevo».
2. **Título**, como hoy: «Traducir TPL · Esdras 3:1–6».
3. **Barra del camino y la frase «Ahora: {paso} · Sigue: {lo que sigue}»**. Reemplaza la barra de pasos y el porcentaje de hoy. No aparece en las tarjetas de «Más».
4. **Una sola línea** que dice qué pasa, de unos 45 caracteres como mucho. Va en negrita cuando le toca a la persona.
5. **El botón**, con un verbo y un objeto: lleno si es la tarjeta que va primero, enlace «… ›» en las demás. O ningún botón, si no hay nada que hacer.
6. **«Ver detalles»**: una fila de 44 px que despliega lo demás. El menú «…» sigue como hoy.

### La barra del camino

Muestra el tramo de la fase por el que pasa el trabajo, con un segmento por paso. Lo hecho va en verde, lo actual en azul y lo que falta en gris.

- La barra es decoración (`aria-hidden`). Lo que se lee, en pantalla y con lector de pantalla, es la frase «Ahora: Borrador · Sigue: Revisión en pares».
- Los segmentos se miden en `em`, para que crezcan con la letra.

Cómo se arma, para cualquier proceso y sin nombres del FCR en el código:

- **Antes:** la tarea de la tarjeta espera a otras de su misma fase, por una regla `waitsFor` con `taskId` y `scope: "chapter"` (no `before`, no ella misma). Se sigue esa cadena hacia atrás, por la primera regla de cada tarea, y se ponen los pasos de esas tareas, ya hechos.
- **La tarea misma:** sus pasos. Los cerrados van hechos, el siguiente es el actual y los demás faltan.
- **Después:** las tareas de la misma fase que esperan a esta por capítulo, hacia adelante; la primera en el orden del plan. Sus pasos van como faltan.
- **«Sigue»:** el paso que viene después del actual en la barra. Si la barra se acaba, la fase de la primera tarea de otra fase que espera a esta por capítulo; por ejemplo, «Sigue: Afinación». Si no hay ninguna, se omite «Sigue».

Ejemplos en el FCR:

| Tarjeta | Barra | Frase |
|---|---|---|
| Traducir TPL | Estudio ✓, **Borrador**, Revisión en pares, Lectura grupal | Ahora: Borrador · Sigue: Revisión en pares |
| Revisión grupal TPL | Estudio ✓, Borrador ✓, Revisión en pares ✓, **Lectura grupal** | Ahora: Lectura grupal · Sigue: Afinación |
| Traducir Notas | Estudio, **Borrador**, Revisión en pares | Ahora: Borrador · Sigue: Revisión en pares (al final: Sigue: Armonización) |
| Palabras clave TPL | Frases con nota ✓, **Palabras clave**, Alinear | Ahora: Palabras clave · Sigue: Alinear |

Quien revisa el borrador de otra persona ve la misma barra que la autora.

Reglas precisas (decisiones de quien diseña):

- **Qué regla cuenta para la cadena:** una regla de `waitsFor` con `taskId` de otra tarea de la misma fase y `scope: "chapter"`, con `partial` o sin él. No cuentan `before`, `chapter-once`, `unit`, las reglas por `phaseId` ni las de `source`.
- **Si hay varias, o la cadena se bifurca:** se toma la primera regla que cuenta, en el orden en que la tarea las escribe; hacia adelante, la primera tarea en el orden del plan. Si la cadena vuelve a una tarea ya vista, se detiene.
- **Los pasos de antes van siempre como hechos.** La barra dibuja el camino del trabajo, no cuánto llevan otras personas: una lectura en grupo que empezó con 3 de 5 pasajes muestra «Borrador ✓». Lo que falta de los pasajes lo dice la línea de llegada.
- **La barra depende solo del plan y de los pasos cerrados de la propia subtarea**, no de `openIssues` ni de quién mira. «Ahora» es el paso real del trabajo, sea la autora, quien revisa o quien coordina. Si la tarea no se encuentra en el plan, no hay barra ni frase.

### La línea y el botón de cada estado

Situación es la sección del tablero. Las palabras con {marcadores} son de la app. Las de los pasos («Estudiar», «Traducir», los nombres de los pasos) salen del paquete del proceso. Todo trata de «usted»: hoy los textos de las tarjetas tratan de «tú», y este cambio los pasa a «usted».

| # | Hoy | Sección | Línea | Botón |
|---|---|---|---|---|
| 1 | Libre | Para tomar | Libre para su equipo. | {acción del paso} («Estudiar», «Traducir») |
| 2 | Del siguiente libro | Más | Es del libro siguiente. | — |
| 3 | Espera a otro | Más | {waitReason} («Espera al capítulo 1 de «Afinación»») | — |
| 4 | Para empezar | Le toca | Su pasaje está listo para empezar. | {acción del paso} |
| 5 | Estudio en curso | Le toca | Estudie el pasaje antes de traducir. | Seguir con el estudio |
| 6 | Borrador en curso | Le toca | Escriba su traducción del pasaje. | Seguir con mi borrador |
| 7 | Nadie revisa aún | Esperan | Su borrador espera a quien lo revise. | — |
| 8 | Alguien revisa | Esperan | @{who} está revisando su borrador. | Ver la revisión (enlace) |
| 9 | Le pidieron cambios | Le toca | Le pidieron cambios. Abra su borrador. | Corregir mi borrador |
| 10 | Corrigiendo | Le toca | Termine de corregir su borrador. | Seguir corrigiendo |
| 11 | Falta su acuerdo | Le toca | @{who} aprobó su borrador. Falta usted. | Ver la revisión |
| 12 | Todo hecho | Le toca | Todo está hecho. Falta entregar. | Entregar mi trabajo |
| 13 | Terminada | Más | Entregada {fecha}. / Se retiró del plan {fecha}. | — |
| 14 | Revisión libre | Para tomar | @{who} busca quien revise su borrador. | Revisar el borrador de @{who} |
| 15 | Revisando | Le toca | Está revisando el borrador de @{who}. | Seguir revisando |
| 16 | Pidió cambios | Esperan | Espera a que @{who} corrija. | Ver mi revisión (enlace) |
| 17 | Ya corrigió | Le toca | @{who} corrigió. Mírelo otra vez. | Mirar de nuevo el borrador |
| 18 | Aprobó, falta entrega | Esperan | Falta que @{who} lo entregue. | Ver mi revisión (enlace) |
| 19 | Lectura sin pasajes | Más | Empieza cuando llegue el primer pasaje. | — |
| 20 | Lectura libre | Para tomar | El capítulo {n} se lee en grupo. | Unirse a la lectura |
| 21 | Leyendo | Le toca | Llegaron {a} de {b} pasajes. Ya puede leerlos. / Llegó todo el capítulo. | Seguir con la lectura |
| 22 | Ya respondió | Esperan | Faltan las respuestas de {n} personas. | Ver mis respuestas (enlace) |
| 23 | Lectura terminada | Le toca | La lectura terminó. Falta entregar. | Entregar el capítulo |
| D | Para decidir | Le toca (primero) | Su equipo necesita su opinión. | Decidir |

- En otras fases rige el mismo patrón. Un paso que se toma va como en 14. Un paso de grupo (`closing: "consensus"`) va como en 20–23, con «Unirse a…» si es de varios y el verbo del paquete si existe.
- Los botones tienen cuatro palabras como mucho.
- «Seguir revisando» y «Mirar de nuevo el borrador» no repiten el nombre de la persona: ya está en la línea.

### La lectura en grupo: lo que llegó

- **En la cara:** «Llegaron 3 de 5 pasajes. Ya puede leerlos.» (o «Llegó todo el capítulo.»).
- **En «Ver detalles»:**
  - **Ya llegaron:** los pasajes y cuántos versículos son («3:1–6 · 3:7–13 · 4:1–5 (14 de 23 versículos)»).
  - **Faltan:** cada pasaje con quién lo tiene («4:6–12 de @ana»), o «sin tomar».
  - **En la lectura:** quiénes se unieron («@rut, @miguel y 1 persona más»).
  - **Después:** «El capítulo pasa a {fase}.»

Cómo se calcula, con lo que ya está en el tablero:

- Los pasajes de la subtarea de lectura salen de sus `porcion:` (`groupReading.ts` `passagesOf`).
- La tarea de origen es la de la regla `partial` de la tarea de lectura.
- Un pasaje falta si alguna subtarea abierta de la tarea de origen lo cubre (`bucket.openIssues`); si no, llegó.
- Los versículos se cuentan por los rangos.

Hay que calcularlo aparte de `waits.ts`, que deja de dar el bloqueo parcial en cuanto llega el primer pasaje. Si `openIssues` no se conoce, no se muestra la línea de llegada.

### «Ver detalles» en las demás tarjetas

- Los pasos con quién cerró cada uno, lo que hoy despliega la barra.
- A quién espera y desde cuándo, solo si lleva más de tres días.
- Para quién es el trabajo: «Su pasaje irá a la lectura del capítulo 3.» / «Después pasa a {fase}.»

### Al entregar

Un aviso breve en «Mis tareas»: «Entregado. Pasa a la lectura del capítulo {n}.» o «Entregado. Pasa a {fase}.». Así la persona no cree que su tarjeta se perdió. El destino sale de la misma cadena que la barra.

Toda entrega pasa por un solo lugar: `close()` de `MyTasksView.tsx`. Ahí se entrega desde el botón de la tarjeta, y ahí entregará también la revisión cuando el plan de la Fase 1 haga su B3, que vuelve a «Mis tareas» con el encargo de entregar. El aviso sale cuando `close()` termina bien, no antes.

## Decisiones

- **Se corrige B1** del diseño de la Fase 1: reclasificar en secciones, no solo ordenar. Su orden se conserva dentro de «Le toca a usted».
- **La barra del camino se queda, junto con las palabras.** La pasada 3 prefería solo palabras. Se queda la barra porque Abel pidió ver de un vistazo que una lectura en grupo va más adelante que un borrador, y no agrega nada a la tarjeta: reemplaza la barra de pasos de hoy.
- **La vista por capítulo para quien coordina** (todos los pasajes de un capítulo y quién falta) es otra pantalla y va después. «Mis tareas» es personal.
- La fase de la tarjeta es la del PR #54. Este trabajo parte de `main` con ese PR unido; si todavía no lo está, se trae su rama `mis-tareas-fase` a la rama de este trabajo.
- **El plan de la Fase 1 todavía no se construyó.** El 24-11 solo están en `main` su diseño y su plan, sin código. Su Tarea 1.1 (B1) no se hace aparte: este trabajo la reemplaza, con su orden dentro de «Le toca a usted» y sus pruebas, y el plan de la Fase 1 se corrige para decirlo. Su B3 (entregar desde la revisión) queda allá y usa el aviso de este diseño.

## Fuera de alcance

- La pantalla del capítulo para quien coordina.
- Cambiar quién puede tomar o cerrar un paso.
- Cambiar los pasos del proceso.
- Las pantallas de las herramientas.

## Lo que se deja a quien construye

- El nombre de las funciones y dónde viven. Las calculadas van en módulos puros de `src/domain/` con su prueba `scripts/verify-*.mts`.
- Cómo encaja con las entregas del plan de la Fase 1 (`2026-11-24-fase-1-traduccion.md`): la Tarea 1.1 (B1) se reescribe sobre estas secciones, y el aviso al entregar se une con su B3 si ya existe.
- Medir a 375 px y con la letra en 1.3, en español y portugués, con los guiones `audit()` y `tsize()` del relevo de la Fase 1.
