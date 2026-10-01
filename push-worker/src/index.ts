import { allowedHost, loginOf, tokenOf } from "./auth";
import { list, type Env, type FetchFn } from "./env";
import { sendPush, type Vapid } from "./send";
import { listSubscriptions, removeSubscription, saveSubscription, validSubscription } from "./store";
import { hostOf, noticesFor, validSignature, type GiteaPayload } from "./webhook";

type Deps = { fetch: FetchFn };

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const ok = list(env.ALLOWED_ORIGINS).includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : "null",
    "access-control-allow-headers": "authorization, content-type, x-door43-host",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    vary: "origin",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Who the caller of /subscribe is: their Door43 host (one this Worker serves) and login (asked to Door43). */
async function caller(request: Request, env: Env, deps: Deps): Promise<{ host: string; login: string } | null> {
  const host = allowedHost(request.headers.get("x-door43-host"), env.ALLOWED_HOSTS);
  if (!host) return null;
  const login = await loginOf(deps.fetch, host, tokenOf(request));
  return login ? { host, login } : null;
}

export function createHandler(deps: Deps) {
  return async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (url.pathname === "/" && request.method === "GET") return json({ service: "tas-push", ok: true }, 200, headers);

    // The public key the browser needs to subscribe.
    if (url.pathname === "/vapid" && request.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, headers);

    if (url.pathname === "/subscribe" && (request.method === "POST" || request.method === "DELETE")) {
      const who = await caller(request, env, deps);
      if (!who) return json({ error: "No se pudo comprobar quién eres en Door43." }, 401, headers);
      const body = (await request.json().catch(() => null)) as { subscription?: unknown; endpoint?: string } | null;
      if (request.method === "POST") {
        if (!body || !validSubscription(body.subscription)) return json({ error: "La suscripción no es válida." }, 400, headers);
        await saveSubscription(env.SUBSCRIPTIONS, who.host, who.login, body.subscription);
      } else if (body?.endpoint) {
        await removeSubscription(env.SUBSCRIPTIONS, who.host, who.login, body.endpoint);
      }
      return new Response(null, { status: 204, headers });
    }

    // Door43 announces what happened; only a request signed with the shared secret counts.
    if (url.pathname === "/webhook" && request.method === "POST") {
      const raw = await request.text();
      const signature = request.headers.get("x-gitea-signature") ?? request.headers.get("x-hub-signature-256");
      if (!(await validSignature(env.WEBHOOK_SECRET, raw, signature))) return json({ error: "Firma no válida." }, 401, headers);
      let payload: GiteaPayload;
      try {
        payload = JSON.parse(raw) as GiteaPayload;
      } catch {
        return json({ error: "Cuerpo no válido." }, 400, headers);
      }
      const host = allowedHost(hostOf(payload), env.ALLOWED_HOSTS);
      if (!host) return json({ ignored: "servidor no permitido" }, 200, headers);
      const vapid: Vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
      const notices = noticesFor(request.headers.get("x-gitea-event") ?? request.headers.get("x-github-event"), payload, env.APP_URL);
      let sent = 0;
      for (const notice of notices) {
        for (const sub of await listSubscriptions(env.SUBSCRIPTIONS, host, notice.login)) {
          const result = await sendPush(deps.fetch, sub, notice, vapid);
          if (result === "sent") sent++;
          if (result === "gone") await removeSubscription(env.SUBSCRIPTIONS, host, notice.login, sub.endpoint);
        }
      }
      return json({ notices: notices.length, sent }, 200, headers);
    }

    return json({ error: "No existe." }, 404, headers);
  };
}

const handle = createHandler({ fetch: (input, init) => fetch(input, init) });

export default {
  fetch: handle,
} satisfies ExportedHandler<Env>;
