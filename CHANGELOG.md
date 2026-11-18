# Changelog

network-kit uses version numbers MAJOR.MINOR.PATCH (D-009, D-021):

- **PATCH**: bug fixes only; never needs changes in a game. Games get them as update proposals on a branch.
- **MINOR**: new features. While the kit is 0.x a MINOR may also need changes in a game; the entry then has an upgrade guide. From 1.0 on, code written for the same MAJOR keeps working.
- **MAJOR**: games must adapt; each entry says how.

Each version says who is affected. From 1.0 on, functions on their way out are marked *deprecated* for at least one MINOR version before they are removed.

## Unreleased

## 0.11.1 (2026-11-18)

Affects: the admin page only; games need no change.

- Fixed (B-069): room requests are counted as Cloudflare counts them against the free limit: 20 incoming WebSocket messages count as one request; connections, alarms and other calls count fully. Messages to hibernating rooms are found by their kind of call (`hibernation`), because Cloudflare reports their message count as 0. Before, every message counted fully, so a game's share looked up to 20 times fuller than it was, and Cloudflare limiting and its warnings (F-004, F-065) would have acted far too early. The page shows what today's room requests are made of.

## 0.11.0 (2026-11-18)

Affects: the admin page and games connected to it (owner's decisions 2026-11-18); games need no change.

- New (F-067): a timer per game and per mode: *on until* a time, then *No new players* (default) or an emergency stop for that game or mode. Players are warned ten minutes before and told when it has ended (notices, F-066).
- New (F-068): game links. The admin links become game links that anyone may use, valid from an hour to 90 days (7 days unless chosen), with Copy and revoking. Invitations from a room made with a valid game link get past *No new players*; a room code alone does not.
- Changed: *Off* is called *No new players*, automatic closing *Cloudflare limiting*; the emergency stop is a button. The closed text for `off` reads "The game is not taking new players right now."
- Removed: *Off until a time* (an old setting still in the future becomes No new players) and *Private only* (the admin page's status no longer has `privateOnly`; with six-character codes and per-address limits it added little).

### Upgrade guide from 0.10

- Nothing to change. A game that read `privateOnly` or the reason `until` from the status can drop that code.

## 0.10.0 (2026-11-18)

Affects: games connected to the admin page; nothing has to change, but a game shows notices only once it calls `watchNotices` (asked by the owner).

- New (F-066): notices from the admin page to every page of a game. `watchNotices(server, { mode })` shows each new notice in a box with a strong background at the top of the screen and plays a warning sound, until the player presses OK; once per browser. Also `NoticeBoard`, `playWarningSound`, `noticeText` and `NOTICE_TEXT`; `NetworkRoom.status()` and `GET <basePath>/status` return `notices`. The admin page can send its own messages to one game or all games.
- New (F-065): when Cloudflare limiting is on, players are warned when their game has used 90 % of its share of the day (Paid plan: 90 % of the monthly cap), and told when it has closed for the day.
- The demo shows notices, and `/notices.html` previews every kind with its sound.

## 0.9.0 (2026-11-18)

Affects: games connected to the admin page; nothing has to change. For Bricks' move (asked by the Bricks session).

- New (F-057): modes per game on the admin page (their own On / Off / Until under the game; a mode only closes more than the game), the `admin` option's `mode` for the rooms, and `NetworkRoom.status(server, { mode })` / `GET <basePath>/status?mode=…`, answered without waking a room, for a mode played alone in the browser. The admin page can add a game or a mode.
- New (F-058): admin links. The admin page makes a personal link per game for the owner's devices (30 days, revocable); with it the browser creates, joins and starts games while the game is off or over its budget, not after an emergency stop. The client takes the link from the address bar into storage (`adminPass`, `forgetAdminPass`).

## 0.8.0 (2026-11-18)

Affects: games that do not set `codeLength` (the owner's decision 2026-11-18).

- Changed: room codes have 6 characters by default (about a billion codes, against a million with 4), so guessing a code to an open room is pointless. A game that wants another length sets `codeLength` (4 to 12).

### Upgrade guide from 0.7

- Nothing to change, unless the game wants to keep 4 characters: then add `codeLength: 4` to the room options. Rooms made before the update with codes of the old length cannot be reached after it (rooms last at most a day after the last player leaves).
- Code fields in the game page should fit 6 characters (or ask `GET /rooms` for `codeLength`).

## 0.7.0 (2026-11-18)

Affects: every game may take it in; nothing has to change in a game. A game that wants the admin page's on/off, budget and measuring adds a service binding and the `admin` option (`docs/ADMIN.md`).

- New (F-052): client option `measure` sends anonymous connection-quality summaries; the game's Worker cleans them and hands them to the admin page, which shows them per game and keeps them 7 days. `MEASURE_NOTICE` is exported. The demo measures and shows the notice.
- New (F-003, F-004, F-008, F-026): server option `admin` connects a game to the admin page over a service binding. The admin page switches each game on, off, or off until a time, can allow private rooms only, has an emergency stop, gives each game a share of the daily free quota (equal by default) and can close a game for the day when it passes its share (off until the owner turns it on); on the Paid plan it shows the month's estimated cost and closes games at a monthly cap. Off refuses new rooms, newcomers and new rounds; admitted participants come back; a stop closes running rooms. Players get the reason in plain words (`gameClosedText`). The demo is connected and logs a tenth of its requests.
- New (F-053): server option `limits` (default 10 room creations and 60 look-ups or joins per visitor and minute), checked before a room is woken, so guessing codes or creating rooms in bulk cannot find open rooms or use up the free quota. The demo turns it off in local test runs (`ROOM_LIMITS=off`).
- Docs (D-056): the security model (what codes, keys, bans and the room protect, and what they do not) in `docs/INTEGRATION.md`.
- Admin page and demo (F-054, B-055): security headers (a content security policy without inline scripts, no framing, no referrer); the admin page's record of wrong passwords per address is deleted a day after the last one.

### Upgrade guide from 0.6

- Take the client and the server part together (as always). Nothing has to change.
- New default: `limits` (10 room creations and 60 look-ups or joins per visitor and minute). Local test runs where every request comes from one address may need `limits: null` (the demo uses an environment variable).
- To connect the game to the admin page: the service binding and `admin: { binding, game }`; for measuring, `measure: true` in the client and a visible notice.

## 0.6.0 (2026-11-18)

Affects: every game may take it in; nothing has to change in a game. New features for Vättigt (F-039, F-040), Bricks (F-029, F-030), Buzzy (F-030, F-031) and every game (F-051, F-032).

- New (F-031): the owner's `room.bans` lists who was banned (name, time) and `unban(id)` lifts a ban. For Buzzy.
- New (F-032): room option `idleCloseMs` (60 min): a room whose connected pages have all been in the background that long closes with reason `idle`. Clients report when their page is hidden.
- CI (F-032): the version check (`scripts/version-check.mjs`, warns when `src/` changed without a new version), a lint of the workflows and the games' update template, and a game's vendored copy running the shipped smoke test.
- New (F-029): `createRoom(env, { settings })` on the room server makes a room from the game's own server code (an invitation two people open); the first participant who may lead becomes owner and host. For Bricks.
- New (F-030): `setWelcomeState(data, { role })` (host) and `room.setWelcomeState` (rules): a state the room keeps and sends to everyone who joins or comes back, shared or per role; event `welcome-state`. For Bricks and Buzzy.
- New (F-039): role option `sendsTo: 'all'` lets a participant in a host-run room send like the host (everyone, a list, a role or a place), also while the host is away. Default unchanged (`'host'`). Asked by Vättigt.
- New (F-040): `setSuccessors([ids])` lets the host name who takes over first (e.g. the player whose turn it is); one who does not answer is passed over. Asked by Vättigt.
- New (D-046): `GET /rooms/<code>` (and `NetworkRoom.info`) includes `where`, the Cloudflare data centre the room runs in.
- New (F-051): room option `heartbeatMs`. Clients send their free heartbeat that often, and a participant silent for 2.5 heartbeats is treated as dropped, so a phone that loses its network is noticed in about 5 s (2 s heartbeat) instead of a minute. `CLOSE_UNRESPONSIVE` is exported by the client. The demo's crew game uses 2 s.
- Demo: a new host continues from the newest positions it has (B-049) and the game steps by the clock (B-050); the guide says games should do both. The kit itself is unchanged.
- Demo: ships without inertia and a response-time meter, to judge how fast the game answers (F-045). The kit itself is unchanged.
- Demo: "Instant own ship" moves a player's own ship at once and corrects it towards the host (F-048), and "Send report" sends the device's measurements for the agent to read (F-047). The kit itself is unchanged.

### Upgrade guide from 0.5

- Take the client and the server part together (as always). Nothing in a game has to change.
- New default: a room whose connected pages have all been in the background for an hour closes with reason `idle` (`idleCloseMs`, set `null` to turn it off).
- Recommended: set `heartbeatMs: 2000` in the room options, so a phone that loses its network is noticed in about 5 s; turn-based games may use `sendsTo: 'all'` and `setSuccessors`.

## 0.5.1 (2026-11-17)

Affects: every game; take it in (bug fixes only, nothing to change in a game). Found in the owner's phone and iPad test (D-025).

- Fixed: the others heard that someone joined before they got the room's new list, so a game could not show the name yet ("Someone joined"). The list now comes first, and every `peer` event carries the participant's `name` (B-043).
- Fixed: someone away longer than the grace period came back without their place. They now get it back if nobody has taken it, and their `join` has `returning: true` (B-044).
- Demo: the others' ships glide between positions instead of jumping 15 times a second (B-042); the steering letters can be typed in the name field (B-041).
- Admin page (F-008, first part): a separate Worker that shows usage per game against Cloudflare's free limits, with password sign-in (`docs/ADMIN.md`).

## 0.5.0 (2026-11-17)

Affects: games with large states or fast-changing values (Critical ST8 first). Nothing to change in a game that keeps its current code (F-036, F-037).

- New: large messages and snapshots travel in parts and the room stores the snapshot in parts, so a game state of a few hundred kilobytes can be sent to a joiner and kept for a change of host. Default limits raised to 256 kB per message and 1 MB per snapshot. The client takes the room's limits at the welcome.
- New: `send(data, { latest: kind })` sends only the newest value of each kind when values come faster than the pace allows, also after a reconnect. The demo sends its positions this way.
- Wire protocol 3: client and server must both be 0.5. Snapshots stored by 0.4 are still read.

### Upgrade guide from 0.4

- Take the client and the server part together (as always); a page left open from before is asked to reload.
- Optional: send positions, aims and the like with `latest` instead of `reliable: false`; with a large state, raise `snapshotSaveMs` (see *Large states* in the guide).

## 0.4.0 (2026-11-17)

Affects: games that do not set `codeLength` (new rooms get four-character codes). Owner's decision (F-035).

- Changed: room codes have 4 characters by default instead of 5.
- Fixed: joining with a code of the wrong length now says "Room not found" at once; before, the client tried until it timed out.

### Upgrade guide from 0.3

- To keep five-character codes, add `codeLength: 5` to the game's room options.
- Otherwise: rooms made before the update have five-character codes, which the updated server refuses as "Room not found". Deploy when no rooms are in use, or set `codeLength: 5` for a day first. Make sure the game's code field accepts four characters.
- Four characters are easier to guess in open rooms (about 1 million codes); see *Room codes* in the guide for when to make rooms private.

## 0.3.0 (2026-11-17)

Affects: nobody has to change anything (the default stays 5 characters). Games that want another code length set one option. Needed by Bricks and Buzzy, which use four-character codes today (F-035).

- New: `codeLength`, the number of characters in a game's room codes, 4 to 12 (default 5). Codes of another length are refused without waking a room. `GET /rooms` reports the length; the client exports `isValidCode(code, length)`, `CODE_MIN_LENGTH` and `CODE_MAX_LENGTH`. Share links read codes of any allowed length. The guide explains how much easier short codes are to guess, and when to make rooms private.
- Demo: the quiz uses four-character codes, the memory game six.

### Upgrade guide from 0.2

Nothing to change. To use another code length, add `codeLength: 4` (or 6, 8, ...) to the game's room options, and make the game's code field long enough.

## 0.2.3 (2026-11-16)

Affects: games with `takeover: true` (Critical ST8 will be one); a bug fix, no change needed in games (take 0.2.3). Found in the owner's phone test (B-034).

- Fixed: with takeover on, the host role moved to another participant in the lobby when the host's phone switched app for a few seconds (phones close a background tab's connection quickly), and stayed there when the owner came back. Now a lost host is only replaced while a game is in progress (countdown or playing, also paused); in the lobby and between rounds the room waits. A host gone for good (past the grace period) is still replaced, so the others can start. An owner who comes back while no game is in progress gets the host role back, with the kept state. Starting a round while the host is away starts the wait for a takeover.
- Demo: the owner is told to press Start instead of to wait for the host.
- The shipped smoke test starts a game before it checks the takeover.

## 0.2.2 (2026-11-15)

Affects: every game using the default `identity: 'tab'`; a bug fix, no change needed in games (take 0.2.2). Found in the owner's first phone test (B-033).

- Fixed: a tab opened from another tab of the same browser (a link opened in a new tab, a duplicated tab) became the same participant as the first tab, because browsers copy the tab's session storage; it took the first tab's seat (for the owner: the room and the host role) and closed the first tab. Such a copy is now recognised and gets an identity of its own, so it joins as a new participant. A reload still keeps the seat. Recognising copies needs the browser's Web Locks or BroadcastChannel (all current browsers).
- New: `tabSession()` tells a game whether the current tab is such a copy, for per-tab state it keeps itself in session storage.
- Demo: a copied tab no longer rejoins the first tab's room by itself, and someone arriving by an invitation link lands in the name field.

## 0.2.1 (2026-11-15)

Affects: nobody yet (take 0.2.1 rather than 0.2.0). No change to the room server or the client.

- Fixed: the smoke test that ships with every copy (`smoke.mjs`) could time out in its takeover step on a busy machine, because the test moved its clock before the room had handled the host's disconnect. A failing smoke test now also prints the state of the room.

## 0.2.0 (2026-11-15)

Hardening after the independent review of v0.1.0 and the shape games will build on (runs A and B: B-014 to B-017, F-018, B-020, B-022, F-024, B-027, D-012, D-019, F-013, F-010, D-023, D-021). Affects: nobody (no game had taken v0.1.0 in). **v0.1.0 should not be used.**

### New and changed

- **Owner and host are separate (D-019).** The room's creator is the owner: kick and ban, links, settings, closing. Ownership never moves by itself and comes back with the owner key, also from another device. The host is the browser that runs the game and has none of the owner's rights.
- **Waiting for a lost host is the default (F-013).** No participant can become host and the kept state is never sent to anyone else. A game turns `takeover` on to let another participant continue. Options for closing after a long wait (`closeAfterHostAwayMs`) and for passing ownership on (`passOwnerAfterMs`, `ownerLeave: 'pass'`).
- **Roles are defined by the game (F-013):** seats, whether a role plays, sends, may pause, may host, and whether it needs its own link. The creator may join in a non-playing role (`ownerRole`), e.g. a quiz leader. `player` and `viewer` remain the defaults.
- **Places** replace posts: named spots with a capacity (posts, sides, teams).
- **A silent host is found within seconds (F-010):** clients can report a host that stopped sending (`hostSilentMs`); the room asks it to answer and acts if it does not.
- **Snapshots are private to the host seat.** State for newcomers is sent as normal messages.
- Message targets are `'all'`, `[ids]`, `{ role }` and `{ place }`; the sender never gets its own message.
- Shared room data (`setData`, `room.data`), a countdown that can be called off (`cancelStart`), `room.phase` that reaches `playing` on its own, `room.running`, handlers before connecting (`on`), a separate identity per `slot`, identities stored per game server.
- Server-run rules may be `async`, get `room.env`, and store only when the game changed; the seed is no longer sent to clients in server-run rooms.
- **Limits (F-018):** a message pace per connection that the client keeps by itself, a cap on messages and on busy minutes per room and day, a cap on connections that have not introduced themselves; refused and ignored messages cost the sender, not the room; a client that sends nothing while the host is alone, slows down when the server cannot be reached and gives up in the end.
- **Versions and updates (D-021):** the kit's smoke test ships with every copy (`smoke.mjs`); the update workflow for games proposes a bug fix on a branch after a waiting time and never pushes to a game's main branch; the release workflow checks the version, the changelog and every test, including the demo page in a browser.
- A third example game: a quiz with a non-playing leader.
- Checked by an independent reviewer before release (`docs/reviews/2026-11-15-v0.2.0-check.md`); what it found was fixed first, among it: a long resend after a reconnect no longer trips the rate limit, the owner's second tab no longer takes the room from the first, a new host that does not answer is passed over, and remembered participants lose their standing when a link is renewed or someone is banned.

### Fixed (found in the review)

- A room that had slept handed an older game state to the next host, and counted resent messages twice after a network switch (B-014).
- Someone back after the grace period replayed old messages and commands; a silent reconnect told nobody; a takeover message that hit a dead connection was never repeated; messages queued in one role were delivered in another (B-015).
- The client stayed "offline" after a short blip, and joining never gave up when the server could not be reached (B-016).
- Connections that never introduced themselves were kept, could flood a room and stopped its cleanup for good; an overlong session id left a ghost seat; odd ids such as `__proto__` were accepted (B-017).
- Viewers and waiting participants could pause; an automatic pause could get stuck; someone who had been in the game was refused after the grace period; a ban was bypassed from a new tab (B-020).
- Server-run rooms wrote to storage on every message, and the example's hidden cards could be worked out from the public seed (B-022).

### Upgrade guide from 0.1.0

Wire protocol 2: client and server must both be 0.2.0. Rooms stored by 0.1.0 are discarded.

| 0.1.0 | 0.2.0 |
| --- | --- |
| `limits: { player: 3 }` | `roles: { player: { seats: 3 }, viewer: { seats: 4 } }` |
| `posts: [...]`, `claimPost`, `releasePost`, `assignPost`, `room.posts[name]` (an id) | `places: [...]`, `takePlace`, `leavePlace`, `assignPlace`, `room.places[name]` (a list of ids) |
| takeover always on | `takeover: true` to keep it |
| `hostLeave: 'close' \| 'handover'` | `ownerLeave: 'close' \| 'pass'` |
| `hostKey` | `ownerKey` (never shown in the room state) |
| host-only: kick, renew, settings, close | owner-only; the host keeps start, end, admit, assign, handover |
| `sendSnapshot(data, { to })`, the `snapshot` event | `sendSnapshot(data)` keeps it in the room only; send newcomers a normal message |
| `to: 'others' \| 'players' \| 'viewers'` | `'all'`, `{ role: 'player' }`, `{ role: 'viewer' }` |
| the `host` event only after a takeover | also for the creator at the start and after a host reload: start the game from it |
| `role` event `{ isHost }` | `{ isHost, isOwner }` |
| `info().players`, `.viewers` | `info().participants[role]` |
| rules: synchronous, stored after every hook | may be `async`; stored on `room.game = ...` or `room.save()` |

## 0.1.0 (2026-11-15)

First version (run A: F-001, F-002, F-005, F-006, F-007, D-009). Affects: nobody yet; Critical ST8 is the first game to take it in.

- Room server core on Cloudflare Durable Objects (Workers Free plan, SQLite-backed objects): short room codes, create, info, join, leave, close; rooms sleep between messages (WebSocket hibernation, heartbeats answered without waking the room); rooms are deleted 24 hours after the last player left.
- Seats with limits per role (players and viewers; a viewer never becomes a player), named posts on a shared ship that players claim and switch freely, kick and ban.
- Late join per room: now, at the next safe point (the host admits), or never.
- Host-run rooms (one player's browser runs the game, the server relays) and server-run rooms (the game's rules run in the room).
- Messages to everyone, to one player or a chosen group; full-state snapshots for players who join or come back.
- Host takeover: when the host's connection is lost, another player continues from the latest snapshot after a short wait; a host whose page reloads gets the snapshot back.
- Pause for everyone, a grace period before a dropped player counts as gone, optional automatic pause, drop/back/gone events.
- Browser client: reconnection on network change, tab return and coming back online, growing retry delay, heartbeat; duplicate protection for messages resent after a glitch.
- Share links with a key per role (player, viewer) after `#`, private rooms, renewable keys with optional expiry, QR codes (vendored qrcode-generator 1.4.4, MIT).
- Versions and updates: tagged releases, `scripts/vendor.mjs` for the game's own copy, and `templates/update-network-kit.yml` for automatic bug-fix update proposals in games.
- Example games and tests: a host-run demo page and a server-run memory game.
