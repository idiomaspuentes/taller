# Tiempo abierto tras el acuerdo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un ítem que alcanza el mínimo de acuerdos siga abierto `openHours` horas (72 en el FCR) antes de cerrarse, que se cierre antes si ya opinaron todos los del paso, y que el paso solo se complete cuando ningún ítem tiene plazo abierto.

**Architecture:** todo se calcula de las respuestas que ya existen, sin guardar nada nuevo. Un módulo puro (`src/domain/openWindow.ts`) dice hasta cuándo sigue abierto un ítem. Los dos motores de acuerdo (`reviewRound.ts` para Afinación y Lectura grupal; `checkProposal.ts` + `checklist.ts` para Armonización) calculan desde cuándo está de acuerdo cada ítem y agregan `openUntil` / `closesAt`. Las pantallas reciben las personas sentadas en el paso (leídas de la subtarea) y la hora, y cambian el botón de cierre por la fecha desde la que se podrá cerrar.

**Tech Stack:** React 18 + Vite + TypeScript; pruebas `scripts/verify-*.mts` con `tsx` y `node:assert/strict`; mock de Door43 (`scripts/mock-door43/server.mjs`).

**Spec:** [`docs/superpowers/specs/2026-11-06-tiempo-abierto-tras-el-acuerdo-design.md`](../specs/2026-11-06-tiempo-abierto-tras-el-acuerdo-design.md)

## Global Constraints

- El plazo del FCR es **72** horas, en el campo de paso **`openHours`**. Sin el campo, o con 0, todo funciona exactamente como hoy.
- Pasos del FCR que lo llevan (11): `revision-grupal-tpl › lectura`, `revision-grupal-tps › lectura`, `desafios-tpl › revisar`, `desafios-tps › revisar`, `palabras-tpl › revisar`, `palabras-tps › revisar`, `alinear-tpl › revisar-alineacion`, `alinear-tps › revisar-alineacion`, `armonizar-notas › notas-textos`, `armonizar-palabras › palabras-textos`, `armonizar-preguntas › preguntas-textos`. **No** `validar › decision`.
- La versión del paquete FCR sube de 53 a 54.
- El código no conoce ningún proceso: nada de ids de pasos o tareas del FCR en `src/` (`npm run verify:decoupling`).
- Los logins se comparan en minúsculas y sin espacios (`trim().toLowerCase()`), como en el resto del motor.
- Texto de interfaz con `useT()`, fuente en `src/i18n/locales/es.json` y traducción en `pt.json` (`npm run verify:config` comprueba claves y `{marcadores}`). La interfaz trata de «tú».
- En Armonización no se muestran recuentos de votos (decisión de Abel del 27-10): solo «De acuerdo · puedes opinar hasta…».
- Comentarios y commits en inglés, con título corto y un cuerpo que explique el porqué, y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nada se publica ni se sube: ni push, ni Cloudflare, ni Door43 QA. Las pruebas de pantalla son contra el mock.
- Trabajar solo en este worktree. Los cambios sin commit de la copia principal (`docs/MODELO.md`, `scripts/mock-door43/server.mjs`, `src/main.tsx`, `src/worker/client.ts`…) son de otra sesión: no se tocan.
- Preparación del worktree, una vez: el enlace de `usfm-ast` (PowerShell: `New-Item -ItemType Junction -Path C:\Users\LENOVO\Git\Github\gateway-tasks\.claude\worktrees\usfm-ast -Target C:\Users\LENOVO\Git\Github\usfm-ast`, si no existe). Al terminar se quita con `[System.IO.Directory]::Delete($link, $false)`.

## Review Focus

