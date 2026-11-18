import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareAnalytics, buildUsage, lastDays, UNNAMED } from '../../admin/analytics.js';
import { LoginGuard, checkPassword, newSession, validSession, readCookie, COOKIE } from '../../admin/auth.js';
import { handle, resetCache, AdminGuard } from '../../admin/worker.js';

const NOW = Date.UTC(2026, 10, 17, 15, 30);
const PASSWORD = 'correct horse battery';
const env0 = { ADMIN_PASSWORD: PASSWORD };

/* ---------- a fake Cloudflare API ---------- */

const obj = (name) => ({ kind: 'OBJECT', name });
const field = (name, type, args = []) => ({ name, type, args });
const list = (t) => ({ kind: 'LIST', ofType: { kind: 'NON_NULL', ofType: t } });

// A schema shaped like Cloudflare's; durable objects report per namespace here.
const TYPES = {
  Query: { fields: [field('viewer', obj('viewer'))] },
  viewer: { fields: [field('accounts', list(obj('account')), [{ name: 'filter', type: obj('AccountFilter') }])] },
  account: {
    fields: [
      field('workersInvocationsAdaptive', list(obj('WIA')), [{ name: 'filter', type: { kind: 'INPUT_OBJECT', name: 'WIAFilter' } }]),
      field('durableObjectsInvocationsAdaptiveGroups', list(obj('DOI')), [{ name: 'filter', type: { kind: 'INPUT_OBJECT', name: 'DOIFilter' } }]),
      field('durableObjectsPeriodicGroups', list(obj('DOP')), [{ name: 'filter', type: { kind: 'INPUT_OBJECT', name: 'DOPFilter' } }]),
      field('durableObjectsStorageGroups', list(obj('DOS')), [{ name: 'filter', type: { kind: 'INPUT_OBJECT', name: 'DOSFilter' } }]),
      field('settings', obj('Settings')),
    ],
  },
  WIA: { fields: [field('sum', obj('WIASum')), field('dimensions', obj('WIADims'))] },
  WIASum: { fields: [field('requests'), field('errors'), field('subrequests')] },
  WIADims: { fields: [field('date'), field('scriptName'), field('datetime')] },
  WIAFilter: { inputFields: [{ name: 'date_geq' }, { name: 'date_leq' }, { name: 'scriptName' }] },
  DOI: { fields: [field('sum', obj('DOISum')), field('dimensions', obj('DOIDims'))] },
  DOISum: { fields: [field('requests'), field('responseBodySize')] },
  DOIDims: { fields: [field('date'), field('scriptName'), field('namespaceId'), field('datetimeHour'), field('type')] },
  DOIFilter: { inputFields: [{ name: 'date_geq' }, { name: 'date_leq' }] },
  DOP: { fields: [field('sum', obj('DOPSum')), field('dimensions', obj('DOPDims'))] },
  DOPSum: { fields: [field('activeTime'), field('cpuTime'), field('rowsRead'), field('rowsWritten'), field('inboundWebsocketMsgCount')] },
  DOPDims: { fields: [field('date'), field('namespaceId')] },
  DOPFilter: { inputFields: [{ name: 'date_geq' }, { name: 'date_leq' }] },
  DOS: { fields: [field('max', obj('DOSMax')), field('dimensions', obj('DOSDims'))] },
  DOSMax: { fields: [field('storedBytes')] },
  DOSDims: { fields: [field('datetimeHour'), field('namespaceId')] },
  DOSFilter: { inputFields: [{ name: 'datetime_geq' }, { name: 'datetime_leq' }] },
};

const ROWS = {
  workersInvocationsAdaptive: [
    { sum: { requests: 1200 }, dimensions: { date: '2026-11-17', scriptName: 'vattigt' } },
    { sum: { requests: 300 }, dimensions: { date: '2026-11-16', scriptName: 'vattigt' } },
    { sum: { requests: 50 }, dimensions: { date: '2026-11-17', scriptName: 'network-kit-demo' } },
    { sum: { requests: 80 }, dimensions: { date: '2026-11-17', scriptName: '__unknown__' } },
  ],
  durableObjectsInvocationsAdaptiveGroups: [
    { sum: { requests: 200 }, dimensions: { date: '2026-11-17', namespaceId: 'ns-vattigt', type: 'http' } },
    { sum: { requests: 3800 }, dimensions: { date: '2026-11-17', namespaceId: 'ns-vattigt', type: 'hibernation' } },
    { sum: { requests: 10 }, dimensions: { date: '2026-11-17', namespaceId: 'ns-gone' } },
  ],
  durableObjectsPeriodicGroups: [
    // 1 hour of one active room = 3,600 s × 0.125 GB = 450 GB-s.
    { sum: { activeTime: 3_600_000_000, rowsRead: 900, rowsWritten: 120, inboundWebsocketMsgCount: 0 }, dimensions: { date: '2026-11-17', namespaceId: 'ns-vattigt' } },
  ],
  durableObjectsStorageGroups: [
    { max: { storedBytes: 5000 }, dimensions: { datetimeHour: '2026-11-17T10:00:00Z', namespaceId: 'ns-vattigt' } },
    { max: { storedBytes: 7000 }, dimensions: { datetimeHour: '2026-11-17T11:00:00Z', namespaceId: 'ns-vattigt' } },
  ],
};

