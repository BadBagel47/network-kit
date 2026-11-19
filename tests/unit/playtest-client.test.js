// Playtest's client helpers (F-091); the panel itself is tested in Chromium (tests/browser/playtest.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTesterLink, questionsOf, withTest, describeDevice, ReportSender } from '../../src/client/playtest.js';

test('F-091: the tester link, the questions and the start address', () => {
  assert.equal(readTesterLink('#nk-tester=pt_abc.DEF-_1'), 'pt_abc.DEF-_1');
  assert.equal(readTesterLink('#x=1&nk-tester=pt_a.b'), 'pt_a.b');
  assert.equal(readTesterLink('#nk-admin=x'), null);
  assert.deepEqual(questionsOf({ ask: 'One?' }), ['One?']);
  assert.deepEqual(questionsOf({ ask: ['One?', 'Two?'] }), ['One?', 'Two?']);
  assert.deepEqual(questionsOf({ questions: ['Q'], ask: 'ignored' }), ['Q']);
  assert.deepEqual(questionsOf({}), []);
  assert.equal(withTest('./?test&call=siege', 'F-279', 'https://x.example/critical/playtest.html'), 'https://x.example/critical/?test=&call=siege&playtest=F-279');
});

test('F-091: device and browser in plain words', () => {
  assert.deepEqual(describeDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5 }).device, 'iPad');
  assert.equal(describeDevice({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36', brave: {} }).browser, 'Brave');
  assert.equal(describeDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36' }).device, 'Android phone');
});

test('F-091: a report that cannot be sent is kept and sent later; a refused link is not kept', async () => {
  const kept = new Map();
  const storage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v), removeItem: (k) => kept.delete(k) };
  let online = false;
  const posted = [];
  const fetchStub = async (url, init) => {
    if (!online) throw new TypeError('offline');
    if (url.includes('/playtest/v1/report')) posted.push(JSON.parse(init.body).report);
    return new Response(JSON.stringify({ id: 'r1' }), { status: 200 });
  };
  const sender = new ReportSender({ admin: 'https://admin.example/', token: 'pt_a.b', storage, fetch: fetchStub });
  assert.deepEqual(await sender.send({ testId: 'T-1', result: 'worked' }), { sent: false, queued: true });
  assert.equal(JSON.parse(kept.get('nk-playtest:queue')).length, 1);
  online = true;
  assert.equal(await sender.flush(), 0);
  assert.equal(posted[0].testId, 'T-1');
  assert.equal(kept.has('nk-playtest:queue'), false);

  const refused = new ReportSender({ admin: 'https://admin.example', token: 'pt_x.y', storage, fetch: async () => new Response('{}', { status: 401 }) });
  assert.deepEqual(await refused.send({ testId: 'T-2', result: 'failed' }), { sent: false, error: 401 });
  assert.equal(kept.has('nk-playtest:queue'), false);
});

test('F-096: the light entry loads nothing without a tester link', async () => {
  const { hasTesterLink, startPlaytest } = await import('../../src/client/playtest-entry.js');
  const store = (v) => ({ getItem: () => v });
  assert.equal(hasTesterLink({ location: { hash: '' }, localStorage: store(null) }), false);
  assert.equal(hasTesterLink({ location: { hash: '#nk-tester=pt_a.b' }, localStorage: store(null) }), true);
  assert.equal(hasTesterLink({ location: { hash: '' }, localStorage: store('"pt_a.b"') }), true);
  assert.equal(await startPlaytest({ admin: 'https://x', window: { location: { hash: '' }, localStorage: store(null) } }), null);
});

test('F-092: the Recorder sends batches with the game\'s events, the room\'s and the page\'s errors; a closing page sends with a beacon', async () => {
  const { Recorder } = await import('../../src/client/recorder.js');
  const sent = [];
  const beacons = [];
  const listeners = new Map();
  const win = {
    crypto: globalThis.crypto, location: { href: 'https://game.example/', search: '' }, navigator: { userAgent: 'test', sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } },
    innerWidth: 800, innerHeight: 600, screen: { width: 800, height: 600 }, devicePixelRatio: 2,
    addEventListener: (type, fn) => listeners.set(type, fn), setInterval: () => 1, clearInterval: () => {},
  };
  const fetchStub = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); };
  const rec = new Recorder({ admin: 'https://admin.example/', token: 'pt_a.b', version: 'v1', window: win, document: null, fetch: fetchStub, badge: false });
  const handlers = new Map();
  const room = { code: 'ABCDEF', me: 'p1', on: (type, fn) => handlers.set(type, fn) };
  rec.attach(room);
  rec.record('level-start', { level: 2 });
  handlers.get('peer')({ event: 'join', id: 'p2' });
  handlers.get('status')('reconnecting');
  listeners.get('error')({ message: 'boom', filename: 'https://game.example/app.js', lineno: 12 });
  await rec.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://admin.example/playtest/v1/record');
  const first = sent[0].body;
  assert.equal(first.seq, 0);
  assert.equal(first.token, 'pt_a.b');
  assert.equal(first.context.version, 'v1');
  assert.deepEqual(first.events.map((e) => e.k), ['room', 'level-start', 'room-peer', 'room-status', 'error']);
  assert.equal(await rec.flush(), false, 'nothing new, nothing sent');
  rec.record('death', { by: 'wind' });
  listeners.get('pagehide')();
  assert.equal(beacons.length, 1, 'the last batch goes with a beacon');
  assert.equal(JSON.parse(await beacons[0].blob.text()).seq, 1);
});
