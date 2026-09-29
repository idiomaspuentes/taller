# Plan: conversación por subtarea y avisos (Gateway Tasks)

> Estado: plan. No hay código de la función todavía. Dirección de producto ya acordada; este documento no la reabre.
> Fecha: 2026-09-25 (rev. 2). Código leído: `gateway-tasks@1e3edec` + cambios locales, `idiomas-puentes-lms/packages/dcs-client`, DCS `1.27.2+dcs` (swagger en `idiomas-puentes-docs/docs/lms-platform/dcs-api`).
> Referencias de diseño: [`UI_UX_PRINCIPLES.md`](./UI_UX_PRINCIPLES.md), [`VISUAL_ARCHITECTURE.md`](./VISUAL_ARCHITECTURE.md), [`MODELO.md`](./MODELO.md).
>
> **Cambios de la rev. 2** (sustituyen decisiones de la v1):
> 1. Las acciones propias (Guardar, Cerrar) **no esperan** un aviso de DCS: la app pinta la burbuja de sistema al instante. A la otra persona se le avisa con una **mención `@`** en el comentario, no haciendo que vigile la org.
> 2. El punto de no leído de Mis tareas **no es** el "no leído" de la web de Door43. Es el **último comentario que el usuario abrió en esta app**, guardado en el navegador. Marcar como leído en git.door43.org no lo borra. Abrir un hilo marca solo ese hilo.
> 3. Cuando la versión de Ana reemplaza el versículo de Bob, **también se comenta en la subtarea de Bob** con `@bob` y los dos textos. Su fila sube a "Necesitan tu atención". (En la v1, Bob no se enteraba.)
> 4. `write:notification` **deja de ser requisito**. El cursor local basta para el punto; ampliar el permiso queda como opción para limpiar también la bandeja de Door43 (slice 8), sin bloquear los slices 1–2.
> 5. Sección nueva §8 **UX/UI**, con la extensibilidad como requisito: el chat sirve para cualquier tipo de tarea y mini-app, no solo para porciones de Escritura.

## 0. Resumen en una pantalla

- **El objeto visible es un chat por subtarea** (un issue PM = una conversación). Ramas, fusión por versículo y refs `archivo/…` siguen debajo, invisibles.
- **El chat es un armazón genérico.** Proyecto → fase → tarea → paso → mini-app (solver) los configura el gestor (`workflows.json`, `solvers.json`, `assignments.json`). El hilo es igual para cualquier tipo de tarea. Los mensajes de sistema y las tarjetas de decisión son **eventos tipados** que una mini-app emite. El conflicto de versículo es el primer tipo, no un caso especial de la pantalla.
- **Sin servidor nuevo.** El hilo se pinta con comentarios DCS: los del issue PM (`{pmOrg}/gateway-tasks`) y los del PR de la porción (`{contentOrg}/{repo}`), mezclados en una sola línea de tiempo.
- **Punto de no leído = cursor local por hilo** (`localStorage`): id del último comentario visto en la app. Se detectan comentarios nuevos con `GET /repos/{o}/{r}/issues/comments?since=` (una llamada por repo en cada sondeo), no con la bandeja de Door43.
- **Acciones propias al instante:** Guardar, Cerrar, responder y decidir pintan su burbuja en cuanto la acción termina. Cuando llega el comentario o el commit real de DCS, se reconcilia sin duplicar.
- **La respuesta humana va al issue PM**, nunca al PR (el PR aparece tarde, vive en otro repo y su marcador puede desaparecer).
- **El conflicto se vuelve persistente y llega a las dos personas:** tarjeta de decisión en el hilo de Ana **y** en el de Bob (comentario con `@bob` y los dos textos), etiqueta `pm/estado:conflicto` en ambas subtareas.
- **Quedarme con esta / Volver a la otra** reutilizan el motor existente (`patchTrunkByVerse` + `mergeIntoTrunkWithRetry`), con una guarda: solo se escribe si el versículo del tronco sigue igual que cuando se registró el conflicto. Si no, el botón queda deshabilitado y el motivo se lee **dentro de la tarjeta**.
- **Sin cambio de permisos** para los slices 1–7. `write:notification` solo si más adelante se quiere limpiar también la bandeja de Door43.

---

## 1. Qué ofrece DCS hoy (y qué usa la app)

### 1.1 Endpoints relevantes (DCS 1.27.2, `dcs-api/by-tag/notification.json`, `issue/issues.json`)

| Endpoint | Para qué | ¿Hay helper? | ¿Lo usa el plan? |
|---|---|---|---|
| `GET /repos/{o}/{r}/issues/comments?since&before&page&limit` | **Todos** los comentarios del repo (issues y PRs) actualizados desde una fecha | No | **Sí, base del punto** (slice 1). Una llamada por repo y sondeo |
| `GET /repos/{o}/{r}/issues/{n}/comments?since&before` | Comentarios de un issue **o de un PR** (mismo índice) | Sí: `listIssueComments` (`dcs-client/src/issues.ts`). Sin paginación | Sí, al abrir el hilo |
| `POST /repos/{o}/{r}/issues/{n}/comments` | Comentar | Sí: `createIssueComment`; en la app `commentOnIssue` (`src/dcs/issues.ts`, repo PM) y `commentOnPortionPr` (`src/dcs/portionPr.ts`, repo de contenido) | Sí (respuesta, espejos, mención a Bob) |
| `GET /repos/{o}/{r}/issues/comments/{id}` | Un comentario | No | Opcional |
| `GET /repos/{o}/{r}/issues/{n}/timeline?since&page&limit` | Comentarios + eventos (asignación, etiqueta, cierre) | No | Opcional, ver §6 |
| `GET /repos/{o}/{r}/issues/{n}/subscriptions`, `GET /repos/{o}/{r}/subscribers` | Quién vigila un issue o un repo | No | QA del ruido (§9) |
| `GET /repos/{o}/{r}/commits?sha=` | Historial de una rama (para "Ana guardó") | Sí: `listCommits` (`dcs-client/src/commits.ts`), sin `path` ni `page` | Sí |
| `GET /repos/{o}/{r}/git/blobs/{sha}` | Leer un archivo por SHA de blob | No | Sí, "Volver a la otra" (§7) |
| `GET /notifications/new` | Número de no leídas de **todo** DCS | Sí: `getNewNotificationCount`. No se usa | No como número del badge. Como mucho, disparador barato opcional |
| `GET /notifications?status-types…&subject-type…` | Lista de hilos de aviso de Door43 | No | No en el camino principal. Slice 8 (opcional) |
| `PATCH /notifications/threads/{id}?to-status=read` | Marcar **un** hilo de Door43 como leído | No | Solo slice 8, con `write:notification` |
| `PUT /notifications?all&to-status` | Marcar **todo** como leído | No | **Nunca** |

### 1.2 Forma del hilo de aviso de Door43 (`NotificationThread`)

`{ id, unread, pinned, updated_at, url, repository{full_name,…}, subject{ type, title, url, html_url, latest_comment_url, latest_comment_html_url, state } }`

- Un hilo por usuario y por sujeto (issue o PR), no uno por comentario.
- El estado `unread` **se comparte con la web de Door43**: si el usuario lo lee allí, desaparece. Por eso el plan **no** lo usa como punto de la app (decisión 2).

### 1.3 Qué notifica DCS (lógica de Gitea) y qué no

Notifica a **otros**; al autor de la acción, nunca:
- Comentario nuevo en un issue o PR donde el usuario **participa** (autor, comentó antes, asignado, suscrito).
- **Mención** `@usuario` en un comentario o cuerpo (si el usuario tiene acceso al repo). **Es el canal que usa el plan para avisar a otra persona** (Bob, revisores).
- Cambio de **asignado**, a la persona asignada (cuando la asigna otra persona).
- Revisiones de PR, al autor del PR y a los participantes.
- A **todos los que vigilan el repo** (watchers). Riesgo de ruido en §9.

**No notifica (o no sirve como señal):**
- **Tomar una subtarea uno mismo** (`claimIssue`): quien actúa es quien recibe → nada.
- **Tarea asignada que el usuario no ha abierto**: el estado se comparte con la web y se "consume". → La app lo calcula (slice 7).
- **Conflictos de versículo**: `mergePortionPrIfOpen` los publica en el PR del repo de contenido y el autor es quien pulsa Cerrar. La dueña del texto desplazado no participa en ese PR. → Espejo en el issue PM de cada lado, con mención (slice 5).
- **Guardar** (`saveUsfmOnPortionBranch`, commit `TAS: NEH 1:10–11 (tpl) · #41`): commits, sin avisos. → La app pinta su burbuja al momento (decisión 1) y la deriva de los commits al recargar.
- **Refs de archivo**, **cambios en el marcador de progreso**: sin avisos.
- **Aprobar paso** (`submitPortionPrApproval`): revisión APPROVED en el PR; no avisa a los del issue PM.

### 1.4 Lo que la app usa hoy

