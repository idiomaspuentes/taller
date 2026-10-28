# Avisos de armonización (etapa 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bajo una propuesta de nota o de artículo de Palabras (al escribirla y al revisarla), Taller muestra lo que encontró solo: errores mecánicos con «Arreglar», reglas del equipo con su porqué, y en Palabras, si la palabra enlazada no está entre los números Strong del artículo.

**Architecture:** Funciones puras en `src/domain/helpChecks.ts` (mecánicos y reglas) y `src/domain/termStrong.ts` (Strong del enlace); las reglas del equipo viven en el paquete del proceso (`writingChecks` en `processes/fcr.json`), validadas como el resto del paquete. Un componente `HelpChecksHint`, hecho como `FormalAddressHint`, las muestra en `ProposalSheet` (al escribir) y en `NoteOptions` (al revisar, donde «Arreglar» abre un ajuste con el texto arreglado).

**Tech Stack:** React 18, TypeScript, Vite; pruebas `scripts/verify-*.mts` con `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-28-herramientas-de-armonizacion-design.md` (capa 1 y el aviso de Strong del apartado «Palabras»).

## Global Constraints

- Ninguna capa bloquea publicar: los avisos nunca deshabilitan «Proponer» ni «Estoy de acuerdo».
- Si no hay nada que avisar, no se ve nada (ni siquiera un contenedor vacío).
- Nunca más de tres avisos a la vista; los demás en «Ver N más».
- Los tipos de comillas no se avisan nunca (se ajustan solos al publicar).
- Los avisos nunca cambian lo que dice el texto, solo su forma; los de reglas no se arreglan solos.
- `src/` no nombra ninguna regla ni id del FCR (`verify:decoupling`); las reglas van en `processes/fcr.json`.
- Todo texto de interfaz con `useT()`, en `es.json` y `pt.json` con los mismos `{marcadores}` (`verify:config`). Esos dos archivos se editan con la herramienta de edición o con un guion que primero lee el archivo entero; nunca abriendo para escribir y leer en la misma expresión (ya los vació una vez).
- Al revisar la propuesta de otra persona, «Arreglar» no la cambia: abre un ajuste con lo arreglado.
- Teléfono primero: probado a 375 px y en escritorio; el botón «Arreglar» no saca el cursor del texto (`onMouseDown` con `preventDefault`, como `FormalAddressHint`).
- Commits en inglés, título corto y cuerpo con el porqué, terminando en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Trabajar en una rama `avisos-armonizacion`, no en `main`.

## Review Focus

1. Las viñetas de Palabras llevan varios espacios tras el asterisco (`*   Usualmente…`): el aviso de doble espacio no debe saltar en la sangría de una línea, solo dentro del texto.
2. Enlaces válidos con salmos de tres cifras (`psa/054/01`) y códigos en minúscula o mayúscula no deben avisar; un enlace a otro recurso (`rc://*/ta/man/…`, `../kt/…`) tampoco.
3. Una nota se edita en su forma de lectura (`noteFromTsv`): los avisos corren sobre esa forma, no sobre `\n` literales del TSV.
4. Artículos sin números Strong en español ni en inglés: el aviso de Strong calla, no avisa «no está».
5. Palabras hebreas con prefijos y marcas (`הַ⁠מֶּ֣לֶךְ`, atributo `strong="b:H4428"`): el Strong se compara sin prefijo ni letra final, y `G07440`/`G744` cuentan como el mismo.

---

### Task 1: Avisos mecánicos

