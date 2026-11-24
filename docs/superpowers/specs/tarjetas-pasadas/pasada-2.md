# Pasada 2: palabras de las tarjetas (Fase 1)

Regla de origen: **[P]** = del paquete `fcr.json` (`actionLabel`: «Estudiar», «Traducir», «Revisar»; nombres de paso: Estudio, Borrador, Revisión en pares, Lectura grupal; nombres de fase). **[A]** = palabra genérica de la app, con {marcadores}. El paquete hoy solo da un «Revisar» para pares y lectura; propongo que la app lo complete con objeto y que «Unirse a la lectura» salga de `closing: consensus` ([A]), sin tocar `src/` con nombres de FCR.
Nota: las claves `tb.*` de hoy tratan de «tú» («Te pidieron…»); abajo todo va de «usted», como manda el producto.

## 1. Las cinco situaciones (títulos de sección)

| es | pt | Abierta |
|---|---|---|
| Le toca a usted | É a sua vez | sí |
| Esperan a otras personas | Aguardam outras pessoas | sí |
| Para tomar | Para assumir | solo si las dos anteriores están vacías |
| Todavía no se puede | Ainda não é possível | plegada |
| Terminado | Concluído | plegada |

«En pausa» sigue plegada; «Para decidir» entra en «Le toca a usted» con la marca «decidir».

## 2. Los 23 estados: una línea y un botón

Línea en negrita solo si es su turno. Botón lleno solo en la tarjeta líder; en las demás, enlace.

| # | Situación | Línea única | Botón |
|---|---|---|---|
| 1 | Para tomar | Libre para su equipo. | «{P} este pasaje» (Estudiar / Traducir) |
| 2 | Todavía no | Es del libro siguiente. Llegará a su turno. | ninguno |
| 3 | Todavía no | {waitReason}: «Espera al capítulo 1 de Afinación» / «Espera a «Traducir TPL» de @ana» | ninguno |
| 4 | Le toca | Su pasaje está listo para empezar. | «{P} este pasaje» |
| 5 | Le toca | Estudie antes de traducir. | «Seguir con el estudio» [A] |
| 6 | Le toca | Escriba su traducción de este pasaje. | «Seguir con mi borrador» [A] |
| 7a | Espera | @{who} está revisando su borrador. | ninguno |
| 7b | Espera | Su borrador espera a quien lo revise. Le avisaremos. | ninguno (hoy decía una mentira) |
| 8 | Espera | @{who} está revisando su borrador. | «Ver la revisión de @{who}» |
| 9 | Le toca | Le pidieron cambios. Abra su borrador y corrija. | «Corregir mi borrador» |
| 10 | Le toca | Está corrigiendo su borrador. Termínelo otra vez. | «Seguir corrigiendo» |
| 11 | Le toca | @{who} aprobó su borrador. Falta su conformidad. | «Dar mi conformidad» (flag: ver §6) |
| 12 | Le toca | Todo está hecho. Falta entregar. | «Entregar mi trabajo» + debajo «Pasa a {destino}.» |
| 13 | Terminado | Entregada el {fecha}. / Se retiró del plan el {fecha}. | ninguno |
| 14 | Para tomar | @{who} terminó su borrador y busca quien lo revise. | «Revisar el borrador de @{who}» |
| 15 | Le toca | Está revisando el borrador de @{who}. | «Seguir revisando» |
| 16 | Espera | Pidió cambios. Espera a que @{who} corrija. | «Ver mi revisión» (enlace) |
| 17 | Le toca | @{who} corrigió su borrador. Mírelo otra vez. | «Mirar de nuevo el borrador» |
| 18 | Espera | Su revisión está lista. Falta que @{who} entregue. | «Ver mi revisión» (enlace) |
| 19 | Todavía no | Empieza cuando llegue el primer pasaje del capítulo {n}. | ninguno |
| 20 | Para tomar | El capítulo {n} se lee en grupo. Se unieron {k} de {max}. | «Unirse a la lectura del capítulo {n}» |
| 21 | Le toca | Lea el capítulo {n} con el grupo. | «Seguir con la lectura del capítulo {n}» |
| 22 | Espera | Ya respondió todo. Faltan las respuestas de {n} personas. | «Ver mis respuestas» (enlace) |
| 23 | Le toca | La lectura terminó. Falta entregar el capítulo. | «Entregar el capítulo {n}» + «Pasa a {destino}.» |

Cuatro «Revisar» resueltos: tomar un par = «Revisar el borrador de @{who}»; continuar = «Seguir revisando»; revisar otra vez = «Mirar de nuevo el borrador»; grupo = «Unirse a la lectura…» / «Seguir con la lectura…». En Afinación el mismo patrón: «Revisar las frases de {x}» (objeto del paso, [A]).

## 3. Recorrido

