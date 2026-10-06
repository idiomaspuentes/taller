# El glosario como recurso de Door43 (propuesta)

Borrador del 1 de octubre de 2026. Cómo mejorar el glosario de decisiones de traducción y cómo
guardarlo en Door43 como un tipo de recurso nuevo. La idea del glosario está en la sección 12 de
[PLANTILLA_FCR.md](PLANTILLA_FCR.md). La primera versión está construida (2 de octubre de 2026): el
repositorio, las entradas, el toque sobre el inglés alineado, la vista del pasaje, el buscador y «cómo se tradujo
antes» en el libro en curso. Faltan el índice de todos los libros, los cambios recientes y el informe de consistencia
como comprobación antes de publicar.

Desde el 6 de octubre de 2026 las decisiones **se leen junto al versículo** que se traduce o se revisa y **se
guardan desde el comentario de una revisión**; el detalle y lo que se midió están en la sección 12 de
[PLANTILLA_FCR.md](PLANTILLA_FCR.md) («Al trabajar»). Dos cosas de esta propuesta cambiaron con el uso: una misma
palabra del original puede tener **una fila por cada palabra inglesa** con que se tradujo («Christ», «Messiah»), no
solo por sentido; y crear el repositorio pide a alguien que administre la organización, así que la primera entrada
la guarda esa persona.

**Comprobado hoy en Door43:** el catálogo reconoce una lista cerrada de 25 temas («Aligned Bible»,
«TSV Translation Notes», «TSV Translation Words Links», «Translation Words»…). Ninguno es un
glosario. Los recursos recientes por referencia (notas, preguntas, enlaces de palabras) son
**archivos TSV** con un `manifest.yaml` de formato `rc0.2`.

---

## 1. Qué mejorar en la idea

1. **Una entrada = una palabra del original + un sentido.** La clave es el **lema** y su número de
   **Strong**, que no cambian. Varios sentidos de la misma palabra son varias filas con la misma
   clave y distinto sentido. Así no hay duplicados por conjugación ni por quién la escribió.
2. **El inglés cuelga del original, no al revés.** Una entrada del inglés (*redeem*) guarda a qué
   lema(s) corresponde cuando se sabe. Si todavía no se sabe, queda como entrada «solo inglés» y se
   une después, cuando Afinación la encuentre.
3. **La decisión dice dónde vale:** TPL, TPS, ayudas, o todo. El TPL y el TPS traducen distinto a
   propósito; sin este dato el glosario parecería contradecirse.
4. **«Cuándo usar cada una»**, en una frase: no solo «redimir / rescatar», sino «rescatar cuando el
   contexto es una liberación física».
5. **Lo que se evita, con su razón.** Ahorra repetir la misma discusión.
6. **Estado:** *propuesta* (la creó alguien) o *acordada* (un equipo la confirmó). Crear es libre;
   cambiar una acordada pide consenso.
7. **Las variantes en español no se escriben: se calculan** desde los textos alineados, y se pueden
   completar a mano.
8. **La evidencia no se guarda en el glosario.** «Cómo se tradujo antes» se calcula desde la
   alineación cada vez. El glosario solo guarda **decisiones**; así nunca queda desactualizado
   respecto al texto.
9. **Un informe de consistencia** como mini-app: dónde el texto se aparta de una decisión acordada.
   Sirve en palabras clave de Afinación y como comprobación antes de publicar.
10. **Sirve a otros.** Un equipo de una lengua minoritaria que traduce desde nuestros recursos puede
    ver por qué elegimos cada palabra. Con licencia abierta, también otros equipos de lenguas puente.

## 2. Cómo guardarlo en Door43

### 2.1 Un repositorio por idioma

| | |
|---|---|
| Repositorio | `es-419_gl/es-419_tg` y `pt-br_gl/pt-br_tg` |
| Identificador | `tg` (*translation glossary*) **(nombre por decidir)** |
| Tema (subject) | `TSV Translation Glossary` **(nuevo)** |
| Formato | `text/tsv` |
| Tipo | `help` (igual que los enlaces de palabras) |
| Licencia | CC BY-SA 4.0, como el resto del paquete |

Va al lado de los demás recursos del idioma, con sus mismos permisos. No va en el repositorio de
tareas (`taller`): es **contenido**, no gestión.

### 2.2 Los archivos

```text
es-419_tg/
  manifest.yaml
  README.md              qué es y cómo se lee
  LICENSE.md
  tg_grc.tsv             entradas del griego
  tg_hbo.tsv             entradas del hebreo y el arameo
  tg_en.tsv              entradas del inglés que todavía no tienen lema
```

