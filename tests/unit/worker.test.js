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
  assert.throws(() => createRoomServer({ ownerRole: 'nobody' }), /ownerRole/);
});

// F-035: room code length chosen by the game.

/** A Durable Object namespace that creates rooms without Cloudflare. */
function fakeRooms() {
  const created = [];
  return {
    created,
    idFromName: (name) => name,
    get: (code) => ({
      fetch: async (url, init) => {
        if (String(url).endsWith('/create')) {
          created.push(JSON.parse(init.body).code);
          return new Response(JSON.stringify({ code, ownerKey: 'k', keys: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ code, phase: 'lobby' }), { status: 200 });
      },
    }),
  };
}

test('room codes have the length the game chose, 4 to 12 characters', async () => {
  for (const codeLength of [4, 5, 8, 12]) {
    const rooms = fakeRooms();
    const server = createRoomServer({ codeLength });
    const res = await server.fetch(new Request('https://rooms.example/rooms', { method: 'POST', body: '{}' }), { ROOMS: rooms });
    const { code } = await res.json();
    assert.equal(code.length, codeLength);
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    const info = await server.fetch(new Request('https://rooms.example/rooms'), { ROOMS: rooms });
    assert.equal((await info.json()).codeLength, codeLength, 'the game page can ask for it');
  }
  const server = createRoomServer({});
  const res = await server.fetch(new Request('https://rooms.example/rooms', { method: 'POST', body: '{}' }), { ROOMS: fakeRooms() });
  assert.equal((await res.json()).code.length, 5, 'five by default');
});

test('a code of another length is refused without waking a room', async () => {
  const server = createRoomServer({ codeLength: 4 });
  const asleep = { ROOMS: { idFromName: () => { throw new Error('the room must not be woken'); } } };
  assert.equal((await server.fetch(new Request('https://rooms.example/rooms/ABCDE'), asleep)).status, 404);
  assert.equal((await server.fetch(new Request('https://rooms.example/rooms/ABCDEFGH/ws', { headers: { upgrade: 'websocket' } }), asleep)).status, 404);
  const ok = await server.fetch(new Request('https://rooms.example/rooms/abcd'), { ROOMS: fakeRooms() });
  assert.equal(ok.status, 200);
});

test('a code length outside 4 to 12 fails early', () => {
  for (const codeLength of [3, 13, 4.5, '5', null]) {
    assert.throws(() => createRoomServer({ codeLength }), /codeLength/, String(codeLength));
  }
});
