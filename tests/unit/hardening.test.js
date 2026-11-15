// Regression tests for the faults found in the review of v0.1.0
// (docs/reviews/2026-11-15-v0.1.0.md): sleeping rooms, uninvited
// connections, cost limits, pause rights and storage writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld, connect, open, send, cmd, drop } from './fake-host.js';
import { setup, CREW } from './setup.js';
import { CLOSE } from '../../src/shared/protocol.js';
import { memoryRules } from '../../examples/demo/memory-rules.js';

test('B-014: the newest snapshot survives the room going to sleep', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await send(core, owner, { t: 'snap', d: { move: 1 } });
  await world.advance(1_000);
  await send(core, owner, { t: 'snap', d: { move: 2 } });
  assert.deepEqual(world.store.get('snapshot').d, { move: 1 }, 'not written on every snapshot');
  await world.advance(4_100); // the trailing save
  assert.deepEqual(world.store.get('snapshot').d, { move: 2 });
  const woke = await world.sleep();
  await drop(woke, owner);
  await world.advance(6_000);
  assert.deepEqual(a.last('host').snapshot, { move: 2 });
});

test('B-014: a snapshot is stored when the host drops, pauses, leaves or hands over', async () => {
  for (const how of ['drop', 'pause', 'leave', 'handover']) {
    const { world, core, owner } = await setup({ ...CREW, ownerLeave: 'pass' });
    const a = await connect(world, core, { name: 'A' });
    await send(core, owner, { t: 'snap', d: { v: 1 } });
    await send(core, owner, { t: 'snap', d: { v: 2 } });
    if (how === 'drop') await drop(core, owner);
    if (how === 'pause') await cmd(core, owner, 'pause');
    if (how === 'leave') await cmd(core, owner, 'leave');
    if (how === 'handover') await cmd(core, owner, 'handover', { id: a.id });
    assert.deepEqual(world.store.get('snapshot').d, { v: 2 }, how);
  }
});

test('B-014: duplicate protection survives sleep plus a replaced connection', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'switch-key-xxxxxxxxxxxxx' });
  for (let n = 1; n <= 5; n++) await send(core, a, { t: 'msg', n, d: `input-${n}` });
  const woke = await world.sleep();
  // Wifi to mobile data: a new connection while the old one still looks open.
  const a2 = await connect(world, woke, { name: 'A', pk: a.pk });
  assert.equal(a2.last('welcome').lastN, 5);
  for (let n = 1; n <= 5; n++) await send(woke, a2, { t: 'msg', n, d: `input-${n}` });
  await send(woke, a2, { t: 'msg', n: 6, d: 'input-6' });
  assert.deepEqual(owner.messages('msg').map((m) => m.d), [1, 2, 3, 4, 5, 6].map((n) => `input-${n}`));
});

test('B-015: back after the grace period in the same page: nothing is replayed', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'long-away-key-xxxxxxxxxx' });
  for (let n = 1; n <= 3; n++) await send(core, a, { t: 'msg', n, d: n });
  await drop(core, a);
  await world.advance(120_000);
  assert.equal(owner.last('ev').e, 'gone');
  const back = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(back.id, a.id, 'the same id for the whole life of the room');
  assert.equal(back.last('welcome').lastN, 3);
  for (let n = 1; n <= 3; n++) await send(core, back, { t: 'msg', n, d: n });
  assert.deepEqual(owner.messages('msg').map((m) => m.d), [1, 2, 3]);
});

test('B-017: a connection must introduce itself; junk closes it', async () => {
  const { world, core, owner } = await setup(CREW, { access: 'private' });
  for (const junk of ['not json', '[1,2]', '"text"', JSON.stringify({ t: 'msg', d: 1 }), 'x'.repeat(600_000)]) {
    const raw = open(world, core);
    await send(core, raw, junk);
    assert.equal(raw.closedWith?.code, CLOSE.BAD_REQUEST, junk.slice(0, 20));
  }
  assert.equal(owner.messages('msg').length, 0);
});