Separar por idioma de origen mantiene los archivos pequeños y reduce los choques cuando dos equipos
editan a la vez (Afinación del AT y del NT casi nunca tocan el mismo archivo).

### 2.3 Las columnas

Una fila por **palabra + sentido**. Mismas costumbres que las notas en TSV: un `ID` corto y estable,
tabuladores, una fila por línea.

| Columna | Qué guarda | Ejemplo |
|---------|-----------|---------|
| `ID` | Identificador corto y estable | `r4k2` |
| `Lemma` | Palabra del original (o del inglés en `tg_en.tsv`) | `λυτρόω` |
| `Strong` | Número de Strong | `G30840` |
| `English` | Término(s) inglés(es) relacionados, separados por `;` | `redeem; ransom` |
| `Sense` | El sentido, en pocas palabras | `liberar pagando un precio` |
| `Rendering` | La traducción acordada | `redimir` |
| `Alternatives` | Otras aceptadas y cuándo, `;` | `rescatar: liberación física` |
| `Avoid` | Las que se evitan y por qué, `;` | `liberar: pierde la idea del precio` |
| `Scope` | Dónde vale: `tpl`, `tps`, `helps`, `all` | `tpl` |
| `Variants` | Formas extra escritas a mano, `;` | `redención; redentor` |
| `TWLink` | Artículo de Palabras relacionado | `rc://*/tw/dict/bible/kt/redeem` |
| `Examples` | Referencias, `;` | `TIT 2:14; LUK 24:21` |
| `Status` | `proposed` o `agreed` | `agreed` |
| `Note` | La razón de la decisión | `Conserva la metáfora del rescate` |

Quién lo decidió y cuándo **no va en una columna**: lo guarda el historial de Door43 (ver 2.4).

### 2.4 Las reglas del equipo, con lo que Door43 ya tiene

| Regla nuestra | Cómo se hace en Door43 |
|---------------|------------------------|
| Cualquiera crea una entrada | Una fila nueva con `Status: proposed`, guardada directo |
| Cambiar una acordada pide consenso | Un **pull request** que necesita la aprobación del equipo que lo propone; la discusión queda en el PR |
| Traducción aprende de los cambios | El PR fusionado **es** el aviso: qué cambió, por qué y quién lo acordó |
| Historial | El historial del archivo: cada fila tiene su autor, fecha y motivo |
| Versiones | Una **release** del repositorio cuando se publica un libro, para saber con qué glosario se hizo |

La app esconde todo esto: la persona ve «Guardar decisión» y «Proponer un cambio»; por debajo son un
commit y un pull request.

### 2.5 El catálogo

El tema `TSV Translation Glossary` no existe en Door43. Dos momentos:

1. **Ahora:** el repositorio funciona sin el catálogo. Taller lo lee directamente, como lee los
   demás repositorios. No hace falta pedir nada a nadie para empezar.
2. **Después:** pedir a unfoldingWord que agregue el tema al catálogo, con este documento como
   especificación. Mientras tanto, usar `relation` en el `manifest.yaml` para declarar con qué
   recursos se relaciona (`es-419/glt`, `es-419/gst`, `es-419/tw`, `el-x-koine/ugnt`, `hbo/uhb`).

Conviene **proponerlo como estándar abierto** desde el principio: otros equipos de lenguas puente
tienen la misma necesidad, y un formato compartido vale más que uno propio.

## 3. Lo que queda fuera del recurso (se calcula)

| Dato | De dónde sale |
|------|---------------|
| Cómo se tradujo cada palabra, en todos los libros | Los textos alineados del idioma (`es-419_glt`, `es-419_gst`) |
| Variantes en español | Las mismas alineaciones |
| A qué palabra del original corresponde un término inglés | La alineación del ULT y el UST |
| Dónde el texto se aparta de una decisión | Comparar lo anterior con el glosario |

Para no recorrer todos los libros cada vez, se guarda un **índice generado** (no editable a mano)
que se actualiza cuando se **publica** una unidad del libro. Decidido el 2 de octubre de 2026: va dentro del
mismo repositorio, en `index/<LIBRO>.json` (un solo lugar y los mismos permisos).

## 3b. Crear una entrada con un toque sobre el inglés

Como el inglés (ULT y UST) **siempre está alineado** con el original, quien traduce no necesita saber
griego ni hebreo para registrar bien una entrada:

1. Toca la palabra del inglés que quiere agregar (*redeem* en Tito 2:14).
2. La app lee la alineación de **ese versículo** y encuentra la palabra del original que está debajo
   (λυτρόω).
3. La persona escribe la traducción y, si quiere, el significado y la razón.
4. La entrada queda guardada **por la palabra del original**, con el término inglés y el versículo
   como ejemplo.

