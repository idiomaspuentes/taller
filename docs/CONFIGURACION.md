# Adaptar Taller a otra organización

Todo lo que cambia de una organización a otra vive en **un solo archivo**: [`taller.config.ts`](../taller.config.ts), en la raíz del repositorio. Quien use este código no necesita tocar el resto para tener su propia bienvenida, sus equipos y su nombre. El archivo no guarda secretos.

## Qué se configura

| Campo | Para qué sirve |
|---|---|
| `brand.name` | El nombre de la app en cada idioma de la interfaz (`es`, `pt`). |
| `brand.organization` | La organización que aparece sobre el título de la bienvenida. |
| `brand.short` | El nombre corto de la organización (para Idiomas Puentes, «Id»). Se añade al nombre de la app en el título del sitio: «Taller Id». |
| `uiLanguages` / `defaultUiLanguage` | Los idiomas de la interfaz. La primera visita sigue el idioma del navegador; la persona puede cambiarlo en la pantalla de bienvenida. |
| `defaultServer` | El servidor de Door43 con el que arranca la app publicada (`production` o `qa`). La persona normal nunca ve la opción de servidor: quien prueba abre la app con `?server=qa` (o `?server=production` para volver), y solo en ese dispositivo aparece «Avanzado: servidor» al iniciar sesión. |
| `pmRepo` | El nombre del repositorio de Door43 donde Taller guarda el plan, las subtareas y los ajustes del equipo (hoy `taller`). Se crea al primer inicio de sesión si no existe. Quien ya usa `gateway-tasks` lo conserva escribiéndolo aquí. |
| `workspaces` | Los **espacios de trabajo**: uno por equipo de lengua. Ver abajo. |
| `branchNames` | La primera palabra de cada clase de rama que la app crea en los repositorios de contenido. Ver «Los nombres de las ramas». |
| `welcome` | El texto de la primera pantalla, en cada idioma: título, subtítulo, tres líneas de lo que se encontrará, la pregunta del equipo, el botón y el texto de confianza. |

## Espacios de trabajo (equipos que no se mezclan)

Cada espacio es un equipo con su propio trabajo. Pueden estar en **organizaciones distintas**, o en **la misma organización** (con idiomas distintos o con el mismo idioma). En todos los casos **sus proyectos, tareas y avisos no se mezclan**: la app solo lee y escribe dentro del espacio elegido.

```ts
{
  id: "pt",                    // clave estable; no la cambies cuando ya haya personas usando la app
  lang: "pt-br",               // código de lengua en Door43
  contentOrg: "pt-br_gl",      // organización de los repositorios de contenido
  pmOrg: "pt-br_gl",           // organización donde vive el repositorio del plan (`pmRepo`) con el plan y las subtareas
  scope: "pt",                 // opcional: lo que lo distingue de otro espacio en la MISMA organización
  uiLanguage: "pt",            // idioma de interfaz con el que empieza este equipo
  name: { es: "Portugués (Brasil)", pt: "Português (Brasil)" },
}
```

### Cuándo hace falta `scope`

- **Un espacio solo en su organización** (cada uno en la suya): no hace falta. Se queda con los nombres de siempre.
- **Varios espacios en la misma organización**: cada uno necesita un `scope` distinto (solo letras minúsculas, números y guiones). Como mucho **uno** puede no tenerlo; ese conserva los nombres de siempre, así que los datos que ya existían siguen siendo suyos.

Con `scope`, el espacio marca todo lo que escribe y filtra todo lo que lee:

| Qué | Cómo queda con `scope: "pt"` |
|---|---|
| Subtareas (incidencias) | llevan la etiqueta `pm/espacio:pt` y solo se listan en ese espacio; un espacio sin scope no ve las que tienen scope |
| Hitos de cada proyecto | `pt/NEH` en lugar de `NEH` |
| Archivos del plan, equipos, flujos, niveles de las personas (`config.json`) | bajo `pt/…` en el repositorio del plan (`pmRepo`) |
| Copias en el navegador | con su propia clave |
| Menciones y avisos | solo las de subtareas de ese espacio |
| Un enlace a una subtarea de otro espacio | no la abre: avisa que es de otro espacio |

Qué **sí** se comparte dentro de una organización: los equipos de Door43, el catálogo de herramientas (`solvers.json`) y los repositorios de contenido.

La configuración se valida (consola en desarrollo y `npm run verify:config`): avisa de espacios sin `scope` que comparten organización, de scopes repetidos o con caracteres no válidos.

- Con **un solo espacio**, la bienvenida no pregunta nada y entra directo.
- Con **varios**, la bienvenida muestra una tarjeta por equipo y sugiere el que habla el idioma de la interfaz.
- Quien ya inició sesión puede cambiar de espacio en el diálogo «Sesión»; la app se recarga para que no quede nada del espacio anterior.

## El proceso de trabajo

Las fases, tareas, pasos y herramientas con las que trabaja el equipo no están en el código: son un paquete JSON en
`processes/`, listado en `processes` de `taller.config.ts`. Otra organización escribe su propio paquete y lo lista
ahí. Ver [`PROCESOS.md`](PROCESOS.md).

