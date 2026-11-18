// The example games against the demo Worker in local workerd, with real clients.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkRoom, CLOSE, CLOSE_UNRESPONSIVE, RoomError, PROTOCOL } from '../../src/client/index.js';
import { BASE, create, join, next, until, sleep, cleanup, raw } from './helpers.mjs';

afterEach(cleanup);

test('crew game: create, info, join and relay between the host and the others', async () => {
  const hostEvent = [];
  const host = await create('Host', { on: { host: (e) => hostEvent.push(e) } });
  await until(() => hostEvent.length === 1);
  assert.deepEqual(hostEvent, [{ snapshot: null }]);
  assert.ok(host.isHost && host.isOwner);
  assert.ok(host.inviteKeys.player.k);
  const info = await NetworkRoom.info(BASE, host.code);
  assert.equal(info.phase, 'lobby');
  assert.ok('where' in info, 'the room tells where it runs (null when the trace page cannot be reached)');
  assert.deepEqual(info.participants, { player: 1, viewer: 0 });
  assert.equal(await NetworkRoom.info(BASE, 'ZZZZZ'), null);

  const a = await join(host.code.toLowerCase(), 'A');
  const b = await join(host.code, 'B');
  const tv = await join(host.code, 'TV', { role: 'viewer' });
  await until(() => host.players.length === 4);
  assert.equal(a.isHost, false);
  assert.equal(a.inviteKeys, null);

  const got = next(host, 'message');
  a.send({ input: 'left' });
  const { at, ...message } = await got;
  assert.deepEqual(message, { from: a.me, data: { input: 'left' } });
  assert.ok(Math.abs(at - Date.now()) < 10_000, 'with the time it reached the room (F-063)');

  const toAll = Promise.all([next(a, 'message'), next(b, 'message'), next(tv, 'message')]);
  host.send({ tick: 1 });
  for (const m of await toAll) assert.deepEqual(m.data, { tick: 1 });

  const seen = { a: [], b: [], tv: [] };
  a.on('message', (m) => seen.a.push(m.data));
  b.on('message', (m) => seen.b.push(m.data));
  tv.on('message', (m) => seen.tv.push(m.data));
  host.send('only b', { to: [b.me] });
  host.send('viewers', { to: { role: 'viewer' } });
  host.send('end');
  await until(() => seen.a.length && seen.b.length === 2 && seen.tv.length === 2);
  assert.deepEqual(seen, { a: ['end'], b: ['only b', 'end'], tv: ['viewers', 'end'] });
});

test('room not found and closed rooms are refused with a reason', async () => {
  await assert.rejects(join('ZZZZ', 'X'), (err) => err instanceof RoomError && err.code === CLOSE.NOT_FOUND);
  // A code of another length is refused at once, not after a timeout.
  const started = Date.now();
  await assert.rejects(join('ZZZZZ', 'X'), (err) => err.code === CLOSE.NOT_FOUND);
  await assert.rejects(join('ZZ', 'X'), (err) => err.code === CLOSE.NOT_FOUND);
  assert.ok(Date.now() - started < 3000, 'without waiting for a timeout');
  const host = await create('Host');
  const a = await join(host.code, 'A');
  const closed = next(a, 'closed');
  host.leave();
  assert.deepEqual(await closed, { code: CLOSE.ROOM_CLOSED, reason: 'owner-left', text: 'The room has closed.' });
  await assert.rejects(join(host.code, 'B'), (err) => err.code === CLOSE.ROOM_CLOSED);
  assert.equal((await NetworkRoom.info(BASE, host.code)).closed, true);
});

