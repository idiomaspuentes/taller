# Rediseño de «Mis tareas»

*2 de octubre de 2026.* Plan antes de tocar código. Pensado para personas no técnicas, poco hábiles con computadoras o teléfonos, que entran a Taller a hacer **su** trabajo de traducción. Todo lo que sigue está confirmado en el código (archivo y función entre paréntesis) y en el navegador con el Door43 de mentira.

## 1. Cómo funciona hoy (confirmado)

**Qué muestra.** `MyTasksView.tsx` (1967 líneas) sirve tres pantallas con `mode`: `ahora`, `avisos` y `lista` (Mis tareas). La lista agrupa las subtareas en un acordeón **Proyecto → Fase → Tarea → Capítulo** (`groupQueue`), todo plegable. Carla, con **una** subtarea, la ve detrás de cuatro cabeceras: «Nehemías / NEH · autoasignación · 0 en curso / 1 subtarea», «Traducción», «Traducir TPL 1», «Capítulo 2».

**Filtros** (`filterProjectIssues`, `domain/myTasks.ts`): *Mías* = asignadas a mí o donde tengo un paso tomado (`userHasActiveStepRole`); *Disponibles* = sin persona asignada en proyectos con autoasignación; *Todas* = todo el proyecto, incluido el trabajo de otras personas. Más una búsqueda y «¿Cómo funciona?» con dos párrafos.

**Lo que una subtarea puede ser para una persona** (`audienceOf`, `domain/audience.ts`): `mine` (asignada a mí), `free` (sin asignar, de una tarea de un equipo del que soy parte) u `other`. Las dos primeras pueden estar **retenidas** (`hold`): *espera* (otra tarea debe terminar antes, `waitBlocks`) o *nivel* (la tarea pide un nivel que no tengo, o soy «oyente»). Lo retenido se ve pero no se anuncia.

**Estado y botón de cada fila** (`QueueRow`, mismo archivo). Un solo botón principal, decidido en este orden:

| Caso en el código | Chip | Botón de hoy |
|---|---|---|
| decisión del equipo (`isDecisionIssue`) | «Decisión del equipo» | Votar |
| retenida (espera / nivel) | «Esperando» / «Todavía no» | ninguno |
| libre y puedo tomarla (`canClaimIssue`) | «Disponible» | **Tomar** (solo asigna) o, en la tarjeta de «Ahora», **Empezar** (asigna y abre la herramienta, `begin`) |
| mía, todos los pasos hechos (`allStepsDone`) | «Tuya» | **Cerrar** |
| mía, sin pasos, con herramienta | «Tuya» / «En curso» | **Abrir editor** / **Estudiar** (`solverActionLabel`) |
| mía, aún no en curso | «Tuya» | **Empezar** → solo marca «en curso» (`start`), **no abre nada** |
| mía, en curso, con pasos pendientes | «En curso» | ninguno; abajo la lista de pasos |

Menú `···`: Comentar, Cerrar tarea, Liberar (`canUnassignIssue`).

**Pasos** (`TaskStep`, `stepClaimMode`): `none` = casilla libre; `exclusive` = una persona lo toma («Tomar»); `pool` = varias lo toman («Tomar la revisión», con cupo `n/m`) y se aprueba («Aprobar», `canApproveStep`). La lista completa de pasos se muestra **siempre abierta** bajo la fila (`showChecklist`), con una casilla y hasta tres botones por paso. Además hay una sección aparte «Revisiones» con las ofertas de pasos de todo el proyecto que puedo tomar o aprobar (`listStepClaimOffers`).

**Qué hace cada acción.**
- **Abrir editor** (`openSolverApp`, `domain/solverLaunch.ts`): `window.open(url, "_blank")`. **Siempre una pestaña nueva**, también para las herramientas de la propia app (todas son `openMode: "tab"` salvo Estudiar, que es externa). En el teléfono eso deja a la persona en otra pestaña sin camino de vuelta claro.
- **Cerrar** (`close` → `closeSubtask`): pasa los versículos al borrador del grupo, puede abrir un conflicto de versículos y cierra la subtarea. **Sin confirmación.** La palabra «Cerrar», para alguien no técnico, suena a cerrar la ventana.
- **Empezar** (fila normal) solo cambia la etiqueta a «en curso». La persona vuelve a quedar frente a la misma fila.
- Tocar el título abre la **conversación** de la subtarea (`canOpenConversation`), con «← Mis tareas» para volver.