test('B-017: silent connections are capped and do not stop the cleanup', async () => {
  const { world, core, owner } = await setup();
  const silent = [];
  for (let i = 0; i < 20; i++) {
    world.time += 1;
    silent.push(open(world, core, `silent-${i}`));
  }
  assert.equal(silent.filter((ws) => !ws.closedWith).length, 8);
  assert.ok(silent[0].closedWith && !silent[19].closedWith, 'the oldest are closed first');
  await drop(core, owner);
  await world.advance(25 * 3600_000);
  assert.equal(world.store.size, 0, 'the room is deleted although silent connections were open');
  assert.ok(silent[19].closedWith);
});

test('B-017: a bad session id is refused and leaves no ghost seat', async () => {
  const { world, core, owner } = await setup();
  for (const sid of ['x'.repeat(20_000), '', 42, null]) {
    const ghost = await connect(world, core, { name: 'ghost', sid });
    assert.equal(ghost.closedWith?.code, CLOSE.BAD_REQUEST);
  }
  assert.equal(owner.room.players.length, 1);
  assert.equal(Object.keys(core.state.players).length, 1);
});

test('B-017: odd ids in commands are refused and touch nothing', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await drop(core, a);
  const timers = core.state.timers.length;
  for (const id of ['__proto__', 'constructor', 'toString', 42, null, { a: 1 }]) {
    world.time += 1_000; // refused commands cost extra; a person does not send them in a burst
    await cmd(core, owner, 'kick', { id });
    assert.equal(owner.last('err').code, 'no-such-participant');
    await cmd(core, owner, 'assign', { id, place: 'captain' });
    assert.equal(owner.last('err').code, 'no-such-participant');
  }
  await cmd(core, owner, 'take', { place: '__proto__' });
  assert.equal(owner.last('err').code, 'no-such-place');
  await send(core, owner, { t: 'msg', d: 1, to: ['__proto__', 7, null] });
  await send(core, owner, { t: 'cmd', n: 99_999, c: { evil: true } });
  assert.equal(owner.last('err').code, 'unknown-command');
  assert.equal(core.state.timers.length, timers, 'the grace timers are untouched');
});

test('F-018: a connection that sends too fast is closed', async () => {
  const { world, core, owner } = await setup({ ...CREW, maxMessagesPerSecond: 20 });
  const a = await connect(world, core, { name: 'A' });
  for (let i = 0; i < 100 && !a.closedWith; i++) await send(core, a, { t: 'msg', d: i });
  assert.equal(a.closedWith.code, CLOSE.RATE);
  assert.equal(owner.messages('msg').length, 40, 'a burst of twice the rate is let through');
  assert.equal(owner.room.players.find((p) => p.id === a.id).status, 'away');
  // A steady pace under the limit is never cut off.
  const b = await connect(world, core, { name: 'B' });
  for (let i = 0; i < 200; i++) {
    world.time += 60;
    await send(core, b, { t: 'msg', d: i });
  }
  assert.equal(b.closedWith, null);
});

test('F-018: a room that uses up its daily budget closes; the count survives sleep', async () => {
  const { world, core, owner } = await setup({ ...CREW, maxMessagesPerDay: 1_200, maxMessagesPerSecond: 0 });
  const a = await connect(world, core, { name: 'A' });
  for (let i = 0; i < 1_000; i++) await send(core, a, { t: 'msg', d: i });
  await core.flush();
  const woke = await world.sleep();
  assert.ok(woke.state.usage.n >= 1_000, 'the count was stored along the way');
  for (let i = 0; i < 300 && !a.closedWith; i++) await send(woke, a, { t: 'msg', d: i });
  assert.equal(a.closedWith.code, CLOSE.BUDGET);
  assert.equal(owner.closedWith.code, CLOSE.BUDGET);
  assert.equal(owner.last('closed').reason, 'room-budget');
});

