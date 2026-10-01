# El FCR en Taller

Cómo es nuestro proceso, cómo se estructura y cómo Taller lo sostiene sin quedar atado a él.

Borrador del 1 de octubre de 2026. Fuentes:
- **El proceso:** la guía pública del FCR (`idiomas-puentes-lms/apps/docs/src/content/fcr/guide.ts`,
  publicada en `/guias/fcr`).
- **Lo que ya probamos en Taller:** la plantilla base (`src/domain/fcrTemplate.ts`), las herramientas
  de Traducción y Afinación, y las notas de `AFINACION_PROXIMOS_PASOS.md`.

Donde la guía y Taller no coinciden, lo digo. Las preguntas que hay que responder antes de diseñar
están al final (sección 8).

---

## 1. Para qué sirve este documento

Queremos que Taller haga **bien** el FCR y que, con el mismo motor, sirva mañana para otros
proyectos bíblicos. Para eso hace falta separar dos cosas:

- **Lo que es del FCR:** sus fases, sus recursos, sus mínimos y sus reglas de revisión.
- **Lo que es de cualquier proceso colaborativo:** repartir trabajo, tomarlo, hacerlo con una
  herramienta, revisarlo entre varias personas, decidir y entregar.

Este documento describe lo primero con las palabras de Taller. Así se ve qué parte va en una
**plantilla** (datos) y qué parte necesita el **motor** (código).

## 2. El FCR en una página

El FCR produce en español el **Paquete de Recursos de Traducción (PRT)** de un libro de la Biblia:
dos textos (**TPL** y **TPS**) y cuatro recursos de apoyo (**Notas, Preguntas, Palabras y
Academia**), a partir del paquete inglés de unfoldingWord.

| # | Fase | Qué hace | Entra | Sale |
|---|------|----------|-------|------|
| 0 | **Preparación** | Elige el libro, lo divide en **porciones** (unidad de sentido dentro de un capítulo) y anota qué recursos hay que producir. No transforma contenido. | PRT inglés + lista de artículos ya publicados | Porciones con su inventario |
| 1 | **Traducción** | Seis equipos, a la vez y por separado, escriben los borradores en español. Los recursos de apoyo se escriben **sin mirar** el TPL ni el TPS en español. | Inventario de la porción | TPL y TPS → Afinación; apoyo → Armonización |
| 2 | **Afinación** | El TPL y el TPS se vuelven a anclar al original en tres etapas: **desafíos de traducción**, **palabras clave** y **alineación**. Al menos 2 personas con dominio del idioma bíblico, ajenas al borrador; grupo de 3 o más; consenso. | Borradores TPL/TPS + original | TPL y TPS afinados |
| 3 | **Armonización** | Los recursos de apoyo se ajustan a los textos afinados. Dos pistas: **Notas + Preguntas + Academia** (juntas) y **Palabras** (aparte). Cada recurso lo cierra una persona habilitada distinta de quien lo preparó. | Apoyo + TPL/TPS afinados | Paquete parcial armonizado |
| 4 | **Validación** | Un comité pastoral juzga fidelidad, claridad y utilidad. Al menos 2 pastores; con 2, los dos deben apoyar; con 3 o más, más de la mitad. Toda objeción seria debe quedar resuelta. | Paquete parcial armonizado | Paquete parcial con aval |
| 5 | **Publicación** | Informática revisa formato y metadatos y publica **exactamente** lo avalado. No edita contenido. | Paquete avalado | Paquete parcial publicado |

Tres reglas que atraviesan todo el proceso:

- **Propiedad editorial permanente.** Después del primer traspaso, el TPL y el TPS solo los cambia
  **Afinación**, y los recursos de apoyo solo **Armonización**, venga de donde venga la sugerencia.
  El trabajo **no vuelve** a Traducción.
- **Ojos frescos.** Quien revisa o cierra no es quien preparó el texto.
- **Retroalimentación por caminos fijos.** Las fases se comentan entre sí (por ejemplo, Validación
  canaliza a Afinación o a Armonización según el recurso), pero eso no cambia quién es dueño.