**Qué se ve en «Ahora»** (`nowDecide` / `nowMine` / `nowFree`): primero una decisión pendiente, si no la primera mía en curso, si no la primera mía lista, si no la primera libre. Con el enlace «N avisos te esperan».

**Terminadas:** no se consultan. Solo se traen las cerradas con conflicto (`listMyConflictIssues`). Quien termina algo deja de verlo.

**Textos a la vista** que no significan nada para la persona: `es-419_gl`, `NEH`, «autoasignación», «0 en curso», «1 subtarea», «Probar un conflicto» (solo en desarrollo).

**Avisos** reutiliza el mismo componente (`mode="avisos"`); cualquier cambio tiene que dejarlo funcionando.

## 2. Qué está mal, en orden de daño

1. **La jerarquía es la de quien coordina.** Proyecto / Fase / Tarea / Capítulo es cómo se planifica, no cómo se trabaja. Cuatro niveles para llegar a una tarea.
2. **No hay un «siguiente paso» claro.** El botón cambia de nombre y de significado según el caso, y en el caso más común (mía, en curso, con pasos) no hay botón: hay una lista de casillas y botones.
3. **Las acciones graves no avisan.** «Cerrar» entrega el trabajo al grupo sin preguntar.
4. **La herramienta se abre en otra pestaña.** En el teléfono, la persona pierde la app.
5. **Filtros y búsqueda que no son suyos.** «Todas» enseña el trabajo ajeno; la búsqueda no sirve con dos tareas.
6. **Jerga y restos técnicos** en la cabecera y en las filas.
7. **Nada de lo terminado.** Sin sensación de avance.

## 3. Decisiones (tomadas pensando en quien menos maneja el teléfono)

1. **Una sola pantalla de trabajo.** «Ahora» deja de ser una pantalla aparte para la persona del equipo: su siguiente paso es la **primera tarjeta** de «Mis tareas». Barra del equipo: **Mis tareas · Avisos · Yo** (teléfono) y **Mis tareas · Avisos** (escritorio). Coordinación no cambia (Equipo hoy · Mis tareas · Avisos · Proyectos). `#/ahora` sigue existiendo y lleva a `#/mis-tareas` (los avisos push y los enlaces guardados siguen funcionando).
2. **Lista plana de tarjetas, agrupada por lo que toca hacer**, en este orden y con lo urgente abierto y lo demás plegado con su número:
   `Para decidir` → `En curso` → `Para empezar` → `Revisiones que puedes tomar` → `Libres para tu equipo` → `En espera` → `Terminadas (últimos 7 días)`.
   Dentro de cada grupo: primero lo que tiene mensajes sin leer, luego lo de movimiento más reciente (`attentionRank`).
   Lo que no es de la persona todavía (`Libres para tu equipo`, `Del siguiente libro`, `En espera`) va **desde el principio del libro**: por pasaje y, dentro de un pasaje, en el orden de las tareas del plan; los artículos, que no son de un pasaje, al final (`byPlace`). Por movimiento, el trabajo que nadie había tocado salía en el orden en que se creó, al revés: el primer pasaje del libro era la última de 49 tarjetas. De esos grupos y de `Terminadas` se muestran las **seis primeras** tarjetas y un botón «Ver N más»: abierto entero, lo libre de un libro eran trece pantallas en el teléfono.
3. **Una tarjeta = una tarea, un botón.** El botón dice lo que va a pasar:
   - **Empezar**: toma la tarea si está libre y abre la herramienta (la semántica de `begin`, que hoy solo tiene «Ahora»). Nunca más un «Empezar» que solo cambia una etiqueta.
   - **Seguir**: abre la herramienta del **siguiente paso pendiente** que yo pueda hacer. Si el siguiente paso es una revisión que hacen otras personas, no hay botón y la tarjeta lo dice: «Esperando la revisión de otras personas».
   - **Entregar** (antes «Cerrar»): solo cuando todos los pasos están hechos. Con confirmación: «Tu trabajo pasa al borrador del grupo. ¿Entregamos?».
   - **Votar** en decisiones; **Tomar la revisión** / **Aprobar** en las ofertas de revisión.
   - El menú `···` guarda lo raro: Ver pasos, Comentar, Liberar (con confirmación).
