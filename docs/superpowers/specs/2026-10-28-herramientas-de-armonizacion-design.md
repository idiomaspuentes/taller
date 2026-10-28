# Herramientas para armonizar notas y palabras, sin abrumar

Fecha: 28 de octubre de 2026. Sale de la revisión de la hoja «Ester- Armonizacion Palabras» (capítulos 1, 3 y 5), en
la que Abel pidió anotar qué recursos sirvieron para encontrar lo que el equipo no vio, y cómo dárselos al equipo de
armonización dentro de Taller. Los recursos están listados, con un ejemplo de cada uno, en
[idiomaspuentes/taller#33](https://github.com/idiomaspuentes/taller/issues/33). Este documento dice cómo se llevan a
la armonización de **notas** y de **palabras**, con sus diferencias.

## Para qué

En la revisión, la mayoría de los problemas no eran de criterio, sino de lo que la persona no tenía a mano:

- **No veía la palabra que lee quien abre el artículo.** El TPL de Ester dice «Susa, la ciudadela», «sus oficiales»,
  «la casa de la realeza», «cada mayordomo», y los artículos enlazados se titulan «castillo, fortaleza», «noble»,
  «palacio», «supervisar». Nadie lo notó porque la hoja mostraba el artículo, no el versículo.
- **No tenía el inglés ni su historia.** Una línea decía «reino» donde el inglés dice «reign» desde 2017. Siete
  artículos se revisaron sin saber que unfoldingWord los había borrado.
- **No podía buscar otros artículos.** Se agregó «gobernar» al título de «reinar» sin saber que ya existe
  «Gobernar, reinar, gobernador…».
- **Errores mecánicos que una máquina ve**: enlaces a libros que no existen (`1cr` por 2 Crónicas, `2re`, `1sam`,
  `luc`, `nah`), dobles espacios, comas sueltas, «tú» en vez de «usted», «él» para Dios.
- **No veía el artículo entero.** La propuesta trae solo los párrafos que cambian; lo que se pierde (como «ser
  exaltado» en «gloria») no se ve.

Lo que se quiere: que quien armoniza tenga eso **cuando lo necesita y sin buscarlo**, y que la pantalla no crezca.
Se mide así: alguien poco hábil con la tecnología, a 375 px, abre una nota o un artículo sin ningún problema y no ve
nada nuevo; abre uno con un enlace roto y ve un solo aviso, con un botón que lo arregla.

## Tres capas, cada una solo cuando hace falta

1. **Taller lo revisó solo**: avisos sobre el texto que alguien propone. Si no hay nada, no se ve nada.
2. **Para mirar**: cada pregunta del paso trae la fuente que la responde, en la capa de fuentes que ya existe.
3. **Para decidir**: lo que no le toca a cada persona (listas desactualizadas, artículos borrados, choques entre
   capítulos) va a quien coordina, no a la pantalla de cada uno.

Ninguna capa agrega pasos ni preguntas obligatorias, y ninguna bloquea publicar.

## Capa 1: «Taller encontró…»

### Cuándo y dónde

- **Al escribir una propuesta o un ajuste**, antes de «Proponer»: bajo el editor, una línea «Taller encontró 2 cosas»
  que se abre con un toque.
- **Al revisar la propuesta de otra persona**: la misma línea bajo la propuesta, para que se pueda sugerir un ajuste.
- Nunca más de tres avisos a la vista; los demás, en «Ver N más».

### Dos clases de aviso

- **Mecánicos, con «Arreglar»**: un toque los corrige en el texto propuesto, y queda como parte de la propuesta.
  - Enlace `rc://` a un libro que no existe, cuando el nombre del enlace dice cuál es («[2 Crónicas 3:14]» con `1cr`
    → `2ch/03/14`). Si no se puede deducir, el aviso dice solo «este enlace no lleva a ningún versículo».
  - Dobles espacios, espacio antes de una coma o de un punto, línea de lista que termina en coma.
  - Un encabezado sin `##` («Definición» suelto) y una viñeta sin espacio («*Los…»).
- **De las reglas del equipo, con su porqué**: no se arreglan solos; quien escribe decide.
  - A quien traduce se le habla de «usted» («en tu idioma, usa…»).
  - Mayúscula para Dios en las ayudas («Él», «Rey» como título), minúscula para un rey humano.
  - En un artículo de Palabras, negrita solo en los ejemplos de las historias; la palabra de la que se habla va
    entre comillas.
  - En una nota, la negrita es solo para las palabras del TPL, y la traducción alternativa va entre comillas.

Los tipos de comillas no se avisan nunca: se ajustan solos al publicar.

### Dónde viven las reglas

- Los avisos mecánicos son código general (`src/domain/helpChecks.ts`, función pura `helpChecks(text, kind)`), porque
  valen para cualquier idioma: la lista de libros y la forma de un enlace son las de Door43.
- Los de reglas dependen del idioma y del equipo: van en el paquete del proceso (`processes/fcr.json`), como hoy las
  preguntas, en una lista `writingChecks` con un patrón, el recurso al que aplica, el mensaje y el porqué. Cuando el
  equipo agrega una regla a su documento («Reglas para los artículos de Palabras»), se agrega aquí también, sin
  tocar `src/`. `verify:decoupling` sigue vigilando que el código no conozca ninguna.

## Capa 2: la fuente que responde cada pregunta

Las fuentes se abren en la capa que ya existe junto al texto del paso (en el teléfono, a un deslizamiento: nunca el
editor y la fuente a la vez), y se abren **en el lugar que importa**: el versículo de la nota, la palabra marcada.

| Pregunta | Lo que trae |
|---|---|
| Notas, TPL: «¿La nota explica las palabras marcadas en el TPL?» | El original de esas palabras: forma, lema, número Strong (como en `OriginalWords`) |
| Notas, todos los pasos | La nota en inglés de la misma fila |
| Notas, Academia: «¿El artículo trata de esta dificultad?» | El artículo, ya en pantalla, y su versión en inglés |
| Palabras, TPL: «¿La definición es la que la palabra tiene en este versículo?» | El TPL con la palabra marcada y el original (lema, Strong) |
| Palabras, TPS: «¿El artículo sugiere la forma en que lo dice el TPS?» | El TPS del versículo con la parte alineada marcada |
| Palabras, todos los pasos | El artículo en inglés, con un sello si unfoldingWord lo borró («ya no existe en inglés desde 2023») |

## Palabras: lo que cambia más

Una nota vive en un versículo; un artículo de Palabras sirve a todo el libro, y a otros libros. Pero que un artículo
se reutilice no quiere decir que cada palabra esté bien enlazada a él: la lista de palabras puede conectar una
palabra hebrea con un artículo que no le corresponde (marcar una palabra y enlazarla con «salvación», por ejemplo).
Por eso en Palabras hay **dos revisiones distintas**, y Palabras necesita estas cosas que las notas no:

1. **El enlace se revisa por cada palabra; el artículo, una vez.**
   - **El enlace** (cada fila de la lista de palabras): ¿esta palabra del original, en este versículo, corresponde a
     este artículo? ¿El artículo habla de ella o la incluye? Es la pregunta que ya existe («¿La definición del
     artículo es la que la palabra tiene en este versículo?») y no desaparece al agrupar: se responde por fila, pero
     rápido, con lo justo a la vista (la palabra del TPL marcada, el lema y el Strong, el título y la primera línea
     del artículo).
   - **El artículo** (su contenido: definición, sugerencias, propuestas): se revisa una vez por libro, en el primer
     capítulo donde aparece (ver «Decisiones»). Hoy cada fila de la
     lista es un elemento de la lista del capítulo (`parseTermRows`), aunque la conversación y las propuestas ya
     son por artículo (`termMessageKey`, `path`). En la hoja, «rey» ocupó 27 filas y su comentario se repitió 27
     veces. En Taller la lista del capítulo muestra cada artículo una vez, con «se usa en 27 lugares»; al abrirlo,
     arriba van los enlaces por confirmar (uno por lugar, con «Este enlace no corresponde» como salida) y abajo el
     artículo.
   - **Ayuda automática para el enlace** (capa 1): los artículos traen sus números Strong en «Datos de esta palabra»
     (todos los de inglés que usa Ester; solo 31 de los 59 en español, así que se toma el inglés cuando el español
     no los trae). El Strong de la palabra enlazada sale del texto original (el atributo `strong` de cada palabra del
     hebreo o del griego, que la fila de la lista señala por `OrigWords` y `Occurrence`). Si no está entre los del
     artículo, Taller avisa: «Esta palabra (H3444) no está entre las
     del artículo; revise si el enlace es el correcto». No decide: hay artículos que cubren una idea con palabras que
     su lista no nombra.
   - Un enlace que no corresponde no se arregla en el artículo: es un cambio en la lista de palabras, que va a quien
     coordina (capa 3), con la palabra, el versículo y el artículo que le correspondería.
2. **«Dónde se usa»**: los versículos del libro enlazados al artículo, cada uno con la palabra del TPL marcada (por la
   lista de palabras y la alineación del TPL). Con eso se ve que falta «ciudadela» u «oficiales» en el título. Si
   ninguna de esas palabras está en el título, Taller lo dice como aviso de la capa 1: «En el TPL esta palabra se lee
   “la ciudadela”, que no está en el título».
3. **El artículo entero, con lo que cambia marcado.** La propuesta se muestra dentro del artículo completo: lo nuevo
   resaltado y lo que sale tachado, con «Mostrar lo que sale» para ocultarlo. Así se ve un párrafo que se pierde.

Y una que puede servir también a las notas, pero que en Palabras es la principal:

4. **Buscar otros artículos** por título o por palabra, en español y en inglés, desde «Ver también» o desde el
   editor de la propuesta. Un resultado se puede citar en la conversación («esto ya está en “Gobernar…”»).

## Notas: lo que se agrega es poco

La pantalla de notas ya trae el TPL y el TPS del versículo con la cita marcada. Se agregan solo la nota en inglés,
el original de las palabras citadas y los avisos de la capa 1. El orden de lectura, nota por nota, no cambia.

El enlace de una nota con su artículo de Academia tiene la misma revisión que el de una palabra con su artículo, y ya
existe como pregunta («¿El artículo que enlaza la nota trata de esta dificultad?»). Para responderla rápido, la
fuente de esa pregunta muestra el título y la primera línea del artículo antes que el artículo entero. Un enlace que
no corresponde se propone cambiar en la nota (la columna del artículo es parte de la nota), no en el artículo.

## Capa 3: para quien coordina

Lo que no puede resolver una persona en una nota va a una vista de quien coordina el proyecto (o, mientras no
exista, a la hoja «Pendientes del TPL y el TPS»):

- La lista de palabras que usa el equipo frente a la de unfoldingWord (hoy Taller lee la del paquete fuente,
  `en_twl`; la hoja del equipo numeraba con `es-419_twl`, de 2021).
- Artículos que unfoldingWord borró y que el equipo sigue teniendo.
- Enlaces de la lista de palabras que alguien marcó como «no corresponde», con el artículo que sugiere.
- El mismo artículo con propuestas distintas en dos capítulos (en Ester: «reina», «reino», «bueno», «oro»,
  «administración»).
- Correcciones al TPL o al TPS que salen al armonizar (como «Susa, el palacio» en Ester 2:3).

## En qué orden

1. **Capa 1**: los avisos mecánicos y los de reglas, para notas y palabras. Es lo más barato y lo que más ahorra.
2. **Palabras**: el artículo una vez y el enlace por cada palabra (con el aviso de Strong), «Dónde se usa», el
   artículo entero con lo que cambia, y el inglés con su sello.
3. **Búsqueda de artículos** y la **vista de quien coordina**.

Cada etapa se puede publicar sola.

## Fuera de esto

- Detectar frases que solo sirven en español («pilar» de trillar, «tomar» de beber): no hay un patrón fiable; queda
  en la revisión humana y en el documento de reglas.
- Consultar la RAE, Fundéu o versiones en español desde Taller: se enlazan desde el documento de reglas, no se
  construyen.
- Corregir el sentido de una propuesta: los avisos nunca cambian lo que dice el texto, solo su forma.
- Actualizar la lista de palabras: es una decisión de Abel (Taller usa esa lista); este diseño solo la hace visible.

## Pruebas

- `verify:help-checks` (nuevo): cada aviso mecánico con un caso que lo dispara y uno parecido que no (un enlace bien
  formado, un doble espacio dentro de un bloque de código, «él» referido a un hombre), y que «Arreglar» deja el
  texto igual salvo lo arreglado.
- `verify:templates`: que `writingChecks` del paquete sea válido.
- `verify:decoupling`: que `src/` no tenga ninguna regla del FCR.
- Para Palabras: que la lista del capítulo agrupe por artículo sin perder la revisión de cada enlace; que «Dónde se
  usa» marque la palabra del TPL en un libro sembrado en el mock (`MOCK_SEED_BOOK=EST`); y que el aviso de Strong
  salte con una palabra cuyo número no está en el artículo y no salte con una que sí está.
- En el navegador, a 375 px y en escritorio: una nota sin problemas no muestra nada nuevo; una con un enlace roto
  muestra un aviso y «Arreglar» lo corrige.

## Decisiones (28 de octubre)

- **Los avisos se muestran también a quien solo revisa**, bajo la propuesta de otra persona, para que pueda sugerir
  un ajuste. «Arreglar» en ese caso no cambia la propuesta ajena: abre un ajuste con lo arreglado.
- **El artículo se armoniza una vez por libro**, no por capítulo (Abel dejó la decisión a la recomendación):
  - Lo revisa el equipo del primer capítulo donde aparece, dentro de su subtarea de siempre.
  - En los capítulos siguientes, el artículo aparece como «Armonizado en el capítulo 1», con su estado y su propuesta
    si la hay. Ese equipo solo confirma los enlaces de su capítulo, y puede sumarse a la misma conversación o
    sugerir un ajuste a la misma propuesta, pero no abre otra.
  - Por qué: un artículo vale para todo el libro, y armonizarlo en cada capítulo produce dos versiones distintas del
    mismo texto. En Ester pasó con «reina», «reino», «bueno», «oro» y «administración» (capítulos 1 y 5). Las
    propuestas ya son por artículo (`path`), así que una sola propuesta por libro sale de lo que hay.
