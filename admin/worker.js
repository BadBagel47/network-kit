// network-kit admin page: usage per game against Cloudflare's free limits.
//   GET  /            the page (static, admin/public); it asks /api/usage
//   POST /login       password sign-in (form post, so password managers save it)
//   POST /logout      sign out
//   GET  /api/usage   usage per game and day, with each game's share, budget
//                     and status (signed in only)
//   GET/PUT /api/settings  on/off/until, private only, stop, shares, plan, cap,
//                     automatic closing (signed in only) (F-003, F-004, F-008)
//   GET/POST/DELETE /api/passes, /api/messages  game links (F-058, F-068) and
//                     messages to players (F-066) (signed in only)
//   GET  /api/log     the owner's log, 90 days (F-074) (signed in only)
//   GET/POST/DELETE /api/lobbies  lobbies with host and guest links (F-059) (signed in only)
//
// Games ask whether they are open through the GameApi entrypoint (entry.js),
// over a service binding.
//
// Secrets (set by .github/workflows/deploy-admin.yml): ADMIN_PASSWORD and
// CF_ANALYTICS_TOKEN (read-only Cloudflare token). Variable: CF_ACCOUNT_ID.

import { CloudflareAnalytics } from './analytics.js';
import { METRICS, LIMITS_CHECKED } from './limits.js';
import { budgetState, gameStatus, normalizeSettings } from './control.js';
import {
  LoginGuard, checkPassword, passwordConfigured, newSession, validSession,
  readCookie, sessionCookie, clearCookie,
} from './auth.js';

