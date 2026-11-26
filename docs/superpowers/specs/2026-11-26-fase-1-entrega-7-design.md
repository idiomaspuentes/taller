# Fase 1, entrega 7: Taller avisa mientras se escribe (E1)

*Escrito el 26 de noviembre de 2026, con las decisiones que Abel tomó ese día.*

Lo marcado «(decidido)» lo decidió Abel; lo marcado «(mi decisión)» lo decidí al escribir, y Abel lo revisa al aprobar.

Parte del diseño de la Fase 1 ([`2026-11-23-fase-1-traduccion-design.md`](2026-11-23-fase-1-traduccion-design.md), propuesta E1) y de su plan ([`2026-11-24-fase-1-traduccion.md`](../plans/2026-11-24-fase-1-traduccion.md), «Entrega 7»). Los nombres técnicos entre paréntesis son para quien lo construya.

## 1. Para qué

Hoy el editor del texto (TPL y TPS) no señala nada de lo que Taller sabe encontrar solo. El editor de ayudas solo avisa del «tú». Los espacios mal puestos, los enlaces rotos y las reglas del equipo aparecen recién en Afinación o en Armonización, cuando otra persona ya está leyendo. Esta entrega lleva esos avisos a donde se escribe, para que cada persona los arregle en su borrador.

**Éxito:** quien escribe ve, en letra pequeña bajo la caja, «Taller encontró 2 cosas». Con un toque en «Arreglar» quedan arreglados los que son seguros. Los demás se leen con un toque, con su «Por qué».

**Fracaso aunque funcione:** que los avisos salten con cada letra y muevan la caja bajo el dedo. Que compitan con la caja o con «Fíjese en esto». Que aparezcan dos botones para arreglar lo mismo. Que «Arreglar» cambie algo que no es seguro. Que se cambie cómo se guarda algo.

## 2. Alcance

- **El editor del texto** (`ScriptureEditorView.tsx`): el versículo abierto, en TPL y TPS, en la caja de una línea y en las líneas de un poema.
- **El editor de ayudas** (`HelpsEditorView.tsx`): la pieza abierta (`ArticleBlocks`) y las ayudas que se escriben enteras en una caja (las notas, las preguntas y su respuesta, y los artículos sin piezas). Vale en los cuatro recursos: Notas, Preguntas, Palabras y Academia.

Fuera del alcance:

- Afinación, Armonización y la hoja de propuestas (`ProposalSheet`). Siguen como hoy: allí `HelpChecksHint` y `FormalAddressHint` no cambian de aspecto ni de comportamiento.
- La revisión en pares (`PortionReviewView`).
- Ningún dato guardado. «Arreglar» cambia el borrador igual que si la persona lo escribiera, y el editor lo guarda como siempre.

## 3. Lo que ve la persona

### 3.1 Una sola línea, bajo la caja (decidido)

En el teléfono, a 375 px, con el versículo abierto:

```
┌ caja del versículo ───────────────┐
│ Y el rey  dijo a Amán ,…          │
└───────────────────────────────────┘
Taller encontró 2 cosas   [Arreglar]      ← letra pequeña; solo si hay algo
Fíjese en esto  3  «You»: ¿una o…  ›   ‹ ›
```

