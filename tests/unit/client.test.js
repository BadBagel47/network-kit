// The real browser client against the real room core (in-process bridge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, client, start, join, sleep, until, cleanup } from './bridge.js';
import { CREW } from './setup.js';
import { CLOSE } from '../../src/shared/protocol.js';

const WAIT = { mode: 'host', graceMs: 60_000, countdownMs: 3_000 };
const track = (room) => room;
test.afterEach(cleanup);

test('create, join, relay; the owner is told to run the game with isHost already true', async () => {
  const world = new World(CREW);
  const created = await world.create();
  const owner = client(world, { name: 'Owner', ownerKey: created.ownerKey });
  let hostSeen = null;
  owner.on('host', ({ snapshot }) => { hostSeen = { snapshot, isHost: owner.isHost }; });
  await owner.connect();
  await world.settle();
  assert.deepEqual(hostSeen, { snapshot: null, isHost: true });
  assert.ok(owner.isOwner && owner.inviteKeys.player.k);
  const a = track(await join(world, 'A'), owner);
  assert.equal(a.isHost, false);
  assert.equal(a.inviteKeys, null);
  a.send({ fire: true });
  owner.send({ tick: 1 });
  await world.settle();
  // F-063: each message carries the time it reached the room, in server time.
  assert.deepEqual(owner.events('message').map(({ at, ...m }) => m), [{ from: a.me, data: { fire: true } }]);
  assert.deepEqual(a.events('message').map(({ at, ...m }) => m), [{ from: owner.me, data: { tick: 1 } }]);
  assert.ok(Number.isFinite(owner.events('message')[0].at));
});

test('B-016: a short offline/online blip with the connection intact ends "online" and loses nothing', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  a.win.navigator.onLine = false;
  a.win.dispatchEvent(new Event('offline'));
  assert.equal(a.status, 'offline');
  a.send('during the blip');
  await world.settle();
  assert.deepEqual(owner.events('message').map((m) => m.data), ['during the blip'], 'sent although the browser said offline');
  a.win.navigator.onLine = true;
  a.win.dispatchEvent(new Event('online'));
  await world.settle();
  assert.equal(a.status, 'online');
});

test('B-016: joining gives up with a clear error when the server cannot be reached', async () => {
  const world = new World(CREW);
  await world.create();
  world.down = true;
  const a = client(world, { name: 'A', connectTimeoutMs: 150 });
  await assert.rejects(a.connect(), (err) => err.code === 0 && err.reason === 'timeout' && /reach/.test(err.message));
  const attempts = world.opened;
  await sleep(150);
  assert.equal(world.opened, attempts, 'and stops trying');
  assert.equal(a.status, 'closed');
});

test('B-016: a connected client that loses the server slows down and finally gives up', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A', { giveUpMs: 200, slowAfterMs: 50, slowDelayMs: 60 }), owner);
  world.down = true;
  a.ws.close();
  await until(() => a.status === 'closed', 3000);
  assert.deepEqual(a.events('closed').map((c) => c.reason), ['unreachable']);
  const attempts = world.opened;
  await sleep(120);
  assert.equal(world.opened, attempts);
});

test('reconnect: a dropped connection comes back as the same participant and resends once', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  const id = a.me;
  a.send('one');
  await world.settle();
  a.ws.close();
  a.send('two'); // while disconnected
  await until(() => a.status !== 'online');
  await until(() => a.status === 'online');
  await world.settle();
  assert.equal(a.me, id);
  assert.deepEqual(owner.events('message').map((m) => m.data), ['one', 'two']);
  assert.deepEqual(owner.events('peer').map((p) => p.event).filter((e) => e !== 'join'), ['drop', 'back']);
  // The name comes with every event and the player is already in the room list (B-043).
  const joined = owner.events('peer').find((p) => p.event === 'join' && p.id === id);
  assert.equal(joined.name, 'A');
  assert.equal(joined.player?.name, 'A');
  assert.equal(joined.returning, false);
});

