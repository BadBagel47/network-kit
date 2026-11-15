import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld, connect, send, drop } from './fake-host.js';
import { CLOSE } from '../../src/shared/protocol.js';
import { memoryRules } from '../../examples/demo/memory-rules.js';

const HOST_OPTS = {
  mode: 'host',
  posts: ['captain', 'gunner', 'engineer'],
  limits: { player: 3, viewer: 2 },
  graceMs: 60_000,
  takeoverMs: 5_000,
  autoPauseMs: 20_000,
};

async function setup(options = HOST_OPTS, settings = {}) {
  const world = new FakeWorld();
  const core = await world.core(options);
  const created = await core.create(settings, 'ABCDE');
  const host = await connect(world, core, { name: 'Host', hk: created.hostKey });
  return { world, core, created, host };
}

test('create, join and host role', async () => {
  const { core, created, host } = await setup();
  assert.equal(created.code, 'ABCDE');
  assert.equal(host.last('welcome').room.hostId, host.id);
  assert.ok(host.last('welcome').room.keys, 'host sees invitation keys');
});

test('relay: players reach the host; the host reaches everyone or chosen players', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  assert.equal(a.last('welcome').room.players.length, 2);
  assert.ok(!a.last('room').room.keys, 'players do not see keys');

  await send(core, a, { t: 'msg', n: 1, d: { fire: true } });
  assert.deepEqual(host.last('msg'), { t: 'msg', from: a.id, d: { fire: true } });
  assert.equal(b.messages('msg').length, 0, 'players do not see each other\'s inputs');

  await send(core, host, { t: 'msg', d: { all: 1 } });
  assert.equal(a.last('msg').d.all, 1);
  assert.equal(b.last('msg').d.all, 1);
  assert.equal(host.messages('msg').filter((m) => m.from === host.id).length, 0);

  await send(core, host, { t: 'msg', d: { secret: 1 }, to: [b.id] });
  assert.equal(a.messages('msg').filter((m) => m.d.secret).length, 0);
  assert.equal(b.last('msg').d.secret, 1);
});

test('duplicate protection: a resent numbered message counts once', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await send(core, a, { t: 'msg', n: 1, d: 'x' });
  await send(core, a, { t: 'msg', n: 1, d: 'x' });
  await send(core, a, { t: 'msg', n: 2, d: 'y' });
  assert.deepEqual(host.messages('msg').map((m) => m.d), ['x', 'y']);
  // Reconnect in the same page session: welcome reports what was counted.
  await drop(core, a);
  const again = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(again.last('welcome').lastN, 2);
  await send(core, again, { t: 'msg', n: 2, d: 'y' });
  await send(core, again, { t: 'msg', n: 3, d: 'z' });
  assert.deepEqual(host.messages('msg').map((m) => m.d), ['x', 'y', 'z']);
  // A reloaded page (new session id) starts counting again.
  await drop(core, again);
  const reloaded = await connect(world, core, { name: 'A', pk: a.pk, sid: 's2' });
  assert.equal(reloaded.last('welcome').lastN, 0);
});

test('posts: claim, taken, switch, release, and release when gone', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'a-key-xxxxxxxxxxxxxxxx' });
  await send(core, host, { t: 'cmd', n: 1, c: 'claim', post: 'captain' });
  await send(core, a, { t: 'cmd', n: 1, c: 'claim', post: 'captain' });
  assert.equal(a.last('err').code, 'post-taken');
  await send(core, a, { t: 'cmd', n: 2, c: 'claim', post: 'gunner' });
  let room = a.last('room').room;
  assert.equal(room.posts.captain, host.id);
  assert.equal(room.posts.gunner, a.id);
  await send(core, a, { t: 'cmd', n: 3, c: 'claim', post: 'engineer' });
  room = a.last('room').room;
  assert.equal(room.posts.gunner, null);
  assert.equal(room.posts.engineer, a.id);
  await drop(core, a);
  await world.advance(59_000);
  assert.equal(host.last('room').room.posts.engineer, a.id, 'post kept during the grace period');
  await world.advance(2_000);
  assert.equal(host.last('room').room.posts.engineer, null, 'post released when gone');
  assert.equal(host.last('ev').e, 'gone');
});

test('grace period: drop, back with the same id and post', async () => {
  const { world, core, host } = await setup();
  const pk = 'back-key-xxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  await send(core, a, { t: 'cmd', n: 1, c: 'claim', post: 'gunner' });
  await drop(core, a);
  assert.equal(host.last('ev').e, 'drop');
  assert.equal(host.last('room').room.players.find((p) => p.id === a.id).status, 'away');
  await world.advance(30_000);
  const a2 = await connect(world, core, { name: 'A', pk });
  assert.equal(a2.id, a.id);
  assert.equal(host.last('ev').e, 'back');
  assert.equal(a2.last('welcome').room.posts.gunner, a.id);
  await world.advance(120_000);
  assert.ok(host.last('room').room.players.some((p) => p.id === a.id), 'still in the room');
});

