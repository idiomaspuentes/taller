# Plan de ejecución: colisiones USFM

Plan ejecutable para [`PLAN_RAMAS_Y_COLISIONES.md`](./PLAN_RAMAS_Y_COLISIONES.md)
(la política). Este documento **no** reabre reglas de producto: las
fija, señala dónde el código actual las contradice y ordena el trabajo
en slices del tamaño de un PR. Cada slice deja la app funcionando.

Código revisado: `src/domain/usfmVerseMerge.ts`,
`src/domain/usfmGitMerge.ts`, `src/domain/usfmEdit.ts`,
`src/domain/usfmAst.ts`, `src/domain/draftCache.ts`,
`src/domain/solverLaunch.ts`, `src/domain/workOrder.ts`,
`src/dcs/portionPr.ts`, `src/dcs/repoFile.ts`, `src/dcs/pulls.ts`,
`src/dcs/bookBootstrap.ts`, `src/components/ScriptureEditorView.tsx`,
`src/components/MyTasksView.tsx`, `src/components/PublishView.tsx`,
`scripts/verify-usfm-merge.mts`.

---

## Revisión (gotchas)

Cada punto: qué falla, dónde, si la política ya lo cubre y qué decide
este plan.

1. **El texto viejo de una rama de trabajo pisa versículos ya
   fusionados (confirmado).**
   `mergePortionPrIfOpen` llama `mergeUsfmByVerse(bookFile.text,
   [headFile.text])`. `mergeUsfmByVerse` usa el tronco como un candidato
   más y `pickText` devuelve `nonempty[nonempty.length - 1]`: si la rama
   `w/…` conserva el texto que tenía al bifurcarse en un versículo que
   no tocó, ese texto viejo **gana** al texto nuevo del tronco. La
   política lo cubre (6.3). *Decisión:* slice 1 aplica **las dos**
   capas, ancestro por slot **y** alcance de la porción. Sin esto no se
   construye nada de puentes encima.

2. **Faltan datos para el ancestro, pero existen en DCS.**
   El tipo `DcsPull` (`src/dcs/pulls.ts`) no declara `merge_base`,
   aunque Gitea sí lo devuelve en `GET /pulls/{n}`. La rama `w/…` se
   crea una sola vez desde el tronco (`ensureTaskBranchFromBook` →
   `ensureBranchFrom`) y nunca se rebasa; las escrituras de Cerrar van
   por Contents API al tronco, así que el merge-base del PR sigue siendo
   el punto de bifurcación. `readRepoFile` acepta un SHA como `branch`
   (`ref` de Contents API). La política no dice de dónde sale el
   ancestro. *Decisión:* ancestro = archivo en `pull.merge_base`. Si
   falta `merge_base`, Cerrar falla en español y no cierra el issue
   (la API de compare de DCS no devuelve el merge-base). Si el archivo
   da 404 en ese SHA, el ancestro es `""`.

3. **El rango de la porción al Cerrar: existe, y es el mismo que usa el
   editor.**
   `MyTasksView.close(issue)` solo tiene el issue. No hay `ctx`, así que
   el `parseRefRange(ctx.ref)` de la política (6.3) no existe en ese
   punto. Sí existe la misma fuente que usa el editor:
   `buildSolverLaunchContext` pone `ref = refFromIssueTitle(issue.title)`
   y `rangeFromLaunch` (en `ScriptureEditorView`) hace
   `parseRefRange(ref) || { chapter, from: 1, to: 1 }`. *Decisión:*
   extraer un helper `portionRange(ref, chapter)` en `usfmEdit.ts` que
   usen el editor y Cerrar. El alcance de Cerrar queda idéntico a lo que
   el editor dejó escribir. La frase de la política se corrigió.

4. **El rango de un lote de varias porciones está truncado (ya hoy, en
   el editor).**
   `rangeLabelForPortions` (`workOrder.ts`) arma
   `` `${refs[0]}–${last.split(":").pop()}` ``: dos porciones `1:1–8` y
   `1:9–12` dan `1:1–8–9–12`. Entre capítulos (`1:9–11` + `2:1–4`) da
   `1:9–11–1–4`. `parseRefRange` corta en el primer rango: el editor
   solo muestra 1:1–8, y 1:9–12 **no se pueden traducir** en ese issue.
   *Actualizado:* `rangeLabelForPortions` emite ahora un solo rango por
   capítulo (`1:1–12`); `parseRefRange` lee la cadena vieja no
   decreciente (`1:1–8–9–12` → 1:1–12) y devuelve `null` si retrocede o
   nombra otro capítulo. Cerrar usa `parseRefRange` estricto y falla en
   español si es `null`; `portionRange` (solo para mostrar en el editor)
   conserva el primer tramo o `c:1`. Límite: un lote con huecos en el
   mismo capítulo cubre de la primera a la última.

5. **El error de `writeRepoFile` se traga y el PR se cierra con un
   comentario falso (confirmado).**
   En `mergePortionPrIfOpen` el `try { … writeRepoFile … } catch {}` no
   hace nada. Después, si `mergePull` falla, se comenta «Fusión por
   versículos aplicada en la rama del libro» y se llama `closePull`,
   aunque la escritura haya fallado. Además, `writeRepoFile` solo
   reintenta un 409/422 cuando **no** recibió `sha`. Cerrar pasa
   `sha: bookFile.sha`, así que no reintenta. Y `wrapWriteError` sin
   `step` devuelve un `Error` plano **sin** `status`, por lo que quien
   llama ni siquiera puede saber que fue un choque de SHA. *Decisión:*
   nuevo `BootstrapStep` `"trunk-merge"` para conservar el `status`;
   bucle de releer, fusionar y escribir, con un máximo de 3 intentos;
   si se agotan, se lanza el error y el issue no se cierra.

6. **Cerrar nunca debe escribir el tronco sin `sha`.**
   La rama `!params.sha` de `writeRepoFile` relee el SHA y **vuelve a
   escribir el mismo contenido**: es una actualización perdida si el
   contenido se calculó sobre un tronco viejo. La política no lo dice.
   *Decisión:* el camino de Cerrar siempre pasa el `sha` leído en ese
   intento. El reintento lo hace el bucle de fusión, nunca
   `writeRepoFile`.

