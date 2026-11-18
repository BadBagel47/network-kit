// The owner (rights and keys) and the host (runs the game): waiting for a
// lost host, takeover where the game allows it, silent hosts, handing over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld, connect, send, cmd, drop, sendInParts } from './fake-host.js';
import { setup, CREW, QUIZ } from './setup.js';
import { CLOSE, CLOSE_UNRESPONSIVE } from '../../src/shared/protocol.js';
import { memoryRules } from '../../examples/demo/memory-rules.js';

const WAIT = { mode: 'host', roles: { player: { seats: 4 }, viewer: { seats: 2 } }, graceMs: 60_000 };

test('default: a lost host is waited for and nobody else can become host', async () => {
  const { world, core, created, owner } = await setup(WAIT);
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await world.advance(4_000);
  await send(core, owner, { t: 'snap', d: { answers: 'secret' } });
  await drop(core, owner);
  assert.deepEqual(a.room.paused.reason, 'host-away');
  await cmd(core, a, 'resume');
  assert.equal(a.room.paused.reason, 'host-away', 'waiting for the host cannot be resumed away');
  await world.advance(30_000);
  assert.equal(a.room.hostId, owner.id);
  assert.equal(a.messages('host').length, 0);

  // Back in the same page: the game continues at once, no state is needed.
  const back = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(a.room.paused, null);
  assert.equal(back.messages('host').length, 0);

  // Away past the grace period: the seat is freed, the room keeps waiting.
  await drop(core, back);
  await world.advance(61_000);
  assert.equal(a.room.hostId, null);
  assert.equal(a.room.ownerId, null);
  assert.equal(a.room.paused.reason, 'host-away');
  assert.equal(a.messages('host').length, 0, 'no participant was ever made host');

  // The owner returns, even from another device: same seat, and the state only goes to them.
  const other = await connect(world, core, { name: 'Owner', pk: 'another-device-key-xxxxx', owner: created.ownerKey, sid: 'new' });
  assert.equal(other.room.ownerId, other.id);
  assert.equal(other.room.hostId, other.id);
  assert.deepEqual(other.last('host').snapshot, { answers: 'secret' });
  assert.equal(a.room.paused.reason, 'host-change');
  await cmd(core, other, 'host-ready');
  assert.equal(a.room.paused, null);
  assert.ok(!JSON.stringify(a.sent).includes('secret'), 'the kept state never reached a participant');
});

test('without takeover a game may close the room after waiting long enough', async () => {
  const { world, core, owner } = await setup({ ...WAIT, closeAfterHostAwayMs: 120_000 });
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await drop(core, owner);
  await world.advance(119_000);
  assert.equal(a.closedWith, null);
  await world.advance(2_000);
  assert.equal(a.closedWith.code, CLOSE.ROOM_CLOSED);
  assert.equal(a.last('closed').reason, 'host-away');
});

