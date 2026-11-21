// Playtest (F-091): tester links, reports, pictures, Behåll and the agent's reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminStore } from '../../admin/store.js';
import { handle } from '../../admin/worker.js';
import { newSession } from '../../admin/auth.js';
import { cleanReport, KEEP_MAX, PlaytestStore } from '../../admin/playtest.js';

const NOW = Date.UTC(2026, 10, 19, 12);

function memory() {
  const data = new Map();
  return {
    data,
    get: async (k) => structuredClone(data.get(k)), put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort().map(([k, v]) => [k, structuredClone(v)])),
    setAlarm: async () => {}, deleteAlarm: async () => {},
  };
}

function setup() {
  let t = NOW;
  const now = () => t;
  const main = new AdminStore({ storage: memory() }, {}, { now });
  const ns = (obj) => ({ idFromName: (n) => n, get: () => ({ fetch: (url, init) => obj.fetch(new Request(url, init)) }) });
  const env = { ADMIN_PASSWORD: 'a long enough password', PLAYTEST_READ_KEY: 'read-key', STORE: ns(main) };
  const pt = new PlaytestStore({ storage: memory() }, env, { now });
  env.PLAYTEST = ns(pt);
  const deps = { fetch: () => { throw new Error('no network'); }, now };
  const call = (path, init = {}) => handle(new Request(`https://admin.example${path}`, init), env, deps);
  return { main, store: pt, env, call, tick: (ms) => { t += ms; } };
}

const post = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://badbagel47.github.io', ...headers }, body: JSON.stringify(body) });

