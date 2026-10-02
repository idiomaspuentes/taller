# Plan técnico: plantillas, proyectos y el FCR completo

Reescrito el 1 de octubre de 2026, después de documentar el proceso con la persona dueña. Reemplaza
la versión anterior de este plan.

**Qué hay que construir** está en:
- [PLANTILLA_FCR.md](PLANTILLA_FCR.md): la plantilla para leer (fases, tareas, pasos, reglas de
  cierre, citas de las notas, glosario).
- [CORRIDA_EN_FRIO_FCR.md](CORRIDA_EN_FRIO_FCR.md): la historia de Tito 2, equipo por equipo.
- [FCR_EN_TALLER.md](FCR_EN_TALLER.md): el FCR y lo que se respondió.
- [GLOSARIO_DOOR43.md](GLOSARIO_DOOR43.md): el glosario como recurso de Door43.

Este documento dice **en qué orden** y **qué cambia en el código**.

---

## 1. De dónde partimos (confirmado en el código)

**Lo que sirve:** los pasos ya son datos (`TaskStep`): quién, cuántos asientos, exclusiones,
herramienta, «espera a», nivel mínimo. «Mis tareas» ya trabaja con cualquier plantilla.

**Lo que falta o estorba:**

| # | Problema | Dónde |
|---|----------|-------|
| A | La plantilla del FCR es código, con nombres solo en español; el portugués sale de buscar y reemplazar frases | `fcrTemplate.ts`, `templateNames.ts` |
| B | El paso se completa por «Aprobar» de las personas, no por consenso de los ítems | `stepClaim.ts:229` frente a `reviewRound.ts` |
| C | Un solo nivel por persona; el FCR lo pide por fase, asignado por el coordinador del equipo | `levels.ts`, `config.json` |
| D | No existe el coordinador de un equipo | — |
| E | La espera es «por capítulo» fija; no se puede partir un capítulo largo ni agrupar a mano | `waits.ts`, `WaitScope` |
| F | Crear un proyecto pide «primera fase» y la plantilla se aplica después, reemplazando todo | `ProjectsView.tsx:263`, `TeamsView.tsx:715` |
| G | La copia de la plantilla no tiene versión; re-aplicar puede dejar subtareas huérfanas | `workflows.ts:11` |
| H | No hay validador; los errores se «arreglan» en silencio | `store.ts:1331` |
| I | Recursos y unidades fijos a la Biblia y las seis ayudas | `types.ts:31-87` |
| J | Dos editores de tareas distintos | `WorkflowsView.tsx`, `TeamsView.tsx` |
| K | No hay lista de comprobación por ítem, ni «consulta al dueño», ni devolución con regreso | — |
| L | Nada cruza libros (glosario, cómo se tradujo antes) | — |

## 2. El modelo al que vamos

```text
Espacio de trabajo (idioma)
 ├─ Glosario y registro de traducciones        ← cruza libros
 ├─ Equipos, con coordinador y niveles por fase
 └─ Proyecto (libro)  ── plantilla + versión
     ├─ Unidades de traspaso (capítulo, o tramos)   ← las define quien coordina el libro
     └─ Fase → Tarea → Subtarea (porción) → Paso → Ítem
```

**Un paso declara** (todo datos):
- nombre y texto del botón, por idioma;
- quién: nivel mínimo en la fase, exclusiones, asientos;
- herramienta;
- **regla de cierre**, una de cinco:
  `self` (lo marca quien lo hace) · `approval` (otra persona lo aprueba) · `consensus` (consenso por
  ítem, con decisión final) · `checklist` (preguntas de sí o no por ítem) · `automatic`
  (comprobación automática);
- para `consensus`: mínimo de acuerdos e independientes, y quién confirma la decisión final;
- para `checklist`: las preguntas, por idioma, y las salidas de un «no»;
- **alcance del paso:** por porción, por unidad de traspaso (palabras clave) o por capítulo
  (familiarización, una vez por persona).

## 3. Fases de trabajo

Cada fase deja la app funcionando y sigue leyendo los proyectos existentes.

### Fase 1 · La plantilla como datos — hecha (1 de octubre de 2026)

