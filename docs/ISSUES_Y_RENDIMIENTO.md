# Las subtareas en Door43 y lo que tarda Taller

*9 de noviembre de 2026. Abel aprobó el camino A y está hecho (abajo, «Lo que cambió con A»). El camino C espera su
decisión.*

Cada subtarea es una incidencia (issue) de Door43 en el repositorio del plan (`{org}/taller`). Un libro del FCR trae
unas 1.200 (Nehemías empezó con 1.221), y cada libro nuevo suma otras tantas. Este documento mide dónde se va el
tiempo, separa lo que de verdad necesita ser una incidencia de lo que solo vive ahí, y propone cómo seguir.

## 1. Lo que se midió

**Cómo.** El Door43 de prueba (`scripts/mock-door43`) ahora pagina y responde a `since` como el real, cuenta las
peticiones y los bytes de cada pantalla (`GET /__mock/stats`) y puede tardar lo que tarda Door43
(`MOCK_LIST_LATENCY_MS=800` por página de subtareas). `scripts/mock-door43/seed-big-book.mts` lo siembra con el plan FCR
y subtareas escritas como las escribe la app (título, texto, marcadores, etiquetas e hito): **Nehemías con 1.157
abiertas** y **Esdras con 890, casi todas cerradas**. Con `MOCK_FULL_ISSUES=1` cada subtarea viene completa, como la
manda Door43: **3,7 KB** cada una (2,5 KB de persona, etiquetas, hito y repositorio; el resto, su texto). Un libro
entero son **24 páginas de 50 y 4,2 MB**.

| Pantalla (en el mock, dos libros) | Páginas de subtareas | Bytes | Notas |
|---|---|---|---|
| «Mis tareas», persona del equipo, la primera vez en el aparato | 37 | 5,4 MB | lee entero cada libro abierto |
| «Mis tareas», al volver a abrir la app | 9 | 0,85 MB | más 0,5 MB de archivos del plan; guarda en el aparato 2,6 millones de caracteres |
| «Equipo hoy», quien coordina | 53 | 9,1 MB | abiertas y cerradas de cada libro, **un libro tras otro**: ocupó al servidor 30 s |
| «Proyectos» justo después | 0 | — | usa lo leído |
| Abrir un proyecto (subtareas) justo después | 26 | 4,2 MB | lo vuelve a leer entero aunque se acaba de leer |
| La app quieta, cada minuto | 2–8 | hasta 1 MB | sondeo de actividad: mis subtareas, menciones y lo que cambió; crece con las subtareas de cada persona (en el mock, Bea tiene unas 80, más que nadie del equipo real) |

Lo que no se recorrió en el navegador sale del código (cada caso con su archivo en el inventario de la sección 2):
**«Terminé»** lee el libro entero con las cerradas (24+ páginas) porque «Mis tareas» solo guarda las abiertas;
**publicar el plan** lo lee entero 2 o 3 veces; el **tablero de un equipo** lee las abiertas de ese equipo en todos los
libros.

**Cuánto tarda en Door43.** El mock no se pone lento con muchas peticiones a la vez; Door43 sí. El 6 de noviembre, en
producción, una página que sola tarda menos de un segundo tardó hasta 27 s con 77 a la vez, y «Mis tareas» apareció a
los 35 s. El arreglo de ese día (seis peticiones a la vez, y cada libro leído una vez por página) ayuda, pero no cambia
la cuenta de fondo:

- **Todo crece con las subtareas de todos los libros abiertos.** Cada libro nuevo suma unas 24 páginas a «Mis
  tareas» la primera vez, y 24 abiertas + cerradas a «Equipo hoy», al tablero y a «Terminé».
- **Las cerradas no dejan de contar.** Cada lectura «abiertas y cerradas» vuelve a bajar todo lo terminado del libro.
- **La copia del aparato no alcanza.** Con un libro grande ocupa 2,6 millones de caracteres en `localStorage`, unos
  5 MB: el límite de Safari en el iPhone. Con dos libros grandes no cabe, la app no lo dice (`keepTasks` calla el
  error) y cada arranque vuelve a leer todo.