7. **`mergePull` después de la escritura por versículos puede deshacer
   la decisión semántica.**
   Tras el commit por versículos, Cerrar llama igual a `mergePull`. Si
   Git fusiona limpio, aplica cambios **de línea** del trabajo que el
   tronco dejó igual al ancestro. Eso incluye justo los casos en que la
   regla decide «queda el tronco»: conflicto estructural (P8/P9), un
   versículo vaciado en el trabajo (vacío pierde) y cambios fuera de la
   porción. La política no lo cubre. *Decisión:* si hubo camino por
   versículos, **no** se llama `mergePull`. Se comenta en el PR y se
   cierra. `mergePull` queda solo para PRs sin USFM (TSV de notas o
   preguntas).

8. **Los PRs que no son USFM también pasan por el camino de USFM.**
   Si el PR no tiene `.usfm`, `usfmPath` cae en
   `bookUsfmName(bookCodeFromWorkHead(head))`. `readRepoFile` da 404,
   el `catch` lo traga y se sigue a `mergePull`. Si `mergePull` falla,
   el mismo comentario falso de versículos se publica y el PR de notas
   se cierra **sin fusionar**. *Decisión:* si el archivo USFM no existe
   en la rama `head` (404), el PR no es de USFM. Se llama `mergePull` y,
   si falla, se lanza un error en español sin cerrar ni PR ni issue.

9. **Cerrar sin marcador de PR no fusiona nada.**
   `mergePortionPrIfOpen` devuelve `"none"` y `close` cierra el issue.
   Si la tarea TPL/TPS no pasó por reseña (el PR se abre al marcar
   borrador con reseña, al Tomar o con «Listo para revisión»), la rama
   `w/…` guardada **nunca llega al tronco**. La política lo menciona
   como comportamiento («el issue se cierra igual») sin decir que pierde
   trabajo. *Decisión:* slice 1. En `MyTasksView.close`, si el recurso
   es `tpl`/`tps` y no hay marcador, se llama `ensurePortionPr` antes de
   fusionar. Es idempotente y `bucket.board`, `lang` y `contentOrg` ya
   están disponibles.

10. **Un PR cerrado a mano (sin merge) salta la fusión.**
    `pull.state === "closed"` devuelve `"already"` sin mirar si hubo
    fusión. *Actualizado:* `"already"` solo si `pull.merged`. Un PR
    cerrado sin fusión con USFM en su rama se vuelve a fusionar por
    versículos (idempotente: no escribe si el tronco ya lo tiene, no
    repite el comentario de conflictos). Sin USFM devuelve `"closed"`;
    para TPL/TPS `closeIssueBlockReason` impide cerrar el issue, igual
    que con `"none"`.

11. **Reintentar Cerrar después de una escritura parcial pierde el
    registro del conflicto.**
    Con tres vías, si el tronco ya se escribió pero falló algo después
    (comentario, `closePull` o `closeIssue`), el segundo Cerrar ve el
    tronco igual al lado entrante: no hay conflicto y la lista se
    pierde. *Decisión:* slice 3 publica el comentario de conflictos
    **antes** de escribir el tronco. Un comentario duplicado en un
    reintento es aceptable; uno perdido no.

12. **`conflicts[]` no puede decir qué issue escribió el texto del
    tronco.**
    La política pide `{ issue, … }` por candidato. Contents API no da
    autoría por versículo. *Decisión:* el candidato del tronco lleva
    `source: "tronco"` y el SHA del tronco; el entrante lleva
    `source: "issue"` y el número. La frase de la política se corrigió.

13. **El marcador máquina de conflictos no puede ser JSON crudo en un
    comentario HTML.**
    `MARKER_RE` de `portionPr.ts` usa `\{[\s\S]*?\}` (perezoso). Un
    texto de versículo con `}` o `-->` rompe el marcador o el comentario
    HTML. *Decisión:* `<!-- tas:verse-conflicts <base64url(JSON)> -->`,
    con el mismo codificador que `encodeSolverLaunchContext`.

14. **Puentes: `listVerseSpans` descarta el `-M` y el sufijo de
    letra.**
    La regex `^\\v\s+(\d+)(?:-(\d+))?([a-z])?` captura `-11` y `a` pero
    solo devuelve `verse`. `\v 10a` y `\v 10b` caen en la misma clave y
    `verseMap` (`Map.set`) se queda con el último: el texto de `10a` se
    pierde sin aviso. La política saca `\v 10a` del alcance, pero hoy el
    código **borra** texto. *Decisión:* slice 2 añade `verseTo` y
    `segment`. Los segmentos del mismo número se **unen** en orden de
    archivo con un espacio en un solo slot, con aviso `segmento`. Un
    `\v` duplicado real (sin letra) sigue la política: gana el último,
    con aviso `duplicado`. Un `\v 11-10` o `\v 10-10` se lee como
    `\v 10` con aviso `rango-invalido`. En lectura se tolera el guion
    largo `–`; al escribir siempre se usa `-`. Un puente entre capítulos
    no existe en USFM (un `\v` vive dentro de un `\c`).

15. **Puente que se sale de la porción.**
    UST trae muchos puentes, y TPS arma el esqueleto desde UST. Una
    porción 11–13 puede encontrarse con `\v 10-11` en el tronco. Hoy
    `extractVerseEdits` indexa por el primer número: el 11 «falta» y
    `applyVerseEdits` lo **añade al final del capítulo** con un número
    que ya está ocupado. *Decisión:* un slot pertenece a la porción si
    **interseca** su rango. El editor lo muestra como una fila
    `10–11`, editable pero **sin** Unir/Separar, con la pista «Puente
    con versículos fuera de tu porción». En Cerrar, el alcance también
    es por intersección. Si dos porciones escriben el mismo puente con
    textos distintos, es el caso P5 (conflicto de texto, gana el
    último).

16. **Unir y Separar: casos borde.**
    Unir cuando una fila ya es puente: `10–11` + `12` da `10–12`.
    Separar no puede repartir el texto de forma mecánica: todo queda en
    `N` y el resto vacío, con aviso. Unir exige
    `next.from === cur.to + 1` y ambas filas **dentro** del rango.
    *Decisión:* así, sin heurística de reparto.

17. **El caché local del borrador descarta las claves de rango.**
    `loadDraftCache` hace `Number(k)` y descarta lo que no es finito:
    `"10-11"` da `NaN` y el puente desaparece al recargar.
    `editedVerses` es `Set<number>` y `VerseDraft` es
    `{ verse, text }`. *Decisión:* slice 4 indexa por clave de slot
    (`"10"` o `"10-11"`). Las claves numéricas antiguas siguen siendo
    válidas.

