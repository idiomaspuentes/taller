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
   - **Partir un capítulo largo** en tramos que avanzan por separado (`settings.handoffUnits`).
   - **Añadir una subtarea a mano** a cualquier tarea (`settings.extraWork`), sobre una porción o sobre el libro en
     general. Sigue al equipo y los pasos de su tarea. Una tarea de *trabajo general* solo tiene de estas.

«Crear proyecto» (`createProject` en `src/dcs/startBook.ts`) coloca los equipos, guarda el proyecto y escribe las
subtareas. `startBook` (el camino sencillo) encadena `draftBook` → `readBook` → `createProject`.

## Un proyecto en marcha

Pestañas: **Avance · Proceso · Subtareas · Versiones**, y bajo «Más»: lectura del libro, asignar personas por nombre
y escribir de nuevo todas las subtareas.

- **Proceso** (`ProjectPlanView`): el editor sobre una copia. La barra de «Cambios sin guardar» dice qué tareas se
  quitan y cuántas subtareas se cierran, qué tareas cambian de pasos, y si se crearán o cerrarán subtareas. Al
  guardar (`saveProjectChanges`), quien ya tomó una subtarea la conserva.
- **Subtareas** (`ProjectWorkView`): lo mismo que la vista previa, con el estado de cada una en Door43 (libre, de
  quién, hecha, por crear). Aquí se añade una a mano o se parte un capítulo.
- «Limitar a una parte del libro o a personas concretas» (en «Más ajustes» de una tarea) abre el editor antiguo de
  esa tarea (`TeamsView`), que conserva lo que el editor nuevo no cubre.

## Plantillas (`TemplatesView`)

Tarjetas de las plantillas de la organización y de las incluidas en la aplicación. Las incluidas se leen y se copian
para cambiarlas. Guardar sube la versión; un proyecto creado con una versión anterior ofrece «Traer lo nuevo».

## Pruebas

`verify:plan` (operaciones del editor), `verify:extra-work` (cortes de porciones y subtareas a mano),
`verify:start-book`, `verify:templates`, `verify:publish-sync`. En el navegador: recorrido completo contra el Door43
simulado (borrador → unir porciones → subtarea a mano → crear → cambiar el proceso → añadir subtarea).