- **Se lee más de lo que se usa.** Abrir un proyecto no usa lo ya leído (`pullIssues`); «Mis tareas» pide las abiertas
  de cada libro antes de saber si las necesita (`myTasks.ts`, `loadBucket`); «Equipo hoy» lee los libros uno detrás
  de otro (`teamToday.ts`) e incluye los casi terminados.

No se comprobó si Door43 comprime las respuestas: comprimidas, los 4,2 MB de un libro serían unos 224 KB. Aun así, lo
lento es que Door43 arme cada página de 50 (personas, etiquetas, hitos), no solo bajarla.

## 2. Qué guarda una subtarea, y qué necesita ser una incidencia

| Qué | Dónde vive | ¿Necesita Door43? |
|---|---|---|
| El número y el título | la incidencia | **Sí**: el Worker de avisos la lee para nombrarla y comprobar quién la ve |
| Quién la tiene | asignados | **Sí**: Door43 avisa y el webhook manda el aviso al teléfono |
| La conversación (comentarios de personas) | comentarios | **Sí**: el equipo la lee y la escribe; el webhook avisa a mencionados y asignados |
| Menciones | notificaciones de Door43 | **Sí**, por definición |
| Abierta / cerrada | estado | A medias: sirve para buscar; los avisos de cierre los manda la app |
| El encargo: tarea, porción, trabajos (`gateway-work-order`) | texto, en JSON | No: es una copia del plan |
| Pasos hechos, asientos, aprobaciones, quién cerró y con qué fuentes, cuánto lleva (`gateway-task-progress-2`) | texto, en JSON | No: es el estado de la app. Se reescribe entero sin control de versión: gana el último que guarda |
| La revisión enlazada (`gateway-portion-pr`) | texto, en JSON | No: es un enlace |
| «En curso» y «conflicto» | etiqueta (+ marca en el texto) | No: banderas para poder buscarlas |
| Libro, tarea, recurso, capítulo, espacio | hito y etiquetas `pm/*` | No: solo filtros; la app vuelve a filtrar por su cuenta |
| Tarjetas, votos y decisiones (`tas:chat-event`) | comentarios | Mixto: el resumen con menciones aprovecha los avisos; los datos (versículo elegido, conflicto) son estado de la app |

Además de las subtareas hay en `taller` incidencias de **decisión** (una por propuesta de alineación; todo su estado
está en comentarios), de **lista de propuestas** y de **corrección** (una por inquietud del comité).

En resumen: de lo que pesa y se lee miles de veces, **casi todo es estado de la app que viaja dentro de la
incidencia**. Lo que solo Door43 da (conversación, menciones, asignación y sus avisos) se usa en pocas subtareas a la
vez y nunca exige leer el libro entero.

## 3. Tres caminos

### A. Pedir menos sin cambiar nada de fondo

Arreglar lo que se lee de más: abrir un proyecto con lo ya leído; «Equipo hoy» en paralelo y sin los libros
terminados; «Mis tareas» sin pedir lo que no usa; «Terminé» sin releer las cerradas; guardar la copia de cada libro (no
solo la de «Mis tareas») en IndexedDB, que no tiene el límite de 5 MB, y desde ahí pedir solo lo que cambió.

- **Costo:** 2 a 3 días, con sus pruebas en el mock.
- **Gana:** después de la primera vez en cada aparato, cada pantalla pide una página por libro.
- **No resuelve:** la primera vez en un aparato (teléfono nuevo, datos borrados) sigue siendo 24 páginas por libro, y
  sigue creciendo con cada libro.
- **Riesgo:** bajo. Nada cambia en Door43.

#### Lo que cambió con A (9 de noviembre)