test('takeover: another participant runs the game, the owner keeps the rights', async () => {
  const { world, core, created, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  await world.advance(4_000);
  await send(core, owner, { t: 'snap', d: { tick: 42 } });
  await drop(core, owner);
  assert.equal(a.room.paused.reason, 'host-away');
  await world.advance(4_000);
  assert.equal(a.messages('host').length, 0, 'no takeover during the short wait');
  await world.advance(2_000);
  assert.deepEqual(a.last('host').snapshot, { tick: 42 });
  assert.equal(b.messages('host').length, 0);
  assert.equal(b.room.hostId, a.id);
  assert.equal(b.room.ownerId, owner.id, 'ownership did not move');
  assert.equal(b.room.paused.reason, 'host-change');
  assert.ok(!a.room.keys, 'the stand-in does not get the invitation keys');
  assert.ok(!JSON.stringify(a.sent).includes(created.ownerKey), 'nor the owner key');
  await cmd(core, a, 'host-ready');
  assert.equal(b.room.paused, null);
  await send(core, b, { t: 'msg', d: 'to the new host' });
  assert.equal(a.last('msg').d, 'to the new host');

  // The stand-in may run the game but not the room.
  await cmd(core, a, 'kick', { id: b.id });
  assert.equal(a.last('err').code, 'owner-only');
  await cmd(core, a, 'start');
  assert.equal(b.room.round, 2);

  // The owner comes back: rights and keys are there, the game stays where it runs.
  const back = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(back.room.ownerId, back.id);
  assert.equal(back.room.hostId, a.id);
  assert.ok(back.room.keys);
  assert.equal(back.messages('host').length, 0);
  await cmd(core, back, 'kick', { id: b.id });
  assert.equal(b.closedWith.code, CLOSE.KICKED);

  // The stand-in leaving on purpose does not close the room; the game goes back to the owner.
  await send(core, a, { t: 'snap', d: { tick: 99 } });
  await cmd(core, a, 'leave');
  assert.equal(back.closedWith, null);
  assert.equal(back.room.hostId, back.id);
  assert.deepEqual(back.last('host').snapshot, { tick: 99 });
});

test('a host that comes back within the wait keeps the game', async () => {
  const { world, core, created, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await drop(core, owner);
  await world.advance(2_000);
  const back = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  await world.advance(10_000);
  assert.equal(a.room.hostId, back.id);
  assert.equal(a.room.paused, null);
  assert.equal(a.messages('host').length, 0);
  assert.equal(back.messages('host').length, 0, 'same page: it still has the game');
});

test('the "you run the game" message is repeated until the new host confirms', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'new-host-key-xxxxxxxxxxx' });
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  await send(core, owner, { t: 'snap', d: { tick: 7 } });
  await drop(core, owner);
  await world.advance(6_000);
  assert.equal(a.messages('host').length, 1);
  // That message landed on a dead connection; A reconnects without the room having seen a drop.
  const a2 = await connect(world, core, { name: 'A', pk: a.pk });
  assert.deepEqual(a2.last('host').snapshot, { tick: 7 });
  assert.equal(b.room.paused.reason, 'host-change');
  await cmd(core, a2, 'host-ready');
  assert.equal(b.room.paused, null);
  const a3 = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(a3.messages('host').length, 0, 'not repeated once confirmed');
});

test('a host whose page reloads gets the kept state back', async () => {
  const { world, core, created, owner } = await setup(WAIT);
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await send(core, owner, { t: 'snap', d: { tick: 7 } });
  await drop(core, owner);
  const again = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey, sid: 'page2' });
  assert.deepEqual(again.last('host').snapshot, { tick: 7 });
  assert.equal(a.room.paused.reason, 'host-change');
  await cmd(core, again, 'host-ready');
  assert.equal(a.room.paused, null);
});

test('takeover with nobody online: the next eligible participant to connect takes over', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A', pk: 'late-key-xxxxxxxxxxxxxxx' });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  await cmd(core, owner, 'start');
  await send(core, owner, { t: 'snap', d: { s: 1 } });
  await drop(core, a);
  await drop(core, owner);
  await world.advance(6_000);
  assert.equal(tv.messages('host').length, 0, 'a viewer cannot run the game');
  assert.equal(tv.room.hostId, owner.id);
  const a2 = await connect(world, core, { name: 'A', pk: a.pk });
  assert.equal(a2.room.hostId, a2.id);
  assert.deepEqual(a2.last('host').snapshot, { s: 1 });
});

test('someone who slips in before the creator does not get the game', async () => {
  const { FakeWorld } = await import('./fake-host.js');
  const world = new FakeWorld();
  const core = await world.core(CREW);
  const created = await core.create({}, 'ABCDE');
  const early = await connect(world, core, { name: 'Early' });
  assert.equal(early.room.hostId, null);
  assert.equal(early.messages('host').length, 0);
  const owner = await connect(world, core, { name: 'Owner', owner: created.ownerKey });
  assert.equal(owner.room.hostId, owner.id);
  assert.equal(owner.room.ownerId, owner.id);
});

