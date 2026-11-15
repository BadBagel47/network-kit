# network-kit backlog

## Conventions

- IDs: one running series with prefixes `B-` (bug), `F-` (feature), `D-` (planning/design). New ID = highest ID + 1.
- Priority: High, Medium, Low. Done items move to *Done*; parked items have the status *Parkerad*.
- Moved from the Bricks backlog on 2026-11-15: Bricks F-007 → F-001 to F-005 here. Old IDs remain in Bricks commits; Bricks keeps F-007 for moving its own 2 Players mode here later.

## Open

| ID | Type | Title | Priority | Status | Suggested model |
| --- | --- | --- | --- | --- | --- |
| F-001 | Feature | Room server core and browser client | Medium | Idea | Strong, high |
| F-002 | Feature | Secure share links: room code + key per role, QR code | Medium | Idea | Strong, high |
| F-003 | Feature | One admin page for all games: on/off/until, private only, emergency stop | Medium | Idea | Strong, high |
| F-004 | Feature | Automatic daily budget per game | Medium | Proposal | Standard |
| F-005 | Feature | Critical ST8 needs: posts on a shared ship, targeted messages, snapshots for rejoin | Medium | Idea; first real user (2026-11-15) | Strong, high |
| F-006 | Feature | Host-run rooms: one player's browser runs the game, the server relays, and another player takes over if the host drops | Medium | Idea | Strong, high |
| F-007 | Feature | Room-wide pause and a grace period before a lost player counts as gone | Medium | Idea | Standard |
| F-008 | Feature | Usage on the admin page: today/this month per game, free or paid plan, estimated cost and a monthly spending cap | Medium | Idea | Standard |
| D-009 | Design | Versions and updates: how games get new versions and bug fixes without breaking | High | Approved by the owner (2026-11-15); set up in the first build run | Strong, high |

## Done

| ID | Type | Title | Done |
| --- | --- | --- | --- |

## Proposed runs (2026-11-15)

- **A** – strong model, high level – Room server for Critical ST8
  - F-001 – Build the room server core and browser client (rooms, codes, seats, reconnection, late join, kick and ban) on Cloudflare, so Critical ST8 can be played online and later games reuse a proven base.
  - F-006 – Let one player's browser run the game while the server only relays, with automatic takeover if that player drops, so the free plan lasts many hours of play a day.
  - F-005 – Add free switching between posts, messages to one player or a group, and full-state snapshots for players who join or come back, so Critical's crew play works.
  - F-007 – Add a pause for everyone and a grace period before a dropped player counts as gone, as Critical's rules require.
  - F-002 – Add share links with a key per role and a QR code, so rooms can be shared safely and a viewer link cannot play.
  - D-009 – Set up version numbers, releases, the game's own copy and automatic bug-fix update proposals, so Critical and later games get fixes without breaking.
- **B** – strong model, high level – Administration and budget
  - F-003 – Add one admin page with on/off/until, private only and an emergency stop per game, so each game can be closed without touching the others.
  - F-004 – Give each game a share of the daily free budget that closes it for the day when used up, so one runaway game cannot stop the others.
  - F-008 – Show usage per game today and this month, with plan, estimated cost and an optional spending cap, so you can see when it is time to pay and never get a surprise bill.

Run A together with Critical ST8 F-040 (online mode), the first real user. Boomers F-002 follows.

## Details

### F-001 Room server core and browser client
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

### F-002 Secure share links
- Bricks already has private invitation links: a long random key in the part of the link the browser never sends to servers, expiry, revoke from admin, and the room code alone grants no access to a private room.
- The core generalizes this: one key per role (player, viewer/big screen, host), so a viewer link cannot play; each room chooses whether the code is enough (open room) or the key is required (private room); the host can renew a key, which stops old links at once while people already inside stay; optional expiry; QR code for the link.
- Covers Buzzy #348 (secret, renewable viewer link) and relates to Buzzy #331 (host sign-in).

### F-003 Administration
- One admin page for all games, building on today's Bricks admin Worker (opening hours, private invitations, sign-in by email link for approved addresses, no passwords; only the owner to begin with).
- One row per game (Boomers, Bricks, Buzzy, …) with On / Off / Until, plus a "private rooms only" mode where only invitation links work.
- Off: the server refuses new rooms and joins for that game at the first step, before any room is created, and the game shows "closed" instead of the button. Running games finish, as in Bricks today.
- Emergency stop: also closes running rooms of that game at once.
- An Off game costs almost nothing (one small refused request per attempt). Fully zero needs the game's route switched off in Cloudflare (manual).

