# Proyectos y plantillas: cómo se crean y se cambian

Qué pantalla hace qué, y dónde está cada cosa en el código. Rediseñado el 2 de octubre de 2026.

## La idea

Una **plantilla**, un **proyecto que todavía no existe** y un **proyecto en marcha** llevan lo mismo: fases, tareas
de cada fase, pasos de cada tarea, a qué espera cada tarea y quién la hace. Por eso se editan con **un solo editor**
(`PlanEditor`). Lo único que cambia es qué pasa al terminar:

| Dónde | Con qué empieza | Qué hace el botón final |
|---|---|---|
| Proyectos → Empezar un libro → **Empezar** | La plantilla | Crea el proyecto de una vez (camino sencillo) |
| … → **Ajustar antes de crear** | La plantilla | Abre un **borrador**; nada se escribe hasta «Crear proyecto» |
| … → **Sin plantilla** → Armar el proyecto | Vacío | Lo mismo, armando el proceso a mano |
| Plantillas → una plantilla o «Nueva» | La plantilla, o vacío | Guardar plantilla |
| Un proyecto → **Proceso** | El proyecto | Guardar cambios (dice antes a qué trabajo afecta) |

Desde un borrador o desde un proyecto se puede «Guardar como plantilla».

## El editor (`PlanEditor`)

- A la izquierda, el **esquema**: fases → tareas → pasos, con «+ Fase», «+ Tarea», «+ Paso» en su sitio. En el
  teléfono el esquema es la primera pantalla y el detalle se abre encima.
- A la derecha, el **detalle** de lo elegido:
  - **Fase**: nombre, orden, equipo que la hace (vale para todas sus tareas).
  - **Tarea**: nombre, qué se trabaja (recursos, o ninguno: *trabajo general*), cómo se divide el libro (por porción o
    por capítulo), equipo propio si no es el de la fase, a qué espera, pasos. En «Más ajustes»: fase, nivel mínimo,
    recorrer cada unidad, herramienta, descripción.
  - **Paso**: nombre, **quién lo hace**, cuándo se completa, con qué herramienta, preguntas. En «Más ajustes»: qué
    abarca, texto del botón, descripción.
- **Quién lo hace** se dice en tres formas (quien tiene la subtarea, una persona del equipo, varias personas), con
  cuántas, quién no puede tomarlo, y se lee de vuelta como una frase. Son los mismos ajustes del motor
  (`claimMode`, `minAssignees`, `excludePriorStepIds`…); cambió cómo se preguntan.
- Los equipos se listan con los que **ya pueden editar** lo que la tarea escribe primero.

Las operaciones son funciones puras en `src/domain/plan.ts` (`verify:plan`).

## El borrador (`DraftProjectView`, `#/proyectos/nuevo`)

Se guarda en el dispositivo (`src/domain/draftProject.ts`); en «Proyectos» aparece como «Borrador sin crear». Tiene
dos pantallas:

1. **Proceso**: el editor, sobre el borrador.
2. **Subtareas que se crearán** (`WorkPreview`): lee el libro y muestra, fase por fase y tarea por tarea, cada
   subtarea que se va a escribir. Desde ahí:
   - **Cambiar las porciones**: unir dos o partir una en dos (`settings.portionStarts`). El lector del libro corta
     donde el proyecto dice y cuenta qué cae en cada porción. Solo antes de crear: las subtareas se escriben sobre
     esas porciones.
   - **Partir un capítulo largo** en tramos que avanzan por separado (`settings.handoffUnits`). No es un botón
     fijo: la app lo **sugiere** cuando un capítulo pasa de un máximo de versículos (`maxChapterVerses`, 40 si nadie
     dice otra cosa), con los cortes ya propuestos en tramos parejos. El máximo lo dice la plantilla y se puede
     cambiar en el proyecto, ahí mismo.
   - **Añadir una subtarea a mano** a cualquier tarea (`settings.extraWork`), sobre una porción o sobre el libro en
     general. Sigue al equipo y los pasos de su tarea. Una tarea de *trabajo general* solo tiene de estas.

