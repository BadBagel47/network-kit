// Measurement reports from the demo page (F-047). The demo is only tested by
// the owner, so a report may hold everything the measurement needs (names used
// in the test, device, timings). Reports are kept 7 days; reading them needs
// DIAG_KEY, which the deploy workflow derives from its Cloudflare token, so the
// agent reads them through a GitHub workflow.

const KEEP_MS = 7 * 86_400_000;
const KEEP_MAX = 200;
const MAX_BYTES = 64 * 1024;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Routes /diag on the demo Worker; returns null for other paths. */
export async function diagRoute(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/diag') return null;
  if (!env.DIAG) return json({ error: 'not-set-up' }, 404);
  // Kept in the EU like the rooms (not available in local workerd).
  const ns = env.ROOM_JURISDICTION ? env.DIAG.jurisdiction(env.ROOM_JURISDICTION) : env.DIAG;
  const store = ns.get(ns.idFromName('reports'));
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: 'too-large' }, 413);
    let report;
    try {
      report = JSON.parse(text);
    } catch {
      return json({ error: 'bad-json' }, 400);
    }
    // Where the request reached Cloudflare (the data centre code, e.g. ARN), useful for D-046.
    const edge = request.cf?.colo ?? null;
    return store.fetch('https://diag/add', { method: 'POST', body: JSON.stringify({ report, edge }) });
  }
  if (request.method === 'GET') {
    const given = request.headers.get('x-diag-key') ?? '';
    if (!env.DIAG_KEY || !given || (await sha256(given)) !== (await sha256(env.DIAG_KEY))) {
      return json({ error: 'forbidden' }, 403);
    }
    return store.fetch(`https://diag/list?since=${encodeURIComponent(url.searchParams.get('since') ?? '0')}`);
  }
  return json({ error: 'method' }, 405);
}

/** One object for all reports; each report is its own stored value. */
export class DiagStore {
  constructor(state) {
    this.storage = state.storage;
  }

  /** All reports, oldest first, after dropping those older than 7 days or beyond the newest 200. */
  async reports(now) {
    const all = [...(await this.storage.list({ prefix: 'r:' })).entries()];
    const drop = all.filter(([, r], i) => now - r.at >= KEEP_MS || i < all.length - KEEP_MAX).map(([k]) => k);
    if (drop.length) await this.storage.delete(drop);
    return all.filter(([k]) => !drop.includes(k)).map(([, r]) => r);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === '/add') {
      const { report, edge } = await request.json();
      const id = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % ALPHABET.length]).join('');
      // Keys sort by time, so the list comes back oldest first.
      await this.storage.put(`r:${String(now).padStart(15, '0')}:${id}`, { id, at: now, edge, report });
      await this.reports(now);
      return json({ id });
    }
    if (url.pathname === '/list') {
      const since = Number(url.searchParams.get('since')) || 0;
      const list = (await this.reports(now)).filter((r) => r.at > since);
      return json(list.map((r) => ({ ...r, time: new Date(r.at).toISOString() })));
    }
    return json({ error: 'not-found' }, 404);
  }
}