test('F-018: the budget starts again the next day', async () => {
  const { world, core } = await setup({ ...CREW, maxMessagesPerDay: 100, maxMessagesPerSecond: 0 });
  const a = await connect(world, core, { name: 'A' });
  for (let i = 0; i < 90; i++) await send(core, a, { t: 'msg', d: i });
  await world.advance(24 * 3600_000);
  for (let i = 0; i < 90; i++) await send(core, a, { t: 'msg', d: i });
  assert.equal(a.closedWith, null);
});

test('B-020: only admitted participants whose role may pause can pause', async () => {
  const { world, core, created, owner } = await setup(CREW, { access: 'private', lateJoin: 'next' });
  const tv = await connect(world, core, { name: 'TV', key: created.keys.viewer.k });
  await cmd(core, owner, 'start');
  const waiting = await connect(world, core, { name: 'W', key: created.keys.player.k });
  for (const ws of [tv, waiting]) {
    await cmd(core, ws, 'pause');
    assert.equal(ws.last('err').code, 'not-allowed');
  }
  assert.equal(owner.room.paused, null);
  await cmd(core, owner, 'admit');
  await cmd(core, waiting, 'pause');
  assert.equal(owner.room.paused.id, waiting.id);
  await cmd(core, tv, 'resume');
  assert.equal(tv.last('err').code, 'not-allowed');
  await cmd(core, owner, 'resume');
  assert.equal(owner.room.paused, null);
});

test('B-020: an automatic pause ends when its cause does', async () => {
  for (const pauseBy of ['anyone', 'nobody']) {
    for (const ending of ['back', 'gone']) {
      const { world, core, owner } = await setup({ ...CREW, pauseBy });
      const a = await connect(world, core, { name: 'A', pk: `auto-${pauseBy}-${ending}-xxxxxxxx` });
      await cmd(core, owner, 'start');
      await drop(core, a);
      await world.advance(19_000);
      assert.equal(owner.room.paused, null);
      await world.advance(2_000);
      assert.equal(owner.room.paused.reason, 'player-away');
      if (ending === 'back') await connect(world, core, { name: 'A', pk: a.pk });
      else await world.advance(60_000);
      assert.equal(owner.room.paused, null, `${pauseBy}/${ending}`);
    }
  }
});

test('B-020: with pauseBy "host" only the host and the owner pause', async () => {
  const { world, core, owner } = await setup({ ...CREW, pauseBy: 'host' });
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, a, 'pause');
  assert.equal(a.last('err').code, 'not-allowed');
  await cmd(core, owner, 'pause');
  assert.equal(a.room.paused.id, owner.id);
});

test('B-020: someone who was in the game gets back in after the grace period', async () => {
  const { world, core, created, owner } = await setup(CREW, { access: 'private', lateJoin: 'never' });
  const a = await connect(world, core, { name: 'A', pk: 'returning-key-xxxxxxxxxx', key: created.keys.player.k });
  const kicked = await connect(world, core, { name: 'K', pk: 'kicked-out-key-xxxxxxxxx', key: created.keys.player.k });
  await cmd(core, owner, 'start');
  await cmd(core, owner, 'renew', { role: 'player' });
  await cmd(core, owner, 'kick', { id: kicked.id });
  await drop(core, a);
  await world.advance(61_000);
  const back = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(back.id, a.id, 'no key, game running, late join off: still let back in');
  assert.equal(back.room.players.find((p) => p.id === a.id).waiting, false);
  const again = await connect(world, core, { name: 'K', pk: kicked.pk });
  assert.equal(again.closedWith.code, CLOSE.KEY, 'someone who was removed needs a new invitation');
  const stranger = await connect(world, core, { name: 'S', key: owner.room.keys.player.k });
  assert.equal(stranger.closedWith.code, CLOSE.IN_PROGRESS);
});

test('B-022: relayed messages cause no storage writes; snapshots are written sparingly', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await core.flush();
  world.puts = [];
  for (let i = 0; i < 100; i++) {
    world.time += 50;
    await send(core, a, { t: 'msg', d: i });
    await send(core, owner, { t: 'msg', d: i });
  }
  assert.deepEqual(world.puts, []);
  assert.equal(a.closedWith, null);
  await cmd(core, owner, 'pause');
  world.puts = [];
  for (let i = 0; i < 20; i++) {
    world.time += 100;
    await send(core, owner, { t: 'snap', d: { i } });
  }
  assert.ok(world.puts.length <= 1, `paused: ${world.puts.length} writes for 20 snapshots`);
});