Y una regla de personas: cuatro formas de participar, **Observador → Aprendiz → Practicante →
Persona habilitada**. Solo las habilitadas cuentan para los mínimos y para cerrar.

## 3. Las piezas: cómo se estructura

```text
Proyecto (un libro: Nehemías)
 └─ Fase (Afinación)
     └─ Tarea (Afinar TPL)                     ← una «pista» de la fase, con su equipo
         └─ Subtarea (Afinar TPL · NEH 2)      ← una unidad de trabajo: porción o capítulo
             └─ Paso (Revisar notas)           ← una etapa de la subtarea, con su herramienta
                 └─ Ítem (la nota 2:3-xyz)     ← lo que se revisa uno por uno dentro del paso
```

| Pieza | En el FCR | En Taller hoy | Ejemplo |
|-------|-----------|---------------|---------|
| **Proyecto** | Un libro (su PRT) | `AssignmentsDoc`, un libro o un proyecto «temático» con varios libros | Nehemías |
| **Porción** | Rango de versículos con sentido completo, dentro de un capítulo | Sale del **inventario** (Preparar → Libro) | NEH 2:1-8 |
| **Fase** | Preparación … Publicación | `Phase`. Preparación no es fase de la plantilla: es la pantalla «Libro» | Afinación |
| **Tarea** | Una pista de la fase («Equipo TPL» de Afinación) | `ProjectTask`: recurso(s), equipo, nivel mínimo, «espera a», pasos | Afinar TPL |
| **Subtarea** | El trabajo de una pista sobre una porción | Un **issue** de Door43 (porción × tarea) | Afinar TPL · NEH 2 |
| **Paso** | Una etapa («desafíos», «palabras clave», «alineación») | `TaskStep`: nombre, herramienta, quién lo toma y cuántas personas | Revisar notas |
| **Ítem** | Una nota, un término o un versículo | Respuestas por ítem en la ronda de revisión (`reviewRound.ts`) | La nota de NEH 2:3 |
| **Equipo** | Los equipos de cada pista | Equipo de la organización en Door43 | Afinación TPL |
| **Nivel** | Observador … habilitada | `PersonLevel` (oyente, aprendiz, practicante, habilitada) | habilitada |
| **Herramienta** | Lo que se usa para hacer el paso | «Solver»: una pantalla de Taller o un sitio externo | Editor de alineación |
| **Borrador principal** | El texto vigente del recurso | La rama principal del repo de contenido; cada subtarea trabaja en su propia rama | `es-419_glt` |

## 4. Cómo se resuelve un paso

Este es el corazón del sistema. Un paso pasa siempre por el mismo ciclo, sea del FCR o de otro
proceso.

```text
 bloqueado ──▶ disponible ──▶ tomado ──▶ en trabajo ──▶ en revisión ──▶ completo
 (espera a)    (quién puede)   (asientos)   (herramienta)   (ronda/aprobación)
```

### 4.1 ¿Cuándo está disponible?
- La subtarea ya no **espera a** nada: el trabajo anterior de la misma porción, capítulo o libro
  está cerrado (`waitsFor`).
- Los pasos anteriores de la misma subtarea están completos (los pasos van en orden).

### 4.2 ¿Quién puede tomarlo?
Lo decide la plantilla, paso por paso:
- **Equipo** de la tarea y **nivel mínimo** (por ejemplo, solo habilitadas en Armonización).
- **Exclusiones** para tener ojos frescos: no quien tiene la subtarea (`excludeIssueAssignee`), no
  quien hizo pasos anteriores (`excludePriorStepIds`).
- **Cuántos asientos:**
  - *Ninguno* (`none`): lo hace quien tiene la subtarea.
  - *Uno* (`exclusive`): una persona lo toma.
  - *Varios* (`pool`): de `min` a `max` personas se suman.

