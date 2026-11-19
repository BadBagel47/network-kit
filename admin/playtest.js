// Playtest (F-091): tester links, play-test reports and their pictures, kept in
// the admin page's store. A tester link lets a browser show Playtest-rutan and
// send reports for one game; the owner sees them under Rapporter, and the
// developing agent reads them sealed through a workflow.
//
// Keys in the store's storage:
//   tst:<id>              a tester link (the secret only as a hash)
//   rep:<time>-<id>       a report
//   img:<id>              a picture (JPEG or PNG, base64), owned by one report
//   ptn:<tester>:<day>    how many reports and pictures a tester sent that day
//   ptu:<id>              an upload key for Playtest Remote (B-094): pictures only, a few hours
//
// They live in a Durable Object of their own (PlaytestStore, F-095), so pictures
// never slow the games' status checks in the admin page's main store.

export const TESTER_PREFIX = 'pt_';
export const UPLOAD_PREFIX = 'pu_';
export const UPLOAD_KEY_MS = 6 * 60 * 60_000; // an upload key for Playtest Remote lasts six hours
export const REPORT_KEEP_MS = 30 * 86_400_000; // owner 2026-11-19
export const KEEP_MAX = 50; // reports marked Behåll per game (owner 2026-11-19)
export const IMAGE_MAX_BYTES = 400 * 1024; // the panel aims at about 300 kB
const TESTER_DEFAULT_HOURS = 30 * 24;
const TESTER_MAX_HOURS = 90 * 24;
const TESTER_KEEP_MS = 14 * 86_400_000; // links no longer active stay listed this long
const UNUSED_IMAGE_MS = 86_400_000; // a picture no report points to is deleted after a day
const PER_DAY = { report: 200, image: 100 }; // per tester link and UTC day
const RESULTS = new Set(['worked', 'partly', 'failed', 'cancelled', 'note']);

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hashText = async (text) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export const validGame = (g) => typeof g === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(g);

const text = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Plain JSON, at most `depth` deep and `max` characters, for the game's own context. */
function plain(value, depth = 3) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 500);
  if (depth <= 0) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => plain(v, depth - 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) out[String(k).slice(0, 60)] = plain(v, depth - 1);
    return out;
  }
  return null;
}

/** A report as the panel sends it, with known fields only and short texts. */
export function cleanReport(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const c = r.context && typeof r.context === 'object' ? r.context : {};
  const answers = Array.isArray(r.answers) ? r.answers.slice(0, 12).map((a) => ({
    q: text(a?.q, 300),
    a: text(a?.a, 2000),
  })) : [];
  const context = {
    url: text(c.url, 1000),
    version: text(c.version, 80),
    kit: text(c.kit, 20),
    device: text(c.device, 40),
    browser: text(c.browser, 60),
    userAgent: text(c.userAgent, 300),
    window: text(c.window, 20),
    screen: text(c.screen, 20),
    dpr: num(c.dpr),
    fullscreen: Boolean(c.fullscreen),
    language: text(c.language, 20),
    startedAt: num(c.startedAt),
    durationMs: num(c.durationMs),
    errors: Array.isArray(c.errors) ? c.errors.slice(0, 20).map((e) => text(e, 500)) : [],
    game: plain(c.game),
  };
  return {
    testId: text(r.testId, 60),
    title: text(r.title, 200),
    result: RESULTS.has(r.result) ? r.result : 'note',
    answers,
    text: text(r.text, 4000),
    via: r.via === 'remote' ? 'remote' : 'panel',
    images: Array.isArray(r.images) ? r.images.filter((i) => typeof i === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(i)).slice(0, 4) : [],
    context,
  };
}

export class Playtest {
  /** `storage` is the store's Durable Object storage; `log(game, text, kind)` writes the owner's log. */
  constructor(storage, { now = Date.now, log = async () => {} } = {}) {
    this.storage = storage;
    this.now = now;
    this.log = log;
  }

  // ---- tester links

