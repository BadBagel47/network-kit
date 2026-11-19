// Lobbies from the admin page (F-059), arrival times (F-063) and response
// times for the rules (F-076).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld, connect, cmd, send } from './fake-host.js';
import { CREW } from './setup.js';
import { CLOSE } from '../../src/shared/protocol.js';
import { createRoomServer } from '../../src/server/worker.js';
import { AdminStore } from '../../admin/store.js';
import { readLobbyLink } from '../../src/client/lobby.js';

const HOST = 'lb_abcdef12.host-secret-xxxxxxxxxxxxxxxxxxxx';
const GUEST = 'lb_abcdef12.guest-secret-xxxxxxxxxxxxxxxxxxx';

async function lobbyRoom({ valid = () => true } = {}) {
  const world = new FakeWorld();
  const core = await world.core(CREW);
  world.word = { open: false, reason: 'off', until: null, stopped: false };
  core.host = { ...world.host(), checkAdminPass: async (t) => (t === HOST || t === GUEST) && valid() };
  const created = await core.create({ access: 'private' }, 'ABCDEF', { pass: HOST, lobbyEnds: world.time + 3_600_000 });
  return { world, core, created };
}

test('F-059: guests wait in a lobby room while the game takes no new players, and the host link makes its holder owner and host', async () => {
  const { world, core, created } = await lobbyRoom();
  const guest = await connect(world, core, { name: 'Guest', key: created.keys.player.k });
  assert.ok(guest.last('welcome'), 'the guest gets in although the game takes no new players');
  assert.equal(core.state.ownerId, null, 'nobody owns the room yet: the guest waits');
  const stranger = await connect(world, core, { name: 'Stranger' });
  assert.equal(stranger.closedWith.code, CLOSE.GAME_CLOSED, 'the code alone is not enough');
  const host = await connect(world, core, { name: 'Host', owner: created.ownerKey });
  assert.equal(core.state.ownerId, host.id);
  await cmd(core, host, 'host-ready');
  assert.equal(core.state.hostId, host.id);
  await cmd(core, host, 'start');
  assert.notEqual(core.state.phase, 'lobby', 'a round starts while the game takes no new players');
});

test('F-059: a lobby room closes when the lobby ends or is revoked; a lobby token is not a game link', async () => {
  const { world, core, created } = await lobbyRoom();
  // A lobby token sent as a game link opens nothing.
  const sneaky = await connect(world, core, { name: 'Sneaky', adminPass: GUEST });
  assert.equal(sneaky.closedWith.code, CLOSE.GAME_CLOSED);
  const guest = await connect(world, core, { name: 'Guest', key: created.keys.player.k });
  assert.ok(guest.last('welcome'));
  await world.advance(3_600_000 + 1);
  assert.equal(core.state.closed?.reason, 'lobby-ended', 'closed when the lobby ends');

  let open = true;
  const r = await lobbyRoom({ valid: () => open });
  open = false; // revoked on the admin page
  const late = await connect(r.world, r.core, { name: 'Late', key: r.created.keys.player.k });
  assert.equal(late.closedWith.code, CLOSE.ROOM_CLOSED);
  assert.equal(r.core.state.closed?.reason, 'lobby-ended', 'a revoked lobby closes its room at the next newcomer');
});

test('F-059: the admin page makes lobbies with a host and a guest link, lists them, revokes them and logs it', async () => {
  let t = Date.UTC(2026, 10, 18, 12);
  const data = new Map();
  const storage = {
    get: async (k) => structuredClone(data.get(k)), put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort()),
    setAlarm: async () => {}, deleteAlarm: async () => {},
  };
  const store = new AdminStore({ storage }, {}, { now: () => t });
  const call = async (path, method = 'GET', body) => (await store.fetch(new Request(`https://store${path}`, { method, body: body && JSON.stringify(body) }))).json();
  const lobby = await call('/lobbies', 'POST', { game: 'bricks', label: 'Fredagsmatch', hours: 4, page: 'https://bricks.example/play' });
  assert.match(lobby.hostToken, /^lb_/);
  assert.notEqual(lobby.hostToken, lobby.guestToken);
  assert.equal(readLobbyLink(`#nk-lobby=${lobby.guestToken}`), lobby.guestToken, 'the client reads the link');
  assert.deepEqual(await call('/lobby-check', 'POST', { game: 'bricks', token: lobby.hostToken }), { id: lobby.id, role: 'host', expires: lobby.expires, room: null });
  assert.equal((await call('/lobby-check', 'POST', { game: 'vattigt', token: lobby.hostToken })).error, 'lobby-other-game', 'one game only');
  assert.equal((await call('/check-pass', 'POST', { game: 'bricks', token: lobby.guestToken })).valid, true, 'the room checks the token like a game link');
  // The first room stored wins.
  assert.equal((await call('/lobby-room', 'POST', { game: 'bricks', id: lobby.id, room: { code: 'AAAAAA', ownerKey: 'o1', key: 'k1' } })).code, 'AAAAAA');
  assert.equal((await call('/lobby-room', 'POST', { game: 'bricks', id: lobby.id, room: { code: 'BBBBBB', ownerKey: 'o2', key: 'k2' } })).code, 'AAAAAA');
  assert.equal((await call('/lobbies'))[0].code, 'AAAAAA');
  await call(`/lobbies/${lobby.id}`, 'DELETE');
  assert.equal((await call('/check-pass', 'POST', { game: 'bricks', token: lobby.guestToken })).valid, false, 'revoked');
  assert.equal((await call('/lobby-check', 'POST', { game: 'bricks', token: lobby.guestToken })).error, 'lobby-revoked', 'the real reason (B-089)');
  assert.equal((await call('/lobby-check', 'POST', { game: 'bricks', token: 'lb_nothing.here' })).error, 'not-a-lobby');
  assert.deepEqual(await call('/lobbies'), [], 'only active lobbies by default');
  assert.equal((await call('/lobbies?all=1'))[0].state, 'revoked');
  const log = (await call('/log')).map((e) => e.text);
  assert.ok(log.some((x) => x.startsWith('Lobby skapad: Fredagsmatch för bricks')));
  assert.ok(log.some((x) => x.includes('fick rummet AAAAAA')));
  assert.ok(log.some((x) => x.startsWith('Lobbyn Fredagsmatch återkallad')));
  t += 15 * 86_400_000;
  assert.deepEqual(await call('/lobbies?all=1'), [], 'gone after 14 days');
});