Una línea visible, en palabras, bajo el título: **«Ahora: {paso} · Sigue: {paso siguiente}»** (nombres [P]; el tramo de grupo usa la palabra [A] «en grupo» si el paso es `consensus`). Los puntos son solo apoyo visual.

| Tarjeta | Etapa | Ejemplo |
|---|---|---|
| A (TPL) | Estudio | Ahora: Estudio · Sigue: Borrador |
| A | Borrador | Ahora: Borrador · Sigue: Revisión en pares |
| A | Pares (autor) | Ahora: Revisión en pares · Sigue: Lectura en grupo |
| B (Palabras) | Borrador | Ahora: Borrador · Sigue: Revisión en pares |
| Revisor de pares | | Ahora: usted revisa · Sigue: Lectura en grupo |
| C (Grupo) | Lectura | Ahora: Lectura en grupo · Sigue: Afinación |
| Cualquiera entregada | | Entregada · Sigue: Afinación |

Texto accesible (`aria-label`): «Recorrido de este trabajo: Estudio, hecho. Borrador, ahora. Revisión en pares, falta. Lectura en grupo, falta. Después, Afinación.» Plantilla: «Recorrido: {paso}, {hecho|ahora|falta}…; después, {fase}».

## 4. Información extra (con {marcadores} y ejemplo en Esdras)

| Dato | es | Ejemplo |
|---|---|---|
| Llegada | Llegaron {a} de {b} pasajes ({vv} de {vt} versículos). | Llegaron 3 de 5 pasajes (14 de 23 versículos). |
| Faltan (≤2) | Faltan {rangos}, de @{who}. | Faltan 1:12–16 de @ana y 1:17–23 de @bea. |
| Faltan (>2) | Faltan {n} pasajes. Toque para ver cuáles. | Faltan 3 pasajes. Toque para ver cuáles. |
| Todo llegó | Llegó todo el capítulo ({vt} versículos). | Llegó todo el capítulo (23 versículos). |
| Espera a | La lectura espera a @{who}. | La lectura espera a @ana. |
| Para quién | Después pasa a {destino}. / Su pasaje irá a la lectura del capítulo {n}. | Su pasaje irá a la lectura del capítulo 3. |
| Personas | Se unieron {k} de {max}; para empezar bastan {min}. | Se unieron 2 de 8; para empezar bastan 2. |
| Desde cuándo (solo si espera y pasó de 3 días) | Espera desde hace {n} días. | Espera desde hace 4 días. |

Para la tarjeta de grupo: línea única + «Llegada» + «Faltan» (máximo dos renglones secundarios, el resto en «Ver detalles»). «Para quién» siempre va en detalles y bajo el botón de entregar.

## 5. Líneas de más de ~60 caracteres a 375 px

- #20 completa (~58, al límite; en pt pasa): partir en línea + «Se unieron 2 de 8» en detalles.
- #12/#23 con «Pasa a Afinación»: dos renglones; aceptable.
- #11, #14, #18, #22: 50–60 con nombre largo de usuario; pueden envolver. Medir en pt.
- «Mirar de nuevo el borrador de @{who}» pasaría de 35 en botón: se deja sin nombre.
- «Faltan 1:12–16 de @ana y 1:17–23 de @bea» (~42) sin problema; con nombres de 15 letras, ~55.

## 6. Ideas de la pasada 1 cuyas palabras no funcionan

1. **«Paso 2 de 4»**: mezcla pasos de esta tarea con otra tarea (la lectura) y con una fase. Para B serían 3, para C «4 de 4» sin haber hecho nada. Reemplazado por «Ahora… Sigue…».
2. **Etiqueta «Grupo» solo con icono/color**: sin palabra no vale (regla del teléfono); por eso «Lectura en grupo» escrita.
3. **«Todavía nadie la revisa»** en 7b se mezcla con el grupo «Esperan a otras personas», que promete que alguien trabaja. Aceptable solo porque la línea lo dice; alternativa: ponerla en «Para tomar» desde el punto de vista del revisor y dejar a la autora con «Espera a quien lo revise».
4. **«Dar mi conformidad»** (#11) nombra una acción que hoy lleva a «Ver la revisión»; solo sirve si esa pantalla trae un botón de acuerdo. Si no, «Ver la aprobación de @{who}».
5. **Mi lectura de #10** (autora corrigiendo) es suposición: el brief no dice si es de la autora o de quien espera.
6. **Cuenta de verdad en #20**: «se unieron k de max» asusta si max=8 (parece que faltan 6); mejor mostrar solo el mínimo.
7. Con la etiqueta de fase y el recorrido, «Después: Afinación» aparece dos veces; mostrar la fase en el recorrido y quitar la pastilla cuando el recorrido ya la nombra, o a la inversa.
8. Los textos de «Para quién» («equipo de Afinación») dependen de `orgTeamName`; si el equipo no se llama así, caer a «la fase {fase}».
