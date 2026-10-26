# Armonización por capítulo: plan de implementación

> **Para quien lo ejecute (persona o agente):** se trabaja tarea por tarea, en orden, marcando cada casilla (`- [ ]`). Habilidad recomendada: `superpowers:subagent-driven-development` o `superpowers:executing-plans`.

*26 de octubre de 2026.* Decidido con Abel en la conversación de ese día.

**Objetivo.** Cada tipo de armonización (notas, palabras, preguntas) se resuelve en **una sola subtarea por capítulo**. Dentro de ella hay:
- una lista de todos los ítems del capítulo, agrupados por secciones, con el estado de cada uno y el avance;
- la presencia en vivo de quién está en cada ítem;
- un «Seguir donde hace falta» que lleva a cada persona a lo que necesita gente.

**Arquitectura.**
- El proceso FCR pasa las tareas de armonización a `bundle: { grain: "chapter" }`, como ya hacen la revisión grupal y las palabras del TPL. La subtarea trae sus secciones en `portionIds`.
- La lista y el «Seguir» son funciones puras nuevas (`chapterRoster.ts`), dibujadas por un componente nuevo dentro de `ChecklistView`.
- La presencia usa `usfm-relay-server` (repositorio `usfm-ast`), endurecido: sesión de Door43, permisos, límites, varios aparatos y conexiones cortadas. En Taller hay un cliente que se apaga solo si no hay servidor configurado.

**Tecnologías.** React 18 + Vite + TypeScript (Taller). Pruebas con `tsx` (`scripts/verify-*.mts`). Cloudflare Worker con Durable Objects e hibernación de WebSocket, y pruebas con `vitest` + `@cloudflare/vitest-pool-workers` (relay). Mock de Door43 (`scripts/mock-door43/server.mjs`).

## Lo decidido (la especificación)

1. **Una subtarea por capítulo y por tipo:**
   - «Armonizar Notas y Academia · Ester 1»;
   - «Armonizar Palabras · Ester 1»;
   - «Armonizar Preguntas · Ester 1».

   Un capítulo partido en tramos (`handoffUnits`) da una subtarea por tramo, como hoy en las tareas por capítulo.
2. **Dentro de la subtarea, la lista del capítulo:**
   - agrupada por las secciones de siempre (1:1–4, 1:5–6…);
   - cada fila con la referencia, las palabras que cita el ítem, su estado y quién lo revisó o está en él;
   - se toca una fila y se abre ese ítem.
3. **Estados de un ítem**, dichos para quien mira:
   - **Lista**: la decidieron las personas que hacen falta;
   - **Te toca**: tu opinión falta, o te respondieron;
   - **Esperando a otros**: ya dijiste lo tuyo;
   - **Sin revisar**: nadie dijo nada.

   Arriba, el avance: cuántas hay en cada estado y el porcentaje de «Lista».
4. **«Seguir donde hace falta».** Lleva primero a lo que **te toca**. Después, a lo que no has revisado y tiene menos personas (las que ya respondieron más las que están ahora) que las que hacen falta. Nunca bloquea: si todo está cubierto, lleva a lo que no has revisado.
5. **Presencia en vivo**, como en Google Docs:
   - «Bea y Carla están aquí» en la subtarea;
   - «Bea está en esta nota» y «Bea está escribiendo una propuesta» en el ítem;
   - las iniciales en la lista.

   Desaparece sola en menos de 75 s si alguien se va o pierde la señal. No bloquea nada. Cuando alguien responde, la nota y la lista de los demás se ponen al día sin recargar.
6. **Sin servidor de presencia** (variable vacía, servidor caído o acceso negado), Taller funciona como hoy y solo no se ve quién está.
7. **El servidor solo deja entrar** a quien tiene sesión de Door43 y puede leer el repositorio donde se guardan las respuestas. El nombre que muestra es el de Door43, no el que manda la app.
8. **Los proyectos ya creados conservan las subtareas por sección que ya existen.** Los capítulos que todavía no tienen subtareas de armonización nacen con una por capítulo. Las respuestas se guardan por subtarea (`LIBRO.issue.paso`), y nada se mueve.
9. **No se publica nada sin el «sí» de Abel:** ni Cloudflare, ni GitHub, ni Door43. El servidor de presencia lo publica Abel desde su cuenta.

