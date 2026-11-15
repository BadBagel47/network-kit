// One room's logic, independent of Cloudflare so it can be tested in Node.
// The Durable Object adapter (durable-object.js) feeds it sockets, messages
// and alarms through a small "host" interface:
//
//   host.now()                         current time in ms
//   host.storage.get/put/delete/deleteAll
//   host.setAlarm(atMs | null)
//   host.sockets()                     all accepted sockets of this room
//   host.getAttachment(ws) / host.setAttachment(ws, value)
//   host.send(ws, text) / host.close(ws, code, reason)
//
// Everything that must survive hibernation lives in `this.state` (stored
// under the key "room") or in socket attachments. The latest full game state
// sent by the host (snapshot) is kept in memory and stored at most every
// `snapshotSaveMs`, and always when the host drops.

import { PROTOCOL, CLOSE } from '../shared/protocol.js';
import { newPlayerId, newSecret, randomSeed, sha256, sameSecret } from './random.js';

export const DEFAULT_OPTIONS = Object.freeze({
  mode: 'host', // 'host': a player's browser runs the game; 'server': rules run here
  limits: { player: 8, viewer: 4 },
  posts: [], // named posts on a shared ship, e.g. ['captain', 'gunner', 'engineer']
  access: 'open', // default room access: 'open' (code is enough) or 'private' (key needed)
  lateJoin: 'now', // default: 'now', 'next' (wait for the next safe point) or 'never'
  lateJoinChoices: ['now', 'next', 'never'], // what a host may choose for this game
  pauseBy: 'anyone', // who may pause and resume: 'anyone', 'host' or 'nobody'
  graceMs: 60_000, // how long a dropped player keeps the seat
  autoPauseMs: null, // pause automatically when a player has been away this long
  takeoverMs: 5_000, // host-run rooms: wait this long before another player takes over
  hostLeave: 'close', // host leaving on purpose: 'close' the room or 'handover'
  countdownMs: 3_000,
  cleanupMs: 24 * 60 * 60_000, // delete a room this long after the last player left
  closedKeepMs: 60 * 60_000, // keep a closed room's "closed" note this long
  snapshotSaveMs: 10_000,
  maxMessageBytes: 64 * 1024,
  maxSnapshotBytes: 512 * 1024,
  nameMaxLength: 24,
  rules: null, // server mode: the game's rules (see docs/INTEGRATION.md)
});

const ROLES = ['player', 'viewer'];
const HOST_COMMANDS = new Set([
  'start', 'end', 'admit', 'kick', 'renew', 'settings', 'assign', 'handover', 'close', 'host-ready',
]);

export function resolveOptions(options = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  merged.limits = { ...DEFAULT_OPTIONS.limits, ...(options.limits || {}) };
  if (!['host', 'server'].includes(merged.mode)) throw new Error(`network-kit: unknown mode "${merged.mode}"`);
  if (merged.mode === 'server' && !merged.rules) throw new Error('network-kit: server mode needs rules');
  return merged;
}

function cleanName(name, max) {
  const text = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return text.slice(0, max) || 'Player';
}

function byteLength(text) {
  return typeof text === 'string' ? new TextEncoder().encode(text).length : text.byteLength;
}

export class RoomCore {
  constructor(host, options) {
    this.host = host;
    this.options = resolveOptions(options);
    this.state = null;
    this.snapshot = null; // { d, at }
    this.snapshotSavedAt = 0;
    this.dirty = false;
    this.alarmAt = null;
  }

  // ---------------------------------------------------------------- storage

  async load() {
    this.state = (await this.host.storage.get('room')) ?? null;
    this.snapshot = (await this.host.storage.get('snapshot')) ?? null;
    this.alarmAt = this.state ? this.nextTimerAt() : null;
  }

  async flush() {
    if (this.dirty && this.state) {
      this.dirty = false;
      await this.host.storage.put('room', this.state);
    }
    const next = this.state ? this.nextTimerAt() : null;
    if (next !== this.alarmAt) {
      this.alarmAt = next;
      await this.host.setAlarm(next);
    }
  }

  async saveSnapshot() {
    if (!this.snapshot) return;
    this.snapshotSavedAt = this.host.now();
    await this.host.storage.put('snapshot', this.snapshot);
  }

  touch() {
    this.dirty = true;
  }