test('handover: the host gives the game to a chosen participant; the owner can take it back', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  await send(core, owner, { t: 'snap', d: { v: 2 } });
  await cmd(core, owner, 'handover', { id: tv.id });
  assert.equal(owner.last('err').code, 'no-such-participant');
  await cmd(core, owner, 'handover', { id: b.id });
  assert.equal(a.room.hostId, b.id);
  assert.deepEqual(b.last('host').snapshot, { v: 2 });
  await cmd(core, b, 'host-ready');
  await cmd(core, a, 'handover', { id: a.id });
  assert.equal(a.last('err').code, 'host-only');
  await send(core, b, { t: 'snap', d: { v: 3 } });
  await cmd(core, owner, 'handover', { id: owner.id });
  assert.equal(a.room.hostId, owner.id);
  assert.deepEqual(owner.last('host').snapshot, { v: 3 });
});

test('a silent host is checked and replaced within seconds', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  await world.advance(10_000);
  await send(core, owner, { t: 'snap', d: { tick: 5 } });
  await core.flush();
  world.puts = [];

  // The host answers: nothing happens, and nothing is written.
  const checks = owner.messages('check').length;
  await send(core, b, { t: 'cmd', c: 'host-check' });
  assert.equal(owner.messages('check').length, checks + 1);
  await send(core, b, { t: 'cmd', c: 'host-check' });
  await send(core, a, { t: 'cmd', c: 'host-check' });
  assert.equal(owner.messages('check').length, checks + 1, 'one check at a time');
  await world.advance(5_000); // the fake client answers like a living one
  assert.equal(b.room.hostId, owner.id);
  assert.equal(owner.closedWith, null);
  assert.deepEqual(world.puts, [], 'checking a healthy host costs no storage writes');

  // The host's phone went to sleep: its connection looks open but nothing comes back.
  owner.alive = false;
  await world.advance(5_000);
  await send(core, b, { t: 'cmd', c: 'host-check' });
  await world.advance(2_900);
  assert.equal(b.room.hostId, owner.id);
  await world.advance(200);
  assert.equal(owner.closedWith.code, CLOSE_UNRESPONSIVE);
  assert.equal(b.room.hostId, a.id, 'taken over at once, without the usual wait');
  assert.deepEqual(a.last('host').snapshot, { tick: 5 });
  assert.equal(b.room.players.find((p) => p.id === owner.id).status, 'away');
});

test('a silent host without takeover: the room knows it is waiting', async () => {
  const { world, core, owner } = await setup(WAIT);
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await world.advance(10_000);
  owner.alive = false;
  await send(core, a, { t: 'cmd', c: 'host-check' });
  await world.advance(3_100);
  assert.equal(a.room.paused.reason, 'host-away');
  assert.equal(a.room.hostId, owner.id);
  assert.equal(a.messages('host').length, 0);
});

test('B4: a next host whose phone is asleep is passed over', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  await world.advance(4_000);
  await send(core, owner, { t: 'snap', d: { tick: 8 } });
  a.alive = false; // A's connection is half-open
  await drop(core, owner);
  await world.advance(5_100);
  assert.equal(b.room.hostId, a.id, 'A is picked first');
  assert.equal(b.room.paused.reason, 'host-change');
  await world.advance(3_100); // A never confirms
  assert.equal(a.closedWith.code, CLOSE_UNRESPONSIVE);
  assert.equal(b.room.hostId, b.id);
  assert.deepEqual(b.last('host').snapshot, { tick: 8 });
  await cmd(core, b, 'host-ready');
  assert.equal(b.room.paused, null);
});

test('B16: a room emptied by a host check is still cleaned up', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await world.advance(10_000);
  owner.alive = false;
  await send(core, a, { t: 'cmd', c: 'host-check' });
  await drop(core, a); // the reporter drops before the answer is due
  await world.advance(3_100);
  assert.equal(owner.closedWith.code, CLOSE_UNRESPONSIVE);
  assert.ok(core.state.timers.some((t) => t.kind === 'cleanup'), 'on its way to being deleted');
  await world.advance(25 * 3600_000);
  assert.equal(world.store.size, 0);
});