1. **Logins con otra mayúscula:** la subtarea sienta a `Ana` y la respuesta es de `ana`. El cierre anticipado tiene que reconocerla. Prueba en la Tarea 2.
2. **No se pudo leer quién está en el paso** (modo de prueba sin subtarea, o falla de red): `seated` llega vacío. El ítem debe esperar el plazo completo, nunca cerrarse antes. Pruebas en las Tareas 2 y 3.
3. **Texto corregido y vuelto a acordar:** el plazo cuenta desde el acuerdo nuevo, no desde el primero. Prueba en la Tarea 2.
4. **Proyecto viejo sin `openHours`** (antes de «Traer lo nuevo»): debe dar el mismo resultado que hoy, también en `complete`. Pruebas en las Tareas 2 y 3.
5. **Pantalla abierta mientras vence el plazo:** el botón de cerrar aparece solo, sin recargar. Lo hace `useNow` (Tarea 4) y se comprueba en el navegador (Tarea 6).

---

### Task 1: El campo `openHours` en el paquete

**Files:**
- Modify: `src/domain/types.ts` (tipo `TaskStep`, junto a `minAgree`, ~línea 428)
- Modify: `src/domain/store.ts:486-585` (`normalizeTaskSteps`)
- Modify: `src/domain/workflowCheck.ts:~146-155` (validación de un paso)
- Modify: `processes/fcr.json` (los 11 pasos de las Global Constraints; `version` 53 → 54)
- Modify: `docs/PROCESOS.md` (tabla de campos de un paso)
- Test: `scripts/verify-templates.mts`, `scripts/verify-workflow-upgrade.mts`

**Interfaces:**
- Produces: `TaskStep.openHours?: number`, un entero ≥ 1 conservado por `normalizeTaskSteps` solo cuando `closing` es `"consensus"` o `"checklist"` y `claimMode` es `"pool"`. En cualquier otro caso queda `undefined`.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `verify-templates.mts`:
- `test("un paso de acuerdo conserva sus horas abiertas, y uno que no es de acuerdo no las tiene")`: `normalizeWorkflowTemplate` de un paso `{ closing: "consensus", claimMode: "pool", openHours: 72 }` → `steps[0].openHours === 72`. De un paso `{ closing: "self", openHours: 72 }` → `undefined`. De `openHours: 0` → `undefined`.
- `test("el validador rechaza horas abiertas que no son un número entero, o en un paso que no es de acuerdo")`: `workflowProblems` con `openHours: -1`, con `openHours: 1.5` y con `openHours: 72` en un paso `closing: "self"`. Las tres dan un problema cuyo texto incluye `«openHours»`.
- `test("el FCR deja abierto 72 horas cada paso de acuerdo, salvo la validación")`: en `shippedWorkflow("fcr-base")!`, los 11 pasos de las Global Constraints tienen `openHours === 72` y `validar › decision` no lo tiene.

En `verify-workflow-upgrade.mts`:
- `test("traer lo nuevo agrega las horas abiertas a los pasos de acuerdo de un proyecto viejo")`: un tablero aplicado con el FCR, al que se le quita `openHours` de sus pasos y se le pone `workflowVersion: 53`. Tras `upgradeBoardToWorkflow(board, fcr)`, `desafios-tpl › revisar` tiene `openHours === 72` y `workflowVersion === 54`. Un paso con `openHours: 24` puesto por el proyecto conserva su 24.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm run verify:templates` y `npm run verify:workflow-upgrade`
Expected: FAIL en las pruebas nuevas.

- [ ] **Step 3: Implementar**
- `types.ts`: `openHours?: number` con un comentario de una línea (cuántas horas sigue abierto un ítem acordado para que otros opinen; `reviewRound.ts`, `checklist.ts`).
- `store.ts`: `...(isAgreementPool && Number.isInteger(Number(item.openHours)) && Number(item.openHours) >= 1 ? { openHours: Number(item.openHours) } : {})`, donde `isAgreementPool = claimMode === "pool" && (closing === "consensus" || closing === "checklist")`.
- `workflowCheck.ts`: dos problemas en español, en el estilo de los vecinos. «`${at}`: «openHours» tiene que ser un número entero de horas, 0 o más.» y «`${at}`: «openHours» solo vale en un paso que se cierra por acuerdo de varias personas.».
- `fcr.json`: `"openHours": 72` después de `minIndependent` en los 11 pasos, y `"version": 54`.
- `PROCESOS.md`: una fila `openHours`: cuántas horas sigue abierto un ítem que ya tiene el mínimo; se cierra antes si ya opinaron todos los del paso; sin el campo, se cierra al acordarse.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm run verify:templates && npm run verify:workflow-upgrade && npm run verify:process-load && npx tsc --noEmit -p .`
Expected: todo `ok`, sin errores de tipos.

