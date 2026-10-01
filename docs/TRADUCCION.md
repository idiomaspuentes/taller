# Traducir y revisar los textos de Taller

Los textos de la interfaz son datos, no código, y se pueden revisar con una herramienta sin tocar el repositorio.

## Dónde están

| Qué | Archivo | Quién lo usa |
|---|---|---|
| Textos de las pantallas (fuente en español y portugués) | `src/i18n/locales/es.json`, `pt.json` | `useT()` / `tNow()` en `src/i18n/messages.ts` |
| Frases y nombres que el dominio construye en español y se traducen al mostrarlos (nombres de las plantillas, filtros y ayudas de las tareas, tarjetas de decisión, categorías de notas, libros, niveles, errores al guardar) | `src/i18n/locales/glossary.pt.json` | `templateNames.ts`, `scopeNames.ts`, `threadNames.ts`, `afinacionNames.ts`, `books.ts`, `levels.ts`, `languages.ts` |
| Texto de la organización (bienvenida, equipos) | `taller.config.ts` | pantalla de bienvenida |
| Qué se revisó, quién y cuándo | `src/i18n/locales/pt.review.json` | la herramienta |

Una clave sin traducción (cadena vacía) muestra el español.

## Flujo de revisión (quien coordina)

```bash
npm run translations:review        # genera docs/traduccion/revisar-portugues.html
```

1. Enviar ese archivo HTML a la persona que revisa (se abre en cualquier navegador, sin conexión ni cuenta; la herramienta está en portugués). Su trabajo queda guardado en su navegador y puede pausar y seguir.
2. Ella marca «Revisado», edita lo que haga falta, comenta lo dudoso y pulsa **Baixar meu trabalho**: se descarga un `.json`.
3. Recibir ese `.json` y aplicarlo:

```bash
npm run translations:apply -- revisao-pt-nombre-2026-10-01.json --dry   # simulacro: cuenta y avisa, no escribe
npm run translations:apply -- revisao-pt-nombre-2026-10-01.json
npm run verify:config && npm run build
```

`apply` salta (y lo cuenta) toda traducción vacía o que no conserve los `{marcadores}` del español, y las claves que ya no existen. Los textos marcados «Revisado» quedan en `pt.review.json`; los comentarios, en `docs/traduccion/comentarios.md`. Si el español de un texto cambia después, conviene quitar su marca de revisado (hoy no se hace solo).

El archivo `docs/traduccion/revisar-portugues.html` es generado: vuelve a crearlo con `translations:review` antes de enviarlo.

## Lo que la herramienta no edita

- **Frases con partes variables** (nombres, números, referencias: «Propuesta de @ana para NEH 1:2», «No se pudo guardar «x» en …»): su portugués está en expresiones regulares de `src/domain/*Names.ts`. Aparecen en la herramienta con un ejemplo y su traducción actual **solo para comentar**; los cambios los aplica quien coordina a mano. `verify:config` comprueba esas frases con los constructores reales.
- **El texto de la organización** (`taller.config.ts`): solo comentarios.
- **Lo que escribe la gente** (mensajes, notas de una propuesta) y **lo que se guarda en Door43** (el resumen de un voto o de un cierre): no se traduce.

## Añadir otro idioma

Los textos de pantalla sirven tal cual: copiar `es.json` a `<idioma>.json`, añadirlo a `TABLE` en `messages.ts` y a `uiLanguages` en `taller.config.ts`. Los glosarios y las frases con partes variables son hoy solo para portugués (`glossary.pt.json` y los `*Names.ts`); un idioma nuevo necesitaría su propia copia. Está pendiente generalizarlo si hace falta.
