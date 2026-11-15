# network-kit handoff

Read this first, then `AGENTS.md` (shared rules reference and project rules) and `docs/BACKLOG.md`.

## Shared rules and inventory

- **Shared rules version:** v1.9 (2026-11-15), https://raw.githubusercontent.com/BadBagel47/agent-rules/main/AGENTS.md . The repo has followed the shared rules from the start (2026-11-15, v1.7); v1.8–v1.9 needed no change (no auto-merge workflow; agents push to main).
- Inventory: 2026-11-15
  - The repo was empty when set up: no branches, pull requests, issues or earlier documentation. The plan lived in the Bricks backlog as F-007 and was moved here on 2026-11-15 (ID mapping in `docs/BACKLOG.md`).
  - Sensitive information: none yet. Secrets (Cloudflare API token) must only ever be GitHub Secrets.
  - Laws and regulations: the room server will process player names, room data and IP addresses at Cloudflare (GDPR). Each game's privacy notice must mention it; storage and cleanup rules are part of F-001 (groundwork in Buzzy #332 and #405, Bricks T-006).
- **Publishing method:** agents push to `main` (owner decision 2026-11-15).
  - Library: when the version in `package.json` and `src/version.js` changes on `main`, `.github/workflows/release.yml` runs the tests and creates the tag and GitHub release `vX.Y.Z`. Games take a copy of a tag (D-009, `docs/INTEGRATION.md`).
  - Demo Worker (`examples/demo`, the example games): `.github/workflows/deploy-demo.yml` deploys it to Cloudflare from `main` and checks that a room can be created. It is skipped until the secret `CLOUDFLARE_API_TOKEN` exists (one-time action below).
  - Tests on every push: `.github/workflows/test.yml` (unit + integration).
- **Project language:** English for code, docs and the README; chat with the owner in Swedish.
- **Environment (2026-11-15, cloud agent session):** push to `main` works; Node 22, npm and `wrangler dev` (local workerd) work; Chromium with Playwright is available for `npm run test:browser`. developers.cloudflare.com is blocked by the session's network rules, so Cloudflare's limits and the EU option on the Free plan could not be read there (D-011). Local workerd has no jurisdictions: tests run with `ROOM_JURISDICTION` empty.

## Decisions