**Files:**
- Create: `src/domain/helpChecks.ts`
- Create: `scripts/verify-help-checks.mts`
- Modify: `package.json` (agregar `"verify:help-checks": "tsx --tsconfig tsconfig.scripts.json scripts/verify-help-checks.mts"`)
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/pt.json` (las claves `hc.badLink`, `hc.doubleSpace`, `hc.spaceBefore`, `hc.listComma`, `hc.bareHeading`, `hc.bulletSpace`, con los textos de la lista de Task 4, porque `message.key` es un `MessageKey`)

**Interfaces:**
- Consumes: `BOOKS`, `usfmStudyBookId` de `src/domain/books.ts`.
- Produces:
  ```ts
  export type HelpKind = "notas" | "palabras";
  export type HelpCheck = {
    id: string;                 // "bad-link" | "double-space" | "space-before" | "list-comma" | "bare-heading" | "bullet-space" | id de una regla del paquete
    fix: "auto" | "none";       // "auto": se arregla con «Arreglar»
    excerpt: string;            // el trozo del texto que se muestra
    message: { key: MessageKey; params?: Record<string, string> } | { text: string }; // mecánicos: clave hc.* (Task 4); reglas: texto del paquete en el idioma pedido
    why?: string;               // solo reglas
    start: number; end: number; // posición en el texto
    replacement?: string;       // solo fix "auto"
  };
  export function mechanicalChecks(text: string, opts: { kind: HelpKind; before?: string }): HelpCheck[];
  export function applyFixes(text: string, checks: HelpCheck[]): string;
  ```

- [ ] **Step 1: Write the failing test** `scripts/verify-help-checks.mts`, con la salida legible de los otros `verify-*` (`ok  <nombre>` y un total). Casos, cada uno con `assert`:
  - «un enlace a un libro que no existe se arregla por su nombre»: `"[2 Crónicas 3:14](rc://*/tn/help/1cr/3/14)"` → un aviso `bad-link`; `applyFixes` da `"[2 Crónicas 3:14](rc://*/tn/help/2ch/03/14)"`.
  - «un enlace que no se puede deducir solo avisa»: `"[aquí](rc://*/tn/help/2re/11/1)"` → `bad-link` con `fix: "none"`.
  - «los enlaces buenos no avisan»: `rc://*/tn/help/psa/054/01`, `rc://*/tn/help/LUK/01/34`, `rc://*/ta/man/translate/figs-metaphor`, `../kt/wrath.md` → ningún aviso.
  - «doble espacio dentro del texto, no en la sangría»: `"*   Usualmente, un rey  era"` → un solo `double-space` (el de «rey  era»); `applyFixes` deja `"*   Usualmente, un rey era"`.
  - «espacio antes de coma o punto»: `"de los creyentes de Cristo ."` → `space-before`, arreglado a `"de los creyentes de Cristo."`.
  - «línea de lista que termina en coma»: `"* La palabra casa…, ya sean edificios o tiendas,"` → `list-comma`, arreglado cambiando la coma final por punto.
  - «encabezado sin ##»: con `before` que tiene `"## Definición"`, el texto `"# perjudicar\nDefinición\nLa palabra"` → `bare-heading`, arreglado a `"## Definición"`.
  - «viñeta sin espacio»: `"*Los “hombres sabios”"` → `bullet-space`, arreglado a `"* Los “hombres sabios”"`; `"**[19:16](…)**"` no avisa.
  - «las comillas no se avisan»: `"\"reinar\" y “reinar”"` → ningún aviso.
- [ ] **Step 2: Run it to verify it fails** — `npm run verify:help-checks` → FAIL (no existe `src/domain/helpChecks.ts`).
- [ ] **Step 3: Implement `mechanicalChecks` and `applyFixes` in `src/domain/helpChecks.ts`.** El código del enlace se deduce del nombre del enlace comparándolo con `BOOKS[].name` (sin tildes ni mayúsculas, con el número delante: «2 Crónicas» → `2CH`); capítulo y versículo se rellenan con ceros como los demás enlaces (`03`, salmos `054`). `applyFixes` aplica de atrás hacia adelante solo los `fix: "auto"`.
- [ ] **Step 4: Run it** — `npm run verify:help-checks` → `verify-help-checks: 9 checks passed.`
- [ ] **Step 5: Commit** — `npm run verify:config` pasa; `git add src/domain/helpChecks.ts scripts/verify-help-checks.mts package.json src/i18n/locales/es.json src/i18n/locales/pt.json` · `git commit -m "Helps: mechanical checks under a proposed text"`

### Task 2: Reglas del equipo en el paquete del proceso

