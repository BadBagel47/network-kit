import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkRoom, CLOSE, RoomError } from '../../src/client/index.js';
import { BASE, create, join, next, until, sleep } from './helpers.mjs';

const open = [];
const track = (room) => (open.push(room), room);
after(() => open.forEach((r) => r.disconnect()));

test('create, info, join and relay between host and players', async () => {
  const host = track(await create('Host'));
  assert.equal(host.isHost, true);
  assert.ok(host.inviteKeys.player.k);
  const info = await NetworkRoom.info(BASE, host.code);
  assert.equal(info.phase, 'lobby');
  assert.equal(await NetworkRoom.info(BASE, 'ZZZZZ'), null);

  const a = track(await join(host.code.toLowerCase(), 'A'));
  const b = track(await join(host.code, 'B'));
  await until(() => host.players.length === 3);
  assert.equal(a.isHost, false);
  assert.equal(a.inviteKeys, null);

  const got = next(host, 'message');
  a.send({ input: 'left' });
  assert.deepEqual(await got, { from: a.me, data: { input: 'left' } });

  const toAll = Promise.all([next(a, 'message'), next(b, 'message')]);
  host.send({ tick: 1 });
  for (const m of await toAll) assert.deepEqual(m.data, { tick: 1 });

  let aGot = 0;
  a.on('message', () => { aGot += 1; });
  const onlyB = next(b, 'message');
  host.send({ secret: true }, { to: [b.me] });
  assert.deepEqual((await onlyB).data, { secret: true });
  await sleep(200);
  assert.equal(aGot, 0);
});

test('room not found and closed rooms are refused with a reason', async () => {
  await assert.rejects(join('ZZZZZ', 'X'), (err) => err instanceof RoomError && err.code === CLOSE.NOT_FOUND);
  const host = track(await create('Host'));
  const a = track(await join(host.code, 'A'));
  const closed = next(a, 'closed');
  host.leave();
  assert.equal((await closed).code, CLOSE.ROOM_CLOSED);
  await assert.rejects(join(host.code, 'B'), (err) => err.code === CLOSE.ROOM_CLOSED);
  const info = await NetworkRoom.info(BASE, host.code);
  assert.equal(info.closed, true);
});

test('posts on a shared ship', async () => {
  const host = track(await create('Host'));
  const a = track(await join(host.code, 'A'));
  host.claimPost('captain');
  await until(() => a.room.posts.captain === host.me);
  const err = next(a, 'error');
  a.claimPost('captain');
  assert.equal((await err).code, 'post-taken');
  a.claimPost('gunner');
  await until(() => host.room.posts.gunner === a.me);
  host.claimPost('engineer');
  await until(() => host.room.posts.engineer === host.me && host.room.posts.captain === null);
});

test('snapshot for a late joiner, pause for everyone', async () => {
  const host = track(await create('Host'));
  host.start();
  await until(() => host.room.phase !== 'lobby');
  host.on('peer', ({ event, id }) => {
    if (event === 'join') host.sendSnapshot({ world: 'full' }, { to: [id] });
  });
  const late = track(await join(host.code, 'Late'));
  const snap = await next(late, 'snapshot');
  assert.deepEqual(snap.data, { world: 'full' });

  late.pause();
  await until(() => host.room.paused?.id === late.me);
  host.resume();
  await until(() => late.room.paused === null);
});

test('reconnect: a dropped connection comes back as the same player and resends', async () => {
  const host = track(await create('Host'));
  const a = track(await join(host.code, 'A'));
  const id = a.me;
  const back = next(host, 'peer', (e) => e.event === 'back');
  a.ws.close(); // network glitch: the client reconnects by itself
  await next(a, 'status', (s) => s === 'reconnecting');
  const got = [];
  host.on('message', (m) => got.push(m.data));
  a.send('sent while away'); // queued and delivered after the reconnect
  await back;
  await until(() => a.status === 'online');
  assert.equal(a.me, id);
  await until(() => got.includes('sent while away'));
  assert.deepEqual(got, ['sent while away']);
});

test('host takeover in a host-run room', async () => {
  const host = track(await create('Host'));
  const a = track(await join(host.code, 'A'));
  const b = track(await join(host.code, 'B'));
  host.start();
  await sleep(100);
  host.sendSnapshot({ tick: 99 });
  await sleep(100);
  const took = next(a, 'host', () => true, 12_000);
  host.disconnect(); // the host's browser is gone without leaving
  const { snapshot } = await took;
  assert.deepEqual(snapshot, { tick: 99 });
  await until(() => a.isHost && b.room.hostId === a.me);
  await until(() => b.room.paused === null); // host-ready sent automatically
  const toNew = next(a, 'message');
  b.send('hello new host');
  assert.equal((await toNew).data, 'hello new host');
});

test('private room: keys per role, renew, kick and ban', async () => {
  const host = track(await create('Host', { settings: { access: 'private' } }));
  await assert.rejects(join(host.code, 'NoKey'), (err) => err.code === CLOSE.KEY && err.reason === 'key-required');
  const viewer = track(await join(host.code, 'TV', { key: host.inviteKeys.viewer.k }));
  assert.equal(viewer.role, 'viewer');
  const oldKey = host.inviteKeys.player.k;
  const a = track(await join(host.code, 'A', { key: oldKey }));
  host.renewKey('player');
  await until(() => host.inviteKeys.player.k !== oldKey);
  await assert.rejects(join(host.code, 'Old', { key: oldKey }), (err) => err.reason === 'key-invalid');
  assert.equal(a.status, 'online', 'players inside stay');

  const kicked = next(a, 'closed');
  host.kick(a.me, { ban: true });
  assert.equal((await kicked).code, CLOSE.BANNED);
});

test('server-run room: the memory example game', async () => {
  const turns = { basePath: '/turns' };
  const host = track(await create('Host', turns));
  const b = track(await join(host.code, 'B', turns));
  const board = next(b, 'message', (m) => m.data?.type === 'board');
  host.start();
  const first = (await board).data;
  assert.equal(first.cards.length, 8);
  assert.equal(first.turn, host.me);

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
