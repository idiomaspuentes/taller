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

### Fase 3 · Cerrar un paso por consenso — hecha (1 de octubre de 2026)

**Lo que quedó:** un paso con `closing: consensus` ya no se completa con «Aprobar». Con herramienta por ítems
(Afinación), lo completa la herramienta cuando todo está de acuerdo: muestra lo que quedó sin acuerdo (la lista para
la reunión) y «Cerrar la revisión». Lo disputado se resuelve con la **decisión del equipo**, registrada con su razón
por el coordinador o una persona habilitada; una objeción posterior lo reabre y un cambio de texto la anula. Sin
herramienta (acuerdo del equipo), deben aprobar todas las personas sentadas. Pruebas: `verify:consensus`.

**Corrección pedida:** nadie hace un capítulo entero. La alineación es **un solo paso compartido**: cada persona toma
versículos, y lo que termina pasa a que lo revisen las demás. Una subtarea libre cuyo paso siguiente es del equipo ya
no se ofrece como «Empezar» (que se la daba entera a una persona): la gente **se suma al paso** y la subtarea sigue
siendo del equipo; la entrega quien participó.

#### Lo planeado era
- El cierre de un paso `consensus` lo decide el resumen de la ronda (`summarizeRound`), no los
  «Aprobar»: completo cuando todos los ítems están de acuerdo.
- **Decisión final** para un ítem en disputa: la registra el coordinador o una persona habilitada del
  equipo, con su razón; queda en el historial de la subtarea.
- Vista «lo que quedó sin acuerdo» para preparar la reunión.
- Las herramientas de Afinación (notas, palabras, alineación) usan la misma pieza.

**Listo cuando:** un paso de Afinación con una objeción abierta no se completa, y se completa al
registrar la decisión final.

### Fase 4 · Preparar el libro y crear el proyecto — hecha (1 de octubre de 2026)

**Lo que quedó:** al crear un proyecto se elige el **proceso** (la plantilla; ya no se pide «primera fase») y el
proyecto nace con sus fases, tareas y pasos, y recuerda la versión (`workflowVersion`). En **Preparar → Libro**, debajo
del inventario, se define **qué pasa junto de una fase a la siguiente**: cada capítulo entero, o un capítulo largo
partido en tramos (`settings.handoffUnits`). Las tareas que reciben una unidad (Afinación, Armonización, Validación)
tienen una subtarea por unidad; Traducción sigue por porción. La espera «por capítulo» se cuenta por unidad, así que
cada tramo avanza solo. La **familiarización** se hace una vez por persona y capítulo (`scope: chapter-once`) y su
pantalla muestra la introducción al libro y al capítulo. Pruebas: `verify:handoff`.

**Límites:** cambiar los cortes después de crear subtareas pide volver a «Entregar» para que sigan el nuevo corte.

#### Lo planeado era
- Asistente de tres pasos: **plantilla → libro → unidades de traspaso → revisar y crear**. Sin
  «primera fase». El proyecto guarda `workflowId` y `workflowVersion`.
- **Unidades de traspaso:** por defecto un capítulo; se puede partir un capítulo en tramos de
  porciones. Las esperas entre fases se cuentan por unidad (`WaitScope` nuevo: `unit`).
- La **familiarización** como paso con alcance «capítulo, una vez por persona», mostrando las notas
  de introducción al libro y al capítulo.
- Las palabras clave de Afinación con alcance «unidad de traspaso».

**Listo cuando:** se crea Tito con la plantilla del FCR en un minuto, el Salmo 119 se puede partir,
y cada tramo avanza solo.

### Fase 5 · Armonización — hecha (2 de octubre de 2026)

**Lo que quedó:** las tres pistas de la plantilla (Notas + Academia, Palabras, Preguntas) y la herramienta de
**lista de comprobación por ítem** (`#/solver/checklist`), con las preguntas de sí/no como datos del paso. Cada ítem
se muestra junto al TPL (y al TPS), con la **cita generada** desde el texto alineado. Un «no» pide qué se hizo: «lo
corregí», «creé lo que faltaba» o «pedí el cambio a quien mantiene el texto» (queda **en consulta**, avisa en la
conversación y no deja cerrar el paso). Las respuestas llevan la huella del versículo: si Afinación lo cambia, quedan
pendientes otra vez. La lista de Academia recorre solo las notas que enlazan un artículo (`only: linked`). Armonizar
Palabras tiene una subtarea por capítulo (`everyUnit`). Las listas muestran las notas y preguntas **del equipo** (el
borrador grupal de ese trabajo). Cierra con «Acuerdo del equipo». Pruebas: `verify:checklist`.

