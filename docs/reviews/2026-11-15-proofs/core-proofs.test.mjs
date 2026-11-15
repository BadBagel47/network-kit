// Throwaway review proofs against the fake host. Each test PASSES when the suspected problem EXISTS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld, FakeSocket, connect, send, drop } from '../../../tests/unit/fake-host.js';
import { CLOSE } from '../../../src/shared/protocol.js';
import { memoryRules } from '../../../examples/demo/memory-rules.js';

const HOST_OPTS = { mode: 'host', posts: ['captain', 'gunner', 'engineer'], limits: { player: 3, viewer: 2 }, graceMs: 60_000, takeoverMs: 5_000, autoPauseMs: 20_000 };
async function setup(options = HOST_OPTS, settings = {}) {
  const world = new FakeWorld();
  const core = await world.core(options);
  const created = await core.create(settings, 'ABCDE');
  const host = await connect(world, core, { name: 'Host', hk: created.hostKey, pk: 'host-key-xxxxxxxxxxxxxxxx' });
  return { world, core, created, host };
}

test('P1 hibernation + silent socket replacement: lastN is stale, relayed messages are delivered twice', async () => {
  const { world, core, host } = await setup();
  const pk = 'a-key-xxxxxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  for (let n = 1; n <= 5; n++) await send(core, a, { t: 'msg', n, d: `input-${n}` });
  assert.equal(host.messages('msg').length, 5);
  // Room goes quiet and hibernates (in-memory state lost; storage + attachments survive).
  const woke = await world.core(HOST_OPTS);
  assert.equal(a.attachment.n, 5, 'the old socket attachment still knows n=5');
  // A's phone switches network: a NEW socket says hello before the server noticed the old one died.
  const a2 = await connect(world, woke, { name: 'A', pk });
  console.log('P1 welcome.lastN after hibernation+replace =', a2.last('welcome').lastN, '(should be 5)');
  assert.equal(a2.last('welcome').lastN, 0);
  // The client resends everything with n > lastN (its queue still holds 1..5).
  for (let n = 1; n <= 5; n++) await send(woke, a2, { t: 'msg', n, d: `input-${n}` });
  console.log('P1 host received', host.messages('msg').map((m) => m.d).join(','));
  assert.equal(host.messages('msg').length, 10, 'all five inputs delivered twice');
});

test('P2 snapshot newer than the last save is lost when the room hibernates', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await send(core, host, { t: 'snap', d: { move: 1 } }); // saved (first one)
  await world.advance(4_000);
  await send(core, host, { t: 'snap', d: { move: 2 } }); // < snapshotSaveMs since last save: memory only
  assert.deepEqual(world.store.get('snapshot').d, { move: 1 });
  // Nothing happens for a while (turn-based game, lobby, game over): the room hibernates.
  await world.advance(30_000);
  const woke = await world.core(HOST_OPTS);
  await drop(woke, host); // host's browser dies
  await world.advance(6_000);
  console.log('P2 new host continues from', JSON.stringify(a.last('host').snapshot), '(latest sent was {"move":2})');
  assert.deepEqual(a.last('host').snapshot, { move: 1 });
});

test('P3 silent socket replacement gives the host no "back" event (nothing tells it to resend state)', async () => {
  const { world, core, host } = await setup();
  const pk = 'b-key-xxxxxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  host.clear();
  await send(core, host, { t: 'msg', d: { delta: 1 } }); // goes to the old (dead) socket
  const a2 = await connect(world, core, { name: 'A', pk }); // same page session, new socket
  await send(core, host, { t: 'msg', d: { delta: 2 } });
  console.log('P3 events seen by host:', JSON.stringify(host.messages('ev')), '| new socket got deltas:', JSON.stringify(a2.messages('msg').map((m) => m.d)));
  assert.equal(host.messages('ev').length, 0);
  assert.deepEqual(a2.messages('msg').map((m) => m.d), [{ delta: 2 }], 'delta 1 was lost, and nobody was told');
});

test('P4 takeover "host" message sent to a dead socket is never repeated: new host has no snapshot, room stays paused', async () => {
  const { world, core, host } = await setup({ ...HOST_OPTS, pauseBy: 'host' });
  const pk = 'c-key-xxxxxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await world.advance(4_000);
  await send(core, host, { t: 'snap', d: { tick: 42 } });
  await drop(core, host);
  await world.advance(6_000); // takeover: "host" goes to A's current socket (half-open in reality)
  assert.equal(core.state.hostId, a.id);
  // A's client noticed its dead connection (missed pong) and reconnects in the same page session.
  const a2 = await connect(world, core, { name: 'A', pk });
  console.log('P4 new socket: host msgs =', a2.messages('host').length, '| welcome.hostId is me =', a2.last('welcome').room.hostId === a2.id, '| paused =', JSON.stringify(a2.last('welcome').room.paused?.reason));
  assert.equal(a2.messages('host').length, 0);
  assert.equal(a2.last('welcome').room.paused.reason, 'host-change');
});

