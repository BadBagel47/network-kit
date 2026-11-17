# network-kit backlog

## Conventions

- IDs: one running series with prefixes `B-` (bug), `F-` (feature), `D-` (planning/design). New ID = highest ID + 1.
- Priority: High, Medium, Low. Done items move to *Done*; parked items have the status *Parkerad*.
- Moved from the Bricks backlog on 2026-11-15: Bricks F-007 → F-001 to F-005 here. Old IDs remain in Bricks commits; Bricks keeps F-007 for moving its own 2 Players mode here later.

## Open

| ID | Type | Title | Priority | Status | Suggested model |
| --- | --- | --- | --- | --- | --- |
| F-003 | Feature | One admin page for all games: on/off/until, private only, emergency stop | Medium | Idea; must include the gate redesign (review finding 15, D-012) | Strong, high |
| F-004 | Feature | Automatic daily budget per game | Medium | Proposal | Standard |
| F-008 | Feature | Usage on the admin page: today/this month per game, free or paid plan, estimated cost and a monthly spending cap | Medium | First part built 2026-11-17: admin page with usage per game against the free limits (`docs/ADMIN.md`); tested locally with sample figures, not yet against Cloudflare's real figures (needs the read-only token and the password). Left: plan, estimated cost, spending cap | Standard |
| D-025 | Design | Try the demo on real phones: lock screen, wifi to mobile data, tab in the background (two phones, or two browser apps on one); include an iPad, since Critical ST8's touch controls start on iPad (2026-11-17) | Medium | Owner task; started 2026-11-15 on one phone (found B-033 and B-034) | – |
| F-026 | Feature | Operations: what players see when the daily quota is used up, a budget for the public demo, logging in production | Low | Proposal from the review 2026-11-15 | Standard |
| D-028 | Design | Boomers' recorded decision says its gameplay runs on the room server, but the kit runs no real-time game on the server (free plan): decide in Boomers, recommendation host-run | High | Needs the owner's decision (in `BadBagel47/boomers`) | – |
| F-029 | Feature | Rooms created by a game's server without a participating creator (e.g. an invitation two people open), with the first eligible participant leading | Medium | Idea from the games pass (D-012); needed when Bricks moves | Strong, high |
| F-030 | Feature | A room-kept state for newcomers, optionally per role, so joiners and reloading participants get it without relying on the host | Medium | Idea from the games pass (D-012) | Strong, high |
| F-031 | Feature | Smaller additions found in the games pass: automatic placement, ready flags, pause timeline in server time, grace period per phase, unban and ban list, admit one by one, access per role, private kept state per participant, server time on relayed messages, state saved in parts, rate caps per role | Low | Ideas from the games pass (D-012); each is added when a game needs it | Standard |
| F-032 | Feature | Follow-ups from the check of v0.2.0: notice a room nobody is playing in (beyond the cap on busy minutes), test the update template and the release workflow in CI, test the gate on joining, a CI check that a change to `src/` comes with a version bump | Low | Ideas from the check 2026-11-15 | Standard |
| F-039 | Feature | Direct sends from playing participants in host-run rooms: a role option lets a participant send to everyone (or chosen participants) like the host, instead of only to the host | Low | Idea from Vättigt 2026-11-17; not blocking, added when a game needs it | Standard |
| F-040 | Feature | Preferred successor for takeover: the host names an order (e.g. the player whose turn it is) that is tried before the owner and the longest-present participant | Low | Idea from Vättigt 2026-11-17; not blocking, added when a game needs it | Standard |

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
| F-035 | Feature | Room code length set by the game, 4 to 12 characters | 2026-11-17, v0.3.0; 4 characters by default from v0.4.0 (owner's decision) |
| F-036 | Feature | Large states: send a full state to a joiner and keep a snapshot when the game's state is larger than the default limits, by packing (compression) and/or splitting into parts; check Cloudflare's limit on one stored value for the snapshot | 2026-11-17, v0.5.0: split into parts (owner's answer to question A1), messages and stored snapshots; tested in local workerd |
| F-037 | Feature | Values where only the latest counts (an aim that changes 60 times a second): when the client holds back sends to keep the room's pace, keep and send the newest value per kind instead of dropping it | 2026-11-17, v0.5.0: `send(data, { latest: kind })` |
| F-038 | Feature | Demo: arrow buttons on the screen for phones and tablets | 2026-11-17 (demo only; tested in Chromium and on an emulated Pixel, not yet on the owner's devices) |
| D-011 | Design | Check Cloudflare's Free plan figures (daily requests, GB-s, 20:1 WebSocket billing, storage rows) and whether EU-only rooms work on the Free plan | 2026-11-17: figures checked in Cloudflare's documentation (read from its source on GitHub, since the documentation site is blocked in the agent's environment); EU rooms confirmed 2026-11-15. See the D-011 details |

## Proposed runs (2026-11-17, rules v1.12)

Ordered for: what the games moving here next need first (Bricks, Buzzy), operations and budget after; Vättigt, the first game, needs nothing here to start.

- **A** – strong model, high level – Additions for Bricks and Buzzy
  - F-029 – A game's server can create a room that nobody in it created, so two people opening the same invitation land in one room (Bricks).
  - F-030 – The room keeps a state for newcomers, so players who join or reload get it without the host being awake.
  - Question: Who owns a room created by an invitation? Recommendation: the first participant who enters in a role that may host becomes owner and host, as in Bricks today ("the first to redeem becomes host").
  - Question: Who sets the state for newcomers, and is there one per role? Recommendation: the host (or the rules, in server-run rooms) sets it; one shared state by default and optionally one per role, so a quiz can give players and screens different views.
- **B** – standard model, medium level – Smaller additions and follow-ups
  - F-031 – Lifting a ban, with a list of banned people for the owner, so Buzzy's leader can undo a ban; the other small additions wait until a game needs them.
  - F-032 – Rooms nobody is playing in are noticed, and the update and release workflows are tested automatically, so a forgotten room costs less and workflow mistakes are caught early.
  - Question: Which of the small additions in F-031 now? Recommendation: only lifting a ban and the ban list (Buzzy needs them); the rest when a game asks.
- **C** – strong model, high level – Administration and budget
  - F-008 – The admin page also shows plan, estimated cost and an optional spending cap (usage per game is built).
  - F-004 – Each game gets a share of the daily free budget and closes for the day when it is used up.
  - F-003 – One admin page with on/off/until, private only and an emergency stop per game; checked inside the room, also when a round starts (Bricks), not on reconnects.
  - F-026 – Players get a clear message when the quota is used up; the public demo gets a budget; logging is turned on.
  - Question: How is the daily free budget shared between the games? Recommendation: set per game on the admin page, equal shares by default.
  - Question (shown in a later proposal): Should the new admin page also replace Bricks' own admin Worker? Recommendation: no, not now: it serves the games on network-kit, and Bricks moves to it when Bricks moves to network-kit.
- **D** – standard model, medium level – Turn-based games (from Vättigt)
  - F-039 – A playing participant can send straight to everyone, so a turn's inputs cross the room once and keep flowing while the host's phone sleeps.
  - F-040 – The host can name who takes over first (e.g. the player whose turn it is), so takeover lands on a phone that is awake.

Owner tasks: D-025 (try the demo on phones and an iPad) and D-028 (decide how Boomers runs its game).

Vättigt (first game on network-kit, owner's decision 2026-11-17) and Critical F-040 (online mode) can build on v0.5.0 following `docs/INTEGRATION.md`. None of the runs here is needed for them.

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
- **Bricks**: two players, each browser runs its own game from a shared seed. Fits a host-run room used as a relay (with two participants, "to the host" and "to the others" is peer to peer), owner and host as today's code owner and lobby host, `ownerLeave: 'pass'`, late join never, countdown with seed, rematch as a new round, private invitation keys. Gaps: the gate at round start (F-003), rooms nobody in them created (F-029), smaller ones in F-031. Stays in Bricks: reopening a previous room with the same code, settings approval, results, history, admin sign-in. Four-character codes: F-035 (also Buzzy).
- **Buzzy**: a non-playing host, 12 players, 4 viewer screens; must work without an awake host tab, so it fits a **server-run** room with a leader role that sends (`ownerRole`, `plays: false`, `sends: true`): the question library and answers stay in `room.game`, rules send each role its view, buzzes arrive in the order the room got them. Waiting for the host (F-013) is for host-run games. Gaps: a kept state for newcomers if it were host-run (F-030), unban, admit one by one, access per role, state saved in parts (F-031). Stays in Buzzy: buzz modes, judging, scoring, questions, viewer modes.
  - Owner's question 2026-11-15: Buzzy's preload of the next question (players load the allowed text and image in advance and acknowledge it) is not affected by the host's private snapshot. The preload is content the game chooses to send: a normal message to the players, answered by a message from each player; in a server-run room the rules send it again to someone who joins or reconnects. To check when Buzzy moves: how question images are delivered and how large they are, against the message size limit (`maxMessageBytes`, 64 kB by default) and the room's stored state.
  - Buzzy's check of v0.2.3 (2026-11-17, Buzzy #408): question images are web addresses (at most 2,048 characters), never uploaded data, so the preload stays far below `maxMessageBytes`; the question library with answers is about the size of a few kilobytes per question. Gaps for Buzzy: unban (in F-031) and four-character codes (F-035). Everything else Buzzy needs today is covered by v0.2.3: a non-playing leader role, seats per role (12 players, 4 screens), an invitation key per role (Buzzy #348), late join at the next question, kick and ban, reconnection, EU rooms and deletion 24 hours after the last participant left (Buzzy #332).

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