## Restricciones de todo el plan

- La interfaz va en `src/i18n/locales/es.json` (la fuente) y `pt.json`, con `useT()`. No queda español suelto en los componentes. `npm run verify:config` debe pasar.
- El código no nombra fases, tareas ni pasos del FCR: lo que es del proceso va en `processes/fcr.json` (`npm run verify:decoupling`).
- Cada texto nuevo tiene su regla `html[data-text]` con `--ts` (`npm run verify:text-size`).
- Diseño: pensado para el dedo a 375 px. Entre grupos 24–32 px y dentro de un grupo 8–12 px. Una sola cosa obvia que hacer. Se pasa la lista de [`FILOSOFIA_DE_DISENO.md`](FILOSOFIA_DE_DISENO.md) en teléfono y escritorio.
- Comentarios y commits en inglés, con título corto y un cuerpo que diga el porqué, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No se suben a git `scripts/mock-door43/server.mjs` (cambios locales), `scripts/tmp-tt.js` ni `respaldos/`.
- Los archivos se editan con guiones que leen antes de escribir, sin `sed -i` en archivos con CRLF. `src/styles/components.css` está en LF.
- Mock: puerto 8798 (`MOCK_PORT=8798 MOCK_HOST=http://localhost:8798 MOCK_PM_ORG=es-419_gl MOCK_SEED_BOOK=EST`). Dos personas a la vez: Ana en 5185 (`taller-mock-ana`) y Bea en 5186. El servidor de presencia local va en 8790.

## Lo que más puede fallar sin que una prueba lo vea

Cada punto tiene su prueba en la tarea que lo toca.

1. **Un teléfono pierde la señal o se bloquea.** La persona desaparece en ≤ 75 s y nada queda tomado (Tarea 5, `livePeers`).
2. **La misma persona en dos aparatos.** Cerrar uno no la hace «salir» (Tarea 4, `peer-leave only after the last socket of a user`).
3. **Sesión vencida o sin acceso.** La app sigue sin presencia y no reintenta en bucle (Tarea 4, `denied`; Tarea 5, `stops after denied`).
4. **Un capítulo partido en tramos, o una sección sin ítems.** La lista muestra solo su tramo y no deja una sección vacía con encabezado (Tarea 1, `sectionsOf`/`rosterOf`).
5. **Otra persona responde mientras la lista está abierta.** Los conteos cambian sin recargar, y una respuesta propia no se pisa con datos viejos (Tarea 6, evento `taller:answered`; se relee antes de contar).

---

### Tarea 0: Guardar lo hecho antes de empezar

El trabajo del 26 de octubre está sin commit:
- consenso por opciones;
- preguntas nuevas;
- tarjeta única;
- hoja de otra nota y del versículo enlazado;
- pregunta «remite»;
- barra de posición.

**Pide el «sí» de Abel antes de hacer commits.**

- [ ] **Paso 1.** `git status` y `git diff --stat`. Agrupa en commits con sentido:
  1. propuestas como opciones y consenso;
  2. preguntas del checklist (`fcr.json` v52, `formerTexts`, `since`, `formerQuestions`);
  3. pantalla del checklist (tarjeta, comentar, dividir la nota, hojas);
  4. carga del libro entero en `checklistLoad.ts`.
- [ ] **Paso 2.** Corre `npx tsc --noEmit -p .` y los scripts `verify:` `checklist`, `check-proposal`, `workflow-upgrade`, `templates`, `config`, `text-size`, `decoupling` y `process-load`. Todo debe pasar.
- [ ] **Paso 3.** Haz los commits sin los archivos excluidos (ver las restricciones).

### Tarea 1: El estado del capítulo (dominio)

**Archivos:**
- Crear: `src/domain/chapterRoster.ts`
- Crear: `scripts/verify-chapter-roster.mts`, y en `package.json`, `"verify:chapter-roster": "tsx --tsconfig tsconfig.scripts.json scripts/verify-chapter-roster.mts"`

