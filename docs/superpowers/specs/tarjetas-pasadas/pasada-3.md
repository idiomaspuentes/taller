# Pasada 3: Doña Rut y Miguel (Fase 1)

Medidas reales: tarjeta con 20 px de relleno lateral, título 1rem/700, estado 0.9375rem (casi igual que el título: la jerarquía por tamaño es débil), botón 48 px, enlace 44 px. Todo en rem, así que crece con el texto. A 375 px quedan unos 300 px de texto útil; con letra a 1.3 son ~28 caracteres por renglón. Una «línea única» de 58 caracteres ocupa 2–3 renglones; la regla de «una línea» no existe en su teléfono.

## 1. Cinco momentos

**(a) Abrir «Mis tareas».** Ve «Le toca a usted» con 3 tarjetas (borrador devuelto, pasaje libre, ¿pares?) y la lectura del capítulo 3. Problema: el pasaje libre (Para tomar) y la revisión de pares (Para tomar) quedan en «Para tomar», plegada porque «Le toca» no está vacío: bien. Pero la lectura grupal con 3 de 5 llegados, ¿está en «Le toca» (#21)? Sí, y compite con el borrador devuelto: dos botones «lo que toca». Solo el primero va lleno; ella toca el azul (borrador devuelto), correcto. Dónde se pierde: cada tarjeta trae pastilla de fase + marcas + título + puntos + «Ahora/Sigue» + línea + botón + «Ver detalles» = 7 elementos; con letra grande una tarjeta mide casi una pantalla, y la lista de tres pide desplazar sin saber que hay más. Riesgo mayor: la llegada «Llegaron 3 de 5 pasajes (14 de 23 versículos) · Faltan…» en una tarjeta que dice «Lea el capítulo con el grupo»: ella lee números cuando solo debe tocar. La pregunta «¿puedo leer ya, si faltan pasajes?» queda sin responder.

**(b) Tras entregar.** La tarjeta pasa a «Esperan a otras personas» o «Terminado». Falta un cierre: el tablero debe decir una vez «Entregado: pasa a la lectura del capítulo 3», porque la tarjeta desaparece de «Le toca» y ella puede creer que se perdió. «Para quién» solo en detalles no sirve aquí: ahí es donde se necesita, en la línea.

**(c) Ya respondió la lectura.** «Esperan…»: «Ya respondió todo. Faltan las respuestas de 2 personas.» Bien, sin botón lleno, enlace «Ver mis respuestas». Peligro: dos enlaces «Ver…» en tarjetas distintas que no se distinguen; el enlace debe llevar el objeto («Ver mis respuestas del capítulo 3»). Que Doña Rut vea esta sección abierta junto a «Le toca» duplica la pantalla; con una sola persona esperada, basta una línea.

**(d) No puede empezar.** «Todavía no se puede», plegada. Bien que esté plegada. Si la toca por curiosidad: «Empieza cuando llegue el primer pasaje del capítulo 3» sin botón. Correcto; pero la tarjeta lleva puntos y «Ahora: … Sigue:…» de algo que no empezó: ruido. Ahí basta título + una línea.

**(e) Miguel, capítulo 3.** El tablero es personal: Miguel ve «sus» tarjetas. Para saber cómo va el capítulo 3 tiene que abrir la tarjeta de lectura y leer «Llegaron 3 de 5 · Faltan de @ana, @bea». Es lo mejor de la propuesta para él, pero solo aparece si él tiene esa tarjeta; si no la tiene no ve nada. Lo que Miguel necesita es una vista por capítulo (otra pantalla); no cargarla en la tarjeta de Doña Rut.

## 2. Contra la lista de FILOSOFIA y accesibilidad

- Controles a la vista: tarjeta con botón, «Ver detalles», «···», más la pastilla (si es botón) = 3–4 por tarjeta; con 4 tarjetas abiertas pasa de 12. Con cinco secciones, las cabeceras también cuentan. Límite: máximo 3 tarjetas abiertas por sección o «Ver las demás».
- Botón lleno: uno. Cuidado con «Entregar», que para quien ya terminó es lo único útil y debe ser el líder.
- Toques de 44 px: «Ver detalles ›» como enlace de texto de 16 px mide menos; debe ser fila de 44. Los puntos del recorrido no deben ser tocables.
- Tamaño de texto: pasar a rem y `--ts`; los puntos deben medirse en `em`, no px, o con letra grande se ven diminutos junto al texto.
- Solo color: pastilla de fase lleva su palabra (bien). Puntos: hecho/aquí/falta distinguidos por relleno/anillo/vacío: forma sí, pero un anillo vs un punto lleno de 8 px no lo ve nadie con baja visión; el recorrido en palabras («Ahora/Sigue») es la señal real. Los puntos son decoración: `aria-hidden`.
- Lector de pantalla: la plantilla «Recorrido: Estudio, hecho; Borrador, ahora…» es larga y se repite en cada tarjeta. Mejor un texto corto en el título accesible: «Ahora Borrador; sigue Revisión en pares». Tampoco debe anunciarse junto a la pastilla de fase dos veces.
- Contraste: la regla 7:1 del documento; el estado en `--text-muted` a 0.9375rem es lo que lee ella: llevarlo a texto normal cuando es «su turno» (ya se propone negrita).
- Portugués: «Aguardam outras pessoas» y «Ainda não é possível» entran en cabeceras; medir.
- Idioma de la tarjeta: `border-left` 4 px azul de «doing» hoy marca «en curso»; con la nueva clasificación debe marcar «le toca», no «tiene algo abierto».

## 3. Veredicto por elemento

| Elemento | Veredicto | Razón / cómo |
|---|---|---|
| Cinco situaciones | **CAMBIAR**: tres visibles | «Le toca a usted», «Esperan a otras personas», «Para tomar»; «Todavía no», «Terminado» y «En pausa» van juntas en una sola sección plegada («Más»). Cinco cabeceras repiten la fatiga de nueve. La reclasificación en sí se mantiene (arregla 7, 16, 18, 22). |
| «Para tomar» abierta solo si las otras están vacías | MANTENER | Una sola cosa obvia. Pero poner su conteo en la cabecera plegada («Para tomar 2») para que no se oculte. |
| Línea de recorrido (puntos + Ahora/Sigue) | **CAMBIAR** | Una sola de las dos formas: solo la frase «Ahora: Borrador · Sigue: Pares» con puntos pequeños `aria-hidden`; o solo puntos con palabra del paso actual. Recomiendo la frase, sin puntos. Se omite en «Todavía no» y «Terminado». |
| Duplicación con pastilla de fase | **CAMBIAR** | La pastilla se queda (viene de la rama, solo si hay 2+ fases); «Sigue: Afinación» al final del recorrido se quita. La fase siguiente solo en la tarjeta que cierra la fase. |
| Línea única + botón con verbo y objeto | MANTENER | Es lo que más ayuda. Recortar a ≤ 45 caracteres; el nombre del botón no repite lo que dice la línea. |
| Línea de llegada del grupo | **CAMBIAR** | Una sola frase: «Llegaron 3 de 5 pasajes». Los versículos y «Faltan 1:12–16 de @ana y @bea» pasan a «Ver detalles»; si faltan ≤ 2, «Faltan 2 pasajes: de @ana y @bea». Tampoco nombres de usuarios largos. |
| «Ver detalles ›» | MANTENER, **CAMBIAR** | Una fila de 44 px, con palabra («Ver detalles») y el resultado (pasos, personas, desde cuándo). Es la capa correcta para «Para quién», «Se unieron k», «Hace 4 días». |
| «Después: {fase}» | **QUITAR** de la cara | Está en «Sigue» o en detalles; sin ello dos veces. Excepción: línea tras «Entregar» («Pasa a Afinación»), que sí tranquiliza por propósito. |
| Quitar la barra de % | MANTENER | Era contradictoria (0 % con «todos hechos»). Pero «Entregada…» en Terminado y los pasos con quién los cerró deben estar en detalles. |
| Verbos concretos | MANTENER | Con una regla: texto del botón ≤ 4 palabras («Unirse a la lectura»). «Dar mi conformidad» solo si la pantalla trae esa acción. |
| Desde cuándo espera | MANTENER en detalles, quitar de la línea | Evita presión. |
| «Cuántas se unieron k de max» | **QUITAR** | Asusta (dice la pasada 2). Solo «para empezar bastan 2». |

## 4. Los cinco cambios que más importan

1. **Tres secciones a la vista** (Le toca / Esperan / Para tomar) y una sola plegada con lo demás; máximo tres tarjetas abiertas por sección.
2. **Una sola señal de etapa**: la frase «Ahora · Sigue» y quitar los puntos de la cara (o ponerlos `aria-hidden` y de `em`); nada de «Después: fase» ni segunda mención de fase.
3. **Cara de la tarjeta = título + línea de ≤ 45 caracteres + botón.** Todo lo demás (llegada detallada, quién falta, personas, días, para quién) a «Ver detalles» con fila de 44 px.
4. **Línea de llegada corta** («Llegaron 3 de 5 pasajes») que además diga si se puede leer ya; los versículos y nombres, en detalles.
5. **Texto y medidas**: todo en rem/em para `--ts`, prueba a 375 px y letra 1.3 en es y pt, estado a texto de contraste normal, el borde azul solo en «Le toca», y confirmar a Doña Rut tras entregar («Entregado: pasa a la lectura del capítulo 3»).

## 5. Para decidir (máx. 3)

1. ¿Se aprueba corregir B1 («solo ordenar»): reclasificar en Le toca / Esperan? **Recomendado: sí**, es lo único que arregla que Doña Rut toque tarjetas que no puede mover.
2. ¿Los puntos del recorrido se quedan o se dejan solo las palabras «Ahora · Sigue»? **Recomendado: solo palabras**; los puntos suman un elemento y casi no se distinguen a 8 px.
3. ¿Miguel necesita una vista del capítulo (todos los pasajes y quién falta) aparte de «Mis tareas»? **Recomendado: sí, pero como pantalla propia después**; la tarjeta personal solo lleva «Llegaron 3 de 5».
