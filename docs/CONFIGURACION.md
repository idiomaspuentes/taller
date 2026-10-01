# Adaptar Taller a otra organización

Todo lo que cambia de una organización a otra vive en **un solo archivo**: [`taller.config.ts`](../taller.config.ts), en la raíz del repositorio. Quien use este código no necesita tocar el resto para tener su propia bienvenida, sus equipos y su nombre. El archivo no guarda secretos.

## Qué se configura

| Campo | Para qué sirve |
|---|---|
| `brand.name` | El nombre de la app en cada idioma de la interfaz (`es`, `pt`). |
| `brand.organization` | La organización que aparece sobre el título de la bienvenida y en el título de la pestaña. |
| `uiLanguages` / `defaultUiLanguage` | Los idiomas de la interfaz. La primera visita sigue el idioma del navegador; la persona puede cambiarlo en la pantalla de bienvenida. |
| `defaultServer` | El servidor de Door43 con el que arranca la app publicada (`production` o `qa`). Cada persona puede cambiarlo en «Avanzado» al iniciar sesión. |
| `workspaces` | Los **espacios de trabajo**: uno por equipo de lengua. Ver abajo. |
| `welcome` | El texto de la primera pantalla, en cada idioma: título, subtítulo, tres líneas de lo que se encontrará, la pregunta del equipo, el botón y el texto de confianza. |

## Espacios de trabajo (equipos que no se mezclan)

Cada espacio tiene su propia organización de Door43, y por eso **sus proyectos, tareas y avisos nunca se mezclan con los de otro**: la app solo lee y escribe dentro de la organización del espacio elegido.

```ts
{
  id: "pt",                    // clave estable; no la cambies cuando ya haya personas usando la app
  lang: "pt-br",               // código de lengua en Door43
  contentOrg: "pt-br_gl",      // organización de los repositorios de contenido
  pmOrg: "pt-br_gl",           // organización donde vive el repositorio gateway-tasks (plan y subtareas)
  uiLanguage: "pt",            // idioma de interfaz con el que empieza este equipo
  name: { es: "Portugués (Brasil)", pt: "Português (Brasil)" },
}
```

- Con **un solo espacio**, la bienvenida no pregunta nada y entra directo.
- Con **varios**, la bienvenida muestra una tarjeta por equipo y sugiere el que habla el idioma de la interfaz.
- Dos espacios **no pueden compartir `pmOrg`**: la configuración se valida y avisa (en la consola en desarrollo, y en `npm run verify:config`).
- Quien ya inició sesión puede cambiar de espacio en el diálogo «Sesión»; la app se recarga para que no quede nada del espacio anterior.

## Cambiar la bienvenida

Edita `welcome.es` y `welcome.pt` en `taller.config.ts`. Los tres puntos (`points`) llevan un ícono cada uno. Si añades un idioma nuevo hay que:

1. añadirlo a `UiLanguage` en [`src/config/types.ts`](../src/config/types.ts) y a `uiLanguages`;
2. escribir su texto en `welcome`, `brand.name` y el `name` de cada espacio;
3. añadir su columna en [`src/i18n/messages.ts`](../src/i18n/messages.ts) (los textos generales de la interfaz: menús, inicio de sesión, avisos).

## Qué está traducido y qué no

La pantalla de bienvenida, el inicio de sesión, los menús principales, el aviso para activar notificaciones y el selector de espacio están en español y portugués. **El resto de la app sigue en español** y se irá pasando a `src/i18n/messages.ts` por pantallas.

## Avisos con la app cerrada en cada espacio

El Worker de avisos (`push-worker/`) escucha un webhook por organización. Para cada espacio hay que crear el webhook de Door43 en **su** organización (`pmOrg`), con el mismo secreto. Ver [`push-worker/README.md`](../push-worker/README.md).

## Comprobar

```bash
npm run verify:config
```

Valida la configuración (espacios sin repetir, textos completos en cada idioma) y la lógica de idioma y espacio.