function fakeCloudflare({ failDataset = null } = {}) {
  const calls = [];
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ?? null, auth: init.headers?.authorization });
    if (String(url).endsWith('/graphql')) {
      const { query, variables } = JSON.parse(init.body);
      if (query.includes('__schema')) return reply({ data: { __schema: { queryType: { name: 'Query' } } } });
      if (query.includes('__type')) {
        const t = TYPES[variables.n];
        return reply({ data: { __type: t ? { name: variables.n, fields: t.fields ?? null, inputFields: t.inputFields ?? null } : null } });
      }
      if (query.includes('settings')) return reply({ data: { viewer: { accounts: [{ settings: {} }] } } });
      for (const [name, rows] of Object.entries(ROWS)) {
        if (!query.includes(name)) continue;
        if (name === failDataset) return reply({ errors: [{ message: 'not allowed' }] });
        return reply({ data: { viewer: { accounts: [{ [name]: rows }] } } });
      }
      return reply({ errors: [{ message: 'unknown query' }] });
    }
    if (String(url).includes('/durable_objects/namespaces')) {
      return reply({ success: true, result: [{ id: 'ns-vattigt', script: 'vattigt', class: 'Room' }] });
    }
    if (String(url).includes('/accounts')) return reply({ success: true, result: [{ id: 'acc-1' }] });
    return reply({ success: false, errors: [{ message: 'nope' }] }, 404);
  };
  f.calls = calls;
  return f;
}

/* ---------- usage ---------- */

test('usage is gathered per game from all four datasets', async () => {
  const fetch = fakeCloudflare();
  const usage = await new CloudflareAnalytics({ token: 't', fetch, now: () => NOW }).usage({ days: 31 });
  assert.equal(usage.today, '2026-11-17');
  assert.equal(usage.dates.length, 31);
  assert.deepEqual(usage.available, ['workerRequests', 'doRequests', 'doDuration', 'rowsRead', 'rowsWritten', 'storedBytes']);
  const vattigt = usage.games.find((g) => g.name === 'vattigt');
  assert.equal(vattigt.daily.workerRequests['2026-11-17'], 1200);
  assert.equal(vattigt.daily.workerRequests['2026-11-16'], 300);
  // B-069: 3,800 of the 4,000 room requests were incoming messages to a hibernating room
  // (calls of the kind "hibernation"; Cloudflare reports their message count as 0), which count 1 in 20.
  assert.equal(vattigt.daily.doRequestsAll['2026-11-17'], 4000);
  assert.equal(vattigt.daily.doMessages['2026-11-17'], 3800);
  assert.equal(vattigt.daily.doRequests['2026-11-17'], 200 + 190);
  assert.equal(vattigt.daily.doDuration['2026-11-17'], 450);
  assert.equal(vattigt.daily.rowsWritten['2026-11-17'], 120);
  assert.equal(vattigt.daily.storedBytes['2026-11-17'], 7000, 'the day’s peak, not a sum of hours');
  assert.ok(usage.games.some((g) => g.name === 'network-kit-demo'));
  assert.equal(usage.games.find((g) => g.name === UNNAMED).daily.workerRequests['2026-11-17'], 80, 'requests without a name get their own row');
  assert.ok(usage.games.some((g) => g.name.startsWith('namespace ')), 'an unknown namespace is still shown');
  // The account was looked up with the token, and every call carried it.
  assert.ok(fetch.calls.every((c) => c.auth === 'Bearer t'));
  // A dataset that only filters by datetime is asked with datetimes.
  const roomQuery = fetch.calls.find((c) => c.body?.includes('durableObjectsInvocationsAdaptiveGroups(')).body;
  assert.match(roomQuery, /dimensions \{ date namespaceId type \}/, 'rooms are tied to games through their namespace, split by kind of call');
  const storageQuery = fetch.calls.find((c) => c.body?.includes('durableObjectsStorageGroups(')).body;
  assert.match(storageQuery, /datetime_geq/);
});