const CACHE_MS = 60_000;
let cache = null; // { at, data } per isolate: the page may be reloaded often

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const back = (location, headers = {}) => new Response(null, { status: 303, headers: { location, ...headers } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Posts must come from the page itself. */
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function guardFor(env, request) {
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const stub = env.GUARD.get(env.GUARD.idFromName(address));
  const call = async (action) => {
    const res = await stub.fetch(`https://guard/${action}`, { method: 'POST' });
    return Number(await res.text()) || 0;
  };
  return { waitMs: () => call('wait'), failed: () => call('failed'), succeeded: () => call('succeeded') };
}

async function login(request, env) {
  if (!passwordConfigured(env)) return back('/?error=notset');
  const guard = guardFor(env, request);
  const wait = await guard.waitMs();
  if (wait > 0) return back(`/?error=wait&s=${Math.ceil(wait / 1000)}`);
  const form = await request.formData().catch(() => null);
  if (await checkPassword(env, form?.get('password'))) {
    await guard.succeeded();
    return back('/', { 'set-cookie': sessionCookie(await newSession(env)) });
  }
  const next = await guard.failed();
  await sleep(500);
  return back(next > 0 ? `/?error=wait&s=${Math.ceil(next / 1000)}` : '/?error=wrong');
}

async function usage(env, deps) {
  if (!env.CF_ANALYTICS_TOKEN) {
    return { error: 'no-token', metrics: METRICS, limitsChecked: LIMITS_CHECKED };
  }
  const now = deps.now();
  if (cache && now - cache.at < CACHE_MS) return cache.data;
  const analytics = new CloudflareAnalytics({
    token: env.CF_ANALYTICS_TOKEN,
    accountId: env.CF_ACCOUNT_ID || null,
    fetch: deps.fetch,
    now: deps.now,
  });
  const data = { ...(await analytics.usage({ days: 31 })), metrics: METRICS, limitsChecked: LIMITS_CHECKED };
  cache = { at: now, data };
  return data;
}

function store(env) {
  return env.STORE ? env.STORE.get(env.STORE.idFromName('main')) : null;
}

async function readSettings(env) {
  const s = store(env);
  if (!s) return { settings: normalizeSettings({}), budget: null };
  return (await s.fetch('https://store/settings')).json();
}

/** The usage with each game's share, budget and status as the games see it. */
async function usageWithControl(env, deps) {
  const data = await usage(env, deps);
  if (data.error) return data;
  const { settings, connected = {}, versions = {} } = await readSettings(env);
  const budget = budgetState(settings, data);
  const now = deps.now();
  // What each game and each of its modes says now, and when a running timer ends (F-067).
  const one = (n, m) => {
    const entry = m ? settings.games[n]?.modes?.[m] : settings.games[n];
    const st = gameStatus(settings, budget, n, now, m);
    const timerUntil = st.open && entry?.mode === 'timer' && entry.timer && Date.parse(entry.timer.until) > now ? entry.timer.until : null;
    return { ...st, timerUntil };
  };
  const status = Object.fromEntries(
    [...new Set([...data.games.map((g) => g.name), ...Object.keys(settings.games)])].map((n) => [n, {
      ...one(n, null),
      modes: Object.fromEntries(Object.keys(settings.games[n]?.modes ?? {}).map((m) => [m, one(n, m)])),
    }]),
  );
  return { ...data, control: { settings, budget, status, connected, versions } };
}

/** The request handler; `deps` lets tests replace the clock and the network. */
export async function handle(request, env, deps = { fetch: (...a) => fetch(...a), now: Date.now }) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === 'POST' && (pathname === '/login' || pathname === '/logout')) {
    if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
    if (pathname === '/logout') return back('/', { 'set-cookie': clearCookie() });
    return login(request, env);
  }
  if (pathname === '/api/usage') {
    if (!(await validSession(env, readCookie(request)))) {
      return json({ error: 'signed-out', passwordSet: passwordConfigured(env) }, 401);
    }
    try {
      return json(await usageWithControl(env, deps));
    } catch (e) {
      return json({ error: 'analytics', message: String(e.message ?? e), metrics: METRICS, limitsChecked: LIMITS_CHECKED }, 502);
    }
  }
  if (pathname === '/api/quality') {
    if (!(await validSession(env, readCookie(request)))) return json({ error: 'signed-out' }, 401);
    const s = store(env);
    if (!s) return json({ days: 7, quality: {} });
    return json(await (await s.fetch('https://store/quality')).json());
  }
  const listApi = ['/api/passes', '/api/messages', '/api/log', '/api/lobbies'].find((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (listApi) {
    // The owner's personal links per game (F-058) and messages to players (F-066).
    if (!(await validSession(env, readCookie(request)))) return json({ error: 'signed-out' }, 401);
    if (request.method !== 'GET' && !sameOrigin(request)) return new Response('Forbidden', { status: 403 });
    const s = store(env);
    if (!s) return json({ error: 'no-store' }, 500);
    if (listApi === '/api/log' && request.method !== 'GET') return json({ error: 'method' }, 405);
    const rest = pathname.slice('/api'.length) + url.search;
    const res = await s.fetch(`https://store${rest}`, {
      method: request.method,
      body: request.method === 'POST' ? (await request.text()).slice(0, 2048) : undefined,
    });
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (pathname === '/api/settings') {
    if (!(await validSession(env, readCookie(request)))) return json({ error: 'signed-out' }, 401);
    if (request.method === 'GET') return json(await readSettings(env));
    if (request.method === 'PUT') {
      if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
      const s = store(env);
      if (!s) return json({ error: 'no-store' }, 500);
      const body = await request.text();
      if (body.length > 32 * 1024) return json({ error: 'too-large' }, 413);
      return new Response((await s.fetch('https://store/settings', { method: 'PUT', body })).body, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return json({ error: 'method' }, 405);
  }
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response('Not found', { status: 404 });
}

export function resetCache() {
  cache = null;
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};

/** One per address: counts wrong passwords (see LoginGuard). */
export class AdminGuard {
  constructor(state) {
    this.storage = state.storage;
    this.guard = new LoginGuard(state.storage);
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    let result = 0;
    if (action === 'wait') result = await this.guard.waitMs();
    else if (action === 'failed') {
      result = await this.guard.failed();
      // The record about this address is deleted a day after the last wrong password (B-055).
      await this.storage.setAlarm(Date.now() + 86_400_000 + 60_000);
    } else if (action === 'succeeded') {
      await this.guard.succeeded();
      await this.storage.deleteAlarm?.();
    } else return new Response('Not found', { status: 404 });
    return new Response(String(result));
  }

  async alarm() {
    await this.storage.deleteAll();
  }
}