test('ownership passes on only where the game asks for it', async () => {
  const { world, core, created, owner } = await setup({ ...CREW, passOwnerAfterMs: 600_000 });
  const a = await connect(world, core, { name: 'A' });
  await drop(core, owner);
  await world.advance(6_000); // A runs the game now
  await world.advance(590_000);
  assert.equal(a.room.ownerId, null, 'the owner is away but still the owner');
  assert.ok(!a.room.keys);
  await world.advance(10_000);
  assert.equal(a.room.ownerId, a.id);
  assert.ok(a.room.keys, 'the new owner gets the invitation keys');
  const newKey = a.last('owner').key;
  assert.ok(newKey && newKey !== created.ownerKey);
  // The old owner key no longer works: the old owner comes back as a normal participant.
  const old = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(old.room.ownerId, a.id);
  assert.ok(!old.room.keys);
});

test('default: ownership never moves by itself, however long the owner is away', async () => {
  const { world, core, created, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await drop(core, owner);
  await world.advance(3 * 3600_000);
  assert.equal(a.room.ownerId, null);
  assert.equal(a.room.hostId, a.id);
  await cmd(core, a, 'renew', { role: 'player' });
  assert.equal(a.last('err').code, 'owner-only');
  const back = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(back.room.ownerId, back.id);
  assert.ok(back.room.keys);
});

test('owner leaving on purpose: closes the room, or passes it on where the game says so', async () => {
  {
    const { world, core, owner } = await setup();
    const a = await connect(world, core, { name: 'A' });
    await cmd(core, owner, 'leave');
    assert.equal(owner.closedWith.code, CLOSE.LEFT);
    assert.equal(a.closedWith.code, CLOSE.ROOM_CLOSED);
    assert.equal(a.last('closed').reason, 'owner-left');
  }
  {
    const { world, core, owner } = await setup({ ...CREW, ownerLeave: 'pass' });
    const a = await connect(world, core, { name: 'A' });
    await send(core, owner, { t: 'snap', d: { last: 1 } });
    await cmd(core, owner, 'leave');
    assert.equal(a.closedWith, null);
    assert.equal(a.room.ownerId, a.id);
    assert.equal(a.room.hostId, a.id);
    assert.deepEqual(a.last('host').snapshot, { last: 1 });
    assert.ok(a.last('owner').key);
  }
  {
    // Nobody is there to receive it: the next eligible participant becomes the owner.
    const { world, core, owner } = await setup({ ...WAIT, ownerLeave: 'pass' });
    await cmd(core, owner, 'leave');
    const next = await connect(world, core, { name: 'Next' });
    assert.equal(next.room.ownerId, next.id);
    assert.equal(next.room.hostId, next.id);
    assert.ok(next.last('owner').key);
  }
});

test('the owner can give the room to someone else', async () => {
  const { world, core, created, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, a, 'owner', { id: a.id });
  assert.equal(a.last('err').code, 'owner-only');
  await cmd(core, owner, 'owner', { id: a.id });
  assert.equal(owner.room.ownerId, a.id);
  assert.ok(a.room.keys);
  assert.ok(!owner.room.keys);
  assert.equal(owner.room.hostId, owner.id, 'the game stays where it runs');
  const again = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(again.room.ownerId, a.id, 'the old key is void');
});

test('quiz leader: players never get the game, even if the leader is gone for good', async () => {
  const { world, core, created, owner } = await setup(QUIZ);
  const a = await connect(world, core, { name: 'A' });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  await cmd(core, owner, 'start');
  await world.advance(4_000);
  await send(core, owner, { t: 'snap', d: { answer: 'xyzzy-secret' } });
  await drop(core, owner);
  await world.advance(3600_000);
  for (const ws of [a, tv]) {
    assert.equal(ws.messages('host').length, 0);
    assert.equal(ws.room.hostId, null);
    assert.equal(ws.room.paused.reason, 'host-away');
    assert.ok(!JSON.stringify(ws.sent).includes('xyzzy'));
  }
  const leader = await connect(world, core, { name: 'Leader', pk: owner.pk, owner: created.ownerKey, sid: 'later' });
  assert.equal(leader.last('welcome').you.role, 'leader');
  assert.deepEqual(leader.last('host').snapshot, { answer: 'xyzzy-secret' });
});

test('server-run rooms: the owner leads; an absent owner can always come back and start', async () => {
  const options = { mode: 'server', rules: memoryRules, roles: { player: { seats: 4 } }, countdownMs: 0, graceMs: 60_000 };
  const { world, core, created, owner } = await setup(options);
  const b = await connect(world, core, { name: 'B' });
  assert.equal(b.room.hostId, owner.id);
  assert.equal(owner.messages('host').length, 0, 'nobody runs the game in a browser');
  await cmd(core, b, 'start');
  assert.equal(b.last('err').code, 'host-only');
  await drop(core, owner);
  await world.advance(61_000);
  assert.equal(b.room.ownerId, null);
  const back = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  await cmd(core, back, 'start');
  assert.equal(b.room.phase, 'playing');
  assert.equal(b.last('msg').d.type, 'board');
});

test('a countdown can be called off; shared room data reaches everyone', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'data', { d: { map: 3, mode: 'versus' } });
  assert.deepEqual(a.room.data, { map: 3, mode: 'versus' });
  await cmd(core, a, 'data', { d: { map: 9 } });
  assert.equal(a.last('err').code, 'host-only');
  await cmd(core, owner, 'data', { d: 'x'.repeat(5000) });
  assert.equal(owner.last('err').code, 'too-large');
  await cmd(core, owner, 'start');
  assert.equal(a.room.phase, 'countdown');
  assert.ok(a.room.startsAt > a.room.now);
  assert.equal(typeof a.room.seed, 'number');
  await cmd(core, owner, 'cancel');
  assert.equal(a.room.phase, 'lobby');
  await cmd(core, owner, 'cancel');
  assert.equal(owner.last('err').code, 'not-allowed');
  await cmd(core, owner, 'start');
  await world.advance(3_100);
  const late = await connect(world, core, { name: 'Late' });
  assert.equal(late.room.phase, 'playing');
  assert.deepEqual(late.room.data, { map: 3, mode: 'versus' }, 'someone joining later sees it too');
});