18. **La vía AST del borrador también pierde el puente.**
    `verseFromSid("NEH 1:10-11")` y `verseNumberFromNode` se quedan con
    `10`. *Decisión:* la **estructura** de las filas sale de
    `listVerseSpans` (con `verseTo`). La vía AST solo aporta el texto de
    la fila, buscado por `from`.

19. **`skeletonUsfmFromSource` borra los puentes de la fuente.**
    Escribe `\v ${span.verse}`. *Decisión:* se corrige en slice 4, **no**
    en slice 2. Si el esqueleto conservara puentes antes de que el
    editor los entienda, el editor volvería a añadir el 11 al final del
    capítulo.

20. **La extracción plana mete títulos y notas dentro del versículo.**
    `listVerseSpans` corta de `\v` al siguiente `\v`/`\c`, y
    `stripAlignment` cambia cada marcador por un espacio pero **conserva
    su texto**. Un `\s1 Título` entre versos termina pegado al versículo
    anterior y `\f + \ft nota\f*` queda como «+ nota» dentro del texto.
    Con el libro copiado de default (caso C), eso se compara, se
    fusiona y se escribe en el tronco. La política (6.6) solo menciona
    las notas. *Decisión:* slice 2 quita del **texto comparado y
    escrito** los bloques `\f…\f*`, `\fe…\fe*` y `\x…\x*`, y las líneas
    de párrafo de título (`\s#`, `\ms#`, `\mr`, `\r`, `\d`, `\sp`,
    `\cl`, `\cd`, `\rem`) junto con su contenido. Con la regla «TAS
    normaliza», esos elementos no sobreviven en el tronco: pérdida
    aceptada y listada en «Fuera de este plan».

21. **`mergeUsfmBranchesWithGit` repite el error de dos vías y descarta
    el resultado de Git.**
    Llama `mergeUsfmByVerse(baseUsfm, [oursUsfm, theirsUsfm])`: el
    ancestro entra como candidato. No trae blobs de DCS (recibe tres
    strings y arma un repo sintético). `usedGitMerge` es `false`
    justamente cuando Git choca. La prueba actual usa un esqueleto
    vacío, así que el fallo de tres vías no se ve. La política (5.1)
    decía que «trae el blob de cada lado»; se corrigió. *Decisión:*
    slice 5.

22. **No existe «Publicar libro».**
    `PublishView` publica **issues** (`publishWorkOrders`). No hay PR
    tronco → default en ningún sitio. *Decisión:* ningún slice finge un
    bloqueo. El marcador de conflictos del slice 3 deja los datos listos
    para un bloqueo futuro, que está fuera de este plan.

23. **Normalizar reescribe todo el tronco en la primera fusión.**
    `mergeUsfmByVerse` siempre emite un `\p` por capítulo y una línea
    por versículo. El primer Cerrar sobre un libro copiado de default
    aplana poesía y párrafos, aunque el entrante no traiga cambios.
    Además, Guardar (`applyVerseEdits`) reemplaza de `\v` al siguiente
    marcador: borra un `\q`/`\p`/`\s` que siga al versículo editado.
    *Decisión:* es la regla acordada («TAS normaliza»). Solo se evita
    escribir cuando el resultado es idéntico al tronco (sin commits
    vacíos).

**Frases corregidas en la política** (`PLAN_RAMAS_Y_COLISIONES.md`):

- 2.4, paso 3: el tronco **no** siempre quedó ensamblado; la escritura
  puede fallar sin aviso (gotcha 5).
- 5, punto 1: `mergeUsfmBranchesWithGit` no trae blobs; recibe tres
  textos y descarta el archivo de Git (gotcha 21).
- 6.3: en Cerrar no hay `ctx.ref`; el rango sale del título del issue
  (gotcha 3).
- 6.4: el candidato del tronco no tiene issue conocido (gotcha 12).

Dos propuestas de la política **no** se adoptan tal cual, por decisión
y no por error: comentar en el issue PM **y** en el PR (aquí: solo en
el PR), y que Cerrar llame a `mergeUsfmBranchesWithGit` (aquí: no; ver
«Decisiones cerradas»). La sección 12 y el punto 5 de la sección 9 se
alinean en el slice 5.

---

## Decisiones cerradas

No se discuten durante la implementación.

- **isomorphic-git es solo transporte.** Un conflicto de líneas sobre
  un USFM en blanco es falso cuando se editaron versículos distintos.
  Nunca se escriben `<<<<<<<` / `=======` / `>>>>>>>` en un archivo.
- **Cerrar sigue con Contents API + fusión por versículos, sin
  isomorphic-git en el navegador.** Hoy ningún archivo de `src/`
  importa `usfmGitMerge.ts`. Llevarlo a Cerrar exige un `fs` en el
  navegador (IndexedDB), clonar el repo de DCS por HTTP con CORS y
  token, y sumar isomorphic-git al bundle. Todo eso para un resultado
  que el propio helper descarta (el helper arma un repo sintético con
  los tres blobs y devuelve la fusión por versículos). El script de
  verificación sigue siendo la prueba de Git: demuestra que Git choca y
  que la fusión semántica no.
- **Colisión real** = el mismo número de versículo ocupado, con dos
  textos planos no vacíos distintos tras NFC + `trim` (+ espacios
  colapsados, + sin alineación, notas ni títulos). Gana el último lado
  (la subtarea que cierra), se escribe un solo texto y se registra en
  `conflicts[]`.
- **Vacío pierde ante lleno.** Vaciar un versículo en la rama de
  trabajo **no** se propaga al tronco.
- **Tres vías por slot.** Un lado «aporta» un slot si tiene texto y ese
  slot (rango + texto normalizado) no es idéntico al del ancestro. Solo
  hay conflicto si el tronco **y** el entrante aportan en slots que se
  intersecan. Sin ancestro, todo slot con texto aporta (las dos vías de
  hoy, pero limitadas a la porción).
- **Alcance de la porción al Cerrar** = `portionRange(refFromIssueTitle(issue.title),
  chapterFromIssue(issue))`, el mismo helper que el editor. Un slot del
  entrante entra si **interseca** ese rango. Si no hay rango **ni**
  ancestro, Cerrar falla con un mensaje en español y el issue sigue
  abierto.
- **Puente `\v N-M`** = **un** slot que ocupa los enteros N…M.
  Contiguo, en el mismo capítulo, con `N < M`. Los rangos disjuntos se
  unen en orden de libro y un puente nunca se parte.
- **Puente con texto contra sueltos vacíos: gana el puente.** Sueltos
  con texto contra puente vacío: gana el lado lleno.
