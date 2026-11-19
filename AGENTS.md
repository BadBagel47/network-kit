# Agent instructions

Follow the shared agent rules at
https://raw.githubusercontent.com/BadBagel47/agent-rules/main/AGENTS.md
(repo `BadBagel47/agent-rules`; fetch it via GitHub if the link cannot be read).
Read them at the start of every session.

- Current state, decisions and next steps: [docs/HANDOFF.md](docs/HANDOFF.md).
- Backlog (features, bugs, design, proposed runs): [docs/BACKLOG.md](docs/BACKLOG.md).

## Project rules (network-kit)

Owner decisions behind these rules are recorded under *Decisions* in `docs/HANDOFF.md`.

- network-kit is the shared multiplayer room server and client for the owner's hobby games (Critical ST8 first, then Boomers, later Bricks, Buzzy and others).
- The core handles rooms, codes, joining, roles and seats, reconnection and share links; opening hours and administration are planned (F-003). Game rules live in each game's own repository and plug into the core; the core never contains one game's rules.
- Every feature in network-kit must be general: described without naming a single game, useful for at least two kinds of games, configurable with a sensible default, and covered by the example games' tests. A need that only one game has is solved in that game.
- Games use a versioned copy of the client and update when it suits them, so a change here never breaks all games at once.
- Runs on the Cloudflare Workers Free plan. No paid plan or billing upgrade without the owner's approval.
- Keep the daily free budget in mind in every design: rooms sleep when nobody plays, inputs are sent only when they change, and each game has its own share of the budget.
- **Development branch and preview (owner 2026-11-19, Q10–Q12):** code changes go to the branch `develop`, never straight to `main`. Every push to `develop` runs the tests and deploys a preview at https://nk-admin-preview.trythis.one and https://nk-demo-preview.trythis.one (separate Workers with storage of their own). Only when the owner says **"Publicera"** is `develop` brought into `main`, which deploys the real admin page and demo and releases the version. Documentation (the backlog, the handoff) still goes straight to `main`, so other agents see what is in progress; bring `main` into `develop` before work there, so the two do not drift apart.
