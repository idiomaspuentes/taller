# «Mis tareas»: tarjetas que se entienden — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que cada tarjeta de «Mis tareas» diga en una línea qué pasa y qué hacer, en cuatro secciones según a quién le toca, con una barra que muestre en qué punto del camino va el trabajo.

**Architecture:** la clasificación sigue en `buildBoard` (`src/domain/myTasksBoard.ts`), que conserva sus nueve grupos y además da a cada tarjeta su **situación** (uno de los estados de la tabla del diseño) y su **sección**. Tres módulos puros nuevos en `src/domain/`: la situación, el camino del trabajo y lo que llegó a la lectura en grupo. La pantalla (`MyTasksBoard.tsx`, `TaskCard.tsx`) solo dibuja lo que esos módulos dicen. Las palabras de los pasos salen del paquete del proceso.

**Tech Stack:** React 18 + Vite + TypeScript; pruebas `scripts/verify-*.mts` con `tsx` y `node:assert/strict`; panel del navegador de la app con `preview_start`.

**Spec:** [`docs/superpowers/specs/2026-11-24-tarjetas-claras-design.md`](../specs/2026-11-24-tarjetas-claras-design.md), con sus pasadas en `../specs/tarjetas-pasadas/`. Relevo: `C:\Users\LENOVO\Git\Github\gateway-tasks\.claude\relevos\2026-11-24-tarjetas.md`.

