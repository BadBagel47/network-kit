// In-process bridge: the real browser client (src/client/room.js) talking to
// the real RoomCore through fake sockets. Server time is a fake clock that
// tests advance; the client uses real, short timers.
// (Based on the proof scripts of the v0.1.0 review.)
import { RoomCore } from '../../src/server/room-core.js';
import { NetworkRoom } from '../../src/client/room.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `check()` is true. */
export async function until(check, timeoutMs = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for condition');
    await sleep(5);
  }
}

export class World {
  constructor(options) {
    this.time = Date.UTC(2026, 0, 1, 12);
    this.store = new Map();
    this.alarm = null;
    this.deferred = [];
    this.socketList = [];
    this.options = options;
    this.chain = Promise.resolve();
    this.down = false; // true: the server cannot be reached
    this.opened = 0;
  }

  host() {
    const w = this;
    return {
      env: {},
      now: () => w.time,
      storage: {
        get: async (k) => structuredClone(w.store.get(k)),
        put: async (k, v) => void w.store.set(k, structuredClone(v)),
        delete: async (k) => void w.store.delete(k),
        deleteAll: async () => void w.store.clear(),
      },
      setAlarm: async (at) => { w.alarm = at; },
      defer(ms, fn) {
        const entry = { at: w.time + ms, fn };
        w.deferred.push(entry);
        return () => { w.deferred = w.deferred.filter((d) => d !== entry); };
      },
      sockets: () => w.socketList.filter((ws) => !ws.closedWith),
      getAttachment: (ws) => ws.attachment,
      setAttachment: (ws, v) => { ws.attachment = structuredClone(v); },
      send: (ws, text) => {
        if (ws.closedWith || ws.client.dead) return;
        setTimeout(() => ws.client.onmessage?.({ data: text }), 0);
      },
      close: (ws, code, reason) => {
        if (ws.closedWith) return;
        ws.closedWith = { code, reason };
        if (ws.client.dead) return;
        setTimeout(() => { ws.client.readyState = 3; ws.client.onclose?.({ code, reason }); }, 0);
      },
    };
  }

  async boot() {
    this.core = new RoomCore(this.host(), this.options);
    await this.core.load();
    return this.core;
  }

  /** Create the room; returns what the create call returns. */
  async create(settings = {}) {
    await this.boot();
    return this.core.create(settings, 'ABCDE');
  }

  run(fn) {
    this.chain = this.chain.then(fn);
    return this.chain;
  }

  /** Let pending client and server work finish. */
  async settle(ms = 20) {
    await sleep(ms);
    await this.chain;
    await sleep(5);
  }

  async advance(ms) {
    await this.chain;
    const end = this.time + ms;
    for (;;) {
      const nextDeferred = this.deferred.reduce((min, d) => (min === null || d.at < min ? d.at : min), null);
      const candidates = [nextDeferred, this.alarm].filter((t) => t !== null && t <= end);
      if (candidates.length === 0) break;
      this.time = Math.max(this.time, Math.min(...candidates));
      const due = this.deferred.filter((d) => d.at <= this.time);
      this.deferred = this.deferred.filter((d) => d.at > this.time);
      for (const d of due) await d.fn();
      if (this.alarm !== null && this.alarm <= this.time) {
        this.alarm = null;
        await this.core.alarm();
      }
    }
    this.time = end;
    await this.settle();
  }

  /** Let the server clock follow real time (for tests of pacing and rate limits). */
  realtime() {
    const started = Date.now();
    const base = this.time;
    this.ticker = setInterval(() => { this.time = base + (Date.now() - started); }, 5);
    worlds.push(this);
  }

  /** The runtime finally notices that a dead socket is gone. */
  serverNotices(socket) {
    const peer = socket.peer;
    peer.closedWith ??= { code: 1006, reason: '' };
    return this.run(() => this.core.closed(peer));
  }

  WebSocket() {
    const w = this;
    return class BridgeWS {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.dead = false; // true: half-open, nothing gets through in either direction
        this.sent = [];
        const peer = { client: this, attachment: null, closedWith: null };
        this.peer = peer;
        w.opened += 1;
        setTimeout(() => {
          if (this.readyState !== 0) return;
          if (w.down) {
            this.readyState = 3;
            this.onclose?.({ code: 1006, reason: '' });
            return;
          }
          this.readyState = 1;
          w.socketList.push(peer);
          w.core.opened(peer);
          this.onopen?.();
        }, 0);
      }

      send(text) {
        if (this.dead) return;
        if (text === 'ping') {
          setTimeout(() => this.onmessage?.({ data: 'pong' }), 0);
          return;
        }
        this.sent.push(text);
        w.run(() => w.core.message(this.peer, text));
      }

      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        // Like a browser: the page hears about its own close a moment later.
        setTimeout(() => this.onclose?.({ code: 1006, reason: '' }), 0);
        if (this.dead) return; // the server does not hear about it
        if (!this.peer.closedWith) {
          this.peer.closedWith = { code: 1000, reason: '' };
          w.run(() => w.core.closed(this.peer));
        }
      }
    };
  }
}

export function fakeWindow() {
  const win = new EventTarget();
  win.navigator = { onLine: true };
  const doc = new EventTarget();
  doc.hidden = false;
  return { win, doc };
}

export function memStore() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const created = [];
const worlds = [];

/** Stop every client made so far (timers would keep the test process alive). */
export function cleanup() {
  for (const room of created.splice(0)) {
    room.stopped = true;
    room.stopTimers();
  }
  for (const world of worlds.splice(0)) clearInterval(world.ticker);
}

/** A real client wired to the world. Records its events in `room.seen`. */
export function client(world, extra = {}) {
  const { win, doc } = fakeWindow();
  const room = new NetworkRoom({
    server: 'http://bridge', code: 'ABCDE', WebSocket: world.WebSocket(), storage: memStore(),
    window: win, document: doc, minDelayMs: 10, maxDelayMs: 40, heartbeatMs: 100_000, pongTimeoutMs: 100,
    connectTimeoutMs: 1_000, ...extra,
  });
  created.push(room);
  room.seen = [];
  for (const type of ['message', 'host', 'role', 'peer', 'error', 'closed', 'status']) {
    room.on(type, (detail) => room.seen.push([type, detail]));
  }
  room.events = (type) => room.seen.filter(([t]) => t === type).map(([, d]) => d);
  return room;
}

/** Create a room with a connected owner. */
export async function start(options, settings) {
  const world = new World(options);
  const created = await world.create(settings);
  const owner = client(world, { name: 'Owner', ownerKey: created.ownerKey });
  await owner.connect();
  await world.settle();
  return { world, created, owner };
}

export async function join(world, name, extra = {}) {
  const room = client(world, { name, ...extra });
  await room.connect();
  await world.settle();
  return room;
}
