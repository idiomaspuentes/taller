# Filosofía de diseño de Taller

*14 de octubre de 2026.* Taller toma la filosofía de translationCore 4 (tC4) y la lleva al teléfono. tC4 mete muchas funciones sin quitarle protagonismo al texto, pero es una aplicación de escritorio: columnas a los lados, ratón y teclado. El equipo FCR trabaja con el teléfono y no se maneja bien con la tecnología. Este documento dice qué principios se toman de tC4, cómo se ven en una pantalla de 375 px y cómo comprobarlos antes de dar por hecho un cambio.

De dónde sale cada principio de tC4, con el archivo donde se ve: [`ESTRUCTURA_TC4.md`](ESTRUCTURA_TC4.md), sección 1. Las reglas de densidad (12 controles, dos alturas de pantalla): [`UI_UX_PRINCIPLES.md`](UI_UX_PRINCIPLES.md).

**En una frase:** lo que la persona está traduciendo ocupa la pantalla; todo lo demás está a un toque, aparece cuando hace falta y nunca le dice algo que no es cierto.

## Los principios

### 1. Decide quien trabaja el texto

En tC4, ante dos opciones, gana la que sirve a quien traduce (`docs/VISION.md`). Lo que debilita algo más importante se rechaza o se rediseña.

En Taller el orden es este (Abel, 6 de octubre de 2026):

1. que el proceso funcione de un paso al siguiente;
2. que lo entienda alguien poco hábil con la tecnología;
3. después, lo demás: avisos, contadores, opciones.

Una función nueva que complica una pantalla de trabajo tiene que ganarse el lugar frente a estas dos primeras.

### 2. El texto en el centro

En el teléfono, el texto con que se trabaja y el lugar donde se escribe llenan la pantalla. Lo demás va debajo, plegado o en otra capa.

- Al escribir, la fuente queda pegada a la caja: el versículo abierto muestra su ULT, la caja y «Fíjate en esto» (así funciona ya el editor de texto bíblico).
- En el teléfono no queda nada fijo que no haga falta. Una barra fija quita espacio en cada pantalla y, con el teclado abierto, quedan unos 400 px.
- Lo que en tC4 es una columna lateral (libros, ayudas, la lista de elementos), en el teléfono es una hoja que sube o una pestaña («Recursos»). A 1280 px puede volver a ser una columna.

### 3. Lo demás, cerca y en capas

Cada función secundaria va en la capa más baja donde todavía se encuentra sin buscarla:

| Capa | Para qué | Ejemplo |
|---|---|---|
| En la pantalla, plegado | Lo que se lee una vez por paso | «Antes de empezar»: qué se pide e introducción, en un solo pliegue |
| Dentro de lo abierto | Lo que sirve para ese versículo o esa nota | «Unir con el 3» dentro del versículo abierto |
| Hoja que sube | Una lista o un texto largo | La lista de propuestas con su estado; un artículo de Academia |
| Menú «Más» de la cabecera | Lo que se usa poco en esa herramienta | Glosario, Estudio, «Rehacer mi borrador» |
| Menú de la cuenta | Lo que no es de una herramienta | Idioma, cómo empezar, informar un problema |

En los menús, cada fila tiene dos líneas: la acción y una frase que dice qué hace, como en el menú de cuenta de tC4. Los datos técnicos (número de tarea, archivo, fase) van al final, en gris.

### 4. Lo que tocas decide lo que ves

En tC4, al abrir un versículo, el panel de ayudas muestra solo las de ese versículo. En Taller es la regla de siempre: **las ayudas se leen pegadas a su texto**, de una en una, nunca como una lista larga. Sin nada abierto, se muestra lo del primer versículo que falta, no todo el capítulo.

### 5. Se ofrece, no se impone

tC4 anima a prepararse, pero no obliga. Taller sí tiene pasos: los del proceso, que define el paquete del proceso (`processes/`). Dentro de un paso, la pantalla no agrega obligaciones propias. La ayuda está a la vista o a un toque, pero no hay que abrirla para seguir.

### 6. Avisos solo cuando algo falla

Lo normal no se anuncia. Un aviso aparece cuando hay algo que hacer o algo salió mal, y dice qué hacer. Un botón que solo sirve en un caso (conflictos, rehacer) aparece solo en ese caso.

### 7. Una cosa obvia que hacer

- Un solo botón lleno por pantalla; lo demás, con borde o como enlace.
- Al terminar algo, el botón lleno pasa a ser el que lleva al siguiente paso, en lugar de volver a una lista.
- Dos cosas que significan algo distinto no se parecen: un aviso no tiene el aspecto de una regla del texto, y «Terminé» no se parece a «Seguir».

### 8. Honestidad

- «Guardado» se dice solo cuando quedó guardado en Door43. Antes de eso: «Sin guardar» o «Guardando».
- No se sabe no es lo mismo que no hay: un recurso que no se pudo leer no se muestra como un recurso que falta.
- Un número que baja dice por qué.

