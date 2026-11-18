# Using network-kit in a game

network-kit has two parts, both plain JavaScript without a build step or dependencies:

- `client/`: the browser side (`NetworkRoom`, share links, QR codes).
- `server/`: the room server for the game's own Cloudflare Worker (`createRoomServer`).

Each game keeps its own copy of a fixed version, so a change in network-kit never reaches a game before the game takes it in. This guide describes **v0.13** (0.13.0).

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

**Rooms made by the game's server (from 0.6, F-029):** `rooms.createRoom(env, { settings })` creates a room from the game's own Worker code, for example for an invitation two people open. Nobody in it created it: the first participant who enters in a role that may lead becomes owner and host. It returns `{ code, keys }` (no owner key); put the code and a role's key in the invitation. The demo's `POST /invite` shows it.

Deploy with `npx wrangler deploy` from a GitHub Actions workflow using a `CLOUDFLARE_API_TOKEN` secret (see network-kit's `.github/workflows/deploy-demo.yml`). Local runs: `npx wrangler dev --var ROOM_JURISDICTION:` (local workerd has no jurisdictions).

**The game's own pages from the same Worker:** a game can serve its pages (HTML, scripts, images, its copy of the client) from the same Worker as its rooms, so the game loads nothing from another site and needs no CORS settings. Add the folder to the wrangler config:

```jsonc
  "assets": { "directory": "public" }   // the game's pages; put the client copy under public/ too
```

Files in the folder are served as they are; requests under `basePath` that match no file reach the room server. The page then uses its own address as the server: `NetworkRoom.create(location.origin, ...)`. Deploying the Worker deploys pages and room server together, so they are always the same version. network-kit's demo is set up this way (`wrangler.jsonc`, `examples/demo/public/`).

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
| `graceMs` | 60 s | How long a dropped participant keeps the seat and place. Someone who comes back later is the same participant again (`returning`), and gets the place back if nobody has taken it (from 0.5.1). |
| `autoPauseMs` | off | Pause the room when a playing participant has been away this long; lifted when they are back or gone. |
| `takeover` | `false` | Host-run rooms: may another participant continue a lost host's game? Only while a game is in progress (countdown or playing); in the lobby and between rounds the room waits, unless the host is gone past the grace period. Off: the room always waits for the host. |
| `takeoverMs` | 5 s | With takeover: how long to wait for the host first. |
| `hostCheckMs` | 3 s | How long a host has to answer when others report it silent. |
| `idleCloseMs` | 60 min | Close the room when every connected page has been in the background this long (forgotten tabs); `null` never. Clients tell the room when their page is hidden (from 0.6, F-032). |
| `heartbeatMs` | off | Clients send a free heartbeat this often (the platform answers it without waking the room); anyone, host or player, who has sent nothing for 2.5 heartbeats is treated as dropped, so a phone that loses its network is noticed in seconds instead of a minute or more. 2 s gives about 5 s. The room looks while messages arrive and when a timer fires, so in a quiet lobby it can take longer (from 0.6, F-051). |
| `rttProbeMs` | off | Server-run rules: measure each participant's response time this often (the room asks the page when the participant's own messages arrive, so a quiet participant is not asked); the rules see it as `participant.rttMs` (from 0.13, F-076). 10 s is plenty. |
| `closeAfterHostAwayMs` | off | Without takeover: close the room after waiting this long for its host. |
| `passOwnerAfterMs` | off | Ownership passes on (to the host, else whoever has been in the room longest) when the owner has been away this long. |
| `ownerLeave` | `'close'` | The owner leaving on purpose `'close'`s the room or `'pass'`es ownership on. |
| `countdownMs` | 3 s | Time from start to play (0: none). |
| `cleanupMs` | 24 h | Delete the room this long after the last participant left. |
| `closedKeepMs` | 1 h | How long a closed room still answers "closed". |
| `snapshotSaveMs` | 5 s | The host's snapshot is written to storage at most this often (and when the host drops, pauses, leaves or hands over). |
| `maxMessageBytes` / `maxSnapshotBytes` / `maxDataBytes` | 256 kB / 1 MB / 4 kB | Larger ones are refused. Messages and snapshots above 16,000 characters travel and are stored in parts, without the game noticing (*Large states* in section 5). |
| `maxMessagesPerSecond` | 40 | Per connection; short bursts of twice this are fine. Faster connections are closed (4012, final). Refused and ignored messages cost the sender several times as much, and nothing of the room's budget. The kit's client keeps under the pace by itself. 0: no limit. |
| `maxMessagesPerDay` | 600,000 | Per room and UTC day; the room closes (4013) when it is used up. 0: no limit. |
| `maxActiveMinutesPerDay` | 720 | Per room and UTC day: minutes in which messages arrived. Stops a forgotten room that trickles messages from staying awake all day. 0: no limit. |
| `maxPendingSockets` | 8 | Connections that have not introduced themselves yet. |
| `nameMaxLength` | 24 | Nicknames are trimmed to this. |
| `codeLength` | 6 | Characters in this game's room codes, 4 to 12 (the default was 4 before 0.8). See *Room codes* below. |
| `binding` | `'ROOMS'` | Durable Object binding name. |
| `basePath` | `'/rooms'` | URL prefix of the room API. |
| `allowedOrigins` | `'*'` | Pages allowed to use the API (the game's site). |
| `jurisdiction` | `null` | `'eu'` keeps rooms in the EU; may be a function `(env) => 'eu' \| null`. |
| `limits` | 10 creations, 60 tries a minute | Per visitor address, checked before a room is woken: `{ createsPerMinute, attemptsPerMinute }` (attempts are look-ups and joins at a room code). Over the limit a visitor gets 429 or close code `RATE` for the rest of the minute. Counted per Worker instance, which is enough to make guessing codes or creating rooms in bulk pointless; `null` turns it off; may be a function of `env` (from 0.7, F-053). |
| `admin` | – | Connects the game to the admin page (from 0.7, F-003, F-004): `{ binding, game, mode }` (`mode`, from 0.9: the rooms' mode for a game with several, F-057), a service binding to the admin Worker's `GameApi` entrypoint and the game's name; may be a function of `env`. New rooms, newcomers and new rounds are refused while the game is off or over its budget; participants already in a room come back; an emergency stop closes running rooms. See `docs/ADMIN.md`. |
| `lobbyRole` | `'player'` | The role a lobby's guest link joins in (lobbies made on the admin page, from 0.13, F-059). |
| `gate` | – | **Experimental**, replaced by `admin` for on/off (F-003): `async ({ request, env, action }) => true \| { open: false, reason }`, checked before a room is created or a connection is opened. |
| `fallback` | – | `async (request, env, ctx) => Response` for other paths. |

### Room codes

A room code is made of 32 easy-to-read characters (no 0, O, 1 or I). Each game chooses the length with `codeLength`, 4 to 12; the default is 6 (owner's decision 2026-11-18; a game that wants 4 sets `codeLength: 4`). Typed codes may contain spaces or dashes (`abcd-efgh` is read as `ABCDEFGH`). `GET /rooms` tells the game page the length (`{ codeLength }`), for example for the size of a code field; `isValidCode(code, length)` and `CODE_MIN_LENGTH` / `CODE_MAX_LENGTH` are exported by the client.

A shorter code is easier to read out and type, and easier to guess:

| Length | Possible codes |
| --- | --- |
| 4 | about 1 million |
| 5 | about 34 million |
| 6 | about 1 billion |
| 8 | about 1 million million |

In an **open** room the code is all a stranger needs. With 4 characters and 10 open rooms at a time, someone trying one code a second would find a room in about a day; with 6 characters (the default from 0.8) it would take about three years, and the per-visitor limits (`limits`) slow such a visitor to 60 tries a minute. Where that matters, make rooms private (`access: 'private'`): then only the invitation link, which carries a long key whatever the code length, lets people in. Changing the length only affects new rooms; codes of another length are refused without waking a room.

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
| `sendsTo` | `'host'` | Host-run rooms: `'all'` lets this role send like the host (to everyone, a list, a role or a place), so a turn's inputs cross the room once and keep flowing while the host is away. Messages still need `sends` (from 0.6, F-039). |

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
  - Phones close the connection of a tab in the background within seconds, so during a game a host who switches app for longer than `takeoverMs` hands the game over. Raise `takeoverMs` if that is too eager for the game.
  - An owner who comes back while no game is in progress gets the host role back, with the kept state; during a game, the game stays where it runs.
  - A host that looks connected but has gone silent (a phone asleep) is found when others report it (`hostSilentMs` on the client): the room asks it to answer within `hostCheckMs`. With `heartbeatMs` the room finds any silent participant by itself (F-051).
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
import { NetworkRoom, shareLink, readShareLink, forgetShareKey, qrSvg, watchNotices }
  from './vendor/network-kit/client/index.js';

const SERVER = 'https://my-game-rooms.example.workers.dev';
watchNotices(SERVER);                                         // the admin page's notices (F-066)

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
| `identity` | `'tab'` | Who a browser is. `'tab'`: a reload keeps the seat and two tabs are two participants, also a tab the browser copied from another (a link opened in a new tab, a duplicated tab). A link opened again in a new tab after the old one was closed is a new participant too (the old seat is held for the grace period). `'device'`: all tabs of the browser are one participant, and a second tab replaces the first. |
| `slot` | – | A separate identity in the same browser, e.g. `'screen'` for a big-screen window. |
| `measure` | `false` | Send anonymous connection-quality summaries (response time to the room, how evenly the host's messages arrive, breaks, host changes, frame rate, kind of device and browser family; no names, ids or addresses) every 5 minutes and when the player leaves. The game's Worker hands them to the admin page (needs the `admin` option), which keeps them 7 days. Show `MEASURE_NOTICE` ("Connection quality is measured anonymously to improve the game.") or your own translation of it where the game starts (from 0.7, F-052). |
| `hostSilentMs` | off | Host-run games: report the host to the room when it has sent nothing for this long during play. Set it only if the host sends continuously. |
| `connectTimeoutMs` | 15 s | The first connect must succeed within this. |
| `giveUpMs` | 30 min | Stop reconnecting after failing this long (`closed` with reason `'unreachable'`). |
| `maxQueueAgeMs` | 60 s | Game messages older than this are not resent after a reconnect. |
| `aloneSnapshotMs` | 5 min | A host alone in the room stores snapshots this seldom. |
| `autoHostReady` | `true` | Confirm hosting when the `host` handlers have run. Set `false` to call `hostReady()` yourself after loading asynchronously. |
| `basePath`, `storage`, `heartbeatMs`, … | | See the constructor in `client/room.js`. |

Identities and owner keys are stored per game server, so games on the same site do not share them.

**Per-tab state of your own:** browsers copy a tab's `sessionStorage` into a tab opened from it. If the game keeps per-tab state there (for example "the room this tab is in", to rejoin after a reload), check `await tabSession()` first: `{ id, copied }`, where `copied` is true in such a copy, whose stored state belongs to the other tab. The demo does this. It needs Web Locks or BroadcastChannel; without either, every tab counts as the original.

### Events (`room.on(type, fn)` returns an unsubscribe function)

| Event | Detail |
| --- | --- |
| `status` | `'connecting'`, `'online'`, `'reconnecting'`, `'offline'`, `'closed'` |
| `welcome` | the room, each time the connection is (re)established |
| `room` | the room changed: `phase`, `round`, `seed` (host-run), `startsAt`, `paused`, `ownerId`, `hostId`, `settings`, `roles`, `places`, `placeSizes`, `data`, `players` (and `keys` for the owner) |
| `message` | `{ from, data, at }` (host-run: from participants to the host, from the host to the others; server-run: `from` is `null`). `at` is when the message reached the room, in server time (compare with `serverNow()`), from 0.13 (F-063): for example to see that a player's game runs slower than real time, or for buzz order and turn timers |
| `host` | `{ snapshot }` this browser runs the game now: continue from `snapshot`, or start fresh when it is `null`. Also sent to the creator at the start and to a host whose page reloaded. `room.isHost` is already true. |
| `welcome-state` | `{ data }` the room's state for newcomers (F-030), right after the welcome, also after a reconnect; also in `room.welcomeState` |
| `role` | `{ isHost, isOwner }` when either changes for this client |
| `peer` | `{ event, id, name, player, why, returning }` with `event` = `join`, `waiting`, `drop`, `back`, `gone`, `host` or `owner`. `back` is sent on every reconnect, also a silent one. The room list already includes the participant when `join` or `back` arrives, and `name` is always given (from 0.5.1). `returning` is true for a `join` by someone who was here before and was away longer than the grace period. |
| `error` | `{ code, command }` a refused command (a refused start because the game is closed: `game-closed`, with `reason`, `until` and `text`): `place-taken`, `owner-only`, `host-only`, `not-allowed`, `too-large`, … |
| `ok` | `{ command, n }` a command was carried out |
| `closed` | `{ code, reason, text }` the room is over for this client (no more reconnecting). For a closed game (`GAME_CLOSED`) `reason` is `off` (no new players), `budget` or `stopped` (`until` only from an admin page older than 0.11) and `text` says so in plain words, with the time it opens again (from 0.7, F-026); `gameClosedText(reason, until)` is exported for games that show their own text. |

### Methods and properties

- `NetworkRoom.status(server, { basePath, mode })` (static, from 0.9, F-057): is the game, or one of its modes, open now? `{ open, reason, until, text, notices }`, asked without waking a room; for a mode played alone in the browser. Open when the admin page cannot be reached.
- **Lobbies (from 0.13, F-059):** the admin page makes a lobby for a game: a room made ahead with a host link and a guest link (`…#nk-lobby=…`). `NetworkRoom.joinLobby(SERVER, { name, …options })` reads the link from the address bar (or `token`), asks the game's Worker (`POST <basePath>/lobby`) and joins the lobby's room: the host link as its owner (and host), the guest link with an invitation key (role `lobbyRole`), waiting for the host. It works while the game takes no new players, not after an emergency stop; the room closes when the lobby ends or is revoked. `room.lobby` is `{ role, ends }`. `readLobbyLink(hash)` tells whether a page was opened from one, `forgetLobbyLink()` takes it out of the address bar (`joinLobby` does when it read it there). Rejects with a `RoomError` whose `reason` is `lobby-ended` or `stopped`.
- **Notices (from 0.10, F-066):** `watchNotices(SERVER, { basePath, mode })` asks the game's status at once, every minute while the page is visible and when it becomes visible again, and shows each new notice from the admin page (Cloudflare limiting soon or reached, a message from the owner, later a timer running out) in a box at the top of the screen with a strong background and a warning sound, until the player presses OK. Each notice is shown once per browser. Start it on every page of the game, also outside rooms (a game played alone in the browser too). Returns `{ stop, check, board }`. The box is made with a constructed style sheet, so it works under a strict Content-Security-Policy; colours can be changed with the CSS variables `--nk-notice-warning-bg`, `--nk-notice-warning-ink`, `--nk-notice-info-bg`, `--nk-notice-info-ink` and `--nk-notice-edge`. `new NoticeBoard().show({ id, level, title, text, until })` shows a game's own notice the same way; `playWarningSound({ level })` plays only the sound (browsers allow sound only after the player has touched the page; until then it waits for the first touch or key). The texts are English (`NOTICE_TEXT`); `{until}` becomes the local time. `NetworkRoom.status()` also returns `notices`. Costs one Worker request a minute per visible page.
- **Game link (admin pass, from 0.9, F-058; from 0.11 for anyone, F-068):** a link from the admin page (`…#nk-admin=…`) lets the browser that opens it create, join and start games while the game takes no new players or is closed by Cloudflare limiting (not after an emergency stop). A room whose owner has a valid game link lets in those who have one of the room's invitation keys too, while the link is valid. The client takes the link from the address bar into storage by itself and sends it with `create`, `join` and `status`; `forgetAdminPass()` removes it from the browser.
- `send(data, { to, reliable })`. `to`: `'all'` (default: everyone else who is admitted), `[ids]`, `{ role }` or `{ place }`. The sender never gets its own message. Messages are numbered and resent after a reconnect, and the room counts each once. `reliable: false` is for data the next message replaces anyway (positions). Returns `false` when nothing was sent: nobody is there to get it (a host alone in the room, or the host is away), this participant may not send (a role that does not send, or still waiting), or it is too large.
- `send(data, { latest: kind })`: for values that change faster than they can be sent, where only the newest counts (an aim, a position, a slider). The client keeps the newest value of each `kind` and sends it as soon as the pace allows, also after a reconnect; older values of the same kind are never sent.
- **Pace:** the client stays under the room's `maxMessagesPerSecond` by itself. Sent faster than that, reliable messages are held back and delivered in order, and `reliable: false` ones are dropped. After a reconnect, queued game messages up to `maxQueueAgeMs` old and all queued commands are resent, at the same pace.
- `sendSnapshot(data, { force })` (host): give the room the full state to keep.
- `setWelcomeState(data, { role })` (host): the state everyone gets right after the welcome when they join or come back, kept by the room so it reaches them even while the host is asleep (from 0.6, F-030). One shared state, or one per role (a big screen can get another view than the players); `null` removes it. Only the newest counts; it is stored at most every `snapshotSaveMs`. Server-run rules use `room.setWelcomeState(data, role)`. Unlike the snapshot it is sent to participants, so it must hold only what they may see.
- `takePlace(name)`, `leavePlace()`, `pause()`, `resume()`.
- Host or owner: `start()`, `cancelStart()`, `end()`, `admitWaiting()`, `assignPlace(id, name | null)`, `setData(data)`, `handover(id, snapshot)`, `setSuccessors([ids])` (who takes over first if the host is lost, e.g. the player whose turn it is; tried before the owner and the longest-present, and passed over if they do not answer; shown as `room.successors`; from 0.6, F-040).
- Owner: `kick(id, { ban })`, `unban(id)` (the owner's `room.bans` lists who was banned, with name and time; a lifted ban still needs a new invitation link, because the links were renewed; from 0.6, F-031), `renewKey(role, { ttlMs })`, `setSettings({ access, lateJoin })`, `giveOwnership(id)`, `close()`. A ban also renews every invitation key and makes the room private, because otherwise the same link would let the person back in from a new tab.
- `leave(snapshot)`: leave on purpose (while disconnected it keeps trying for ten seconds to tell the room). `disconnect()`: stop without leaving (the seat is kept for the grace period). `reportHostSilent()`. A `NetworkRoom` that has closed or disconnected is finished: make a new one to join again.
- `me`, `self`, `role`, `players`, `player(id)`, `othersOnline`, `room`, `status`, `ready`, `isHost`, `isOwner`, `phase`, `running` (playing and not paused), `serverNow()`, `inviteKeys`, `ownerKey`.

## 5. Host-run games

The host's browser steps the game; everyone else sends inputs and draws what the host sends. Only messages *into* the server count against the daily budget, so:

- Participants send inputs **only when they change**.
- The host sends the moving part of the state often with `latest: 'positions'` (only the newest counts), things that must arrive with the default, and `sendSnapshot(state)` every few seconds. Inputs that change very often, like an aim, also go with `latest`.
- On `host`: load the snapshot (or start fresh) and begin stepping. On `role` with `isHost: false`: stop.
- On `peer` `join` or `back` (host): send that participant what it needs to see, `send({ type: 'full', ... }, { to: [id] })`. **Never rely on the snapshot for this**: it is not sent to them.
- Your own moving thing (real-time host-run games): a player who does not run the game waits a round trip (about 110–130 ms measured 2026-11-17, phone on 5G to a tablet on wifi) before the host's positions show their key press. Move the player's own ship at once in their browser and correct it gently towards the host's position when it arrives, so steering feels immediate.
- Taking over (host-run games with takeover): the room's kept state is only as new as the last `sendSnapshot`. A page that becomes host has often seen newer state from the old host's messages; continue from the newest it has, or things jump back (the demo does this on `host`).
- Game speed: step the game by the time that has passed, not once per timer call. Browsers run timers late (Safari on an iPad runs a 33 ms timer about every 36 ms), so a game stepped per call runs slower on some hosts.
- Others' moving things (host-run games): positions arrive in steps (the demo sends 15 a second). Draw them gliding from where they are drawn to the newest position over about one interval, or they look jerky; the host draws its own game directly. The demo shows how (`drawnAt` in `examples/demo/public/app.js`).
- On `peer` `host`, and on `peer` `back` for the host's id (others): send the current input again. A new host does not know which keys are held, and inputs sent while the host was away were dropped.
- Step the game only while `room.running`.
- The client sends nothing while the host is alone in the room.

**Large states.** A game state of a few hundred kilobytes works without any change in the game: the client and the room split anything above 16,000 characters into parts and join them again, and the room stores the host's snapshot in parts too. The limits are `maxMessageBytes` (256 kB) for one message, for example the full state sent to a joiner, and `maxSnapshotBytes` (1 MB) for the kept state; raise them if the game needs more. Each part counts against the connection's pace, so a 200 kB state takes about a third of a second to send. Each stored part is a storage write: with a large state, raise `snapshotSaveMs` (for example to 15 seconds) so a long evening's play does not use up the free plan's daily writes, and keep the state small where it is easy (rebuild what can be rebuilt from the seed).

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
  onMessage(room, participant, data, { at }) {},   // only from roles that send; `at`: when it reached the room (from 0.13, F-063)
  onTimer(room, name) {},            // after room.setTimer(name, ms)
};
```

A `participant` has `id`, `name`, `role`, `place`, `status`, `waiting` and `rttMs`: the median of the last few measured response times to the room (from 0.13, F-076), or `null` until the room option `rttProbeMs` has measured one. The page answers the room's probes by itself; a page could answer late on purpose, so use it with a cap, for example to subtract half of it from a buzz, at most 100 ms.

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

The Workers Free plan has daily limits shared by every game on the account, reset at 00:00 UTC (checked in Cloudflare's documentation 2026-11-17, D-011): 100,000 Worker requests; 100,000 Durable Object requests (incoming WebSocket messages counted 20 to 1, outgoing ones and heartbeats free); 13,000 GB-s of Durable Object time (only while a room is awake; hibernating rooms cost nothing); 5 million rows read and 100,000 rows written; 5 GB stored. Over a limit, further operations of that kind fail until midnight UTC. The admin page (`docs/ADMIN.md`) shows each game's use against these.

What the kit does to stay cheap: rooms sleep between messages; relayed messages and commands that change nothing cause no storage writes; snapshots are written at most every few seconds; a host alone in a room sends nothing; a client that cannot reach the server slows down and gives up; each connection has a message pace, and each room a daily cap on messages and on busy minutes.

What a game should do: send inputs on change only, choose the host's send rate deliberately (it decides how many hours of play a day the free plan gives), and set `maxMessagesPerDay` to what a long session of the game really needs.

## 9. Security model

What protects a room, and what does not (D-056, from the lessons of an external review of Buzzy, `docs/reviews/2026-11-18-buzzy-review-lessons.md`):

- **The room code is not a secret.** It is short so people can type it (6 characters by default, about a billion codes; games may choose 4 to 12). In an `open` room the code alone lets anyone in; per-visitor limits (`limits`) make guessing pointless, but a game where strangers must not get in uses `access: 'private'` and invitation links, whose keys are the secret (one per role).
- **The room enforces, the page does not.** Who may send, start, pause, take a place, host or own is decided in the room; a modified page gets no further than the room allows. Hidden game state belongs in server-run rules (`room.game`) or in the host's snapshot, which is only ever sent to whoever runs the game; `setWelcomeState` and messages reach participants.
- **Identity is per browser.** Each browser keeps a random identity key; there are no accounts. A kick or a ban removes that identity, closes its connection at once, and a ban renews every invitation key and makes the room private, so no old link works. A person with a new browser and a new link is a new participant: a ban is not a ban on the person.
- **Seats and places are freed by the room** after the grace period, on leaving and on a kick; a page cannot keep them.
- **No secrets in pages.** The kit puts no keys in pages; the owner key and invitation keys are per room and only reach the owner. Tokens (Cloudflare) stay in Workers.
- **Data is deleted on a schedule** (see Privacy).
- **Not covered:** proof that a page is the game's own (anything that speaks the protocol can join a room it has the key for); `allowedOrigins` only stops other web pages.

## 10. Privacy

A room stores: nicknames; a hash of each participant's random identity key (never the key itself), also for the last 100 who left, and for those banned; room settings, invitation keys and the owner key; the latest snapshot from the host (host-run) or the game state (server-run); the room data; today's message count. A room is deleted 24 hours after the last participant left and one hour after it was closed. Cloudflare processes participants' IP addresses to deliver the connection. Each game's privacy notice should say so.