«Crear proyecto» (`createProject` en `src/dcs/startBook.ts`) coloca los equipos, guarda el proyecto y escribe las
subtareas. `startBook` (el camino sencillo) encadena `draftBook` → `readBook` → `createProject`.

## Un proyecto en marcha

Pestañas: **Avance · Proceso · Subtareas · Versiones**. Un proyecto de varios libros tiene además, bajo «Más», la
pantalla donde se lee cada libro.

- **Proceso** (`ProjectPlanView`): el editor sobre una copia. La barra de «Cambios sin guardar» dice qué tareas se
  quitan y cuántas subtareas se cierran, qué tareas cambian de pasos, y si se crearán o cerrarán subtareas. Al
  guardar (`saveProjectChanges`), quien ya tomó una subtarea la conserva. En «Más ajustes» de una tarea: limitarla a
  algunos capítulos o porciones, y marcar que revisa texto ya entregado.
- **Subtareas** (`ProjectWorkView`): lo mismo que la vista previa, con el estado de cada una en Door43 (libre, de
  quién, hecha, por crear). Tocar una subtarea permite dársela a alguien del equipo de su tarea, o liberarla. Aquí
  también se añade una a mano, se parte un capítulo y se vuelve a leer el libro. Si después de leerlo el plan llama
  de otra forma a una subtarea que ya existe (la fuente cambió el título de un artículo), la pantalla lo dice y
  ofrece «Actualizar los nombres».

Cuando el plan vuelve a escribir una subtarea que ya existe (al guardar un cambio del proceso, al crear las que
faltan, al actualizar los nombres) cambia su nombre y su descripción, y nada más: quien la tiene, los pasos hechos,
quién tomó cada paso y la revisión a la que está unida quedan como estaban (`refreshedIssueBody`).

No queda ningún editor antiguo: las pantallas de «Fases y tareas» por pasos, «Asignar personas» y «Crear subtareas»
se retiraron el 2 de octubre de 2026 (sus direcciones llevan a «Subtareas»).

## Plantillas (`TemplatesView`)

Tarjetas de las plantillas de la organización y de las incluidas en la aplicación. Las incluidas se leen y se copian
para cambiarlas. Guardar sube la versión; un proyecto creado con una versión anterior ofrece «Traer lo nuevo».

## Recorrido de prueba

Para probar **cada paso** de un proceso en un servidor de pruebas, con una sola persona y en el teléfono. En
«Empezar un libro», fuera de producción (`isProductionHost`), cada proceso incluido trae al final su «Recorrido de
prueba · …». Pide un libro y **un capítulo**.

- Se hace con un libro que **ya está hecho**: así cada paso tiene sobre qué trabajar (texto que alinear, notas que
  afinar, un capítulo que validar). En QA, `es-419_gl` tiene completos Tito, Judas, Jonás, Rut y 3 Juan.
- Es el mismo proceso (`walkthroughOf`, `src/domain/walkthrough.ts`): sus fases, tareas, pasos y herramientas. Se
  deriva cada vez, no se escribe a mano. Cambia dos cosas: **ninguna tarea espera a otra**, y un paso que toman
  varias personas tiene **un solo asiento** (`minAssignees: 1`, `minIndependent: 0`, sin excluir a quien hizo el
  paso anterior).
- Todas las tareas se limitan al capítulo elegido (`limitedToChapters`), y heredan los equipos del último libro
  hecho con el proceso (`processOf`).
- **La revisión en pares sigue pidiendo a otra persona**: Door43 no deja aprobar la propia solicitud. Para esos
  pasos hace falta una segunda cuenta.
- Lo que el recorrido no prueba son las esperas y los acuerdos entre varias personas: los quita.
- El paso «Publicar» escribe en la rama publicada del servidor de pruebas.

Un proyecto de recorrido no ofrece «Traer lo nuevo»: no es una plantilla guardada. `npm run verify:walkthrough`.

## Pruebas

`verify:plan` (operaciones del editor), `verify:extra-work` (cortes de porciones y subtareas a mano),
`verify:start-book`, `verify:templates`, `verify:publish-sync`. En el navegador: recorrido completo contra el Door43
simulado (borrador → unir porciones → subtarea a mano → crear → cambiar el proceso → añadir subtarea).