4. **Los pasos no se abren solos.** La tarjeta muestra el avance («2 de 4 pasos» con puntos) y el nombre del paso siguiente. La lista completa aparece al tocar «Ver pasos», con un solo botón por paso. Así la tarjeta cabe en una pantalla de teléfono.
5. **La herramienta se abre en la misma pestaña** cuando es de la app (`kind: "app"`), con «← Mis tareas» arriba. Solo lo externo (Estudiar, en TranslationCore Study) abre otra pestaña, y el botón lo dice: «Estudiar ↗ (se abre aparte)».
6. **Sin jerga.** Cabecera: «Mis tareas» y «Hola, Carla» (nombre de Door43 si lo tiene, si no el usuario). El equipo (espacio) solo si hay más de uno. Nada de `es-419_gl`, `NEH`, «autoasignación», «subtarea». La tarea se nombra por **lo que es y dónde**: «Traducir TPL · Nehemías 2» (libro con `bookLabel`, capítulo; o el rango «Nehemías 1:1–8» cuando la orden lo trae en `label`). El proyecto aparece como etiqueta pequeña solo si hay más de un proyecto.
7. **Se van** el acordeón, los filtros Mías/Todas/Disponibles, la búsqueda y «¿Cómo funciona?». La búsqueda vuelve sola si hay más de 12 tarjetas. La ayuda pasa a un «?» que abre una hoja corta. «Probar un conflicto» se queda solo en desarrollo, dentro del menú de Pruebas.
8. **Terminadas**: consulta nueva de las cerradas asignadas a mí en los últimos 7 días (`searchPmIssues` ya admite `state: "closed"` + `assigned`), plegadas al final. «Terminaste 3 esta semana.»
9. **Para quien casi no usa el teléfono:** botones de 48 px de alto y texto de 16 px; el estado siempre con palabra, no solo con color; una sola acción primaria por tarjeta; confirmación en lo irreversible (Entregar, Liberar); mensajes de éxito en una frase («Listo. Tu trabajo quedó en el borrador del grupo.»); la lista se actualiza sola al volver a la app (hoy solo al entrar).

## 4. Cómo se verá

Teléfono (persona del equipo):

```
Mis tareas                              ↻
Hola, Carla

EN CURSO
┌──────────────────────────────────────┐
│ Traducir TPL · Nehemías 2            │
│ Borrador  ●●○○  2 de 4 pasos         │
│ Siguiente: Revisión en pares         │
│ Último movimiento: ayer              │
│ Bea: ¿seguro de «siervo»?       ● 1  │
│ [        Seguir        ]        ···  │
└──────────────────────────────────────┘

LIBRES PARA TU EQUIPO (1)                ▸
EN ESPERA (1)                             ▸
TERMINADAS ESTA SEMANA (0)                ▸

            Mis tareas · Avisos · Yo
```

Escritorio: la misma lista en una columna de 40 rem como máximo; los grupos plegados a la derecha como resumen («Libres 1 · En espera 1 · Terminadas 3») si cabe.

Tarjeta en espera (sin botón): «Revisar la alineación · Nehemías 1 — Espera a «Traducir TPL» de @ana». Tarjeta libre: «Traducir TPL · Nehemías 3 — Libre para tu equipo desde hace 2 días — [ Empezar ]». Decisión: «Nehemías 1:2 · decidir la alineación — 2 personas ya votaron — [ Votar ]».

## 5. Qué se construye y cómo se prueba

Nada de esto cambia los datos en Door43 ni los archivos del plan; es la misma lógica con otra cara.

**Fase 1 — Lógica pura, con pruebas (medio día)**
- `src/domain/myTasksBoard.ts`: a partir de los `buckets`, la sesión, el nivel, el cursor de lectura y las ofertas, devuelve los **grupos** en orden y, por tarjeta, el **estado**, el **siguiente paso**, la **acción principal** (`empezar | seguir | entregar | votar | ninguna`), el avance (`hechos/total`) y la frase de contexto. Reutiliza `audienceOf`, `waitBlocks`, `canClaimIssue`, `allStepsDone`, `stepClaimMode`, `canClaimStep`, `canApproveStep`, `listStepClaimOffers`, `rowActivity`.
- `scripts/verify-my-tasks-board.mts`: con las personas del mock (ana, bea, carla) y casos armados: libre / mía sin empezar / en curso con paso siguiente mío / en curso esperando revisión ajena / todos los pasos hechos / retenida por espera / retenida por nivel / decisión / oyente. Comprueba grupo, botón y frase en español y portugués.
- `listMyClosedIssues(session, org, days)` en `dcs/issues.ts`, con prueba contra el mock.