**Files:**
- Modify: `src/config/types.ts:83-100` (agregar `writingChecks?: WritingCheck[]` a `ProcessPackage`)
- Modify: `src/domain/workflowCheck.ts` (`processProblems`: validar `writingChecks`)
- Modify: `src/domain/processes.ts` (exportar `writingChecks(packages?)`)
- Modify: `src/domain/helpChecks.ts` (agregar `ruleChecks`)
- Modify: `processes/fcr.json` (las reglas)
- Modify: `scripts/verify-help-checks.mts`, `scripts/verify-templates.mts`

**Interfaces:**
- Consumes: `HelpCheck`, `HelpKind` (Task 1).
- Produces:
  ```ts
  // src/config/types.ts
  export type WritingCheck = {
    id: string;                                   // con guion, como los demás ids del paquete
    resources: ("notas" | "palabras")[];
    pattern: string;                              // expresión regular (flags "gu" siempre)
    near?: string;                                // la regla salta solo si esta otra expresión está en la misma oración
    until?: string;                               // la regla no mira después de la primera línea que cumpla esta expresión
    message: Record<string, string>;              // por idioma de interfaz
    why: Record<string, string>;                  // por idioma de interfaz
  };
  // src/domain/processes.ts
  export function writingChecks(packages?: ProcessPackage[]): WritingCheck[];
  // src/domain/helpChecks.ts
  export function ruleChecks(text: string, kind: HelpKind, rules: WritingCheck[], lang: string): HelpCheck[]; // fix siempre "none"
  ```
- Las reglas del FCR (`processes/fcr.json`, `writingChecks`), con mensaje y porqué en `es` y `pt`:
  - `mayuscula-para-dios` (notas, palabras): `pattern` `\bél\b`, `near` `\b(Dios|Jehová|Señor|Jesús|Cristo)\b`. Mensaje: «¿Se refiere a Dios? En las ayudas va «Él» con mayúscula.» Porqué: «Regla del equipo: mayúscula para Dios y Jesús en las ayudas y el TPS; no en el TPL.»
  - `rey-humano-minuscula` (notas, palabras): `pattern` `\bRey (?!de reyes)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+`. Mensaje: «Un rey humano va con minúscula: «el rey Asuero».» Porqué: «La mayúscula de «Rey» es solo para Dios o Jesús.»
  - `negrita-en-definicion` (palabras): `pattern` `\*\*[^*\n]+\*\*`, `until` `^## (Ejemplos|Exemplos)`. Mensaje: «En la definición no se usa negrita; la palabra de la que se habla va entre comillas.» Porqué: «La negrita es solo para la palabra dentro de las historias bíblicas.»
  - `traduccion-alternativa-entre-comillas` (notas): `pattern` `Traducción alternativa:\s*\*\*`. Mensaje: «La traducción alternativa va entre comillas, no en negrita.» Porqué: «En las notas, la negrita es solo para las palabras del TPL.»

- [ ] **Step 1: Write the failing tests.** En `verify-help-checks.mts`, con `writingChecks()` del paquete real:
  - «él cerca de Dios avisa como pregunta»: `"…hacia Dios porque él es justo"` → `mayuscula-para-dios`; `"Asuero dijo que él iría"` → nada.
  - «Rey con nombre avisa, Rey de reyes no»: `"con el Rey Asuero"` → aviso; `"Rey de reyes"` → nada.
  - «negrita en la definición sí, en los ejemplos no»: artículo con `**provincia**` antes de `## Ejemplos de las historias bíblicas` y `**judíos**` después → un solo aviso.
  - «traducción alternativa en negrita»: `"Traducción alternativa: **incluso hoy**"` → aviso; con comillas → nada.
  - «las reglas no se arreglan solas»: todos con `fix: "none"`.
  En `verify-templates.mts`: «un writingCheck con expresión inválida o sin mensaje en un idioma es un problema» (`processProblems` devuelve un problema para `pattern: "("` y para `message` sin `pt`).