test('P5 gone after the grace period and back in the same page session: lastN restarts at 0 (client replays its queue)', async () => {
  const { world, core, host } = await setup();
  const pk = 'd-key-xxxxxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk, sid: 'page1' });
  for (let n = 1; n <= 3; n++) await send(core, a, { t: 'cmd', n, c: n % 2 ? 'pause' : 'resume' });
  await drop(core, a);
  await world.advance(61_000);
  const a2 = await connect(world, core, { name: 'A', pk, sid: 'page1' });
  console.log('P5 welcome.lastN =', a2.last('welcome').lastN, 'same id =', a2.id === a.id);
  assert.equal(a2.last('welcome').lastN, 0);
});

test('P6 a viewer and a waiting player can pause the game; a viewer\'s messages reach the host', async () => {
  const { world, core, created, host } = await setup(HOST_OPTS, { access: 'private', lateJoin: 'next' });
  const v = await connect(world, core, { name: 'TV', key: created.keys.viewer.k });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await send(core, v, { t: 'cmd', n: 1, c: 'pause' });
  assert.equal(host.last('room').room.paused.id, v.id);
  await send(core, host, { t: 'cmd', n: 2, c: 'resume' });
  const w = await connect(world, core, { name: 'W', key: created.keys.player.k });
  assert.equal(w.last('welcome').room.players.find((p) => p.id === w.id).waiting, true);
  await send(core, w, { t: 'cmd', n: 1, c: 'pause' });
  assert.equal(host.last('room').room.paused.id, w.id);
  await send(core, v, { t: 'msg', n: 2, d: { fire: true } });
  assert.deepEqual(host.last('msg'), { t: 'msg', from: v.id, d: { fire: true } });
  console.log('P6 viewer paused, waiting player paused, viewer input relayed to host');
});

test('P7 a socket that never says hello stops the 24 h cleanup for good', async () => {
  const { world, core, host } = await setup();
  await drop(core, host);
  const lurker = new FakeSocket('lurker');
  world.socketList.push(lurker);
  core.opened(lurker);
  await world.advance(25 * 3600_000);
  assert.ok(world.store.get('room'), 'not deleted while the lurker is connected');
  await drop(core, lurker);
  await world.advance(30 * 24 * 3600_000);
  console.log('P7 room still stored 30 days later:', Boolean(world.store.get('room')), 'timers:', JSON.stringify(world.store.get('room').timers), 'alarm:', world.alarm);
  assert.ok(world.store.get('room'));
});

test('P8 sid is stored unvalidated; known grows without bound', async () => {
  const { world, core } = await setup({ ...HOST_OPTS, limits: { player: 3, viewer: 2 }, graceMs: 1 });
  const big = 'x'.repeat(400_000);
  const a = await connect(world, core, { name: 'A', sid: big });
  assert.equal(world.store.get('room').players[a.id].sid.length, 400_000);
  assert.equal(a.attachment.sid.length, 400_000, 'and it is put in the socket attachment');
  for (let i = 0; i < 200; i++) {
    const s = await connect(world, core, { name: 'S', role: 'viewer' });
    await drop(core, s);
    await world.advance(10);
  }
  console.log('P8 known entries after 200 short visits:', Object.keys(world.store.get('room').known).length, 'players:', Object.keys(world.store.get('room').players).length);
  assert.ok(Object.keys(world.store.get('room').known).length >= 200);
});

test('P9 kick with id "__proto__" (host) clears every grace timer', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await drop(core, a);
  assert.ok(core.state.timers.some((t) => t.kind === 'grace'));
  await send(core, host, { t: 'cmd', n: 1, c: 'kick', id: '__proto__' });
  console.log('P9 reply:', JSON.stringify(host.last('ok') ?? host.last('err')), 'timers:', JSON.stringify(core.state.timers.map((t) => t.kind)));
  assert.ok(!core.state.timers.some((t) => t.kind === 'grace'));
  await world.advance(10 * 60_000);
  assert.ok(core.state.players[a.id], 'the away player is never removed');
});

test('P10 pauseBy "nobody" + autoPauseMs: the automatic pause can never be lifted', async () => {
  const { world, core, host } = await setup({ ...HOST_OPTS, pauseBy: 'nobody' });
  const pk = 'e-key-xxxxxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await drop(core, a);
  await world.advance(21_000);
  assert.equal(host.last('room').room.paused.reason, 'player-away');
  await connect(world, core, { name: 'A', pk });
  await send(core, host, { t: 'cmd', n: 2, c: 'resume' });
  console.log('P10 after the player is back and the host resumes:', JSON.stringify(host.last('room').room.paused?.reason), JSON.stringify(host.last('err')));
  assert.equal(host.last('room').room.paused.reason, 'player-away');
});

