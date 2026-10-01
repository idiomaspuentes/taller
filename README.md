# Taller

La app del equipo FCR de [Idiomas Puentes](https://idiomaspuentes.org) para el trabajo de traducción sobre Door43: lo que te toca hoy, revisiones y decisiones de alineación en equipo, y avisos en el teléfono. PWA móvil primero, en español y portugués, de código abierto (MIT) y adaptable a otra organización.

Estado y próximos pasos: [`docs/PLAN.md`](docs/PLAN.md). Para quien continúe el trabajo (también una sesión de Claude): [`CLAUDE.md`](CLAUDE.md).

Antes se llamó *TAS* (Translation Assistance System) y *Gateway Tasks*. El repositorio de datos en Door43 sigue siendo `{pmOrg}/gateway-tasks` por compatibilidad.

Vocabulario y arquitectura: [`docs/MODELO.md`](docs/MODELO.md) ·
migración: [`docs/PLAN_MIGRACION.md`](docs/PLAN_MIGRACION.md) ·
plataforma: [`docs/PLATAFORMA.md`](docs/PLATAFORMA.md).

## Adaptarla a otra organización

La bienvenida, los equipos (espacios de trabajo por lengua) y el nombre de la app se cambian en un solo archivo, [`taller.config.ts`](taller.config.ts). Ver [docs/CONFIGURACION.md](docs/CONFIGURACION.md).

## Arranque

Taller necesita [`usfm-ast`](https://github.com/abelpz/usfm-ast) **al lado** de este repositorio. Un script lo prepara todo (necesita git, Node 20+ y [Bun](https://bun.sh)):

```bash
node scripts/setup-workspace.mjs   # clona ../usfm-ast, lo construye, instala y comprueba
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
