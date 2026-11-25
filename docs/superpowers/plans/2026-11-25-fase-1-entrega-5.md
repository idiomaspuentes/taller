# Fase 1, entrega 5 — la revisión en pares como conversación (D1): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quien revisa lee el pasaje como texto, dice «Estoy de acuerdo» o «No del todo…» con palabras propuestas o un comentario, y en la segunda vuelta ve solo lo que la autora cambió; la autora usa una propuesta con un toque en su editor.

**Architecture:** dos datos nuevos y ninguna migración. Una propuesta es un comentario de la revisión con un marcador propio (`taller-proposal`), leído por un analizador puro; si está usada se calcula al leer, comparando con el borrador. La versión con que se compara la segunda vuelta se anota en la marca de la tarea (`StepRuntime.returned`) al devolver el borrador. Encima, se rehacen la pantalla de revisión (`PortionReviewView.tsx`) y se agrega «Usar estas palabras» a los dos editores.

**Tech Stack:** React 18 + Vite + TypeScript; pruebas `scripts/verify-*.mts` con `tsx` y `node:assert/strict`; mock de Door43 (`scripts/mock-door43/server.mjs`); panel del navegador con `preview_start`.

**Spec:** [`docs/superpowers/specs/2026-11-25-fase-1-entrega-5-design.md`](../specs/2026-11-25-fase-1-entrega-5-design.md) (aprobado el 25-11). Sus números de sección (3.2, 4.3, 5.1…) se citan abajo. Parte del plan de la fase, [`2026-11-24-fase-1-traduccion.md`](2026-11-24-fase-1-traduccion.md).

## Global Constraints

