# Entrar con Door43 — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que «Entrar con Door43» (OAuth, cliente público con PKCE y sin servidor) sea la entrada principal de Taller, con la contraseña a un toque en «Otra forma de entrar», y que el token se renueve solo sin que ninguna pantalla lo note.

**Architecture:** `gt-dcs-session.token` pasa a ser una **seña** fija de la sesión, y el token real vive en `gt-dcs-oauth`. La guarda de `fetch` (`sessionExpiry.ts`), instalada por fuera de la compuerta, cambia la seña por el token vigente, renueva bajo un candado entre pestañas y reintenta una vez tras un 401 de Door43. Los archivos que usan `session.token` no se tocan. El regreso de Door43 se atiende en `main.tsx`, antes de dibujar React.

**Tech Stack:** React 18 + Vite + TypeScript; Web Crypto y Web Locks; pruebas `scripts/verify-*.mts` con `tsx` y `node:assert/strict`; mock de Door43 en `scripts/mock-door43/`.

**Spec:** [`docs/superpowers/specs/2026-11-23-entrar-con-door43-design.md`](../specs/2026-11-23-entrar-con-door43-design.md). Léelo completo antes de la primera tarea: este plan no repite sus razones.

## Global Constraints

- Trabajo de **Idiomas Puentes**: Claude lo hace todo. Nunca se lanza Cursor.
- `scope` = los siete `TOKEN_SCOPES`, unidos con un espacio. PKCE `S256` y `state` en cada entrada. Sin secreto.
- `POST /login/oauth/access_token` siempre **form-encoded** y por `fetchBeforeGate()`. Con JSON, el navegador pide un preflight que Door43 no permite.
- Claves de `localStorage`: `gt-dcs-session`, `gt-dcs-oauth`, `gt-dcs-oauth-flow`, `gt-dcs-last-user`, `gt-dcs-oauth-done`, `gt-dcs-signed-out`.
- Límites: flujo **10 min**, regreso **15 s**, renovación **8 s**, espera del candado **10 s** (`taller-oauth-renew`), margen de renovación **2 min**, reintento tras token usado **2 s**.
- Los tokens nunca se registran ni aparecen en mensajes, errores o detalles técnicos.
- Client ID de QA, que no es secreto: `3793dc63-8be8-4c39-8c36-c93b33256706`. **Producción no lleva Client ID hasta la Tarea 13**, así que ahí no hay botón.
- Código y commits en inglés; interfaz con `useT()` / `tNow()`, en `es.json` y `pt.json`. La pantalla de entrada trata de **usted**.
- No cambies la lógica de guardar borradores (PR #48), ni la entrada desde otra sesión de trabajo (Fase 1).
- `scripts/mock-door43/server.mjs` **no se toca**: Abel tiene ahí cambios sin guardar.
- Pruebas contra el mock o QA. Producción solo en la prueba de la Tarea 13, que hace Abel.
- **Abel autoriza** cada commit inicial, push, PR, merge y publicación. Taller se publica solo con `npm run deploy -- --publish`.
- `verify:prep`, `verify:text-size` y `verify:review-items` ya fallan en `main`. No son de este trabajo.
- En un worktree: crea el enlace a `usfm-ast` (`New-Item -ItemType Junction -Path <repo>\.claude\worktrees\usfm-ast -Target C:\Users\LENOVO\Git\Github\usfm-ast`). `npx tsc`, `tsx` y `vite` usan el `node_modules` de la carpeta principal.

## Review Focus

1. **Volver atrás desde Door43** (el navegador restaura la página desde su caché): el botón no queda en «Entrando…» y se puede tocar otra vez. Prueba en la Tarea 10.
2. **Volver a la app mientras presencia espera un token:** `refresh()` no abre un segundo socket, y `close()` durante la espera no abre ninguno. Prueba en la Tarea 6.
3. **`localStorage` bloqueado o lleno al tocar el botón:** no se navega a Door43 (el regreso se perdería) y se abre la contraseña. Prueba en la Tarea 8.
4. **El reloj del teléfono está mal:** el vencimiento sale de `expires_in`, y si el reloj engaña, el 401 de Door43 renueva igual, sin cerrar la sesión. Prueba en la Tarea 5.
5. **Un regreso con `state` de otro intento** (dos pestañas): no se cambia el código ni se borra el flujo que la otra pestaña está usando. Prueba en la Tarea 9.

## Decisiones de este plan

El diseño dejó estas a quien construya:

- `door43OAuth.ts` se parte: **`door43OAuth.ts`** (la entrada) y **`door43Tokens.ts`** (guardar y renovar).
- El mock de OAuth es **un proceso aparte** delante del mock (`oauth-front.mjs`). Así no hay cruce con los cambios de Abel en `server.mjs`.
- La bienvenida no cambia: su botón abre la pantalla de entrada, que explica «Autorizar» antes de salir a Door43.
- `SESSION_EXPIRED_MESSAGE` sigue igual («Tu sesión…»), porque se usa fuera de esta pantalla y está en el glosario. Solo cambia la clave `signIn.expired`.
- `sw.js` no cambia: guarda la navegación bajo `./`, y un código que se usa una sola vez y exige PKCE no sirve a nadie más.

## Archivos

| Archivo | Qué hace |
|---|---|
| `src/dcs/door43Tokens.ts` (nuevo) | Registro `gt-dcs-oauth`, lectura del JWT, clasificar y hacer la renovación |
| `src/dcs/door43OAuth.ts` (nuevo) | Disponibilidad, PKCE, dirección, inicio, lectura del regreso, cambio del código |
| `src/signInReturn.ts` (nuevo) | El regreso en el arranque: pantalla de carga, 15 s, avisos para `App` |
| `src/firstInteraction.ts` (nuevo) | Si la persona ya tocó o escribió algo en esta carga |
| `src/domain/signInView.ts` (nuevo) | Qué muestra la entrada en cada caso, sin React |
| `src/components/SignedInAs.tsx` (nuevo) | «Entró como… · ¿No es usted?» |
| `src/dcs/sessionExpiry.ts` | Guarda: sustituir, renovar, reintentar |
| `src/dcs/door43Gate.ts` | Expone `isDoor43Url` y `fetchBeforeGate` |
| `src/dcs/auth.ts` | `method`, reglas de escritura, cerrar sesión |
| `src/dcs/presence.ts`, `src/components/usePresence.ts` | Token vigente antes de cada unión |
| `src/main.tsx`, `src/App.tsx`, `src/serverChoice.ts`, `src/devMockSession.ts` | Arranque y conexión |
| `src/components/SignIn.tsx`, `src/index.css`, `es.json`, `pt.json` | La pantalla |
| `taller.config.ts`, `src/config/types.ts`, `docs/CONFIGURACION.md` | Client ID y direcciones |
| `scripts/mock-door43/oauth-front.mjs` (nuevo) | OAuth de prueba delante del mock |
| `scripts/verify-oauth.mts`, `scripts/verify-oauth-mock.mts` (nuevos) | Pruebas |

## Entregas

| Entrega | Tareas | Qué cambia para el equipo |
|---|---|---|
| 1. La guarda en su lugar | 1–2 | Un tropiezo del Worker de avisos ya no saca a nadie |
| 2. Renovar | 3–6 | Nada: no existe aún ninguna sesión OAuth |
| 3. La entrada | 7–11 | Nada en producción. En QA aparece el botón |
| 4. Comprobar en QA con teléfonos | 12 | Abel y quien pruebe, en QA |
| 5. Producción | 13 | El botón aparece para todos, con la contraseña a un toque |
| 6. Prueba con el equipo | 14 | Una semana de trabajo real |

Cada entrega de la 1 a la 3 es un PR propio, y la siguiente empieza después de unirlo. La semana con el equipo va **después** de abrir producción (diseño, sección 7): es la condición para hablar de retirar la contraseña, no para abrir OAuth.

---

## Entrega 1 · La guarda en su lugar

### Task 1: Solo un 401 de Door43 cierra la sesión

**Files:**
- Modify: `src/dcs/door43Gate.ts`, `src/dcs/sessionExpiry.ts`
- Modify: `package.json` (`verify:session-expiry` pasa a usar `--tsconfig tsconfig.scripts.json`, porque la Tarea 5 importa i18n)
- Modify: `scripts/verify-session-expiry.mts` (agrega `fromDoor43: true` a las llamadas de `decideExpiry`)
- Create: `scripts/verify-oauth.mts`

**Interfaces:**
- Produces: `isDoor43Url(url: string): boolean`; `fetchBeforeGate(): typeof fetch`; `decideExpiry({ status, requestToken, sessionToken, expiredTokens, fromDoor43: boolean })`.

- [ ] **Step 1: Crea `scripts/verify-oauth.mts` y el script** `"verify:oauth": "tsx --tsconfig tsconfig.scripts.json scripts/verify-oauth.mts"`, con el arnés `test(name, fn)` de `verify-presence.mts` y estas pruebas:

```ts
await test("reconoce Door43 y el API del mock, y nada más", () => {
  for (const u of ["https://qa.door43.org/api/v1/user", "https://git.door43.org/x", "http://localhost:8787/api/v1/user", "http://localhost:8788/api/v1/user"]) assert.equal(isDoor43Url(u), true, u);
  for (const u of ["https://push.example/notify", "https://evildoor43.org/x", "http://localhost:8787/login/oauth/access_token"]) assert.equal(isDoor43Url(u), false, u);
});
await test("un 401 de otro servidor pasa tal cual y no cierra la sesión", async () => {
  // fetch falso que responde 401; guarda con getSessionToken = T
  const res = await fetch("https://push.example/notify", { headers: { authorization: `token ${T}` } });
  assert.equal(res.status, 401);
  assert.equal(expired, 0);
});
await test("fetchBeforeGate no pasa por la compuerta ni cuenta como escritura", async () => {
  // globalThis.fetch = falso (cuenta llamadas; nunca va a la red); installDoor43Gate(1)
  const url = "https://qa.door43.org/login/oauth/access_token";
  const before = door43Writes();
  await globalThis.fetch(url, { method: "POST" });
  assert.equal(door43Writes(), before + 1, "control: por la compuerta sí cuenta");
  // Con el único lugar ocupado por una petición que no termina:
  const held = globalThis.fetch("https://qa.door43.org/api/v1/espera");
  await fetchBeforeGate()(url, { method: "POST" }); // no espera turno
  assert.equal(door43Writes(), before + 1);
  release(); await held;
});
```

- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA porque `isDoor43Url` no existe.
- [ ] **Step 3: Implementa.** Renombra y exporta `isDoor43` como `isDoor43Url`. `installDoor43Gate` guarda el `fetch` enlazado que tenía, y `fetchBeforeGate()` lo devuelve (o `globalThis.fetch` si no se instaló). En la guarda, `fromDoor43 = isDoor43Url(url)`, y `decideExpiry` responde `"pass"` a un 401 con `fromDoor43: false`.
- [ ] **Step 4: Corre** `npm run verify:oauth` y `npm run verify:session-expiry`. Esperado: pasan.
- [ ] **Step 5: Commit** `Session guard: only a 401 from Door43 ends the session`, con el porqué en el cuerpo: el Worker de avisos responde 401 cuando no logra preguntarle a Door43.

### Task 2: La guarda se instala antes de dibujar

**Files:**
- Modify: `src/dcs/sessionExpiry.ts`, `src/dcs/auth.ts`, `src/main.tsx`, `src/App.tsx:371-384`
- Test: `scripts/verify-oauth.mts`

**Interfaces:**
- Produces: `notifySessionExpired(seal: string): void`; `onSessionExpired(handler: (seal: string) => void): () => void`; `clearSessionIfSeal(seal: string): boolean` (borra solo si la sesión guardada tiene esa seña; devuelve `true` si después no queda sesión).
- `installSessionExpiryGuard`: `onExpired` pasa a recibir la seña.

- [ ] **Step 1: Escribe las pruebas.** Al inicio del archivo, define el almacenamiento falso con `Object.defineProperty(globalThis, "localStorage", { value: fakeStore(), configurable: true })`. `auth.ts` solo lo lee al llamar a sus funciones, así que los `import` estáticos no estorban.

```ts
await test("una caducidad anterior a App se entrega al conectarse, una sola vez", () => {
  notifySessionExpired("s1");
  const a: string[] = []; const off = onSessionExpired((s) => a.push(s));
  assert.deepEqual(a, ["s1"]); off();
  const b: string[] = []; onSessionExpired((s) => b.push(s))();
  assert.deepEqual(b, []);
});
await test("una pestaña vieja no borra la sesión de quien entró después", () => {
  localStorage.setItem("gt-dcs-session", JSON.stringify({ host: "h", username: "bea", token: "B" }));
  assert.equal(clearSessionIfSeal("A"), false);
  assert.equal(loadSession()?.token, "B");
  assert.equal(clearSessionIfSeal("B"), true);
  assert.equal(loadSession(), undefined);
});
```

- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA.
- [ ] **Step 3: Implementa.** En `main.tsx`, justo después de `installDoor43Gate()`: `installSessionExpiryGuard({ getSessionToken: () => loadSession()?.token, onExpired: notifySessionExpired })`. En `App`, el efecto pasa a `onSessionExpired((seal) => { if (!clearSessionIfSeal(seal)) return; setSession(null); setWorkspaceOpen(false); setSessionExpired(true); setSignInOpen(true); })`.
- [ ] **Step 4: Corre** `npm run verify:oauth`, `npm run verify:session-expiry` y `npx tsc --noEmit -p .`. Esperado: pasan.
- [ ] **Step 5: Prueba en el navegador** contra el mock con `?mockUser=ana`: cambia `token` de `gt-dcs-session` por uno inválido, recarga, y se abre «Volver a iniciar sesión» una sola vez.
- [ ] **Step 6: Commit** `Session guard: install before the first render, outside the gate`. **Abre el PR de la Entrega 1 con el OK de Abel.**

---

## Entrega 2 · Renovar

### Task 3: El registro de tokens y las reglas de escritura

**Files:**
- Create: `src/dcs/door43Tokens.ts`
- Modify: `src/dcs/auth.ts`
- Test: `scripts/verify-oauth.mts`

**Interfaces:**

```ts
// door43Tokens.ts (no importa auth.ts)
export type OAuthRecord = { host: string; username: string; seal: string; grantId: number; clientId: string; accessToken: string; refreshToken: string; expiresAt: number };
export type TokenStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function grantOf(jwt: string): number | null;
export function loadOAuthRecord(store?: TokenStore): OAuthRecord | null;
export function saveOAuthRecord(record: OAuthRecord, store?: TokenStore): void;
export function clearOAuthRecord(store?: TokenStore): void;
export function recordFor(requestToken: string, store?: TokenStore): OAuthRecord | null; // mismo gnt

// auth.ts
export type GtSession = { /* … */ method?: "oauth" };
export function lastUser(): string | null;
export function markEntered(login: string): void; // guarda gt-dcs-last-user, borra gt-dcs-signed-out
export function signedOutHere(): boolean;
export function storeOAuthSession(session: GtSession, record: OAuthRecord): void;
```

- [ ] **Step 1: Escribe las pruebas**, con el ayudante `jwt(gnt, n)` (`h.<base64url de {gnt, tt:0, n}>.s`):

```ts
await test("lee el permiso de un JWT y no se rompe con otra cosa", () => {
  assert.equal(grantOf(jwt(7)), 7);
  for (const bad of ["abc123", "a.b.c", "", "h.e30.s"]) assert.equal(grantOf(bad), null);
});
await test("recordFor acepta una seña anterior del mismo permiso y rechaza otra", () => {
  saveOAuthRecord(rec({ grantId: 7, seal: jwt(7, 2) }));
  assert.ok(recordFor(jwt(7, 1)));
  assert.equal(recordFor(jwt(8)), null);
  assert.equal(recordFor("token-de-contraseña"), null);
});
await test("loadSession conserva method", () => { /* guarda method:"oauth"; assert.equal(loadSession()?.method, "oauth") */ });
await test("cerrar sesión borra el registro y deja la última cuenta", () => {
  markEntered("ana"); saveOAuthRecord(rec()); signOut();
  assert.equal(loadOAuthRecord(), null); assert.equal(lastUser(), "ana"); assert.equal(signedOutHere(), true);
});
await test("caducar no cuenta como cerrar sesión", () => { /* clearSessionIfSeal(seña) borra sesión y registro; signedOutHere() === false */ });
await test("enrichSessionRoles no resucita una sesión cerrada mientras leía", async () => {
  // fetch falso de /user/teams que llama signOut() antes de responder
  await enrichSessionRoles(session, "org");
  assert.equal(loadSession(), undefined);
});
await test("refreshUser tampoco resucita una sesión cerrada", async () => { /* igual, con /user */ });
await test("entrar con contraseña borra el registro OAuth", async () => { /* fetch falso; tras signInWithToken, loadOAuthRecord() === null */ });
```

- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA.
- [ ] **Step 3: Implementa.** `loadSession` copia `method`. `grantOf` decodifica el segundo trozo en base64url y exige `gnt` entero positivo. `refreshUser` y `enrichSessionRoles` (las dos ramas) escriben solo si la sesión guardada tiene `next.token`, pero siguen devolviendo `next`: `refreshUser` no tiene llamadores y el único de `enrichSessionRoles` (`App.tsx:424`) ya descarta el resultado si la sesión cambió. `storeOAuthSession` escribe primero el registro y después la sesión. `signOut` borra sesión y registro, y pone `gt-dcs-signed-out`. `clearSessionIfSeal` borra también el registro cuando la seña coincide. `signInWithPassword` y `signInWithToken` llaman a `clearOAuthRecord()` y `markEntered(user.login)`.
- [ ] **Step 4: Corre** `npm run verify:oauth`, `npm run verify:session-expiry` y `npx tsc --noEmit -p .`. Esperado: pasan.
- [ ] **Step 5: Commit** `Session: keep OAuth tokens apart and write only over the same session`.

### Task 4: Renovar una sola vez entre pestañas

**Files:**
- Modify: `src/dcs/door43Tokens.ts`
- Test: `scripts/verify-oauth.mts`

**Interfaces:**

```ts
export type LockLike = { request<T>(name: string, options: { signal: AbortSignal }, fn: () => Promise<T>): Promise<T> };
export type RenewDeps = { fetch: typeof fetch; store: TokenStore; locks: LockLike | null; now: () => number; sleep: (ms: number) => Promise<void> };
export type RenewResult = { kind: "ok"; record: OAuthRecord } | { kind: "transient" } | { kind: "definitive"; seal: string } | { kind: "gone" };
export function classifyRenewal(status: number, body: unknown): "ok" | "used" | "definitive" | "transient";
export function renewAccessToken(usedAccess: string, deps?: Partial<RenewDeps>): Promise<RenewResult>;
export function ensureFresh(record: OAuthRecord, deps?: Partial<RenewDeps>): Promise<RenewResult>; // renueva si quedan < 2 min
export type JoinToken = { kind: "ok"; token: string } | { kind: "transient" } | { kind: "definitive"; seal: string } | { kind: "gone" };
export function tokenForJoin(sessionToken: string, deps?: Partial<RenewDeps>): Promise<JoinToken>;
```

Valores por defecto: `fetchBeforeGate()`, `localStorage`, `navigator.locks ?? null`, `Date.now`, `setTimeout`.

Algoritmo, porque la firma no lo determina:

```text
renewAccessToken(usedAccess):
  en esta pestaña, una sola promesa en curso por usedAccess
  con locks: pedir el candado, esperando 10 s como máximo → al vencer: transient
  sin locks (http en la red local): correr el cuerpo directo; basta la promesa de la pestaña
  dentro del candado (cada intento vuelve a leer el registro y usa su refreshToken):
    r = loadOAuthRecord; sin r → gone
    si r.accessToken ≠ usedAccess → ok con r (otra pestaña ya renovó)
    POST grant_type=refresh_token, client_id, refresh_token; 8 s
    según classifyRenewal:
      ok    → si gt-dcs-session.token y el registro guardado todavía tienen r.seal:
                guarda access, refresh, expiresAt = now + expires_in·1000 → ok
              si no → gone, sin escribir
      used  → relee: si hay un token más nuevo → ok con ese
              si no → espera 2 s y repite una vez; si vuelve a dar used → definitive
      definitive → definitive con r.seal
      transient  → transient
```

- [ ] **Step 1: Escribe las pruebas**, con `fakeLocks()` (cola real entre llamadas), `fakeDoor43()` (cuenta renovaciones) y un `store` compartido:

```ts
await test("clasifica cada respuesta de la tabla", () => {
  const e = (error: string, error_description = "") => ({ error, error_description });
  assert.equal(classifyRenewal(200, { access_token: "a", refresh_token: "r", expires_in: 3600 }), "ok");
  assert.equal(classifyRenewal(200, {}), "transient");
  assert.equal(classifyRenewal(400, e("unauthorized_client", "token was already used")), "used");
  assert.equal(classifyRenewal(400, e("invalid_grant", "cannot increase the grant counter")), "used");
  assert.equal(classifyRenewal(400, e("unauthorized_client", "unable to parse refresh token")), "definitive");
  assert.equal(classifyRenewal(400, e("invalid_grant", "grant does not exist")), "definitive");
  assert.equal(classifyRenewal(400, e("invalid_client")), "definitive");
  for (const [s, b] of [[429, {}], [403, {}], [500, {}], [503, "<html>"], [400, e("invalid_request", "server error")], [400, "<html>"]] as const) assert.equal(classifyRenewal(s, b), "transient");
});
await test("muchos 401 a la vez producen una sola renovación", async () => { /* 20 renewAccessToken(mismo); door43.renewals === 1 */ });
await test("dos pestañas: la segunda usa lo que guardó la primera", async () => { /* dos deps con el mismo store y locks; renewals === 1 */ });
await test("cerrar sesión durante una renovación no escribe nada", async () => { /* el fetch falso llama signOut(); resultado "gone"; loadOAuthRecord() === null */ });
await test("otra persona entró durante la renovación: no se pisa", async () => { /* el fetch falso guarda otra sesión; su registro queda igual */ });
await test("token usado: toma el más nuevo o reintenta una vez a los 2 s", async () => { /* sleep recibe 2000; con dos used → definitive */ });
await test("sin red, 8 s o candado ocupado 10 s: la sesión sigue", async () => { /* transient; el registro no cambia */ });
await test("renovar conserva la seña", async () => { /* record.seal igual y accessToken distinto */ });
await test("sin Web Locks también renueva una sola vez en la pestaña", async () => { /* locks: null; 5 llamadas; renewals === 1 */ });
await test("tokenForJoin con una sesión de contraseña da el mismo token", async () => {
  assert.deepEqual(await tokenForJoin("token-de-contraseña", deps), { kind: "ok", token: "token-de-contraseña" });
  assert.equal(door43.renewals, 0);
});
```

- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA.
- [ ] **Step 3: Implementa** las funciones con el algoritmo de arriba.
- [ ] **Step 4: Corre** `npm run verify:oauth`. Esperado: pasa.
- [ ] **Step 5: Commit** `OAuth: renew once across tabs, telling a lost session from a passing failure`.

### Task 5: La guarda cambia la seña y reintenta

**Files:**
- Modify: `src/dcs/sessionExpiry.ts`, `src/i18n/locales/es.json`, `src/i18n/locales/pt.json`
- Test: `scripts/verify-oauth.mts`

**Interfaces:**
- Consumes: `recordFor`, `ensureFresh`, `renewAccessToken`.
- Produces: `class Door43UnreachableError extends Error` (mensaje `tNow("signIn.offlineRetry")`; `isSessionExpiredError` lo trata como falso). `installSessionExpiryGuard` acepta `oauth?: Partial<RenewDeps>`.

```text
guarded(input, init):
  X = token de la petición; si X ya caducó → SessionExpiredError
  r = X ? recordFor(X) : null
  sin r → el camino de hoy
  copia un Request antes del primer envío
  f = ensureFresh(r): definitive o gone → caducar(r.seal); ok → r = f.record; transient → sigue con r
  res = enviar con r.accessToken, al mismo destino
  si res no es 401, o no es de Door43, o el cuerpo es un stream → devuelve res
  n = renewAccessToken(r.accessToken)
    transient → Door43UnreachableError; definitive o gone → caducar(r.seal)
  res2 = reenviar con n.record.accessToken
  res2 es 401 → caducar(n.record.seal); si no → devuelve res2

caducar(seal): agrega X y seal a expiredTokens, llama onExpired(seal) una vez, lanza SessionExpiredError
```

`gone` significa que otra pestaña cerró la sesión o que entró otra persona. `App` ya lo resuelve con `clearSessionIfSeal`: si queda la sesión de otra persona, no la toca.

- [ ] **Step 1: Escribe las pruebas:**

```ts
await test("cambia la seña por el token vigente, conservando la cabecera", async () => { /* con { authorization } en minúsculas, Headers, arreglo y Request; el servidor ve el vigente */ });
await test("una sesión con contraseña no se toca", async () => { /* el servidor ve el mismo token; 0 renovaciones */ });
await test("renueva antes si quedan menos de 2 minutos", async () => { /* 1 renovación, la petición sale con el nuevo */ });
await test("un 401 renueva y reintenta una sola vez, con el mismo cuerpo", async () => { /* POST con body; 2 envíos y body igual */ });
await test("un segundo 401 cierra la sesión una vez", async () => { /* SessionExpiredError; expired === 1 */ });
await test("el reloj adelantado no cierra la sesión", async () => { /* expiresAt futuro, Door43 da 401; renueva y responde 200 */ });
await test("un 401 sin red para renovar no cierra la sesión", async () => {
  await assert.rejects(call(), Door43UnreachableError);
  assert.equal(expired, 0); assert.ok(loadOAuthRecord());
});
await test("un 429 o una página HTML al renovar no cierra la sesión", async () => { /* igual */ });
await test("otra pestaña cerró sesión durante el 401: caduca sin escribir", async () => { /* SessionExpiredError; onExpired con la seña; sin registro nuevo */ });
await test("el 401 de un Worker no renueva", async () => { /* 0 renovaciones; res.status === 401; expired === 0 */ });
await test("la renovación no cuenta como escritura", async () => { /* door43Writes() igual */ });
await test("ningún error muestra un token", async () => { /* message y technicalDetail no contienen la seña ni el token */ });
```

- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA.
- [ ] **Step 3: Implementa** con el algoritmo de arriba, y añade `signIn.offlineRetry` (tabla de la Tarea 10).
- [ ] **Step 4: Corre** `npm run verify:oauth`, `npm run verify:session-expiry`, `npm run verify:config` y `npx tsc --noEmit -p .`. Esperado: pasan.
- [ ] **Step 5: Commit** `Session guard: send the current OAuth token and retry once after a 401`.

### Task 6: Presencia pide un token vigente

**Files:**
- Modify: `src/dcs/presence.ts`, `src/components/usePresence.ts`
- Test: `scripts/verify-presence.mts`

**Interfaces:**
- `connectPresence({ …, getToken?: () => Promise<JoinToken>, onSessionExpired?: (seal: string) => void })`. **Sin `getToken` sigue síncrono**, como esperan las pruebas actuales.
- `usePresence` pasa `getToken: () => tokenForJoin(p.session.token)` y `onSessionExpired: notifySessionExpired`.

- [ ] **Step 1: Escribe las pruebas** en `verify-presence.mts`:

```ts
await test("pide el token antes de abrir y se une con el vigente", async () => { /* getToken → "nuevo"; auth.token === "nuevo" */ });
await test("cada reconexión vuelve a pedir el token", async () => { /* tras drop, 2 llamadas a getToken */ });
await test("un fallo pasajero cuenta como intento y reintenta con la espera", async () => { /* no abre socket; a 1 s pide de nuevo */ });
await test("un fallo definitivo avisa y deja de intentar", async () => { /* onSessionExpired("s"); 0 sockets */ });
await test("refresh mientras espera el token no abre un segundo socket", async () => { /* getToken pendiente, refresh(), resolver: 1 socket */ });
await test("close mientras espera el token no abre ninguno", async () => { /* 0 sockets */ });
```

- [ ] **Step 2: Corre** `npm run verify:presence`. Esperado: FALLA.
- [ ] **Step 3: Implementa.** Agrega `waitingToken: boolean`. Con `getToken`, `connect` lo pone en `true`, espera el token **antes** de `open(address)` y lo devuelve a `false`; si entonces hay `stopped`, no abre. `transient` suma a `failed` y programa el reintento con la lógica de `onclose`, extraída a una función (incluido pasar a `"resting"` tras 8 fallos). `definitive` y `gone` ponen `stopped = "denied"`; `definitive` llama además a `onSessionExpired`. `refresh()` con `waitingToken` solo reinicia `wait` y `failed`, y vuelve: el intento en curso ya va a conectar.
- [ ] **Step 4: Corre** `npm run verify:presence`, `npm run verify:oauth` y `npx tsc --noEmit -p .`. Esperado: pasan.
- [ ] **Step 5: Commit** `Presence: ask for a current token before each join`. **Abre el PR de la Entrega 2 con el OK de Abel.**

---

## Entrega 3 · La entrada

### Task 7: OAuth de prueba delante del mock

**Files:**
- Create: `scripts/mock-door43/oauth-front.mjs`, `scripts/verify-oauth-mock.mts`
- Modify: `package.json` (`mock:door43-oauth`, `verify:oauth-mock`)

**Interfaces:**
- Variables: `MOCK_OAUTH_PORT` (8788), `MOCK_TARGET` (`http://localhost:8787`), `MOCK_OAUTH_TTL_S` (3600). Client ID: `taller-mock`.
- `GET /login/oauth/authorize`: exige `client_id`, `redirect_uri` y `code_challenge_method=S256`. Muestra una página con ana, bea, carla y «Cancelar», que vuelven a `redirect_uri` con `code` y `state`, o con `error=access_denied` y `state`.
- `POST /login/oauth/access_token`: solo form-encoded, con PKCE real. Responde como Door43: `{ access_token, token_type: "bearer", expires_in, refresh_token }` o 400 con `{ error, error_description }`. Tokens JWT con `gnt`. Un permiso por persona.
- Control: `POST /__oauth/expire` (vence los de acceso), `/__oauth/revoke` (borra los permisos), `/__oauth/invalidate?on=1` (rechaza los usados con «token was already used»; con `&mode=counter`, `invalid_grant` «cannot increase the grant counter»), `/__oauth/fail?status=503&n=1` (las próximas N renovaciones).
- Todo lo demás va a `MOCK_TARGET`, con CORS. Un JWT válido se cambia por `token-<login>`; uno vencido o desconocido en `/api/v1/*` recibe 401.

- [ ] **Step 1: Escribe `verify-oauth-mock.mts`**, que arranca el mock y el frente en puertos libres, con estos casos: flujo completo con PKCE y `/user` da `ana`; `code_verifier` incorrecto da 400; el código no sirve dos veces; `/__oauth/expire` hace que `/user` dé 401 y la renovación lo arregle; con `invalidate`, un token usado da `unauthorized_client` «token was already used»; tras `revoke`, renovar da `invalid_grant`.
- [ ] **Step 2: Corre** `npm run verify:oauth-mock`. Esperado: FALLA porque el frente no existe.
- [ ] **Step 3: Implementa** `oauth-front.mjs` solo con `node:http` y `node:crypto`.
- [ ] **Step 4: Corre** `npm run verify:oauth-mock`. Esperado: pasa. `git status` no muestra `server.mjs`.
- [ ] **Step 5: Commit** `Mock: a Door43 OAuth front for trying the sign-in`.

### Task 8: Empezar la entrada

**Files:**
- Create: `src/dcs/door43OAuth.ts`
- Modify: `src/config/types.ts`, `taller.config.ts`, `docs/CONFIGURACION.md`
- Test: `scripts/verify-oauth.mts`

**Interfaces:**

```ts
// types.ts — TallerConfig
oauth?: { appName: string; clients: Record<string, string>; origins: string[] };

// taller.config.ts
oauth: {
  appName: "Taller", // como está registrada: la pantalla de Door43 muestra este nombre, también en portugués
  clients: { "https://qa.door43.org": "3793dc63-8be8-4c39-8c36-c93b33256706" },
  origins: ["https://taller.idiomaspuentes.org/", "https://taller-b2h.pages.dev/", "http://localhost/"],
},

// door43OAuth.ts
export type SignInEnv = { origin: string; baseUrl: string; secure: boolean; dev: boolean };
export type OAuthFlow = { verifier: string; state: string; host: string; clientId: string; redirectUri: string; route: string; at: number };
export function door43SignIn(host: string, env?: SignInEnv, config?: TallerConfig["oauth"]): { clientId: string; redirectUri: string } | null;
export function challengeFor(verifier: string): Promise<string>;
export function authorizeUrl(host: string, clientId: string, redirectUri: string, state: string, challenge: string): string;
export function startDoor43SignIn(host: string, route: string, deps?: { store?: TokenStore; go?: (url: string) => void; env?: SignInEnv; now?: () => number }): Promise<boolean>;
```

`door43SignIn` es **el único lugar** que decide si se ofrece el botón (diseño, sección 3).

- [ ] **Step 1: Escribe las pruebas:**

```ts
await test("PKCE con el vector del RFC 7636", async () => {
  assert.equal(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});
await test("el botón sale solo con aplicación y dirección registradas", () => {
  const e = (origin: string, secure = true, dev = false) => ({ origin, baseUrl: "/", secure, dev });
  assert.equal(door43SignIn(QA_HOST, e("https://taller.idiomaspuentes.org"), cfg)?.redirectUri, "https://taller.idiomaspuentes.org/");
  assert.equal(door43SignIn(QA_HOST, e("http://localhost:5183", true, true), cfg)?.redirectUri, "http://localhost:5183/");
  assert.equal(door43SignIn(PRODUCTION_HOST, e("https://taller.idiomaspuentes.org"), cfg), null);
  assert.equal(door43SignIn(QA_HOST, e("https://abc.taller-b2h.pages.dev"), cfg), null);
  assert.equal(door43SignIn(QA_HOST, e("http://192.168.1.5:5177", false, true), cfg), null);
  assert.equal(door43SignIn("http://localhost:8788", e("http://localhost:5183", true, true), cfg)?.clientId, "taller-mock");
  assert.equal(door43SignIn("http://localhost:8788", e("http://localhost:5183", true, false), cfg), null);
});
await test("la dirección lleva los siete permisos y S256", () => {
  const q = new URL(authorizeUrl(QA_HOST, "id", "https://a/", "st", "ch")).searchParams;
  assert.equal(q.get("scope"), TOKEN_SCOPES.join(" "));
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("code_challenge_method"), "S256");
});
await test("guarda el flujo antes de salir, con servidor y ruta", async () => { /* go recibe la URL; el flujo tiene host y route "#/mis-tareas" */ });
await test("con localStorage bloqueado no navega", async () => {
  assert.equal(await startDoor43SignIn(QA_HOST, "#/x", { store: throwingStore, go, env }), false);
  assert.equal(went, 0);
});
```

- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA.
- [ ] **Step 3: Implementa.** `verifier` y `state` con `crypto.getRandomValues` (32 bytes, base64url). El entorno por defecto usa `location.origin`, `isSecureContext && !!crypto.subtle`, y `BASE_URL` y `DEV` leídos con `(import.meta as { env?: … }).env?.…`, como `dcs/config.ts`, porque bajo `tsx` no existe `import.meta.env`. El cliente `taller-mock` vale solo con `dev` y un host `localhost`. Añade a `docs/CONFIGURACION.md` cómo registrar la aplicación y qué significa `oauth`.
- [ ] **Step 4: Corre** `npm run verify:oauth`, `npm run verify:config`, `npm run verify:decoupling` y `npx tsc --noEmit -p .`. Esperado: pasan.
- [ ] **Step 5: Commit** `OAuth: decide where it is offered and start the sign-in`.

### Task 9: El regreso, antes de dibujar

**Files:**
- Create: `src/signInReturn.ts`
- Modify: `src/dcs/door43OAuth.ts`, `src/main.tsx`, `src/serverChoice.ts`, `src/devMockSession.ts`, `src/index.css`
- Test: `scripts/verify-oauth.mts`

**Interfaces:**

```ts
// door43OAuth.ts
export type ReturnAction =
  | { kind: "none" } | { kind: "exchange"; code: string; flow: OAuthFlow }
  | { kind: "cancelled"; flow: OAuthFlow | null } | { kind: "failed"; flow: OAuthFlow | null }
  | { kind: "lost" } | { kind: "unfinished" };
export function readReturn(search: string, flow: OAuthFlow | null, hasSession: boolean, now: number): ReturnAction;
export function completeDoor43SignIn(flow: OAuthFlow, code: string, deps: { signal: AbortSignal; fetch?: typeof fetch }): Promise<GtSession>;

// signInReturn.ts
export type SignInNotice = "cancelled" | "failed" | "lost" | "unfinished"; // "cancelled" abre la entrada, sin mensaje
export type ReturnDeps = { search: string; pathname: string; replaceUrl: (url: string) => void; store: TokenStore; root: HTMLElement | null; now: () => number; timeoutMs: number; fetch: typeof fetch };
export function beginSignInReturn(deps?: Partial<ReturnDeps>): Promise<void> | null; // la promesa nunca rechaza
export function takeSignInNotice(): SignInNotice | null;
export function takeEnteredAs(): string | null; // lo que dejó el regreso: el login si era la primera cuenta o una distinta de la anterior; se consume una vez

// serverChoice.ts
export function forceHost(host: string): void;
// devMockSession.ts
export function applyMockServerFromUrl(): void; // solo en desarrollo: ?mockServer=8788 → forceHost("http://localhost:8788") y quita el parámetro
```

Tabla de `readReturn`:

| Dirección | Flujo guardado | Sesión | Resultado |
|---|---|---|---|
| sin `code` ni `error` | ninguno o vencido | — | `none` |
| sin `code` ni `error` | vigente | sí | `none` |
| sin `code` ni `error` | vigente | no | `unfinished` |
| `code` + `state` igual | vigente | — | `exchange` |
| `code` | ninguno, vencido o `state` distinto | — | `lost` |
| `error=access_denied` | `state` igual | — | `cancelled` con flujo |
| otro `error` | `state` igual | — | `failed` con flujo |
| `error` | `state` distinto | — | el mismo tipo, con `flow: null` |

- [ ] **Step 1: Escribe las pruebas:** una por fila de la tabla, y además:

```ts
await test("limpia la dirección antes de todo y pone la ruta guardada", async () => { /* replaceUrl recibe "/#/tarea/3", sin code ni state, antes del primer fetch */ });
await test("a applyServerFromUrl no le queda nada que cambiar", async () => {
  // regreso con ?code&state&server=production y flujo de QA
  assert.equal(new URL(replaced, "http://x").search, "");
  assert.equal(forcedHost(), QA_HOST);
});
await test("no crea tokens ni cierra otras sesiones", async () => { /* ninguna llamada a /users/<login>/tokens */ });
await test("un token sin permiso legible no abre sesión", async () => { /* access_token "abc": aviso "failed"; loadSession() === undefined */ });
await test("un fallo del cambio no rechaza y deja el aviso", async () => { /* fetch que lanza; await no lanza; takeSignInNotice() === "failed" */ });
await test("cancelar abre la entrada sin mensaje", async () => { /* error=access_denied → "cancelled" */ });
await test("el flujo se borra antes del cambio, y solo si era suyo", async () => { /* con state distinto el flujo sigue ahí */ });
await test("guarda la sesión con scopes actuales y la seña fija", async () => {
  const s = await completeDoor43SignIn(flow, "c", deps);
  assert.equal(s.method, "oauth"); assert.equal(sessionNeedsReauth(s), false);
  assert.equal(loadOAuthRecord()?.seal, s.token); assert.equal(loadOAuthRecord()?.grantId, 7);
});
await test("el servidor del flujo gana sobre el que parezca activo", async () => { /* forcedHost() === flow.host */ });
await test("a los 15 s cancela y una respuesta tardía no guarda nada", async () => { /* signal.aborted; loadSession() === undefined; aviso "failed" */ });
await test("otra cuenta sale en «Entró como», la misma no", async () => { /* last=ana: bea → "bea"; ana → null; sin last → login */ });
await test("un flujo pendiente sin código avisa sin borrarlo", () => { /* notice "unfinished"; el flujo sigue */ });
```

- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA.
- [ ] **Step 3: Implementa.** `beginSignInReturn` hace lo síncrono primero (`readReturn`, `history.replaceState`, borrar el flujo si era suyo). Solo con `exchange` muestra en `#root` la pantalla de carga, sin React, con `tNow("signIn.busy")`, y devuelve la promesa. El intercambio y `/user` usan `fetchBeforeGate()` con cabecera explícita y el `signal` de un `AbortController` que vence a los 15 s. **`/user` no usa `getAuthenticatedUser`:** pasaría por la guarda, que cambiaría el token nuevo por el viejo del mismo permiso. Comprueba `signal.aborted` antes de guardar, y captura todo error como aviso `failed`. Al terminar: lee `lastUser()` **antes** de `markEntered`, compara en minúsculas y deja en una variable del módulo el login si no había cuenta anterior o era otra (`null` si es la misma); después `storeOAuthSession`, `markEntered`, `gt-dcs-oauth-done`, `forceHost(flow.host)` y, si hay `loadContext()`, `saveContext({ ...ctx, host: flow.host })`. Sin contexto guardado, el primer efecto de `App` (`App.tsx:392`) lo escribe con el servidor forzado. `applyMockSessionFromUrl` borra además `gt-dcs-oauth`. Orden en `main.tsx`:

```ts
installDoor43Gate();
installSessionExpiryGuard({ getSessionToken: () => loadSession()?.token, onExpired: notifySessionExpired });
applyTextSize();
const returning = beginSignInReturn();
const start = () => { applyMockSessionFromUrl(); applyMockServerFromUrl(); applyServerFromUrl(); startManifest(); installTypingMode(); createRoot(/* … */).render(/* … */); };
if (returning) void returning.finally(start); else start();
```

- [ ] **Step 4: Corre** `npm run verify:oauth`, `npm run verify:scope` y `npx tsc --noEmit -p .`. Esperado: pasan.
- [ ] **Step 5: Commit** `OAuth: handle the return before the first render`.

### Task 10: La pantalla de entrada

**Files:**
- Create: `src/domain/signInView.ts`
- Modify: `src/components/SignIn.tsx`, `src/App.tsx`, `src/index.css`, `es.json`, `pt.json`
- Test: `scripts/verify-oauth.mts`

**Interfaces:**

```ts
export type SignInViewInput = { available: boolean; sessionExpired: boolean; interacted: boolean; notice: SignInNotice | null; door43Done: boolean; signedOut: boolean };
export type SignInViewResult = {
  primary: "door43" | "password";       // el único botón lleno
  passwordOpen: boolean;
  message: "signIn.door43Failed" | "signIn.otherBrowser" | "signIn.unfinished" | "signIn.expired" | null;
  authorizeHint: boolean;
  otherPerson: boolean;
  door43Link: boolean;                  // «Entrar con Door43» como enlace, con signIn.reopenNote
};
export function signInView(input: SignInViewInput): SignInViewResult;
```

Se evalúa en este orden y gana la primera fila que aplique. `authorizeHint` es `!door43Done` en toda fila con `primary: door43`, y falso en las demás. Los campos no marcados son falsos o `null`.

| Orden | Caso | `primary` | `passwordOpen` | `message` | Otros |
|---|---|---|---|---|---|
| 1 | `!available` y `sessionExpired` | password | sí | `expired` | |
| 2 | `!available` | password | sí | — | |
| 3 | `notice: failed` | door43 («Intentar otra vez») | sí | `door43Failed` | |
| 4 | `notice: unfinished` | door43 («Intentar otra vez») | sí | `unfinished` | |
| 5 | `notice: lost` | door43 | no | `otherBrowser` | |
| 6 | `sessionExpired` e `interacted` | password | sí | `expired` | `door43Link` |
| 7 | `sessionExpired` | door43 | no | `expired` | |
| 8 | `signedOut` | door43 | no | — | `otherPerson` |
| 9 | Normal, o `notice: cancelled` | door43 | no | — | |

Texto:

| Clave | es | pt |
|---|---|---|
| `signIn.heading` | Entre con su cuenta de Door43 | Entre com sua conta do Door43 |
| `signIn.door43` | Entrar con Door43 | Entrar com Door43 |
| `signIn.authorizeHint` | Door43 le preguntará si autoriza a {app}. Toque «Autorizar» para guardar su trabajo desde aquí. | O Door43 perguntará se você autoriza o {app}. Toque em «Autorizar» para guardar seu trabalho a partir daqui. |
| `signIn.otherWay` | Otra forma de entrar | Outra forma de entrar |
| `signIn.otherPerson` | ¿Es otra persona? Use Otra forma de entrar | É outra pessoa? Use Outra forma de entrar |
| `signIn.door43Failed` | No se pudo entrar con Door43. | Não foi possível entrar com o Door43. |
| `signIn.tryAgain` | Intentar otra vez | Tentar de novo |
| `signIn.otherBrowser` | Abra {app} desde su icono y toque otra vez Entrar con Door43. | Abra o {app} pelo ícone e toque de novo em Entrar com Door43. |
| `signIn.unfinished` | No se terminó la entrada con Door43 | A entrada com o Door43 não foi concluída |
| `signIn.reopenNote` | Esta pantalla se volverá a abrir | Esta tela será aberta de novo |
| `signIn.signedInAs` | Entró como {user} | Entrou como {user} |
| `signIn.notYou` | ¿No es usted? | Não é você? |
| `signIn.offlineRetry` | No hay conexión con Door43. Intente de nuevo en un momento. | Sem conexão com o Door43. Tente de novo em instantes. |
| `signIn.expired` | Su sesión caducó. Vuelva a iniciar sesión. | (sin cambio) |
| `signIn.forgot` | ¿Olvidó su contraseña? | (sin cambio) |

También pasan a «usted» en español: `signIn.reauth`, `signIn.devProd`, `signIn.permsToken`, `signIn.session` y `signIn.trust`. En `authorizeHint`, `{app}` es `tallerConfig.oauth.appName`, porque debe coincidir con lo que muestra Door43. En `otherBrowser` es `appName(idioma)`, el nombre del icono.

- [ ] **Step 1: Escribe una prueba por fila** de la tabla de `signInView`, con `assert.deepEqual` del resultado completo.
- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA.
- [ ] **Step 3: Implementa `signInView`.** En `SignInModal`, sin cambiar la lógica de contraseña y token, dibuja según su resultado. «Otra forma de entrar» abre los campos en la misma ventana. El botón llama a `startDoor43SignIn(host, location.hash)`; si devuelve `false`, abre la contraseña con `signIn.door43Failed`. Un `pageshow` con `persisted` quita el estado «Entrando…». `App` abre la ventana si `takeSignInNotice()` trajo cualquier aviso, también `cancelled`.
- [ ] **Step 4: Corre** `npm run verify:oauth`, `npm run verify:config` y `npx tsc --noEmit -p .`. Esperado: pasan.
- [ ] **Step 5: Prueba en el navegador** con `npm run mock:door43`, `npm run mock:door43-oauth` y `npm run dev`, abriendo `/?mockServer=8788`, a 375 px y en escritorio, en español y portugués:
  - entrar y volver a la pantalla donde se estaba;
  - cancelar: la entrada, sin mensaje de error;
  - **volver atrás desde la página del mock: el botón responde**;
  - «Otra forma de entrar» con `clave-ana`;
  - pasar la lista de `docs/FILOSOFIA_DE_DISENO.md`, con un solo botón lleno.
- [ ] **Step 6: Commit** `Sign-in: Door43 first, the password one tap away`.

### Task 11: Quién entró y qué pasa si caduca

**Files:**
- Create: `src/firstInteraction.ts`, `src/components/SignedInAs.tsx`
- Modify: `src/main.tsx`, `src/App.tsx`, `src/components/SignIn.tsx`, `src/index.css`
- Test: `scripts/verify-oauth.mts`

**Interfaces:**
- `watchFirstInteraction(target?: EventTarget): void`; `interactedThisLoad(): boolean`. Escucha en captura `pointerdown`, `keydown`, `beforeinput` e `input`.
- `signedInLineStays(touched: boolean, elapsedMs: number): boolean`: falso solo si ya hubo un toque **y** pasaron 15 s.
- `<SignedInAs username onNotYou />`. «¿No es usted?» llama a `signOut()`, `setSession(null)` y abre la entrada con «Otra forma de entrar» desplegada (`startWithPassword` en `SignInModal`).

- [ ] **Step 1: Escribe las pruebas:**

```ts
await test("cualquiera de los cuatro eventos cuenta como interacción", () => { /* un EventTarget por evento */ });
await test("la línea queda hasta el primer toque o 15 s, lo que tarde más", () => {
  assert.equal(signedInLineStays(false, 60_000), true);
  assert.equal(signedInLineStays(true, 14_999), true);
  assert.equal(signedInLineStays(true, 15_000), false);
});
```

- [ ] **Step 2: Corre** `npm run verify:oauth`. Esperado: FALLA.
- [ ] **Step 3: Implementa.** En `main.tsx`, llama a `watchFirstInteraction()` justo después de instalar la guarda, y pasa `interactedThisLoad()` a `signInView`.
- [ ] **Step 4: Corre** `npm run verify:oauth`, `npm run verify:session-expiry`, `npm run verify:presence`, `npm run verify:config`, `npm run verify:decoupling`, `npx tsc --noEmit -p .` y `npm run build`. Esperado: pasan. Busca `console.` en `door43Tokens.ts`, `door43OAuth.ts` y `signInReturn.ts`: no debe haber ninguno que reciba un token.
- [ ] **Step 5: Prueba en el navegador** con el mock, a 375 px y en escritorio, en español y portugués, con la lista de `docs/FILOSOFIA_DE_DISENO.md`:
  - entrar como bea tras ana: sale «Entró como bea», y «¿No es usted?» lleva a la contraseña;
  - `POST /__oauth/expire` con la app abierta: sigue trabajando, sin recargar ninguna pantalla;
  - `POST /__oauth/revoke` **sin** haber tocado nada tras recargar: entrada normal con «Su sesión caducó»;
  - `revoke` **después** de escribir en un comentario: ventana con contraseña sobre la pantalla, y el texto sigue ahí al entrar;
  - `/__oauth/fail?status=503&n=5` con el token vencido: la sesión sigue;
  - dos pestañas tras `expire`: una sola renovación en la red.
- [ ] **Step 6: Commit** `Sign-in: say who came back, and keep what was typed when a session ends`. **Abre el PR de la Entrega 3 con el OK de Abel, y avísale** del cruce de abajo.

> **Antes de unir cualquier PR:** Abel tiene cambios sin guardar en la carpeta principal. Este trabajo no toca `server.mjs`, así que un `git pull` no debería chocar con ellos. Compruébalo con `git diff --name-only origin/main...HEAD`.

---

## Entrega 4 · Comprobar en QA con teléfonos

### Task 12: QA con personas reales

Esta tarea la hacen Abel y quien pruebe. Claude prepara, acompaña y anota.

- [ ] **Step 0: Pregunta a Abel** qué teléfono usó en la prueba del 23-11 y quién del equipo tiene iPhone. Anótalo en `docs/PLAN.md`.
- [ ] **Step 1: Abel agrega en la aplicación de QA** las direcciones `http://localhost/`, `https://taller.idiomaspuentes.org/` y `https://taller-b2h.pages.dev/`. Comprueba además que siga como cliente público, con `skip_secondary_authorization` activado, y cámbiale el nombre a `Taller`, para que coincida con lo que dice la entrada.
- [ ] **Step 2: Claude comprueba en QA desde el navegador**, con la sesión que inicie Abel, que entra desde `http://localhost:<puerto>/?server=qa`.
- [ ] **Step 3: Con el OK de Abel,** `npm run deploy -- --publish`. Producción sigue sin botón: compruébalo en `https://taller.idiomaspuentes.org/` antes de seguir.
- [ ] **Step 4: Pruebas en `https://taller-b2h.pages.dev/?server=qa`,** en la app instalada. Anota el modelo de cada teléfono:

| Lo que el diseño no comprobó | Cómo se comprueba | Pasa si |
|---|---|---|
| Primera autorización en un teléfono | Una cuenta que nunca autorizó | Toca «Autorizar» y vuelve a la app |
| iPhone | Lo mismo en un iPhone, si alguien del equipo lo usa | Vuelve a la app instalada y entra |
| Salir de Door43 sin terminar | Sin sesión en Door43, salir de su página y abrir el icono | Ve la entrada con su aviso |
| Token vencido de verdad | Dejar la app abierta más de una hora y guardar algo | Se guarda, sin pedir entrar |
| Avisos de punta a punta | Tras una hora, activar avisos y provocar uno | Llega el aviso |
| Presencia de punta a punta | Tras una hora, dos personas en la misma subtarea | Se ven |
| Corte de internet | Modo avión al renovar, y volver | La sesión sigue |
| Teléfono y computadora | La misma cuenta en los dos, un día | Ninguno saca al otro |

- [ ] **Step 5: Si el regreso falla en iPhone,** cambia solo `door43SignIn` para que la app instalada en iPhone use la contraseña como entrada principal, y **consulta a Abel** antes de pensar en el Worker (plan B del diseño).
- [ ] **Step 6: Criterio de salida:** todas las filas de la tabla pasan en los teléfonos disponibles, incluido un iPhone si alguien del equipo lo usa. Si nadie lo usa, anótalo así en `docs/PLAN.md`.

---

## Entrega 5 · Producción

### Task 13: Abrir la entrada en producción

Abel registra e inicia sesión. Claude prepara los datos y no escribe credenciales.

- [ ] **Step 1: Abel decide qué organización** es dueña de la aplicación.
- [ ] **Step 2: Abel registra en esa organización** una aplicación OAuth en `git.door43.org`: nombre `Taller`; cliente público (sin marcar «confidential»); direcciones `https://taller.idiomaspuentes.org/` y `https://taller-b2h.pages.dev/`, más `http://localhost/` **solo para el paso 3**; `skip_secondary_authorization` activado.
- [ ] **Step 3: Prueba única de Abel** con `.claude/relevos/2026-11-23-oauth-pruebas/escritorio/index.html`, cambiando `HOST` y el Client ID. Solo lee y renueva. Debe mostrar: token de 1 hora, renovación de unos 30 días, y que **el token de renovación anterior sigue sirviendo**.
- [ ] **Step 4: Si producción invalida los tokens usados, detente.** OAuth no se abre ahí hasta hablarlo con quien administra Door43.
- [ ] **Step 5: Abel quita `http://localhost/`** de la aplicación de producción.
- [ ] **Step 6: Agrega el Client ID** a `oauth.clients` con la clave `https://git.door43.org`. Corre `npm run verify:oauth`, `npm run verify:config` y `npm run build`. Actualiza la prueba de «el botón sale solo con…», porque producción ya tiene aplicación.
- [ ] **Step 7: Commit, PR y, con el OK de Abel,** `npm run deploy -- --publish`.
- [ ] **Step 8: Abel entra en producción desde su teléfono** y confirma que vuelve a la pantalla donde estaba.
- [ ] **Step 9: Limpieza, con el OK de Abel:** borrar el proyecto de Cloudflare `taller-oauth-prueba`, quitar su dirección de la aplicación de QA, y actualizar `docs/PLAN.md` y `docs/PLATAFORMA.md`.

---

## Entrega 6 · Prueba con el equipo

### Task 14: Una semana de trabajo real

- [ ] **Step 1: Tres personas del equipo** entran con Door43 en sus propios teléfonos, con un iPhone si alguien lo usa, y trabajan una semana. La contraseña sigue a un toque.
- [ ] **Step 2: Abel y Claude anotan** en `docs/PLAN.md` quién probó, en qué teléfono, y si alguien quedó fuera o perdió texto.
- [ ] **Step 3: Criterio de salida:** una semana sin que nadie quede fuera. Retirar la contraseña es una decisión aparte de Abel y **no** es parte de este plan; antes habría que resolver cambiar de cuenta en un teléfono compartido y volver a entrar sin perder lo escrito.
