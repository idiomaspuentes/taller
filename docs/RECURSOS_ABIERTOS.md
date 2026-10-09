# Recursos abiertos que Taller puede aprovechar

Medido el 9 de octubre de 2026, solo leyendo los repositorios públicos. Es un plan: de lo que sigue, en la app están
el léxico con sus campos de significado (fase 1), los pasajes paralelos (fase 2), «¿a quién se refiere?» (fase 3) y
«quién hace qué a quién» (fase 4) y cómo está armada la oración (fase 6). La fase 5 se omitió.

## Lo que ya usamos

El léxico de la ficha de palabra sale de los diccionarios de las Sociedades Bíblicas Unidas (`ubsicap/ubs-open-license`,
CC BY-SA 4.0): hebreo y griego, con definiciones, glosas y campos de significado.

Los pasajes paralelos salen de la misma colección. En el editor, en la lectura grupal y al revisar desafíos o
términos clave, el versículo dice «Pasaje paralelo: Mateo 12:40» (o «16 pasajes paralelos») y al tocarlo se lee ese
pasaje, uno a la vez: en el texto del equipo si ya tiene ese libro, en el ULT y en el original, con cada palabra
abriendo su ficha y resaltadas las que dicen lo mismo que el versículo de partida. Los datos son 60 archivos
pequeños (370 KB entre todos) que la app sirve ella misma, en `public/parallels/`; se rehacen con
`npm run parallels:build` y los vigila `npm run verify:parallels`.

La lista numera el Antiguo Testamento como la Biblia hebrea (Jonás 2:1 es nuestro 1:17; el Salmo 51:6, nuestro
51:4). Nuestros textos, UHB incluido, usan la numeración de las Biblias en español, así que cada referencia se pasa
con la tabla estándar de Paratext (`Copenhagen-Alliance/versification-specification`, datos CC BY-SA 4.0).

Las palabras que coinciden vienen como un dígito por palabra, contando las palabras del texto de las Sociedades
Bíblicas. Se resaltan solo cuando hay tantos dígitos como palabras mostramos: con una de diferencia se marcaría la
palabra que no es. Medido en 25 libros: cuadra en el 87 % de las referencias del griego, el 90 % de las del griego
que cita al Antiguo Testamento y el 76 % de las del hebreo; donde no cuadra, el pasaje se muestra sin resaltar. No
averigüé por qué el hebreo falla más (casi siempre por una palabra). Las marcas del hebreo que el Nuevo Testamento
cita no se guardan: cuentan las palabras de la Septuaginta.

«¿A quién se refiere?» sale de MACULA (`Clear-Bible/macula-hebrew` y `macula-greek`, de Biblica, CC BY 4.0). En la
ficha de una palabra del original, donde quiera que se abra (al alinear, al revisar desafíos y términos clave, en un
pasaje paralelo), aparece a qué sustantivo apunta un pronombre o un sufijo («me» → Jonás) y de quién habla un verbo
cuando la oración no lo nombra («tragar» → el pez), con su significado y el versículo si está en otro. Tocarlo abre
esa palabra.

«Quién hace qué a quién» sale de las mismas tablas (columna `frame`) y se muestra en el mismo recuadro de la ficha
de un verbo: «Quién lo hace», «A quién o a qué», «También participa» y, en los causativos del hebreo, «Quién hace
que pase» (Yahvé hizo que un viento cayera sobre el mar). Cuando ese lugar lo ocupa un pronombre, se da aquello que
el pronombre nombra («te dejé» → Tito), que es lo que hay que saber para traducir. El sujeto callado y el sufijo que
ya están dichos en el marco no se repiten. Los lugares de MACULA son los de PropBank (A0, A1, A2…): los dos primeros
se dicen con seguridad; del tercero en adelante depende del verbo, y por eso solo se dice que «también participa».

Entre las dos cosas son 152 155 palabras en los 66 libros.

Los datos van con la app, en `public/referents/`, un archivo por libro que se lee la primera vez que se abre una
palabra de ese libro: 8,1 MB entre todos, el mayor (Salmos) de 507 KB antes de comprimir. El plan decía guardarlos
en Door43; quedaron aquí porque no dependen del idioma y así no hay otro repositorio que publicar. Si el peso del
repositorio molesta, es lo primero que se movería. Se rehacen con `npm run referents:build` (baja 90 MB de tablas) y
los vigila `npm run verify:referents`.

