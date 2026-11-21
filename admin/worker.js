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
//   GET  /api/control settings and the games' status without Cloudflare's figures, fast (F-078)
//   GET/POST/DELETE /api/lobbies  lobbies with host and guest links (F-059) (signed in only)
//   GET/POST/DELETE /api/testers, /api/reports  Playtest tester links and reports (F-091) (signed in only)
//   GET/POST/DELETE /api/open-tests            Open test per game (F-118) (signed in only)
//   POST /playtest/check, /playtest/report, /playtest/image, /playtest/upload-key  from a
//                     tester's browser on any site (CORS), with the tester link's token (F-091),
//                     or for pictures an upload key for Playtest Remote (B-094)
//   POST /playtest/v1/record  Playtest Recorder's batches from a tester's browser (F-092)
//   GET  /playtest/read, POST /playtest/keep  the agent's workflow, with PLAYTEST_READ_KEY
//        (also read-image, read-recordings, read-recording)
//
// Games ask whether they are open through the GameApi entrypoint (entry.js),
// over a service binding.
//
// Secrets (set by .github/workflows/deploy-admin.yml): ADMIN_PASSWORD and
// CF_ANALYTICS_TOKEN (read-only Cloudflare token). Variable: CF_ACCOUNT_ID.

import { CloudflareAnalytics, forgetShapes } from './analytics.js';
import { METRICS, LIMITS_CHECKED } from './limits.js';
import { budgetState, gameStatus, normalizeSettings } from './control.js';
import { createRoomServer } from '../src/server/worker.js';
import { visitorKey } from '../src/shared/visitor.js';
import {
  LoginGuard, checkPassword, passwordConfigured, newSession, validSession,
  readCookie, sessionCookie, clearCookie, DEVICE_COOKIE, newDeviceMark, knownDevice, deviceCookie,
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

// Playtest (F-091): a tester's browser on any site may send reports.
const PLAYTEST_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-playtest-token',
  'access-control-max-age': '86400',
};
const REPORT_MAX_BYTES = 64 * 1024;

// Playtest Remote (F-091): a small room per pairing. The game page that opened
// it is its owner and host ('screen'); remotes join with the short code alone
// (a phone, a tablet or a computer) and send to the host only. Rooms close an
// hour after every page was hidden and are deleted two hours after the last left.
export const playtestRooms = createRoomServer({
  binding: 'PLAYTEST_ROOMS',
  basePath: '/playtest/rooms',
  codeLength: 6,
  jurisdiction: (env) => env.ROOM_JURISDICTION || null,
  mode: 'host',
  roles: {
    screen: { seats: 1, plays: true, canHost: true, needsKey: true },
    remote: { seats: 4, plays: false, sends: true, canPause: false, needsKey: false },
  },
  ownerRole: 'screen',
  ownerLeave: 'close',
  cleanupMs: 2 * 60 * 60_000,
});

const IMAGE_MAX_BYTES = 400 * 1024;
const PER_MINUTE = 60; // playtest requests per address and minute (per isolate)
let hits = new Map();
let hitsMinute = 0;
function tooMany(request, now) {
  const minute = Math.floor(now / 60_000);
  if (minute !== hitsMinute) {
    hits = new Map();
    hitsMinute = minute;
  }
  const who = visitorKey(request.headers.get('cf-connecting-ip'));
  const n = (hits.get(who) ?? 0) + 1;
  hits.set(who, n);
  return n > PER_MINUTE;
}

const sameKey = async (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i += 1) diff |= u[i] ^ v[i];
  return diff === 0;
};

/**
 * Playtest Remote's rooms: only a browser with a working tester link may open
 * one (its token goes as the room's admin pass); joining needs the code.
 */
async function playtestRoom(request, env) {
  if (!env.PLAYTEST_ROOMS) return json({ error: 'no-rooms' }, 404);
  const url = new URL(request.url);
  // Only the checked path may make a room (B-097): a doubled slash or any
  // other POST under the rooms' path is refused, never passed on.
  if (url.pathname.includes('//')) return json({ error: 'not-found' }, 404, PLAYTEST_CORS);
  if (request.method === 'POST' && url.pathname !== '/playtest/rooms') {
    return json({ error: 'not-found' }, 404, PLAYTEST_CORS);
  }
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 4096) return json({ error: 'too-large' }, 413, PLAYTEST_CORS);
    let token = '';
    try {
      token = String(JSON.parse(text)?.adminPass ?? '');
    } catch {
      token = '';
    }
    const s = playtestStore(env);
    const checked = s && (await s.fetch('https://store/playtest/check', { method: 'POST', body: JSON.stringify({ token }) }));
    // Playtest Remote needs a tester link; an Open test token makes no room (F-118).
    const ok = checked?.ok && !(await checked.json()).open;
    if (!ok) return json({ error: 'no-tester' }, 401, { ...PLAYTEST_CORS, 'access-control-allow-origin': request.headers.get('origin') ?? '*', vary: 'origin' });
    return playtestRooms.fetch(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ settings: { access: 'open' } }) }), env);
  }
  return playtestRooms.fetch(request, env);
}

