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

test('F-120: not recording, the Recorder keeps only the last two minutes in memory and sends nothing; Spela in sends them with the start', async () => {
  const { Recorder, LOOKBACK_MS } = await import('../../src/client/recorder.js');
  const sent = [];
  const events = new Map();
  const win = {
    crypto: globalThis.crypto, location: { href: 'https://game.example/?report', search: '?report' }, navigator: { userAgent: 'test' },
    innerWidth: 800, innerHeight: 600, screen: { width: 800, height: 600 },
    addEventListener: (type, fn) => events.set(type, fn), dispatchEvent: () => true, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setInterval: () => 1, clearInterval: () => {}, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const fetchStub = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  const rec = new Recorder({ admin: 'https://admin.example', token: 'pto_demo', open: true, recording: false, window: win, document: null, fetch: fetchStub, badge: false });
  assert.equal(rec.recording, false);
  rec.record('old', { n: 1 });
  rec.events[0].at = Date.now() - LOOKBACK_MS - 5_000; // older than two minutes
  rec.record('just-before', { n: 2 });
  rec.tick();
  assert.equal(sent.length, 0, 'nothing is sent while not recording');
  assert.deepEqual(rec.events.map((e) => e.k), ['just-before'], 'only the last two minutes are kept');
  let told = 0;
  rec.onStart(() => { told += 1; });
  rec.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(told, 1, 'the game is told it records');
  assert.equal(sent.length, 1, 'the look-back goes at once');
  assert.equal(sent[0].seq, 0);
  assert.equal(sent[0].events[0].k, 'just-before');
  assert.ok(sent[0].events[0].t <= 0, 'the look-back is before the start');
  await rec.stop();
  assert.equal(rec.recording, false);
});

test('B-125: the Recorder sends nothing for frame lines alone, pauses when the day is full and stops for good when refused', async () => {
  const { Recorder } = await import('../../src/client/recorder.js');
  let status = 200;
  let sent = 0;
  const win = {
    crypto: globalThis.crypto, location: { href: 'https://game.example/', search: '' }, navigator: { userAgent: 'test' },
    innerWidth: 800, innerHeight: 600, screen: { width: 800, height: 600 },
    addEventListener: () => {}, dispatchEvent: () => true, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {}, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const fetchStub = async () => { sent += 1; return new Response('{}', { status }); };
  const rec = new Recorder({ admin: 'https://admin.example', token: 'pt_a.b', window: win, document: null, fetch: fetchStub, badge: false });
  rec.events.push({ at: Date.now(), k: 'perf', d: { fps: 60 } });
  assert.equal(await rec.flush(), false);
  assert.equal(sent, 0, 'a frame line alone is not sent');
  rec.record('level-start', { level: 1 });
  status = 429;
  await rec.flush();
  assert.equal(rec.full, true, 'the day is full');
  rec.record('death', {});
  await rec.flush();
  assert.equal(sent, 1, 'nothing more is sent once full');

  let stopped = 0;
  const other = new Recorder({ admin: 'https://admin.example', token: 'pto_x.y', open: true, window: win, document: null, fetch: fetchStub, badge: false });
  other.onStop(() => { stopped += 1; });
  status = 401;
  other.record('room', {});
  await other.flush();
  assert.equal(other.closed, true, 'refused: stopped for good');
  assert.equal(other.recording, false);
  assert.equal(stopped, 1, 'the game is told, so the others are too');
});

test('B-131, B-132: recorded data is copied at once, never throws, is capped; large batches are split; a lost batch is marked', async () => {
  const { Recorder } = await import('../../src/client/recorder.js');
  const bodies = [];
  let status = 200;
  const win = {
    crypto: globalThis.crypto, location: { href: 'https://game.example/', search: '' }, navigator: { userAgent: 'test' },
    innerWidth: 800, innerHeight: 600, screen: { width: 800, height: 600 },
    addEventListener: () => {}, dispatchEvent: () => true, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {}, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const fetchStub = async (url, init) => { bodies.push(init.body); return new Response('{}', { status }); };
  const rec = new Recorder({ admin: 'https://admin.example', token: 'pt_a.b', window: win, document: null, fetch: fetchStub, badge: false });
  const live = { hp: 3 };
  rec.record('hit', live);
  live.hp = 0;
  const loop = {};
  loop.self = loop;
  rec.record('loop', loop);
  rec.record('big', { text: 'x'.repeat(5000) });
  for (let i = 0; i < 60; i += 1) rec.record('filler', { text: 'y'.repeat(1500) });
  await rec.flush();
  const sent = bodies.map((b) => JSON.parse(b));
  assert.ok(sent.length >= 2, 'split into several batches');
  assert.ok(bodies.every((b) => b.length < 64 * 1024), 'each under the beacon\'s limit');
  const all = sent.flatMap((b) => b.events);
  assert.deepEqual(all.find((e) => e.k === 'hit').d, { hp: 3 }, 'the value when recorded');
  assert.deepEqual(all.find((e) => e.k === 'loop').d, { notJson: true });
  assert.ok(all.find((e) => e.k === 'big').d.tooLarge > 2048, 'capped');
  status = 500;
  rec.record('lost-one', {});
  await rec.flush();
  status = 200;
  rec.record('next', {});
  await rec.flush();
  const last = JSON.parse(bodies[bodies.length - 1]);
  assert.equal(last.events[0].k, 'lost', 'the lost batch is marked first');
});

// ---- F-121: scripted tests

import { ScriptRun, codeOf, findControl } from '../../src/client/playtest-script.js';

function scriptWindow() {
  const sent = [];
  class KeyboardEvent { constructor(type, init) { Object.assign(this, init, { type }); } }
  let frame = 0;
  const win = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    KeyboardEvent,
    requestAnimationFrame: (fn) => setTimeout(() => fn((frame += 16)), 4),
    performance: { now: () => 0, getEntriesByType: () => [{ name: 'draw', startTime: 5, duration: 2 }, { name: 'draw', startTime: 6, duration: 4 }] },
  };
  const body = { dispatchEvent: (e) => sent.push(`${e.type}:${e.key}:${e.code}`) };
  const doc = { body, querySelector: () => null, querySelectorAll: () => [] };
  return { win, doc, sent };
}

test('F-121: a script steps, presses keys, checks, measures and asks; the report says what happened', async () => {
  const { win, doc, sent } = scriptWindow();
  const asked = [];
  let x = 0;
  const item = {
    id: 'G-1',
    run: async (t) => {
      t.step('Steer');
      await t.key('ArrowRight', { hold: 5 });
      x = 20;
      await t.wait(() => x > 10);
      t.check(x > 10, 'moved right');
      t.check(false, 'a check that fails');
      const m = await t.measure('steering', 60);
      t.check(m.fps > 0, 'frames counted');
      assert.equal(m.marks.draw.count, 2);
      assert.equal(m.marks.draw.avgMs, 3);
      assert.equal(await t.ask('Smooth?'), true);
      t.note('done');
    },
  };
  const run = await new ScriptRun({ item, win, doc, ui: { ask: async (q) => { asked.push(q); return true; } } }).go();
  assert.deepEqual(sent, ['keydown:ArrowRight:ArrowRight', 'keyup:ArrowRight:ArrowRight']);
  assert.deepEqual(asked, ['Smooth?']);
  assert.equal(run.state, 'done');
  assert.equal(run.result, 'failed', 'a failed check fails the test');
  const report = run.toReport('remote');
  assert.equal(report.from, 'remote');
  assert.deepEqual(report.steps.map((s) => s.text), ['Steer']);
  assert.deepEqual(report.checks.map((c) => c.ok), [true, false, true]);
  assert.deepEqual(report.asks.map((a) => a.a), ['Ja']);
  assert.ok(report.measures.steering.frames > 0);
  assert.match(report.summary, /2 av 3 kontroller/);
  assert.equal(codeOf('w'), 'KeyW');
  assert.equal(codeOf(' '), 'Space');
});

test('F-121: a script that throws fails with its reason, a Nej fails, a stop cancels and lets go of held keys', async () => {
  const { win, doc, sent } = scriptWindow();
  const thrown = await new ScriptRun({ item: { run: async (t) => { await t.wait(() => false, { timeout: 30, what: 'the door' }); } }, win, doc, ui: {} }).go();
  assert.equal(thrown.state, 'failed');
  assert.match(thrown.error, /the door/);
  const no = await new ScriptRun({ item: { run: async (t) => { await t.ask('Right?'); } }, win, doc, ui: { ask: async () => false } }).go();
  assert.equal(no.result, 'failed');
  const passed = await new ScriptRun({ item: { run: async (t) => { t.check(true, 'ok'); } }, win, doc, ui: {} }).go();
  assert.equal(passed.result, 'worked');
  const long = new ScriptRun({ item: { run: async (t) => { t.keyDown('d'); await t.wait(10_000); } }, win, doc, ui: {} });
  const going = long.go();
  setTimeout(() => long.stop(), 20);
  await going;
  assert.equal(long.state, 'stopped');
  assert.equal(long.result, 'cancelled');
  assert.deepEqual(sent.slice(-2), ['keydown:d:KeyD', 'keyup:d:KeyD'], 'a key held by the script is let go');
});

test('F-121: a control is found by its text, aria-label or a selector, never inside the panel', () => {
  const button = (text, extra = {}) => ({ textContent: text, hidden: false, disabled: false, closest: () => null, getClientRects: () => [1], getAttribute: (k) => extra[k] ?? null, ...extra });
  const start = button(' Start ');
  const inPanel = button('Start');
  const icon = button('', { 'aria-label': 'Pause' });
  const panel = { contains: (e) => e === inPanel };
  const doc = { querySelectorAll: (sel) => (sel.startsWith('#') ? [icon] : [inPanel, start, icon]) };
  assert.equal(findControl(doc, 'start', panel), start);
  assert.equal(findControl(doc, 'Pause', panel), icon);
  assert.equal(findControl(doc, '#pause', panel), icon);
  assert.equal(findControl(doc, 'Missing', panel), null);
});