test('a dataset that fails leaves a note and the rest still works', async () => {
  const fetch = fakeCloudflare({ failDataset: 'durableObjectsPeriodicGroups' });
  const usage = await new CloudflareAnalytics({ token: 't', accountId: 'acc-9', fetch, now: () => NOW }).usage();
  assert.ok(!usage.available.includes('doDuration'));
  assert.ok(usage.available.includes('doRequests'));
  assert.ok(usage.notes.some((n) => n.includes('durableObjectsPeriodicGroups') && n.includes('not allowed')));
  assert.ok(!fetch.calls.some((c) => c.url.endsWith('/accounts?per_page=5')), 'a given account id is used as is');
});

test('buildUsage ignores days outside the window', () => {
  const dates = lastDays(NOW, 2);
  const shapes = { workers: { day: 'date', owner: 'scriptName', values: { sum: ['requests'] } } };
  const usage = buildUsage({
    now: NOW, dates, shapes,
    results: { workers: [{ sum: { requests: 5 }, dimensions: { date: '2026-10-01', scriptName: 'x' } }] },
  });
  assert.equal(usage.games[0].daily.workerRequests['2026-11-17'], 0);
});

/* ---------- sign-in ---------- */

test('only the right password passes, and a session is signed', async () => {
  assert.equal(await checkPassword(env0, PASSWORD), true);
  assert.equal(await checkPassword(env0, 'correct horse batterY'), false);
  assert.equal(await checkPassword({ ADMIN_PASSWORD: 'short' }, 'short'), false, 'a too short password is never accepted');
  const s = await newSession(env0, NOW);
  assert.equal(await validSession(env0, s, NOW + 1000), true);
  assert.equal(await validSession(env0, s, NOW + 31 * 86_400_000), false, 'sessions expire');
  assert.equal(await validSession({ ADMIN_PASSWORD: 'another long password' }, s, NOW), false, 'a new password signs everybody out');
  const [exp, sig] = s.split('.');
  assert.equal(await validSession(env0, `${Number(exp) + 1}.${sig}`, NOW), false, 'the expiry cannot be changed');
});

test('wrong passwords brake one address, longer each time', async () => {
  const store = new Map();
  const storage = { get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) };
  const guard = new LoginGuard(storage, { freeTries: 3, firstWaitMs: 60_000 });
  assert.equal(await guard.failed(NOW), 0);
  assert.equal(await guard.failed(NOW), 0);
  assert.equal(await guard.failed(NOW), 60_000);
  assert.equal(await guard.waitMs(NOW + 30_000), 30_000);
  assert.equal(await guard.failed(NOW + 60_000), 120_000);
  assert.equal(await guard.waitMs(NOW + 2 * 86_400_000), 0, 'forgotten after a quiet day');
  await guard.succeeded();
  assert.equal(await guard.waitMs(NOW), 0);
});

/* ---------- the Worker ---------- */

function guardNamespace() {
  const objects = new Map();
  return {
    idFromName: (n) => n,
    get: (id) => {
      if (!objects.has(id)) {
        const store = new Map();
        const storage = {
          get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k),
          setAlarm: async (at) => void (storage.alarmAt = at), deleteAlarm: async () => void (storage.alarmAt = null),
          deleteAll: async () => store.clear(), store,
        };
        objects.set(id, new AdminGuard({ storage }));
        objects.get(id).storageForTest = storage;
      }
      const o = objects.get(id);
      return { fetch: (url, init) => o.fetch(new Request(url, init)) };
    },
    objects,
  };
}

const post = (path, form, headers = {}) =>
  new Request(`https://admin.example${path}`, { method: 'POST', body: new URLSearchParams(form), headers: { 'cf-connecting-ip': '1.2.3.4', ...headers } });