test('P11 after an automatic takeover, the stand-in host leaving closes the room for the creator; hostKey was handed over', async () => {
  const { world, core, created, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await drop(core, host);
  await world.advance(6_000); // creator had a 6 s glitch in the lobby
  const back = await connect(world, core, { name: 'Host', hk: created.hostKey, pk: host.pk });
  assert.equal(back.last('welcome').room.hostId, a.id, 'the creator does not get the room back');
  assert.equal(a.last('room').room.hostKey, created.hostKey, 'the stand-in now holds the permanent host key');
  await send(core, a, { t: 'cmd', n: 1, c: 'leave' });
  console.log('P11 creator socket closed with', JSON.stringify(back.closedWith));
  assert.equal(back.closedWith.code, CLOSE.ROOM_CLOSED);
});

test('P12 ban is bypassed with a fresh player key; an ex-host passes a private room after key renewal with the host key', async () => {
  const { world, core, created, host } = await setup(HOST_OPTS, { access: 'private' });
  const a = await connect(world, core, { name: 'A', key: created.keys.player.k, pk: 'f-key-xxxxxxxxxxxxxxxxxx' });
  await send(core, host, { t: 'cmd', n: 1, c: 'kick', id: a.id, ban: true });
  const again = await connect(world, core, { name: 'A', key: created.keys.player.k, pk: 'g-key-xxxxxxxxxxxxxxxxxx' });
  assert.ok(again.id, 'same invitation link, new tab: back in');
  // Now someone who was host once (learned hostKey), is banned, and both keys are renewed:
  await send(core, host, { t: 'cmd', n: 2, c: 'kick', id: again.id, ban: true });
  await send(core, host, { t: 'cmd', n: 3, c: 'renew', role: 'player' });
  await send(core, host, { t: 'cmd', n: 4, c: 'renew', role: 'viewer' });
  const exHost = await connect(world, core, { name: 'Ex', hk: created.hostKey, pk: 'h-key-xxxxxxxxxxxxxxxxxx' });
  console.log('P12 ex-host with hostKey after renewals: joined =', Boolean(exHost.id), 'role', exHost.last('welcome')?.you.role);
  assert.ok(exHost.id);
});

test('P13 server-run room with hostLeave "close": host away past the grace period leaves a room nobody can start', async () => {
  const opts = { mode: 'server', rules: memoryRules, limits: { player: 4, viewer: 2 }, graceMs: 60_000 };
  const { world, core, host } = await setup(opts);
  const b = await connect(world, core, { name: 'B' });
  await drop(core, host);
  await world.advance(61_000);
  await send(core, b, { t: 'cmd', n: 1, c: 'start' });
  console.log('P13 hostId =', core.state.hostId, 'B start →', JSON.stringify(b.last('err')));
  assert.equal(core.state.hostId, null);
  assert.equal(b.last('err').code, 'host-only');
});

test('P14 handover/leave snapshot is not persisted when nobody can take over', async () => {
  const { world, core, host } = await setup({ ...HOST_OPTS, hostLeave: 'handover' });
  const pk = 'i-key-xxxxxxxxxxxxxxxxxx';
  const a = await connect(world, core, { name: 'A', pk });
  await send(core, host, { t: 'snap', d: { s: 1 } }); // saved
  await drop(core, a); // A is away for a moment
  await world.advance(2_000);
  await send(core, host, { t: 'snap', d: { s: 2 } }); // host.leave(snapshot): final state, memory only
  await send(core, host, { t: 'cmd', n: 1, c: 'leave' });
  const woke = await world.core({ ...HOST_OPTS, hostLeave: 'handover' }); // hibernation
  const a2 = await connect(world, woke, { name: 'A', pk });
  console.log('P14 A takes over from', JSON.stringify(a2.last('host')?.snapshot));
  assert.deepEqual(a2.last('host').snapshot, { s: 1 });
});

test('P15 while paused every snapshot is written to storage', async () => {
  const { world, core, host } = await setup();
  let puts = 0;
  const realPut = core.host.storage.put;
  core.host.storage.put = async (k, v) => { if (k === 'snapshot') puts += 1; return realPut(k, v); };
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await send(core, host, { t: 'cmd', n: 2, c: 'pause' });
  for (let i = 0; i < 20; i++) { await world.advance(100); await send(core, host, { t: 'snap', d: { i } }); }
  console.log('P15 snapshot puts for 20 snapshots in 2 s while paused:', puts);
  assert.equal(puts, 20);
});

test('P16 storage writes: how many "room" puts does a quiet relay cause? and a server-mode message?', async () => {
  const { world, core, host } = await setup();
  const a = await connect(world, core, { name: 'A' });
  let puts = 0;
  const realPut = core.host.storage.put;
  core.host.storage.put = async (k, v) => { puts += 1; return realPut(k, v); };
  for (let n = 1; n <= 50; n++) await send(core, a, { t: 'msg', n, d: n });
  for (let n = 1; n <= 50; n++) await send(core, host, { t: 'msg', d: n });
  console.log('P16 host-mode puts for 100 relayed messages:', puts);
  assert.equal(puts, 0);
});