- **Origin (2026-11-13):** planned in the Bricks backlog as F-007 (shared room server); moved to its own repository by the owner on 2026-11-15.
- **Platform (2026-11-13):** Cloudflare, because the owner trusts Cloudflare more than Google. One room = one Durable Object. Rooms are stored only in the EU if the free plan allows it (check during the build).
- **Shared core, own game rules (2026-11-13):** the core is shared; each game plugs in its own rules and keeps its own copy of the client.
- **Plan (2026-11-14):** start on the Workers Free plan (daily limits shared by all games on the account). Move to Workers Paid (5 USD/month per account, small pay-as-you-go beyond what is included, no shutdown at the limits) only when a game actually hits the free limits, and only with the owner's approval. Same code on both plans. Guards against surprise costs: rooms sleep when nobody plays, the per-game budget (F-004) and usage notifications in Cloudflare.
- **Order (2026-11-15):** Critical ST8 (`BadBagel47/critical`) is the first real user, chosen by the owner. Boomers follows (earlier plan, 2026-11-13: Boomers first). Bricks stays on Firebase until network-kit is proven; Buzzy moves last (Buzzy #408).
- **Free first, paid possible (2026-11-15):** network-kit must work on a free Cloudflare account, and the owner wants to be able to pay for the account when the quota runs out. The admin page shows the usage (F-008).
- **Versions and updates (2026-11-15, D-009):** approved by the owner. Version numbers MAJOR.MINOR.PATCH; each game keeps its own copy of a fixed version; bug-fix releases reach games as automatic update proposals that are taken in only when the game's tests pass; fixes are always made in network-kit first. Same model as geo-kit.
- **Version policy for 0.x and careful updates (2026-11-15, D-021):** replaces parts of D-009. While the kit is 0.x a MINOR version may require changes in the game (with a guide); a PATCH never does; the full "MINOR never breaks" promise starts at 1.0. Bug fixes arrive in a game as a branch plus a notice, some days after the release and after a kit smoke test, and are taken in when the owner or an agent says so; fully automatic later, by a new decision. Built in run B; the template in v0.1.0 still pushes to `main` and must not be turned on in a game.
- **Publishing to main (2026-11-15):** the owner allows agents to push network-kit changes directly to `main`, in this and future runs.
- **General, reusable kit (2026-11-15):** the owner wants network-kit to work for any game and be reused, never tailored to a single project. Project rule in `AGENTS.md`: every feature is general, useful for at least two kinds of games, configurable with a sensible default and covered by the example games' tests; a need only one game has is solved in that game. Before Boomers, Bricks and Buzzy move here, their needs are checked against the core (D-012).
- **Waiting for the host is the default (2026-11-15):** when a host's connection is lost, the room pauses and waits; automatic takeover by another player is something a game turns on itself (Critical does). With takeover off, no player can become host and the game state is never sent to anyone but the host. Built in F-013; v0.1.0 still always takes over in host-run rooms.
- **New roles when needed (2026-11-15):** no referee or other extra role is built before a game needs it; F-013 makes roles definable by each game so adding one later is a setting, not a core change.
- **Public repository (2026-11-15):** network-kit is public (owner decision); it must never hold secrets.
- **EU-only rooms (2026-11-15, D-011):** work on the owner's Cloudflare account: the first demo deploy created a room with `jurisdiction('eu')`. Games set `jurisdiction: 'eu'` (empty in local tests).
- **Room cleanup (proposal 2026-11-13, built 2026-11-15):** a room is deleted 24 hours after the last player left (not 24 hours after it was created, so a long evening's game is never cut off), and an hour after it was closed. The server keeps nicknames and a hash of each player's random key, never the key itself. The owner may still change the 24 hours.
- **Host-run rooms first (2026-11-15, run A):** network-kit supports both host-run rooms (F-006, Critical's choice) and server-run rooms; the demo has one of each. A player's identity is kept per browser tab by default, so a reload keeps the seat and several tabs on one computer are separate players.

## Current state (2026-11-15)

- **v0.1.0 built (run A):** room server core and browser client (F-001), share links with a key per role and QR codes (F-002), Critical's needs: posts, targeted messages, snapshots (F-005), host-run rooms with takeover (F-006), pause and grace period (F-007), versions and updates (D-009). 32 unit tests, 8 integration tests against local workerd and a browser test of the demo page pass. Released as tag `v0.1.0` by the release workflow; the Test and Release workflows passed on GitHub on 2026-11-15. The demo deploy ran and skipped itself (no token yet).
- **Demo on Cloudflare (2026-11-15):** https://network-kit-demo.l8p1.workers.dev (host-run demo page; the memory example under `/turns`). Deployed by `deploy-demo.yml`, whose check passed: the Worker answers and a room can be created with EU-only storage on the owner's account. Not yet opened on a phone.
- **Reviewed (2026-11-15):** an independent review of v0.1.0 found real faults (state lost when a room sleeps, reconnect faults, a client stuck offline, no protection against uninvited connections or runaway cost) and design points to settle before games depend on them. Report: `docs/reviews/2026-11-15-v0.1.0.md`; tracked as B-014 to B-027 in `docs/BACKLOG.md`. **v0.1.0 should not go live in a game.**
- **Next:** runs A (fix the faults) and B (settle the shape) in `docs/BACKLOG.md`, then a release. Critical ST8 F-040 may start its integration work in parallel but should not go live before that. Decision waiting for the owner: D-019 (owner and host). D-021 is decided.

## One-time actions

- Done (2026-11-15): Cloudflare API token (template "Edit Cloudflare Workers") added as the GitHub Secret `CLOUDFLARE_API_TOKEN`; the demo deploys from `main` by itself.
- Done (2026-11-15): the owner made network-kit public, so games' update workflows need no token.
- Pending: a second, read-only Cloudflare API token for account analytics, as a secret for the admin page (F-008).

## Users of network-kit

| Game | Repository | Status |
| --- | --- | --- |
| Critical ST8 | `BadBagel47/critical` (F-040, F-038) | First real user; integration can start with v0.1.0, go live only after runs A and B (review 2026-11-15) |
| Boomers | `BadBagel47/boomers` (F-002) | Second |
| Bricks | `BadBagel47/bricks` (F-007) | Later |
| Buzzy | `BadBagel47/buzzy` (#408, #348) | Later, last |
| Memory-type turn-based game | idea | Should fit without extra work |

## Documentation map

| What | Where |
| --- | --- |
| Agent rules | `AGENTS.md` (shared rules reference and project rules) |
| Current state, decisions | this file |
| Features, bugs, design, proposed runs | `docs/BACKLOG.md` |
| How games use network-kit (API, options, budget, privacy) | `docs/INTEGRATION.md` |
| Changes per version | `CHANGELOG.md` |
| Reviews and their proof scripts | `docs/reviews/` |
| Update workflow for games | `templates/update-network-kit.yml` |
| Example games (host-run demo page, server-run memory) | `examples/demo/` |
