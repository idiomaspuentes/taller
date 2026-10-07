# Door43 de mentira

Un Door43 en memoria para probar TAS con varias personas sin tocar ningún servidor real.

```
npm run mock:door43        # http://localhost:8787
npm run dev -- --port 5177 # persona 1
npm run dev -- --port 5178 # persona 2
```

Cada puerto es un origen distinto, así que cada pestaña guarda su propia sesión.

## Qué contiene

- El plan y las subtareas del proyecto NEH (`BSOJ/taller`) y el borrador en español (`es-419_gl/es-419_glt`, rama `neh`). Todo se escribe aquí, en memoria.
- Los textos públicos de unfoldingWord (hebreo, notas, palabras, artículos) se leen de `qa.door43.org`, sin credenciales y solo lectura, y se guardan en caché.
- Personas de prueba: `ana` (coordina), `bea`, `carla`. Sus tokens son `token-ana`, `token-bea` y `token-carla`.

## Entrar como una persona

En la consola de cada pestaña (cambia el usuario) y **recarga la página** (cambiar solo el `#` no recarga):

```js
localStorage.clear();
const scopes = ["read:user","read:organization","write:repository","write:issue","write:organization","read:notification"];
localStorage.setItem("gt-dcs-session", JSON.stringify({ host: "http://localhost:8787", username: "ana", token: "token-ana", scopes, scopesVersion: 2, canManage: true, teams: [] }));
localStorage.setItem("gt-context", JSON.stringify({ book: "NEH", contentOrg: "es-419_gl", host: "http://localhost:8787", lang: "es-419", pmOrg: "BSOJ" }));
localStorage.setItem("gt-context-confirmed", "1");
location.reload();
```

## Con un libro de verdad

`MOCK_PM_ORG=es-419_gl MOCK_SEED_BOOK=TIT npm run mock:door43` empieza con lo publicado de ese libro (los dos
textos, las notas y las preguntas), leído una vez de Door43, sin credenciales. `MOCK_PORT=8797` lo pone en otro
puerto cuando el 8787 está ocupado.

`npm run verify:proposals-mock` (con `MOCK_HOST=http://localhost:8797` si no está en el 8787) recorre ahí una
propuesta de cambio: se propone sobre una nota, otra persona la acuerda, se escribe en el borrador del equipo, y
cada una da su acuerdo al paso. Sin un mock con ese libro, no se ejecuta.

## Para mirar y reiniciar

- `GET /__mock/log`: escrituras hechas y peticiones que el servidor no implementa.
- `GET /__mock/files?repo=es-419_gl/es-419_glt&branch=neh` (añade `&path=16-NEH.usfm` para ver un archivo).
- `POST /__mock/reset`: vuelve al estado inicial.