**Interfaces:**
- Usa: `CheckItem`, `ChecklistSummary`, `CheckItemTally` y `CheckSlot.voices` (`src/domain/checklist.ts`), y `portionRange(ref, chapter)` (`src/domain/usfmEdit.ts`).
- Da:
  ```ts
  export type RosterStatus = "ready" | "mine" | "waiting" | "unread";
  export type RosterSection = { ref: string; from: number; to: number };
  export type RosterRow = { itemId: string; chapter: number; verse: number; verseTo?: number; section: string; status: RosterStatus; voices: string[] };
  export function sectionsOf(portionIds: string[], chapter: number): RosterSection[];
  export function rosterOf(p: { items: CheckItem[]; summary: ChecklistSummary; sections: RosterSection[] }): RosterRow[];
  export function rosterCounts(rows: RosterRow[]): { ready: number; mine: number; waiting: number; unread: number; total: number; readyShare: number };
  export function nextNeeding(rows: RosterRow[], p: { me: string; needed: number; after?: string; present?: Record<string, string[]> }): string | null;
  ```

**Cómo se calcula:**
- **Estado.**
  - Ítem con `state === "ok"`: `ready`.
  - Si no, según `turn`: `"mine"` da `mine`; `"waiting"` da `waiting`; `"new"`, o sin `turn` y sin voces, da `unread`.
- **Voces:** la unión ordenada de `slots[*].voices` en minúsculas.
- **Sección:** la del versículo. Los ítems «todo el versículo» (`stop`) van en la sección de su versículo.
- **`nextNeeding`:** recorre en orden de lectura a partir del ítem que sigue a `after`, dando la vuelta. Elige:
  1. la primera fila `mine`;
  2. si no hay, la primera no `ready` donde `me` no está en `voices` y `voices.length + (present[item] sin me).length < needed`;
  3. si no hay, la primera no `ready` sin `me` en `voices`;
  4. si no, `null`.

- [ ] **Paso 1.** Escribe las pruebas en `verify-chapter-roster.mts`:
  - `sectionsOf(["1:1-4","1:5-6"], 1)` da `[{ref:"1:1-4",from:1,to:4},{ref:"1:5-6",from:5,to:6}]`. Un id que no es referencia (`"EST-x"`) se ignora. Sin ninguna referencia válida da `[{ref:"1", from:1, to:200}]`.
  - `rosterOf` con 4 ítems (1:2 ok, 1:3 turn mine, 1:5 turn waiting, 1:6 sin respuestas) da los estados `ready`, `mine`, `waiting` y `unread`, con las secciones `"1:1-4"`, `"1:1-4"`, `"1:5-6"` y `"1:5-6"`.
  - Una sección sin ítems no aparece en las filas. Un tramo (`sections` solo de 1:5–6) deja fuera los ítems de 1:1–4.
  - `rosterCounts` de esos cuatro da `{ready:1,mine:1,waiting:1,unread:1,total:4,readyShare:0.25}`.
  - `nextNeeding`:
    - con `me:"ana"`, `needed:3`, da el ítem `mine`;
    - sin filas `mine`, salta un ítem con 2 voces más 1 persona presente y elige el siguiente sin cubrir;
    - si todo está cubierto, elige el primero que Ana no revisó;
    - si Ana revisó todo, da `null`;
    - con `after:"n6"`, da la vuelta y empieza por el principio.
- [ ] **Paso 2.** `npm run verify:chapter-roster` debe fallar porque el módulo no existe.
- [ ] **Paso 3.** Implementa `src/domain/chapterRoster.ts` con las firmas de arriba.
- [ ] **Paso 4.** `npm run verify:chapter-roster` debe pasar todo.
- [ ] **Paso 5.** Commit: «Chapter roster: the state of each help of a chapter and where help is needed».

### Tarea 2: La lista del capítulo (pantalla)

**Archivos:**
- Crear: `src/components/ChapterHelpsList.tsx`
- Modificar: `src/components/ChecklistView.tsx`
  - la etiqueta `ck-where` (≈ línea 1570) pasa a ser el botón que abre la lista;
  - estado `listOpen`;
  - `goOn()` (≈ línea 1174) y `jump()` (≈ línea 873).
- Modificar: `src/i18n/locales/es.json` y `pt.json`, y `src/styles/components.css`.

