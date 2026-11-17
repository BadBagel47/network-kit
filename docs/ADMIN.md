# Admin page

The admin page shows how much of Cloudflare's free plan the games use, per game and per day (F-008). It is its own Worker, `network-kit-admin`, in `admin/`, deployed by `.github/workflows/deploy-admin.yml` from `main`. It reads only Cloudflare's usage figures; it never touches the games' rooms.

## What it shows

- **Today on the whole account:** each free daily limit with today's use (UTC day; the limits are per account and reset at 00:00 UTC).
- **Per game:** one row per Worker with today's, yesterday's or this month's figures and a bar against the daily free limit (for a month, the average day).
- **Last 30 days:** one line per game for a chosen figure, with a table view.

Figures (limits checked 2026-11-17 in Cloudflare's documentation, D-011; `admin/limits.js`):

| Figure | Free plan | Source in Cloudflare's analytics |
| --- | --- | --- |
| Worker requests | 100,000 a day | `workersInvocationsAdaptive` `sum.requests` |
| Room requests | 100,000 a day | `durableObjectsInvocationsAdaptiveGroups` `sum.requests` (incoming WebSocket messages are billed at 1 in 20, so billing is lower than the count) |
| Room time | 13,000 GB-s a day | `durableObjectsPeriodicGroups` `sum.activeTime` (µs × 128 MB), or `sum.duration` |
| Rows read | 5 million a day | `durableObjectsPeriodicGroups` `sum.rowsRead` |
| Rows written | 100,000 a day | `durableObjectsPeriodicGroups` `sum.rowsWritten` |
| Stored data | 5 GB in total | `durableObjectsStorageGroups` `max.storedBytes` |

Cloudflare does not document every field of these datasets, so the page asks the API which fields exist (introspection) and builds its queries from them. A dataset that is missing or refused leaves a note under *About the figures*; the rest still shows. After each deploy, `scripts/admin-check.mjs` runs the real queries and writes what it found in the workflow's summary.

## Sign-in

- One password, chosen by the owner, stored as the GitHub secret `ADMIN_PASSWORD` (at least 12 characters) and copied to the Worker by the deploy. Changing the secret and deploying again signs everyone out.
- The sign-in form is a normal form, so password managers offer to save and fill the password.
- A signed-in browser stays signed in for 30 days (a signed, HttpOnly cookie).
- After 5 wrong passwords from one address, that address must wait 1 minute, then 2, 4 … up to a day; a right password clears it.
- E-mail sign-in can be added later in front of the page (Cloudflare Access) or as an e-mail link like Bricks', without rebuilding the page.

## Secrets

| GitHub secret | What | Needed for |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | the deploy token all games use | deploying |
| `ADMIN_PASSWORD` | the page's password | signing in |
| `CLOUDFLARE_ANALYTICS_TOKEN` | a read-only Cloudflare token with *Account Analytics: Read* and *Workers Scripts: Read* | the figures; the second permission names the games when Cloudflare reports rooms per namespace |
| `CLOUDFLARE_ACCOUNT_ID` | optional | found with the deploy token when missing |

## Later (F-008, F-004, F-003)

Plan and estimated cost, a spending cap, a daily budget per game and on/off controls are not built yet.
