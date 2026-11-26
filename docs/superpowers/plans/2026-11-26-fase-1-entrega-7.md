# Fase 1, entrega 7 — Taller avisa mientras se escribe (E1): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** los dos editores (el del texto y el de ayudas) muestran, en una sola línea discreta bajo la caja del versículo o de la pieza abierta, lo que Taller encuentra. La línea se actualiza tras una pausa y su «Arreglar» corrige de una vez lo que es seguro, incluido el «tú» → «usted».

**Architecture:** no hay datos nuevos. En el dominio (`helpChecks.ts`) se agregan:

- el «tú» como comprobación más;
- el espacio doble en un versículo, con una opción;
- el texto que va antes de una pieza, para las reglas con `until`;
- una función `checksOf` que reúne todo.

`HelpChecksHint` se extiende con tres propiedades opcionales (`address`, `quiet`, `settle`). Sin ellas se ve y se comporta como hoy. Los dos editores lo usan para el versículo o la pieza abierta. En el editor de ayudas reemplaza a `FormalAddressHint`.

**Tech Stack:** React 18 + Vite + TypeScript. Pruebas en `scripts/verify-*.mts` con `tsx` y `node:assert/strict`. El mock de Door43 (`scripts/mock-door43/server.mjs`) y el panel del navegador con `preview_start`.

**Spec:** [`docs/superpowers/specs/2026-11-26-fase-1-entrega-7-design.md`](../specs/2026-11-26-fase-1-entrega-7-design.md). Abajo se citan sus números de sección (3.1, 3.4, 4…). Es parte del plan de la fase, [`2026-11-24-fase-1-traduccion.md`](2026-11-24-fase-1-traduccion.md), «Entrega 7».

## Global Constraints