test('places, shared room data and a newcomer getting the state', async () => {
  const host = await create('Host');
  host.setData({ map: 3 });
  host.takePlace('captain');
  const a = await join(host.code, 'A');
  await until(() => a.room.places.captain[0] === host.me);
  assert.deepEqual(a.room.data, { map: 3 });
  const err = next(a, 'error');
  a.takePlace('captain');
  assert.equal((await err).code, 'place-taken');
  a.takePlace('gunner');
  await until(() => host.room.places.gunner[0] === a.me);

  host.start();
  await until(() => host.phase !== 'lobby');
  host.on('peer', ({ event, id }) => {
    if (event === 'join') host.send({ type: 'full', world: 'everything' }, { to: [id] });
  });
  const late = await join(host.code, 'Late');
  const full = await next(late, 'message', (m) => m.data?.type === 'full');
  assert.equal(full.data.world, 'everything');
  late.pause();
  await until(() => host.room.paused?.id === late.me);
  host.resume();
  await until(() => late.room.paused === null);
});

test('reconnect: a dropped connection comes back as the same participant and resends once', async () => {
  const host = await create('Host');
  const a = await join(host.code, 'A');
  const id = a.me;
  const back = next(host, 'peer', (e) => e.event === 'back');
  const got = [];
  host.on('message', (m) => got.push(m.data));
  a.ws.close(); // a network glitch: the client reconnects by itself
  await next(a, 'status', (s) => s === 'reconnecting');
  a.send('sent while away');
  await back;
  await until(() => a.status === 'online' && got.length > 0);
  assert.equal(a.me, id);
  await sleep(200);
  assert.deepEqual(got, ['sent while away']);
});

test('V-B1: a long queue after a reconnect arrives in order and nobody is thrown out', async () => {
  const host = await create('Host');
  const a = await join(host.code, 'A');
  const got = [];
  host.on('message', (m) => got.push(m.data));
  a.ws.close();
  await next(a, 'status', (s) => s === 'reconnecting');
  for (let i = 0; i < 150; i++) a.send(i);
  await until(() => got.length === 150, 15_000);
  assert.deepEqual(got, Array.from({ length: 150 }, (_, i) => i));
  assert.equal(a.status, 'online');
});

test('F-036: large states travel and are kept in parts in real workerd', { timeout: 60_000 }, async () => {
  const big = (kb, tag) => ({ tag, bases: Array.from({ length: kb }, (_, i) => ({ i, map: 'ö'.repeat(490) })) });
  const host = await create('Host');
  const a = await join(host.code, 'A');
  const b = await join(host.code, 'B');
  const full = next(a, 'message', (m) => m.data?.tag === 'joiner');
  host.send(big(190, 'joiner'), { to: [a.me] });
  assert.equal((await full).data.bases.length, 190);
  const fromA = next(host, 'message', (m) => m.data?.tag === 'from A');
  a.send(big(150, 'from A'));
  assert.equal((await fromA).data.bases.length, 150);

  host.start();
  await until(() => host.phase !== 'lobby');
  host.sendSnapshot(big(600, 'kept'), { force: true });
  await sleep(1500);
  const took = next(a, 'host', () => true, 15_000);
  host.disconnect();
  const { snapshot } = await took;
  assert.equal(snapshot.tag, 'kept');
  assert.equal(snapshot.bases.length, 600);
  assert.equal(b.status, 'online');
});

test('F-037: the newest value wins in real workerd', async () => {
  const host = await create('Host');
  const a = await join(host.code, 'A');
  const got = [];
  host.on('message', (m) => got.push(m.data.aim));
  for (let i = 0; i < 400; i++) a.send({ aim: i }, { latest: 'aim' });
  await until(() => got.at(-1) === 399, 8000);
  assert.ok(got.length < 400);
  assert.equal(a.status, 'online');
});

test('crew game: takeover when the host is lost; the owner keeps the room', async () => {
  const host = await create('Host');
  const a = await join(host.code, 'A');
  const b = await join(host.code, 'B');
  host.start();
  await sleep(100);
  host.sendSnapshot({ tick: 99 });
  await sleep(100);
  const took = next(a, 'host', () => true, 12_000);
  host.disconnect(); // the host's browser is gone without leaving
  await until(() => b.room.paused?.reason === 'host-away');
  assert.deepEqual(await took, { snapshot: { tick: 99 } });
  await until(() => a.isHost && b.room.hostId === a.me);
  await until(() => b.room.paused === null); // confirmed automatically
  assert.equal(a.isOwner, false);
  assert.equal(a.inviteKeys, null);
  const toNew = next(a, 'message');
  b.send('hello new host');
  assert.equal((await toNew).data, 'hello new host');
});

