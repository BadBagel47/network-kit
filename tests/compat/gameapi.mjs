#!/usr/bin/env node
// GameApi compatibility (F-103): games keep their own network-kit copy, but the
// admin page is one, shared live. The game Worker of an earlier release must
// still work against the current admin page: status with notices, a game link
// on a closed game, a lobby, and a measurement. Uses the newest earlier tag
// (any minor); with no tags fetched it says so and passes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { AdminStore } from '../../admin/store.js';
import { gameApi } from '../../admin/gameapi.js';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const num = (v) => v.replace(/^v/, '').split('.').map(Number);
const older = (a, b) => { for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
let tags = [];
try {
  tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').map((t) => t.trim()).filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
} catch {
  tags = [];
}
// The admin page as games met it: GameApi from 0.9 on, game links from 0.10, lobbies from 0.13.
const earlier = tags.filter((t) => older(num(t), num(version)) && !older(num(t), [0, 13, 0])).sort((a, b) => (older(num(a), num(b)) ? -1 : 1));
// The GameApi class games call (entry.js) and gameApi() have the same methods (F-138).
// entry.js imports cloudflare:workers, so its methods are read from the text.
const entryText = readFileSync('admin/entry.js', 'utf8');
const classBody = entryText.slice(entryText.indexOf('export class GameApi'));
const classMethods = [...classBody.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]).filter((n) => n !== 'api').sort();
const objectMethods = Object.keys(gameApi({ fetch: async () => new Response('{}') })).sort();
assert.deepEqual(classMethods, objectMethods, 'GameApi in entry.js and gameApi() in gameapi.js offer the same methods');

if (!earlier.length) {
  // Without tags the test would check nothing (F-138): fail, unless told that is expected.
  if (process.env.NK_COMPAT_NO_TAGS === '1') {
    console.log(`gameapi compat: no earlier release to check against ${version} (allowed by NK_COMPAT_NO_TAGS)`);
    process.exit(0);
  }
  console.error(`gameapi compat: no earlier release tag found to check against ${version}; fetch the tags (git fetch --tags) or set NK_COMPAT_NO_TAGS=1`);
  process.exit(1);
}
// The newest release of each earlier minor line (games keep their copy for a while).
const newest = [...new Map(earlier.map((t) => [num(t).slice(0, 2).join('.'), t])).values()];
for (const tag of newest) await check(tag);

async function check(tag) {
const dir = mkdtempSync(join(tmpdir(), 'network-kit-gameapi-'));
try {
  execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['archive', tag, 'src/server', 'src/shared', 'src/version.js'], { maxBuffer: 64 * 1024 * 1024 }) });
  const { createRoomServer } = await import(pathToFileURL(join(dir, 'src/server/worker.js')).href);

  // The current admin page's store and GameApi, in memory.
  const data = new Map();
  const storage = {
    get: async (k) => structuredClone(data.get(k)), put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort().map(([k, v]) => [k, structuredClone(v)])),
    setAlarm: async () => {}, deleteAlarm: async () => {},
  };
  const store = new AdminStore({ storage }, {});
  const stub = { fetch: (url, init) => store.fetch(new Request(url, init)) };
  const call = async (path, method = 'GET', body) => (await store.fetch(new Request(`https://store${path}`, { method, body: body && JSON.stringify(body) }))).json();

  // A room that answers like a real one, without Durable Objects.
  let made = 0;
  const env = {
    ADMIN: gameApi(stub),
    ROOMS: { idFromName: (n) => n, get: () => ({ fetch: async () => { made += 1; return Response.json({ code: `ROOM${made}`, ownerKey: 'o', keys: { player: { k: 'p' } } }); } }) },
  };
  // A fresh game Worker per step: each caches the admin page's answer for 30 seconds.
  let rooms = null;
  const fresh = () => { rooms = createRoomServer({ admin: { binding: 'ADMIN', game: 'bricks' }, limits: null }); };
  const req = (path, init) => rooms.fetch(new Request(`https://bricks.example${path}`, init), env, { waitUntil: () => {} });
  fresh();

  // Status with a message from the owner.
  await call('/messages', 'POST', { game: 'bricks', text: 'Hello from the owner', minutes: 60 });
  const status = await (await req('/rooms/status')).json();
  assert.equal(status.open, true, `${tag}: open`);
  assert.deepEqual(status.notices.map((n) => n.text), ['Hello from the owner'], `${tag}: notices reach the game`);

  // No new players: refused, but a game link gets in.
  await call('/settings', 'PUT', { games: { bricks: { mode: 'off' } } });
  fresh();
  assert.equal((await req('/rooms', { method: 'POST', body: '{}' })).status, 503, `${tag}: closed`);
  const { token } = await call('/passes', 'POST', { game: 'bricks', hours: 1 });
  const withPass = await req('/rooms', { method: 'POST', body: JSON.stringify({ adminPass: token }) });
  assert.equal(withPass.status, 200, `${tag}: a game link opens the closed game`);

  // A lobby's guest link makes its room.
  const lobby = await call('/lobbies', 'POST', { game: 'bricks', hours: 1, label: 'Compat', page: 'https://bricks.example/' });
  const guest = await req('/rooms/lobby', { method: 'POST', body: JSON.stringify({ token: lobby.guestToken }) });
  assert.equal(guest.status, 200, `${tag}: the lobby link works`);
  assert.equal((await guest.json()).role, 'guest');

  // The emergency stop: the earlier game Worker must refuse a new room, not fail open (F-138).
  await call('/settings', 'PUT', { games: { bricks: { mode: 'on', stopped: true } } });
  fresh();
  const stopped = await req('/rooms', { method: 'POST', body: '{}' });
  assert.equal(stopped.status, 503, `${tag}: the emergency stop closes the game`);
  assert.equal((await stopped.json()).reason ?? 'stopped', 'stopped');

  console.log(`gameapi compat: the ${tag} game Worker works against the ${version} admin page`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
}