- **Puente contra separados con texto en ambos lados, en un número
  común, y puentes solapados distintos con texto (P8/P9):** no se
  resuelve solo. El tronco conserva lo que tenía en ese rango, el
  texto entrante queda en `conflicts[]` (`kind: "estructura"`,
  `kept: "tronco"`) y en su rama `w/…`.
- **Solo formato** (`\p`, `\q`, notas, alineación, títulos) no es
  conflicto de traducción. TAS escribe un `\p` tras cada `\c` y una
  línea plana por versículo o puente, en NFC.
- **Cabecera:** gana la del tronco, salvo que el tronco no tenga `\id`.
- **NFC sí,** al comparar y al escribir, desde el slice 1.
- **Dónde viven los conflictos:** un **comentario en el PR de la
  subtarea** (contenido legible en español + marcador
  `<!-- tas:verse-conflicts <base64url> -->`). No va en el issue PM,
  que se cierra en ese mismo momento, ni en un archivo auxiliar ni en
  un servicio nuevo. `mergePortionPrIfOpen` ya comenta en ese PR, y el
  PR vive en el repo de contenido junto al tronco y a la rama que
  guarda el texto desplazado. El comentario lleva el texto completo de
  cada candidato, así que no depende de que la rama `w/…` sobreviva
  (Recrear la borra).
- **Tras una escritura por versículos no se llama `mergePull`:** se
  comenta y se cierra el PR. `mergePull` solo se usa en PRs sin USFM.
- **Orden de slices:** persistir conflictos (slice 3) va **antes** del
  editor Unir/Separar (slice 4). Unir hace frecuentes los conflictos
  estructurales; sin registro, su único rastro sería la rama `w/…`.
- **La UI está en español.** Los botones de las filas usan el `Button`
  de `@/components/ui/button` con `size="sm"` y `variant="ghost"`,
  como las acciones pequeñas del editor.

### Historia en DCS: parche de un padre + ref de archivo

- **No hay commit de dos padres en DCS.** `git/blobs`, `git/trees` y
  `git/commits` son solo GET; la única escritura es la Contents API,
  que crea un commit con **un** padre. `pulls/merge` (fusión por líneas)
  no se usa para USFM.
- **Cerrar parchea el tronco** (`patchTrunkByVerse`): solo se
  reemplazan los versículos de la porción cuyo contenido cambió. El
  resto conserva sus bytes (cabecera, `\q`/`\s`/`\p`, CRLF o LF), así
  que el **blame de las líneas no tocadas se mantiene**. Si la porción
  no cambió, no hay escritura. El mensaje del commit lleva traductor,
  issue, rango, PR y el SHA de la punta de `w/…`.
- **La otra versión vive en la ref `archivo/{libro}/{issue}`**
  (p. ej. `archivo/neh/41`), que apunta a la punta de la rama de
  trabajo, más el comentario `tas:verse-conflicts` del PR. Se crea
  antes de cerrar el PR; si falla, Cerrar da error y el issue no se
  cierra. Cuelga de `archivo/`, nunca de `neh/` ni de `w/`.
- **El blame de la línea actual sigue siendo de un solo autor:** el de
  quien escribió el commit de Cerrar. Para ver el historial de la
  rama de trabajo hay que abrir la ref de archivo.

---

## Fuera de este plan

- «Publicar libro» (PR tronco → default) y su bloqueo mientras haya
  conflictos. Queda para después; el marcador del slice 3 es su fuente
  de datos.
- UI para listar y resolver conflictos (se resuelve editando el tronco
  con el comentario del PR a la vista).
- Editor enriquecido: notas, poesía, títulos, alineación y segmentos
  `\v 10a` como unidades propias. Hoy se aplanan o se quitan (gotchas
  14, 20 y 23).
- Arreglar el título de los lotes de varias porciones y entre capítulos
  (gotcha 4).
- Fusionar al Cerrar cuando el PR se cerró a mano sin merge (gotcha 10).
- isomorphic-git en el navegador o en un worker.
- Pruebas contra DCS en vivo, contra `es-419_gl` o contra cualquier
  org `*_gl`.

---

## Slices

### Slice 1 — Tres vías + alcance de porción + errores visibles en Cerrar

**Objetivo:** que Cerrar nunca pise un versículo más nuevo del tronco
con el texto viejo de la rama de trabajo, y que un fallo al escribir el
tronco impida cerrar el issue.

**Archivos a tocar**

- `src/domain/usfmVerseMerge.ts`
- `src/domain/usfmEdit.ts`
- `src/domain/trunkMerge.ts` (nuevo, puro, sin imports de `dcs/`)
- `src/dcs/repoFile.ts`
- `src/dcs/pulls.ts`
- `src/dcs/portionPr.ts`
- `src/components/MyTasksView.tsx`
- `src/components/ScriptureEditorView.tsx` (solo `rangeFromLaunch`)
- `scripts/verify-usfm-merge.mts`

**Pasos concretos**

1. `usfmEdit.ts`: exportar
   `portionRange(ref: string, chapter: number): RefRange | null` =
   `parseRefRange(ref) || (chapter > 0 ? { chapter, from: 1, to: 1 } : null)`.
   Exportar `normalizeVerseText(text)`: el texto que devuelve
   `stripAlignment`, pasado por `.normalize("NFC")`.
2. `ScriptureEditorView.tsx`: `rangeFromLaunch` pasa a llamar
   `portionRange(decoded.ref, decoded.chapter)`. El comportamiento no
   cambia.
3. `usfmVerseMerge.ts`: añadir un tercer parámetro opcional a
   `mergeUsfmByVerse`:
   `opts?: { ancestor?: string | null; scope?: RefRange | null }`.
   - Los textos se comparan con `normalizeVerseText` y se escriben en
     NFC.
   - `scope`: de cada lado entrante (`sides`) solo cuentan las claves
     del capítulo del `scope` con número en `[from, to]`. El resto de
     claves del lado se ignoran, incluso para el orden.
   - `ancestor` (string, aunque sea `""`): un slot de un lado aporta
     solo si tiene texto y ese texto es distinto del texto del ancestro
     en esa clave. El tronco (`base`) siempre es el valor actual, pero
     cuenta como «aportante» solo si difiere del ancestro. Resolución
     por clave:
     - ningún entrante aporta → queda el tronco;
     - aporta un entrante y el tronco no → gana el entrante, sin
       conflicto;
     - aportan el tronco y el entrante, con textos iguales → ese texto;
     - aportan los dos, con textos distintos → gana el último entrante y
       se registra el conflicto.
   - `ancestor` `undefined`/`null`: comportamiento actual (todo texto
     aporta), pero con `scope` y NFC.
   - `VerseConflict` todavía no cambia de forma (eso es el slice 2).