Una palabra se encuentra por sus letras y por cuál es entre las iguales de su versículo, porque MACULA usa otras
ediciones (WLC y SBLGNT) que las nuestras (UHB y UGNT). Medido en 25 libros: el 99,2 % de las palabras que señalan
a otra se halla en nuestro texto; del resto no se muestra nada. El hebreo se pasa a nuestra numeración con la misma
tabla que los pasajes paralelos.

«Cómo está armada la oración» sale de los árboles sintácticos de MACULA. Desde la ficha de cualquier palabra del
original, «Ver cómo está armada la oración» abre la oración de ese versículo como un diagrama de cajas, una dentro
de otra: cada oración es una caja de borde grueso, y cada parte suya (Verbo, Sujeto, Objeto, Circunstancia…) una
caja de su color con sus palabras en el orden en que se leen y lo que significan. Son cajas y no ramas porque un
árbol de sesenta palabras no cabe en un teléfono y esto sí: crece hacia abajo, nunca hacia los lados.

Arriba dice qué clase de oración es: simple, compuesta («3 oraciones unidas») o compleja («5 oraciones, 3 de ellas
subordinadas»). Las oraciones unidas van numeradas («Oración 1 de 3») con lo que las une entre ellas; una
subordinada va dibujada, con borde de rayas, dentro de la parte que ocupa («Subordinada · hace de objeto») o de la
parte que describe. La palabra de la que se vino queda marcada, y tocar otra abre su ficha.

**El equipo puede hacer suyo un diagrama.** «Corregir este diagrama» lo abre para cambiarlo tocando: se eligen
palabras o cajas y se meten en una caja nueva (de verbo, de sujeto, una oración…), a una caja se le dice qué es, o
se quita dejando lo que tenía; hay «Deshacer». Un versículo sin diagrama ofrece «Armar el diagrama de este
versículo», que empieza con sus palabras sueltas. Lo que el equipo deja se guarda en el repositorio del plan, en la
carpeta de su espacio (`diagramas/<LIBRO>/<capítulo>.json`), con quién lo dejó así, y todos lo ven en lugar del de
la app; «Volver al diagrama de la app» lo quita. En una pantalla abierta solo para probar (el laboratorio) los
diagramas se leen y no se cambian. Lo vigila `npm run verify:diagrams`.

Lo que todavía no hace: partir una oración en dos o juntar dos, cambiar el orden de las cajas, y mover una palabra
de una caja a otra de un toque (hoy es quitar la caja y volver a armarla).

De los árboles (500 MB) se guarda solo qué partes tienen función y en qué lugar de su versículo está cada palabra:
8,6 MB en `public/trees/`, un archivo por libro. Las palabras se leen de nuestro texto, y por eso una oración se
muestra solo si cada versículo suyo tiene aquí tantas palabras como allá: el 94 % de las oraciones, medido en 25
libros. De las demás se dice que no tenemos el análisis, y el equipo puede armarlo. Se rehacen con `npm run trees:build` (la cabecera del guion
dice cómo bajar los árboles) y los vigila `npm run verify:trees`.

Con esto, lo que la app sirve de estos recursos pesa unos 17 MB (referentes 8,1; árboles 8,6; paralelos 0,4). Cada
libro se baja solo cuando se abre algo suyo.

## Lo que hay y no usamos

### Sociedades Bíblicas Unidas (`ubsicap/ubs-open-license`, CC BY-SA 4.0)

| Recurso | Qué trae | Idiomas | Tamaño |
|---|---|---|---|
| Campos de significado (dominios léxicos) | A qué campo pertenece cada sentido de cada palabra | Hebreo: es, pt, en, fr, zh. Griego: es, en, fr, zh (sin pt) | 85–250 KB por idioma |
| Fauna, flora y realia | Animales, plantas y objetos de la cultura bíblica, explicados | **Solo inglés y chino** | 1 MB, 0,9 MB y 2,7 MB |
| Imágenes | Tres colecciones (una de 85 y otra de 161 imágenes; la tercera no la conté), con las citas de cada imagen | Los metadatos, en inglés | Se bajan aparte, en archivos zip |
| Pasajes paralelos | Qué pasajes dicen lo mismo, con las palabras que coinciden numeradas; incluye citas del AT en el NT | No depende del idioma | Un archivo |
| Rutas bíblicas | Casi 200 recorridos con sus coordenadas y su dibujo | Los nombres, en inglés | 0,4–8 KB cada uno |
| HOTTP | Dudas del texto hebreo del AT, con la lectura preferida y su calificación (A–D) | Inglés y francés | Un archivo |

El diccionario hebreo está también en portugués; el griego no.

### MACULA (`Clear-Bible/macula-hebrew` y `macula-greek`, de Biblica, CC BY 4.0)

