// Rooms, seats, roles, places, relaying and keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, send, cmd, drop } from './fake-host.js';
import { setup, CREW, QUIZ } from './setup.js';
import { CLOSE } from '../../src/shared/protocol.js';
import { memoryRules } from '../../examples/demo/memory-rules.js';

test('create and join: the creator is owner and host', async () => {
  const { core, created, owner } = await setup();
  assert.equal(created.code, 'ABCDE');
  assert.ok(created.ownerKey);
  assert.deepEqual(Object.keys(created.keys), ['player', 'viewer']);
  assert.equal(owner.room.ownerId, owner.id);
  assert.equal(owner.room.hostId, owner.id);
  assert.ok(owner.room.keys, 'the owner sees the invitation keys');
  assert.equal(owner.last('host').snapshot, null, 'the host is told to run the game, from scratch');
  assert.deepEqual(await core.create({}, 'ABCDE'), { error: 'exists' });
  assert.deepEqual(core.info().participants, { player: 1, viewer: 0 });
});

test('relay: others reach the host; the host reaches everyone, chosen ids, a role or a place', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  assert.ok(!a.room.keys, 'others do not see the keys');
  await cmd(core, b, 'take', { place: 'gunner' });

  await send(core, a, { t: 'msg', d: { fire: true } });
  assert.deepEqual(owner.last('msg'), { t: 'msg', from: a.id, d: { fire: true } });
  assert.equal(b.messages('msg').length, 0, 'others do not see each other\'s messages');

  await send(core, owner, { t: 'msg', d: 'all' });
  for (const ws of [a, b, tv]) assert.equal(ws.last('msg').d, 'all');
  assert.equal(owner.messages('msg').filter((m) => m.d === 'all').length, 0, 'never echoed to the sender');

  await send(core, owner, { t: 'msg', d: 'one', to: [b.id] });
  await send(core, owner, { t: 'msg', d: 'viewers', to: { role: 'viewer' } });
  await send(core, owner, { t: 'msg', d: 'gunners', to: { place: 'gunner' } });
  await send(core, owner, { t: 'msg', d: 'nobody', to: { nonsense: true } });
  assert.deepEqual(a.messages('msg').map((m) => m.d), ['all']);
  assert.deepEqual(b.messages('msg').map((m) => m.d), ['all', 'one', 'gunners']);
  assert.deepEqual(tv.messages('msg').map((m) => m.d), ['all', 'viewers']);
});

test('viewers and waiting participants cannot send game messages', async () => {
  const { world, core, owner } = await setup(CREW, { lateJoin: 'next' });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  await cmd(core, owner, 'start');
  const late = await connect(world, core, { name: 'Late' });
  await send(core, tv, { t: 'msg', d: 'from viewer' });
  await send(core, late, { t: 'msg', d: 'from waiting' });
  assert.equal(owner.messages('msg').length, 0);
});

test('duplicate protection: a resent numbered message counts once', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'dedupe-key-xxxxxxxxxxxx' });
  await send(core, a, { t: 'msg', n: 1, d: 'x' });
  await send(core, a, { t: 'msg', n: 1, d: 'x' });
  await send(core, a, { t: 'msg', n: 2, d: 'y' });
  await send(core, a, { t: 'msg', n: 2.5, d: 'bad number' });
  assert.deepEqual(owner.messages('msg').map((m) => m.d), ['x', 'y']);
  await drop(core, a);
  const again = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(again.last('welcome').lastN, 2);
  await send(core, again, { t: 'msg', n: 2, d: 'y' });
  await send(core, again, { t: 'msg', n: 3, d: 'z' });
  assert.deepEqual(owner.messages('msg').map((m) => m.d), ['x', 'y', 'z']);
  await drop(core, again);
  const reloaded = await connect(world, core, { name: 'A', pk: a.pk, sid: 's2' });
  assert.equal(reloaded.last('welcome').lastN, 0, 'a reloaded page starts counting again');
});

test('places with one spot: take, taken, switch, leave, assign', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  await cmd(core, owner, 'take', { place: 'captain' });
  await cmd(core, a, 'take', { place: 'captain' });
  assert.equal(a.last('err').code, 'place-taken');
  await cmd(core, a, 'take', { place: 'gunner' });
  assert.deepEqual(a.room.places, { captain: [owner.id], gunner: [a.id], engineer: [] });
  await cmd(core, a, 'take', { place: 'engineer' });
  assert.deepEqual(a.room.places.gunner, []);
  assert.equal(a.room.players.find((p) => p.id === a.id).place, 'engineer');
  await cmd(core, a, 'take', { place: 'bridge' });
  assert.equal(a.last('err').code, 'no-such-place');
  await cmd(core, tv, 'take', { place: 'gunner' });
  assert.equal(tv.last('err').code, 'not-allowed');
  await cmd(core, owner, 'assign', { id: a.id, place: 'captain' });
  assert.deepEqual(a.room.places.captain, [a.id], 'a single spot changes hands');
  assert.equal(owner.room.players.find((p) => p.id === owner.id).place, null);
  await cmd(core, a, 'leave-place');
  assert.deepEqual(a.room.places.captain, []);
});