### 4.3 ¿Con qué se trabaja?
Cada paso dice qué **herramienta** abre. Taller le pasa el contexto (libro, capítulo, porción,
subtarea, paso, persona) y la herramienta guarda en la rama de la subtarea. Hoy hay herramientas
para:
- borrador de TPL y TPS;
- borrador de ayudas;
- revisión en pares y grupal;
- las tres etapas de Afinación (notas, palabras clave y alineación con su revisión);
- leer en TranslationCore Study (familiarizar).

### 4.4 ¿Cuándo queda completo? Tres maneras
| Manera | Cómo se completa | Ejemplo en el FCR |
|--------|------------------|-------------------|
| **Lo marca quien lo hace** | La persona dice «terminé» | Borrador de Traducción |
| **Uno hace y otro aprueba** | Quien tomó el paso aprueba; si la plantilla lo pide, también quien hizo el paso anterior | Cierre independiente de Armonización |
| **Ronda de revisión** | Cada persona responde **ítem por ítem** (de acuerdo / propongo un cambio / objeción). Un ítem queda de acuerdo cuando bastantes habilitadas independientes coinciden y no hay objeciones abiertas. Lo que queda en disputa va a una reunión. | Afinación (notas, palabras, alineación); Validación |

**Algo que hay que arreglar:** hoy la ronda por ítem y la finalización del paso **no están
conectadas**. La herramienta muestra cuántos ítems están de acuerdo, pero el paso se completa cuando
bastantes personas sentadas pulsan «Aprobar» en Mis tareas (`stepClaim.ts`), aunque queden ítems en
disputa. En el FCR, el paso debería completarse cuando **todos los ítems** están de acuerdo (o
resueltos en la reunión).

### 4.5 ¿Qué pasa al completar el último paso?
**Entregar la subtarea:**
- se fusiona su rama en el borrador principal;
- si alguien cambió el mismo versículo, se abre una **decisión** para el equipo;
- se cierra el issue;
- se desbloquea lo que esperaba por ella.

### 4.6 Lo que el ciclo todavía no sabe hacer
- **Volver atrás con dueño:** cuando Validación deja el aval pendiente, el ajuste va a Afinación o a
  Armonización y después vuelve **al mismo comité**. Hoy no hay forma de reabrir ese recorrido.
- **Reglas de decisión distintas al mínimo:** la unanimidad con 2 personas, la mayoría con 3 o más y
  la objeción seria que bloquea (Validación).
- **Retroalimentación entre fases**, que llegue al dueño como algo que hay que atender.

## 5. El FCR tal como está en Taller

Estado: ✅ probado con herramientas · 🧩 está en la plantilla, sin herramienta propia · ❌ no
modelado.

| Fase | Tarea(s) en la plantilla | Pasos | Espera a | Estado |
|------|--------------------------|-------|----------|--------|
| Preparación | (pantalla «Libro») | inventario automático de porciones | — | ✅ |
| Traducción | Traducir TPL, Traducir TPS | Borrador → Revisión en pares → Revisión grupal | — | ✅ |
| Traducción | Traducir Notas / Preguntas / Palabras / Academia | Borrador → Revisión en pares | — | ✅ (editor de ayudas) |
| Afinación | Afinar TPL, Afinar TPS | Revisar notas (3-6, 2 independientes) → Revisar palabras clave (3-6) → Alinear (1, no quien tiene la subtarea) → Revisar la alineación (2-4) | su Traducción, **por capítulo** | ✅ |
| Armonización | Armonizar Notas / Preguntas / Academia / Palabras (4 tareas) | Ajustar → Cierre independiente | su Traducción + toda la Afinación, por capítulo | 🧩 |
| Validación | Validar | Decisión pastoral (2-4, 2 independientes) | toda la Armonización, por capítulo | 🧩 sin herramienta |
| Publicación | «Publicar versión» (pantalla del proyecto) | requiere Validación | — | 🧩 por libro, no por porción |
| Artículos compartidos nuevos | — | — | — | ❌ |
| Retroalimentación y aval pendiente | — | — | — | ❌ |