test('F-059: the game Worker makes the lobby room once and gives the host the owner key, guests an invitation key', async () => {
  const made = [];
  let stored = null;
  const env = {
    ROOMS: { idFromName: (n) => n, get: () => ({ fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      made.push(body);
      return Response.json({ code: body.code, ownerKey: 'owner-key', keys: { player: { k: 'player-key', exp: null }, viewer: { k: 'viewer-key', exp: null } } });
    } }) },
    ADMIN: {
      status: async () => ({ open: false, reason: 'off', stopped: false }),
      lobby: async (game, token) => (token === HOST ? { id: 'abcdef12', role: 'host', expires: Date.now() + 3_600_000, room: stored }
        : token === GUEST ? { id: 'abcdef12', role: 'guest', expires: Date.now() + 3_600_000, room: stored } : { error: 'lobby-ended' }),
      lobbyRoom: async (game, id, room) => (stored ??= room),
    },
  };
  const server = createRoomServer({ admin: { binding: 'ADMIN', game: 'bricks' } });
  const ask = async (token) => server.fetch(new Request('https://x/rooms/lobby', { method: 'POST', body: JSON.stringify({ token }) }), env);
  const guest = await (await ask(GUEST)).json();
  assert.equal(guest.role, 'guest');
  assert.equal(guest.key, 'player-key');
  assert.equal(guest.ownerKey, undefined, 'a guest never gets the owner key');
  assert.equal(made.length, 1);
  assert.equal(made[0].pass, GUEST);
  assert.equal(made[0].settings.access, 'private');
  const host = await (await ask(HOST)).json();
  assert.deepEqual([host.role, host.code, host.ownerKey], ['host', guest.code, 'owner-key']);
  assert.equal(made.length, 1, 'the room is made once');
  const bad = await ask('lb_nope.nope');
  assert.equal(bad.status, 410);
  env.ADMIN.status = async () => ({ open: false, reason: 'stopped', stopped: true });
  const fresh = createRoomServer({ admin: { binding: 'ADMIN', game: 'bricks' } }); // the admin page's word is kept 30 s per server
  const stopped = await fresh.fetch(new Request('https://x/rooms/lobby', { method: 'POST', body: JSON.stringify({ token: HOST }) }), env);
  assert.equal(stopped.status, 503, 'not after an emergency stop');
});

test('F-063: messages carry the time they reached the room; F-076: the rules see each participant\'s response time', async () => {
  const seen = [];
  const rules = {
    init: () => ({}),
    onMessage(room, player, data, meta) { seen.push({ data, at: meta.at, rttMs: player.rttMs }); },
  };
  const world = new FakeWorld();
  const core = await world.core({ mode: 'server', rules, roles: { player: { seats: 4 } }, countdownMs: 0, rttProbeMs: 10_000 });
  const created = await core.create({}, 'ABCDEF');
  const a = await connect(world, core, { name: 'A', owner: created.ownerKey });
  await send(core, a, { t: 'msg', d: 'first' });
  const probe = a.last('probe');
  assert.ok(probe, 'the room asks the page to answer');
  await world.advance(80);
  await send(core, a, { t: 'probe', n: probe.n });
  await send(core, a, { t: 'msg', d: 'buzz' });
  assert.equal(seen.at(-1).at, world.time);
  assert.equal(seen.at(-1).rttMs, 80);
  assert.equal(a.messages('probe').length, 1, 'probes are not sent more often than rttProbeMs');
});