- `App.tsx` → `countMyPmNotifications` (`src/dcs/issues.ts`) → `listMyIssues(...).length`. **No lee avisos**: cuenta issues PM abiertos asignados a mí. `AppNav.tsx` lo muestra como `Badge` con el texto "tareas pm abiertas asignadas a ti". Se calcula una vez por `session`/`pmOrg`, sin sondeo.
- `TOKEN_SCOPES` en `src/dcs/auth.ts` incluye `write:issue` (comentar, etiquetar) y `read:notification`, no `write:notification`. `SCOPES_VERSION = 2`. **El plan no lo cambia** en los slices 1–7.

---

## 2. Brecha: lo que hay frente a la metáfora del chat

| Hoy | Chat acordado |
|---|---|
| Mis tareas = árbol fase → tarea → capítulo → fila (`MyTasksView.tsx`, `groupQueue`) | Lista de conversaciones: último mensaje, hora, punto de no leído; sección de atención arriba |
| Fila sin actividad: título, estado y pasos | Fila con "Bob: ¿seguro de 'siervo'? · 10:42" y un punto |
| Badge = nº de issues abiertos asignados | Badge = conversaciones que piden atención (comentarios de otros sin abrir + tareas nuevas + decisiones pendientes) |
| "Comentar" abre un `Input` en la fila y publica en el issue PM; no se ve ningún comentario | Hilo completo con burbujas, respuesta y cita |
| Comentarios de revisión en el PR (`PortionReviewView.tsx` → `commentOnPortionPr`) | Los mismos, dentro del hilo de la subtarea |
| Conflicto: `conflictNotices` (estado de React) → `Alert` "Ocultar"; **desaparece al recargar**. El issue se cierra en el mismo `close()` y sale de la lista | Tarjeta de decisión que sigue en el hilo tras recargar, en el hilo de **las dos** personas |
| Decidir un conflicto = "edita el tronco con el texto elegido" | Botones Quedarme con esta / Volver a la otra |
| Guardar/Cerrar sin rastro visible en la app | Burbujas de sistema al instante: "Guardaste 1:10–11", "Versículos 1:10–11 en el tronco" |
| La pantalla solo entiende porciones USFM | El hilo entiende cualquier subtarea; el tipo de mini-app decide qué eventos aparecen |

---

## 3. Identidad de una conversación

**Clave:** `{pmOrg}/gateway-tasks#{issue}`. Un issue PM (subtarea) = un hilo. Nada más la identifica: ni la rama, ni el PR, ni el libro, ni el tipo de recurso.

**Cabecera (genérica):** título corto de la subtarea (`shortTitle(issue)`, p. ej. `NEH 1:10–11`; si la subtarea no tiene rango bíblico, el título del `WorkOrder`/issue), nombre de la tarea (`teamPhaseLabel`), recurso si existe (`buildSolverLaunchContext(...).resource`), asignado (`issueAssigneeLogins`), paso actual y la mini-app que le toca (`solverAppId` de la tarea o del paso, resuelta con `solvers.json`).

### 3.1 Fuentes de mensajes (adaptadores)

Cada fuente es un adaptador `ThreadSource` que devuelve `ThreadItem[]`. El armazón no sabe de USFM; solo pide las fuentes que la subtarea tiene.

1. **Issue PM** (siempre): `listIssueComments(config, pmOrg, "gateway-tasks", issue.number)`.
2. **PR de la subtarea** (si la tarea usa PR): solo si `parsePortionPrMarker(issue.body)` devuelve marcador → `listIssueComments(config, marker.owner, marker.repo, marker.number)`. Aquí están el conflicto (`tas:verse-conflicts`), "Versículos … fusionados en «…»" y los comentarios de revisión. Sirve igual para TSV/markdown de ayudas (mismo marcador).
3. **Revisiones del PR** (opcional en v1): `GET /repos/{o}/{r}/pulls/{n}/reviews` → "Aprobado en TAS: «Revisión» · subtarea #41".
4. **Commits de la rama de la subtarea** (derivados): `listCommits(config, owner, repo, { sha: marker.head })` filtrando `TAS: … · #{issue}`. Si la rama ya no existe, `archivo/{libro}/{issue}`.
5. **Local** (nuevo): eventos propios recién hechos (Guardar, Cerrar, respuesta, decisión) que todavía no se leyeron de DCS. Vive en memoria y en `sessionStorage` (`tas-chat-pending:{host}:{username}`), con TTL de 10 min.

### 3.2 Orden en una línea de tiempo

- Normalizar cada fuente a `ThreadItem { key, source: "issue"|"pr"|"review"|"commit"|"local", createdAt, author, kind: "humano"|"sistema"|"decision", eventType?, body, payload?, pending? }`.
- Ordenar por `created_at` (no por `updated_at`: editar un comentario no lo mueve). Desempate: `source` (issue < pr < review < commit < local), luego `id`.
- `key = "{source}:{owner}/{repo}:{id}"` para no mezclar ids de repos distintos.
- **Reconciliación de lo local:** un `ThreadItem` local lleva `reconcileKey` (SHA del commit para Guardar, id del comentario devuelto por `POST` para respuesta y eventos, número de issue + `closed_at` para Cerrar). Cuando la fuente real trae un ítem con esa clave, el local se descarta. Si pasa el TTL sin aparecer, se descarta igual (la acción ya se confirmó al terminar; solo falta el reflejo).

### 3.3 Antes de que exista el PR

El PR se crea con `ensurePortionPr` al completar un paso que desbloquea revisión, al Tomar un paso exclusivo/pool o dentro de `close()`. Antes:
- El hilo muestra los comentarios del issue PM, los eventos locales y los commits de la rama `w/…` si existe.
- No se muestra "sin PR" como error. Como mucho, una línea gris "Aún no hay revisión abierta" (solo si la tarea usa PR).
- Cuando aparece el marcador, la siguiente carga añade los comentarios del PR.

### 3.4 Si el marcador del PR desaparece

`resolveVisiblePortionPr` y `closeOwnedPortionPrIfSafe` **borran** el marcador del cuerpo cuando la rama de trabajo ya no existe o no coincide. Reglas:
- La vista del hilo **no** llama a `resolveVisiblePortionPr` (edita el issue). Solo usa `parsePortionPrMarker`.
- Recuperación: cada evento de sistema en el issue (§6.3) guarda `pr: {owner, repo, number}`. Última opción: buscar el PR por el título que genera `ensurePortionPr` (`… (#41)`) o por el cuerpo `Subtarea PM: …/issues/41`.

---

## 4. Quién está "relacionado"