test('pause and resume by anyone; automatic pause after a long drop', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await send(core, a, { t: 'cmd', n: 1, c: 'pause' });
  assert.equal(host.last('room').room.paused.id, a.id);
  await send(core, host, { t: 'cmd', n: 2, c: 'resume' });
  assert.equal(host.last('room').room.paused, null);
  await drop(core, a);
  await world.advance(19_000);
  assert.equal(host.last('room').room.paused, null);
  await world.advance(2_000);
  assert.equal(host.last('room').room.paused.reason, 'player-away');
});

test('pauseBy host: players cannot pause', async () => {
  const { world, core } = await setup({ ...HOST_OPTS, pauseBy: 'host' });
  const a = await connect(world, core, { name: 'A' });
  await send(core, a, { t: 'cmd', n: 1, c: 'pause' });
  assert.equal(a.last('err').code, 'not-allowed');
});

test('host takeover: another player continues from the latest snapshot', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await world.advance(4_000);
  await send(core, host, { t: 'snap', d: { tick: 42 } });
  await drop(core, host);
  await world.advance(4_000);
  assert.equal(a.messages('host').length, 0, 'no takeover during the short wait');
  await world.advance(2_000);
  const msg = a.last('host');
  assert.deepEqual(msg.snapshot, { tick: 42 });
  assert.equal(b.messages('host').length, 0);
  let room = b.last('room').room;
  assert.equal(room.hostId, a.id);
  assert.equal(room.paused.reason, 'host-change');
  assert.ok(a.last('room').room.keys, 'the new host sees the keys');
  await send(core, a, { t: 'cmd', n: 1, c: 'host-ready' });
  room = b.last('room').room;
  assert.equal(room.paused, null);
  // Inputs now go to the new host.
  await send(core, b, { t: 'msg', n: 1, d: 'to-new-host' });
  assert.equal(a.last('msg').d, 'to-new-host');
});

test('host returning within the wait keeps the role', async () => {
  const { world, core, created, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await drop(core, host);
  await world.advance(2_000);
  const back = await connect(world, core, { name: 'Host', hk: created.hostKey, pk: host.pk });
  assert.equal(back.id, host.id);
  await world.advance(10_000);
  assert.equal(a.last('room').room.hostId, host.id);
  assert.equal(a.messages('host').length, 0);
  assert.equal(back.messages('host').length, 0, 'same page session: no snapshot needed');
});

test('host page reload: the host gets the stored snapshot back', async () => {
  const world = new FakeWorld();
  const core = await world.core(HOST_OPTS);
  const created = await core.create({}, 'ABCDE');
  const pk = 'reload-host-xxxxxxxxxxxx';
  const host = await connect(world, core, { name: 'Host', hk: created.hostKey, pk, sid: 'page1' });
  await send(core, host, { t: 'snap', d: { tick: 7 } });
  await drop(core, host);
  const again = await connect(world, core, { name: 'Host', hk: created.hostKey, pk, sid: 'page2' });
  assert.deepEqual(again.last('host').snapshot, { tick: 7 });
  assert.equal(again.last('welcome').room.hostId, again.id);
});

test('takeover with nobody online: the next player to connect takes over', async () => {
  const { world, core, host } = await setup();
  const pk = 'late-key-xxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  await send(core, host, { t: 'snap', d: { s: 1 } });
  await drop(core, a);
  await drop(core, host);
  await world.advance(6_000);
  const a2 = await connect(world, core, { name: 'A', pk });
  assert.equal(a2.last('welcome').room.hostId === a2.id || a2.last('room').room.hostId === a2.id, true);
  assert.deepEqual(a2.last('host').snapshot, { s: 1 });
});

test('snapshot to a joining player only', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  await send(core, host, { t: 'snap', d: { full: true }, to: [b.id] });
  assert.equal(a.messages('snap').length, 0);
  assert.deepEqual(b.last('snap').d, { full: true });
  assert.deepEqual(core.snapshot.d, { full: true });
});

test('late join: now, next (admitted at the next safe point) and never', async () => {
  for (const lateJoin of ['now', 'next', 'never']) {
    const { world, core, host } = await setup(HOST_OPTS, { lateJoin });
    await send(core, host, { t: 'cmd', n: 1, c: 'start' });
    const a = await connect(world, core, { name: 'A' });
    if (lateJoin === 'never') {
      assert.equal(a.closedWith.code, CLOSE.IN_PROGRESS);
      continue;
    }
    const me = a.last('welcome').room.players.find((p) => p.id === a.id);
    assert.equal(me.waiting, lateJoin === 'next');
    if (lateJoin === 'next') {
      await send(core, a, { t: 'msg', n: 1, d: 'ignored' });
      assert.equal(host.messages('msg').length, 0, 'waiting players do not play');
      await send(core, host, { t: 'cmd', n: 2, c: 'admit' });
      assert.equal(host.last('ev').e, 'join');
      assert.equal(a.last('room').room.players.find((p) => p.id === a.id).waiting, false);
    }
  }
});

