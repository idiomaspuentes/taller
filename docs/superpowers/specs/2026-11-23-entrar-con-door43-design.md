# Entrar con Door43 (OAuth) en Taller

*23 de noviembre de 2026. **Aprobado por Abel el 23-11**, con las cuatro recomendaciones de la sección 8. Todavía no se ha escrito código de la app.*

Trabajo de **Idiomas Puentes**: Claude lo hace todo y no se usa Cursor.

## 1. Qué se quiere y por qué

Abel decidió el 23-11 que **«Entrar con Door43» sea la entrada principal de Taller** y que la contraseña se quede como **«Otra forma de entrar»** hasta probar la nueva entrada con el equipo en teléfonos reales.

Las razones son tres:

- La contraseña deja de pasar por Taller.
- Quien ya tiene abierta su sesión de Door43 entra casi con un toque.
- Desaparece el límite de sesiones por cuenta, que hoy obliga a cerrar la menos usada.

### Metas

- Una persona poco hábil con la tecnología entra desde el teléfono con una sola cosa obvia que hacer.
- Vuelve a la app instalada, a la pantalla donde estaba.
- Una vez dentro, no vuelve a pensar en la sesión: el token se renueva solo, con varias pestañas y varios aparatos.
- Quien ya tiene sesión con contraseña sigue dentro, sin notar nada.
- Si la entrada nueva falla, la persona llega a la contraseña sin quedarse atrapada.

### Lo que no se hace ahora

- No se retira la contraseña ni la entrada con token.
- No se crea un servidor propio para la entrada.
- No se cambia cómo los 89 archivos que usan `session.token` hablan con Door43.
- No se mueve a nadie a la entrada nueva a la fuerza.

### Sería un fracaso, aunque técnicamente funcione

- Que un corte de internet saque a alguien de su sesión.
- Que se pierda texto sin guardar por tener que volver a entrar.
- Que el teléfono y la computadora de la misma persona se saquen uno al otro.
- Que las pantallas se recarguen solas cada hora al renovarse el token.
- Que alguien se quede en una pantalla de Door43 sin saber cómo volver.

## 2. Lo comprobado

Se usó una aplicación de prueba registrada por Abel en QA (`28.3.3+dcs.41`), como cliente público, sin secreto. Ninguna prueba cambió datos: las de escritura apuntaron a cosas que no existen.

### Medido en QA

| Pregunta | Resultado |
|---|---|
| ¿Se cambia el código por el token desde el navegador, con PKCE y sin secreto? | Sí, con `POST` form-encoded y CORS |
| ¿La API acepta `Authorization: token <jwt>`? | Sí |
| ¿Se respetan los permisos pedidos? | Sí. Los siete de `TOKEN_SCOPES` funcionan; `read:package` y `write:package`, no pedidos, dan 403 |
| ¿Cuánto dura el token de acceso? | 3600 s (1 hora) |
| ¿Cuánto dura el de renovación? | 2 628 000 s (730 horas, unos 30 días). Cada renovación da otros 30 días |
| ¿La renovación recibe CORS? | Sí |
| ¿El token de renovación cambia? | Sí, llega uno nuevo cada vez |
| ¿El anterior deja de servir? | No, sigue funcionando. QA no invalida los usados |
| ¿El token de acceso anterior sigue vivo tras renovar? | Sí, hasta que vence |
| Dos pestañas renovando a la vez | Las dos reciben 200 |
| Un segundo aparato autoriza | Los dos siguen pudiendo renovar |
| La persona cancela en Door43 | Vuelve con `error=access_denied` |
| Con `skip_secondary_authorization` activado | Vuelve en un segundo, sin pantalla de permisos |
| Token de acceso inválido | 401 |
| Token de renovación inválido | 400 con `unauthorized_client` |
| Consultas de los Workers (`/user`, permisos de organización, repositorio con `permissions`) | 200 con el token de OAuth |

### Probado en un teléfono