**Interfaces:**
- Usa: todo lo de la Tarea 1; `labelOf(itemId)` y `summary` de `ChecklistView`; `ctx.portionIds` y `ctx.chapter`.
- Da:
  ```tsx
  <ChapterHelpsList rows counts sections labelOf onOpen onNext presentOn? />
  ```
  - `labelOf(itemId) → string`: las palabras citadas, como en el checklist.
  - `onOpen(itemId)`.
  - `onNext()`: «Seguir donde hace falta».
  - `presentOn?(itemId) → { login: string; name: string; writing: boolean }[]`: la usa la Tarea 6.

**Cómo se ve:**
- **Arriba:**
  - una barra de avance de cuatro tramos con su leyenda: «Listas 12 · Te toca 3 · Esperando a otros 5 · Sin revisar 9»;
  - «41 % listo»;
  - el botón lleno **«Seguir donde hace falta»**.
- **Filtros de un toque:** «Todas», «Te toca» y «Sin revisar».
- **Por sección:**
  - encabezado «1:1–4 · 3 de 8 listas»;
  - filas de al menos 44 px con la referencia («1:2»), las palabras citadas (una línea, con «…»), el estado con color y palabra (no solo color), y a la derecha las iniciales de quien revisó.
- **Cuándo se abre la lista:** al entrar, si la subtarea cubre más de una sección (`sections.length > 1`). Si no, se abre la primera nota, como hoy. Desde una nota, se llega tocando «Nota 5 de 29 · 1:12».
- **«Seguir donde hace falta»** abre el ítem que da `nextNeeding` (`needed` = `agreement.people`). Si no hay ninguno, vuelve a la lista con «No te queda nada por revisar en este capítulo».
- **Textos nuevos** (es, y su versión pt):
  - `ck.listTitle`: «Notas del capítulo» / «Palabras del capítulo» / «Preguntas del capítulo», según el tipo;
  - `ck.listReady`, `ck.listMine`, `ck.listWaiting`, `ck.listUnread`;
  - `ck.listShare`: «{n} % listo»;
  - `ck.listNext`: «Seguir donde hace falta»;
  - `ck.listNothing`;
  - `ck.listSection`: «{ref} · {done} de {total} listas»;
  - `ck.listAll`;
  - `ck.listOpen`: «Ver todas»;
  - `ck.listFilterMine`, `ck.listFilterUnread`.

- [ ] **Paso 1.** Crea `ChapterHelpsList.tsx` y conéctalo en `ChecklistView`. Corre `npx tsc --noEmit -p .`: sin errores.
- [ ] **Paso 2.** Agrega los textos a `es.json` y `pt.json`. `npm run verify:config` debe pasar.
- [ ] **Paso 3.** Agrega el CSS con sus reglas `html[data-text]`. `npm run verify:text-size` debe pasar.
- [ ] **Paso 4.** Prueba en el navegador con el mock, en la subtarea «Ester 1:1–4» (más de una nota):
  - tocar «Nota 2 de 8» abre la lista;
  - tocar una fila abre esa nota;
  - «Seguir» lleva a la que da `nextNeeding`;
  - los conteos coinciden con las respuestas;
  - a 375 px y en escritorio, mide el aire entre grupos (24–32 px) y dentro de ellos (8–12 px);
  - pasa la lista de comprobación de diseño.
- [ ] **Paso 5.** Commit: «Checklist: the list of a chapter's helps, by section, with where each stands».

### Tarea 3: Una subtarea por capítulo (proceso)

**Archivos:**
- Modificar: `processes/fcr.json` (tareas `armonizar-notas`, `armonizar-palabras` y `armonizar-preguntas`; versión 53)
- Modificar: `scripts/verify-workflow-upgrade.mts`
- Puede tocarse: `src/domain/workflows.ts` (`upgradeBoardToWorkflow`, `fillMissing`)

**Interfaces:**
- Usa: `bundleUnits` (`src/domain/assignment.ts:882`) y `unitsOfChapter` (`src/domain/handoff.ts:44`).
- Da: en las tres tareas, `bundle: { enabled: true, grain: "chapter" }`, `distributeUnit: "chapter"` y `distributePolicy: "manual"`. Así lo tienen `revision-grupal-tpl` y `palabras-tpl`.