- Si Taller no encuentra nada, no se muestra nada.
- En el editor del texto, la línea va justo encima de «Fíjese en esto», dentro de lo que se abre con el versículo. (mi decisión)
- En el editor de ayudas, va bajo la caja de la pieza, donde hoy sale el aviso del «tú». «Fíjese en esto» queda donde está, bajo la fuente: habla de la fuente, y los avisos hablan de lo escrito. (mi decisión)
- Un toque en «Taller encontró 2 cosas» abre la lista, como en Afinación: tres a la vez, con «Ver N más» y «Por qué» en las reglas del equipo.
- **Letra pequeña, sin competir con la caja.** La línea usa el mismo tamaño y el mismo peso que «Fíjese en esto» en ese editor (se mide; hoy son 0.8125rem). El color es el texto normal, no un gris claro, y solo el número lleva el color de aviso. Con «1 cosa», que no lleva número, la frase entera va en ese color. El botón y la línea siguen midiendo 44 px de alto para el dedo. Aquí se usa una forma discreta del componente; en Afinación se sigue viendo como hoy. (mi decisión)
- **Aire.** La línea es parte del versículo o la pieza abierta: va a 8 px de la caja, igual que «Fíjese en esto». No es una etiqueta suelta entre grupos.
- **Sin paso nuevo en la guía.** La línea dice sola qué es y no aparece si no hay nada. (mi decisión)
- **Respecto de E1, que decía «junto a «Fíjese en esto»»:** en el editor del texto la línea va justo encima de «Fíjese en esto». En el de ayudas no va junto a ella, por la razón de abajo.
- **Tamaño de letra:** la forma discreta tiene su propia regla `html[data-text] … calc(… * var(--ts))`, como las demás.

### 3.2 El «tú» cuenta en la misma línea (decidido)

En el editor de ayudas, cada palabra que trata al traductor de «tú» (`informalWords`, con la regla del espacio de trabajo `helpsAddressOf`) es un aviso más de la línea. En la lista se lee: «Aquí se le habla al traductor de «tú»: «puedes» → «puede».» (clave `hc.informal`). `FormalAddressHint` deja de mostrarse en el editor de ayudas; la hoja de propuestas lo sigue usando.

**Cada caja, su línea.** Cuando una ayuda tiene más de una caja (una pregunta y su respuesta), cada caja tiene su propia línea bajo ella, como hoy pasa con el aviso del «tú». Un «Arreglar» arregla solo su caja. (mi decisión)

### 3.3 Qué arregla «Arreglar» (decidido)

Un solo botón arregla todo lo que es seguro, de una vez:

- **Lo que ya arregla Afinación:** los espacios antes de un signo o después de uno de apertura, el espacio que falta después de un signo, el espacio doble, el enlace a un libro que no existe cuando su nombre dice cuál es, la línea de lista que termina en coma y el espacio que falta después del asterisco.
- **El «tú» → «usted».** Ya se cambiaba con un toque, y sigue así.

**Nunca se arreglan solos:** las reglas del equipo (la mayúscula para Dios, «el rey Asuero», la negrita en la definición…) y la palabra repetida, porque el TPL repite a propósito lo que repite el original. Se muestran y dicen por qué.

«Arreglar» solo toca el versículo o la pieza abierta.

**Después de «Arreglar»:**

- La línea se actualiza al instante, sin esperar la pausa.
- El cursor se queda donde estaba, corrido lo que hayan corrido los arreglos de antes. En las líneas de un poema queda donde lo deje el navegador, y la prueba lo anota.
- Mientras la persona no vuelva a escribir, en lugar del botón sale «Deshacer», que devuelve el texto como estaba. Así siempre se puede volver, como pide la filosofía de diseño. (mi decisión)

### 3.4 Cuándo aparecen (decidido)

**Tras una pausa.** La línea se calcula cuando la persona deja de escribir un momento (alrededor de un segundo). Mientras escribe, la línea no cambia: ni aparece ni desaparece. Al abrir otro versículo u otra pieza, su línea sale enseguida, sin esperar.

Lo que esto exige al construir: «Arreglar» se calcula sobre el texto **de ese momento**, no sobre el de la última pausa. Si no, aplicaría un arreglo en un lugar que ya cambió.

## 4. Qué busca cada editor

| Editor | Busca | Notas |
|---|---|---|
| Texto (TPL, TPS) | `verseChecks` **y además el espacio doble** | Afinación deja pasar el espacio doble porque reescribe el versículo con espacios simples. En el editor se escribe a mano, y arreglarlo no cambia nada de lo que dice: se avisa (opción de `verseChecks`, apagada en Afinación). (mi decisión) |
| Ayudas | `mechanicalChecks`, `ruleChecks` y el «tú» | En los cuatro recursos. Las reglas del paquete se aplican solo a los recursos que nombran (hoy, Notas y Palabras); Preguntas y Academia reciben las de formato y el «tú». |

