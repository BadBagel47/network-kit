// In-process bridge: the real browser client (src/client/room.js) talking to the real RoomCore
// through fake sockets. Server time is a fake clock; the client uses real (short) timers.
import { RoomCore } from '../../../src/server/room-core.js';
import { NetworkRoom } from '../../../src/client/room.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class World {
  constructor(options) {
    this.time = 1_000_000;
    this.store = new Map();
    this.alarm = null;
    this.socketList = [];
    this.options = options;
    this.chain = Promise.resolve();
    this.log = [];
  }
  host() {
    const w = this;
    return {
      now: () => w.time,
      storage: {
        get: async (k) => structuredClone(w.store.get(k)),
        put: async (k, v) => void w.store.set(k, structuredClone(v)),
        delete: async (k) => void w.store.delete(k),
        deleteAll: async () => void w.store.clear(),
      },
      setAlarm: async (at) => { w.alarm = at; },
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
  async boot() { this.core = new RoomCore(this.host(), this.options); await this.core.load(); return this.core; }
  run(fn) { this.chain = this.chain.then(fn); return this.chain; }
  async advance(ms) {
    await this.chain;
    this.time += ms;
    while (this.alarm !== null && this.alarm <= this.time) { this.alarm = null; await this.core.alarm(); }
  }
  /** The runtime finally notices that a dead socket is gone. */
  serverNotices(client) {
    const peer = client.ws_peer;
    peer.closedWith ??= { code: 1006, reason: '' };
    return this.run(() => this.core.closed(peer));
  }
  WebSocket() {
    const w = this;
    return class BridgeWS {
      constructor(url) {
        this.url = url; this.readyState = 0; this.dead = false;
        const peer = { client: this, attachment: null, closedWith: null };
        this.peer = peer;
        w.lastSocket = this;
        w.opened = (w.opened ?? 0) + 1;
        setTimeout(() => {
          if (this.readyState !== 0) return;
          this.readyState = 1;
          w.socketList.push(peer);
          w.core.opened(peer);
          this.onopen?.();
        }, 0);
      }
      send(text) {
        if (this.dead) return; // half-open: bytes go nowhere
        if (text === 'ping') { setTimeout(() => this.onmessage?.({ data: 'pong' }), 0); return; }
        w.run(() => w.core.message(this.peer, text));
      }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        if (this.dead) return; // the server does not hear about it
        if (!this.peer.closedWith) { this.peer.closedWith = { code: 1000, reason: '' }; w.run(() => w.core.closed(this.peer)); }
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
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

export function client(world, extra = {}) {
  const { win, doc } = fakeWindow();
  const room = new NetworkRoom({
    server: 'http://bridge', code: 'ABCDE', WebSocket: world.WebSocket(), storage: memStore(),
    window: win, document: doc, minDelayMs: 20, maxDelayMs: 100, heartbeatMs: 100_000, pongTimeoutMs: 200, ...extra,
  });
  room.win = win; room.doc = doc;
  return room;
}