4. `trunkMerge.ts` (nuevo):
   ```ts
   export type TrunkIo = {
     read(): Promise<{ text: string; sha?: string }>;
     write(text: string, sha: string | undefined): Promise<void>;
     isShaConflict(err: unknown): boolean;
   };
   export async function mergeIntoTrunkWithRetry(
     io: TrunkIo,
     compute: (trunkText: string) => UsfmVerseMergeResult,
     maxAttempts = 3,
   ): Promise<{ result: UsfmVerseMergeResult; wrote: boolean; attempts: number }>;
   ```
   En cada intento: `read` → `compute` → si `result.usfm === text`,
   devolver sin escribir (`wrote: false`); si no, `write(result.usfm,
   sha)`. Si `isShaConflict(err)`, reintentar desde `read`; cualquier
   otro error se relanza. Al agotar los intentos, lanzar
   `Error("El libro cambió mientras se fusionaba (3 intentos). Vuelve a pulsar Cerrar.")`.
5. `repoFile.ts`: añadir `"trunk-merge"` a `BootstrapStep` y su etiqueta
   en `stepLabel` (`"fusión en el tronco"`). Así `wrapWriteError`
   conserva `status`.
6. `pulls.ts`: añadir `merge_base?: string` a `DcsPull`.
7. `portionPr.ts`, `mergePortionPrIfOpen`, en orden:
   1. Sin marcador → `"none"`. PR `merged` o `closed` → `"already"`
      (como hoy).
   2. Resolver `usfmPath` como hoy. Leer el archivo de `marker.head`.
      Si da 404 (DcsApiError 404 o BootstrapError con status 404), el PR
      **no es USFM**: `mergePull`; si falla, lanzar
      `Error("No se pudo fusionar el PR de la subtarea: …")` **sin**
      comentar ni cerrar el PR. Devolver `"merged"`.
   3. Ancestro: si hay `pull.merge_base`, `readRepoFile` con
      `branch: pull.merge_base`; si da 404 → `""`. Sin `merge_base` →
      `null`.
   4. `scope = portionRange(refFromIssueTitle(issue.title), chapterFromIssue(issue))`.
      Si `scope` y ancestro son `null`, lanzar
      `Error("No se pudo saber qué versículos aporta esta subtarea (sin rango en el título ni ancestro del PR). No se cerró.")`.
   5. `mergeIntoTrunkWithRetry` con `read` =
      `readRepoFile({ branch: bookRef })`, `write` =
      `writeRepoFile({ …, branch: bookRef, sha, step: "trunk-merge", message: "TAS: fusionar versículos #N" })`
      (el `sha` es siempre el del intento) e `isShaConflict` =
      `BootstrapError` con status 409 o 422. `compute` =
      `(t) => mergeUsfmByVerse(t, [headFile.text], { ancestor, scope })`.
      **Sin `try/catch` vacío.**
   6. Comentar en el PR:
      `"Versículos de #N fusionados en «bookRef». El PR se cierra sin fusión Git: el tronco ya tiene el resultado."`
      (o `"… sin cambios en el tronco."` si `wrote` es `false`), y
      después `closePull`. **No** llamar `mergePull`.
   7. Devolver `"verses"`. El tipo de retorno pasa a
      `"verses" | "merged" | "already" | "none"`.
8. `MyTasksView.tsx`, `close(issue, board)`: pasar `bucket.board` desde
   `onClose`.
   - Si `parsePortionPrMarker(issue.body)` es `null` y el recurso del
     issue (vía `buildSolverLaunchContext`) es `tpl` o `tps`: llamar
     primero `ensurePortionPr({ session, pmOrg, lang, contentOrg, board, issue })`
     y usar el issue que devuelve.
   - Anuncio según el resultado: `"verses"` →
     `#N cerrado · versículos en el tronco`; `"merged"` →
     `#N cerrado · PR fusionado`; el resto, como hoy.
   - Si `mergePortionPrIfOpen` lanza un error, **no** se llama
     `closeIssue` (ya ocurre así, porque está en el mismo `try`).

**Pruebas** — `npx tsx scripts/verify-usfm-merge.mts`. Casos nuevos:

- `libro-lleno-no-sobrescribe`: ancestro con 1:10–13 = `O10…O13`;
  tronco = ancestro con 1:10–11 = `A10`, `A11`; Bob = ancestro con
  1:12–13 = `B12`, `B13`. Se afirma, en tres variantes (solo
  `ancestor`, solo `scope {1,12,13}`, ambos): 1:10 = `A10`,
  1:12 = `B12`, `conflicts = []`. **Sin opciones falla** (1:10 = `O10`):
  dejar esa aserción invertida para documentar el bug.
- `solape-sin-tocar`: ancestro 1:11 = `O11`; tronco 1:11 = `A11`; Bob
  (porción 11–13) deja `O11`, con ancestro. Queda `A11`, sin conflicto.
- `solape-con-cambio`: igual, pero Bob escribe `B11`. Queda `B11`,
  `conflicts.length === 1`.
- `vaciar-no-propaga`: ancestro 1:12 = `X`; tronco igual; entrante
  1:12 vacío. Queda `X`.
- `identico-trim-nfc`: `é` precompuesta contra `e` + U+0301, con
  espacios finales. Sin conflicto y la salida está en NFC.
- `reintento-sha`: `mergeIntoTrunkWithRetry` con un `io` falso. El
  primer `write` lanza un error con `status 409`; el segundo `read`
  devuelve un tronco con 1:1 lleno por otro. Se afirma que se escribió
  una vez, con el 1:1 ajeno y los versos del entrante, en
  `attempts === 2`.
- `reintento-agotado`: `write` siempre lanza 409. La promesa **rechaza**
  y `write` se llamó 3 veces.
- `error-no-sha-se-propaga`: `write` lanza un 500. Rechaza a la primera.
- `sin-cambios-no-escribe`: `compute` devuelve el mismo texto que
  `read`. `wrote === false` y `write` no se llamó.
- `sin-marcadores`: ninguna salida contiene `<<<<<<<`, `=======` ni
  `>>>>>>>`.

También `npm run typecheck`.

**Hecho cuando**

