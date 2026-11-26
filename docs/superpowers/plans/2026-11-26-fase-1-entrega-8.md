# Fase 1, entrega 8 — Las ayudas se guardan solas, en el borrador propio: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** el editor de ayudas guarda solo, 3,5 s después de la última tecla, cuando escribe en el borrador propio de la persona. En el borrador del equipo (`shared`) sigue pidiendo «Guardar». En el borrador propio, el pie ya no tiene «Guardar»: solo «Reintentar» tras un fallo.

**Architecture:** no hay datos nuevos ni cambia cómo se escribe un archivo. Se agregan:

- en el dominio, una función pura que dice si toca guardar (`autosaveDue`, en `src/domain/helpsAutosave.ts`);
- en la apertura del editor, el aviso `lostItsBranch()` cuando la rama propia ya no se puede leer;
- que `saveTextOnPortionBranch` devuelva el `restored` que ya da `ensureTaskBranchFromBook`;
- en `HelpsEditorView`, el temporizador, el reintento y el pie nuevo.

**Tech Stack:** React 18 + Vite + TypeScript. Pruebas en `scripts/verify-*.mts` con `tsx` y `node:assert/strict`. El mock de Door43 (`scripts/mock-door43/server.mjs`) y el panel del navegador con `preview_start`.

**Spec:** [`docs/superpowers/specs/2026-11-26-fase-1-entrega-8-design.md`](../specs/2026-11-26-fase-1-entrega-8-design.md). Abajo se citan sus secciones (3.1, 4…). Es parte del plan de la fase, [`2026-11-24-fase-1-traduccion.md`](2026-11-24-fase-1-traduccion.md), «Entrega 8».

## Global Constraints

