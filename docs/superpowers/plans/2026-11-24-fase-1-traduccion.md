# Fase 1 (Traducción) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que una persona poco hábil con la tecnología llegue de «Mis tareas» a la lectura del grupo tocando en cada pantalla solo el botón evidente, sin perder lo que escribe y con la letra del tamaño que eligió.

**Architecture:** el diseño se construye en entregas pequeñas, cada una en su rama y su PR, que se pueden publicar solas. Las entregas 0 a 4 cambian pantallas y orden, no cómo se guardan los datos. Las 5 y 6 (la revisión como conversación) llevan antes un diseño corto propio. La 8 toca el guardado de las ayudas y va al final.

**Tech Stack:** React 18 + Vite + TypeScript; pruebas `scripts/verify-*.mts` con `tsx` y `node:assert/strict`; mock de Door43 (`scripts/mock-door43/server.mjs`); panel del navegador de la app con `preview_start`.

**Spec:** [`docs/superpowers/specs/2026-11-23-fase-1-traduccion-design.md`](../specs/2026-11-23-fase-1-traduccion-design.md). Las letras y números (A1, B3, C6…) son los de su sección 4; las entregas, las de su sección 7.

## Global Constraints

- Trabajo de **Idiomas Puentes**: Claude escribe el código, lo prueba y lo revisa con subagentes. Nunca se lanza Cursor.
- Decisiones de Abel del 24-11: (1) la misma regla de cierre de la revisión, dicha como conversación; (2) entregar con un toque en la misma pantalla, no automático; (3) las ayudas se guardan solas solo en el borrador propio, en la entrega 8; (4) fuente y caja juntas en el teléfono.
- El código no conoce ningún proceso: ningún id ni nombre de fase, tarea, paso o herramienta en `src/` (`npm run verify:decoupling`). La revisión en pares y la lectura grupal se distinguen por la regla de cierre del paso (`closing: "consensus"` en la grupal).
- Texto de interfaz con `useT()` / `tNow()`. Claude escribe el español en `src/i18n/locales/es.json` y el portugués en `pt.json`, y los revisa con `npm run translations:review` ([`docs/TRADUCCION.md`](../../TRADUCCION.md)). `npm run verify:config` comprueba claves y `{marcadores}`.
- La app trata de **«usted»**. Al hablar con Abel, de tú.
- `es.json` y `pt.json` se editan con la herramienta Edit, o con un guion que lee el archivo antes de escribirlo. Nunca con una sola expresión que abra el archivo para escribir y lo lea (así se vaciaron una vez).
- No cambia quién debe estar de acuerdo para cerrar un paso, ni cómo se guarda nada, en las entregas 0 a 4 y 7.
- Diseño de pantallas: una sola cosa obvia que hacer, a 375 px: como mucho 12 controles, ninguno de menos de 44 px, un botón lleno, dos pantallas de alto; 24–32 px entre grupos y 8–12 dentro ([`docs/FILOSOFIA_DE_DISENO.md`](../../FILOSOFIA_DE_DISENO.md)). Cada texto nuevo que se lee o se escribe lleva su regla `html[data-text] … { font-size: calc(Xrem * var(--ts)); }`.
- Comentarios y commits en inglés, con título corto y un cuerpo que explique el porqué, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nada se publica sin el OK de Abel: ni push, ni PR, ni Cloudflare, ni Door43. Producción de Door43 no se toca para pruebas: todo contra el mock. Taller se publica **solo** con `npm run deploy -- --publish`.
- No se toca la entrada a la app: otra sesión diseña «Entrar con Door43».
- La carpeta principal (`gateway-tasks`) tiene cambios de Abel sin guardar (`scripts/mock-door43/server.mjs`, `AGENTS.md`, `.agents/`, `respaldos/`, `scripts/tmp-*`): no se tocan ni van en un commit.
- Pruebas que deben seguir pasando al cerrar cada entrega: `npx tsc --noEmit -p .`, `verify:decoupling`, `verify:config`, `verify:guide`, `verify:review-items`, `verify:review-changes`, `verify:my-tasks-board`, `verify:text-size` (estas tres últimas pasan desde la entrega 0). `verify:prep` falla desde antes y no es de este trabajo.

## Cómo probar en el navegador (vale para todas las entregas)

La receta completa está en el relevo de la etapa de diseño, `C:\Users\LENOVO\Git\Github\gateway-tasks\.claude\relevos\2026-11-23-fase-1.md` («Cómo probar»), y la resumida en `2026-11-24-fase-1-plan.md` de la misma carpeta. Lo esencial:

- **Mock propio** en un puerto libre (mira `netstat`; 8798 suele estar ocupado y `verify-unit-stage` usa 8797), en segundo plano: `$env:MOCK_PORT='8799'; $env:MOCK_PM_ORG='es-419_gl'; $env:MOCK_SEED_BOOK='EST'; node scripts/mock-door43/server.mjs`. Al terminar se detiene el proceso que escucha en ese puerto, después de comprobar que su línea de comando dice `mock-door43`.
- **Servidor desde el worktree:** una entrada en el `.claude/launch.json` del worktree (ignorado por git) con `npx vite --port 5188 --strictPort`, arrancada con `preview_start`. Se quita al terminar. El worktree necesita `.claude/worktrees/usfm-ast` (ya existe).
- **Libro nuevo, proyecto y subtareas:** Ester 1 vaciado en el mock, proyecto creado desde `/solver-stub.html`, **el capítulo entero publicado** (si faltan porciones, la lectura grupal parece ofrecerse vacía: es un falso hallazgo). Dos o tres personas en una pestaña cambiando `username` y `token` en `gt-dcs-session`.
- **Medir:** los guiones `audit(label)` (controles, menos de 44 px, botón lleno, alturas) y `tsize()` (textos que no crecen con la letra «más grande») están en el relevo `2026-11-24-fase-1-plan.md`. Se pegan en la pestaña.
- A 375 px y a 1280 px. Lo visible se mira también en portugués (`pt`).
- Al tocar por coordenadas en el tamaño de teléfono, se calculan desde `getBoundingClientRect`, no desde la imagen.

## Review Focus

1. **Mensajes ya publicados con «Te dejé»** (antes del 9-11): deben seguir sin contar como comentario abierto, igual que los nuevos con «Le dejé». Prueba en la Tarea 0.1.
2. **Dos cajas de comentario abiertas y enviar una:** la otra conserva su texto. Si el envío falla (sin red), la caja enviada conserva el suyo. Se comprueba en el navegador en la Tarea 0.2.
3. **Notas dentro de Afinación, Armonización y las hojas** (`NoteSheet`, `ProposalSheet`) con la letra «más grande»: crecen una sola vez y los paneles laterales siguen cabiendo a 1280 px. Tarea 0.3, paso de medida.
4. **Tarjeta con dos motivos a la vez** (falta mi acuerdo y además me pidieron cambios en otra porción): el botón lleno va a la que volvió a mí, nunca a un trabajo libre. Prueba en la Tarea 1.1.
5. **La misma subtarea entregada desde dos lugares** (la autora en dos pestañas, o la autora en la revisión y quien coordina desde «Mis tareas»): la entrega ocurre una vez y la segunda dice «Esta tarea ya se entregó», sin error. Tarea 1.4.

---

## Entrega 0 — Fallos que hoy afectan al equipo (A1, A2, A3)

Rama `claude/fase-1-entrega-0`, desde `origin/main`. Un PR con tres commits, uno por tarea. No depende de nada.

### Task 0.1: El mensaje automático deja de bloquear la aprobación (A2)

**Por qué:** el reconocimiento busca «Te dejé N comentarios» y desde el commit `4ac2945` (9-11) `es.json` dice «Le dejé». En español el mensaje cuenta como comentario abierto: bloquea «Aprobar» y ofrece «Cambiar» y «Borrar». La prueba que debía avisarlo ya existe y es la que hace fallar `verify:review-items` en `main` (su último caso arma el mensaje con el texto real de `es.json` y `pt.json`). Arreglar A2 la hace pasar.

**Files:**
- Modify: `src/domain/reviewComments.ts:125-131` (`BARE_REQUEST` y su comentario)
- Test: `scripts/verify-review-items.mts:234-247`

**Interfaces:** sin cambios. `isBareRequest(comment: Pick<ReviewComment, "ref" | "text">): boolean` sigue igual; la arreglan las dos formas del regex.

- [ ] **Step 1: Comprobar que la prueba falla hoy por este motivo**

Run: `npm run verify:review-items`
Expected: FAIL en «el mensaje que la revisión escribe sola al pedir cambios…», con `actual: [ 1, 2, 3, 6 ]` y `expected: [ 1, 6 ]`. Los casos anteriores dicen `ok`.

- [ ] **Step 2: Agregar a esa prueba los mensajes ya publicados** (son de regresión: fallan hoy solo porque el caso de arriba falla antes)

En el mismo `test(...)`, después del `assert.deepEqual(openComments(all…))`:

