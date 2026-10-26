/** Who is in a subtask and on which help, live: the room, the peers, and the connection to the relay. */
import assert from "node:assert/strict";
import { applyServerMessage, livePeers, PEER_STALE_MS, peersOn, presenceRoom, PRESENCE_BEAT_MS, type Peer } from "../src/domain/presence";
import { connectPresence, type PresenceTimers, type SocketLike } from "../src/dcs/presence";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

await test("la sala es el host sin esquema, el repositorio de las respuestas y la clave de la subtarea", () => {
  assert.equal(presenceRoom({ host: "https://qa.door43.org/", owner: "es-419_gl", repo: "es-419_tn", key: "EST.12.notas-textos" }), "qa.door43.org|es-419_gl/es-419_tn|EST.12.notas-textos");
  assert.equal(presenceRoom({ host: "http://localhost:8798", owner: "o", repo: "r", key: "k" }), "localhost:8798|o/r|k");
});

const join = (userId: string, displayName: string, focus?: Peer["focus"]) => ({ type: "peer-join", peer: { userId, displayName, color: "#000", lastSeen: 1, ...(focus ? { focus } : {}) } });

await test("quien entra se agrega, quien cambia se actualiza, quien sale se quita, y lo desconocido no cambia nada", () => {
  let peers = applyServerMessage(new Map(), join("Bea", "Bea Ruiz"), 1000);
  assert.deepEqual([...peers.values()], [{ login: "bea", name: "Bea Ruiz", lastSeen: 1000 }]);
  peers = applyServerMessage(peers, join("bea", "Bea Ruiz", { item: "n1", doing: "writing" }), 2000);
  assert.deepEqual(peers.get("bea"), { login: "bea", name: "Bea Ruiz", focus: { item: "n1", doing: "writing" }, lastSeen: 2000 });
  assert.equal(applyServerMessage(peers, { type: "pong" }, 3000).size, 1);
  assert.equal(applyServerMessage(peers, "no es un mensaje", 3000).size, 1);
  assert.equal(applyServerMessage(peers, { type: "peer-leave", userId: "BEA" }, 3000).size, 0);
});

await test("los vivos no incluyen a quien mira ni a quien lleva más de 50 s sin señal", () => {
  let peers = applyServerMessage(new Map(), join("ana", "Ana"), 0);
  peers = applyServerMessage(peers, join("bea", "Bea"), 10_000);
  peers = applyServerMessage(peers, join("carla", "Carla"), 0);
  assert.deepEqual(livePeers(peers, PEER_STALE_MS, "Ana").map((p) => p.login), ["bea", "carla"]);
  assert.deepEqual(livePeers(peers, PEER_STALE_MS + 1, "ana").map((p) => p.login), ["bea"]);
});

await test("quién está en un ítem", () => {
  const peers: Peer[] = [
    { login: "bea", name: "Bea", focus: { item: "n1", doing: "viewing" }, lastSeen: 0 },
    { login: "carla", name: "Carla", focus: { item: "n2", doing: "writing" }, lastSeen: 0 },
    { login: "dina", name: "Dina", lastSeen: 0 },
  ];
  assert.deepEqual(peersOn(peers, "n2").map((p) => p.login), ["carla"]);
});

/** A socket and a clock that the test drives. */
function harness() {
  const sockets: (SocketLike & { sent: string[]; url: string; open(): void; receive(data: unknown): void; drop(): void; closed: boolean })[] = [];
  const timers: { at: number; fn: () => void; every?: number; id: number }[] = [];
  let clock = 0;
  let nextId = 1;
  const fakeTimers: PresenceTimers = {
    after: (ms, fn) => {
      const id = nextId++;
      timers.push({ at: clock + ms, fn, id });
      return id;
    },
    every: (ms, fn) => {
      const id = nextId++;
      timers.push({ at: clock + ms, fn, every: ms, id });
      return id;
    },
    clear: (id) => {
      const at = timers.findIndex((t) => t.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  };
  const advance = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (!due || due.at > until) break;
      clock = due.at;
      if (due.every) due.at += due.every;
      else timers.shift();
      due.fn();
    }
    clock = until;
  };
  const socket = (url: string) => {
    const s = {
      url,
      sent: [] as string[],
      closed: false,
      onopen: null as null | (() => void),
      onmessage: null as null | ((ev: { data: unknown }) => void),
      onclose: null as null | (() => void),
      send(data: string) {
        s.sent.push(data);
      },
      close() {
        s.closed = true;
        s.onclose?.();
      },
      open() {
        s.onopen?.();
      },
      receive(data: unknown) {
        s.onmessage?.({ data: JSON.stringify(data) });
      },
      drop() {
        s.onclose?.();
      },
    };
    sockets.push(s);
    return s;
  };
  return { sockets, fakeTimers, advance, socket, now: () => clock };
}