- **Cada libro leído se guarda en el aparato** (IndexedDB, `src/lib/deviceStore.ts`), con lo que las pantallas leen de
  cada subtarea. Al abrir la app otra vez se pide solo lo que cambió desde entonces (`readProjectIssues` en
  `src/dcs/issues.ts`).
  - Se pide así hasta tres días sin abrir la app; antes eran seis horas, y cada mañana se leía todo entero.
  - Igual se lee entero una vez por semana, por lo que un cambio no dice (una subtarea pasada a otro libro).
- **«Mis tareas» guarda su lista en IndexedDB**, y no en `localStorage`. Al leerla, quita la copia vieja.
- **Abrir un proyecto usa lo ya leído** (`pullIssues`).
- **«Equipo hoy» lee todos los libros a la vez.**
- **«Terminé»** también se pone al día desde lo guardado: abiertas y cerradas se leen enteras solo la primera vez en
  cada aparato.

Medido de nuevo en el mock, con los mismos dos libros:

| Pantalla | Antes | Con A |
|---|---|---|
| «Mis tareas» al volver a abrir la app | 9 páginas, 1,4 MB | 2 páginas, 0,48 MB |
| «Equipo hoy» al volver a abrir la app | 53 páginas, 9,1 MB | 9 páginas, 0,84 MB |
| Abrir un proyecto | 26 páginas, 4,2 MB | 1 página vacía |
| La primera vez en un aparato | igual | igual (37 y 53 páginas); «Equipo hoy» ocupó al servidor 22 s y no 30, por leer los libros a la vez |

#### Páginas de 500 (12 de noviembre)

Door43 ya comprime sus respuestas: los 4,2 MB de un libro viajan como unos 224 KB. Además acepta hasta 500
subtareas por página (`GET /api/v1/settings/api`, `max_response_items: 500`), y Taller pedía 50.

Ahora cada servidor dice su límite y Taller pide hasta 500 (`src/dcs/pageSize.ts`). Si el límite no se puede leer,
sigue pidiendo 50: pedir más de lo que el servidor da haría que una página corta pareciera la última, y se perderían
subtareas.

| La primera vez en un aparato | Páginas de 50 | Páginas de 500 |
|---|---|---|
| «Mis tareas», persona del equipo | 37 | 6 |
| «Equipo hoy», quien coordina | 53 | 8, con los mismos números en pantalla |

En Door43 una página de 500 tardó 4,8 s y una de 50, 1,4 s (una sola muestra de cada una, el 12 de noviembre).
El mock tarda lo mismo con cualquier tamaño de página, así que exagera la ganancia de tiempo. Lo seguro es esto: el
servidor hace 8 veces menos búsquedas y comprobaciones de permisos. Conviene medirlo en QA.

#### Lo que corrigió la revisión (12 de noviembre)

- **Un libro se lee entero siempre con abiertas y cerradas.** Door43 da primero lo más nuevo, en páginas.
  - Si alguien cerraba una subtarea mientras se leían solo las abiertas, las demás subían un lugar, y una pasaba a una
    página ya leída: se perdía.
  - Con la copia en el aparato, ese hueco duraba hasta la lectura entera de la semana.
  - Leídas con las cerradas, nada se mueve.
- **Dos pantallas que leen el mismo libro a la vez** ya no dejan una copia más vieja o más chica que la que ya había.
- **Un libro que no cambió no se vuelve a guardar entero.** Solo se anota cuándo se comprobó, y así no se lee entero
  cada tres días solo por estar quieto.
- **Si IndexedDB no contesta** (pasa en algunos iPhone), a los 1,5 s se sigue sin él. Antes, la app se quedaba
  esperando.
- **«Mis tareas» pide a Door43 sin esperar su copia del aparato.**
- **Si no se pudo preguntar el límite de páginas**, se vuelve a preguntar la próxima vez.
- **La cola de Door43 también cuenta las escrituras al mock.** Antes, contra el mock una escritura no invalidaba lo
  leído, y `verify:redo-mock` fallaba también en `main` por eso.