Abel instaló la página de prueba `taller-oauth-prueba.pages.dev`, la abrió desde su icono, entró y confirmó que **«volvió y entró»**. No quedó registrado el modelo del teléfono ni el texto del resultado.

### Leído en el código de Door43 (`unfoldingWord/dcs`), sin medir

- **Hay un solo permiso (grant) por persona y aplicación**, compartido por todos sus aparatos. Quitar la autorización en Door43 cierra la entrada en todos.
- Si un servidor tuviera `INVALIDATE_REFRESH_TOKENS = true`, renovar en un aparato dejaría sin renovación a los demás. El valor por defecto es `false`.
- Un cliente público sin PKCE se rechaza.
- `skip_secondary_authorization` lo activa quien es dueño de la aplicación. Solo evita la pantalla si la persona ya autorizó y los permisos no cambiaron.
- En un cliente público, una dirección de retorno `http://localhost/` vale para cualquier puerto local.
- Las organizaciones también pueden ser dueñas de una aplicación OAuth.
- El token es un JWT que lleva el número del permiso en el campo `gnt`.
- Un token de renovación ya usado responde `unauthorized_client` con «token was already used». El mismo código de error sirve para un token ilegible, así que hay que distinguirlos por su descripción.
- Door43 no ofrece `prompt=login`: si el navegador ya tiene su sesión, no se le puede pedir que pregunte quién es.

### Sin comprobar

- **La configuración de producción.** No se ve desde afuera y no se ha probado ahí (decisión 3).
- **iPhone**, si el teléfono de la prueba no lo era. Es el caso de mayor riesgo, porque la app instalada y Safari no comparten lo guardado.
- **La primera autorización en el teléfono.** En la prueba, la cuenta de Abel ya tenía permiso y la pantalla se saltó.
- **Un token vencido de verdad.** El 401 se midió con un token inválido, no esperando una hora.
- **Los Workers de avisos y presencia de punta a punta.** Se midieron las consultas que hacen a Door43, no los Workers mismos.

## 3. Enfoques

**A. Cliente público, sin servidor (elegido).** Taller habla directo con Door43 usando PKCE. No hay servicio nuevo ni secreto que guardar. QA y el teléfono de prueba mostraron que funciona.

**B. Worker propio, como tc-admin-app.** Guarda la entrada a medias, para que la app instalada la recoja aunque Door43 regrese a otro navegador. Agrega un servicio que maneja credenciales. **Queda como plan B** solo si el regreso falla en los teléfonos del equipo. Un Worker no resolvería el caso de `INVALIDATE_REFRESH_TOKENS`, porque el permiso seguiría siendo uno por persona.

**C. Seguir solo con contraseña.** No cumple la decisión de Abel.

Se acordó con Abel: sin servidor, salvo que falle la prueba en teléfono. La prueba pasó en el teléfono usado.

**Si el regreso falla en iPhone:** se construye solo el camino A. La función que decide si se ofrece «Entrar con Door43» queda en un solo lugar, de modo que en la app instalada en iPhone se pueda mostrar la contraseña como entrada principal, sin tocar nada más. El Worker se reconsidera solo si eso deja fuera a parte del equipo.

## 4. Lo que ve la persona

### La entrada

```
┌───────────────────────────────┐
│ [logo]                        │
│ Entre con su cuenta de Door43 │
│                               │
│ ┌───────────────────────────┐ │
│ │    Entrar con Door43      │ │  ← el único botón lleno
│ └───────────────────────────┘ │
│ Door43 le preguntará si       │
│ autoriza a Taller. Toque      │
│ «Autorizar» para guardar su   │
│ trabajo desde aquí.           │
│                               │
│ Otra forma de entrar          │
│ Crear una cuenta              │
└───────────────────────────────┘
```