Con esto casi todas las entradas nacen ya unidas al original, y el archivo de «solo inglés» queda
para lo que no está alineado (palabras de las notas o de los artículos).

### El problema: palabras pequeñas alineadas junto a la principal

A veces el grupo alineado trae también un artículo, una preposición o una conjunción (en griego,
«el» junto al sustantivo; en hebreo, prefijos como «en», «y», «el» pegados a la palabra). Si se
guardaran todas, la entrada quedaría sucia. Cuatro defensas:

- **Filtrar por clase de palabra.** Los textos originales traen la morfología de cada palabra. Se
  toma solo la **palabra de contenido** (sustantivo, verbo, adjetivo, adverbio) y se dejan fuera
  artículos, preposiciones, conjunciones y partículas.
- **En hebreo, quitar los prefijos.** El texto ya separa el prefijo de la palabra base; se usa el
  lema y el Strong de la **base**.
- **Si queda más de una candidata, se pregunta.** La app muestra las palabras del grupo con su glosa
  en inglés, la de contenido ya marcada, y la persona confirma con un toque. En la mayoría de los
  casos solo queda una y no se pregunta nada.
- **Corregir después.** Si una entrada quedó atada a la palabra equivocada, cualquier persona
  habilitada de Afinación la reasigna; se une con la entrada correcta sin perder el historial.

### Cuando sí son varias palabras

Algunas entradas son **expresiones** a propósito: «Hijo del Hombre», «reino de Dios». Ahí la persona
selecciona varias palabras del inglés y la entrada se guarda con la **secuencia** de lemas. El filtro
de palabras pequeñas no se aplica dentro de una expresión elegida a mano.

### Lo mismo, desde el español

Después de Afinación, el TPL y el TPS también están alineados: el mismo toque funciona sobre una
palabra en **español**.

## 4. Que no se vuelva una lista larga y pesada

El glosario **no se lee como lista**. Nadie debería tener que abrirlo y recorrerlo.

**a) Se muestra en contexto.** Quien trabaja Tito 2:11-15 ve solo las entradas de las palabras que
están en esos cinco versículos: cinco o seis, no cinco mil. Aparecen junto al texto, en el momento
en que hacen falta.

**b) Se busca, no se recorre.** Un buscador por palabra en español, en inglés o del original, y por
versículo. La búsqueda encuentra cualquier forma de la palabra.

**c) Vistas cortas en lugar de «todo»:**
- **De este capítulo / de este libro:** las palabras que aparecen ahí.
- **Cambios recientes:** lo que cambió desde la última vez que la persona miró. Es lo que Traducción
  necesita para aprender, y son pocas líneas por semana.
- **Por acordar:** las propuestas que esperan a un equipo.
- **Esenciales:** las palabras clave marcadas como tales (unas decenas), para quien empieza.

**d) Se mantiene pequeño por diseño.** Solo entra lo que **aporta una decisión**:
- una palabra con más de una traducción posible, o que costó;
- algo que el equipo acordó o cambió.

Lo que siempre se traduce igual y sin duda **no necesita entrada**: ya se ve en «cómo se tradujo
antes», que se calcula solo. Así el glosario crece con las decisiones, no con el vocabulario.

**e) Cada entrada es corta a la vista:** palabra, traducción y dónde vale. La razón, las
alternativas, lo que se evita y los ejemplos se abren al tocarla.

**f) Limpieza.** Dos entradas de la misma palabra y sentido se pueden **unir**; una que dejó de
usarse se **archiva** (no se borra, para conservar el historial).

**En Door43**, el tamaño tampoco es problema: unos miles de filas de texto pesan poco. Si un archivo
crece demasiado para editarlo con comodidad, se parte por la letra inicial del lema sin cambiar el
formato. Quien abra el repositorio a mano verá archivos largos, pero ese no es el uso previsto: el
`README.md` lo dice y remite a la app.

## 5. Riesgos

- **Choques al editar el mismo archivo.** Se reducen con una fila por línea, archivos por idioma de
  origen y cambios pequeños.
- **Entradas duplicadas.** Al crear, la app busca primero por lema, Strong y término inglés.
- **Un tema que el catálogo no conoce.** No bloquea el uso; solo la visibilidad en el catálogo.
- **Strong y lemas en hebreo** tienen casos con dos formas (lo escrito y lo leído). Se usa el lema
  del texto de alineación (UHB), igual que en la herramienta de alineación.

## 6. Por decidir

1. El nombre del identificador (`tg`) y del tema.
2. Si el índice generado va en las releases o en un repositorio aparte.
3. Si proponemos el formato a unfoldingWord antes o después de usarlo con un primer libro.