test('seat limits per role; a viewer never becomes a player', async () => {
  const { world, core, created } = await setup(HOST_OPTS, { access: 'private' });
  const v = await connect(world, core, { name: 'TV', key: created.keys.viewer.k });
  assert.equal(v.last('welcome').you.role, 'viewer');
  const v2 = await connect(world, core, { name: 'TV2', key: created.keys.viewer.k, role: 'player' });
  assert.equal(v2.last('welcome').you.role, 'viewer', 'a viewer link cannot play');
  const v3 = await connect(world, core, { name: 'TV3', key: created.keys.viewer.k });
  assert.equal(v3.closedWith.code, CLOSE.FULL);
  await connect(world, core, { name: 'A', key: created.keys.player.k });
  await connect(world, core, { name: 'B', key: created.keys.player.k });
  const c = await connect(world, core, { name: 'C', key: created.keys.player.k });
  assert.equal(c.closedWith.code, CLOSE.FULL);
  await send(core, v, { t: 'cmd', n: 1, c: 'claim', post: 'captain' });
  assert.equal(v.last('err').code, 'not-allowed');
});

test('private rooms: key required, renew stops old links, people inside stay, expiry', async () => {
  const { world, core, created, host } = await setup(HOST_OPTS, { access: 'private' });
  const none = await connect(world, core, { name: 'X' });
  assert.equal(none.closedWith.code, CLOSE.KEY);
  assert.equal(none.last('denied').reason, 'key-required');
  const pk = 'inside-key-xxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', key: created.keys.player.k, pk });
  assert.ok(a.id);
  await send(core, host, { t: 'cmd', n: 1, c: 'renew', role: 'player' });
  const newKey = host.last('room').room.keys.player.k;
  assert.notEqual(newKey, created.keys.player.k);
  const old = await connect(world, core, { name: 'Y', key: created.keys.player.k });
  assert.equal(old.last('denied').reason, 'key-invalid');
  await drop(core, a);
  const a2 = await connect(world, core, { name: 'A', pk });
  assert.equal(a2.id, a.id, 'a player inside comes back without the key');
  await send(core, host, { t: 'cmd', n: 2, c: 'renew', role: 'viewer', ttlMs: 1_000 });
  const viewerKey = host.last('room').room.keys.viewer.k;
  await world.advance(2_000);
  const late = await connect(world, core, { name: 'TV', key: viewerKey });
  assert.equal(late.last('denied').reason, 'key-expired');
  // Open room: the code is enough.
  await send(core, host, { t: 'cmd', n: 3, c: 'settings', access: 'open' });
  const open = await connect(world, core, { name: 'Z' });
  assert.ok(open.id);
});

test('only the host may use host commands', async () => {
  const { world, core } = await setup();
  const a = await connect(world, core, { name: 'A' });
  for (const c of ['start', 'kick', 'renew', 'close', 'admit']) {
    await send(core, a, { t: 'cmd', n: Math.floor(Math.random() * 1e6) + 1, c, id: 'x', role: 'player' });
    assert.equal(a.last('err').code, 'host-only', c);
  }
});

test('kick and ban', async () => {
  const { world, core, host } = await setup();
  const pk = 'banned-key-xxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  await send(core, host, { t: 'cmd', n: 1, c: 'kick', id: a.id, ban: true });
  assert.equal(a.closedWith.code, CLOSE.BANNED);
  assert.equal(host.last('room').room.players.length, 1);
  const again = await connect(world, core, { name: 'A', pk });
  assert.equal(again.closedWith.code, CLOSE.BANNED);
  const b = await connect(world, core, { name: 'B', pk: 'kicked-key-xxxxxxxxxxxxx' });
  await send(core, host, { t: 'cmd', n: 2, c: 'kick', id: b.id });
  assert.equal(b.closedWith.code, CLOSE.KICKED);
  const b2 = await connect(world, core, { name: 'B', pk: 'kicked-key-xxxxxxxxxxxxx' });
  assert.ok(b2.id, 'a kick without ban allows coming back');
});

test('same player in a new tab replaces the old connection', async () => {
  const { world, core } = await setup();
  const pk = 'tab-key-xxxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  const a2 = await connect(world, core, { name: 'A', pk });
  assert.equal(a.closedWith.code, CLOSE.REPLACED);
  assert.equal(a2.id, a.id);
});

