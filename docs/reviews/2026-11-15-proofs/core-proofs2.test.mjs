import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld, connect, send, drop } from '../../../tests/unit/fake-host.js';
import { memoryRules } from '../../../examples/demo/memory-rules.js';
import { CLOSE } from '../../../src/shared/protocol.js';

test('P17 server-run room: every incoming message is a storage write, even ignored ones from a viewer', async () => {
  const opts = { mode: 'server', rules: memoryRules, limits: { player: 4, viewer: 2 }, countdownMs: 0 };
  const world = new FakeWorld();
  const core = await world.core(opts);
  const created = await core.create({}, 'ABCDE');
  const host = await connect(world, core, { name: 'Host', hk: created.hostKey });
  const v = await connect(world, core, { name: 'TV', role: 'viewer' });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  let puts = 0;
  const realPut = core.host.storage.put;
  core.host.storage.put = async (k, val) => { puts += 1; return realPut(k, val); };
  for (let n = 1; n <= 100; n++) await send(core, v, { t: 'msg', n, d: { type: 'noise' } });
  console.log('P17 storage puts for 100 ignored viewer messages:', puts);
  assert.equal(puts, 100);
});

test('P18 lateJoin "never": a player who was in the game and is away past the grace period cannot come back', async () => {
  const opts = { mode: 'server', rules: memoryRules, limits: { player: 4, viewer: 2 }, lateJoin: 'never', countdownMs: 0 };
  const world = new FakeWorld();
  const core = await world.core(opts);
  const created = await core.create({}, 'ABCDE');
  const host = await connect(world, core, { name: 'Host', hk: created.hostKey });
  const pk = 'b-key-xxxxxxxxxxxxxxxxxx';
  const b = await connect(world, core, { name: 'B', pk });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await drop(core, b);
  await world.advance(61_000); // phone call
  const b2 = await connect(world, core, { name: 'B', pk });
  console.log('P18 returning player:', JSON.stringify(b2.closedWith));
  assert.equal(b2.closedWith.code, CLOSE.IN_PROGRESS);
});

test('P19 storage writes and alarm sets for one reconnect cycle of the host (drop + back)', async () => {
  const world = new FakeWorld();
  const core = await world.core({ mode: 'host', limits: { player: 3, viewer: 2 }, autoPauseMs: 15000 });
  const created = await core.create({}, 'ABCDE');
  const host = await connect(world, core, { name: 'Host', hk: created.hostKey, pk: 'host-key-xxxxxxxxxxxxxxxx' });
  await connect(world, core, { name: 'A' });
  await send(core, host, { t: 'cmd', n: 1, c: 'start' });
  await send(core, host, { t: 'snap', d: { x: 1 } });
  let puts = 0; let alarms = 0;
  const h = core.host;
  const realPut = h.storage.put; const realAlarm = h.setAlarm;
  h.storage.put = async (k, val) => { puts += 1; return realPut(k, val); };
  h.setAlarm = async (at) => { alarms += 1; return realAlarm(at); };
  await drop(core, host);
  await world.advance(1000);
  await connect(world, core, { name: 'Host', hk: created.hostKey, pk: 'host-key-xxxxxxxxxxxxxxxx' });
  console.log('P19 one host drop + return:', puts, 'storage puts,', alarms, 'alarm sets');
});
