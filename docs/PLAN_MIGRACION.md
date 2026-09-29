# Plan de migración — Proyecto / Fase / Tarea / Equipo / Subtarea

Plan vivo alineado con [`MODELO.md`](./MODELO.md). No borra el trabajo de
issues/`pm` ya hecho; lo reordena alrededor del vocabulario correcto.

## Estado actual (2026-09-05)

| Capa | Estado |
|------|--------|
| Docs (`MODELO`, este plan, `PLATAFORMA`) | Hecho |
| Tipos `Phase` / `ProjectTask` + load legacy `teams[]` | Hecho |
| Elegibilidad de repos (`filterTeamsEligibleForTask`) | Hecho |
| Labels UI “Tareas” / fases en el paso del asistente | Hecho |
| Persistencia `phases` + `tasks` (lectura dual `teams[]`) | Hecho |
| Asignar equipo org (sin espejar por defecto) | Hecho |
| Dejar de crear `pm-*` al guardar tarea | Hecho (solo Org / bajo demanda) |
| UI fases (agrupar + CRUD) | Hecho |
| Label `pm/tarea:` al publicar | Hecho |
| Organización = CRUD de equipos; copy vocabulario | Hecho |

## Objetivos

1. Dejar de llamar “equipo” a lo que es una **tarea** de proyecto.
2. Introducir **fase** como agrupador de tareas.
3. Tratar **equipo** solo como equipo de organización DCS, reutilizable.
4. Enforce: solo asignar equipos con repos suficientes para la tarea.
5. Mantener compatibilidad de lectura con `teams[]` legacy en el JSON.

## Fases de implementación

### A. Dominio y docs (esta iteración)

- [x] Documentar modelo (`MODELO.md`) y este plan.
- [x] Tipos `Phase`, `ProjectTask`; `Team` como alias de compatibilidad.
- [x] `AssignmentsDoc.phases[]` + normalización desde `teams[]` legacy.
- [x] `reposForTask` + `teamHasReposForTask` / `filterTeamsEligibleForTask`.
- [x] Actualizar `PLATAFORMA.md` / `VISUAL_ARCHITECTURE.md` al nuevo vocabulario.
- [x] Labels UI del paso: Equipos → Tareas (StepNav + TeamsView cabeceras).

### B. Persistencia y sync

- [x] Guardar `phases` + `tasks` en JSON / localStorage / DCS (leer `teams[]` legacy; ya no escribir espejo).
- [x] Sustituir “Sincronizar con org” / espejo por **Asignar equipo** (elige `pm-*` existente; opcional conceder repos faltantes si admin).
- [x] Dejar de crear un org team por cada “equipo de app”; crear org team solo desde Organización o bajo demanda explícita.
- [x] Issues: label `pm/tarea:{taskId}` además de `pm/equipo:` (legacy).

### C. UI

- [x] Paso “Equipos” → **Fases y tareas** (editor de fases + lista agrupada).
- [x] Selector de equipo org filtrado por elegibilidad de repos.
- [x] Organización = única pantalla de CRUD de equipos.
- [x] Copy restante: Proyecto, Fase, Tarea, Subtarea, Equipo (sin mezclar sentidos).
- [x] Rutas: `#/proyectos/:projectId/...` (`tareas`, `inventario`; legacy `equipos`/`libro`).
  El id es de **proyecto** (hoy suele ser libro; no siempre).

### D. Proyecto ≠ libro + ScriptureScope

- [x] Schema `gateway-assignments-2` con `projectId` / `books` / `kind` (dual-read de schema 1).
- [x] Paths DCS / localStorage por `projectId`; inventarios por libro UBS.
- [x] Índice `{lang}/projects.json` (+ local `gt-projects:`).
- [x] UI crear proyecto libro vs temático (`ProjectsView`).
- [x] `ScriptureScope` en `ProjectTask` + filtro en `assignment.ts`.
- [x] UI de alcance bíblico en editor de tarea.
- [x] Multi-inventario / publish con `pm/libro:` y milestone = projectId.

## Criterios de hecho (MVP de migración)

- Un JSON viejo con `teams[]` abre sin pérdida bajo fases/tareas.
- En UI se habla de tareas/fases/equipos con el sentido de `MODELO.md`.
- No se puede asignar a una tarea un equipo sin los repos requeridos (o se ofrece concederlos).
- Publicar issues y Mis tareas siguen filtrando por namespace `pm`.
- Un JSON v1 con `book: "NEH"` se guarda como v2 con `projectId` + `books: ["NEH"]`.
- Una tarea con `scriptureScope` de caps 1–3 solo emite esos capítulos en backlog/publish.

## Riesgos

- Renombrar `Team` en todo el código es amplio (`assignment.ts`, vistas). Hacerlo por capas: tipos + alias → store → UI labels → renombre de archivos.
- `memberIds` en la tarea legacy: al migrar, si no hay `orgTeamId`, conservar `memberIds` solo para autoasignar local hasta que haya equipo org.

## Orden sugerido (próximos PRs)

1. ~~**Persistencia** — al exportar/guardar, emitir `phases` + `tasks` (seguir leyendo `teams`).~~
2. ~~**Asignar equipo** — picker con `filterTeamsEligibleForTask`; no crear `pm-*` al guardar una tarea.~~
3. ~~**UI fases** — agrupar lista por `phaseId`; CRUD mínimo de fases.~~
4. ~~**Rutas** — alinear hash con `MODELO.md`.~~
5. ~~**Label `pm/tarea:`** — al publicar subtareas.~~
6. ~~**Alcance D** — `ScriptureScope`, `projectId`, multi-libro.~~

Siguiente: extracción a monorepo `@gt/core` cuando haga falta.
