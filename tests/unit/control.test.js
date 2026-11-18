// The admin page's controls (F-003, F-004, F-008, F-026): settings, shares,
// budget, cost, and what rooms do with the admin page's word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, shares, budgetState, gameStatus, estimateCost, gameNotices, NOTICE_TEXT } from '../../admin/control.js';
import { AdminStore } from '../../admin/store.js';
import { buildUsage, lastDays } from '../../admin/analytics.js';
import { createRoomServer } from '../../src/server/worker.js';
import { gameClosedText, CLOSE } from '../../src/shared/protocol.js';
import { connect, cmd } from './fake-host.js';
import { setup, CREW } from './setup.js';

const NOW = Date.UTC(2026, 10, 18, 12);
const usageWith = (perGame) => {
  const dates = lastDays(NOW, 31);
  const shapes = { workers: { day: 'date', owner: 'scriptName', values: { sum: ['requests'] } } };
  const rows = Object.entries(perGame).map(([name, n]) => ({ sum: { requests: n }, dimensions: { date: '2026-11-18', scriptName: name } }));
  return buildUsage({ now: NOW, dates, shapes, results: { workers: rows } });
};

test('settings are cleaned; closing automatically is off unless turned on', () => {
  const s = normalizeSettings({ account: { plan: 'weird', capUsd: '7' }, games: { vattigt: { mode: 'until', until: '2026-11-19T06:00:00Z', share: 150 }, 'Bad Name!': {} } });
  assert.deepEqual(s.account, { plan: 'free', capUsd: 7, autoClose: false });
  assert.deepEqual(Object.keys(s.games), ['vattigt']);
  assert.equal(s.games.vattigt.share, 100);
});

test('Q5: games without a share split the rest equally', () => {
  const s = normalizeSettings({ games: { a: { share: 50 } } });
  assert.deepEqual(shares(s, ['a', 'b', 'c']), { a: 50, b: 25, c: 25 });
  assert.deepEqual(shares(normalizeSettings({}), ['x', 'y']), { x: 50, y: 50 });
});

test('F-004: a game over its share is closed for the day only when automatic closing is on', () => {
  const usage = usageWith({ vattigt: 60_000, 'network-kit-demo': 10_000 });
  const off = normalizeSettings({});
  const budget = budgetState(off, usage);
  assert.match(budget.over.vattigt, /Worker requests/);
  assert.equal(budget.over['network-kit-demo'], undefined);
  assert.equal(gameStatus(off, budget, 'vattigt', NOW).open, true, 'shown, not acted on');
  const on = normalizeSettings({ account: { autoClose: true } });
  const closed = gameStatus(on, budgetState(on, usage), 'vattigt', NOW);
  assert.deepEqual([closed.open, closed.reason, closed.until], [false, 'budget', '2026-11-19T00:00:00.000Z']);
  assert.equal(gameStatus(on, budgetState(on, usage), 'vattigt', NOW + 86_400_000).open, true, 'open again the next day');
});

test('F-003: off, until, private only and an emergency stop', () => {
  const s = normalizeSettings({ games: {
    a: { mode: 'off' }, b: { mode: 'until', until: '2026-11-18T18:00:00Z' }, c: { privateOnly: true }, d: { stopped: true, mode: 'on' },
  } });
  assert.equal(gameStatus(s, null, 'a', NOW).reason, 'off');
  assert.equal(gameStatus(s, null, 'b', NOW).reason, 'until');
  assert.equal(gameStatus(s, null, 'b', Date.parse('2026-11-18T19:00:00Z')).open, true);
  assert.deepEqual([gameStatus(s, null, 'c', NOW).open, gameStatus(s, null, 'c', NOW).privateOnly], [true, true]);
  assert.deepEqual([gameStatus(s, null, 'd', NOW).reason, gameStatus(s, null, 'd', NOW).stopped], ['stopped', true]);
  assert.equal(gameStatus(s, null, 'unknown', NOW).open, true);
});

