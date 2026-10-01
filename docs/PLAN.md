# Taller: estado y plan

*Actualizado el 1 de octubre de 2026.* Este documento es el punto de partida para quien continúe el trabajo (una persona o una sesión de Claude en la nube). Las decisiones de diseño están en los demás documentos de `docs/`; aquí se resume dónde estamos y qué sigue.

## Qué es Taller

La app del equipo FCR de Idiomas Puentes para el trabajo de traducción: lo que te toca hoy, las revisiones entre varias personas, las decisiones de alineación sin reuniones y los avisos en el teléfono. Es una PWA (React + Vite + TypeScript), pensada primero para el móvil, en español y portugués, sobre **Door43** (los repositorios y las incidencias son los datos). Es de código abierto (MIT) y se adapta a otra organización editando `taller.config.ts` ([CONFIGURACION.md](CONFIGURACION.md)).

- Producción de pruebas: https://taller.idiomaspuentes.org (Cloudflare Pages, proyecto `taller`). Arranca contra **QA** (`qa.door43.org`).
- Avisos con la app cerrada: Worker `tas-push` en Cloudflare ([push-worker/README.md](../push-worker/README.md)).
- Repositorio de datos en Door43: `{pmOrg}/taller` (`pmRepo` en `taller.config.ts`; antes `gateway-tasks`). En QA queda un `es-419_gl/gateway-tasks` viejo, de pruebas, que se puede borrar.

## Dónde estamos

**Hecho y publicado**
- Flujo FCR completo: plantillas, niveles y esperas entre tareas, avisos por audiencia, revisión por consenso.
- **Afinación** con tres herramientas (notas, palabras, alineación): alinear con cajas y banco de palabras, revisar, proponer y objetar; las propuestas son decisiones del equipo con votación, consenso y confirmación, con recordatorios automáticos.
- Equipo hoy (con «Asignar a otra persona»), Mis tareas, Ahora y Avisos, con menciones de Door43 y contadores.
- **Avisos push** (Cloudflare Workers gratis): menciones, asignaciones y solicitudes de cambios; se agrupan y se cierran al verlos en la app.
- **Primera pantalla** de bienvenida y tarjeta de primeros pasos; estados vacíos que distinguen «sin tareas todavía» de «al día».
- **Configuración en un archivo** y **espacios de trabajo**: varios equipos (por idioma o no) en la misma organización o en organizaciones distintas, sin mezclarse (`scope`).
- **Español y portugués**: bienvenida, inicio de sesión, menús, Ahora, Mis tareas, Avisos (incluidos mensajes y nombres de las plantillas de flujo).
- Puentes: diseño visual, PWA instalable, acceso por LAN para probar en el teléfono, mock de Door43 para pruebas con varias personas.

**Probado de verdad:** lo de la alineación y las decisiones con tres usuarios en el mock; los avisos push de punta a punta con un teléfono real; la bienvenida, los primeros pasos y las pantallas en portugués en el navegador (móvil y escritorio).

**Solo probado con pruebas automáticas o el mock:** el aislamiento entre espacios (6 + 5 comprobaciones), el cambio de espacio en la interfaz con dos espacios en una organización, las traducciones al portugués (sin revisión de una persona nativa).

## Cómo trabajar

```bash
node scripts/setup-workspace.mjs   # una vez: clona usfm-ast al lado, lo construye e instala todo
npm run dev                        # http://localhost:5175 (QA por defecto en desarrollo)
npm run build                      # la versión publicada
npm run verify:config              # y los demás verify:* (ver package.json); verify:prep falla desde antes
```

- **Pruebas:** `scripts/verify-*.mts`, una por tema, con salida legible. `npm run mock:door43` levanta un Door43 en memoria (puerto 8787, `MOCK_PM_ORG` elige la organización) y `?mockUser=ana|bea|carla` inicia sesión como cada una. `npm run verify:scope-mock` prueba el aislamiento de espacios contra ese mock.
- **Variables de compilación** (en `.env.production.local`, no se sube): `VITE_PUSH_URL` (dirección del Worker de avisos) y, solo para una versión de pruebas, `VITE_DEFAULT_HOST=qa`. La versión publicada arranca en **producción** (`git.door43.org`); para probar contra QA se abre con `?server=qa` (y `?server=production` para volver).
- **Dependencia de usfm-ast:** repositorio aparte, esperado en `../usfm-ast` (el script lo clona fijado en un commit conocido). `packages/dcs-client` es una copia del cliente de Door43 del monorepo `idiomas-puentes-lms`.