test('B-022: server-run rooms write only when the game changed', async () => {
  const options = { mode: 'server', rules: memoryRules, roles: { player: { seats: 4 }, viewer: { seats: 2 } }, countdownMs: 0 };
  const { world, core, owner } = await setup(options);
  const b = await connect(world, core, { name: 'B' });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  await cmd(core, owner, 'start');
  await core.flush();
  world.puts = [];
  for (let i = 0; i < 50; i++) {
    world.time += 1_000;
    await send(core, tv, { t: 'msg', d: { type: 'flip', index: 0 } }); // a viewer
    await send(core, b, { t: 'msg', d: { type: 'flip', index: 0 } }); // not B's turn
    await send(core, owner, { t: 'msg', d: { type: 'nonsense' } });
  }
  assert.deepEqual(world.puts, []);
  await send(core, owner, { t: 'msg', d: { type: 'flip', index: 0 } });
  assert.deepEqual(world.puts, ['room']);
});

test('D-021: a room stored by another version is discarded, not misread', async () => {
  const world = new FakeWorld();
  world.store.set('room', { v: 1, code: 'OLD11', players: {}, timers: [], hostKey: 'x' });
  world.store.set('snapshot', { d: 1 });
  const core = await world.core(CREW);
  assert.equal(core.info(), null);
  assert.equal(world.store.size, 0);
  const created = await core.create({}, 'NEW22');
  assert.equal(created.code, 'NEW22');
});

// ---- Found by the independent check of the 0.2.0 release candidate -------

const QUIET = { mode: 'host', roles: { player: { seats: 6 }, viewer: { seats: 2 } }, graceMs: 60_000 };

test('V-B2: the owner key in a second window does not take the room from the first', async () => {
  const { world, core, created, owner } = await setup();
  const second = await connect(world, core, { name: 'Owner again', owner: created.ownerKey, pk: 'second-window-key-xxxxxx' });
  assert.equal(owner.closedWith, null, 'the first window is left alone');
  assert.equal(second.room.ownerId, owner.id);
  assert.equal(second.room.hostId, owner.id);
  assert.notEqual(second.id, owner.id);
  assert.ok(!second.room.keys);
  assert.equal(second.room.players.length, 2, 'it joins like anyone else');
  // Only when the owner's seat is not connected does the key claim it.
  await drop(core, owner);
  const claim = await connect(world, core, { name: 'Phone', owner: created.ownerKey, pk: 'the-owners-phone-key-xxx' });
  assert.equal(claim.id, owner.id, 'the same participant id, under the new identity');
  assert.equal(claim.room.ownerId, owner.id);
});