**Corregir una cita:** en la lista de notas, «Corregir la cita» deja marcar las palabras en el TPL; la app saca la
cita del original por la alineación (en el orden del original, con «&» entre palabras separadas) y la guarda en las
notas del equipo. Prueba: `verify:quote-selection`.

### Fase 6 · Validación y Publicación — hecha (2 de octubre de 2026)

**Validación:** revisión pastoral **a ciegas** (nadie ve otro reporte antes de entregar el suyo), decisión del comité
por la regla del paso (`decisionRule`: mayoría o unanimidad, con las objeciones a la vista) y «dejar pendiente», que
envía cada inquietud a quien mantiene ese recurso. Al conceder el aval se guarda **qué se avaló**, versículo por
versículo y fila por fila. Pruebas: `verify:endorsement`.

**Publicación:** una tarea `publicar` por unidad con dos pasos `automatic`. Las comprobaciones corren al abrir y, si
todo pasa, el paso se completa solo: versículos completos, textos alineados, filas de ayudas enteras y **que sea
exactamente lo avalado**. Si algo falla, la publicación se detiene y se avisa al dueño. Publicar pasa la unidad a la
rama publicada de cada recurso por un pull request, sin tocar el resto del archivo; con rama protegida, la solicitud
queda abierta para quien tenga permiso. Una tarea con todos sus pasos automáticos se entrega sola. Pruebas:
`verify:unit-publish`.

**Artículos:** los de Academia que enlazan las notas de la unidad y los de Palabras de sus términos clave se
comprueban y se publican con la primera unidad que los usa (`articles` en los parámetros de la herramienta). También
entran en lo que el comité avala.

### Fase 7 · Glosario y registro de traducciones — hecha en su primera versión (2 de octubre de 2026)

**Lo que quedó:** el glosario vive en `<idioma>_tg` de la organización de contenido, con el formato de
[GLOSARIO_DOOR43.md](GLOSARIO_DOOR43.md); el repositorio se crea con la primera entrada. Se abre **en el pasaje**
(desde el editor de texto y desde Afinación) o se **busca**; «Por acordar» lista las propuestas. Una entrada nace con
un toque sobre una palabra del inglés alineado: la app llega a la palabra del original y deja fuera artículos,
preposiciones, conjunciones, partículas y prefijos hebreos; varios toques forman una expresión. Cada entrada muestra
**cómo se tradujo antes** en el libro (calculado desde la alineación) y dónde el texto **se aparta** de una decisión
acordada. Crear o trabajar una propuesta es un commit; cambiar lo acordado es un pull request. Pruebas:
`verify:glossary`.

**Límites:** «cómo se tradujo antes» mira el libro en curso, no todos (falta el índice generado); falta la vista de
«cambios recientes»; proponer la alineación con el puente por el inglés no está hecho. Las propuestas de cambio a
una decisión acordada se ven en «Por acordar» y las acepta o descarta quien coordina o una persona habilitada.

### Fase 8 · Abrir el motor a otros procesos — hecha en parte (2 de octubre de 2026)

**Hecho:**
- **Actualizar un proyecto** a la versión nueva de su proceso: aviso en «Fases y tareas»; agrega fases, tareas y pasos
  que faltan y completa ajustes, sin cambiar ni quitar nada del proyecto. Prueba: `verify:workflow-upgrade`.
- **Espera entre proyectos:** una regla `{ "taskId": "publicar", "scope": "chapter", "source": true }` espera a que el
  **proyecto fuente** (el mismo libro, en la organización del paquete de recursos de origen) cierre esa tarea para ese
  capítulo.
- **Segundo proceso:** `processes/lengua-minoritaria.json` (borrador y revisión del equipo → comunidad → consultor →
  publicación) funciona con el mismo motor y sin código propio. No está activado en `taller.config.ts`. Prueba:
  `verify:second-process`.

**Pendiente:**
- La interfaz de **tipo de trabajo**: las claves de los recursos (`tpl`, `tps`, `notas`…) y dónde se guarda cada uno
  siguen en el código. Sus **nombres** ya vienen del proceso (`resourceNames`): el segundo proceso llama «Biblia» a
  su texto, en las pantallas del proyecto, en los títulos de las subtareas y en las herramientas.
- **Un solo editor de tareas** para Plantillas y para el proyecto (los campos nuevos de un paso se editan hoy en el
  JSON del paquete).

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