test('the owner moving to another device takes the seat and the game along at once', async () => {
  const { world, core, created, owner } = await setup(QUIZ);
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await send(core, owner, { t: 'snap', d: { answer: 'xyzzy-secret' } });
  await drop(core, owner); // the leader's computer dies; the seat is held for the grace period
  const moved = await connect(world, core, { name: 'Leader', pk: 'the-leaders-phone-key-xx', owner: created.ownerKey, sid: 'phone' });
  assert.equal(moved.last('welcome').you.role, 'leader');
  assert.equal(a.room.ownerId, moved.id);
  assert.equal(a.room.hostId, moved.id);
  assert.deepEqual(a.room.players.filter((p) => p.role === 'leader').map((p) => p.id), [moved.id], 'one leader, not two');
  assert.deepEqual(moved.last('host').snapshot, { answer: 'xyzzy-secret' });
  await cmd(core, moved, 'host-ready');
  assert.equal(a.room.paused, null);
  await world.advance(120_000);
  assert.equal(a.room.hostId, moved.id, 'the old seat\'s grace timer does nothing any more');
});

// ---- B-034: the host role outside a game ---------------------------------

test('B-034: in the lobby a short absence of the host moves nothing, even with takeover on', async () => {
  const { world, core, created, owner } = await setup();
  const b = await connect(world, core, { name: 'B' });
  await drop(core, owner); // the owner's phone switches to another app
  await world.advance(30_000);
  assert.equal(b.room.hostId, owner.id);
  assert.equal(b.messages('host').length, 0);
  assert.equal(b.room.paused, null, 'nothing is running, so nothing is paused');
  const c = await connect(world, core, { name: 'C' });
  assert.equal(c.room.hostId, owner.id, 'nor does someone who connects meanwhile get it');
  const back = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(back.room.hostId, back.id);
  assert.equal(back.messages('host').length, 0, 'same page: it still has everything');
});