- **Trabajo de Idiomas Puentes:** Claude escribe, prueba y revisa con subagentes. Nunca Cursor.
- **Textos de la interfaz:** con `useT()` / `tNow()` y claves en `src/i18n/locales/es.json` y `pt.json`. Esos dos archivos se editan con Edit, nunca con `sed -i` ni con un `python -c` que abra y escriba a la vez. La app trata de «usted».
- **Ningún nombre de proceso en `src/`** (`npm run verify:decoupling`).
- **El editor del texto no se toca** (`ScriptureEditorView.tsx`). Ni su guardado ni su reintento.
- **El camino de `shared` no cambia:** sigue con su botón «Guardar», su anuncio `he.savedShared` y sin temporizador.
- **Las pruebas de la Tarea 1 se escriben y pasan antes de la Tarea 3**, y siguen pasando al final (lo pide el plan de la fase).
- **Rama:** `claude/fase-1-entrega-8` desde `origin/main`. La entrega 7 (PR #75) cambia los avisos de `HelpsEditorView.tsx` (hacia las líneas 1170–1215), no el guardado: si se fusiona antes, rebase.
- **Commits:** en inglés, con título corto y un cuerpo que explique el porqué, y que terminen con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nada se publica sin el OK de Abel.** Todo se prueba contra el mock, nunca en modo de prueba (memoria `trial-mode-proves-no-writes`).
- **Pruebas que deben pasar al cerrar:**
  - `npx tsc --noEmit -p .`
  - `npm run verify:helps-autosave` (nueva), `verify:draft-cache`, `verify:book-bootstrap`, `verify:helps-table`, `verify:config`, `verify:decoupling` y `verify:text-size`
  - `verify:prep` y `verify:review-items` ya fallaban antes: no son de esta entrega.

## Review Focus

1. **La rama propia desapareció y el aparato dice que lo guardó ahí.** La apertura no da lo del aparato por guardado, y ni la primera tecla ni el guardado solo lo pisan (spec 4.1). Tarea 1 y Tarea 2.
2. **Un guardado solo y «Terminé el borrador» casi a la vez.** Nunca dos escrituras del mismo archivo en vuelo: la segunda daría «sha does not match». Tarea 3 y navegador.
3. **Seguir escribiendo mientras se guarda.** Lo escrito en ese rato no se da por guardado (`editCount`, como hoy) y se guarda en la vuelta siguiente. Tarea 3 y navegador.
4. **Un fallo de red.** Un solo intento por tecla o por «Reintentar», nunca un bucle. Tarea 1 (`autosaveDue`) y navegador (contar pedidos en el mock).
5. **El borrador del equipo** (`shared`) no se guarda nunca solo. Tarea 1 y navegador.

---

## Task 1: Las pruebas antes de tocar nada

**Files:**
- Create: `src/domain/helpsAutosave.ts`
- Create: `scripts/verify-helps-autosave.mts`; agrega `"verify:helps-autosave": "tsx scripts/verify-helps-autosave.mts"` a `package.json`
- Modify: `scripts/verify-draft-cache.mts`
- Modify: `scripts/verify-book-bootstrap.mts`

**Interfaces:**
- Produces, en `helpsAutosave.ts`:
  ```ts
  export type AutosaveState = {
    shared: boolean; hasSession: boolean; dirty: boolean; saving: boolean;
    finishing: boolean; openingPr: boolean; busy: boolean; hasItems: boolean;
    /** «¿Entregar con piezas sin traducir?» is open. */
    confirming: boolean;
    /** `labWriteDecision(ctx).mode === "blocked"`: nothing can be saved. */
    blocked: boolean;
    /** The last save failed and nothing was typed since, nor did the connection come back. */
    failedSinceEdit: boolean;
  };
  export const AUTOSAVE_DELAY_MS = 3500;
  export function autosaveDue(s: AutosaveState): boolean;
  ```
  `autosaveDue` es verdadero solo si `!shared && hasSession && dirty && !saving && !finishing && !openingPr && !busy && hasItems && !confirming && !blocked && !failedSinceEdit`. En el editor, el objeto se arma en el cuerpo del componente con los estados que ya existen (`confirming` ya es un estado).

- [ ] **Step 1: `verify-helps-autosave.mts`**, una prueba por línea, con nombres en español que cuenten lo que se verifica:
  - `"se guarda solo con algo por guardar en el borrador propio"`.
  - `"el borrador del equipo nunca se guarda solo"` (`shared: true`).
  - `"sin sesión, guardando, terminando, abriendo la revisión, con la pregunta de entregar abierta o bloqueado, no"`.
  - `"tras un fallo no se reintenta hasta otra tecla o hasta que vuelva la red"` (`failedSinceEdit: true` → falso).
- [ ] **Step 2: el caso 1 del PR #48 en las ayudas**, en `verify-draft-cache.mts`, junto a las pruebas de `helpsDraftCacheOpening` (hacia la línea 620):
  - `"ayudas: la rama propia se perdió; lo guardado en el aparato no se pisa"`. Guarda con `saveHelpsDraftCache` una entrada con `texts: { n1: "Lo que ana tradujo" }`, `unsaved: false`, `branch` = la rama de trabajo y `typedOver` = el sello de ese mismo texto (lo que deja un guardado que salió bien). Abre con `helpsDraftCacheOpening`, llama a `lostItsBranch()` y responde con lo que da la rama principal: `now` = el sello de `"Texto en inglés"`, `same: false`, `blank: false`. La respuesta es `aside`, con los textos de ana, y `loadHelpsDraftCache(...).own?.unsaved` es `true`.
  - La misma, con Door43 en blanco (`now` vacío, `blank: true`): `restore`.
  - **Lo que pasa hoy**, sin `lostItsBranch()`: la misma entrada y la misma respuesta dan `saved`, y el editor muestra el texto en inglés. Deja esa aserción, con un comentario que diga que ese es el fallo que la apertura evita llamando a `lostItsBranch()` (Tarea 2).
- [ ] **Step 3: el caso 2 del PR #48 en las ayudas**, en `verify-book-bootstrap.mts`, con el Door43 falso (`installFakeDcs`, que ya tiene `listedGone`):
  - `"un guardado de ayudas sobre una rama listada sin commit la rehace y no borra nada"`: llama a `saveTextOnPortionBranch` con `repo: "es-419_tn"`, `filepath: "tn_NEH.tsv"`, `resource: "notas"` y la rama de trabajo en `listedGone`. La rama queda en el commit del borrador del grupo, el archivo se escribe ahí, no hay ningún `DELETE` y la respuesta trae `restored: true`.
  - `"un guardado de ayudas sobre una rama sana no la rehace"`: `restored` falta, la rama no se mueve.
  - El `sha` que se manda es el del archivo en el borrador del grupo, que es desde donde se rehace la rama.
  - `"un guardado de notas de quien aún no tiene rama no pisa las filas de otro pasaje que el grupo cambió"` (spec 4.3): el borrador del grupo y la principal difieren en una fila de otro pasaje; el editor leyó la principal (sin sha). Hoy esa fila vuelve a lo de la principal: escribe la prueba para que falle por eso. Pasa con la Tarea 2, paso 3.
  - Si el falso no sirve para `es-419_tn` tal como está (rutas, archivos), amplíalo lo justo y dilo en el commit.
- [ ] **Step 4:** corre `npm run verify:helps-autosave`, `verify:draft-cache` y `verify:book-bootstrap`. Las pruebas de `restored: true` y de las filas de otro pasaje deben fallar (la Tarea 2 las arregla); el resto debe pasar.
- [ ] **Step 5:** commit: `Helps: tests for saving by itself and the two failures fixed in #48`.

## Task 2: La apertura y el arranque saben que la rama se perdió

**Files:**
- Modify: `src/dcs/portionPr.ts` (`saveUsfmOnPortionBranch`, hacia la línea 886)
- Modify: `src/components/HelpsEditorView.tsx` (`load`, hacia las líneas 320–465; `save`, hacia 514)

**Interfaces:**
- `saveUsfmOnPortionBranch` y `saveTextOnPortionBranch` devuelven `{ sha?, commitSha?, branch, restored?: boolean }`, con `restored` tomado de `ensureTaskBranchFromBook`. El editor del texto no lo lee: no cambia.

- [ ] **Step 1:** en `saveUsfmOnPortionBranch`, pasa `task.restored` a la respuesta. `verify:book-bootstrap` pasa entero.
- [ ] **Step 2: la apertura** (spec 4.1). En `load`, crea **una sola** apertura `const opening = helpsDraftCacheOpening(launch, cache)` justo después de saber `launch` y `cache` (hacia la línea 334), y usa esa en `settle` en lugar de crear una en cada llamada. Después de `setBranch(head)` (hacia la línea 387, cuando `head` ya tiene en cuenta una revisión abierta) y antes de leer los archivos, en el camino que no es `shared` ni de laboratorio: si `cache?.unsaved === false` y `cache.branch === head`, pregunta por la ref de git de `head` (`getBranchSha` de `src/dcs/pulls.ts`, con `dcsConfig(sess.host)`). Si no tiene ref, llama a `opening.lostItsBranch()`. Si la pregunta falla por red, no hagas nada (como hoy). No cambies `readFilePreferBranch`.
- [ ] **Step 2b: el artículo que no se lee** (spec 4.4). En el bucle de los artículos (hacia la línea 449), el `catch` da `{ text: "" }` solo si el error es un 404 (`DcsApiError` con `status === 404`, o lo que lance `readFileOnRef`: míralo). Cualquier otro error se relanza y la apertura muestra su mensaje (el `catch` de `load` ya lo hace). Prueba en `verify-helps-autosave.mts` con una función pequeña que decida (`blankOnlyWhenMissing(err)`), si así queda más simple. Un fallo pasajero solo en la rama propia (la principal sí se lee) no lo ve este paso: deja el archivo sin sha de la rama, y lo cubre el paso 3.
- [ ] **Step 3: escribir sobre lo que hay en la rama** (spec 4.2 y 4.3). Hoy `readFileOnRef` sin `ref` (la lectura de respaldo de `readFilePreferBranch`, líneas 158–161) devuelve `sha: undefined`, y `writeRepoFile` sin sha busca el de la rama y escribe encima sin comparar (`src/dcs/repoFile.ts` 308–321). Eso se cierra así:
  1. **Preparar la rama una vez, al empezar el guardado.** Exporta en `src/dcs/portionPr.ts` un `prepareOwnBranch(params)` que llama a `ensureTaskBranchFromBook` con los mismos parámetros que hoy usa `saveUsfmOnPortionBranch` y devuelve `{ branch, restored }`. Recibe el `filepath` (lo usa `resolveBookBranchName`). `save` lo llama antes de decidir qué archivos escribir o saltar: en un TSV, una vez; en un artículo, una vez por archivo, como hoy hace cada escritura. `restored` es verdadero si alguna llamada lo dijo. Si dos llamadas devuelven ramas distintas, es un error y no se escribe nada. Si `ctx.book` está vacío no se puede preparar así: en ese caso el guardado solo no corre (`blocked` en `autosaveDue`) y el pie dice el error. En las tareas del plan siempre hay libro.
  2. **Escribir sin volver a preparar.** `saveTextOnPortionBranch` acepta un parámetro opcional `prepared: { branch: string }`. Con él no llama a `ensureTaskBranchFromBook` y escribe en esa rama. Acepta también `mustCreate?: boolean`, que pasa a `writeRepoFile`: con él, `writeRepoFile` no busca un sha antes (líneas 308–321) **ni** hace su reintento de 409/422 (hacia 333–352). Si el archivo ya existe, Door43 lo rechaza, y en el editor ese rechazo es un conflicto directo (paso 7), no un rechazo de sha que se repite (paso 5). Sin esos parámetros todo funciona como hoy (el editor del texto no los usa).
  3. **La decisión, pura** (en `src/domain/helpsAutosave.ts`), para probarla sin pantalla: `composeOnBranch({ kind, onBranch, base, edits })`. `onBranch` es el archivo leído ahora en la rama (`{ text, sha } | null` si no existe). `base` es **lo último que este editor leyó o escribió de ese archivo en la rama propia**: `files[filepath].text`, que `save` ya actualiza tras cada escritura (líneas 604 y 630). Da `{ content, sha, mustCreate? }` o `{ conflict: true }`:
     - `onBranch === null` → `{ content: <lo de hoy>, mustCreate: true }`.
     - **TSV:** si las filas de este pasaje en `onBranch.text` (como `rowsIn` en `load`: `selectTsvRowsForPortion` + `tsvRowsToDraftItems`) tienen los mismos sellos que las filas de este pasaje en `base`, da `{ content: applyHelpsTsvEdits(onBranch.text, edits), sha: onBranch.sha }`. Si no, `conflict`.
     - **Artículo:** si `onBranch.text === base`, da `{ content: articleAsWritten(onBranch.text, item.text), sha: onBranch.sha }`. Si no, `conflict`.
  4. **Cuándo se usa.** Todo se lee y se escribe en la rama que devuelve `prepareOwnBranch` (puede tener otro nombre que `head`: `canonicalWorkBranchName`), y `setBranch` queda en ella. En los dos caminos propios de `save`, para cada archivo: si `restored` es verdadero, o si no hay sha de la rama propia en `files` (se leyó de la principal o no existía), se lee el archivo en esa rama con `readFileOnRef` **con** `ref` (así trae sha) y se arma con `composeOnBranch`. **Con `restored`, `base` es el propio `onBranch`** (no se compara): la rama se acaba de cortar del borrador del grupo, nadie más escribe en ella, y el texto de la persona está en el editor y en el aparato. Se escriben encima sus filas o su artículo, como al cortarla la primera vez. Si hay sha de la rama propia y la rama no se rehízo, se escribe como hoy con ese sha. Lo que `composeOnBranch` da por `base` para un archivo que se leyó de la principal es el texto de la principal, y está bien: las filas de este pasaje en el borrador del grupo deben ser las que la persona vio al abrir.
  5. **Si Door43 rechaza el sha**, se repite ese archivo una sola vez, ahora leyendo en la rama y con `composeOnBranch`. Un segundo rechazo es un error y se dice. **Cómo se reconoce:** `writeRepoFile` envuelve los errores (`wrapWriteError`, `src/dcs/repoFile.ts` ~380): con `step` da un `BootstrapError` con `status`; sin él, un `Error` sin estado. Por eso `isShaConflict` (que solo mira `DcsApiError`) no lo ve. Haz dos cosas en `repoFile.ts`, sin cambiar ningún mensaje: (a) el `Error` sin estado lleva el original en `cause` (`new Error(msg, { cause: err })`; comprueba que el `target`/`lib` de `tsconfig` lo acepte); (b) exporta `writeRefusedStatus(err): number | undefined`, que devuelve el `status` de un `DcsApiError`, de un `BootstrapError` o de su `cause`. El editor usa `writeRefusedStatus(err)` 409 o 422, pero **primero** mira si esa escritura iba con `mustCreate`: entonces el rechazo es un conflicto directo (paso 7) y no se repite. Pruébalo en `verify-helps-autosave.mts` con los tres tipos de error.
  6. **`restored`.** Si `prepareOwnBranch` dio `restored: true`, además `helpsDraftCacheLostItsBranch(launch)` (expórtalo en `helpsDraftCache.ts`, como los otros, sobre `keptDraftLostItsBranch`), y en un artículo no se salta ningún archivo «porque no cambió»: todos pasan por `composeOnBranch`. La guarda de hoy se conserva: un archivo que no existe en la rama y cuyo texto está en blanco no se crea vacío (línea ~611).
  7. `settleSaved` corre solo si todos los archivos del guardado se escribieron. Si hubo un `conflict`, se lanza un error propio con el mensaje `he.conflict` (nuevo en `es.json` y `pt.json`: «Su borrador en Door43 cambió desde que lo abrió. Lo que escribió quedó en este teléfono; vuelva a abrir la tarea.»). `save` devuelve `false`, el error queda arriba y `failedSinceEdit` pasa a verdadero.
- [ ] **Step 4: pruebas de la regla.** En `verify-helps-autosave.mts`, una por rama de `composeOnBranch`: no existe; TSV con el pasaje igual (las filas de otro pasaje cambiadas en la rama **se conservan**); TSV con el pasaje distinto (`conflict`); artículo igual; artículo distinto. Con el falso, en `verify-book-bootstrap.mts` (Tarea 1, paso 3): un guardado de notas de quien no tiene rama, con el borrador del grupo distinto de la principal en otro pasaje, deja intacta esa fila del otro pasaje.
- [ ] **Step 5:** corre las pruebas de la Tarea 1 y `npx tsc --noEmit -p .`. Todas pasan.
- [ ] **Step 6:** commit: `Helps: a lost own branch is known when the editor opens and when it saves`.

## Task 3: El guardado solo

**Files:**
- Modify: `src/components/HelpsEditorView.tsx`

- [ ] **Step 1: `save` en silencio, y uno a la vez.** `save(opts?: { quiet?: boolean })`. Con `quiet` no anuncia `se.savedIn` ni `se.savedLocalAnnounce`. Un `useRef` `inFlight` guarda la promesa del guardado en vuelo, con el `editCount` con que empezó. Quien llama a `save` mientras hay uno en vuelo espera esa promesa. Si falló, devuelve `false`. Si salió bien y `editCount.current` no cambió desde que empezó, devuelve `true` sin escribir. Si cambió, guarda otra vez. Nunca hay dos escrituras en paralelo. No decidas con `dirty`: en el cierre que espera, ese valor es viejo. Por lo mismo, `save` lee `items`, `files` y `branch` de `useRef` que se actualizan en cada render (`itemsRef.current = items`, etc.), no del cierre: el guardado que se repite debe usar el texto con las teclas nuevas y el sha que dejó el guardado anterior. Así un temporizador que vence entre el clic en «Terminé» y el render siguiente no escribe dos veces. El camino `shared` no cambia, salvo que también pasa por `inFlight`.
- [ ] **Step 2: el modo de prueba local.** Cuando `labWriteDecision(ctx).mode === "local"`, `save` hace lo que hace el editor del texto: `setDirty(false)`, `setSavedOnce(true)` (estado nuevo en este editor) y anuncia solo sin `quiet`. Devuelve `true`. Con la tecla siguiente, `dirty` vuelve a ser verdadero y el pie dice «Sin guardar» (va antes en el orden de la Tarea 4).
- [ ] **Step 3: el fallo.** Estado nuevo `failedSinceEdit`. `save` lo pone en `true` cuando lanza un error o devuelve `false` con sesión (laboratorio bloqueado, destino sin resolver), y en `false` cuando sale bien. `updateItem` lo pone en `false` (otra tecla). Un `useEffect` escucha `window` `online` y lo pone en `false`; se quita al desmontarse.
- [ ] **Step 4: el temporizador.** Un `useEffect` con dependencias `[dirty, saving, finishing, openingPr, busy, items, confirming, failedSinceEdit, shared, session]`. Si `autosaveDue(...)` da verdadero, programa `save({ quiet: true })` a `AUTOSAVE_DELAY_MS` y lo limpia al volver a correr y al desmontarse. Como `items` cambia con cada tecla, la espera se reinicia con cada tecla. Como `failedSinceEdit` queda en `true` tras un fallo, el efecto que corre cuando `saving` vuelve a `false` no programa otro intento: así no hay bucle.
- [ ] **Step 5: «Terminé» y «Listo para revisión».** `finish` y `openPr` ya guardan si `dirty`. Mientras `finishing` u `openingPr`, `autosaveDue` da falso, así que el temporizador pendiente se limpia. Los botones ya se apagan con `saving`. Comprueba en el navegador que tocar «Terminé» un instante después de escribir hace un solo guardado (Review Focus 2).
- [ ] **Step 6:** commit: `Helps: the own draft saves itself a moment after the last key`.

## Task 4: El pie

**Files:**
- Modify: `src/components/HelpsEditorView.tsx` (pie, hacia las líneas 1376–1425)
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/pt.json`

**Copia nueva o cambiada:**
- `he.footSaveFailed`: es `No se pudo guardar; quedó en este teléfono.` · pt `Não foi possível salvar; ficou neste telefone.`
- `he.retry`: es `Reintentar` · pt `Tentar de novo`
- `he.footInReview` cambia a: es `Ya está en revisión. Lo que escriba se suma a ella.` · pt: la misma idea con «escrever» (lee la clave actual de `pt.json` y cambia solo el verbo).
- Revisa con `npm run translations:review` si hace falta, y corre `verify:config`.

- [ ] **Step 1: la línea del pie**, en este orden (spec 3.1): sin sesión → `he.footOffline`; `shared` → como hoy (`dirty` → `he.footUnsaved`, si no `he.footShared`); `failedSinceEdit` → `he.footSaveFailed`; `saving` → `se.saving`; `dirty` → `se.unsaved`; modo de prueba local con `savedOnce` → `se.savedHere`; si no, lo de hoy (`he.footPending…`, `he.footNotSaved`, `he.footInReview`, `he.footSaved`).
- [ ] **Step 2: los botones.** `shared`: como hoy. En los otros dos caminos se quita el botón «Guardar» (`he.save`). Con `failedSinceEdit`, aparece «Reintentar» (`variant="outline"`, `disabled={saving || finishing}`, `onClick={() => void save()}`, sin `quiet`) antes de «Terminé el borrador» o de «Listo para revisión». Sin sesión no hay «Guardar» ni temporizador: lo escrito queda en el aparato, como dice `he.footOffline`.
- [ ] **Step 3:** no se quita ninguna clave: `he.save`, `he.footUnsaved` y `he.savedShared` siguen en el camino `shared`. Corre `npx tsc --noEmit -p .`, `verify:config`, `verify:decoupling` y `verify:text-size`.
- [ ] **Step 4:** commit: `Helps: the foot says how saving goes; «Guardar» only for the team's draft`.

## Task 5: En el navegador, contra el mock

**El mock:** en un puerto libre, desde PowerShell y en segundo plano: `$env:MOCK_PORT='8803'; $env:MOCK_PM_ORG='es-419_gl'; $env:MOCK_SEED_BOOK='EST'; node scripts/mock-door43/server.mjs`. Está listo cuando `GET /api/v1/repos/es-419_gl/es-419_tn/contents` da 200. Las subtareas de prueba y la sesión de ana (`?mockUser=ana`) se siembran con los guiones que indica el relevo de esta construcción. Las notas y las respuestas se escriben en un `contenteditable` (`.mde-box`). Antes de repetir una prueba, borra los borradores del aparato (`tas-helps-draft*` en localStorage).

- [ ] **Step 1: nota, 375 px.** Abrir la subtarea de Notas de ana. Escribir en una nota. El pie dice «Sin guardar», luego «Guardando…», luego lo que queda por traducir; los botones no cambiaron. Recargar: la nota está. Leer el archivo **en el mock** (`GET /api/v1/repos/es-419_gl/es-419_tn/contents/<archivo>?ref=<rama de ana>`) y ver el texto escrito.
- [ ] **Step 2: pregunta y respuesta.** Lo mismo con Preguntas, escribiendo en la pregunta y en la respuesta.
- [ ] **Step 3: artículo de Palabras por piezas**, en escritorio. Si el mock no siembra Palabras (issue #77), dilo y prueba solo Notas y Preguntas.
- [ ] **Step 4: seguir escribiendo mientras guarda** (Review Focus 3): escribir, esperar a «Guardando…» y escribir más enseguida. Al final, recargar y ver todo.
- [ ] **Step 5: «Terminé» enseguida** (Review Focus 2): escribir y tocar «Terminé el borrador» antes de 3,5 s. Un solo `PUT` del archivo en `read_network_requests`, sin error.
- [ ] **Step 6: sin red** (Review Focus 4): detener el mock, escribir, esperar. El pie dice «No se pudo guardar; quedó en este teléfono.» y aparece «Reintentar». En 15 s no hay más de un pedido de guardado. Arrancar el mock y tocar «Reintentar»: guarda y «Reintentar» desaparece.
- [ ] **Step 7: la rama perdida** (Review Focus 1): con algo guardado, borrar la rama de ana en el mock (por la API del mock) y reabrir el editor. Lo del aparato vuelve o se muestra aparte; no se pisa con la primera tecla.
- [ ] **Step 8: el borrador del equipo** (Review Focus 5): abrir una tarea de corrección (`shared`). Escribir y esperar 10 s: no se guarda solo y «Guardar» sigue ahí.
- [ ] **Step 9:** medir el pie con el guion de auditoría a 375 px: botones de 44 px o más, un solo botón lleno. Con la letra grande, el pie crece. Captura del pie en los cuatro estados.
- [ ] **Step 10:** apagar el servidor de la app y el mock, quitar la entrada de `.claude/launch.json`.

## Task 6: Revisión y PR

- [ ] **Step 1:** un subagente Sonnet sin contexto revisa el diff contra el spec y este plan, con el Review Focus. Corregir hasta que salga limpio.
- [ ] **Step 2:** todas las pruebas de «Pruebas que deben pasar al cerrar».
- [ ] **Step 3:** con el OK de Abel, push y PR. Lo que quede fuera del alcance va a un issue (también con su OK).
