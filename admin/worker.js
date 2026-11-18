// network-kit admin page: usage per game against Cloudflare's free limits.
//   GET  /            the page (static, admin/public); it asks /api/usage
//   POST /login       password sign-in (form post, so password managers save it)
//   POST /logout      sign out
//   GET  /api/usage   usage per game and day (signed in only)
//
// Secrets (set by .github/workflows/deploy-admin.yml): ADMIN_PASSWORD and
// CF_ANALYTICS_TOKEN (read-only Cloudflare token). Variable: CF_ACCOUNT_ID.

import { CloudflareAnalytics } from './analytics.js';
import { METRICS, LIMITS_CHECKED } from './limits.js';
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
      return json(await usage(env, deps));
    } catch (e) {
      return json({ error: 'analytics', message: String(e.message ?? e), metrics: METRICS, limitsChecked: LIMITS_CHECKED }, 502);
    }
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