- [ ] **Step 2: Run** — `npm run verify:help-checks` y `npm run verify:templates` → FAIL.
- [ ] **Step 3: Implement** el tipo, la validación (expresiones que compilan, `resources` válidos, `message` y `why` en todos los idiomas de interfaz), `writingChecks()` y `ruleChecks()`; agregar las cuatro reglas a `fcr.json`. La «oración» de `near` es el texto entre `.`, `?`, `!` o salto de línea.
- [ ] **Step 4: Run** — `npm run verify:help-checks`, `npm run verify:templates`, `npm run verify:decoupling` → todos pasan.
- [ ] **Step 5: Commit** — `git commit -m "Helps: the team's writing rules live in the process package"` (con los seis archivos).

### Task 3: El aviso de Strong del enlace

**Files:**
- Create: `src/domain/termStrong.ts`
- Modify: `src/domain/helpQuoteMatch.ts:278` (exportar `quoteInOriginal`)
- Modify: `scripts/verify-help-checks.mts`

**Interfaces:**
- Consumes: `OriginalWord` (`src/dcs/afinacionLoad.ts:37`), `quoteInOriginal(original, quote, occurrence): number[] | null`.
- Produces:
  ```ts
  export function strongKey(raw: string): string | null;        // "b:H4428" → "H4428"; "H0148" → "H148"; "G07440" → "G744"; "G744" → "G744"
  export function articleStrongs(article: string): string[];     // claves de la línea «Strong» de «Datos de esta palabra» / «Word Data»
  export function strongMismatch(p: {
    words: OriginalWord[];      // del versículo
    quote: string; occurrence: number;
    article: string | null;     // el del equipo
    sourceArticle: string | null; // el del paquete fuente (inglés)
  }): { strongs: string[] } | null;  // null = nada que avisar
  ```
  Regla: se usan los Strong del artículo del equipo; si no trae ninguno, los del inglés; si ninguno trae, `null`. Avisa solo si **ninguna** de las palabras citadas tiene su Strong en la lista.

- [ ] **Step 1: Write the failing tests** («strongKey quita prefijos, ceros y la letra final»; «la lista sale de la línea Strong en español o en inglés»; «la palabra del rey está en el artículo del rey» con `הַ⁠מֶּ֣לֶךְ`/`H4428` y la línea `* Números de Strong: H4427, H4428…` → `null`; «una palabra enlazada a un artículo que no la tiene avisa» → `{ strongs: ["H3444"] }`; «sin Strong en ningún artículo, calla» → `null`; «el inglés suple al español» con `article` sin línea Strong y `sourceArticle` con ella).
- [ ] **Step 2: Run** — `npm run verify:help-checks` → FAIL.
- [ ] **Step 3: Implement** `src/domain/termStrong.ts`; exportar `quoteInOriginal` sin cambiar su comportamiento.
- [ ] **Step 4: Run** — `npm run verify:help-checks` y `npx tsc --noEmit -p .` → pasan.
- [ ] **Step 5: Commit** — `git commit -m "Words: warn when the linked word is not among the article's Strong numbers"`.

### Task 4: Mostrar los avisos