| Rol | Cómo se sabe | ¿DCS avisa solo? | La app debe… |
|---|---|---|---|
| Asignado del issue | `issueAssigneeLogins(issue)` | Sí en comentarios del issue PM | Mostrar el hilo en Mis tareas; punto por cursor local |
| Actor de paso (pares/grupo) | `userHasActiveStepRole` / `getStepRuntime(parseTaskProgressMarker(body))` | Solo si comentó, fue mencionado o es autor del PR | Incluir su hilo (ya entra por `filterProjectIssues("mine")`) |
| Autor del PR | Quien disparó `ensurePortionPr` | Sí en el PR | Nada especial |
| Quien comentó | Autor de cualquier comentario | Sí (participante) | Nada especial |
| Mencionado `@x` | Texto del comentario | Sí, si tiene acceso al repo | Autocompletar solo participantes (§9) |
| Equipo de la tarea (`orgTeamName`) | `userOnTaskTeam` | **No** (y no debe) | No notificar al equipo. Solo ven la cola en "Disponibles" |
| Gestor | `effectiveCanManage(session.canManage, viewMode)` | Solo si participa | Puede abrir cualquier hilo en modo gestor, sin badge salvo que participe |
| **Dueño del texto desplazado** (otra subtarea, p. ej. Bob en #37) | Último commit del tronco en el rango (`trunkMergeCommitMessage`: `Traductor: @bob`, `Subtarea: #37`) | **No** por sí solo | **Comentar en #37 con `@bob` y los dos textos** (slice 5). Su fila sube a "Necesitan tu atención" (etiqueta `pm/estado:conflicto` en #37) |
| Persona recién asignada que no abrió la tarea | Diferencia entre las asignaciones actuales y el registro local | No de forma fiable | Insignia "nueva" (slice 7) |

---

## 5. Modelo de leído / no leído (cursor local)

**Una sola fuente de verdad para el punto: el cursor local.** La bandeja de Door43 no interviene.

**Clave en `localStorage`:** `tas-chat:{host}:{username}:{pmOrg}` →

```ts
{ v: 1,
  seeded: boolean,
  lastPollAt?: string,                        // hora de servidor del último sondeo
  threads: { [issue: number]: { lastReadId: number; at: string } },
  seenIssues: { [issue: number]: string },    // slice 7
  latest: { [issue: number]: { id: number; at: string; author: string; preview: string } } }
```

- **`lastReadId`** = mayor id de comentario (de cualquier fuente del hilo) que el usuario tenía en pantalla al abrir el hilo en esta app.
- Los ids de comentario de Gitea son **globales en la instancia** (una sola tabla), así que un comentario del PR y uno del issue PM se pueden comparar. **Verificar en QA** (§13). Si no se cumpliera, `lastReadId` pasa a ser por fuente (`{ pm, pr }`) sin cambiar el resto.
- **`latest[issue]`** se alimenta con el sondeo: `GET /repos/{pmOrg}/gateway-tasks/issues/comments?since={lastPollAt}` + la misma llamada en cada repo de contenido que tenga PRs de mis subtareas visibles (deduplicado; normalmente 1–2 repos). Cada comentario se mapea a su subtarea por `issue_url` (PM) o por el índice de PR (`buildPrIndex` con `parsePortionPrMarker`). Se ignoran los comentarios **míos**.

**Una fila tiene punto si:** `latest[n].id > threads[n].lastReadId` (hay un comentario de otra persona que no abrí aquí), **o** hay una decisión pendiente para mí (§7) más nueva que `threads[n].at`, **o** es nueva (slice 7). Las acciones propias nunca ponen punto: ya las vi al hacerlas.

**Al abrir el hilo (y solo entonces):**
1. Cargar y pintar los mensajes.
2. Si **todas** las fuentes cargaron: `threads[n] = { lastReadId: max(id visibles), at: ahora }`. Si alguna falló (p. ej. el PR), **no** avanzar el cursor: el usuario no vio todo.
3. Si durante la carga el sondeo trajo un id mayor, no se cubre: el punto vuelve hasta que se vea.

**Qué NO lo marca como leído:** sondear, pintar la lista, expandir un capítulo, pulsar "Actualizar", leer en git.door43.org, abrir otro hilo. **Abrir un hilo marca solo ese hilo; nunca hay "marcar todo".**

**Primera vez en un navegador (siembra):** con `seeded=false`, se leen los comentarios de los últimos 30 días y cada hilo visible queda con `lastReadId = latest[n].id`. Sin avalancha de puntos, a costa de no marcar lo que ya estaba sin leer antes de usar esta versión. Se dice así en la nota de versión.

**Límite que hay que decir claramente (texto para usuarios, §8.9):** "Lo leído se guarda en este navegador. Si abres TAS en otro equipo o en el teléfono, puede que veas el punto en conversaciones que ya leíste aquí, hasta que las abras allí. Marcar como leído en Door43 no quita el punto de TAS."

**Gestor en vista "trabajador":** el cursor es de su cuenta real (la vista no cambia la identidad).

---

## 6. Mensajes de sistema frente a mensajes humanos

### 6.1 Clasificación (función pura `classifyComment(body) → { kind, eventType?, payload? }`)

Todo lo que no es humano se traduce a un **evento tipado** (§6.3), aunque venga de un formato antiguo. Así hay un solo camino de render.

| Evento | Dónde vive | Detección | `eventType` | Render |
|---|---|---|---|---|
| Conflicto al Cerrar | Comentario en el PR con `<!-- tas:verse-conflicts … -->` | `parseVerseConflictsComment(body)` | `verse-conflict` | **Tarjeta de decisión** |
| Versículos en el tronco | Comentario en el PR: "Versículos 1:10–11 de #41 fusionados en «neh/tpl-draft»…" o "…ya estaban en…" | Regex `^Versículos .+ de #\d+ (fusionados\|ya estaban)` | `verses-merged` | Sistema |
| Aprobado | Revisión del PR: "Aprobado en TAS: «…» · subtarea #41" | Prefijo `Aprobado en TAS:` | `step-approved` | Sistema |
| Guardar | Commit `TAS: NEH 1:10–11 (tpl) · #41` | Mensaje del commit | `saved` | Sistema compacto, agrupado ("Ana guardó 3 veces") |
| Eventos nuevos | Comentario con `<!-- tas:chat-event … -->` | `parseChatEvent` | el que diga el payload | Según el registro (§6.4) |
| Cierre / asignación | Eventos del issue | `timeline` (opcional) o `closed_at` / `assignees` | `closed`, `assigned` | Sistema |
| Cualquier otro comentario | Issue PM o PR | Sin marcador ni prefijo | — | **Humano** |

**Render de humanos:** markdown mínimo (citas `>`, negrita, enlaces). **Antes de renderizar, quitar todo comentario HTML `<!-- … -->`** y las líneas vacías que queden. Nunca `dangerouslySetInnerHTML` con el cuerpo crudo.

### 6.2 Respuesta humana: **issue PM**, siempre

- Existe desde que se publica la subtarea, mucho antes que el PR.
- Está en la org PM, donde el trabajador ya tiene permiso de issues; el repo de contenido puede no dar escritura.
- No depende del marcador del PR, que se puede borrar o recrear.
- `commentOnIssue` ya existe.

Los comentarios que ya se hacen en el PR (`PortionReviewView.tsx`) **se leen** en el hilo, pero el cuadro de respuesta nunca publica en el PR.

### 6.3 Formato de evento: `tas:chat-event` (genérico)

Mismo esquema que `verseConflicts.ts` (base64url porque un texto puede contener `-->`). Mover `encodeBase64Url`/`decodeBase64Url` a `src/domain/markerCodec.ts`.

```text
{summary visible en texto plano, con @menciones si toca}

<!-- tas:chat-event BASE64URL({
  schema: "tas-chat-event-1",
  type: "verse-conflict" | "verse-choice" | …,   // abierto: lo define la mini-app
  emitter: "tas" | "{solverAppId}",
  issue: 41,
  summary: "…",                                   // igual que el texto visible
  mentions?: ["bob"],
  decision?: { id, options: [{ id, label }], state: "pendiente" | "resuelta", chosen?, by? },
  data: { … }                                     // propio del tipo
}) -->
```

- **`summary` siempre presente** y es también el texto visible del comentario. Quien lo lea en la web de Door43, en el correo, o en una versión de TAS que no conozca el `type`, ve una frase comprensible.
- **`type` es una cadena abierta.** TAS no valida la lista; valida la forma.
- Tipos que define este plan (emisor `tas`, mini-app de Escritura):
  - `verse-conflict` — espejo del conflicto. `data`: `pr {owner, repo, number}`, `commentUrl`, `bookRef`, `ranges[] {chapter, from, to, kept}`, `otherIssue?`, `otherLogin?`, `side: "entrante" | "desplazado"` (hilo de Ana o de Bob), `texts: { entrante, tronco }` (normalizados, solo para mostrar). Se publica en el issue de Ana **y** en el de Bob (§7.3).
  - `verse-choice` — tras decidir. `data`: `range`, `choice: "entrante" | "tronco"`, `source` (`archivo/neh/41`, `blob:{sha}`), `bookRef`, `commit`, `by`. Se publica en los dos hilos.

### 6.4 Registro de tipos de evento

`src/domain/chatEvents/registry.ts`:

```ts
registerChatEventType({
  type: "verse-conflict",
  render: "decision",                 // "system" | "decision"
  title(e): string,                   // "El versículo 1:10 lo escribieron dos personas"
  body?(e): ReactNode,                // p. ej. los dos textos lado a lado
  options?(e, ctx): DecisionOption[], // botones, cada uno con blockReason(ctx) → string | null
  run?(optionId, e, ctx): Promise<ChatEvent>, // escribe y devuelve el evento de resultado
});
```

- **Tipo desconocido** → línea de sistema con `summary`, sin botones. Nunca se rompe el hilo.
- El código que **escribe** vive con la mini-app que registró el tipo (el de `verse-conflict` junto a `src/dcs/portionPr.ts`), no en `ConversationView`.
- Una futura mini-app de notas (TN) puede registrar, por ejemplo, `note-quote-mismatch` ("La cita ya no aparece en el versículo") con opciones "Actualizar cita" / "Mantener". Aparece en el mismo hilo, con la misma tarjeta, **sin pantalla nueva**.

---

## 7. Decisión de conflicto sobre el motor existente

### 7.1 Qué hay en el payload `tas-verse-conflicts-1`

`{ issue, bookRef, trunkSha?, conflicts: [{ chapter, from, to, kind: "texto"|"estructura", kept: "ultimo"|"tronco", candidates: [{ source: "tronco"|"entrante", sideIndex, from, to, text }] }] }`

- `kept: "ultimo"` → quedó el texto de esta subtarea (`entrante`) y el del tronco se desplazó. `kept: "tronco"` → al revés.
- `trunkSha` es el **SHA del blob** del archivo del tronco leído antes de escribir, no un SHA de commit.
- `text` está **normalizado** (`normalizeVerseText`). **No sirve para escribir.**
- **No** incluye `workSha` ni `archiveRef`. `archiveRefName(book, issue)` es determinista.
- **No** dice quién escribió el texto del tronco. Se deduce del último commit del tronco que tocó el rango (`listCommits(… { sha: bookRef })` + parser puro de `trunkMergeCommitMessage`).

### 7.2 Por qué se puede reutilizar sin motor nuevo

`patchTrunkByVerse(trunk, [sideText], { ancestor: trunk, scope: {chapter, from, to} })`:
- Con `ancestor = tronco actual`, la fusión a tres bandas toma el lado **solo dentro del rango**. El resto conserva los bytes del tronco.
- `mergeIntoTrunkWithRetry({read, write, isShaConflict}, compute)` aporta el reintento por SHA (409/422).
- `readRepoFile` / `writeRepoFile` aceptan `branch` = nombre o SHA.

Extraer, sin cambiar Cerrar, un helper en `src/dcs/portionPr.ts`:

```ts
writeTrunkVerseChoice({ session, owner, repo, filepath, bookRef, sourceText, scope, expectedTrunkText, message })
```

Lectura → **guarda** → `patchTrunkByVerse` → escritura con reintento.

### 7.3 Las dos acciones y los dos hilos

La decisión es **una** (`decision.id` = `{issueEntrante}:{chapter}:{from}-{to}:{commentId del payload}`) y se ve en dos hilos:

| Hilo | Quién lo ve | Texto de la tarjeta | Botón principal | Botón secundario |
|---|---|---|---|---|
| Ana (#41, `side: "entrante"`) | Ana y gestores | "El versículo 1:10 también lo escribió @bob (#37). Quedó tu versión." | **Quedarme con esta** | Volver a la otra |
| Bob (#37, `side: "desplazado"`) | Bob y gestores | "@ana cerró 1:10 y su versión reemplazó la tuya." | **Mantener la de @ana** | Volver a la mía |

Los dos lados escriben con el mismo helper y la misma guarda (§7.4). Quien decide primero gana; la tarjeta del otro lado pasa a "Resuelto por @x" en el siguiente sondeo o al abrir, y sus botones desaparecen.

| Caso | Mantener lo que está en el tronco | Volver al texto desplazado |
|---|---|---|
| `kept: "ultimo"` (ganó Ana) | No escribe; publica `verse-choice` "confirmada" | Fuente = tronco antes de la escritura de Ana: `GET git/blobs/{payload.trunkSha}`. Alternativa: `archivo/{libro}/{otherIssue}` |
| `kept: "tronco"` (ganó el tronco) | No escribe; publica `verse-choice` | Fuente = trabajo de Ana: `archivo/{libro}/{issue}` (`getBranchSha` → `readRepoFile({branch: sha})`). Alternativa: `workSha` leído del comentario "fusionados" o del commit |

Después de escribir: publicar `verse-choice` en **los dos** issues PM (Ana y Bob), con mención a la otra persona. Si todos los rangos del último payload tienen elección, quitar `pm/estado:conflicto` de ambas subtareas. Mensaje del commit: `trunkChoiceCommitMessage` en `src/domain/portionPr.ts` (p. ej. `TAS: elegir versión de 1:10 en #41 (@ana) — quedó #37 (@bob)`, con `Archivo:` y `Fuente:`).

### 7.4 Guarda obligatoria antes de escribir

Leer el tronco actual → `verseSlotsOf(trunk)` en el rango → comparar con el `text` del candidato que **quedó** (`kept`), ambos normalizados.
- Coinciden → se puede escribir.
- No coinciden → alguien cambió ese versículo después. **"Volver a la otra" / "Volver a la mía" deshabilitado**, con el motivo escrito **dentro de la tarjeta**: "El versículo 1:10 cambió después del conflicto. Ábrelo en el editor." (con enlace a la mini-app en ese versículo). Nunca pisar a una tercera persona. "Quedarme con esta" / "Mantener" tampoco escribe en ese caso; solo cierra la tarjeta como "ya no aplica".
- La guarda se evalúa al pintar la tarjeta **y** otra vez justo antes de escribir.

### 7.5 Casos límite

| Caso | Comportamiento |
|---|---|
| Las dos subtareas ya cerradas | Normal: la decisión escribe en el tronco (`bookRef`). Que el issue esté cerrado no bloquea |
| Falta la ref de archivo propia | "Volver…" deshabilitado: "Falta el archivo de tu trabajo. Vuelve a pulsar Cerrar para crearlo." Si `kept: "ultimo"` no hace falta |
| Payload sin `trunkSha` | "Volver a la otra" solo con `archivo/{libro}/{otherIssue}`; si no se deduce `otherIssue`, deshabilitado con el motivo |
| No se deduce quién es Bob | No hay espejo en otro hilo; la tarjeta de Ana dice "otra subtarea" en lugar del nombre. Se anota en el payload `otherIssue: null` |
| Bob no tiene acceso al repo PM | La mención no le avisa (Gitea exige acceso). Su fila sigue marcada por la etiqueta cuando entre. Se registra en QA |
| El usuario no es el asignado de ese lado | Botones solo para el asignado de ese issue o `effectiveCanManage`. El resto ve la tarjeta sin botones y la línea "Solo @ana o un gestor puede decidir" |
| Dos conflictos en una porción | Una tarjeta por rango. Escrituras secuenciales, UI bloqueada durante la escritura, guarda y reintento por rango |
| Varios payloads (Cerrar pulsado más de una vez) | Manda el último del issue; los anteriores son historial sin botones |
| `payload.issue === 0` | Solo aceptar `payload.issue === issue.number` para mostrar botones |
| `bookRef` ya no existe | Deshabilitado con el motivo |
| Recurso no USFM (TSV) | No hay `verse-conflict` (Cerrar usa `mergePull`). Otras mini-apps pueden registrar sus propios tipos |

**Veredicto para el slice 6:** implementable sin motor nuevo, con la guarda de §7.4 y deshabilitando por caso cuando falte la fuente, siempre con el motivo visible en la tarjeta.

---

## 8. UX/UI (experto)

Escrito desde las reglas de `UI_UX_PRINCIPLES.md` (divulgación progresiva, una acción principal por sección, reconocimiento antes que memoria, contraer controles y no contenido) y los presupuestos de `VISUAL_ARCHITECTURE.md` (≤12 objetivos interactivos en el estado por defecto, acción principal visible a 1280×800, scroll en `.app-main`, sin cajas `max-h-*` anidadas).

### 8.1 Modelo mental: una conversación por subtarea; la lista es Mis tareas

- El trabajador no aprende un producto nuevo. **Mis tareas ya es su bandeja**; ahora cada fila es también una conversación. No hay pestaña "Chat" ni "Mensajes" aparte.
- Una subtarea = un hilo, siempre el mismo, pase lo que pase debajo (PR creado, recreado, rama archivada). La persona piensa "la porción 1:10–11 de TPL", no "el PR 7 del repo X".
- La jerarquía del gestor (proyecto → fase → tarea → capítulo) sigue siendo la estructura del árbol. El chat **no la aplana ni la reordena**; añade encima una sola sección de atención.

### 8.2 La lista: "Necesitan tu atención" y el resto

```
┌ Mis tareas ───────────────────────────────────────────────┐
│ NECESITAN TU ATENCIÓN                                3    │
│ ● NEH 1:10–11 · TPL     Decidir versículo 1:10    10:42 › │
│ ● NEH 2:1–4 · TPS       Bob: ¿seguro de "siervo"?  ayer › │
│ ● NEH 3:1–5 · Notas     Nueva tarea                        › │
├───────────────────────────────────────────────────────────┤
│ FASE 1 · TRADUCIR TPL                                     │
│ ▾ Capítulo 1                                              │
│   NEH 1:1–3 · TPL       Guardaste 1:3            09:15 ›  │
│   …                                                       │
└───────────────────────────────────────────────────────────┘
```

- **Sección de atención** arriba, eyebrow en versalitas (`text-xs font-semibold uppercase tracking-wide`), mismo patrón que "Revisiones". Entra una fila si tiene punto (comentario de otra persona sin abrir aquí), decisión pendiente para mí, o es nueva. Orden: la más reciente primero. **Si está vacía, no se pinta** (ni título ni "no hay nada").
- **El árbol de abajo no cambia de orden.** Cada fila solo gana punto, última línea y hora. Una fila en atención **también** sigue en su sitio del árbol (reconocimiento: la encuentran donde siempre).
- **Qué muestra una fila, en este orden:** punto (si toca) · porción o título corto · recurso/tarea · última línea (autor + texto, una línea, truncada; o el `summary` del último evento) · hora relativa (`Intl.RelativeTimeFormat("es")`: "hace 5 min", "ayer", "12 sept") · chevron. Insignias solo cuando aportan: "nueva", "decidir".
- **Qué no muestra nunca:** nombres de rama (`tas/…`, `w/…`), SHAs, refs `archivo/…`, marcadores `<!-- … -->` ni base64, números de PR, etiquetas `pm/…` en crudo, rutas de archivo. Si el último mensaje es un evento, la línea es su `summary` en lenguaje llano ("Versículos 1:10–11 en el tronco"), no el comentario técnico.
- El número de subtarea (`#41`) no va en la fila. Está en la cabecera del hilo, dentro de "Más → Abrir en Door43".
- **Toda la fila es el objetivo táctil** (mín. 44 px de alto) y lleva al hilo. Las acciones de fila actuales (Tomar, Aprobar, Cerrar, Resolver) pasan a la cabecera del hilo (§8.5) para no competir con la navegación; en escritorio se puede mantener un único botón de fila para la acción del paso actual, en `outline`.

### 8.3 El hilo: burbujas humanas, líneas de sistema, tarjetas de decisión

```
┌ ← Mis tareas   NEH 1:10–11 · Traducir TPL        [Abrir Escritura] ⋯ ┐
│ Paso: Revisión en pares · @bob                                        │
├───────────────────────────────────────────────────────────────────────┤
│                 ─ Guardaste 1:10–11 · 09:12 ─                         │
│ (B) Bob  10:02                                                        │
│  ┌──────────────────────────────┐                                     │
│  │ ¿Seguro de "siervo" en 1:10? │                                     │
│  └──────────────────────────────┘                                     │
│                                  ┌──────────────────────────┐        │
│                                  │ Sí, sigue a la ULT.       │  10:05 │
│                                  └──────────────────────────┘        │
│                 ─ Versículos 1:10–11 en el tronco · 10:40 ─           │
│ ┌ DECIDIR ────────────────────────────────────────────────────────┐   │
│ │ El versículo 1:10 también lo escribió @bob (#37)                │   │
│ │ ┌ Tu versión · en el tronco ┐   ┌ Versión de @bob ──────────┐   │   │
│ │ │ …                         │   │ …                          │   │   │
│ │ └───────────────────────────┘   └────────────────────────────┘   │   │
│ │ [ Quedarme con esta ]   Volver a la otra                        │   │
│ │ El versículo 1:10 cambió después del conflicto. Ábrelo en el    │   │
│ │ editor.  (solo si está bloqueado)                               │   │
│ └─────────────────────────────────────────────────────────────────┘   │
├───────────────────────────────────────────────────────────────────────┤
│ [ Escribe un mensaje…                              ] [Citar] [Enviar] │
└───────────────────────────────────────────────────────────────────────┘
```

- **Humanas:** las de otras personas a la izquierda con iniciales (avatar) y nombre solo cuando cambia el autor; las mías a la derecha, sin nombre. Hora pequeña. Fondo papel para otros, teal muy suave para las mías (nunca teal fuerte: el teal es para la acción principal).
- **Sistema:** una línea centrada, pequeña, en `text-muted-foreground`, sin avatar ni burbuja. Los Guardar seguidos se agrupan ("Guardaste 3 veces · 09:12–09:40"). Las acciones propias aparecen **en cuanto terminan** (fuente local) y se reconcilian después sin saltos.
- **Tarjeta de decisión:** ancho completo del hilo (no es la voz de nadie), borde y eyebrow "DECIDIR". Contiene: título en una frase, los dos textos lado a lado (apilados en teléfono) con etiqueta de autor y cuál está "en el tronco", **una** acción principal (`default`) y la alternativa en `outline`. La cita al versículo y "Abrir en el editor" son enlaces discretos.
  - **Deshabilitado con motivo dentro de la tarjeta**, en una línea de texto bajo los botones, no en un `title` (no existe en táctil) ni en un `Alert` en otra parte de la página.
  - Antes de escribir, confirmación **dentro de la tarjeta** ("¿Volver a la versión de @bob en 1:10? Se escribe en el tronco.") con Confirmar/Cancelar; sin diálogo modal.
  - Durante la escritura, la tarjeta muestra "Guardando en el tronco…" y bloquea sus botones; el resto del hilo sigue usable.
  - **Resuelta:** la tarjeta se contrae a "Resuelto por @ana: quedó la versión de @bob · 11:03" con "Ver textos" para desplegar. Se contraen los controles, no el contenido.
- **Accesibilidad:** la lista de mensajes es `role="log"` con `aria-live="polite"`; el punto tiene texto accesible ("sin leer"); `<time datetime>` en cada hora; el color nunca es la única señal (la tarjeta tiene eyebrow y borde, el punto va con la insignia en atención).
- Al abrir, el hilo se sitúa en el **primer mensaje no leído** (separador "Nuevos") o al final si no hay.

### 8.4 Cuadro de respuesta: responder y citar

- **Una línea de texto que crece** hasta 6 líneas; después, scroll interno solo del cuadro. Placeholder "Escribe un mensaje…".
- **Enviar** es la acción principal de esa sección. Escritorio: Enter envía, Mayús+Enter salto de línea. Teléfono: Enter es salto de línea y se envía con el botón (el teclado virtual no tiene Mayús cómodo).
- **Citar**: en escritorio, botón `ghost` "Citar" que abre la lista de lo citable de esta subtarea; además, cada tarjeta y cada línea de sistema con referencia tiene "Citar" al pasar/pulsar. Inserta `> **NEH 1:10** texto` al principio del borrador. Lo citable lo aporta la mini-app (versículo para Escritura; fila de nota para TN; párrafo para TW). v1 implementa versículo; el resto usa el mismo contrato.
- **Menciones:** `@` abre un menú con los participantes (asignado, actores de paso, quienes comentaron). Nada de equipos.
- **Envío optimista:** la burbuja aparece al instante con "Enviando…"; si falla, "No se envió · Reintentar" en la propia burbuja. El borrador se guarda en `sessionStorage` por hilo para sobrevivir a una recarga o a un nuevo inicio de sesión.
- **Objetivos táctiles** ≥44×44 px; en teléfono el cuadro se pega al borde inferior respetando `env(safe-area-inset-bottom)` y el teclado.
- Sin adjuntos, sin reacciones, sin "escribiendo…".

### 8.5 La mini-app se abre desde el hilo, no es otro producto

- La cabecera del hilo lleva **un** botón principal: **"Abrir {nombre de la mini-app}"** ("Abrir Escritura", "Abrir Notas", "Abrir Familiarizar"), resuelto con el `solverAppId` del paso actual o de la tarea (`solvers.json`) y lanzado con `buildSolverLaunchContext`. Si el paso actual no tiene mini-app, no hay botón (no se pinta deshabilitado).
- **Paso actual y su acción** (Tomar / Aprobar / Cerrar) en la segunda línea de la cabecera, en `outline`. La casilla de checklist y los asientos siguen la política configurada por el gestor (`claimMode`, `minAssignees`…); el hilo solo la refleja.
- "Más" (`⋯`) agrupa lo raro: "Abrir en Door43", "Ver revisión (diff)", "Copiar enlace". Presupuesto: cabecera ≤5 objetivos.
- Al volver de la mini-app (Guardar, Listo para revisión), el hilo ya muestra la línea de sistema correspondiente (fuente local). La persona entiende que la mini-app **trabaja dentro** de la conversación.
- Las tarjetas de decisión enlazan a la mini-app en el punto exacto ("Abrir en el editor" → Escritura en 1:10).

### 8.6 Extensibilidad (requisito)

La app es un armazón que el gestor configura. El chat tiene que respetar eso: **ningún componente del hilo sabe qué es un versículo**.

**Qué controla el gestor (y el chat solo lee):**

| Estructura | Dónde se configura | Efecto en el chat |
|---|---|---|
| Proyecto, libros o tema (`Project.kind`, `books[]`) | Proyectos | Título y agrupación del árbol |
| Fases, tareas, pasos (`WorkflowTemplate` → snapshot) | Plantillas / Fases y tareas | Nombre de tarea y paso en fila y cabecera |
| Mini-app por tarea o paso (`solverAppId`, `solvers.json`) | Plantillas | Botón "Abrir …", qué es citable, qué tipos de evento pueden aparecer |
| Quién toma cada paso (`claimMode`, exclusiones, aprobación) | Plantillas | Acción del paso en la cabecera, quién puede decidir una tarjeta |
| Equipos y asignación (`DcsTeam`, subtareas) | Organización / Asignar | Qué conversaciones ve cada trabajador |

- **No hay ajustes de chat por trabajador ni por conversación.** No se añade configuración nueva al gestor en v1. Si algún día hace falta (p. ej. no mencionar al autor desplazado en cierto flujo), será un campo opcional de la tarea en la plantilla, nunca un interruptor en el hilo.
- **El trabajador ve solo sus conversaciones** (asignado, actor de paso, participante). "Disponibles" sigue siendo la cola del equipo, en solo lectura y sin punto.

**Contratos que hacen el chat genérico:**
1. **Sujeto** (`ConversationSubject`): clave del issue PM, título, tarea, paso, mini-app, asignados y la lista de fuentes que tiene (`ThreadSource[]`). Una tarea sin PR (proyecto temático, artículo, familiarizar) tiene solo la fuente del issue PM y funciona igual.
2. **Fuentes** (§3.1): adaptadores intercambiables. Añadir una fuente nueva (p. ej. la rama de una mini-app de audio en el futuro) no toca la vista.
3. **Eventos tipados** (§6.3–6.4): `type` abierto, `summary` obligatorio, `decision` opcional con opciones y motivos de bloqueo. La mini-app registra el tipo, su render y su acción. `verse-conflict` es el primero; `note-quote-mismatch` u otro llegan sin pantalla nueva.
4. **Citables**: la mini-app declara qué se puede citar y cómo se escribe la cita.

**Pruebas de diseño para no caer en "chat de porciones":** revisar cada pantalla con tres subtareas imaginarias: una porción TPL, una nota TN de un capítulo y una tarea de un proyecto temático sin rango bíblico. Si alguna muestra un hueco, un "Versículo: —" o un botón que no aplica, el diseño está atado a Escritura.

### 8.7 Estados: vacío, carga, error, sin sesión. Sin controles muertos

| Estado | Lista (Mis tareas) | Hilo |
|---|---|---|
| Vacío | "No tienes tareas asignadas. Cuando te asignen una, aparecerá aquí." + enlace a Disponibles si el equipo permite tomar | "Aún no hay mensajes. Escribe para hablar con quien revisa esta tarea." El cuadro de respuesta está activo |
| Cargando | Filas esqueleto (3–5), sin spinner que bloquee; el árbol llega y luego se añaden puntos | Burbujas esqueleto; cabecera ya visible con lo que se sabe de la fila; cuadro de respuesta visible pero sin enviar hasta cargar (botón deshabilitado con "Cargando conversación…") |
| Error parcial | — | Una línea dentro del hilo donde irían esos mensajes: "No se pudieron cargar los comentarios de revisión · Reintentar". El cursor no avanza |
| Error total | Aviso discreto en la cabecera de la sección: "Sin conexión con Door43 · Reintentar"; lo ya cargado sigue visible | "No se pudo abrir la conversación · Reintentar · Abrir en Door43" |
| Sondeo fallando | Indicador pequeño "Sin conexión con Door43" junto al badge; reintentos 60 → 120 → 300 s; sin alerta roja | Igual |
| Sin sesión / token caducado | La app ya exige sesión; sin sondeo ni badge | El borrador se guarda; al volver a entrar, el hilo se reabre con el texto |
| Sin permiso | Las filas que no le tocan no existen para él | Sin botones de decisión; línea "Solo @ana o un gestor puede decidir" |

**Regla:** un control que nunca puede funcionar para esta persona **no se pinta**; uno que ahora no puede funcionar se pinta deshabilitado **con el motivo visible a su lado**. Nunca un botón que no hace nada.

### 8.8 Encaje en el marco actual

- **Badge:** el número pasa a colgar del enlace **"Mis tareas"** de `AppNav` (no un icono de campana aparte). Texto accesible: "N conversaciones necesitan tu atención". Desaparece "tareas pm abiertas asignadas a ti".
- **Sin FAB nuevo.** El control de rol de los gestores (`RoleModeToggle`, hoy en `AppNav`) **se queda donde está**; el chat no añade ningún botón flotante. El cuadro de respuesta es lo único pegado abajo, y solo dentro de la ruta del hilo.
- **Rutas:** `#/mis-tareas` (lista) y `#/mis-tareas/{issue}` (hilo). Escritorio ≥1280 px: dos paneles (lista estrecha a la izquierda, hilo a la derecha), misma ruta. Por debajo: el hilo ocupa la pantalla con "← Mis tareas".
- **Gestor en modo gestor:** llega a un hilo desde Asignar ("Ver conversación" en el menú de la fila) o por enlace; puede leer y decidir; sin badge salvo que participe.
- **Tokens:** papel, tinta, teal (`tokens.css`); clases `.hub-*` para la lista y `.chat-*` nuevas para el hilo en `src/styles/components.css`.
- **Presupuesto de densidad del hilo** (estado por defecto): volver, abrir mini-app, acción de paso, más, cuadro, citar, enviar = 7; cada tarjeta pendiente suma 2. Debe quedar ≤12 con una tarjeta.

### 8.9 Textos (español)

- Punto: "sin leer". Insignias: "nueva", "decidir".
- Límite del cursor (en "¿Cómo funciona?" de Mis tareas y en la nota de versión): "Lo leído se guarda en este navegador. En otro equipo puede que veas el punto en conversaciones que ya leíste aquí, hasta que las abras allí. Marcar como leído en Door43 no quita el punto de TAS."
- Nunca "PR", "rama", "merge", "commit", "tronco" en la lista. En la tarjeta, "tronco" solo como etiqueta "en el tronco" con `title`/ayuda "la versión compartida del libro". (Si se prefiere, "versión compartida" en lugar de "tronco": decidir en QA con usuarios.)

---

## 9. Privacidad y ruido

- **Nunca notificar a la org ni al equipo.** Las menciones solo autocompletan participantes. La mención automática a Bob es la única que añade la app, y va a la persona cuyo texto se reemplazó.
- **Visibilidad del hilo igual que la cola actual:** un trabajador abre un hilo si es asignado, actor de paso, participante o si la fila le aparece en "Disponibles" (solo lectura, sin punto). Bob ve el hilo de Ana (#41) **solo por el enlace** del comentario en su propia subtarea, en solo lectura salvo la tarjeta de su lado. En modo gestor, cualquier hilo. DCS deja leer todo el repo PM → **la app filtra**.
- **Comentarios de repos ajenos:** el sondeo solo pide `gateway-tasks` de la org PM y los repos de contenido de mis PRs visibles. Nada más cuenta.
- **Riesgo de watchers:** si DCS hace que los miembros vigilen automáticamente los repos nuevos (`AUTO_WATCH_NEW_REPOS`), cada comentario en `gateway-tasks` avisa a todos por campana y correo de Door43. El punto de TAS no se ve afectado (es local y filtrado). Verificar en QA con `GET /repos/{pmOrg}/gateway-tasks/subscribers` y documentarlo a gestores.
- **Guardar no genera comentarios**: se deriva de los commits y, al instante, de la fuente local.

---

## 10. No objetivos

- No es un clon de WhatsApp: ni voz, ni estados, ni adjuntos, ni reacciones, ni "escribiendo…", ni confirmaciones de lectura por persona.
- **Sin push en el primer camino** (ni Service Worker ni Web Push). Sondeo con pestaña visible.
- **Sin servidor de chat nuevo**, sin websockets, sin base de datos propia.
- Sin sincronizar lo leído entre navegadores (ni en el cuerpo del issue ni en un repo).
- Sin configuración de chat por trabajador o por conversación.
- Sin publicación tronco → rama por defecto. Sin isomorphic-git ni fusión Git en el navegador.
- No se rediseña Cerrar (`mergePortionPrIfOpen`), ni la ref de archivo, ni el formato `tas:verse-conflicts`.
- No se toca la jerarquía de Mis tareas más allá de la sección "Necesitan tu atención".

---

## 11. Pasos ejecutables (slices)

Convenciones para todos:
- **Pruebas:** autopruebas puras en `scripts/verify-conversation.mts` (estilo `scripts/verify-portion-pr.mts`: `assert` y `npx tsx`), script `verify:conversation` en `package.json`. `npm run typecheck` y `npm run build`. Pruebas manuales solo contra una org de prueba (`*-test`, `*-sandbox`, como `isProtectedContentOrg`). **Nunca escribir en `es-419_gl`.**
- **Helpers DCS nuevos en la app** (`src/dcs/*.ts` con `request` de `@ip-lms/dcs-client`). No tocar el paquete en v1 (se consume desde `dist/`).
- Textos de UI en español. Cada slice pasa el checklist de `UI_UX_PRINCIPLES.md` y los presupuestos de §8.8.
- **Genérico por defecto:** ningún archivo de `src/components/Conversation*` ni `src/domain/conversation*` importa nada de USFM. Lo específico de Escritura va en el registro de eventos y en `src/dcs/portionPr.ts`.

### Slice 1 — Cursor local de lectura y badge real

- **Objetivo:** el badge cuenta conversaciones con comentarios de otras personas que no abrí en esta app. Sin UI de chat. Sin cambio de permisos.
- **Archivos:**
  - nuevo `src/dcs/comments.ts`: `listRepoComments(session, owner, repo, { since, maxPages })` → `GET /repos/{o}/{r}/issues/comments` con `page`/`limit=50` y tope.
  - nuevo `src/domain/readCursor.ts` (puro + `localStorage`): clave `tas-chat:{host}:{username}:{pmOrg}`, `loadCursor`, `saveCursor`, `recordLatest(comments, me, mapToIssue)`, `markThreadRead(issue, maxId)`, `seedIfEmpty(latest)`, `hasUnread(issue)`. JSON corrupto → reiniciar sin romper.
  - nuevo `src/domain/notificationMap.ts` (puro): `issueNumberFromUrl(url)`, `buildPrIndex(issues)` con `parsePortionPrMarker`, `mapCommentToIssue(comment, { pmOrg, prIndex })`.
  - `src/App.tsx`: sondeo cada 60 s con pestaña visible (pausa con `document.visibilityState`), `since = lastPollAt`; repos = `{pmOrg}/gateway-tasks` + repos de contenido de mis PRs visibles. Sustituir `countMyPmNotifications`.
  - `src/components/AppNav.tsx`: badge en el enlace "Mis tareas", texto "conversaciones necesitan tu atención".
  - `src/dcs/issues.ts`: borrar `countMyPmNotifications` si no queda uso.
- **Al terminar:** un comentario de otra persona en una subtarea mía sube el badge en ≤60 s. Leerlo en git.door43.org **no** lo baja. Mis propios comentarios no lo suben. Primera carga: sin avalancha (siembra).
- **Pruebas:** autopruebas de `issueNumberFromUrl` (issue, pull, host distinto), mapeo por PR, comentario propio ignorado, siembra, `markThreadRead` que solo toca un hilo, JSON corrupto. Manual: cuentas A y B de prueba; B comenta en un issue de A; A lo marca leído en Door43 y el badge sigue.
- **Hecho cuando:** badge correcto, sin ninguna llamada a `/notifications` de escritura, `SCOPES_VERSION` sin cambios, typecheck/build/verify en verde.
- **No hacer:** UI de hilo, cambios en Mis tareas, usar `unread` de Door43.

### Slice 2 — Filas de Mis tareas con punto, hora y atención

- **Objetivo:** cada fila muestra punto, última línea y hora; sección "Necesitan tu atención" arriba (§8.2).
- **Archivos:** `src/components/MyTasksView.tsx` (`QueueRow`: punto, última línea, hora; sección nueva antes de `hub-queue`, oculta si está vacía); nuevo `src/domain/attention.ts` (puro: `attentionRank(issue, cursor, local)`, `formatRelativeEs(date, now)`, `rowPreview(latest)` que nunca devuelve marcadores ni base64); `src/styles/components.css` (`hub-queue-item__dot`, `__preview`, `__time`).
- **Al terminar:** filas con punto arriba, más reciente primero; el árbol sigue igual y la fila sigue también en su sitio. La última línea sale de `cursor.latest` (sin pedir comentarios por fila).
- **Pruebas:** orden, tiempo relativo ("hace 5 min", "ayer", fecha), `rowPreview` con un comentario de conflicto real (sin `<!--`, sin base64), fila de una tarea sin rango bíblico (título del issue). Manual: comentar desde B y ver el punto en A.
- **Hecho cuando:** se actualiza sin recargar; con 0 filas en atención no hay sección; toda la fila es táctil (≥44 px).
- **No hacer:** marcar como leído, abrir hilos, peticiones por fila.

### Slice 3 — Hilo genérico: línea de tiempo, eventos tipados, marcar leído local

- **Objetivo:** abrir una subtarea como conversación, para cualquier tipo de tarea.
- **Archivos:**
  - `src/router.tsx`: `{ name: "conversacion"; issue: number }` ↔ `#/mis-tareas/{n}`.
  - nuevo `src/components/ConversationView.tsx`: cabecera genérica (§8.5: título, tarea, paso, "Abrir {mini-app}" desde `solverAppId`, "Más"), burbujas humanas, líneas de sistema, hueco para tarjetas. Dos paneles ≥1280 px.
  - nuevo `src/domain/conversation.ts` (puro): `ConversationSubject`, `ThreadItem`, `classifyComment`, `stripHtmlComments`, `mergeTimeline`, agrupar Guardar.
  - nuevo `src/domain/chatEvents/registry.ts` (puro): `registerChatEventType`, `resolveChatEvent`, fallback de tipo desconocido → sistema con `summary`. Registrar `verses-merged`, `step-approved`, `saved` (solo render).
  - nuevo `src/dcs/thread.ts`: `loadThread(session, pmOrg, issueNumber)` que pide solo las fuentes que tiene el sujeto (issue PM siempre; PR y commits si hay marcador).
  - `MyTasksView.tsx`: la fila navega al hilo; "Abrir en Door43" pasa a "Más".
  - `src/App.tsx`: renderizar la ruta.
- **Al terminar:** el hilo mezcla issue y PR en orden, los marcadores nunca se ven, y al abrirlo con todo cargado se llama `markThreadRead(n, maxId)` y desaparece el punto **solo de esa fila**.
- **Pruebas:** `mergeTimeline` (empates, dos repos con el mismo id), `stripHtmlComments` con un `tas:verse-conflicts` real, `classifyComment` para cada fila de §6.1, tipo desconocido → línea con `summary`. Manual: un issue sin PR, uno con PR, y una subtarea de ayudas o de proyecto temático (sin versículos): sin huecos ni campos vacíos.
- **Hecho cuando:** recargar no duplica; abrir A no marca B; si falla el PR, el cursor no avanza y el hilo muestra "No se pudieron cargar los comentarios de revisión · Reintentar".
- **No hacer:** responder, botones de decisión, `resolveVisiblePortionPr`, importar USFM en la vista.

### Slice 4 — Responder, citar y burbujas propias al instante

- **Objetivo:** cuadro de respuesta (§8.4) y fuente local para las acciones propias.
- **Archivos:**
  - `ConversationView.tsx`: cuadro que crece, Enviar, Enter/Mayús+Enter en escritorio, botón en teléfono, borrador en `sessionStorage`, envío optimista con "Reintentar".
  - reutilizar `commentOnIssue` (`src/dcs/issues.ts`).
  - `src/domain/conversation.ts`: `quoteVerse(ref, text)`, `mentionCandidates(issue, progress, comments)`, contrato `CiteTarget` (v1: versículo).
  - nuevo `src/domain/pendingEvents.ts`: `pushLocal(issue, item)`, `reconcile(items, real)`, TTL 10 min, `sessionStorage` `tas-chat-pending:{host}:{username}`.
  - puntos de emisión: `saveUsfmOnPortionBranch` (o su llamador en la mini-app de Escritura) → `saved` con SHA; `MyTasksView.close()` → `closed`; responder → comentario con id devuelto.
  - `MyTasksView.tsx`: retirar el "Comentar" en línea de la fila (o redirigir al hilo).
- **Al terminar:** la respuesta aparece al instante y se confirma; Guardar y Cerrar pintan su línea sin esperar a DCS; al recargar no hay duplicados. Autocompletado `@` solo con participantes.
- **Pruebas:** `quoteVerse`, `mentionCandidates` (sin equipo no participante), `reconcile` (por SHA, por id, TTL vencido). Manual: A responde y B ve el punto en ≤60 s; C, del equipo sin participar, no tiene la fila.
- **Hecho cuando:** la respuesta nunca va al PR; las acciones propias nunca ponen punto al propio usuario.
- **No hacer:** publicar en el PR, adjuntos, editar o borrar comentarios.

### Slice 5 — Conflicto persistente en los dos hilos (primer tipo de decisión)

- **Objetivo:** el conflicto es una tarjeta que sobrevive a recargas y al cierre, y llega a Ana **y a Bob**.
- **Archivos:**
  - `src/domain/markerCodec.ts`: códec base64url (movido desde `verseConflicts.ts`).
  - nuevo `src/domain/chatEvent.ts`: `formatChatEvent` / `parseChatEvent` genéricos (`tas-chat-event-1`, `type` abierto, `summary` obligatorio).
  - nuevo `src/domain/trunkAuthor.ts` (puro): `parseTrunkMergeCommit(message) → {issue, login, verses, workSha, archiveRef}`.
  - `src/dcs/portionPr.ts` (o módulo junto a él): `registerChatEventType({ type: "verse-conflict", render: "decision", … })` con título, cuerpo de dos textos y opciones **sin `run` todavía** (slice 6).
  - `src/components/MyTasksView.tsx` → `close()`: después de `closeIssue`, si hay conflictos:
    1. deducir `otherIssue`/`otherLogin` con `listCommits(bookRef)` + `parseTrunkMergeCommit`;
    2. publicar `verse-conflict` (`side: "entrante"`) en el issue de Ana;
    3. si hay `otherIssue`: publicar `verse-conflict` (`side: "desplazado"`) en el issue de Bob, con `summary` que incluye **`@bob`** y los dos textos citados ("@ana cerró NEH 1:10 y su versión reemplazó la tuya. > Tuya: … > De @ana: …");
    4. etiqueta `pm/estado:conflicto` en **las dos** subtareas (`markIssueConflict` en `src/dcs/issues.ts`, patrón de `markIssueInProgress`).
    Quitar `conflictNotices` y su `Alert`. Burbuja local inmediata en el hilo de Ana.
  - `src/dcs/issues.ts`: `listMyConflictIssues` (cerrados + etiqueta, filtrado en cliente).
  - `src/domain/myTasks.ts` → `loadMyTasksProjects`: incluir los cerrados con conflicto en "Necesitan tu atención" (para Ana y para Bob).
- **Al terminar:** tras Cerrar con conflicto, la tarjeta está en el hilo de Ana y en el de Bob; las dos filas aparecen en "Necesitan tu atención" con "decidir", aunque las subtareas estén cerradas; Bob recibe también el aviso de Door43 por la mención. Recargar no pierde nada.
- **Pruebas:** `formatChatEvent`/`parseChatEvent` (texto con `-->` y `}`, `type` desconocido), `parseTrunkMergeCommit` con la salida real de `trunkMergeCommitMessage`, `summary` con mención y sin marcadores visibles. Manual en org de prueba: dos subtareas que escriben 1:10 y se cierran en orden (como `scripts/verify-usfm-merge.mts`); comprobar la fila de Bob y su aviso.
- **Hecho cuando:** la tarjeta se ve tras recargar y en otro navegador, en los dos hilos; los textos del payload se muestran pero no se usan para escribir.
- **No hacer:** botones que escriben, cambiar `mergePortionPrIfOpen` o `formatVerseConflictsComment`, mencionar a nadie más que a Bob.

### Slice 6 — Decidir: Quedarme con esta / Volver a la otra (y "Volver a la mía")

- **Objetivo:** decidir desde la tarjeta, en cualquiera de los dos hilos, con el motor existente.
- **Archivos:**
  - `src/dcs/portionPr.ts`: `writeTrunkVerseChoice(...)` (§7.2); `resolveChoiceSource(...)` (`archivo/…` o blob `trunkSha`); `run` del tipo `verse-conflict` en el registro.
  - `src/dcs/pulls.ts` (o `repoFile.ts`): `readGitBlob(owner, repo, sha)`.
  - `src/domain/portionPr.ts`: `trunkChoiceCommitMessage`.
  - nuevo `src/domain/conflictChoice.ts` (puro): `choiceBlockReason({payload, conflict, side, currentTrunkSlots, session, issue, sources})` → `null` o el motivo en español (guarda §7.4 y casos §7.5).
  - tarjeta de decisión genérica en `ConversationView.tsx` (o `DecisionCard.tsx`): opciones del registro, **motivo de bloqueo como texto dentro de la tarjeta**, confirmación en línea, estado "Guardando en el tronco…", estado resuelto contraído.
  - tras escribir: `verse-choice` en los dos issues (mención a la otra persona); quitar `pm/estado:conflicto` de ambos cuando todos los rangos estén decididos.
- **Al terminar:** elegir escribe solo el rango (1 commit), publica `verse-choice` en los dos hilos y la tarjeta pasa a "Resuelto por @ana: quedó la versión de @bob". Si el tronco cambió, el botón está deshabilitado y la tarjeta lo explica.
- **Pruebas:** `choiceBlockReason` (cada caso de §7.5, ambos lados), `patchTrunkByVerse(trunk, [side], {ancestor: trunk, scope})`: solo cambia el rango, fuera los bytes son idénticos, CRLF se conserva, elegir lo que ya está no escribe. Manual: los dos sentidos, decidir desde el hilo de Bob, dos conflictos en una porción, tronco modificado a mano entre medias (bloquea), Ana y Bob decidiendo a la vez (el segundo ve el motivo).
- **Hecho cuando:** ninguna elección escribe fuera de su rango ni pisa un versículo cambiado después; sin fuente, sin botón activo y con motivo visible.
- **No hacer:** escribir desde `candidate.text`, crear refs o ramas, tocar Cerrar, publicar a la rama por defecto.

### Slice 7 — Tarea nueva sin ver

- **Objetivo:** insignia "nueva" en subtareas asignadas (o donde soy actor de paso) que no he abierto.
- **Archivos:** `src/domain/readCursor.ts` (campo `seenIssues`, `markSeen(n)`, siembra compartida con el slice 1); `MyTasksView.tsx` (insignia; abrir el hilo o lanzar la mini-app → `markSeen`); `App.tsx` (sumar las nuevas al badge).
- **Al terminar:** primera vez en un navegador, todo lo actual queda visto. Lo asignado después sale "nueva" en atención hasta abrirlo.
- **Pruebas:** siembra, alta, clave por host/usuario/org, JSON corrupto. Manual: el gestor asigna a A; A ve "nueva"; en otro navegador se aplica la siembra (documentado).
- **Hecho cuando:** "nueva" no depende de avisos de Door43 y no reaparece tras abrir.
- **No hacer:** sincronizar lo visto entre navegadores, notificaciones del navegador.

### Slice 8 — (Opcional) Limpiar también la bandeja de Door43

- Solo si se quiere que abrir un hilo en TAS también quite el aviso en git.door43.org. Añadir `write:notification` a `TOKEN_SCOPES` y `SCOPES_VERSION = 3` (un nuevo inicio de sesión). Al abrir un hilo: buscar los hilos de aviso de Door43 de **esa** subtarea (issue PM y su PR) y `PATCH /notifications/threads/{id}?to-status=read`, con la comprobación de `updated_at`. Nunca `PUT /notifications`. **No cambia el punto de TAS**, que sigue siendo el cursor local. No bloquea nada anterior.

### Slice 9 — (Más adelante) Notificación del navegador

- Pedir permiso de `Notification` solo tras un gesto del usuario, con el sondeo de pestaña abierta. Sin Service Worker ni push. **Fuera del primer camino ejecutable.**

---

## 12. Trampas (gotchas) del código actual

1. **La bandeja de Door43 no es el punto de TAS.** Su `unread` se comparte con la web y otros repos. No usarla para el badge (decisión 2). `/notifications/new` cuenta todo DCS.
2. **`GET /repos/{o}/{r}/issues/comments` pagina** y filtra por `updated_at`, no por creación: un comentario editado vuelve a llegar. El cursor compara **ids**, así que no crea puntos falsos; deduplicar por id.
3. **`PUT /notifications` marca todo como leído**, también lo ajeno a TAS. No implementarlo nunca.
4. **`write:notification` no está** en `TOKEN_SCOPES`. No hace falta para los slices 1–7. Si se hace el slice 8, subir `SCOPES_VERSION` obliga a volver a iniciar sesión.
5. **Marcador en base64 dentro de la burbuja o de la fila:** quitar `<!-- … -->` siempre (`tas:verse-conflicts`, `tas:chat-event`, `gateway-portion-pr`, `gt:en-curso`, `gateway-task-progress`). La vista previa de la fila usa `summary`, nunca el cuerpo.
6. **Org PM frente a repo de contenido:** los números chocan (issue #7 del PM ≠ PR #7 del contenido). Nunca usar un número sin su `owner/repo`.
7. **El marcador del PR se borra** (`unlinkPortionPrMarker`…). El hilo no debe depender solo del cuerpo del issue (§3.4).
8. **Issue 0 en el laboratorio:** `solverLab.ts` usa `issueNumber: 0`. En el laboratorio no hay conversación, badge, eventos locales ni decisión.
9. **Trabajadores viendo otros equipos:** DCS deja leer todo el repo PM a los miembros. Aplicar §9 en el hilo y en el badge.
10. **Mis tareas solo lista abiertos** y `close()` cierra en la misma acción que produce el conflicto → sin `pm/estado:conflicto` en las dos subtareas, el conflicto desaparece para ambos.
11. **`labels=` en la búsqueda descarta etiquetas inexistentes:** filtrar siempre en cliente.
12. **`trunkSha` es un SHA de blob:** `git/blobs/{sha}`, no `readRepoFile({branch})`.
13. **El texto del payload está normalizado:** mostrarlo sí; escribirlo, nunca.
14. **Las acciones propias no generan aviso para uno mismo** → fuente local (§3.1) para pintarlas; nunca ponen punto.
15. **`loadPortionPrConflicts` acepta `payload.issue === 0`**: en el hilo, igualdad estricta.
16. **Watchers automáticos:** verificar en QA antes del slice 4.
17. **`@ip-lms/dcs-client` se resuelve desde `dist/`:** helpers nuevos en `src/dcs/` de la app.
18. **Varias pestañas sondean a la vez:** 60 s, solo pestaña visible; no bajar de 30 s. Las pestañas comparten `localStorage`: escuchar el evento `storage` para que marcar leído en una pestaña quite el punto en las otras.
19. **Vista "trabajador" de un gestor:** el cursor es el de su cuenta real.
20. **`listIssueComments` no pagina:** cargar el hilo bajo demanda, nunca por fila.
21. **La mención a Bob solo avisa si Bob tiene acceso al repo PM.** Si no, se queda con la etiqueta y el punto cuando entre.
22. **Ids de comentario globales:** el cursor único por hilo asume que los ids de Gitea son comparables entre repos de la misma instancia. Verificar; si no, cursor por fuente.
23. **Tentación de acoplar a Escritura:** cualquier `if (resource === "tpl")` en la vista del hilo es un error de diseño. Va al registro de eventos o a la mini-app.

---

## 13. Preguntas abiertas y verificación en QA

- ¿Los ids de comentario de DCS 1.27.2 son globales y crecientes en toda la instancia (issue PM y PR del repo de contenido comparables)? Afecta a la forma del cursor (§5), no al plan.
- ¿DCS avisa al asignado cuando el issue se **crea** ya asignado? No cambia el plan; afecta al ruido de Door43.
- ¿Quién vigila `gateway-tasks` y los repos de contenido? (`GET …/subscribers`).
- ~~¿Hay que avisar al dueño del texto desplazado?~~ **Decidido: sí**, con `@bob` en su subtarea (slice 5).
- ¿"Tronco" o "versión compartida" en la tarjeta? Probar con dos trabajadores.
- Campos opcionales en `tas-verse-conflicts-1` (`workSha`, `archiveRef`, `otherIssue`) simplificarían los slices 5–6. Compatibles hacia atrás, pero tocan el comentario de Cerrar: decidir aparte. El plan funciona sin ellos.
- ¿Declarar en `solvers.json` qué tipos de evento emite cada mini-app (para documentación y validación)? Útil cuando haya una segunda mini-app con eventos; no hace falta en v1.
- ¿Mover los comentarios de `PortionReviewView` al issue PM? Fuera de este plan.