- La frase sobre «Autorizar» se muestra hasta la primera entrada exitosa con Door43 en ese aparato.
- **Otra forma de entrar** abre, en la misma ventana, el usuario y la contraseña que existen hoy, con «¿Olvidó su contraseña?» y «Entrar con un token».
- En un servidor de pruebas sigue el aviso «Servidor de pruebas · qa.door43.org».
- Si ese servidor o esa dirección no tiene aplicación registrada, no hay botón de Door43 y se muestra directamente la contraseña.
- Decisión mía: esta pantalla pasa a «usted», como el resto de la app. Hoy es la excepción («Entra con tu cuenta»).

### La pantalla de permisos de Door43

No se puede cambiar. Sale una sola vez por persona, y dice algo que asusta: en inglés y portugués avisa que la aplicación podrá acceder y escribir en **toda** la información de la cuenta, aunque el token solo tiene los siete permisos de Taller. También lista los permisos con su nombre técnico.

Por eso la frase de la entrada dice de antemano qué tocar y para qué sirve, sin nombrar riesgos, como pide la regla de tranquilizar por el propósito. El botón de Door43 dice «Autorizar aplicación», «Autorizar Aplicativo» o «Authorize Application» según el idioma, y por eso el texto dice solo «Autorizar».

La aplicación debe registrarse con un nombre claro («Taller») y `skip_secondary_authorization` activado, para que no vuelva a preguntar.

### El regreso

- Mientras se completa, se ve la pantalla de carga de la app. Si tarda más de 15 segundos, pasa al caso de error.
- La persona llega a **la pantalla donde estaba** (se guarda la ruta con `#` antes de salir).
- Lo normal no se avisa, con una excepción: si la cuenta que volvió no es la última que entró en ese aparato, o es la primera, se muestra «Entró como *usuario* · ¿No es usted?». Door43 puede devolver a quien recuerde sin preguntar, y nadie debe trabajar a nombre de otra persona sin notarlo. La línea queda hasta el primer toque o 15 segundos, lo que tarde más. «¿No es usted?» cierra la sesión y abre «Otra forma de entrar». La última cuenta se guarda aparte (`gt-dcs-last-user`), y cerrar sesión no la borra.

### Cuando algo sale mal

| Caso | Qué ve | Qué puede hacer |
|---|---|---|
| Canceló en Door43 | La entrada, sin mensaje de error | Volver a tocar el botón |
| Door43 no contesta o devuelve un error | «No se pudo entrar con Door43.» | «Intentar otra vez», con la contraseña ya abierta debajo |
| Regresó a otro navegador, sin la clave temporal | «Abra Taller desde su icono y toque otra vez Entrar con Door43.» | Esa instrucción, u «Otra forma de entrar» |
| Sin internet al renovar | Lo mismo que hoy ante un corte. **La sesión sigue abierta** | Seguir cuando vuelva la conexión |
| Pasó más de un mes sin abrir, o quitó la autorización | «Su sesión caducó», con «Entrar con Door43» | Un toque si Door43 aún lo reconoce |
| La sesión caduca **después de que la persona tocó o escribió algo en esta carga de la página** | La ventana «Su sesión caducó» sobre su pantalla, con usuario y contraseña como acción principal | Entrar ahí mismo, sin salir de la pantalla |
| Se quedó en la página de Door43 y volvió a abrir Taller desde su icono | La entrada, con «No se terminó la entrada con Door43» y la contraseña ya abierta | Intentar otra vez u «Otra forma de entrar» |

**Cómo se distinguen las dos filas de sesión caducada.** `main.tsx` anota el primer `pointerdown`, `keydown`, `beforeinput` o `input` de la página (el dictado, el autocompletado y pegar no siempre producen `keydown`). Sin ninguno, no pudo escribirse nada y la entrada normal, con «Entrar con Door43» como botón principal, es segura. Con alguno, se usa la ventana con contraseña.

**Por qué.** Salir a Door43 recarga la página. Solo los editores de texto y de ayudas guardan lo escrito en el aparato; las respuestas, los comentarios y las propuestas a medio escribir viven en memoria y se perderían. Con la contraseña la pantalla sigue debajo, como hoy. «Entrar con Door43» sigue disponible como enlace, con la frase «Esta pantalla se volverá a abrir». Es un caso raro: pide más de 30 días sin renovar, o que se haya quitado la autorización.