**Files:**
- Create: `src/components/HelpChecksHint.tsx`
- Modify: `src/components/ProposalSheet.tsx:303-307,347,355` (junto a `FormalAddressHint`)
- Modify: `src/components/NoteOptions.tsx:171-186,227-236` (bajo la propuesta que se revisa)
- Modify: `src/components/ChecklistView.tsx:811-815` (`adjustProposal(view, startText?)`), `:2780-2789` (`startFrom={startText ?? proposal.after}`), y donde se arma la tarjeta del artículo de Palabras (aviso de Strong)
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/pt.json`, `src/styles/components.css`

**Interfaces:**
- Consumes: `mechanicalChecks`, `ruleChecks`, `applyFixes` (Tasks 1–2), `writingChecks()` (Task 2), `strongMismatch` (Task 3), `originalWordsOf` (`src/dcs/afinacionLoad.ts:40`), `readRaw`, `resolveSourcePackage`, `termArticlePath`.
- Produces:
  ```ts
  export function HelpChecksHint(p: { text: string; kind: HelpKind; before?: string; onFix?: (next: string) => void }): JSX.Element | null;
  ```
  Con `onFix`, «Arreglar» aplica los automáticos; sin `onFix` (en la revisión) el componente no se usa: `NoteOptions` pasa un `onFix` que abre el ajuste (`onEdit(head, fixed)`).
- Claves (es / pt), con sus textos; las de los avisos mecánicos (`hc.badLink` … `hc.bulletSpace`) ya se agregaron en Task 1, aquí van las demás:
  - `hc.found`: «Taller encontró {n} cosas» / «O Taller encontrou {n} coisas»; `hc.foundOne`: «Taller encontró 1 cosa» / «O Taller encontrou 1 coisa»
  - `hc.more`: «Ver {n} más» / «Ver mais {n}»; `hc.fix`: «Arreglar» / «Corrigir»; `hc.why`: «Por qué» / «Por quê»
  - `hc.badLink`: «Este enlace lleva a un libro que no existe ({code}).» / «Este link leva a um livro que não existe ({code}).»
  - `hc.doubleSpace`: «Sobra un espacio.» / «Sobra um espaço.»; `hc.spaceBefore`: «Sobra el espacio antes del signo.» / «Sobra o espaço antes do sinal.»
  - `hc.listComma`: «La línea termina en coma.» / «A linha termina em vírgula.»; `hc.bareHeading`: «Falta «##» en el encabezado.» / «Falta «##» no título da seção.»
  - `hc.bulletSpace`: «Falta el espacio después del asterisco.» / «Falta o espaço depois do asterisco.»
  - `hc.strong`: «Esta palabra ({strong}) no está entre las del artículo; revise si el enlace es el correcto.» / «Esta palavra ({strong}) não está entre as do artigo; confira se o link é o correto.»

- [ ] **Step 1: Implement `HelpChecksHint`** como `FormalAddressHint` (`role="status"`, `onMouseDown={preventDefault}` en el botón): una línea «Taller encontró N cosas» que abre la lista; hasta tres visibles, el resto tras `hc.more`; cada aviso muestra su `excerpt` y su mensaje; los de regla tienen `hc.why` que despliega el porqué; un solo `hc.fix` para todos los automáticos. Sin avisos, `null`.
- [ ] **Step 2: Wire it** en `ProposalSheet` (con `onFix={setText}`, y en las partes `other`/`extra` igual que `FormalAddressHint`), en `NoteOptions` (bajo `changeOf(head…)`, con `onFix={(fixed) => onEdit(head, fixed)}`), y el aviso de Strong en la tarjeta del artículo de Palabras, una línea bajo el título, solo si `strongMismatch` no es `null`. `adjustProposal(view, startText?)` abre `ProposalSheet` con `startFrom={startText ?? view.proposal.after}`.
- [ ] **Step 3: Run** — `npx tsc --noEmit -p .`, `npm run verify:config`, `npm run verify:help-checks`, `npm run verify:decoupling`, `npm run verify:note-situation`, `npm run verify:check-proposal` → todos pasan.
- [ ] **Step 4: Verify in the browser** contra el mock sembrado (`MOCK_PM_ORG=es-419_gl MOCK_SEED_BOOK=EST npm run mock:door43`, sesión `?mockUser=ana`), a 375 px y en escritorio, midiendo dentro de `.af` (no la ventana):
  - una nota sin problemas al proponer: no aparece nada nuevo;
  - escribir `[2 Crónicas 3:14](rc://*/tn/help/1cr/3/14)` y un doble espacio: «Taller encontró 2 cosas», «Arreglar» los corrige y el teclado no se cierra;
  - con `bea`, revisar esa propuesta antes de arreglar: aparece la línea; «Arreglar» abre un ajuste con el texto arreglado y la propuesta de Ana no cambia;
  - un artículo de Palabras con una fila de la lista apuntada a un artículo que no tiene su Strong: la línea `hc.strong` bajo el título; uno que sí lo tiene: nada.
  Captura de cada caso. Pasar la lista de `docs/FILOSOFIA_DE_DISENO.md`.
- [ ] **Step 5: Commit** — `git commit -m "Harmonization: show what Taller found under a proposal, while writing and while reviewing"`.