### 9. El trabajo no se pierde

- Lo escrito y no guardado se conserva en el aparato hasta guardarlo.
- Nada reescribe en silencio el texto de una persona.
- La app propone y la persona confirma: una sugerencia (de alineación, de un ejemplo, de una corrección) no se guarda sin que alguien la acepte.

### 10. Una forma para cosas parecidas

- Todas las herramientas comparten la misma cabecera (`ToolHeader`), con «‹», el título en una línea, el estado de guardado, un botón principal y «Más».
- Recorrer elementos se ve igual en todas: una línea «Tito 1:2 · 2 de 4 ‹ ›», y tocar el número abre la lista.
- Lo que se aprende en una herramienta sirve en la siguiente.

### 11. Pensado para el dedo

Esto es lo que tC4 no hace y Taller sí:

- **Toques de 44 px** como mínimo. Las palabras que se arrastran al alinear se prueban aparte, en un teléfono.
- **Ningún icono sin palabra.** En el teléfono no hay texto al pasar el ratón: un icono suelto no dice que ahí hay algo.
- **Tocar, no pasar el ratón.** Lo que en tC4 se marca al pasar por encima, aquí se marca al tocar.
- **Tocar antes que escribir.** Si el texto ya existe, se ofrece en trozos para tocar; el teclado es el último recurso.
- **Nada escondido sin que se note.** Una pestaña dice cuánto hay dentro («Notas 3»). Cuando algo cambia de lugar, una línea lo dice una sola vez.
- **Portugués a 375 px.** Las palabras son más largas; cada pantalla se mide también en `pt`.

### 12. Jerarquía y aire

Abel lo ha pedido varias veces (la última, el 16 de octubre, en «Acuerdo del equipo»): una pantalla se lee por
grupos, y cada grupo necesita espacio para respirar.

- **Más aire entre grupos que dentro de ellos.** Las partes de un grupo van a 8–12 px; un grupo y el siguiente, a
  24–32 px. Si las dos distancias son iguales, la pantalla se lee como una lista de cosas sueltas.
- **Cada grupo, un título.** Una etiqueta va pegada a lo que nombra; ninguna queda suelta entre dos grupos (un chip
  «Notas» entre el versículo y la nota no dice de cuál de los dos habla).
- **La jerarquía, por tamaño y peso; no por grises claros.** El texto que se lee tiene contraste de 7:1 o más; lo
  secundario es más pequeño, no más pálido.
- **Una sola capa de caja.** No hay cajas dentro de cajas. Cosas parecidas tienen la misma caja; cosas distintas
  (lo que dice hoy, lo que se propone) se ven distintas.
- **Se mide, no se mira:** con un guion en la página se toma la distancia entre cada grupo y el siguiente.

## La guía paso a paso

*9 de noviembre de 2026.* Los primeros días de Nehemías el equipo se perdió en la app: una traductora tocó «Terminé»
creyendo que guardaba. Desde entonces cada pantalla de trabajo trae una guía corta que señala dónde tocar, paso a
paso. Sale sola la primera vez, se puede saltar, y «Guía» (siempre en la cabecera, con su palabra) la repite. En el
menú de la cuenta, «Ver la guía» lleva a la de «Mis tareas».

- **Hay guía en** «Mis tareas», el editor del texto y la revisión en pares. En cualquier herramienta, el primer paso
  es para qué sirve el paso del proceso: viene del paquete (`purpose`), no de `src/`. Sustituye a la tarjeta «En
  esta tarea» con «Entendido» y a la de «Para empezar con buen pie».
- **Cada paso señala algo que se toca** y lo dice en una frase de doce palabras o menos, de «usted».
- **Cada paso se recuerda por separado**, por persona y servidor: abrir el editor para el TPS después del TPL solo
  muestra para qué sirve el paso nuevo. Un paso cuyo objeto no está en pantalla (no hay «Terminé» en una prueba) no
  sale ni se da por visto.
- **Para agregar un paso:** un `data-guide="…"` en el elemento, el paso en `src/components/screenGuides.tsx` y su
  frase en `es.json` y `pt.json` (`guide.*`). La lógica está en `src/domain/guide.ts`; su prueba, `npm run verify:guide`.

### En las pantallas de trabajo, la guía acompaña mientras se hace

*9 de noviembre de 2026, con Abel.* Una guía que lo dice todo primero se olvida antes de empezar. En afinación
(frases con nota, palabras clave), alinear y revisar la alineación, la guía es una **caminata** por el primer punto o
versículo: cada paso muestra una sola cosa, la dice y **espera a que la persona la haga**. Desde el segundo punto la
pantalla está completa y la guía calla. Está en `src/components/tuningGuides.tsx`; el diseño anotado, en la página
«Guía de afinación paso a paso».

