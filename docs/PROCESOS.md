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
| **Desde la app** | `workflows.json` y `solvers.json`, en el repositorio de tareas de la organización en Door43 | Quien coordina, en **Plantillas** | Copias propias: se parte de una plantilla de fábrica («+ Desde …») o de cero, y se ajusta |

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
| **Los cuatro niveles** y sus nombres | `levels.ts` | Fase 2 |
| **El motor todavía no obedece `closing`, `checklist` ni `scope`**: los lee, los valida y los guarda, pero un paso se sigue completando con «Terminé» o «Aprobar» | `stepClaim.ts` | Fases 3 a 5 |
| **Publicar una versión** del texto | `PublishView`, `release.ts` | Fase 6 |
| Textos de ayuda en español dentro del modelo | `types.ts` | Fase 8 |