**Sigue pendiente:**
- `verify:proposals-mock` falla, también en `main`: busca en el FCR un paso que se cierra «por consenso», y el proceso
  ya no lo tiene.
- Las copias de libros en el aparato no se borran solas (una por persona, organización, espacio y libro).

**En el propio Door43 (`unfoldingWord/dcs`)** se podría hacer más. Sería trabajo compartido, con la regla de uW y
según el calendario de uW:
- revisar por qué Door43 se pone lento con muchas peticiones a la vez (configuración, sin código);
- una búsqueda que devuelva subtareas «ligeras», sin la persona, el repositorio y la solicitud de cambios de cada una
  (`LoadAttributes` en `models/issues/issue_list.go`);
- un pedido que devuelva el índice de un libro.

Conviene solo si, con A y las páginas de 500, la app sigue lenta.

**No se hizo:**
- **«Mis tareas» sigue pidiendo las abiertas de cada libro.** Con el FCR casi siempre las necesita, por las esperas
  entre tareas.
- **Los libros terminados siguen leyéndose.** Hay que decidir antes desde cuándo un libro cuenta como terminado.
- **Publicar el plan sigue leyendo todo entero.** Así no se crea nada dos veces.

### B. Menos incidencias

Crear la incidencia solo cuando alguien toma la subtarea, o una por capítulo en vez de una por porción.

- **Costo:** 2 a 3 semanas. Unos 25 módulos leen el encargo y el progreso de la incidencia, y las esperas y el
  trabajo libre se calculan con todas a la vista.
- **Gana:** al empezar un libro. Al terminarlo ya existen todas.
- **En contra:** una por capítulo cambia cómo se reparte el trabajo y rompe «una porción, una revisión».
- **Migración:** Nehemías, Esdras y Ester ya están en producción.
- **Descartado como solución.** Una parte sí vale: que un libro publicado deje de leerse.

### C. Un índice de cada libro en un Worker, con Door43 como fuente de verdad (recomendado)

Un Worker de Cloudflare guarda una fila corta por subtarea en D1: número, estado, asignados, tarea, porción, los
marcadores y la fecha del último cambio. Se alimenta del **webhook que ya existe para los avisos**, que manda la
incidencia completa en cada cambio. La app sigue escribiendo en Door43 como hoy. Solo cambia cómo lee:

1. Pide el índice del libro al Worker: una petición de unos 26 KB comprimidos (17 KB sin la lista de trabajos de cada
   subtarea; medido con el Nehemías sembrado), en vez de 24 páginas y 4,2 MB.
2. Pide a Door43 lo que cambió después: una página, como hoy con `since`. Si el webhook se retrasó, esto lo corrige.
3. Si el Worker no está configurado o no responde, lee como hoy.

El Worker comprueba con el token de Door43 de quien pregunta que pueda leer `{org}/taller`, como ya hace `/notify`.
Cuando un libro no tiene índice, lo arma leyendo Door43 una vez con ese mismo token.

- **Costo:** 1 a 2 semanas. Incluye el Worker y D1 (o el Worker de avisos ampliado), la lectura en la app con su
  respaldo, el mock y las pruebas. Publicarlo lo hace Abel.
- **Gana:** cada pantalla pide una petición por libro, la primera vez en cualquier aparato. «Equipo hoy» y «Terminé»
  dejan de bajar las cerradas, y Door43 deja de armar cientos de páginas al día.
- **Riesgos:** que el índice se desfase (lo cubre el paso 2) y que el Worker se caiga (lo cubre el paso 3).
- **Privacidad:** Cloudflare guarda una copia de títulos y logins del plan, como ya guarda las suscripciones de avisos.
- **Plan gratuito:** alcanza de sobra (D1: 5 millones de filas leídas y 100.000 escritas al día). Hay que confirmarlo
  al publicar.
- **Otra organización:** es opcional. Se activa con una dirección en `taller.config.ts` (como `VITE_PUSH_URL`) y el
  webhook de la organización. Sin ellos, Taller funciona como hoy.