test('places with several spots work as teams', async () => {
  const { world, core, owner } = await setup({ mode: 'host', places: { red: 2, blue: 2 } });
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  for (const ws of [owner, a]) await cmd(core, ws, 'take', { place: 'red' });
  await cmd(core, b, 'take', { place: 'red' });
  assert.equal(b.last('err').code, 'place-taken');
  await cmd(core, b, 'take', { place: 'blue' });
  assert.deepEqual(b.room.places, { red: [owner.id, a.id], blue: [b.id] });
  assert.deepEqual(b.room.placeSizes, { red: 2, blue: 2 });
  await cmd(core, owner, 'assign', { id: b.id, place: 'red' });
  assert.equal(owner.last('err').code, 'place-taken', 'a full team does not push anyone out');
});

test('grace period: drop, back with the same id and place; gone afterwards', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'grace-key-xxxxxxxxxxxxx' });
  await cmd(core, a, 'take', { place: 'gunner' });
  await drop(core, a);
  assert.equal(owner.last('ev').e, 'drop');
  assert.equal(owner.room.players.find((p) => p.id === a.id).status, 'away');
  await world.advance(30_000);
  const a2 = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(a2.id, a.id);
  assert.equal(owner.last('ev').e, 'back');
  assert.deepEqual(a2.room.places.gunner, [a.id]);
  await drop(core, a2);
  await world.advance(59_000);
  assert.deepEqual(owner.room.places.gunner, [a.id], 'kept during the grace period');
  await world.advance(2_000);
  assert.deepEqual(owner.room.places.gunner, []);
  assert.deepEqual(owner.last('ev'), { t: 'ev', e: 'gone', id: a.id, why: 'gone' });
});

test('late join: now, next (admitted at the next safe point) and never', async () => {
  for (const lateJoin of ['now', 'next', 'never']) {
    const { world, core, owner } = await setup(CREW, { lateJoin });
    await cmd(core, owner, 'start');
    const a = await connect(world, core, { name: 'A' });
    if (lateJoin === 'never') {
      assert.equal(a.closedWith.code, CLOSE.IN_PROGRESS);
      const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
      assert.ok(tv.id, 'viewers may always join');
      continue;
    }
    assert.equal(a.room.players.find((p) => p.id === a.id).waiting, lateJoin === 'next');
    if (lateJoin === 'next') {
      assert.equal(owner.last('ev').e, 'waiting');
      await cmd(core, owner, 'admit');
      assert.equal(owner.last('ev').e, 'join');
      assert.equal(a.room.players.find((p) => p.id === a.id).waiting, false);
    }
  }
});

test('seats per role; a viewer link can never play; a new round admits those waiting', async () => {
  const { world, core, created, owner } = await setup(CREW, { access: 'private', lateJoin: 'next' });
  const v = await connect(world, core, { name: 'TV', key: created.keys.viewer.k });
  assert.equal(v.last('welcome').you.role, 'viewer');
  const v2 = await connect(world, core, { name: 'TV2', key: created.keys.viewer.k, role: 'player' });
  assert.equal(v2.last('welcome').you.role, 'viewer');
  const v3 = await connect(world, core, { name: 'TV3', key: created.keys.viewer.k });
  assert.equal(v3.closedWith.code, CLOSE.FULL);
  await connect(world, core, { name: 'A', key: created.keys.player.k });
  await cmd(core, owner, 'start');
  const b = await connect(world, core, { name: 'B', key: created.keys.player.k });
  const c = await connect(world, core, { name: 'C', key: created.keys.player.k });
  assert.equal(c.closedWith.code, CLOSE.FULL);
  assert.equal(b.room.players.find((p) => p.id === b.id).waiting, true);
  await cmd(core, owner, 'start');
  assert.equal(b.room.players.find((p) => p.id === b.id).waiting, false);
  assert.equal(b.room.round, 2);
});

