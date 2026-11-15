// A fake Durable Object host for RoomCore: clock, storage, alarm, short
// in-memory timers and sockets.
import { RoomCore } from '../../src/server/room-core.js';

export class FakeSocket {
  constructor(name) {
    this.name = name;
    this.sent = [];
    this.closedWith = null;
    this.attachment = null;
    this.alive = true; // answers "check" like a living client; set false for a frozen one
    this.owesAnswer = false;
  }

  messages(type) {
    return this.sent.map((t) => JSON.parse(t)).filter((m) => !type || m.t === type);
  }

  last(type) {
    const list = this.messages(type);
    return list[list.length - 1];
  }

  /** The room as this client last saw it. */
  get room() {
    return this.messages().filter((m) => m.t === 'room' || m.t === 'welcome').pop()?.room;
  }

  clear() {
    this.sent = [];
  }
}

export class FakeWorld {
  constructor() {
    this.time = Date.UTC(2026, 0, 1, 12);
    this.store = new Map();
    this.puts = [];
    this.alarm = null;
    this.deferred = [];
    this.socketList = [];
  }

  host() {
    const world = this;
    return {
      env: { TEST: true },
      now: () => world.time,
      storage: {
        get: async (k) => structuredClone(world.store.get(k)),
        put: async (k, v) => {
          world.puts.push(k);
          world.store.set(k, structuredClone(v));
        },
        delete: async (k) => void world.store.delete(k),
        deleteAll: async () => void world.store.clear(),
      },
      setAlarm: async (at) => {
        world.alarm = at;
      },
      defer(ms, fn) {
        const entry = { at: world.time + ms, fn };
        world.deferred.push(entry);
        return () => {
          world.deferred = world.deferred.filter((d) => d !== entry);
        };
      },
      sockets: () => world.socketList.filter((ws) => !ws.closedWith),
      getAttachment: (ws) => ws.attachment,
      setAttachment: (ws, v) => {
        ws.attachment = structuredClone(v);
      },
      send: (ws, text) => {
        if (ws.closedWith) return;
        ws.sent.push(text);
        if (text === '{"t":"check"}' && ws.alive) ws.owesAnswer = true;
      },
      close: (ws, code, reason) => {
        ws.closedWith ??= { code, reason };
      },
    };
  }

  /** A fresh RoomCore that loads from storage. */
  async core(options) {
    this.options = options ?? this.options;
    const core = new RoomCore(this.host(), this.options);
    await core.load();
    this.current = core;
    return core;
  }

  /** The room goes to sleep: everything in memory is lost, storage and sockets stay. */
  async sleep() {
    this.deferred = [];
    return this.core();
  }

  /** Living clients answer a pending "are you there?" from the room. */
  async answerChecks() {
    for (const ws of this.socketList) {
      if (!ws.owesAnswer || ws.closedWith) continue;
      ws.owesAnswer = false;
      await this.current.message(ws, JSON.stringify({ t: 'cmd', c: 'alive' }));
    }
  }

  async advance(ms) {
    await this.answerChecks();
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
        await this.current.alarm();
      }
      await this.answerChecks();
    }
    this.time = end;
  }
}

let playerCounter = 0;

/** Connect a fake client and say hello. */
export async function connect(world, core, { name = 'P', pk, role, key, owner, sid = 's1' } = {}) {
  playerCounter += 1;
  const ws = new FakeSocket(name);
  world.socketList.push(ws);
  core.opened(ws);
  const playerKey = pk ?? `player-key-${playerCounter}-xxxxxxxxxxxx`;
  await core.message(ws, JSON.stringify({ t: 'hello', v: 2, pk: playerKey, sid, name, role, key, owner }));
  ws.id = ws.last('welcome')?.you.id ?? null;
  ws.pk = playerKey;
  return ws;
}

/** A raw connection that has not said hello. */
export function open(world, core, name = 'raw') {
  const ws = new FakeSocket(name);
  world.socketList.push(ws);
  core.opened(ws);
  return ws;
}

export async function send(core, ws, msg) {
  await core.message(ws, typeof msg === 'string' ? msg : JSON.stringify(msg));
}

let commandN = 1000;
/** Send a numbered command. */
export async function cmd(core, ws, c, args = {}) {
  commandN += 1;
  await send(core, ws, { t: 'cmd', n: commandN, c, ...args });
}

/** The socket dropped (network loss), as the runtime reports it. */
export async function drop(core, ws) {
  ws.closedWith ??= { code: 1006, reason: '' };
  await core.closed(ws);
}
