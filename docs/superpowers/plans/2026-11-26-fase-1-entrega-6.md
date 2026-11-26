# Fase 1, entrega 6 — la lectura grupal como conversación (D2): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quien entra a la lectura grupal lee el pasaje de corrido en un solo texto, abre solo el versículo que le hace dudar, ve las caras de quienes están de acuerdo, llega a cada duda desde arriba y dice «Estoy de acuerdo con este pasaje» al final.

**Architecture:** ningún dato nuevo. Las respuestas siguen siendo `ReviewDecision` por versículo y texto (`appendMyDecisions`), y una propuesta sigue siendo una decisión del equipo (`openTextProposal`). Se agregan funciones puras en `src/domain/groupReading.ts` (quiénes están de acuerdo con un pasaje, qué guarda el acuerdo con el pasaje, por qué no se acuerda, las dudas de arriba) y se rehace la pantalla `GroupReadingView.tsx` con las piezas de la revisión en pares.

**Tech Stack:** React 18 + Vite + TypeScript; pruebas `scripts/verify-*.mts` con `tsx` y `node:assert/strict`; mock de Door43 (`scripts/mock-door43/server.mjs`); panel del navegador con `preview_start`.

**Spec:** [`docs/superpowers/specs/2026-11-26-fase-1-entrega-6-design.md`](../specs/2026-11-26-fase-1-entrega-6-design.md). Sus números de sección se citan abajo. Parte del plan de la fase, [`2026-11-24-fase-1-traduccion.md`](2026-11-24-fase-1-traduccion.md).

## Global Constraints

