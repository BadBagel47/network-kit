import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, client, sleep } from './bridge.mjs';
import { FakeWorld, connect, send } from '../../../tests/unit/fake-host.js';
import { memoryRules, PAIRS } from '../../../examples/demo/memory-rules.js';

const OPTS = { mode: 'host', posts: ['captain'], limits: { player: 3, viewer: 2 }, graceMs: 60_000, takeoverMs: 5_000 };

test('C7 an old host that comes back after a takeover delivers its queued host messages to the new host as if they were player input', async () => {
  const world = new World(OPTS);
  await world.boot();
  const created = await world.core.create({}, 'ABCDE');
  const host = client(world, { name: 'Host', hostKey: created.hostKey });
  await host.connect();
  const a = client(world, { name: 'A' });
  await a.connect();
  const atNewHost = [];
  a.on('message', (m) => { if (a.isHost) atNewHost.push(m); });
  host.ws.dead = true; // host's phone sleeps; its game loop keeps "sending"
  const deadSock = host.ws; deadSock.ws_peer = deadSock.peer;
  host.send({ type: 'event', text: 'airlock opened' }); // reliable (default) host → players
  host.send({ type: 'event', text: 'reactor critical' });
  await world.serverNotices(deadSock);
  await world.advance(6_000); // A takes over
  await sleep(30);
  assert.equal(a.isHost, true);
  host.probe(30); // old host wakes up and reconnects in the same page
  await sleep(200);
  console.log('C7 old host isHost =', host.isHost, '| new host received as "player input":', JSON.stringify(atNewHost));
  assert.equal(atNewHost.length, 2);
  assert.equal(atNewHost[0].from, host.me);
  host.disconnect(); a.disconnect();
});

test('S1 server-run example: room.seed is sent to every client, and the example shuffles the hidden cards from it', async () => {
  const world = new FakeWorld();
  const core = await world.core({ mode: 'server', rules: memoryRules, limits: { player: 4, viewer: 2 }, countdownMs: 0 });
  const created = await core.create({}, 'ABCDE');
  const host = await connect(world, core, { name: 'Host', hk: created.hostKey });
  const b = await connect(world, core, { name: 'B' });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  const seed = b.last('room').room.seed; // what player B's browser was told
  // B recomputes the shuffle exactly as memory-rules.js does.
  function mulberry32(s) { let a = s >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const random = mulberry32(seed); const cards = [];
  for (let i = 0; i < PAIRS; i++) cards.push(i, i);
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  console.log('S1 B computed', JSON.stringify(cards), 'server has', JSON.stringify(core.state.game.cards));
  assert.deepEqual(cards, core.state.game.cards);
});