/** Playtest paths that do not need the owner's sign-in: testers' browsers and the agent's workflow. */
async function playtestPublic(request, env, deps) {
  const url = new URL(request.url);
  const s = playtestStore(env);
  const cors = (res) => {
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(PLAYTEST_CORS)) headers.set(k, v);
    headers.set('cache-control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PLAYTEST_CORS });
  if (!s) return cors(json({ error: 'no-store' }, 500));
  // The paths carry a version (F-103). The unversioned ones of 0.14 were removed
  // in 0.17 (F-114): no game took 0.14 (docs/DEPRECATIONS.md).
  if (!url.pathname.startsWith('/playtest/v1/')) return cors(json({ error: 'not-found' }, 404));
  // The store needs the page's origin and the visitor for Open test (B-123): an empty origin
  // never matches a test's page; tester links do not look at either.
  const who = { 'x-nk-origin': request.headers.get('origin') ?? '', 'x-nk-visitor': visitorKey(request.headers.get('cf-connecting-ip')) };
  const path = url.pathname.replace(/^\/playtest\/v1\//, '/playtest/');
  if (path === '/playtest/read' || path === '/playtest/keep' || path === '/playtest/read-image' || path === '/playtest/read-recordings' || path === '/playtest/read-recording') {
    // The agent's workflow (playtest-reports.yml), with the key the deploy derives.
    if (!(await sameKey(request.headers.get('x-playtest-key'), env.PLAYTEST_READ_KEY))) {
      // Wrong keys count against the per-address brake (D-140); the right one is never braked.
      if (tooMany(request, deps.now())) return json({ error: 'too-many' }, 429);
      return json({ error: 'forbidden' }, 403);
    }
    if (path === '/playtest/keep' && request.method === 'POST') {
      const { ids = [], keep = true } = await request.json().catch(() => ({}));
      const out = {};
      for (const id of [].concat(ids).slice(0, 100)) {
        out[id] = await (await s.fetch(`https://store/reports/${encodeURIComponent(id)}/keep`, { method: 'POST', body: JSON.stringify({ keep }) })).json();
      }
      return json(out);
    }
    if (path === '/playtest/read-recordings') {
      const q = new URLSearchParams({ game: url.searchParams.get('game') ?? '', since: url.searchParams.get('since') ?? '0' });
      return json(await (await s.fetch(`https://store/recordings?${q}`)).json());
    }
    if (path === '/playtest/read-recording') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return json({ error: 'bad-id' }, 400);
      const res = await s.fetch(`https://store/recordings/${id}`);
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (path === '/playtest/read-image') {
      // One picture at a time (B-099): the reading never holds them all.
      const id = url.searchParams.get('id') ?? '';
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return json({ error: 'bad-id' }, 400);
      const res = await s.fetch(`https://store/reports/image/${id}`);
      return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' } });
    }
    const q = new URLSearchParams({ game: url.searchParams.get('game') ?? '', since: url.searchParams.get('since') ?? '0' });
    const reports = await (await s.fetch(`https://store/reports?${q}`)).json();
    return json(reports);
  }
  if (request.method !== 'POST') return cors(json({ error: 'method' }, 405));
  if (tooMany(request, deps.now())) return cors(json({ error: 'too-many' }, 429));
  if (path === '/playtest/image') {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > IMAGE_MAX_BYTES) return cors(json({ error: 'too-large' }, 413));
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > IMAGE_MAX_BYTES) return cors(json({ error: 'too-large' }, 413));
    // The token in a header keeps it out of logs of addresses (D-111); copies up to 0.16 send it in the query.
    const token = request.headers.get('x-playtest-token') ?? url.searchParams.get('token') ?? '';
    return cors(await s.fetch(`https://store/playtest/image?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': request.headers.get('content-type') ?? '', ...who }, body: bytes,
    }));
  }
  if (path === '/playtest/record') {
    // Playtest Recorder's batches (F-092); a page that closes sends its last one with sendBeacon.
    const body = await request.text();
    if (body.length > 128 * 1024) return cors(json({ error: 'too-large' }, 413));
    return cors(await s.fetch('https://store/playtest/record', { method: 'POST', headers: who, body }));
  }
  if (path === '/playtest/open') {
    // Open test (F-118): a page with ?record=<key> or ?report=<key> asks whether its game's
    // test is on; the key from its address and the browser's Origin must both match (B-123).
    const text = await request.text();
    if (text.length > 1024) return cors(json({ error: 'too-large' }, 413));
    let key = '';
    try {
      key = String(JSON.parse(text || '{}')?.key ?? '').slice(0, 40);
    } catch {
      key = '';
    }
    return cors(await s.fetch('https://store/playtest/open', { method: 'POST', body: JSON.stringify({ origin: who['x-nk-origin'], key }) }));
  }
  if (path === '/playtest/check' || path === '/playtest/report' || path === '/playtest/upload-key') {
    const body = await request.text();
    if (body.length > REPORT_MAX_BYTES) return cors(json({ error: 'too-large' }, 413));
    return cors(await s.fetch(`https://store${path}`, { method: 'POST', headers: who, body }));
  }
  return cors(json({ error: 'not-found' }, 404));
}

/** Posts must come from the page itself. */
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

// All wrong passwords together, from every address (F-101): a flood from many
// addresses slows down, and makes no new guard per address while it lasts.
export const ALL_ADDRESSES = 'all-addresses';

function guardFor(env, request, name = null) {
  const address = name ?? visitorKey(request.headers.get('cf-connecting-ip'));
  const stub = env.GUARD.get(env.GUARD.idFromName(address));
  const call = async (action) => {
    const res = await stub.fetch(`https://guard/${action}${name === ALL_ADDRESSES ? '?all=1' : ''}`, { method: 'POST' });
    return Number(await res.text()) || 0;
  };
  return { waitMs: () => call('wait'), failed: () => call('failed'), succeeded: () => call('succeeded') };
}

async function login(request, env) {
  if (!passwordConfigured(env)) return back('/?error=notset');
  // A device that signed in before is not held up by the brake for all addresses (F-101).
  const known = await knownDevice(env, readCookie(request, DEVICE_COOKIE));
  const all = guardFor(env, request, ALL_ADDRESSES);
  if (!known) {
    const waitAll = await all.waitMs();
    if (waitAll > 0) return back(`/?error=wait&s=${Math.ceil(waitAll / 1000)}`);
  }
  const guard = guardFor(env, request);
  const wait = await guard.waitMs();
  if (wait > 0) return back(`/?error=wait&s=${Math.ceil(wait / 1000)}`);
  const form = await request.formData().catch(() => null);
  if (await checkPassword(env, form?.get('password'))) {
    await guard.succeeded();
    const headers = new Headers({ location: '/' });
    headers.append('set-cookie', sessionCookie(await newSession(env)));
    if (!known) headers.append('set-cookie', deviceCookie(await newDeviceMark(env)));
    return new Response(null, { status: 303, headers });
  }
  const next = await guard.failed();
  await all.failed();
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
    keep: true, // the datasets' fields are asked once a day (F-078)
  });
  const data = { ...(await analytics.usage({ days: 31 })), metrics: METRICS, limitsChecked: LIMITS_CHECKED };
  cache = { at: now, data };
  return data;
}