  async createTester({ game, label, hours, page }) {
    if (!validGame(game)) return { error: 'bad-game' };
    const id = b64url(crypto.getRandomValues(new Uint8Array(6)));
    const secret = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const now = this.now();
    const h = Math.min(TESTER_MAX_HOURS, Math.max(1, Math.round(Number(hours) || TESTER_DEFAULT_HOURS)));
    const tester = {
      id, game, label: text(label, 40), page: text(page, 500), hash: await hashText(secret),
      created: now, expires: now + h * 3_600_000, revoked: null, lastUsed: null,
    };
    await this.storage.put(`tst:${id}`, tester);
    await this.log(game, `Testarlänk skapad${tester.label ? ` till ${tester.label}` : ''} för ${game}`, 'link');
    const { hash, ...shown } = tester;
    return { token: `${TESTER_PREFIX}${id}.${secret}`, tester: shown };
  }

  async testers() {
    const now = this.now();
    const out = [];
    const gone = [];
    for (const t of (await this.storage.list({ prefix: 'tst:' })).values()) {
      const endedAt = t.revoked ?? (t.expires <= now ? t.expires : null);
      if (endedAt !== null && now - endedAt > TESTER_KEEP_MS) {
        gone.push(`tst:${t.id}`);
        continue;
      }
      const { hash, ...shown } = t;
      out.push({ ...shown, state: t.revoked ? 'revoked' : t.expires <= now ? 'expired' : 'active' });
    }
    if (gone.length) await this.storage.delete(gone);
    return out.sort((a, b) => b.created - a.created);
  }

  async revokeTester(id) {
    const t = await this.storage.get(`tst:${id}`);
    if (!t || t.revoked) return;
    t.revoked = this.now();
    await this.storage.put(`tst:${id}`, t);
    await this.log(t.game, `Testarlänk${t.label ? ` till ${t.label}` : ''} återkallad (${t.game})`, 'link');
  }

  /** The tester link behind a token, if it works now. */
  async testerFor(token) {
    const raw = String(token ?? '');
    if (!raw.startsWith(TESTER_PREFIX)) return null;
    const [id, secret] = raw.slice(TESTER_PREFIX.length).split('.');
    if (!id || !secret || id.length > 20) return null;
    const t = await this.storage.get(`tst:${id}`);
    if (!t || t.revoked || t.expires <= this.now()) return null;
    if ((await hashText(secret)) !== t.hash) return null;
    return t;
  }

  async count(tester, kind) {
    const key = `ptn:${tester.id}:${day(this.now())}`;
    const n = (await this.storage.get(key)) ?? { report: 0, image: 0 };
    if (n[kind] >= PER_DAY[kind]) return false;
    n[kind] += 1;
    await this.storage.put(key, n);
    if (this.now() - (tester.lastUsed ?? 0) > 3_600_000) {
      tester.lastUsed = this.now();
      await this.storage.put(`tst:${tester.id}`, tester);
    }
    return true;
  }

  // ---- what a tester's browser asks

  /** { game, label, expires, reported: [test ids sent in the last 30 days] } or null. */
  async check(token) {
    const t = await this.testerFor(token);
    if (!t) return null;
    const reported = new Set();
    for (const r of (await this.storage.list({ prefix: 'rep:' })).values()) {
      if (r.game === t.game && r.testId && r.result !== 'cancelled') reported.add(r.testId);
    }
    return { game: t.game, label: t.label, expires: t.expires, reported: [...reported] };
  }

  /**
   * A short-lived key that only lets Playtest Remote send pictures for this
   * tester (B-094): the tester link's own token never leaves the game page.
   */
  async createUploadKey(token) {
    const t = await this.testerFor(token);
    if (!t) return { error: 'no-tester', status: 401 };
    const id = b64url(crypto.getRandomValues(new Uint8Array(6)));
    const secret = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const expires = Math.min(t.expires, this.now() + UPLOAD_KEY_MS);
    await this.storage.put(`ptu:${id}`, { id, tester: t.id, hash: await hashText(secret), expires });
    return { key: `${UPLOAD_PREFIX}${id}.${secret}`, expires };
  }

