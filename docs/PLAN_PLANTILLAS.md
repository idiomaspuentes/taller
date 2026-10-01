# Plantillas y creación de proyectos: revisión y plan

Revisión del 1 de octubre de 2026, hecha leyendo el código. Todavía **no hay cambios**: esto es el
diagnóstico y lo que propongo hacer, por fases.

La meta: que Taller sirva de verdad para el FCR **y** para otros procesos en el futuro, sin que la
app tenga que «saber» cómo se llama cada paso del FCR.

---

## 1. Cómo funciona hoy

```text
Plantilla (org)            workflows.json · WorkflowTemplate
  └─ Fases → Tareas → Pasos (nombre, herramienta, quién lo toma, espera a…, nivel)

Proyecto                   assignments.json · AssignmentsDoc
  └─ COPIA de la plantilla (fases + tareas), sin versión
        └─ Subtareas       issues de Door43 (una por porción × tarea)
              └─ Progreso de pasos en el cuerpo del issue (por id de paso)
```

Para crear un proyecto hoy, quien coordina:

1. **Proyectos → Nuevo**: elige libro (o «temático» + libros) y escribe el **nombre de la primera fase**
   (`ProjectsView.tsx:263`).
2. Entra al proyecto en **Preparar → Libro** (inventario).
3. Va a **Preparar → Tareas**, elige una plantilla y la **aplica** (`TeamsView.tsx:715`). Eso
   **reemplaza** todas las fases y tareas (`workflows.ts:11`), incluida la «primera fase» del paso 1.
4. **Repartir → Asignar**, **Entregar** (crea los issues), **Avance**, **Publicar**.

La plantilla del FCR está escrita como código (`domain/fcrTemplate.ts`), y se copia al catálogo con
«Crear desde FCR» (`WorkflowsView.tsx:203`).

## 2. Lo que encontré

### A. El motor ya es bastante genérico… en los pasos
Lo bueno: **los pasos son datos**. Quién toma un paso (`claimMode` none / exclusive / pool, mínimos,
exclusiones), qué espera a qué (`waitsFor`), el nivel mínimo y la herramienta salen de la plantilla.
Por eso «Mis tareas» puede funcionar con cualquier proceso, y esa es la base que hay que conservar.

### B. Pero la *unidad de trabajo* es fija: la Biblia y las seis ayudas del FCR
- Los recursos son una lista cerrada: `ScopeKey = "notas" | "preguntas" | "academia" | "palabras" | "tpl" | "tps"`
  (`types.ts:31-33`).
- El inventario tiene un campo por recurso (`Portion.tplItems`, `notasItems`, … en `types.ts:65-87`)
  y sale de los repos de unfoldingWord.
- Las subtareas siempre son «porción × tarea» de un libro de la Biblia (`workOrder.ts`).
- `ProjectTask` lleva campos que solo tienen sentido en el FCR: `reviewsPrincipal`, `reviewRef`,
  `reviewAssigneeId` (`types.ts:241-254`).

Otro proceso (por ejemplo, revisar un curso, grabar audio o traducir un manual) **no tiene dónde
entrar**: no tiene porciones ni TPL.

### C. Hay palabras del FCR dentro del motor
- Textos en español escritos dentro del modelo (`GRAIN_LABEL`, `articleFilterHelp`,
  `scriptureIntro`… en `types.ts:543-860`; el cuerpo del issue en `workOrder.ts:555`).
- Herramientas del FCR que la app vuelve a agregar a mano si faltan (`issues.ts:296-300`
  `fcr-pair-review`, `fcr-group-review`, `fcr-familiarize`).
- Los niveles (oyente, aprendiz, practicante, habilitada) vienen de la rúbrica del FCR y son fijos
  (`levels.ts:7`).
- Etiquetas de la interfaz que suponen el FCR, como «Revisiones que puedes tomar» (ya cambiada a
  «Puedes sumarte»).

### D. Los nombres solo están en un idioma
Fases, tareas y pasos se guardan en español. Para mostrarlos en portugués, la app **busca y reemplaza
frases** con un glosario (`templateNames.ts:16`, `glossary.pt.json`). Funciona con la plantilla de
fábrica, pero un nombre nuevo o editado se queda en español, y el reemplazo de trozos de texto es
frágil («Alinear» dentro de «Revisar la alineación»).

### E. Crear un proyecto está desordenado
- Pide el **nombre de la primera fase**, que se pierde al aplicar la plantilla.
- La plantilla se elige **después**, en una pestaña aparte, y nada obliga a elegirla.
- El inventario se prepara **antes** de saber qué recursos pide la plantilla.
- Seis pantallas en cuatro etapas para algo que, para el FCR, es «este libro, con esta plantilla».

### F. La copia no tiene versión y re-aplicar es peligroso
- El proyecto guarda `workflowId` y la fecha, **no la versión**. Si se mejora la plantilla, los
  proyectos no se enteran, y no hay forma de ver qué cambió ni de actualizar.
- **Aplicar otra vez reemplaza todo**, aunque ya haya issues publicados: solo un
  `window.confirm`. Los issues usan `pm/tarea:<id>` y el progreso usa el **id de cada paso**; si
  cambian los ids, quedan subtareas huérfanas o progreso perdido.

### G. No hay validación, hay «arreglos silenciosos»
`normalizeWorkflowTemplate` (`store.ts:1331`) corrige en silencio: una tarea con una fase que no
existe pasa a la primera fase, y lo demás se descarta sin avisar. No hay un validador que diga
«el paso X espera a una tarea que no existe» o «dos pasos con el mismo id».