## Publicar

Desde una máquina con sesión de Cloudflare (`wrangler login`); una sesión en la nube **no** puede publicar.

```bash
npm run build
cd /ruta/limpia && npx wrangler pages deploy <taller>/dist --project-name taller --branch main
```

(Se ejecuta fuera de la carpeta del proyecto para que wrangler no intente autoconfigurar Vite.) El Worker se publica con `npx wrangler deploy` dentro de `push-worker/`. Los secretos del Worker (`VAPID_*`, `WEBHOOK_SECRET`) viven en Cloudflare, nunca en el repositorio.

## Qué sigue (por prioridad)

### 1. Terminar la experiencia en portugués
1. **Equipo hoy**, gestión de equipos, proyectos, organización: textos y nombres de las plantillas.
2. Editor, conversación y decisiones de alineación.
3. **Nombres de los libros** en portugués.
4. Que una persona del equipo brasileño **revise** las traducciones (`src/i18n/messages.ts`, `src/domain/templateNames.ts`, `taller.config.ts`).
5. Mensajes que llegan de Door43 tal cual (errores del servidor): decidir si se envuelven.

### 2. Espacios de trabajo, con datos reales
1. Recorrer en la interfaz un caso con **dos espacios en una organización** (elegir, cambiar, recargar limpio).
2. Crear el webhook de avisos en `pt-br_gl` (hoy solo existe en `es-419_gl`) y probar los avisos del espacio en portugués.
3. Decidir qué hacer con quien está en dos espacios de una organización y recibe avisos de ambos.

### 3. Avisos
1. Urgencia alta para menciones y asignaciones (hoy pueden tardar minutos con el teléfono en reposo).
2. Subtareas **libres para un equipo** (hoy no avisan) y recordatorios de plazo sin que nadie abra la app (necesita un cron y una cuenta de servicio de Door43).
3. Borrar el Worker sobrante `taller` en Cloudflare (se creó por error).

### 4. Alineación y revisión
Pendientes de [AFINACION_PROXIMOS_PASOS.md](AFINACION_PROXIMOS_PASOS.md): ocultar o plegar, atajos, accesibilidad, sugerencia automática de alineación (puntos 8, 9, 13, 16 a 20), y probar el arrastre largo en un teléfono real.

### 5. Técnico
- **CI** en GitHub: type-check + los `verify:*` en cada cambio; y despliegue automático a Pages (necesita un token de Cloudflare como secreto del repositorio).
- `verify:prep` falla desde antes y no está relacionado: arreglarlo o retirarlo.
- `packages/dcs-client`: copia del monorepo del LMS; decidir quién es la fuente (o publicarlo como paquete). Sus pruebas (`vitest`) no corren aquí.
- `usfm-ast` fijado en un commit: avisar cuando se mueva.
- Revisar el aviso de «Probar un conflicto» y otras herramientas de desarrollo que solo deben verse con `import.meta.env.DEV`.

### 6. Para el lanzamiento
1. (Hecho el 1 de octubre) La app publicada arranca en producción; QA solo con `?server=qa`.
2. Avisos en producción: el Worker ya acepta `git.door43.org` (1 de octubre); **falta crear el webhook** en la organización de producción (`es-419_gl`, con el mismo secreto que el de QA) y probarlo con un teléfono.
3. (Hecho el 1 de octubre) El repositorio creado por error en producción (`es-419_gl/gateway-tasks`) se borró, y el nombre pasó a `taller` antes del primer inicio de sesión real.
4. Revisar las políticas de datos (el Worker guarda las direcciones de push de cada dispositivo; ver su README).

## Reglas de trabajo acordadas
- La interfaz es para personas del equipo, no técnicas: lenguaje claro y cálido, móvil primero.
- Nada se publica ni se sube sin confirmar antes con quien lo pide; los secretos no entran al repositorio.
- Cada cambio visible se prueba en el navegador (móvil y escritorio) y lleva su prueba automática cuando tiene lógica.
- Commits en inglés, con una línea de título y un cuerpo que explique el porqué.