test('F-091: a tester link sends reports with pictures from any site; the owner sees them, keeps them, and they go after 30 days', async () => {
  const { env, call, tick } = setup();
  const cookie = `nk_admin=${await newSession(env)}`;
  const made = await (await call('/api/testers', { method: 'POST', headers: { cookie }, body: JSON.stringify({ game: 'critical', label: 'Pixel', hours: 720, page: 'https://badbagel47.github.io/critical/' }) })).json();
  assert.match(made.token, /^pt_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(made.tester.hash, undefined, 'the secret is never shown again');
  assert.equal((await (await call('/api/log', { headers: { cookie } })).json())[0].text, 'Testarlänk skapad till Pixel för critical', 'written to the owner\'s log in the main store');

  // CORS for a page on another site.
  const pre = await call('/playtest/v1/report', { method: 'OPTIONS', headers: { origin: 'https://badbagel47.github.io' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');

  const check = await call('/playtest/v1/check', post({ token: made.token }));
  assert.equal(check.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await check.json(), { game: 'critical', label: 'Pixel', expires: made.tester.expires, reported: [] });
  assert.equal((await call('/playtest/v1/check', post({ token: 'pt_nope.nope' }))).status, 401);

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  // The token goes in a header (D-111); the query of copies up to 0.16 still works (below).
  const img = await (await call('/playtest/v1/image', { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-playtest-token': made.token }, body: jpeg })).json();
  assert.ok(img.id);
  assert.equal((await call('/playtest/v1/image?token=pt_x.y', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg })).status, 401);
  assert.equal((await call(`/playtest/v1/image?token=${encodeURIComponent(made.token)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(401 * 1024) })).status, 413);

  const report = {
    testId: 'F-208', title: 'Standardbasens insida', result: 'partly',
    answers: [{ q: 'Syns ljuset?', a: 'Ja, men för mörkt i källaren' }], text: 'Bra överlag', images: [img.id, 'someoneelse1'],
    context: { url: 'https://badbagel47.github.io/critical/?test&playtest=F-208', device: 'iPad', browser: 'Brave', dpr: 2, errors: ['TypeError: x'], game: { mode: 'base', fps: 58 } },
  };
  const sent = await call('/playtest/v1/report', post({ token: made.token, report }));
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

  assert.deepEqual((await (await call('/playtest/v1/check', post({ token: made.token }))).json()).reported, ['F-208'], 'the panel marks it done');

  // The agent's workflow reads with its key; pictures one at a time.
  assert.equal((await call('/playtest/v1/read?game=critical', { headers: { 'x-playtest-key': 'wrong' } })).status, 403);
  const read = await (await call('/playtest/v1/read?game=critical&since=0', { headers: { 'x-playtest-key': 'read-key' } })).json();
  assert.deepEqual(read[0].images, [img.id], 'the list names the pictures');
  assert.equal(read[0].pictures, undefined, 'but does not carry them (B-099)');
  const one = await call(`/playtest/v1/read-image?id=${img.id}`, { headers: { 'x-playtest-key': 'read-key' } });
  assert.deepEqual(new Uint8Array(await one.arrayBuffer()), jpeg, 'each picture is read on its own');

  // Playtest Remote gets a key that only sends pictures, for a few hours (B-094).
  const { key } = await (await call('/playtest/v1/upload-key', post({ token: made.token }))).json();
  assert.match(key, /^pu_/);
  const photo = await call(`/playtest/v1/image?token=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg });
  assert.equal(photo.status, 200, 'the upload key sends a picture');
  assert.equal((await call('/playtest/v1/report', post({ token: key, report: {} }))).status, 401, 'but no report');
  assert.equal((await call('/playtest/v1/check', post({ token: key }))).status, 401, 'and does not open the panel');
  tick(7 * 3_600_000); // the tester link (30 days) still works
  assert.equal((await call(`/playtest/v1/image?token=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg })).status, 401, 'it ends after six hours');

  // Behåll keeps a report past 30 days.
  const second = await (await call('/playtest/v1/report', post({ token: made.token, report: { testId: 'B-282', result: 'worked' } }))).json();
  const kept = await (await call('/playtest/v1/keep', { method: 'POST', headers: { 'x-playtest-key': 'read-key' }, body: JSON.stringify({ ids: [id] }) })).json();
  assert.equal(kept[id].keep, true, 'the agent can keep a report');
  tick(31 * 86_400_000);
  const later = await (await call('/api/reports', { headers: { cookie } })).json();
  assert.deepEqual(later.map((r) => r.id), [id], 'the one not kept is gone');
  assert.ok(!later.some((r) => r.id === second.id));
  assert.equal((await call(`/api/reports/image/${img.id}`, { headers: { cookie } })).status, 200, 'a kept report keeps its picture');

  // The link is gone when revoked.
  await call(`/api/testers/${made.tester.id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal((await call('/playtest/v1/report', post({ token: made.token, report: {} }))).status, 401);
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

test('F-121: a scripted test\'s part of the report is kept as plain, short JSON', () => {
  const r = cleanReport({
    result: 'failed',
    script: {
      state: 'hacked', from: 'remote', durationMs: 4200, summary: 's'.repeat(400), extra: 1,
      steps: Array(80).fill({ at: 1, text: 'step' }),
      checks: [{ at: 2, text: 'moved', ok: 1 }, { text: 'x'.repeat(300), ok: 0 }],
      asks: [{ q: 'Smooth?', a: 'Ja' }, { q: 'Odd?', a: '<b>' }],
      measures: { steering: { fps: 58, slowestFrameMs: 40, marks: { draw: { count: 3, avgMs: 2 } } } },
      error: 'e'.repeat(900),
    },
  });
  assert.equal(r.script.state, 'failed');
  assert.equal(r.script.from, 'remote');
  assert.equal(r.script.summary.length, 300);
  assert.equal(r.script.steps.length, 50);
  assert.deepEqual(r.script.checks.map((c) => c.ok), [true, false]);
  assert.equal(r.script.checks[1].text.length, 200);
  assert.deepEqual(r.script.asks.map((a) => a.a), ['Ja', null]);
  assert.equal(r.script.measures.steering.marks.draw.avgMs, 2);
  assert.equal(r.script.error.length, 500);
  assert.equal(r.script.extra, undefined);
  assert.equal(cleanReport({ result: 'worked' }).script, undefined, 'no script part unless sent');
});

test('F-121, owner Q30: the agent makes a tester link with the read key: a day at most, marked, ten a game a day', async () => {
  const { env, call, tick } = setup();
  const ask = (body, key = 'read-key') => call('/playtest/v1/tester', { method: 'POST', headers: { 'x-playtest-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await ask({ game: 'demo', page: 'https://nk-demo.example/' }, 'wrong')).status, 403, 'only with the read key');
  assert.equal((await call('/playtest/v1/tester', post({ game: 'demo' }))).status, 403, 'not from a page');
  const res = await ask({ game: 'demo', page: 'https://nk-demo.example/', hours: 500, label: 'iPad' });
  assert.equal(res.status, 200);
  const made = await res.json();
  assert.match(made.token, /^pt_/);
  assert.equal(made.tester.label, 'Från agenten · iPad');
  assert.equal(made.tester.agent, true);
  assert.equal(made.tester.expires - made.tester.created, 24 * 3_600_000, 'a day at most');
  const check = await (await call('/playtest/v1/check', post({ token: made.token }))).json();
  assert.equal(check.game, 'demo', 'the link works like any tester link');
  const cookie = `nk_admin=${await newSession(env)}`;
  const listed = await (await call('/api/testers', { headers: { cookie } })).json();
  assert.ok(listed.some((t) => t.id === made.tester.id && t.label.startsWith('Från agenten')), 'the owner sees it under Testarlänkar');
  for (let i = 0; i < 9; i += 1) assert.equal((await ask({ game: 'demo', page: 'https://nk-demo.example/' })).status, 200);
  assert.equal((await ask({ game: 'demo', page: 'https://nk-demo.example/' })).status, 429, 'ten a game a day');
  assert.equal((await ask({ game: 'other', page: 'https://other.example/' })).status, 200, 'another game has its own ten');
  assert.equal((await ask({ game: 'Bad Name', page: 'https://x.example/' })).status, 400);
  tick(86_400_001);
  assert.equal((await ask({ game: 'demo', page: 'https://nk-demo.example/' })).status, 200, 'a new day');
});

test('F-110, B-097: every open path refuses a stranger; no room is made without a tester link', async () => {
  const { env, call } = setup();
  let made = 0;
  env.PLAYTEST_ROOMS = { idFromName: (n) => n, get: () => ({ fetch: async () => { made += 1; return Response.json({ code: 'ABCDEF', ownerKey: 'k', keys: {} }); } }) };
  const cases = [
    ['POST', '/playtest/rooms', 401],
    ['POST', '/playtest/rooms//', 404],
    ['POST', '/playtest/rooms/', 404],
    ['POST', '/playtest//rooms', 404],
    ['POST', '/playtest/rooms/ABCDEF', 404],
    ['POST', '/playtest/rooms/ABCDEF/ws', 404],
    ['POST', '/playtest/rooms/lobby', 404],
    ['POST', '/playtest/v1/check', 401],
    ['POST', '/playtest/v1/report', 401],
    ['POST', '/playtest/v1/upload-key', 401],
    ['POST', '/playtest/v1/image?token=pt_x.y', 401],
    ['GET', '/playtest/v1/report', 405],
    ['GET', '/playtest/v1/read', 403],
    ['GET', '/playtest/read', 404], // the unversioned path is gone (F-114)
    ['POST', '/playtest/check', 404],
    ['GET', '/playtest/v1/read-image?id=abcdefgh', 403],
    ['POST', '/playtest/v1/keep', 403],
    ['GET', '/api/testers', 401], ['GET', '/api/reports', 401], ['GET', '/api/reports/image/abcdefgh', 401],
    ['GET', '/api/passes', 401], ['GET', '/api/lobbies', 401], ['GET', '/api/messages', 401], ['GET', '/api/log', 401],
    ['GET', '/api/settings', 401], ['GET', '/api/control', 401], ['GET', '/api/quality', 401], ['GET', '/api/usage', 401],
  ];
  for (const [method, path, status] of cases) {
    const res = await call(path, { method, headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: method === 'POST' ? JSON.stringify({ token: 'pt_x.y', adminPass: 'pt_x.y' }) : undefined });
    assert.equal(res.status, status, `${method} ${path}`);
  }
  assert.equal(made, 0, 'no room was made');
});

test('B-099: pictures are kept apart from their facts, so cleaning reads no picture data', async () => {
  const { store } = setup();
  const pt = store.playtest;
  const { token } = await pt.createTester({ game: 'critical', hours: 1 });
  const ids = [];
  for (let i = 0; i < 300; i += 1) ids.push((await pt.addImage(token, 'image/jpeg', new Uint8Array(1000).fill(i % 255))).id);
  assert.equal(ids.filter(Boolean).length, 100, 'at most 100 pictures a day per tester');
  const metas = [...(await pt.storage.list({ prefix: 'img:' })).values()];
  assert.ok(metas.every((m) => m.data === undefined), 'the list holds no picture data');
  assert.equal((await pt.image(ids[0])).data.length > 1000, true, 'one picture comes with its data');
  await pt.clean();
});

test('F-114: Playtest data left in the main store by 0.14.0 is deleted once', async () => {
  const storage = memory();
  for (const k of ['tst:a', 'rep:1', 'img:x', 'ptn:a:2026-11-19', 'settings']) await storage.put(k, { old: true });
  const main = new AdminStore({ storage }, {}, { now: () => NOW });
  await main.fetch(new Request('https://store/settings'));
  assert.deepEqual([...storage.data.keys()].sort(), ['dropped:playtest-0.14', 'settings']);
});

test('F-092: Playtest Recorder keeps a session in batches; the owner and the agent read it whole; it goes after 30 days unless kept', async () => {
  const { env, call, tick } = setup();
  const cookie = `nk_admin=${await newSession(env)}`;
  const { token } = await (await call('/api/testers', { method: 'POST', headers: { cookie }, body: JSON.stringify({ game: 'demo', label: 'Kväll', hours: 720 }) })).json();
  const session = 'session-abc123';
  const send = (seq, events, extra = {}) => call('/playtest/v1/record', { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://game.example' }, body: JSON.stringify({ token, session, seq, events, ...extra }) });
  assert.equal((await send(0, [{ t: 0, k: 'room', d: { code: 'ABCDEF' } }, { t: 5, k: 'level-start', d: { level: 1 } }], { context: { device: 'iPad', browser: 'Brave' } })).status, 200);
  assert.equal((await send(1, [{ t: 60_000, k: 'perf', d: { fps: 58 } }])).status, 200);
  assert.equal((await send(1, [{ t: 60_000, k: 'perf', d: { fps: 58 } }])).status, 200, 'a batch sent twice counts once');
  assert.equal((await call('/playtest/v1/record', { method: 'POST', body: JSON.stringify({ token: 'pt_x.y', session, seq: 2, events: [] }) })).status, 401);
  assert.equal((await send(9999, [])).status, 400, 'a session has at most 240 batches');

  const list = await (await call('/api/recordings', { headers: { cookie } })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].tester, 'Kväll');
  assert.equal(list[0].events, 3);
  assert.equal(list[0].context.device, 'iPad');
  const whole = await (await call(`/api/recordings/${session}`, { headers: { cookie } })).json();
  assert.deepEqual(whole.events.map((e) => e.k), ['room', 'level-start', 'perf']);
  const read = await (await call(`/playtest/v1/read-recording?id=${session}`, { headers: { 'x-playtest-key': 'read-key' } })).json();
  assert.equal(read.events.length, 3, 'the agent reads it too');
  assert.equal((await call('/playtest/v1/read-recordings', { headers: { 'x-playtest-key': 'nope' } })).status, 403);

  assert.equal((await (await call(`/api/recordings/${session}/keep`, { method: 'POST', headers: { cookie }, body: JSON.stringify({ keep: true }) })).json()).keep, true);
  tick(31 * 86_400_000);
  assert.equal((await (await call('/api/recordings', { headers: { cookie } })).json()).length, 1, 'kept');
  await call(`/api/recordings/${session}/keep`, { method: 'POST', headers: { cookie }, body: JSON.stringify({ keep: false }) });
  tick(61 * 60_000); // cleaning runs once an hour (F-130)
  assert.equal((await (await call('/api/recordings', { headers: { cookie } })).json()).length, 0, 'gone after 30 days');
});

test('F-118, B-123, B-127: Open test needs the key of this switch-on and the game\'s page, gives each visitor a share, and is removed in one go', async () => {
  const { env, call, tick } = setup();
  const cookie = `nk_admin=${await newSession(env)}`;
  const page = { 'content-type': 'text/plain', origin: 'https://bricks.trythis.one', 'cf-connecting-ip': '198.51.100.7' };
  const open = (key, headers = page) => call('/playtest/v1/open', { method: 'POST', headers, body: JSON.stringify({ key }) });
  assert.equal((await open('x')).status, 404, 'off by default');

  const set = await (await call('/api/open-tests', { method: 'POST', headers: { cookie }, body: JSON.stringify({ game: 'bricks', page: 'https://bricks.trythis.one/', hours: 24 }) })).json();
  assert.equal(set.until - NOW, 6 * 3_600_000, 'at most six hours (owner Q6)');
  assert.match(set.key, /^[A-Za-z0-9_-]{12}$/);
  assert.equal((await open('')).status, 404, 'no key, no test (B-123)');
  assert.equal((await open('wrong-key')).status, 404);
  assert.equal((await open(set.key, { ...page, origin: 'https://other.example' })).status, 404, 'only the game\'s own page (B-127)');
  const got = await (await open(set.key)).json();
  assert.equal(got.game, 'bricks');
  const { token } = got;
  assert.equal(token, `pto_bricks.${set.key}`);

  // The game's name alone is not enough any more (B-123).
  assert.equal((await call('/playtest/v1/report', { method: 'POST', headers: page, body: JSON.stringify({ token: 'pto_bricks', report: { result: 'note', text: 'x' } }) })).status, 401);
  assert.equal((await call('/playtest/v1/report', { method: 'POST', headers: { ...page, origin: 'https://other.example' }, body: JSON.stringify({ token, report: { result: 'note', text: 'x' } }) })).status, 401, 'another site\'s page is refused');
  assert.equal((await call('/playtest/v1/report', { method: 'POST', headers: page, body: JSON.stringify({ token, report: { result: 'note', text: 'x'.repeat(17_000) } }) })).status, 413, 'Open test reports are small');

  // A report with an optional name (owner Q8), marked as Open test.
  assert.equal((await call('/playtest/v1/report', { method: 'POST', headers: page, body: JSON.stringify({ token, report: { result: 'failed', text: 'Stuck at level 2', name: 'Kim' } }) })).status, 200);
  const reports = await (await call('/api/reports?game=bricks', { headers: { cookie } })).json();
  assert.equal(reports[0].tester, 'Öppet test · Kim');
  assert.equal(reports[0].open, true);
  // A recording; a name typed later comes with the next batch.
  assert.equal((await call('/playtest/v1/record', { method: 'POST', headers: page, body: JSON.stringify({ token, session: 'open-session-1', seq: 0, events: [{ t: 0, k: 'room', d: null }] }) })).status, 200);
  let recordings = await (await call('/api/recordings?game=bricks', { headers: { cookie } })).json();
  assert.equal(recordings[0].tester, 'Öppet test');
  assert.equal(recordings[0].open, true);
  await call('/playtest/v1/record', { method: 'POST', headers: page, body: JSON.stringify({ token, session: 'open-session-1', seq: 1, events: [{ t: 1, k: 'x', d: null }], name: 'Mobil' }) });
  recordings = await (await call('/api/recordings?game=bricks', { headers: { cookie } })).json();
  assert.equal(recordings[0].tester, 'Öppet test · Mobil');
  // No Playtest Remote: no upload key, no room.
  assert.equal((await call('/playtest/v1/upload-key', { method: 'POST', headers: page, body: JSON.stringify({ token }) })).status, 403);
  let made = 0;
  env.PLAYTEST_ROOMS = { idFromName: (n) => n, get: () => ({ fetch: async () => { made += 1; return Response.json({ code: 'ABCDEF', ownerKey: 'k', keys: {} }); } }) };
  assert.equal((await call('/playtest/rooms', { method: 'POST', headers: page, body: JSON.stringify({ adminPass: token }) })).status, 401);
  assert.equal(made, 0, 'no Remote room for an Open test token');

  // Each visitor a share (B-123): 10 reports a day, then others still can.
  const send = (ip) => call('/playtest/v1/report', { method: 'POST', headers: { ...page, 'cf-connecting-ip': ip }, body: JSON.stringify({ token, report: { result: 'note', text: 'n' } }) });
  let last = 200;
  let sent = 1; // Kim's report above came from this visitor
  while (last === 200 && sent < 30) {
    last = (await send('198.51.100.7')).status;
    if (last === 200) sent += 1;
    tick(1500);
  }
  assert.equal(last, 429);
  assert.equal(sent, 10, 'one visitor sends at most 10 reports a day');
  assert.equal((await send('203.0.113.9')).status, 200, 'another visitor still can');

  // Ta bort allt från Öppet test: the test's reports and recordings, not the tester links'.
  const tester = await (await call('/api/testers', { method: 'POST', headers: { cookie }, body: JSON.stringify({ game: 'bricks', label: 'Ägaren', hours: 24 }) })).json();
  await call('/playtest/v1/report', { method: 'POST', headers: page, body: JSON.stringify({ token: tester.token, report: { result: 'worked', text: 'mine' } }) });
  const removed = await (await call('/api/open-tests/bricks/data', { method: 'DELETE', headers: { cookie } })).json();
  assert.deepEqual(removed, { reports: 11, recordings: 1 });
  const left = await (await call('/api/reports?game=bricks', { headers: { cookie } })).json();
  assert.deepEqual(left.map((r) => r.text), ['mine']);

  // Switched off: the token stops working at once; switched on again, the old key is useless.
  await call('/api/open-tests/bricks', { method: 'DELETE', headers: { cookie } });
  assert.equal((await open(set.key)).status, 404);
  assert.equal((await call('/playtest/v1/record', { method: 'POST', headers: page, body: JSON.stringify({ token, session: 'open-session-1', seq: 2, events: [] }) })).status, 401);
  const again = await (await call('/api/open-tests', { method: 'POST', headers: { cookie }, body: JSON.stringify({ game: 'bricks', page: 'https://bricks.trythis.one/', hours: 1 }) })).json();
  assert.notEqual(again.key, set.key);
  assert.equal((await open(set.key)).status, 404, 'the old addresses are useless');
});
