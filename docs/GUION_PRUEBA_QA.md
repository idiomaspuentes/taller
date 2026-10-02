# Guion de prueba en QA

Para recorrer un libro corto en `qa.door43.org` con personas reales y ver qué funciona y qué no. Todo lo que
sigue se probó solo contra el Door43 simulado; aquí se comprueba lo que el simulador no puede demostrar:
permisos, notificaciones y que las pantallas se entiendan sin explicación.

**Libro sugerido:** 3 Juan (1 capítulo, 5 porciones). **Personas:** al menos cuatro, para que la revisión grupal
y el consenso de Afinación tengan con quién. **Nunca producción.**

En cada paso, anota: ¿se entendió sin ayuda?, ¿cuánto tardó?, ¿qué mensaje salió si falló?

## 0. Antes de empezar

| # | Qué | Se espera |
|---|-----|-----------|
| 0.1 | Hay un equipo por fase en la organización de QA, cada uno con sus personas y alguien que coordina | En **Organización** se ven los equipos, los niveles y quién coordina |
| 0.2 | Entrar a Taller con cada cuenta | Cada persona ve «Mis tareas», sin errores |

## 1. Empezar el libro (quien coordina)

| # | Qué | Se espera |
|---|-----|-----------|
| 1.1 | Proyectos → **Empezar un libro** → 3 Juan → FCR → Empezar | Las etapas en pantalla y, al final, «3 Juan está en marcha» |
| 1.2 | Leer el resumen | Traducción «lista para empezar»; las demás fases dicen a cuál esperan |
| 1.3 | Si es el primer libro con el FCR en QA | Avisa de cuántas tareas no tienen equipo y pide uno por fase (o por tarea) |
| 1.4 | Mirar en Door43 el repositorio `taller` | Las subtareas existen como incidencias, con su hito y etiquetas |
| 1.5 | Otro libro con **Ajustar antes de crear** | Abre un borrador: nada en Door43 hasta «Crear proyecto» |
| 1.6 | En el borrador: «Subtareas que se crearán» → añadir una a mano, unir dos porciones | El total cambia; al crear, las incidencias salen así |
| 1.7 | En el proyecto: **Proceso** → añadir o quitar una tarea → Guardar cambios | Antes de guardar dice qué subtareas se cierran o se crean |
| 1.8 | **Subtareas** → tocar una → Asignar a alguien, y Liberar | La incidencia cambia de persona en Door43 |

**Probado en QA el 2 de octubre de 2026** con `abelperez`: 1.1 (3 Juan), 1.5 a 1.8 (2 Juan) y guardar una plantilla.

**Dudoso:** ¿quien coordina sin ser dueño de la organización tiene permiso de escritura en el repositorio `taller`?

## 2. Traducción (dos personas, y el equipo para la grupal)

| # | Qué | Se espera |
|---|-----|-----------|
| 2.1 | A toma «Traducir TPL · 3 Juan 1:1–4»: estudiar, borrador, «Listo para revisión» | Se abre una revisión en Door43 a nombre de A |
| 2.2 | B se suma a «Revisión en pares» y aprueba | B ve **el borrador de A**, no uno propio vacío |
| 2.3 | A aprueba su propia revisión en pares | No da error (Door43 no deja aprobar el PR propio; la app lo deja como comentario) |
| 2.4 | A pulsa **Entregar** | La subtarea se cierra y el texto llega al borrador grupal |
| 2.5 | C abre «Revisión grupal · 3 Juan 1:1–15» | Aparece en cuanto hay una porción entregada: se lee esa, y las demás dicen «Todavía en traducción» |
| 2.5b | C y D dan su acuerdo, uno corrige un versículo, otro deja una duda | El versículo corregido pide mirarlo de nuevo; el de la duda no queda acordado; no se puede cerrar hasta que lleguen todas las porciones |
| 2.6 | Repetir 2.1–2.5 con «Traducir Notas» de la misma porción | Se entrega en el repositorio de **notas**, no en el del texto |

**Dudoso:** 2.3 y 2.5 dependen de respuestas de Door43 que el simulador imita; es lo primero que hay que mirar.