const session = { host: "http://localhost:8798", username: "Ana", token: "token-ana" } as never;

await test("al conectar se une con su sesión y repite su presencia cada 20 s", () => {
  const h = harness();
  const seen: Peer[][] = [];
  const conn = connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: (p) => seen.push(p), onEvent: () => undefined, socket: h.socket, now: h.now, timers: h.fakeTimers });
  assert.equal(h.sockets[0]!.url, "ws://relay.test/rooms/r%7Co%2Fx%7Ck");
  h.sockets[0]!.open();
  const joined = JSON.parse(h.sockets[0]!.sent[0]!);
  assert.equal(joined.type, "join");
  assert.deepEqual(joined.auth, { token: "token-ana" });
  assert.equal(joined.userId, "ana");
  conn.setFocus({ item: "n1", doing: "viewing" });
  assert.deepEqual(JSON.parse(h.sockets[0]!.sent.at(-1)!).presence.focus, { item: "n1", doing: "viewing" });
  const before = h.sockets[0]!.sent.length;
  h.advance(PRESENCE_BEAT_MS);
  assert.equal(h.sockets[0]!.sent.length, before + 1);
  assert.equal(JSON.parse(h.sockets[0]!.sent.at(-1)!).type, "presence");
  conn.close();
});

await test("lo que llega del servidor da la lista de personas, sin quien mira", () => {
  const h = harness();
  let last: Peer[] = [];
  connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: (p) => (last = p), onEvent: () => undefined, socket: h.socket, now: h.now, timers: h.fakeTimers });
  h.sockets[0]!.open();
  h.sockets[0]!.receive(join("bea", "Bea", { item: "n1", doing: "writing" }));
  h.sockets[0]!.receive(join("ana", "Ana"));
  assert.deepEqual(last.map((p) => p.login), ["bea"]);
  h.advance(PEER_STALE_MS + PRESENCE_BEAT_MS);
  assert.deepEqual(last, [], "quien no da señales se va");
});

await test("reconecta tras un corte, cada vez esperando más, y no tras un acceso negado", () => {
  const h = harness();
  connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: () => undefined, onEvent: () => undefined, socket: h.socket, now: h.now, timers: h.fakeTimers });
  h.sockets[0]!.open();
  h.sockets[0]!.drop();
  h.advance(999);
  assert.equal(h.sockets.length, 1);
  h.advance(1);
  assert.equal(h.sockets.length, 2, "a 1 s");
  h.sockets[1]!.drop();
  h.advance(2000);
  assert.equal(h.sockets.length, 3, "a 2 s");
  h.sockets[2]!.receive({ type: "denied", reason: "access" });
  h.sockets[2]!.drop();
  h.advance(60_000);
  assert.equal(h.sockets.length, 3, "tras denied no reintenta");
});

await test("anunciar una respuesta llega a los demás con quién la dio", () => {
  const h = harness();
  const events: unknown[] = [];
  const conn = connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: () => undefined, onEvent: (e) => events.push(e), socket: h.socket, now: h.now, timers: h.fakeTimers });
  h.sockets[0]!.open();
  conn.announce({ type: "taller:answered", item: "n7" });
  assert.deepEqual(JSON.parse(h.sockets[0]!.sent.at(-1)!), { type: "relay", message: { type: "taller:answered", senderId: "ana", payload: { type: "taller:answered", item: "n7" } } });
  h.sockets[0]!.receive({ type: "relay", message: { type: "taller:answered", senderId: "bea", payload: { type: "taller:answered", item: "n2" } } });
  h.sockets[0]!.receive({ type: "relay", message: { type: "ops", senderId: "bea", payload: {} } });
  assert.deepEqual(events, [{ type: "taller:answered", item: "n2", by: "bea" }]);
  conn.close();
  assert.ok(h.sockets[0]!.closed);
  h.advance(60_000);
  assert.equal(h.sockets.length, 1, "cerrar a propósito no reconecta");
});

