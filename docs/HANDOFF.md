# network-kit handoff

Read this first, then `AGENTS.md` (shared rules reference and project rules) and `docs/BACKLOG.md`.

## Shared rules and inventory

- **Shared rules version:** v1.9 (2026-11-15), https://raw.githubusercontent.com/BadBagel47/agent-rules/main/AGENTS.md . The repo has followed the shared rules from the start (2026-11-15, v1.7); v1.8–v1.9 needed no change (no auto-merge workflow; agents push to main).
- Inventory: 2026-11-15
  - The repo was empty when set up: no branches, pull requests, issues or earlier documentation. The plan lived in the Bricks backlog as F-007 and was moved here on 2026-11-15 (ID mapping in `docs/BACKLOG.md`).
  - Sensitive information: none yet. Secrets (Cloudflare API token) must only ever be GitHub Secrets.
  - Laws and regulations: the room server will process player names, room data and IP addresses at Cloudflare (GDPR). Each game's privacy notice must mention it; storage and cleanup rules are part of F-001 (groundwork in Buzzy #332 and #405, Bricks T-006).
- **Publishing method:** not set up yet. Planned: a Cloudflare Worker with Durable Objects deployed from `main` by a GitHub Actions workflow, using a Cloudflare API token stored as a GitHub Secret.
- **Project language:** English for code, docs and the README; chat with the owner in Swedish.
- **Environment:** not checked yet (no build run so far).

## Decisions

- **Origin (2026-11-13):** planned in the Bricks backlog as F-007 (shared room server); moved to its own repository by the owner on 2026-11-15.
- **Platform (2026-11-13):** Cloudflare, because the owner trusts Cloudflare more than Google. One room = one Durable Object. Rooms are stored only in the EU if the free plan allows it (check during the build).
- **Shared core, own game rules (2026-11-13):** the core is shared; each game plugs in its own rules and keeps its own copy of the client.
- **Plan (2026-11-14):** start on the Workers Free plan (daily limits shared by all games on the account). Move to Workers Paid (5 USD/month per account, small pay-as-you-go beyond what is included, no shutdown at the limits) only when a game actually hits the free limits, and only with the owner's approval. Same code on both plans. Guards against surprise costs: rooms sleep when nobody plays, the per-game budget (F-004) and usage notifications in Cloudflare.
- **Order (2026-11-15):** Critical ST8 (`BadBagel47/critical`) is the first real user, chosen by the owner. Boomers follows (earlier plan, 2026-11-13: Boomers first). Bricks stays on Firebase until network-kit is proven; Buzzy moves last (Buzzy #408).
- **Free first, paid possible (2026-11-15):** network-kit must work on a free Cloudflare account, and the owner wants to be able to pay for the account when the quota runs out. The admin page shows the usage (F-008).
- **Room cleanup (proposal 2026-11-13):** rooms are deleted automatically after 24 hours; the server keeps only nicknames. To confirm in the first build run.

## Current state (2026-11-15)

- Planning only, no code. Requirements are in `docs/BACKLOG.md`.
- Next: the first build run (see *Proposed runs* in `docs/BACKLOG.md`), together with Critical ST8 F-040 (online mode).

## One-time actions

- Pending: add the Cloudflare API token as a GitHub Secret in this repo (same kind of token as the Bricks admin Worker uses) when the first build run asks for it.
- Pending: a second, read-only Cloudflare API token for account analytics, as a secret for the admin page (F-008).

## Users of network-kit

| Game | Repository | Status |
| --- | --- | --- |
| Critical ST8 | `BadBagel47/critical` (F-040, F-038) | First real user; needs F-005, F-006, F-007 |
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
