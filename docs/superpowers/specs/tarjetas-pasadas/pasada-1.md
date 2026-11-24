# Pasada 1: tarjetas de «Mis tareas», Fase 1

## Diagnóstico (en corto)

La tarjeta de hoy se lee en tres sitios (botón, línea de estado, barra de pasos) y los tres a veces se contradicen («0 %» junto a «Todos los pasos están hechos»). La captura lo confirma: en la tarjeta de «Traducir TPL» el ojo cae en la barra gris y en «1 de 3 pasos · 0 %», que es lo menos útil, y el único botón lleno no dice qué pasa al tocarlo. La barra mide el avance de *esta tarea*, no el del *trabajo* (pasaje, pares, grupo, siguiente fase). Lo bueno que se conserva: título claro, un solo botón lleno, la etiqueta de fase, el aire entre tarjetas.

Falla de fondo: el tablero agrupa por **dónde está el trabajo** (En curso, En espera…) y la persona se pregunta **«¿me toca a mí?»**. Esa pregunta ya la sabe el código: `action.kind === "none"` frente a lo demás, más `why` (`othersReview`, `othersAnswer`, `assigneeDelivers`, `hold`).

## 1. Cinco situaciones

| Situación | Qué dice a la persona | Es su turno |
|---|---|---|
| **Le toca a usted** | Hay algo que hacer ahora | sí |
| **Espera a otras personas** | Usted ya hizo lo suyo | no |
| **Para tomar** | Nadie lo tiene; usted puede | opcional |
| **Todavía no se puede** | Falta algo antes | no |
| **Terminado** | Entregado o retirado | no |

(«Para decidir» queda dentro de «Le toca a usted», con su marca. «En pausa» sigue plegada al final.)

| Estado # | Situación nueva | Turno |
|---|---|---|
| 4, 5, 6 | Le toca | sí |
| 9, 11, 12 (volvió a mí) | Le toca, arriba | sí |
| 15, 17 (revisión en pares que ya tomé) | Le toca | sí |
| 21, 23 (lectura grupal en la que estoy) | Le toca | sí |
| 7 con revisor sentado, 8, 10, 16, 18, 22 | Espera a otras personas | no |
| **7 sin nadie que la haya tomado** | Espera a otras personas, con otra frase: «Todavía nadie la revisa» (hoy miente) | no |
| 1, 14, 20 | Para tomar | opcional |
| 2 (siguiente libro), 3, 19 | Todavía no se puede | no |
| 13 | Terminado | no |

**¿Cambian los grupos?** Sí: pasar de nueve grupos a cinco, con dos abiertos («Le toca a usted», «Espera a otras personas») y «Para tomar» abierto solo si los otros dos están vacíos. Se quita la mezcla «En curso = mi turno + espero» y «En espera = no puedo + ya respondí».

**¿Contradice «solo ordenarlas» (B1)?** Parcialmente, y debe decirse. B1 tenía razón en que lo urgente es lo que *volvió a mí*, y esa regla de orden se queda dentro de «Le toca a usted». Pero ordenar no arregla que 7, 16 y 18 (esperas) vivan en «En curso» junto a 9 y 11: la persona sigue tocando tarjetas que no puede mover. Es una reclasificación, no cuesta más cómputo (la señal ya existe), y conviene que Abel la apruebe como corrección a B1.

## 2. Anatomía: una cosa que leer, una que hacer

De arriba abajo, a 375 px (8–12 px dentro de la tarjeta):

1. **Fila pequeña:** pastilla de fase (la de la rama) + marcas (nueva, Corrección pedida). Menú «···» a la derecha.
2. **Título** («Traducir TPL · Esdras 3:1–6»), el texto más grande.
3. **Recorrido** (punto 3): una línea de puntos con el paso actual nombrado.
4. **La línea única**, en negrita si es su turno: dice *quién, qué* («Le pidieron cambios: abra su borrador y corrija»; «Espera a @bea, que lo revisa»).
5. **Botón** con verbo concreto y objeto («Corregir mi borrador», «Leer el capítulo con el grupo»). Lleno solo en la tarjeta líder; en las que esperan, sin botón o un enlace «Ver».
6. **«Ver detalles ›»** plegado: lista de pasos con quién cerró cada uno, última actividad, fuentes que cambiaron, cómo se hace el paso.