### H. Dos editores para lo mismo
Las tareas se editan en **Plantillas** (`WorkflowsView.tsx`, 1375 líneas) y otra vez en el proyecto
(`TeamsView.tsx`, 3095 líneas), con pantallas y opciones distintas. «Guardar como plantilla» copia
del proyecto a la plantilla, y así las dos versiones se separan con el tiempo.

---

## 3. Decisiones que propongo

1. **Tres capas separadas**:
   - **Motor**: proyectos, fases, tareas, subtareas y pasos, con las mecánicas (tomar, sumarse,
     aprobar, esperar, entregar, niveles). No sabe nada del FCR.
   - **Tipo de trabajo** (adaptador): de dónde salen las unidades (porciones de un libro, artículos,
     una lista escrita a mano), qué herramientas hay y cómo se entrega el resultado. «Biblia y
     ayudas» es el primero. Agregamos un segundo, **«Lista»** (unidades escritas a mano o pegadas de
     una hoja de cálculo), para probar que el motor de verdad es genérico.
   - **Plantilla** (solo datos): fases, tareas y pasos, nombres por idioma, qué tipo de trabajo usa
     y la versión.
2. **Nombres por idioma en la plantilla**: `name: { es: "Revisar notas", pt: "Revisar notas" }`.
   Se puede seguir leyendo un texto simple (cuenta para todos los idiomas). El glosario queda solo
   para las plantillas antiguas.
3. **`actionLabel` por paso, opcional y por idioma**: lo que dice el botón grande («Revisar»,
   «Votar», «Grabar»). Si falta, se usa la regla de la mecánica: «Sumarme a «paso»», «Aprobar
   «paso»», «Empezar» o «Seguir».
4. **Los ids son para siempre**: ids de fase, tarea y paso estables y generados. El nombre se puede
   cambiar libremente porque la app muestra el nombre por el id y no por el título del issue.
5. **Copia con versión, no enlace vivo**: el proyecto guarda `workflowId` + `workflowVersion`.
   Cuando hay una versión nueva, quien coordina ve **qué cambió** y la aplica con reglas seguras:
   - agregar tareas o pasos y renombrar: siempre;
   - quitar o reordenar: solo si no hay subtareas abiertas que dependan de eso;
   - cambiar un id: nunca.
6. **Crear proyecto = elegir plantilla + alcance**, en tres pasos:
   1. **¿Qué proceso?** Las plantillas, con su descripción, más «Empezar en blanco».
   2. **¿Sobre qué?** Lo pide el tipo de trabajo: libro(s) para la Biblia, la lista para «Lista».
   3. **Revisar y crear**: resumen (fases, tareas, equipos que faltan, herramientas que faltan) y un
      botón. El inventario se prepara solo, y solo para los recursos que pide la plantilla.

   Desaparece «nombre de la primera fase» y desaparece «Aplicar plantilla» dentro del proyecto
   (se reemplaza por «Actualizar a la versión N»).
7. **Un solo editor de tareas**: el mismo componente en Plantillas y en el proyecto. El proyecto solo
   agrega lo que es suyo (alcance, equipo, personas).
8. **Un validador** (`validateTemplate`) que devuelve problemas legibles, usado al guardar, al
   aplicar y en un script `verify:templates`. Nada de arreglos silenciosos.
9. **Plantillas de fábrica como archivos de datos** (JSON en `templates/`), no como funciones. La del
   FCR pasa a ser `templates/fcr.json`; quien quiera otro proceso escribe otro archivo o lo arma en
   Plantillas.

## 4. Fases de trabajo

Cada fase deja la app funcionando y no rompe proyectos existentes (se siguen leyendo
`gateway-assignments-2` y `gateway-workflows-1`).

**Fase 1: Plantilla como datos claros (bajo riesgo)**
- Nombres por idioma y `actionLabel` en fases, tareas y pasos, con lectura de los formatos antiguos.
- `validateTemplate` + `verify:templates`. El editor de Plantillas muestra los problemas.
- Campo `version` en la plantilla, que sube al guardar.
- FCR como `templates/fcr.json` con nombres en español y portugués; el glosario de plantillas queda
  solo para datos viejos.
- «Mis tareas» y los avisos muestran el nombre por id, en el idioma de la persona.

**Fase 2: Crear proyecto en tres pasos**
- Asistente nuevo (plantilla → alcance → revisar). Sin «primera fase».
- El proyecto guarda `workflowId` + `workflowVersion`.
- El inventario se prepara según la plantilla.
- Se quita «Aplicar plantilla» de Preparar → Tareas para proyectos con plantilla.

**Fase 3: Actualizar un proyecto a una versión nueva de su plantilla**
- Comparación (agregado / renombrado / quitado) y reglas seguras.
- Bloquear cambios de id y quitar algo con subtareas abiertas.

**Fase 4: Tipo de trabajo (adaptadores)**
- Interfaz `WorkSource` (unidades, inventario, herramientas, entrega).
- Mover lo de la Biblia y las ayudas (`ScopeKey`, inventario por porción, `reviewsPrincipal`…) al
  adaptador «Biblia y ayudas».
- Segundo adaptador «Lista» para un proceso sin Biblia.
- Sacar del motor los textos y las herramientas del FCR (`issues.ts:296`, `types.ts:543+`).
- Niveles con nombres configurables en `taller.config.ts` (el orden y la lógica siguen iguales).

**Fase 5: Un solo editor**
- Unificar `WorkflowsView` y `TeamsView` en un editor de tareas compartido.

## 5. Lo que necesito saber para la fase 4

Qué otros procesos imaginan en los próximos meses (aunque sea a grandes rasgos: qué se reparte, quién
lo hace, dónde queda el resultado). Eso decide qué debe poder describir un «tipo de trabajo». Las
fases 1 a 3 no dependen de esa respuesta.