test('B-015: gone past the grace period and back in the same page replays nothing', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  for (let i = 1; i <= 5; i++) a.send(`input-${i}`);
  a.pause();
  a.resume();
  await world.settle();
  a.ws.dead = true; // the phone sleeps
  await world.serverNotices(a.ws);
  await world.advance(120_000);
  assert.equal(owner.player(a.me), null, 'counted as gone');
  a.ws.close();
  a.recover();
  await until(() => a.status === 'online');
  await world.settle();
  assert.equal(owner.events('message').length, 5);
  assert.equal(owner.room.paused, null, 'old pause commands did not run again');
});

test('B-015: old game messages are not resent after a long break', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A', { maxQueueAgeMs: 30 }), owner);
  a.ws.close();
  a.send('stale input');
  a.takePlace('gunner'); // commands are kept
  world.down = true;
  await sleep(80);
  world.down = false;
  a.recover();
  await until(() => a.status === 'online');
  await world.settle();
  assert.deepEqual(owner.events('message'), []);
  assert.deepEqual(owner.room.places.gunner, [a.me]);
});

test('B-015: a silent reconnect tells the host, so it can send the state again', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  owner.seen.length = 0;
  a.ws.dead = true; // half-open: the server still thinks the connection is fine
  owner.send('lost on the dead connection');
  a.ws.close();
  a.recover();
  await until(() => a.status === 'online');
  await world.settle();
  assert.deepEqual(owner.events('peer').map((p) => [p.event, p.id]), [['back', a.me]]);
});

test('B-015: a takeover message lost on a dead connection is repeated after the reconnect', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  const b = track(await join(world, 'B'));
  owner.start();
  await world.settle();
  await world.advance(4_000);
  owner.sendSnapshot({ tick: 9 });
  await world.settle();
  a.ws.dead = true; // A's connection is half-open when the host disappears
  owner.disconnect();
  await world.advance(6_000);
  assert.equal(b.room.hostId, a.me);
  assert.equal(b.room.paused.reason, 'host-change');
  assert.deepEqual(a.events('host'), [], 'the message went to the dead connection');
  a.ws.close();
  a.recover();
  await until(() => a.isHost);
  await world.settle();
  assert.deepEqual(a.events('host').at(-1), { snapshot: { tick: 9 } });
  assert.equal(b.room.paused, null, 'confirmed automatically, the game goes on');
});

test('B-015: messages queued in one role are not delivered in another', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  owner.start();
  await world.settle();
  await world.advance(4_000);
  owner.ws.dead = true; // the host's connection dies silently
  owner.send({ pos: 'queued as host' });
  await world.serverNotices(owner.ws);
  await world.advance(6_000);
  assert.equal(a.isHost, true);
  owner.ws.close();
  owner.recover();
  await until(() => owner.status === 'online');
  await world.settle();
  assert.equal(owner.isHost, false);
  assert.equal(owner.isOwner, true);
  assert.deepEqual(a.events('message'), [], 'the old host broadcast did not arrive as player input');
  assert.deepEqual(owner.events('role').at(-1), { isHost: false, isOwner: true });
});

test('the phase moves from countdown to playing on its own; running follows pause', async () => {
  const { world, owner } = await start({ ...CREW, countdownMs: 60 });
  const a = track(await join(world, 'A'), owner);
  owner.start();
  await world.settle(10);
  assert.equal(a.phase, 'countdown');
  assert.equal(a.running, false);
  await until(() => a.phase === 'playing');
  assert.equal(a.running, true);
  await world.advance(1_000);
  a.pause();
  await world.settle();
  assert.equal(owner.running, false);
  assert.equal(owner.phase, 'playing');
});

test('F-018: a host alone in the room sends nothing; with company it does', async () => {
  const { world, owner } = await start(CREW);
  track(owner);
  const before = owner.ws.sent.length;
  assert.equal(owner.send({ pos: 1 }), false);
  assert.equal(owner.send({ pos: 2 }, { reliable: false }), false);
  assert.equal(owner.sendSnapshot({ s: 1 }), true, 'the first snapshot is kept');
  assert.equal(owner.sendSnapshot({ s: 2 }), false, 'then seldom while alone');
  assert.equal(owner.sendSnapshot({ s: 3 }, { force: true }), true);
  assert.equal(owner.ws.sent.length, before + 2);
  const a = track(await join(world, 'A'));
  assert.ok(owner.send({ pos: 3 }));
  assert.equal(owner.sendSnapshot({ s: 4 }), true);
  await world.settle();
  assert.deepEqual(a.events('message').map((m) => m.data), [{ pos: 3 }]);
});