test('roles are defined by the game: a referee needs its own link and cannot play', async () => {
  const options = {
    mode: 'host',
    roles: { player: { seats: 4 }, referee: { seats: 1, canPause: true }, viewer: { seats: 2 } },
  };
  const { world, core, created, owner } = await setup(options);
  assert.deepEqual(owner.room.roles, {
    player: { seats: 4, plays: true, sends: true },
    referee: { seats: 1, plays: false, sends: false },
    viewer: { seats: 2, plays: false, sends: false },
  });
  const sneaky = await connect(world, core, { name: 'X', role: 'referee' });
  assert.equal(sneaky.closedWith.code, CLOSE.KEY, 'a role with its own link cannot be picked by name');
  const ref = await connect(world, core, { name: 'Ref', key: created.keys.referee.k });
  assert.equal(ref.last('welcome').you.role, 'referee');
  await cmd(core, owner, 'start');
  await send(core, ref, { t: 'msg', d: 'not a player' });
  assert.equal(owner.messages('msg').length, 0);
  await cmd(core, ref, 'pause');
  assert.equal(owner.room.paused.id, ref.id, 'this game lets the referee pause');
  const unknown = await connect(world, core, { name: 'Y', role: 'wizard' });
  assert.equal(unknown.last('welcome').you.role, 'player', 'unknown roles fall back to the default');
});

test('private rooms: key required, renew stops old links, people inside stay, expiry', async () => {
  const { world, core, created, owner } = await setup(CREW, { access: 'private' });
  const none = await connect(world, core, { name: 'X' });
  assert.equal(none.closedWith.code, CLOSE.KEY);
  assert.equal(none.last('denied').reason, 'key-required');
  const a = await connect(world, core, { name: 'A', key: created.keys.player.k, pk: 'inside-key-xxxxxxxxxxxxx' });
  assert.ok(a.id);
  await cmd(core, owner, 'renew', { role: 'player' });
  assert.notEqual(owner.room.keys.player.k, created.keys.player.k);
  const old = await connect(world, core, { name: 'Y', key: created.keys.player.k });
  assert.equal(old.last('denied').reason, 'key-invalid');
  await drop(core, a);
  const a2 = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(a2.id, a.id, 'someone inside comes back without the key');
  await cmd(core, owner, 'renew', { role: 'viewer', ttlMs: 1_000 });
  const viewerKey = owner.room.keys.viewer.k;
  await world.advance(2_000);
  const late = await connect(world, core, { name: 'TV', key: viewerKey });
  assert.equal(late.last('denied').reason, 'key-expired');
  await cmd(core, owner, 'settings', { access: 'open' });
  const open = await connect(world, core, { name: 'Z' });
  assert.ok(open.id, 'open room: the code is enough');
  await cmd(core, owner, 'renew', { role: '__proto__' });
  assert.equal(owner.last('err').code, 'bad-role');
});

test('kick lets someone come back; a ban holds because the links are renewed', async () => {
  const { world, core, created, owner } = await setup({ ...CREW, roles: { player: { seats: 6 } } });
  const b = await connect(world, core, { name: 'B', pk: 'kicked-key-xxxxxxxxxxxxx' });
  await cmd(core, owner, 'kick', { id: b.id });
  assert.equal(b.closedWith.code, CLOSE.KICKED);
  assert.equal((await connect(world, core, { name: 'B', pk: b.pk })).id, b.id, 'and keeps the same id');

  const a = await connect(world, core, { name: 'A', pk: 'banned-key-xxxxxxxxxxxxx', key: created.keys.player.k });
  const stays = await connect(world, core, { name: 'S' });
  await cmd(core, owner, 'kick', { id: a.id, ban: true });
  assert.equal(a.closedWith.code, CLOSE.BANNED);
  assert.equal(a.last('denied').code, CLOSE.BANNED);
  assert.equal((await connect(world, core, { name: 'A', pk: a.pk })).closedWith.code, CLOSE.BANNED);
  // The same person in a new tab has a new player key, but the old link and the code no longer work.
  const newTab = await connect(world, core, { name: 'A', key: created.keys.player.k });
  assert.equal(newTab.closedWith.code, CLOSE.KEY);
  assert.equal(owner.room.settings.access, 'private');
  assert.notEqual(owner.room.keys.player.k, created.keys.player.k);
  assert.ok(stays.room.players.some((p) => p.id === stays.id), 'everyone else stays');
  await cmd(core, owner, 'kick', { id: owner.id });
  assert.equal(owner.last('err').code, 'no-such-participant');
});

test('the same participant in a new tab replaces the old connection', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'tab-key-xxxxxxxxxxxxxxxx' });
  const a2 = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(a.closedWith.code, CLOSE.REPLACED);
  assert.equal(a2.id, a.id);
  assert.equal(owner.last('ev').e, 'back', 'the host is told, so it can send the state again');
});