**Dónde:** el trabajo parte de la rama local `tarjetas-claras` (diseño 3b4c88d sobre `main` 5232a41), que ya tiene unida la rama `mis-tareas-fase` (PR #54, la etiqueta de fase). Se construye en el worktree `.claude/worktrees/affectionate-roentgen-f9bf3b` (rama `claude/affectionate-roentgen-f9bf3b`, puesta en ese mismo punto) porque la sesión no puede escribir en el worktree `tarjetas`; se sube como `tarjetas-claras` (`git push origin HEAD:tarjetas-claras`). El worktree no necesita `npm install`.

## Global Constraints

- Trabajo de **Idiomas Puentes**: Claude escribe, prueba y revisa con subagentes. Nunca Cursor.
- Decisiones de Abel (24-11): reclasificar en secciones, no solo ordenar (corrige el B1 de la Fase 1); la barra del camino se queda junto a «Ahora · Sigue» y reemplaza la de porcentaje; la vista por capítulo para quien coordina va después; la etiqueta de fase es la **fase**.
- El código no conoce ningún proceso: ningún id ni nombre de fase, tarea, paso o herramienta en `src/` (`npm run verify:decoupling`). La lectura en grupo se reconoce por `closing: "consensus"`, no por su nombre. Las pruebas en `scripts/` sí pueden usar el FCR.
- Texto con `useT()`; el español en `src/i18n/locales/es.json`, el portugués en `pt.json`; `npm run verify:config` y `npm run translations:review`. Los textos de las tarjetas pasan de «tú» a **«usted»**.
- `es.json` y `pt.json` se editan con la herramienta Edit o con un guion que lee antes de escribir. Nunca abrir para escribir y leer en la misma expresión.
- Cada texto nuevo lleva su regla `html[data-text] … { font-size: calc(Xrem * var(--ts)); }`.
- Pantalla a 375 px: una sola cosa obvia, un botón lleno, nada de menos de 44 px; 24–32 px entre grupos, 8–12 dentro ([`docs/FILOSOFIA_DE_DISENO.md`](../../FILOSOFIA_DE_DISENO.md)). Nada de cajas amarillas.
- No cambia quién puede tomar o cerrar un paso, ni los pasos del proceso, ni las herramientas.
- Comentarios y commits en inglés, título corto y cuerpo con el porqué, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nada se sube, se publica ni se une sin el OK de Abel. Door43 de producción no se toca.
- Pruebas que deben pasar al final: `npx tsc --noEmit -p .`, `verify:my-tasks-board`, `verify:phase-badges`, `verify:config`, `verify:decoupling`, `verify:templates`, y las nuevas. `verify:text-size` y `verify:prep` ya fallan en `main`: no deben fallar más.

## Decisiones de este plan

Lo que el diseño deja a quien construye, decidido aquí:

1. **Los nueve grupos se quedan** en `Board` (las pruebas y `phaseBadges` los usan). La sección es un campo nuevo de la tarjeta, calculado en `buildBoard`, y `boardSections(board)` arma las cuatro secciones en su orden.
2. **Las palabras de un paso que el diseño fija para el FCR** («Estudie el pasaje antes de traducir.», «Seguir con el estudio», «Unirse a la lectura», «El capítulo {n} se lee en grupo.») van en el paquete, en un campo nuevo `card` del paso. Se leen como `stepPurpose`: del plan del proyecto o, si no las tiene, del paquete tal como se publica hoy, por id de tarea y de paso. Así Esdras y Ester las tienen sin aplicar una versión nueva del proceso. Sin ellas, la app usa palabras generales.
3. **«Faltan las respuestas de {n} personas»** (estado 22) se dice sin número: la app no sabe cuántas personas de un equipo van a sumarse. Queda «Ya respondió. Faltan las respuestas de su equipo.».
4. **El aviso al entregar y «Para quién es el trabajo»** nombran el paso que sigue con su nombre del paquete: «Entregado. Pasa a «Lectura grupal» del capítulo 3.». La app no puede saber que ese paso es «la lectura».
5. **Cuándo se acaba la barra:** si todos los pasos de la tarea están hechos, no hay «Ahora»; la frase es solo «Sigue: …». Para «Sigue» de otra fase cuentan las reglas por `taskId` que nombran la última tarea de la barra y las reglas por `phaseId` que nombran su fase, con `scope: "chapter"` y sin `source`; la primera tarea en el orden del plan.
6. **Lo pausado** va a «Más · En pausa» con la línea «Este proyecto está en pausa.» y conserva su botón como enlace.
7. **Orden dentro de cada sección:** «Le toca a usted»: las decisiones, luego lo que volvió a la persona, luego lo demás en el orden de grupos de hoy (`doing`, `todo`, `reviews`). «Esperan»: lo ya respondido primero, luego lo demás. «Para tomar»: revisiones en pares (alguien espera), luego lecturas en grupo, luego trabajo libre. «Más»: no se puede empezar, libro siguiente, pausado, terminado.

## Review Focus

1. **Un proyecto creado antes de este cambio** (Esdras, Ester): sus pasos no tienen `card`. Deben salir las palabras del paquete publicado; y en una tarea que el paquete no tiene, palabras generales, nunca un botón vacío. Prueba en la Tarea 2.
2. **Una tarjeta que volvió a la persona en un proyecto pausado**: va a «Más · En pausa», no a «Le toca a usted», y el botón lleno no la elige. Prueba en la Tarea 4.
3. **`openIssues` desconocido** (la lista guardada en el aparato antes de leer Door43): sin línea de llegada; la lectura usa su línea del paquete o la general. Prueba en la Tarea 5.
4. **Letra a 1.3 y portugués** (palabras más largas): la barra crece con la letra, los botones de cuatro palabras caben a 375 px sin partirse feo. Se mide en la Tarea 9.
5. **Dos motivos a la vez** (falta mi acuerdo en un pasaje y me pidieron cambios en otro) y **un pasaje libre como lo siguiente**: el botón lleno va a lo que volvió a mí; sin nada mío, a «Para tomar», que se abre sola. Prueba en la Tarea 4 (es la que el plan de la Fase 1 tenía en su Tarea 1.1).

---

### Task 1: El camino del trabajo

**Files:**
- Create: `src/domain/workPath.ts`
- Create: `scripts/verify-work-path.mts`; script `verify:work-path` en `package.json` (`tsx --tsconfig tsconfig.scripts.json scripts/verify-work-path.mts`)

**Interfaces:**
- Consumes: `AssignmentsDoc`, `ProjectTask`, `TaskStep`, `Phase`, `WaitRule` de `src/domain/types.ts`.
- Produces:
  - `export type PathSegment = { taskId: string; step: TaskStep; state: "done" | "now" | "todo" }`
  - `export type PathNext = { kind: "step"; step: TaskStep; taskId: string } | { kind: "phase"; phase: Phase }`
  - `export type WorkPath = { segments: PathSegment[]; now?: TaskStep; next?: PathNext }`
  - `export function chainRule(task: ProjectTask, board: Pick<AssignmentsDoc, "teams">): WaitRule | undefined` — la primera regla de `task.waitsFor` que cuenta para la cadena: `taskId` de **otra** tarea de la **misma fase**, `scope: "chapter"`, sin `source` (con `partial` o sin él).
  - `export function chainBefore(taskId: string, board): ProjectTask[]` — de la más antigua a la anterior a `taskId`, siguiendo `chainRule`; se detiene si vuelve a una tarea vista.
  - `export function chainAfter(taskId: string, board): ProjectTask[]` — hacia adelante: en cada paso, la primera tarea en el orden de `board.teams` cuya `chainRule` nombra la actual; se detiene si vuelve a una vista.
  - `export function nextPhaseAfter(taskId: string, board: Pick<AssignmentsDoc, "teams" | "phases">): Phase | undefined` — la fase de la primera tarea (orden del plan) de **otra** fase con una regla `scope: "chapter"`, sin `source`, que nombra `taskId` o la fase de `taskId` (decisión 5).
  - `export function workPath(taskId: string, board: Pick<AssignmentsDoc, "teams" | "phases">, doneStepIds: string[]): WorkPath | undefined` — `undefined` si la tarea no está en el plan o la barra queda sin pasos.
  - `export function handOffTarget(taskId: string, board): PathNext | undefined` — adónde va el trabajo al entregarse: el primer paso de la primera tarea de `chainAfter`; si no hay, `nextPhaseAfter`.

- [ ] **Step 1: Escribir las pruebas que fallan**

El plan de prueba es el FCR publicado: `const fcr = processPlan("fcr-base", { lang: "es-419", contentOrg: "x", pmOrg: "y" })!` (`src/domain/processes.ts:45`). Ayudante `const names = (p: WorkPath) => p.segments.map((s) => `${s.step.name}:${s.state}`)`.

```ts
await test("Traducir TPL en el borrador: estudio hecho, borrador ahora, y siguen la revisión en pares y la lectura", () => {
  const p = workPath("tpl", fcr, ["familiarizar"])!;
  assert.deepEqual(names(p), ["Estudio:done", "Borrador:now", "Revisión en pares:todo", "Lectura grupal:todo"]);
  assert.equal(p.now?.name, "Borrador");
  assert.equal(p.next?.kind === "step" && p.next.step.name, "Revisión en pares");
});
await test("la lectura grupal muestra hechos los pasos de antes, aunque nadie de esta subtarea los cerró, y sigue Afinación", () => {
  const p = workPath("revision-grupal-tpl", fcr, [])!;
  assert.deepEqual(names(p), ["Estudio:done", "Borrador:done", "Revisión en pares:done", "Lectura grupal:now"]);
  assert.equal(p.next?.kind === "phase" && p.next.phase.name, "Afinación");
});
await test("Traducir Notas: sin lectura después; al final de la barra sigue Armonización", () => {
  const start = workPath("notas-ayuda", fcr, [])!;
  assert.equal(start.next?.kind === "step" && start.next.step.name, "Borrador");
  const end = workPath("notas-ayuda", fcr, ["familiarizar", "borrador"])!;
  assert.equal(end.now?.name, "Revisión en pares");
  assert.equal(end.next?.kind === "phase" && end.next.phase.name, "Armonización");
});
await test("Afinación no trae los pasos de Traducción: la cadena es solo de la misma fase", () => {
  assert.deepEqual(names(workPath("palabras-tpl", fcr, [])!), ["Revisar frases con nota:done", "Revisar palabras clave:now", "Alinear y revisar:todo"]);
});
await test("con todos los pasos hechos no hay «Ahora», y «Sigue» dice adónde va (una regla por fase también cuenta)", () => {
  const p = workPath("alinear-tpl", fcr, ["alinear"])!;
  assert.equal(p.now, undefined);
  assert.equal(p.next?.kind === "phase" && p.next.phase.name, "Armonización");
});
await test("al entregar Traducir TPL, el trabajo pasa a la lectura grupal; al entregar la lectura, a Afinación", () => {
  const t = handOffTarget("tpl", fcr);
  assert.equal(t?.kind === "step" && t.step.name, "Lectura grupal");
  assert.equal(handOffTarget("revision-grupal-tpl", fcr)?.kind, "phase");
});
await test("una tarea que no está en el plan no tiene barra", () => {
  assert.equal(workPath("no-existe", fcr, []), undefined);
});
await test("una cadena que vuelve sobre sí misma se detiene, y de dos que esperan a la misma va la primera del plan", () => {
  // Plan hecho a mano: a y b se esperan por capítulo una a la otra; c y d esperan a a (d antes que c en teams).
  // Expected: workPath("a", …) termina; chainAfter("a", …)[0].id === "b" o "d" según el orden de teams, nunca se cuelga.
});
```

Run: `npm run verify:work-path`
Expected: FAIL («Cannot find module …/workPath»).

- [ ] **Step 2: Escribir `src/domain/workPath.ts`** con las firmas de arriba. Pasos de antes: los de `chainBefore`, todos `done` (la barra dibuja el camino, no cuánto llevan otras personas). Pasos de la tarea: `done` si su id está en `doneStepIds`, el primero que no está es `now`, los demás `todo`. Pasos de `chainAfter`: `todo`. `next`: el segmento después de `now`; si no hay `now`, el primero `todo`; si la barra se acaba, `nextPhaseAfter` de la última tarea de la barra.

- [ ] **Step 3: Ver que pasan** — `npm run verify:work-path` → todas `ok`. `npm run verify:decoupling` → PASS.

- [ ] **Step 4: Commit** — «My tasks: the path a piece of work goes along», con el porqué: nada decía en qué punto del camino iba un trabajo; una lectura en grupo y un borrador se veían igual.

### Task 2: Las palabras de cada paso, del paquete

**Files:**
- Modify: `src/domain/types.ts` (`TaskStep`, junto a `actionLabel`, línea 379)
- Modify: `src/domain/processes.ts` (función nueva junto a `stepPurpose`, línea 67)
- Modify: `src/domain/store.ts` (`normalizeTaskSteps`), `src/domain/workflowCheck.ts`
- Modify: `processes/fcr.json` (con un guion que lee el archivo, comprueba que se reescribe igual sin cambios, y conserva CRLF)
- Test: `scripts/verify-work-path.mts` (mismo archivo: son lecturas del paquete)

**Interfaces:**
- Produces:
  - En `TaskStep`: `card?: StepCardWords`, con `export type StepCardWords = { line?: string; lines?: Localized; continue?: string; continues?: Localized; join?: string; joins?: Localized; offer?: string; offers?: Localized }`. `line`: lo que hace la persona en el paso (estados 5, 6 y 21 sin llegadas). `continue`: el botón para seguir en él. `join`: el botón para sumarse. `offer`: la línea de un paso de grupo que se ofrece; puede llevar `{n}`, el capítulo.
  - `export function stepCardWords(taskId: string, step: Pick<TaskStep, "id" | "card"> | undefined, language: string, packages?: ProcessPackage[]): { line?: string; continue?: string; join?: string; offer?: string }` — localizadas; de `step.card` si existe, si no del paso publicado con el mismo id de tarea y de paso.

- [ ] **Step 1: Pruebas que fallan**

```ts
await test("las palabras de un paso salen del paquete aunque el plan del proyecto no las tenga", () => {
  const borrador = { id: "borrador" }; // como en un plan guardado antes de este cambio
  assert.equal(stepCardWords("tpl", borrador, "es").line, "Escriba su traducción del pasaje.");
  assert.equal(stepCardWords("tpl", borrador, "es").continue, "Seguir con mi borrador");
  assert.equal(stepCardWords("palabras-ayuda", borrador, "es").line, "Escriba su traducción del artículo.");
  assert.equal(stepCardWords("revision-grupal-tpl", { id: "lectura" }, "pt").join, "Entrar na leitura");
});
await test("lo que el proyecto escribió manda sobre el paquete, y una tarea que el paquete no tiene no da palabras", () => {
  assert.equal(stepCardWords("tpl", { id: "borrador", card: { line: "Propia" } }, "es").line, "Propia");
  assert.deepEqual(stepCardWords("tarea-propia", { id: "borrador" }, "es"), {});
});
```

- [ ] **Step 2: El tipo, la función y el paquete.** En `processes/fcr.json`, `card` en estos pasos (español / portugués):

| Tareas | Paso | `line` | `continue` | `join` | `offer` |
|---|---|---|---|---|---|
| tpl, tps, notas-ayuda, preguntas-ayuda | familiarizar | Estudie el pasaje antes de traducir. / Estude a passagem antes de traduzir. | Seguir con el estudio / Continuar o estudo | | |
| tpl, tps, notas-ayuda, preguntas-ayuda | borrador | Escriba su traducción del pasaje. / Escreva sua tradução da passagem. | Seguir con mi borrador / Continuar meu rascunho | | |
| palabras-ayuda, academia-ayuda | borrador | Escriba su traducción del artículo. / Escreva sua tradução do artigo. | Seguir con mi borrador / Continuar meu rascunho | | |
| revision-grupal-tpl, revision-grupal-tps | lectura | Lea con su equipo los pasajes que llegaron. / Leia com sua equipe as passagens que chegaram. | Seguir con la lectura / Continuar a leitura | Unirse a la lectura / Entrar na leitura | El capítulo {n} se lee en grupo. / O capítulo {n} é lido em grupo. |

- [ ] **Step 2b: Que el paquete no pierda `card` al cargarse.** `normalizeTaskSteps` (`src/domain/store.ts`, el `steps.push` de ~561) arma cada paso con una lista fija de campos, y `shippedWorkflows` pasa por ella: `card` se descarta. Se agrega `export function normalizeCardWords(raw: unknown): StepCardWords | undefined` en `store.ts` y el paso lo conserva. `workflowCheck.ts` (junto a `actionLabels`, ~140) comprueba cada texto de `card` en todos los idiomas del proceso, como el nombre. La prueba del Step 1 ya lee por `shippedWorkflows`, no el JSON.

- [ ] **Step 3:** `npm run verify:work-path; npm run verify:templates; npm run verify:decoupling; npx tsc --noEmit -p .` → PASS.

- [ ] **Step 4: Commit** — «Process: the words a card says for each step», porqué: «Estudiar» y «Traducir» decían qué hacer, no qué pasa; el código no puede decir «pasaje» o «lectura» sin conocer el proceso.

### Task 3: La situación de cada tarjeta

**Files:**
- Create: `src/domain/cardSituation.ts`
- Modify: `src/domain/myTasksBoard.ts` (`BoardCard`, 54; `buildBoard`: las ramas de espera 332 y 386, y el bucle final 417-430)
- Create: `scripts/verify-card-situation.mts`; script `verify:card-situation`

**Interfaces:**
- Consumes: `changesPending`, `takenBackByAuthor`, `handedInAgain`, `stepClaimMode` (`src/domain/stepClaim.ts`); `getStepRuntime`, `parseTaskProgressMarker` (`taskProgress.ts`); `waitBlocks` (`waits.ts:152`).
- Produces:
  - `export type BoardSection = "mine" | "waiting" | "take" | "more"`
  - `export type MorePart = "held" | "later" | "paused" | "done"`
  - `export type CardState = "free" | "nextBook" | "held" | "toStart" | "ownStep" | "finishStep" | "noReviewer" | "beingReviewed" | "changesAsked" | "correcting" | "yourAgreement" | "toDeliver" | "done" | "withdrawn" | "reviewOffered" | "reviewing" | "askedChanges" | "authorCorrecting" | "correctedLook" | "authorDelivers" | "groupNotYet" | "groupOffered" | "group" | "answered" | "approved" | "groupToDeliver" | "decide" | "proposals" | "paused"`
  - `export type CardSituation = { state: CardState; section: BoardSection; morePart?: MorePart; returned: boolean; who?: string[] }` — `who`: las personas que nombra la línea (sin `@`); ausente o vacío si no hay a quién nombrar.
  - `export function cardSituation(card: Omit<BoardCard, "situation">, login: string): CardSituation` — el progreso se lee de `card.issue.body` (`parseTaskProgressMarker`) y los pasos de `card.task?.steps`.
  - En `BoardCard`: `situation: CardSituation`; `waitsFirstPassage?: boolean` (lo que la retiene son solo reglas `partial`: espera el primer pasaje).

**Palabras de la tabla:**
- «autora»: la persona asignada a la subtarea (`issue.assignee`).
- «revisión de un borrador»: el paso que se toma es de una subtarea **con autora** y no tiene `closing: "consensus"`.
- «paso de grupo»: cualquier otro paso que se toma: con `closing: "consensus"` (lectura, Afinación), o de una subtarea **sin autora** (las listas de Armonización, Validación). Por eso sus estados se llaman `group*` y sus textos salen del paquete o dicen «su equipo», nunca «la lectura».
- «un paso con X»: se recorren los pasos de la tarea y se toma el primero para el que `X(steps, progress, step, autora)` es verdadero.

**Cómo se decide** (la primera fila que coincide gana; el orden importa: la 8 va antes de la 13 porque a quien revisa, con cambios pedidos, `stepAction` le da `assigneeDelivers`):

| # | Condición | Estado | Sección | `returned` | `who` |
|---|---|---|---|---|---|
| 1 | `group === "done"` | `withdrawn` si quedan pasos sin hacer (`stepsDone < stepsTotal`), si no `done` | more/done | no | |
| 2 | `group === "paused"` | `paused` | more/paused | no | |
| 3 | `group === "later"` | `nextBook` | more/later | no | |
| 4 | `group === "decide"` | `decide` | mine | no | |
| 5 | `action.kind === "proposals"` | `proposals` | mine | no | |
| 6 | `action` none `hold` y `group === "waiting"` | `groupNotYet` si `waitsFirstPassage`, si no `held` | more/held | no | |
| 7 | `action` none `othersAnswer` | `answered` si el paso tiene herramienta (`solverAppId`), si no `approved` (lo que hoy dice `tb.othersApprove`) | waiting | no | |
| 8 | un paso con `changesPending` | si la persona es la autora: `correcting` si ese paso da `takenBackByAuthor`, si no `changesAsked`. Si no es la autora: `authorCorrecting` si `takenBackByAuthor`, si no `askedChanges` | autora: mine; otra: waiting | sí solo en `changesAsked` | si no es la autora: la autora |
| 9 | `action.kind === "deliver"` | `groupToDeliver` si el último paso es de grupo, si no `toDeliver` | mine | sí | |
| 10 | no es la autora, un paso con `handedInAgain`, está sentada en él y no aprobó | `correctedLook` | mine | no | la autora |
| 11 | es la autora; la acción es `begin`, `continue` o `approveStep` sobre un paso que se toma con `includeAuthorInApproval` | si hay aprobaciones y todas son de otras personas: `yourAgreement`; si el paso tiene sentados: `beingReviewed`; si no `noReviewer` | `yourAgreement`: mine; las otras: waiting | sí solo en `yourAgreement` | quienes aprobaron / los sentados |
| 12 | `action` none `othersReview` | `beingReviewed` si el paso tiene sentados, si no `noReviewer` | waiting | no | los sentados |
| 13 | `action` none `assigneeDelivers` | `authorDelivers` | waiting | no | la autora |
| 14 | `claimStep` | revisión de un borrador: `reviewOffered`; paso de grupo: `groupOffered` | take | no | la autora en `reviewOffered` |
| 15 | `approveStep` (no es la autora) | `closing: "self"`: `finishStep`; revisión de un borrador: `reviewing`; paso de grupo: `group` | mine | no | la autora en `reviewing` |
| 16 | `begin`/`continue` en un paso que se toma (no es la autora) | revisión de un borrador: `reviewing`; paso de grupo: `group` | mine | no | la autora en `reviewing` |
| 17 | `begin` | `group === "free"`: `free` (take); si no `toStart` (mine) | | no | |
| 18 | `continue` | `ownStep` | mine | no | |
| 19 | `action` none `hold` y `group === "free"` (persona oyente) | `free` | take | no | |
| 20 | lo demás | `held` | more/held | no | |

Además `returned` es verdadero para una tarjeta de «mine» con `askedBack` o `redoOf`. Para que la fila 11 vea a la autora en una revisión sin herramienta (planes viejos), `approveStep` está en ella antes que en la 15.

- [ ] **Step 1: Pruebas que fallan.** Un plan propio de la prueba con una tarea `par` (pasos `borrador` `closing: "self"` y `pares` `claimMode: "exclusive"`, `closing: "approval"`, `includeAuthorInApproval: true`) y una `grupo` (paso `lectura`, `claimMode: "pool"`, `closing: "consensus"`, `minAgree: 2`, con `waitsFor: [{ taskId: "par", scope: "chapter", partial: true }]`). Se reutilizan `issue()` y `boardFor()` copiados de `scripts/verify-my-tasks-board.mts:60-102`, con `progress.returned` para el `returnedBy` de un paso. Una prueba por fila de la tabla del diseño (1–23 y D), cada una con su nombre en español y sus aserciones sobre `situation.state`, `situation.section` y, donde la tabla lo dice, `returned` y `who`. Por ejemplo:

```ts
await test("7: mi borrador terminado sin nadie que lo revise espera a otras personas, y no dice que alguien lo revisa", () => {
  const mine = issue({ task: "par", title: "NEH 1:1–4 · TPL", assignee: "carla", started: true, progress: { done: ["borrador"] } });
  const c = where(boardFor([mine]), mine.number)!;
  assert.equal(c.situation.state, "noReviewer");
  assert.equal(c.situation.section, "waiting");
});
await test("19: la lectura de un capítulo sin pasajes todavía está en «Más» y dice que empieza con el primero", () => {
  // grupo de NEH 1 con la subtarea de par 1:1–4 abierta y sin entregar: waitsFirstPassage, state groupNotYet, section more.
});
await test("22: quien ya respondió toda la lectura la ve en «Esperan», no en «Le toca»", () => { /* … */ });
```

- [ ] **Step 2: Correr** `npm run verify:card-situation` → FAIL (falta el módulo).
- [ ] **Step 3: Escribir `cardSituation`** según la tabla, y en `buildBoard`: `waitsFirstPassage` donde se pone `holdText` (líneas 333 y 387; para la 333 se calculan los bloques con `waitBlocks` si `bucket.openIssues` existe: `blocks.length > 0 && blocks.every((b) => b.rule.partial)`); `situation` al final, para cada tarjeta de cada grupo, después de `oneBookAtATime` y de la pausa (la tarjeta ya tiene su grupo final).
- [ ] **Step 4: Correr** `npm run verify:card-situation; npm run verify:my-tasks-board; npm run verify:phase-badges; npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5: Commit** — «My tasks: what each card is about, said once», porqué: la misma tarjeta se leía en el botón, la línea y la barra, y a veces se contradecían; «Revisar» quería decir cuatro cosas.

### Task 4: Cuatro secciones y el botón lleno (reemplaza el B1 de la Fase 1)

**Files:**
- Modify: `src/domain/myTasksBoard.ts` (`nextCard` 509, `boardCount` 513)
- Modify: `src/components/MyTasksView.tsx:875` (lo que se le cuenta al recordatorio diario)
- Test: `scripts/verify-my-tasks-board.mts`

**Interfaces:**
- Consumes: `BoardCard.situation` (Tarea 3).
- Produces:
  - `export type BoardSections = { mine: BoardCard[]; waiting: BoardCard[]; take: BoardCard[]; more: Record<MorePart, BoardCard[]> }`
  - `export function boardSections(board: Board): BoardSections` — en el orden de la decisión 7. Dentro de cada parte se conserva el orden que `buildBoard` ya dio.
  - `nextCard(board: Board): BoardCard | undefined` — la primera de `mine` con acción (`action.kind !== "none"`); si no hay, la primera de `take` con acción. Misma firma.
  - El recordatorio diario (`MyTasksView.tsx:875`) cuenta `boardSections(taskBoard).mine.length` como `mine`. `OPEN_GROUPS` se queda hasta la Tarea 7, que reescribe `MyTasksBoard.tsx`, su último uso.

- [ ] **Step 1: Pruebas que fallan** (con las piezas `par` y `grupo` de la Tarea 3, copiadas al `plan` de este archivo):

```ts
await test("lo que volvió a mí va primero en «Le toca a usted», y el botón lleno es suyo", () => {
  // Un artículo mío empezado (tocado después) y un pasaje al que le pidieron cambios.
  // Expected: boardSections(b).mine[0] es el de cambios; nextCard(b) es él.
});
await test("falta entregar y falta mi acuerdo también vuelven a mí; lo que la autora retomó por su cuenta no", () => { /* … */ });
await test("dos motivos a la vez: falta mi acuerdo en un pasaje y me pidieron cambios en otro; el botón lleno va a uno de ellos, nunca a lo libre", () => { /* … */ });
await test("en «Para tomar», la revisión en pares va antes que la lectura en grupo, y las dos antes que el trabajo libre", () => { /* … */ });
await test("sin nada mío con botón, el botón lleno está en lo primero de «Para tomar»", () => { /* … */ });
await test("lo mío que espera a otras personas no está en «Le toca a usted» aunque esté empezado", () => { /* 7, 8 y 18 en waiting */ });
await test("lo que volvió a mí en un proyecto pausado va a «Más · En pausa» y el botón lleno no lo elige", () => { /* … */ });
await test("las decisiones van primero en «Le toca a usted», antes que lo que volvió", () => { /* … */ });
```

- [ ] **Step 2: Correr** `npm run verify:my-tasks-board` → FAIL en las nuevas.
- [ ] **Step 3: Escribir `boardSections`, cambiar `nextCard` y el recuento del recordatorio** (`MyTasksView.tsx:875`). Las pruebas de antes que usan `nextCard` deben seguir pasando; si una cambia de sentido por el diseño (lo mío que espera ya no es «lo que toca ahora»), se cambia su aserción y se dice en el commit.
- [ ] **Step 4: Correr** `npm run verify:my-tasks-board; npm run verify:card-situation; npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5: Commit** — «My tasks: four sections, by whose move it is», porqué: «En curso» mezclaba lo que le toca a la persona con lo que espera a otras; reemplaza el B1 del plan de la Fase 1.

### Task 5: Lo que llegó a la lectura en grupo

**Files:**
- Create: `src/domain/readingArrivals.ts`
- Modify: `src/domain/myTasksBoard.ts` (`BoardCard`; se calcula en el bucle final, junto a `situation`)
- Create: `scripts/verify-reading-arrivals.mts`; script `verify:reading-arrivals`

**Interfaces:**
- Consumes: `passagesOf` (`groupReading.ts:17`), `chapterFromIssue` (`solverLaunch.ts:53`), `placeOf` (`myTasksBoard.ts:152`), `parseWorkOrderMarker`, `getStepRuntime`. La tarea de origen es la de la **primera regla `partial`** con `taskId` de la tarea de lectura.
- Produces:
  - `export type ArrivedPassage = { from: number; to: number }`
  - `export type MissingPassage = { from: number; to: number; who?: string }` — `who`: quien tiene la subtarea de origen abierta; sin nadie, ausente («sin tomar»).
  - `export type ReadingArrivals = { chapter: number; arrived: ArrivedPassage[]; missing: MissingPassage[]; arrivedVerses: number; totalVerses: number; joined: string[] }`
  - `export function readingArrivals(issue: DcsIssue, task: ProjectTask, openIssues: DcsIssue[] | undefined): ReadingArrivals | undefined` — `undefined` si `openIssues` es `undefined`, si la tarea no tiene regla `partial`, o si la subtarea no lista pasajes (`passagesOf(itemIds, capítulo, 0)` vacío).
  - En `BoardCard`: `arrivals?: ReadingArrivals`, solo para los estados `groupOffered`, `group`, `answered`, `groupNotYet`.

Un pasaje **falta** si una subtarea abierta de la tarea de origen, del mismo capítulo, se cruza con él (su rango sale de `placeOf(issue).place`, «3:1–6»). Si no, llegó: es lo mismo que supone `waits.ts` (las subtareas de un capítulo se publican juntas, así que un pasaje que ninguna abierta cubre es uno que se cerró). `joined`: los sentados del primer paso no hecho de la lectura.

- [ ] **Step 1: Pruebas que fallan**

```ts
await test("llegaron 3 de 5 pasajes: cuáles, cuántos versículos, y quién tiene los que faltan", () => {
  // Lectura de NEH 3 con cinco porcion:NEH 3:…; abiertas de origen: 3:20–24 de ana y 3:25–32 sin nadie.
  // Expected: arrived.length 3, missing [{from:20,to:24,who:"ana"},{from:25,to:32}], arrivedVerses / totalVerses según los rangos.
});
await test("con todo entregado, no falta nada", () => { /* missing [] */ });
await test("si no se sabe qué está abierto, no se dice nada de lo que llegó", () => {
  assert.equal(readingArrivals(lectura, grupo, undefined), undefined);
});
await test("quiénes se unieron a la lectura", () => { /* joined de los sentados */ });
```

- [ ] **Step 2: Correr** → FAIL. **Step 3: Escribir.** **Step 4: Correr** `npm run verify:reading-arrivals; npm run verify:my-tasks-board; npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5: Commit** — «My tasks: how much of the chapter reached the group reading», porqué: Abel pidió saber cuántos pasajes llegaron y cuántos faltan; `waits.ts` deja de verlo en cuanto llega el primero.

### Task 6: Los textos de las secciones y de cada estado

**Files:**
- Create: `src/components/cardWords.ts`
- Modify: `src/i18n/locales/es.json`, `pt.json`

**Interfaces:**
- Consumes: `CardState` (Tarea 3), `stepCardWords` (Tarea 2).
- Produces:
  - `export const SECTION_TITLE: Record<BoardSection, MessageKey>` y `export const MORE_TITLE: Record<MorePart, MessageKey>`
  - `export function cardWords(card: BoardCard, opts: { t: (k: MessageKey) => string; language: string; externalTool: boolean }): { line: string; strong: boolean; button?: string }` — `strong` cuando la sección es `mine`. `button` ausente cuando la tarjeta no tiene nada que abrir (acción `none` sin paso con herramienta) o la tabla no da botón.

Claves nuevas, prefijo `tc.` (español; el portugués en la misma tarea, revisado con `translations:review`). Donde la tabla dice «paquete», se usa `stepCardWords` y, si no da nada, la clave general.

| Clave | Español |
|---|---|
| `tc.section.mine` / `.waiting` / `.take` / `.more` | Le toca a usted / Esperan a otras personas / Para tomar / Más |
| `tc.more.held` / `.later` / `.paused` / `.done` | Todavía no se pueden empezar / Del libro siguiente / En pausa / Terminadas esta semana |
| `tc.showRest` | Ver las demás ({n}) |
| `tc.details` / `tc.hideDetails` | Ver detalles / Ocultar detalles |
| `tc.path.now` / `tc.path.next` | Ahora: {step} / Sigue: {next} |
| `tc.line.free` | Libre para su equipo. |
| `tc.line.nextBook` | Es del libro siguiente. |
| `tc.line.toStart` | Su pasaje está listo para empezar. |
| `tc.line.ownStep` (si el paquete no da `line`) | Siga con «{step}». |
| `tc.line.finishStep` | Ya está todo hecho en «{step}». |
| `tc.line.noReviewer` | Su borrador espera a quien lo revise. |
| `tc.line.beingReviewed` | @{who} está revisando su borrador. |
| `tc.line.changesAsked` | Le pidieron cambios. Abra su borrador. |
| `tc.line.correcting` | Termine de corregir su borrador. |
| `tc.line.yourAgreement` | @{who} aprobó su borrador. Falta usted. |
| `tc.line.toDeliver` | Todo está hecho. Falta entregar. |
| `tc.line.reviewOffered` | @{who} busca quien revise su borrador. |
| `tc.line.reviewing` | Está revisando el borrador de @{who}. |
| `tc.line.askedChanges` | Espera a que @{who} corrija. |
| `tc.line.authorCorrecting` | @{who} está corrigiendo su borrador. |
| `tc.line.correctedLook` | @{who} corrigió. Mírelo otra vez. |
| `tc.line.authorDelivers` | Falta que @{who} lo entregue. |
| `tc.line.groupNotYet` | Empieza cuando llegue el primer pasaje. |
| `tc.line.groupOffered` (si el paquete no da `offer`) | Su equipo hace «{step}» del capítulo {n}. |
| `tc.line.arrived` / `tc.line.arrivedAll` | Llegaron {a} de {b} pasajes. Ya puede leerlos. / Llegó todo el capítulo. |
| `tc.line.group` (si no hay llegadas ni `line`) | Siga con «{step}» junto a su equipo. |
| `tc.line.answered` / `tc.line.approved` | Ya respondió. Faltan las respuestas de su equipo. / Ya dio su aprobación. Falta la de otra persona de su equipo. |
| `tc.line.groupToDeliver` | «{step}» terminó. Falta entregar. |
| `tc.line.decide` | Su equipo necesita su opinión. |
| `tc.line.paused` | Este proyecto está en pausa. |
| `held`, `done`, `withdrawn`, `proposals` | las de hoy: `holdText` con `localizeHold`; `tb.doneAt`, `tb.withdrawnAt` (pasada a «usted»: «Se retiró del plan {when}: lo que tenía escrito no se entregó.»); `tb.proposalsLeft*`, `tb.proposalsDecided` |
| `tc.btn.continue` / `tc.btn.correct` / `tc.btn.keepCorrecting` | Seguir / Corregir mi borrador / Seguir corrigiendo |
| `tc.btn.seeReview` / `tc.btn.seeMyReview` / `tc.btn.seeMine` | Ver la revisión / Ver mi revisión / Ver mis respuestas |
| `tc.btn.deliver` / `tc.btn.deliverChapter` | Entregar mi trabajo / Entregar el capítulo |
| `tc.btn.reviewOf` / `tc.btn.keepReviewing` / `tc.btn.lookAgain` | Revisar el borrador de @{who} / Seguir revisando / Mirar de nuevo el borrador |
| `tc.btn.join` (si el paquete no da `join` ni `actionLabel`) | Unirse |
| `tc.goesTo.step` / `tc.goesTo.stepNoChapter` / `tc.goesTo.phase` | Después pasa a «{step}» del capítulo {n}. / Después pasa a «{step}». / Después pasa a {phase}. |
| `tc.delivered.step` / `tc.delivered.stepNoChapter` / `tc.delivered.phase` | Entregado. Pasa a «{step}» del capítulo {n}. / Entregado. Pasa a «{step}». / Entregado. Pasa a {phase}. |
| `tc.waitingSince` | Espera desde {when}. |
| `tc.arrived.list` / `tc.arrived.missing` / `tc.arrived.missingNobody` / `tc.arrived.joined` / `tc.arrived.after` | Ya llegaron: {list} ({a} de {b} versículos) / Falta {range} de @{who} / Falta {range}, sin tomar / Se unieron: {who} / El capítulo pasa a {phase}. |

Botones por estado: `free`, `toStart`: `stepButton(action.step)` o `tb.begin`; `ownStep`: `card.continue` del paquete, si no `stepButton`, si no `tc.btn.continue`; `groupOffered`: `card.join`, si no `stepButton`, si no `tc.btn.join`; `group`: `card.continue`, si no `stepButton`, si no `tc.btn.continue`; `finishStep`: `tb.stepFinishNamed`; `decide`: `tb.vote`; `proposals`: `tb.proposals` con sus líneas de hoy. `tb.study` (herramienta externa) sigue mandando en `free`, `toStart` y `ownStep`. `groupToDeliver` dice `tc.btn.deliverChapter` si la subtarea es de un capítulo entero, si no `tc.btn.deliver`. Los demás, según la tabla del diseño.

**Un botón solo si abre algo:** cuando la acción es `none`, el botón aparece solo si la acción trae un paso con herramienta (`othersAnswer` y `assigneeDelivers` con `step.solverAppId`), que es lo que `onPrimary` abre hoy. Así `beingReviewed` por `othersReview` y `noReviewer` no tienen botón; `beingReviewed` de la autora (fila 11, acción `begin`/`continue`) sí, «Ver la revisión»; `askedChanges` de quien revisa (acción `continue`) sí, «Ver mi revisión».

También pasan a «usted» las claves de hoy que siguen viéndose en «Mis tareas»: las de la lista de pasos (`tb.stepMine` «Le toca», `tb.stepFree` «Puede tomarlo»), la pregunta de entregar y devolver (`tb.deliverAsk`, `tb.releaseAsk`), y los avisos `mt.closedVerses`, `mt.closedMerged`, `mt.closedPlain`, `mt.closedVersesConflict`. Las claves `tb.*` que queden sin uso en `src/` (por ejemplo `tb.group.*`, `tb.othersReview`, `tb.changesForYou`) se borran de los dos archivos.

- [ ] **Step 1:** Escribir las claves en `es.json` y `pt.json` con Edit, y `cardWords.ts`.
- [ ] **Step 2:** `npm run verify:config; npm run translations:review; npx tsc --noEmit -p .; npm run verify:decoupling` → PASS, sin claves marcadas.
- [ ] **Step 3: Commit** — «My tasks: one line and one button for each situation», porqué: los textos trataban de «tú» mientras la app trata de «usted», y no decían qué pasa.

### Task 7: El tablero en cuatro secciones

**Files:**
- Modify: `src/components/MyTasksBoard.tsx`
- Modify: `src/styles/components.css` (`.task-board__*`, desde 6813)

**Interfaces:**
- Consumes: `boardSections`, `nextCard` (Tarea 4); `SECTION_TITLE`, `MORE_TITLE` (Tarea 6).
- Produces: `MyTasksBoard` con las mismas props.

- [ ] **Step 1:** Dibujar las secciones con `data-section`:
  - «Le toca a usted» y «Esperan a otras personas» abiertas; «Para tomar» abierta solo si «Le toca a usted» está vacía; «Más» plegada. Plegada, la cabecera muestra su número.
  - Una sección abierta muestra tres tarjetas y luego el botón `tc.showRest` con las que faltan. Dentro de «Más», cada parte con su subtítulo (`MORE_TITLE`) y la regla de hoy (`FIRST_SHOWN`).
  - La búsqueda filtra dentro de las secciones, y mientras hay texto buscado todo está abierto y entero, como hoy.
  - `lead` es `nextCard(board)`.
- [ ] **Step 2:** Estilos: 24–32 px entre secciones, 8–12 dentro; el subtítulo de una parte de «Más» más chico que la cabecera de sección, por tamaño y peso; sus reglas `html[data-text]`.
- [ ] **Step 3:** Borrar `OPEN_GROUPS` de `myTasksBoard.ts`, que ya nadie usa. `npx tsc --noEmit -p .; npm run verify:my-tasks-board` → PASS.
- [ ] **Step 4: Commit** — «My tasks: sections by whose move it is», porqué: nueve grupos cansan, y lo que esperaba a otras personas estaba junto a lo que le toca a una.

### Task 8: La cara de la tarjeta

**Files:**
- Modify: `src/components/TaskCard.tsx`
- Create: `src/components/PathBar.tsx`
- Modify: `src/components/MyTasksView.tsx` (`close()`, 729-793: el aviso al entregar)
- Modify: `src/styles/components.css` (`.task-card*`, desde 6894)

**Interfaces:**
- Consumes: `card.situation`, `card.arrivals` (Tareas 3, 5), `workPath`, `handOffTarget` (Tarea 1), `cardWords` (Tarea 6), `chapterFromIssue`.
- Produces:
  - `export function PathBar({ path }: { path: WorkPath })` — los segmentos con `aria-hidden` (verde hecho, azul ahora, gris falta, medidos en `em`) y, al lado, la frase `tc.path.now` · `tc.path.next` como texto que se lee.
  - `export function deliveredNotice(issue: DcsIssue, board: AssignmentsDoc, t, language: string): string | undefined` en `cardWords.ts`, con `handOffTarget` y el capítulo de la subtarea.

- [ ] **Step 1: La tarjeta, de arriba abajo** (diseño, «La cara de la tarjeta»):
  1. Fila de marcas solo si hay alguna: la fase (cuando `mixed`, como hoy), «nueva», «Corrección pedida», «Revisar de nuevo».
  2. Título como hoy, y su menú «…».
  3. `PathBar` con `workPath(card.task.id, card.bucket.board, doneStepIds)`, salvo en «Más», en decisiones y en listas de propuestas. Reemplaza la fila de la barra de pasos y el porcentaje.
  4. La línea de `cardWords`, en negrita si `strong`; la de las correcciones (`tb.correctionsOpen`) y la de las fuentes que cambiaron se quedan debajo, como hoy.
  5. El botón: lleno si es `lead`; enlace «… ›» (`.task-card__go`) en las demás, y siempre enlace en «Esperan». Los botones de al lado de hoy (abrir la herramienta junto a «Terminé», «Terminé «paso»») se quedan.
  6. «Ver detalles», una fila de 44 px que despliega: la lista de pasos de hoy (con quién cerró cada uno); en «Esperan», `tc.waitingSince` si el último paso cerrado de la subtarea (`progress.steps[id].done.at`, el más reciente) tiene más de tres días, y nada si no hay ninguno (`updated_at` cambia con cualquier comentario); la lectura en grupo, con `tc.arrived.*`; y para quién es el trabajo, con `tc.goesTo.*`.
  - El borde azul de la izquierda va con `data-section="mine"`, no con `data-group="doing"`.
  - Se quitan el menú «Ver los pasos» y el «Siguiente: {paso}» suelto: «Ver detalles» y la frase del camino los reemplazan.
- [ ] **Step 2: El aviso al entregar.** En `close()`, cuando no hay conflicto ni error de publicación, `announce(deliveredNotice(...) ?? <el aviso de hoy>)`, después de que `closeSubtask` terminó bien. Es el aviso que usará el B3 del plan de la Fase 1.
- [ ] **Step 3: Estilos.** Cada texto nuevo con su regla `html[data-text]`; la barra en `em`; «Ver detalles» de 44 px de alto.
- [ ] **Step 4:** `npx tsc --noEmit -p .; npm run verify:my-tasks-board; npm run verify:phase-badges; npm run verify:config; npm run verify:decoupling; npm run verify:text-size` → PASS, salvo `verify:text-size` con solo su falla de `main` (`.af--round`).
- [ ] **Step 5: Commit** — «My tasks: a card read in one place», porqué: el botón, la línea y la barra decían cosas distintas («0 %» junto a «Todos los pasos están hechos»); y al entregar la tarjeta desaparecía sin decir adónde fue el trabajo.

### Task 9: Probar en el navegador

- [ ] **Step 1: Sin mock, con el guion.** Servidor de este worktree con `preview_start` (una entrada en el `.claude/launch.json` que `preview_start` lea, con `npx vite <worktree> --port <libre> --strictPort`). Se pega `.claude/relevos/tarjetas-harness.js` y se dibujan tarjetas de cada estado (con `openIssues` en el `bucket` para las llegadas). A 375 px y a 1280 px, con la letra a 1.3, en español y en portugués. Expected: cada tarjeta lee como la tabla del diseño; un solo botón lleno; nada de menos de 44 px (`audit("tarjetas")`, del relevo `2026-11-24-fase-1-plan.md`); los textos crecen con la letra (`tsize()`).
- [ ] **Step 2: Con el mock, lo que escribe.** Según el relevo `2026-11-23-fase-1.md` («Cómo probar»): Ana entrega un borrador revisado. Expected: «Entregado. Pasa a «Lectura grupal» del capítulo 1.»; la lectura aparece en «Para tomar» de Bea con «Llegaron 1 de N pasajes».
- [ ] **Step 3: La tarjeta de Preguntas** (Tarea 1.1, paso 7 del plan de la Fase 1): abrir una tarea de Preguntas solo desde su tarjeta, escribir, «Terminé», que Bea la tome. Expected: la tarjeta de Ana en «Esperan», con «@bea está revisando su borrador.». Si sale en «Le toca a usted» sin botón, se agrega su prueba en la Tarea 3 y se corrige.
- [ ] **Step 4:** Capturas a 375 px y a 1280 px para Abel. Se quita la entrada del `launch.json` que se agregó, y se detiene el mock comprobando antes que su línea de comando dice `mock-door43`.

### Task 10: Corregir el plan de la Fase 1

**Files:**
- Modify: `docs/superpowers/plans/2026-11-24-fase-1-traduccion.md`

- [ ] **Step 1:** En la Tarea 1.1, una nota al principio: la reemplaza este plan (Tareas 3 y 4), con sus pruebas (los dos motivos a la vez, lo que la autora retomó, la revisión en pares antes que la lectura, el botón lleno en lo libre) y su paso 7 (la tarjeta de Preguntas, Tarea 9 de este plan). Sus pasos quedan, marcados como reemplazados, con un enlace a este plan.
- [ ] **Step 2:** En la Tarea 1.4 (B3): al llegar a «Mis tareas» con el encargo de entregar, `close()` ya dice «Entregado. Pasa a…» (`deliveredNotice`). La ventana con `mt.deliveredTitle` usa ese texto en vez de una clave nueva. En «Review Focus», el punto 4 remite a este plan.
- [ ] **Step 3: Commit** — «Plan: Phase 1 B1 is done by the clear task cards», porqué: dos trabajos no deben ordenar «Mis tareas» de dos maneras.

### Task 11: Revisión y PR

- [ ] **Step 1:** Dos peces dorados por separado sobre el diff entero (`git diff origin/main...HEAD`), uno en Sonnet y otro en Opus, con este plan y el diseño y nada de la conversación. Corregir o explicar por qué no aplica; un pez dorado nuevo sobre lo que cambió, hasta que salga limpio.
- [ ] **Step 2:** Todas las pruebas de «Global Constraints».
- [ ] **Step 3:** Con el OK de Abel: `git push origin HEAD:tarjetas-claras` y PR a `main`, con las capturas de la Tarea 9 y la nota de que incluye el PR #54 si todavía no se unió. No se publica sin que Abel lo pida (`npm run deploy -- --publish`).