test('F-008: the cost on the Paid plan, and the monthly cap', () => {
  assert.equal(estimateCost({}).usd, 5);
  const c = estimateCost({ workerRequests: 20_000_000, doDuration: 1_400_000 });
  assert.equal(c.usd, 5 + 3 + 12.5);
  const usage = usageWith({ vattigt: 30_000_000 });
  const paid = normalizeSettings({ account: { plan: 'paid', capUsd: 10, autoClose: true } });
  const b = budgetState(paid, usage);
  assert.equal(b.cost.usd, 11);
  assert.match(b.over.vattigt, /cap/);
  assert.equal(gameStatus(paid, b, 'vattigt', NOW).reason, 'budget');
});

test('F-026: players are told why in plain words', () => {
  assert.equal(gameClosedText('stopped'), 'The game was stopped by its owner.');
  assert.match(gameClosedText('budget', '2026-11-19T00:00:00Z'), /used up today's free quota\. It opens again at /);
  assert.equal(gameClosedText('something-else'), null);
});

test('the store keeps settings and turns the budget check on and off', async () => {
  const data = new Map();
  let alarm = null;
  const storage = {
    get: async (k) => data.get(k), put: async (k, v) => void data.set(k, v),
    list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix))),
    setAlarm: async (at) => void (alarm = at), deleteAlarm: async () => void (alarm = null),
  };
  const usage = usageWith({ vattigt: 90_000 });
  const store = new AdminStore({ storage }, {}, { now: () => NOW, analytics: { usage: async () => usage } });
  const put = (body) => store.fetch(new Request('https://store/settings', { method: 'PUT', body: JSON.stringify(body) }));
  await put({ account: { autoClose: true }, games: { vattigt: { share: 50 } } });
  assert.ok(alarm, 'the budget is read every few minutes while closing is on');
  await store.alarm();
  const status = await (await store.fetch(new Request('https://store/status?game=vattigt'))).json();
  assert.equal(status.reason, 'budget');
  await put({ account: { autoClose: false } });
  assert.equal(alarm, null);
  assert.equal((await (await store.fetch(new Request('https://store/status?game=vattigt'))).json()).open, true);
});

// ------------------------------------------------- in the rooms (F-003)

test('F-003: a closed game turns newcomers away, lets those already in come back, and refuses a new round', async () => {
  const { world, core, owner } = await setup(CREW);
  const a = await connect(world, core, { name: 'A' });
  world.word = { open: false, reason: 'until', until: '2026-11-19T06:00:00Z', privateOnly: false, stopped: false };
  core.host = world.host();
  const late = await connect(world, core, { name: 'Late' });
  assert.equal(late.closedWith.code, CLOSE.GAME_CLOSED);
  assert.deepEqual(late.last('denied'), { t: 'denied', code: CLOSE.GAME_CLOSED, reason: 'until', until: '2026-11-19T06:00:00Z' });
  const back = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(back.id, a.id, 'an admitted participant comes back');
  await cmd(core, owner, 'start');
  assert.equal(owner.last('err').code, 'game-closed');
  assert.equal(core.state.phase, 'lobby');
});

test('F-003: private only lets only invitation links in; an emergency stop closes running rooms', async () => {
  const { world, core, owner, created } = await setup(CREW);
  world.word = { open: true, reason: null, privateOnly: true, stopped: false };
  core.host = world.host();
  const noKey = await connect(world, core, { name: 'NoKey' });
  assert.equal(noKey.closedWith.code, CLOSE.KEY);
  const withKey = await connect(world, core, { name: 'Invited', key: created.keys.player.k });
  assert.ok(withKey.id);
  await cmd(core, owner, 'start');
  world.word = { open: false, reason: 'stopped', stopped: true, privateOnly: false };
  core.host = world.host();
  await world.advance(31_000);
  await cmd(core, owner, 'pause');
  assert.equal(core.state.closed?.reason, 'stopped');
  assert.equal(withKey.closedWith.code, CLOSE.GAME_CLOSED);
});

