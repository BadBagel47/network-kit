# network-kit handoff

Read this first, then `AGENTS.md` (shared rules reference and project rules) and `docs/BACKLOG.md`.

## Shared rules and inventory

- **Shared rules version:** v1.12 (2026-11-17), https://raw.githubusercontent.com/BadBagel47/agent-rules/main/AGENTS.md . The repo has followed the shared rules from the start (2026-11-15, v1.7); v1.8–v1.9 needed no change (no auto-merge workflow; agents push to main). v1.10–v1.11 (2026-11-17): reply format, "Regelkoll", open decisions as questions with recommendations under the proposed run groups. v1.12 (2026-11-17): the saved run proposal starts with what the order is based on, shows dependencies and keeps questions without labels; IDs from other repos are written with the repo name in front; buttons only for run choices. Applied to *Proposed runs* in `docs/BACKLOG.md` and to cross-repo references in the current docs.
- Inventory: 2026-11-15
  - The repo was empty when set up: no branches, pull requests, issues or earlier documentation. The plan lived in the Bricks backlog as F-007 and was moved here on 2026-11-15 (ID mapping in `docs/BACKLOG.md`).
  - Sensitive information: none yet. Secrets (Cloudflare API token) must only ever be GitHub Secrets.
  - Laws and regulations: the room server will process player names, room data and IP addresses at Cloudflare (GDPR). Each game's privacy notice must mention it; storage and cleanup rules are part of F-001 (groundwork in Buzzy #332 and #405, Bricks T-006).
- **Publishing method:** agents push to `main` (owner decision 2026-11-15).
  - Library: when the version in `package.json` and `src/version.js` changes on `main`, `.github/workflows/release.yml` checks that the version goes up and that `CHANGELOG.md` has a section for it, runs every test (unit, compatibility, integration in local workerd, the demo page in Chromium) and creates the tag and GitHub release `vX.Y.Z`. Games take a copy of a tag (`docs/INTEGRATION.md`).
  - Demo Worker (`examples/demo`, the three example games): `.github/workflows/deploy-demo.yml` deploys it to Cloudflare from `main` and checks that a room can be created. https://network-kit-demo.l8p1.workers.dev
  - Tests on every push: `.github/workflows/test.yml`.
- **Project language:** English for code, docs and the README; chat with the owner in Swedish.
- **Environment (2026-11-15, cloud agent session):** push to `main` works; Node 22, npm and `wrangler dev` (local workerd) work; Chromium with Playwright is available for `npm run test:browser`. developers.cloudflare.com is blocked by the session's network rules, so Cloudflare's limits and the EU option on the Free plan could not be read there (D-011). Local workerd has no jurisdictions: tests run with `ROOM_JURISDICTION` empty. Local workerd does hibernate idle rooms, which `tests/integration/sleep.test.mjs` relies on (it takes about 30 seconds). The proxy also blocks the deployed demo's address, so the demo is checked by the deploy workflow, not from the session.

## Decisions