**Lo que quedó:** el FCR salió del código a `processes/fcr.json` (plantilla nueva con familiarización, tres pistas de
Armonización, listas de comprobación, nombres en español y portugués, botón por paso, regla de cierre y versión) y
`taller.config.ts` lo lista en `processes`. El motor lee los paquetes por `src/domain/processes.ts`; las herramientas
de fábrica y la puesta al día del catálogo de cada organización son genéricas (`supersedes`, `stepParams`,
`needsIssue`). `validateTemplate` existe como `workflowProblems` / `processProblems` (`workflowCheck.ts`), con
`verify:templates` (incluye un proceso inventado de grabación de audio) y `verify:decoupling`. Detalle en
[PROCESOS.md](PROCESOS.md).

**Lo que falta de esta fase:** editar en la pantalla **Plantillas** los campos nuevos (nombres por idioma, botón,
regla de cierre, preguntas); hoy se conservan al guardar pero solo se escriben en el JSON.

Lo planeado era:
- Tipos nuevos en `types.ts`: nombres por idioma (`string | { es, pt }`), `actionLabel`, `closing`,
  `checklist`, `stepScope`. Lectura de los formatos actuales sin romper nada.
- `templates/fcr.json` con la plantilla de [PLANTILLA_FCR.md](PLANTILLA_FCR.md), en español y
  portugués. `fcrTemplate.ts` pasa a leer ese archivo.
- `validateTemplate()` con mensajes legibles + `verify:templates`. Fin de los arreglos silenciosos.
- Campo `version` en la plantilla.
- «Mis tareas» y los avisos toman el nombre y el botón de la plantilla por id y por idioma; el
  glosario de nombres queda solo para datos antiguos.

**Listo cuando:** `verify:templates` pasa, la plantilla del FCR se lee del JSON y la app se ve igual
en español y en portugués.

### Fase 2 · Personas: coordinador y nivel por equipo — hecha (1 de octubre de 2026)

**Lo que quedó:** el nivel de una persona es **por equipo** (cada pista de cada fase tiene su equipo, así que cada
fase tiene su propia escala) y cada equipo tiene **coordinadores**. Se guardan en `config.json` del espacio
(`teamLevels`, `coordinators`), junto al nivel general de antes (`levels`), que sigue valiendo en un equipo hasta que
ese equipo registra el primero propio. En **Organización**, quien administra nombra coordinadores; el coordinador (o
quien administra) asigna los niveles de su equipo; el resto los ve. En un equipo con niveles propios, quien no tiene
nivel ahí solo puede tomar lo que no pide nivel. `canConfirmForTeam` ya dice quién puede confirmar una decisión final
(lo usa la fase 3). Pruebas: `verify:levels`.

**Límites conocidos:**
- El equipo se identifica por su nombre: si se renombra en Door43, sus niveles hay que volver a ponerlos.
- Para guardar un nivel, la coordinadora necesita permiso de escritura en el repositorio de tareas.
- Las decisiones de alineación (votos) todavía cuentan con el nivel general, no con el del equipo.

Lo planeado era:

#### Personas: coordinador y nivel por fase
- `config.json` del espacio: por equipo, su **coordinador**; por persona, su **nivel en cada fase**
  (lectura del nivel único actual como valor para todas las fases).
- El coordinador asigna niveles de su equipo desde Organización.
- `audience.ts` y `levels.ts` usan el nivel de la fase de la tarea.

**Listo cuando:** una persona es habilitada en Traducción y aprendiz en Afinación, y cada fase la
trata según su nivel ahí.

### Fase 3 · Cerrar un paso por consenso
- El cierre de un paso `consensus` lo decide el resumen de la ronda (`summarizeRound`), no los
  «Aprobar»: completo cuando todos los ítems están de acuerdo.
- **Decisión final** para un ítem en disputa: la registra el coordinador o una persona habilitada del
  equipo, con su razón; queda en el historial de la subtarea.
- Vista «lo que quedó sin acuerdo» para preparar la reunión.
- Las herramientas de Afinación (notas, palabras, alineación) usan la misma pieza.

**Listo cuando:** un paso de Afinación con una objeción abierta no se completa, y se completa al
registrar la decisión final.

