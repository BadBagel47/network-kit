# What is on its way out, and which versions games use

Owner's decision 2026-11-19: something is removed only when no game still uses it, and the list is checked regularly so clean-ups happen. How (also in `docs/HANDOFF.md` under *Decisions*):

1. It is first marked as on its way out (here, and *deprecated* in `docs/INTEGRATION.md`).
2. Before removing, check which network-kit versions are in use: the game cards on the admin page show the version each connected game reports, and the table below lists the games' copies (check their repositories, `vendor/network-kit/VERSION` or the update workflow's issues).
3. It is removed in a release whose changelog says so (with an upgrade guide for a game's own copy). `tests/compat/gameapi.mjs` then only covers the versions still in use.

**When to check:** at every MINOR release, and in the monthly check (see *One-time actions* in `docs/HANDOFF.md`). Update the tables then.

## Versions in use (2026-11-19)

| Game | network-kit in its copy | Uses the admin page | Uses Playtest |
| --- | --- | --- | --- |
| Vättigt | 0.5.0 | no (before the admin page) | no |
| Bricks | 0.13.4 (0.15.1 recommended) | yes | no |
| Critical ST8 | none yet (0.15.1 planned, its D-288) | not yet | planned |
| Buzzy | none yet | – | – |
| The demo (`examples/demo`) | the current version | yes | yes |

## On its way out

| What | Marked | Still used by | Remove when | Item |
| --- | --- | --- | --- | --- |
| Playtest paths without a version (`/playtest/check`, `/report`, `/image`, `/upload-key`, `/read`, `/keep`) | 0.15.0 | nothing (only 0.14.x copies used them; no game took 0.14) | now | F-114 |
| Playtest data from 0.14.0 in the admin page's main store (`tst:`, `rep:`, `img:`, `ptn:` keys from before the own store) | 0.14.1 | nothing | now | F-114 |
| The `gate` option of `createRoomServer` (use `admin`) | 0.15.1 | no game known; check before removing | 1.0, or earlier when no copy uses it | – |
| Stored rooms of shape 1 (`STATE_DROPPED`) | 0.2.0 | nothing | already closed; keep the entry | – |

## Removed

| What | Removed in | Note |
| --- | --- | --- |
| – | | |