- **Tres clases de paso.** *Mire*: algo que leer; sigue con su botón («Entendido», «Ya la leí»). *Toque*: lo
  iluminado se toca de verdad, solo eso; al tocarlo la guía sigue sola. *Haga*: un trabajo de varios toques (marcar
  palabras, colocarlas en sus cajas); la pantalla queda libre y la guía se achica a una línea que no tapa el trabajo.
- **Se ve lo mínimo.** Lo que todavía no tiene su turno no está en pantalla (`hide`); lo ya visto queda atenuado
  detrás del velo.
- **Una rama es el mismo paso con otra forma.** Si la persona toca «No, es otra cosa», el paso de la pregunta pasa a
  «Escriba qué ve aquí…»; si cancela, vuelve a la pregunta.
- **Lo que la persona hace se le avisa a la guía** con `guideDid("af:answered")`: responder lleva a la app al punto
  siguiente de una vez, y la guía no debe volver a empezar en él.
- **Los casos que el primer punto no tiene** (otra persona ya respondió, un punto cerrado, cerrar la revisión) traen
  su aviso corto la primera vez que aparecen.
- **Si lo que un paso señala no llega** (el versículo siguiente aún no es de la persona), la guía sigue a los 30
  segundos: nunca se queda esperando para siempre.

### «De qué trata esta tarea»

La primera vez que se toca el botón de una tarjeta para un paso con herramienta de Taller, antes de abrirla sale una
ventana grande: de qué se trata (`purpose`), los pasos de la tarea con dónde está la persona, cómo se hace (`howTo`,
una línea por cosa que hacer) y lo que debe cumplir (`criterion`). Todo sale del paquete del proceso. «Empezar con la
guía» abre la herramienta con su caminata; «Empezar sin guía» la abre sin ella (la caminata espera a «Guía»). Quien ya
vio para qué sirve el paso no la ve.

### Afinación: primero se dice qué se hace, y si algo se guarda

*11 de noviembre de 2026, con Abel.* El equipo de afinación es de personas mayores que desconfían de tocar algo por
miedo a dañar el trabajo. En frases con nota y palabras clave (`AfinacionView`, ventanas en `StageWindow.tsx`):

- **Al entrar a la tarea, siempre**, una ventana: el nombre de la tarea, para qué es (`purpose`), sus tres pasos
  (`howTo`) y «Nada cambia el texto hasta que usted decide en el paso 3. Lo que decida se puede cambiar después».
  Un solo botón, «Empezar». Por eso la tarjeta no abre «De qué trata esta tarea» para estas herramientas.
- **Al empezar cada fase del primer punto de la visita** (Estudiar, Marcar, Decidir), otra ventana: el título de la
  fase, qué se hace y si algo se guarda («Aquí no se cambia nada», «Nada se guarda todavía», «Su respuesta se
  guarda, y la puede cambiar después»). «Continuar» o «Muéstreme cómo». Solo en el primer punto: en cada uno serían
  más de doscientos toques, y se cerrarían sin leer.
- **Desde el segundo punto**, una línea bajo los pasos dice lo mismo, corto, y «¿Qué hago aquí?» abre la ventana otra
  vez.
- **La guía va por fase** (`flow:afinar-<notas|palabras>-<1|2|3>`) y **nunca sale sola** (`manual`): la abre
  «Muéstreme cómo», solo la de esa fase, o «Guía».
- **Una sola salida obvia.** En Estudiar de una palabra clave, «Ya lo estudié»; «Hay un error» queda como enlace
  discreto debajo. Una frase con nota conserva su pregunta y sus dos respuestas, porque ahí se responde algo.
- **Lo que cambia el texto pregunta antes.** «Corregir», junto a las palabras que se marcan, abre «¿Corregir el
  versículo?» con «No, volver» como lo destacado.

## Cómo comprobarlo

Antes de dar por hecho un cambio visible, se recorre a 375 px como lo haría alguien poco hábil con la tecnología, y se anotan los números en el informe:

- [ ] ¿Qué es lo principal, y se ve sin bajar?
- [ ] ¿Cuántos controles hay a la vista sin tocar nada? (12 o menos)
- [ ] ¿Cuántos miden menos de 44 px?
- [ ] ¿Hay un solo botón lleno?
- [ ] ¿Cuántas alturas de pantalla mide? (dos o menos)
- [ ] ¿Algo queda fijo sin necesidad, o tapa la caja con el teclado abierto?
- [ ] ¿Hay algún icono sin palabra?
- [ ] ¿Las ayudas que se ven son las del versículo en que se trabaja?
- [ ] Al terminar, ¿a dónde lleva la app?
- [ ] ¿Cada grupo tiene más aire alrededor (24–32 px) que entre sus partes (8–12 px)? Medido.
- [ ] ¿Hay alguna etiqueta suelta entre dos grupos, o una caja dentro de otra?
- [ ] ¿Se ve igual de bien en portugués y a 1280 px?
- [ ] Si la pantalla trae algo nuevo que aprender, ¿lo dice su guía? Si es una pantalla de trabajo, ¿la guía espera a que la persona lo haga?