test('B-034: the owner back between games gets the host role back, with the kept state', async () => {
  const { world, core, created, owner } = await setup();
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  await world.advance(4_000);
  await drop(core, owner);
  await world.advance(6_000);
  assert.equal(b.room.hostId, b.id, 'during the game B took over');
  await cmd(core, b, 'host-ready');
  await send(core, b, { t: 'snap', d: { series: 'B leads 1-0' } });
  await cmd(core, b, 'end');
  const back = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(back.room.hostId, back.id);
  assert.deepEqual(back.last('host').snapshot, { series: 'B leads 1-0' }, 'the next round continues the series');
  assert.equal(b.room.hostId, back.id);
  await cmd(core, back, 'host-ready');
  assert.equal(b.room.paused, null);
});

test('B-034: the owner back during a game leaves it where it runs', async () => {
  const { world, core, created, owner } = await setup();
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  await world.advance(4_000);
  await drop(core, owner);
  await world.advance(6_000);
  await cmd(core, b, 'host-ready');
  const back = await connect(world, core, { name: 'Owner', pk: owner.pk, owner: created.ownerKey });
  assert.equal(back.room.hostId, b.id);
  assert.equal(back.room.ownerId, back.id);
});

test('B-034: in the lobby a host gone for good is replaced, so the others can still start', async () => {
  const { world, core, owner } = await setup();
  const b = await connect(world, core, { name: 'B' });
  await drop(core, owner);
  await world.advance(61_000); // past the grace period
  assert.equal(b.room.hostId, b.id);
  await cmd(core, b, 'start');
  assert.equal(b.room.round, 1);
});

test('B-034: starting while the host is away starts the wait for a takeover', async () => {
  const { world, core, created, owner } = await setup({ ...CREW, ownerLeave: 'pass' });
  const b = await connect(world, core, { name: 'B' });
  const c = await connect(world, core, { name: 'C' });
  await cmd(core, owner, 'handover', { id: b.id });
  await cmd(core, b, 'host-ready');
  await drop(core, b); // the host steps away in the lobby
  await world.advance(10_000);
  assert.equal(c.room.hostId, b.id);
  await cmd(core, owner, 'start');
  assert.equal(c.room.paused.reason, 'host-away');
  await world.advance(5_100);
  assert.notEqual(c.room.hostId, b.id, 'now there is a game to continue');
  assert.ok(created.ownerKey);
});

test('F-039: a role with sendsTo "all" reaches everyone directly, also while the host is away', async () => {
  const opts = { ...CREW, roles: { player: { seats: 4, sendsTo: 'all' }, viewer: { seats: 2 } } };
  const { world, core, owner } = await setup(opts);
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  assert.equal(owner.room.roles.player.sendsTo, 'all');
  await send(core, a, { t: 'msg', d: { aim: 45 } });
  for (const ws of [owner, b, tv]) assert.deepEqual((({ at, ...m }) => m)(ws.last('msg')), { t: 'msg', from: a.id, d: { aim: 45 } }); // F-063 adds `at`
  await send(core, a, { t: 'msg', d: 'just B', to: [b.id] });
  assert.equal(b.last('msg').d, 'just B');
  assert.notEqual(tv.last('msg').d, 'just B');
  await drop(core, owner);
  await send(core, a, { t: 'msg', d: 'host away' });
  assert.equal(b.last('msg').d, 'host away');
  // A viewer (no sendsTo) still cannot send at all.
  await send(core, tv, { t: 'msg', d: 'nope' });
  assert.notEqual(b.last('msg').d, 'nope');
});