- [ ] `verify-usfm-merge: ok`, con todos los casos nuevos.
- [ ] `npm run typecheck` sin errores.
- [ ] En `portionPr.ts` no queda ningún `catch {}` vacío alrededor de
      la lectura o escritura del tronco.
- [ ] `mergePull` solo se llama en el camino no USFM.
- [ ] El editor abre la misma porción que antes (`rangeFromLaunch` usa
      `portionRange`).

**No hacer en este slice**

- Puentes, `verseTo`, clusters ni cambios de forma de `VerseConflict`.
- Comentarios de conflictos.
- Tocar `usfmGitMerge.ts`.

---

### Slice 2 — Slots por rango en el merge (sin UI)

**Objetivo:** que la fusión trate `\v N-M` como un slot que ocupa N…M y
aplique P1–P9 sin partir nunca un puente.

**Archivos a tocar**

- `src/domain/usfmEdit.ts`
- `src/domain/usfmVerseMerge.ts`
- `scripts/verify-usfm-merge.mts`

**Pasos concretos**

1. `VerseSpan` gana los campos `verseTo: number` (igual a `verse` si no
   hay rango) y `segment?: string`. `listVerseSpans` acepta
   `(\d+)(?:\s*[-–]\s*(\d+))?([a-z])?`. Si `to <= from`, `verseTo = verse`
   y se añade el aviso `rango-invalido`. El campo `verse` no cambia de
   significado, así que los llamadores actuales siguen igual.
2. `stripAlignment`: antes de quitar marcadores, eliminar los bloques
   `\f … \f*`, `\fe … \fe*` y `\x … \x*` completos, y los marcadores de
   título (`\s\d?`, `\ms\d?`, `\mr`, `\r`, `\d`, `\sp`, `\cl`, `\cd`,
   `\rem`) con el resto de su línea. `normalizeVerseText` hereda el
   cambio.
3. `usfmVerseMerge.ts`, nuevo modelo:
   - `Slot = { chapter, from, to, text }`. Por cada lado, `slotsOf(usfm)`:
     une los segmentos `10a`/`10b` en orden con un espacio (aviso
     `segmento`); para duplicados exactos gana el último (aviso
     `duplicado`).
   - `scope`: de los entrantes solo entran los slots que **intersecan**
     el rango.
   - «Candidatos llenos» = slots con texto del tronco + slots con texto
     de cada entrante. Un slot está **vivo** si no hay ancestro, o si el
     ancestro no tiene un slot con el mismo `from`, `to` y texto
     normalizado.
   - Por capítulo: agrupar los candidatos llenos en clusters que se
     intersecan (componentes conexas sobre los números ocupados).
     Resolver cada cluster:
     - todos idénticos (rango + texto) → uno;
     - tronco **no** vivo + entrante vivo → los slots del entrante
       reemplazan a los del tronco en el cluster (P6 con ancestro);
     - vivos de lados distintos con el **mismo** rango y textos
       distintos → gana el último lado; conflicto `kind: "texto"`,
       `kept: "ultimo"` (caso 5 / P5);
     - vivos de lados distintos con rangos **distintos** que se
       intersecan → quedan los slots del tronco en el cluster (o
       ninguno si el tronco no tenía texto ahí); conflicto
       `kind: "estructura"`, `kept: "tronco"` (P8/P9);
     - si solo un lado tiene slots vivos en el cluster → ese lado,
       en su forma (P2, P6, P7).
   - Relleno: tras colocar los slots ganadores, añadir los slots del
     tronco (vacíos o no) que no intersecan nada colocado. Los números
     que siguen sin cubrir se escriben como `\v K` vacíos. Cada número
     aparece exactamente una vez.
   - Emisión: orden por `(chapter, from)`, un `\p` tras cada `\c`,
     `\v N-M texto` o `\v N texto`, en NFC.
   - `VerseConflict` pasa a:
     ```ts
     {
       chapter: number; from: number; to: number;
       kind: "texto" | "estructura";
       kept: "ultimo" | "tronco";
       candidates: { source: "tronco" | "entrante"; sideIndex: number; from: number; to: number; text: string }[];
     }
     ```
     y `UsfmVerseMergeResult` gana `warnings: { chapter: number; verse: number; kind: "segmento" | "duplicado" | "rango-invalido" }[]`.
4. `mergeUsfmBranchesWithGit` solo se adapta al tipo nuevo (sigue sin
   ancestro; eso es el slice 5).

**Pruebas** — `npx tsx scripts/verify-usfm-merge.mts`. Todos los casos
del slice 1 siguen verdes, y se añaden:

- `span-parse`: `\v 10-11 X` y `\v 12 Y` dan `(10,11)` y `(12,12)`.
- `span-vs-esqueleto` (P2): una línea `\v 10-11 X`; ni `\v 10` ni
  `\v 11` sueltos; sin conflicto.
- `span-lleno-vs-sueltos-vacios` (P3): el tronco con el puente lleno
  queda así.
- `span-disjunto` (P1): los dos slots, en orden; el puente no se parte.
- `span-igual` (P4) y `span-mismo-rango-distinto-texto` (P5,
  `kind: texto`).
- `span-vs-dos-llenos` (P8): tronco `\v 10-11 X`, entrante `\v 10 a` +
  `\v 11 b`, sin ancestro. El tronco sigue con `\v 10-11 X`; conflicto
  `estructura`; la salida no contiene `a` ni `b`.
- `span-vs-uno-lleno`: tronco `\v 10-11 X`, entrante `\v 10` vacío +
  `\v 11 b`. `estructura`.
- `spans-solapados` (P9): `10-11 X` contra `11-12 Y`. `estructura`,
  rango 10–12.
- `span-vacio-pierde` (P7): tronco `\v 10-11` vacío; lado A llena
  `\v 10`, lado B llena `\v 11`. Resultado `\v 10 a`, `\v 11 b`, sin
  conflicto.
- `separar-con-ancestro`: ancestro = tronco = `\v 10-11 X`; entrante
  `\v 10 a` + `\v 11 b`. Gana la separación.
- `span-fuera-de-porcion`: `scope` 11–13, entrante `\v 10-11 Z` (el
  tronco lo tenía vacío). Entra porque interseca.
- `segmentos-10a-10b`: un solo `\v 10 a1 a2` con aviso `segmento`.
- `nota-y-titulo-no-entran`: un versículo con `\f + \ft nota\f*` y un
  `\s1 Título` antes del siguiente. El texto no contiene «nota» ni
  «Título», y es igual al del otro lado sin marcas: no hay conflicto.
- `sin-marcadores` sobre todas las salidas.

