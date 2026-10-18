import { allowedHost, loginOf, tokenOf } from "./auth";
import { list, type Env, type FetchFn } from "./env";
import { sendPush, type Vapid } from "./send";
import { listDevices, removeSubscription, saveSubscription, validSubscription } from "./store";
import { askedNotices, hostOf, isAskedKind, noticesFor, validSignature, type GiteaPayload, type Notice } from "./webhook";
import { remindDue, reportSeen, type RoundResult } from "./reminders";
import { cleanReport } from "../../src/domain/reminder";

type Deps = { fetch: FetchFn; now: () => number };

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

/** Tell each device of each person, in its language; a device that is gone is forgotten. */
async function deliver(notices: Notice[], host: string, env: Env, deps: Deps): Promise<number> {
  const vapid: Vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  let sent = 0;
  for (const notice of notices) {
    for (const device of await listDevices(env.SUBSCRIPTIONS, host, notice.login)) {
      const result = await sendPush(deps.fetch, device.sub, notice, vapid, device.lang);
      if (result === "sent") sent++;
      if (result === "gone") await removeSubscription(env.SUBSCRIPTIONS, host, notice.login, device.sub.endpoint);
    }
  }
  return sent;
}

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
/** The most people one request may tell: a team, not a mailing list. */
const MAX_PEOPLE = 40;

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
      const body = (await request.json().catch(() => null)) as { subscription?: unknown; endpoint?: string; lang?: unknown } | null;
      if (request.method === "POST") {
        if (!body || !validSubscription(body.subscription)) return json({ error: "La suscripción no es válida." }, 400, headers);
        const lang = typeof body.lang === "string" && /^[a-z]{2}$/.test(body.lang) ? body.lang : undefined;
        await saveSubscription(env.SUBSCRIPTIONS, who.host, who.login, body.subscription, Date.now(), lang);
      } else if (body?.endpoint) {
        await removeSubscription(env.SUBSCRIPTIONS, who.host, who.login, body.endpoint);
      }
      return new Response(null, { status: 204, headers });
    }

    // The app tells what it saw in «Mis tareas» (how many tasks wait, the device's zone, the reminder hour): the person
    // came in today, and the daily reminder knows what to say. Only about the person who asks.
    if (url.pathname === "/remind" && request.method === "POST") {
      const who = await caller(request, env, deps);
      if (!who) return json({ error: "No se pudo comprobar quién eres en Door43." }, 401, headers);
      const report = cleanReport(await request.json().catch(() => null));
      if (!report) return json({ error: "Recordatorio no válido." }, 400, headers);
      await reportSeen(env.SUBSCRIPTIONS, who.host, who.login, report, deps.now());
      return new Response(null, { status: 204, headers });
    }

    // The app asks to tell people what Door43 does not announce by itself (a subtarea became free for a team, it is
    // somebody's turn, a decision waits). Whoever asks is a person signed in to Door43 who can read that subtarea;
    // they choose who is told, never what is said.
    if (url.pathname === "/notify" && request.method === "POST") {
      const who = await caller(request, env, deps);
      if (!who) return json({ error: "No se pudo comprobar quién eres en Door43." }, 401, headers);
      const body = (await request.json().catch(() => null)) as { kind?: unknown; org?: unknown; repo?: unknown; issue?: unknown; count?: unknown; to?: unknown; step?: unknown } | null;
      const org = String(body?.org ?? ""), repo = String(body?.repo ?? ""), number = Number(body?.issue);
      const to = Array.isArray(body?.to) ? body.to.filter((x): x is string => typeof x === "string" && NAME.test(x)).slice(0, MAX_PEOPLE) : [];
      if (!body || !isAskedKind(body.kind) || !NAME.test(org) || !NAME.test(repo) || !Number.isInteger(number) || number < 1) return json({ error: "Aviso no válido." }, 400, headers);
      if (!to.length) return json({ notices: 0, sent: 0 }, 200, headers);
      const res = await deps.fetch(`${who.host}/api/v1/repos/${org}/${repo}/issues/${number}`, { headers: { Authorization: `token ${tokenOf(request)}`, "User-Agent": "tas-push/0.1" } }).catch(() => null);
      if (!res?.ok) return json({ error: "No se pudo leer esa subtarea." }, 404, headers);
      const issue = (await res.json()) as GiteaPayload["issue"];
      const count = Math.max(1, Math.min(500, Math.floor(Number(body.count) || 1)));
      const step = typeof body.step === "string" ? body.step.slice(0, 80) : undefined;
      const notices = askedNotices({ kind: body.kind, issue: issue ?? {}, count, to, step, from: who.login, appUrl: env.APP_URL });
      return json({ notices: notices.length, sent: await deliver(notices, who.host, env, deps) }, 200, headers);
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
      const notices = noticesFor(request.headers.get("x-gitea-event") ?? request.headers.get("x-github-event"), payload, env.APP_URL);
      return json({ notices: notices.length, sent: await deliver(notices, host, env, deps) }, 200, headers);
    }

    return json({ error: "No existe." }, 404, headers);
  };
}

/** One run of the round of daily reminders (the cron in wrangler.toml, every two minutes). */
export function runReminders(env: Env, deps: Deps): Promise<RoundResult> {
  const vapid: Vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  return remindDue(env.SUBSCRIPTIONS, deps.now(), env.APP_URL, async (host, login) => {
    // The same as `deliver`, counting what it costs: the round keeps within what the free plan allows a run.
    const devices = await listDevices(env.SUBSCRIPTIONS, host, login);
    return {
      devices: devices.length,
      send: async (notice) => {
        let sent = 0, calls = 0;
        for (const device of devices) {
          const result = await sendPush(deps.fetch, device.sub, notice, vapid, device.lang);
          if (result === "sent") sent++;
          if (result === "gone") {
            await removeSubscription(env.SUBSCRIPTIONS, host, login, device.sub.endpoint);
            calls += 2;
          }
        }
        return { sent, calls };
      },
    };
  });
}

const deps: Deps = { fetch: (input, init) => fetch(input, init), now: () => Date.now() };
const handle = createHandler(deps);

export default {
  fetch: handle,
  scheduled: (_event, env, ctx) => ctx.waitUntil(runReminders(env, deps)),
} satisfies ExportedHandler<Env>;
