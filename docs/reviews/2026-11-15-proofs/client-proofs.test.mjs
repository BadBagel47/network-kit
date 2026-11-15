// Each test PASSES when the suspected problem EXISTS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, client, sleep, memStore, fakeWindow } from './bridge.mjs';
import { NetworkRoom } from '../../../src/client/room.js';

const OPTS = { mode: 'host', posts: ['captain'], limits: { player: 3, viewer: 2 }, graceMs: 60_000, takeoverMs: 5_000 };
async function setup(options = OPTS) {
  const world = new World(options);
  await world.boot();
  const created = await world.core.create({}, 'ABCDE');
  const host = client(world, { name: 'Host', hostKey: created.hostKey });
  await host.connect();
  return { world, created, host };
}

test('C1 browser "offline" then "online" while the socket survives: status stays "offline" and reliable sends are held back forever', async () => {
  const { world, host } = await setup();
  const a = client(world, { name: 'A' });
  await a.connect();
  const got = [];
  host.on('message', (m) => got.push(m.data));
  a.win.dispatchEvent(new Event('offline'));
  a.win.dispatchEvent(new Event('online')); // 1 second blip; TCP connection is fine
  await sleep(400); // longer than the probe's pong wait in real life (3 s) is not needed: pong arrives at once here
  a.send('input after the blip');
  await sleep(100);
  console.log('C1 status =', a.status, '| socket open =', a.ws?.readyState === 1, '| host got', JSON.stringify(got), '| queued =', a.queue.length);
  assert.equal(a.status, 'offline');
  assert.deepEqual(got, []);
  a.disconnect(); host.disconnect();
});

test('C2 join() never settles when the server cannot be reached, and retries forever', async () => {
  let opened = 0;
  class DeadWS { constructor() { opened += 1; this.readyState = 0; setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' }); }, 0); } send() {} close() {} }
  const { win, doc } = fakeWindow();
  let settled = false;
  const room = new NetworkRoom({ server: 'http://down', code: 'ABCDE', WebSocket: DeadWS, storage: memStore(), window: win, document: doc, minDelayMs: 5, maxDelayMs: 40 });
  const p = room.connect(); // NetworkRoom.join() does exactly this, but returns no handle to stop it
  p.then(() => { settled = true; }, () => { settled = true; });
  await sleep(1500);
  console.log('C2 settled =', settled, '| connection attempts in 1.5 s with maxDelayMs 40:', opened, '| with the default 15 s cap: ~', Math.round(86400 / 15), 'requests a day from one forgotten tab');
  assert.equal(settled, false);
  assert.ok(opened > 20);
  room.disconnect();
});

test('C3 a player gone after the grace period who comes back in the same page replays its whole recent history', async () => {
  const { world, host } = await setup();
  const a = client(world, { name: 'A' });
  await a.connect();
  const got = [];
  host.on('message', (m) => got.push(m.data));
  for (let i = 1; i <= 5; i++) a.send(`input-${i}`);
  a.pause(); a.resume();
  await sleep(50);
  assert.deepEqual(got, ['input-1', 'input-2', 'input-3', 'input-4', 'input-5']);
  // Phone locked: connection half-open, then the server notices, grace period passes.
  a.ws.dead = true;
  const dead = a.ws; dead.ws_peer = dead.peer;
  await world.serverNotices(dead);
  await world.advance(61_000);
  assert.equal(world.core.state.players[a.me], undefined, 'gone');
  const pauses = [];
  host.on('room', (r) => pauses.push(Boolean(r.paused)));
  a.probe(30); // phone unlocked: no pong on the dead socket → the client reconnects (same page session)
  await sleep(200);
  console.log('C3 host received:', JSON.stringify(got), '| pause flips seen by host after return:', JSON.stringify(pauses));
  assert.equal(got.length, 10, 'the five old inputs arrived a second time');
  a.disconnect(); host.disconnect();
});

test('C4 takeover "host" lost on a half-open socket: client becomes host (role event) without a "host" event or snapshot; room stays paused', async () => {
  const { world, host } = await setup({ ...OPTS, pauseBy: 'host' });
  const a = client(world, { name: 'A' });
  await a.connect();
  const events = [];
  a.on('host', (e) => events.push(['host', e.snapshot]));
  a.on('role', (e) => events.push(['role', e.isHost]));
  host.start();
  await sleep(30);
  host.sendSnapshot({ tick: 42 });
  await sleep(30);
  a.ws.dead = true; // A's wifi drops silently
  host.disconnect(); // and the host's browser closes
  await sleep(30);
  await world.advance(6_000); // takeover → "host" is written to A's dead socket
  a.probe(30); // A's client notices (missed pong after a network change) and reconnects
  await sleep(200);
  console.log('C4 A.isHost =', a.isHost, '| events:', JSON.stringify(events), '| paused:', JSON.stringify(a.room.paused?.reason));
  assert.equal(a.isHost, true);
  assert.deepEqual(events, [['role', true]]);
  assert.equal(a.room.paused.reason, 'host-change');
  a.disconnect();
});

test('C5 inside the "host" event handler room.isHost is still false', async () => {
  const { world, host } = await setup();
  const a = client(world, { name: 'A' });
  await a.connect();
  let seen = null;
  a.on('host', () => { seen = a.isHost; });
  host.disconnect();
  await sleep(30);
  await world.advance(6_000);
  await sleep(50);
  console.log('C5 isHost inside the "host" handler =', seen, '| afterwards =', a.isHost);
  assert.equal(seen, false);
  a.disconnect();
});

test('C6 silent reconnect: the reconnecting player misses host messages and the host gets no peer event', async () => {
  const { world, host } = await setup();
  const a = client(world, { name: 'A' });
  await a.connect();
  const peer = [];
  host.on('peer', (e) => peer.push(e.event));
  const got = [];
  a.on('message', (m) => got.push(m.data));
  await sleep(20);
  peer.length = 0;
  a.ws.dead = true; // wifi → 5G: old connection is dead, the server has not noticed
  host.send({ event: 'door opened' }); // reliable: true (default)
  await sleep(30);
  a.probe(30); // network change → heartbeat probe gets no pong → reconnect
  await sleep(150);
  host.send({ event: 'later' });
  await sleep(50);
  console.log('C6 A received', JSON.stringify(got), '| host peer events:', JSON.stringify(peer));
  assert.deepEqual(got, [{ event: 'later' }]);
  assert.deepEqual(peer, []);
  a.disconnect(); host.disconnect();
});
