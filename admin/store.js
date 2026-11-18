// The admin page's settings and the games' budget, in one Durable Object
// (SQLite, Free plan). Games ask it through the admin Worker's GameApi
// entrypoint (a service binding), never over the internet.

import { CloudflareAnalytics } from './analytics.js';
import { normalizeSettings, budgetState, gameStatus, gameNotices } from './control.js';

const BUDGET_EVERY_MS = 5 * 60_000;
// Game links (F-058, F-068): valid as long as the owner chooses (7 days unless
// chosen), from an hour to 90 days, and can be revoked.
const PASS_DEFAULT_HOURS = 7 * 24;
const PASS_MAX_HOURS = 90 * 24;
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

  async status(game, mode = null) {
    const settings = await this.settings();
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

  async passes() {
    const now = this.now();
    const all = [...(await this.storage.list({ prefix: 'pass:' })).values()];
    const expired = all.filter((p) => p.expires <= now);
    if (expired.length) await this.storage.delete(expired.map((p) => `pass:${p.id}`));
    return all.filter((p) => p.expires > now);
  }

  async createPass(game, label, hours) {
    const id = b64url(crypto.getRandomValues(new Uint8Array(6)));
    const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const now = this.now();
    const h = Math.min(PASS_MAX_HOURS, Math.max(1, Math.round(Number(hours) || PASS_DEFAULT_HOURS)));
    const pass = { id, game, label: String(label ?? '').slice(0, 40), hash: await hashText(secret), created: now, expires: now + h * 3_600_000 };
    await this.storage.put(`pass:${id}`, pass);
    return { token: `${id}.${secret}`, pass: { ...pass, hash: undefined } };
  }

  async checkPass(game, token) {
    const [id, secret] = String(token ?? '').split('.');
    if (!id || !secret) return false;
    const pass = await this.storage.get(`pass:${id}`);
    if (!pass || pass.game !== game || pass.expires <= this.now()) return false;
    return (await hashText(secret)) === pass.hash;
  }

  /**
   * A game asked the admin page (status, a game link or a measurement): it is
   * connected (F-070). Written at most once an hour per game.
   */
  async seen(game) {
    if (typeof game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(game)) return;
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

  /** game → when it last asked the admin page. */
  async connected() {
    const out = {};
    for (const [key, at] of await this.storage.list({ prefix: 'seen:' })) out[key.slice(5)] = at;
    return out;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/settings' && request.method === 'GET') {
      return json({ settings: await this.settings(), budget: await this.budget(), connected: await this.connected() });
    }
    if (url.pathname === '/settings' && request.method === 'PUT') {
      const settings = normalizeSettings(await request.json(), this.now());
      await this.storage.put('settings', settings);
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
    if (url.pathname === '/status') {
      await this.seen(url.searchParams.get('game'));
      return json(await this.status(url.searchParams.get('game') ?? '', url.searchParams.get('mode') || null));
    }
    if (url.pathname === '/passes' && request.method === 'GET') {
      return json((await this.passes()).map(({ hash, ...p }) => p));
    }
    if (url.pathname === '/passes' && request.method === 'POST') {
      const { game, label, hours } = await request.json();
      if (typeof game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(game)) return json({ error: 'bad-game' }, 400);
      if ((await this.passes()).length >= 50) return json({ error: 'too-many' }, 400);
      return json(await this.createPass(game, label, hours));
    }
    if (url.pathname.startsWith('/passes/') && request.method === 'DELETE') {
      await this.storage.delete(`pass:${url.pathname.slice('/passes/'.length)}`);
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
      return json(await this.addMessage(body));
    }
    if (url.pathname.startsWith('/messages/') && request.method === 'DELETE') {
      await this.storage.delete(`msg:${url.pathname.slice('/messages/'.length)}`);
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