test('private room: a key per role, renew, kick and ban', async () => {
  const host = await create('Host', { settings: { access: 'private' } });
  await assert.rejects(join(host.code, 'NoKey'), (err) => err.code === CLOSE.KEY && err.reason === 'key-required');
  const viewer = await join(host.code, 'TV', { key: host.inviteKeys.viewer.k });
  assert.equal(viewer.role, 'viewer');
  const oldKey = host.inviteKeys.player.k;
  const a = await join(host.code, 'A', { key: oldKey });
  host.renewKey('player');
  await until(() => host.inviteKeys.player.k !== oldKey);
  await assert.rejects(join(host.code, 'Old', { key: oldKey }), (err) => err.reason === 'key-invalid');
  assert.equal(a.status, 'online', 'those inside stay');
  const kicked = next(a, 'closed');
  host.kick(a.me, { ban: true });
  assert.equal((await kicked).code, CLOSE.BANNED);
});

test('uninvited connections: junk before hello closes the connection', async () => {
  const host = await create('Host', { settings: { access: 'private' } });
  const { ws, opened, closed } = raw(host.code);
  await opened;
  ws.send('not even json');
  assert.equal((await closed).code, CLOSE.BAD_REQUEST);
  const second = raw(host.code);
  await second.opened;
  second.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, pk: 'p'.repeat(20), sid: 's'.repeat(20_000), name: 'ghost' }));
  assert.equal((await second.closed).code, CLOSE.BAD_REQUEST);
  await sleep(100);
  assert.equal(host.players.length, 1, 'no ghost seat');
});

test('F-051: a connection that goes silent is dropped within seconds in real workerd', { timeout: 30_000 }, async () => {
  const host = await create('Host');
  const { ws, opened, closed } = raw(host.code);
  await opened;
  ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, pk: 'silent-player-key-xxxxx', sid: 'silent', name: 'Quiet' }));
  await until(() => host.players.some((p) => p.name === 'Quiet'));
  const started = Date.now();
  // The host keeps the room busy; the silent connection sends no heartbeat.
  const busy = setInterval(() => host.send({ t: 'tick' }), 200);
  const drop = next(host, 'peer', (e) => e.event === 'drop' && e.name === 'Quiet', 15_000);
  try {
    assert.equal((await closed).code, CLOSE_UNRESPONSIVE);
    await drop;
  } finally {
    clearInterval(busy);
  }
  const took = Date.now() - started;
  assert.ok(took < 9_000, `noticed in ${took} ms`);
});

test('F-029 and F-030: a room from an invitation, and the state for newcomers, in real workerd', async () => {
  const invite = await (await fetch(`${BASE}/invite`, { method: 'POST' })).json();
  assert.ok(invite.code && invite.key);
  const first = await join(invite.code, 'First', { key: invite.key });
  await until(() => first.isOwner && first.isHost);
  first.setWelcomeState({ board: 'kept by the room' });
  await sleep(200);
  const second = await join(invite.code, 'Second', { key: invite.key });
  assert.equal(second.isOwner, false);
  await until(() => second.welcomeState?.board === 'kept by the room');
});

test('a connection that floods the room is closed, and the others are not disturbed', async () => {
  const host = await create('Host');
  const a = await join(host.code, 'A');
  const got = [];
  host.on('message', (m) => got.push(m.data));
  const flood = raw(host.code);
  await flood.opened;
  flood.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, pk: 'flooding-client-key-xxxx', sid: 'flood', name: 'Flood' }));
  await until(() => host.players.length === 3);
  for (let i = 0; i < 400; i++) flood.ws.send(JSON.stringify({ t: 'msg', d: i }));
  assert.equal((await flood.closed).code, CLOSE.RATE);
  assert.ok(got.length < 200, `only a burst got through (${got.length})`);
  a.send('still here');
  await until(() => got.includes('still here'));
});