- [ ] **Step 5: Commit** — `Process: steps decided by agreement say how long an agreed item stays open`.

---

### Task 2: El plazo en las rondas de Afinación y la Lectura grupal

**Files:**
- Create: `src/domain/openWindow.ts`
- Modify: `src/domain/reviewRound.ts` (`ItemTally`, `tallyItem`, `RoundSummary`, `summarizeRound`)
- Modify: `src/domain/groupReading.ts` (`ReadingProgress`, `readingProgress`)
- Test: `scripts/verify-review-round.mts`, `scripts/verify-group-reading.mts`

**Interfaces:**
- Consumes: `TaskStep.openHours` (Task 1).
- Produces, en `openWindow.ts`:
  - `type OpenWindow = { hours: number; seated: string[]; now: number }`
  - `openWindowFor(step: { openHours?: number } | undefined, seated: string[], now: number): OpenWindow | undefined`. Devuelve `undefined` cuando no hay horas.
  - `openUntilOf(p: { agreedAt?: string; window?: OpenWindow; answered: string[]; decided?: boolean }): string | undefined`. Da el ISO de `agreedAt + hours` cuando ese momento es posterior a `now`, `decided` no es verdadero, y no todos los `seated` (no vacío) están entre `answered`. Si no, `undefined`. Compara en minúsculas.
  - `latestOf(dates: (string | undefined)[]): string | undefined`. Da el más tardío.
  - `sayOpenDate(iso: string, language: string, pattern: string): string`. Reemplaza `{day}` con `toLocaleDateString(language, { weekday: "long", day: "numeric", month: "long" })` y `{time}` con `toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })`.
- Produces, en `reviewRound.ts`:
  - `tallyItem({ …, open?: OpenWindow })`. `ItemTally` gana `agreedAt?: string` (en un ítem `"agreed"` que no cerró una decisión final) y `openUntil?: string`.
  - `summarizeRound({ …, open?: OpenWindow })`. `RoundSummary` gana `allAgreed: boolean` (todos `"agreed"`) y `closesAt?: string` (`latestOf` de los `openUntil`). `complete` pasa a ser `allAgreed && !closesAt`.
- Produces, en `groupReading.ts`: `ReadingProgress` gana `allAgreed: boolean` y `closesAt?: string`. `complete` también exige que ningún tally tenga `openUntil`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `verify-review-round.mts`

