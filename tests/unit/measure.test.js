// Anonymous measurement of connection quality (F-052): the client's summary,
// the room server's clean-up, and the admin page's store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Measure, deviceClass, quantiles, MEASURE_NOTICE } from '../../src/client/measure.js';
import { cleanSummary } from '../../src/server/measure-check.js';
import { createRoomServer } from '../../src/server/worker.js';
import { AdminStore, quality } from '../../admin/store.js';

const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/27.0 Safari/605.1.15', maxTouchPoints: 5 };
const PIXEL = { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/157.0.0.0 Mobile Safari/537.36', maxTouchPoints: 5 };

test('device class is coarse: kind and browser family only', () => {
  assert.deepEqual(deviceClass(IPAD), { kind: 'tablet', browser: 'safari' });
  assert.deepEqual(deviceClass(PIXEL), { kind: 'phone', browser: 'chrome' });
  assert.match(MEASURE_NOTICE, /anonymously/);
});

test('a summary holds timings and counts, no names or ids', () => {
  let t = 0;
  const sent = [];
  const room = { isHost: false, self: { role: 'player', name: 'Secret Name', id: 'abc123' }, players: [{ role: 'player', name: 'Secret Name' }], room: { phase: 'playing' } };
  const m = new Measure(room, { send: (body, leaving) => sent.push({ body: JSON.parse(body), leaving }), win: null, nav: PIXEL, now: () => t });
  for (let i = 0; i < 5; i++) {
    m.pingSent();
    t += 40 + i;
    m.pongReceived();
    m.hostMessage();
    t += 66;
  }
  m.status('reconnecting');
  t += 2000;
  m.status('online');
  m.hostChanged();
  t += 10_000;
  m.stop('leave');
  assert.equal(sent.length, 1);
  const s = sent[0].body;
  assert.equal(sent[0].leaving, true);
  assert.deepEqual(s.rttMs, { n: 5, p50: 42, p90: 44, max: 44 });
  assert.equal(s.counts.reconnects, 1);
  assert.equal(s.offlineMs.p50, 2000);
  assert.deepEqual(s.device, { kind: 'phone', browser: 'chrome' });
  const text = JSON.stringify(s);
  assert.ok(!text.includes('Secret') && !text.includes('abc123'), 'no names or ids');
  assert.deepEqual(quantiles([]), null);
});

test('the room server keeps only known fields and numbers', () => {
  const s = cleanSummary({
    v: 1, why: 'leave', seconds: 120, device: { kind: 'phone', browser: 'chrome', model: 'Pixel 10' }, network: 'wifi-at-home',
    role: 'player', players: 2, rttMs: { n: 3, p50: 44.4, p90: 'x', max: 90 }, counts: { reconnects: 1, evil: 5 }, name: 'Ada', ip: '1.2.3.4',
  });
  assert.deepEqual(s.device, { kind: 'phone', browser: 'chrome' });
  assert.equal(s.network, 'other');
  assert.deepEqual(s.rttMs, { n: 3, p50: 44, p90: null, max: 90 });
  assert.equal(s.counts.evil, undefined);
  assert.equal(s.name, undefined);
  assert.equal(s.ip, undefined);
  assert.equal(cleanSummary({ v: 2 }), null);
});

test('the game\'s Worker hands a cleaned summary to the admin page', async () => {
  const got = [];
  const env = { ADMIN: { measure: async (game, summary) => got.push({ game, summary }), status: async () => ({ open: true }) } };
  const server = createRoomServer({ admin: { binding: 'ADMIN', game: 'vattigt' } });
  const res = await server.fetch(new Request('https://x/rooms/measure', { method: 'POST', body: JSON.stringify({ v: 1, rttMs: { n: 1, p50: 50, p90: 50, max: 50 }, secret: 'x' }) }), env);
  assert.equal(res.status, 204);
  assert.equal(got.length, 1);
  assert.equal(got[0].game, 'vattigt');
  assert.equal(got[0].summary.secret, undefined);
  const without = createRoomServer({});
  assert.equal((await without.fetch(new Request('https://x/rooms/measure', { method: 'POST', body: '{}' }), {})).status, 204, 'not connected: dropped quietly');
});

test('the admin page keeps summaries a week and shows quality per game', async () => {
  let now = Date.UTC(2026, 10, 18, 12);
  const data = new Map();
  const storage = {
    get: async (k) => data.get(k), put: async (k, v) => void data.set(k, v),
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort()),
  };
  const store = new AdminStore({ storage }, {}, { now: () => now });
  const add = (game, rtt) => store.fetch(new Request('https://store/measure', {
    method: 'POST',
    body: JSON.stringify({ game, summary: cleanSummary({ v: 1, seconds: 300, role: 'player', device: { kind: 'phone', browser: 'chrome' }, rttMs: { n: 10, p50: rtt, p90: rtt * 2, max: rtt * 3 }, counts: { reconnects: 1 } }) }),
  }));
  await add('vattigt', 40);
  await add('vattigt', 60);
  await add('network-kit-demo', 100);
  let q = (await (await store.fetch(new Request('https://store/quality'))).json()).quality;
  assert.equal(q.vattigt.summaries, 2);
  assert.equal(q.vattigt.rttP50, 60);
  assert.equal(q.vattigt.reconnects, 2);
  assert.deepEqual(q.vattigt.devices, { 'phone chrome': 2 });
  now += 8 * 86_400_000;
  await add('vattigt', 50);
  q = (await (await store.fetch(new Request('https://store/quality'))).json()).quality;
  assert.equal(q.vattigt.summaries, 1, 'older than a week: gone');
  assert.equal(q['network-kit-demo'], undefined);
  assert.deepEqual(quality({}), {});
});
