# Taller (repositorio `taller`)

PWA del equipo FCR de Idiomas Puentes para coordinar el trabajo de traducción sobre Door43. React 18 + Vite + TypeScript, móvil primero, interfaz en español y portugués. Estado y plan: [`docs/PLAN.md`](docs/PLAN.md). Cómo adaptarla a otra organización: [`docs/CONFIGURACION.md`](docs/CONFIGURACION.md).

## Empezar

```bash
node scripts/setup-workspace.mjs   # clona ../usfm-ast, lo construye, instala y comprueba (necesita git, Node 20+ y Bun)
npm run dev                        # http://localhost:5175
```

`usfm-ast` (github.com/abelpz/usfm-ast) debe estar **al lado** de este repositorio (`../usfm-ast`); el script lo hace. `packages/dcs-client` es una copia del cliente de Door43.

## En una sesión en la nube

El entorno nuevo no trae `usfm-ast` ni Bun. Al empezar, una sola vez:

```bash
curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH"
node scripts/setup-workspace.mjs
```

Sin sesión de Cloudflare ni acceso al Door43 real: se trabaja con el mock (`npm run mock:door43`) y no se publica. No hay memoria de conversaciones anteriores; lo que importa está en `docs/PLAN.md` y en este archivo.

## Comandos

- `npx tsc --noEmit -p .` — tipos. `npm run build` — versión publicada.
- `npm run verify:<tema>` — pruebas (`scripts/verify-*.mts`, con `tsx`). Las de configuración: `verify:config`, `verify:scope`. Con el mock: `npm run mock:door43` y `npm run verify:scope-mock`. `verify:prep` falla desde antes (no es tuyo).
- Mock de Door43 (en memoria, puerto 8787): sesiones de prueba `?mockUser=ana|bea|carla` en desarrollo.

## Convenciones

- **Texto de interfaz**: lo propio de una organización va en `taller.config.ts`; lo general en `src/i18n/messages.ts` (columnas `es` y `pt`, el tipo obliga a rellenar las dos). Los nombres de las plantillas de flujo se traducen al mostrarlos en `src/domain/templateNames.ts`. No dejes texto en español suelto en un componente nuevo: usa `useT()`.
- **Espacios de trabajo**: todo lo que se lee o escribe de un espacio pasa por `src/domain/scope.ts` (etiquetas, hitos, rutas, claves locales). Un código nuevo que liste incidencias o archivos del repositorio `gateway-tasks` debe respetarlo; añade una prueba en `verify-scope`.
- Comentarios y commits en inglés; la interfaz y la documentación del producto, en español. Commits con título corto y un cuerpo que explique el porqué.
- Estilo del código: el del entorno (comentarios que expliquen el porqué, pocos). Pruebas con salida legible y nombres que cuenten lo que se verifica.
- Cada cambio visible se prueba en el navegador (móvil y escritorio) además de las pruebas automáticas.

## Límites

- **Nada se publica sin confirmar**: ni Cloudflare, ni GitHub, ni Door43 (QA o producción). Una sesión en la nube no tiene sesión de Cloudflare.
- **Sin secretos en el repositorio**: los secretos del Worker de avisos viven en Cloudflare; `.env*.local` está ignorado.
- Producción de Door43 no se toca para pruebas; se trabaja contra QA o el mock.
- Si una acción es difícil de deshacer (borrar, publicar, enviar), pregunta antes.

## Dónde mirar

| Para… | Mira |
|---|---|
| Entender los datos y el flujo | `docs/MODELO.md`, `docs/PLATAFORMA.md` |
| La alineación y sus decisiones | `docs/AFINACION_PROXIMOS_PASOS.md` |
| Avisos con la app cerrada | `push-worker/README.md` |
| Cambiar la bienvenida, los equipos, los idiomas | `docs/CONFIGURACION.md` |
