// A room that really goes to sleep (Durable Object hibernation in workerd)
// must wake up with the newest game state and its message counters.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { create, join, next, until, sleep, cleanup } from './helpers.mjs';

afterEach(cleanup);

test('B-014: after a real sleep the next host gets the newest snapshot, and nothing is counted twice', { timeout: 90_000 }, async () => {
  const quiet = { heartbeatMs: 600_000 };
  const host = await create('Host', quiet);
  const a = await join(host.code, 'A', quiet);
  const got = [];
  host.on('message', (m) => got.push(m.data));
  host.start();
  await until(() => a.phase !== 'lobby');
  host.sendSnapshot({ move: 1 });
  await sleep(1_000);
  host.sendSnapshot({ move: 2 }); // not written at once: only the trailing save keeps it
  for (let i = 1; i <= 5; i++) a.send(`input-${i}`);
  await until(() => got.length === 5);

  await sleep(25_000); // nothing happens: the room hibernates

  // A's phone switches network: a new connection while the old one still looks open.
  const old = a.ws;
  old.onclose = old.onmessage = null;
  a.ws = null;
  a.open();
  await until(() => a.ready);
  assert.equal(a.queue.length, 0, 'the room remembered what it had already counted');

  const took = next(a, 'host', () => true, 15_000);
  host.disconnect();
  assert.deepEqual(await took, { snapshot: { move: 2 } });
  old.close();
});