test('memory game: rules in the room, turns and a hidden board', async () => {
  const turns = { basePath: '/turns' };
  const host = await create('Host', turns);
  assert.equal(host.code.length, 6, 'the memory game chose six-character codes');
  const b = await join(host.code, 'B', turns);
  const board = next(b, 'message', (m) => m.data?.type === 'board');
  host.start();
  const first = (await board).data;
  assert.equal(first.cards.length, 8);
  assert.equal(first.turn, host.me);
  assert.equal('seed' in b.room, false);

  // Flip cards until the turn passes to B (a mismatch hides the cards after a timer).
  let state = first;
  host.on('message', (m) => { if (m.data?.type === 'board') state = m.data; });
  for (let i = 1; i < 8 && state.turn === host.me; i++) {
    host.send({ type: 'flip', index: 0 });
    await until(() => state.cards[0] !== null);
    host.send({ type: 'flip', index: i });
    await until(() => state.turn !== host.me || state.cards[0] === null || state.scores[host.me] > 0, 5000);
    if (state.scores[host.me] > 0) break;
  }
  assert.ok(state.turn === b.me || state.scores[host.me] > 0);
  await assert.rejects(join(host.code, 'Late', turns), (err) => err.code === CLOSE.IN_PROGRESS);
});

test('quiz: the leader does not play, and nobody takes over when the leader is lost', async () => {
  const quiz = { basePath: '/quiz' };
  const leader = await create('Leader', quiz);
  assert.equal(leader.role, 'leader');
  assert.equal(leader.code.length, 6, 'six characters by default');
  const a = await join(leader.code, 'A', quiz);
  const b = await join(leader.code, 'B', quiz);
  const tv = await join(leader.code, 'TV', { ...quiz, role: 'viewer' });
  assert.equal(a.role, 'player');
  await assert.rejects(join(leader.code, 'L2', { ...quiz, role: 'leader' }), (err) => err.code === CLOSE.KEY);
  const everything = [];
  for (const room of [a, b, tv]) {
    room.on('message', (m) => everything.push(JSON.stringify(m)));
    room.on('host', (m) => everything.push(JSON.stringify(m)));
  }

  // The leader runs the game: the answer stays in the leader's private state.
  leader.start();
  await until(() => a.running);
  const question = Promise.all([next(a, 'message'), next(b, 'message'), next(tv, 'message')]);
  leader.send({ type: 'question', text: 'What is 6 × 7?' });
  await question;
  leader.sendSnapshot({ answer: 'xyzzy-secret', scores: {} });
  const buzz = next(leader, 'message');
  b.send({ type: 'buzz' });
  assert.equal((await buzz).from, b.me, 'the leader gets the buzz, in the order the room received it');
  await sleep(100);

  // The leader's computer dies. The room waits; no player becomes host.
  const ownerKey = leader.ownerKey;
  leader.disconnect();
  await until(() => a.room.paused?.reason === 'host-away');
  await sleep(1500);
  assert.equal(a.room.hostId, leader.me);
  assert.equal(a.isHost || b.isHost, false);

  // The leader comes back on another device with the owner key and continues.
  const hostEvents = [];
  const again = await join(leader.code, 'Leader', { ...quiz, ownerKey, on: { host: (e) => hostEvents.push(e) } });
  assert.equal(again.role, 'leader');
  await until(() => hostEvents.length === 1);
  assert.deepEqual(hostEvents[0].snapshot, { answer: 'xyzzy-secret', scores: {} });
  await until(() => a.room.paused === null && a.room.hostId === again.me);
  assert.ok(!everything.some((text) => text.includes('xyzzy')), 'the answer never reached a participant');
});