**Dos cuidados:**
1. **El cupo de personas.** Los pasos `claimMode: "pool"` de estas tareas tienen hoy `maxAssignees: 6` para una sección. Para un capítulo, sube `maxAssignees` a 12 y deja `minAssignees: 3`. Es una propuesta: confírmala con Abel antes del commit.
2. **Los proyectos ya creados** (decisión 8). `fillMissing` agregaría `bundle` a una tarea que no lo tiene, así que hay que comprobar qué pasa con sus subtareas ya creadas.

- [ ] **Paso 1.** Escribe dos pruebas en `verify-workflow-upgrade.mts`:
  - «un proyecto que ya armonizó por secciones conserva sus subtareas y su cupo»: tablero con `armonizar-notas` sin `bundle` y subtareas por sección del capítulo 1. Tras actualizar a v53, las subtareas del capítulo 1 siguen siendo las mismas (mismos ids y secciones) y el capítulo 1 no gana una subtarea de capítulo.
  - «un proyecto nuevo arma una sola subtarea por capítulo»: `bundleUnits` de la tarea del proceso v53 sobre las porciones de Ester 1 da una sola unidad con todas las secciones en `portionIds`.
- [ ] **Paso 2.** Corre las pruebas. Si la primera falla porque `fillMissing` agrega `bundle`, cambia `upgradeBoardToWorkflow` para que no agregue `bundle`, `distributeUnit` ni `distributePolicy` a una tarea que ya tiene subtareas creadas. El cambio afecta solo a esas claves, con un comentario que diga por qué. Lee cómo se crean las subtareas de un capítulo (`bundleUnits` y quien lo llama) para confirmar que los capítulos sin subtareas sí nacen por capítulo.
- [ ] **Paso 3.** Edita `fcr.json`: los tres bloques y `"version": 53`, con un guion que lea antes de escribir.
- [ ] **Paso 4.** Corre los scripts `verify:` `workflow-upgrade`, `templates`, `process-load` y `decoupling`. Todo debe pasar. Si `process-load` avisa de carga en estos pasos, ajusta `walks`, no el cupo.
- [ ] **Paso 5.** Prueba en el mock: crea de nuevo el libro EST desde la página, con el recorrido del capítulo 1 (ver `startBook.ts`). «Mis tareas» debe mostrar «Armonizar Notas y Academia · Ester 1», «Armonizar Palabras · Ester 1» y «Armonizar Preguntas · Ester 1», y la primera debe abrir la lista con sus 8 secciones.
- [ ] **Paso 6.** Commit: «FCR: harmonization is one subtask per chapter, with its sections inside».

### Tarea 4: El servidor de presencia, endurecido (repositorio `usfm-ast`)

**Archivos** (en `../usfm-ast/packages/usfm-relay-server`):
- Modificar: `src/index.ts`, `src/protocol.ts` y `wrangler.jsonc` (variables vacías por defecto)
- Crear: `src/door43.ts` (comprobación de sesión y acceso)
- Modificar: `tests/relay.test.ts` y `tests/protocol.test.ts`; `README.md` (sección «Taller» y variables)

**Interfaces** (compatibles con `usfm-editor-core`: todo lo nuevo es opcional):

```ts
// protocol.ts
export interface PeerPresenceWire { userId: string; displayName: string; color: string; cursor?: {chapter:number;pos:number}; selection?: {chapter:number;from:number;to:number}; focus?: { item: string; doing: "viewing" | "writing" }; lastSeen: number }
type ClientMessage = { type: 'join'; roomId: string; userId: string; presence: PeerPresenceWire; auth?: { token: string } } | ...
type ServerMessage = ... | { type: 'denied'; reason: 'auth' | 'access' | 'room' | 'full' }
// door43.ts
export function parseRoom(roomId: string): { host: string; owner: string; repo: string; key: string } | null; // "host|owner/repo|key"
export async function checkDoor43(p: { host: string; owner: string; repo: string; token: string; fetch?: typeof fetch }): Promise<{ login: string; name: string } | { denied: 'auth' | 'access' }>;
```

**Variables del Worker** (todas opcionales; sin ellas, el servidor se comporta como hoy):
- `AUTH_MODE`: `"door43"` exige `auth`.
- `ALLOWED_HOSTS`: por ejemplo `git.door43.org,qa.door43.org,localhost:8798`. `http://` solo se usa para `localhost`.
- `ALLOWED_ORIGINS`: si existe, rechaza con 403 la conexión desde otro `Origin`.
- `MAX_MESSAGE_BYTES`: por defecto `65536`; Taller usa `4096`.
- `MAX_PEERS`: por defecto `50`.