**Quedarse en Door43.** Si el navegador no tiene sesión, Door43 muestra su propia página de entrada, que no tiene botón para cancelar. Al arrancar, si hay un `gt-dcs-oauth-flow` pendiente, la dirección no trae `code` **ni `error`** y **no hay sesión guardada**, la app muestra la fila de arriba. Con sesión guardada no muestra nada. Una dirección con `error` la atiende el regreso, que borra ese flujo y muestra la fila que corresponda (cancelar o error). Fuera de ese regreso, la app no borra el flujo al arrancar, porque otra pestaña puede estar usándolo: vence solo a los 10 minutos, o lo reemplaza un nuevo intento. Cómo sale la persona de esa página en la app instalada, sobre todo en iPhone, se comprueba en la prueba con teléfonos.

### Otra persona en el mismo teléfono

Cerrar sesión en Taller no cierra la de Door43 en ese navegador. Como Door43 ya la reconoce y no vuelve a preguntar, tocar «Entrar con Door43» devolvería a **la persona anterior**. Por eso, después de cerrar sesión en un aparato, la entrada muestra debajo del botón: «¿Es otra persona? Use Otra forma de entrar». La contraseña es hoy la forma de cambiar de cuenta.

## 5. Cómo funciona

### Registro y configuración

- QA y producción son **dos aplicaciones distintas**, cada una con su Client ID. Abel las registra.
- Los Client ID van en `taller.config.ts`, por servidor. No son secretos: viajan en la dirección de cada autorización.
- La configuración también lista las direcciones desde las que se puede entrar:
  - `https://taller.idiomaspuentes.org/`
  - `https://taller-b2h.pages.dev/`
  - `http://localhost/`, que vale para los puertos de desarrollo
- La dirección de retorno es la raíz, **sin `#`**: `origin + BASE_URL`. Una dirección no registrada, como la de una versión de vista previa, no muestra el botón. Tampoco se muestra sin contexto seguro (`crypto.subtle` no existe en el servidor de desarrollo por `http` en la red local).
- Cada dirección guarda su propia sesión, igual que hoy.
- La app elige la aplicación según el servidor activo (`?server=qa` sigue igual). Lo que se guarda antes de salir incluye el servidor, y el regreso usa ese, no el que parezca activo.

### La entrada

Un módulo nuevo, `src/dcs/door43OAuth.ts`, con funciones que se puedan probar sin navegador. `exchangeCodeForToken` de `packages/dcs-client` no se reusa, porque manda JSON con secreto.

1. Crea `verifier` y `state` al azar. Guarda en `localStorage`, clave `gt-dcs-oauth-flow`: `verifier`, `state`, servidor, ruta actual y hora. Vence a los 10 minutos.
2. Navega en la misma ventana a `/login/oauth/authorize`, con `scope` igual a `TOKEN_SCOPES` y `code_challenge_method=S256`.
3. Al regresar, `main.tsx` lo atiende **primero**, antes de `applyMockSessionFromUrl` y `applyServerFromUrl` (las dos reescriben la dirección y conservarían el código), y una sola vez:
   - con `history.replaceState`, quita `code` y `state` y pone la ruta guardada con `#`, de modo que la app nunca dibuje otra pantalla;
   - muestra una pantalla de carga mínima, sin React, y dibuja la app cuando termina o a los 15 segundos. Al llegar a ese límite **cancela el intercambio** con `AbortController`, para que una respuesta tardía no guarde una sesión mientras la pantalla muestra el error;
   - comprueba `state`;
   - cambia el código por los tokens con `POST` form-encoded;
   - lee `/user` y guarda la sesión con `scopes` y `scopesVersion` actuales, o `sessionNeedsReauth` pediría entrar otra vez;
   - deja el servidor del flujo como el elegido (`gt-context` y el servidor forzado de `serverChoice`), porque `?server=qa` ya no está en la dirección y `App` podría abrir otro servidor.

