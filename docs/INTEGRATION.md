# Using network-kit in a game

network-kit has two parts, both plain JavaScript without a build step or dependencies:

- `client/`: the browser side (`NetworkRoom`, share links, QR codes).
- `server/`: the room server for the game's own Cloudflare Worker (`createRoomServer`).

Each game keeps its own copy of a fixed version (D-009), so a change in network-kit never reaches a game before the game takes it in.

## 1. Take a copy

From a network-kit checkout at the wanted tag:

```sh
node scripts/vendor.mjs ../my-game/vendor/network-kit
```

This writes `client/`, `server/`, `shared/`, `version.js`, `VERSION` and a short README. Record the version in the game's HANDOFF. Never edit the copy: fix network-kit first (with a test that shows the bug), release, then update.

For automatic bug-fix updates, copy `templates/update-network-kit.yml` to the game's `.github/workflows/` and set `VENDOR_DIR`, `SETUP_COMMAND` and `TEST_COMMAND` at the top. Every day it looks for a newer PATCH of the same MAJOR.MINOR, copies it, runs the game's tests and pushes it to `main` only if they pass. Otherwise it pushes a branch `network-kit/vX.Y.Z` and opens an issue. network-kit is public, so no token is needed (`NETWORK_KIT_TOKEN` is only for a private copy).

> Note for games published with GitHub Pages from a branch: check once that a push made by the workflow starts the Pages build.

## 2. The game's Worker

```js
// worker/index.js in the game
import { createRoomServer } from '../vendor/network-kit/server/index.js';

const rooms = createRoomServer({
  mode: 'host',                                  // a player's browser runs the game
  posts: ['captain', 'gunner', 'engineer'],
  limits: { player: 3, viewer: 4 },
  allowedOrigins: ['https://badbagel47.github.io'],
  jurisdiction: 'eu',
});

export const Room = rooms.RoomObject;
export default { fetch: rooms.fetch };
```

```jsonc
// wrangler.jsonc in the game
{
  "name": "my-game-rooms",
  "main": "worker/index.js",
  "compatibility_date": "2026-11-01",
  "durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "Room" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]   // Free plan: SQLite only
}
```