Las respuestas de prueba usan la hora base del archivo (1 de octubre de 2026, 12:00 UTC, un minuto por respuesta). `H = 3_600_000`, `base = Date.UTC(2026, 9, 1, 12, 0)`. La ventana es `open = (hoursLater, seated = []) => ({ hours: 72, seated, now: base + hoursLater * H })`.
- `test("acordado hace una hora, el ítem sigue abierto 72 horas y la ronda no está completa")`: ana, bea y carla `approved`, `open(1)` → `state === "agreed"`, `openUntil === new Date(Date.parse(<hora de carla>) + 72 * H).toISOString()`. En `summarizeRound` de ese único ítem: `allAgreed === true`, `complete === false` y `closesAt === openUntil`.
- `test("acordado hace 73 horas, el ítem está cerrado")`: lo mismo con `open(73)` → `openUntil === undefined` y `complete === true`.
- `test("si respondieron todos los que tomaron el paso, se cierra en el acto")`: `open(1, ["Ana", "BEA", "carla "])` → `openUntil === undefined`. Cubre el foco 1.
- `test("alguien más se sienta en el paso dentro del plazo, y el ítem vuelve a estar abierto")`: `open(1, ["ana", "bea", "carla", "dora"])` → `openUntil` definido.
- `test("sin saber quién está en el paso, se espera el plazo completo")`: `open(1, [])` → `openUntil` definido. Cubre el foco 2.
- `test("un de acuerdo más dentro del plazo no lo alarga")`: ana, bea y carla, y dora `approved` después → `openUntil` igual al de la primera prueba.
- `test("una objeción dentro del plazo lo vuelve a disputa; retirada, el plazo empieza de nuevo")`: tras las tres, dora `revise` → `state === "disputed"`, sin `openUntil`. Después dora `approved` → `openUntil` = hora de esa respuesta + 72 h.
- `test("con el texto corregido y vuelto a acordar, el plazo cuenta desde el acuerdo nuevo")`: las tres con `hash: "a"`; después las tres con `hash: "b"` y `currentHash: "b"` → `agreedAt` es la hora del tercer acuerdo sobre `"b"`. Cubre el foco 3.
- `test("la decisión final de quien coordina se cierra en el acto")`: el caso de decisión final que el archivo ya prueba, con `open(1)` → `decided` definido y `openUntil === undefined`.
- `test("un paso sin horas abiertas se cuenta como antes")`: sin `open` → `openUntil === undefined`, `allAgreed === complete` y `closesAt === undefined`. Cubre el foco 4.

