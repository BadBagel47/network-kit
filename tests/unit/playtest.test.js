// Playtest (F-091): tester links, reports, pictures, Behåll and the agent's reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminStore } from '../../admin/store.js';
import { handle } from '../../admin/worker.js';
import { newSession } from '../../admin/auth.js';
import { cleanReport, KEEP_MAX } from '../../admin/playtest.js';

const NOW = Date.UTC(2026, 10, 19, 12);

function storeWith(now) {
  const data = new Map();
  const storage = {
    get: async (k) => structuredClone(data.get(k)), put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort().map(([k, v]) => [k, structuredClone(v)])),
    setAlarm: async () => {}, deleteAlarm: async () => {},
  };
  const store = new AdminStore({ storage }, {}, { now });
  return { store, data };
}

function setup() {
  let t = NOW;
  const { store, data } = storeWith(() => t);
  const env = {
    ADMIN_PASSWORD: 'a long enough password',
    PLAYTEST_READ_KEY: 'read-key',
    STORE: { idFromName: (n) => n, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) },
  };
  const deps = { fetch: () => { throw new Error('no network'); }, now: () => t };
  const call = (path, init = {}) => handle(new Request(`https://admin.example${path}`, init), env, deps);
  return { store, data, env, call, tick: (ms) => { t += ms; } };
}

const post = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://badbagel47.github.io', ...headers }, body: JSON.stringify(body) });

test('F-091: a tester link sends reports with pictures from any site; the owner sees them, keeps them, and they go after 30 days', async () => {
  const { env, call, tick } = setup();
  const cookie = `nk_admin=${await newSession(env)}`;
  const made = await (await call('/api/testers', { method: 'POST', headers: { cookie }, body: JSON.stringify({ game: 'critical', label: 'Pixel', hours: 720, page: 'https://badbagel47.github.io/critical/' }) })).json();
  assert.match(made.token, /^pt_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(made.tester.hash, undefined, 'the secret is never shown again');

  // CORS for a page on another site.
  const pre = await call('/playtest/report', { method: 'OPTIONS', headers: { origin: 'https://badbagel47.github.io' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');

  const check = await call('/playtest/check', post({ token: made.token }));
  assert.equal(check.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await check.json(), { game: 'critical', label: 'Pixel', expires: made.tester.expires, reported: [] });
  assert.equal((await call('/playtest/check', post({ token: 'pt_nope.nope' }))).status, 401);

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  const img = await (await call(`/playtest/image?token=${encodeURIComponent(made.token)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg })).json();
  assert.ok(img.id);
  assert.equal((await call('/playtest/image?token=pt_x.y', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg })).status, 401);
  assert.equal((await call(`/playtest/image?token=${encodeURIComponent(made.token)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(401 * 1024) })).status, 413);

  const report = {
    testId: 'F-208', title: 'Standardbasens insida', result: 'partly',
    answers: [{ q: 'Syns ljuset?', a: 'Ja, men för mörkt i källaren' }], text: 'Bra överlag', images: [img.id, 'someoneelse1'],
    context: { url: 'https://badbagel47.github.io/critical/?test&playtest=F-208', device: 'iPad', browser: 'Brave', dpr: 2, errors: ['TypeError: x'], game: { mode: 'base', fps: 58 } },
  };
  const sent = await call('/playtest/report', post({ token: made.token, report }));
  assert.equal(sent.status, 200);
  const { id } = await sent.json();

  const list = await (await call('/api/reports?game=critical', { headers: { cookie } })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].tester, 'Pixel');
  assert.equal(list[0].result, 'partly');
  assert.deepEqual(list[0].images, [img.id], 'only the tester\'s own pictures');
  assert.deepEqual(list[0].context.game, { mode: 'base', fps: 58 });
  const picture = await call(`/api/reports/image/${img.id}`, { headers: { cookie } });
  assert.equal(picture.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await picture.arrayBuffer()), jpeg);
  assert.equal((await call('/api/reports', {})).status, 401, 'the list needs the sign-in');

  assert.deepEqual((await (await call('/playtest/check', post({ token: made.token }))).json()).reported, ['F-208'], 'the panel marks it done');

  // The agent's workflow reads with its key, pictures included.
  assert.equal((await call('/playtest/read?game=critical', { headers: { 'x-playtest-key': 'wrong' } })).status, 403);
  const read = await (await call('/playtest/read?game=critical&since=0', { headers: { 'x-playtest-key': 'read-key' } })).json();
  assert.equal(read[0].pictures[0].data, btoa(String.fromCharCode(...jpeg)));

  // Behåll keeps a report past 30 days.
  const second = await (await call('/playtest/report', post({ token: made.token, report: { testId: 'B-282', result: 'worked' } }))).json();
  const kept = await (await call('/playtest/keep', { method: 'POST', headers: { 'x-playtest-key': 'read-key' }, body: JSON.stringify({ ids: [id] }) })).json();
  assert.equal(kept[id].keep, true, 'the agent can keep a report');
  tick(31 * 86_400_000);
  const later = await (await call('/api/reports', { headers: { cookie } })).json();
  assert.deepEqual(later.map((r) => r.id), [id], 'the one not kept is gone');
  assert.ok(!later.some((r) => r.id === second.id));
  assert.equal((await call(`/api/reports/image/${img.id}`, { headers: { cookie } })).status, 200, 'a kept report keeps its picture');

  // The link is gone when revoked.
  await call(`/api/testers/${made.tester.id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal((await call('/playtest/report', post({ token: made.token, report: {} }))).status, 401);
});

test('F-091: at most 50 kept reports per game', async () => {
  const { store } = setup();
  const pt = store.playtest;
  const { token } = await pt.createTester({ game: 'bricks', hours: 1 });
  const ids = [];
  for (let i = 0; i < KEEP_MAX + 1; i += 1) ids.push((await pt.addReport(token, { testId: `T-${i}`, result: 'worked' })).id);
  for (const id of ids.slice(0, KEEP_MAX)) assert.equal((await pt.setKeep(id, true)).keep, true);
  assert.equal((await pt.setKeep(ids[KEEP_MAX], true)).error, 'keep-full');
  assert.equal((await pt.setKeep(ids[0], false)).keep, false);
  assert.equal((await pt.setKeep(ids[KEEP_MAX], true)).keep, true);
});

test('F-091: a report keeps known fields only, with short texts', () => {
  const r = cleanReport({ result: 'hacked', text: 'x'.repeat(5000), answers: Array(20).fill({ q: 'q', a: 'a' }), context: { game: { deep: { deeper: { deepest: { gone: 1 } } } }, extra: 1 }, extra: 1 });
  assert.equal(r.result, 'note');
  assert.equal(r.text.length, 4000);
  assert.equal(r.answers.length, 12);
  assert.equal(r.extra, undefined);
  assert.deepEqual(r.context.game, { deep: { deeper: { deepest: null } } });
});
