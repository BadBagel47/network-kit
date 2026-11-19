// The admin page's settings and the games' budget, in one Durable Object
// (SQLite, Free plan). Games ask it through the admin Worker's GameApi
// entrypoint (a service binding), never over the internet.

import { CloudflareAnalytics } from './analytics.js';
import { normalizeSettings, budgetState, gameStatus, gameNotices, describeChanges, when, endedTimers, timerEndedText } from './control.js';

const BUDGET_EVERY_MS = 5 * 60_000;
// Game links (F-058, F-068): valid as long as the owner chooses (7 days unless
// chosen), from an hour to 90 days, and can be revoked.
const PASS_DEFAULT_HOURS = 7 * 24;
const PASS_MAX_HOURS = 90 * 24;
const PASS_KEEP_MS = 14 * 86_400_000; // links no longer active stay listed (folded) this long (owner 2026-11-18)
const PASS_USED_EVERY_MS = 60 * 60_000; // when a link was last used is stored at most hourly
const LOG_KEEP_MS = 90 * 86_400_000; // the owner's log is kept 90 days (owner 2026-11-18)
const LOG_MAX = 2_000;
const LOBBY_PREFIX = 'lb_'; // lobby tokens (F-059); the room server knows the same prefix
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hashText = async (text) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const MESSAGE_MAX = 20; // the owner's messages to players (F-066) kept at once
const MESSAGE_MIN_MS = 5 * 60_000;
const MESSAGE_MAX_MS = 7 * 86_400_000;
const SEEN_EVERY_MS = 60 * 60_000; // how often a game's last contact is stored (F-070)
const KEEP_DAYS = 7; // measurement summaries are kept a week (F-052)
const PER_DAY_MAX = 3_000;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const median = (list) => {
  const s = list.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** Connection quality per game over the kept days, from the summaries. */
export function quality(byGame) {
  const out = {};
  for (const [game, list] of Object.entries(byGame)) {
    const devices = {};
    for (const m of list) devices[`${m.device.kind} ${m.device.browser}`] = (devices[`${m.device.kind} ${m.device.browser}`] ?? 0) + 1;
    const sum = (k) => list.reduce((a, m) => a + (m.counts?.[k] ?? 0), 0);
    out[game] = {
      summaries: list.length,
      minutes: Math.round(list.reduce((a, m) => a + m.seconds, 0) / 60),
      rttP50: median(list.map((m) => m.rttMs?.p50)),
      rttP90: median(list.map((m) => m.rttMs?.p90)),
      hostGapP90: median(list.filter((m) => m.role !== 'host').map((m) => m.hostGapMs?.p90)),
      frameP50: median(list.map((m) => m.frameMs?.p50)),
      reconnects: sum('reconnects'),
      hostChanges: sum('hostChanges'),
      dropsSeen: sum('dropsSeen'),
      offlineP90: median(list.map((m) => m.offlineMs?.p90)),
      devices,
    };
  }
  return out;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export class AdminStore {
  constructor(state, env, deps = {}) {
    this.storage = state.storage;
    this.env = env;
    this.now = deps.now ?? Date.now;
    this.analytics = deps.analytics ?? null; // tests replace the Cloudflare API
  }

  async settings() {
    return normalizeSettings((await this.storage.get('settings')) ?? {}, this.now());
  }

  async budget() {
    return (await this.storage.get('budget')) ?? null;
  }

  /** Read today's use and work out who is over budget; kept for the games' checks. */
  async refreshBudget() {
    const token = this.env.CF_ANALYTICS_TOKEN;
    if (!token && !this.analytics) return null;
    const analytics = this.analytics ?? new CloudflareAnalytics({ token, accountId: this.env.CF_ACCOUNT_ID || null });
    const usage = await analytics.usage({ days: 31 });
    const budget = budgetState(await this.settings(), usage);
    await this.storage.put('budget', budget);
    return budget;
  }

  /** A timer that has run out gets one log line, at the time it ran out (B-088). */
  async logEndedTimers(settings) {
    for (const t of endedTimers(settings, this.now())) {
      const key = `timerlog:${t.game}:${t.mode ?? ''}`;
      if ((await this.storage.get(key)) === t.until) continue;
      await this.storage.put(key, t.until);
      await this.log(t.game, timerEndedText(t), 'settings', Date.parse(t.until));
    }
  }

  async status(game, mode = null) {
    const settings = await this.settings();
    await this.logEndedTimers(settings);
    const budget = await this.budget();
    const now = this.now();
    return { ...gameStatus(settings, budget, game, now, mode), notices: gameNotices(settings, budget, game, now, await this.messages(), mode) };
  }

  // ---- the owner's messages to players (F-066)

  async messages() {
    const now = this.now();
    const all = [...(await this.storage.list({ prefix: 'msg:' })).values()];
    const old = all.filter((m) => m.until <= now);
    if (old.length) await this.storage.delete(old.map((m) => `msg:${m.id}`));
    return all.filter((m) => m.until > now).sort((a, b) => a.created - b.created);
  }

  async addMessage({ game, text, minutes, level }) {
    const now = this.now();
    const ms = Math.min(MESSAGE_MAX_MS, Math.max(MESSAGE_MIN_MS, Math.round(Number(minutes) || 60) * 60_000));
    const message = {
      id: b64url(crypto.getRandomValues(new Uint8Array(6))),
      game,
      text: String(text).replace(/\s+/g, ' ').trim().slice(0, 300),
      level: level === 'warning' ? 'warning' : 'info',
      created: now,
      until: now + ms,
    };
    await this.storage.put(`msg:${message.id}`, message);
    return message;
  }

  // ---- admin passes (F-058): a personal link per game for the owner's devices

  // ---- the owner's log (F-074): kept 90 days

  async log(game, text, kind = 'settings', at = this.now()) {
    this.logSeq = ((this.logSeq ?? 0) + 1) % 1_000_000; // keeps the order of entries written in the same millisecond
    const id = `${String(at).padStart(15, '0')}-${String(this.logSeq).padStart(6, '0')}`;
    await this.storage.put(`log:${id}`, { at, game: game ?? null, text: String(text).slice(0, 300), kind });
  }

  /** Newest first; older than 90 days are deleted. */
  async logs(game = null) {
    const now = this.now();
    const entries = [...(await this.storage.list({ prefix: 'log:' })).entries()];
    const old = entries.filter(([, e]) => now - e.at > LOG_KEEP_MS).map(([k]) => k);
    if (old.length) await this.storage.delete(old);
    return entries
      .filter(([, e]) => now - e.at <= LOG_KEEP_MS && (!game || e.game === game))
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([, e]) => e)
      .slice(0, LOG_MAX);
  }

  // ---- lobbies (F-059): a room made ahead, with a host link and a guest link

  async lobbies() {
    const now = this.now();
    const all = [...(await this.storage.list({ prefix: 'lobby:' })).values()];
    const out = [];
    const gone = [];
    for (const l of all) {
      const endedAt = l.revoked ?? (l.expires <= now ? l.expires : null);
      if (endedAt !== null && now - endedAt > PASS_KEEP_MS) {
        gone.push(`lobby:${l.id}`);
        continue;
      }
      if (!l.revoked && l.expires <= now && !l.expiryLogged) {
        l.expiryLogged = true;
        await this.storage.put(`lobby:${l.id}`, l);
        await this.log(l.game, `Lobbyn ${l.label || l.id} gick ut (${l.game})`, 'lobby');
      }
      out.push({ ...l, state: l.revoked ? 'revoked' : l.expires <= now ? 'expired' : 'active' });
    }
    if (gone.length) await this.storage.delete(gone);
    return out.sort((a, b) => b.created - a.created);
  }

  async createLobby({ game, label, hours, page }) {
    const now = this.now();
    const id = b64url(crypto.getRandomValues(new Uint8Array(6)));
    const secret = () => b64url(crypto.getRandomValues(new Uint8Array(24)));
    const h = Math.min(PASS_MAX_HOURS, Math.max(1, Math.round(Number(hours) || 24)));
    let url = null;
    try {
      const u = new URL(String(page ?? ''));
      if (u.protocol === 'https:' || u.hostname === 'localhost') url = `${u.origin}${u.pathname}${u.search}`;
    } catch {
      url = null;
    }
    // Kept as they are, so the owner can copy the links again from the list.
    const lobby = {
      id, game, label: String(label ?? '').slice(0, 40), page: url, created: now, expires: now + h * 3_600_000,
      hostToken: `${LOBBY_PREFIX}${id}.${secret()}`, guestToken: `${LOBBY_PREFIX}${id}.${secret()}`, room: null,
    };
    await this.storage.put(`lobby:${id}`, lobby);
    await this.log(game, `Lobby skapad${lobby.label ? `: ${lobby.label}` : ''} för ${game}, gäller till ${when(new Date(lobby.expires).toISOString())}`, 'lobby');
    return lobby;
  }

  async revokeLobby(id) {
    const lobby = await this.storage.get(`lobby:${id}`);
    if (!lobby || lobby.revoked) return;
    lobby.revoked = this.now();
    await this.storage.put(`lobby:${id}`, lobby);
    await this.log(lobby.game, `Lobbyn ${lobby.label || lobby.id} återkallad (${lobby.game}); rummet stängs inom en minut`, 'lobby');
  }

  /** Which lobby and which link a token is, if the lobby is still open. */
  async lobbyFor(game, token) {
    const t = String(token ?? '');
    if (!t.startsWith(LOBBY_PREFIX)) return null;
    const id = t.slice(LOBBY_PREFIX.length).split('.')[0];
    const lobby = await this.storage.get(`lobby:${id}`);
    if (!lobby || lobby.game !== game || lobby.revoked || lobby.expires <= this.now()) return null;
    const role = t === lobby.hostToken ? 'host' : t === lobby.guestToken ? 'guest' : null;
    return role ? { lobby, role } : null;
  }

  /** Why a lobby link does not work (B-089): not-a-lobby, lobby-other-game, lobby-revoked or lobby-ended. */
  async lobbyProblem(game, token) {
    const t = String(token ?? '');
    const lobby = t.startsWith(LOBBY_PREFIX) ? await this.storage.get(`lobby:${t.slice(LOBBY_PREFIX.length).split('.')[0]}`) : null;
    if (!lobby || (t !== lobby.hostToken && t !== lobby.guestToken)) return 'not-a-lobby';
    if (lobby.game !== game) return 'lobby-other-game';
    if (lobby.revoked) return 'lobby-revoked';
    return 'lobby-ended';
  }

  // ---- game links (F-058, F-068)

  /**
   * Active links, and those no longer active (revoked or expired) for 14 days;
   * older ones are deleted. An expiry is written to the log once.
   */
  async passes() {
    const now = this.now();
    const all = [...(await this.storage.list({ prefix: 'pass:' })).values()];
    const out = [];
    const gone = [];
    for (const p of all) {
      const endedAt = p.revoked ?? (p.expires <= now ? p.expires : null);
      if (endedAt !== null && now - endedAt > PASS_KEEP_MS) {
        gone.push(`pass:${p.id}`);
        continue;
      }
      if (!p.revoked && p.expires <= now && !p.expiryLogged) {
        p.expiryLogged = true;
        await this.storage.put(`pass:${p.id}`, p);
        await this.log(p.game, `Spellänk ${p.label ? `till ${p.label} ` : ''}gick ut (${p.game})`, 'link');
      }
      out.push({ ...p, state: p.revoked ? 'revoked' : p.expires <= now ? 'expired' : 'active' });
    }
    if (gone.length) await this.storage.delete(gone);
    return out.sort((a, b) => b.created - a.created);
  }

  async revokePass(id) {
    const pass = await this.storage.get(`pass:${id}`);
    if (!pass || pass.revoked) return;
    pass.revoked = this.now();
    await this.storage.put(`pass:${id}`, pass);
    await this.log(pass.game, `Spellänk ${pass.label ? `till ${pass.label} ` : ''}återkallad (${pass.game})`, 'link');
  }

  async createPass(game, label, hours) {
    const id = b64url(crypto.getRandomValues(new Uint8Array(6)));
    const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const now = this.now();
    const h = Math.min(PASS_MAX_HOURS, Math.max(1, Math.round(Number(hours) || PASS_DEFAULT_HOURS)));
    const pass = { id, game, label: String(label ?? '').slice(0, 40), hash: await hashText(secret), created: now, expires: now + h * 3_600_000 };
    await this.storage.put(`pass:${id}`, pass);
    await this.log(game, `Spellänk skapad${pass.label ? ` till ${pass.label}` : ''} för ${game}, gäller till ${when(new Date(pass.expires).toISOString())}`, 'link');
    return { token: `${id}.${secret}`, pass: { ...pass, hash: undefined } };
  }

  async checkPass(game, token) {
    // A lobby's token is valid while its lobby is open (F-059); the room checks it.
    if (String(token ?? '').startsWith(LOBBY_PREFIX)) return Boolean(await this.lobbyFor(game, token));
    const [id, secret] = String(token ?? '').split('.');
    if (!id || !secret) return false;
    const pass = await this.storage.get(`pass:${id}`);
    const now = this.now();
    if (!pass || pass.game !== game || pass.revoked || pass.expires <= now) return false;
    if ((await hashText(secret)) !== pass.hash) return false;
    // When it was last used (F-074), stored at most hourly.
    if (now - (pass.lastUsed ?? 0) >= PASS_USED_EVERY_MS) {
      pass.lastUsed = now;
      await this.storage.put(`pass:${id}`, pass);
    }
    return true;
  }

  /**
   * A game asked the admin page (status, a game link or a measurement): it is
   * connected (F-070). Written at most once an hour per game.
   */
  async seen(game, version = null) {
    if (typeof game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(game)) return;
    // The network-kit version the game runs (F-074), stored when it changes.
    if (typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version)) {
      this.versionOf ??= new Map();
      if (this.versionOf.get(game) !== version) {
        if ((await this.storage.get(`ver:${game}`)) !== version) await this.storage.put(`ver:${game}`, version);
        this.versionOf.set(game, version);
      }
    }
    const now = this.now();
    this.seenAt ??= new Map();
    if (now - (this.seenAt.get(game) ?? 0) < SEEN_EVERY_MS) return;
    let stored = (await this.storage.get(`seen:${game}`)) ?? 0;
    if (now - stored >= SEEN_EVERY_MS) {
      stored = now;
      await this.storage.put(`seen:${game}`, now);
    }
    this.seenAt.set(game, stored);
  }

  /** game → the network-kit version it last reported. */
  async versions() {
    const out = {};
    for (const [key, v] of await this.storage.list({ prefix: 'ver:' })) out[key.slice(4)] = v;
    return out;
  }

  /** game → when it last asked the admin page. */
  async connected() {
    const out = {};
    for (const [key, at] of await this.storage.list({ prefix: 'seen:' })) out[key.slice(5)] = at;
    return out;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/log-add' && request.method === 'POST') {
      // Playtest's own store writes to the owner's log (F-095).
      const { game, text, kind } = await request.json().catch(() => ({}));
      if (typeof text === 'string' && text) await this.log(typeof game === 'string' ? game : null, text, typeof kind === 'string' ? kind : 'settings');
      return json({ ok: true });
    }
    if (url.pathname === '/settings' && request.method === 'GET') {
      await this.logEndedTimers(await this.settings());
      return json({ settings: await this.settings(), budget: await this.budget(), connected: await this.connected(), versions: await this.versions() });
    }
    if (url.pathname === '/settings' && request.method === 'PUT') {
      const before = await this.settings();
      await this.logEndedTimers(before);
      const settings = normalizeSettings(await request.json(), this.now());
      await this.storage.put('settings', settings);
      for (const change of describeChanges(before, settings, this.now())) await this.log(change.game, change.text);
      // Automatic closing reads the budget every 5 minutes while it is on.
      if (settings.account.autoClose) await this.storage.setAlarm(this.now() + 1_000);
      else await this.storage.deleteAlarm();
      return json({ settings, budget: await this.budget() });
    }
    if (url.pathname === '/measure' && request.method === 'POST') {
      // One anonymous summary from a game's page (already cleaned by the room server).
      const { game, summary } = await request.json();
      if (typeof game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(game) || !summary) return json({ error: 'bad' }, 400);
      await this.seen(game);
      const key = `m:${day(this.now())}:${game}`;
      const list = (await this.storage.get(key)) ?? [];
      if (list.length < PER_DAY_MAX) {
        list.push(summary);
        await this.storage.put(key, list);
      }
      await this.dropOldMeasurements();
      return json({ ok: true });
    }
    if (url.pathname === '/quality') {
      const byGame = {};
      for (const [key, list] of await this.storage.list({ prefix: 'm:' })) {
        const game = key.split(':')[2];
        (byGame[game] ??= []).push(...list);
      }
      return json({ days: KEEP_DAYS, quality: quality(byGame) });
    }
    if (url.pathname === '/lobbies' && request.method === 'GET') {
      const all = url.searchParams.get('all') === '1';
      return json((await this.lobbies()).filter((l) => all || l.state === 'active').map(({ expiryLogged, room, ...l }) => ({ ...l, code: room?.code ?? null })));
    }
    if (url.pathname === '/lobbies' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (typeof body?.game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(body.game)) return json({ error: 'bad-game' }, 400);
      if ((await this.lobbies()).filter((l) => l.state === 'active').length >= 30) return json({ error: 'too-many' }, 400);
      const { room, expiryLogged, ...lobby } = await this.createLobby(body);
      return json(lobby);
    }
    if (url.pathname.startsWith('/lobbies/') && request.method === 'DELETE') {
      await this.revokeLobby(url.pathname.slice('/lobbies/'.length));
      return json({ ok: true });
    }
    if (url.pathname === '/lobby-check' && request.method === 'POST') {
      // The game's Worker asks which lobby a link belongs to (GameApi.lobby).
      const { game, token } = await request.json().catch(() => ({}));
      await this.seen(game);
      const found = await this.lobbyFor(String(game), token);
      if (!found) return json({ error: await this.lobbyProblem(String(game), token) });
      return json({ id: found.lobby.id, role: found.role, expires: found.lobby.expires, room: found.lobby.room });
    }
    if (url.pathname === '/lobby-room' && request.method === 'POST') {
      // The game's Worker made the lobby's room; the first one stored wins.
      const { game, id, room } = await request.json().catch(() => ({}));
      const lobby = await this.storage.get(`lobby:${id}`);
      if (!lobby || lobby.game !== game) return json({ error: 'not-found' }, 404);
      if (!lobby.room && room?.code) {
        lobby.room = { code: String(room.code).slice(0, 16), ownerKey: String(room.ownerKey ?? ''), key: room.key ? String(room.key) : null };
        await this.storage.put(`lobby:${id}`, lobby);
        await this.log(game, `Lobbyn ${lobby.label || lobby.id} fick rummet ${lobby.room.code}`, 'lobby');
      }
      return json(lobby.room);
    }
    if (url.pathname === '/log' && request.method === 'GET') {
      await this.logEndedTimers(await this.settings());
      return json(await this.logs(url.searchParams.get('game') || null));
    }
    if (url.pathname === '/status') {
      await this.seen(url.searchParams.get('game'), url.searchParams.get('version'));
      return json(await this.status(url.searchParams.get('game') ?? '', url.searchParams.get('mode') || null));
    }
    if (url.pathname === '/passes' && request.method === 'GET') {
      // Active links by default; ?all=1 adds those no longer active (14 days).
      const all = url.searchParams.get('all') === '1';
      return json((await this.passes()).filter((p) => all || p.state === 'active').map(({ hash, expiryLogged, ...p }) => p));
    }
    if (url.pathname === '/passes' && request.method === 'POST') {
      const { game, label, hours } = await request.json();
      if (typeof game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(game)) return json({ error: 'bad-game' }, 400);
      if ((await this.passes()).length >= 50) return json({ error: 'too-many' }, 400);
      return json(await this.createPass(game, label, hours));
    }
    if (url.pathname.startsWith('/passes/') && request.method === 'DELETE') {
      await this.revokePass(url.pathname.slice('/passes/'.length));
      return json({ ok: true });
    }
    if (url.pathname === '/messages' && request.method === 'GET') {
      return json(await this.messages());
    }
    if (url.pathname === '/messages' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const game = body?.game;
      if (typeof game !== 'string' || !(game === '*' || /^[a-z0-9][a-z0-9-]{0,62}$/.test(game))) return json({ error: 'bad-game' }, 400);
      if (typeof body.text !== 'string' || !body.text.trim()) return json({ error: 'no-text' }, 400);
      if ((await this.messages()).length >= MESSAGE_MAX) return json({ error: 'too-many' }, 400);
      const message = await this.addMessage(body);
      await this.log(game === '*' ? null : game, `Meddelande till ${game === '*' ? 'alla spel' : game}: ${message.text}`, 'message');
      return json(message);
    }
    if (url.pathname.startsWith('/messages/') && request.method === 'DELETE') {
      const key = `msg:${url.pathname.slice('/messages/'.length)}`;
      const m = await this.storage.get(key);
      if (m) await this.log(m.game === '*' ? null : m.game, `Meddelande borttaget: ${m.text}`, 'message');
      await this.storage.delete(key);
      return json({ ok: true });
    }
    if (url.pathname === '/check-pass' && request.method === 'POST') {
      const { game, token } = await request.json();
      await this.seen(game);
      return json({ valid: await this.checkPass(String(game), token) });
    }
    return json({ error: 'not-found' }, 404);
  }

  /** Summaries older than a week are deleted. */
  async dropOldMeasurements() {
    const oldest = day(this.now() - (KEEP_DAYS - 1) * 86_400_000);
    const old = [...(await this.storage.list({ prefix: 'm:' })).keys()].filter((k) => k.split(':')[1] < oldest);
    if (old.length) await this.storage.delete(old);
  }

  async alarm() {
    const settings = await this.settings();
    if (!settings.account.autoClose) return;
    try {
      await this.refreshBudget();
    } finally {
      await this.storage.setAlarm(this.now() + BUDGET_EVERY_MS);
    }
  }
}
