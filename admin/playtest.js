// Playtest (F-091): tester links, play-test reports and their pictures, kept in
// the admin page's store. A tester link lets a browser show Playtest-rutan and
// send reports for one game; the owner sees them under Rapporter, and the
// developing agent reads them sealed through a workflow.
//
// Keys in the store's storage:
//   tst:<id>              a tester link (the secret only as a hash)
//   rep:<time>-<id>       a report
//   rix:<time>-<id>       its small index entry (F-130): id, game, test, result, time, keep, open, pictures;
//                         lists, Behåll and cleaning read these, never the reports' bodies
//   img:<id>              a picture's facts (type, size, owner), small, so lists stay light (B-099)
//   imgd:<id>             the picture itself (base64), read only when one picture is asked for
//   ptn:<tester>:<day>    how many reports and pictures a tester sent that day
//   ptu:<id>              an upload key for Playtest Remote (B-094): pictures only, a few hours
//   rcs:<session>         a Playtest Recorder session's facts (F-092): game, tester, times, counts
//   rck:<session>:<seq>   one batch of a session's events (about a minute)
//   ot:<game>             Open test (F-118): the game's page, its key and until when anyone with the test's addresses takes part
//   ptv:<game>:<visitor>:<day>  Open test: what one visitor sent that day (B-123)
//
// They live in a Durable Object of their own (PlaytestStore, F-095), so pictures
// never slow the games' status checks in the admin page's main store.

import { b64url, hashText, day } from './util.js';
export const TESTER_PREFIX = 'pt_';
export const UPLOAD_PREFIX = 'pu_';
// Open test (F-118, owner 2026-11-19): off by default, at most six hours (Q6);
// while on, a page of the game with ?record or ?report takes part without a
// tester link, under smaller caps per game and day (Q9).
export const OPEN_PREFIX = 'pto_';
export const OPEN_MAX_HOURS = 6;
const OPEN_KEEP_MS = 86_400_000; // an ended open test stays listed a day
const PER_DAY_OPEN = { report: 50, image: 100, chunk: 300 }; // per game and UTC day
const PER_VISITOR_OPEN = { report: 10, image: 20, chunk: 90 }; // per visitor, game and UTC day: nobody takes the whole day (B-123)
const OPEN_REPORT_MAX = 16 * 1024; // Open test reports and batches are smaller than a tester link's (B-123)
const OPEN_CHUNK_MAX = 32 * 1024;
export const UPLOAD_KEY_MS = 6 * 60 * 60_000; // an upload key for Playtest Remote lasts six hours
export const REPORT_KEEP_MS = 30 * 86_400_000; // owner 2026-11-19
export const KEEP_MAX = 50; // reports marked Behåll per game (owner 2026-11-19)
export const IMAGE_MAX_BYTES = 400 * 1024; // the panel aims at about 300 kB
const TESTER_DEFAULT_HOURS = 30 * 24;
const TESTER_MAX_HOURS = 90 * 24;
const TESTER_KEEP_MS = 14 * 86_400_000; // links no longer active stay listed this long
const UNUSED_IMAGE_MS = 86_400_000; // a picture no report points to is deleted after a day
const PER_DAY = { report: 200, image: 100, chunk: 1500 }; // per tester link and UTC day
// Playtest Recorder (F-092): batches of about a minute, at most this many per
// session (four hours) and events per batch; kept like the reports.
export const RECORDING_CHUNKS_MAX = 240;
export const RECORDING_EVENTS_MAX = 500;
export const RECORDING_KEEP_MAX = 20;
const SESSION_ID = /^[A-Za-z0-9_-]{8,40}$/;
const CLEAN_EVERY_MS = 60 * 60_000; // F-130
const RESULTS = new Set(['worked', 'partly', 'failed', 'cancelled', 'note']);

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

