# «Mis tareas»: la fase de cada tarjeta — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando las tarjetas de «Mis tareas» son de más de una fase, cada una lleva una etiqueta con el nombre de su fase y un color propio.

**Architecture:** Una función pura nueva (`src/domain/phaseBadges.ts`) dice la fase de una tarjeta y si un tablero mezcla fases. `MyTasksBoard` decide si se muestran y se las pasa a `TaskCard`, que las pinta en una fila sobre el título junto a «nueva». Los colores son tokens en `tokens.css`, elegidos por el orden de la fase.

**Tech Stack:** React 18 + TypeScript, pruebas `tsx` en `scripts/verify-*.mts`.

**Spec:** `docs/superpowers/specs/2026-11-24-mis-tareas-fase-de-cada-tarjeta-design.md`

## Global Constraints

- Ningún id ni nombre de fase del FCR en `src/` (`npm run verify:decoupling`).
- Texto de interfaz por `useT()`; claves nuevas en `es.json` y `pt.json` (`npm run verify:config`).
- Sin azul (acción), ámbar (decidir) ni rojo (peligro) en la etiqueta; el nombre siempre escrito, el color solo ayuda.
- La franja izquierda de la tarjeta no se toca (significa «en curso»).
- Comentarios y commits en inglés; commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Dos libros con la misma fase («Traducción» de Esdras y de Nehemías): no es «mezcla»; sin etiqueta. Prueba en Task 1.
2. Solo las tarjetas terminadas son de otra fase: no es mezcla (lo terminado está plegado al final). Prueba en Task 1.
3. Una tarjeta sin tarea o sin proyecto (una decisión cuyo proyecto no se encontró): sin etiqueta, sin error. Prueba en Task 1.
4. Una fase sin `order` o con órdenes repetidos: el color sigue siendo estable. Prueba en Task 1.
5. Una tarjeta «nueva» con etiqueta: «nueva» va en la misma fila, no dos píldoras apiladas. Se mira en el navegador (Task 2).

---

### Task 1: La fase de una tarjeta, pura

**Files:**
- Create: `src/domain/phaseBadges.ts`
- Create: `scripts/verify-phase-badges.mts`
- Modify: `package.json` (script `verify:phase-badges`)

**Interfaces:**
- Produces:
  - `export const PHASE_TONES = 5`
  - `export type PhaseBadge = { name: string; names?: Localized; tone: number }` — `tone` de 1 a 5.
  - `export function phaseOfCard(card: Pick<BoardCard, "task" | "bucket">): PhaseBadge | undefined` — la fase `card.task.phaseId` en `card.bucket.board.phases`; `tone` = posición de esa fase entre las fases del plan ordenadas por `order` (empate: el orden en que vienen), módulo 5, más 1.
  - `export function mixesPhases(cards: Pick<BoardCard, "task" | "bucket" | "group">[]): boolean` — más de un nombre de fase distinto (por `name`, sin mayúsculas ni espacios de más) entre las tarjetas que no son `group === "done"`.

- [ ] **Step 1: Escribir las pruebas** en `scripts/verify-phase-badges.mts`, con el estilo de `verify-my-tasks-board.mts` (`test(name, fn)` y `ok  …`). Un plan con fases `[{id:"a",name:"Traducción",order:0},{id:"b",name:"Afinación",order:1},{id:"c",name:"Armonización",order:2}]`:
  - `phaseOfCard` de una tarea de `b` → `{ name: "Afinación", tone: 2 }`.
  - Una sexta fase (order 5) → `tone: 1`.
  - Fases sin `order` → el tono sale del orden en que vienen.
  - Sin `task`, sin `bucket` o con `phaseId` que no está → `undefined`.
  - `mixesPhases`: una sola fase → `false`; `a` y `b` → `true`; «Traducción» de dos proyectos con ids distintos → `false`; `a` abierta y `b` solo en `done` → `false`; una tarjeta sin tarea más una de `a` → `false`.
- [ ] **Step 2:** `npx tsx scripts/verify-phase-badges.mts` → falla (el módulo no existe).
- [ ] **Step 3:** Implementar `src/domain/phaseBadges.ts`.
- [ ] **Step 4:** La misma orden → todas `ok`. Agregar `"verify:phase-badges": "tsx scripts/verify-phase-badges.mts"` a `package.json`.
- [ ] **Step 5: Commit** «My tasks: tell the phase of each card when there are several».

### Task 2: La etiqueta en la tarjeta

**Files:**
- Modify: `src/components/MyTasksBoard.tsx`, `src/components/TaskCard.tsx`
- Modify: `src/styles/tokens.css`, `src/styles/components.css`
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/pt.json`

**Interfaces:**
- Consumes: `phaseOfCard`, `mixesPhases`, `PhaseBadge` (Task 1); `localized` de `src/domain/processes.ts`.
- Produces: prop `phase?: PhaseBadge` de `TaskCard`.

- [ ] **Step 1: `MyTasksBoard`:** `const mixed = mixesPhases(all)`; a cada `TaskCard`, `phase={mixed ? phaseOfCard(card) : undefined}`; la búsqueda también compara el nombre de la fase en el idioma de la interfaz; el título del grupo `free` usa `tb.group.freeMany` cuando `mixed`.
- [ ] **Step 2: `TaskCard`:** con `phase`, una fila `div.task-card__tags` antes de `.task-card__top` con `span.task-card__phase[data-tone]` (el nombre con `localized(phase.name, phase.names, language)`) y la marca «nueva», que entonces sale del `h3`. Sin `phase`, la tarjeta queda exactamente como hoy.
- [ ] **Step 3: Estilos:** en `tokens.css`, `--phase-N-bg` y `--phase-N-fg` para N = 1…5: verde `#e3f1df/#2f5b26`, violeta `#efe6f7/#5b2d84`, cian `#dcf0f5/#0f5466`, arena `#f1e8dc/#6b4423`, magenta `#f7e4ef/#86245a` (todos ≥ 7:1). En `components.css`: la fila con `gap: var(--space-8)` y la píldora como `.task-card__new` (13 px, 700, `radius-full`), con color por `data-tone`. Con la fila presente, `.task-card__new` dentro de ella no lleva `margin-right`.
- [ ] **Step 4: Claves:** `"tb.group.freeMany": "Libres para tus equipos"` (es) y `"Livres para suas equipes"` (pt), junto a `tb.group.free`.
- [ ] **Step 5: Comprobar:** `npx tsc --noEmit -p .`, `npm run verify:phase-badges`, `verify:my-tasks-board`, `verify:config`, `verify:decoupling`, `verify:text-size` (ya fallaba en `main`: comparar con `main`, no debe fallar más).
- [ ] **Step 6: En el navegador**, con el tablero de prueba (el FCR real, tarjetas de Traducción y Afinación) a 375 px y en escritorio: la etiqueta sobre el título, «nueva» a su lado, nada que se desborde, objetivos táctiles intactos, y sin etiqueta cuando todas son de una fase. Pasar la lista de `docs/FILOSOFIA_DE_DISENO.md`.
- [ ] **Step 7: Commit** «My tasks: a phase label on each card when the person works in several».

## Después

Una revisión de un subagente nuevo (Sonnet) sobre el diff entero; corregir lo que encuentre y que otro nuevo revise lo que cambió, hasta que salga limpio. Luego PR con el OK de Abel, y publicar solo con `npm run deploy -- --publish` cuando él lo diga.
