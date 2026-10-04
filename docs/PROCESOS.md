# Procesos: cómo se le dice a Taller cómo trabaja un equipo

Taller no trae ningún proceso dentro del código. Un **proceso** (para Idiomas Puentes, el FCR) es un
archivo JSON en `processes/`, y `taller.config.ts` dice cuáles usa la organización:

```ts
import fcr from "./processes/fcr.json";

export const tallerConfig = {
  // …
  processes: [fcr],
};
```

Para trabajar con otro proceso se escribe otro archivo y se agrega a esa lista. No hay que tocar
`src/`. La prueba `npm run verify:decoupling` falla si el código vuelve a nombrar una plantilla, una
fase, una tarea, un paso o una herramienta de un proceso.

## Dos formas de configurar un proceso

| | Dónde vive | Quién lo cambia | Para qué |
|---|---|---|---|
| **El paquete** | `processes/*.json`, en el repositorio de la app | Quien mantiene la app | Las plantillas y herramientas de fábrica, con sus nombres en cada idioma |
| **Desde la app** | `workflows.json` y `solvers.json`, en el repositorio de tareas de la organización en Door43 | Quien coordina, en **Plantillas** | Copias propias: se copia una plantilla incluida o se empieza de cero, y se ajusta (ver `docs/PROYECTOS.md`) |

Un proyecto guarda una **copia** de la plantilla con la que se creó. Cambiar la plantilla no cambia
los proyectos ya creados.

## Qué trae un paquete

```json
{
  "schema": "taller-process-1",
  "id": "fcr",
  "workflows": [ … ],
  "tools": [ … ],
  "glossary": { "pt": { "Cierre independiente": "Fechamento independente" } }
}
```

### `workflows`: las plantillas

Cada plantilla tiene `id`, `name`, `version`, `phases` y `tasks`.

**Una tarea** (`tasks[]`):

| Campo | Qué dice |
|---|---|
| `id`, `name`, `names` | Identificador estable, nombre y nombre en otros idiomas (`{ "pt": "…" }`) |
| `phaseId` | Su fase |
| `rules` | Sobre qué recurso trabaja |
| `minLevel` | Nivel mínimo para tomarla |
| `waitsFor` | Qué espera: una tarea (`taskId`) o una fase (`phaseId`), y con qué alcance |
| `solverAppId` | Herramienta de toda la tarea, si no tiene pasos |
| `steps` | Sus pasos, en orden |

**Un paso** (`steps[]`):

| Campo | Qué dice |
|---|---|
| `id`, `name`, `names` | Identificador estable y nombre, por idioma |
| `actionLabel`, `actionLabels` | Lo que dice el botón grande («Revisar», «Grabar»). Sin él, la app dice «Empezar» o «Seguir» |
| `solverAppId` | La herramienta que abre |
| `checks` | Lo que la persona comprueba en su propio trabajo antes de entregar el paso: una lista corta que marca para sí (`id`, `text`, `texts` por idioma). Recuerda; no cierra el paso |
| `claimMode` | Quién lo toma: `none` (quien tiene la tarea), `exclusive` (una persona), `pool` (varias) |
| `minAssignees`, `maxAssignees`, `minIndependent` | Cuántas personas, y cuántas no deben haber escrito el texto (`pool`) |
| `excludeIssueAssignee`, `excludePriorStepIds`, `includeAuthorInApproval` | Quién no puede tomarlo, y si el autor también confirma |
| `closing` | Cómo se completa: `self`, `approval`, `consensus`, `checklist`, `automatic` |
| `checklist` | Las preguntas de sí o no de un paso `checklist` (`id`, `text`, `texts`, `per`) |
| `scope` | Qué cubre: una subtarea, la unidad completa (`unit`), o un capítulo una vez por persona (`chapter-once`) |

Los **ids no se cambian nunca**: las subtareas y su avance en Door43 los usan. Los nombres sí se
pueden cambiar.

### `tools`: las herramientas