Deploy with `npx wrangler deploy` from a GitHub Actions workflow using the `CLOUDFLARE_API_TOKEN` secret (see network-kit's `.github/workflows/deploy-demo.yml`). Local tests: `npx wrangler dev`. Local workerd has no jurisdictions, so pass the jurisdiction through a variable and leave it empty locally (as the demo does with `ROOM_JURISDICTION`).

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `'host'` | `'host'`: a player's browser runs the game and the room relays. `'server'`: the game's `rules` run in the room. |
| `rules` | – | Server mode: the game's rules (section 5). |
| `limits` | `{ player: 8, viewer: 4 }` | Seats per role. Away players keep their seat. |
| `posts` | `[]` | Named posts; each held by at most one player. |
| `access` | `'open'` | Default for new rooms: `'open'` (code is enough) or `'private'` (invitation key needed). |
| `lateJoin` | `'now'` | Joining a running game: `'now'`, `'next'` (waits until the host admits) or `'never'`. |
| `lateJoinChoices` | all three | Which `lateJoin` values a host may pick for this game. |
| `pauseBy` | `'anyone'` | Who may pause and resume: `'anyone'`, `'host'` or `'nobody'`. |
| `graceMs` | 60 s | How long a dropped player keeps the seat and post. |
| `autoPauseMs` | `null` | Pause the room when a player has been away this long during a game. |
| `takeoverMs` | 5 s | Host-run rooms: wait before another player takes over from a lost host. |
| `hostLeave` | `'close'` | A host leaving on purpose `'close'`s the room or `'handover'`s it. |
| `countdownMs` | 3 s | Time from start to play; clients get `startsAt` and the server time. |
| `cleanupMs` | 24 h | Delete the room this long after the last player left. |
| `snapshotSaveMs` | 10 s | How often the latest snapshot is written to storage (always when the host drops or the room pauses). |
| `maxMessageBytes` / `maxSnapshotBytes` | 64 kB / 512 kB | Larger messages are refused. |
| `binding` | `'ROOMS'` | Durable Object binding name. |
| `basePath` | `'/rooms'` | URL prefix of the room API. |
| `allowedOrigins` | `'*'` | Pages allowed to use the API (the game's site). |
| `jurisdiction` | `null` | `'eu'` keeps rooms in the EU; may be a function `(env) => 'eu' \| null`. |
| `gate` | – | `async ({ request, env, action }) => true \| { open: false, reason }`, checked before a room is created or joined (for the shared admin page, F-003). |
| `fallback` | – | `async (request, env, ctx) => Response` for other paths. |

## 3. The browser client

```js
import { NetworkRoom, shareLink, readShareLink, forgetShareKey, qrSvg }
  from './vendor/network-kit/client/index.js';

const SERVER = 'https://my-game-rooms.example.workers.dev';

// Create (the creator becomes host) or join.
const room = await NetworkRoom.create(SERVER, { name: 'Ada', settings: { access: 'private' } });
const link = readShareLink(location.hash);                   // { code, key } from a share link
const other = await NetworkRoom.join(SERVER, { code: link.code, key: link.key, name: 'Bo' });
forgetShareKey();                                            // take the key out of the address bar

// Share: the player link and a QR code (keys are only visible to the host).
const url = shareLink(location.href, room.code, room.inviteKeys.player.k);
element.innerHTML = qrSvg(url);
```

`NetworkRoom.join` and `create` reject with a `RoomError` whose `code` is one of the close codes below and whose `message` is a plain sentence for the player. `NetworkRoom.info(SERVER, code)` looks a room up without joining (`null` if not found).

The player key that identifies a player is kept per tab by default (`identity: 'device'` keeps it per browser). A reload in the same tab comes back as the same player with the same seat and post.

### Events (`room.on(type, fn)` returns an unsubscribe function)

| Event | Detail |
| --- | --- |
| `status` | `'connecting'`, `'online'`, `'reconnecting'`, `'offline'`, `'closed'` |
| `room` | the room: `phase`, `round`, `seed`, `startsAt`, `paused`, `hostId`, `posts`, `players`, `settings` (and `keys` for the host) |
| `message` | `{ from, data }` (host-run: inputs to the host, state to players; server-run: `from` is `null`) |
| `snapshot` | `{ from, data }` a full state from the host |
| `host` | `{ snapshot }` you now run the game: continue from `snapshot` (may be `null`) |
| `role` | `{ isHost }` when this client starts or stops being the host |
| `peer` | `{ event, id, player }` with `event` = `join`, `waiting`, `drop`, `back`, `gone` or `host` |
| `error` | `{ code, command }` a refused command, e.g. `post-taken`, `host-only`, `not-allowed` |
| `closed` | `{ code, reason, text }` the room is over for this client (no more reconnecting) |

### Methods

- `send(data, { to, reliable })`: `to` = `'others'` (default), `'all'`, `'players'`, `'viewers'` or a list of player ids. Messages are numbered and resent after a reconnect, and the room counts each once. Use `reliable: false` for data that the next message replaces anyway (positions).
- `sendSnapshot(data, { to })` (host): the room keeps the latest one for takeover and reload; `to` also delivers it now.
- `claimPost(post)`, `releasePost()`, `assignPost(id, post)` (host).
- `pause()`, `resume()`.
- Host: `start()` (new round, seed, countdown; admits waiting players), `end()`, `admitWaiting()`, `kick(id, { ban })`, `renewKey(role, { ttlMs })`, `setSettings({ access, lateJoin })`, `handover(id, snapshot)`, `close()`.
- `leave(snapshot)`: leave on purpose. `disconnect()`: stop without leaving (the seat is kept for the grace period).
- `isHost`, `me`, `self`, `players`, `player(id)`, `room`, `status`, `serverNow()`, `inviteKeys`.

## 4. Host-run games (recommended for Critical ST8)

The host's browser steps the game; everyone else sends inputs and draws what the host sends. Only messages into the server count against the daily free budget, so:

- Players send inputs **only when they change**.
- The host sends the moving part of the state often with `reliable: false` (e.g. 15–20 times a second), changes that must arrive with the default `reliable: true`, and a full `sendSnapshot` every few seconds (the room keeps it for takeover).
- On `peer` `join` or `back`, the host sends `sendSnapshot(state, { to: [id] })`.
- On `host`, load `snapshot` and continue; the client tells the room it is ready, which ends the short "host-change" pause.
- On `role` `{ isHost: false }`, stop stepping the game.
- Posts: `claimPost`; the room tells everyone who holds what (`room.posts`).

## 5. Server-run games

Rules are an object of synchronous hooks; the room stores `room.game` after each hook:

```js
export const rules = {
  init(room) { return { /* initial game state */ }; },
  onStart(room) {},                  // after start(): room.seed, room.round
  onJoin(room, player) {},           // admitted (also for late joiners)
  onBack(room, player) {}, onDrop(room, player) {}, onGone(room, player) {},
  onMessage(room, player, data) {},
  onTimer(room, name) {},            // after room.setTimer(name, ms)
  onEnd(room) {},
};
```

`room` offers `code`, `phase`, `round`, `seed`, `hostId`, `players`, `game` (read/write), `save()`, `send(to, data)`, `end()`, `admit()`, `setTimer(name, ms)`, `clearTimer(name)`, `now()`. See `examples/demo/memory-rules.js`.

## 6. Close codes

| Code | Meaning |
| --- | --- |
| 4000 | The room has closed. |
| 4001 | Removed by the host. |
| 4002 | Banned. |
| 4003 | The same player opened the room in another tab. |
| 4004 | Room not found. |
| 4005 | The room is full. |
| 4006 | The game has already started (late join off). |
| 4007 | Invitation key needed, invalid or expired (`reason`: `key-required`, `key-invalid`, `key-expired`). |
| 4008 | The game is closed right now (admin gate). |
| 4009 | Mixed network-kit versions: reload. |
| 4010 | Bad request. |
| 4011 | You left the room. |

`CLOSE_TEXT` has a plain sentence for each.

## 7. Budget and limits

The Workers Free plan has daily limits shared by every game on the account (around 100,000 requests and 13,000 GB-s of Durable Object time a day; incoming WebSocket messages are billed at 20:1; heartbeats answered by the auto-response cost nothing). **These figures were not verified against Cloudflare's own pages in run A (the pages could not be reached from the build environment); check them before relying on them** (F-008 shows the real usage later).

## 8. Privacy

A room stores: nicknames, a hash of each player's random player key (never the key itself), room settings and invitation keys, the latest snapshot sent by the host (host-run rooms) or the game state (server-run rooms). Rooms are deleted 24 hours after the last player left, and an hour after they were closed. Cloudflare processes players' IP addresses to deliver the connection. Each game's privacy notice should say so.
