// F-036: large messages and game states travel and are stored in parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld, connect, send, sendInParts, cmd, drop } from './fake-host.js';
import { setup, CREW } from './setup.js';
import { PART_CHARS, splitIntoParts, PartJoiner } from '../../src/shared/protocol.js';

/** A game state of about `kb` kilobytes, with non-ASCII text in it. */
const bigState = (kb, tag = 'x') => ({
  tag,
  bases: Array.from({ length: kb }, (_, i) => ({ id: i, name: `Bas ${i} – Ålö`, map: 'é'.repeat(480) })),
});

test('splitting and joining gives back the same text, and odd parts are refused', () => {
  const text = JSON.stringify(bigState(100));
  const parts = splitIntoParts(text, 7);
  assert.equal(parts.length, Math.ceil(text.length / PART_CHARS));
  const joiner = new PartJoiner(10 * 1024 * 1024);
  let joined = null;
  for (const part of parts) joined = joiner.add(JSON.parse(part));
  assert.equal(joined, text);
  const fresh = new PartJoiner(10 * 1024 * 1024);
  assert.throws(() => fresh.add(JSON.parse(parts[1])), /out of order/);
  assert.throws(() => new PartJoiner(PART_CHARS * 2).add({ p: 1, i: 0, of: 50, d: 'x' }), /bad part/);
  assert.throws(() => fresh.add({ p: 1, i: 0, of: 2, d: 'x'.repeat(PART_CHARS + 1) }), /bad part/);
});

test('a large message from the host reaches a joining player whole', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const state = bigState(190);
  await sendInParts(core, owner, { t: 'msg', d: { type: 'full', state }, to: [a.id] });
  assert.ok(a.wire.filter((m) => m.t === 'part').length > 1, 'it travelled in parts');
  assert.deepEqual(a.last('msg').d.state, state);
  assert.equal(a.messages('msg').length, 1);
});

test('a large message from a player reaches the host whole; it counts once against the budget', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const before = core.state.usage.n;
  await sendInParts(core, a, { t: 'msg', n: 1, d: bigState(120, 'from A') });
  assert.equal(owner.last('msg').d.tag, 'from A');
  assert.equal(core.state.usage.n, before + 1);
  // Resent after a reconnect: counted once by duplicate protection, as any message.
  await sendInParts(core, a, { t: 'msg', n: 1, d: bigState(120, 'from A') }, 2);
  assert.equal(owner.messages('msg').length, 1);
});

test('parts that do not fit together are refused and deliver nothing', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  const parts = splitIntoParts(JSON.stringify({ t: 'msg', d: bigState(150) }), 1);
  assert.ok(parts.length >= 4);
  await core.message(a, parts[0]);
  await core.message(a, parts[2]); // a part is missing
  assert.equal(a.last('err').code, 'bad-part');
  for (const part of parts.slice(3)) await core.message(a, part);
  assert.equal(owner.messages('msg').length, 0);
  const tooBig = splitIntoParts(JSON.stringify({ t: 'msg', d: 'x'.repeat(2 * 1024 * 1024) }), 2);
  for (const part of tooBig.slice(0, 2)) await core.message(a, part);
  assert.equal(a.last('err').code, 'bad-part', 'more parts than any allowed message can have');
});

test('the size limits still hold for a joined message', async () => {
  const { world, core, owner } = await setup({ ...CREW, maxMessageBytes: 100 * 1024 });
  const a = await connect(world, core, { name: 'A' });
  await sendInParts(core, a, { t: 'msg', n: 1, d: bigState(150) });
  assert.equal(a.last('err').code, 'too-large');
  assert.equal(owner.messages('msg').length, 0);
});

test('a large snapshot is stored in parts, survives sleep and reaches the next host whole', async () => {
  const { world, core, owner } = await setup();
  const a = await connect(world, core, { name: 'A' });
  await cmd(core, owner, 'start');
  await world.advance(4_000);
  const state = bigState(400, 'large');
  await sendInParts(core, owner, { t: 'snap', d: state });
  const record = world.store.get('snapshot');
  assert.ok(record.parts > 1, `stored in ${record.parts} parts`);
  for (let i = 0; i < record.parts; i++) assert.ok(world.store.get(`snapshot:${i}`).length <= PART_CHARS);
  assert.deepEqual(world.storedSnapshot(), state);

  const woke = await world.sleep();
  await drop(woke, owner);
  await world.advance(6_000);
  assert.deepEqual(a.last('host').snapshot, state);
  assert.ok(a.wire.filter((m) => m.t === 'part').length > 1, 'and was sent in parts');

  // A smaller state later leaves no stale parts behind.
  await cmd(woke, a, 'host-ready');
  await world.advance(10_000);
  await send(woke, a, { t: 'snap', d: { small: true } });
  assert.equal(world.store.get('snapshot').parts, 1);
  assert.equal(world.store.get('snapshot:1'), undefined);
  assert.deepEqual(world.storedSnapshot(), { small: true });
});

test('a snapshot stored whole by an earlier version is still read', async () => {
  const world = new FakeWorld();
  const core = await world.core(CREW);
  const created = await core.create({}, 'ABCD');
  const owner = await connect(world, core, { name: 'Owner', owner: created.ownerKey, pk: 'old-format-owner-xxxxxxx' });
  await cmd(core, owner, 'host-ready');
  world.store.set('snapshot', { d: { old: 'format' }, at: 1 });
  const woke = await world.sleep();
  const back = await connect(world, woke, { name: 'Owner', owner: created.ownerKey, pk: owner.pk, sid: 'reloaded' });
  assert.deepEqual(back.last('host').snapshot, { old: 'format' });
});

test('closing a room removes every stored part', async () => {
  const { world, core, owner } = await setup();
  await sendInParts(core, owner, { t: 'snap', d: bigState(200) });
  assert.ok(world.store.get('snapshot').parts > 1);
  const woke = await world.sleep(); // the part count must also be found after sleep
  await cmd(woke, owner, 'close');
  assert.deepEqual([...world.store.keys()].filter((k) => k.startsWith('snapshot')), []);
});
