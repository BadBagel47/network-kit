# Using network-kit in a game

network-kit has two parts, both plain JavaScript without a build step or dependencies:

- `client/`: the browser side (`NetworkRoom`, share links, QR codes).
- `server/`: the room server for the game's own Cloudflare Worker (`createRoomServer`).

Each game keeps its own copy of a fixed version, so a change in network-kit never reaches a game before the game takes it in. This guide describes **v0.2** (0.2.1).

Contents: [1 Copy and updates](#1-take-a-copy-and-keep-it-updated) · [2 The game's Worker](#2-the-games-worker) · [3 Concepts](#3-concepts) · [4 The browser client](#4-the-browser-client) · [5 Host-run games](#5-host-run-games) · [6 Server-run games](#6-server-run-games) · [7 Close codes](#7-close-codes) · [8 Cost and limits](#8-cost-and-limits) · [9 Privacy](#9-privacy)

## 1. Take a copy and keep it updated

From a network-kit checkout at the wanted tag:

```sh
node scripts/vendor.mjs ../my-game/vendor/network-kit
```

This writes `client/`, `server/`, `shared/`, `version.js`, `smoke.mjs`, `VERSION` and a short README. Never edit the copy: fix network-kit first (with a test that shows the bug), release, then update.

**Version numbers** (MAJOR.MINOR.PATCH):

- A **PATCH** (0.2.0 → 0.2.1) only fixes bugs and never needs changes in the game.
- While the kit is 0.x, a **MINOR** (0.2 → 0.3) may need changes in the game; the changelog then has a short upgrade guide. From 1.0 a MINOR never breaks games.
- The client and the server part of one game must be the same version (they are, since both come from the same copy; deploy the game's Worker and its pages together).

**The smoke test** checks a copy without Cloudflare, in plain Node 22+:

```sh
node vendor/network-kit/smoke.mjs --options rooms-options.js
```

`--options` is the file that exports the object the game passes to `createRoomServer` (`export default { ... }`). Keep the options in a file of their own, as `examples/demo/options.js` does, so they can be loaded outside Cloudflare.

**Update proposals:** copy `templates/update-network-kit.yml` to the game's `.github/workflows/` and set the values at its top. Once a day it looks for the newest PATCH of the same MAJOR.MINOR that has been out for at least three days, copies it onto a branch `network-kit/vX.Y.Z`, runs the smoke test and the game's own tests, and opens an issue with the result. **It never pushes to the game's main branch**; the owner or an agent merges the branch. A version that already has an issue (open or closed) is not proposed again, so closing the issue skips it. A new MINOR or MAJOR version is only announced once with an issue; it is prepared the same way by starting the workflow by hand with the version. The kit's code and the game's tests run in a job that can only read the repository.

`scripts/vendor.mjs` replaces its target folder, so it refuses a folder that is not empty and is not an earlier copy.

## 2. The game's Worker

```js
// rooms-options.js in the game (plain data, also used by the smoke test)
export default {
  mode: 'host',                 // a participant's browser runs the game
  takeover: true,               // another participant continues if the host is lost
  places: ['captain', 'gunner', 'engineer'],
  roles: { player: { seats: 3 }, viewer: { seats: 4 } },
};
```

```js
// worker/index.js in the game
import { createRoomServer } from '../vendor/network-kit/server/index.js';
import options from '../rooms-options.js';

const rooms = createRoomServer({
  ...options,
  allowedOrigins: ['https://badbagel47.github.io'],
  jurisdiction: (env) => env.ROOM_JURISDICTION || null,   // "eu" in production, empty locally
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
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }],   // Free plan: SQLite only
  "vars": { "ROOM_JURISDICTION": "eu" }
}
```

Deploy with `npx wrangler deploy` from a GitHub Actions workflow using a `CLOUDFLARE_API_TOKEN` secret (see network-kit's `.github/workflows/deploy-demo.yml`). Local runs: `npx wrangler dev --var ROOM_JURISDICTION:` (local workerd has no jurisdictions).

HTTP API under `basePath`: `POST /rooms` creates a room (`{ code, ownerKey, keys }`), `GET /rooms/CODE` gives `{ code, phase, access, participants, closed }`, `GET /rooms/CODE/ws` is the WebSocket.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `'host'` | `'host'`: a participant's browser runs the game and the room relays. `'server'`: the game's `rules` run in the room. |
| `rules` | – | Server mode: the game's rules (section 6). |
| `roles` | `player` (8 seats) and `viewer` (4) | The kinds of participants, see below. Listing roles replaces the default set. |
| `ownerRole` | `'player'` | The role the room's creator joins in (e.g. a non-playing `leader`). |
| `places` | none | Named spots a playing participant can take, one at a time: `['captain', 'gunner']` (one each) or `{ red: 4, blue: 4 }` (teams). |
| `access` | `'open'` | Default for new rooms: `'open'` (the code is enough) or `'private'` (an invitation key is needed). |
| `lateJoin` | `'now'` | Joining a running game in a playing role: `'now'`, `'next'` (waits until admitted) or `'never'`. |
| `lateJoinChoices` | all three | Which `lateJoin` values a room's owner may pick. |
| `pauseBy` | `'anyone'` | Who may pause and resume: `'anyone'` (whose role may pause), `'host'` (host and owner only) or `'nobody'`. |
| `graceMs` | 60 s | How long a dropped participant keeps the seat and place. |
| `autoPauseMs` | off | Pause the room when a playing participant has been away this long; lifted when they are back or gone. |
| `takeover` | `false` | Host-run rooms: may another participant continue a lost host's game? Off: the room waits for the host. |
| `takeoverMs` | 5 s | With takeover: how long to wait for the host first. |
| `hostCheckMs` | 3 s | How long a host has to answer when others report it silent. |
| `closeAfterHostAwayMs` | off | Without takeover: close the room after waiting this long for its host. |
| `passOwnerAfterMs` | off | Ownership passes on (to the host, else whoever has been in the room longest) when the owner has been away this long. |
| `ownerLeave` | `'close'` | The owner leaving on purpose `'close'`s the room or `'pass'`es ownership on. |
| `countdownMs` | 3 s | Time from start to play (0: none). |
| `cleanupMs` | 24 h | Delete the room this long after the last participant left. |
| `closedKeepMs` | 1 h | How long a closed room still answers "closed". |
| `snapshotSaveMs` | 5 s | The host's snapshot is written to storage at most this often (and when the host drops, pauses, leaves or hands over). |
| `maxMessageBytes` / `maxSnapshotBytes` / `maxDataBytes` | 64 kB / 512 kB / 4 kB | Larger ones are refused. |
| `maxMessagesPerSecond` | 40 | Per connection; short bursts of twice this are fine. Faster connections are closed (4012, final). Refused and ignored messages cost the sender several times as much, and nothing of the room's budget. The kit's client keeps under the pace by itself. 0: no limit. |
| `maxMessagesPerDay` | 600,000 | Per room and UTC day; the room closes (4013) when it is used up. 0: no limit. |
| `maxActiveMinutesPerDay` | 720 | Per room and UTC day: minutes in which messages arrived. Stops a forgotten room that trickles messages from staying awake all day. 0: no limit. |
| `maxPendingSockets` | 8 | Connections that have not introduced themselves yet. |
| `nameMaxLength` | 24 | Nicknames are trimmed to this. |
| `binding` | `'ROOMS'` | Durable Object binding name. |
| `basePath` | `'/rooms'` | URL prefix of the room API. |
| `allowedOrigins` | `'*'` | Pages allowed to use the API (the game's site). |
| `jurisdiction` | `null` | `'eu'` keeps rooms in the EU; may be a function `(env) => 'eu' \| null`. |
| `gate` | – | **Experimental**, will change with the admin page (F-003): `async ({ request, env, action }) => true \| { open: false, reason }`, checked before a room is created or a connection is opened. |
| `fallback` | – | `async (request, env, ctx) => Response` for other paths. |

### Roles

```js
roles: {
  leader:  { seats: 1, plays: false },             // with ownerRole: 'leader'
  player:  { seats: 12 },
  viewer:  { seats: 4 },
  referee: { seats: 1, plays: false, canPause: true },
}
```

| Property | Default | Meaning |
| --- | --- | --- |
| `seats` | 1 (player 8, viewer 4) | How many may be in the room in this role. The owner always gets in. |
| `plays` | `false` (player `true`) | Takes part in the game: may take a place, and the late-join setting applies. |
| `sends` | same as `plays` | Its game messages reach the host or the rules. Set it for a non-playing role that commands the game. |
| `canPause` | same as `plays` | May pause and resume (with `pauseBy: 'anyone'`). |
| `canHost` | same as `plays`; `true` for `ownerRole` | May run the game: after a takeover or a handover. |
| `needsKey` | `false` for `player` and `viewer`, else `true` | Can only be joined with this role's invitation link, also in open rooms. |

Every role has its own invitation key, so a viewer link can never play. In an open room someone without a key gets the first playing role that needs no key, or the role they ask for if it needs no key.

## 3. Concepts

- **Owner**: whoever created the room. Kicks and bans, renews links, changes settings, closes the room, and may also do everything the host may. Ownership never moves by itself (unless the game sets `passOwnerAfterMs` or `ownerLeave: 'pass'`; it then goes to the host, else to whoever has been in the room longest in a role that may host).
  - The owner gets a secret **owner key** at creation, kept in the browser. It brings them back as owner at any time, also from another device: the owner's seat, with the same participant id, place and host role, then belongs to the new device.
  - The key only claims the owner's seat when that seat is **not connected**. A second tab or window of the owner's browser, which finds the same key, joins as an ordinary participant and leaves the first one alone.
  - When ownership passes on by itself in a room **without takeover**, the kept game state does not pass with it: the new owner starts fresh. (A quiz should still leave both options off.)
- **Host** (host-run rooms): the participant whose browser runs the game; from the start that is the owner. It starts and ends rounds, admits those waiting, assigns places and sets the room data, and has none of the owner's rights. In server-run rooms nobody runs the game in a browser and the owner leads.
- **When the host's connection is lost**, the room pauses (`paused.reason` `'host-away'`).
  - Default: it **waits** for the host. No participant can become host, and the kept state is never sent to anyone else.
  - With `takeover: true`: after `takeoverMs` another participant who may host continues from the latest snapshot (`'host-change'` until it confirms). The owner is preferred, then whoever has been in the room longest.
  - A host that looks connected but has gone silent (a phone asleep) is found when others report it (`hostSilentMs` on the client): the room asks it to answer within `hostCheckMs`.
- **Snapshot**: the full game state the host gives the room to keep. It is private to the host seat: the room only sends it back to whoever runs the game (the host after a reload, or the next host). What newcomers may see is sent as normal messages.
- **Places**: named spots (posts, sides, teams) with a capacity. A playing participant holds at most one; everyone sees who holds what.
- **Phases**: `lobby` → `countdown` → `playing` → `ended`; `start()` again begins a new round (a rematch) with a new seed. `cancelStart()` calls a countdown off. Pausing during a countdown does not stop the countdown; the game then starts paused.
- **Room data**: one small object (`room.data`) set by the host, the owner or the rules and seen by everyone, also by those who join later: lobby choices, the chosen map and the like.
- **Participant ids** are stable for the life of the room: someone who drops, leaves or is removed and comes back with the same browser identity gets the same id (the room remembers the last 100).
- **Coming back**: a participant whose connection was lost may return without an invitation key, also after the grace period, and is not a late joiner in the round they were part of. That standing ends when the role's link is renewed, when they are removed, or when anyone is banned. Someone who left on purpose or was removed needs an invitation like anyone else. The owner can remove or ban someone the room remembers by id while they are away.
- **Waiting for the host**: while a host-run room has no connected host, the room is paused (`'host-away'`) and messages to the host are dropped, not queued (`send()` returns `false`). When the host is back, everyone sends their current input again (section 5).
- **A new or returning host is asked to answer** within `hostCheckMs` (the client does that by itself); one that does not is treated as lost, so a host picked while its phone was asleep does not leave everyone waiting.

## 4. The browser client

```js
import { NetworkRoom, shareLink, readShareLink, forgetShareKey, qrSvg }
  from './vendor/network-kit/client/index.js';

const SERVER = 'https://my-game-rooms.example.workers.dev';

// Create (the creator becomes owner and host) or join.
const room = await NetworkRoom.create(SERVER, { name: 'Ada', settings: { access: 'private' } });
const link = readShareLink(location.hash);                   // { code, key } from a share link
const other = await NetworkRoom.join(SERVER, { code: link.code, key: link.key, name: 'Bo' });
forgetShareKey();                                            // take the key out of the address bar

// Share: a link and a QR code (only the owner has the keys).
const url = shareLink(location.href, room.code, room.inviteKeys?.player.k);
element.innerHTML = qrSvg(url);
```

`create` and `join` reject with a `RoomError` whose `code` is a close code (section 7), or 0 with `reason` `'timeout'` when the server cannot be reached, and whose `message` is a plain sentence for the player. `NetworkRoom.info(SERVER, code)` looks a room up without joining (`null` if not found).

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `name`, `code`, `key`, `role` | | Nickname, room code, invitation key, wanted role (open rooms). |
| `ownerKey` | from storage | The owner key, to come back as owner from another device. |
| `on` | – | Handlers registered before connecting, e.g. `{ host: fn }`. |
| `identity` | `'tab'` | Who a browser is. `'tab'`: a reload keeps the seat and two tabs are two participants, but a link opened again in a new tab is a new participant (the old seat is held for the grace period). `'device'`: all tabs of the browser are one participant, and a second tab replaces the first. |
| `slot` | – | A separate identity in the same browser, e.g. `'screen'` for a big-screen window. |
| `hostSilentMs` | off | Host-run games: report the host to the room when it has sent nothing for this long during play. Set it only if the host sends continuously. |
| `connectTimeoutMs` | 15 s | The first connect must succeed within this. |
| `giveUpMs` | 30 min | Stop reconnecting after failing this long (`closed` with reason `'unreachable'`). |
| `maxQueueAgeMs` | 60 s | Game messages older than this are not resent after a reconnect. |
| `aloneSnapshotMs` | 5 min | A host alone in the room stores snapshots this seldom. |
| `autoHostReady` | `true` | Confirm hosting when the `host` handlers have run. Set `false` to call `hostReady()` yourself after loading asynchronously. |
| `basePath`, `storage`, `heartbeatMs`, … | | See the constructor in `client/room.js`. |

Identities and owner keys are stored per game server, so games on the same site do not share them.

### Events (`room.on(type, fn)` returns an unsubscribe function)

| Event | Detail |
| --- | --- |
| `status` | `'connecting'`, `'online'`, `'reconnecting'`, `'offline'`, `'closed'` |
| `welcome` | the room, each time the connection is (re)established |
| `room` | the room changed: `phase`, `round`, `seed` (host-run), `startsAt`, `paused`, `ownerId`, `hostId`, `settings`, `roles`, `places`, `placeSizes`, `data`, `players` (and `keys` for the owner) |
| `message` | `{ from, data }` (host-run: from participants to the host, from the host to the others; server-run: `from` is `null`) |
| `host` | `{ snapshot }` this browser runs the game now: continue from `snapshot`, or start fresh when it is `null`. Also sent to the creator at the start and to a host whose page reloaded. `room.isHost` is already true. |
| `role` | `{ isHost, isOwner }` when either changes for this client |
| `peer` | `{ event, id, player, why }` with `event` = `join`, `waiting`, `drop`, `back`, `gone`, `host` or `owner`. `back` is sent on every reconnect, also a silent one. |
| `error` | `{ code, command }` a refused command: `place-taken`, `owner-only`, `host-only`, `not-allowed`, `too-large`, … |
| `ok` | `{ command, n }` a command was carried out |
| `closed` | `{ code, reason, text }` the room is over for this client (no more reconnecting) |

### Methods and properties

- `send(data, { to, reliable })`. `to`: `'all'` (default: everyone else who is admitted), `[ids]`, `{ role }` or `{ place }`. The sender never gets its own message. Messages are numbered and resent after a reconnect, and the room counts each once. `reliable: false` is for data the next message replaces anyway (positions). Returns `false` when nothing was sent: nobody is there to get it (a host alone in the room, or the host is away), this participant may not send (a role that does not send, or still waiting), or it is too large.
- **Pace:** the client stays under the room's `maxMessagesPerSecond` by itself. Sent faster than that, reliable messages are held back and delivered in order, and `reliable: false` ones are dropped. After a reconnect, queued game messages up to `maxQueueAgeMs` old and all queued commands are resent, at the same pace.
- `sendSnapshot(data, { force })` (host): give the room the full state to keep.
- `takePlace(name)`, `leavePlace()`, `pause()`, `resume()`.
- Host or owner: `start()`, `cancelStart()`, `end()`, `admitWaiting()`, `assignPlace(id, name | null)`, `setData(data)`, `handover(id, snapshot)`.
- Owner: `kick(id, { ban })`, `renewKey(role, { ttlMs })`, `setSettings({ access, lateJoin })`, `giveOwnership(id)`, `close()`. A ban also renews every invitation key and makes the room private, because otherwise the same link would let the person back in from a new tab.
- `leave(snapshot)`: leave on purpose (while disconnected it keeps trying for ten seconds to tell the room). `disconnect()`: stop without leaving (the seat is kept for the grace period). `reportHostSilent()`. A `NetworkRoom` that has closed or disconnected is finished: make a new one to join again.
- `me`, `self`, `role`, `players`, `player(id)`, `othersOnline`, `room`, `status`, `ready`, `isHost`, `isOwner`, `phase`, `running` (playing and not paused), `serverNow()`, `inviteKeys`, `ownerKey`.

## 5. Host-run games

The host's browser steps the game; everyone else sends inputs and draws what the host sends. Only messages *into* the server count against the daily budget, so:

- Participants send inputs **only when they change**.
- The host sends the moving part of the state often with `reliable: false`, things that must arrive with the default, and `sendSnapshot(state)` every few seconds.
- On `host`: load the snapshot (or start fresh) and begin stepping. On `role` with `isHost: false`: stop.
- On `peer` `join` or `back` (host): send that participant what it needs to see, `send({ type: 'full', ... }, { to: [id] })`. **Never rely on the snapshot for this**: it is not sent to them.
- On `peer` `host`, and on `peer` `back` for the host's id (others): send the current input again. A new host does not know which keys are held, and inputs sent while the host was away were dropped.
- Step the game only while `room.running`.
- The client sends nothing while the host is alone in the room.

`examples/demo/public/app.js` is a complete small game of this kind. For a game led by someone who does not play (a quiz), use `ownerRole` with a non-playing role and leave `takeover` off: see the quiz in `examples/demo/options.js` and its test in `tests/integration/rooms.test.mjs`.

## 6. Server-run games

Rules are an object of hooks. They may be `async`, but another message can be handled while a hook waits for something outside the room, so keep them short.

```js
export const rules = {
  init(room) { return { /* initial room.game */ }; },
  onStart(room) {},                  // after start(): room.seed (secret), room.round
  onCancel(room) {}, onEnd(room) {},
  onJoin(room, participant) {},      // admitted, any role (also late joiners)
  onBack(room, participant) {},      // reconnected: send them what they need to see
  onDrop(room, participant) {}, onGone(room, participant) {},
  onMessage(room, participant, data) {},   // only from roles that send
  onTimer(room, name) {},            // after room.setTimer(name, ms)
};
```

`room` offers `code`, `phase`, `round`, `seed`, `ownerId`, `players`, `env` (the Worker's bindings), `now()`, `game` (the game's state), `data` (the shared room data), `send(to, data)`, `end()`, `admit()`, `setTimer(name, ms)`, `clearTimer(name)`.

**Storing:** the room writes to storage only when the rules assign `room.game = ...` or call `room.save()` after changing it in place. A hook that changes nothing costs no write.

The seed is not sent to clients in server-run rooms, so rules can shuffle hidden things from it. See `examples/demo/memory-rules.js`.

## 7. Close codes

| Code | Meaning |
| --- | --- |
| 4000 | The room has closed (`reason`: `owner-left`, `closed-by-owner`, `host-away`, `expired`). |
| 4001 | Removed by the owner. |
| 4002 | Banned. |
| 4003 | The same participant opened the room in another tab. |
| 4004 | Room not found. |
| 4005 | The room is full. |
| 4006 | The game has already started (late join off). |
| 4007 | Invitation key needed, invalid or expired (`reason`: `key-required`, `key-invalid`, `key-expired`). |
| 4008 | The game is closed right now (gate). |
| 4009 | Client and server are different network-kit versions: reload. |
| 4010 | Bad request (a connection that did not introduce itself properly). |
| 4011 | You left the room. |
| 4012 | Too many messages from this connection (final: the page must be reloaded; the kit's client does not get here by itself). |
| 4013 | The room has used up its messages for today. |
| 4014 | Not final: the room gave up on a connection that stopped answering; the client reconnects. |

`CLOSE_TEXT` has a plain sentence for each final code.

## 8. Cost and limits

The Workers Free plan has daily limits shared by every game on the account. The figures the kit was designed around (about 100,000 requests and 13,000 GB-s of Durable Object time a day, incoming WebSocket messages counted 20 to 1, heartbeats answered for free) **have not been verified against Cloudflare's own pages** (network-kit D-011); check the account's usage page before relying on them.

What the kit does to stay cheap: rooms sleep between messages; relayed messages and commands that change nothing cause no storage writes; snapshots are written at most every few seconds; a host alone in a room sends nothing; a client that cannot reach the server slows down and gives up; each connection has a message pace, and each room a daily cap on messages and on busy minutes.

What a game should do: send inputs on change only, choose the host's send rate deliberately (it decides how many hours of play a day the free plan gives), and set `maxMessagesPerDay` to what a long session of the game really needs.

## 9. Privacy

A room stores: nicknames; a hash of each participant's random identity key (never the key itself), also for the last 100 who left, and for those banned; room settings, invitation keys and the owner key; the latest snapshot from the host (host-run) or the game state (server-run); the room data; today's message count. A room is deleted 24 hours after the last participant left and one hour after it was closed. Cloudflare processes participants' IP addresses to deliver the connection. Each game's privacy notice should say so.