**Qué cambia en el comportamiento:**
- **Con `AUTH_MODE=door43`**, el `join` debe traer `auth.token` y una sala con el formato `host|owner/repo|key`. El host debe estar en `ALLOWED_HOSTS`.
  - Se hacen dos llamadas: `GET {host}/api/v1/user`, que debe dar 200 y el login; y `GET {host}/api/v1/repos/{owner}/{repo}`, que debe dar 200.
  - `userId` pasa a ser el login de Door43 en minúsculas, y `displayName` es `full_name` o, si falta, el login. El servidor ignora lo que mande la app.
  - Si algo falla, manda `denied` y cierra con el código 4403. Nada de lo que mande esa conexión se reenvía.
- **`lastSeen`** lo pone el servidor (`Date.now()`) en cada `join` o `presence`.
- **`peer-leave`** se manda solo cuando se cierra la **última** conexión de ese `userId` en la sala.
- **`webSocketError`** hace lo mismo que `webSocketClose`.
- **Un mensaje más grande que `MAX_MESSAGE_BYTES`** se descarta. Un `join` con la sala llena (`MAX_PEERS`) recibe `denied: 'full'`.

- [ ] **Paso 1.** Escribe las pruebas en `tests/relay.test.ts`, con `fetch` de Door43 simulado (`checkDoor43` recibe `fetch`):
  - `denies join without token when AUTH_MODE=door43`;
  - `denies a host not in ALLOWED_HOSTS`;
  - `denies a user who cannot read the repository`;
  - `uses the Door43 login, not the client's userId`;
  - `peer-leave only after the last socket of a user`;
  - `relays focus in presence`;
  - `drops messages over MAX_MESSAGE_BYTES`;
  - `denies join when the room is full`;
  - `without AUTH_MODE behaves as before`: las pruebas que ya existían siguen pasando.

  En `protocol.test.ts`: `parseRoom` acepta `qa.door43.org|es-419_gl/es-419_tn|EST.12.notas-textos` y rechaza las salas sin las tres partes.
- [ ] **Paso 2.** Corre `RUN_RELAY_POOL_TESTS=1 bun run test`: las pruebas nuevas deben fallar.
- [ ] **Paso 3.** Implementa `door43.ts` y los cambios en `index.ts` y `protocol.ts`.
- [ ] **Paso 4.** Corre `RUN_RELAY_POOL_TESTS=1 bun run test` y `bun run check-types`: todo debe pasar. Comprueba que `usfm-editor-core` compila (`bun run check-types` en ese paquete).
- [ ] **Paso 5.** Commit en `usfm-ast`: «relay-server: Door43 sign-in, room access, limits, and leave after the last socket».

### Tarea 5: El cliente de presencia en Taller

**Archivos:**
- Crear: `src/domain/presence.ts`, `src/dcs/presence.ts`, `src/components/usePresence.ts`, `scripts/verify-presence.mts`, y en `package.json`, `verify:presence`
- Modificar: `.env.example`, si existe, o la sección de variables de `docs/CONFIGURACION.md`, con `VITE_PRESENCE_URL`

**Interfaces:**
```ts
// domain/presence.ts (pure)
export type PresenceFocus = { item: string; doing: "viewing" | "writing" };
export type Peer = { login: string; name: string; focus?: PresenceFocus; lastSeen: number };
export const PEER_STALE_MS = 75_000;
export const PRESENCE_BEAT_MS = 30_000;
export function presenceRoom(p: { host: string; owner: string; repo: string; key: string }): string; // "host|owner/repo|key"; host without scheme
export function applyServerMessage(peers: ReadonlyMap<string, Peer>, msg: unknown, now: number): Map<string, Peer>;
export function livePeers(peers: ReadonlyMap<string, Peer>, now: number, me: string): Peer[];
export function peersOn(peers: Peer[], item: string): Peer[];
// dcs/presence.ts
export type PresenceEvent = { type: "taller:answered"; item: string };
export type PresenceConnection = { setFocus(focus: PresenceFocus | null): void; announce(event: PresenceEvent): void; close(): void };
export function connectPresence(p: { url: string; room: string; session: GtSession; onPeers(peers: Peer[]): void; onEvent(e: PresenceEvent & { by: string }): void; socket?: (url: string) => WebSocket; now?: () => number }): PresenceConnection;
// components/usePresence.ts
export function usePresence(room: string | null, focus: PresenceFocus | null): { peers: Peer[]; announce(e: PresenceEvent): void; onEvent(handler: (e: PresenceEvent & { by: string }) => void): void };
```