Lo que un paso puede abrir: una pantalla de Taller o un sitio de fuera.

| Campo | Qué dice |
|---|---|
| `id`, `name`, `description` | Identificador y nombre |
| `launchUrl` | Adónde va, con marcadores como `{context}`, `{book}`, `{chapter}` |
| `resources` | Para qué recursos sirve |
| `kind`, `openMode`, `lang` | Pantalla de la app o sitio externo, y en qué idioma lee un sitio externo |
| `needsIssue` | Necesita una subtarea real (no se puede probar en el laboratorio) |
| `stepParams` | Parámetros extra según el paso: una misma pantalla sirve a dos pasos (`{ "revisar-alineacion": { "mode": "revisar" } }`) |
| `supersedes` | Trozos de direcciones viejas: la copia guardada de una organización se pone al día sola |
| `walks` | Qué recorre una persona, uno por uno, en la herramienta: `unit` (`verses`, `notes`, `questions` o `items`), `times` (cuántos hay por cada uno, si el libro no lo dice), `approx` y `label` / `labels` (cómo los llama). Con eso se calcula la carga de un paso; ver «Carga por persona» |

### Carga por persona: cómo se ve un proceso mal repartido

Un proceso puede estar bien armado y aun así repartir mal el trabajo: una persona sola con 110 términos mientras
otras tres esperan. Eso solo se ve cuando el proceso se encuentra con un libro, así que se calcula ahí
(`src/domain/processLoad.ts`): para cada paso, cuántas personas lo toman, cuánto mide su subtarea más grande y
cuántas personas esperan a que termine.

- **Dónde se ve:** en «Subtareas que se crearán», antes de crear el proyecto, y en la pantalla «Subtareas» de un
  proyecto. Arriba, en rojo, los pasos que cargan demasiado a una persona; dentro de cada tarea, la carga de cada
  paso.
- **Las reglas:** ningún paso que toma **una sola persona** debe pasar de **40 ítems** en una subtarea, y no deben
  quedar **más de 2 personas** esperando a una. Una organización cambia esos números con `workLoad` en
  `taller.config.ts`.
- **Cuánto mide una subtarea:** lo que su herramienta dice que recorre (`walks`); si no lo dice, de qué está hecha
  la subtarea: los versículos de un texto, las notas o las preguntas de sus pasajes, sus artículos.
- **Qué no cuenta:** un paso que se hace una vez por capítulo o por unidad, una lista de comprobación y un paso
  que completa su herramienta sola.
- **Con el proyecto en marcha solo pesa lo asignado sin entregar.** Antes de crear el proyecto la carga de un paso
  es su subtarea más grande: lo que le podría tocar a una persona. Una vez creado, cuenta lo que cada persona
  tiene de verdad: para un paso de una sola persona, todo lo que tiene asignado y no ha entregado, sumando sus
  subtareas. Lo entregado no es carga de nadie, y lo que nadie ha tomado todavía tampoco.
- **La prueba:** `npm run verify:process-load` corre las reglas sobre el proceso de fábrica con un libro del
  tamaño de Hageo y guarda la lista de lo que hoy se marca. Un cambio al proceso que agregue una línea a esa lista
  es una decisión que alguien toma, no algo que se cuela.

### `glossary`: nombres de planes antiguos

Los proyectos y los títulos de las subtareas guardan nombres como texto. Si un nombre cambió o se
quitó de la plantilla, el glosario del paquete permite seguir mostrándolo en otro idioma.

## Comprobar un paquete

```bash
npm run verify:templates    # el paquete está bien formado, completo en cada idioma, y recorre el motor
npm run verify:decoupling   # el código no nombra nada del proceso
```

`verify:templates` incluye un proceso inventado de **grabación de audio** que no existe en la app:
si el motor lo acepta y lo recorre, el motor es genérico.

Un paquete con errores no se arregla en silencio: en desarrollo la consola dice qué está mal, con
frases como «tarea «Validar»: espera a la fase «x», que no existe».