test('F-039: by default a participant still reaches only the host', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  await send(core, a, { t: 'msg', d: 'to host' });
  assert.equal(owner.last('msg').d, 'to host');
  assert.equal(b.last('msg'), undefined);
});

test('F-040: the host names who takes over first', async () => {
  const { world, core, owner } = await setup({ ...CREW, roles: { player: { seats: 4 }, viewer: { seats: 2 } } });
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  const c = await connect(world, core, { name: 'C' });
  await cmd(core, owner, 'start');
  await cmd(core, a, 'successors', { ids: [c.id] });
  assert.equal(a.last('err').code, 'host-only');
  await cmd(core, owner, 'successors', { ids: [c.id, b.id] });
  assert.deepEqual(owner.room.successors, [c.id, b.id]);
  // The owner is the host and drops: C (whose turn it is) takes over, not A who came first.
  await world.advance(3_500);
  await drop(core, owner);
  await world.advance(CREW.takeoverMs + 100);
  assert.equal(core.state.hostId, c.id);
});

test('F-040: a preferred successor that does not answer is passed over for the next', async () => {
  const { world, core, owner } = await setup(CREW);
  const a = await connect(world, core, { name: 'A' });
  const b = await connect(world, core, { name: 'B' });
  await cmd(core, owner, 'start');
  await cmd(core, owner, 'successors', { ids: [b.id, a.id] });
  await world.advance(3_500);
  b.alive = false; // B's phone sleeps: it will not answer the room's "are you there?"
  await drop(core, owner);
  await world.advance(CREW.takeoverMs + 3_000 + 3_200); // takeover wait, then B's 3 s to answer
  assert.equal(core.state.hostId, a.id);
});

// --------------------------------------------- F-029 rooms from an invitation

test('F-029: a room made by the game\'s server: the first who may lead becomes owner and host', async () => {
  const world = new FakeWorld();
  const core = await world.core(CREW);
  const made = await core.create({}, 'INVT', { open: true });
  assert.equal(made.ownerKey, undefined, 'no owner key: nobody created it from a page');
  assert.ok(made.keys.player.k);
  const a = await connect(world, core, { name: 'A', key: made.keys.player.k });
  assert.equal(core.state.ownerId, a.id);
  assert.equal(core.state.hostId, a.id);
  assert.ok(a.last('owner')?.key, 'A gets the owner key, so a reload keeps the ownership');
  const b = await connect(world, core, { name: 'B', key: made.keys.player.k });
  assert.equal(core.state.ownerId, a.id, 'the second is an ordinary participant');
  assert.equal(b.room.ownerId, a.id);
});

test('F-029: a viewer opening the invitation first does not become owner', async () => {
  const world = new FakeWorld();
  const core = await world.core(CREW);
  const made = await core.create({}, 'INVT', { open: true });
  const tv = await connect(world, core, { name: 'TV', role: 'viewer', key: made.keys.viewer.k });
  assert.equal(core.state.ownerId, null);
  const a = await connect(world, core, { name: 'A', key: made.keys.player.k });
  assert.equal(core.state.ownerId, a.id);
  assert.equal(tv.room.ownerId, a.id);
});

// ------------------------------------------------- F-030 state for newcomers

