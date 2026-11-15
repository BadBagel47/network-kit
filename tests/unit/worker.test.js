import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomServer } from '../../src/server/worker.js';

const env = { ROOMS: { idFromName: () => { throw new Error('the room must not be woken'); } } };

test('a closed game refuses new rooms before any room is woken', async () => {
  const server = createRoomServer({ gate: async ({ action }) => ({ open: false, reason: `closed-${action}` }) });
  const res = await server.fetch(new Request('https://rooms.example/rooms', { method: 'POST', body: '{}' }), env);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'closed-create' });
});

test('pages from other sites are refused when origins are listed', async () => {
  const server = createRoomServer({ allowedOrigins: ['https://game.example'] });
  const bad = await server.fetch(new Request('https://rooms.example/rooms', { headers: { origin: 'https://evil.example' } }), env);
  assert.equal(bad.status, 403);
  const ok = await server.fetch(new Request('https://rooms.example/rooms', { headers: { origin: 'https://game.example' } }), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://game.example');
  const pre = await server.fetch(new Request('https://rooms.example/rooms', { method: 'OPTIONS', headers: { origin: 'https://game.example' } }), env);
  assert.equal(pre.status, 204);
});

test('bad room codes and other paths answer 404 without waking a room', async () => {
  const server = createRoomServer({});
  assert.equal((await server.fetch(new Request('https://rooms.example/rooms/0OO0O'), env)).status, 404);
  assert.equal((await server.fetch(new Request('https://rooms.example/other'), env)).status, 404);
});

test('bad options fail early', () => {
  assert.throws(() => createRoomServer({ mode: 'peer' }), /unknown mode/);
  assert.throws(() => createRoomServer({ mode: 'server' }), /needs rules/);
});
