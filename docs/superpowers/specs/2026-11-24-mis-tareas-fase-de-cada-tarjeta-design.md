# «Mis tareas»: de qué fase es cada tarjeta

Diseño corto, 24 de noviembre de 2026.

## Para qué

Una persona que está en dos equipos (por ejemplo Traducción y Afinación) ve en «Mis tareas» todas sus tarjetas mezcladas y no distingue de un vistazo qué clase de trabajo es cada una ni de qué equipo. Lo pidió Abel tras verlo en el equipo.

Hoy la tarjeta solo dice el nombre de la tarea y el pasaje («Palabras clave TPL · Esdras 2»). Los nombres se parecen entre fases («Traducir Palabras», «Palabras clave TPL», «Armonizar Palabras») y el botón dice «Revisar» en las dos. El grupo «Libres para tu equipo» no dice de cuál.

## Enfoques considerados

1. **Etiqueta de fase en cada tarjeta** (elegido por Abel, «como recomiendes»). La lista sigue igual. Cada tarjeta lleva arriba una etiqueta corta con el nombre de su fase y un color propio. Es una sola cosa más que leer, no esconde nada y no cambia cómo se recorre la lista.
2. **Selector «Traducción | Afinación» arriba.** Ordena más, pero suma una decisión y deja tarjetas fuera de la vista sin que la persona lo note. Descartado por eso.
3. **Agrupar por equipo en vez de por lo que hay que hacer.** Rompe el orden actual («En curso», «Para empezar»…), que es lo que lleva de un paso al siguiente. Descartado.

## Diseño

- **La etiqueta:** una píldora pequeña (13 px, negrita) con el nombre de la fase de la tarea, en su idioma (`Phase.names`), en una fila sobre el título. Si la tarjeta es «nueva», esa marca va en la misma fila, a su lado, no en otra píldora encima del título.
- **Solo cuando hace falta:** aparece únicamente si las tarjetas por trabajar son de más de una fase (como el nombre del libro, que aparece cuando hay varios proyectos). No cuentan las terminadas ni las de un proyecto en pausa, que están plegadas al final. Quien trabaja en un solo equipo no ve nada nuevo.
- **Las otras marcas** de la tarjeta («nueva», «corrección pedida», «revisar de nuevo») van en la misma fila que la fase, no dentro del título.
- **Color por el orden de la fase**, no por su id: el código no conoce ninguna fase del FCR. Hay una paleta de cinco pares (fondo claro, texto oscuro, con contraste AA; Taller no tiene modo oscuro) en `tokens.css`, y la fase toma el par de su posición. No se usan el azul (acciones), el ámbar (decidir) ni el rojo (peligro).
- **El texto lo dice todo:** el color ayuda, pero la etiqueta siempre lleva el nombre. No se usa la franja izquierda de la tarjeta, que ya significa «en curso».
- **«Libres para tus equipos»** cuando hay más de una fase.
- **La búsqueda** también encuentra por fase cuando las tarjetas la muestran: escribir «afinación» deja solo esas tarjetas.

## Decisiones mías (revisables)

- **La fase, no el nombre del equipo en Door43.** Los equipos de Door43 tienen nombres técnicos («pm-…») y hay ocho. La fase es como el equipo llama a su trabajo. Dentro de una fase, el título ya distingue TPL de TPS.
- Las tarjetas sin tarea conocida (sin `task`) no llevan etiqueta.

## Fuera de alcance

Filtros, pestañas, cambiar el orden o los grupos de la lista.

## Cómo se comprueba

- Una función pura que diga la fase de cada tarjeta y si el tablero mezcla fases, con su prueba en `scripts/verify-*.mts`: una sola fase sin etiqueta, dos fases con etiqueta, una tarjeta sin tarea, el color según el orden de la fase y la búsqueda por fase.
- `verify:config` para las claves nuevas en `es.json` y `pt.json`, y `verify:decoupling` (ningún id de fase en `src/`).
- En el navegador, a 375 px y en escritorio, con la lista de `docs/FILOSOFIA_DE_DISENO.md`.