/** A scripted test's part of a report (F-121): steps, checks, answers and measurements, as plain JSON. */
function cleanScript(raw) {
  const list = (v, f) => (Array.isArray(v) ? v.slice(-50).map(f) : []);
  const measures = {};
  for (const [label, m] of Object.entries(raw.measures && typeof raw.measures === 'object' ? raw.measures : {}).slice(0, 20)) {
    measures[String(label).slice(0, 60)] = plain(m, 3);
  }
  return {
    state: ['done', 'failed', 'stopped'].includes(raw.state) ? raw.state : 'failed',
    from: raw.from === 'remote' ? 'remote' : 'panel',
    durationMs: num(raw.durationMs),
    summary: text(raw.summary, 300),
    steps: list(raw.steps, (x) => ({ at: num(x?.at), text: text(x?.text, 200) })),
    checks: list(raw.checks, (x) => ({ at: num(x?.at), text: text(x?.text, 200), ok: Boolean(x?.ok) })),
    asks: list(raw.asks, (x) => ({ at: num(x?.at), q: text(x?.q, 300), a: x?.a === 'Ja' || x?.a === 'Nej' ? x.a : null })),
    measures,
    notes: list(raw.notes, (x) => ({ at: num(x?.at), text: text(x?.text, 500) })),
    ...(raw.error ? { error: text(raw.error, 500) } : {}),
  };
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
    name: text(r.name, 40).trim(), // Open test: an optional name (owner Q8)
    via: r.via === 'remote' ? 'remote' : 'panel',
    images: Array.isArray(r.images) ? r.images.filter((i) => typeof i === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(i)).slice(0, 4) : [],
    context,
    ...(r.script && typeof r.script === 'object' ? { script: cleanScript(r.script) } : {}),
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

  // ---- Open test (F-118)

  async openTests() {
    const now = this.now();
    const out = [];
    for (const o of (await this.storage.list({ prefix: 'ot:' })).values()) {
      if (o.until <= now && now - o.until > OPEN_KEEP_MS) {
        await this.storage.delete(`ot:${o.game}`); // long ended (D-140)
        continue;
      }
      // Today's use against the caps (F-128): a batch is about a minute of recording.
      const used = { report: 0, image: 0, chunk: 0, ...((await this.storage.get(`ptn:open-${o.game}:${day(now)}`)) ?? {}) };
      out.push({ ...o, state: o.until > now ? 'on' : 'ended', used, caps: PER_DAY_OPEN, perVisitor: PER_VISITOR_OPEN });
    }
    return out.sort((a, b) => b.until - a.until);
  }

  async setOpenTest({ game, page, hours }) {
    if (!validGame(game)) return { error: 'bad-game', status: 400 };
    let origin = '';
    try {
      const u = new URL(String(page ?? ''));
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
      origin = u.origin;
    } catch {
      return { error: 'bad-page', status: 400 };
    }
    const now = this.now();
    const h = Math.min(OPEN_MAX_HOURS, Math.max(0.25, Number(hours) || 2));
    // A new key each time it is switched on (B-123): only the addresses the admin page shows work,
    // and switching off and on again makes old addresses useless.
    const key = b64url(crypto.getRandomValues(new Uint8Array(9)));
    const open = { game, page: text(page, 500), origin, key, since: now, until: now + Math.round(h * 3_600_000) };
    await this.storage.put(`ot:${game}`, open);
    await this.log(game, `Öppet test på för ${game} till ${new Date(open.until).toISOString().slice(11, 16)} UTC`, 'link');
    return { ...open, state: 'on' };
  }

  async stopOpenTest(game) {
    const o = await this.storage.get(`ot:${game}`);
    if (!o || o.until <= this.now()) return;
    o.until = this.now();
    await this.storage.put(`ot:${game}`, o);
    await this.log(game, `Öppet test avslaget för ${game}`, 'link');
  }

  /** The open test this page takes part in: its origin and the key in its address must match (B-123, B-127). */
  async openFor(origin, key) {
    const now = this.now();
    if (!key || typeof key !== 'string') return null;
    for (const o of (await this.storage.list({ prefix: 'ot:' })).values()) {
      if (o.until > now && o.origin === origin && o.key && o.key === key) {
        return { game: o.game, label: 'Öppet test', expires: o.until, reported: [], open: true, token: `${OPEN_PREFIX}${o.game}.${o.key}` };
      }
    }
    return null;
  }

  // ---- the reports' index (F-130, review COST-2)

  indexOf(r) {
    return { id: r.id, key: r.key, game: r.game, testId: r.testId, result: r.result, at: r.at, keep: Boolean(r.keep), open: Boolean(r.open), images: r.images ?? [] };
  }

  /** The index, built once from the reports stored before it existed. */
  async index() {
    if (!this.indexBuilt) {
      if (!(await this.storage.get('meta:rix-built'))) {
        for (const [key, r] of await this.storage.list({ prefix: 'rep:' })) await this.storage.put(`rix:${key.slice(4)}`, this.indexOf({ ...r, key }));
        await this.storage.put('meta:rix-built', this.now());
      }
      this.indexBuilt = true;
    }
    return this.storage.list({ prefix: 'rix:' });
  }

  /** *Ta bort allt från Öppet test* (B-123): every report and recording an Open test brought in for a game. */
  async removeOpenData(game) {
    const gone = [];
    let reports = 0;
    let recordings = 0;
    for (const x of (await this.index()).values()) {
      if (x.game === game && x.open) {
        gone.push(x.key, `rix:${x.key.slice(4)}`, ...x.images.flatMap((i) => [`img:${i}`, `imgd:${i}`]));
        reports += 1;
      }
    }
    for (const m of (await this.storage.list({ prefix: 'rcs:' })).values()) {
      if (m.game === game && m.open) {
        gone.push(...this.recordingKeys(m));
        recordings += 1;
      }
    }
    for (let i = 0; i < gone.length; i += 128) await this.storage.delete(gone.slice(i, i + 128));
    if (reports || recordings) await this.log(game, `Allt från Öppet test borttaget för ${game} (${reports} rapporter, ${recordings} inspelningar)`, 'link');
    return { reports, recordings };
  }

  /** The tester link behind a token, if it works now; an Open test token while its test is on. */
  async testerFor(token, { origin = null } = {}) {
    const raw = String(token ?? '');
    if (raw.startsWith(OPEN_PREFIX)) {
      // pto_<game>.<key>: the key of this switch-on, and the page's own origin (B-123).
      const [game, key] = raw.slice(OPEN_PREFIX.length).split('.');
      if (!validGame(game) || !key) return null;
      const o = await this.storage.get(`ot:${game}`);
      if (!o || o.until <= this.now() || !o.key || o.key !== key) return null;
      if (origin !== null && origin !== o.origin) return null;
      return { id: `open-${game}`, game, label: 'Öppet test', open: true, expires: o.until };
    }
    if (!raw.startsWith(TESTER_PREFIX)) return null;
    const [id, secret] = raw.slice(TESTER_PREFIX.length).split('.');
    if (!id || !secret || id.length > 20) return null;
    const t = await this.storage.get(`tst:${id}`);
    if (!t || t.revoked || t.expires <= this.now()) return null;
    if ((await hashText(secret)) !== t.hash) return null;
    return t;
  }

  async count(tester, kind, visitor = '') {
    const key = `ptn:${tester.id}:${day(this.now())}`;
    const n = { report: 0, image: 0, chunk: 0, ...((await this.storage.get(key)) ?? {}) };
    if (n[kind] >= (tester.open ? PER_DAY_OPEN : PER_DAY)[kind]) return false;
    if (tester.open) {
      // Each visitor a share of the game's day (B-123).
      const vkey = `ptv:${tester.game}:${String(visitor || 'unknown').slice(0, 80)}:${day(this.now())}`;
      const v = { report: 0, image: 0, chunk: 0, ...((await this.storage.get(vkey)) ?? {}) };
      if (v[kind] >= PER_VISITOR_OPEN[kind]) return false;
      v[kind] += 1;
      await this.storage.put(vkey, v);
    }
    n[kind] += 1;
    await this.storage.put(key, n);
    if (!tester.open && this.now() - (tester.lastUsed ?? 0) > 3_600_000) {
      tester.lastUsed = this.now();
      await this.storage.put(`tst:${tester.id}`, tester);
    }
    return true;
  }

  // ---- what a tester's browser asks

  /** { game, label, expires, reported: [test ids sent in the last 30 days] } or null. */
  async check(token, ctx = {}) {
    const t = await this.testerFor(token, ctx);
    if (!t) return null;
    if (t.open) return { game: t.game, label: t.label, expires: t.expires, reported: [], open: true };
    const reported = new Set();
    for (const x of (await this.index()).values()) {
      if (x.game === t.game && x.testId && x.result !== 'cancelled') reported.add(x.testId);
    }
    return { game: t.game, label: t.label, expires: t.expires, reported: [...reported] };
  }

  /**
   * A short-lived key that only lets Playtest Remote send pictures for this
   * tester (B-094): the tester link's own token never leaves the game page.
   */
  async createUploadKey(token, ctx = {}) {
    const t = await this.testerFor(token, ctx);
    if (!t) return { error: 'no-tester', status: 401 };
    if (t.open) return { error: 'open-test', status: 403 }; // Playtest Remote needs a tester link
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

  async addImage(token, type, bytes, ctx = {}) {
    const t = (await this.testerFor(token, ctx)) ?? (await this.testerForUpload(token));
    if (!t) return { error: 'no-tester', status: 401 };
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return { error: 'bad-type', status: 415 };
    if (!bytes?.byteLength || bytes.byteLength > IMAGE_MAX_BYTES) return { error: 'too-large', status: 413 };
    if (!(await this.count(t, 'image', ctx.visitor))) return { error: 'too-many', status: 429 };
    const id = b64url(crypto.getRandomValues(new Uint8Array(9)));
    let binary = '';
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    await this.storage.put(`imgd:${id}`, btoa(binary));
    await this.storage.put(`img:${id}`, { id, game: t.game, tester: t.id, type, size: view.length, at: this.now(), report: null });
    return { id };
  }

  async addReport(token, raw, ctx = {}) {
    const t = await this.testerFor(token, ctx);
    if (!t) return { error: 'no-tester', status: 401 };
    if (t.open && JSON.stringify(raw ?? {}).length > OPEN_REPORT_MAX) return { error: 'too-large', status: 413 };
    if (!(await this.count(t, 'report', ctx.visitor))) return { error: 'too-many', status: 429 };
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
    const tester = t.open ? `Öppet test${report.name ? ` · ${report.name}` : ''}` : t.label || 'Testare';
    const stored = { ...report, images, id, key, game: t.game, tester, testerId: t.id, open: Boolean(t.open), at: now, keep: false };
    await this.index(); // built before the first new entry, so older reports are in it too
    await this.storage.put(key, stored);
    await this.storage.put(`rix:${key.slice(4)}`, this.indexOf(stored));
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

  /** One picture with its data, or null. Pictures from 0.14.0–0.14.1 kept the data in img:. */
  async image(id) {
    const meta = await this.storage.get(`img:${id}`);
    if (!meta) return null;
    return { ...meta, data: meta.data ?? (await this.storage.get(`imgd:${id}`)) ?? '' };
  }

  async findReport(id) {
    for (const x of (await this.index()).values()) {
      if (x.id === id) {
        const r = await this.storage.get(x.key);
        return r ? { key: x.key, r } : null;
      }
    }
    return null;
  }

  /** Behåll: keep a report past 30 days, at most KEEP_MAX per game. */
  async setKeep(id, keep) {
    const found = await this.findReport(id);
    if (!found) return { error: 'not-found', status: 404 };
    if (keep && !found.r.keep) {
      let kept = 0;
      for (const x of (await this.index()).values()) if (x.keep && x.game === found.r.game) kept += 1;
      if (kept >= KEEP_MAX) return { error: 'keep-full', status: 409 };
    }
    found.r.keep = Boolean(keep);
    await this.storage.put(found.key, found.r);
    await this.storage.put(`rix:${found.key.slice(4)}`, this.indexOf({ ...found.r, key: found.key }));
    return { ok: true, keep: found.r.keep };
  }

  async deleteReport(id) {
    const found = await this.findReport(id);
    if (!found) return;
    await this.storage.delete([found.key, `rix:${found.key.slice(4)}`, ...found.r.images.flatMap((i) => [`img:${i}`, `imgd:${i}`])]);
  }

  // ---- Playtest Recorder (F-092)

  /** One batch of a recording session: { session, seq, events: [{ t, k, d }], context }. */
  async addRecording(token, raw, ctx = {}) {
    const t = await this.testerFor(token, ctx);
    if (!t) return { error: 'no-tester', status: 401 };
    if (t.open && JSON.stringify(raw ?? {}).length > OPEN_CHUNK_MAX) return { error: 'too-large', status: 413 };
    const session = String(raw?.session ?? '');
    const seq = Number(raw?.seq);
    if (!SESSION_ID.test(session) || !Number.isInteger(seq) || seq < 0 || seq >= RECORDING_CHUNKS_MAX) return { error: 'bad-chunk', status: 400 };
    if (!(await this.count(t, 'chunk', ctx.visitor))) return { error: 'too-many', status: 429 };
    const now = this.now();
    const metaKey = `rcs:${session}`;
    const meta = (await this.storage.get(metaKey)) ?? {
      id: session, game: t.game, tester: t.open ? `Öppet test${text(raw?.name, 40).trim() ? ` · ${text(raw.name, 40).trim()}` : ''}` : t.label || 'Testare',
      testerId: t.id, open: Boolean(t.open), startedAt: now, lastAt: now,
      chunks: 0, events: 0, keep: false, context: cleanReport({ context: raw?.context }).context,
    };
    if (meta.testerId !== t.id) return { error: 'not-yours', status: 403 };
    // Open test: a name typed after recording started still comes with it (owner 2026-11-20).
    const name = text(raw?.name, 40).trim();
    if (t.open && name && meta.tester === 'Öppet test') meta.tester = `Öppet test · ${name}`;
    const events = Array.isArray(raw?.events) ? raw.events.slice(0, RECORDING_EVENTS_MAX + 2).map((e) => ({ // the client's markers fit too (B-132)
      t: Number.isFinite(Number(e?.t)) ? Number(e.t) : null,
      k: typeof e?.k === 'string' ? e.k.slice(0, 40) : 'event',
      d: plain(e?.d),
    })) : [];
    const chunkKey = `rck:${session}:${String(seq).padStart(4, '0')}`;
    const fresh = !(await this.storage.get(chunkKey));
    await this.storage.put(chunkKey, { seq, at: now, events });
    meta.lastAt = now;
    if (fresh) {
      meta.chunks = Math.max(meta.chunks, seq + 1);
      meta.events += events.length;
    }
    await this.storage.put(metaKey, meta);
    await this.clean();
    return { ok: true };
  }

  /** Sessions, newest first (their facts only). */
  async recordings({ game = null, since = 0 } = {}) {
    await this.clean();
    const out = [];
    for (const m of (await this.storage.list({ prefix: 'rcs:' })).values()) {
      if ((game && m.game !== game) || m.lastAt <= since) continue;
      out.push(m);
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** One session with all its events in order, or null. */
  async recording(id) {
    const meta = SESSION_ID.test(String(id)) ? await this.storage.get(`rcs:${id}`) : null;
    if (!meta) return null;
    const events = [];
    for (let seq = 0; seq < meta.chunks; seq += 1) {
      const chunk = await this.storage.get(`rck:${id}:${String(seq).padStart(4, '0')}`);
      if (chunk) events.push(...chunk.events);
    }
    return { ...meta, events };
  }

  async setKeepRecording(id, keep) {
    const meta = SESSION_ID.test(String(id)) ? await this.storage.get(`rcs:${id}`) : null;
    if (!meta) return { error: 'not-found', status: 404 };
    if (keep && !meta.keep) {
      let kept = 0;
      for (const m of (await this.storage.list({ prefix: 'rcs:' })).values()) if (m.keep && m.game === meta.game) kept += 1;
      if (kept >= RECORDING_KEEP_MAX) return { error: 'keep-full', status: 409 };
    }
    meta.keep = Boolean(keep);
    await this.storage.put(`rcs:${id}`, meta);
    return { ok: true, keep: meta.keep };
  }

  recordingKeys(meta) {
    return [`rcs:${meta.id}`, ...Array.from({ length: meta.chunks }, (_, seq) => `rck:${meta.id}:${String(seq).padStart(4, '0')}`)];
  }

  async deleteRecording(id) {
    const meta = SESSION_ID.test(String(id)) ? await this.storage.get(`rcs:${id}`) : null;
    if (!meta) return;
    const keys = this.recordingKeys(meta);
    for (let i = 0; i < keys.length; i += 128) await this.storage.delete(keys.slice(i, i + 128));
  }

  /** Reports older than 30 days (unless kept), their pictures, and stray pictures go. */
  async clean() {
    const now = this.now();
    // Once an hour, from the small index (F-130): a recording tab sends a batch a
    // minute, and cleaning every minute read every stored row each time.
    if (now - (this.cleanedAt ?? 0) < CLEAN_EVERY_MS) return;
    this.cleanedAt = now;
    const gone = [];
    for (const [ikey, x] of await this.index()) {
      if (!x.keep && now - x.at > REPORT_KEEP_MS) gone.push(x.key, ikey, ...x.images.flatMap((i) => [`img:${i}`, `imgd:${i}`]));
    }
    for (const [key, img] of await this.storage.list({ prefix: 'img:' })) {
      if (!img.report && now - img.at > UNUSED_IMAGE_MS) gone.push(key, `imgd:${img.id}`);
    }
    // Recordings go like reports (F-092); their batches are deleted by name, never listed.
    for (const m of (await this.storage.list({ prefix: 'rcs:' })).values()) {
      if (!m.keep && now - m.lastAt > REPORT_KEEP_MS) gone.push(...this.recordingKeys(m));
    }
    for (const [key, u] of await this.storage.list({ prefix: 'ptu:' })) {
      if (u.expires <= now) gone.push(key);
    }
    for (const prefix of ['ptn:', 'ptv:']) {
      for (const key of (await this.storage.list({ prefix })).keys()) {
        if (key.slice(-10) < day(now - 2 * 86_400_000)) gone.push(key);
      }
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
    // Who asks, as the admin Worker passes it on (B-123): the page's origin and the visitor.
    const ctx = { origin: request.headers.get('x-nk-origin'), visitor: request.headers.get('x-nk-visitor') ?? '' };
    // What a tester's browser asks (through the admin Worker's /playtest/ paths).
    if (path === '/playtest/check' && request.method === 'POST') {
      const found = await pt.check((await body()).token, ctx);
      return found ? json(found) : json({ error: 'no-tester' }, 401);
    }
    if (path === '/playtest/open' && request.method === 'POST') {
      const asked = await body();
      const found = await pt.openFor(String(asked.origin ?? ''), String(asked.key ?? ''));
      return found ? json(found) : json({ error: 'not-open' }, 404);
    }
    if (path === '/open-tests' && request.method === 'GET') return json(await pt.openTests());
    if (path === '/open-tests' && request.method === 'POST') return answer(await pt.setOpenTest(await body()));
    const otData = path.match(/^\/open-tests\/([a-z0-9][a-z0-9-]{0,62})\/data$/);
    if (otData && request.method === 'DELETE') return json(await pt.removeOpenData(otData[1]));
    const ot = path.match(/^\/open-tests\/([a-z0-9][a-z0-9-]{0,62})$/);
    if (ot && request.method === 'DELETE') {
      await pt.stopOpenTest(ot[1]);
      return json({ ok: true });
    }
    if (path === '/playtest/upload-key' && request.method === 'POST') {
      return answer(await pt.createUploadKey((await body()).token, ctx));
    }
    if (path === '/playtest/record' && request.method === 'POST') {
      const { token, ...chunk } = await body();
      return answer(await pt.addRecording(token, chunk, ctx));
    }
    if (path === '/recordings' && request.method === 'GET') {
      return json(await pt.recordings({ game: url.searchParams.get('game') || null, since: Number(url.searchParams.get('since')) || 0 }));
    }
    const rec = path.match(/^\/recordings\/([A-Za-z0-9_-]{8,40})(\/keep)?$/);
    if (rec && rec[2] && request.method === 'POST') return answer(await pt.setKeepRecording(rec[1], (await body()).keep !== false));
    if (rec && !rec[2] && request.method === 'GET') {
      const found = await pt.recording(rec[1]);
      return found ? json(found) : json({ error: 'not-found' }, 404);
    }
    if (rec && !rec[2] && request.method === 'DELETE') {
      await pt.deleteRecording(rec[1]);
      return json({ ok: true });
    }
    if (path === '/playtest/report' && request.method === 'POST') {
      const { token, report } = await body();
      return answer(await pt.addReport(token, report, ctx));
    }
    if (path === '/playtest/image' && request.method === 'POST') {
      const bytes = await request.arrayBuffer();
      return answer(await pt.addImage(url.searchParams.get('token'), request.headers.get('content-type') ?? '', bytes, ctx));
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