test('cleanup: a room is deleted 24 hours after the last participant left', async () => {
  const { world, core, owner } = await setup();
  await drop(core, owner);
  await world.advance(23 * 3600_000);
  assert.ok(world.store.get('room'));
  await world.advance(2 * 3600_000);
  assert.equal(world.store.size, 0);
  assert.equal(core.info(), null);
});

test('a closed room says so for an hour and is then forgotten', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'close');
  assert.equal(a.closedWith.code, CLOSE.ROOM_CLOSED);
  assert.equal(a.last('closed').reason, 'closed-by-owner');
  const late = await connect(world, core, { name: 'B' });
  assert.equal(late.closedWith.code, CLOSE.ROOM_CLOSED);
  assert.equal(core.info().closed, true);
  await world.advance(61 * 60_000);
  assert.equal(core.info(), null);
});

test('messages over the size limit are refused; names are trimmed', async () => {
  const { world, core, owner } = await setup({ ...CREW, maxMessageBytes: 100 });
  const a = await connect(world, core, { name: '  A\u0007very   long name that goes on and on  ' });
  assert.equal(a.room.players.find((p) => p.id === a.id).name, 'Avery long name that goe');
  await send(core, a, { t: 'msg', n: 1, d: 'x'.repeat(200) });
  assert.deepEqual(a.last('err'), { t: 'err', code: 'too-large', n: 1 });
  assert.equal(owner.messages('msg').length, 0);
});

test('bad options fail early', async () => {
  const { RoomCore } = await import('../../src/server/room-core.js');
  assert.throws(() => new RoomCore({}, { mode: 'peer' }), /unknown mode/);
  assert.throws(() => new RoomCore({}, { mode: 'server' }), /needs rules/);
  assert.throws(() => new RoomCore({}, { ownerRole: 'leader' }), /ownerRole/);
  assert.throws(() => new RoomCore({}, { roles: { 'Bad Name': {} } }), /bad role name/);
});

test('a quiz: the leader runs the game without playing', async () => {
  const { world, core, created, owner } = await setup(QUIZ);
  assert.equal(owner.last('welcome').you.role, 'leader');
  assert.equal(owner.room.hostId, owner.id);
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  assert.equal(a.last('welcome').you.role, 'player', 'the default role is the one that plays');
  const second = await connect(world, core, { name: 'L2', role: 'leader' });
  assert.equal(second.closedWith.code, CLOSE.KEY, 'nobody can pick the leader role by name');
  await cmd(core, owner, 'start');
  await send(core, a, { t: 'msg', d: 'buzz' });
  assert.equal(owner.last('msg').from, a.id);
  await send(core, owner, { t: 'msg', d: 'question', to: { role: 'player' } });
  assert.equal(a.last('msg').d, 'question');
  assert.equal(b.last('msg').d, 'question');
  assert.deepEqual(core.info().participants, { leader: 1, player: 2, viewer: 0 });
  assert.ok(created.keys.leader, 'every role has its own link');
});

test('server-run room: the memory example with turns, a timer and a secret seed', async () => {
  const options = { mode: 'server', rules: memoryRules, roles: { player: { seats: 4 } }, lateJoin: 'never', countdownMs: 0 };
  const { world, core, owner } = await setup(options);
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  assert.equal(owner.room.phase, 'playing');
  assert.equal('seed' in owner.room, false, 'the seed that shuffles the cards is not sent to clients');
  const board = owner.last('msg').d;
  assert.equal(board.cards.length, 8);
  assert.ok(board.cards.every((c) => c === null), 'faces hidden');
  assert.equal(board.turn, owner.id);
  await send(core, b, { t: 'msg', d: { type: 'flip', index: 0 } }); // not B's turn
  assert.deepEqual(b.last('msg').d.cards, board.cards);
  const cards = core.state.game.cards;
  const j = cards.findIndex((c, i) => i > 0 && c !== cards[0]);
  await send(core, owner, { t: 'msg', d: { type: 'flip', index: 0 } });
  await send(core, owner, { t: 'msg', d: { type: 'flip', index: j } });
  assert.equal(b.last('msg').d.cards[0], cards[0]);
  await world.advance(1_000);
  assert.equal(b.last('msg').d.cards[0], null, 'hidden again by the timer');
  assert.equal(b.last('msg').d.turn, b.id, 'the turn passes on');
  const k = cards.findIndex((c, i) => c === cards[0] && i !== 0);
  await send(core, b, { t: 'msg', d: { type: 'flip', index: 0 } });
  await send(core, b, { t: 'msg', d: { type: 'flip', index: k } });
  assert.equal(b.last('msg').d.scores[b.id], 1);
  assert.equal(b.last('msg').d.turn, b.id, 'a match keeps the turn');
});
