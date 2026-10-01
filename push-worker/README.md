# Avisos push de TAS (Cloudflare Workers, plan gratuito)

Un Worker pequeño que hace llegar al teléfono un aviso cuando alguien te menciona o te asigna una subtarea, **aunque no tengas TAS abierto**.

```
Door43 ──(webhook firmado)──▶ Worker ──(Web Push cifrado)──▶ servicio de push del navegador ──▶ tu teléfono
                               ▲
   la app ──(suscribir, con tu token de Door43)──┘     KV: un registro por dispositivo
```

- El Worker **no guarda tu token**: lo usa una vez para preguntarle a Door43 quién eres.
- Guarda, por persona, la dirección que el navegador le da a cada dispositivo (hasta 5 por persona). Es un dato personal mínimo; se borra al desactivar los avisos o cuando el dispositivo deja de existir.
- Solo Door43 puede anunciar avisos: cada anuncio trae una firma con un secreto que solo conocen Door43 y el Worker.

## Qué avisa (y qué no)

Avisa cuando:
- un comentario te **menciona** con `@tuusuario` (las decisiones del equipo, los consensos y los recordatorios de voto usan menciones);
- alguien comenta una subtarea que **tienes asignada**;
- te **asignan** una subtarea.

No avisa todavía de:
- subtareas nuevas **libres para tu equipo** (Door43 no dice a qué equipo pertenece cada persona; haría falta que el Worker lea el plan del proyecto);
- el recordatorio de plazo **cuando nadie abre la app** (hoy lo hace la app misma; con el Worker se podría hacer con un cron y una cuenta de servicio de Door43).

## Poner en marcha (una vez)

Necesitas una cuenta gratuita de Cloudflare y Node. Todo se hace en esta carpeta (`push-worker/`).

1. `npm install`
2. `npx wrangler login` (abre el navegador para entrar a tu cuenta de Cloudflare).
3. Crear el almacén: `npx wrangler kv namespace create SUBSCRIPTIONS`. Copia el `id` que imprime en `wrangler.toml` (reemplaza `CAMBIAR-por-el-id…`).
4. Claves del servicio de push: `npm run keys` imprime `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`. Guárdalas como secretos (te pide el valor):
   - `npx wrangler secret put VAPID_PUBLIC_KEY`
   - `npx wrangler secret put VAPID_PRIVATE_KEY`
5. Un secreto para las firmas de Door43 (invéntalo largo y al azar, por ejemplo con `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`):
   - `npx wrangler secret put WEBHOOK_SECRET`
6. Revisa los valores de `wrangler.toml`:
   - `ALLOWED_HOSTS`: los servidores de Door43 cuya gente puede suscribirse (producción y QA; quita QA al lanzar si ya no se prueba).
   - `APP_URL` y `ALLOWED_ORIGINS`: la dirección donde se sirve la app (con HTTPS), sin barra final.
   - `VAPID_SUBJECT`: un correo de contacto, como `mailto:equipo@tudominio.org`.
7. `npx wrangler deploy`. Imprime la dirección del Worker, por ejemplo `https://tas-push.tucuenta.workers.dev`.

## Conectar Door43

En Door43 (QA), en la organización del equipo (`BSOJ`), ve a **Configuración → Webhooks → Añadir webhook → Gitea**:
- URL de destino: `https://tas-push.tucuenta.workers.dev/webhook`
- Tipo de contenido: `application/json`
- Secreto: el mismo `WEBHOOK_SECRET` del paso 5
- Eventos: **Incidencias** y **Comentarios de incidencias** (es lo que Door43 llama a las subtareas)
- Activo.

## Conectar la app

La app tiene que servirse por **HTTPS** (los avisos push no funcionan por `http://` en el teléfono). La forma gratuita es Cloudflare Pages:

1. En la raíz del proyecto, crea `.env.production.local` con `VITE_PUSH_URL=https://tas-push.tucuenta.workers.dev`.
2. `npm run build`
3. `npx wrangler pages deploy dist --project-name tas` (la primera vez crea el proyecto y da una dirección `https://tas.pages.dev`).
4. Pon esa dirección en `APP_URL` y `ALLOWED_ORIGINS` de `wrangler.toml` y vuelve a hacer `npx wrangler deploy`.

## Probar en el teléfono

1. Abre la dirección de Pages en el teléfono, entra a QA, y **instala la app** (menú del navegador → «Instalar» / «Añadir a pantalla de inicio»). En iPhone, los avisos solo funcionan con la app instalada.
2. En el menú de la app: **Avisos con la app cerrada → Activar en este dispositivo** y acepta el permiso.
3. Pide a otra persona que te mencione en un comentario de una subtarea. Debe llegarte el aviso con la app cerrada; al tocarlo abre la subtarea.

## Si algo no llega

- `npx wrangler tail` muestra en vivo lo que recibe el Worker.
- En Door43, el webhook tiene una lista de entregas con la respuesta del Worker (debe ser 200; 401 = el secreto no coincide).
- Un dispositivo que dejó de existir se borra solo la próxima vez que se le intenta avisar.

## Límites del plan gratuito

Cloudflare Workers gratis: 100 000 peticiones al día; KV: 100 000 lecturas y 1 000 escrituras al día. Para un equipo pequeño sobra con mucho margen. Web Push no cuesta nada.

## Pruebas

Desde la raíz del proyecto: `npm run verify:push-worker` (el Worker: suscripción, firma del webhook, a quién se avisa, cifrado y firma reales) y `npm run verify:push-client` (la app).