function store(env) {
  return env.STORE ? env.STORE.get(env.STORE.idFromName('main')) : null;
}

/** Playtest's own store (F-095): reports and pictures never slow the games' status checks. */
function playtestStore(env) {
  return env.PLAYTEST ? env.PLAYTEST.get(env.PLAYTEST.idFromName('main')) : null;
}

async function readSettings(env) {
  const s = store(env);
  if (!s) return { settings: normalizeSettings({}), budget: null };
  return (await s.fetch('https://store/settings')).json();
}

/** Each game's and mode's status as the games see it, with the settings (F-067). */
function controlOf({ settings, rev = 0, budget, connected = {}, versions = {}, roomsRefused = {} }, names, now) {
  // What each game and each of its modes says now, and when a running timer ends (F-067).
  const one = (n, m) => {
    const entry = m ? settings.games[n]?.modes?.[m] : settings.games[n];
    const st = gameStatus(settings, budget, n, now, m);
    const timerUntil = st.open && entry?.mode === 'timer' && entry.timer && Date.parse(entry.timer.until) > now ? entry.timer.until : null;
    return { ...st, timerUntil };
  };
  const status = Object.fromEntries(
    [...new Set([...names, ...Object.keys(settings.games)])].map((n) => [n, {
      ...one(n, null),
      modes: Object.fromEntries(Object.keys(settings.games[n]?.modes ?? {}).map((m) => [m, one(n, m)])),
    }]),
  );
  return { settings, rev, budget, status, connected, versions, roomsRefused };
}

