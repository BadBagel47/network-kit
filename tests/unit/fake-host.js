// A fake Durable Object host for RoomCore: clock, storage, alarm and sockets.
import { RoomCore } from '../../src/server/room-core.js';

export class FakeSocket {
  constructor(name) {
    this.name = name;
    this.sent = [];
    this.closedWith = null;
    this.attachment = null;
  }

  messages(type) {
    return this.sent.map((t) => JSON.parse(t)).filter((m) => !type || m.t === type);
  }

  last(type) {
    const list = this.messages(type);
    return list[list.length - 1];
  }

  clear() {
    this.sent = [];
  }
}

export class FakeWorld {
  constructor() {
    this.time = 1_000_000;
    this.store = new Map();
    this.alarm = null;
    this.socketList = [];
  }

  host() {
    const world = this;
    return {
      now: () => world.time,
      storage: {
        get: async (k) => structuredClone(world.store.get(k)),
        put: async (k, v) => void world.store.set(k, structuredClone(v)),
        delete: async (k) => void world.store.delete(k),
        deleteAll: async () => void world.store.clear(),
      },
      setAlarm: async (at) => {
        world.alarm = at;
      },
      sockets: () => world.socketList.filter((ws) => !ws.closedWith),
      getAttachment: (ws) => ws.attachment,
      setAttachment: (ws, v) => {
        ws.attachment = structuredClone(v);
      },
      send: (ws, text) => {
        if (!ws.closedWith) ws.sent.push(text);
      },
      close: (ws, code, reason) => {
        ws.closedWith ??= { code, reason };
      },
    };
  }

  /** Simulate hibernation: a fresh RoomCore that reloads from storage. */
  async core(options) {
    const core = new RoomCore(this.host(), options);
    await core.load();
    this.current = core;
    return core;
  }

  async advance(ms) {
    this.time += ms;
    while (this.alarm !== null && this.alarm <= this.time) {
      this.alarm = null;
      await this.current.alarm();
    }
  }
}

let playerCounter = 0;

/** Connect a fake client and say hello. */
export async function connect(world, core, { name = 'P', pk, role, key, hk, sid = 's1' } = {}) {
  playerCounter += 1;
  const ws = new FakeSocket(name);
  world.socketList.push(ws);
  core.opened(ws);
  const playerKey = pk ?? `player-key-${playerCounter}-xxxxxxxxxxxx`;
  await core.message(ws, JSON.stringify({ t: 'hello', v: 1, pk: playerKey, sid, name, role, key, hk }));
  ws.id = ws.last('welcome')?.you.id ?? null;
  ws.pk = playerKey;
  return ws;
}

export async function send(core, ws, msg) {
  await core.message(ws, JSON.stringify(msg));
}

/** The socket dropped (network loss), as the runtime reports it. */
export async function drop(core, ws) {
  ws.closedWith ??= { code: 1006, reason: '' };
  await core.closed(ws);
}