await test("quien pierde la señal desaparece a los 55 s como mucho de su última señal", () => {
  const h = harness();
  let last: Peer[] = [];
  connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: (p) => (last = p), onEvent: () => undefined, socket: h.socket, now: h.now, timers: h.fakeTimers });
  h.sockets[0]!.open();
  h.sockets[0]!.receive(join("bea", "Bea"));
  h.advance(45_000);
  assert.deepEqual(last.map((p) => p.login), ["bea"], "todavía cuenta");
  h.advance(10_000);
  assert.deepEqual(last, [], "a los 55 s ya no");
});

await test("al volver a unirse tras un corte avisa para leer otra vez las respuestas", () => {
  const h = harness();
  let rejoined = 0;
  connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: () => undefined, onEvent: () => undefined, onRejoin: () => rejoined++, socket: h.socket, now: h.now, timers: h.fakeTimers });
  h.sockets[0]!.open();
  h.sockets[0]!.receive({ type: "joined", userId: "ana" });
  assert.equal(rejoined, 0, "la primera vez no");
  h.sockets[0]!.drop();
  h.advance(1000);
  h.sockets[1]!.open();
  h.sockets[1]!.receive({ type: "joined", userId: "ana" });
  assert.equal(rejoined, 1);
});

await test("si el servidor nunca acepta la unión, deja de intentar tras 8 cortes", () => {
  const h = harness();
  connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: () => undefined, onEvent: () => undefined, socket: h.socket, now: h.now, timers: h.fakeTimers });
  for (let i = 0; i < 20; i++) {
    const socket = h.sockets.at(-1)!;
    socket.open();
    socket.drop();
    h.advance(60_000);
  }
  assert.equal(h.sockets.length, 8);
});

await test("una unión aceptada vuelve a empezar la cuenta y la espera", () => {
  const h = harness();
  connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: () => undefined, onEvent: () => undefined, socket: h.socket, now: h.now, timers: h.fakeTimers });
  for (let i = 0; i < 5; i++) {
    h.sockets.at(-1)!.open();
    h.sockets.at(-1)!.drop();
    h.advance(60_000);
  }
  h.sockets.at(-1)!.open();
  h.sockets.at(-1)!.receive({ type: "joined", userId: "ana" });
  h.sockets.at(-1)!.drop();
  const count = h.sockets.length;
  h.advance(1000);
  assert.equal(h.sockets.length, count + 1, "a 1 s otra vez");
  for (let i = 0; i < 6; i++) {
    h.sockets.at(-1)!.open();
    h.sockets.at(-1)!.drop();
    h.advance(60_000);
  }
  assert.ok(h.sockets.length > count + 5, "la cuenta empezó de nuevo");
});

await test("al volver a la pestaña reconecta enseguida; tras un acceso negado, no", () => {
  const h = harness();
  const conn = connectPresence({ url: "ws://relay.test", room: "r|o/x|k", session, onPeers: () => undefined, onEvent: () => undefined, socket: h.socket, now: h.now, timers: h.fakeTimers });
  for (let i = 0; i < 10; i++) {
    h.sockets.at(-1)!.open();
    h.sockets.at(-1)!.drop();
    h.advance(60_000);
  }
  const stopped = h.sockets.length;
  conn.refresh();
  h.advance(0);
  assert.equal(h.sockets.length, stopped + 1, "un intento nuevo");
  h.sockets.at(-1)!.open();
  h.sockets.at(-1)!.receive({ type: "denied", reason: "auth" });
  h.sockets.at(-1)!.drop();
  conn.refresh();
  h.advance(60_000);
  assert.equal(h.sockets.length, stopped + 1, "negado, no insiste");
});

console.log(`\nverify-presence: ${passed} checks passed.`);