test('F-003: a closed game refuses new rooms at the Worker; an unreachable admin page leaves it open', async () => {
  const env = (status) => ({
    ROOMS: { idFromName: (n) => n, get: () => ({ fetch: async () => Response.json({ code: 'ABCD', ownerKey: 'k', keys: {} }) }) },
    ADMIN: { status: async () => { if (status instanceof Error) throw status; return status; } },
  });
  const server = createRoomServer({ admin: { binding: 'ADMIN', game: 'vattigt' } });
  const closed = await server.fetch(new Request('https://x/rooms', { method: 'POST', body: '{}' }), env({ open: false, reason: 'budget', until: 'u' }));
  assert.equal(closed.status, 503);
  assert.deepEqual(await closed.json(), { error: 'budget', until: 'u' });
  const server2 = createRoomServer({ admin: { binding: 'ADMIN', game: 'vattigt' } });
  const open = await server2.fetch(new Request('https://x/rooms', { method: 'POST', body: '{}' }), env(new Error('down')));
  assert.equal(open.status, 200);
});

// ------------------------------------------------- F-057 modes, F-058 admin passes

test('F-057: a mode can be closed on its own; it never opens what the game has closed', () => {
  const s = normalizeSettings({ games: { bricks: { modes: { solo: { mode: 'off' }, duo: { mode: 'until', until: '2026-11-18T18:00:00Z' }, 'Bad!': {} } } } });
  assert.deepEqual(Object.keys(s.games.bricks.modes), ['solo', 'duo']);
  assert.equal(gameStatus(s, null, 'bricks', NOW, 'solo').reason, 'off');
  assert.equal(gameStatus(s, null, 'bricks', NOW, 'duo').reason, 'until');
  assert.equal(gameStatus(s, null, 'bricks', NOW).open, true, 'the game itself is open');
  const off = normalizeSettings({ games: { bricks: { mode: 'off', modes: { solo: { mode: 'on' } } } } });
  assert.equal(gameStatus(off, null, 'bricks', NOW, 'solo').open, false);
});

function storeWith(now = () => NOW) {
  const data = new Map();
  const storage = {
    get: async (k) => data.get(k), put: async (k, v) => void data.set(k, v),
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort()),
    setAlarm: async () => {}, deleteAlarm: async () => {},
  };
  return new AdminStore({ storage }, {}, { now });
}

