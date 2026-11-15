# Changelog

network-kit uses version numbers MAJOR.MINOR.PATCH (D-009, D-021):

- **PATCH**: bug fixes only; never needs changes in a game. Games get them as update proposals on a branch.
- **MINOR**: new features. While the kit is 0.x a MINOR may also need changes in a game; the entry then has an upgrade guide. From 1.0 on, code written for the same MAJOR keeps working.
- **MAJOR**: games must adapt; each entry says how.

Each version says who is affected. From 1.0 on, functions on their way out are marked *deprecated* for at least one MINOR version before they are removed.

## Unreleased

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