test('host leaving on purpose closes the room; handover option passes it on', async () => {
  {
    const { world, core, host } = await setup();
    const a = await connect(world, core, { name: 'A' });
    await send(core, host, { t: 'cmd', n: 1, c: 'leave' });
    assert.equal(a.closedWith.code, CLOSE.ROOM_CLOSED);
    assert.equal(a.last('closed').reason, 'host-left');
    const late = await connect(world, core, { name: 'B' });
    assert.equal(late.closedWith.code, CLOSE.ROOM_CLOSED);
    assert.equal(core.info().closed, true);
  }
  {
    const { world, core, host } = await setup({ ...HOST_OPTS, hostLeave: 'handover' });
    const a = await connect(world, core, { name: 'A' });
    await send(core, host, { t: 'snap', d: { last: 1 } });
    await send(core, host, { t: 'cmd', n: 1, c: 'leave' });
    assert.equal(a.last('room').room.hostId, a.id);
    assert.deepEqual(a.last('host').snapshot, { last: 1 });
  }
});

test('handover to a chosen player', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  await send(core, host, { t: 'snap', d: { v: 2 } });
  await send(core, host, { t: 'cmd', n: 1, c: 'handover', id: b.id });
  assert.equal(a.last('room').room.hostId, b.id);
  assert.deepEqual(b.last('host').snapshot, { v: 2 });
});

test('cleanup: a room is deleted 24 hours after the last player left', async () => {
  const { world, core, host } = await setup();
  await drop(core, host);
  await world.advance(23 * 3600_000);
  assert.ok(world.store.get('room'));
  await world.advance(2 * 3600_000);
  assert.equal(world.store.size, 0);
  assert.equal(core.info(), null);
});

test('hibernation: a reloaded room keeps players, sockets and duplicate protection', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await send(core, a, { t: 'msg', n: 1, d: 'one' });
  await send(core, host, { t: 'cmd', n: 1, c: 'pause' });
  const woke = await world.core(HOST_OPTS);
  assert.equal(woke.state.players[a.id].name, 'A');
  await send(woke, a, { t: 'msg', n: 1, d: 'one again' });
  await send(woke, a, { t: 'msg', n: 2, d: 'two' });
  assert.deepEqual(host.messages('msg').map((m) => m.d), ['one', 'two']);
  assert.ok(woke.state.paused);
});

test('messages over the size limit are refused', async () => {
  const { world, core, host } = await setup({ ...HOST_OPTS, maxMessageBytes: 100 });
  const a = await connect(world, core, { name: 'A' });
  await send(core, a, { t: 'msg', n: 1, d: 'x'.repeat(200) });
  assert.equal(a.last('err').code, 'too-large');
  assert.equal(host.messages('msg').length, 0);
});

test('names are trimmed and limited', async () => {
  const { world, core } = await setup();
  const a = await connect(world, core, { name: '  A\u0007very   long name that goes on and on  ' });
  const me = a.last('welcome').room.players.find((p) => p.id === a.id);
  assert.equal(me.name, 'Avery long name that goe');
});

test('server mode: the memory example game with turns and a timer', async () => {
  const opts = { mode: 'server', rules: memoryRules, limits: { player: 4, viewer: 2 }, lateJoin: 'never', countdownMs: 0 };
  const { world, core, host } = await setup(opts);
  const b = await connect(world, core, { name: 'B' });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  const board = host.last('msg').d;
  assert.equal(board.cards.length, 8);
  assert.ok(board.cards.every((c) => c === null), 'faces hidden');
  assert.equal(board.turn, host.id);
  // Not your turn.
  await send(core, b, { t: 'msg', n: 1, d: { type: 'flip', index: 0 } });
  assert.deepEqual(b.last('msg').d.cards, board.cards);
  // Find a mismatching pair from the server state and flip it.
  const cards = core.state.game.cards;
  const j = cards.findIndex((c, i) => i > 0 && c !== cards[0]);
  await send(core, host, { t: 'msg', n: 2, d: { type: 'flip', index: 0 } });
  await send(core, host, { t: 'msg', n: 3, d: { type: 'flip', index: j } });
  assert.equal(b.last('msg').d.cards[0], cards[0]);
  await world.advance(1_000);
  const after = b.last('msg').d;
  assert.equal(after.cards[0], null, 'cards hidden again by the timer');
  assert.equal(after.turn, b.id, 'turn passes on');
  // Match a pair as B.
  const k = cards.findIndex((c, i) => c === cards[0] && i !== 0);
  await send(core, b, { t: 'msg', n: 2, d: { type: 'flip', index: 0 } });
  await send(core, b, { t: 'msg', n: 3, d: { type: 'flip', index: k } });
  assert.equal(b.last('msg').d.scores[b.id], 1);
  assert.equal(b.last('msg').d.turn, b.id, 'a match keeps the turn');
});