Árboles sintácticos de toda la Biblia en hebreo y en griego, palabra por palabra. Además del árbol:

- la **función** de cada parte en la oración (sujeto, verbo, objeto);
- **quién hace qué a quién** en cada verbo;
- **a quién se refiere** un pronombre o un verbo sin sujeto dicho;
- una glosa por palabra, en inglés y chino (no en español ni portugués).

Medido en los dos libros del recorrido de prueba:

| | Jonás (hebreo) | Tito (griego) |
|---|---|---|
| Palabras en nuestro texto (UHB, UGNT) | 688 | 659 |
| Palabras en MACULA | 688 | 659 |
| Coinciden | 685 (99,6 %) | 658 (99,8 %) |
| Con función en la oración | 289 | 184 |
| Verbos con «quién hace qué» | 195 | 97 |
| Con sujeto o referente resuelto | 121 + 114 | 74 + 57 |

Dos cosas que hay que resolver al emparejar:

- **La numeración de versículos del hebreo.** MACULA sigue la hebrea y nuestro texto la de las versiones: Jonás 2:1 en
  MACULA es 1:17 en el nuestro. De 688 palabras, 576 caen en el mismo número; las demás, en el versículo de al lado.
- **Las pocas palabras que no coinciden** (3 en Jonás, 1 en Tito) son diferencias entre ediciones del texto. Esas se
  quedan sin árbol.

### Vistos y descartados por ahora

| Recurso | Por qué no |
|---|---|
| OpenText.org (griego, CC BY-SA 4.0) | Sin cambios desde 2018; MACULA cubre lo mismo y más |
| STEPBible (CC BY 4.0) | Léxico y morfología: repite lo que ya tenemos |
| ETCBC y PROIEL | No confirmé la licencia de los datos; las conocía como no comerciales |

## Plan

De lo que más ayuda a quien traduce sin ser especialista y menos cuesta, a lo más especializado.

| Fase | Qué se añade | Dónde aparece | Qué hace falta |
|---|---|---|---|
| 1 | Campo de significado y «otras palabras del mismo campo» | Ficha de palabra | Nada nuevo: ya viene en el léxico |
| 2 | Pasajes paralelos: cómo quedó el pasaje gemelo | Editor y lectura grupal | Leer un archivo; no hay que traducir |
| 3 | «¿A quién se refiere?» | Ficha de palabra; al afinar | Emparejar MACULA con nuestro texto |
| 4 | Quién hace qué a quién | Al afinar; en Estudio | Lo mismo, y un diseño para pantalla estrecha |
| 5 | Plantas, animales y objetos, con imagen | Ficha de palabra; al traducir | **Traducirlos**: solo están en inglés y chino |
| 6 | El árbol del versículo | Vista nueva en Estudio | Diseño propio: un diagrama no se lee a 375 px |
| 7 | Rutas | Estudio | Un mapa de fondo, que no viene incluido |
| 8 | Dudas del texto hebreo | Afinación | Traducirlas; sirven a quien lee hebreo |

Cambió respecto a la primera propuesta: fauna, flora y realia bajan de la fase 2 a la 5 porque no están en español, y
los pasajes paralelos y los referentes suben porque no dependen del idioma.

Hechas: de la 1 a la 4 y la 6; la 5 se omitió. La 4 y la 6 quedaron en la ficha de palabra, no como vistas
propias en Estudio.

### Cómo llegaría a la app

Como el léxico: se prepara una vez, se guarda en un repositorio de Door43 y la app lee solo lo del versículo abierto.
Así se pensó; al final los pasajes paralelos y los referentes van dentro de la app, porque no dependen del idioma. Los árboles de un capítulo pesan entre 150 y 350 KB en su formato original; habría
que guardarlos reducidos a lo que se muestra.

### Atribución

- UBS: «© United Bible Societies», CC BY-SA 4.0. Lo que se derive debe compartirse con la misma licencia.
- MACULA: «MACULA Hebrew/Greek Linguistic Datasets, available at https://github.com/Clear-Bible/macula-hebrew/»
  (o `macula-greek`), CC BY 4.0.

### Lo que no medí

- La tercera colección de imágenes y los avisos de derechos de las imágenes de fauna y flora (vienen en PDF).
- Los pasajes paralelos sí se midieron después: 2193 pasajes; Judas tiene 9 (todos con 2 Pedro), Nehemías 63,
  Jonás 1, Tito 1, 3 Juan 1, Rut y Ester ninguno. Los libros que más tienen son los evangelios y Crónicas.
- El emparejado de MACULA fuera de Jonás y Tito.