test('the usage API needs a session, and signing in gives one', async () => {
  resetCache();
  const env = { ...env0, GUARD: guardNamespace(), CF_ANALYTICS_TOKEN: 't', CF_ACCOUNT_ID: 'acc-1' };
  const deps = { fetch: fakeCloudflare(), now: () => NOW };
  const out = await handle(new Request('https://admin.example/api/usage'), env, deps);
  assert.equal(out.status, 401);
  assert.equal((await out.json()).passwordSet, true);

  const wrong = await handle(post('/login', { username: 'admin', password: 'nope' }), env, deps);
  assert.equal(wrong.status, 303);
  assert.equal(wrong.headers.get('location'), '/?error=wrong');
  assert.equal(wrong.headers.get('set-cookie'), null);

  const ok = await handle(post('/login', { username: 'admin', password: PASSWORD }), env, deps);
  assert.equal(ok.headers.get('location'), '/');
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const value = cookie.split(';')[0].split('=').slice(1).join('=');

  const res = await handle(new Request('https://admin.example/api/usage', { headers: { cookie: `${COOKIE}=${value}` } }), env, deps);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.games.length > 0);
  assert.ok(body.metrics.length === 6);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('sign-in posts from other sites are refused, and repeated wrong passwords must wait', async () => {
  const env = { ...env0, GUARD: guardNamespace() };
  const foreign = await handle(post('/login', { password: PASSWORD }, { origin: 'https://evil.example' }), env);
  assert.equal(foreign.status, 403);
  let last;
  for (let i = 0; i < 5; i++) last = await handle(post('/login', { password: 'nope' }), env);
  assert.match(last.headers.get('location'), /^\/\?error=wait&s=\d+$/);
  const blocked = await handle(post('/login', { password: PASSWORD }), env);
  assert.match(blocked.headers.get('location'), /error=wait/, 'even the right password waits');
  // Another address is not affected.
  const other = await handle(post('/login', { password: PASSWORD }, { 'cf-connecting-ip': '5.6.7.8' }), env);
  assert.equal(other.headers.get('location'), '/');
});

test('without a password or token the page says what is missing', async () => {
  const noPass = await handle(post('/login', { password: 'x' }), { GUARD: guardNamespace() });
  assert.equal(noPass.headers.get('location'), '/?error=notset');
  resetCache();
  const env = { ...env0, GUARD: guardNamespace() };
  const s = await newSession(env);
  const res = await handle(new Request('https://admin.example/api/usage', { headers: { cookie: `${COOKIE}=${s}` } }), env);
  assert.equal((await res.json()).error, 'no-token');
  assert.equal(readCookie(new Request('https://x', { headers: { cookie: `a=1; ${COOKIE}=v.w` } })), 'v.w');
});

test('B-055: the record about an address is deleted a day after its last wrong password', async () => {
  const guards = guardNamespace();
  const env = { ...env0, GUARD: guards };
  await handle(post('/login', { password: 'nope' }), env);
  const guard = guards.objects.get('1.2.3.4');
  const storage = guard.storageForTest;
  assert.ok(storage.store.size > 0, 'the wrong password is remembered');
  assert.ok(storage.alarmAt > Date.now() + 86_000_000, 'until a day later');
  await guard.alarm();
  assert.equal(storage.store.size, 0, 'then forgotten');
});

test('B-069: without the message count every room request counts fully, with a note', () => {
  const dates = ['2026-11-17'];
  const shapes = {
    invocations: { day: 'date', owner: 'scriptName', values: { sum: ['requests'] } },
    periodic: { day: 'date', owner: 'scriptName', values: { sum: ['rowsRead'] } },
  };
  const results = {
    invocations: [{ sum: { requests: 500 }, dimensions: { date: '2026-11-17', scriptName: 'demo' } }],
    periodic: [{ sum: { rowsRead: 1 }, dimensions: { date: '2026-11-17', scriptName: 'demo' } }],
  };
  const usage = buildUsage({ now: NOW, dates, shapes, results });
  assert.equal(usage.games[0].daily.doRequests['2026-11-17'], 500);
  assert.ok(usage.notes.some((n) => /not reported/.test(n)));
  // More messages than requests (figures from two datasets): never below the calls that are not messages.
  shapes.periodic.values.sum.push('inboundWebsocketMsgCount');
  results.periodic[0].sum.inboundWebsocketMsgCount = 900;
  assert.equal(buildUsage({ now: NOW, dates, shapes, results }).games[0].daily.doRequests['2026-11-17'], 25);
});

test('F-078: with keep, the datasets\' fields are asked once a day, and the figures are asked at the same time', async () => {
  const { forgetShapes } = await import('../../admin/analytics.js');
  forgetShapes();
  let t = NOW;
  const fetch = fakeCloudflare();
  const make = () => new CloudflareAnalytics({ token: 't', fetch, now: () => t, keep: true });
  await make().usage({ days: 31 });
  const asked = () => fetch.calls.filter((c) => c.body?.includes('__type')).length;
  const first = asked();
  assert.ok(first > 5, 'the first time, the fields are asked');
  const second = await make().usage({ days: 31 });
  assert.equal(asked(), first, 'not again within a day, also from a new instance');
  assert.equal(second.games.find((g) => g.name === 'vattigt').daily.workerRequests['2026-11-17'], 1200, 'the same figures');
  t += 86_400_001;
  await make().usage({ days: 31 });
  assert.ok(asked() > first, 'asked again after a day');
  forgetShapes();
});