**Detalles:**
- La sala es la misma clave de las respuestas: `presenceRoom({ host, owner: data.target.owner, repo: data.target.repo, key: \`${BOOK}.${issueNumber}.${stepId}\` })`.
- La conexión manda `join` con `auth.token` y repite su presencia cada `PRESENCE_BEAT_MS`.
- Si se cae, reintenta tras 1, 2, 4… segundos, hasta 30 s entre intentos. Tras un `denied` no reintenta.
- Sin `VITE_PRESENCE_URL`, `usePresence` no conecta nada y devuelve `peers: []`.

- [ ] **Paso 1.** Escribe las pruebas en `verify-presence.mts`, con un socket falso:
  - `presenceRoom` da `qa.door43.org|es-419_gl/es-419_tn|EST.12.notas-textos` (le quita `https://` al host);
  - `applyServerMessage`: `peer-join` agrega o actualiza, `peer-leave` quita, y un mensaje desconocido no cambia nada;
  - `livePeers` deja fuera a la propia persona y a quien lleva más de 75 s sin señal;
  - `peersOn` filtra por `focus.item`;
  - `connectPresence`:
    - manda `join` con el token;
    - repite la presencia a los 30 s;
    - reconecta tras un cierre;
    - **no** reconecta tras `denied`;
    - `announce` manda un `relay` con `{ type: "taller:answered", item }`.
- [ ] **Paso 2.** `npm run verify:presence` debe fallar.
- [ ] **Paso 3.** Implementa los tres archivos.
- [ ] **Paso 4.** `npm run verify:presence` y `npx tsc --noEmit -p .` deben pasar.
- [ ] **Paso 5.** Commit: «Presence: who is in a subtask and on which help, live, off without a server».

### Tarea 6: La presencia en la pantalla

**Archivos:**
- Modificar: `src/components/ChecklistView.tsx`, `src/components/ChapterHelpsList.tsx`, `es.json`, `pt.json` y `components.css`.

**Interfaces:**
- Usa: `usePresence` (Tarea 5) y `presentOn` de `ChapterHelpsList` (Tarea 2).

**Qué se agrega:**
- **El foco de cada persona:**
  - `{ item: item.id, doing: "viewing" }` al estar en un ítem;
  - `doing: "writing"` cuando está abierta la hoja de propuesta (`proposing`) o el formulario de comentario (`commenting`);
  - `null` en la lista.
- **Lo que se ve:**
  - en la subtarea, bajo la barra: «Bea y Carla están aquí» (`ck.hereNow`), solo si hay alguien;
  - en el ítem, sobre «Qué comprobar»: «Bea está en esta nota» (`ck.onThisNow`) o «Bea está escribiendo una propuesta…» (`ck.writingNow`);
  - en la lista, las iniciales de quien está ahora, con un punto verde.
- **Respuestas de otros:**
  - tras guardar (`save()` con éxito), se anuncia `taller:answered`;
  - al recibir un anuncio de otra persona, se vuelven a leer las respuestas con `loadCheckAnswers`. Las lecturas se juntan en una por segundo. La lista y la nota cambian sin recargar.

- [ ] **Paso 1.** Implementa, con los textos en `es.json` y `pt.json` y el CSS con sus reglas `html[data-text]`.
- [ ] **Paso 2.** Corre `npx tsc --noEmit -p .` y los scripts `verify:` `config`, `text-size`, `checklist` y `presence`.
- [ ] **Paso 3.** Commit: «Checklist: see who is here, on which help, and what they answer, as it happens».

### Tarea 7: «Seguir» cuenta a quien está

**Archivos:** modificar `src/components/ChecklistView.tsx` (`goOn()` y `onNext` de la lista).