### Dónde la plantilla no sigue a la guía
1. **Traducción** tiene en la plantilla revisión en pares y grupal; la guía solo pide que cada equipo
   compruebe su material y que el coordinador asegure que se complete.
2. **Afinación**: la plantilla llama «Revisar notas» a la etapa que la guía llama «desafíos de
   traducción / cotejo con el original», y separa «Alinear» (una persona) de «Revisar la
   alineación». La guía habla de grupo y consenso en las tres etapas.
3. **Unidad de espera:** la guía habla de **porción**; la plantilla espera **por capítulo**.
4. **Armonización:** la guía tiene **dos pistas** (Notas + Preguntas + Academia juntas, y Palabras);
   la plantilla tiene **cuatro tareas** separadas.
5. **Palabras y Academia** son artículos **compartidos entre libros**, con su «propio camino
   global». En Taller todo cuelga de un libro.
6. **Validación** decide por porción y con reglas de mayoría y objeción; la plantilla solo tiene un
   mínimo de personas.
7. **Publicación** es por **paquete parcial** (porción) en la guía, y por libro o versión en Taller.
8. **Niveles:** la guía dice **Observador**; Taller dice **oyente**. La guía habla de habilitación
   **por función o pista**; Taller guarda un solo nivel por persona.

## 6. Qué es motor y qué es plantilla

Si separamos bien, el FCR completo cabe en **datos**, y el motor queda reutilizable.

**El motor (igual para todos los procesos)**
- Proyecto, fase, tarea, subtarea, paso e ítem.
- Esperas entre tareas o fases con un alcance (misma unidad, mismo grupo, todo).
- Quién puede: equipo, nivel, exclusiones, asientos.
- Las tres maneras de completar un paso, con **reglas de decisión** configurables: mínimo de
  acuerdos, independientes, mayoría, unanimidad y objeción que bloquea.
- Entregar (fusionar, decisiones de conflicto) y **devolver** a la fase dueña con regreso.
- Avisos, Mis tareas, Equipo hoy.

**El tipo de trabajo (uno por clase de contenido)**
- De dónde salen las **unidades**: porciones de un libro (FCR), historias y marcos (OBS), artículos
  sueltos (Palabras y Academia), o una lista escrita a mano.
- Qué **herramientas** sirven para esas unidades.
- Dónde se guarda el resultado (qué repo y qué archivo).

**La plantilla (solo datos, una por proceso)**
- Fases, tareas, pasos e ítems; nombres en cada idioma y lo que dice el botón (`actionLabel`).
- Qué tipo de trabajo usa cada tarea.
- Mínimos, reglas de decisión, esperas, niveles y dueños («quién responde por el TPL»).

### Cómo cabrían otros proyectos bíblicos
| Proyecto | Unidad | Fases posibles | Qué necesita del motor |
|----------|--------|----------------|------------------------|
| **FCR** (PRT en español o portugués) | Porción de un libro | Las del FCR | Todo lo de arriba |
| **Artículos compartidos** de Palabras y Academia | Artículo | Traducción → Armonización (Palabras) | Unidad que no es de un libro |
| **Historias Bíblicas Abiertas (OBS)** | Historia y marco | Traducción → Revisión → Validación | Otro tipo de trabajo, el mismo motor |
| **Traducción a una lengua nativa** con el PRT | Porción o capítulo | Borrador → Revisión comunitaria (Preguntas) → Consultoría | Ronda con personas de fuera del equipo |
| **Revisión de una traducción existente** | Capítulo | Revisión → Decisión | Solo ronda de revisión |

## 7. Lo que propongo decidir primero

1. **Unidad de trabajo y de espera** del FCR (porción o capítulo), porque cambia cómo se crean las
   subtareas.
2. **Cómo se completa un paso de ronda** (todos los ítems de acuerdo, o aprobación de las personas).
3. **Las pistas de Armonización** (dos o cuatro tareas).
4. **El camino de los artículos compartidos**, que es la primera necesidad real de una unidad «que no
   es de un libro». Prueba la extensibilidad dentro del mismo FCR.