```ts
// Published before 9 November, when the Spanish still said «Te dejé»: they stay in the reviews already open.
for (const n of [1, 3]) assert.equal(isBareRequest(row(9, `@alice Pido cambios: Te dejé ${n} ${n === 1 ? "comentario" : "comentarios"} en el borrador.`)), true, `«Te dejé ${n}»`);
// Without the name of the author (the reviewer was the author's coordinator, or the name was not known).
assert.equal(isBareRequest(row(10, `${es["rv.changesAsked"]} ${es["rv.changesAutoOne"]!.replace("{n}", "1")}`)), true, "sin la mención también");
```

- [ ] **Step 3: Aceptar «Te dejé» y «Le dejé» en `BARE_REQUEST`**

En `src/domain/reviewComments.ts`, la parte española del mensaje pasa de `Te dejé` a `(?:Te|Le) dejé`. El comentario de encima dice por qué existen las dos («Te dejé» quedó en los comentarios publicados antes del 9-11). Nada más cambia: la regla se comprueba al leer, así que los mensajes ya publicados también dejan de bloquear.

- [ ] **Step 4: Correr las pruebas**

Run: `npm run verify:review-items; npm run verify:review-changes; npx tsc --noEmit -p .`
Expected: `verify-review-items: N checks passed.` sin ningún fallo, `verify:review-changes` pasa, `tsc` sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/domain/reviewComments.ts scripts/verify-review-items.mts
git commit -m "Review: the automatic «changes asked» message holds nothing again in Spanish" -m "Since 9 November es.json says «Le dejé N comentarios», but the message was still recognised by «Te dejé», so in Spanish it counted as an open comment: it blocked approval and offered Change and Delete. Both forms are accepted, since «Te dejé» stays in the comments already published. verify:review-items, which was failing on main for this reason, passes again." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.2: Cada caja de comentario conserva lo escrito (A1)

**Por qué:** la revisión admite una sola caja abierta (`commenting`, `src/components/PortionReviewView.tsx:158`). Al tocar «Comentar» en otro versículo, la primera caja se desmonta y su texto se pierde. El texto vive dentro de `Composer` (línea 71), así que la pantalla no sabe que existe: tampoco puede avisar si la persona aprueba, pide cambios o sale con un comentario sin enviar.

**Files:**
- Modify: `src/components/PortionReviewView.tsx` (`Composer` en 71-106; estado `commenting` en 158; `comment()` en 443-453; las dos cajas en 888-894 y 981-987; el pie en 1160-1212)
- Modify: `src/i18n/locales/es.json`, `pt.json`

**Interfaces:**
- El estado `commenting: string` pasa a `boxes: ReadonlyMap<string, string>`: la clave de cada caja abierta y su texto. Las claves llevan prefijo para que no choquen: `v:${item.key}` para un versículo o fila (línea 888), `p:${ref}` para una pieza de artículo o introducción (línea 981).
- `Composer` gana dos props opcionales, `text?: string` y `onText?: (text: string) => void`. Con ellas el texto lo guarda la pantalla; sin ellas, como hoy (la caja de cambiar un comentario, línea 597, y la caja general, 1139, no cambian). Sigue vaciándose solo cuando `run` devuelve `true`.
- `comment(ref: string, text: string, askChanges = false, box?: string): Promise<boolean>`: al enviarse bien quita del mapa solo la caja `box`. Las cajas de 889 y 982 pasan su clave. Las demás llamadas (las de `askNow` y `askFinishNow` en 678 y 686, el botón «Falta traducir» de 821 y la caja general de 1139) no pasan ninguna y no cierran ninguna caja.
- Claves nuevas: `rv.unsentOne` «Tiene un comentario sin enviar en {ref}.» / «Você tem um comentário não enviado em {ref}.»; `rv.unsentMany` «Tiene {n} comentarios sin enviar.» / «Você tem {n} comentários não enviados.»; `rv.unsentKeep` «Seguir escribiendo» / «Continuar escrevendo»; `rv.unsentDrop` «Seguir sin enviarlos» / «Seguir sem enviá-los».

- [ ] **Step 1: Las cajas en un mapa**

«Comentar» agrega la clave con texto vacío; la caja se muestra si `boxes.has(key)` y recibe `text={boxes.get(key)}` y `onText`. Cada caja recibe `cancel={{ label: t("rv.cancelEdit"), run: () => closeBox(key) }}` («Cancelar», la misma clave que al cambiar un comentario). Cerrarla a propósito sí borra su texto: es lo que la persona pidió.

- [ ] **Step 2: Avisar antes de dejar un comentario sin enviar**

Antes de «Aprobar» / «Para mí está bien», «Pedir cambios» y «Volver» (el `onBack` de `ToolHeader` y el `fa.back` del pie), si alguna caja tiene texto, un `ConfirmDialog` (el de la línea 1218 es el modelo) con `rv.unsentOne` (nombra el versículo, `item.ref`) o `rv.unsentMany`. «Seguir escribiendo» cierra el aviso y pone el foco en la primera caja con texto; «Seguir sin enviarlos» hace lo que se pidió. Sin cajas con texto, nada cambia.

- [ ] **Step 3: Tipos y textos**

Run: `npx tsc --noEmit -p .; npm run verify:config; npm run translations:review`
Expected: sin errores; las claves nuevas sin marcas.

- [ ] **Step 4: Comprobar en el navegador (no hay pruebas automáticas de pantalla)**

Con el mock y una revisión en pares del TPL abierta por quien revisa (Bea), a 375 px y con el teclado simulado (375×420):
1. «Comentar» en 1:2, escribir «uno»; «Comentar» en 1:3, escribir «dos». Expected: las dos cajas siguen abiertas con su texto.
2. Enviar la de 1:3. Expected: el comentario aparece en 1:3, su caja se cierra y la de 1:2 sigue con «uno».
3. Con «uno» aún en 1:2, tocar «Pedir cambios». Expected: el aviso «Tiene un comentario sin enviar en 1:2»; «Seguir escribiendo» deja el foco en esa caja con «uno».
4. «Cancelar» en 1:2. Expected: la caja se cierra y vuelve el enlace «Comentar»; «Volver» ya no avisa.
5. Con el mock detenido un momento (sin red), enviar una caja con texto teniendo otra abierta. Expected: el error se anuncia, la caja enviada conserva su texto y la otra también.
6. Los pasos 1 a 3 en portugués.

- [ ] **Step 5: Commit**