test('F-018: messages to a host that is away are dropped instead of sent', async () => {
  const { world, owner } = await start(WAIT);
  const a = track(await join(world, 'A'), owner);
  owner.ws.close();
  owner.stopped = true; // the host does not come back
  await world.settle();
  assert.equal(a.player(a.room.hostId).status, 'away');
  const before = a.ws.sent.length;
  assert.equal(a.send({ input: 1 }), false);
  assert.equal(a.ws.sent.length, before);
});

test('F-010: a client notices a silent host and the room replaces it within seconds', async () => {
  const { world, owner } = await start({ ...CREW, countdownMs: 0 });
  const a = track(await join(world, 'A', { hostSilentMs: 60 }), owner);
  owner.start();
  await world.settle();
  await world.advance(4_000);
  owner.sendSnapshot({ tick: 3 }, { force: true });
  await world.settle();
  owner.ws.dead = true; // looks open, but nothing gets through
  await sleep(150); // A hears nothing from the host and reports it
  await world.settle();
  await world.advance(3_100);
  await until(() => a.isHost);
  assert.deepEqual(a.events('host').at(-1), { snapshot: { tick: 3 } });
});

test('F-010: a host that answers the check keeps the game', async () => {
  const { world, owner } = await start({ ...CREW, countdownMs: 0 });
  const a = track(await join(world, 'A', { hostSilentMs: 60 }), owner);
  owner.start();
  await world.settle();
  await world.advance(4_000);
  await sleep(150); // the host is simply not sending anything right now
  await world.settle();
  await world.advance(10_000);
  assert.equal(a.room.hostId, owner.me);
  assert.equal(owner.status, 'online');
});

test('D-019: the owner key is kept, replaced when ownership is given, and dropped when lost', async () => {
  const { world, created, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  const ownerKeys = () => [...owner.ownerStore.map.entries()].filter(([k]) => k.includes(':owner:'));
  assert.deepEqual(ownerKeys(), [['network-kit:http://bridge/rooms:owner:ABCDE', created.ownerKey]]);
  owner.giveOwnership(a.me);
  await world.settle();
  assert.equal(a.isOwner, true);
  assert.equal(owner.isOwner, false);
  assert.deepEqual(ownerKeys(), [], 'the old owner forgets a key that no longer works');
  assert.ok(a.ownerKey && a.ownerKey !== created.ownerKey);
  assert.deepEqual(a.events('role').at(-1), { isHost: false, isOwner: true });
  // The new owner's key works after a reconnect.
  a.ws.close();
  await until(() => a.status !== 'online');
  await until(() => a.status === 'online');
  await world.settle();
  assert.equal(a.isOwner, true);
});

test('D-023: identities are kept per game server and per slot', async () => {
  const world = new World(CREW);
  await world.create();
  const shared = new Map();
  const storage = { getItem: (k) => shared.get(k) ?? null, setItem: (k, v) => shared.set(k, v), removeItem: (k) => shared.delete(k) };
  const a = client(world, { name: 'A', storage });
  const same = client(world, { name: 'A', storage });
  const screen = client(world, { name: 'TV', storage, slot: 'screen' });
  const otherGame = client(world, { name: 'A', storage, server: 'http://other-game' });
  assert.equal(same.playerKey, a.playerKey);
  assert.notEqual(screen.playerKey, a.playerKey);
  assert.notEqual(otherGame.playerKey, a.playerKey);
});

test('messages that are too large are refused before they are sent', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A', { maxMessageBytes: 100 }), owner);
  const before = a.ws.sent.length;
  assert.equal(a.send('x'.repeat(500)), false);
  assert.equal(a.ws.sent.length, before);
  assert.deepEqual(a.events('error'), [{ code: 'too-large', command: 'send' }]);
});

