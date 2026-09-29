# TAS — Translation Assistance System

App de preparación FCR y gestión de trabajo sobre issues DCS: inventariar un
libro (o varios en un proyecto temático), definir **tareas** (alcance + reparto),
asignar **equipos** de org y publicar **subtareas**.

Antes: *Gateway Tasks*. El repo DCS sigue siendo `{pmOrg}/gateway-tasks` por
compatibilidad.

Vocabulario y arquitectura: [`docs/MODELO.md`](docs/MODELO.md) ·
migración: [`docs/PLAN_MIGRACION.md`](docs/PLAN_MIGRACION.md) ·
plataforma: [`docs/PLATAFORMA.md`](docs/PLATAFORMA.md).

## Arranque

Necesitas el monorepo [`idiomas-puentes-lms`](../idiomas-puentes-lms) al lado (para `@ip-lms/dcs-client`).

```bash
npm install
npm run dev
# http://localhost:5175
```

No hace falta ningún proceso aparte: **Generar** en el paso Inventario corre
enteramente en el navegador (ver [Inventario](#inventario) más abajo). Sin
red también puedes **Cargar JSON**.

## Flujo

1. **Inventario**: elegir proyecto (libro o temático) e inventariar.
2. **Tareas**: alcance (`ScriptureScope`), reparto y (opcional) equipo de org DCS.
3. **Asignar**: backlog filtrado por la tarea activa; asignar o **Autoasignar**.
4. **Entregar**: descargar JSON, guardar en DCS y/o publicar subtareas (issues).

La lengua se elige en el setup y en Proyectos. La sesión DCS y la organización PM
viven en el chip de la barra (iniciar sesión o, ya dentro, el resumen de sesión).

Arquitectura visual: [`docs/VISUAL_ARCHITECTURE.md`](docs/VISUAL_ARCHITECTURE.md).
Dominio: [`docs/MODELO.md`](docs/MODELO.md).

## Persistencia DCS

Repo: `{pmOrg}/gateway-tasks` (nombre técnico legacy; producto = TAS)

```
team-presets.json
{lang}/projects.json
{lang}/teams.json          # people + tasks
{lang}/{projectId}/assignments.json
{lang}/{BOOK}/inventory.json
```

## Inventario

El paso Inventario genera el JSON de porciones/artículos en el navegador
(worker). Para proyectos temáticos, inventaría cada libro de `books[]` por
pestaña.