test('V-B3: a host closed for not answering resends nothing it already sent', async () => {
  const { world, core, created, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await world.advance(10_000);
  for (const n of [1, 2, 3]) await send(core, owner, { t: 'msg', n: 2000 + n, d: n });
  const woke = await world.sleep();
  owner.alive = false;
  await send(woke, a, { t: 'cmd', c: 'host-check' });
  await world.advance(3_100);
  assert.equal(owner.closedWith.code, 4014);
  const back = await connect(world, woke, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(back.last('welcome').lastN, 2003);
});

test('V-B5: server-run rules see the same participant when the owner changes device', async () => {
  const options = { mode: 'server', rules: memoryRules, roles: { player: { seats: 4 } }, countdownMs: 0, graceMs: 60_000 };
  const { world, core, created, owner } = await setup(options);
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  assert.equal(core.state.game.turn, owner.id);
  await drop(core, owner);
  const phone = await connect(world, core, { name: 'Owner', owner: created.ownerKey, pk: 'owner-on-the-phone-key-x', sid: 'phone' });
  assert.equal(phone.id, owner.id);
  assert.equal(phone.last('msg').d.type, 'board', 'onBack sent them the board');
  await send(core, phone, { t: 'msg', d: { type: 'flip', index: 0 } });
  assert.notEqual(b.last('msg').d.cards[0], null, 'and it is still their turn');
});

test('V-B6: a renewed link, a removal or a ban also shuts out those the room remembers', async () => {
  const { world, core, created, owner } = await setup(QUIET, { access: 'private', lateJoin: 'never' });
  const key = created.keys.player.k;
  const visitor = await connect(world, core, { name: 'V', pk: 'visitor-key-xxxxxxxxxxxx', key });
  const other = await connect(world, core, { name: 'O', pk: 'other-key-xxxxxxxxxxxxxx', key });
  const third = await connect(world, core, { name: 'T', pk: 'third-key-xxxxxxxxxxxxxx', key });
  const lobby = await connect(world, core, { name: 'L', pk: 'lobby-key-xxxxxxxxxxxxxx', key });
  for (const ws of [visitor, other, third, lobby]) await drop(core, ws);
  await world.advance(61_000);

  // Lost connections may return without a key, as long as the link is unchanged ...
  assert.ok((await connect(world, core, { name: 'L', pk: lobby.pk })).id);
  await drop(core, world.socketList.at(-1));
  await world.advance(61_000);
  // ... but not into a game that started without them, where late join is off.
  await cmd(core, owner, 'start');
  assert.equal((await connect(world, core, { name: 'L', pk: lobby.pk })).closedWith.code, CLOSE.IN_PROGRESS);
  await cmd(core, owner, 'end');

  // Removing someone who is away works by id, and they need a new invitation.
  await cmd(core, owner, 'kick', { id: other.id });
  assert.equal(owner.last('ok').c, 'kick');
  assert.equal((await connect(world, core, { name: 'O', pk: other.pk })).closedWith.code, CLOSE.KEY);
  await cmd(core, owner, 'kick', { id: third.id, ban: true });
  assert.equal((await connect(world, core, { name: 'T', pk: third.pk, key: owner.room.keys.player.k })).closedWith.code, CLOSE.BANNED);

  // The ban renewed the links: the visitor's standing is gone with the old one.
  const again = await connect(world, core, { name: 'V', pk: visitor.pk });
  assert.equal(again.closedWith.code, CLOSE.KEY);
  assert.equal(again.last('denied').reason, 'key-required');
  assert.equal((await connect(world, core, { name: 'V', pk: visitor.pk, key: owner.room.keys.player.k })).id, visitor.id);
});

test('V-B7: ignored and refused messages cost the sender, not the room', async () => {
  const { world, core, owner } = await setup({ ...CREW, maxMessagesPerDay: 1_000 });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  await core.flush();
  world.puts = [];
  const before = core.state.usage.n;
  for (let i = 0; i < 2_000 && !tv.closedWith; i++) {
    world.time += 30; // 33 a second: under the plain rate limit
    await send(core, tv, { t: 'msg', d: 'ignored' });
  }
  assert.equal(tv.closedWith?.code, CLOSE.RATE, 'the viewer is closed');
  assert.equal(owner.closedWith, null, 'the room is not');
  assert.equal(core.state.usage.n, before, 'and its budget is untouched');

  // Commands that change nothing cause no write and no broadcast.
  const a = await connect(world, core, { name: 'A' });
  await core.flush();
  world.puts = [];
  const rooms = owner.messages('room').length;
  for (let i = 0; i < 20; i++) {
    world.time += 1_000;
    await cmd(core, a, 'leave-place');
  }
  assert.deepEqual(world.puts, []);
  assert.equal(owner.messages('room').length, rooms);
});

test('V-B8: a room that is busy for too many minutes in a day closes', async () => {
  const { world, core, owner } = await setup({ ...CREW, maxActiveMinutesPerDay: 30 });
  const a = await connect(world, core, { name: 'A' });
  for (let minute = 0; minute < 40 && !a.closedWith; minute++) {
    await send(core, a, { t: 'msg', d: minute });
    await world.advance(60_000);
  }
  assert.equal(a.closedWith?.code, CLOSE.BUDGET);
  assert.equal(owner.last('closed').reason, 'room-budget');
});

test('V-B9: a valid link or an allowed role asked for beats the role held before', async () => {
  const { world, core, created } = await setup(QUIET);
  const first = await connect(world, core, { name: 'X', pk: 'role-change-key-xxxxxxxx', role: 'viewer' });
  assert.equal(first.last('welcome').you.role, 'viewer');
  await drop(core, first);
  await world.advance(61_000);
  const same = await connect(world, core, { name: 'X', pk: first.pk });
  assert.equal(same.last('welcome').you.role, 'viewer', 'nothing asked: back as before');
  await drop(core, same);
  await world.advance(61_000);
  const asked = await connect(world, core, { name: 'X', pk: first.pk, role: 'player' });
  assert.equal(asked.last('welcome').you.role, 'player');
  await drop(core, asked);
  await world.advance(61_000);
  const linked = await connect(world, core, { name: 'X', pk: first.pk, key: created.keys.viewer.k, role: 'player' });
  assert.equal(linked.last('welcome').you.role, 'viewer', 'the link decides');
});

test('V-B10: a host-run game is never "running" while nobody runs it', async () => {
  {
    // An automatic pause for A is lifted while the host is away.
    const { world, core, owner } = await setup({ ...QUIET, autoPauseMs: 20_000 });
    const a = await connect(world, core, { name: 'A', pk: 'auto-paused-key-xxxxxxxx' });
    const b = await connect(world, core, { name: 'B' });
    await cmd(core, owner, 'start');
    await world.advance(5_000);
    await drop(core, a);
    await world.advance(21_000);
    assert.equal(b.room.paused.reason, 'player-away');
    await drop(core, owner);
    await connect(world, core, { name: 'A', pk: a.pk });
    assert.equal(b.room.paused.reason, 'host-away');
  }
  {
    // The owner starts a round while the host it handed the game to is away.
    const { world, core, owner } = await setup(QUIET);
    const a = await connect(world, core, { name: 'A' });
    await cmd(core, owner, 'handover', { id: a.id });
    await cmd(core, a, 'host-ready');
    await drop(core, a);
    await cmd(core, owner, 'start');
    assert.equal(owner.room.paused.reason, 'host-away');
  }
  {
    // Takeover is on, but only a viewer is left.
    const { world, core, owner } = await setup({ ...CREW, ownerLeave: 'pass' });
    const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
    await cmd(core, owner, 'start');
    await world.advance(5_000);
    await cmd(core, owner, 'leave');
    assert.equal(tv.room.hostId, null);
    assert.equal(tv.room.paused.reason, 'host-away');
  }
});

test('V-B11: without takeover, a room that passes to a new owner does not hand over the old game state', async () => {
  const { world, core, owner } = await setup({ ...QUIET, passOwnerAfterMs: 120_000 });
  const a = await connect(world, core, { name: 'A' });
  await send(core, owner, { t: 'snap', d: { answers: ['secret'] } });
  await drop(core, owner);
  await world.advance(121_000);
  assert.equal(a.room.ownerId, a.id);
  assert.equal(a.room.hostId, a.id);
  assert.deepEqual(a.last('host'), { t: 'host', snapshot: null }, 'the new owner starts fresh');
  assert.ok(!JSON.stringify(a.sent).includes('secret'));
  assert.equal(world.store.get('snapshot'), undefined);
});

test('V-B15: an owner who missed the renewed owner key gets it on the next connection', async () => {
  const { world, core, created, owner } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'new-owner-key-xxxxxxxxxx' });
  await cmd(core, owner, 'owner', { id: a.id });
  const key = a.last('owner').key;
  const again = await connect(world, core, { name: 'A', pk: a.pk }); // without any owner key
  assert.equal(again.last('owner').key, key);
  assert.notEqual(key, created.ownerKey);
  const withKey = await connect(world, core, { name: 'A', pk: a.pk, owner: key });
  assert.equal(withKey.messages('owner').length, 0, 'not repeated to someone who has it');
});