### F-004 Daily budget per game (proposal 2026-11-13)
- All games share one Cloudflare account's daily free limits. Each game gets a share of the daily budget; a game that exceeds its share closes itself for the rest of the day, so one runaway game cannot take the others down.
- The admin page shows each game's usage today.

### F-005 Critical ST8 needs (updated 2026-11-15)
- Critical ST8 (https://github.com/BadBagel47/critical, the owner's top-down co-op space game) is the first real user, decided by the owner on 2026-11-15. Its online mode is F-040 and late join F-038 there; network preparations D-060, D-061, D-062 there.
- What the game already is (2026-11-15): playable solo end to end; up to three players online share one frigate on three posts (Captain, Gunner, Engineer) and may switch posts freely; solo starts as Captain. Boarding switches to a top-down on-foot view. Pure JavaScript without a build step, hosted on GitHub Pages, moving to Cloudflare when the engine is built in.
- The game logic is deterministic and separate from drawing and input: the whole game is one plain object (about 25 kB, about 3 kB changes all the time, measured 2026-11-14), stepped 60 times a second, and `stepPlayers()` takes each player's requests. That fits F-006 (one player's browser runs the game).
- Posts on a shared ship: a seat can be a post; players claim and switch posts freely, a post is held by at most one player, and the room tells everyone who holds what.
- Messages to one player or a group, not only to everyone: players on the ship and players boarding a station see different things, and the host decides who gets what. This also saves the daily budget.
- Snapshots for join and rejoin: a player who joins mid-game or comes back gets the full state once (about 25 kB), then only changes (F-038 there).
- Viewer seat for a big screen that watches without controlling (F-137 there), using the viewer role from F-001 and F-002.
- Saved games are text and stay in the players' browsers (save, export, import already exist). Storing a crew's save on the server is not needed now; revisit if the owner wants to continue a crew's game from any device.
- If the game later outgrows the free plan, see the plan decision in `docs/HANDOFF.md` and F-008.

### F-006 Host-run rooms (2026-11-15)
- One player's browser (the host) runs the game; the server only relays: players' inputs go to the host, the host's state changes go to the others. Recommended in Critical D-060.
- Much cheaper on the free plan than running the game on the server: the room can sleep between messages, and only messages into the server count (about 40 per second for three players, roughly 14 hours of play per day within the free limits; to be measured).
- Host takeover: if the host drops, the server picks another player, who continues from the latest full state; everyone gets a short pause while it happens (F-007).
- Fairness and cheating: the host could cheat; acceptable for a game among friends (same stance as Bricks).
- Server-run rooms stay possible for games that need them; each game chooses.

### F-007 Pause and grace period (2026-11-15)
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

### D-009 Versions and updates (approved by the owner 2026-11-15)
- Owner's question: can network-kit keep developing after games use it, and do bug fixes reach those games, without it becoming messy? Same need for `BadBagel47/geo-kit` (shared GPS module).
- Same model as `BadBagel47/geo-kit`, which already has version numbers, an automatic tagged release per version and projects pinned to a tag; geo-kit D-016 adds the same update proposals there.
- Version numbers: MAJOR.MINOR.PATCH. PATCH = bug fix only, safe to take; MINOR = new features, old code keeps working; MAJOR = something changes in a way games must adapt to (rare, with a short guide).
- Each game uses a fixed version and records it in its HANDOFF. Nothing changes in a game until it updates.
- Delivery: a copy of the client files inside each game's repository (e.g. `vendor/network-kit/`), made by a small workflow, not loaded from another site at run time (Critical's tests forbid loading from other services, and a copy keeps working even if something elsewhere breaks). The game's server part includes the same version.
- Bug fixes: when network-kit publishes a PATCH, each game gets an automatic update proposal (a branch with the new copy); it merges by itself only if the game's own tests pass, otherwise it waits and the owner is told. MINOR and MAJOR updates are taken in a normal run in that game.
- Order: fix in network-kit first, with a test that shows the bug; never patch the copy inside a game. A game that needs a quick workaround records it and removes it when the fix arrives.
- Keeping it tidy: no game-specific code in network-kit; a short changelog per version that says who is affected; old functions are marked as on their way out for at least one MINOR version before they are removed; network-kit's own tests include a small example game that every release must pass.