**Una regla con `until` en una pieza.** «Sin negrita en la definición» se aplica hasta «## Ejemplos». Si se juzga una pieza sola, la regla no ve el encabezado y señalaría la negrita de los ejemplos, que es correcta. Por eso la regla se juzga con lo que la ayuda tiene antes de esa pieza: si ya pasó «## Ejemplos», no se aplica. Una pieza que todavía no está traducida cuenta con su fuente. Como la fuente de Palabras puede estar en inglés, el `until` de esa regla en `fcr.json` suma «Examples». No es una regla nueva: es la misma regla, con el encabezado en un idioma más. Afinación y Armonización también usan esa regla, y el cambio les quita el mismo aviso falso. Es el único cambio que les llega. (mi decisión)

**Sin `before` en el editor.** «Falta «##» en el encabezado» compara con el texto anterior en el mismo idioma. En el editor, la fuente está en otro idioma, así que esa comprobación no se usa aquí. (mi decisión)

## 5. Cómo se construye (enfoque A, decidido)

Se **extiende `HelpChecksHint`** en lugar de hacer un componente nuevo. Así un solo lugar sigue decidiendo qué es un aviso y qué es seguro arreglar.

- `helpChecks.ts`:
  - Las comprobaciones del «tú» pasan a ser `HelpCheck` con `fix: "auto"` (`informalChecks`), a partir de `informalWords`.
  - `verseChecks` admite la opción del espacio doble.
  - `ruleChecks` admite el texto que va antes de la pieza.
  - `HelpKind` incluye `preguntas` y `academia`. `helpKindOf` no cambia, así que las propuestas siguen igual.
- `HelpChecksHint` recibe tres cosas nuevas: `address` (suma el «tú»), `quiet` (la forma discreta) y `settle` (la pausa). Sin ellas, se ve y se comporta como hoy.
- Los editores lo usan para el versículo o la pieza abierta. En el editor de ayudas reemplaza a `FormalAddressHint`.

**El otro enfoque (B)** era un componente nuevo solo para los editores. No tocaba lo que ya funciona, pero dejaba dos sitios que deciden lo mismo y que con el tiempo se separan.

## 6. Cómo se prueba

- **Lógica pura,** en `verify:help-checks`:
  - Cada comprobación aparece en la fila que le corresponde.
  - El espacio doble solo se avisa en un versículo con la opción.
  - El «tú» es un aviso que «Arreglar» corrige, junto con los de formato y en una sola pasada.
  - Una regla con `until` no se aplica en una pieza que va después de «## Ejemplos».
  - Preguntas y Academia reciben las comprobaciones de formato, pero no las reglas de Notas.
- **En el navegador, contra el mock sembrado con Ester,** en el teléfono (375 px) y en escritorio:
  - Un versículo con doble espacio y un espacio antes de una coma: la línea sale tras la pausa, y «Arreglar» deja el versículo limpio sin cerrar el teclado.
  - Una nota con «tú»: una sola línea, sin el aviso viejo, y «Arreglar» la deja en «usted».
  - Mientras se escribe, la línea no cambia.
  - Se mide con el guion de auditoría: la línea no supera el tamaño de «Fíjese en esto», los botones miden 44 px o más y no hay un segundo botón lleno.
  - Con el tamaño de letra grande, la línea crece con él.
- Siguen pasando `verify:formal-address`, `verify:config`, `verify:decoupling` y los tipos.

## 7. Lo que no cambia

- Ningún dato guardado ni cómo se guarda.
- Afinación, Armonización, la hoja de propuestas y la revisión en pares.
- Ningún nombre de fase, tarea, paso ni herramienta en `src/` (las reglas siguen en `processes/fcr.json`).
- No se agrega ninguna regla nueva al paquete. Si el equipo quiere más reglas para Preguntas o Academia, van en `writingChecks` y se muestran solas.
