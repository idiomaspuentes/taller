# Taller: estado y plan

*Actualizado el 1 de octubre de 2026.* Este documento es el punto de partida para quien continúe el trabajo (una persona o una sesión de Claude en la nube). Las decisiones de diseño están en los demás documentos de `docs/`; aquí se resume dónde estamos y qué sigue.

## Qué es Taller

La app del equipo FCR de Idiomas Puentes para el trabajo de traducción: lo que te toca hoy, las revisiones entre varias personas, las decisiones de alineación sin reuniones y los avisos en el teléfono. Es una PWA (React + Vite + TypeScript), pensada primero para el móvil, en español y portugués, sobre **Door43** (los repositorios y las incidencias son los datos). Es de código abierto (MIT) y se adapta a otra organización editando `taller.config.ts` ([CONFIGURACION.md](CONFIGURACION.md)).

- Producción de pruebas: https://taller.idiomaspuentes.org (Cloudflare Pages, proyecto `taller`). Arranca contra **QA** (`qa.door43.org`).
- Avisos con la app cerrada: Worker `tas-push` en Cloudflare ([push-worker/README.md](../push-worker/README.md)).
- Nombre del repositorio de datos en Door43: `{pmOrg}/gateway-tasks` (se conserva por compatibilidad).

## Dónde estamos

**Hecho y publicado**
- Flujo FCR completo: plantillas, niveles y esperas entre tareas, avisos por audiencia, revisión por consenso.
- **Afinación** con tres herramientas (notas, palabras, alineación): alinear con cajas y banco de palabras, revisar, proponer y objetar; las propuestas son decisiones del equipo con votación, consenso y confirmación, con recordatorios automáticos.
- Equipo hoy (con «Asignar a otra persona»), Mis tareas, Ahora y Avisos, con menciones de Door43 y contadores.
- **Avisos push** (Cloudflare Workers gratis): menciones, asignaciones y solicitudes de cambios; se agrupan y se cierran al verlos en la app.
- **Primera pantalla** de bienvenida y tarjeta de primeros pasos; estados vacíos que distinguen «sin tareas todavía» de «al día».
- **Configuración en un archivo** y **espacios de trabajo**: varios equipos (por idioma o no) en la misma organización o en organizaciones distintas, sin mezclarse (`scope`).
- **Español y portugués**: bienvenida, inicio de sesión, menús, Ahora, Mis tareas, Equipo hoy, Avisos (incluidos mensajes y nombres de las plantillas de flujo).
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
- **Variables de compilación** (en `.env.production.local`, no se sube): `VITE_PUSH_URL` (dirección del Worker de avisos) y `VITE_DEFAULT_HOST=qa` (que la versión publicada arranque en QA).
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
1. **Hecho:** Equipo hoy, encabezado y menús, Proyectos, tablero de equipo, Organización y los nombres de los libros (tabla aparte, solo para mostrar: `bookLabel`; `bookName` sigue en español porque se escribe en Door43). Probado en el mock en móvil y escritorio (Organización y Proyectos con datos mínimos). «Plantillas» se muestra como «Modelos» en portugués: que lo confirme la persona que revise.
   También hecho: `TeamsView` (fases y tareas, editor de tarea), `StepNav` y los campos de espera, quién puede tomarla y nivel mínimo. Las etiquetas y ayudas que construye el dominio en español (`types.ts`, `stepClaim.ts`) se traducen al mostrarlas con `src/domain/scopeNames.ts` (`localizeScope`); `verify:config` falla si aparece una frase nueva sin traducir. Probado en el mock en móvil y escritorio (crear una tarea y ver la lista). Dos decisiones para quien revise: «Avance» se muestra «Andamento» y «Plantillas» «Modelos».
   También hecho: `HelpsEditorView` y `PortionReviewView` (probados sin sesión en el navegador, en móvil; con Door43 real no se han visto). `ScriptureEditorView` (editor de versículos; probado sin sesión en el navegador con un contexto armado a mano; guardar, abrir la revisión y rehacer el borrador contra Door43 no se han visto) y los mensajes de error al guardar (`explainRepoFileError`: se traduce la frase y se deja tal cual el «Detalle técnico» que viene de Door43; esto cubre en parte el punto 1.5). `AfinacionView` (revisar notas y palabras clave) y `AlineacionView` (alinear y revisar la alineación), con los nombres de las categorías de notas (`src/domain/afinacionNames.ts`). **Solo se vieron en el navegador (móvil) con un enlace inválido**: el mock no trae el borrador, el original ni las notas, así que las pantallas con datos (cajas, banco de palabras, votos, propuestas) no se han visto en portugués; hay que recorrerlas con datos reales de QA. `ConversationView`, `DecisionCard` y las tarjetas de decisión (alineación y conflicto de versículos), los votos, el consenso y los cierres, y las vistas previas de Avisos/Mis tareas. Esas frases las construye el dominio en español (y el `summary` del evento se guarda así en el comentario de Door43); se traducen al mostrarlas con `src/domain/threadNames.ts` y `verify:config` comprueba cada frase con los constructores reales. Probado en el mock con la conversación de prueba (`#/mis-tareas/prueba`, solo en desarrollo): se vio el conflicto de versículos y sus opciones; las tarjetas de alineación (voto, consenso, cierre) solo con la prueba automática. Lo que escribe una persona nunca se traduce. `PublishView` (crear subtareas; probado en el mock hasta el diálogo de confirmación, sin confirmar la publicación, así que el aviso de éxito y el progreso solo están cubiertos por tipos y por lectura del código), `BookStepView` y su explorador de inventario (probado en el mock con un JSON de 3 porciones; «Inventariar» desde Door43 no se pudo probar sin el servidor real), el botón «Cerrar» de todos los diálogos, `AssignView` (asignar personas; probado en el mock cargando un inventario JSON de 3 porciones, sin llegar a asignar a nadie), `WorkflowsView` (modelos de flujo; probado en el mock creando uno desde el FCR). Los nombres de pasos y tareas dentro de un campo editable se muestran tal como están guardados (no se traducen para no cambiar lo que la persona escribe).
   También hecho: `FamiliarizeView`, `ReviewTaskControl`, `ReleaseVersionControl`, `PrincipalPassControl` y las pantallas de entrada (aviso de sesión, `WorkspaceDialog`, `SetupGate`, avisos push y del navegador, selector de idioma, errores de `push.ts`). Probado en el navegador: bienvenida y entrada en móvil y escritorio; las demás solo con `verify:config` y tipos (el mock no trae sus datos).
   **Falta**: las de gestión o laboratorio `QaAdminDialog`, `QaTestScenarioSection`, `SolverLabView`. Lo demás que muestra `grep -c "[áéíóúñ¿¡]" src/components/*.tsx` son puntos medios («·») y comentarios. Los motivos de error de `parseReviewRef` (`domain/reviewTask.ts`) siguen en español.
