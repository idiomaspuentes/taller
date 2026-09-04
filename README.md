# Gateway Tasks

App de Preparación FCR: inventariar un libro de la Biblia, definir equipos con alcance y **producir la lista de asignaciones**. Con sesión DCS se guarda en `{org}/gateway-tasks`.

## Arranque

Necesitas el monorepo [`idiomas-puentes-lms`](../idiomas-puentes-lms) al lado (para `@ip-lms/dcs-client`).

```bash
npm install
npm run dev
# http://localhost:5175
```

No hace falta ningún proceso aparte: **Generar** en el paso Inventario corre
enteramente en el navegador (ver [Inventario](#inventario) más abajo). Sin
red también puedes usar **Instantánea NEH** o **Cargar JSON**.

## Flujo

1. **Contexto** (barra): lengua, org de contenido (`{lang}_gl`), org PM (si hay login), libro.
2. **Inventario**: generar o cargar JSON → porciones + artículos pendientes.
3. **Equipos**: personas, equipos y alcance (Notas, Preguntas, Academia, Palabras).
4. **Asignar**: backlog filtrado por el equipo activo; asignar o **Autoasignar**.
5. **Publicar**: descargar JSON o **Guardar en DCS**.

## Persistencia DCS

Repo: `{pmOrg}/gateway-tasks`

```
team-presets.json
{lang}/teams.json
{lang}/{book}/assignments.json
{lang}/{book}/inventory.json
```

`team-presets.json` guarda las plantillas de alcance de equipo (recursos, filtro,
grano, "asignar juntos"), sin nada específico de un libro. No está bajo `{lang}/`
porque el mismo preset sirve para cualquier lengua. Se sincroniza al guardar o
borrar un preset en Equipos (si hay sesión y organización PM elegidas); si no,
queda solo en este dispositivo (`localStorage`).

Schema del entregable: `gateway-assignments-1` (personas, equipos, asignaciones con `personId` + `teamId`).

Login: usuario/contraseña → PAT, o pegar un token (`read:user`, `read:organization`, `write:repository`).

## Inventario

**Generar** corre en [`src/worker/inventoryWorker.ts`](src/worker/inventoryWorker.ts), un
Web Worker real (no un proceso aparte): descarga el ULT y los archivos
compañeros (UST/TN/TQ/TWL) directamente de Door43, arma las porciones
(`src/prep/`) y comprueba el estado de cada artículo de Academia/Palabras en
el org destino (`src/status/`). Ambas mitades son un port a TypeScript, línea
a línea, de los scripts Python de `idiomas-puentes-docs` (`prep_portions.py`
+ `check_article_status.py`); `npm run verify:prep`, `verify:seqmatch` y
`verify:status` comparan la salida contra la de esos scripts originales.

## Relación con la guía

El `/tablero` de `idiomas-puentes-docs` queda como prototipo. Esta app es el destino.

## UI/UX

Antes de tocar una vista o añadir un control, lee
[`docs/UI_UX_PRINCIPLES.md`](docs/UI_UX_PRINCIPLES.md) — reglas de
divulgación progresiva y jerarquía visual, con una checklist para PRs.