- **Trabajo de Idiomas Puentes:** Claude escribe, prueba y revisa con subagentes. Nunca Cursor.
- **Textos de la interfaz:** con `useT()` y claves en `src/i18n/locales/es.json` y `pt.json`. Esos dos archivos se editan con Edit o con un guion que lea antes de escribir; nunca con `sed -i`. La app trata de «usted».
- **Ningún nombre de proceso en `src/`** (`npm run verify:decoupling`). Las reglas siguen en `processes/fcr.json`.
- **Tamaño de letra:** cada clase nueva con `font-size` lleva su regla `html[data-text] .clase { font-size: calc(Xrem * var(--ts)); }` (`npm run verify:text-size`).
- **No se toca el guardado de los editores** (PR #48). «Arreglar» escribe en el borrador por el mismo camino que una tecla (`updateVerse`, `put`, `updateItem`).
- **Afinación, Armonización, la hoja de propuestas y la revisión en pares no cambian.** Usan `HelpChecksHint` sin las propiedades nuevas y `FormalAddressHint` tal cual.
- **Botones de 44 px de alto o más.** El botón y la línea no le quitan el foco a la caja: `onMouseDown={(e) => e.preventDefault()}`, como hoy.
- **Rama:** `claude/fase-1-entrega-7` desde `origin/main`. La entrega 6 (PR #73) no toca los editores: no hace falta esperarla.
- **Commits:** en inglés, con título corto y un cuerpo que explique el porqué, y que terminen con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nada se publica sin el OK de Abel.** Todo se prueba contra el mock.
- **Pruebas que deben pasar al cerrar:**
  - `npx tsc --noEmit -p .`
  - `npm run verify:help-checks`, `verify:formal-address`, `verify:config`, `verify:decoupling`, `verify:templates` y `verify:text-size`
  - `verify:prep` ya fallaba antes: no es de esta entrega.

## Review Focus

1. **Escribir rápido, en el teléfono, en un versículo con un aviso.** La línea no cambia hasta la pausa, y «Arreglar», tocado en mitad de una palabra, arregla el texto actual sin estropear lo recién escrito. Se prueba en la Tarea 1 (`checksOf` sobre el texto actual, con `applyFixes`) y en el navegador, en la Tarea 5.
2. **Un artículo de Palabras con la negrita en los ejemplos,** escrito por piezas, cuando el encabezado «Ejemplos» todavía no está traducido. La regla de la definición no se aplica a esas piezas. Se prueba en la Tarea 1 (con `past` en inglés y en español).
3. **Un versículo de poema** (varias líneas, `VerseLines`). Las comprobaciones y los arreglos no juntan ni separan líneas. Se prueba en la Tarea 1 (un texto con `\n`) y en el navegador.
4. **Una nota con «tú» y además un espacio doble en la misma frase.** Un solo «Arreglar» deja las dos cosas bien. Se prueba en la Tarea 1.
5. **Pasar al versículo siguiente con las flechas.** La línea del versículo nuevo sale enseguida, sin mostrar por un momento la del anterior. Se prueba en la Tarea 2 (la pausa se reinicia con `key`) y en el navegador.

---

## Task 1: Lo que se busca, en el dominio

**Files:**
- Modify: `src/domain/helpChecks.ts`
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/pt.json` (clave `hc.informal`)
- Modify: `processes/fcr.json`: `until` de la regla `negrita-en-definicion` pasa a `"^## (Ejemplos|Exemplos|Examples)"`, porque la fuente de Palabras puede estar en inglés. No es una regla nueva.
- Test: `scripts/verify-help-checks.mts`

**Interfaces:**
- Produces:
  - `type HelpKind = "notas" | "palabras" | "preguntas" | "academia"`. `helpKindOf` (en `HelpChecksHint.tsx`) **no cambia**: las propuestas siguen igual.
  - `verseChecks(text: string, opts?: { doubleSpace?: boolean }): HelpCheck[]`. Con `doubleSpace`, cada coincidencia de `/(?<=[^\s«¿¡(]) {2,}(?=[^\s,.;:!?»)])/g` da `{ id: "double-space", fix: "auto", replacement: " ", message: { key: "hc.doubleSpace" } }`. La clave ya existe. Las miradas atrás y adelante dejan fuera los tramos que ya cuentan `space-open` y `space-before`, para no avisar dos veces del mismo tramo, y lo que está junto a un `\n`.
  - `ruleChecks(text, kind, rules, lang, opts?: { past?: string })`. Si `rule.until` coincide con alguna línea de `past`, la regla no se aplica a `text`.
  - `informalChecks(text: string, address: HelpsAddress | undefined): HelpCheck[]`. Una por palabra de `informalWords`: `{ id: "informal", fix: "auto", start: at, end: at + length, replacement: formal, excerpt, message: { key: "hc.informal", params: { word, formal } } }`.
  - `checksOf(text: string, kind: HelpKind | "verse", opts: { before?: string; past?: string; address?: HelpsAddress; doubleSpace?: boolean; language: string }): HelpCheck[]`. Para `"verse"`, solo `verseChecks(text, { doubleSpace })`: ni reglas ni «tú». Para las ayudas, `mechanicalChecks(text, { kind, before })`, más `ruleChecks(…, writingChecks(), language, { past })`, más `informalChecks(text, address)`. Todo ordenado por `start`. `mechanicalChecks` no usa `kind`, así que los tipos nuevos no le cambian nada.
  - `caretAfterFixes(caret: number, checks: HelpCheck[]): number`. Corre el cursor según los arreglos `auto` que aplica `applyFixes`, elegidos con su misma regla: de atrás hacia adelante, y se salta uno si `c.end > floor`. Conviene sacar esa elección a una función común para no copiarla. Por cada arreglo aplicado:
    - si `end <= caret`, suma `replacement.length - (end - start)`;
    - si `start < caret < end` (el cursor está dentro de lo reemplazado), el cursor pasa a `start + replacement.length`, más lo que corran los arreglos de antes.
- Copia nueva:
  - `hc.informal`:
    - es: `Aquí se le habla al traductor de «tú»: «{word}» → «{formal}».`
    - pt: `Aqui o tradutor é tratado por «tú»: «{word}» → «{formal}».` (la misma forma que `addr.informal` en `pt.json`)
  - `hc.undo`: es `Deshacer`, pt `Desfazer`.
  - `hc.fixed`: es `Arreglado`, pt `Corrigido`.
- Actualiza el comentario de `WritingCheck.resources` en `src/config/types.ts`: ahora pueden ser los cuatro recursos de ayudas.

- [ ] **Step 1: Escribe las pruebas que fallan** en `verify-help-checks.mts`:
  - `"un versículo con espacio doble solo lo avisa con la opción"`: `ids(verseChecks("Y el rey  dijo"))` es `[]`. Con `{ doubleSpace: true }` es `["double-space"]`, y `applyFixes` da `"Y el rey dijo"`.
  - `"espacio doble y espacio antes de coma en un versículo se arreglan juntos"`: `"Y el rey  dijo a Amán , vete"` → `"Y el rey dijo a Amán, vete"`.
  - `"un poema conserva sus líneas"`: `"Alaben a Jehová\nporque  él es bueno ,"` con `doubleSpace` → `"Alaben a Jehová\nporque él es bueno,"`.
  - `"el «tú» es un aviso que se arregla"`: `checksOf("Puedes traducirlo así.", "notas", { address: "usted", language: "es" })` contiene `informal`, y su `applyFixes` empieza por `"Puede traducirlo"`.
  - `"el «tú» y un espacio doble se arreglan en una pasada"`: `"Puedes  traducirlo así."` → `"Puede traducirlo así."`.
  - `"sin regla de tratamiento no hay aviso del «tú»"`: con `address: undefined` no hay `informal`.
  - `"la regla de la definición no se aplica después de los ejemplos"`: con `"El **rey** dijo"` en `palabras`, la negrita se avisa con `past: "# rey\n\nDefinición"`. No se avisa con `past: "…\n## Ejemplos de las historias bíblicas"`, ni con `past: "…\n## Examples from the Bible stories"`.
  - `"el espacio doble no se avisa dos veces"`: `verseChecks("dijo: «  Ve  »", { doubleSpace: true })` da solo `space-open` y `space-before`, sin `double-space`.
  - `"el cursor se corre con los arreglos de antes"`: en `"Y el rey  dijo a Amán , vete"`, con el cursor en el final (28), `caretAfterFixes` da 26. Con el cursor en 3 (antes de los arreglos), da 3. Con el cursor en 9, entre los dos espacios dobles (dentro de lo reemplazado), da 9.
  - `"preguntas y academia reciben las comprobaciones de formato, no las reglas de notas"`: `checksOf("Traducción alternativa: **x**  y", "preguntas", …)` tiene `double-space` y no tiene `traduccion-alternativa-entre-comillas`. Con `"notas"` tiene las dos.
- [ ] **Step 2:** `npm run verify:help-checks`. Debe fallar (`checksOf` y `informalChecks` todavía no existen).
- [ ] **Step 3:** implementa las firmas de arriba en `helpChecks.ts`. Agrega `hc.informal` a los dos JSON. Cambia el `until` en `fcr.json`.
- [ ] **Step 4:** corre `npm run verify:help-checks`, `verify:formal-address`, `verify:templates`, `verify:config`, `verify:decoupling` y `npx tsc --noEmit -p .`. Todo debe pasar.
- [ ] **Step 5:** commit: `Checks: the «tú», a doubled space in a verse, and rules that end at a heading`.

## Task 2: `HelpChecksHint`, discreto y tras una pausa

**Files:**
- Modify: `src/components/HelpChecksHint.tsx`
- Modify: `src/styles/components.css` (junto a `.hc-hint`, hacia la línea 9444)

**Interfaces:**
- Consumes: `checksOf`, `applyFixes` (Tarea 1).
- Produces: `HelpChecksHint({ text, kind, before, past, address, doubleSpace, quiet, settle, onFix })`. `text`, `kind`, `before`, `past`, `address` y `doubleSpace` se pasan a `checksOf`. El idioma lo lee el componente con `useUiLanguage()`, como hoy. Además:
  - `quiet?: boolean`: añade la clase `hc-hint--quiet` y el «Deshacer».
  - `settle?: number`: milisegundos de pausa; sin ella, calcula al instante, como hoy.
  - `onFix?: (next: string) => void`.

- [ ] **Step 1:** la pausa. Con `settle`, la lista que se muestra se calcula sobre un texto «asentado». Ese texto se pone al valor actual cuando `text` lleva `settle` ms sin cambiar: un `setTimeout` que se limpia en cada cambio y al desmontarse. Al montarse, el texto asentado es el actual, sin esperar. Si cambian `kind`, `past`, `address` o el idioma, se recalcula sobre el texto asentado sin esperar. Los editores le dan una `key` por versículo, pieza o caja, así que cada uno monta su propio componente y su línea sale enseguida.
- [ ] **Step 2:** «Arreglar» calcula sobre el texto actual, nunca sobre la lista asentada:
  1. Se calculan `checks = checksOf(text, …)` y `next = applyFixes(text, checks)`.
  2. Se llama a `onFix(next)`.
  3. El texto asentado pasa a ser `next` al instante.
  4. Si el elemento con foco es un `textarea` o un `input` cuyo `value` era `text`, en el `requestAnimationFrame` siguiente se le pone `setSelectionRange(c, c)`, con `c = caretAfterFixes(selectionStart, checks)`.
  
  El botón se muestra si la lista asentada tiene algo `auto`.
- [ ] **Step 3:** «Deshacer», solo con `quiet`, y solo si el arreglo cambió algo (`next !== text`).
  - **Qué se guarda.** Se guarda `before = text`. El `after` es el primer `text` que el componente recibe después de `onFix`, no `next`. Así vale aunque el editor devuelva el texto por otro camino: una nota pasa por `noteToTsv` y vuelve por `noteFromTsv`.
  - **Cuánto dura.** Mientras `text === after`, la línea se pinta aunque ya no quede ningún aviso. Si no queda ninguno, dice «Arreglado» (`hc.fixed`) en lugar de «Taller encontró…». Si queda alguno (una regla, una palabra repetida), dice «Taller encontró…» como siempre. En lugar de «Arreglar» se muestra «Deshacer» (`hc.undo`), con la misma forma. En cuanto el texto cambia por otra cosa, el «Deshacer» se olvida y la línea vuelve a lo de siempre (nada, si no hay avisos).
  - **Al tocarlo.** «Deshacer» llama a `onFix(before)`, pone el texto asentado en `before` al instante y olvida el «Deshacer».
- [ ] **Step 4:** el número. `hc.found` se parte por `{n}` al pintar: lo de antes, `<span class="hc-hint__n">{n}</span>` y lo de después. Así sirve en español y en portugués sin cambiar las claves. `hc.foundOne` no tiene número: con `quiet`, la frase entera lleva la clase `hc-hint__n`.
- [ ] **Step 5:** la forma discreta, en CSS. Todo va **después** de la línea `html[data-text] .hc-hint__toggle…` (hoy, la 9454), para ganarle en especificidad y en orden:
  - `.hc-hint--quiet { margin-top: 0.5rem; }`
  - `.hc-hint--quiet .hc-hint__toggle`:
    - `font-size` y `font-weight`: los mismos que `.scripture-editor__verse-body > .step-hints[data-item] .step-hints__lead` (mídelos en el navegador; hoy 0.8125rem y 500);
    - `color: var(--text)`, sin subrayado;
    - `min-height: 2.75rem`.
  - `.hc-hint__n { color: var(--warning-700); font-weight: 700; }`
  - `.hc-hint--quiet .hc-hint__fix`: `font-size: 0.8125rem`; sigue siendo de contorno (no lleno) y conserva los 44 px.
  - La regla de tamaño de letra: `html[data-text] .hc-hint--quiet .hc-hint__toggle, html[data-text] .hc-hint--quiet .hc-hint__fix { font-size: calc(0.8125rem * var(--ts)); }`
- [ ] **Step 6:** corre `npx tsc --noEmit -p .` y `npm run verify:text-size`; deben pasar. Comprueba que Afinación (`AfinacionView`), la hoja de corrección y la de propuestas no cambiaron: siguen llamando sin las propiedades nuevas.
- [ ] **Step 7:** commit: `Checks hint: a quiet form that settles after a pause and fixes the text as it is now`.

## Task 3: El editor del texto

**Files:**
- Modify: `src/components/ScriptureEditorView.tsx` (hacia la línea 2680, el bloque `activeVerse === d.from`)

- [ ] **Step 1:** dentro de `activeVerse === d.from`, **antes** de `<div className="se-row-foot">`, agrega:

  `<HelpChecksHint key={key} text={d.text} kind="verse" doubleSpace quiet settle={1000} onFix={(next) => updateVerse(key, next)} />`

  Solo si `!recreating`. Va dentro del cuerpo del versículo, para que quede entre la caja y «Fíjese en esto» (spec 3.1).
- [ ] **Step 2:** corre `npx tsc --noEmit -p .`; debe pasar.
- [ ] **Step 3:** commit: `Text editor: what Taller finds in the open verse, above «Fíjese en esto»`.

## Task 4: El editor de ayudas

**Files:**
- Modify: `src/components/ArticleBlocks.tsx` (línea 367 y `Props`)
- Modify: `src/components/HelpsEditorView.tsx` (líneas ~1054, ~1166, ~1181, ~1196)

**Interfaces:**
- `ArticleBlocks` recibe `checks?: HelpKind`. Si la recibe, muestra `HelpChecksHint` bajo la caja de la pieza abierta. Si no, no muestra ningún aviso: ninguna otra pantalla que use `ArticleBlocks` cambia.

- [ ] **Step 1:** en `ArticleBlocks`, reemplaza el `FormalAddressHint` de la línea 367 por:

  `checks && shown.trim() ? <HelpChecksHint key={`${id}-${index}`} text={shown} kind={checks} past={past} address={address} quiet settle={1000} onFix={(md) => put(index, md)} /> : null`

  `past` es lo que la ayuda tiene antes de esa pieza. Se arma con `rows` (el arreglo que recorre el `rows.map` de la línea 240): las filas `0..index-1`, cada una como `row.draft.trim() || row.source`, unidas con `"\n\n"`. No se pasa `before`, porque el diseño (§4) no usa el encabezado anterior en el editor.

  Solo el editor de ayudas escribe con `ArticleBlocks`: `PortionReviewView` lo usa con `readOnly`, y ese camino no muestra el aviso (comprobado el 26-11). `FormalAddressHint` sale de `ArticleBlocks`; el componente se queda para la hoja de propuestas.
- [ ] **Step 2:** en `HelpsEditorView`, **crea** al principio del archivo `const helpKindOfResource = (resource: string | undefined): HelpKind | undefined`. Devuelve el recurso si es `notas`, `preguntas`, `palabras` o `academia`, y `undefined` en otro caso. No es `helpKindOf`, que solo acepta Notas y Palabras y devuelve `null`. Pasa `checks={helpKindOfResource(ctx?.resource)}` a `piecesOf`.
- [ ] **Step 3:** en las cajas enteras, reemplaza cada `FormalAddressHint` por `HelpChecksHint` con el mismo texto y el mismo `onFix`, más `kind`, `address`, `quiet`, `settle={1000}` y una `key` por caja (`${item.id}-text` o `${item.id}-answer`). Son tres: la pregunta (~1166), la nota o el artículo en `MarkdownEditor` (~1181) y la respuesta (~1196). La respuesta está dentro de un `<label>`: comprueba en el navegador que tocar «Arreglar» no mueve el foco a la caja. Si lo mueve, saca el aviso del `<label>`. Quita la importación de `FormalAddressHint`.
- [ ] **Step 4:** corre `npx tsc --noEmit -p .` y `npm run verify:decoupling`; deben pasar.
- [ ] **Step 5:** commit: `Helps editor: one line of what Taller finds, the «tú» among it`.

## Task 5: Probar en el navegador

Cómo levantar el mock, sembrar y usar los guiones: en el relevo de la construcción de esta entrega (`2026-11-26-fase-1-entrega-7-construccion.md`, en la carpeta de notas de la sesión que lo escribió).

- [ ] **Step 1:** levanta el mock sembrado con Ester y siembra con `seed-fase-1.mts`. Entra como la persona que traduce el TPL y abre el editor del texto en el teléfono (375 px).
- [ ] **Step 2:** en un versículo, fija el texto `Y el rey  dijo a Amán , vete` (con el *setter* nativo y un evento `input`). Comprueba, en este orden:
  - antes de un segundo no hay línea;
  - después sale «Taller encontró 2 cosas»;
  - «Arreglar» deja `Y el rey dijo a Amán, vete`, el foco sigue en la caja, el cursor no salta al final si estaba en medio, y la línea muestra «Deshacer» al instante;
  - «Deshacer» devuelve el texto con sus dos fallos; escribir una letra hace que «Deshacer» desaparezca.
- [ ] **Step 3:** escribe letra a letra (con `computer type`) en un versículo con un aviso. Mientras se escribe, la línea no aparece ni desaparece. Pasa al versículo siguiente con la flecha: sale la línea de ese versículo, no la del anterior.
- [ ] **Step 4:** en un versículo de poema, provoca un espacio doble y arréglalo. Las líneas siguen siendo las mismas. Anota dónde queda el cursor.
- [ ] **Step 4b:** con el teclado abierto (alto de unos 400 px en el teléfono), comprueba que la caja sigue a la vista con la línea y «Fíjese en esto» debajo. El contraste de la línea debe cumplir lo que pide `docs/FILOSOFIA_DE_DISENO.md`.
- [ ] **Step 5:** entra como la persona de Notas. En una nota escribe `Puedes  traducirlo así.` Comprueba:
  - hay una sola línea, «Taller encontró 2 cosas»;
  - ya no sale el aviso viejo («Aquí se le habla al traductor…»);
  - «Arreglar» deja `Puede traducirlo así.`
- [ ] **Step 6:** en Palabras, con un artículo por piezas, pon negrita en una pieza de los ejemplos: no sale el aviso de la definición. En la definición, sí.
- [ ] **Step 7:** mide con `audit()`:
  - la línea no es más grande que «Fíjese en esto» (`getComputedStyle`);
  - los botones miden 44 px o más;
  - no hay un segundo botón lleno.
  
  Repite con el tamaño de letra grande: la línea crece. Repite en escritorio.
- [ ] **Step 8:** abre Afinación y una hoja de propuestas de una nota: se ven como antes.
- [ ] **Step 9:** corre todas las pruebas de «Global Constraints» y haz un commit si hubo arreglos.

## Al cerrar

- Revisión de toda la rama con un pez dorado (un subagente Sonnet sin contexto), con el diseño, este plan y el diff.
- Subir la rama y abrir el PR **con el OK de Abel**.
- Todo hallazgo fuera del alcance va a un issue del repo.
- El relevo de lo que sigue (la entrega 8, el guardado de las ayudas) va en la carpeta de notas.
