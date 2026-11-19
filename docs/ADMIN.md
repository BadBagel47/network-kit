# Admin page

The admin page shows how much of Cloudflare's free plan the games use, per game and per day, and switches games on and off (F-003, F-004, F-008). It is its own Worker, `network-kit-admin`, in `admin/`, deployed by `.github/workflows/deploy-admin.yml` from `main`. It reads Cloudflare's usage figures and keeps its settings in a small Durable Object (`AdminStore`); games ask it whether they are open.

## What it shows

The page shows the game cards at once and fills in Cloudflare's figures when they arrive, animated the first time (F-078). The page is in Swedish, styled as a control room (dark, status lamps, large controls), made for the phone (F-071, from 0.12). Every change is saved at once. Five tabs:

- **Spel:** a card per connected game: a status lamp (green open, yellow no new players or partly open, red emergency stop), rooms and players now and the busiest five minutes today (F-072, from Cloudflare's figures, a few minutes behind; players are connections, so a viewer or a second tab counts too), the network-kit version the game runs and when it was last deployed, and today's errors (F-074). Per game and per mode: *På*, *Inga nya* and *Timer*; a running timer shows the time left in its button, which drains, and under it *Öppet till …* and *Sedan: …* (tap to switch between no new players and an emergency stop). The emergency stop is under a striped cover: lift it, then press *NÖDSTOPP*; *Häv stoppet* lifts it. Games that are not connected are hidden behind a checkbox (F-070).
- **Länkar och meddelanden:** lobbies (F-059: a room made ahead for a game, valid 1 hour to 7 days, with a name and the game's page; a host link that makes its holder the room's owner and host, and a guest link for the guests, who wait for the host; both can be copied again from the list; the room is made when the first link is opened and its code is shown; revoking closes the room within a minute; revoked and expired lobbies stay folded away for 14 days; all of it is logged), game links (active ones; revoked and expired ones folded away for 14 days, with when each was last used) and messages to players, with a preview of the box players see. The game lists here offer the connected games only and keep the last choice in that browser (B-081).
- **Förbrukning:** each daily limit as a compact bar with today's use; tap it for a ring, the last seven days and whether today's pace lasts the day. Below: each game against its share today, connection quality, and folded away the figures per game and period (today, yesterday, this month), the last 30 days as a chart or table, and what the figures mean.
- **Inställningar:** plan, monthly cap, Cloudflare limiting, what a new timer starts with (30 min to 4 h, then no new players or an emergency stop), shares per game, and the games and their modes (add a game or a mode, remove a mode).
- **QR codes (F-083):** a game link shows its QR code as soon as it is made; each lobby has *QR värd* and *QR gäst*; each game card has *QR* to the game's page (known once a link or a lobby was made with it in that browser). The page vendors network-kit's client (`npm run admin:assets`, also run by the deploy) for the QR codes.
- **Rapporter (F-091, Playtest):** reports from Playtest in the games, newest first, for all games or one: the result, the test, who and when (and *fjärr* when sent from Playtest Remote), the answers, the device, browser, window and frames per second, the address, the page's errors and the pictures. Kept 30 days; *Behåll* keeps a report until unmarked (at most 50 per game); *Ta bort* deletes it. Tester links are made under *Länkar och meddelanden → Testarlänkar* (the game's name, which need not be a connected game; who it is for; 1 to 90 days; the game's page): the link shows Playtest in the browser that opens it. Playtest Remote's page is `/remote/` on the admin page's address and needs no sign-in (it joins with the code the game shows). See `docs/INTEGRATION.md` section 11.
- **Logg:** the owner's changes, timers that ran out (at the time they ran out; a timer started again reads "timern startades om", B-088), game links and tester links (made, revoked, expired) and messages, newest first, for all games or one; kept 90 days (F-074).

Figures (limits checked 2026-11-17 in Cloudflare's documentation, D-011; `admin/limits.js`):

| Figure | Free plan | Source in Cloudflare's analytics |
| --- | --- | --- |
| Worker requests | 100,000 a day | `workersInvocationsAdaptive` `sum.requests` |
| Room requests | 100,000 a day | `durableObjectsInvocationsAdaptiveGroups` `sum.requests`, with the incoming WebSocket messages among them (calls of the type `hibernation`; `durableObjectsPeriodicGroups` `sum.inboundWebsocketMsgCount` is 0 for hibernating rooms, checked 2026-11-18) counted 1 in 20, as Cloudflare counts them against the limit (B-069, from 0.11.1; before that every message counted fully) |
| Room time | 13,000 GB-s a day | `durableObjectsPeriodicGroups` `sum.activeTime` (µs × 128 MB), or `sum.duration` |
| Rows read | 5 million a day | `durableObjectsPeriodicGroups` `sum.rowsRead` |
| Rows written | 100,000 a day | `durableObjectsPeriodicGroups` `sum.rowsWritten` |
| Stored data | 5 GB in total | `durableObjectsStorageGroups` `max.storedBytes` |

Rooms are tied to their game through the Durable Object namespace (Cloudflare does not always fill in the Worker name for room requests); Worker requests that Cloudflare reports without a name get their own row, *Not named by Cloudflare*. Stored data is only reported for the whole account.

Cloudflare does not document every field of these datasets, so the page asks the API which fields exist (introspection) and builds its queries from them. A dataset that is missing or refused leaves a note under *Om siffrorna*; the rest still shows. Errors per game come from `sum.errors` of the two request datasets; deploy times from the Workers scripts list (`modified_on`); rooms and players from `durableObjectsPeriodicGroups` `max.activeWebsocketConnections` per room and five minutes. Games tell their network-kit version when they ask for their status (from 0.12). After each deploy, `scripts/admin-check.mjs` runs the real queries and writes what it found in the workflow's summary.

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

The deploy also gives the Worker `PLAYTEST_READ_KEY`, derived from `CLOUDFLARE_API_TOKEN`; the workflow *Playtest reports* derives the same to read reports (F-091). No new GitHub secret is needed.

## Games: on, no new players, timer, stop (F-003, F-004, F-008, F-026, F-067)

Per game (each game is a Worker; its name is the Worker's name, as in the usage figures) and per mode:

- **Mode:** *På* (on), *Inga nya* (no new players) or *Timer*. No new players refuses new rooms, newcomers and new rounds (also rematches); running games finish, and participants who were already in a room can come back. A timer makes the game or mode work as On until its end, and then as what was chosen with it: no new players (the default) or an emergency stop for that game or mode only. A new timer starts with the length and follow-up set under *Inställningar* (1 hour and no new players unless changed). Players are warned ten minutes before and told when it has ended. (Off until a time and Private only were removed in 0.11; an old Off until still in the future became No new players.)
- **Emergency stop:** under a cover. It turns everyone away and closes running rooms within about 30 seconds; no game link gets past it. *Häv stoppet* opens again.
- **Share %:** under *Inställningar*: the game's share of each daily free limit. Empty means an equal share of what the other games leave.

Under *Inställningar* also:

- **Plan:** free or paid. On the paid plan the page shows what this month would cost (5 USD a month plus what goes past the included amounts; prices checked 2026-11-18; Workers CPU time is not counted).
- **Monthly cap:** on the paid plan, the cost at which games close.
- **Cloudflare limiting:** off until the owner turns it on. When on, the admin Worker reads the usage every 5 minutes and closes a game that has passed its share (free plan) for new players for the rest of the UTC day, or every game when the cap is reached (paid plan); players are warned at 90 %.

Players see why in plain words (`not taking new players`, `used up today's free quota … opens again at …`, `stopped by its owner`), in the game's own language if the game translates the kit's reasons.

**Modes (F-057):** a game can have modes with their own mode and timer under the game's row (for example Bricks' 1 Player and 2 Players). Add a game or a mode under *Inställningar*. A mode can only close more than the game: when the game takes no new players, its modes do not either. Rooms ask for their own mode (`admin: { …, mode }`); a page asks for any mode with `NetworkRoom.status(server, { mode })`, without waking a room.

**Game links (F-058, F-068):** a link per game that lets whoever opens it create, join and start games, alone or with others, while the game or a mode takes no new players or is closed by Cloudflare limiting; an emergency stop still stops it. It can be used by anyone it is given to. Friends invited from a room made with a game link (the room's own invitation link, made in the game) get in too, as long as the room lives and the game link is valid; a room code alone is not enough. Make one under *Länkar och meddelanden* (game, how long it is valid, 1 hour to 90 days, 7 days unless chosen, who it is for, the game's page); the link is shown once with *Kopiera*, and can be revoked, which also stops its rooms' invitations (within a minute). Revoked and expired links stay listed, folded away, for 14 days, and are written to the log; the page shows when each link was last used. The game's Worker checks it with the admin page (kept a minute).

**Notices to players (F-065, F-066):** games that run `watchNotices` show the admin page's notices on every page, in a box with a strong background and a warning sound, until the player presses OK (once per browser, within about a minute):

- *Closing soon for today:* sent by itself when Cloudflare limiting is on and a game has used 90 % of its share of a daily free limit (on the Paid plan: 90 % of the monthly cap).
- *Closed for today:* sent by itself when the game has passed its share; running games finish.
- *Messages to players:* write a message (English) to one game or to every game (`*`), as a message (blue) or a warning (yellow), shown for 15 minutes to a day; it can be removed before then. At most 20 at a time.
- *Open play ends soon* / *The game stops soon* ten minutes before a timer ends, and *Open play has ended* / *The game has stopped* when it has (shown for an hour). A page that asks without a mode gets every mode's timer notices, with the mode's name in the title.

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