test('F-058: an admin pass is for one game, lasts 30 days and can be revoked', async () => {
  let t = NOW;
  const store = storeWith(() => t);
  const call = async (path, method = 'GET', body) => (await store.fetch(new Request(`https://store${path}`, { method, body: body && JSON.stringify(body) }))).json();
  const { token, pass } = await call('/passes', 'POST', { game: 'bricks', label: 'Pixel' });
  assert.match(token, /^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(pass.hash, undefined, 'the secret is not shown again');
  assert.equal((await call('/check-pass', 'POST', { game: 'bricks', token })).valid, true);
  assert.equal((await call('/check-pass', 'POST', { game: 'vattigt', token })).valid, false, 'one game only');
  assert.equal((await call('/check-pass', 'POST', { game: 'bricks', token: `${token}x` })).valid, false);
  const list = await call('/passes');
  assert.deepEqual(list.map((p) => [p.game, p.label]), [['bricks', 'Pixel']]);
  assert.equal(list[0].hash, undefined);
  await call(`/passes/${pass.id}`, 'DELETE');
  assert.equal((await call('/check-pass', 'POST', { game: 'bricks', token })).valid, false, 'revoked');
  const second = await call('/passes', 'POST', { game: 'bricks' });
  t += 31 * 86_400_000;
  assert.equal((await call('/check-pass', 'POST', { game: 'bricks', token: second.token })).valid, false, 'expired');
});

test('F-058: with an admin pass the owner creates, joins and starts while public play is off, not after a stop', async () => {
  const { world, core, owner } = await setup(CREW);
  world.word = { open: false, reason: 'off', until: null, privateOnly: false, stopped: false };
  core.host = { ...world.host(), checkAdminPass: async (t) => t === 'good.pass-xxxxxxxxxxxxxxxxxxxxx' };
  const stranger = await connect(world, core, { name: 'Stranger' });
  assert.equal(stranger.closedWith.code, CLOSE.GAME_CLOSED);
  const ws = new (await import('./fake-host.js')).FakeSocket('Admin');
  world.socketList.push(ws);
  core.opened(ws);
  await core.message(ws, JSON.stringify({ t: 'hello', v: 3, pk: 'admin-player-key-xxxxxxx', sid: 's1', name: 'Admin', adminPass: 'good.pass-xxxxxxxxxxxxxxxxxxxxx' }));
  assert.ok(ws.last('welcome'), 'the admin gets in');
  await cmd(core, owner, 'start');
  assert.equal(owner.last('err').code, 'game-closed', 'the owner of the room has no pass');
  await cmd(core, owner, 'handover', { id: ws.last('welcome').you.id }); // the admin runs the game now
  await core.message(ws, JSON.stringify({ t: 'cmd', n: 2, c: 'host-ready' }));
  await core.message(ws, JSON.stringify({ t: 'cmd', n: 3, c: 'start' }));
  assert.notEqual(core.state.phase, 'lobby', 'the admin starts the round');
  world.word = { open: false, reason: 'stopped', stopped: true, privateOnly: false };
  core.host = { ...world.host(), checkAdminPass: async () => true };
  const again = await connect(world, core, { name: 'Late' });
  assert.equal(again.closedWith.code, CLOSE.GAME_CLOSED, 'a stop stops everyone');
});

test('F-057, F-058: pages ask whether a mode is open without waking a room; a pass opens it', async () => {
  const asked = [];
  const env = {
    ROOMS: { idFromName: () => { throw new Error('no room may be woken'); } },
    ADMIN: {
      status: async (game, mode) => (asked.push([game, mode]), mode === 'solo' ? { open: false, reason: 'off', until: null, stopped: false } : { open: true }),
      checkPass: async (game, token) => token === 'ok.token-xxxxxxxxxxxxxxxxxxxxxxx',
    },
  };
  const server = createRoomServer({ admin: { binding: 'ADMIN', game: 'bricks', mode: 'duo' } });
  const solo = await (await server.fetch(new Request('https://x/rooms/status?mode=solo'), env)).json();
  assert.deepEqual(solo, { open: false, reason: 'off', until: null, notices: [] });
  const withPass = await (await server.fetch(new Request('https://x/rooms/status?mode=solo', { headers: { 'x-admin-pass': 'ok.token-xxxxxxxxxxxxxxxxxxxxxxx' } }), env)).json();
  assert.deepEqual(withPass, { open: true, reason: 'admin', until: null, notices: [] });
  assert.deepEqual(asked[0], ['bricks', 'solo']);
  // Creating a room asks for the rooms' own mode.
  env.ROOMS = { idFromName: (n) => n, get: () => ({ fetch: async () => Response.json({ code: 'ABCDEF', ownerKey: 'k', keys: {} }) }) };
  await server.fetch(new Request('https://x/rooms', { method: 'POST', body: '{}' }), env);
  assert.deepEqual(asked.at(-1), ['bricks', 'duo']);
});

// ------------------------------------------------- notices (F-065, F-066)

test('F-065: players are warned at 90 % of the share, and told when the game has closed for the day', () => {
  const on = normalizeSettings({ account: { autoClose: true }, games: { vattigt: { share: 50 }, demo: { share: 50 } } });
  // Worker requests: 100k a day, so each game may use 50k; 46k is past 90 %.
  const budget = budgetState(on, usageWith({ vattigt: 46_000, demo: 10_000 }));
  assert.match(budget.near.vattigt, /Worker requests/);
  assert.equal(budget.near.demo, undefined);
  const [soon] = gameNotices(on, budget, 'vattigt', NOW);
  assert.equal(soon.kind, 'budget-soon');
  assert.equal(soon.id, 'budget-soon-2026-11-18', 'once per day');
  assert.equal(soon.until, '2026-11-19T00:00:00.000Z');
  assert.match(soon.text, /\{until\}/);
  assert.deepEqual(gameNotices(on, budget, 'demo', NOW), []);
  const over = budgetState(on, usageWith({ vattigt: 51_000 }));
  assert.equal(over.near.vattigt, undefined, 'past the share it is closed, not near');
  assert.equal(gameNotices(on, over, 'vattigt', NOW)[0].kind, 'budget-closed');
  // Without Cloudflare limiting nothing closes, so nobody is warned.
  assert.deepEqual(gameNotices(normalizeSettings({}), budget, 'vattigt', NOW), []);
  // A budget from yesterday says nothing about today.
  assert.deepEqual(gameNotices(on, { ...budget, day: '2026-11-17' }, 'vattigt', NOW), []);
});

test('F-065: on the Paid plan players are warned when the month nears the cap', () => {
  const paid = normalizeSettings({ account: { autoClose: true, plan: 'paid', capUsd: 5 } });
  const budget = budgetState(paid, usageWith({ vattigt: 10 }));
  assert.equal(budget.cost.usd, 5, 'the base price');
  assert.ok(budget.over.vattigt, 'the cap is reached at 5 USD');
  const higher = budgetState(normalizeSettings({ account: { autoClose: true, plan: 'paid', capUsd: 5.5 } }), usageWith({ vattigt: 10 }));
  assert.ok(higher.near.vattigt, '5 of 5.5 is past 90 %');
});

test("F-066: the owner's messages reach one game or every game until they end, and can be removed", async () => {
  let t = NOW;
  const store = storeWith(() => t);
  const call = async (path, method = 'GET', body) => (await store.fetch(new Request(`https://store${path}`, { method, body: body && JSON.stringify(body) }))).json();
  const one = await call('/messages', 'POST', { game: 'bricks', text: '  Server  update tonight ', minutes: 30, level: 'warning' });
  assert.equal(one.text, 'Server update tonight');
  t += 1_000;
  await call('/messages', 'POST', { game: '*', text: 'Hello everyone', minutes: 120 });
  assert.equal((await call('/messages', 'POST', { game: 'Bad!', text: 'x' })).error, 'bad-game');
  assert.equal((await call('/messages', 'POST', { game: 'bricks', text: ' ' })).error, 'no-text');
  const bricks = await call('/status?game=bricks');
  assert.deepEqual(bricks.notices.map((n) => [n.kind, n.level, n.text]), [['message', 'warning', 'Server update tonight'], ['message', 'info', 'Hello everyone']]);
  assert.deepEqual((await call('/status?game=vattigt')).notices.map((n) => n.text), ['Hello everyone']);
  t += 31 * 60_000;
  assert.deepEqual((await call('/status?game=bricks')).notices.map((n) => n.text), ['Hello everyone'], 'the first has ended');
  const [left] = await call('/messages');
  await call(`/messages/${left.id}`, 'DELETE');
  assert.deepEqual((await call('/status?game=bricks')).notices, []);
  const short = await call('/messages', 'POST', { game: 'bricks', text: 'x', minutes: 1 });
  assert.equal(short.until - short.created, 5 * 60_000, 'at least five minutes');
});

test('F-066: pages get the notices with the status, open or closed, cleaned', async () => {
  const notices = [
    { id: 'budget-soon-2026-11-18', kind: 'budget-soon', level: 'warning', title: 'Closing soon for today', text: 'Soon {until}.', until: '2026-11-19T00:00:00.000Z', extra: 'dropped' },
    { kind: 'message', text: 'no id, dropped' },
  ];
  const env = { ADMIN: { status: async () => ({ open: false, reason: 'off', until: null, stopped: false, notices }), checkPass: async () => false } };
  const server = createRoomServer({ admin: { binding: 'ADMIN', game: 'bricks' } });
  const body = await (await server.fetch(new Request('https://x/rooms/status'), env)).json();
  assert.equal(body.open, false);
  assert.deepEqual(body.notices, [{ id: 'budget-soon-2026-11-18', kind: 'budget-soon', level: 'warning', title: 'Closing soon for today', text: 'Soon {until}.', until: '2026-11-19T00:00:00.000Z' }]);
  for (const kind of ['budget-soon', 'budget-closed', 'timer-soon', 'timer-ended', 'timer-stop-soon']) assert.ok(NOTICE_TEXT[kind].text.length > 20, kind);
});
