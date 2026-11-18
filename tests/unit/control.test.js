// The admin page's controls (F-003, F-004, F-008, F-026): settings, shares,
// budget, cost, and what rooms do with the admin page's word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, shares, budgetState, gameStatus, estimateCost } from '../../admin/control.js';
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
