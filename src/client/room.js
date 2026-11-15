// Browser client for a network-kit room. Plain JavaScript, no build step,
// no dependencies; also runs in Node 22+ (used by the tests).
//
//   const room = await NetworkRoom.create('https://rooms.example.workers.dev', { name: 'Ada' });
//   room.on('message', ({ from, data }) => ...);
//   room.send({ fire: true });
//
// Connection recovery follows Buzzy's proven pattern: reconnect with a
// growing delay, react at once to network changes, the tab coming back and
// the browser going online, and a cheap heartbeat that the server answers
// without waking the room.

import { PROTOCOL, CLOSE, CLOSE_TEXT, FINAL_CLOSE_CODES, normalizeCode } from '../shared/protocol.js';

const memoryStore = new Map();
const memoryStorage = {
  getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
  setItem: (k, v) => memoryStore.set(k, String(v)),
  removeItem: (k) => memoryStore.delete(k),
};

function pickStorage(kind) {
  try {
    const store = globalThis[kind];
    if (store) {
      const probe = '__network_kit__';
      store.setItem(probe, '1');
      store.removeItem(probe);
      return store;
    }
  } catch {
    // storage blocked (private mode, sandbox)
  }
  return memoryStorage;
}

function randomKey(bytes = 18) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let out = '';
  for (const b of data) out += b.toString(16).padStart(2, '0');
  return out;
}

function apiBase(server, basePath) {
  return `${String(server).replace(/\/$/, '')}${basePath}`;
}

export class RoomError extends Error {
  constructor(code, reason, text) {
    super(text || CLOSE_TEXT[code] || reason || 'Could not reach the room.');
    this.code = code;
    this.reason = reason;
  }
}

export class NetworkRoom {
  /**
   * @param {object} o
   * @param {string} o.server  base URL of the game's room Worker
   * @param {string} o.code    room code
   * @param {string} [o.name]  nickname
   * @param {'player'|'viewer'} [o.role]
   * @param {string} [o.key]   invitation key from a share link
   * @param {string} [o.hostKey]
   * @param {'tab'|'device'} [o.identity] keep the player per tab (default) or per device
   * @param {{getItem, setItem, removeItem}} [o.storage] replaces sessionStorage/localStorage
   */
  constructor(o) {
    this.server = o.server;
    this.basePath = o.basePath ?? '/rooms';
    this.code = normalizeCode(o.code);
    this.name = o.name ?? 'Player';
    this.role = o.role ?? 'player';
    this.key = o.key ?? null;
    this.WebSocket = o.WebSocket ?? globalThis.WebSocket;
    this.win = o.window ?? (typeof window !== 'undefined' ? window : null);
    this.doc = o.document ?? (typeof document !== 'undefined' ? document : null);
    this.minDelayMs = o.minDelayMs ?? 500;
    this.maxDelayMs = o.maxDelayMs ?? 15_000;
    this.heartbeatMs = o.heartbeatMs ?? 20_000;
    this.pongTimeoutMs = o.pongTimeoutMs ?? 8_000;
    this.autoHostReady = o.autoHostReady ?? true;
    this.maxQueue = o.maxQueue ?? 500;

    // `storage` replaces both browser stores (tests, embedded views).
    const keyStore = o.storage ?? pickStorage(o.identity === 'device' ? 'localStorage' : 'sessionStorage');
    this.hostStore = o.storage ?? pickStorage('localStorage');
    this.playerKey = o.playerKey ?? keyStore.getItem('network-kit:player-key');
    if (!this.playerKey) {
      this.playerKey = randomKey();
      keyStore.setItem('network-kit:player-key', this.playerKey);
    }
    this.hostKeyName = `network-kit:host:${this.code}`;
    this.hostKey = o.hostKey ?? this.hostStore.getItem(this.hostKeyName);
    if (o.hostKey) this.hostStore.setItem(this.hostKeyName, o.hostKey);

    this.sid = randomKey(8); // one page session; resets duplicate protection on reload
    this.n = 0;
    this.queue = []; // numbered messages not yet confirmed by a welcome
    this.pendingSnapshot = null;
    this.listeners = new Map();
    this.status = 'idle';
    this.ws = null;
    this.me = null;
    this.room = null;
    this.clockOffset = 0;
    this.welcomed = false;
    this.stopped = false;
    this.attempt = 0;
    this.retryTimer = null;
    this.heartbeatTimer = null;
    this.pongTimer = null;
    this.hiddenAt = 0;
    this.wasHost = false;
    this.firstWelcome = null;
  }