test('F-030: the host sets a state for newcomers, shared or per role; the room keeps it', async () => {
  const { world, core, owner } = await setup(CREW);
  await send(core, owner, { t: 'welcome-state', d: { board: 'all players see this' } });
  await send(core, owner, { t: 'welcome-state', role: 'viewer', d: { board: 'the big screen' } });
  const a = await connect(world, core, { name: 'A' });
  assert.deepEqual(a.last('welcome-state'), { t: 'welcome-state', d: { board: 'all players see this' } });
  const order = a.messages().map((m) => m.t);
  assert.ok(order.indexOf('welcome') < order.indexOf('welcome-state'), 'right after the welcome');
  const tv = await connect(world, core, { name: 'TV', role: 'viewer' });
  assert.deepEqual(tv.last('welcome-state').d, { board: 'the big screen' });
  // Only the host may set it.
  await send(core, a, { t: 'welcome-state', d: 'mine' });
  // Kept while the room sleeps, and sent to someone who comes back.
  await world.advance(6_000);
  const core2 = await world.sleep();
  await drop(core2, a);
  const back = await connect(world, core2, { name: 'A', pk: a.pk });
  assert.deepEqual(back.last('welcome-state').d, { board: 'all players see this' });
  // null removes it.
  await send(core2, owner, { t: 'welcome-state', d: null });
  const b = await connect(world, core2, { name: 'B' });
  assert.equal(b.last('welcome-state'), undefined);
});

test('F-030: a large state for newcomers is kept in parts', async () => {
  const { world, core, owner } = await setup(CREW);
  const big = { cells: 'x'.repeat(100_000) };
  await sendInParts(core, owner, { t: 'welcome-state', d: big });
  await world.advance(6_000);
  const core2 = await world.sleep();
  const a = await connect(world, core2, { name: 'A' });
  assert.equal(a.last('welcome-state').d.cells.length, 100_000);
});

// ------------------------------------------------- F-031 lifting a ban

test('F-031: the owner sees who was banned and can lift a ban; a new link lets them back in', async () => {
  const { world, core, owner } = await setup(CREW);
  const a = await connect(world, core, { name: 'Annoying', pk: 'annoying-player-key-xxxx' });
  await cmd(core, owner, 'kick', { id: a.id, ban: true });
  assert.deepEqual(owner.room.bans.map((b) => [b.id, b.name]), [[a.id, 'Annoying']]);
  const b = await connect(world, core, { name: 'B', key: core.state.keys.player.k });
  assert.equal(b.room.bans, undefined, 'only the owner sees the list');
  await cmd(core, b, 'unban', { id: a.id });
  assert.equal(b.last('err').code, 'owner-only');
  const refused = await connect(world, core, { name: 'Annoying', pk: a.pk, key: core.state.keys.player.k });
  assert.equal(refused.closedWith.code, CLOSE.BANNED);
  await cmd(core, owner, 'unban', { id: a.id });
  assert.deepEqual(owner.room.bans, []);
  const back = await connect(world, core, { name: 'Annoying', pk: a.pk, key: core.state.keys.player.k });
  assert.ok(back.id, 'back in with a new link');
  await cmd(core, owner, 'unban', { id: 'nobody' });
  assert.equal(owner.last('err').code, 'no-such-participant');
});

// ------------------------------------------------- F-032 forgotten rooms

test('F-032: a room whose pages have all been hidden for idleCloseMs closes', async () => {
  const { world, core, owner } = await setup({ ...CREW, idleCloseMs: 10 * 60_000 });
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'visibility', { hidden: true });
  await world.advance(20 * 60_000);
  assert.equal(core.state.closed, null, 'A still looks at the page');
  await cmd(core, a, 'visibility', { hidden: true });
  await world.advance(9 * 60_000);
  await cmd(core, a, 'visibility', { hidden: false }); // back for a moment
  await cmd(core, a, 'visibility', { hidden: true });
  await world.advance(9 * 60_000);
  assert.equal(core.state.closed, null, 'the wait starts again when someone looks');
  await world.advance(2 * 60_000);
  assert.equal(core.state.closed?.reason, 'idle');
  assert.equal(owner.closedWith?.code, CLOSE.ROOM_CLOSED);
});

test('F-032: idleCloseMs null turns the idle close off', async () => {
  const { world, core, owner } = await setup({ ...CREW, idleCloseMs: null });
  await cmd(core, owner, 'visibility', { hidden: true });
  await world.advance(3 * 60 * 60_000);
  assert.equal(core.state.closed, null);
});