En `verify-group-reading.mts`:
- `test("la lectura grupal no se puede cerrar mientras un versículo acordado sigue abierto")`: un `tallies` con un `ItemTally` `{ state: "agreed", openUntil: <iso> }` → `readingProgress(...).complete === false`, `allAgreed === true` y `closesAt === <iso>`.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm run verify:review-round` y `npm run verify:group-reading`
Expected: FAIL (`openUntil`/`allAgreed` no existen).

- [ ] **Step 3: Implementar `openWindow.ts`** con las firmas de arriba.

- [ ] **Step 4: Implementar `agreedAt` y `openUntil` en `tallyItem`**

`agreedAt` es la hora de la última respuesta con la que el ítem pasó de no acordado a acordado, si sigue acordado. Para calcularlo: separar el recuento actual en una función interna `stateOf(decisions): ItemState` (lo que hoy hace `tallyItem` sin la ventana), ordenar por `timestamp` las respuestas del ítem que cuentan (las de `mine`), y recorrer los prefijos. `agreedAt` es el `timestamp` de la respuesta *k* en la que `stateOf(prefijo k) === "agreed"` y `stateOf(prefijo k-1) !== "agreed"`, la última vez que pasa. Son pocas respuestas por ítem (menos de diez), así que recorrer los prefijos no cuesta. Después, `openUntil = openUntilOf({ agreedAt, window: params.open, answered: answers.map((a) => a.reviewer), decided: false })`. En la rama de la decisión final (`decided`) no hay ni `agreedAt` ni `openUntil`.

- [ ] **Step 5: Implementar en `summarizeRound` y `readingProgress`** lo que dice el bloque Interfaces. `summarizeRound` pasa `open` a cada `tallyItem`.

- [ ] **Step 6: Correr y ver que pasan**

Run: `npm run verify:review-round && npm run verify:group-reading && npm run verify:consensus && npm run verify:afinacion-store && npx tsc --noEmit -p .`
Expected: todo `ok`. Los tipos fallan solo si algún lector de `RoundSummary` construye uno a mano; si pasa, completarlo con `allAgreed`.

- [ ] **Step 7: Commit** — `Rounds: an agreed item stays open for the rest of the team before it closes`.

---

### Task 3: El plazo en Armonización

**Files:**
- Modify: `src/domain/checkProposal.ts` (`ProposalView`, `byChoice`)
- Modify: `src/domain/checklist.ts` (`CheckSlot`, `CheckItemTally`, `ChecklistSummary`, `summarizeChecklist`, `slotsOf`)
- Test: `scripts/verify-check-proposal.mts`, `scripts/verify-checklist.mts`

**Interfaces:**
- Consumes: `OpenWindow`, `openUntilOf`, `latestOf` (Task 2).
- Produces:
  - `ProposalView.agreedAt?: string`. En cada versión vigente de una opción de un ítem que se decidió por unanimidad (gane una propuesta o «dejarla como está»), es el momento en que la elección del ítem quedó unánime. No se pone cuando decidió quien coordina (`decidedBy`), ni en lo aplicado o enviado.
  - `summarizeChecklist({ …, agreement?: { people; proposals; me?; open?: OpenWindow } })`.
  - `CheckSlot.settledAt?: string`, `CheckSlot.openUntil?: string`.
  - `CheckItemTally.openUntil?: string`: el más tardío de sus preguntas.
  - `ChecklistSummary.allSettled: boolean` (todos los ítems `"ok"`) y `closesAt?: string`. `complete` pasa a ser `allSettled && !closesAt`.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `verify-check-proposal.mts`, con `proposalsOf(answers, 3, ours, { consensus: true, decides, questionsOf })` como en las pruebas de propuesta única que ya tiene el archivo:
- `test("una propuesta acordada por tres sabe desde cuándo está de acuerdo")`: ana propone y bea y carla la aceptan → `state === "agreed"` y `agreedAt === <hora de carla>`.
- `test("un cuarto que también está de acuerdo no cambia desde cuándo")`: dora la acepta después → el mismo `agreedAt`.
- `test("lo que decide quien coordina no tiene desde cuándo")`: con `@decide` de quien coordina → `agreedAt === undefined`.

En `verify-checklist.mts`, con `H` y una ventana `open(hoursLater, seated)` como en la Tarea 2, medida desde la hora del último «sí»:
- `test("tres sí en una pregunta la dejan resuelta, abierta 72 horas")`: `agreement: { people: 3, proposals: [], open: open(1) }`, tres `yes` de ana, bea y carla → `slots[q].settled === true`, `slots[q].openUntil` = hora del tercer «sí» + 72 h, `items[0].state === "ok"`, `summary.allSettled === true`, `summary.complete === false` y `summary.closesAt` definido.
- `test("vencido el plazo, la lista está completa")`: con `open(73)` → `complete === true`.
- `test("si ya opinaron todos los del paso, la nota se cierra en el acto")`: `open(1, ["Ana", "bea", "carla"])` → `openUntil === undefined`.
- `test("sin saber quién está en el paso, la nota espera el plazo completo")`: `open(1, [])` → `openUntil` definido.
- `test("a quien está en el paso y no opinó, la nota abierta le toca")`: `open(1, ["ana", "bea", "carla", "dora"])`, `me: "dora"` → `items[0].turn === "mine"`. Con `me: "ana"` → `turn === "done"`.
- `test("una nota acordada fuera de Taller no espera")`: con `itemAgreed(...)` → `items[0].openUntil === undefined`.
- `test("una lista sin horas abiertas se cuenta como antes")`: sin `open` → `complete === allSettled` y `closesAt === undefined`. Cubre el foco 4.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm run verify:check-proposal` y `npm run verify:checklist`
Expected: FAIL.

- [ ] **Step 3: Implementar `agreedAt` en `byChoice`**

Sacar el cálculo final de la unanimidad (las líneas `unanimous` y `winner`, sin la parte de `decided`) a una función interna `agreedOption(): string | undefined` que lee el estado del recorrido en ese momento (`choice`, `inForce`, `noOn`, `live`). Usarla en el final, como hoy. Dentro del bucle, junto a donde se actualiza `since`, llevar `let agreedSince: string | undefined`: `agreedSince = agreedOption() !== undefined ? (agreedSince ?? row.at) : undefined`. Al construir cada vista de `live`, poner `agreedAt: agreedSince` cuando `winner` viene de la unanimidad y no de `decided` y la vista no está aplicada ni enviada.

- [ ] **Step 4: Implementar `settledAt` y `openUntil` en `slotsOf` y `summarizeChecklist`**