- [ ] **Paso 1.** `goOn()` y el botón de la lista usan `nextNeeding(rows, { me, needed, after: item?.id, present })`, donde `present` sale de `livePeers` (ítem → logins). Si da `null`, abren la lista con `ck.listNothing`.
- [ ] **Paso 2.** Agrega a `verify-chapter-roster.mts` el caso «con dos personas ya en una nota, Seguir lleva a la siguiente», que ya cubre `present`. Corre `npm run verify:chapter-roster`.
- [ ] **Paso 3.** Commit: «Checklist: go on to where people are missing, counting who is there now».

### Tarea 8: Prueba completa con el mock y dos personas

- [ ] **Paso 1.** Levanta todo:
  - el mock en 8798;
  - el servidor de presencia local: `node ./node_modules/wrangler/bin/wrangler.js dev --port 8790 --var AUTH_MODE:door43 --var ALLOWED_HOSTS:localhost:8798 --var MAX_MESSAGE_BYTES:4096`, desde `usfm-ast/packages/usfm-relay-server`;
  - Taller como Ana en 5185 y como Bea en 5186, con `VITE_PRESENCE_URL=ws://localhost:8790`.
- [ ] **Paso 2.** Recorre y anota el resultado de cada caso:
  1. Ana abre «Armonizar Notas y Academia · Ester 1» y ve la lista con 8 secciones.
  2. Bea entra: Ana ve «Bea está aquí».
  3. Bea abre la nota de 1:2: en la lista de Ana aparece «B» en 1:2.
  4. Bea abre «Proponer el cambio»: Ana, en 1:2, ve «Bea está escribiendo una propuesta…».
  5. Bea envía: la nota de Ana se pone al día sin recargar, y los conteos de la lista cambian.
  6. Bea cierra la pestaña: Ana la deja de ver en menos de 75 s.
  7. Ana abre Taller en una segunda pestaña y cierra una: Bea la sigue viendo.
  8. Con el servidor apagado, Ana responde normalmente y no hay errores en la consola.
  9. Con una sesión inválida, el servidor responde `denied` y la app no reintenta.
- [ ] **Paso 3.** Mide la lista y la nota con el guion de auditoría (controles, < 44 px, botón lleno, aire entre grupos) a 375 px y en escritorio. Toma capturas.
- [ ] **Paso 4.** Arregla lo que falle en la tarea correspondiente y repite.

### Tarea 9: Publicar (lo hace Abel)

Nada de esto se hace sin su «sí».

- [ ] **Paso 1.** Dale a Abel los comandos para publicar el servidor desde la carpeta del paquete, no desde el perfil (por la carpeta `~/.wrangler`):

  ```
  node ./node_modules/wrangler/bin/wrangler.js deploy
  ```

  Con las variables `AUTH_MODE=door43`, `ALLOWED_HOSTS=git.door43.org,qa.door43.org`, `ALLOWED_ORIGINS=<dominio de Taller>` y `MAX_MESSAGE_BYTES=4096`.
- [ ] **Paso 2.** Taller publicado necesita `VITE_PRESENCE_URL=wss://<worker>/` en su compilación. Anótalo en `docs/CONFIGURACION.md`.
- [ ] **Paso 3.** Antes de publicar el proceso v53, revisa (solo lectura) si algún proyecto real de producción ya tiene subtareas de armonización abiertas, y confirma con la prueba de la Tarea 3 que se conservan.
- [ ] **Paso 4.** Agrega a [`PLAN.md`](PLAN.md) una línea que apunte a este plan y a su estado.

## Costo en Cloudflare

Para 10 personas, unas 4 horas al día, el plan gratuito alcanza de sobra:

| | Plan gratuito (por día) | Uso estimado |
|---|---|---|
| Peticiones | 100 000 | unas 1 000 |
| Tiempo de cálculo | 13 000 GB-s | menos de 50 GB-s |
| Almacenamiento | 5 GB | ninguno |

Cada conexión cuenta como una petición, y cada 20 mensajes recibidos cuentan como otra. Los mensajes que el servidor envía no cuentan, y las salas sin movimiento no cobran tiempo. Ojo: la cuota de peticiones de los Workers es compartida con el Worker de avisos, y por eso importan los límites de la Tarea 4.

Fuente: [precios de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).
