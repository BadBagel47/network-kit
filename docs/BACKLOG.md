# network-kit backlog

## Conventions

- IDs: one running series with prefixes `B-` (bug), `F-` (feature), `D-` (planning/design). New ID = highest ID + 1.
- Priority: High, Medium, Low. Done items move to *Done*; parked items have the status *Parkerad*.
- Moved from the Bricks backlog on 2026-11-15: Bricks F-007 → F-001 to F-005 here. Old IDs remain in Bricks commits; Bricks keeps F-007 for moving its own 2 Players mode here later.

## Open

| ID | Type | Title | Priority | Status | Suggested model |
| --- | --- | --- | --- | --- | --- |
| D-028 | Design | Boomers' recorded decision says its gameplay runs on the room server, but the kit runs no real-time game on the server (free plan): decide in Boomers, recommendation host-run | High | Parkerad 2026-11-18 (owner: wait until Boomers has come further in its development). Needs the owner's decision (in `BadBagel47/boomers`) | – |
| F-059 | Feature | Private invitations made on the admin page: the owner makes an invitation for a game (a room nobody created, with an expiry), sees its room code and link with Copy, a list with Active / Expired / Revoked, and can revoke an active one (closing its room); the invitation works while public play is off | High | Asked by the Bricks session 2026-11-18 (Bricks' admin page does this today); needed when Bricks moves Smaller first step proposed 2026-11-18: rooms created with an admin link let their invited participants in while the game is Off (see details) | Strong, high |
| F-060 | Feature | The best host between rounds: each participant reports its connection quality to the room (response time, how evenly it receives the host's messages, and as host how evenly it sends) about every 10 s; between rounds (lobby, before the countdown) the room hands the game to a participant who has been clearly better for a while; mid-round the host only changes when it fails (as today); the game turns it on; the owner can see each participant's quality | Medium | Owner's question 2026-11-18; the device tests showed the iPad as host sending unevenly while the Pixel sent evenly | Strong, high |
| F-061 | Feature | Optional message validation in host-run rooms: a game-provided hook, e.g. `validate(message, participant, room) => true \| false`, run before the room relays a message (and optionally before it accepts a snapshot or a state for newcomers), so malformed or out-of-range data is dropped in one place instead of in every receiver. Not anti-cheat (a modified page can still send well-formed lies); most useful with many receivers (Buzzy's screens, Critical's crew). Cost: some room CPU per message, not measured | Low | Idea from the Bricks session 2026-11-18; Bricks does not depend on it (it validates in the receiving browser, Bricks F-028) | Standard |
| D-062 | Design | Checking honest play in games with a deterministic simulation: a guide section for peer replay verification (each player sends its inputs with frame numbers; the others replay them from the room's seed and compare the reported board, score and attacks; a mismatch marks the match unverified), and whether the kit should offer a small helper for ordered input logs per frame. Server-run verification (the room runs every game itself) is F-064 | Low | Proposal from the Bricks session 2026-11-18 (owner's request); fits Bricks and Vättigt | Standard |
| F-063 | Feature | Server receive time on relayed messages: the room stamps each relayed message with the time it arrived (`{ from, data, at }` on the `message` event), so a receiver can check a player's frame count against real time (someone slowing their game), and for buzz order (Buzzy) and turn timers (Vättigt). A few bytes per message, no extra messages. (Listed earlier among F-031's small additions.) | Low | Proposal from the Bricks session 2026-11-18 (owner's request) | Standard |
| F-064 | Feature | Server-run verification: the room runs every player's game itself with the game's own deterministic engine, from the inputs, and is the only authority on boards, scores and attacks (the strongest protection against fake results) | Low | Proposal from the Bricks session 2026-11-18; added to the backlog at the owner's request. Advised against for now: it costs room CPU for every input on the free plan and needs the game's engine in the Worker; not against bots or assisted play | Strong, high |

## Done

| ID | Type | Title | Done |
| --- | --- | --- | --- |
| F-001 | Feature | Room server core and browser client | 2026-11-15, v0.1.0 (demo deployed 2026-11-15; faults found in the review, see B-014 to B-017) |
| F-002 | Feature | Secure share links: room code + key per role, QR code | 2026-11-15, v0.1.0 |
| F-005 | Feature | Critical ST8 needs: posts on a shared ship, targeted messages, snapshots for rejoin | 2026-11-15, v0.1.0 (Critical takes it in with its F-040) |
| F-006 | Feature | Host-run rooms with takeover | 2026-11-15, v0.1.0 |
| F-007 | Feature | Room-wide pause and a grace period | 2026-11-15, v0.1.0 |
| D-009 | Design | Versions and updates | 2026-11-15, v0.1.0: release workflow, `scripts/vendor.mjs`, `templates/update-network-kit.yml` |
| F-010 | Feature | Notice a host whose connection died silently (e.g. a phone that went to sleep) within seconds, so takeover does not wait for Cloudflare to close the connection | 2026-11-15, v0.2.0: clients report a silent host, the room checks within seconds |
| D-012 | Design | Check Boomers', Bricks' and Buzzy's needs against the core before they move here, and collect what is missing as general features | 2026-11-15: paper pass done, results under Details; gaps recorded as D-028 to F-031 |
| F-013 | Feature | Game-master host: a host without a player seat (e.g. a quiz host), a choice between takeover and waiting for the host when its connection drops, and roles defined by the game | 2026-11-15, v0.2.0: non-playing owner role, waiting for the host by default, roles defined by the game |
| B-014 | Bug | A sleeping room loses the latest game state and its duplicate protection | 2026-11-15, v0.2.0 (tested with a room that really sleeps in local workerd) |
| B-015 | Bug | Reconnects: old messages replayed after a long absence, host messages lost on a silent reconnect, the takeover message never repeated, queued messages crossing the host/player roles | 2026-11-15, v0.2.0 |
| B-016 | Bug | The client gets stuck "offline" after a short network blip, and joining never gives up when the server cannot be reached | 2026-11-15, v0.2.0 |
| B-017 | Bug | Uninvited connections can flood a room, stop its cleanup for good and create ghost seats; ids are not validated | 2026-11-15, v0.2.0 |
| F-018 | Feature | Limits on what one room can cost: rate cap per connection, daily cap per room, no sending to an empty room, pause when alone | 2026-11-15, v0.2.0: caps per connection and per room and day; a host alone sends nothing |
| D-019 | Design | Separate the room's owner (rights, keys, closing) from the host (the browser that runs the game) | 2026-11-15, v0.2.0 |
| B-020 | Bug | Rights and lockouts: viewers and waiting players can pause, an automatic pause can get stuck, admitted players are locked out after the grace period, a ban is bypassed with a new tab | 2026-11-15, v0.2.0 |
| D-021 | Design | Version policy while the kit is 0.x, and a safer update workflow for games | 2026-11-15, v0.2.0: 0.x policy, smoke test, update proposals on a branch, release checks |
| B-022 | Bug | Server-run rooms: a storage write for every message, and the public seed reveals hidden cards in the example game | 2026-11-15, v0.2.0 |
| D-023 | Design | API details to settle before the first game depends on them (naming of posts, phase, host event, message targets, storage keys) | 2026-11-15, v0.2.0: choices listed under Decisions in `docs/HANDOFF.md` |
| F-024 | Feature | Tests that were missing: client unit tests, a real sleep test, the browser test in CI and before a release | 2026-11-15, v0.2.0: client unit tests, real sleep test, browser test in CI and before a release |
| B-027 | Bug | Documentation disagrees with the code in several places | 2026-11-15, v0.2.0 |
| B-033 | Bug | A new tab opened from a game page in the same browser becomes the same participant (here: the owner and host) and closes the first tab; the demo then also skips the name | 2026-11-15, v0.2.2 (tested in Chromium and on an emulated phone; not yet on the owner's phone) |
| B-034 | Bug | The host role moves to another player in the lobby when the owner's phone switches app for a few seconds, and stays there when the owner is back; the demo then tells the owner to wait for the host although the owner can start | 2026-11-16, v0.2.3 (tested on the fake host, in local workerd and in Chromium; not yet on the owner's phone) |
| F-035 | Feature | Room code length set by the game, 4 to 12 characters | 2026-11-17, v0.3.0; 4 characters by default from v0.4.0; 6 characters by default from v0.8.0 (owner's decisions 2026-11-17 and 2026-11-18) |
| F-036 | Feature | Large states: send a full state to a joiner and keep a snapshot when the game's state is larger than the default limits, by packing (compression) and/or splitting into parts; check Cloudflare's limit on one stored value for the snapshot | 2026-11-17, v0.5.0: split into parts (owner's answer to question A1), messages and stored snapshots; tested in local workerd |
| F-037 | Feature | Values where only the latest counts (an aim that changes 60 times a second): when the client holds back sends to keep the room's pace, keep and send the newest value per kind instead of dropping it | 2026-11-17, v0.5.0: `send(data, { latest: kind })` |
| F-038 | Feature | Demo: arrow buttons on the screen for phones and tablets | 2026-11-17 (demo only; tested in Chromium and on an emulated Pixel, not yet on the owner's devices) |
| D-011 | Design | Check Cloudflare's Free plan figures (daily requests, GB-s, 20:1 WebSocket billing, storage rows) and whether EU-only rooms work on the Free plan | 2026-11-17: figures checked in Cloudflare's documentation (read from its source on GitHub, since the documentation site is blocked in the agent's environment); EU rooms confirmed 2026-11-15. See the D-011 details |
| D-025 | Design | Try the demo on real phones: lock screen, wifi to mobile data, tab in the background; with an iPad | 2026-11-18: all three parts done on an iPad, a Pixel 10 Pro and a computer as viewer, measured with the reports (F-047); found B-033, B-034, B-041 to B-044, B-049, B-050 |
| B-041 | Bug | Demo: the letters W, A, S and D (and the arrow keys) could not be typed in the name field, because the game took them as steering keys on the whole page | 2026-11-17 (demo only; tested in Chromium, not yet on the owner's iPad) |
| B-042 | Bug | Demo: players who do not run the game saw the ships move jerkily (about 15 steps a second), while the host saw them smooth | 2026-11-17, v0.5.1 (the others' ships glide between positions; demo only; not yet seen on the owner's devices) |
| B-043 | Bug | "Someone joined" instead of the name: the room told the others that a participant joined before it sent the room's new list | 2026-11-17, v0.5.1 (list first, name in every event; unit tests) |
| B-044 | Bug | A participant away longer than the grace period came back without the place and was announced as joined | 2026-11-17, v0.5.1 (place given back if free, `returning` on the join, the demo says "is back"; unit tests) |
| F-045 | Feature | Demo: ships without inertia (they stop at once) and a response-time meter in milliseconds, so the owner can judge how fast the game answers | 2026-11-17 (demo only; the meter measures this browser to the host's browser and back every 2 seconds; tested in Chromium, not yet on the owner's devices) |
| B-049 | Bug | Demo: at a change of host the new host continued from the room's kept state (up to 3 s old) although its page had newer positions, so the ships jumped back | 2026-11-18 (the new host continues from the newest positions it has; the browser test moves a ship just before the host leaves and checks it stays; not yet on the owner's devices) |
| B-050 | Bug | Demo: the game ran at the host's timer speed, about 8 % slower with the iPad as host | 2026-11-18 (the game steps by the clock, 30 steps a second; checked in the browser test; not yet on the owner's devices) |
| F-053 | Feature | Limits per visitor at the Worker before a room is woken | 2026-11-18, v0.7.0 (server option `limits`, 10 creations and 60 tries a minute; unit tests) |
| D-056 | Design | The security model for games | 2026-11-18, v0.7.0 (`docs/INTEGRATION.md`, section 9) |
| F-054 | Feature | Security headers for the admin page and the demo | 2026-11-18 (`_headers`; referrer policy same-origin, since no-referrer broke the admin sign-in in a test) |
| B-055 | Bug | The admin page's brake on wrong passwords kept a record per address with no end date | 2026-11-18 (deleted a day after the last wrong password; unit test) |
| F-003 | Feature | One admin page for all games: on/off/until, private only, emergency stop | 2026-11-18, v0.7.0 (checked on new rooms, newcomers and new rounds, not on reconnects; a stop closes running rooms within 30 s; games connect over a service binding; fails open; tests in Node; the demo is connected) |
| F-004 | Feature | Daily budget per game | 2026-11-18, v0.7.0 (shares of each daily free limit, equal by default; automatic closing for the day is off until the owner turns it on) |
| F-008 | Feature | Usage on the admin page, plan, estimated cost and spending cap | 2026-11-18, v0.7.0 (usage per game 2026-11-17; plan, the month's cost on the Paid plan, a monthly cap) |
| F-026 | Feature | Operations: what players see when a game is closed or the quota is used up, a budget for the demo, logging | 2026-11-18, v0.7.0 (plain reasons with the opening time; the demo is a game on the admin page and logs a tenth of its requests) |
| F-052 | Feature | Automatic anonymous measurement in games | 2026-11-18, v0.7.0 (client option `measure`; summaries cleaned by the game's Worker, kept 7 days by the admin page, shown per game; the demo measures; not yet used by a game) |
| F-057 | Feature | Modes per game on the admin page, and a room-less check for pages | 2026-11-18, v0.9.0 (asked by the Bricks session; unit tests and a local run of the admin Worker; not yet used by a game) |
| F-058 | Feature | Administrators may play while a game is off | 2026-11-18, v0.9.0 (admin links per game, 30 days, revocable; owner's answer to Q9; unit tests and a local run of the admin Worker; not yet used on the owner's devices) |
| F-029 | Feature | Rooms created by a game's server without a participating creator, with the first eligible participant leading | 2026-11-18, v0.6.0 (`createRoom(env)`; the demo's `POST /invite`; unit, client and workerd tests; not yet used by a game) |
| F-030 | Feature | A room-kept state for newcomers, optionally per role | 2026-11-18, v0.6.0 (`setWelcomeState`, rules `room.setWelcomeState`, event `welcome-state`; kept in parts; tests incl. workerd) |
| F-031 | Feature | Lifting a ban and the ban list for the owner (the other small additions from the games pass wait until a game needs them, owner's answer to Q3) | 2026-11-18, v0.6.0 (`room.bans`, `unban(id)`; unit tests) |
| F-032 | Feature | Follow-ups from the check of v0.2.0: forgotten rooms, workflow and template checks in CI, the gate on joining, a version check | 2026-11-18, v0.6.0 (`idleCloseMs` 60 min; CI lints the workflows and the update template, runs a vendored copy's smoke test and `scripts/version-check.mjs`; the gate on joining is tested) |
| F-039 | Feature | Direct sends from playing participants in host-run rooms (role option `sendsTo: 'all'`) | 2026-11-18, v0.6.0 (asked by Vättigt; unit tests) |
| F-040 | Feature | Preferred successor for takeover (`setSuccessors`) | 2026-11-18, v0.6.0 (asked by Vättigt; a preferred one who does not answer is passed over; unit tests) |
| F-051 | Feature | Faster notice when someone's connection dies silently (room option `heartbeatMs`) | 2026-11-18, v0.6.0 (2.5 heartbeats, about 5 s with 2 s; the demo uses it; unit, client and workerd tests, where a silent connection was dropped within 9 s; not yet seen on the owner's devices) |
| D-046 | Design | Where EU rooms run | 2026-11-18 (documented: a room stays where its first visitor created it, inside the EU; rooms now report their data centre and the demo's reports include it; to be read from the next report) |
| F-047 | Feature | Demo: measurement report per device (key to movement, key to stop, response time, how evenly positions arrive, frame rate, device and network), sent with "Send report", kept 7 days in the demo Worker and read by the agent through a workflow that seals it with the agent's key (the repository is public) | 2026-11-17 (tested in Chromium and local workerd; not yet used on the owner's devices) |
| F-048 | Feature | Demo: the player's own ship moves at once in their browser and is corrected towards the host's position after it stops; switch "Instant own ship: on/off" to compare | 2026-11-17 (tested in Chromium; not yet on the owner's devices) |

## Proposed runs (2026-11-18, rules v1.12)

No runs are proposed: every open item is done or waits for a game or the owner.

Owner tasks: D-028 (decide how Boomers runs its game). Try v0.7.0 on the devices: the admin page's Games section (Off, Off until, Stop) against the demo, the response time and room's data centre in a report, and the connection-quality table.

Vättigt, Critical ST8, Bricks and Buzzy can build on v0.7.0 following `docs/INTEGRATION.md` and `docs/ADMIN.md`.

## Details

### F-001 Room server core and browser client (done 2026-11-15, v0.1.0)
- Shape (to settle in the first run): one room = one Durable Object on Cloudflare (Workers Free plan; SQLite-backed objects only). The core is a library; each game's server plugs its own rules into it and keeps its own versioned copy, so games update on their own schedule. One shared admin service holds opening hours and budgets that every game's server checks.
- Rooms: short codes, create, join, leave, waiting room, countdown and shared seed, rematch, cleanup of old rooms (proposal: after 24 hours; only nicknames stored).
- Rooms sleep when nobody plays (WebSocket hibernation), so idle rooms cost nothing.
- Seats with limits per role (from Buzzy: 12 players, 4 big screens; a big screen never becomes a player). Bricks has no spectators today.
- Kick and ban players (from Buzzy).
- Late join: a new player waits and is admitted at the next safe point; each game decides when (Buzzy: next question; Boomers: next round, or straight into the running round when the room allows it; Bricks: next rematch; memory-type game: before start only). Room setting: admit now or at the next round, where the game allows both.
- Host leaving: leaving on purpose closes the room for everyone with a message; a lost connection does not. Bricks instead hands the host role over. The core supports both.
- Connection recovery (from Buzzy, proven there): network change such as wifi → 5G, tab back from the background, network back online, growing retry delay. Independent of Firebase and can move almost as is.
- Duplicate protection: a command resent after a network glitch counts once (from Buzzy).
- Player identity without Google sign-in: a random player key per device; the host gets a secret host key.
- Client patterns to reuse: QR share screen with code and link, code entry field, leave confirmation, clear errors ("Room not found"), waiting state on reload (from Buzzy).
- Privacy: what is stored, for how long, and cleanup of old rooms (groundwork in Buzzy #332, #405 and Bricks T-006). Rooms stored only in the EU if the free plan allows it.
- Must also fit a turn-based game such as memory without extra work.

### F-002 Secure share links (done 2026-11-15, v0.1.0)
- Bricks already has private invitation links: a long random key in the part of the link the browser never sends to servers, expiry, revoke from admin, and the room code alone grants no access to a private room.
- The core generalizes this: one key per role (player, viewer/big screen, host), so a viewer link cannot play; each room chooses whether the code is enough (open room) or the key is required (private room); the host can renew a key, which stops old links at once while people already inside stay; optional expiry; QR code for the link.
- Covers Buzzy #348 (secret, renewable viewer link) and relates to Buzzy #331 (host sign-in).

### F-003 Administration
- Games pass 2026-11-15 (D-012): the gate must also be asked when a round starts (Bricks: new starts and rematches recheck access; admitted games finish), so it needs the actions create, join and start, must be callable from inside the room, and must exempt admitted participants who reconnect. `gate` in v0.2.0 is marked experimental until then.
- Review 2026-11-15 (finding 15): the `gate` hook in v0.1.0 runs on every connection, also when an admitted player reconnects, so "running games finish" would break at the first glitch after Off; and running rooms cannot be reached for an emergency stop. Check new joins inside the room and give rooms a cheap stop flag read on hello and alarm. Until then `gate` is experimental.
- One admin page for all games, building on today's Bricks admin Worker (opening hours, private invitations, sign-in by email link for approved addresses, no passwords; only the owner to begin with).
- One row per game (Boomers, Bricks, Buzzy, …) with On / Off / Until, plus a "private rooms only" mode where only invitation links work.
- Off: the server refuses new rooms and joins for that game at the first step, before any room is created, and the game shows "closed" instead of the button. Running games finish, as in Bricks today.
- Emergency stop: also closes running rooms of that game at once.
- An Off game costs almost nothing (one small refused request per attempt). Fully zero needs the game's route switched off in Cloudflare (manual).

### F-004 Daily budget per game (proposal 2026-11-13)
- Review 2026-11-15: each game is its own Worker, so Cloudflare's per-script usage numbers may give per-game usage without extra storage writes (unverified; needs the read-only token). Enforcement is a flag the gate reads with a cache. Messages inside a room never pass the gate, so the caps per room (F-018) are the real guard against a runaway game.
- All games share one Cloudflare account's daily free limits. Each game gets a share of the daily budget; a game that exceeds its share closes itself for the rest of the day, so one runaway game cannot take the others down.
- The admin page shows each game's usage today.

### F-005 Critical ST8 needs (updated 2026-11-15; done in v0.1.0)
- Critical ST8 (https://github.com/BadBagel47/critical, the owner's top-down co-op space game) was the first real user, decided by the owner on 2026-11-15 (Vättigt is first since 2026-11-17). Its online mode is Critical F-040 and late join Critical F-038; network preparations Critical D-060, D-061, D-062.
- What the game already is (2026-11-15): playable solo end to end; up to three players online share one frigate on three posts (Captain, Gunner, Engineer) and may switch posts freely; solo starts as Captain. Boarding switches to a top-down on-foot view. Pure JavaScript without a build step, hosted on GitHub Pages, moving to Cloudflare when the engine is built in.
- The game logic is deterministic and separate from drawing and input: the whole game is one plain object (about 25 kB, about 3 kB changes all the time, measured 2026-11-14; measured again 2026-11-17: 41 kB at the start and up to 187 kB with visited bases, see F-036), stepped 60 times a second, and `stepPlayers()` takes each player's requests. That fits F-006 (one player's browser runs the game).
- Posts on a shared ship: a seat can be a post; players claim and switch posts freely, a post is held by at most one player, and the room tells everyone who holds what.
- Messages to one player or a group, not only to everyone: players on the ship and players boarding a station see different things, and the host decides who gets what. This also saves the daily budget.
- Snapshots for join and rejoin: a player who joins mid-game or comes back gets the full state once (about 25 kB), then only changes (Critical F-038).
- Viewer seat for a big screen that watches without controlling (Critical F-137), using the viewer role from F-001 and F-002.
- Saved games are text and stay in the players' browsers (save, export, import already exist). Storing a crew's save on the server is not needed now; revisit if the owner wants to continue a crew's game from any device.
- If the game later outgrows the free plan, see the plan decision in `docs/HANDOFF.md` and F-008.

### F-006 Host-run rooms (2026-11-15; done in v0.1.0)
- One player's browser (the host) runs the game; the server only relays: players' inputs go to the host, the host's state changes go to the others. Recommended in Critical D-060.
- Much cheaper on the free plan than running the game on the server: the room can sleep between messages, and only messages into the server count (about 40 per second for three players, roughly 14 hours of play per day within the free limits; to be measured).
- Host takeover: if the host drops, the server picks another player, who continues from the latest full state; everyone gets a short pause while it happens (F-007).
- Fairness and cheating: the host could cheat; acceptable for a game among friends (same stance as Bricks).
- Server-run rooms stay possible for games that need them; each game chooses.

### F-007 Pause and grace period (2026-11-15; done in v0.1.0)
- A pause button freezes the world for everyone in the room; anyone can resume (Critical: "a pause button freezes the world for all").
- A player whose connection drops keeps their seat during a grace period; the game decides whether to pause automatically and after how long (Critical: automatic pause only after a while, limit to be tested).
- The room reports drop, back and gone as events, so each game handles them its own way.

### F-008 Usage on the admin page (2026-11-15)
- The owner wants network-kit to work on a free Cloudflare account, with the option to pay when the quota runs out.
- Two sources: the server's own counters per game (exact, live: messages, connections, active room time) and Cloudflare's own usage numbers through its analytics API (official, a few minutes behind; needs an API token with read access to account analytics, stored as a secret, never in the code).
- Plan setting on the admin page: Free or Paid.
  - Free: today's use against the daily limits (100,000 requests and 13,000 GB-s of room time per day for the whole account, reset at midnight UTC), per game and in total, with the per-game budget from F-004.
  - Paid: this month's use against what is included (1 million requests and 400,000 GB-s per month), an estimated cost so far, and an optional monthly spending cap of the owner's choosing that closes games before it is passed. Cloudflare's own usage notifications as a second guard.
- Warns on the admin page when use nears a limit, e.g. at 80 %.
- Check the current Cloudflare limits and prices when building; they can change.

### D-009 Versions and updates (approved by the owner 2026-11-15; set up in v0.1.0)
- Owner's question: can network-kit keep developing after games use it, and do bug fixes reach those games, without it becoming messy? Same need for `BadBagel47/geo-kit` (shared GPS module).
- Same model as `BadBagel47/geo-kit`, which already has version numbers, an automatic tagged release per version and projects pinned to a tag; geo-kit D-016 adds the same update proposals there.
- Version numbers: MAJOR.MINOR.PATCH. PATCH = bug fix only, safe to take; MINOR = new features, old code keeps working; MAJOR = something changes in a way games must adapt to (rare, with a short guide).
- Each game uses a fixed version and records it in its HANDOFF. Nothing changes in a game until it updates.
- Delivery: a copy of the client files inside each game's repository (e.g. `vendor/network-kit/`), made by a small workflow, not loaded from another site at run time (Critical's tests forbid loading from other services, and a copy keeps working even if something elsewhere breaks). The game's server part includes the same version.
- Bug fixes: when network-kit publishes a PATCH, each game gets an automatic update proposal (a branch with the new copy); it merges by itself only if the game's own tests pass, otherwise it waits and the owner is told. MINOR and MAJOR updates are taken in a normal run in that game.
- Order: fix in network-kit first, with a test that shows the bug; never patch the copy inside a game. A game that needs a quick workaround records it and removes it when the fix arrives.
- Keeping it tidy: no game-specific code in network-kit; a short changelog per version that says who is affected; old functions are marked as on their way out for at least one MINOR version before they are removed; network-kit's own tests include a small example game that every release must pass.

### Run A result (2026-11-15, v0.1.0)
- Built as planned: one room = one SQLite-backed Durable Object with WebSocket hibernation; heartbeats are answered by the runtime without waking the room. The core (`src/server/room-core.js`) is independent of Cloudflare and tested in Node with a fake clock; `src/server/worker.js` is the Cloudflare glue.
- Both kinds of rooms: host-run (Critical) and server-run (memory example with turns and a timer).
- Not verified: Cloudflare's Free plan figures and EU rooms on the Free plan (D-011); behaviour on real phones (switching networks) is covered by the client logic carried over from Buzzy and by tests that drop connections, not by a phone test.
- QR codes use the vendored qrcode-generator 1.4.4 (MIT, licence file next to it), the same library Buzzy uses.

### F-010 Faster takeover from a silently dead host (2026-11-15)
- When a phone goes to sleep, its connection can stay open on the server side for a long time, so the takeover after `takeoverMs` starts late.
- Review 2026-11-15 (finding 16): a 20-second heartbeat, slowed further in background tabs, cannot give "within seconds". Better: players report after N seconds without data from the host; the room then pings the host and takes over if nothing comes back in about 3 seconds. Do it by the first game's first playtest.
- Earlier idea: the room already gets a heartbeat from every client every 20 seconds (answered for free); `getWebSocketAutoResponseTimestamp` tells when a socket last sent one. Players who stop receiving state could ask the room to check the host; if the host's last heartbeat is too old, the room treats the host as dropped. Must not cost room time while nothing happens.

### D-011 Cloudflare limits and EU rooms on the Free plan (2026-11-15)
- Checked 2026-11-17 (Cloudflare's documentation, read from github.com/cloudflare/cloudflare-docs): Workers Free 100,000 requests a day (error 1027 above it); Durable Objects Free 100,000 requests a day and 13,000 GB-s a day; SQLite storage 5 million rows read and 100,000 rows written a day, 5 GB stored in total; all daily limits per account, reset at 00:00 UTC, and operations over a limit fail. Incoming WebSocket messages count as requests at 20:1 for billing; outgoing messages and protocol pings are free; auto-responses (our ping/pong) cost no duration; hibernating objects cost no duration; duration is billed at 128 MB per active object; each `setAlarm()` and each delete is a row written. The analytics show real message counts, not the 20:1 figure. Used by the admin page (`admin/limits.js`).
- The figures in `docs/INTEGRATION.md` (100,000 requests and 13,000 GB-s a day, 20:1 billing of incoming WebSocket messages) come from earlier notes, not from Cloudflare's pages, which could not be reached from the build environment.
- EU-only rooms: confirmed on 2026-11-15. The first demo deploy created a room with `ROOM_JURISDICTION=eu` (recorded under Decisions in `docs/HANDOFF.md`).
- The account's own figures are shown on the admin page (F-008).

### D-012 Fit for the other games (2026-11-15)
- The owner wants network-kit to work for any game and be reused, not tailored to one project (project rule in `AGENTS.md`).
- Go through Boomers (Boomers F-002), Bricks (Bricks F-007, its 2 Players mode and private invitations) and Buzzy (Buzzy #408, #348, #331) and compare with v0.1.0: roles, host behaviour, late join, timers, rematch, admin needs.
- Review 2026-11-15: do this as a short paper pass before D-019, F-013 and D-023, since its value is finding API changes while they are free.
- Output: a short list in this section of what already fits and what is missing, each missing piece written as a general feature with its own ID. Nothing game-specific goes into network-kit.

### F-013 Game-master host (2026-11-15)
- Today the host is a player with extra rights: the host takes a player seat, is counted in `to: 'players'`, and in host-run rooms another player takes over when the host's connection is lost.
- Buzzy has a quiz host who leads without playing (host, up to 12 players, up to 4 viewer screens). If such a host drops, a player must not take over (they could see the answers); the room should pause and wait for the host.
- General options, each with a default that keeps today's behaviour: a host without a player seat (not counted among players and posts), and `takeover` on (today) or off (pause and wait for the host during the grace period; what happens after the grace period is chosen too).
- Also useful for e.g. a party game with a game master. Covered by an example game's tests.
- Owner's point 2026-11-15: in Buzzy it would be badly wrong if a player suddenly became host. Requirements: with takeover off, no player can ever become host and the stored game state (which may hold the answers) is never sent to anyone but the host/owner; the room pauses with a clear "waiting for the host" state, and the host continues when back, also from another device with the host key. Decided by the owner 2026-11-15: waiting for the host is the default and takeover is something a game turns on (Critical does), because a wrong default then only causes a pause, never a leak. Tested with an example game that has a non-playing host.
- Roles defined by the game (owner decision 2026-11-15): instead of only the built-in `player` and `viewer`, a game lists its own kinds of participants with their seat limits and rights (e.g. plays or not, may pause, may become host, gets the invitation keys, has its own share link). `player` and `viewer` stay as the default, so games written for v0.1.0 keep working (a MINOR version). This makes a later role such as a referee a setting instead of a change to the core. No referee is built now: it waits until a game needs it.

### Review of v0.1.0 (2026-11-15)
- An independent reviewer went through the code, tests, docs and plans. Report with all 27 findings, line numbers and scenarios: [docs/reviews/2026-11-15-v0.1.0.md](reviews/2026-11-15-v0.1.0.md). Proof scripts that demonstrate the faults: `docs/reviews/2026-11-15-proofs/` (they pass while a fault exists; reverse the assertion when it is fixed).
- The items below group the findings; the numbers in brackets are the report's finding numbers.

### B-014 A sleeping room loses state (findings 1, 2, 24)
- The latest snapshot is kept only in memory until the next timed save, so a room that goes quiet and sleeps hands an older state to the next host. The message counter for duplicate protection is not stored either, so after sleep plus a network switch inputs are delivered twice.
- Also: the snapshot save is not awaited, and the error for an oversized message does not say which message it was.

### B-015 Reconnect faults (findings 3, 4, 13)
- A player who was away past the grace period and returns in the same page resends up to 500 old messages and commands (old pause commands flip the pause for everyone).
- When a connection is replaced without the server seeing a drop, nobody is told, so the host does not resend state; reliable delivery only covers client to room.
- If the takeover message lands on a dead connection, the new host never gets the state and the room stays paused.
- Messages queued as host are delivered as player input after a role change, and the reverse.

### B-016 Client stuck offline; join never gives up (findings 5, 14)
- After the browser reports offline and online again while the connection survived, the client stays "offline" and holds back everything it sends.
- When the server cannot be reached, `join()` neither succeeds nor fails and retries for ever (thousands of requests a day from one forgotten tab).

### B-017 Uninvited connections (findings 7, 8, 23)
- A connection that never introduces itself is never closed, can send junk without limit, and one such connection stops the 24-hour cleanup for good.
- A very long session id makes a seat that looks online with nobody in it, for good; a few of these fill an open room.
- Ids such as `__proto__` are accepted in commands.

### F-018 Limits on what one room can cost (finding 6)
- A host alone in a started game keeps the room awake all day; nothing caps messages per connection or per room. With the unverified free-plan figures, one forgotten tab can use most of a day's quota. The public demo is open to this.
- Proposal: the client does not send when nobody else is online; a rate cap per connection and a daily cap per room that close with a clear final code; automatic pause when one participant has been alone for some minutes. All as options with sensible defaults.

### D-019 Owner and host (finding 9)
- Today "host" means three things at once: the creator with the rights, the browser that runs the game, and the holder of the keys. A 6-second glitch for the creator moves all three to the next player for good, that player leaving closes the room for everyone, the host key can never be renewed, and a server-run room can end up with no host at all.
- Decided by the owner 2026-11-15:
  - The owner is whoever created the room: kick and ban, renew links, settings, closing the room. Ownership never moves automatically; the owner gets everything back on return, at any time and also from another device with the secret owner key. That key is never sent to anyone else.
  - The host is the browser that runs the game. In games that turn takeover on, the host role can move to another player; that player may run the game (start and end rounds, admit waiting players) but gets none of the owner's rights or keys. From the start the owner is also the host.
  - Longer absence, games with takeover: short pause, another player runs the game after `takeoverMs`; the owner's seat and post are freed after the grace period like any player's, ownership stays; when the owner returns the game keeps running where it is (no new pause).
  - Longer absence, games without takeover: the room stays paused and waits; seats are kept; nothing but leaving is possible until the host is back.
  - If the owner never returns: the room lives until everyone has left and is cleaned up 24 hours later. Options a game may turn on, both off by default: ownership passes to the current host after a long absence (games with takeover), or the room closes with a clear message after a waiting time (games without takeover).
  - The owner may hand ownership over voluntarily.

### B-020 Rights and lockouts (findings 12, 18, 19, 20)
- Viewers and waiting players can pause; a viewer's messages reach the host.
- An automatic pause is not lifted when the player returns or is gone, and with `pauseBy: 'nobody'` it can never be lifted.
- A player who was admitted is refused after the grace period when late join is off or the invitation key was renewed.
- A ban is bypassed by opening the same invitation link in a new tab.

### D-021 Version policy and update workflow (findings 10, 11, 27)
- The changelog promises that a MINOR version never breaks games, but several fixes from the review change behaviour. Proposal: while the kit is 0.x, a MINOR version may require changes in the game (with a short guide) and only PATCH versions are taken automatically; add a test of the previous release's client against the new server.
- The update workflow for games pushes straight to the game's `main` when the game's own tests pass, but those tests normally do not exercise the kit, the push may not start the game's deploy, and a bad release would reach every game within a day. Proposal: a kit smoke test the game runs, a waiting time of some days before a patch is taken, and branch plus issue as the default until the model is trusted. To decide by the owner.
- Smaller workflow fixes are listed under finding 27.
- Decided by the owner 2026-11-15, both parts:
  1. While the kit is 0.x, a MINOR version may require changes in the game and comes with a short guide; a PATCH never does. At 1.0 (when the kit has proven stable in a couple of games) the full promise applies: MINOR never breaks games.
  2. Bug fixes reach a game as a proposal on a branch with a notice to the owner, not directly on the game's `main`; they are taken only some days after the release and after a kit smoke test (create a room, join, send, reconnect) has passed in the game. Switching to fully automatic is a later decision, once the smoke test exists and the first updates have gone well.
- To build in run B: the changelog header and `docs/INTEGRATION.md` text, the smoke test, the waiting time and branch-plus-issue as the template's only path for now, one dry run to see whether a workflow push starts a game's publishing, and the fixes under finding 27.

### B-022 Server-run rooms (findings 17, 21)
- Every message to a server-run room causes a storage write, even ignored ones; every snapshot while paused too.
- The seed is sent to every client, and the memory example shuffles its hidden cards from it, so a player can work out the cards.

### D-023 API details to settle now (finding 22)
- `posts` is described with one game's words and allows one holder per post; `room.phase` stays "countdown" on clients; `isHost` is false inside the host event; `to: 'all'` echoes to the sender; rules cannot be asynchronous; storage keys are shared between games on the same site.

### F-024 Missing tests (finding 25)
- No unit tests of the client, no test with a real sleeping room, the browser test is not part of CI or releases; several flows are untested (gate on join, cleanup with connections present, silent replacement).

### D-025 Demo on two real phones
- Lock the screen, switch from wifi to mobile data, put the tab in the background; note how long each recovery takes. Never done so far.

### F-026 Operations (the review's list of missing items)
- What a player sees when the daily quota is used up; a budget or gate for the public demo; logging in production (`observability` is off in `wrangler.jsonc`).

### B-027 Documentation disagrees with the code (finding 26)
- `AGENTS.md` says "Boomers first" and lists opening hours and administration as existing (changing project rules needs the owner's approval; approved with this item); gaps in `docs/INTEGRATION.md` (events, options, what is stored); a wrong file name in a code comment.

### Runs A and B result (2026-11-15, v0.2.0)
- The faults from the review have regression tests: `tests/unit/hardening.test.js`, `tests/unit/host-owner.test.js`, `tests/unit/client.test.js` (the real client against the real room logic) and `tests/integration/sleep.test.mjs` (a room that really sleeps in local workerd). 107 unit tests, 12 integration tests, the browser test of the demo and the kit's smoke test pass.
- Before the release an independent reviewer checked the candidate: [docs/reviews/2026-11-15-v0.2.0-check.md](reviews/2026-11-15-v0.2.0-check.md). It found two serious and about ten medium faults in the rewrite (a reconnect with a long queue got the client thrown out; the owner's second tab took the room from the first). All were fixed or recorded before the release, with tests named `V-B…`. **Those last fixes were tested by the building agent but not checked again independently.**
- Not done from the review: finding 15 (the gate) is part of F-003; the rest is in F-032.
- v0.2.1 followed at once: GitHub's test run on v0.2.0 showed two tests that depended on timing or on random ids; one of them was a race in the shipped smoke test, fixed in v0.2.1 (the room server and the client are unchanged).
- Not verified: behaviour on real phones (D-025); Cloudflare's free-plan figures (D-011), so the default caps (40 messages a second per connection, 600,000 a day per room) are estimates.

### D-012 results: the games pass (2026-11-15)
Read-only pass over Boomers, Bricks and Buzzy against the 0.2.0 shape. Changes it led to in 0.2.0: snapshots private to the host seat (a quiz must not leak answers to joiners), `sends` separate from `plays` in a role (a non-playing leader commands the game), a stable id also for someone removed and let in again, a countdown that can be called off, shared room data, an identity `slot`, and defined behaviour for messages while the host is away (dropped).

- **Boomers** (docs only, no code): real-time arena game, 2 to 4 players. Fits a host-run room with takeover, as the crew example. Its HANDOFF and AGENTS say gameplay runs on the room server, which the kit does not do: D-028.
- **Bricks**: two players, each browser runs its own game from a shared seed. Fits a host-run room used as a relay (with two participants, "to the host" and "to the others" is peer to peer), owner and host as today's code owner and lobby host, `ownerLeave: 'pass'`, late join never, countdown with seed, rematch as a new round, private invitation keys. Gaps: the gate at round start (F-003), rooms nobody in them created (F-029), smaller ones in F-031. Stays in Bricks: reopening a previous room with the same code, settings approval, results, history, admin sign-in. Room codes: 6 characters at the move, probably (owner 2026-11-18), which is the kit's default from v0.8.0, so nothing to set.
- **Buzzy**: a non-playing host, 12 players, 4 viewer screens; must work without an awake host tab, so it fits a **server-run** room with a leader role that sends (`ownerRole`, `plays: false`, `sends: true`): the question library and answers stay in `room.game`, rules send each role its view, buzzes arrive in the order the room got them. Waiting for the host (F-013) is for host-run games. Gaps: a kept state for newcomers if it were host-run (F-030), unban, admit one by one, access per role, state saved in parts (F-031). Stays in Buzzy: buzz modes, judging, scoring, questions, viewer modes.
  - Owner's question 2026-11-15: Buzzy's preload of the next question (players load the allowed text and image in advance and acknowledge it) is not affected by the host's private snapshot. The preload is content the game chooses to send: a normal message to the players, answered by a message from each player; in a server-run room the rules send it again to someone who joins or reconnects. To check when Buzzy moves: how question images are delivered and how large they are, against the message size limit (`maxMessageBytes`, 64 kB by default) and the room's stored state.
  - Buzzy's check of v0.2.3 (2026-11-17, Buzzy #408): question images are web addresses (at most 2,048 characters), never uploaded data, so the preload stays far below `maxMessageBytes`; the question library with answers is about the size of a few kilobytes per question. Gaps for Buzzy: unban (in F-031) and four-character codes (F-035, done in v0.3.0). Owner's decision 2026-11-18 for Buzzy's move: 6-character codes (the kit's default from v0.8.0, so no setting needed), more player seats than today's 12 and fewer screens than today's 4 (numbers set at the move; all three are existing settings, so nothing new is needed in the kit). Everything else Buzzy needs today is covered by v0.2.3: a non-playing leader role, seats per role (12 players, 4 screens), an invitation key per role (Buzzy #348), late join at the next question, kick and ban, reconnection, EU rooms and deletion 24 hours after the last participant left (Buzzy #332).

### D-028 How Boomers runs its game (2026-11-15)
- `BadBagel47/boomers` records (HANDOFF, Decisions, Network 2026-11-15, and AGENTS) that gameplay runs on the room server. network-kit deliberately runs no real-time game on the server: a room that steps a game many times a second never sleeps and would use the free plan's daily time quickly (figures unverified, D-011).
- Recommendation: Boomers becomes a host-run game with takeover, like the crew example and Critical ST8, and its documents are corrected. The alternative, a tick loop in server-run rooms, is possible later but costs room time continuously.
- The owner decides; the decision is recorded in Boomers.

### F-029 Rooms without a participating creator (2026-11-15)
- A game's server (e.g. an admin-issued invitation) creates the room; nobody in the room created it. Needs: a chosen or repeatable room id so two people opening the same link land in the same room, optional expiry, and the first eligible participant as owner and host (the room logic already has "ownership is free for the next eligible participant").

### F-030 A kept state for newcomers (2026-11-15)
- Today a newcomer's view is sent by the host (host-run) or by the rules (server-run). A state the room keeps and hands to joiners and reloading participants, optionally one per role, would not depend on the host being awake. It must stay separate from the host's private snapshot.

### F-032 Follow-ups from the check of v0.2.0 (2026-11-15)
- The cap on busy minutes (`maxActiveMinutesPerDay`, default 12 hours) only limits a forgotten room; it does not notice that nobody is playing. A real idle signal would have to come from the clients (no input from anyone for some minutes).
- The update template and the release workflow were simulated by hand in run B, not tested in CI. A small script that runs their shell steps against local repositories would catch regressions.
- The gate has a unit test for creating a room, none for joining (it changes in F-003 anyway).
- A CI check that a change to `src/` comes with a version bump and a changelog entry.

### B-033 A copied tab takes over the participant (2026-11-15)
- Found by the owner when trying the demo on one phone (D-025): the player link opened in a new tab of the same browser showed "(owner, host)" and no name field, and the first tab closed with "The room was opened in another tab."
- Reproduced with an emulated phone (Pixel 7, local workerd). Opening the link in a new tab from the game page: the new tab is the same participant as the first (same id, owner and host) and the first tab is closed. A separate browser, or a new tab where the link is pasted, works as intended.
- Cause in the kit: with `identity: 'tab'` the identity is kept in `sessionStorage`, which browsers copy into a tab opened from another tab (and into a duplicated tab). The copy then counts as a reload of the same tab.
- Cause in the demo: it also keeps the current room in `sessionStorage` and rejoins it automatically when the link is for the same room, so the copied tab never shows the start screen.
- Fixed in v0.2.2: every tab holds a browser lock named after its tab id (Web Locks, with a BroadcastChannel question where locks are missing); a tab whose stored id is held by another open tab is a copy and gets a new id, and the client then makes a new identity for it. `tabSession()` is exported for games' own per-tab state; the demo uses it so a copied tab does not rejoin the first tab's room, and focuses the name field when someone arrives by a link. Tests: unit tests of the detection, the real client joining from a copied tab, and the Chromium test opening the invitation in a new tab of the owner's browser (it asks for a name, joins as a third participant, and the owner's tab stays owner and host).
- Not affected: games where every participant uses their own device, which is the normal case. Workaround for testing on one phone: use two different browser apps.

### B-034 Host moves in the lobby (2026-11-16)
- Found by the owner in the phone test (D-025): A (owner, Brave) created the room, B joined in Firefox; switching to Firefox put Brave in the background, Android closed its connection, and four seconds later B was host. Back in Brave, A was still the owner but not the host, and the demo said "Waiting for the host to start" while showing A a Start button.
- Reproduced on the fake host with the demo's crew options: in the lobby, a dropped owner-host is replaced after `takeoverMs`, and the owner returning does not get the host role back.
- Cause: takeover starts whenever the host drops, also when no game is running (lobby, between rounds), where there is nothing to continue; and the host role only returns to the owner by a handover.
- Fixed in v0.2.3 as proposed: with `takeover` on, a lost host is replaced only while a game is in progress (countdown or playing, also paused); in the lobby and after a round the room just waits. An owner who comes back while no game is in progress gets the host role back (with the kept state, so a series of rounds continues). The demo's text: the owner, who may start, is told to press Start.
- Phones close a background tab's connection within seconds, so during a game a short app switch by the host still hands the game over (that is what takeover is for). If that is too eager, `takeoverMs` can be raised per game.

### B-041 Steering keys block typing (2026-11-17)
- Found by the owner in the test with an iPad keyboard (D-025): the letter A could not be typed in the name field; other letters worked.
- Cause (read in the code): the demo listens for keys on the whole page and stops W, A, S, D and the arrow keys from doing anything else, also while the player types in a text field.
- Fixed 2026-11-17: the keys are let through while a text field (or another field that takes typing) has focus; a key held before the field got focus is still let go. The browser test types the steering letters and arrow keys in the name field. Demo only; the kit is unchanged.

### D-025 results, 2026-11-17 (iPad host with keyboard, Pixel 10 Pro as B), part 1
- Works: joining by QR code, taking a place, steering with keys and screen arrows, takeover during a game and the owner coming back as owner.
- Found: B-041 (steering letters could not be typed in the name field; fixed the same evening), B-042 (jerky ships for those who do not run the game), B-043 ("Someone joined" instead of the name), B-044 (after a 2-minute lock B was back without the gunner place).
- Response time (F-045 meter, after v0.5.1): 110–130 ms from the Pixel on 5G to the iPad (host, wifi) and back, through an EU room; with the Pixel on wifi about the same (100–130 ms, mostly 110–120), so the time is spent on the way through the room, not on the phone's network. Fine for turn-based games; real-time games should move the player's own ship at once and correct it against the host (note in the guide).
- With the Pixel as host (wifi) and the iPad not hosting, the iPad's own ship starts and stops late, both with its own controls and as seen from the Pixel. Expected with the demo's set-up (round trip, host step, position interval and smoothing add up to about 0.15–0.25 s); to be measured with F-047 and compared with F-048.
- Measured 2026-11-18 with the reports (F-047; Pixel host and iPad not hosting, both on wifi according to the owner — the browsers do not tell the network type — both reaching Cloudflare in Stockholm): response time from the iPad 44 ms typical (most under 75 ms, now and then up to about 200 ms); the iPad's key to the game moving its ship 45 ms typical (most under 90 ms); positions arrive very evenly every 66 ms; both screens draw 60 frames a second (the Pixel up to 90). The key-to-stop figure was about 66 ms too high because of how it was measured (fixed the same night). With the instant own ship, the iPad's ship was on average 8 px (at most 21 px) from the game's position when it stopped and glided there. Earlier the meter showed 110–130 ms when the Pixel measured to the iPad as host; both were on wifi then too, so the difference is not 5G against wifi; to be measured the other way round (iPad host, Pixel playing) with the reports.
- Measured 2026-11-18, the other way round (iPad host, Pixel playing, both on wifi): response time from the Pixel 108–127 ms typical (often 200 ms, at most 340 ms), and the positions reach the Pixel unevenly (typically 53–71 ms apart, but often 130–150 ms and up to 250 ms), against 44 ms and very even gaps with the Pixel as host. So the iPad as host is slower and sends unevenly; the cause (the iPad's timers, its browser or its wifi) is to be found with the next reports, which now also measure how evenly the host itself sends. The key-to-move figure counted a second key pressed while already moving as a start (fixed).
- The report now also records everything around breaks for parts 2 and 3: every line of the page's log, how long each loss of connection and each pause lasted (and why), host changes, the own place, jumps of a ship, how old the kept state was at a takeover, the browser's own network and page events, and errors.
- Part 2, 2026-11-18 (Pixel host, iPad playing, both on wifi, instant own ship on; from the reports): test 11 passed (the Pixel away 30 s, back as owner and host). Test 12 passed. Test 13: the iPad took over 4.0 s after the Pixel left, from a kept state 0.5 s old. Test 14: the iPad was offline 38 s (longer than the planned 10 s, the owner confirms; still within the 60 s grace period) and came back; the Pixel took over about 7 s after the iPad went silent, but from a kept state 2.6 s old although it had newer positions, so the ships jumped back (B-049). The iPad's own sends are very even (every 72–73 ms), while the Pixel receives the positions unevenly (often 150 ms apart): the unevenness is in the Pixel's receiving, most likely its wifi power saving. Response time this time about 130 ms typical.
- Part 3, 2026-11-18 (computer as viewer): test 15 passed (shown as viewer, no arrows, no posts). Extra rounds with the iPad as host: the iPad's page sends evenly (every 72–73 ms), but both the Pixel and the computer receive unevenly (often 110–150 ms apart), so the unevenness comes from the iPad's sending side (its browser's socket or its wifi), not from the Pixel; with the Pixel as host everything arrived evenly. The iPad steps the game every 36 ms instead of 33 ms, so the game runs about 8 % slower with the iPad as host (B-050). Another change of host again continued from an old kept state (1.9 s, B-049).
- Note: tests 2 and 10 lock the screen for 2 minutes, longer than the demo's 60-second grace period, so those participants were removed and came back as new joins; the test plan did not say so.

### B-042 Jerky ships for those who do not run the game (2026-11-17)
- The host steps the game 30 times a second and sends positions 15 times a second (`examples/demo/public/app.js`); the others set each ship to the latest position as it arrives and draw it, so they see 15 jumps a second with uneven gaps.
- Fixed in v0.5.1: the others' ships glide from where they are drawn to the newest position over one interval (about 67 ms); the guide says games do this themselves.

### B-043 "Someone joined" (2026-11-17)
- The room sends the event "joined" before the updated room list (`hello` and `admitWaiting` in `src/server/room-core.js`), so the client's `peer` event has no player yet and the demo prints "Someone".
- Fixed in v0.5.1: the room list goes first, then the event; every event carries the name, and the client passes `name` on.

### B-044 Place lost after a long absence (2026-11-17)
- After the grace period the participant is removed; the room remembers them (same id when they return), but not their place, so B came back without gunner and was announced as joined.
- Owner's choice 2026-11-17 (Q4, recommendation): give the place back if it is still free; the grace period stays. Fixed in v0.5.1: the room remembers the place, gives it back when free, and marks the join `returning`.

### D-046 Where EU rooms run (2026-11-18)
- From Cloudflare's documentation (Durable Objects, "Data location", read from its source on GitHub): a room is created in a data centre near the first request that reaches it (here the creator's), restricted to the EU by the jurisdiction, and it never moves afterwards. A location hint (`weur`, `eeur`, …) is only a best effort and only applies when the room is first created; with a jurisdiction, the EU limit always wins.
- So a room created by a player in Sweden should land in a nearby EU data centre that runs Durable Objects; which one is not documented (the site where.durableobjects.live lists them).
- Measured so far: both test devices reach Cloudflare in Stockholm (ARN); the response time through a room is about 45 ms when the Pixel is host, which suggests the room is not in Stockholm itself.
- Built for measuring: a room now reports its data centre in `GET /rooms/<code>` (`where`, asked once per wake-up from Cloudflare's trace page), and the demo's report includes it (`roomRunsIn`). The next report from the owner shows it.
- Not changed: no location hint is set; a hint would only matter if the first visitor were often far from the others, which is not the case for games among friends in Sweden. Revisit if the measured data centre turns out far away.

### F-057 and F-058: Bricks' admin needs (2026-11-18, from the Bricks session)
- Bricks has separate public On/Off/Until for 1 Player (offline in the browser, no room; the page only asks "is 1 Player open?" before a new game) and 2 Players. Today the admin page has one row per game (a Worker name). A game could already use a second name (e.g. `bricks-solo`) through `GameApi.status`, but the page cannot add such a row and the kit has no room-less check for pages. F-057: modes per game on the page, and `GET <basePath>/status?mode=…` answering from the admin page's word without waking a room.
- Bricks rule: the owner and administrators may start and join games while public play is off. The admin page's sign-in is on its own address, so a game page cannot see it. F-058 needs a design: for example a short-lived signed pass the admin page gives the owner for a game, which the game's Worker checks through `GameApi`.
- Correction 2026-11-18: Bricks' "private invitations work while public play is off" is **not** covered by **Private only**: with Private only anyone can still create a room and invite their own friends (only joining someone else's room needs a key), and with Off the owner can play with an admin link but the friends they invite are refused. A smaller step than F-059: a room created with an admin link lets in those who have its invitation link while the game is Off (no list, expiry or revoking).
- Owner's decision (relayed by the Bricks session 2026-11-18): when Bricks moves it uses network-kit's admin page and sign-in as they are, and Bricks' own admin Worker is retired. This answers the earlier question about replacing Bricks' admin Worker.

### F-059 Private invitations from the admin page (2026-11-18, from the Bricks session)
- Bricks' admin page today makes private invitations: a room code and link with Copy, a closing time, a list with Active / Expired / Revoked, and Revoke. Two people open the same link and land in one private room, also while public play is off.
- network-kit has `createRoom(env)` for the game's Worker (F-029), but nothing on the admin page, no list, no expiry and no way to revoke a room made that way (it has no owner key).
- To build: the admin page asks the game's Worker (over a service binding the other way, or through a request the game's Worker makes) to create, list and close such rooms; an expiry closes the room; the room is private and allowed while the game is off (like an admin pass for that room).
- Owner's own description of how access should work (2026-11-18, verbatim in Swedish): "Admin kan stoppa folk att ansluta 1 player och multiplayer separat. – Admin kan skapa en spellänk att själv spela med som ger tillgång till både 1 player och multiplayer där denne kan bjuda in folk – Admin kan skapa en länk från adminsidan som ger en hostlänk och en vanlig inbjudningslänk som funkar för den som får den". Mapping: the first point is F-057 (built); the second is F-058 (built) plus the smaller first step above (friends invited to a room the admin link created get in while Off); the third is F-059 with two links per invitation, one for the host and one for guests, instead of one shared link.
- Owner's fuller model (2026-11-18, verbatim in Swedish): "Adminsidan kan stänga av 1 player och multiplayer / Adminsidan kan skapa en spellänk som går förbi stoppet. Då fungerar både 1 player och multiplayer. Länken ska kunna användas av icke admin också. / Adminsidan ska även kunna sätta en timer, om denne vill att 1 player och/eller multiplayer ska vara av, men öppnas temporärt. Dvs det som är off, vilket kan vara 1 player och/eller multiplayer, kan sättas på med timer / När man använder länken så kan man spela 1 player och multiplayer. Man kan i spelet man kommer åt med spellänken man skapat skapa inbjudningar till andra spelare som då också kommer förbi stoppet med denna länk. Inbjudningslänkarna ska fungera även om multiplayer redan är öppet / Länkarna som går förbi spärren har en giltighetstid som admin kan ställa in per länk, och göra revoke på om denne vill / På något sätt skulle jag även vilja ha en lobby man kan sätta upp där inbjudna spelare kan vänta på att hosten ansluter". Mapping: Off per mode exists (F-057); the game link is F-058's admin link given to anyone, with validity chosen per link (today fixed 30 days); "open for a while" is new (today Until means off until a time); invitations from a room made with the game link get past Off (the smaller first step); the lobby is F-059 (host link and guest link, guests wait in the room until the host comes). Open questions sent to the owner the same day: Stop, keeping Off-until, Private only, how long in-game invitations last, where a lobby is made, default validity.
- Owner's decisions 2026-11-18 (naming and states): "Off until a time" is removed (a misunderstanding); Off is renamed "Inga nya spelare"; automatic closing is renamed "Cloudflare limiting"; a timer "on until a time" opens something that is off for a while (new). Then decided the same day: the emergency Stop stays, as a button (it throws everyone out at once and no link gets past it), and Private only is removed (with six-character codes and per-address limits it adds little).
- Related, not planned: a private kept state per participant (the rest of F-031). Bricks keeps a guest's own checkpoint in the guest's browser, which needs nothing from the kit.

### F-060 The best host between rounds (2026-11-18, owner's question)
- Today: anonymous measurement shows quality per game afterwards (F-052); takeover happens when a host fails; the game can name successors (F-040) or hand over itself.
- Caution: a change of host mid-round pauses the game briefly and things may jump; single measurements are noisy, so switching must not flap; the best response time is not always the best host (the host also steps the game, and how evenly it sends depends on the device: in the owner's test the iPad sent unevenly as host).
- Proposal: participants report quality every ~10 s (cheap); the room keeps a moving score; a change happens only between rounds, only when someone has been clearly better for a while (e.g. 30 % better over 2 minutes); the game turns it on; the owner sees the scores.

### F-035 Room code length (2026-11-17, v0.3.0)
- Asked for by Buzzy (#408) and Bricks (F-007), which use four-character codes; the owner decided on 4 to 12 characters, easy for each game to set.
- Built as one server option, `codeLength` (default 5 in v0.3.0; the owner then chose 4 as the default, v0.4.0). The guide has a table of how many codes each length gives and when to make rooms private.

### F-036 Large states (2026-11-17)
- From a review of Critical ST8's online plans: the game's whole state is 41 kB at the start, about 154 kB with one base the crew has been inside and 187 kB after a while, and it grows with every base visited. The defaults are 64 kB per message (`maxMessageBytes`) and 512 kB per snapshot (`maxSnapshotBytes`), so a full state for a joiner does not fit in one message, and a long game would not fit as a snapshot.
- Critical shrinks its own state (Critical D-263: places rebuilt from a seed, only changes kept), but other games with a large world will meet the same limit.
- General options: pack messages and snapshots (browsers have `CompressionStream`; check Safari and the Worker runtime), split a large message into parts that the client puts together, or both. Large sends should not count as many messages against the per-connection pace.
- Check Cloudflare's limit on the size of one stored value in a Durable Object before relying on 512 kB snapshots (part of D-011).

### F-037 Latest-value sends (2026-11-17)
- Asked by Critical ST8 (its agent, by message): its Gunner's aim changes 60 times a second, but a connection may send at most 40 messages a second. Today the client keeps the pace by holding back reliable messages and dropping `reliable: false` ones that come too fast, so the newest aim can be the one that is dropped and the host is left with an older value until the next change.
- Proposal: `send(data, { latest: 'aim' })` keeps one pending value per kind and sends the newest one as soon as the pace allows. General: positions, aims, sliders.
- Until then a game sends such values at most about 20 times a second itself, and sends the final value with the default (reliable) when the input stops.

### F-039 Direct sends from playing participants (2026-11-17, from Vättigt)
- Today a non-host's message in a host-run room reaches only the host (`relay` in `src/server/room-core.js`). In a turn-based game the active player's input then crosses the room twice (player to host, host to everyone), counts twice against the room's budget, and stops while the host is away.
- Idea (Vättigt): a role option, e.g. `sendsTo: 'host' | 'all'` (default `'host'`, so nothing changes for existing games), that lets a participant in that role use the same targets as the host.
- Other uses: lockstep turn-based games (memory-type, board games), reactions or chat in any game.
- To settle when built: whether direct sends continue while the game is paused, and whether the host still gets a copy. Cheating is not a priority (hobby games), so the host does not need to vet direct sends.

### F-040 Preferred successor for takeover (2026-11-17, from Vättigt)
- Today takeover picks the owner, else whoever has been here longest (`takeOver` in `src/server/room-core.js`). In a turn-based phone game most players put the phone down between turns, so that participant may be asleep too.
- Idea (Vättigt): the host names a preferred order (e.g. the player whose turn it is, certainly awake), kept by the room and tried before the default order.
- The existing awake check after a takeover still applies, so a preferred participant who does not answer is passed over.
- Other uses: any host-run game with takeover that knows who is active.

### Run A result (2026-11-17, v0.5.0)
- F-036: client and room split any text above 16,000 characters into parts and join them; the room stores the snapshot in parts (meta record plus text parts) and still reads the 0.4 format. Parts count against the connection's pace; a joined message counts once against the room's daily budget. Default limits 256 kB per message and 1 MB per snapshot. Tested: unit tests, the real client against the room, and local workerd with a 190 kB state to a joiner and a 600 kB snapshot handed to a new host.
- F-037: `send(data, { latest: kind })` keeps the newest value per kind and sends it when the pace allows, also after a reconnect; dropped on a role change. The demo's positions use it.
- Cloudflare's own limits on one WebSocket message and one stored value are still unchecked in production (D-011); parts of 16,000 characters stay far below the values known from memory.