  // ----------------------------------------------------------------- timers

  nextTimerAt() {
    let next = null;
    for (const t of this.state.timers) if (next === null || t.at < next) next = t.at;
    return next;
  }

  setTimer(kind, delayMs, extra = {}) {
    this.clearTimer(kind, extra.id ?? extra.name);
    this.state.timers.push({ kind, at: this.host.now() + delayMs, ...extra });
    this.touch();
  }

  clearTimer(kind, key) {
    const before = this.state.timers.length;
    this.state.timers = this.state.timers.filter(
      (t) => !(t.kind === kind && (key === undefined || (t.id ?? t.name) === key)),
    );
    if (this.state.timers.length !== before) this.touch();
  }

  async alarm() {
    if (!this.state) return;
    const now = this.host.now();
    const due = this.state.timers.filter((t) => t.at <= now);
    this.state.timers = this.state.timers.filter((t) => t.at > now);
    this.alarmAt = null; // the platform cleared it by firing
    this.touch();
    for (const timer of due) {
      if (!this.state) break; // the room was deleted by an earlier timer
      await this.runTimer(timer);
    }
    if (this.state) await this.flush();
  }

  async runTimer(timer) {
    const s = this.state;
    switch (timer.kind) {
      case 'grace': {
        const p = s.players[timer.id];
        if (p && p.status === 'away') this.removePlayer(p, 'gone');
        break;
      }
      case 'autopause': {
        const p = s.players[timer.id];
        if (p && p.status === 'away' && !s.paused && this.inGame()) {
          s.paused = { reason: 'player-away', id: p.id, at: this.host.now() };
          this.broadcastRoom();
        }
        break;
      }
      case 'takeover': {
        const hostPlayer = s.players[s.hostId];
        if (!hostPlayer || hostPlayer.status === 'away') this.takeOver();
        break;
      }
      case 'cleanup': {
        if (this.liveSockets().length === 0) await this.deleteRoom();
        break;
      }
      case 'rules': {
        this.callRules('onTimer', timer.name);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ rooms

  async create(settings = {}, code) {
    if (this.state && !this.state.closed) return { error: 'exists' };
    const o = this.options;
    const access = settings.access === 'private' || settings.access === 'open' ? settings.access : o.access;
    const lateJoin = o.lateJoinChoices.includes(settings.lateJoin) ? settings.lateJoin : o.lateJoin;
    const now = this.host.now();
    this.state = {
      v: 1,
      code,
      createdAt: now,
      closed: null,
      settings: { access, lateJoin },
      hostKey: newSecret(),
      keys: { player: { k: newSecret(), exp: null }, viewer: { k: newSecret(), exp: null } },
      phase: 'lobby',
      round: 0,
      seed: null,
      startsAt: null,
      paused: null,
      hostId: null,
      hostEver: false,
      players: {},
      known: {},
      bans: [],
      timers: [],
      game: null,
    };
    this.snapshot = null;
    await this.host.storage.delete('snapshot');
    this.setTimer('cleanup', o.cleanupMs);
    if (o.mode === 'server') this.state.game = (this.callRules('init')) ?? null;
    this.touch();
    await this.flush();
    return { code, hostKey: this.state.hostKey, keys: this.publicKeys() };
  }

  info() {
    if (!this.state) return null;
    const players = Object.values(this.state.players);
    return {
      code: this.state.code,
      closed: Boolean(this.state.closed),
      phase: this.currentPhase(),
      access: this.state.settings.access,
      players: players.filter((p) => p.role === 'player').length,
      viewers: players.filter((p) => p.role === 'viewer').length,
    };
  }

  currentPhase() {
    const s = this.state;
    if (s.phase === 'countdown' && s.startsAt !== null && this.host.now() >= s.startsAt) return 'playing';
    return s.phase;
  }

  inGame() {
    const phase = this.currentPhase();
    return phase === 'countdown' || phase === 'playing';
  }

  publicKeys() {
    const { player, viewer } = this.state.keys;
    return { player: { ...player }, viewer: { ...viewer } };
  }

  async closeRoom(reason) {
    const s = this.state;
    s.closed = { reason, at: this.host.now() };
    s.timers = [];
    this.touch();
    const text = JSON.stringify({ t: 'closed', reason });
    for (const ws of this.liveSockets()) {
      this.host.send(ws, text);
      this.host.close(ws, CLOSE.ROOM_CLOSED, reason);
    }
    await this.host.storage.delete('snapshot');
    this.snapshot = null;
    this.setTimer('cleanup', this.options.closedKeepMs);
  }

  async deleteRoom() {
    for (const ws of this.liveSockets()) this.host.close(ws, CLOSE.ROOM_CLOSED, 'expired');
    this.state = null;
    this.snapshot = null;
    this.dirty = false;
    this.alarmAt = null;
    await this.host.storage.deleteAll();
    await this.host.setAlarm(null);
  }

  // ---------------------------------------------------------------- sockets

  liveSockets() {
    return this.host.sockets().filter((ws) => {
      const att = this.host.getAttachment(ws);
      return att && !att.closed;
    });
  }

  socketsOf(id) {
    return this.liveSockets().filter((ws) => this.host.getAttachment(ws)?.id === id);
  }

  sendTo(id, text) {
    for (const ws of this.socketsOf(id)) this.host.send(ws, text);
  }

  sendJson(ws, msg) {
    this.host.send(ws, JSON.stringify(msg));
  }

  /** A new WebSocket was accepted; it must send "hello" first. */
  opened(ws) {
    this.host.setAttachment(ws, { id: null, n: 0 });
    if (!this.state || this.state.closed) {
      const closed = this.state?.closed;
      if (closed) this.sendJson(ws, { t: 'closed', reason: closed.reason });
      this.host.close(ws, closed ? CLOSE.ROOM_CLOSED : CLOSE.NOT_FOUND, closed ? closed.reason : 'not-found');
      this.host.setAttachment(ws, { id: null, n: 0, closed: true });
    }
  }

  reject(ws, code, reason) {
    this.sendJson(ws, { t: 'denied', code, reason });
    this.host.setAttachment(ws, { ...(this.host.getAttachment(ws) || {}), closed: true });
    this.host.close(ws, code, reason);
  }

  async message(ws, raw) {
    if (!this.state || this.state.closed) return;
    const att = this.host.getAttachment(ws);
    if (!att || att.closed) return;
    const limit = this.options.maxSnapshotBytes;
    if (byteLength(raw) > limit) return this.sendJson(ws, { t: 'err', code: 'too-large' });
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.sendJson(ws, { t: 'err', code: 'bad-json' });
    }
    if (!msg || typeof msg !== 'object') return;
    if (!att.id) {
      if (msg.t !== 'hello') return this.reject(ws, CLOSE.BAD_REQUEST, 'hello-first');
      await this.hello(ws, msg);
      await this.flush();
      return;
    }
    const player = this.state.players[att.id];
    if (!player) return this.reject(ws, CLOSE.KICKED, 'not-in-room');

    // Duplicate protection: a numbered message resent after a glitch counts once.
    if (Number.isInteger(msg.n)) {
      if (msg.n <= att.n) return;
      att.n = msg.n;
      player.lastN = msg.n;
      this.host.setAttachment(ws, att);
    }

    if (msg.t === 'msg') {
      if (byteLength(raw) > this.options.maxMessageBytes) {
        return this.sendJson(ws, { t: 'err', code: 'too-large', n: msg.n });
      }
      await this.relay(player, msg);
    } else if (msg.t === 'snap') {
      this.storeSnapshot(player, msg);
    } else if (msg.t === 'cmd') {
      await this.command(ws, player, msg);
    }
    await this.flush();
  }

  async closed(ws) {
    const att = this.host.getAttachment(ws);
    if (!att || att.closed) return;
    att.closed = true;
    this.host.setAttachment(ws, att);
    if (!this.state || this.state.closed || !att.id) return;
    const p = this.state.players[att.id];
    if (p && att.n > (p.lastN ?? 0) && p.sid === att.sid) {
      p.lastN = att.n; // keep duplicate protection across hibernation
      this.touch();
    }
    if (p && this.socketsOf(p.id).length === 0) {
      if (p.id === this.state.hostId) await this.saveSnapshot();
      this.dropped(p);
    }
    if (this.state && this.liveSockets().length === 0) this.setTimer('cleanup', this.options.cleanupMs);
    if (this.state) await this.flush();
  }

  // ------------------------------------------------------------------ hello

  async hello(ws, msg) {
    const s = this.state;
    const o = this.options;
    if (msg.v !== PROTOCOL) return this.reject(ws, CLOSE.VERSION, 'version');
    if (typeof msg.pk !== 'string' || msg.pk.length < 16 || msg.pk.length > 128) {
      return this.reject(ws, CLOSE.BAD_REQUEST, 'player-key');
    }
    const pkh = await sha256(msg.pk);
    if (s.bans.includes(pkh)) return this.reject(ws, CLOSE.BANNED, 'banned');

    const name = cleanName(msg.name, o.nameMaxLength);
    const hostKeyOk = sameSecret(msg.hk, s.hostKey);
    const knownId = s.known[pkh];
    let player = knownId ? s.players[knownId] : null;
    let isNew = false;
    let cameBack = false;
    let reloaded = false;

    if (!player) {
      let keyRole = null;
      for (const role of ROLES) {
        const key = s.keys[role];
        if (sameSecret(msg.key, key.k)) {
          if (key.exp !== null && key.exp <= this.host.now()) return this.reject(ws, CLOSE.KEY, 'key-expired');
          keyRole = role;
        }
      }
      if (s.settings.access === 'private' && !hostKeyOk && !keyRole) {
        return this.reject(ws, CLOSE.KEY, msg.key ? 'key-invalid' : 'key-required');
      }
      let role = msg.role === 'viewer' ? 'viewer' : 'player';
      if (keyRole === 'viewer') role = 'viewer'; // a viewer link can never play
      if (hostKeyOk) role = 'player';
      const taken = Object.values(s.players).filter((p) => p.role === role).length;
      if (taken >= (o.limits[role] ?? 0)) return this.reject(ws, CLOSE.FULL, 'full');
      let waiting = false;
      if (role === 'player' && this.inGame() && !hostKeyOk) {
        if (s.settings.lateJoin === 'never') return this.reject(ws, CLOSE.IN_PROGRESS, 'in-progress');
        waiting = s.settings.lateJoin === 'next';
      }
      let id = knownId;
      if (!id) {
        do id = newPlayerId();
        while (s.players[id] || Object.values(s.known).includes(id));
      }
      player = {
        id, pkh, name, role, waiting, status: 'online', post: null,
        joinedAt: this.host.now(), awaySince: null, sid: msg.sid ?? null, lastN: 0,
      };
      s.players[id] = player;
      s.known[pkh] = id;
      isNew = true;
    } else {
      // The same player connected again: the newest connection wins.
      for (const other of this.socketsOf(player.id)) {
        if (other === ws) continue;
        const oatt = this.host.getAttachment(other);
        this.host.setAttachment(other, { ...oatt, closed: true });
        this.host.close(other, CLOSE.REPLACED, 'replaced');
      }
      cameBack = player.status === 'away';
      player.status = 'online';
      player.awaySince = null;
      player.name = name;
      if (player.sid !== (msg.sid ?? null)) {
        reloaded = true;
        player.sid = msg.sid ?? null;
        player.lastN = 0;
      }
      this.clearTimer('grace', player.id);
      this.clearTimer('autopause', player.id);
    }

    this.host.setAttachment(ws, { id: player.id, n: player.lastN, sid: player.sid });
    this.clearTimer('cleanup');
    this.touch();

    // Host role: the creator's host key claims a free host seat; otherwise a
    // host-run room makes sure some connected player runs the game.
    let becameHost = false;
    if (hostKeyOk && (!s.hostId || !s.players[s.hostId])) {
      s.hostId = player.id;
      s.hostEver = true;
      becameHost = true;
    }
    if (player.id === s.hostId) this.clearTimer('takeover');

    this.sendJson(ws, {
      t: 'welcome',
      you: { id: player.id, role: player.role },
      lastN: player.lastN,
      room: this.view(player.id),
    });

    if (isNew && !player.waiting) this.event('join', player.id);
    if (cameBack) this.event('back', player.id);
    if (isNew && player.waiting) this.event('waiting', player.id);

    const hostPlayer = s.players[s.hostId];
    if (o.mode === 'host' && s.hostEver && (!hostPlayer || hostPlayer.status === 'away')) {
      // The host is missing and no takeover is waiting: this player can run the game.
      const pending = s.timers.some((t) => t.kind === 'takeover');
      if (!pending && this.canHost(player)) this.takeOver();
    } else if (o.mode === 'host' && player.id === s.hostId && this.snapshot && (becameHost || reloaded)) {
      // The host's page reloaded (or the creator came back): continue from the latest state.
      this.sendJson(ws, { t: 'host', snapshot: this.snapshot.d });
    }

    this.broadcastRoom();
    if (o.mode === 'server') {
      if (isNew && !player.waiting) this.callRules('onJoin', this.rulesPlayer(player));
      if (cameBack) this.callRules('onBack', this.rulesPlayer(player));
    }
  }

  canHost(p) {
    return p && p.role === 'player' && !p.waiting && p.status === 'online';
  }

  dropped(p) {
    const s = this.state;
    const o = this.options;
    p.status = 'away';
    p.awaySince = this.host.now();
    this.setTimer('grace', o.graceMs, { id: p.id });
    if (o.autoPauseMs !== null && p.role === 'player' && !p.waiting && this.inGame()) {
      this.setTimer('autopause', o.autoPauseMs, { id: p.id });
    }
    if (p.id === s.hostId && o.mode === 'host') this.setTimer('takeover', o.takeoverMs);
    this.touch();
    this.event('drop', p.id);
    this.broadcastRoom();
    if (o.mode === 'server') this.callRules('onDrop', this.rulesPlayer(p));
  }

  removePlayer(p, why) {
    const s = this.state;
    delete s.players[p.id];
    this.clearTimer('grace', p.id);
    this.clearTimer('autopause', p.id);
    this.touch();
    this.event('gone', p.id, { why });
    if (p.id === s.hostId) {
      s.hostId = null;
      if (this.options.mode === 'host' || this.options.hostLeave === 'handover') this.takeOver();
    }
    this.broadcastRoom();
    if (this.options.mode === 'server') this.callRules('onGone', this.rulesPlayer(p));
  }

  /** Hand the host role to the longest-present connected player. */
  takeOver(preferId) {
    const s = this.state;
    this.clearTimer('takeover');
    const candidates = Object.values(s.players)
      .filter((p) => p.id !== s.hostId && this.canHost(p))
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const next = (preferId && candidates.find((p) => p.id === preferId)) || candidates[0];
    if (!next) return false; // nobody can host now; the next eligible player to connect will
    s.hostId = next.id;
    s.hostEver = true;
    this.touch();
    if (this.options.mode === 'host') {
      if (!s.paused && this.inGame()) s.paused = { reason: 'host-change', id: next.id, at: this.host.now() };
      this.sendTo(next.id, JSON.stringify({ t: 'host', snapshot: this.snapshot?.d ?? null }));
    }
    this.event('host', next.id);
    this.broadcastRoom();
    return true;
  }

  // ------------------------------------------------------------- broadcasts

  view(forId) {
    const s = this.state;
    const posts = {};
    for (const post of this.options.posts) posts[post] = null;
    const players = Object.values(s.players)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => {
        if (p.post) posts[p.post] = p.id;
        return { id: p.id, name: p.name, role: p.role, status: p.status, waiting: p.waiting, post: p.post };
      });
    const room = {
      code: s.code,
      mode: this.options.mode,
      phase: this.currentPhase(),
      round: s.round,
      seed: s.seed,
      startsAt: s.startsAt,
      now: this.host.now(),
      paused: s.paused,
      hostId: s.hostId,
      settings: { ...s.settings, pauseBy: this.options.pauseBy },
      limits: this.options.limits,
      posts,
      players,
    };
    if (forId && forId === s.hostId) {
      room.keys = this.publicKeys();
      room.hostKey = s.hostKey;
    }
    return room;
  }

  broadcastRoom() {
    if (!this.state || this.state.closed) return;
    const common = JSON.stringify({ t: 'room', room: this.view(null) });
    const hostText = JSON.stringify({ t: 'room', room: this.view(this.state.hostId) });
    for (const ws of this.liveSockets()) {
      const att = this.host.getAttachment(ws);
      if (!att.id) continue;
      this.host.send(ws, att.id === this.state.hostId ? hostText : common);
    }
  }

  event(e, id, extra = {}) {
    const text = JSON.stringify({ t: 'ev', e, id, ...extra });
    for (const ws of this.liveSockets()) if (this.host.getAttachment(ws).id) this.host.send(ws, text);
  }

  /** Resolve a `to` value into player ids. */
  targets(to, fromId) {
    const all = Object.values(this.state.players).filter((p) => p.status === 'online');
    if (Array.isArray(to)) return all.filter((p) => to.includes(p.id)).map((p) => p.id);
    const admitted = all.filter((p) => !p.waiting);
    switch (to ?? 'others') {
      case 'all': return admitted.map((p) => p.id);
      case 'players': return admitted.filter((p) => p.role === 'player').map((p) => p.id);
      case 'viewers': return admitted.filter((p) => p.role === 'viewer').map((p) => p.id);
      case 'host': return this.state.hostId ? [this.state.hostId] : [];
      case 'others':
      default: return admitted.filter((p) => p.id !== fromId).map((p) => p.id);
    }
  }

  // ------------------------------------------------------- relay, snapshots

  async relay(player, msg) {
    const s = this.state;
    if (this.options.mode === 'server') {
      if (player.waiting) return;
      this.callRules('onMessage', this.rulesPlayer(player), msg.d);
      return;
    }
    if (player.id === s.hostId) {
      const text = JSON.stringify({ t: 'msg', from: player.id, d: msg.d });
      for (const id of this.targets(msg.to, player.id)) this.sendTo(id, text);
    } else if (!player.waiting && s.hostId) {
      this.sendTo(s.hostId, JSON.stringify({ t: 'msg', from: player.id, d: msg.d }));
    }
  }

  storeSnapshot(player, msg) {
    if (this.options.mode !== 'host' || player.id !== this.state.hostId) return;
    this.snapshot = { d: msg.d, at: this.host.now() };
    if (msg.to !== undefined) {
      const text = JSON.stringify({ t: 'snap', from: player.id, d: msg.d });
      for (const id of this.targets(msg.to, player.id)) if (id !== player.id) this.sendTo(id, text);
    }
    if (this.host.now() - this.snapshotSavedAt >= this.options.snapshotSaveMs || this.state.paused) {
      return this.saveSnapshot();
    }
  }

  // --------------------------------------------------------------- commands

  async command(ws, player, msg) {
    const s = this.state;
    const o = this.options;
    const c = msg.c;
    const isHost = player.id === s.hostId;
    const fail = (code) => this.sendJson(ws, { t: 'err', code, c, n: msg.n });
    if (HOST_COMMANDS.has(c) && !isHost) return fail('host-only');

    switch (c) {
      case 'claim': {
        if (player.role !== 'player' || player.waiting) return fail('not-allowed');
        if (!o.posts.includes(msg.post)) return fail('no-such-post');
        const holder = Object.values(s.players).find((p) => p.post === msg.post);
        if (holder && holder.id !== player.id) return fail('post-taken');
        player.post = msg.post;
        break;
      }
      case 'release':
        player.post = null;
        break;
      case 'assign': {
        const target = s.players[msg.id];
        if (!target || target.role !== 'player') return fail('no-such-player');
        if (msg.post !== null && !o.posts.includes(msg.post)) return fail('no-such-post');
        if (msg.post !== null) {
          for (const p of Object.values(s.players)) if (p.post === msg.post) p.post = null;
        }
        target.post = msg.post;
        break;
      }
      case 'pause': {
        if (o.pauseBy === 'nobody' || (o.pauseBy === 'host' && !isHost)) return fail('not-allowed');
        if (s.paused) return;
        s.paused = { reason: 'player', id: player.id, at: this.host.now() };
        await this.saveSnapshot();
        break;
      }
      case 'resume': {
        if (o.pauseBy === 'nobody' || (o.pauseBy === 'host' && !isHost)) return fail('not-allowed');
        if (!s.paused) return;
        s.paused = null;
        break;
      }
      case 'host-ready':
        if (s.paused?.reason === 'host-change') s.paused = null;
        break;
      case 'start': {
        s.round += 1;
        s.seed = randomSeed();
        s.phase = 'countdown';
        s.startsAt = this.host.now() + o.countdownMs;
        s.paused = null;
        this.admitWaiting();
        if (o.mode === 'server') this.callRules('onStart');
        break;
      }
      case 'end':
        s.phase = 'ended';
        s.startsAt = null;
        if (o.mode === 'server') this.callRules('onEnd');
        break;
      case 'admit':
        this.admitWaiting();
        break;
      case 'kick': {
        const target = s.players[msg.id];
        if (!target || target.id === player.id) return fail('no-such-player');
        if (msg.ban) s.bans.push(target.pkh);
        for (const other of this.socketsOf(target.id)) {
          this.sendJson(other, { t: 'denied', code: msg.ban ? CLOSE.BANNED : CLOSE.KICKED, reason: msg.ban ? 'banned' : 'kicked' });
          this.host.setAttachment(other, { ...this.host.getAttachment(other), closed: true });
          this.host.close(other, msg.ban ? CLOSE.BANNED : CLOSE.KICKED, msg.ban ? 'banned' : 'kicked');
        }
        this.removePlayer(target, msg.ban ? 'banned' : 'kicked');
        break;
      }
      case 'renew': {
        if (!ROLES.includes(msg.role)) return fail('bad-role');
        const ttl = Number.isFinite(msg.ttlMs) && msg.ttlMs > 0 ? msg.ttlMs : null;
        s.keys[msg.role] = { k: newSecret(), exp: ttl === null ? null : this.host.now() + ttl };
        break;
      }
      case 'settings': {
        if (msg.access === 'open' || msg.access === 'private') s.settings.access = msg.access;
        if (o.lateJoinChoices.includes(msg.lateJoin)) s.settings.lateJoin = msg.lateJoin;
        break;
      }
      case 'handover': {
        const target = s.players[msg.id];
        if (!target || !this.canHost(target)) return fail('no-such-player');
        s.hostId = null;
        this.takeOver(target.id);
        break;
      }
      case 'leave': {
        this.sendJson(ws, { t: 'closed', reason: 'left' });
        for (const other of this.socketsOf(player.id)) {
          this.host.setAttachment(other, { ...this.host.getAttachment(other), closed: true });
          this.host.close(other, CLOSE.LEFT, 'left');
        }
        if (isHost && o.hostLeave === 'close') {
          await this.closeRoom('host-left');
          return;
        }
        this.removePlayer(player, 'left');
        if (this.liveSockets().length === 0) this.setTimer('cleanup', o.cleanupMs);
        return;
      }
      case 'close':
        await this.closeRoom('closed-by-host');
        return;
      default:
        return fail('unknown-command');
    }
    this.touch();
    this.broadcastRoom();
    if (msg.n !== undefined) this.sendJson(ws, { t: 'ok', c, n: msg.n });
  }

  admitWaiting() {
    for (const p of Object.values(this.state.players)) {
      if (!p.waiting) continue;
      p.waiting = false;
      this.event('join', p.id);
      if (this.options.mode === 'server') this.callRules('onJoin', this.rulesPlayer(p));
    }
    this.touch();
  }

  // ----------------------------------------------------- server-mode rules

  rulesPlayer(p) {
    return { id: p.id, name: p.name, role: p.role, post: p.post, status: p.status, waiting: p.waiting };
  }

  rulesRoom() {
    const core = this;
    const s = this.state;
    return {
      get code() { return s.code; },
      get phase() { return core.currentPhase(); },
      get round() { return s.round; },
      get seed() { return s.seed; },
      get hostId() { return s.hostId; },
      get players() { return Object.values(s.players).map((p) => core.rulesPlayer(p)); },
      get game() { return s.game; },
      set game(value) { s.game = value; core.touch(); },
      now: () => core.host.now(),
      save: () => core.touch(),
      send(to, data) {
        const text = JSON.stringify({ t: 'msg', from: null, d: data });
        for (const id of core.targets(to ?? 'all', null)) core.sendTo(id, text);
      },
      end() { s.phase = 'ended'; s.startsAt = null; core.touch(); core.broadcastRoom(); },
      admit: () => { core.admitWaiting(); core.broadcastRoom(); },
      setTimer: (name, ms) => core.setTimer('rules', ms, { name }),
      clearTimer: (name) => core.clearTimer('rules', name),
    };
  }

  // Rules hooks are synchronous so every change is stored with the message
  // that caused it.
  callRules(hook, ...args) {
    const fn = this.options.rules?.[hook];
    if (typeof fn !== 'function' || !this.state) return undefined;
    const result = fn(this.rulesRoom(), ...args);
    this.touch();
    return result;
  }
}