También `npm run typecheck`.

**Hecho cuando**

- [ ] Todos los casos P1–P9 pasan.
- [ ] Ninguna salida tiene un número de versículo dos veces en un
      capítulo (aserción genérica en el script).
- [ ] `typecheck` sin errores.

**No hacer en este slice**

- Editor, caché ni `skeletonUsfmFromSource`.
- Persistir conflictos.
- `applyVerseEdits`.

---

### Slice 3 — Persistir `conflicts[]` en el PR de la subtarea

**Objetivo:** que una persona vea, después de Cerrar, cada conflicto
con el texto que quedó y el desplazado, sin marcadores Git en el USFM.

**Archivos a tocar**

- `src/domain/verseConflicts.ts` (nuevo, puro)
- `src/dcs/portionPr.ts`
- `src/components/MyTasksView.tsx`
- `scripts/verify-usfm-merge.mts`

**Pasos concretos**

1. `verseConflicts.ts`:
   - `formatVerseConflictsComment(params: { issueNumber: number; bookRef: string; trunkSha?: string; book: string; conflicts: VerseConflict[] }): string`.
     Markdown en español: título «Conflictos de versículo al cerrar
     #N»; por conflicto, una línea `CAP:DESDE–HASTA · texto|estructura`,
     «Quedó en el tronco:» y «Desplazado (#N):» / «Del tronco:» con cada
     texto en un bloque de cita; una nota final: «El tronco no tiene
     marcadores de conflicto. Para resolver, edita el tronco con el
     texto elegido.» Al final va el marcador
     `<!-- tas:verse-conflicts BASE64URL -->`, con el JSON
     `{ schema: "tas-verse-conflicts-1", issue, bookRef, trunkSha, conflicts }`.
   - `parseVerseConflictsComment(body): payload | null`, para pruebas y
     para el futuro bloqueo de publicación.
   - Copiar localmente el codificador base64url de `solverLaunch.ts` (o
     exportarlo desde allí).
2. `trunkMerge.ts`: añadir a `TrunkIo` un hook opcional
   `beforeWrite?(result: UsfmVerseMergeResult): Promise<void>`, que se
   llama justo antes de cada `write`. Si lanza un error, no se escribe
   y el error sube.
3. `portionPr.ts`: `beforeWrite` publica el comentario con
   `commentOnPortionPr` solo si `result.conflicts.length > 0` y el
   payload es distinto del último publicado en este Cerrar (así, un
   reintento por SHA con los mismos conflictos no duplica el
   comentario).
   `mergePortionPrIfOpen` devuelve
   `{ status: "verses" | "merged" | "already" | "none"; conflicts: VerseConflict[] }`.
4. `MyTasksView.tsx`: si hay conflictos, el anuncio es
   `#N cerrado · versículos en el tronco · K conflicto(s): ver comentario del PR`.

**Pruebas** — `npx tsx scripts/verify-usfm-merge.mts`:

- `comentario-roundtrip`: `parse(format(x))` es igual a `x`, con un
  texto que contiene `}`, `-->` y `<<<<<<<`.
- `comentario-legible`: el cuerpo contiene «Quedó en el tronco» y
  ambos textos, y el marcador aparece una sola vez.
- `reintento-no-pierde-conflicto`: con `mergeIntoTrunkWithRetry` y un
  `io` falso cuyo primer `write` lanza 409, `beforeWrite` se llamó
  **antes** de cada `write`, y la última llamada llevó los conflictos
  del intento que escribió.
- `before-write-falla`: si `beforeWrite` lanza un error, `write` no se
  llama y la promesa rechaza.

**Hecho cuando**

- [ ] Hay un comentario por Cerrar con conflictos, en el PR de la
      subtarea, publicado antes de escribir el tronco.
- [ ] El USFM del tronco nunca contiene marcadores Git (aserción ya
      presente).
- [ ] `typecheck` sin errores.

**No hacer en este slice**

- UI de resolución ni bloqueo de «Publicar libro».
- Comentarios en el issue PM.
- Borrar o proteger ramas `w/…` (el comentario ya guarda el texto).

---

### Slice 4 — Unir / Separar en el borrador

**Objetivo:** que el traductor pueda unir filas contiguas de su porción
en un puente `\v N-M` y separarlo, y que Guardar escriba exactamente
eso.

**Archivos a tocar**

- `src/domain/usfmEdit.ts`
- `src/domain/usfmAst.ts`
- `src/domain/draftCache.ts`
- `src/components/ScriptureEditorView.tsx`
- `scripts/verify-usfm-merge.mts`

**Pasos concretos**

1. `usfmEdit.ts`:
   - `applyVerseEdits(usfm, chapter, edits: { from: number; to: number; text: string }[])`.
     Mantener también la forma antigua `{ verse, text }`, que se lee
     como `from = to = verse`. Por cada edición (en orden descendente
     de `from`), reemplazar **todos** los spans del capítulo que
     intersecan `[from, to]` por una sola línea (`\v N-M texto` o
     `\v N texto`), en la posición del primero. Si ninguno interseca,
     insertar la línea después del último span con `verseTo < from`, o
     tras el `\c`/`\p` del capítulo. Nunca al final del capítulo si hay
     versos mayores.
   - `skeletonUsfmFromSource`: escribir `\v N-M` cuando
     `span.verseTo > span.verse`.
   - `draftSlots(usfm, range): { from: number; to: number; text: string }[]`:
     los spans que intersecan `range`, más filas sueltas para los
     números del rango sin cubrir, ordenadas.
2. `usfmAst.ts`: `extractDraftVerses` devuelve también
   `slots: { from, to, text }[]`, con la estructura de `draftSlots` y el
   texto tomado del mapa AST por `from` cuando existe (si no, del texto
   plano).
3. `draftCache.ts`: `verses: Record<string, string>`, con claves que
   cumplen `^\d+(-\d+)?$`. Las claves numéricas antiguas siguen siendo
   válidas.
4. `ScriptureEditorView.tsx`:
   - `VerseDraft = { from: number; to: number; text: string }`. La clave
     de fila es `slotKey = from === to ? "N" : "N-M"`. `editedVerses`
     pasa a `Set<string>`. `activeVerse` recibe `from`.
   - `placeholderDrafts` y la mezcla caché/remoto (las líneas cerca de
     `setDrafts((prev) => …)` después de `extractDraftVerses`): trabajan
     por `slotKey`. Si el caché tiene otra estructura o textos distintos
     al remoto, se usa la estructura del caché y se marca `dirty` (misma
     regla de hoy).
   - Cabecera de fila (`scripture-editor__verse-head`): la etiqueta
     muestra `10–11`, con `title` `1:10–11`. Acciones, con el `Button`
     de `@/components/ui/button` (`type="button"`, `size="sm"`,
     `variant="ghost"`), deshabilitadas mientras `recreating`:
     - **«Unir con {siguiente}»**, solo si existe la fila siguiente,
       `next.from === cur.to + 1` y ambas filas están dentro de
       `range`. Efecto: una fila `cur.from–next.to` con los textos
       unidos por un espacio (sin perder nada). `title`: «Unir en un
       puente (\v 10-11)».
     - **«Separar»**, solo si `to > from` y la fila está dentro de
       `range`. Efecto: filas `from…to`, el texto en `from` y el resto
       vacío; `announce("Reparte el texto entre los versículos 10–11.")`.
     - Una fila que interseca el rango pero se sale de él: sin
       acciones, con la pista
       `<span className="scripture-editor__hint">Puente con versículos fuera de tu porción</span>`.
   - `save()`: `applyVerseEdits(base, range.chapter, drafts)` con los
     rangos.

**Pruebas** — `npx tsx scripts/verify-usfm-merge.mts`:

- `unir-separar-roundtrip`: sobre un esqueleto 1:9–12, aplicar
  `{10,11,"X"}` da exactamente un `\v 10-11 X`, entre `\v 9` y `\v 12`.
  Aplicar después `{10,10,"X"}` y `{11,11,""}` da `\v 10 X` y `\v 11`
  en su sitio, no al final del capítulo.
- `unir-puente-existente`: `\v 10-11 X` + `{10,12,"X Y"}` sobre
  `\v 12 Y` da `\v 10-12 X Y`.
- `insertar-en-orden`: un verso ausente se inserta en su posición.
- `esqueleto-con-puente-fuente`: una fuente con `\v 10-11` da un
  esqueleto con `\v 10-11` vacío.
- `draft-slots-fuera-de-porcion`: `draftSlots` con rango 11–13 sobre
  `\v 10-11` devuelve la fila `(10,11)`.
- `cache-claves-rango`: `saveDraftCache` + `loadDraftCache` conservan
  `"10-11"` (con un `localStorage` falso en el script).
- Encadenado con el slice 2: una rama A con `\v 10-11` guardada por
  `applyVerseEdits` y fusionada sobre el esqueleto no genera conflicto
  (P2).

También `npm run typecheck` y una prueba manual en `#/lab` (local, sin
DCS): una porción de dos versos, Unir, escribir, Guardar local,
recargar. La fila sigue unida.

**Hecho cuando**

- [ ] Unir y Separar aparecen solo en los casos permitidos, con
      etiquetas en español.
- [ ] Guardar produce una sola línea `\v N-M` y ningún `\v N` ni `\v M`
      suelto en ese capítulo.
- [ ] Recargar conserva el puente (caché).
- [ ] `typecheck` y el script, en verde.

**No hacer en este slice**

- Repartir texto de forma automática al separar.
- Unir filas no contiguas o fuera de la porción.
- Tocar el panel de ayudas más allá de pasar `from` como versículo
  activo.

---

### Slice 5 — isomorphic-git como prueba de transporte (sin tocar Cerrar)

**Objetivo:** que `mergeUsfmBranchesWithGit` use la misma fusión de tres
vías que Cerrar y que el script demuestre que un conflicto de líneas de
Git no es un conflicto de versículo.

**Archivos a tocar**

- `src/domain/usfmGitMerge.ts`
- `scripts/verify-usfm-merge.mts`
- `docs/PLAN_RAMAS_Y_COLISIONES.md` (secciones 5, 9 punto 5 y 12:
  dejar claro que Cerrar **no** usa isomorphic-git, por decisión)

**Pasos concretos**

1. `mergeUsfmBranchesWithGit`: la semántica pasa a
   `mergeUsfmByVerse(oursUsfm, [theirsUsfm], { ancestor: baseUsfm })`
   (ours = tronco, theirs = entrante). Nuevo parámetro opcional
   `scope?: RefRange`, que se pasa tal cual.
2. Devolver `gitLineConflict: boolean` (`true` si `git.merge` lanzó un
   error) en lugar de, o además de, `usedGitMerge`. **Nunca** se lee
   ni se devuelve el archivo del worktree de Git.

**Pruebas** — `npx tsx scripts/verify-usfm-merge.mts`:

- `git-choca-verso-no`: la base es `\c 1\n\p\n\v 1`. Ours añade
  `\v 2 a` al final y theirs añade `\v 3 b` en el mismo punto (strings
  escritos a mano, sin `applyVerseEdits`). Se afirma
  `gitLineConflict === true`, `conflicts = []` y que la salida tiene
  `\v 1`, `\v 2 a` y `\v 3 b` en orden, sin marcadores.
- `git-tres-vias`: el caso `libro-lleno-no-sobrescribe` pasado por
  `mergeUsfmBranchesWithGit` da 1:10 = `A10`.
- El caso existente de porciones disjuntas sigue verde.

**Hecho cuando**

- [ ] Ningún archivo de `src/components` ni de `src/dcs` importa
      `usfmGitMerge.ts` ni `isomorphic-git`.
- [ ] El script prueba que Git choca y la fusión por versículos no.
- [ ] La política dice explícitamente que Cerrar usa Contents API +
      `mergeUsfmByVerse` con ancestro y alcance.

**No hacer en este slice**

- isomorphic-git en el navegador, LightningFS ni clonar desde DCS.
- Cambiar el resultado semántico del slice 2.

---

## Orden de verificación

Local, sin DCS en vivo:

```bash
npm run typecheck
npx tsx scripts/verify-usfm-merge.mts      # → verify-usfm-merge: ok
npx tsx scripts/verify-portion-pr.mts      # nombres w/… y tronco, sin regresiones
npx tsx scripts/verify-book-bootstrap.mts  # esqueleto, ahora con puentes de la fuente
npm run build
```

Revisión estática final:

```bash
rg -n "catch \{\s*$" src/dcs/portionPr.ts          # nada alrededor de la lectura o escritura del tronco
rg -n "usfmGitMerge|isomorphic-git" src/components src/dcs   # vacío
rg -n "<<<<<<<" src/domain                          # solo en aserciones o comentarios
```

La prueba con dos subtareas en una org de prueba (sección 11.3 de la
política) es opcional y posterior. No es parte de la puerta de estos
slices.