## 8. Preguntas

### A. Unidad y orden
1. ¿Qué espera a qué: **porción** o **capítulo**? ¿Puede empezar la Afinación de NEH 2:1-8 cuando su
   TPL está entregado, o espera todo el capítulo 2?
2. La etapa de **palabras clave** compara el término en todo el libro o el capítulo. ¿Su unidad es la
   porción, el capítulo o el libro?
3. ¿Una subtarea de Traducción es siempre **una porción** por persona, o a veces un capítulo
   entero?

### B. Traducción
4. ¿Traducción lleva **revisión en pares y grupal** (como la plantilla) o solo autocomprobación y el
   coordinador (como la guía)?
5. ¿Qué hace el **coordinador de Traducción** en el sistema: asigna, revisa, aprueba la entrega?
6. Un **Aprendiz** «resuelve la misma tarea que alguien con experiencia y comparan». ¿Se crean dos
   borradores de la misma porción? ¿Cuál se entrega?

### C. Afinación
7. ¿Las tres etapas las hace **el mismo grupo** de principio a fin, o cada etapa puede tener gente
   distinta?
8. **Alineación:** ¿una persona alinea y otras revisan (como hoy), o el grupo alinea junto?
9. «Dominio del idioma bíblico pertinente»: ¿es un requisito aparte del nivel (hebreo para AT, griego
   para NT)? ¿Lo registramos por persona?
10. ¿Cómo se resuelve lo que queda **en disputa**: una reunión con fecha, quién la convoca y quién
    registra la decisión?

### D. Armonización
11. ¿Una subtarea por porción que reúne **Notas + Preguntas + Academia**, y otra para **Palabras**?
12. ¿Armonización espera la Afinación de **los dos** textos (TPL y TPS) de esa porción?
13. «La revisión puede ser colaborativa»: ¿quiénes participan antes del cierre independiente, y deben
    quedar registrados?

### E. Validación y Publicación
14. ¿Confirmamos la regla: 2 pastores → los dos apoyan; 3 o más → más de la mitad; cualquier
    **objeción seria** bloquea? ¿Quién declara resuelta una objeción?
15. ¿La validación es **asíncrona** (cada pastor cuando puede) o en **sesión**? ¿Cómo se registra la
    «muestra que él mismo elige»?
16. **Aval pendiente:** ¿el ajuste vuelve como una subtarea nueva a Afinación o Armonización, y luego
    al **mismo** comité (las mismas personas)?
17. ¿Se publica **por porción** (paquete parcial) en cuanto tiene aval, o se juntan porciones en una
    versión del libro?

### F. Artículos compartidos
18. ¿Cuál es el «camino global» de un artículo nuevo de Palabras o Academia: quién lo traduce, quién
    lo revisa, quién lo valida? ¿Un paquete parcial puede validarse si cita un artículo que todavía
    no está publicado?

### G. Personas
19. ¿El nivel es **por función o pista** (habilitada en Afinación TPL, aprendiz en Armonización) o uno
    solo por persona?
20. ¿Usamos **«Observador»** como en la guía (y cambiamos «oyente» en Taller)?

### H. Propiedad y retroalimentación
21. Si Afinación cambia un TPL **después** de que Armonización empezó esa porción, ¿se reabre
    Armonización?
22. La retroalimentación (Validación → Afinación, usuarios → Armonización…): ¿debe llegar como un
    **aviso**, como una **tarea** para el dueño, o como una conversación?

### I. Más allá del FCR
23. ¿Qué otros proyectos imaginan en el próximo año (OBS, lenguas nativas, revisión comunitaria,
    cursos)? Con uno o dos ejemplos concretos podemos probar que el diseño sirve.
24. ¿El FCR en **portugués** es el mismo proceso, o tendrá variaciones (otros mínimos, otras fases)?
