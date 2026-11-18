# Admin page

The admin page shows how much of Cloudflare's free plan the games use, per game and per day, and switches games on and off (F-003, F-004, F-008). It is its own Worker, `network-kit-admin`, in `admin/`, deployed by `.github/workflows/deploy-admin.yml` from `main`. It reads Cloudflare's usage figures and keeps its settings in a small Durable Object (`AdminStore`); games ask it whether they are open.

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

Rooms are tied to their game through the Durable Object namespace (Cloudflare does not always fill in the Worker name for room requests); Worker requests that Cloudflare reports without a name get their own row, *Not named by Cloudflare*. Stored data is only reported for the whole account.

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

## Games: on, off, budget (F-003, F-004, F-008, F-026)

The *Games* section has one row per game (each game is a Worker; its name is the Worker's name, as in the usage figures):

- **Mode:** On, Off, or Off until a time. Off refuses new rooms, newcomers and new rounds (also rematches); running games finish, and participants who were already in a room can come back.
- **Private only:** only invitation links let newcomers in; a room code alone does not.
- **Stop:** an emergency stop. Everyone is turned away and running rooms close within about 30 seconds.
- **Share %:** the game's share of each daily free limit. Empty means an equal share of what the other games leave.

Under *Account*:

- **Plan:** Free or Paid. On the Paid plan the page shows what this month would cost (5 USD a month plus what goes past the included amounts; prices checked 2026-11-18; Workers CPU time is not counted).
- **Monthly cap:** on the Paid plan, the cost at which games close.
- **Close a game for the day when it passes its share:** off until the owner turns it on. When on, the admin Worker reads the usage every 5 minutes and closes a game that has passed its share (Free plan) for the rest of the UTC day, or every game when the cap is reached (Paid plan). Warnings at 80 % are shown either way.

Players see why in plain words (`Off`, `Off until …`, `used up today's free quota … opens again at …`, `stopped by its owner`), in the game's own language if the game translates the kit's reasons.

**Modes (F-057):** a game can have modes with their own On / Off / Until under the game's row (for example Bricks' 1 Player and 2 Players). Add a game or a mode under the table. A mode can only close more than the game: when the game is Off, its modes are too. Rooms ask for their own mode (`admin: { …, mode }`); a page asks for any mode with `NetworkRoom.status(server, { mode })`, without waking a room.

**Admin links (F-058):** a personal link per game for the owner's own devices. With it, that browser can create, join and start games while the game is Off, Off until or over its budget, also with *Private only* on; an emergency stop still stops it. Make one under *Admin links* (game, the game's page, the device's name); the link is shown once, works 30 days and can be revoked. The game's Worker checks it with the admin page (kept a minute).

**Notices to players (F-065, F-066):** games that run `watchNotices` show the admin page's notices on every page, in a box with a strong background and a warning sound, until the player presses OK (once per browser, within about a minute):

- *Closing soon for today:* sent by itself when Cloudflare limiting is on and a game has used 90 % of its share of a daily free limit (on the Paid plan: 90 % of the monthly cap).
- *Closed for today:* sent by itself when the game has passed its share; running games finish.
- *Messages to players:* write a message (English) to one game or to every game (`*`), as a message (blue) or a warning (yellow), shown for 15 minutes to a day; it can be removed before then. At most 20 at a time.
- Ready for the timer (run A): *Open play ends soon*, *Open play has ended*, *The game stops soon*.

A preview of every notice, with the sound, is on the demo's page `/notices.html`.

**Connection quality (F-052):** games that turn measuring on (client option `measure`) send anonymous summaries; the page shows per game the response time to the room (typical and slow), how evenly positions arrive at the others, frame time, reconnects, host changes and the kinds of devices. Kept 7 days, then deleted.

**Connecting a game:** the game's Worker gets a service binding to the admin Worker's `GameApi` entrypoint, and the room server the option `admin`:

```jsonc
// the game's wrangler.jsonc
"services": [{ "binding": "NETWORK_KIT_ADMIN", "service": "network-kit-admin", "entrypoint": "GameApi" }]
```

```js
createRoomServer({ ...options, admin: { binding: 'NETWORK_KIT_ADMIN', game: 'my-game' } });
```

The game asks at most every 30 seconds per Worker instance and per room, over the service binding (never over the internet). If the admin Worker cannot be reached, the game stays open. The demo is connected as `network-kit-demo`.