  /** The tester link behind an upload key, if both still work. */
  async testerForUpload(key) {
    const raw = String(key ?? '');
    if (!raw.startsWith(UPLOAD_PREFIX)) return null;
    const [id, secret] = raw.slice(UPLOAD_PREFIX.length).split('.');
    if (!id || !secret || id.length > 20) return null;
    const u = await this.storage.get(`ptu:${id}`);
    if (!u || u.expires <= this.now() || (await hashText(secret)) !== u.hash) return null;
    const t = await this.storage.get(`tst:${u.tester}`);
    return t && !t.revoked && t.expires > this.now() ? t : null;
  }

  async addImage(token, type, bytes) {
    const t = (await this.testerFor(token)) ?? (await this.testerForUpload(token));
    if (!t) return { error: 'no-tester', status: 401 };
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return { error: 'bad-type', status: 415 };
    if (!bytes?.byteLength || bytes.byteLength > IMAGE_MAX_BYTES) return { error: 'too-large', status: 413 };
    if (!(await this.count(t, 'image'))) return { error: 'too-many', status: 429 };
    const id = b64url(crypto.getRandomValues(new Uint8Array(9)));
    let binary = '';
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    await this.storage.put(`img:${id}`, { id, game: t.game, tester: t.id, type, size: view.length, data: btoa(binary), at: this.now(), report: null });
    return { id };
  }

  async addReport(token, raw) {
    const t = await this.testerFor(token);
    if (!t) return { error: 'no-tester', status: 401 };
    if (!(await this.count(t, 'report'))) return { error: 'too-many', status: 429 };
    const report = cleanReport(raw);
    const now = this.now();
    const id = b64url(crypto.getRandomValues(new Uint8Array(6)));
    const key = `rep:${String(now).padStart(15, '0')}-${id}`;
    // Pictures belong to this report; only the tester's own, of this game.
    const images = [];
    for (const imageId of report.images) {
      const img = await this.storage.get(`img:${imageId}`);
      if (img && img.tester === t.id && !img.report) {
        img.report = id;
        await this.storage.put(`img:${imageId}`, img);
        images.push(imageId);
      }
    }
    const stored = { ...report, images, id, key, game: t.game, tester: t.label || 'Testare', testerId: t.id, at: now, keep: false };
    await this.storage.put(key, stored);
    await this.clean();
    return { id };
  }

  // ---- the owner's and the agent's view

  /** Reports, newest first; `game` narrows to one game, `since` to newer ones. */
  async reports({ game = null, since = 0 } = {}) {
    await this.clean();
    const out = [];
    for (const r of (await this.storage.list({ prefix: 'rep:' })).values()) {
      if ((game && r.game !== game) || r.at <= since) continue;
      out.push(r);
    }
    return out.sort((a, b) => b.at - a.at);
  }

  async image(id) {
    return (await this.storage.get(`img:${id}`)) ?? null;
  }

  async findReport(id) {
    for (const [key, r] of await this.storage.list({ prefix: 'rep:' })) if (r.id === id) return { key, r };
    return null;
  }

  /** Behåll: keep a report past 30 days, at most KEEP_MAX per game. */
  async setKeep(id, keep) {
    const found = await this.findReport(id);
    if (!found) return { error: 'not-found', status: 404 };
    if (keep && !found.r.keep) {
      let kept = 0;
      for (const r of (await this.storage.list({ prefix: 'rep:' })).values()) if (r.keep && r.game === found.r.game) kept += 1;
      if (kept >= KEEP_MAX) return { error: 'keep-full', status: 409 };
    }
    found.r.keep = Boolean(keep);
    await this.storage.put(found.key, found.r);
    return { ok: true, keep: found.r.keep };
  }

  async deleteReport(id) {
    const found = await this.findReport(id);
    if (!found) return;
    await this.storage.delete([found.key, ...found.r.images.map((i) => `img:${i}`)]);
  }