### Qué se guarda

Este es el punto central del diseño.

- `gt-dcs-session` sigue igual, con un campo nuevo `method: "oauth"`. Su `token` es el token de acceso **de cuando se entró y no cambia al renovar**. Funciona como una seña de la sesión.
- `gt-dcs-oauth` guarda de quién es (`host`, `username`, la seña, `grantId`) y lo que sí cambia: token de acceso vigente, token de renovación y hora de vencimiento.

**Por qué así.** Decenas de efectos dependen de `session?.token`. Si cambiara cada hora, todas las pantallas volverían a cargar. Además, `enrichSessionRoles` y `refreshUser` reescriben la sesión entera desde lo que tienen en memoria, y `App.tsx` compara `prev.token !== enriched.token`. Con la seña fija, nada de eso cambia y **los 89 archivos no se tocan**.

`loadSession` debe conservar `method`, porque hoy solo copia los campos que conoce.

**Reglas de escritura**, para que dos pestañas o una salida a medias no dejen datos cruzados:

- Una renovación escribe solo dentro del candado, y solo si `gt-dcs-session` y `gt-dcs-oauth` todavía tienen la misma seña con que empezó. Si la persona cerró sesión mientras tanto, no escribe nada.
- `signOut` borra también `gt-dcs-oauth`. Cuando la sesión caduca, solo se borra lo guardado si su seña es la que falló: una pestaña vieja no saca a quien entró después en otra.
- Toda entrada (Door43, contraseña o token) reemplaza o borra `gt-dcs-oauth`.
- `enrichSessionRoles` y `refreshUser` escriben solo si la sesión guardada todavía tiene su misma seña.

### Renovar en un solo lugar

Todo sigue pasando por la guarda de `fetch` de `src/dcs/sessionExpiry.ts`. Se revisó que ningún módulo guarde una referencia propia a `fetch`, y que no haya `XMLHttpRequest` ni `sendBeacon`. Para cada petición con `Authorization: token X`:

1. Si `X` no es un JWT con el mismo `gnt` que `gt-dcs-oauth`, o no se puede leer, sigue el camino de hoy. Así las sesiones con contraseña no cambian, y una pestaña con una seña anterior del mismo permiso también funciona.
2. Si al token vigente le quedan menos de 2 minutos, renueva primero. Si la renovación falla por la red, sigue con el que tiene.
3. Manda la petición **con el token vigente en lugar de la seña**, al mismo destino. Si esperó mucho en la compuerta y el token venció, lo cubre el paso 4.
4. Si **Door43** responde 401, renueva y **reintenta una sola vez**. Es seguro aunque sea una escritura, porque un 401 significa que Door43 no la procesó. Un segundo 401 es sesión caducada.
5. Si responde 401 **otro servidor** (un Worker), la respuesta pasa tal cual: ni renueva ni cierra la sesión.
6. Solo se cierra la sesión si la renovación falla de forma definitiva o se da el segundo 401.

Un objeto `Request` se clona antes del primer envío para poder cambiar su cabecera y reintentarlo. Un cuerpo en stream no se reintenta; hoy ninguna llamada lo usa.

**Renovar** ocurre bajo `navigator.locks` (`taller-oauth-renew`). Dentro del candado se vuelve a leer `gt-dcs-oauth`: si otra pestaña ya renovó, se usa lo suyo sin llamar a Door43. Así, muchas peticiones con 401 a la vez producen una sola renovación. La llamada de renovación tiene un límite de 8 segundos. La espera del candado dura como máximo 10, porque una pestaña congelada podría retenerlo: al vencer, la petición sigue con el token que hay y un fallo cuenta como pasajero. Donde no haya Web Locks, se evita la doble renovación dentro de la pestaña, y entre pestañas no hace daño mientras el servidor no invalide los tokens usados.