**Fase 2 — Las tarjetas (1 día)**
- `TaskCard.tsx` (una tarjeta) y `MyTasksBoard.tsx` (grupos, plegado, búsqueda tardía). `MyTasksView` conserva la carga de datos y las acciones (`take`, `begin`, `resolve`, `close`, `claimStepOnIssue`, `approveStepOnIssue`, `liberar`) y pasa a renderizar el board en `mode="lista"`; `mode="avisos"` sigue igual.
- Cabecera nueva, sin jerga; textos en `es.json` / `pt.json`; nombres con `localizeName` y `bookLabel`.
- Confirmaciones de Entregar y Liberar (hoja inferior en el teléfono, diálogo en escritorio).
- Prueba a mano en el mock con las tres personas, 375 px y 1200 px, en español y portugués.

**Fase 3 — Lo que hace la app alrededor (medio día)**
- Herramientas de la app en la misma pestaña (`openSolverApp`: `location.assign` cuando la URL es del mismo origen; `window.open` solo para `kind: "url"`). Al cerrar la herramienta (`onSolverClose`) se vuelve a «Mis tareas» en la tarjeta de esa subtarea, que resalta un momento (`returnTo.ts`); antes se volvía al principio de la lista. Al completar un paso desde su herramienta se abre el paso siguiente cuando es de la misma persona y no hay que sumarse a él (`goOnAfterStep`, `nextStepOfMine`): del estudio se pasa al borrador sin volver a la lista.
- Recarga al volver a la app (`visibilitychange`), igual que las menciones.
- «Terminadas esta semana» con la consulta nueva.

**Fase 4 — Navegación y cierre (medio día)**
- `#/ahora` → `#/mis-tareas`; barra del equipo con «Yo»; `landingRoute` de la persona del equipo a `mis-tareas`; la tarjeta de primeros pasos y el aviso de notificaciones siguen arriba de la lista.
- Revisar que Avisos, los enlaces de los avisos push (`#/mis-tareas/<n>`) y la conversación siguen funcionando.
- `docs/PLAN.md` y `docs/CONFIGURACION.md` al día; publicar.

Total: unas dos jornadas y media. Al terminar la fase 2 ya se puede publicar; las fases 3 y 4 pueden ir en días distintos.

## 6. Riesgos y qué se pierde

- **Quien coordina** pierde la vista por proyecto dentro de «Mis tareas». La tiene en «Equipo hoy» (por estado) y en «Proyectos» (por plan). Si la echa de menos, se añade «Ver por proyecto» en el `···` de la cabecera, no en la lista.
- **Abrir la herramienta en la misma pestaña** cambia un hábito de quien ya prueba la app en escritorio con dos pestañas. Se mantiene «Abrir en otra pestaña» en el `···` de la tarjeta.
- **Muchas tareas** (más de 20 propias): la lista crece. Los grupos plegados y la búsqueda que aparece sola lo cubren; si no basta, se pagina por grupo.
- **Avisos** comparte código: se cubre con la prueba manual de la fase 2 y con `verify:audience`, `verify:team-today`, `verify:scope`, `verify-config` (textos).
- **Las palabras.** Pasar de «subtarea» a «tarea» en esta pantalla deja «subtarea» en las de coordinación. Es deliberado (allí la distinción importa), pero conviene que lo revise quien escribe la guía.

## 7. Lo que decidí sin preguntar (para que lo puedas vetar)

1. «Ahora» desaparece como pantalla y pasa a ser la primera tarjeta; la barra del equipo queda en tres.
2. «Cerrar» pasa a llamarse «Entregar» y pide confirmación.
3. Las herramientas de la app se abren en la misma pestaña.
4. Se quitan «Todas», la búsqueda permanente y el acordeón por proyecto.
5. En esta pantalla se dice «tarea», no «subtarea».
6. «Terminadas» muestra los últimos 7 días.
7. Los pasos se ven solo al pedirlos («Ver pasos»); la tarjeta enseña el avance y el siguiente.