  // -------------------------------------------------------------- creating

  /** Create a room and connect to it as its host. */
  static async create(server, options = {}) {
    const basePath = options.basePath ?? '/rooms';
    let res;
    try {
      res = await fetch(apiBase(server, basePath), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: options.settings ?? {} }),
      });
    } catch {
      throw new RoomError(0, 'network', 'Could not reach the server. Check your connection and try again.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const closed = body.error === 'game-closed';
      throw new RoomError(closed ? CLOSE.GAME_CLOSED : 0, body.error, closed ? CLOSE_TEXT[CLOSE.GAME_CLOSED] : null);
    }
    const room = new NetworkRoom({ ...options, server, code: body.code, hostKey: body.hostKey });
    room.keys = body.keys;
    await room.connect();
    return room;
  }

  /** Join an existing room. */
  static async join(server, options) {
    const room = new NetworkRoom({ ...options, server });
    await room.connect();
    return room;
  }

  /** Look up a room without joining: { code, phase, access, players, ... } or null. */
  static async info(server, code, { basePath = '/rooms' } = {}) {
    const res = await fetch(`${apiBase(server, basePath)}/${encodeURIComponent(normalizeCode(code))}`);
    if (res.status === 404) return null;
    const body = await res.json().catch(() => null);
    if (res.status === 410) return { ...body, closed: true };
    if (!res.ok) throw new RoomError(0, body?.error ?? 'network');
    return body;
  }

  // ---------------------------------------------------------------- events

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(type, detail) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      try {
        fn(detail);
      } catch (err) {
        console.error(`network-kit: "${type}" handler failed`, err);
      }
    }
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  // ------------------------------------------------------------ connection

  /** Connect; resolves on the first welcome, rejects if the room refuses. */
  connect() {
    if (this.firstWelcome) return this.firstWelcome.promise;
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.firstWelcome = { promise, resolve, reject, done: false };
    this.watch();
    this.open();
    return promise;
  }

  open() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.dropSocket();
    this.setStatus(this.welcomed ? 'reconnecting' : 'connecting');
    const url = `${apiBase(this.server, this.basePath)}/${this.code}/ws`.replace(/^http/, 'ws');
    let ws;
    try {
      ws = new this.WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    let denied = null;
    ws.onopen = () => {
      this.rawSend({
        t: 'hello', v: PROTOCOL, pk: this.playerKey, sid: this.sid,
        name: this.name, role: this.role, key: this.key, hk: this.hostKey,
      });
      this.startHeartbeat();
    };
    ws.onmessage = (event) => {
      if (event.data === 'pong') {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
        return;
      }
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.t === 'denied') denied = msg;
      this.handle(msg);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      const code = denied?.code ?? event.code;
      if (FINAL_CLOSE_CODES.has(code)) {
        this.finish(code, denied?.reason ?? event.reason);
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows and schedules the retry
    };
  }

  dropSocket() {
    const ws = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }

  scheduleRetry() {
    if (this.stopped) return;
    const offline = this.win?.navigator?.onLine === false || globalThis.navigator?.onLine === false;
    this.setStatus(offline ? 'offline' : this.welcomed ? 'reconnecting' : 'connecting');
    const base = Math.min(this.maxDelayMs, this.minDelayMs * 2 ** this.attempt);
    const delay = base * (0.75 + Math.random() * 0.5);
    this.attempt += 1;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  /** Reconnect now if the connection is not known to be healthy. */
  recover(force = false) {
    if (this.stopped) return;
    const open = this.ws && this.ws.readyState === 1;
    if (!open) {
      this.attempt = 0;
      this.open();
    } else if (force) {
      this.probe(3_000);
    }
  }

  /** Send a heartbeat and reconnect if no answer arrives in time. */
  probe(timeoutMs) {
    if (!this.ws || this.ws.readyState !== 1 || this.pongTimer) return;
    try {
      this.ws.send('ping');
    } catch {
      this.recover();
      return;
    }
    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      this.attempt = 0;
      this.open();
    }, timeoutMs);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.probe(this.pongTimeoutMs), this.heartbeatMs);
  }

  stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.pongTimer);
    this.heartbeatTimer = null;
    this.pongTimer = null;
  }

  watch() {
    const win = this.win;
    const doc = this.doc;
    if (!win) return;
    const online = () => this.recover(true);
    const offline = () => this.setStatus('offline');
    const visible = () => {
      if (doc.hidden) {
        this.hiddenAt = Date.now();
        return;
      }
      this.recover(Date.now() - this.hiddenAt > 15_000);
    };
    const shown = (event) => {
      if (event.persisted) this.recover(true);
    };
    const connection = win.navigator?.connection;
    win.addEventListener('online', online);
    win.addEventListener('offline', offline);
    win.addEventListener('pageshow', shown);
    doc?.addEventListener('visibilitychange', visible);
    connection?.addEventListener?.('change', online);
    this.unwatch = () => {
      win.removeEventListener('online', online);
      win.removeEventListener('offline', offline);
      win.removeEventListener('pageshow', shown);
      doc?.removeEventListener('visibilitychange', visible);
      connection?.removeEventListener?.('change', online);
    };
  }

  finish(code, reason) {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.dropSocket();
    this.unwatch?.();
    this.setStatus('closed');
    if (code === CLOSE.ROOM_CLOSED || code === CLOSE.KICKED || code === CLOSE.BANNED) {
      this.hostStore.removeItem(this.hostKeyName);
    }
    const detail = { code, reason, text: CLOSE_TEXT[code] ?? 'The connection was closed.' };
    if (this.firstWelcome && !this.firstWelcome.done) {
      this.firstWelcome.done = true;
      this.firstWelcome.reject(new RoomError(code, reason));
    }
    this.emit('closed', detail);
  }

  /** Stop without leaving: the seat is kept for the grace period. */
  disconnect() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.dropSocket();
    this.unwatch?.();
    this.setStatus('closed');
  }

  // -------------------------------------------------------------- incoming

  handle(msg) {
    switch (msg.t) {
      case 'welcome': {
        this.me = msg.you.id;
        this.role = msg.you.role;
        this.welcomed = true;
        this.attempt = 0;
        this.applyRoom(msg.room);
        // Resend what the room has not seen; it ignores anything already counted.
        this.queue = this.queue.filter((m) => m.n > msg.lastN);
        if (this.queue.length === 0 && this.n < msg.lastN) this.n = msg.lastN;
        for (const m of this.queue) this.ws.send(m.text);
        if (this.pendingSnapshot && this.isHost) {
          this.rawSend(this.pendingSnapshot);
          this.pendingSnapshot = null;
        }
        this.setStatus('online');
        this.emit('welcome', this.room);
        if (!this.firstWelcome.done) {
          this.firstWelcome.done = true;
          this.firstWelcome.resolve(this);
        }
        break;
      }
      case 'room':
        this.applyRoom(msg.room);
        break;
      case 'msg':
        this.emit('message', { from: msg.from, data: msg.d });
        break;
      case 'snap':
        this.emit('snapshot', { from: msg.from, data: msg.d });
        break;
      case 'host':
        this.emit('host', { snapshot: msg.snapshot });
        if (this.autoHostReady) this.command('host-ready');
        break;
      case 'ev':
        this.emit('peer', { event: msg.e, id: msg.id, why: msg.why, player: this.player(msg.id) });
        break;
      case 'ok':
        this.emit('ok', { command: msg.c, n: msg.n });
        break;
      case 'err':
        this.emit('error', { code: msg.code, command: msg.c, n: msg.n });
        break;
      case 'closed':
      case 'denied':
        break; // handled when the socket closes
    }
  }

  applyRoom(room) {
    if (room.keys) this.keys = room.keys;
    if (room.hostKey && room.hostKey !== this.hostKey) {
      this.hostKey = room.hostKey;
      this.hostStore.setItem(this.hostKeyName, room.hostKey);
    }
    this.clockOffset = room.now - Date.now();
    this.room = room;
    this.emit('room', room);
    const isHost = this.isHost;
    if (isHost !== this.wasHost) {
      this.wasHost = isHost;
      this.emit('role', { isHost });
    }
  }

  // --------------------------------------------------------------- queries

  get isHost() {
    return Boolean(this.room && this.me && this.room.hostId === this.me);
  }

  get players() {
    return this.room?.players ?? [];
  }

  player(id) {
    return this.players.find((p) => p.id === id) ?? null;
  }

  get self() {
    return this.player(this.me);
  }

  /** Server time in ms, for countdowns (room.startsAt). */
  serverNow() {
    return Date.now() + this.clockOffset;
  }

  // -------------------------------------------------------------- outgoing

  rawSend(msg) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try {
      this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  numbered(msg) {
    this.n += 1;
    const text = JSON.stringify({ ...msg, n: this.n });
    this.queue.push({ n: this.n, text });
    if (this.queue.length > this.maxQueue) this.queue.shift();
    if (this.welcomed && this.status === 'online') this.rawSend(text);
    return this.n;
  }

  /**
   * Send game data. Host-run rooms: from the host to `to` (default: everyone
   * else); from a player to the host. Server-run rooms: to the game rules.
   * `to`: 'others' | 'all' | 'players' | 'viewers' | [ids].
   * `reliable: false` drops the message while disconnected (for data that is
   * replaced by the next message anyway).
   */
  send(data, { to, reliable = true } = {}) {
    const msg = { t: 'msg', d: data };
    if (to !== undefined) msg.to = to;
    if (reliable) return this.numbered(msg);
    return this.welcomed && this.status === 'online' ? this.rawSend(msg) : false;
  }

  /**
   * Host only: send the full game state. The room keeps the latest one for
   * players who join or come back and for a new host after a takeover.
   * `to` also delivers it to those players now.
   */
  sendSnapshot(data, { to } = {}) {
    const msg = { t: 'snap', d: data };
    if (to !== undefined) msg.to = to;
    if (!this.rawSend(msg)) this.pendingSnapshot = msg;
  }

  command(c, args = {}) {
    return this.numbered({ t: 'cmd', c, ...args });
  }

  claimPost(post) { return this.command('claim', { post }); }
  releasePost() { return this.command('release'); }
  assignPost(id, post) { return this.command('assign', { id, post }); }
  pause() { return this.command('pause'); }
  resume() { return this.command('resume'); }
  start() { return this.command('start'); }
  end() { return this.command('end'); }
  admitWaiting() { return this.command('admit'); }
  kick(id, { ban = false } = {}) { return this.command('kick', { id, ban }); }
  renewKey(role, { ttlMs } = {}) { return this.command('renew', { role, ttlMs }); }
  setSettings(settings) { return this.command('settings', settings); }
  hostReady() { return this.command('host-ready'); }

  /** Host only: hand the game to another player. Sends `snapshot` first if given. */
  handover(id, snapshot) {
    if (snapshot !== undefined) this.sendSnapshot(snapshot);
    return this.command('handover', { id });
  }

  /** Leave on purpose. A host leaving closes the room unless the game hands over. */
  leave(snapshot) {
    if (snapshot !== undefined && this.isHost) this.sendSnapshot(snapshot);
    this.command('leave');
    this.hostStore.removeItem(this.hostKeyName);
  }

  /** Host only: close the room for everyone. */
  close() {
    return this.command('close');
  }

  /** Invitation keys (host only): { player: { k, exp }, viewer: { k, exp } }. */
  get inviteKeys() {
    return this.isHost ? this.keys ?? null : null;
  }
}