- Trabajo de **Idiomas Puentes**: Claude escribe, prueba y revisa con subagentes. Nunca Cursor.
- Las del plan de la fase valen aquí: textos con `useT()` / `tNow()` en `es.json` y `pt.json` (editados con Edit o con un guion que lee antes de escribir; tienen CRLF), «usted» en la app, ningún nombre de proceso en `src/` (`verify:decoupling`), límites de pantalla (spec 6), regla `html[data-text] … { font-size: calc(Xrem * var(--ts)); }` para cada texto nuevo, commits en inglés con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, nada se publica sin el OK de Abel, todo contra el mock.
- **No cambia la regla de cierre** (decisión 1) ni nada de lo que se escribe en Door43 (spec 5). Si una tarea parece pedir un dato nuevo, se para y se le pregunta a Abel.
- **No se toca `PortionReviewView`** salvo para sacar a un componente común algo que las dos pantallas usen, sin cambiar lo que la revisión en pares hace (`verify:review-items`, `review-changes`, `review-proposals` siguen pasando).
- **Rama:** `claude/fase-1-entrega-6`, desde `origin/main` (con el PR #65 fusionado) más la rama del diseño `claude/fase-1-entrega-6-diseno`.
- Pruebas que siguen pasando al cerrar: `npx tsc --noEmit -p .`, `verify:group-reading`, `verify:reading-arrivals`, `verify:review-round`, `verify:decoupling`, `verify:config`, `verify:guide`, `verify:text-size`, `verify:review-items`, `verify:review-proposals`. `verify:prep` falla desde antes.

## Review Focus

1. **El acuerdo con el pasaje no tapa una duda.** Una duda de otra persona, o una mía, deja ese versículo fuera de lo que se guarda (spec 3.5). Prueba en la Tarea 1 (`passageAgreement`).
2. **Una respuesta vieja no cuenta como acuerdo ni como cara**: si el versículo cambió después de que alguien estuvo de acuerdo, su cara se va de ese pasaje y el botón le vuelve a aparecer. Prueba en la Tarea 1.
3. **Una lectura con respuestas escritas por la versión de hoy** se abre igual: mismas caras, mismas dudas. Prueba en la Tarea 1 (con decisiones como las escribe hoy `answer`) y en el navegador en la Tarea 5.
4. **El cierre de 72 h**: con todo acordado, el pie no ofrece cerrar hasta que pasa el tiempo abierto, y luego sí. En el navegador con `?mockHoursAhead` (Tarea 5).

---

## Task 1: Lo que se calcula del pasaje (lógica pura)

**Files:**
- Modify: `src/domain/groupReading.ts`
- Test: `scripts/verify-group-reading.mts` (agregar pruebas)

**Interfaces (produce):**
Todas trabajan sobre **un texto** (el elegido) y saltan los versículos sin texto (como `readingProgress`).

- `passageAgreers(passage, text, chapter, tallies): string[]` — los logins con `approved` en `tally.answers` (vigente) en todos los versículos con texto del pasaje, en el orden en que respondieron. No mira niveles (spec 3.4).
«De otra persona» quiere decir: `tally.open` sin las respuestas de `me` (`open` incluye las mías). Un versículo `decided` no entra en ninguna lista.

- `passageAgreement(passage, text, chapter, tallies, me): { verses: number[]; othersDoubt: number[]; myDoubt: number[]; changed: number[] }` — `verses`: lo que guarda «Estoy de acuerdo con este pasaje» (sin acuerdo mío vigente, sin duda mía vigente, sin duda abierta de otra persona que yo no haya respondido; mi duda vieja sí entra); `othersDoubt`: con duda abierta de otra persona y sin respuesta mía vigente; `myDoubt`: mi duda vigente; `changed`: mi respuesta (acuerdo o duda) quedó vieja, para la línea «cambió» (spec 3.5).
- `passageBlocker(passage, text, chapter, tallies, minAgree): { kind: "doubt"; verses: number[] } | { kind: "tc"; verse: number } | { kind: "more" } | { kind: "independent" } | null` — del primer versículo no `agreed`: `open` no vacío → `doubt`; `selections` → `tc`; `agree < minAgree` → `more`; si no, `independent` (el `state` sigue `pending` aunque `agree` alcance: falta `minIndependent`; no hace falta mirar `agreeIndependent`). Un versículo `agreed` (también `decided`) no bloquea (spec 3.4).
- `openDoubts(passages, text, chapter, tallies, decisions, me): { verse: number; mine: boolean; answered: boolean }[]` — las dudas abiertas de lo que llegó del texto: las mías primero (`answered`: hay un acuerdo con nota de otra persona después de mi duda), luego por versículo (spec 3.6).
- `verseConversation(decisions, itemId, currentHash): { reviewer; status; note; timestamp; earlier: boolean }[]` — todo lo dicho con nota sobre un versículo, en orden de fecha, de `data.decisions` (no del conteo); `earlier`: sobre un texto anterior (spec 3.2).

- [ ] **Step 1:** Escribir las pruebas primero, con decisiones armadas como las escribe hoy `answer` (`decision()` en `GroupReadingView`): acuerdo vigente, acuerdo viejo (`textHash` distinto), duda de otro, duda mía (vigente y vieja), respuesta a una duda, autora que está de acuerdo, versículo vacío en el pasaje, versículo cerrado por decisión final con `agree` 0, persona de un nivel que no cuenta. Correrlas y verlas fallar.
- [ ] **Step 2:** Implementar las cinco funciones sobre `ItemTally` y las decisiones. No leer nada de Door43.
- [ ] **Step 3:** `npm run verify:group-reading` pasa; `npx tsc --noEmit -p .`. Commit («Group reading: who agrees with a passage, and what agreeing saves»).

## Task 2: El pasaje se lee como texto

**Files:**
- Modify: `src/components/GroupReadingView.tsx`, su CSS, `es.json`, `pt.json`
- Posible: un componente común con `PortionReviewView` para la pieza y sus puntos (spec 8)

- [ ] **Step 1:** Un solo texto a la vez: selector arriba solo si `data.texts.length > 1`, empezando por el primero con algo por responder (spec 3.1).
- [ ] **Step 2:** Cada versículo como pieza cerrada (`.rv-piece`, `.rv-piece__read`, `data-place`, `data-open`), con los puntos «conversación», «abierto» y «cambió» (spec 3.1). Fuera: `gr.lede`, «Mostrar fuentes», el estado por versículo, los tres botones.
- [ ] **Step 3:** El versículo abierto, de uno en uno, conservando lo escrito en una caja (spec 3.2, 3.9): fuente propia con la otra a pedido y `ParallelLink`; la conversación (`verseConversation`) con cara y nombre (`door43Person`, `PersonPhoto`), las dos últimas y «Ver N antes»; las caras de acuerdo de ese versículo; «Responder» (también si ya estoy de acuerdo; pide escribir) o «Ya no tengo la duda», y «No del todo…». Cerrada la lectura, sin acciones (spec 3.7).
- [ ] **Step 4:** «No del todo…» con «Proponer otras palabras» (la caja y los motivos de hoy, `correct` → `openTextProposal`, apagado si solo cambian espacios o comillas, con la misma función que usa la entrega 5) y «Comentar algo» (la duda de hoy; abre con mi duda escrita si la tengo) (spec 3.3).
- [ ] **Step 5:** `npx tsc --noEmit -p .`, `verify:config`, `verify:decoupling`, `verify:text-size`. Commit («Group reading: read the passage as text, open one verse at a time»).

## Task 3: El final del pasaje, arriba y el pie

**Files:**
- Modify: `src/components/GroupReadingView.tsx`, su CSS, `es.json`, `pt.json`

- [ ] **Step 1:** Al final de cada pasaje que llegó: las caras (`passageAgreers`), la línea de `passageBlocker` con enlace al versículo, «Estoy de acuerdo con este pasaje» (guarda `passageAgreement().verses` con `answer`) y «No del todo…», que abre la hoja «¿En qué versículo?» (spec 3.3, 3.4, 3.5).
- [ ] **Step 2:** El botón con borde hasta ver el último versículo del pasaje (`IntersectionObserver` con `root` en `.fam__body`, como `seen` en `PortionReviewView`), la pregunta si se toca antes, y solo el primer pasaje que me falta lleno (spec 3.5).
- [ ] **Step 3:** La línea de arriba con las dudas (`openDoubts`), cada número desplaza `.fam__body` y abre el versículo (spec 3.6).
- [ ] **Step 4:** El pie según la tabla de spec 3.7, con un solo botón lleno.
- [ ] **Step 5:** `npx tsc --noEmit -p .`, `verify:config`, `verify:text-size`. Commit («Group reading: agree with the passage at its end, doubts a touch away»).

## Task 4: La guía y los textos que sobran

**Files:**
- Modify: `src/components/screenGuides.tsx` (`ReadingGuide`), `es.json`, `pt.json`

- [ ] **Step 1:** `ReadingGuide` con tres pasos: un versículo (`kind: "tap"`, con `when` / `done` / `watch` como `ReviewGuide`, cuya firma copia), «No del todo…» dentro de él, el botón del final del pasaje; claves `reading:piece`, `reading:notQuite`, `reading:passage` (spec 3.8).
- [ ] **Step 2:** Borrar las claves `gr.*` y `guide.reading*` que ya no se usan, en los dos idiomas. `npm run translations:review` para las nuevas en portugués.
- [ ] **Step 3:** `verify:guide`, `verify:config`. Commit («Group reading: the guide points at a verse, «No del todo…» and the passage»).

## Task 5: En el navegador, y lo pendiente del #67

Con el mock propio y los guiones del relevo de la construcción. A 375 y 1280 px, en español y portugués.

- [ ] **Step 1:** El recorrido de spec 7, pasos 1 a 7, con Ana, Bea y Carla. `audit("lectura")` con un versículo abierto: como mucho 12 controles, ninguno de menos de 44 px, un botón lleno, dos pantallas de alto.
- [ ] **Step 2:** El cierre de 72 h: con todo acordado, `?mockHoursAhead=73`, cerrar, y ver que la tarea sale de «Mis tareas» de las tres personas.
- [ ] **Step 3:** La revisión en pares de Palabras y Academia (#67): sembrar un artículo en el mock (si el mock no tiene esos repositorios, agregarlos a la siembra y decirlo en el PR), proponer, usar, aprobar. Lo que falle y no sea de esta entrega va a un issue.
- [ ] **Step 4:** Revisión del diff entero por un pez dorado (Sonnet) con el diseño; corregir; uno nuevo revisa lo corregido hasta que salga limpio. Comentar en el #67 lo que se comprobó.