`settledAt` de una pregunta resuelta:
- si la resolvió una propuesta decidida, el `agreedAt` de esa propuesta;
- si la resolvieron los «sí», la hora del `people`-ésimo «sí» en orden de hora;
- si la cerró quien coordina, si se aplicó o se envió, o si la nota se acordó fuera de Taller (`agreedApart`), no tiene.

Si una propuesta se abrió y se retiró, `settledAt` sigue siendo la hora del `people`-ésimo «sí». El plazo puede quedar más corto, y se acepta así.

`openUntil = openUntilOf({ agreedAt: settledAt, window: agreement.open, answered: slot.voices })`. Para el turno (`turn`), una pregunta con `openUntil` cuenta como no resuelta para `me` cuando `me` está en `seated` y no en `voices`; para todos los demás cuenta como resuelta. Calcular `allSettled`, `closesAt` y `complete` como dice el bloque Interfaces.

- [ ] **Step 5: Correr y ver que pasan**

Run: `npm run verify:check-proposal && npm run verify:checklist && npm run verify:checklist-ready && npm run verify:proposal-list && npm run verify:note-situation && npx tsc --noEmit -p .`
Expected: todo `ok`.

- [ ] **Step 6: Commit** — `Harmonization: an agreed note stays open for the rest of the team before it closes`.

---

### Task 4: Las pantallas de las rondas (Afinación, alineación y Lectura grupal)