/**
 * The settings and the games' status without asking Cloudflare: fast, so the
 * page can show the game cards at once (F-078). The budget is the one the
 * admin page last worked out (Cloudflare limiting), or none.
 */
async function controlOnly(env, deps) {
  const stored = await readSettings(env);
  const budget = stored.budget ?? { share: {}, over: {}, near: {}, warnings: [], cost: { usd: 0, lines: [], note: '' } };
  return controlOf({ ...stored, budget }, Object.keys(stored.connected ?? {}), deps.now());
}

/** The usage with each game's share, budget and status as the games see it. */
async function usageWithControl(env, deps) {
  const data = await usage(env, deps);
  if (data.error) return data;
  const stored = await readSettings(env);
  const budget = budgetState(stored.settings, data);
  return { ...data, control: controlOf({ ...stored, budget }, data.games.map((g) => g.name), deps.now()) };
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
  if (pathname === '/api/control') {
    // The game cards' figures, without Cloudflare's (F-078).
    if (!(await validSession(env, readCookie(request)))) return json({ error: 'signed-out', passwordSet: passwordConfigured(env) }, 401);
    return json(await controlOnly(env, deps));
  }
  if (pathname === '/api/quality') {
    if (!(await validSession(env, readCookie(request)))) return json({ error: 'signed-out' }, 401);
    const s = store(env);
    if (!s) return json({ days: 7, quality: {} });
    return json(await (await s.fetch('https://store/quality')).json());
  }
  if (pathname === '/playtest/rooms' || pathname.startsWith('/playtest/rooms/')) return playtestRoom(request, env);
  if (pathname.startsWith('/playtest/')) return playtestPublic(request, env, deps);
  const listApi = ['/api/passes', '/api/messages', '/api/log', '/api/lobbies', '/api/testers', '/api/reports', '/api/recordings', '/api/open-tests'].find((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (listApi) {
    // The owner's personal links per game (F-058) and messages to players (F-066).
    if (!(await validSession(env, readCookie(request)))) return json({ error: 'signed-out' }, 401);
    if (request.method !== 'GET' && !sameOrigin(request)) return new Response('Forbidden', { status: 403 });
    const s = ['/api/testers', '/api/reports', '/api/recordings', '/api/open-tests'].includes(listApi) ? playtestStore(env) : store(env);
    if (!s) return json({ error: 'no-store' }, 500);
    if (listApi === '/api/log' && request.method !== 'GET') return json({ error: 'method' }, 405);
    const rest = pathname.slice('/api'.length) + url.search;
    const res = await s.fetch(`https://store${rest}`, {
      method: request.method,
      body: request.method === 'POST' ? (await request.text()).slice(0, 2048) : undefined,
    });
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
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
      const res = await s.fetch('https://store/settings', { method: 'PUT', body });
      return new Response(res.body, {
        status: res.status, // 409 when the page saved from an older copy (B-109)
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
  forgetShapes();
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
    // The guard for all addresses together allows more before it brakes (F-101).
    this.all = new LoginGuard(state.storage, { freeTries: 30, firstWaitMs: 60_000, maxWaitMs: 60 * 60_000, forgetMs: 60 * 60_000 });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);
    const guard = url.searchParams.get('all') === '1' ? this.all : this.guard;
    let result = 0;
    if (action === 'wait') result = await guard.waitMs();
    else if (action === 'failed') {
      result = await guard.failed();
      // The record about this address is deleted a day after the last wrong password (B-055).
      await this.storage.setAlarm(Date.now() + 86_400_000 + 60_000);
    } else if (action === 'succeeded') {
      await guard.succeeded();
      await this.storage.deleteAlarm?.();
    } else return new Response('Not found', { status: 404 });
    return new Response(String(result));
  }

  async alarm() {
    await this.storage.deleteAll();
  }
}