### D. (Considerado) Una base de datos propia como fuente de verdad

El estado de las subtareas (encargo, progreso, asientos) pasaría a D1, y Door43 quedaría solo para la conversación.
Es lo más rápido a la larga, pero convierte a Taller en una app con servidor propio:

- si el servidor se cae, la app se cae;
- hay que hacer copias de seguridad;
- otra organización tendría que montar el suyo;
- el historial deja de verse en Door43.

**Costo:** 4 a 8 semanas, más migrar los tres libros vivos. No hace falta hoy, y C es su primera mitad: si un día se
quiere, el índice ya existe.

## 4. Recomendación

**A ahora y C después.** A son pocos días, no toca Door43 y vale con o sin índice. Arregla lo que se nota al volver a
abrir la app en el mismo teléfono. C es la respuesta de mediano plazo que pide Abel: lo que se baja deja de crecer con
el tamaño del libro. Door43 sigue siendo donde vive todo, así que no hay migración ni riesgo de perder datos, y se puede
apagar volviendo a como está hoy. Para un equipo pequeño que trabaja con el teléfono, lo que importa es que la primera
pantalla llegue rápido con pocos datos, y eso solo lo da C. B y D no hacen falta por ahora.

**Antes de empezar C, Abel decide:**

1. Si el índice va en el Worker de avisos (`tas-push`, ya recibe el webhook) o en uno nuevo.
2. Si se acepta que Cloudflare guarde esa copia del plan.
3. Si el webhook de producción de `es-419_gl` ya está creado. El índice lo necesita; [`PLAN.md`](PLAN.md) lo daba
   como pendiente.

## Pendiente: estudiar una alternativa a las incidencias

Decidido por Abel el 12 de noviembre: se hace **después de medir A y las páginas de 500 una o dos semanas en
producción**. Hay dos razones para hacerlo:

- **Crecer con cada libro.** Aunque A y las páginas de 500 mejoren la velocidad, todo sigue creciendo con cada libro
  nuevo.
- **Los guardados que se pisan.** El progreso de cada subtarea se guarda reescribiendo todo su texto, sin comprobar
  si cambió mientras tanto (`setIssueTaskProgress` en `src/dcs/issues.ts`). Si dos personas guardan la misma
  subtarea casi a la vez, gana la última y se pierde lo de la otra. No se sabe si ya pasó en producción.

**Qué comparar:**
1. el estado de cada subtarea en archivos del repositorio del plan (uno por persona o por subtarea, para que nadie
   escriba el mismo);
2. el índice en un Worker (camino C);
3. una base de datos propia, con la incidencia de Door43 solo para la conversación.

**Con qué criterios:**
- velocidad en el teléfono, la primera vez y las demás;
- que nada se pierda al guardar;
- lo que Door43 tiene que seguir dando: conversación, menciones y sus avisos, y quién ve qué;
- configurarlo para otra organización;
- migrar Nehemías, Esdras y Ester;
- quién lo mantiene.

## Cómo repetir las medidas

```bash
# Door43 de prueba, con subtareas completas y la lentitud de Door43
MOCK_PM_ORG=es-419_gl MOCK_NO_SAMPLE=1 MOCK_FULL_ISSUES=1 MOCK_LATENCY_MS=150 MOCK_LIST_LATENCY_MS=800 npm run mock:door43
npx tsx --tsconfig tsconfig.scripts.json scripts/mock-door43/seed-big-book.mts NEH:6:0 EZR:6:0.9
```

Entrar como `bea` (equipo) o `ana` (coordina): la sesión se pone a mano, como en
[`scripts/mock-door43/README.md`](../scripts/mock-door43/README.md), con `pmOrg: es-419_gl` y en `teams` el equipo
`Equipo` (o `managers`). Luego: `POST /__mock/stats/reset`, abrir la pantalla y leer `GET /__mock/stats`.
