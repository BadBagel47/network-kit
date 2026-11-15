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
| F-005 | Feature | Space-game extensions: roles on a shared ship, areas, server simulation, saved progress | Low | Idea; build when the space game needs it | Strong, high |

## Done

| ID | Type | Title | Done |
| --- | --- | --- | --- |

## Proposed runs (2026-11-15)

- **A** – strong model, high level – Room server for Boomers
  - F-001 – Build the room server core and browser client (rooms, codes, seats, reconnection, late join, kick and ban) on Cloudflare, so Boomers can play online and later games reuse a proven base.
  - F-002 – Add share links with a key per role and a QR code, so rooms can be shared safely and a big-screen link cannot play.
  - F-003 – Add one admin page with on/off/until, private only and an emergency stop per game, so each game can be closed without touching the others.
  - F-004 – Give each game a share of the daily free budget that closes it for the day when used up, so one runaway game cannot stop the others.

Run together with Boomers F-002 (online play), which is the first real user.

Not yet proposed: F-005 (when the space game needs it).

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

### F-005 Space-game extensions (owner brief 2026-11-14)
- The owner's top-down co-op space game: several players crew one ship (steering, systems, shooting), upgrade it in a shop, board other ships and take over bases. Boarding switches to a top-down on-foot view where several players loot together against enemies and turrets. Repository not linked here yet.
- Roles on a shared object: players take stations (pilot, gunner, systems) on one ship; the server decides who controls what.
- Several areas in one session: some players on the ship while others board another ship or base. Each player only receives updates for the area they are in, which also saves the daily budget.
- Many moving things (enemies, turrets, shots): the server runs the simulation and sends compact changes, not full state.
- Progress that outlives a room: credits, upgrades and captured bases saved per crew between sessions.
- Heaviest user of the daily free budget: inputs only when they change; F-004 matters most here. If it outgrows the free plan, see the plan decision in `docs/HANDOFF.md`.
- F-001 must be designed so these fit later without rework; build them only when the space game needs them.
