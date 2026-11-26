# Fase 1, entrega 8: las ayudas se guardan solas, en el borrador propio

*Escrito el 26 de noviembre de 2026. Lo leyeron siete revisores sin contexto (Sonnet). **Aprobado por Abel el 26 de noviembre**, con las decisiones marcadas «(mi decisión)». Lo marcado «(decidido)» lo decidió Abel; lo marcado «(mi decisión)» lo decidí al escribir, y Abel lo revisa al aprobar.*

Parte del diseño de la Fase 1 ([`2026-11-23-fase-1-traduccion-design.md`](2026-11-23-fase-1-traduccion-design.md), decisión 3) y de su plan ([`2026-11-24-fase-1-traduccion.md`](../plans/2026-11-24-fase-1-traduccion.md), «Entrega 8»). Los nombres técnicos entre paréntesis son para quien lo construya.

## 1. Para qué

El editor del texto (TPL, TPS) se guarda solo. El de ayudas pide tocar «Guardar»: la misma persona aprende una regla en uno y se confunde en el otro, y lo que no guarda no llega a Door43 (en una prueba, tras nueve segundos seguía «sin guardar»).

**Éxito:** quien traduce notas, preguntas o artículos escribe y, un momento después, el pie dice «Guardado», sin haber tocado nada. Si cierra la pantalla, lo escrito está en su borrador de Door43 o, si aún no llegó, en el aparato, y vuelve al abrir.

**Fracaso aunque funcione:** que el guardado solo escriba sobre algo que no debía: lo guardado en el aparato, el borrador del equipo o el texto de otra persona. Que los botones del pie aparezcan y desaparezcan mientras se escribe. Que un fallo de red golpee Door43 cada pocos segundos.

## 2. Alcance

- **Se guarda solo:** el editor de ayudas (`HelpsEditorView`) cuando escribe en el borrador propio de la persona. Vale en Notas, Preguntas, Palabras y Academia, con la tarea por terminar, ya terminada o en revisión.
- **Sigue pidiendo «Guardar»:** el mismo editor cuando corrige el borrador del equipo (`shared`, que sale de `onTeamDraft` y escribe con `saveTeamHelpsRows` / `saveTeamHelpsFile`). Ahí escribir es cambiar el texto de todos. (decidido, decisión 3 de la fase)
- **No cambia:** el editor del texto, cómo se guarda un archivo en Door43 (`saveTextOnPortionBranch`), cómo se arma el TSV o el artículo, la revisión en pares, Afinación y Armonización.

## 3. Lo que ve la persona

### 3.1 El pie (decidido: opción A)

```
Escribiendo:   Sin guardar                                   [Terminé el borrador]
Un momento:    Guardando…                                    [Terminé el borrador]
Después:       Quedan 3 notas sin traducir.                  [Terminé el borrador]
Si falla:      No se pudo guardar; quedó en este teléfono.   [Reintentar] [Terminé el borrador]
```

- En el borrador propio **no hay botón «Guardar»**. Los botones del pie no cambian mientras se escribe. (decidido)
- «Reintentar» aparece solo cuando el último guardado falló, en forma secundaria (`outline`). Desaparece en cuanto un guardado sale bien. (decidido)
- La línea del pie dice, en este orden: sin sesión → lo de hoy (`he.footOffline`); falló → «No se pudo guardar; quedó en este teléfono.»; guardando → «Guardando…»; con algo por guardar → «Sin guardar»; si no, lo de hoy (lo que queda por traducir, «Ya está en revisión», «Todo guardado…»). Son las mismas palabras que el editor del texto (`se.saving`, `se.unsaved`). (mi decisión)
- «Ya está en revisión. Lo que guarde se suma a ella.» pasa a «Ya está en revisión. Lo que escriba se suma a ella.», porque ya no se guarda a mano. (mi decisión)
- El guardado solo no avisa con un anuncio («Guardado.»); lo dice el pie. Un guardado tocado con «Reintentar» sí avisa, como hoy. (mi decisión, como el editor del texto)
- Cuando la tarea no tiene paso por terminar (abierta desde otro lado, o ya terminada), el pie conserva «Listo para revisión» si aún no hay revisión, y ya no tiene «Guardar». (mi decisión)

### 3.2 Cuándo se guarda (mi decisión)