| Respuesta al renovar | Significa | Qué se hace |
|---|---|---|
| 200 | Bien | Guardar y seguir |
| `unauthorized_client` «token was already used», o `invalid_grant` «cannot increase the grant counter» | Otra pestaña o aparato renovó, o se perdió la respuesta de una renovación anterior | Releer lo guardado. Si hay un token más nuevo, usarlo. Si no, reintentar una vez a los 2 segundos y, si se repite, sesión caducada. Solo puede pasar en un servidor que invalide los tokens usados (decisión 3) |
| Otro `invalid_grant`, `unauthorized_client` ilegible o `invalid_client` | Definitivo | Sesión caducada |
| **Cualquier otra respuesta:** sin red, tiempo agotado, 429, 403, 5xx, `invalid_request`, o una página que no es un error JSON de Door43 | Pasajero | **La sesión sigue.** La petición falla como cualquier error de red |

**Tres cambios necesarios en lo que ya existe:**

- **La entrada y la renovación no pasan por la compuerta.** `door43Gate` expone el `fetch` que tenía antes de instalarse, y los `POST` a `/login/oauth/access_token` usan ese. Con decenas de lecturas en fila, una renovación podría esperar más que su propio límite. Además, por la compuerta contaría en `door43Writes`, y cada renovación invalidaría la lista de proyectos que `issues.ts` conserva, de modo que la app volvería a leerla cada hora.
- **La guarda se instala en `main.tsx`, antes de dibujar y después de la compuerta**, para que quede por fuera de ella. Al revés, seis peticiones ocuparían los lugares esperando una renovación que necesita un lugar. Hoy se instala en un efecto de `App`, y React corre primero los efectos de los hijos: sus primeras peticiones saldrían con la seña vencida. `App` solo le conecta qué hacer cuando la sesión caduca.
- **Solo un 401 de Door43 cierra la sesión.** Hoy cualquier 401 con el token de la sesión la cierra, también el del Worker de avisos, que responde 401 cuando no logra preguntarle a Door43 quién es la persona. Es decir, un tropiezo de Door43 visto desde el Worker puede sacar a alguien hoy. Se vio leyendo el código; no se ha reproducido.

### Presencia

Es lo único que usa el token fuera de `fetch`: lo manda dentro del WebSocket al unirse, y nada lo renueva por ese camino. `connectPresence` recibe una función que **asegura un token vigente, renovando si hace falta, antes de cada unión**, en lugar de leer `p.session.token`. Si no, al reconectar después de una hora recibiría `denied` y se quedaría apagada hasta recargar la página.

- **Nunca manda un token vencido.** Si la renovación falla por algo pasajero, como un teléfono que acaba de despertar sin red, ese intento cuenta como uno fallido y se reintenta con la espera que ya existe.
- Si falla de forma definitiva, sigue el camino normal de sesión caducada.

El servidor `usfm-relay-server` y el Worker de avisos no cambian.

### Cerrar sesión y límite de sesiones

- **Cerrar sesión** olvida los tokens en ese aparato y no quita la autorización en Door43, porque eso cerraría todos los aparatos de la persona. Tampoco cierra la sesión de Door43 en el navegador (ver «Otra persona en el mismo teléfono»).
- **`MAX_SESSIONS` no aplica a OAuth.** Esta entrada no crea tokens `taller-<dispositivo>`, así que no ocupa lugar ni cierra otras sesiones. Sigue igual para quien entra con contraseña.
- **Quien entró con contraseña** se queda como está. Si un día entra con Door43, su token anterior queda en Door43 sin usarse, porque sin contraseña Taller no puede borrarlo.

### Seguridad

- PKCE S256 y `state` en cada entrada. Sin secreto en el repositorio.
- El código sale de la dirección antes de cualquier otra cosa.
- Los tokens no se registran ni aparecen en mensajes o detalles técnicos.
- El token de renovación vive en `localStorage`, igual que hoy el token permanente de la contraseña, pero vence si no se usa en 30 días.

## 6. Pruebas

**Automáticas**, en un `npm run verify:oauth` nuevo:

- construcción de la dirección, PKCE, `state` y vencimiento del flujo;
- cada fila de la tabla de renovación;
- sustitución de la seña por el token vigente, y que una sesión con contraseña no se toca;
- reintento único tras un 401, un segundo 401, y que un 401 de otro servidor (con un `fetch` falso) no cierra la sesión;
- dos pestañas renovando a la vez, y una sola renovación ante muchos 401;
- la seña no cambia al renovar, y la renovación no cuenta en `door43Writes`;
- las reglas de escritura: cerrar sesión durante una renovación, y una pestaña vieja con otra persona en otra;
- el regreso: orden frente a `applyServerFromUrl`, servidor conservado, y `sessionNeedsReauth` falso;
- presencia: reconectar con el token vencido renueva antes de unirse, y un fallo pasajero no la apaga;
- una respuesta 429 o una página HTML al renovar no cierra la sesión;
- los 15 segundos cancelan el intercambio, y un flujo pendiente sin código muestra la entrada con su aviso;
- «Entró como…» sale con una cuenta distinta y no con la misma.

**Con el mock.** `scripts/mock-door43` necesita `/login/oauth/authorize` y `/login/oauth/access_token`, con tokens de vida corta para ver vencer uno. La carpeta principal tiene cambios de Abel sin guardar en ese archivo: se trabaja en el worktree y se revisa el cruce antes de unir.

**En el navegador, a 375 px y en escritorio**, en español y portugués, con la lista de `docs/FILOSOFIA_DE_DISENO.md`.

**En QA con teléfonos reales:** primera autorización, regreso a la pantalla donde se estaba, salir de la página de entrada de Door43 sin terminar, token vencido de verdad, avisos y presencia.

## 7. Puesta en marcha

1. Se construye y se prueba solo con el Client ID de QA. En producción no hay botón, así que nadie nota nada.
2. Abel registra la aplicación de producción, con los datos preparados.
3. Se comprueba la configuración de producción (decisión 3).
4. Se publica con `npm run deploy -- --publish`, con el OK de Abel.
5. Prueba con el equipo (decisión 1). La contraseña sigue a un toque.

Al terminar se borra el proyecto de prueba `taller-oauth-prueba` de Cloudflare, con el OK de Abel, y se quita su dirección de la aplicación de QA.

## 8. Decisiones de Abel

Abel aceptó estas cuatro recomendaciones al aprobar el diseño. Quedan por concretar **qué organización** será dueña de la aplicación de producción (decisión 4), qué teléfono se usó en la prueba y si alguien del equipo tiene iPhone.

1. **Qué cuenta como «probado con el equipo».** Recomendación: tres personas del equipo en sus propios teléfonos, incluido un iPhone si alguien lo usa, durante una semana de trabajo, sin que nadie quede fuera. Retirar la contraseña sería una decisión aparte, después, y antes habría que resolver dos cosas que hoy dependen de ella: cambiar de cuenta en un teléfono compartido y volver a entrar sin perder lo escrito.
2. **Quien ya entró con contraseña.** Recomendación: se queda así y pasa a OAuth la próxima vez que deba entrar. Sin avisos ni obligación.
3. **Comprobar producción antes de abrirla.** Recomendación: una sola prueba hecha por ti, con tu cuenta y la aplicación de producción ya registrada, igual a la de QA, que solo lee y renueva. Es una excepción a «no probar en producción», por eso la decides tú. Si resultara que producción invalida los tokens usados, no se abre OAuth ahí hasta hablarlo con quien administra Door43.
4. **A nombre de quién se registra la aplicación de producción.** Door43 muestra «Esta aplicación fue creada por…» en la pantalla de permisos. Recomendación: una organización del equipo, no tu cuenta personal.

## 9. Lo que queda a quien construya

- Los nombres exactos de funciones, y el texto final en `es.json` y `pt.json`.
- Cómo se ve la pantalla de carga durante el regreso.
- El mensaje exacto de un error de red tras un 401, con `useT()` / `tNow()`.
- Si `door43OAuth.ts` debe partirse en dos archivos.