- Trabajo de **Idiomas Puentes**: Claude escribe, prueba y revisa con subagentes. Nunca Cursor.
- Las del plan de la fase («Global Constraints») valen todas aquí: textos con `useT()` / `tNow()` en `es.json` y `pt.json` (editados con Edit o con un guion que lee antes de escribir), «usted» en la app, ningún nombre de proceso en `src/` (`verify:decoupling`), límites de pantalla, regla `html[data-text] … { font-size: calc(Xrem * var(--ts)); }` para cada texto nuevo, commits en inglés con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, nada se publica sin el OK de Abel, todo contra el mock.
- **No cambia la regla de cierre** (decisión 1): quien revisa aprueba, la autora confirma, nada se aprueba con algo abierto. «Estoy de acuerdo» llama al mismo `approve()` / `approveStep`.
- **No se toca el guardado de los editores** (PR #48). «Usar estas palabras» escribe en la caja como si la autora tecleara; guardar sigue siendo del editor.
- **Rama:** `claude/fase-1-entrega-5` desde `origin/main` **con los PR #61, #62 y #63 fusionados** (el diseño parte de B5, C3 y C6). Si alguno no está fusionado, se pregunta a Abel antes de empezar; no se parte de ramas sin fusionar sin su OK.
- Pruebas que siguen pasando al cerrar: `npx tsc --noEmit -p .`, `verify:decoupling`, `verify:config`, `verify:guide`, `verify:review-items`, `verify:review-changes`, `verify:step-claim`, `verify:my-tasks-board`, `verify:text-size`. `verify:prep` falla desde antes.
- Cada texto que se propone o se compara usa **la forma de la caja del editor** (spec 3.2): para un versículo, `verseLinesText(usfm, span)` de `src/domain/usfmEdit.ts`; para una fila de ayuda, `said` / `answer` de `helpRows` (`reviewItems.ts`, que la Tarea 3 exporta; ya pasan por `noteFromTsv`); para un párrafo, la traducción de la fila de `articleRows(source, value)` (`articleBlocks.ts`).
- «Cómo probar» (mock propio, Vite en el worktree, siembra, guiones `asUser` / `audit` / `tsize`): en el relevo de la construcción de esta entrega, `2026-11-25-fase-1-entrega-5-construccion.md`, en la carpeta de notas de la sesión que lo escribió.

## Review Focus

1. **Una propuesta sobre un versículo de poesía con nota al pie** (`\q1`/`\q2` y `\f…\f*`): proponer y usar deja las mismas marcas de línea y la nota; solo cambian palabras. Prueba en la Tarea 1 (`sameShape`) y en el navegador en la Tarea 8.
2. **Un teléfono con la versión anterior de la app escribe la marca de la tarea** después de que se pidieron cambios: `returned` desaparece y la segunda vuelta se lee sin marcas y sin error. Prueba en la Tarea 2 (una marca sin `returned` se lee igual).
3. **Dos personas revisan; una se sienta después de que la otra pidió cambios**: la recién llegada ve una primera vuelta (sin marcas, pie con borde hasta el final). Prueba en la Tarea 3 (`secondRoundFor`).
4. **La autora usa una propuesta en una ayuda y entrega sin tocar «Guardar»**: la revisión la ve abierta, porque el borrador entregado no la tiene. Prueba en la Tarea 1 (`openComments` con el texto de la cabeza) y en el navegador en la Tarea 8.
5. **La autora borra la fila de ayuda sobre la que había una propuesta**: la propuesta aparece con los comentarios de todo el pasaje, abierta, y quien la propuso puede darla por resuelta; nunca queda invisible bloqueando «Estoy de acuerdo». Prueba en la Tarea 1 (`textAt` devuelve `undefined`) y en la Tarea 5 (dónde se muestra).

---

## Task 1: Las propuestas como datos

**Files:**
- Create: `src/domain/reviewProposals.ts`
- Modify: `src/domain/reviewComments.ts` (`ReviewComment`, `reviewCommentsFrom`, `openComments`, `canEditComment`)
- Test: `scripts/verify-review-proposals.mts` (nuevo), y `"verify:review-proposals": "tsx --tsconfig tsconfig.scripts.json scripts/verify-review-proposals.mts"` en `package.json`

**Interfaces:**
- Produces:
  - `type PieceText = { text: string; secondary?: string }`
  - `type Proposal = { over: PieceText; words: PieceText; why?: string }`
  - `PROPOSAL_SCHEMA = "taller-proposal-1"`
  - `formatProposal(book: string, ref: string, proposal: Proposal, visible: string): string`: el cuerpo entero del comentario (spec 5.1). `visible` es la frase «Propongo: «…»» ya traducida, que da la pantalla.
  - `parseProposal(body: string): (Proposal & { ref: string }) | null`
  - `withoutProposalMarker(text: string): string`
  - `sameWords(a: string, b: string): boolean`: ignora espacios y comillas («» “” ‘’ " ').
  - `samePiece(a: PieceText, b: PieceText): boolean`
  - `proposalUsed(proposal: Proposal, now: PieceText | undefined): boolean`
  - `sameShape(proposal: Proposal, now: PieceText): boolean`: mismo número de líneas (`textLines`) en cada parte.
  - `ReviewComment.proposal?: Proposal`
  - `openComments(comments, draftAuthor?, textAt?: (ref: string) => PieceText | undefined, frozen?: boolean)`
  - `canEditComment(comment, all, login, opts: { reviewOpen: boolean; kept?: boolean; used?: boolean })`

- [ ] **Step 1: Write the failing tests** en `verify-review-proposals.mts`, con el estilo de `verify-review-changes.mts` (`test(name, fn)` y `said(id, login, body)`):
  - `"una propuesta escrita y leída da los mismos datos"`: `parseProposal(formatProposal("EST", "1:3", p, "Propongo: «…»"))` es `p` con `ref: "1:3"`; `reviewCommentsFrom` da `ref "1:3"`, `proposal` igual a `p` y `text` sin `<!--`.
  - `"un comentario de antes se lee igual"`: un cuerpo `refComment("EST","1:2","Falta «el».")` da `proposal` `undefined` y el mismo `text` que hoy.
  - `"una pregunta propone pregunta y respuesta juntas"`: `words.secondary` se conserva.
  - `"usada si el texto dice lo propuesto, aunque cambien espacios y comillas"`: `proposalUsed({…words:{text:"dijo: «ven»"}}, {text:"dijo:  \"ven\""})` es `true`; con una palabra distinta, `false`; con `now` `undefined`, `false`.
  - `"una propuesta usada no cuenta como abierta; retocada sí; con la pieza borrada sí"`: `openComments(rows, AUTHOR, textAt)` con tres `textAt`.
  - `"con el paso cerrado no se compara"`: `openComments(rows, AUTHOR, undefined, true)` no la cuenta como abierta.
  - `"un cambio solo de comillas o espacios no es una propuesta"`: `samePiece({text:"«a» b"},{text:"“a”  b"})` es `true`.
  - `"la forma cambió si cambió el número de líneas"`: `sameShape` con 2 líneas propuestas y 3 en la caja es `false`.
  - `"una propuesta usada no se cambia ni se borra"`: `canEditComment(row, rows, REVIEWER, { reviewOpen: true, used: true })` es `false`.

- [ ] **Step 2: Run** `npm run verify:review-proposals`. Esperado: falla al importar `reviewProposals`.

- [ ] **Step 3: Implement** `reviewProposals.ts`.
  - El marcador es `<!-- taller-proposal BASE64URL(JSON) -->` con `encodeBase64Url` / `decodeBase64Url` de `markerCodec.ts`. **Nunca** `tas:` ni `gateway-` (los filtra `isMachineComment`).
  - La línea visible va con `refComment(book, ref, visible)`. Si hay `why`, va en una línea aparte. El marcador va al final, tras una línea en blanco.
  - En `reviewCommentsFrom`, `text` pasa por `withoutProposalMarker` y se agrega `proposal` cuando `parseProposal` da algo.
  - `openComments` excluye una propuesta cuando hay `frozen`, o cuando `textAt` existe y `proposalUsed(p, textAt(ref))`. Sin `textAt` (otra pantalla), cuenta como hoy.
  - `canEditComment` devuelve `false` con `opts.used`.

- [ ] **Step 4: Run** `npm run verify:review-proposals`, `npm run verify:review-changes` y `npx tsc --noEmit -p .`. Esperado: todo pasa.

- [ ] **Step 5: Commit** `Review: proposals of other words as review comments`.

## Task 2: La versión devuelta en la marca de la tarea

**Files:**
- Modify: `src/domain/taskProgress.ts` (`StepRuntime`, `normalizeStepRuntimes`, `kept`, `withStepRuntime`); `src/domain/stepClaim.ts` (`askForChanges`, `takeBack`)
- Test: `scripts/verify-step-claim.mts`

**Interfaces:**
- Produces:
  - `StepRuntime.returned?: { sha: string; seated: string[] }`
  - `askForChanges(progress, steps, step, login, sha?: string)`
  - `takeBack(progress, steps, step, login, author, sha?: string)`
  - Con `sha`, anotan `returned = { sha, seated: runtime.assignees }`. Sin `sha`, quitan un `returned` viejo: una vuelta sin versión no se compara con una anterior.

- [ ] **Step 1: Write the failing tests** en `verify-step-claim.mts`:
  - `"pedir cambios anota la versión y quiénes estaban sentados"`.
  - `"la autora que toma su borrador también la anota"`.
  - `"la versión sobrevive a sentarse, aprobar, contar el trabajo y cambiar la revisión"`: después de `claimStep`, `approveStep`, `withStepWork` y `changeReview`, `returned` sigue igual.
  - `"la marca escrita y leída conserva la versión"`: `parseTaskProgressMarker(encodeTaskProgressMarker(m))`.
  - `"una marca sin versión se lee sin error"`.
  - `"devolver otra vez reemplaza la versión"`.
- [ ] **Step 2: Run** `npm run verify:step-claim`. Esperado: fallan las pruebas nuevas.
- [ ] **Step 3: Implement.**
  - `normalizeReturned(raw)` exige un `sha` no vacío y normaliza `seated` con `normalizeLoginList`.
  - Se agrega a `kept()` y a `withStepRuntime`, campo por campo, como `done`.
- [ ] **Step 4: Run** `npm run verify:step-claim`, `verify:review-changes`, `verify:my-tasks-board` y `tsc`. Esperado: todo pasa.
- [ ] **Step 5: Commit** `Review: keep the version a draft was sent back at`.

## Task 3: Qué cambió en la segunda vuelta, para quién

**Files:**
- Modify: `src/domain/reviewItems.ts`
- Test: `scripts/verify-review-items.mts`

**Interfaces:**
- Consumes: `StepRuntime.returned` (Tarea 2).
- Produces:
  - `secondRoundFor(runtime: StepRuntime, login: string): string | null`: el `sha` si `login` está en `returned.seated` (sin importar mayúsculas); si no, `null`.
  - `changedSince(params: { filename: string; now: string; then: string; range: RefRange; source?: string }): string[]`: los lugares de las piezas cuyo texto, en la forma de la caja, difiere entre `then` y `now`. En un `.usfm`, el `ref` del versículo; en un `.tsv`, el lugar de cada fila (`helpRowRef`) y, para las introducciones, `introPieceRef` de cada párrafo; en un `.md`, `pieceRef(filename, i)` de cada fila de `articleRows(source, …)` (con `source`, el inglés del archivo). Una pieza que está en una versión y no en la otra cuenta como cambiada. Son los mismos lugares que usan los comentarios, para que la pantalla marque con ellos.
  - `export` de `helpRows` (hoy interna), para la forma de la caja de una fila.
  - `lastPieceToSee(keys: string[], changed: string[] | null): string | undefined`: la última de `changed` si hay alguna; si no, la última de `keys`.

- [ ] **Step 1: Write the failing tests:**
  - `"solo quien estaba sentado ve la segunda vuelta"`.
  - `"cambió un versículo de cuatro"` (USFM con `\v 1`–`\v 4`).
  - `"una fila de ayuda cambió, otra no, otra se borró"` (por id, la borrada cuenta).
  - `"un párrafo de un artículo cambió"` (con su inglés de `source`: solo ese `pieceRef`).
  - `"un párrafo de la introducción del capítulo cambió"`.
  - `"sin cambios, se lee hasta el final"`: `lastPieceToSee(keys, [])` es la última de `keys`.
- [ ] **Step 2: Run** `npm run verify:review-items`. Esperado: fallan las nuevas, y solo lo que ya fallaba en `main` falla además.
- [ ] **Step 3: Implement.**
  - Versículos y filas: `verseItems` / `rowItems` con `before = then`, las piezas con `state !== "same"`, comparadas en la forma de la caja.
  - Párrafos: `articleRows` de las dos versiones contra la misma fuente, fila por fila. `articleItems` no sirve: da una pieza por archivo.
- [ ] **Step 4: Run** la misma prueba y `tsc`.
- [ ] **Step 5: Commit** `Review: what changed since the draft went back, and for whom`.

## Task 4: Escribir en Door43

**Files:**
- Modify: `src/dcs/reviewComments.ts`; `src/components/PortionReviewView.tsx` (`comment`, `correct`, `approve`, `changeComment`)

**Interfaces:**
- Consumes: Tareas 1 y 2.
- Produces:
  - `proposeWords(session, marker, book, ref, proposal: Proposal, visible: string): Promise<void>`
  - `editProposal(session, marker, comment: ReviewComment, proposal: Proposal, visible: string): Promise<void>`: reescribe el cuerpo entero con `formatProposal`.

- [ ] **Step 1: Implement** las dos funciones. `proposeWords` publica con `commentOnPortionPr` (`src/dcs/portionPr.ts`), como `comment()` hoy; `editProposal`, con `editIssueComment`, como `editReviewComment`.
- [ ] **Step 2:** Leer `getBranchSha(dcsConfig(host), marker.owner, marker.repo, marker.head, token)` (`src/dcs/pulls.ts`, devuelve `string | null`; un error cuenta como `null`) justo antes de `setIssueTaskProgress`, en los **tres** lugares que devuelven el borrador:
  - `comment(…, askChanges=true)` en `PortionReviewView`;
  - `correct()` en `PortionReviewView`;
  - `takeBack` en `MyTasksView.tsx` (~675), que lee el marcador del PR de la incidencia (`parsePortionPrMarker`).

  Pasarlo a `askForChanges` / `takeBack`. Con `null`, se escribe sin `returned`.
- [ ] **Step 3:** En `approve()`, además de releer los comentarios, releer de `marker.head` los archivos que tienen propuestas abiertas y construir `textAt` con la forma de la caja. Pasarlo a `openComments`.
- [ ] **Step 4:** En `changeComment`, un comentario con `proposal` va a `editProposal`, nunca a `editedCommentBody`.
- [ ] **Step 5: Run** `tsc`. Comprobar en el mock (ver «Cómo probar» en el relevo) que una propuesta escrita aparece en la API de comentarios con su marcador, y que pedir cambios deja `returned` en el cuerpo de la incidencia.
- [ ] **Step 6: Commit** `Review: write proposals and keep the version when sending back`.

## Task 5: Quien revisa lee el pasaje como texto

**Files:**
- Modify: `src/components/PortionReviewView.tsx` (`itemRow`, `rv-bar`, `rv-general`, el bloque de `ArticleBlocks` e introducciones); `src/styles/components.css`; `es.json` y `pt.json`

**Interfaces:**
- Consumes: `openComments(…, textAt, frozen)` (Tarea 1), `changedSince` y `secondRoundFor` (Tarea 3).
- Produces: estado `openPiece: string | null` (el lugar de la pieza abierta) y `seen: Set<string>` (los lugares que estuvieron en pantalla), que usan las Tareas 6 y 7. En los artículos y las introducciones, la pieza abierta sigue siendo la de `usePieces` (`pieces.active` / `pieces.open`): `openPiece` se deriva de ella con `pieceRef` / `introPieceRef`, sin un segundo estado.

- [ ] **Step 0:** `textAt` sale de lo que la pantalla leyó de la cabeza del PR. `frozen` es `stepDone` (spec 4.3: un paso cerrado no se vuelve a comparar). Las dos se pasan a cada `openComments` de la pantalla.
- [ ] **Step 1:** Cada pieza cerrada muestra solo su lugar y su texto, en la forma de la caja (spec 3.1). Lleva un punto si tiene conversación y otro, distinto, si tiene algo abierto. Mide 44 px de alto como mínimo y abrirla es un `button`.
- [ ] **Step 2:** La pieza abierta muestra la fuente (`versesOf`, `NoteQuote`, el inglés), `Hints`, la conversación y un lugar vacío para «No del todo…» (Tarea 6). Abrir otra cierra esta, salvo que tenga una caja con texto (A1).
- [ ] **Step 3:**
  - Quitar de `rv-bar` el conteo y «Mostrar fuentes». Se queda «Ver las {n} que faltan» (`rv.seeMissingMany`), solo si faltan.
  - «Ver lo que cambió» queda solo en la primera vuelta y solo si alguna pieza tenía texto del equipo (spec 3.5).
  - En la segunda vuelta, para `secondRoundFor(runtime, me)`, leer el archivo en ese `sha`, marcar con `diffWords` las piezas de `changedSince` y poner arriba la línea «{who} cambió {n} versículos desde que se lo devolvieron» o «{who} no cambió el texto. Vea lo que respondió.».
- [ ] **Step 4:**
  - Los comentarios de todo el pasaje van al final, tras el enlace «Decir algo sobre todo el pasaje», y su caja ya no ofrece «Pedir cambios».
  - Allí van también las propuestas cuya pieza ya no está.
- [ ] **Step 5:** Cada texto nuevo lleva su regla `html[data-text]`. Correr `verify:text-size`.
- [ ] **Step 6:** En el navegador, a 375 px, con Bea en Ester 1:1–4 del TPL y en Notas: medir con `audit()` (los 12 controles se cuentan alrededor de la pieza abierta, spec 6). Lo mismo a 1280 px.
- [ ] **Step 7: Commit** `Review: read the passage as text, one piece open at a time`.

## Task 6: «No del todo…», la propuesta y el menú «…»

**Files:**
- Create: `src/components/ProposalBox.tsx` (las cajas ya escritas, «Decir por qué», «Enviar propuesta»)
- Modify: `src/components/PortionReviewView.tsx` (`commentRow`, pieza abierta); `components.css`; `es.json` y `pt.json`

**Interfaces:**
- Consumes: `proposeWords` y `editProposal` (Tarea 4), `samePiece` (Tarea 1).
- Produces: `ProposalBox({ initial: PieceText; busy: boolean; onSend(words: PieceText, why?: string): void; onCancel(): void })`.

- [ ] **Step 1:** En la pieza abierta, para quien revisa (no para la autora), el enlace «No del todo…» abre dos botones: «Proponer otras palabras» y «Comentar algo».
  - Donde no se puede proponer (un segmento `1:3a`, una fila sin id), «No del todo…» abre directamente la caja de comentario.
  - Las cajas abiertas conservan lo escrito (A1, `boxes`).
- [ ] **Step 2: Implement `ProposalBox`.**
  - Abre con `initial` ya escrito; en Preguntas, dos cajas.
  - «Enviar propuesta» queda apagado mientras `samePiece(initial, words)`.
  - «Decir por qué» abre su caja solo al tocarlo.
  - Una propuesta se ve en la conversación con `diffWords(over, words)` marcado.
- [ ] **Step 3: El comentario con su menú.**
  - A la vista, solo «Resuelto» / «Abrir otra vez» (`canResolveComment`).
  - «…» abre una hoja con «Cambiar», «Borrar», «Guardar como regla del equipo» y «Llevar al glosario», según lo que hoy decide cada uno. Sin nada que ofrecer, no hay «…».
  - Con más de dos comentarios, se ven los dos últimos y «Ver {n} comentarios antes»; los resueltos se pliegan primero.
  - Una propuesta usada se ve «Usada por @{who}» (`who` es la autora, `author`).
  - `used` para `canEditComment` se calcula con `proposalUsed(p, textAt(ref))` en `commentRow` y otra vez en `changeComment`, con lo releído. Como hoy, una propuesta que alguien ya respondió en ese lugar no se cambia (`answered` en `canEditComment`).
- [ ] **Step 4:** En el navegador: Bea propone en el 1:3 y lo cambia desde «…»; Ana ve el cambio. Medir a 375 px una pieza con tres comentarios.
- [ ] **Step 5: Commit** `Review: say «No del todo…» with other words or a comment`.

## Task 7: El pie y lo que pasa al pedir cambios

**Files:**
- Modify: `src/components/PortionReviewView.tsx` (`status`, `tool-foot`, `askNow`); `es.json` y `pt.json`

**Interfaces:**
- Consumes: `seen` y `openPiece` (Tarea 5), `lastPieceToSee` (Tarea 3), `StageWindow`.

- [ ] **Step 1: Los estados del pie** (spec 3.3), cada uno con un solo botón lleno:
  - «Estoy de acuerdo», con borde hasta que `seen` tenga `lastPieceToSee(...)` y lleno después.
  - «Pedir cambios», cuando lo abierto es mío.
  - Ningún botón, con la línea que nombra a quien dejó algo abierto y lleva a ello. Ya no hay «Aprobar» lleno y apagado.
  - «Pedir que lo termine», con «Estoy de acuerdo así» con borde.
  - «Volver a mis tareas», con «Cambiar mi revisión».
  - La autora conserva «Para mí está bien» y «Entregar al grupo».
- [ ] **Step 2: Saber qué se vio.**
  - `seen` se llena con un `IntersectionObserver` cuyo `root` es el contenedor que se desplaza (`pieces.pane`), no la ventana.
  - Si todo cabe en la pantalla, se llena al abrir.
  - Tocar «Estoy de acuerdo» con borde pregunta «Todavía no llegó al final. ¿Está de acuerdo con todo el pasaje?», con «Sí, estoy de acuerdo» y «Seguir leyendo».
- [ ] **Step 3:** Después de «Pedir cambios» se abre la ventana de la spec 3.4, con «Volver a mis tareas» como único botón lleno.
- [ ] **Step 4:** En el navegador:
  - el pie con borde se llena al ver el 1:4;
  - el pie no se apaga lleno;
  - la ventana se abre tras pedir cambios;
  - Carla, sentada después, ve la primera vuelta.
- [ ] **Step 5: Commit** `Review: one obvious button at the foot, filled once read`.

## Task 8: La autora: «Responder» y «Usar estas palabras»

**Files:**
- Modify: `src/components/PortionReviewView.tsx` (pieza abierta de la autora, pie); `src/components/ScriptureEditorView.tsx`; `src/components/HelpsEditorView.tsx`; `src/components/ArticleBlocks.tsx` (si hace falta una forma de reemplazar el valor de una fila); `es.json` y `pt.json`

**Interfaces:**
- Consumes: `proposalUsed` y `sameShape` (Tarea 1), `openComments(…, textAt)`, con `textAt` sacado de las cajas.

- [ ] **Step 1: En la revisión.**
  - En la pieza abierta, la autora tiene «Responder» y no «No del todo…».
  - Una propuesta se ve marcada contra su texto, con «Corregir mi borrador» (`openDraft` con `focus` en ese lugar).
  - El pie, mientras haya algo abierto, lleva con «Corregir mi borrador» al primer lugar abierto.
- [ ] **Step 2: En `ScriptureEditorView`, junto al comentario de B5.**
  - Hoy el editor guarda solo `openComments(all, owner)` al cargar (~1491 y ~1523 en la rama de la entrega 4; en `HelpsEditorView`, ~384). Pasa a guardar **todos** los comentarios y a calcular lo abierto en cada render con `openComments(all, owner, textAt)`, donde `textAt` lee la caja de cada pieza: así «Usada» se ve al tocar el botón.
  - La propuesta se ve con `diffWords(caja, words.text)`.
  - «Usar estas palabras» solo aparece si se cumplen tres cosas:
    - **el mismo lugar**: hay una caja cuyo lugar es exactamente `ref` (no un puente que lo contiene);
    - `sameShape(p, caja)`;
    - el borrador es el propio (no `onTeamDraft`).
  - Con dos propuestas en la misma pieza, cada una tiene su botón; usar una deja la otra abierta, marcada contra la caja nueva. Comprobarlo en el paso 4.
  - Al tocarlo, se escribe en la caja por el mismo camino que una tecla, para que el editor conserve las marcas de línea y las notas.
  - Sin la misma forma, se ve la línea «El versículo cambió de forma; escriba los cambios a mano».
- [ ] **Step 3:** En `HelpsEditorView` se hace lo mismo para una nota o una pregunta (las dos partes), y para un párrafo de artículo a través de la fila de `ArticleBlocks`.
- [ ] **Step 4: En el navegador, contra el mock sembrado** (no en modo de prueba):
  - Ana usa la propuesta del 1:3 y entrega;
  - Bea ve solo el 1:3 marcado y «Usada por @ana»;
  - un versículo de poesía con nota al pie conserva sus líneas y la nota (leerlo en la API del mock);
  - en Notas, usar sin «Guardar» deja la propuesta abierta en la revisión;
  - con dos propuestas en el 1:3, usar una deja la otra abierta;
  - Ana une el 1:3 y el 1:4 en un puente: la propuesta del 1:3 se ve sin el botón.
- [ ] **Step 5: Commit** `Editors: use the words a reviewer proposed`.

## Task 9: Cerrar la entrega

- [ ] **Step 1:**
  - Guía de la revisión (`ReviewGuide`): señala una pieza, «No del todo…» y el pie, y espera; `verify:guide`.
  - Revisar el portugués con `npm run translations:review`; `verify:config`.
- [ ] **Step 2:** El recorrido completo de la spec 7 (pasos 1 a 8) a 375 px y a 1280 px, con la letra normal y «más grande» (`tsize()`), y en portugués. Para Palabras o Academia, marcar a mano un artículo como pendiente.
- [ ] **Step 3:** Correr todas las pruebas de «Global Constraints».
- [ ] **Step 4:** Revisión del diff entero por un pez dorado (Sonnet) que lea solo la spec y el diff. Como cambia el formato de los datos, que un segundo (Opus o Fable) lea solo las Tareas 1, 2 y 4. Corregir y volver a revisar hasta que salga limpio.
- [ ] **Step 5:** Con el OK de Abel, subir la rama y abrir el PR. En la descripción: lo medido, lo que no se probó (teléfono real) y que no hay migración.