- **3,5 segundos después de la última tecla**, como el editor del texto. Mientras se escribe, cada tecla se guarda ya en el aparato (`persistLocal`, como hoy).
- **No se guarda al abrir** si nada cambió. Si al abrir vuelve un borrador del aparato que no llegó a Door43 (`restore`), el editor ya lo marca «sin guardar» (`setDirty(restored)`, como hoy) y se guarda solo 3,5 s después, como en el editor del texto: es trabajo de la persona que no había llegado.
- **Un artículo que empieza desde la fuente** (`startingText`) no se guarda hasta que se escriba algo, como hoy.
- **«Terminé el borrador»** sigue guardando antes de entregar si queda algo, y no se puede tocar mientras se guarda. Al tocarlo, el guardado solo que esperaba se cancela y «Terminé» guarda él: nunca dos guardados a la vez. Mientras está abierta la pregunta «¿Entregar con piezas sin traducir?», tampoco se guarda solo.
- **Al salir de la pantalla** no se fuerza un guardado: lo escrito está en el aparato y vuelve al abrir, como en el editor del texto.

### 3.3 Si falla la red (decidido)

Tras un guardado que falla, el editor **no reintenta solo cada 3,5 s**. Vuelve a intentar cuando:

- la persona escribe otra vez (y pasan los 3,5 s);
- el navegador avisa que volvió la conexión (evento `online`);
- la persona toca «Reintentar».

El error queda arriba, como hoy (`setError`), y el pie dice que lo escrito quedó en el aparato.

### 3.4 Modo de prueba (mi decisión)

En el modo de prueba que no escribe en Door43 (`labWriteDecision` = `local`), el guardado solo se comporta como en el editor del texto: deja de estar «Sin guardar» y el pie dice «Guardado en este navegador» (`se.savedHere`) hasta la siguiente tecla. Hoy el editor de ayudas anuncia el motivo cada vez que se toca «Guardar»; con el guardado solo lo anunciaría cada 3,5 s. En el modo de prueba que escribe en Door43 (`dcs`) se guarda solo como siempre. En el bloqueado (`blocked`) no se guarda solo: el error queda arriba, como hoy.

## 4. Lo que arreglan las pruebas antes de empezar (PR #48)