**Files:**
- Modify: `src/dcs/roundClose.ts` (nueva lectura de las personas del paso)
- Create: `src/useNow.ts`
- Modify: `src/components/RoundPanel.tsx`
- Modify: `src/components/AfinacionView.tsx` (~líneas 503-560, 568, 917-930, 542 y 1732)
- Modify: `src/components/AlineacionView.tsx` (~líneas 557, 630-670)
- Modify: `src/components/GroupReadingView.tsx` (~líneas 84-120, 267 y 450-475)
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/pt.json`

**Interfaces:**
- Consumes: `openWindowFor`, `sayOpenDate` (Task 2); `ItemTally.openUntil`, `RoundSummary.allAgreed`/`closesAt`, `ReadingProgress.allAgreed`/`closesAt` (Task 2).
- Produces:
  - `stepSeated(params: { session: GtSession; pmOrg: string; issueNumber: number; stepId: string }): Promise<string[]>` en `roundClose.ts`. Da `getStepRuntime(parseTaskProgressMarker(issue.body), stepId).assignees`.
  - `useNow(nextAt?: string): number` en `src/useNow.ts`. Da `Date.now()` más el adelanto de desarrollo, y vuelve a pintar un segundo después de `nextAt` (`setTimeout`, con el retraso tope en `2 ** 31 - 1`). El adelanto de desarrollo es `?mockHoursAhead=N` en la dirección, leído una vez y solo con `import.meta.env.DEV`: suma `N` horas, para probar un vencimiento en el mock.
  - Claves nuevas (es / pt):
    - `round.openUntil`: «De acuerdo · puedes opinar hasta el {date}» / «De acordo · você pode opinar até {date}»
    - `round.dateAt`: «{day} a las {time}» / «{day} às {time}»
    - `round.allAgreedOpen`: «Todo está de acuerdo. Se puede cerrar desde el {date}.» / «Está tudo de acordo. Pode-se fechar a partir de {date}.»
    - `round.allAgreedTellOpen`: «Todo quedó de acuerdo: la revisión se puede cerrar desde el {date}.» / «Ficou tudo de acordo: a revisão pode ser fechada a partir de {date}.»
    - `ck.allCheckedOpen`: «Todo está comprobado. Este paso se puede cerrar desde el {date}.» / «Está tudo verificado. Este passo pode ser fechado a partir de {date}.»

- [ ] **Step 1: `stepSeated` y `useNow`** con las firmas de arriba.

- [ ] **Step 2: Las claves de texto** en `es.json` y `pt.json`. Run: `npm run verify:config`. Expected: `ok`.

- [ ] **Step 3: `AfinacionView`**
- Cargar `seated` con `stepSeated` en el mismo efecto que `stepIsDone` (línea ~568). Si falla, `[]`.
- `const now = useNow(summary?.closesAt)`. Como `summary` depende de `now`, la hora del siguiente vencimiento se guarda en un estado que actualiza un efecto, para no crear un ciclo.
- `const open = openWindowFor(taskStep, seated, now)`, que se pasa a `tallyItem` y a `summarizeRound`, con `now` y `seated` en las dependencias del `useMemo`.
- El aviso a quien coordina (línea ~917): la condición pasa de `!summary.complete` a `!summary.allAgreed` y de `round.complete` a `round.allAgreed`. El texto es `round.allAgreedTellOpen`, con la fecha, cuando la ronda tiene `closesAt`; si no, `round.allAgreedTell`.
- Donde se dice que un ítem está acordado (líneas ~542 y ~1732): si `tally.openUntil`, la línea es `round.openUntil` con `sayOpenDate(tally.openUntil, language, t("round.dateAt"))`.

- [ ] **Step 4: `RoundPanel`**: cuando `!stepDone && summary.allAgreed && summary.closesAt && closesHere`, muestra `round.allAgreedOpen` con la fecha, sin botón, en el mismo bloque `round__ready`. Cambia también la condición de salida temprana para que este caso se vea. El idioma, como lo toma `KeptDraftNote.tsx`.

- [ ] **Step 5: `AlineacionView`**: lo mismo que el Step 3, con `seated`, `useNow` y `open` en el `tallyItem` y el `summarizeRound` de las líneas ~630-650. El `RoundPanel` ya recibe `summary`.

- [ ] **Step 6: `GroupReadingView`**: `seated`, `useNow(progress?.closesAt)` y `open` en el `tallyItem` de la línea ~111. En el pie (línea ~455): cuando `progress.allAgreed && progress.closesAt`, el texto es `round.allAgreedOpen` con la fecha, y el botón `gr.close` sigue apareciendo solo con `progress.complete`. En la línea de cada versículo (línea ~267): `round.openUntil` cuando su tally tiene `openUntil`.

- [ ] **Step 7: Comprobar**

Run: `npx tsc --noEmit -p . && npm run verify:config && npm run verify:decoupling && npm run verify:ui-copy && npm run verify:text-size`
Expected: todo `ok`.

- [ ] **Step 8: Commit** — `Rounds: say until when an agreed item is open, and close the step only after`.

---

### Task 5: La pantalla de Armonización

**Files:**
- Modify: `src/components/ChecklistView.tsx` (~líneas 194, 224-256, 2058-2072 y 2625-2665)

**Interfaces:**
- Consumes: `stepSeated`, `useNow`, `openWindowFor`, `sayOpenDate`, las claves `round.openUntil`, `round.dateAt` y `ck.allCheckedOpen` (Task 4); `ChecklistSummary.allSettled`/`closesAt` y `CheckItemTally.openUntil` (Task 3).

- [ ] **Step 1: Pasar la ventana al motor**: `seated` con `stepSeated` junto a `stepIsDone` (línea ~194), `useNow(summary.closesAt)` con la misma salvedad del ciclo que en la Tarea 4, y `open: openWindowFor(data?.step, seated, now)` dentro de `agreement` (línea ~254), solo cuando `people > 0`.

- [ ] **Step 2: El cierre**: en los dos lugares que muestran `ck.closeStep` (líneas ~2066 y ~2660), cuando `!summary.complete && summary.allSettled && summary.closesAt && closesHere`, se lee `ck.allCheckedOpen` con la fecha, sin botón. El de la línea ~2656 (`!summary.complete` → «Siguiente») no debe ofrecer «Siguiente» en ese caso.

- [ ] **Step 3: El estado de la nota**: en la línea donde la nota dice que está resuelta o que se espera a otros (línea ~2630), cuando `tally.openUntil`, muestra `round.openUntil` con la fecha. Sin recuentos.

- [ ] **Step 4: Comprobar**

Run: `npx tsc --noEmit -p . && npm run verify:checklist && npm run verify:decoupling && npm run verify:ui-copy`
Expected: todo `ok`.

- [ ] **Step 5: Commit** — `Harmonization: say until when an agreed note is open, and close the step only after`.

---

### Task 6: La regla en la documentación, y la prueba con el mock

**Files:**
- Modify: `docs/PLANTILLA_FCR.md` (sección 3.4, «Cómo se acuerda un versículo», ~línea 310; sección 4, «Quién entra y cuándo queda acordado», ~línea 447; sección 5.4, fila «Con tres de acuerdo» y fila «Al cerrarse el paso», ~líneas 621-625)
- Modify: `docs/PLAN.md` (una línea en el estado, si el archivo lleva la lista de lo hecho)

- [ ] **Step 1: Documentación**

En las tres secciones, la regla en una frase, con la fecha de la decisión: alcanzado el mínimo, el ítem queda abierto 72 horas para que otros opinen; se cierra antes si ya opinaron todos los del paso; una objeción lo vuelve a disputa y, acordado de nuevo, empiezan otras 72 horas; lo decidido en reunión se cierra en el acto; se puede reabrir mientras el paso siga abierto; el paso se cierra cuando ningún ítem tiene plazo abierto (Abel, 6 de noviembre de 2026).

- [ ] **Step 2: Todas las pruebas automáticas**

Run: `npm run verify:review-round && npm run verify:group-reading && npm run verify:consensus && npm run verify:checklist && npm run verify:check-proposal && npm run verify:templates && npm run verify:workflow-upgrade && npm run verify:process-load && npm run verify:decoupling && npm run verify:config && npx tsc --noEmit -p . && npm run build`
Expected: todo pasa. `verify:prep` falla desde antes y no es de este cambio.

- [ ] **Step 3: El mock sembrado**

Mirar con `netstat` qué puertos están libres. Levantar el mock en uno (`MOCK_PORT`, `MOCK_PM_ORG=es-419_gl`, `MOCK_SEED_BOOK=TIT`) y correr `npm run verify:proposals-mock` y `npm run verify:scope-mock`.
Expected: `ok`.

- [ ] **Step 4: En el navegador**

El servidor de Vite del worktree va en un puerto libre, con una entrada en `.claude/launch.json` y `preview_start`. Se usa el mock con ana, bea y carla, como dicen las memorias [[two-people-on-the-mock-through-the-ui]] y [[worktree-needs-usfm-ast-link-and-own-mock]].
- Una ronda de Desafíos con cuatro personas sentadas y tres de acuerdo: el ítem dice «De acuerdo · puedes opinar hasta el …» y el panel dice «Se puede cerrar desde el …», sin botón.
- Con `?mockHoursAhead=73`: aparece «Cerrar la revisión». Con la pantalla abierta, el botón aparece solo al vencer el plazo; se prueba con un adelanto que deje un minuto de margen. Cubre el foco 5.
- La cuarta persona objeta dentro del plazo: el ítem pasa a «sin acuerdo».
- Una nota de Armonización con tres de acuerdo: la misma línea, sin recuentos, y «Este paso se puede cerrar desde el …».
- Cada pantalla a 375 px y en el escritorio, con captura. Pasar la lista de `docs/FILOSOFIA_DE_DISENO.md`: la línea nueva no deja una etiqueta suelta entre grupos.

- [ ] **Step 5: Limpiar**: parar el servidor y el mock, quitar la entrada de `launch.json` y el enlace de `usfm-ast`.

- [ ] **Step 6: Commit** — `Docs: an agreed item stays open 72 hours before the step can close`.

---

## Fuera de este plan

- La frase del curso del LMS espera el OK de Abel (ver la spec, «Documentación»).
- Avisar con la app cerrada cuando vence el plazo.
- Editar `openHours` desde el editor del plan de un proyecto: hoy se cambia en el paquete.