  /** Reports older than 30 days (unless kept), their pictures, and stray pictures go. */
  async clean() {
    const now = this.now();
    if (now - (this.cleanedAt ?? 0) < 60_000) return;
    this.cleanedAt = now;
    const gone = [];
    for (const [key, r] of await this.storage.list({ prefix: 'rep:' })) {
      if (!r.keep && now - r.at > REPORT_KEEP_MS) gone.push(key, ...r.images.map((i) => `img:${i}`));
    }
    for (const [key, img] of await this.storage.list({ prefix: 'img:' })) {
      if (!img.report && now - img.at > UNUSED_IMAGE_MS) gone.push(key);
    }
    for (const [key, u] of await this.storage.list({ prefix: 'ptu:' })) {
      if (u.expires <= now) gone.push(key);
    }
    for (const key of (await this.storage.list({ prefix: 'ptn:' })).keys()) {
      if (key.slice(-10) < day(now - 2 * 86_400_000)) gone.push(key);
    }
    for (let i = 0; i < gone.length; i += 128) await this.storage.delete(gone.slice(i, i + 128));
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/**
 * Playtest's own Durable Object (F-095). The admin Worker sends it the
 * testers' paths (/playtest/check, /playtest/report, /playtest/image,
 * /playtest/upload-key) and the owner's (/testers, /reports); it writes the
 * owner's log through the main store.
 */
export class PlaytestStore {
  constructor(state, env, deps = {}) {
    const now = deps.now ?? Date.now;
    const log = async (game, text, kind) => {
      const main = env?.STORE?.get(env.STORE.idFromName('main'));
      await main?.fetch('https://store/log-add', { method: 'POST', body: JSON.stringify({ game, text, kind }) });
    };
    this.playtest = new Playtest(state.storage, { now, log });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pt = this.playtest;
    const path = url.pathname;
    const body = async () => (request.method === 'POST' ? request.json().catch(() => ({})) : {});
    const answer = (r) => json(r, r?.status ?? (r?.error ? 400 : 200));
    // What a tester's browser asks (through the admin Worker's /playtest/ paths).
    if (path === '/playtest/check' && request.method === 'POST') {
      const found = await pt.check((await body()).token);
      return found ? json(found) : json({ error: 'no-tester' }, 401);
    }
    if (path === '/playtest/upload-key' && request.method === 'POST') {
      return answer(await pt.createUploadKey((await body()).token));
    }
    if (path === '/playtest/report' && request.method === 'POST') {
      const { token, report } = await body();
      return answer(await pt.addReport(token, report));
    }
    if (path === '/playtest/image' && request.method === 'POST') {
      const bytes = await request.arrayBuffer();
      return answer(await pt.addImage(url.searchParams.get('token'), request.headers.get('content-type') ?? '', bytes));
    }
    // The owner's and the agent's view.
    if (path === '/testers' && request.method === 'GET') return json(await pt.testers());
    if (path === '/testers' && request.method === 'POST') {
      const made = await pt.createTester(await body());
      return made.error ? json(made, 400) : json(made);
    }
    if (path.startsWith('/testers/') && request.method === 'DELETE') {
      await pt.revokeTester(path.slice('/testers/'.length));
      return json({ ok: true });
    }
    if (path === '/reports' && request.method === 'GET') {
      return json(await pt.reports({ game: url.searchParams.get('game') || null, since: Number(url.searchParams.get('since')) || 0 }));
    }
    const image = path.match(/^\/reports\/image\/([A-Za-z0-9_-]{6,20})$/);
    if (image && request.method === 'GET') {
      const img = await pt.image(image[1]);
      if (!img) return json({ error: 'not-found' }, 404);
      const raw = atob(img.data);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      return new Response(bytes, { headers: { 'content-type': img.type } });
    }
    const keep = path.match(/^\/reports\/([A-Za-z0-9_-]{6,20})\/keep$/);
    if (keep && request.method === 'POST') return answer(await pt.setKeep(keep[1], (await body()).keep !== false));
    const one = path.match(/^\/reports\/([A-Za-z0-9_-]{6,20})$/);
    if (one && request.method === 'DELETE') {
      await pt.deleteReport(one[1]);
      return json({ ok: true });
    }
    return json({ error: 'not-found' }, 404);
  }
}