El 23 de noviembre se arreglaron dos fallos del editor del texto (PR #48, commits `13f1d44` y `943aa8f`). El plan de la fase pide reproducirlos con el guardado solo antes de tocar nada. En el editor de ayudas se ven así:

1. **El borrador del aparato y una rama que ya no está.** El editor de ayudas no prepara la rama al abrir: la lee (`readFilePreferBranch`) y, si no puede, lee la rama principal. Si la persona había guardado (el aparato dice `unsaved: false`) y su rama se perdió, hoy la apertura da lo del aparato por guardado (`saved`), muestra el texto de la rama principal, y la primera tecla escribe sobre lo que guardaba el aparato. Con el guardado solo, ese texto llegaría además a Door43 sin que la persona lo decidiera. **Se arregla como en el editor del texto:** cuando el aparato dice que lo guardó en la rama propia (`unsaved: false` y `branch` igual a esa rama) y esa rama ya no tiene ref de git, la apertura llama a `lostItsBranch()` antes de decidir. Lo del aparato vuelve (`restore`, si Door43 da en blanco o lo mismo sobre lo que se escribió) o queda aparte (`aside`, si da otro texto), nunca se pisa. Se pregunta por la ref, no por un fallo de lectura: un archivo que aún no existe también falla al leerse y no es una rama perdida. (mi decisión)
2. **«Rehacer mi borrador» dejaba una rama rota.** El editor de ayudas no tiene «Rehacer», pero guarda con `ensureTaskBranchFromBook`, que desde el PR #48 rehace una rama listada sin commit. La prueba comprueba que un guardado de ayudas sobre una rama así la rehace, no borra nada y no pisa otra rama. El aviso `restored` que devuelve el arranque llega al editor (hoy `saveUsfmOnPortionBranch` lo pierde). Cuando llega, el editor marca lo del aparato como no guardado (`keptDraftLostItsBranch`) y escribe cada archivo según la regla 3, sobre lo que hay de verdad en la rama rehecha. Así un artículo no da por guardados los archivos que no volvió a escribir, y «Terminé» no entrega nada a medias. (mi decisión)
3. **Nunca se escribe sin el sha de la misma rama.** Hoy, si el editor no pudo leer el archivo en la rama propia (porque aún no existe, porque se perdió o por un fallo pasajero), lee la rama principal y se queda **sin sha**. Al guardar, Door43 recibe el archivo sin sha y lo escribe encima de lo que tenga la rama, sin comparar. En las notas eso es el TSV de todo el libro: las filas de otros pasajes que el grupo ya cambió en su borrador volverían a lo de la principal. Hoy pasa al tocar «Guardar»; con el guardado solo pasaría sin que nadie lo decida. **Desde esta entrega**, antes de escribir un archivo del que no se tiene el sha de la rama propia, o cuando Door43 rechaza el sha, o cuando la rama se rehízo, el editor lee ese archivo en la rama propia (preparada una vez al empezar el guardado) y escribe sobre él. Compara con lo último que leyó o escribió de ese archivo, no solo con lo de la apertura, para que su propio guardado anterior no parezca un conflicto:
   - **No existe ahí:** se crea, y solo se crea: si apareció en el medio, Door43 lo rechaza y es un conflicto.
   - **Notas y preguntas (un TSV del libro):** si las filas de este pasaje dicen ahí lo mismo que lo último que el editor leyó o escribió, aplica los cambios de la persona sobre **ese** archivo y guarda con su sha. Las filas de los otros pasajes quedan como están en la rama. Si las filas del pasaje dicen otra cosa, es un conflicto: no se escribe, se dice, y lo escrito queda en el aparato.
   - **Un artículo:** si su texto ahí es el mismo que lo último que el editor leyó o escribió, guarda con su sha. Si no, es un conflicto y se dice, como en el editor del texto (líneas 1899–1908).
   
   Se hace una sola vez por archivo y por guardado: nunca un bucle. **Tras una rama rehecha no se compara:** la rama se acaba de cortar del borrador del grupo y nadie más escribe en ella, así que lo de la persona se escribe sobre lo que hay ahí, como cuando se cortó la primera vez. (mi decisión)
4. **Un artículo que no se pudo leer al abrir.** Hoy cualquier error al leerlo deja el artículo vacío y sin sha, y el guardado escribiría encima de lo que tenga la rama sin compararlo. Con el guardado solo eso pasaría sin que nadie toque «Guardar». Desde esta entrega, solo un 404 (el archivo no existe) da un artículo vacío; cualquier otro error detiene la apertura con su mensaje, como ya pasa con las notas. (mi decisión)

Esas pruebas pasan antes y después de agregar el guardado solo.

## 5. Enfoques

- **A. El guardado solo dentro de `HelpsEditorView`, con la decisión de cuándo guardar en el dominio (elegido, mi decisión).** Un efecto con el temporizador, como el del editor del texto, y una función pura (`autosaveDue`) que dice si toca guardar, para probarla sin pantalla.
- **B. Un gancho común (`useAutosave`) para los dos editores.** Quedaría una sola regla, pero obliga a tocar el guardado del editor del texto, que el plan de la fase pide no tocar sin una razón fuerte. Se descarta.

## 6. Cómo se prueba

- **Lógica pura** (`verify:draft-cache`, `verify:book-bootstrap` y una prueba nueva `verify:helps-autosave`): los dos casos del PR #48 en el camino de las ayudas (sección 4); cuándo toca guardar (`autosaveDue`: nunca en `shared`, ni sin sesión, ni guardando, ni terminando, ni tras un fallo hasta que haya otra tecla o vuelva la red).
- **En el navegador, contra el mock sembrado con Ester** (no en modo de prueba), a 375 px y en escritorio: escribir una nota, esperar, ver «Guardando…» y luego el pie sin «Sin guardar»; recargar y leer lo escrito **en el mock** (la API del archivo en la rama de la persona). Lo mismo con una pregunta y su respuesta, y con un artículo de Palabras escrito por piezas. Cortar el mock: el pie dice que falló, «Reintentar» aparece, y el mock no recibe un pedido cada 3,5 s. Abrir una tarea de corrección del borrador del equipo: sigue con «Guardar».
- Siguen pasando `npx tsc --noEmit -p .`, `verify:config`, `verify:decoupling`, `verify:text-size` y `verify:helps-table`.

## 7. Fuera del alcance

- El editor del texto reintenta solo cada 3,5 s mientras falla la red (su efecto vuelve a correr al terminar cada guardado). Va como issue aparte.
- El reintento por sha del editor del texto (`ScriptureEditorView.tsx` 1899–1908) pregunta `isShaConflict(err)`, pero `writeRepoFile` le entrega el error envuelto: probablemente nunca se activa. Va como issue aparte; esta entrega solo agrega `writeRefusedStatus`, que ese arreglo podrá usar.
- Cambiar qué rama lee el editor de ayudas cuando la propia no existe todavía (hoy, la principal). La sección 4.3 evita que eso trabe el guardado o pise las filas de otros pasajes. Si al probar se ve que también conviene leer al abrir el borrador del grupo en lugar de la principal, se abre un issue.
- Dos pestañas abiertas en la misma tarea se pisan lo guardado en el aparato. Ya pasa hoy y no cambia.
