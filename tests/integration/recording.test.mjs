// D-126 (owner Q20): the kit tells everyone in a room that a browser records,
// also those who join later, and takes the notice away when it stops; the game
// never sees these messages. A player's word goes through the host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { create, join, next, until, cleanup } from './helpers.mjs';

test.afterEach(cleanup);

test('D-126: a player who records is announced to all, also to a latecomer; the game gets no message', async () => {
  const host = await create('Host');
  const a = await join(host.code, 'A');
  await until(() => host.players.length === 2);
  const gameMessages = [];
  host.on('message', (m) => gameMessages.push(m));

  const toHost = next(host, 'recording', (e) => e.recording);
  a.announceRecording(true, { lookback: true });
  const heard = await toHost;
  assert.deepEqual(heard.by, [a.me]);
  assert.equal(heard.lookback, true);

  // A latecomer is told by the host (a player's word goes through the host).
  const b = await join(host.code, 'B');
  b.on('message', (m) => gameMessages.push(m));
  const toB = await next(b, 'recording', (e) => e.recording);
  assert.deepEqual(toB.by, [a.me], 'a latecomer is told');

  const off = next(b, 'recording', (e) => !e.recording);
  a.announceRecording(false);
  await off;
  assert.deepEqual(gameMessages, [], 'the kit\'s own messages never reach the game');
});
