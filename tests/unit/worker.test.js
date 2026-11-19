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
  // B-104: the status check with a game link sends x-admin-pass; a page on another address must be let through.
  assert.match(pre.headers.get('access-control-allow-headers'), /x-admin-pass/);
});

test('B-097: a path with a doubled slash is not one of ours', async () => {
  const server = createRoomServer({});
  assert.equal((await server.fetch(new Request('https://rooms.example/rooms//', { method: 'POST', body: '{}' }), env)).status, 404);
  assert.equal((await server.fetch(new Request('https://rooms.example/rooms/ABCD//ws'), env)).status, 404);
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
  assert.equal((await res.json()).code.length, 6, 'six by default (owner, 2026-11-18)');
});

test('a code of another length is refused without waking a room', async () => {
  const server = createRoomServer({ codeLength: 4 });
  const asleep = { ROOMS: { idFromName: () => { throw new Error('the room must not be woken'); } } };
  assert.equal((await server.fetch(new Request('https://rooms.example/rooms/ABCDE'), asleep)).status, 404);
  // A WebSocket gets a closed socket with "Room not found" (Cloudflare only); it must not wake a room either.
  await assert.rejects(
    server.fetch(new Request('https://rooms.example/rooms/ABCDEFGH/ws', { headers: { upgrade: 'websocket' } }), asleep),
    (err) => !/woken/.test(err.message),
  );
  const ok = await server.fetch(new Request('https://rooms.example/rooms/abcd'), { ROOMS: fakeRooms() });
  assert.equal(ok.status, 200);
});

test('a code length outside 4 to 12 fails early', () => {
  for (const codeLength of [3, 13, 4.5, '5', null]) {
    assert.throws(() => createRoomServer({ codeLength }), /codeLength/, String(codeLength));
  }
});

test('F-032: a closed game refuses joining with a reason, without waking a room', async () => {
  // Node has no WebSocketPair and refuses status 101; stand-ins for this test only.
  const sent = [];
  const RealResponse = globalThis.Response;
  globalThis.WebSocketPair = class {
    constructor() {
      const side = { accept() {}, send: (t) => sent.push(t), close: (code, reason) => sent.push({ code, reason }) };
      this[0] = side;
      this[1] = side;
    }
  };
  globalThis.Response = class extends RealResponse {
    constructor(body, init) {
      if (init?.status === 101) {
        super(null, { status: 200 });
        this.upgraded = true;
      } else {
        super(body, init);
      }
    }
  };
  try {
    const actions = [];
    const server = createRoomServer({
      gate: async ({ action }) => (actions.push(action), { open: false, reason: 'closed-tonight' }),
    });
    const res = await server.fetch(new Request('https://rooms.example/rooms/ABCDEF/ws', { headers: { upgrade: 'websocket' } }), env);
    assert.equal(res.upgraded, true);
    assert.deepEqual(actions, ['join']);
    assert.deepEqual(JSON.parse(sent[0]), { t: 'denied', code: 4008, reason: 'closed-tonight' });
    assert.deepEqual(sent[1], { code: 4008, reason: 'closed-tonight' });
  } finally {
    globalThis.Response = RealResponse;
    delete globalThis.WebSocketPair;
  }
});

test('F-053: creating rooms and trying codes is limited per visitor, before any room is woken', async () => {
  let woken = 0;
  const env2 = {
    ROOMS: {
      idFromName: (n) => n,
      get: () => ({ fetch: async () => (woken += 1, new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })) }),
    },
  };
  const server = createRoomServer({ limits: { createsPerMinute: 2, attemptsPerMinute: 3 } });
  const from = (ip) => ({ headers: { 'cf-connecting-ip': ip } });
  for (let i = 0; i < 3; i++) await server.fetch(new Request('https://rooms.example/rooms/ABCDEF', from('1.1.1.1')), env2);
  assert.equal(woken, 3);
  const blocked = await server.fetch(new Request('https://rooms.example/rooms/ABCDEG', from('1.1.1.1')), env2);
  assert.equal(blocked.status, 429);
  assert.equal(woken, 3, 'the fourth try woke no room');
  const other = await server.fetch(new Request('https://rooms.example/rooms/ABCDEG', from('2.2.2.2')), env2);
  assert.equal(other.status, 404, 'another visitor is not affected');
  const create = (ip) => server.fetch(new Request('https://rooms.example/rooms', { method: 'POST', body: '{}', ...from(ip) }), env2);
  await create('3.3.3.3');
  await create('3.3.3.3');
  assert.equal((await create('3.3.3.3')).status, 429);
  const off = createRoomServer({ limits: () => null });
  for (let i = 0; i < 5; i++) assert.equal((await off.fetch(new Request('https://rooms.example/rooms/ABCDEF', from('4.4.4.4')), env2)).status, 404);
});