test('leaving, being removed and a closed room end the client with a reason', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  const b = track(await join(world, 'B'));
  a.leave();
  await world.settle();
  assert.deepEqual(a.events('closed').map((c) => c.code), [CLOSE.LEFT]);
  owner.kick(b.me);
  await world.settle();
  assert.deepEqual(b.events('closed').map((c) => [c.code, c.text]), [[CLOSE.KICKED, 'You were removed from the room.']]);
  const c = track(await join(world, 'C'));
  owner.close();
  await world.settle();
  assert.deepEqual(c.events('closed').map((x) => x.code), [CLOSE.ROOM_CLOSED]);
  await assert.rejects(join(world, 'D'), (err) => err.code === CLOSE.ROOM_CLOSED);
});

// ---- Found by the independent check of the 0.2.0 release candidate -------

test('V-B1: a long queue is resent at a pace the room accepts, in order', async () => {
  const { world, owner } = await start(CREW);
  world.realtime();
  const a = track(await join(world, 'A'), owner);
  a.ws.close();
  await until(() => a.status !== 'online');
  world.down = true;
  for (let i = 0; i < 150; i++) a.send(i);
  world.down = false;
  a.recover();
  await until(() => a.status === 'online');
  await until(() => owner.events('message').length === 150, 8000);
  assert.deepEqual(owner.events('message').map((m) => m.data), Array.from({ length: 150 }, (_, i) => i));
  assert.deepEqual(a.events('closed'), []);
});

test('V-B1: a game that sends too fast is slowed down by the client, not thrown out', async () => {
  const { world, owner } = await start(CREW);
  world.realtime();
  const a = track(await join(world, 'A'), owner);
  let dropped = 0;
  for (let i = 0; i < 300; i++) if (owner.send({ pos: i }, { reliable: false }) === false) dropped += 1;
  for (let i = 0; i < 100; i++) a.send({ key: i });
  assert.ok(dropped > 200, `positions over the pace are dropped (${dropped})`);
  await until(() => owner.events('message').length === 100, 8000);
  assert.deepEqual(owner.events('closed'), []);
  assert.deepEqual(a.events('closed'), []);
});

test('V-B2: the owner opening the room in a second tab keeps the first tab as owner', async () => {
  const world = new World(CREW);
  const created = await world.create();
  // Two tabs of one browser: separate identities, one shared place for the owner key.
  const shared = new Map();
  const tab = (name) => {
    const own = new Map();
    const pick = (k) => (k.includes(':owner:') ? shared : own);
    return {
      name,
      storage: { getItem: (k) => pick(k).get(k) ?? null, setItem: (k, v) => pick(k).set(k, String(v)), removeItem: (k) => pick(k).delete(k) },
    };
  };
  const first = client(world, { ...tab('Owner'), ownerKey: created.ownerKey });
  await first.connect();
  await world.settle();
  const second = client(world, tab('Owner, tab 2'));
  assert.equal(second.ownerKey, created.ownerKey, 'the second tab finds the key');
  await second.connect();
  await world.settle();
  assert.equal(first.status, 'online');
  assert.deepEqual(first.events('closed'), []);
  assert.ok(first.isOwner && first.isHost);
  assert.ok(!second.isOwner && !second.isHost);
  assert.equal(first.players.length, 2);
  assert.equal([...shared.values()][0], created.ownerKey, 'and does not throw the key away');
});

test('V-B17: handing over while reconnecting passes on the newest state', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  owner.sendSnapshot({ v: 'old' });
  await world.settle();
  owner.ws.close();
  await until(() => owner.status !== 'online');
  owner.handover(a.me, { v: 'new' });
  await until(() => a.isHost);
  await world.settle();
  assert.deepEqual(a.events('host').at(-1), { snapshot: { v: 'new' } });
});

test('V-B17: leaving while disconnected still reaches the room', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  a.ws.close();
  await until(() => a.status !== 'online');
  a.leave();
  await until(() => a.events('closed').length === 1);
  await world.settle();
  assert.equal(a.events('closed')[0].code, CLOSE.LEFT);
  assert.equal(owner.player(a.me), null);
});

test('V-B19: a host that has just started is not reported as silent', async () => {
  const { world, owner } = await start({ ...CREW, countdownMs: 0 });
  const a = track(await join(world, 'A', { hostSilentMs: 80 }), owner);
  await sleep(200); // a long, quiet lobby
  const before = a.ws.sent.length;
  owner.start();
  await world.settle(30);
  assert.equal(a.running, true);
  assert.equal(a.ws.sent.filter((t) => t.includes('host-check')).length, 0);
  assert.equal(a.ws.sent.length, before);
});