## Los nombres de las ramas

En cada repositorio de contenido (el del TPL, el de las notas…) la app guarda el trabajo en ramas y etiquetas. Cada
clase empieza con su propia palabra, para que quien abra el repositorio en Door43 entienda qué es cada una:

| Clave | Por defecto | Qué es | Ejemplo |
|---|---|---|---|
| `draft` | `borrador` | El borrador del grupo de una tarea de traducción. | `borrador/jud/tpl` |
| `work` | `trabajo` | El trabajo de una persona en una subtarea. | `trabajo/jud/tpl/valeska/160` |
| `archive` | `archivo` | Lo que esa persona entregó, tal como lo dejó. | `archivo/jud/160` |
| `phase` | `fase` | El texto tal como quedó al cerrar una fase. | `fase/jud/traduccion` |
| `validation` | `validacion` | Una unidad tal como la valida el comité, antes de llegar a lo publicado. | `validacion/jud/1` |

```ts
branchNames: { draft: "borrador", work: "trabajo", archive: "archivo", phase: "fase", validation: "validacion" },
```

- Un espacio de trabajo puede dar las suyas (`branchNames` dentro del espacio); lo que no diga lo toma de la
  organización. El espacio en portugués podría usar `{ draft: "rascunho", work: "trabalho", archive: "arquivo" }`.
- Solo minúsculas, números y guion; sin barras; las cinco distintas entre sí. `npm run verify:config` lo comprueba y
  la app no arranca con unas palabras que no sirven.
- **No las cambies cuando un libro ya tiene ramas.** La app crea con las palabras configuradas y busca con esas
  mismas: las ramas creadas con la palabra anterior dejarían de encontrarse. Cámbialas antes de empezar el primer
  libro de un espacio, o entre un libro terminado y el siguiente.
- Solo la tarea que **traduce** un recurso tiene borrador propio (la primera tarea del proceso con ese recurso).
  Las demás tareas del mismo recurso (una lectura grupal, la afinación, la armonización, la validación) trabajan
  sobre ese borrador y no crean ramas.
- Los libros empezados antes de que existieran estas palabras (`jud/tpl`, `t/jud/tpl`, `w/jud/tpl/…`) se siguen
  leyendo donde están; esos nombres no se crean más.

## Cambiar la bienvenida

Edita `welcome.es` y `welcome.pt` en `taller.config.ts`. Los tres puntos (`points`) llevan un ícono cada uno. Si añades un idioma nuevo hay que:

1. añadirlo a `UiLanguage` en [`src/config/types.ts`](../src/config/types.ts) y a `uiLanguages`;
2. escribir su texto en `welcome`, `brand.name` y el `name` de cada espacio;
3. añadir su columna en [`src/i18n/messages.ts`](../src/i18n/messages.ts) (los textos generales de la interfaz: menús, inicio de sesión, avisos).

## Qué está traducido y qué no

La pantalla de bienvenida, el inicio de sesión, los menús principales, el aviso para activar notificaciones y el selector de espacio están en español y portugués. **El resto de la app sigue en español** y se irá pasando a `src/i18n/messages.ts` por pantallas.

## Avisos con la app cerrada en cada espacio

El Worker de avisos (`push-worker/`) escucha un webhook por organización. Hay que crear el webhook de Door43 en cada organización (`pmOrg`) distinta, con el mismo secreto; los espacios que comparten organización comparten el webhook. Ver [`push-worker/README.md`](../push-worker/README.md).

## Comprobar

```bash
npm run verify:config
```

Valida la configuración (espacios sin repetir, textos completos en cada idioma, palabras de las ramas) y la lógica de idioma y espacio. `npm run verify:branch-names` comprueba los nombres de las ramas y qué tarea tiene borrador. `npm run verify:scope` comprueba que dos espacios de una misma organización no se ven entre sí.

## Léxicos

Al tocar una palabra del original en la alineación, Taller muestra lo que significa. Lo lee de un repositorio de léxico en Door43, con un archivo por número de Strong (`content/<número>.json`). Cada espacio dice de dónde en `taller.config.ts`:

```ts
lexicons: {
  greek: [{ owner: "es-419_gl", repo: "es-419_ugl" }],
  hebrew: [{ owner: "es-419_gl", repo: "es-419_uhl" }],
  credit: { es: "…", pt: "…" },
},
```

- Los repositorios de cada lengua se prueban en orden; vale el primero que tenga la entrada.
- Sin `lexicons`, se buscan `<lang>_ugl` y `<lang>_uhl` en `contentOrg`.
- `credit` es la atribución que pide el léxico; se muestra debajo de cada entrada.
- También sirve un léxico sencillo de Door43 (solo `brief` y `long`): se muestra sin sentidos por versículo.

Los léxicos de Idiomas Puentes se generan con `npm run lexicons:build` a partir de los diccionarios de las Sociedades Bíblicas Unidas; lo que a esos les falta se completa desde `scripts/lexicon-additions/`. El guion solo escribe archivos locales: subirlos a Door43 es un paso aparte.