### Fase 4 · Preparar el libro y crear el proyecto
- Asistente de tres pasos: **plantilla → libro → unidades de traspaso → revisar y crear**. Sin
  «primera fase». El proyecto guarda `workflowId` y `workflowVersion`.
- **Unidades de traspaso:** por defecto un capítulo; se puede partir un capítulo en tramos de
  porciones. Las esperas entre fases se cuentan por unidad (`WaitScope` nuevo: `unit`).
- La **familiarización** como paso con alcance «capítulo, una vez por persona», mostrando las notas
  de introducción al libro y al capítulo.
- Las palabras clave de Afinación con alcance «unidad de traspaso».

**Listo cuando:** se crea Tito con la plantilla del FCR en un minuto, el Salmo 119 se puede partir,
y cada tramo avanza solo.

### Fase 5 · Armonización
- Tres pistas en la plantilla (Notas + Academia, Palabras, Preguntas).
- Herramienta de **lista de comprobación por ítem**, con las listas A a F como datos.
- **Cita generada** de cada nota desde el TPL alineado; marcar las notas de un versículo como
  pendientes cuando Afinación cambia ese versículo.
- Las tres salidas de un «no»: corregir, crear (nota o artículo nuevo), **pedir el cambio a
  Afinación** con la razón; el ítem queda «en consulta».
- Paso final «Acuerdo del equipo» con la regla `consensus` de la fase 3.
- Corregir una cita seleccionando palabras del TPL (deducir el original por la alineación).

**Listo cuando:** la corrida de Tito 2 en Armonización se puede hacer entera en la app.

### Fase 6 · Validación y Publicación
- Revisión pastoral **a ciegas**: las inquietudes de los demás se ven al entregar el reporte propio.
- Regla del aval configurable (hoy: objeciones a la vista; sin consenso, mayoría).
- **Aval pendiente:** cada observación va a su dueño y la unidad regresa al mismo comité.
- Publicación por unidad, con pasos `automatic` (mini-apps de comprobación y de publicación).

### Fase 7 · Glosario y registro de traducciones
- Repositorio `<idioma>_tg` y lectura/escritura desde Taller ([GLOSARIO_DOOR43.md](GLOSARIO_DOOR43.md)).
- Crear una entrada con un toque sobre una palabra alineada; filtro de palabras pequeñas.
- Mostrar las entradas en contexto, buscador y «cambios recientes».
- Índice de «cómo se tradujo antes» desde las alineaciones de todos los libros.
- Proponer la alineación con el puente por el inglés.

Puede adelantarse en paralelo desde la fase 3: no depende de las fases 4 a 6.

### Fase 8 · Abrir el motor a otros procesos
- Interfaz de **tipo de trabajo** (de dónde salen las unidades, qué herramientas, dónde se entrega);
  mover lo de la Biblia y las ayudas a ese adaptador.
- **Espera entre proyectos** («lo que el FCR ya publicó»).
- Segunda plantilla: traducción a una lengua minoritaria.
- Actualizar un proyecto a una versión nueva de su plantilla, con reglas seguras.
- Un solo editor de tareas para Plantillas y para el proyecto.

## 4. Orden y dependencias

```text
1 Plantilla como datos ─▶ 2 Personas ─▶ 3 Consenso ─▶ 4 Preparar libro ─▶ 5 Armonización ─▶ 6 Validación y Publicación
                                              └──────▶ 7 Glosario (en paralelo)
                                                                                              8 Otros procesos
```

Las fases 1 a 3 son las de menor riesgo y arreglan lo que el FCR ya usa hoy (Traducción y
Afinación). La 4 cambia cómo se crean los proyectos. Las 5 y 6 son trabajo nuevo.

## 5. Lo que no cambia

- Las subtareas siguen siendo issues de Door43; el progreso sigue en el cuerpo del issue.
- Una rama y un pull request por subtarea de texto.
- Los espacios de trabajo (`scope.ts`) y la configuración (`taller.config.ts`).
- Los proyectos existentes se siguen leyendo sin migración.

## 6. Pendiente de decidir

1. La regla definitiva del aval (fase 6).
2. El nombre del recurso del glosario y dónde va su índice (fase 7).
3. La «copia de práctica» del Aprendiz: aceptada, sin fecha.