- **Origin (2026-11-13):** planned in the Bricks backlog as F-007 (shared room server); moved to its own repository by the owner on 2026-11-15.
- **Platform (2026-11-13):** Cloudflare, because the owner trusts Cloudflare more than Google. One room = one Durable Object. Rooms are stored only in the EU if the free plan allows it (check during the build).
- **Shared core, own game rules (2026-11-13):** the core is shared; each game plugs in its own rules and keeps its own copy of the client.
- **Plan (2026-11-14):** start on the Workers Free plan (daily limits shared by all games on the account). Move to Workers Paid (5 USD/month per account, small pay-as-you-go beyond what is included, no shutdown at the limits) only when a game actually hits the free limits, and only with the owner's approval. Same code on both plans. Guards against surprise costs: rooms sleep when nobody plays, the per-game budget (F-004) and usage notifications in Cloudflare.
- **Order (2026-11-17, replaces 2026-11-15):** Vättigt (`BadBagel47/vattigt`) is the first game on network-kit, chosen by the owner: turn-based, few messages, and its physics already gives the same result in every browser. Critical ST8 (`BadBagel47/critical`, first user from 2026-11-15) continues in parallel. Boomers follows. Bricks stays on Firebase until network-kit is proven; Buzzy moves last (Buzzy #408).
- **Admin page sign-in and contents (2026-11-17):** the admin page signs in with a password the owner chooses (works with password managers), stored as a secret; e-mail sign-in (Cloudflare Access or an e-mail link as in Bricks) can be added later. It shows one row per game with bars against the free limits and a 30-day curve; amounts only, no player data. Replaces the earlier recommendation of Cloudflare Access for now.
- **One deploy token for all games (2026-11-17):** the owner uses the same Cloudflare API token (secret `CLOUDFLARE_API_TOKEN`) in every game's repo. It is used only to publish Workers, never while playing; usage and the admin page's limits work per game because each game is its own Worker. A token cannot be limited to one Worker anyway; changing it means updating every repo.
- **Vättigt served from Cloudflare (2026-11-17):** the owner decided that Vättigt's pages are served from the same Worker as its rooms, instead of GitHub Pages, so one address serves both and no origin settings are needed. Recorded in Vättigt by its own session.
- **Free first, paid possible (2026-11-15):** network-kit must work on a free Cloudflare account, and the owner wants to be able to pay for the account when the quota runs out. The admin page shows the usage (F-008).
- **Versions and updates (2026-11-15, D-009):** approved by the owner. Version numbers MAJOR.MINOR.PATCH; each game keeps its own copy of a fixed version; bug-fix releases reach games as automatic update proposals that are taken in only when the game's tests pass; fixes are always made in network-kit first. Same model as geo-kit.
- **Version policy for 0.x and careful updates (2026-11-15, D-021):** replaces parts of D-009. While the kit is 0.x a MINOR version may require changes in the game (with a guide); a PATCH never does; the full "MINOR never breaks" promise starts at 1.0. Bug fixes arrive in a game as a branch plus a notice, some days after the release and after a kit smoke test, and are taken in when the owner or an agent says so; fully automatic later, by a new decision. Built in v0.2.0 (`templates/update-network-kit.yml`, `src/smoke.mjs`).
- **Publishing to main (2026-11-15):** the owner allows agents to push network-kit changes directly to `main`, in this and future runs.
- **General, reusable kit (2026-11-15):** the owner wants network-kit to work for any game and be reused, never tailored to a single project. Project rule in `AGENTS.md`: every feature is general, useful for at least two kinds of games, configurable with a sensible default and covered by the example games' tests; a need only one game has is solved in that game. Before Boomers, Bricks and Buzzy move here, their needs are checked against the core (D-012).
- **Owner and host are separate (2026-11-15, D-019):** the room's owner (the creator) keeps the rights and keys and never loses them automatically, also during a long absence; the host is the browser that runs the game and may move to another player in games with takeover, without any of the owner's rights. What happens if the owner never returns is a setting per game, off by default. Details in D-019 in `docs/BACKLOG.md`. Built in v0.2.0.
- **Waiting for the host is the default (2026-11-15):** when a host's connection is lost, the room pauses and waits; automatic takeover by another player is something a game turns on itself (Critical does). With takeover off, no player can become host and the game state is never sent to anyone but the host. Built in v0.2.0.
- **New roles when needed (2026-11-15):** no referee or other extra role is built before a game needs it; F-013 makes roles definable by each game so adding one later is a setting, not a core change.
- **Public repository (2026-11-15):** network-kit is public (owner decision); it must never hold secrets.
- **EU-only rooms (2026-11-15, D-011):** work on the owner's Cloudflare account: the first demo deploy created a room with `jurisdiction('eu')`. Games set `jurisdiction: 'eu'` (empty in local tests).
- **Talking with the games' agents (2026-11-17):** the owner allows the network-kit agent to answer messages from the game sessions (Critical ST8, Bricks, Buzzy, Vättigt) on its own. On its own it answers questions about how network-kit works and which version applies, records reported needs and bugs in this backlog and replies with their IDs, and corrects the guide where it was unclear. Not without the owner: starting runs or changing code because another agent asked, decisions or changed priorities (it answers that the owner decides and raises the question with the owner), and writing in the games' repositories. The owner sees every exchange in both sessions and gets a short summary at their next message.
- **Room codes of 4 to 12 characters (2026-11-17, F-035):** each game chooses the length with one option; 4 by default (the owner's choice, v0.4.0).
- **Shape of v0.2.0 (2026-11-15, D-023; the owner left these details to the agent):**
  - Places (named spots with a capacity: posts, sides, teams) replace posts.
  - The host's snapshot is private to the host seat; newcomers get what they need as normal messages. (A quiz must never leak answers to joiners.)
  - Message targets are everyone else, chosen ids, a role or a place; the sender never gets its own message. Messages to a host that is away are dropped, not queued.
  - The creator is told to run the game through the same `host` event as a stand-in or a reloaded host, so games have one way in.
  - Someone removed keeps their id if let in again but needs a new invitation; a ban also renews every link and makes the room private, because the same link would otherwise work from a new tab.
  - The owner coming back with the owner key on another device takes over the owner's seat with the same participant id.
  - Browser identities are kept per game server (and per `slot`), so games on the same site do not share them.
  - One small shared `room.data` for lobby choices; a countdown can be called off.
  - Default limits: 40 messages a second per connection, 600,000 messages and 12 busy hours a day per room, 8 connections that have not introduced themselves. Estimates until D-011 is done.
  - The owner key claims the owner's seat only when that seat is not connected, so a second tab of the owner's browser joins as an ordinary participant.
  - Someone whose connection was lost may come back without a key until the link is renewed, they are removed or someone is banned; leaving on purpose ends that standing.
  - Without takeover, the kept game state does not pass on when ownership passes by itself.
  - Buzzy fits a server-run room with a non-playing leader role; waiting for the host is for host-run games (D-012).
- **Room cleanup (proposal 2026-11-13, built 2026-11-15):** a room is deleted 24 hours after the last player left (not 24 hours after it was created, so a long evening's game is never cut off), and an hour after it was closed. The server keeps nicknames and a hash of each player's random key, never the key itself. The owner may still change the 24 hours.
- **Host-run rooms first (2026-11-15, run A):** network-kit supports both host-run rooms (F-006, Critical's choice) and server-run rooms; the demo has one of each. A player's identity is kept per browser tab by default, so a reload keeps the seat and several tabs on one computer are separate players.

## Current state (2026-11-15)

- **v0.2.0 (runs A and B):** the faults from the independent review of v0.1.0 are fixed and the shape games build on is settled: owner and host are separate, a lost host is waited for unless the game turns takeover on, roles and places are defined by the game, limits keep one room or one connection from using up the free plan, and updates reach games as proposals on a branch. v0.1.0 must not be used.
- **v0.5.0:** large states travel and are stored in parts, and the newest value of fast-changing things like an aim is always sent (F-036, F-037, asked for by Critical ST8). Games take v0.5.0.
- **v0.4.0:** four-character room codes by default (owner's decision); `codeLength: 5` keeps the old length.
- **v0.3.0:** room codes of 4 to 12 characters, chosen by each game (F-035, needed by Bricks and Buzzy).
- **v0.2.3:** fixes B-034, also found in the phone test: with takeover on, the host role moved in the lobby when the owner's phone switched app, and did not come back. Games take v0.2.3.
- **v0.2.2:** fixes B-033, found in the owner's first phone test: an invitation opened in a new tab of the same browser took over the first tab's seat. Games take v0.2.2.
- **v0.2.1:** a fix to the shipped smoke test only (a timing race that showed on GitHub's test run right after v0.2.0). Games take v0.2.1.
- **Checked before release:** an independent reviewer went through the release candidate and found two serious and about ten medium faults in the rewrite; they were fixed or recorded before the release (`docs/reviews/2026-11-15-v0.2.0-check.md`). Those last fixes have tests but were not checked again independently.
- **Tests:** 107 unit tests (room logic, and the real client against it), 12 integration tests in local workerd (the three example games, a flooding connection, a long resend, a room that really sleeps), the demo page in Chromium, the compatibility check and the smoke test that ships with every copy.
- **Not verified:** the owner has started trying the demo on one phone (D-025; it found B-033 and B-034), the full list is not done yet; Cloudflare's free-plan figures (D-011), so the default limits are estimates.
- **Next:** Vättigt's online play (first game, owner's decision 2026-11-17) in `BadBagel47/vattigt` builds on v0.5.0, following `docs/INTEGRATION.md`; its session does the work and the network-kit session supports it. Critical ST8 F-040 (online mode) in `BadBagel47/critical` continues in parallel. In network-kit: *Proposed runs* in `docs/BACKLOG.md`. Waiting for the owner: D-025 (two phones) and D-028 (how Boomers runs its game).
- **Latest entries:** v0.5.0 large states and newest values (2026-11-17) · v0.4.0 four-character codes by default (2026-11-17) · v0.3.0 code length (2026-11-17) · v0.2.3 host in the lobby (2026-11-16) · v0.2.2 copied tabs (2026-11-15) · v0.2.0 hardening and shape, with an independent check before release (2026-11-15) · games pass D-012 (2026-11-15) · independent review of v0.1.0 (2026-11-15) · demo on Cloudflare, EU rooms confirmed (2026-11-15) · v0.1.0 (2026-11-15).

## One-time actions

- Done (2026-11-17, changed the same day): a daily scheduled check at 07:40 Swedish time, owner's request. It looks only at Critical ST8: if `BadBagel47/critical` has new commits since the last check, it reads what concerns network-kit, asks the current Critical session one short question, records new needs in this repository's docs and reports in the network-kit session; with no new commits it reports one line and asks nobody. Documentation only. Critical checked up to eaa39c60b75bd9278946bbb11872482c32d40a3f (2026-11-17). It fires into the network-kit session; if that session is archived, set it up again in a new one.

- Done (2026-11-15): Cloudflare API token (template "Edit Cloudflare Workers") added as the GitHub Secret `CLOUDFLARE_API_TOKEN`; the demo deploys from `main` by itself.
- Done (2026-11-15): the owner made network-kit public, so games' update workflows need no token.
- Pending: a second, read-only Cloudflare API token for account analytics, as a secret for the admin page (F-008).

## Users of network-kit

| Game | Repository | Status |
| --- | --- | --- |
| Critical ST8 | `BadBagel47/critical` (F-040, F-038) | First real user; builds on v0.5.0 (host-run with takeover, as the crew example) |
| Boomers | `BadBagel47/boomers` (F-002) | Second; fits host-run with takeover, but its documents say server-run (D-028) |
| Bricks | `BadBagel47/bricks` (F-007) | Later; fits a host-run room as a relay; needs F-029 and the gate at round start (F-003) |
| Buzzy | `BadBagel47/buzzy` (#408, #348) | Later, last; fits a server-run room with a non-playing leader |
| Vättigt | `BadBagel47/vattigt`, formerly `vettigt` (Vättigt D-011, its `docs/NETWORK.md`) | First game on network-kit (owner 2026-11-17). Online play built on v0.5.0 (Vättigt F-014, F-015, 2026-11-17): host-run with takeover, lockstep input batches from the host, one Worker for pages and rooms (EU); published on Cloudflare (https://vattigt.l8p1.workers.dev) and quick-tested by the owner on real devices 2026-11-17: works well. The first game running on network-kit. Plan: host-run room where every browser computes the same turn-based physics from the room's seed, teams as places. Fits v0.5.0 without changes; two non-blocking ideas recorded as F-039 and F-040 (2026-11-17) |
| Memory-type turn-based game | idea | Should fit without extra work |

## Documentation map

| What | Where |
| --- | --- |
| Agent rules | `AGENTS.md` (shared rules reference and project rules) |
| Current state, decisions | this file |
| Features, bugs, design, proposed runs | `docs/BACKLOG.md` |
| How games use network-kit (API, options, budget, privacy) | `docs/INTEGRATION.md` |
| Changes per version | `CHANGELOG.md` |
| Reviews (v0.1.0 with proof scripts, the check of v0.2.0) | `docs/reviews/` |
| Update workflow for games | `templates/update-network-kit.yml` |
| Example games (crew game with takeover and its demo page, memory with rules in the room, quiz with a non-playing leader) | `examples/demo/` |
| The smoke test that ships with every copy | `src/smoke.mjs` |