2. Editor, conversación y decisiones de alineación (ver lo que falta arriba).
3. ~~Nombres de los libros en portugués~~ (hecho; falta usarlos en `BookStepView` y `TeamsView`, que se traducen con sus pantallas).
4. Que una persona del equipo brasileño **revise** las traducciones: herramienta lista (`npm run translations:review` genera `docs/traduccion/revisar-portugues.html`; ver [TRADUCCION.md](TRADUCCION.md)). **Hecho (provisional):** la persona de Brasil la aprobó tal cual; el resto lo corregirá usando la app. Cuando devuelva correcciones sueltas, se aplican con `translations:apply` (ver [TRADUCCION.md](TRADUCCION.md)). Hasta entonces `pt.review.json` sigue vacío: nada está marcado como revisado.
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
1. Cambiar `defaultServer` a `production` y quitar `VITE_DEFAULT_HOST=qa` del build.
2. Webhook y Worker apuntando a producción (`ALLOWED_HOSTS` hoy solo QA).
3. Borrar los datos que se crearon por error en producción (`es-419_gl/gateway-tasks`).
4. Revisar las políticas de datos (el Worker guarda las direcciones de push de cada dispositivo; ver su README).

## Reglas de trabajo acordadas
- La interfaz es para personas del equipo, no técnicas: lenguaje claro y cálido, móvil primero.
- Nada se publica ni se sube sin confirmar antes con quien lo pide; los secretos no entran al repositorio.
- Cada cambio visible se prueba en el navegador (móvil y escritorio) y lleva su prueba automática cuando tiene lógica.
- Commits en inglés, con una línea de título y un cuerpo que explique el porqué.