## 3. Afinación (tres personas)

Cerrar antes el resto de Traducción del capítulo (o entregarlo de verdad).

| # | Qué | Se espera |
|---|-----|-----------|
| 3.1 | Tres personas responden «Desafíos de traducción» | Las notas salen **en español**; con las tres de acuerdo aparece «Cerrar la revisión» |
| 3.2 | Alineación: cada quien toma versículos, los termina, y revisa los de los demás | «15 de 15 acordados» con tres personas (el «Terminé» cuenta como acuerdo de quien alineó) |
| 3.3 | Alinear dos palabras separadas con la misma palabra del original, terminar y **recargar** | Sigue marcado como terminado y las cajas no se funden |
| 3.4 | Entregar | Se cierra sin pedir una revisión en Door43 |

## 4. Armonización

| # | Qué | Se espera |
|---|-----|-----------|
| 4.1 | Responder la lista «Notas frente al TPL», varias preguntas seguidas | Las respuestas aparecen al instante; ninguna da error |
| 4.2 | Un «no» con «Pedí el cambio a quien mantiene el texto» | Queda «en consulta», avisa en la conversación y **no deja cerrar** el paso |
| 4.3 | «Corregir la cita» marcando palabras en el TPL | La cita cambia y se guarda en las notas del equipo |
| 4.4 | Acuerdo del equipo y entregar | Se cierra |

**Dudoso:** las respuestas se guardan en una rama nueva (`taller-checks`) del repositorio de contenido. ¿Pueden
crearla quienes no administran?

## 5. Validación

| # | Qué | Se espera |
|---|-----|-----------|
| 5.1 | Dos personas entregan su reporte | Ninguna ve el reporte de la otra antes de entregar el suyo |
| 5.2 | Una tercera anota una **objeción** | La decisión muestra la objeción; con mayoría se puede conceder |
| 5.3 | Conceder el aval | Queda un comentario en la subtarea y el paso se completa |

## 6. Publicación

| # | Qué | Se espera |
|---|-----|-----------|
| 6.1 | Abrir «Comprobaciones» | Si todo pasa, el paso se completa solo |
| 6.2 | Cambiar un versículo después del aval y volver a comprobar | Se detiene: «cambió después del aval» |
| 6.3 | Publicar | Texto, notas y artículos pasan a la rama publicada; el resto del libro no cambia |
| 6.4 | Mirar el repositorio del glosario | Existe `index/3JN.json` |

**Dudoso:** si la rama publicada está protegida, la publicación debe quedar «espera confirmación» con un enlace
a la solicitud, no dar error.

## 7. Glosario

| # | Qué | Se espera |
|---|-----|-----------|
| 7.1 | Desde el editor, «Glosario» → tocar una palabra del inglés → guardar | La primera vez crea el repositorio `<idioma>_tg` |
| 7.2 | Quien coordina la guarda como acordada; otra persona propone un cambio | Aparece en «Por acordar»; al aceptarla cambia la decisión |
| 7.3 | «Cambios recientes» con otra cuenta | Muestra lo nuevo desde su última visita |

**Dudoso:** crear un repositorio en la organización pide permiso de administración.

## 8. El libro siguiente

| # | Qué | Se espera |
|---|-----|-----------|
| 8.1 | Entregar hasta pasar el 70 % de Traducción | A quien coordina le llega un aviso (en «Avisos» y en el teléfono) |
| 8.2 | Empezar otro libro corto (2 Juan) | Hereda los equipos de 3 Juan, sin preguntar |
| 8.3 | «Mis tareas» de alguien de Traducción | 3 Juan arriba; 2 Juan en «Del siguiente libro» hasta terminar 3 Juan |

## Lo que conviene mirar con más cuidado

1. Los cuatro puntos marcados **Dudoso**: son permisos de Door43, y el simulador no los imita.
2. Las notificaciones con la app cerrada.
3. Si «Mis tareas» se entiende con dos libros abiertos.
4. Si alguien que no creó nunca un proyecto puede hacer el paso 1 sin ayuda.
