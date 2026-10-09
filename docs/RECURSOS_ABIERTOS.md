# Recursos abiertos que Taller puede aprovechar

Medido el 9 de octubre de 2026, solo leyendo los repositorios públicos. Es un plan: de lo que sigue, en la app están
el léxico con sus campos de significado (fase 1) y los pasajes paralelos (fase 2).

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

Hechas: la 1 y la 2.

### Cómo llegaría a la app

Como el léxico: se prepara una vez, se guarda en un repositorio de Door43 y la app lee solo lo del versículo abierto.
Nada de esto va dentro de la app, salvo los pasajes paralelos, que son pequeños y no dependen del idioma. Los árboles de un capítulo pesan entre 150 y 350 KB en su formato original; habría
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