Se **quita** la barra con porcentaje de la cara de la tarjeta (queda en detalles) y la vista previa de actividad. «Revisar» se sustituye por el verbo de lo que realmente ocurre: tomar, continuar, unirse, responder. Esos textos son del paquete (`actionLabel`), no de `src/`; el caso 4-en-1 se arregla dando al paquete una frase corta por situación, o derivándola del cierre (`consensus` = «Unirse a la lectura»).

## 3. Indicador de recorrido

Se construye sin nombres: el **camino** de una tarjeta es la secuencia de pasos de su tarea, seguida de las tareas que esperan por ella (`waitsFor`, con `partial` y `closing: consensus` marcando «grupo»), seguida de la fase siguiente (`phases[].order`). Cada tramo es un grupo de puntos: pasos propios, la tarea de grupo y la flecha a la próxima fase.

Boceto a 375 px (puntos llenos = hechos, anillo = aquí, vacíos = falta):

```
Borrador de un pasaje        ●──◉──○ │ ○ │ ›Afinación
                              Estudio Borrador Pares  Grupo
Lectura de un capítulo       ●──●──● │ ◉ │ ›Afinación
Pares (revisor)              ●──●──◉ │ ○ │ ›Afinación
```
Debajo de los puntos, una sola frase: «Paso 2 de 4 · Borrador». El grupo se distingue porque es el tramo tras la barra `│` y su punto lleva un icono de varias personas con la palabra («Grupo»), no un color (nada de solo color, ningún icono sin palabra). Solo se escribe el nombre del paso actual; los demás van en detalles. La fase siguiente aparece solo en la última posición («Después: Afinación»).

Para la tarjeta de lectura grupal los pasos del pasaje salen llenos porque ya los pasó el material que llegó; es la señal visible de que «esto va más adelantado que un borrador». Esta línea sustituye la barra de «1 de 3 pasos».

## 4. Información extra, por valor para una persona poco hábil

| # | Dato | Dónde | Calculable hoy | Nota |
|---|---|---|---|---|
| 1 | **A quién espera** («Espera a @bea») | línea única | sí: `assignee`, asientos, `waitReason` | Ya existe para 3 y 19; falta para 7, 16, 18, 22 con nombres |
| 2 | **Llegada del grupo**: «Llegaron 3 de 5 pasajes (versículos 1–11 de 23). Faltan 1:12–16 (@ana) y 1:17–23 (@bea)» | línea única de las lectura grupal (19, 20, 21) | sí, con cuidado: `passagesOf` da los pasajes por `porcion:`; llegó = ningún subtarea abierta de la tarea fuente lo cubre (regla `partial` de `waits.ts`). Hoy `waitBlocks` deja de devolverla en cuanto uno llegó, así que hay que calcular el conjunto de abiertos aparte | Se asume cerrada = entregada; un pasaje retirado cuenta como llegado (riesgo bajo). Versículos salen de los rangos. Con 1 pasaje solo, no se muestra |
| 3 | **Para quién es**: «Su texto pasa al equipo de Afinación» (o «a la lectura del grupo») | línea secundaria en detalles y en el botón de entregar | sí: tarea que depende de esta (`waitsFor` inverso) y `orgTeamName` | Responde a la motivación de servir; no puntos ni comparaciones |
| 4 | **Cuántas personas** en la lectura («2 de 8 se unieron») | detalles | sí: asientos del paso | Útil para la decisión de unirse |
| 5 | **Desde cuándo espera** («hace 4 días») | detalles, y en la línea si pasa de 3 días | sí: `updated_at` | Solo si no es su turno; sin tono de reproche |
| 6 | Versículos agreed en la lectura («18 de 23») | dentro de la herramienta | no en el tablero (`readingProgress` pide leer los textos) | Dejarlo para la herramienta |

**Quitar por ruido:** el porcentaje en la cara, la vista previa de la última actividad, el contador de pasos con barra de segmentos, «nueva» en tarjetas que esperan.

## Orden de entrega sugerido
1. Reclasificar a cinco situaciones y arreglar el 7 (cambia verdades, no solo diseño).
2. Línea única + verbos concretos.
3. Recorrido por puntos.
4. Llegada del grupo y «para quién es».

Riesgos: el paquete debe llevar el texto de cada situación (no hay que escribirlos en `src/`); el cálculo de llegada necesita las subtareas abiertas de la tarea fuente en el mismo capítulo, que el tablero ya recibe en `openIssues`/`sourceIssues`; probar en portugués a 375 px la frase de «llegaron 3 de 5» y la línea de puntos.