// ---- F-036 and F-037: large messages and the newest value ----------------

const bigState = (kb, tag) => ({ tag, bases: Array.from({ length: kb }, (_, i) => ({ i, map: 'å'.repeat(490) })) });

test('F-036: large messages travel both ways whole, and a large snapshot reaches the next host', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  a.send(bigState(150, 'from A'));
  owner.send({ full: bigState(190, 'from host') }, { to: [a.me] });
  await until(() => owner.events('message').length === 1 && a.events('message').length === 1, 4000);
  assert.equal(owner.events('message')[0].data.tag, 'from A');
  assert.equal(a.events('message')[0].data.full.bases.length, 190);
  assert.ok(a.ws.sent.filter((t) => t.startsWith('{"t":"part"')).length > 1, 'sent in parts');

  owner.start();
  await world.settle();
  await world.advance(4_000);
  owner.sendSnapshot(bigState(500, 'kept'), { force: true });
  await world.settle(60);
  owner.ws.dead = true;
  await world.serverNotices(owner.ws);
  await world.advance(6_000);
  await until(() => a.events('host').length === 1, 4000);
  assert.equal(a.events('host')[0].snapshot.tag, 'kept');
  assert.equal(a.events('host')[0].snapshot.bases.length, 500);
});

test('F-036: a large message sent while disconnected arrives once after the reconnect', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  a.ws.close();
  await until(() => a.status !== 'online');
  a.send(bigState(120, 'queued'));
  await until(() => a.status === 'online');
  await until(() => owner.events('message').length === 1, 4000);
  await world.settle(100);
  assert.equal(owner.events('message').length, 1);
  assert.equal(owner.events('message')[0].data.tag, 'queued');
});

test('F-037: only the newest value is sent when values come faster than the pace', async () => {
  const { world, owner } = await start({ ...CREW, maxMessagesPerSecond: 10 });
  world.realtime();
  const a = track(await join(world, 'A'), owner);
  for (let i = 0; i < 300; i++) {
    a.send({ aim: i }, { latest: 'aim' });
    if (i % 20 === 0) await sleep(15);
  }
  await until(() => owner.events('message').at(-1)?.data.aim === 299, 4000);
  const got = owner.events('message').map((m) => m.data.aim);
  assert.ok(got.length < 100, `far fewer than 300 were sent (${got.length})`);
  assert.deepEqual([...got].sort((x, y) => x - y), got, 'in order');
  assert.deepEqual(a.events('closed'), [], 'and nobody was thrown out');
});

test('F-037: the newest value waits through a reconnect, but not into another role', async () => {
  const { world, owner } = await start(CREW);
  const a = track(await join(world, 'A'), owner);
  a.ws.close();
  await until(() => a.status !== 'online');
  for (let i = 0; i < 5; i++) a.send({ aim: i }, { latest: 'aim' });
  a.send({ fire: true }, { latest: 'trigger' });
  await until(() => a.status === 'online');
  await until(() => owner.events('message').length === 2, 4000);
  assert.deepEqual(owner.events('message').map((m) => m.data), [{ aim: 4 }, { fire: true }]);
});

test('F-051: the client beats as often as the room asks', async () => {
  const { world, owner } = await start({ ...CREW, heartbeatMs: 2_000 });
  const a = await join(world, 'A');
  assert.equal(owner.heartbeatMs, 2_000);
  assert.equal(a.heartbeatMs, 2_000);
});

test('F-030: the host sets the state for newcomers; a joiner gets it with an event', async () => {
  const { world, owner } = await start(CREW);
  assert.equal(owner.setWelcomeState({ turn: 3 }), true);
  await world.settle();
  const a = client(world, { name: 'A' });
  const seen = [];
  a.on('welcome-state', ({ data }) => seen.push(data));
  await a.connect();
  await world.settle();
  assert.deepEqual(seen, [{ turn: 3 }]);
  assert.deepEqual(a.welcomeState, { turn: 3 });
  assert.equal(a.setWelcomeState({ turn: 4 }), false, 'only the host');
});