```bash
git add src/components/PortionReviewView.tsx src/i18n/locales/es.json src/i18n/locales/pt.json
git commit -m "Review: a comment being written stays when another box is opened" -m "Only one comment box could be open, so opening a second one unmounted the first with its text. Each box now stays open with its words until it is sent or cancelled, while the screen is open, and approving, asking for changes or leaving with words unsent asks first. Surviving a reload is out of scope." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.3: La letra de la fase crece con el tamaño elegido (A3)

**Por qué:** un texto solo crece si tiene su regla `html[data-text] … { font-size: calc(Xrem * var(--ts)); }` en `src/styles/components.css` (`src/textSize.ts` pone `data-text` y `--ts` en `<html>`: 1, 1,15 o 1,3). Los textos de la Fase 1 no la tienen, y `verify:text-size`, que debía avisarlo, se cae antes de revisar nada: lee línea por línea y la regla de `components.css:11761-11762` está partida en dos.

**Files:**
- Modify: `scripts/verify-text-size.mts`
- Modify: `src/styles/components.css` (reglas nuevas al final, en un bloque con su comentario)

**Interfaces:**
- En `scripts/verify-text-size.mts`: `function textRules(css: string): { selector: string; body: string }[]`, que devuelve cada regla cuyo selector (todo lo que va antes de `{`, aunque ocupe varias líneas) empieza por `html[data-text]`, sin comentarios. Las dos aserciones de la prueba existente usan `selector` y `body` en vez de la línea. `textRules` vive en el mismo script, debajo de la prueba que la usa.

- [ ] **Step 1: Prueba de que una regla partida se lee entera**

Un `test("una regla partida en varias líneas se lee hasta su llave", …)` que pasa a `textRules` un CSS de ejemplo con `html[data-text] .a,\nhtml[data-text] .b { font-size: calc(1rem * var(--ts)); }` y un comentario `/* html[data-text] .c */` entre medio, y comprueba que sale una sola regla, que su `selector` incluye `.a` y `.b`, que su `body` tiene el `calc`, y que `.c` no aparece.

- [ ] **Step 2: Ver que falla**

Run: `npm run verify:text-size`
Expected: FAIL (`textRules` no existe).

- [ ] **Step 3: Escribir `textRules` y usarla en la prueba existente**

Con `css.replace(/\/\*[\s\S]*?\*\//g, "")` y un regex global sobre `selector { body }`. La comprobación del `calc` se hace sobre `body`; la de «falta la regla de…», sobre `selector`.

- [ ] **Step 4: Ver qué dice ahora**

Run: `npm run verify:text-size`
Expected: PASS con la lista de hoy. Si alguna regla real escrita de otra forma no pasa, el mensaje la nombra: se reescribe en la forma `calc(Xrem * var(--ts))`, sin cambiar su tamaño.

- [ ] **Step 5: Agregar a la lista los textos de la Fase 1 que se leen o se escriben**

Como mínimo: `.scripture-editor__help-md` (notas en Estudio, «Recursos», editor de ayudas y revisión), `.mde-box` (la caja del editor de ayudas), `.rv-item__text` (lo que se revisa en pares), `.rv-help` (las ayudas en la revisión), `.ab-text` y `.ab-peek` (párrafos de Palabras y Academia). Más los que encuentre el Step 7. Run: `npm run verify:text-size`. Expected: FAIL nombrando cada una.

- [ ] **Step 6: Escribir las reglas**

Cada regla copia el tamaño en `rem` de la regla base que escala (por ejemplo `.rv-item__text` 1,0625rem, `.rv-item__text--none` 0,9375rem, `.mde-box` 1rem, `.ab-text, .ab-peek` 1rem y 0,9375rem para `.ab-peek.scripture-editor__help-md`). Para `.scripture-editor__help-md`:

```css
html[data-text] :where(.scripture-editor__help-md) { font-size: calc(0.8125rem * var(--ts)); }
```

`:where()` deja la regla con la especificidad de `html[data-text]` (0,1,1): vence a la base `.scripture-editor__help-md` (0,1,0) y pierde ante las reglas de contenedor que ya la hacen heredar (`.rv-help …`, `.ab-text …`, `.ns-body …`, `.af--round .af-intro …`, líneas 8200, 8401, 8419, 9629, 9827, 10023). Así, dentro de Afinación, Armonización y las hojas sigue tomando el tamaño de su contenedor, que ya crece, y no crece dos veces. Como todas las reglas usan `rem`, ningún tamaño se multiplica por `--ts` más de una vez.

Run: `npm run verify:text-size`
Expected: PASS.

- [ ] **Step 7: Medir en el navegador las cinco pantallas**

Con el mock, a 375 px, en Estudio, el borrador del TPL (versículo abierto y «Recursos»), el borrador de Notas, Preguntas y Palabras, la revisión en pares (TPL y Preguntas) y la lectura grupal: pegar `tsize()` y llamarlo. Expected: solo quedan etiquetas cortas (botones, encabezados de la herramienta, contadores). Cada texto que se lee o se escribe y aparece en la lista recibe su regla y entra en la lista de la prueba (volver al Step 5). Después, en portugués y con la letra «más grande», `audit()` en cada una de esas pantallas: `sideways` es `false` y los pies fijos no tapan la caja.

- [ ] **Step 8: Comprobar que nada creció dos veces ni se salió**

Con la letra «más grande» (Ajustes), a 1280 px y a 375 px: una nota abierta en Afinación, un punto de Armonización, `NoteSheet` y `ProposalSheet`. Expected: el texto de la nota tiene el mismo tamaño que el texto que la rodea (`getComputedStyle(...).fontSize` de la nota y de su contenedor), los paneles laterales caben sin barra horizontal (`audit().sideways === false`) y nada se corta. Una captura de la revisión en pares con letra normal y otra con «más grande», que se le muestran a Abel en la conversación (no van al repositorio).

- [ ] **Step 9: Pruebas y commit**

Run: `npm run verify:text-size; npx tsc --noEmit -p .`
Expected: PASS y sin errores.

```bash
git add scripts/verify-text-size.mts src/styles/components.css
git commit -m "Text size: the texts of the Translation phase follow the reader's choice" -m "The notes (HelpMarkdownView), the helps editor box and the text under review had no html[data-text] rule, so «larger» left them at 13-17px. verify:text-size, which should have said so, stopped at a rule split over two lines and only knew a fixed list without any Phase 1 text. It now reads each rule up to its brace, and the list includes them. The notes' rule uses :where() so the containers that make them inherit (tuning, harmonization, sheets) still win and nothing grows twice." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Cerrar la entrega 0

- [ ] Correr las pruebas de «Global Constraints». Expected: todas pasan, también `verify:review-items` y `verify:text-size`, que hoy fallan.
- [ ] Revisión con un subagente Sonnet nuevo que recibe el diseño (A1–A3), esta entrega y el diff, y dice qué está mal o falta. Se corrige y otro subagente nuevo revisa lo que cambió, hasta que salga limpio.
- [ ] Pedirle a Abel el OK para subir la rama y abrir el PR. Publicar Taller solo si lo pide, con `npm run deploy -- --publish` tras fusionar.

Cada entrega siguiente se cierra igual: sus pruebas y las de «Global Constraints», la medida `audit()` de cada pantalla que tocó (a 375 px, en español y en portugués), la revisión con peces dorados, y el OK de Abel para el PR. Cada una empieza en una rama nueva desde `origin/main` actualizado, cuando la anterior ya está fusionada.

---

## Entrega 1 — De un paso al siguiente (B1, B2, B3)

Rama `claude/fase-1-entrega-1`. Depende de la decisión 2 (tomada: un toque en la misma pantalla). Tres tareas, un PR.

**Una decisión de este plan:** «Entregar al grupo» (B3) no copia la lógica de entregar en la pantalla de revisión. Esa lógica (`close()`, `src/components/MyTasksView.tsx:729`) hace mucho más que cerrar: guarda el borrador en el del grupo, marca la fase, avisa del libro siguiente, anota lo hecho en el aparato. Copiarla dejaría dos caminos que se separan con el tiempo. La revisión pide la entrega y vuelve a «Mis tareas», que entrega en cuanto llega, sin volver a preguntar. Para la persona es un toque; para el código, un solo lugar que entrega. B2 usa el mismo aviso de vuelta.

### Task 1.1: «Mis tareas» pone primero lo que volvió a mí (B1)

**Files:**
- Modify: `src/domain/myTasksBoard.ts` (orden de grupos en 417-430; `nextCard` en 509)
- Modify: `src/components/MyTasksBoard.tsx:66-71` (abrir «Libres» cuando el botón lleno está allí)
- Test: `scripts/verify-my-tasks-board.mts`

**Interfaces:**
- Consumes: `changesPending`, `takenBackByAuthor` (`src/domain/stepClaim.ts:487-500`), `correctionsFirst` (`myTasksBoard.ts:232`).
- Produces:
  - `export function backToMe(card: BoardCard, login: string): boolean` — la tarjeta es mía y: su acción es `deliver`; o un paso tiene `changesPending` y no es `takenBackByAuthor` (me pidieron cambios); o su acción es `approveStep` y soy la autora (falta mi acuerdo); o tiene `askedBack` o `redoOf`. Son las mismas condiciones con que `TaskCard.tsx:153-170` escribe «Te pidieron cambios», «Falta entregar» y «Falta tu acuerdo».
  - `export function returnedFirst(cards: BoardCard[], login: string): BoardCard[]` — las de `backToMe` primero, sin cambiar el orden dentro de cada parte.
  - `export function pairsBeforeGroups(cards: BoardCard[]): BoardCard[]` — las tarjetas cuyo `action.step?.closing` no es `"consensus"` primero, sin cambiar el orden dentro de cada parte.

- [ ] **Step 1: Ampliar las piezas de la prueba**

En `scripts/verify-my-tasks-board.mts`, el `plan` (línea 20) gana una tarea `par` con dos pasos: `borrador` (`claimMode` del autor) y `pares` (`closing: "approval"`, `claimMode: "exclusive"`, `includeAuthorInApproval: true`), y una tarea `grupo` con un paso `lectura` (`closing: "consensus"`, `claimMode: "pool"`, `minAgree: 2`). `issue()` (línea 60) acepta `progress.returned?: Record<string, string>` y lo escribe como `returnedBy` del paso en el marcador. Son nombres de la prueba, no de `src/`.

- [ ] **Step 2: Escribir las pruebas que fallan**

```ts
await test("en «En curso», lo que volvió a mí va antes que mi otro trabajo, y el botón lleno es suyo", () => {
  // carla has an article barely opened (touched last) and a passage whose review asked her for changes.
  // Expected: where(board, changes).group === "doing"; board.doing[0] is the changes card; nextCard(board) is it.
});
await test("falta entregar y falta mi acuerdo también vuelven a mí", () => {
  // One card with every step done (action deliver), one with the reviewer's approval and not the author's.
  // Expected: both before an ordinary «continue» card touched later; backToMe true for both, false for the other.
});
await test("lo que la autora retomó por su cuenta no cuenta como pedido de cambios", () => {
  // returnedBy === the author: backToMe false (unless it is also deliver/approve).
});
await test("en «Puedes sumarte», la revisión en pares va antes que la lectura grupal", () => {
  // A pool «lectura» step of 1:1–4 and an exclusive «pares» step of 1:5–8: reviews[0] is the pair review,
  // although the reading's passage comes first in the book.
});
await test("si lo siguiente es un pasaje libre, el botón lleno está en él", () => {
  // doing holds only cards whose action is none (waiting on others), todo and reviews are empty, free has 1:9–12.
  // Expected: nextCard(board)?.group === "free".
});
```

Las aserciones se escriben con `assert.equal` / `assert.deepEqual` sobre `group`, `issue.number` y `nextCard(board)?.issue.number`, como las de la línea 280.

Run: `npm run verify:my-tasks-board`
Expected: FAIL en las cuatro primeras (la quinta puede pasar ya: es la que fija el caso de B1.4).

- [ ] **Step 3: Escribir `backToMe`, `returnedFirst` y `pairsBeforeGroups`, y usarlas al ordenar**

En el bucle de 417-430, después de `correctionsFirst`: `doing` y `todo` pasan por `returnedFirst(…, login)`; `reviews` pasa por `pairsBeforeGroups`. `nextCard` no cambia: con «En curso» ordenado, su primera tarjeta con acción ya es la que volvió.

- [ ] **Step 4: Ver que pasan**

Run: `npm run verify:my-tasks-board; npm run verify:review-changes; npm run verify:step-claim`
Expected: PASS.

- [ ] **Step 5: Abrir «Libres» cuando el botón lleno está allí**

En `MyTasksBoard.tsx`, además del estado inicial, un efecto: cuando `nextCard(board)?.group === "free"` y `free` no está en `open`, se agrega. No cierra nada que la persona abrió ni vuelve a abrir lo que cerró a mano en esta visita (se recuerda en un `useRef` si ya se abrió solo una vez).

- [ ] **Step 6: Comprobar en el navegador**

Con el mock, Ana con: un artículo de Palabras abierto y sin terminar, un pasaje del TPL al que Bea le pidió cambios, y un pasaje libre. Expected a 375 px: la tarjeta de cambios es la primera de «En curso» y lleva el único botón lleno; tras corregir y entregar a revisión, sin nada propio con acción, «Libres para tu equipo» aparece abierto con el botón lleno en su primer pasaje. `audit("mis tareas")`: un botón lleno.

- [ ] **Step 7: Reproducir la tarjeta de Preguntas en «Para empezar» sin nada que hacer**

En el mock, abrir una tarea de Preguntas **solo desde su tarjeta**, escribir, «Terminé», y que Bea la tome en revisión. Mirar la tarjeta de Ana. Si aparece en «Para empezar» sin acción, se agrega aquí una prueba con ese estado en `verify-my-tasks-board` y se corrige en `buildBoard` (debe ir a `waiting`). Si no aparece, se anota en el PR que fue efecto del camino de prueba y se descarta.

- [ ] **Step 8: Commit**

```bash
git add src/domain/myTasksBoard.ts src/components/MyTasksBoard.tsx scripts/verify-my-tasks-board.mts
git commit -m "My tasks: what came back to me comes first, and the filled button points at it" -m "A passage whose review asked for changes stood fourth in «En curso», and the filled button led to an article barely opened. Cards that came back to their author (changes asked, agreement or delivery missing) now come first; among what can be joined, the pair review, someone waits for it, before the group reading; and when what follows is a free passage, its group opens by itself." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.2: Volver a «Mis tareas» con un encargo (para B2 y B3)

**Files:**
- Modify: `src/domain/returnTo.ts`
- Modify: `src/components/MyTasksView.tsx:879-895` (el efecto que recibe la vuelta)
- Create: `scripts/verify-return-to.mts`; Modify: `package.json` (`"verify:return-to": "tsx scripts/verify-return-to.mts"`)

**Interfaces:**
- Produces (en `src/domain/returnTo.ts`):
  - `export type ReturnThen = "finished" | "deliver"`
  - `export function markThen(issueNumber: number, then: ReturnThen): void` — la herramienta lo llama **en el mismo momento en que se cierra** para volver a la lista, nunca antes de algo que pueda abrir otra herramienta.
  - `rememberReturnTo(issueNumber: number): void` — igual que hoy; conserva el `then` solo si es de la misma subtarea, y lo olvida si es de otra.
  - `export function takeReturnTo(): { issue: number; then?: ReturnThen } | null` — antes devolvía `number | null`; su único uso es `MyTasksView.tsx:885`. Leerlo olvida la subtarea **y** el encargo.
- El encargo vive en memoria, como la vuelta de hoy. Si la pestaña se cierra o se recarga, se pierde: la tarjeta queda con «Falta entregar» como primera de «En curso» (Tarea 1.1), así que nada queda escondido.

- [ ] **Step 1: Pruebas**

`verify-return-to.mts`, en el estilo de las demás (`test(name, fn)` y `ok  …`):
- «volver sin encargo da la subtarea y nada más»: `rememberReturnTo(12)` → `takeReturnTo()` es `{ issue: 12 }`; la segunda llamada da `null`.
- «el encargo de la herramienta llega con su subtarea»: `markThen(12, "deliver"); rememberReturnTo(12)` → `{ issue: 12, then: "deliver" }`.
- «un encargo de otra subtarea no se cuela»: `markThen(12, "finished"); rememberReturnTo(13)` → `{ issue: 13 }`.
- «un encargo se usa una sola vez»: tras leer `{ issue: 12, then: "deliver" }`, `rememberReturnTo(12); takeReturnTo()` da `{ issue: 12 }`, sin encargo.
- «un número que no es una subtarea no deja nada»: `rememberReturnTo(0)` → `null`.

Run: `npm run verify:return-to` → FAIL (`markThen` no existe).

- [ ] **Step 2: Implementar y adaptar `MyTasksView.tsx:885`** para leer `.issue`. El encargo todavía no se usa: lo usan las Tareas 1.3 y 1.4, **dentro del mismo `requestAnimationFrame`** donde hoy se lee la vuelta (así, con `StrictMode`, el primer efecto se cancela antes de leer y solo el segundo lo usa). En el navegador, el panel tiene que estar a la vista: oculto no corre cuadros y el encargo no se lee.

Run: `npm run verify:return-to; npx tsc --noEmit -p .` → PASS, sin errores.

- [ ] **Step 3: Commit** («My tasks: a tool can say what it left to do on the way back», con el porqué: B2 y B3 necesitan saber si se volvió tras terminar un borrador o para entregar.)

### Task 1.3: Al terminar un borrador, la app ofrece lo que sigue (B2)

**Files:**
- Modify: `src/domain/myTasksBoard.ts` (función nueva; exportar `startOf`, línea 435)
- Modify: `src/components/ScriptureEditorView.tsx:1872` y `src/components/HelpsEditorView.tsx:702` (`finish`)
- Modify: `src/components/MyTasksView.tsx` (efecto de vuelta y una `StageWindow`)
- Modify: `es.json`, `pt.json`
- Test: `scripts/verify-my-tasks-board.mts`

**Interfaces:**
- Consumes: `markThen` (Tarea 1.2); `goOnAfterStep(session, ctx, back)` (`src/dcs/nextStep.ts:45`); `StageWindow` (`src/components/StageWindow.tsx`, props `{ open, title, sub?, text?, steps?, go, onGo, show?, onShow? }`; cerrarla llama `onGo`).
- Produces:
  - `export function nextPassage(board: Board, finished: number): BoardCard | undefined` — de la misma tarea (`issueTaskId`) y el mismo proyecto que la subtarea `finished`, entre las tarjetas con acción `begin` o `continue` en `doing` o `todo`, y si no hay, las de `free`: la primera por orden del libro (`startOf(placeOf(issue).place)`, capítulo y versículo) que empieza después del pasaje terminado; si ninguna está después, la primera antes. Nunca la misma subtarea, nunca una tarjeta con acción `none`, nunca otra tarea.
  - `export function othersStepLeft(card: BoardCard): boolean` — la subtarea tiene algún paso sin hacer (con `isStepDone` sobre su marcador). Tras «Terminé», ese paso es de otra persona: la revisión.
- Claves nuevas: `mt.draftDoneTitle` «Su borrador quedó listo» / «Seu rascunho ficou pronto»; `mt.draftDoneText` «Ahora lo lee otra persona del equipo.» / «Agora outra pessoa da equipe vai lê-lo.»; `mt.goPassage` «{action} {place}» (para «Traducir 1:5–6»), igual en las dos lenguas.

- [ ] **Step 1: Pruebas de `nextPassage` y `othersStepLeft`**

En `verify-my-tasks-board.mts`:
- «después de 1:1–4 se ofrece mi 1:5–6, aunque haya libres»: Expected `nextPassage(board, n_1_1_4)?.issue.number === n_1_5_6`.
- «sin nada mío, se ofrece el primer pasaje libre de la misma tarea, después del mío».
- «no se ofrece otra tarea ni algo que espera a otros»: una tarjeta de Preguntas libre y una del TPL en `waiting`. Expected `undefined`.
- «si lo libre está antes en el libro, se ofrece igual»: terminé 1:9–12 y solo queda libre 1:1–4. Expected 1:1–4.
- «con el borrador hecho y la revisión por hacer, queda un paso de otra persona»: `othersStepLeft` es `true`; con todos los pasos hechos, `false`.

Run: `npm run verify:my-tasks-board` → FAIL; implementar → PASS.

- [ ] **Step 2: Los editores avisan que terminaron, solo al volver a la lista**

En los dos `finish()`, el tercer argumento de `goOnAfterStep` pasa de `onClose` a `() => { markThen(ctx.issueNumber, "finished"); onClose(); }`. Así el encargo existe solo si de verdad se vuelve a la lista; si `goOnAfterStep` abre otro paso de la misma subtarea, no queda ningún encargo.

- [ ] **Step 3: La ventana en «Mis tareas»**

En el efecto de vuelta, si `then === "finished"` (o tras entregar, Tarea 1.4): `const next = nextPassage(board, issue)`. Se abre una `StageWindow`:
- `title`: `mt.draftDoneTitle` (o `mt.deliveredTitle` tras entregar).
- `text`: `mt.draftDoneText` solo si `othersStepLeft(card)`; si no, ninguno.
- Con `next`: `go = mt.goPassage`, con `{action}` = el mismo texto del botón principal que la tarjeta `next` muestra en `TaskCard` (`TaskCard.tsx:362`) y `{place}` = `placeOf(next.issue).place`; `onGo` hace lo mismo que ese botón (`openCard(next)`). Si `next` es un pasaje libre, su botón ya dice que se toma, y tocarlo lo toma, como en la tarjeta. `show = fa.back` («Volver a mis tareas») cierra la ventana.
- Sin `next`: `go = fa.back`, sin `show`. Es lo que pide el diseño: solo «Volver a mis tareas».

- [ ] **Step 4: Tipos, textos y pruebas** 

Run: `npx tsc --noEmit -p .; npm run verify:config; npm run translations:review; npm run verify:my-tasks-board; npm run verify:decoupling`
Expected: todo pasa; `translations:review` no marca las claves nuevas.

- [ ] **Step 5: Comprobar en el navegador**

Ana con 1:1–4 y 1:5–6 del TPL: termina 1:1–4. Expected: la ventana «Su borrador quedó listo · Ahora lo lee otra persona del equipo», un botón con el texto de la tarjeta de 1:5–6 y el pasaje, que abre ese pasaje en el editor, y el enlace «Volver a mis tareas». Termina 1:5–6 sin nada más suyo y con 1:7–8 libre: el botón ofrece 1:7–8 con el texto de tomarlo y, al tocarlo, el pasaje queda de Ana. Sin nada: solo «Volver a mis tareas». Lo mismo con un borrador de Notas. Cerrar el editor con «Volver», sin terminar: no sale la ventana. A 375 px, en español y portugués.

- [ ] **Step 6: Commit** («Drafts: after «Terminé», offer the next passage», con el porqué: volvía a la lista con el siguiente pasaje plegado.)

### Task 1.4: Entregar al grupo desde la revisión (B3)

**Files:**
- Modify: `src/components/PortionReviewView.tsx` (pie, 1160-1212)
- Modify: `src/components/MyTasksView.tsx` (efecto de vuelta; `close()` en 729)
- Modify: `src/i18n/locales/es.json`, `pt.json`

**Interfaces:**
- Consumes: `allStepsDone(stepIds, marker)` (`src/domain/taskProgress.ts:292`), `markThen` (Tarea 1.2), la ventana de la Tarea 1.3.
- La condición del botón es **la misma que da la acción `deliver` a la tarjeta** (`stepAction`, `src/domain/myTasksBoard.ts:184-188`): todos los pasos de la subtarea hechos, la persona es quien la tiene asignada (`mine` en la revisión, línea 326) y no está entregada (`!handedIn`, línea 327). No sirve `deliverableFromTool`: devuelve `false` para una tarea con borrador propio, como el TPL (`stepClaim.ts:225`, fijado en `verify-step-claim.mts:216`).
- Claves nuevas: `rv.deliver` «Entregar al grupo» / «Entregar ao grupo»; `rv.deliverLine` «Su texto pasa a la lectura del equipo.» / «Seu texto passa para a leitura da equipe.»; `mt.deliveredTitle` «Su texto pasó a la lectura del equipo» / «Seu texto passou para a leitura da equipe»; `mt.alreadyDelivered` «Esta tarea ya se entregó.» / «Esta tarefa já foi entregue.».

- [ ] **Step 1: El botón en la revisión**

En el pie de `PortionReviewView`, con la condición de arriba, el botón lleno es `rv.deliver` con la línea `rv.deliverLine` encima, donde hoy queda «Volver a mis tareas» (`fa.back`), que pasa a enlace debajo. Al tocarlo: `markThen(ctx.issueNumber, "deliver")` y `onClose()`. Sin pregunta: la línea dice qué pasa, y la decisión 2 pide un toque. El botón solo lo ve la autora; quien revisa no cambia nada y conserva «Cambiar mi revisión» hasta que la autora entregue.

- [ ] **Step 2: «Mis tareas» entrega al llegar, y lo dice**

En el efecto de vuelta, si `then === "deliver"`, se busca la tarjeta de esa subtarea en el tablero ya cargado:
- Si su acción es `deliver`: `close(card.issue, card.bucket.board)` directamente, lo mismo que «Sí, entregar» (`close()` no pregunta nada; la pregunta de hoy es de `onDeliver`, línea 959). Si sale bien, se abre la ventana de la Tarea 1.3 con `title = mt.deliveredTitle` y lo que sigue. Si falla, `close()` ya muestra su error (`setError(explainError(err))`) y la tarjeta queda con «Entregar».
- Si la tarjeta ya no está o la subtarea está cerrada (la entregó otra pestaña o quien coordina): `announce(mt.alreadyDelivered)` y se muestra visible en la misma ventana, sin entregar nada.
- Si no es entregable por otro motivo: nada; la tarjeta, primera de la lista, dice lo que falta.

- [ ] **Step 3: Tipos, textos y pruebas**

Run: `npx tsc --noEmit -p .; npm run verify:config; npm run translations:review; npm run verify:my-tasks-board; npm run verify:decoupling`
Expected: todo pasa; `translations:review` no marca las claves nuevas.

- [ ] **Step 4: Comprobar en el navegador**

Ana traduce 1:1–4, Bea aprueba, Ana entra a la revisión: el botón lleno dice «Para mí está bien». Lo toca. Expected: el botón lleno pasa a «Entregar al grupo», con su línea. Lo toca: vuelve a «Mis tareas» y ve «Su texto pasó a la lectura del equipo»; la lectura grupal de ese pasaje aparece en «Puedes sumarte» de Bea. Después:
- Dos pestañas de Ana en la misma revisión: entregar en una y luego en la otra. Expected: una sola entrega; la segunda dice «Esta tarea ya se entregó».
- Con el mock detenido un momento: entregar. Expected: el error de siempre, la tarjeta con «Entregar», nada perdido.
- Con Bea en otra pestaña, «Cambiar mi revisión» sigue disponible hasta que Ana entrega.
- A 375 px, en español y portugués, `audit("revisión, entregar")`: un botón lleno.

- [ ] **Step 5: Commit** («Review: hand the text to the group from where the review ends», con el porqué: hacían falta tres toques fuera de la pantalla y un enlace pequeño; si nadie lo tocaba el grupo nunca recibía el texto. Y por qué entrega «Mis tareas»: un solo lugar entrega.)

---

## Entrega 2 — Escribir sin perderse (B4, B5, C5, C7)

Rama `claude/fase-1-entrega-2`. Depende de la decisión 4 (tomada: fuente y caja juntas). Cuatro tareas, un PR. Empieza por las dos pequeñas.

### Task 2.1: «Terminé» con borde hasta que todo tiene texto (C5)

**Files:** `src/components/ScriptureEditorView.tsx:2164-2177`; `src/components/HelpsEditorView.tsx:1262-1264`.

- [ ] **Step 1:** En el editor del texto, `variant={versesLeft(drafts).count ? "outline" : "default"}`. En el de ayudas, `variant={pending ? "outline" : "default"}` (`pending` de `helpsLeft`, línea 763). Lo que lo habilita no cambia, y tocarlo antes de tiempo sigue preguntando («Quedan 3 versículos sin traducir»). `versesLeft` ya tiene su prueba (`verify:draft-finish`).
- [ ] **Step 2:** `npx tsc --noEmit -p .`; en el navegador, un versículo escrito de cuatro: «Terminé» con borde y `audit()` sin botón lleno; los cuatro escritos: lleno. Igual en Notas. Que no haya botón lleno mientras se escribe es lo buscado: lo único que hacer es escribir, y «solo la acción de decidir va en botón lleno».
- [ ] **Step 3:** Commit («Drafts: «Terminé» is filled only when everything has text», con el porqué de Nehemías: una traductora lo tocó creyendo que guardaba.)

### Task 2.2: Preguntas muestra su versículo (C7)

**Files:** `src/components/HelpsEditorView.tsx:1126-1150` (rama `he-note`).

- [ ] **Step 1:** Para las preguntas (la rama `he-note` cuando `!isNotes`), el mismo `above: () => <NoteQuote … quote="" />` que usan las notas, con `item.chapter` y `item.verse`. Con la cita vacía `NoteQuote` muestra «el versículo entero» en la línea de la frase: para las preguntas esa línea sobra, así que `NoteQuote` gana una prop `verseOnly?: boolean` que muestra solo el `<details>` «Ver 1:1 completo».
- [ ] **Step 2:** En el navegador, una pregunta abierta: «Ver 1:1 completo» se despliega con el ULT y el UST del versículo. Una nota sigue igual que antes.
- [ ] **Step 3:** Commit («Questions: the verse a question is about is a touch away»).

### Task 2.3: Al corregir, el comentario está junto a su versículo (B5)

**Files:**
- Modify: `src/domain/commentPlace.ts` (función nueva)
- Modify: `src/components/ScriptureEditorView.tsx` (carga en 1485-1493; «Verlos» en 2381-2392; filas en 2418-2567)
- Test: `scripts/verify-review-items.mts`

**Interfaces:**
- Produces: `export function commentsOnVerses(comments: ReviewComment[], chapter: number, from: number, to: number): ReviewComment[]` — los comentarios cuyo `ref` (leído con `parseRefComment`) cae en el capítulo `chapter` entre `from` y `to`, incluidos los que nombran un rango que se cruza con él (`1:2-3` está en 1:3). Los de `ref` vacío (sobre todo el borrador) no entran.

- [ ] **Step 1: Pruebas** en `verify-review-items.mts`: «un comentario sobre 1:3 está en el versículo 3 y en la fila 2–3, y no en 1:4»; «un comentario sobre un rango aparece en cada versículo que toca»; «un comentario sin lugar no está en ningún versículo»; «un comentario de otro capítulo no entra». Run → FAIL; implementar → PASS.
- [ ] **Step 2: En el editor:**
  - `reviewComments` ya son solo los abiertos (se cargan con `openComments`, línea 1490): los resueltos no se muestran ni atraen el editor.
  - Sobre la caja del versículo abierto (la fila con `activeVerse === d.from`), `commentsOnVerses(reviewComments, chapter, d.from, d.to)` en una `<ul className="rv-comments">`, como hace el editor de ayudas (`HelpsEditorView.tsx:1130`, con su `commentRow`).
  - En la cabecera de cada fila con comentarios, una marca: el icono `MessageSquare` y el número, como `ArticleBlocks.tsx:99`.
  - Al cargar comentarios (1485-1493), en vez de `setResourceTab("revision")`, el editor abre el primer versículo con comentario (`editRow`). La pestaña «Revisión» se queda para los comentarios sin lugar.
  - «Verlos» (2381-2392) abre el primer versículo con comentario; solo si no hay ninguno con lugar, va a la pestaña como hoy.
- [ ] **Step 3: En el navegador:** Bea comenta 1:3 y pide cambios; Ana abre su borrador. Expected: abre en 1:3 con el comentario encima de la caja, 1:3 lleva la marca, «Verlos» lleva a 1:3. Con el teclado simulado (375×420) se ven el comentario, el ULT y la caja.
- [ ] **Step 4:** `npm run verify:review-items; npx tsc --noEmit -p .`; commit («Editor: a review comment sits above its verse», con el porqué: Ana llegaba a otra pestaña, debajo de todo el texto fuente.)

### Task 2.4: Pasar al versículo siguiente sin cerrar el teclado (B4)

**Files:**
- Create: `src/components/StepArrows.tsx`
- Modify: `src/components/ScriptureEditorView.tsx` (fila abierta) y `src/components/HelpsEditorView.tsx` / `src/components/ArticleBlocks.tsx` (pieza abierta)
- Modify: `src/styles/components.css`, `es.json`, `pt.json`

**Interfaces:**
- Produces: `export function StepArrows(props: { onPrev?: () => void; onNext?: () => void; prevLabel: string; nextLabel: string }): JSX.Element` — dos botones redondos de 44 px, color suave (`--accent-100` / `--accent-800`, como `.pl-pos__step`, `components.css:9542`), con `aria-label` y sin texto. Cada uno lleva `onPointerDown={(e) => e.preventDefault()}` para no quitar el foco de la caja (el patrón de `ArticleBlocks.tsx:232` usa `onMouseDown`, que no cubre el toque), y el clic abre la fila siguiente y le pone el foco en el mismo manejador, de forma síncrona, para que el teléfono acepte abrir el teclado. Sin palabras, por decisión de Abel («flechas teñidas flotando fijas, sin barra ni etiquetas»); el nombre va en `aria-label`. Sin `onPrev` o `onNext`, esa flecha no se muestra.
- Claves nuevas: `se.prevVerse` «Versículo anterior: {ref}», `se.nextVerse` «Versículo siguiente: {ref}», `he.prevHelp` «Ayuda anterior», `he.nextHelp` «Ayuda siguiente».

- [ ] **Step 1: El componente y su lugar.** En el editor del texto, `StepArrows` flota en los márgenes a la altura de la caja abierta: se monta dentro de la fila abierta para que la siga cuando el teclado mueve la pantalla. La entrega 4 usa el mismo componente con otros `onPrev` / `onNext`. `onNext` abre la fila siguiente de `drafts` con `editRow` (que ya pone el foco en su caja, así que el teclado no se cierra); `onPrev`, la anterior. En el de ayudas, `onNext` usa `pieces.after(inPieces, id, index)` y `pieces.show` (`src/components/usePieces.ts:61, 111`); para `onPrev` se agrega a `usePieces` una `before(order, id, index)`, simétrica de `after`, con su prueba en `verify:article-blocks` si su lógica sale a `helpTexts.ts`. El botón `ab-next` («siguiente ↓», `ArticleBlocks.tsx:230-238`) se quita donde haya flechas, para que no haya dos formas de lo mismo.
- [ ] **Step 2: Medir si tapan la caja.** A 375×420 con un versículo abierto y texto largo: `getBoundingClientRect` de cada flecha contra el de la caja. Si se cruzan con el área de texto, las flechas van junto a la caja, al final de la línea de «Fíjese en esto» (`Hints`, `ScriptureEditorView.tsx:2561`), como dice el diseño. Se anota en el PR cuál quedó y por qué.
- [ ] **Step 3: En el navegador:** escribir en 1:1, tocar la flecha siguiente: 1:2 queda abierto con el foco en su caja (`document.activeElement` es su `textarea`) y lo escrito en 1:1 sigue. Igual con dos notas. A 375 px: `audit()` sin controles bajo 44 px nuevos.
- [ ] **Step 4: Teléfono real (obligatorio para B4).** El panel del navegador no prueba que el teclado siga abierto. Abel abre la app de la rama en su teléfono (servidor con `npm run lan`, en la misma red) con el teclado abierto, y dice si se ven la fuente, la caja y las flechas, y si al tocar una flecha el teclado sigue abierto. Si no se puede comprobar, la entrega 2 se fusiona sin B4 y B4 espera a esa prueba.
- [ ] **Step 5:** `npx tsc --noEmit -p .; npm run verify:config; npm run verify:text-size`; commit («Editors: go to the next verse or help without closing the keyboard»).

---

## Entrega 3 — Entender cada paso (C1, C2, C3, C4, C8)

Rama `claude/fase-1-entrega-3`. No depende de otras entregas; si la 2 ya está fusionada, la guía de ayudas (3.4) señala sus flechas. Cinco tareas; si el PR crece demasiado para revisarlo de una vez, C4 (la guía) va en un PR aparte.

### Task 3.1: Estudio — seguir siempre a la vista (C1)

**Files:**
- Create: `src/domain/studyFoot.ts`; Test: `scripts/verify-study-foot.mts`; `package.json` (`"verify:study-foot": "tsx --tsconfig tsconfig.scripts.json scripts/verify-study-foot.mts"`)
- Modify: `src/components/FamiliarizeView.tsx` (pestañas 322-331; «Leído, seguir» 346; pie 369-380; notas 261-282; texto 57)
- Modify: `es.json`, `pt.json`

**Interfaces:**
- Produces:
  - `export function studyFoot(p: { parts: string[]; read: ReadonlySet<string>; open: string | null; done: boolean }): { kind: "read" | "finish" | "back"; part?: string }` — `back` si el paso ya está hecho; `finish` si todas las partes están leídas; si no, `read` con la parte que se marca al tocar (la abierta si no está leída, si no la primera sin leer).
  - `export function notesToStudy<T extends { ref: string }>(rows: T[]): T[]` — sin las filas de introducción (`ref` que termina en `:intro`, o `front:intro`), que ya se leyeron en «El libro» y «El capítulo».

- [ ] **Step 1: Pruebas** en `verify-study-foot.mts`: «con partes sin leer, el botón es leer la abierta»; «con la abierta ya leída, marca la primera sin leer»; «todo leído: terminar»; «el paso ya hecho: volver»; «las notas no repiten las introducciones». Run → FAIL; implementar → PASS.
- [ ] **Step 2: El pie.** En `.tool-foot` queda un solo botón lleno según `studyFoot`: `read` → «Leído, seguir» (`fa.readNext`, o `fa.readLast` en la última) y llama `read(part)`; `finish` → «Terminé de estudiar» (`fa.finish`) y llama `finish()`; `back` → `fa.back`. Se quita el botón de dentro de cada panel (línea 346).
- [ ] **Step 3: «Apuntes» pasa a «Más».** La pestaña `fam-tab--notes` se llama `fa.tabMore` «Más» y abre lo mismo que hoy. Las cuatro partes y «Más» caben a 375 px sin desplazarse de lado.
- [ ] **Step 4: Las notas sin códigos.** La lista usa `notesToStudy`; la cabecera de grupo (`p.fam-verse__ref`) solo se muestra cuando el versículo es un número. Ninguna nota muestra su id o su `ref` crudo.
- [ ] **Step 5: «El pasaje» abre en el pasaje de la persona.** Al abrir la parte, `.fam__body` se desplaza hasta `.fam-text__passage` (una `ref` en ese elemento y `scrollIntoView({ block: "start" })`), sin animación. El capítulo entero sigue a la vista arriba y abajo.
- [ ] **Step 6: En el navegador**, a 375 px: `audit("estudio, el pasaje")` con el botón a la vista sin desplazarse; antes, «Leído, seguir» estaba a 6.486 px. Expected: un botón lleno, el pasaje de la persona arriba. Las notas sin «1:intro · v1fp».
- [ ] **Step 7:** Commit («Study: the way on is always in view»).

### Task 3.2: Estudio ya hecho: decirlo y seguir (C2)

**Files:** `src/components/FamiliarizeView.tsx`; `es.json`, `pt.json`.

- [ ] **Step 1:** Al abrir, si todas las partes ya están leídas en el aparato (`loadFamiliarizeSeen`) o el paso ya está hecho (`done`), una `StageWindow`: `title` `fa.studiedTitle` «Ya estudió este capítulo», `go` `fa.studiedGo` «Seguir», `show` `fa.studiedAgain` «Leerlo otra vez». «Seguir» hace lo mismo que el pie con `finish` (o `back` si el paso ya estaba hecho); «Leerlo otra vez» cierra la ventana y deja la pantalla como hoy.
  - El diseño dice «Seguir al borrador». Aquí dice «Seguir» porque la pantalla de estudio no sabe qué paso viene después en cada proceso, y nombrarlo sería escribir el proceso en `src/`.
- [ ] **Step 2: En el navegador:** estudiar Ester 1 en el TPL, abrir el estudio del TPS del mismo capítulo: sale la ventana; «Seguir» lleva al borrador. Commit («Study: say it was already studied and go on»).

### Task 3.3: La ventana del paso le habla a la autora (C3)

**Files:**
- Modify: `src/components/TaskIntro.tsx` (prop nueva) y `src/components/MyTasksView.tsx` (~952, donde se arma `intro`)
- Modify: `src/components/PortionReviewView.tsx` (el propósito como primer paso de la guía, `useGuidePurpose`)
- Modify: `src/domain/stepClaim.ts` (función nueva); `es.json`, `pt.json`
- Test: `scripts/verify-review-changes.mts`

**Interfaces:**
- Produces: `export function readersOfMyDraft(progress: TaskProgressMarker, step: TaskStep, author: string): string[]` — quienes ya aprobaron ese paso, sin la autora, en el orden en que aprobaron.
- `TaskIntro` gana `forAuthor?: { readers: string[] }`. Con ella, en lugar del propósito del paquete muestra `intro.authorReadOne` «{who} ya leyó su borrador. Léalo y diga si está de acuerdo.» / «{who} já leu seu rascunho. Leia-o e diga se está de acordo.», o con más de un lector `intro.authorReadMany` «{who} ya leyeron su borrador…» / «{who} já leram seu rascunho…»; sin lectores todavía, `intro.authorWaiting` «Otra persona del equipo está leyendo su borrador. Aquí verá lo que diga.». `{who}` son los nombres como los muestran las tarjetas, unidos con `Intl.ListFormat(idioma, { type: "conjunction" })` («Bea y Carla», «Bea e Carla»).
- Se considera autora a quien tiene asignada la subtarea (`assigneeOf(card)`; en la revisión, `isAuthor`, `PortionReviewView.tsx:318`) cuando el paso es de cierre `approval`.

- [ ] **Step 1: Prueba** en `verify-review-changes.mts`: «quien tradujo ve quién ya leyó su borrador, sin contarse a sí misma» (aprueba Elisha y después el autor: `["Elisha"]`; sin aprobaciones: `[]`). Run → FAIL; implementar → PASS.
- [ ] **Step 2:** `MyTasksView` pasa `forAuthor` a `TaskIntro` cuando la persona es la autora y el paso tiene `closing: "approval"`. En la revisión, el propósito que `useGuidePurpose` pone como primer paso de la guía usa la misma frase para la autora. El propósito del paquete no cambia.
- [ ] **Step 3: En el navegador:** Ana abre por primera vez la revisión de su 1:1–4 tras la aprobación de Bea: la ventana dice «bea ya leyó su borrador…». Bea sigue viendo el propósito de siempre. Commit («Review: the step window speaks to the author about her own draft»).

### Task 3.4: Guías que señalan y esperan (C4)

**Files:**
- Modify: `src/components/screenGuides.tsx` (tres guías nuevas)
- Modify: `src/components/FamiliarizeView.tsx`, `src/components/HelpsEditorView.tsx`, `src/components/GroupReadingView.tsx` (montar `GuideScreen`, poner `data-guide`)
- Modify: `es.json`, `pt.json`

**Interfaces:**
- Consumes: `GuideScreen({ steps, ready, watch })`, `guideDid(event)`, `GuideStep` (`src/domain/guide.ts`), con el patrón de `ReviewGuide` (`screenGuides.tsx`) montado como en `PortionReviewView.tsx:1008`.
- Produces: `StudyGuide`, `HelpsGuide`, `ReadingGuide`, cada una con sus `seenKey` propias y pocos pasos:
  - Estudio: mirar el texto (`fam-body`); tocar «Leído, seguir» (`study-next`, `kind: "tap"`, espera a que se marque una parte); al final, «Terminé de estudiar» (`study-next` otra vez).
  - Ayudas: mirar la frase fuente (`he-source`); escribir en la caja (`he-box`, `kind: "do"`, `done` cuando tiene texto); pasar a la siguiente (las flechas de la entrega 2 si ya están, si no `ab-next`); «Terminé» (`he-finish`).
  - Lectura grupal: el primer versículo; «De acuerdo», «Corregir» y «Tengo una duda» (`gr-agree`, `gr-fix`, `gr-doubt`), cada uno señalado con un paso `look` que solo explica: la guía no pide tocar «De acuerdo», para no dar un acuerdo sobre un texto que la persona todavía no leyó. Esta guía se rehará en la entrega 6.
- [ ] **Step 1:** Los textos de cada paso en `guide.*` de `es.json` / `pt.json`, de «usted», cortos, diciendo qué tocar y para qué.
- [ ] **Step 2:** `npm run verify:guide; npx tsc --noEmit -p .`; en el navegador, «Empezar con la guía» en cada una de las tres pantallas: cada paso señala un control visible, espera el toque y sigue. «Empezar sin guía» no la muestra.
- [ ] **Step 3:** Commit («Guides: Study, the helps editor and the group reading point where to touch»).

### Task 3.5: Un mismo trato y palabras honestas (C8)

**Files:**
- Modify: `es.json`, `pt.json` (claves de `fa.*`, `sn.*`, `he.*`, `ab.*`, `gr.*`, `se.*`, `rv.*`, `hs.*` que tratan de «tú»)
- Modify: `src/components/HelpsEditorView.tsx` (pie 1236-1246; aviso `se.savedIn` en 622; `he.oneResource` en 1049)
- Test: `scripts/verify-formal-address.mts`

**Interfaces:**
- Consumes: `informalWords(text, "usted")` (`src/domain/formalAddress.ts`), que ya reconoce «tú» y propone la forma de «usted».

- [ ] **Step 1: Prueba que falla:** en `verify-formal-address.mts`, «la interfaz de la Fase 1 trata de usted»: lee `es.json` y, para cada clave con prefijo `fa.`, `sn.`, `he.`, `ab.`, `gr.`, `se.`, `rv.`, `hs.` o `intro.`, comprueba que `informalWords(valor, "usted")` está vacío; el mensaje nombra la clave y la palabra. Run → FAIL con la lista (unas 30 claves seguras, más las de `se.` y `rv.` sin revisar).
- [ ] **Step 2:** Reescribir cada clave de «usted» en `es.json`; en `pt.json`, el trato equivalente (`você` / tercera persona) que ya usa el resto de la interfaz portuguesa. `npm run translations:review` para ver el portugués. Run → PASS. Si una frase que no es de la Fase 1 aparece (por ejemplo, de la administración), se anota y se deja fuera del prefijo, no se cambia sin razón.
- [ ] **Step 3: Palabras honestas.**
  - El pie del editor de ayudas no muestra `he.footSaved` («Todo guardado») mientras hay un `error`.
  - El aviso `se.savedIn` deja de mostrar `owner/repo @ rama`: dice solo que se guardó. `npm run verify:ui-copy` debe seguir pasando.
  - Se quita «Lo demás del archivo no cambia» de `he.oneResource`: queda «Aquí están solo las ayudas de su pasaje.».
  - El error que el recorrido vio con nombres de ramas junto a «Todo guardado» se reproduce en el mock (guardar Notas con la rama del borrador borrada) y se lleva a `explainError` (`src/dcs/userError.ts`) con un caso nuevo en `verify:user-error`: dice qué hacer, sin nombres de ramas.
- [ ] **Step 4:** `npm run verify:formal-address; npm run verify:config; npm run verify:ui-copy; npm run verify:user-error`; en el navegador, Estudio y el editor de Notas en español y portugués. Commit («Copy: the Translation phase speaks as «usted», and says nothing it cannot keep»).

### Cerrar la entrega 3: el recorrido completo

- [ ] Con todo lo fusionado hasta aquí (entregas 0 a 3), a 375 px, en español y después en portugués: Ana abre «Mis tareas» y llega hasta la lectura grupal de su pasaje (Estudio, borrador, revisión de Bea con un pedido de cambios, corrección, acuerdo, entrega) tocando en cada pantalla solo el botón lleno o la única acción evidente. Cada pantalla donde eso no se cumpla se anota con su `audit()` y se corrige o se le explica a Abel por qué no. Es el criterio de la sección 8 del diseño.

---

## Entrega 4 — Las ayudas, de una en una (C6)

Rama `claude/fase-1-entrega-4`, después de la entrega 2 (usa sus flechas para pasar de una ayuda a otra). Un PR. Es el cambio de pantalla más grande de las entregas 0 a 4.

**Files:**
- Modify: `src/domain/helpTexts.ts` (funciones nuevas); Test: `scripts/verify-article-blocks.mts`
- Create: `src/components/HelpListSheet.tsx`
- Modify: `src/components/HelpsEditorView.tsx` (lista de 1075-1165; contador ~1022)
- Modify: `src/styles/components.css`, `es.json`, `pt.json`

**Interfaces:**
- Produces:
  - `export type HelpEntry = { id: string; kind: "intro" | "help"; ref: string; label: string }` — una entrada por nota o pregunta, y una por cada introducción (libro, capítulo).
  - `export function helpEntries(items: HelpsDraftItem[]): HelpEntry[]` — en el orden en que hoy se muestran.
  - `export function entryPosition(entries: HelpEntry[], id: string): { index: number; total: number }` — `index` desde 1.
  - `HelpListSheet({ entries, current, onPick, onClose })`: una hoja (`Dialog` con `fix-sheet`, como `NoteSheet.tsx`) con todas las entradas, la actual marcada, y las que faltan por traducir señaladas. Tocar una llama `onPick(id)`.
- Claves nuevas: `he.positionNote` «{ref} · nota {n} de {total}», `he.positionQuestion` «{ref} · pregunta {n} de {total}», `he.positionIntro` «{name} · {n} de {total}», `he.listTitle` «Todas las ayudas de su pasaje».

### Task 4.1: Las entradas y su posición

- [ ] **Step 1: Pruebas** en `verify-article-blocks.mts`: «cada nota es una entrada y cada introducción otra»; «la posición cuenta desde 1 y sobre todas las entradas»; «un id que no está da la primera». Run → FAIL; implementar en `helpTexts.ts` → PASS.
- [ ] **Step 2:** Commit.

### Task 4.2: Una ayuda a la vista

- [ ] **Step 1:** En Notas y Preguntas (no en Palabras ni Academia, que conservan el artículo a la vista porque leerlo seguido sirve para traducir), la lista muestra solo la entrada que tiene la pieza abierta (`pieces.active`), con su `NoteQuote` y sus comentarios. Encima, la línea de posición (`entryPosition`) como un botón discreto que abre `HelpListSheet`; elegir una entrada abre su primera pieza sin traducir (o la primera). Los párrafos de una introducción se recorren con las mismas flechas.
- [ ] **Step 2:** Las flechas de la entrega 2 pasan de la última pieza de una entrada a la primera de la siguiente, y al revés.
- [ ] **Step 3: En el navegador**, Ester 1 en Notas a 375 px: `audit("notas")`. Expected: como mucho 12 controles, un botón lleno, dos pantallas de alto (antes 75 controles y 8,69 pantallas). La hoja lista las 27 notas y las introducciones; tocar una lleva a ella. Lo escrito en una nota sigue al volver a ella. Palabras y Academia se ven como antes.
- [ ] **Step 4:** `npx tsc --noEmit -p .; npm run verify:article-blocks; npm run verify:text-size`; commit («Helps editor: one help at a time, the others a touch away»).

---

## Entregas 5 y 6 — La revisión como conversación (D1, D2)

Dependen de la decisión 1 (tomada: la misma regla de cierre, dicha como conversación). **Antes de construir cada una va un diseño corto propio**, en `docs/superpowers/specs/`, aprobado por Abel, porque pueden cambiar cómo se guardan los datos:

- **Entrega 5, revisión en pares (D1):** cómo se guarda una propuesta de palabras («Proponer otras palabras» → «Usar estas palabras», que solo aplica la autora en su borrador) y contra qué versión se compara «lo que cambió desde la última lectura». Sobre el trabajo de A1 (cajas abiertas) y B3 (entregar en la misma pantalla).
- **Entrega 6, lectura grupal (D2):** las caras de quienes están de acuerdo en vez de «0 de 2», los versículos con duda marcados y a un toque desde arriba, y «Estoy de acuerdo con este pasaje» al final. La regla `partial` de `waitBlocks` (`src/domain/waits.ts:190`) ya hace que la lectura espere sola al primer pasaje: no se construye.

Cada diseño corto lleva su propio plan, como este. Comprobación pendiente para la 6: el cierre completo de una lectura grupal con sus 72 h, en el mock con `?mockHoursAhead` (memoria `test-open-window-on-the-mock`), y la revisión en pares de Palabras y Academia, que el recorrido no vio.

## Entrega 7 — Avisos de Taller mientras se escribe (E1)

Después de las entregas 2 y 4, porque va junto a la línea de «Fíjese en esto» y a la ayuda abierta de una en una. En líneas generales:

- Los dos editores muestran lo que Taller encuentra con `HelpChecksHint`, como Afinación y Armonización: `verseChecks` en el editor del texto, y `mechanicalChecks` y `ruleChecks` en el de ayudas.
- En letra pequeña junto a «Fíjese en esto», sin competir con la caja; con su regla de tamaño de letra.
- «Arreglar» solo cuando el arreglo es seguro (lo dice cada comprobación).
- Prueba: que cada comprobación aparezca en la fila que corresponde (lógica pura, en las pruebas de `verify:help-checks`), y en el navegador, un versículo con doble espacio y una nota con «tú».

El plan detallado se escribe al terminar la entrega 4, con el código como haya quedado.

## Entrega 8 — Las ayudas se guardan solas, en el borrador propio (decisión 3)

Al final, después de la 4. En líneas generales:

- `HelpsEditorView` guarda solo, como el editor del texto, **solo cuando escribe en el borrador propio de la persona**. Cuando `onTeamDraft` es verdadero (líneas 308 y 546, `saveTeamHelpsRows`) sigue pidiendo «Guardar», porque ahí escribir es cambiar el texto de todos.
- La lógica de guardar se arregló el 23-11 (PR #48, commits `13f1d44` y `943aa8f`) tras un fallo en producción: el borrador guardado se leía una sola vez al abrir y la primera tecla escribía sobre lo que guardaba el aparato; y «Rehacer mi borrador» dejaba una rama rota. Antes de tocar nada, pruebas que reproduzcan esos dos casos con el guardado solo activado (en `verify:draft-cache` y en las del arranque con el Door43 falso), y que pasen antes y después.
- Se prueba contra el mock sembrado con un libro, no en modo de prueba (memoria `trial-mode-proves-no-writes`): escribir, esperar, recargar, y ver lo escrito en el mock.
- El plan detallado se escribe cuando la 4 esté fusionada, leyendo el PR #48 entero.

---