## Lo que el paquete todavía no puede cambiar

Lo que sigue dentro del código, y en qué fase del plan sale
([PLAN_PLANTILLAS.md](PLAN_PLANTILLAS.md)):

| Qué | Dónde está | Cuándo sale |
|---|---|---|
| **Los recursos** (TPL, TPS, notas, preguntas, palabras, academia) y que el trabajo se reparta en porciones de un libro de la Biblia | `ScopeKey`, el inventario, `workOrder.ts` | Fase 8, «tipo de trabajo» |
| **Las pantallas de las herramientas** (editor de texto, ayudas, afinación, alineación). El paquete elige cuáles usa y cómo se llaman; las pantallas son código | `src/components/*View.tsx` | Se agregan pantallas nuevas según haga falta; una herramienta externa no necesita código |
| **Los cuatro niveles** y sus nombres. Quién tiene cada nivel sí es dato: se asigna por equipo en Organización | `levels.ts` | Fase 8 |
| **El motor todavía no obedece `closing`, `checklist` ni `scope`**: los lee, los valida y los guarda, pero un paso se sigue completando con «Terminé» o «Aprobar» | `stepClaim.ts` | Fases 3 a 5 |
| **Publicar una versión** del texto | `PublishView`, `release.ts` | Fase 6 |
| Textos de ayuda en español dentro del modelo | `types.ts` | Fase 8 |

## Ajustes agregados el 2 de octubre de 2026

| Dónde | Campo | Qué dice |
|---|---|---|
| Plantilla | `resourceNames` | Cómo llama el proceso a cada recurso: `{ "tpl": { "name": "Biblia", "names": { "pt": "Bíblia" } } }`. Se copia al proyecto; lo que no se nombra conserva el nombre usual. |
| Plantilla | `nextBookAt` | Qué parte de la primera fase debe estar entregada (entre 0 y 1) para avisar a quien coordina de empezar el libro siguiente. Si no se dice, 0.7. |
| Tarea | `everyUnit: true` | La tarea recorre **cada unidad** de su alcance (cada capítulo o tramo), tenga o no artículos pendientes. Para revisiones de lo que ya existe. |
| Tarea | `waitsFor[].source: true` | La tarea que se espera es del **proyecto fuente**: el mismo libro, en la organización del paquete de recursos de origen. Libre solo cuando ese proyecto la cerró para el mismo capítulo. |
| Tarea | `waitsFor[].partial: true` | Basta **una parte** de lo esperado para empezar: la tarea queda libre cuando se cierra la primera porción de las que cubre, y sigue mientras llega el resto. Varias reglas parciales cuentan juntas (basta lo de cualquiera). Cuándo se puede terminar lo decide la herramienta. |
| Paso | `closing: "automatic"` | Lo completa su herramienta, sin que nadie lo marque. Una tarea con todos sus pasos automáticos se entrega sola. |
| Herramienta | `stepParams.<paso>.only: "linked"` | (Lista de comprobación) Recorre solo los ítems que enlazan un artículo. |
| Herramienta | `stepParams.<paso>.aligned: "tpl,tps"` | (Publicación) Textos que deben estar alineados para publicarse. |
| Herramienta | `stepParams.<paso>.endorsed: "no"` | (Publicación) El proceso no tiene comité: no se exige el aval. |

Un catálogo de herramientas guardado por la organización recibe solo los parámetros que le falten; lo que la
organización cambió se respeta.

**Un proyecto y la versión de su proceso.** El proyecto recuerda con qué versión se creó (`workflowVersion`). Cuando el
paquete sube de versión, «Proceso» ofrece traer lo nuevo: se agregan fases, tareas y pasos nuevos y se completan
ajustes que faltaban. Nada se cambia ni se quita.

**Otro proceso.** `processes/lengua-minoritaria.json` es un segundo paquete de ejemplo. Para usarlo se importa en
`taller.config.ts` y se agrega a `processes`. `npm run verify:second-process` comprueba que el motor lo ejecuta.
