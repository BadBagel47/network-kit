# D-093: review of network-kit before more games build on it

- **Date:** 2026-11-19
- **Reviewed:** `main` at `28d3574` (v0.14.0): `src/` (room server, client, shared protocol), `admin/` (admin Worker, store, page, Playtest, Playtest Remote), `examples/demo/`, `scripts/`, `templates/`, `.github/workflows/`, `tests/`, `docs/`.
- **How:** read only, by a session that did not build the kit. Nothing in the repository was changed except this file. Two findings were confirmed by running the code in Node (marked *confirmed by running*); everything else is from reading the code and is marked as such where it matters. Nothing was tried against the deployed Workers, and Cloudflare's own limits are taken from `admin/limits.js` and `docs/INTEGRATION.md` (checked there 2026-11-17), not re-checked.
- **Finding labels** (S, SEC, API, COST) are local to this document. The network-kit session gives backlog IDs to whatever the owner chooses to build.

## Summary

The kit is in better shape than its age suggests. The room logic is separated from Cloudflare and tested in Node, the security model is written down and mostly holds, keys are random and compared carefully, the admin page has a strict content security policy, and rooms really do sleep. There is no finding that lets a stranger read another room's secrets, take over a room, or get into the admin page.

The weak points are of three kinds:

1. **Cost and availability.** The limits protect one room and one connection, but not the account. A stranger with a script can use up the whole account's free daily quota in minutes, which stops every game until 00:00 UTC (no bill on the Free plan; real money on the Paid plan). *Cloudflare limiting* on the admin page does not stop it.
2. **Playtest (v0.14.0, one day old).** It has the newest and least tested code and holds most of the concrete faults: the tester link's token is handed to every Playtest Remote, a doubled slash skips the tester check, and pictures are stored in a way that will stop Playtest working after a couple of hundred pictures.
3. **The interface.** The games' API is not ready to be frozen: the kit is four days old, 14 MINOR versions have been released, 7 of them with an upgrade guide, and most features since 0.6 are marked "not yet used by the owner or a game". What is missing is not a 1.0 but a statement of which parts are stable and which are on trial, and attention to the two places where games do **not** have their own copy: the admin Worker's `GameApi` and the Playtest paths, which every game talks to live.

| # | Finding | Severity |
| --- | --- | --- |
| COST-1 | A stranger can use up the account's daily free quota; all games stop | High |
| SEC-1 | Playtest Remote hands the tester link's token to every remote | High |
| COST-2 | Playtest pictures are loaded into memory all at once; Playtest stops after about 200 pictures | High |
| SEC-2 | `POST /playtest/rooms//` opens a Playtest room without a tester link | Medium |
| SEC-3 | Per-visitor limits are easy to get around (per instance, per single IPv6 address) | Medium |
| SEC-4 | Admin sign-in: the brake is per address only; each try creates a Durable Object | Medium |
| API-1 | No stated stability per part of the API; too early to freeze | Medium |
| API-2 | `GameApi` and the Playtest paths are shared live by all games but not versioned or compatibility-tested | Medium |
| API-3 | A game link stops the status check and notices on a game served from another origin (CORS) | Medium |
| API-4 | A stored-state version change deletes every live room at deploy | Medium |
| COST-3 | Default per-room caps allow one room a third of the whole account's day | Medium |
| COST-4 | `watchNotices` polls once a minute per visible page, for ever | Medium |
| S-1 | `room-core.js`: admission, lobbies and game links are woven into `hello` and `start` | Medium |
| S-2 | `AdminStore`: one object for nine concerns; reads that write; whole-document settings saves | Medium |
| S-3 | Tests: thin where the newest code is (Playtest, HTTP routing, WebKit, real hibernation) | Medium |
| SEC-5 | The demo's `/invite` and `/diag` are open and unlimited, and `/invite` is the guide's example | Low |
| SEC-6 | Anyone in an open room can pause the game (default `pauseBy: 'anyone'`) | Low |
| SEC-7 | `allowedOrigins` defaults to `'*'` | Low |
| SEC-8 | Smaller points: token in a query string, sign-out, measurement spam, names | Low |
| API-5 | Every game page loads Playtest, the QR generator and measurement through `client/index.js` | Low |
| COST-5 | Smaller points: visibility writes, measurement list size, sealed reports in git history | Low |
| S-4 | Duplicated helpers and constants | Low |

## 1. Structure and durability

### What is good

- `RoomCore` knows nothing about Cloudflare (a small `host` interface), so 150+ unit tests run the real room logic and the real client against each other in plain Node. This is the kit's best structural decision and should be kept through any refactoring.
- `admin/control.js` (what the admin page decides) is pure and well tested (30 tests).
- The Cloudflare glue (`src/server/worker.js`) is small, and it answers bad codes, closed games and over-limit visitors without waking a room.
- Release discipline: version check, changelog check, smoke test shipped with every copy, a compatibility run of the previous PATCH's client, update proposals that never push to a game's main.

### S-1 (Medium): `room-core.js` mixes the room with the admin page's rules

- **Where:** `src/server/room-core.js` (1,819 lines, one class, about 70 methods). `hello()` is lines 899–1114 (215 lines); `command()` is 1486–1716, one `switch` with 22 cases.
- **What:** the size itself is manageable, because the file is ordered and commented. The durability problem is that three different things share the same functions and the same state object:
  - the room proper (participants, roles, places, host, owner, phases);
  - *admission* from the admin page: the game's status, game links (`adminPass`, `s.pass`), lobbies (`s.lobbyEnds`, `LOBBY_PREFIX`, `checkLobby`), an emergency stop. These appear inside `hello()` (lines 937–950, 1031–1037), inside the `start` command (1569–1576), in `message()` and `alarm()` (`checkStopped`), and in `create()`;
  - storage in parts, written twice: once for the snapshot (212–246, 321–331) and once for welcome states (252–319).
- **Why it matters:** F-058, F-059, F-068 and B-080 each added a condition to the same `if` chains in `hello()`. The line that decides whether a newcomer gets in while a game is closed (949) now has six conditions and two awaits. The next admission feature (F-092 recording, F-075, anything per mode) lands in the same place, and a mistake there is a security fault (someone gets in who should not) or a lock-out. B-080 was exactly such a fault.
- **Proposal:** no rewrite. Three extractions, each behind the existing tests, with no behaviour change and no API change:
  1. An `Admission` helper (own file) with one question, `mayEnter({ isOwner, standing, key, adminPass })`, and one for `mayStart(ws)`. `hello()` and `start` call it; all knowledge of game links, lobby tokens and stops lives there.
  2. One `ChunkedValue` helper for "a JSON value stored in parts, saved at most every N ms with a trailing save", used by both the snapshot and the welcome states.
  3. The commands as a table of small functions (`{ kick, renew, start, … }`) instead of one `switch`, so each has its own rights check and its own tests.
- **When:** before Bricks and Buzzy add their needs, not as part of a feature run.

### S-2 (Medium): `AdminStore` is one object for everything, and reads have side effects

- **Where:** `admin/store.js` (527 lines) and `admin/playtest.js`; one Durable Object instance (`idFromName('main')`) holds settings, the budget, game links, lobbies (with their rooms' owner keys), messages, the 90-day log, measurements, connected games, versions, tester links, reports and pictures. `fetch()` (lines 383–509) is one chain of 25 `if` routes.
- **What and why:**
  - Every game's status question goes through this one object. A fault in any corner (see COST-2) affects all of it. Games fail open when it cannot be reached (`worker.js:157–181`), which is the right choice, but an emergency stop then does not work either.
  - Listing endpoints delete and write while reading: `passes()`, `lobbies()`, `messages()`, `logs()` and `testers()` remove expired entries and write log lines as a side effect of a GET. It works, but the log's content depends on when someone looked, and a reader cannot assume a read is harmless.
  - **Whole-document saves (lost updates):** the page saves by sending its whole copy of the settings (`admin/public/app.js:166–181`, `PUT /api/settings`), and the copy is refreshed once a minute. Two signed-in devices overwrite each other: an emergency stop pressed on the phone is undone if a tab on the computer, loaded before the stop, saves any other change within that minute. For the one control that is meant for emergencies, this matters.
- **Proposal:**
  - Save changes as changes: `PATCH /api/settings` with one path and value (`games.critical.stopped = true`), applied in the store to the stored settings. Or, smaller: send the `settings` version the page loaded and refuse a save made from an older one (the page reloads and asks again).
  - Move Playtest's reports and pictures to a Durable Object of their own (COST-2), so the store that games depend on holds only small values.
  - Split the routes into one small router per concern when the file is next touched; do expiry clean-up in one `sweep()` called from an alarm instead of from GETs.

### S-3 (Medium): where tests are missing

Coverage follows age: the core is well covered, the newest code is not.

| Part | Lines | Tests | Gap |
| --- | --- | --- | --- |
| `room-core.js` | 1,819 | about 100 unit tests (`room-core`, `host-owner`, `hardening`, `large`) | good; no test that counts storage writes per hello, drop or visibility change |
| `client/room.js` | 1,004 | 31 unit tests against the real core, plus the demo in Chromium | good |
| `server/worker.js` | 475 | 9 unit tests, 15 integration tests in workerd | no test of CORS with the client's own headers (API-3); none of `/measure` and `/lobby` over HTTP with odd input |
| `admin/worker.js` | 383 | part of 11 tests in `admin.test.js` | no test of the public paths' routing: SEC-2 would have been caught by one test that posts to `/playtest/rooms//` |
| `admin/store.js`, `admin/playtest.js` | 796 | lobby 3, playtest 3, measure some | no test with many reports and pictures (COST-2); none for two saves from stale copies (S-2) |
| `client/playtest.js`, `remote.js` | 1,051 | 3 unit tests, one Chromium run | nothing checks what the remote is sent (SEC-1), nor a remote that sends rubbish |
| `client/notices.js` | 330 | 2 tests (sound) | no test of the polling itself or of what happens when the status request fails |
| Browsers | – | Chromium only | the owner's recurring device faults are iPad/WebKit (B-084, B-086); Playwright can run WebKit in CI |
| Cloudflare itself | – | one room that really sleeps, locally | the admin Worker's Durable Objects and the service binding are only exercised after deploy |

- **Proposal, in order of value:** (1) a table-driven "what can a stranger reach" test for both Workers: every public path, with doubled slashes, wrong methods and oversized bodies, asserting the status code and that no room or store was touched; (2) the Playtest tests named above; (3) the Chromium tests also in WebKit; (4) a "write budget" test that fails when an ordinary evening (join, play, drop, return, leave) writes more rows than a stated number.

### S-4 (Low): duplicated helpers

- **Where:** the game-name pattern `/^[a-z0-9][a-z0-9-]{0,62}$/` appears eight times (`admin/store.js`, `admin/control.js`, `admin/playtest.js`); `b64url` and SHA-256 helpers are written in `src/server/random.js`, `admin/store.js`, `admin/playtest.js`, `admin/auth.js` and `admin/worker.js`; `LOBBY_PREFIX` is defined in both `room-core.js:36` and `store.js:18`, with a comment that they must agree; a per-address counter is written three times (`worker.js` `overLimit`, `admin/worker.js` `tooMany`, `LoginGuard`).
- **Why:** SEC-3 has to be fixed in each counter separately; a changed prefix or name rule in one place breaks silently.
- **Proposal:** one `shared/` module for tokens (prefixes, patterns), one for the visitor counter.

## 2. Security

### What is good

- Secrets are 128 bits or more from `crypto.getRandomValues`, compared without early exit; the server stores a hash of each participant's identity, never the key; game links and tester links are stored as hashes.
- Rights are checked in the room (`OWNER_COMMANDS`, `HOST_COMMANDS`, `maySend`), not in the page. The host's snapshot is never sent to anyone but the host seat. A role with its own link cannot be picked by name. A ban renews every link.
- Keys travel after `#` and are taken out of the address bar.
- Admin page: HttpOnly, Secure, SameSite=Strict session cookie; origin check on every changing request; a strict content security policy (no inline script, `connect-src 'self'`, no framing); password compared as hashes; the page builds its DOM without `innerHTML` (the three uses are QR codes made from the kit's own links).
- The reports workflow seals correctly (AES-256-GCM with a fresh key, wrapped with RSA-OAEP), and workflow inputs go through the environment, not into shell text.

### SEC-1 (High): Playtest Remote hands out the tester link's token

- **Where:** `src/client/playtest.js:786–801` (`remoteState()` sends `token: this.o.token`), sent with `room.send(...)` to everyone in the pairing room; the room is made with `access: 'open'` and the role `remote` with `needsKey: false` (`admin/worker.js:60–73, 121`), so the six-character code is all a remote needs. `admin/public/remote/remote.js:160–164` uses the token to upload a photo.
- **What:** a tester link is the long-lived secret of Playtest (30 days by default, up to 90). It is sent in full to every device that joins the pairing room, again on every state change. The pairing code is shown on the game screen, as a QR code and in a link, and is meant to be short-lived and low-value; after this it is worth as much as the tester link.
- **What someone with the token can do:** send reports and pictures in that tester's name for as long as the link lives (200 reports and 100 pictures of 400 kB a day), see which tests were reported, and open Playtest rooms. They cannot read reports or reach the admin page. The owner cannot tell from the admin page that it happened, other than by odd reports.
- **Why High:** it breaks the kit's own rule ("no secrets in pages … tokens stay", security model in `docs/INTEGRATION.md` section 9) in the newest feature, just before Critical starts using it with friends, and it gets harder to change once remotes in the field expect the token.
- **Proposal:** never send the token. Either (a) the remote sends its photo to the game page through the room, and the game page uploads it (raise `maxMessageBytes` for Playtest rooms to fit a 300 kB picture as text, about 400 kB), or (b) the game page asks the admin Worker for a one-time upload ticket (valid minutes, pictures only, tied to the tester) and sends that. Add a test that the state sent to remotes holds no token. Consider making the pairing room private with its invitation key in the QR link, and keeping the typed code for computers as a second, deliberate way in.

### SEC-2 (Medium): a doubled slash skips the tester check — *confirmed by running*

- **Where:** `admin/worker.js:109` checks the tester link only when the path is exactly `/playtest/rooms` (or with one trailing slash); every other path under it goes straight to the room server (`:123`), whose router drops empty path parts (`src/server/worker.js:219`) and therefore treats `POST /playtest/rooms//` as "create a room".
- **Confirmed:** with the store answering "no tester", `POST /playtest/rooms` and `/playtest/rooms/` gave 401; `POST /playtest/rooms//` gave 200 and a room code with its owner key.
- **What a stranger gets:** rooms on the admin Worker (10 a minute per address, kept two hours), counted against the same daily quota as the admin page itself. No access to reports or settings.
- **Proposal:** in `playtestRoom`, refuse every POST that is not the checked create (only GET and the WebSocket path may pass through); in the room server, answer 404 for paths with empty parts instead of dropping them. Add the routing test from S-3.

### SEC-3 (Medium): the per-visitor limits are easy to get around

- **Where:** `src/server/worker.js:138–155` (`overLimit`), `admin/worker.js:76–89` (`tooMany`).
- **What:** the counters live in one Worker instance's memory and are keyed on the full address in `cf-connecting-ip`.
  - Cloudflare runs many instances; each has its own counter, so the real limit is a multiple of the stated one, and unknown.
  - One home connection with IPv6 has billions of addresses (a /64). Rotating them gives a fresh allowance per request. When the table passes 10,000 entries it is emptied for everyone (`:149`).
- **Why it matters:** `docs/INTEGRATION.md` (sections 2 and 9) says the limits "make guessing pointless". For 6 characters that is still true by the size of the code space alone. For a game that chooses `codeLength: 4` with open rooms (allowed, and the owner's default until 0.8) it is not: about a million codes, and the limit does not hold against a visitor who wants to get around it. More important, these limits are the only brake on room creation (COST-1).
- **Proposal:** key IPv6 addresses on their /64; say in the guide what the limit is (a brake on accidents and simple scripts, not a guarantee); make `access: 'private'` the stated requirement for codes shorter than 6. For a real limit, see COST-1.

### SEC-4 (Medium): admin sign-in brake is per address, and each try costs

- **Where:** `admin/worker.js:190–213` (`guardFor`, `login`), `admin/auth.js:80–112` (`LoginGuard`).
- **What:** five free tries per address, then a doubling wait, in a Durable Object named after the address. Someone who changes address (IPv6 again) gets five new tries each time, without end; and every try creates a Durable Object, writes a row and sets an alarm, on the account's shared quota.
- **Why it matters:** the password is the only thing between the internet and the emergency stop, the game links and the reports. With the required 12 characters and a password manager, guessing will not succeed; the realistic harm is the quota (it is one more way to do COST-1) and a weak password chosen by hand.
- **Proposal:** add one global counter beside the per-address one (for example at most 30 wrong passwords an hour from addresses that have never signed in; a browser that has signed in before carries a long-lived "known device" cookie and is exempt, so the owner cannot be locked out by a stranger). Key IPv6 on the /64. Longer term, the decision already recorded (Cloudflare Access or an e-mail link in front of the page) removes the problem.
- **Smaller, same area:** sign-out only clears the cookie; a copied cookie stays valid for 30 days and can only be ended by changing the password. The cookie is signed with a key that is one SHA-256 of the password, so a leaked cookie allows offline guessing of the password. Both are acceptable for one owner with a long password; a random session secret stored in the store would fix both.

### SEC-5 (Low): the demo's open paths, and the guide's example

- **Where:** `examples/demo/worker.js:33–36` (`POST /invite`), `examples/demo/diag-store.js:24–39` (`POST /diag`).
- **What:** `/invite` creates a room on every call with no per-visitor limit and without asking the admin page, so it works while the demo takes no new players and after an emergency stop. `/diag` stores up to 64 kB per call without a limit on calls (storage is capped at 200 reports; requests are not).
- **Why it matters:** the demo is only the owner's, but `docs/INTEGRATION.md` section 2 points to "the demo's `POST /invite`" as the way to use `createRoom`. Games will copy it, and `createRoom` itself checks nothing.
- **Proposal:** make `createRoom(env, { request })` apply the same visitor limit and admission as `POST /rooms` when given the request (and document that without it the game must do its own check); put `/diag` behind the same counter.

### SEC-6 (Low): anyone in an open room can pause the game

- **Where:** `room-core.js:54` (`pauseBy: 'anyone'`), `mayPause` at 1479–1484.
- **What:** in an open room the code is enough to join as a player, and any player may pause and resume. For games among friends that is the right default; for open rooms it is the simplest way for a stranger who found a code to spoil a game, together with taking a free place.
- **Proposal:** keep the default, but say it in the security model, and consider `pauseBy: 'host'` as the default when `access` is `'open'` and the game has not chosen.

### SEC-7 (Low): `allowedOrigins` defaults to `'*'`

- **Where:** `src/server/worker.js:26, 99–112`; also the Playtest rooms (`admin/worker.js:60`), which do not set it.
- **What:** by default any web page may create and join rooms from a visitor's browser. No cookies are involved, so nothing can be stolen; the effect is that any site can spend the game's quota through its own visitors, each with their own address and allowance.
- **Proposal:** before 1.0, make the default "the Worker's own origin, and requests without an Origin" (what a game served from its own Worker needs, as Vättigt and the demo), and let games on another site list it. That is a breaking change for cross-origin games, so it belongs in a MINOR with an upgrade line.

### SEC-8 (Low): smaller points

- **Token in a query string:** pictures are uploaded to `/playtest/image?token=…` (`client/playtest.js:202`, `remote.js:164`). The admin Worker has request logging on for every request (`admin/wrangler.jsonc`, `observability`), so tester tokens end up in Cloudflare's logs. Send it in the body or a header.
- **Measurement spam:** `POST <basePath>/measure` accepts summaries from anyone; a stranger can fill a game's 3,000 a day and skew the quality figures. Acceptable; say so on the admin page ("unverified").
- **Names:** `cleanName` removes control characters only. Games must still escape names and treat every `message` as untrusted input from another player; the guide's security model should say this in one line, since games built by different sessions will each meet it.
- **Timing:** lobby tokens are compared with `===` (`store.js:215`); not exploitable over the network in practice, but the rest of the kit uses a constant-time compare.
- **Actions pinned by tag:** workflows use `actions/checkout@v4` and `rhysd/actionlint:latest`; pinning by commit is the stricter habit for a repository whose workflows hold the deploy token.

## 3. The interface towards the games

### API-1 (Medium): too early to freeze; label the parts instead

- **Evidence:** first release 2026-11-15; 14 MINOR versions in four days; upgrade guides in 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8 and 0.11; one game (Vättigt, on 0.5.0) runs on it; `docs/HANDOFF.md` says of 0.6, 0.7, 0.10, 0.11, 0.12, 0.13 and 0.14 that they are "not yet used by the owner or a game". Only `gate` is marked experimental (`worker.js:28`).
- **Assessment by part:**

| Part | Judgement | Why |
| --- | --- | --- |
| Rooms, codes, joining, roles, places, owner and host, phases, reconnection, close codes | **Stable**: safe to promise | Two reviews, the most tests, used by Vättigt on real devices |
| `send` (targets, `reliable`, `latest`), snapshots, large states | **Stable** | Tested end to end; used by Vättigt; asked for by Critical |
| Server-run `rules` hooks and the `room` object | **Stable in shape, thin in use** | Only the demo's memory game uses it; Buzzy will be the first real user. Expect additions (validation F-061, timers), not changes |
| Share links, QR codes, `tabSession` | **Stable** | Small and tested |
| Welcome state, successors, `sendsTo: 'all'`, `rttMs`, `at` on messages | **On trial** | New in 0.6 and 0.13, no game uses them yet |
| `admin` option, game links, lobbies, modes, `status()`, notices | **On trial** | Renamed and reshaped three times in two days (0.7, 0.9, 0.11, 0.13); the owner's device test passed, no game uses them |
| `measure` | **On trial** | The summary format is `v: 1` with no plan for `v: 2` |
| Playtest and Playtest Remote | **Experimental** | One day old; SEC-1, SEC-2 and COST-2 change its wire format and storage |
| `gate` | **Deprecated** | Replaced by `admin`; remove at 1.0 |
| Client constructor options not in the guide (`minDelayMs`, `maxQueue`, `pongTimeoutMs`, `storage`, `WebSocket`, …; the guide says "see the constructor") | **Internal** | Used by tests; should not be promised |

- **Proposal:** add a *Stability* column or section to `docs/INTEGRATION.md` with these four words (stable, on trial, experimental, deprecated) and one rule each: stable parts change only with a MAJOR (from 1.0) or with an upgrade guide and a compatibility test (0.x); parts on trial may change in any MINOR; experimental parts may change in a PATCH. Call 1.0 when Bricks and Buzzy have each run a real session on it, not before.

### API-2 (Medium): two interfaces are shared live by every game, and nothing checks them

- **What:** the kit's promise is that "a change here never breaks all games at once", because each game has its own copy. That holds for the room server and the client. It does not hold for:
  - **`GameApi`** (`admin/entry.js:15–49`): `status`, `checkPass`, `lobby`, `lobbyRoom`, `measure`. The admin Worker deploys from `main` on every change; games call it from whatever kit version they copied. The room server reads `open`, `reason`, `until`, `stopped`, `notices` from the answer.
  - **The Playtest paths** (`/playtest/check`, `/report`, `/image`, `/playtest/rooms`): the panel in a game is the game's copy; the admin Worker and the Remote page (`admin/public/remote/`, which loads the admin Worker's own copy of the client) are the newest. The pairing room's server is the newest `PROTOCOL`; the game page joins with its copy's `PROTOCOL`. `src/shared/protocol.js:1–3` states the assumption that breaks here: "both sides of one game always use the same network-kit version".
- **What will go wrong:** the first time `PROTOCOL` is raised, Playtest Remote stops working in every game that has not yet updated (close code 4009, "reload the page", which does not help). The first time a `GameApi` answer changes shape, games on older copies misread it; because the room server treats an error as "open", the likely failure is silent: a closed game that is open, or an emergency stop that does nothing in one game.
- **Proposal:**
  - Treat `GameApi` as append-only and write that at the top of `entry.js`; new meanings get new methods or new fields, never changed ones.
  - Extend `tests/compat/run.mjs`: run the `server/worker.js` of each kit version still in use by a game (the admin page already knows the versions, F-074) against the current `AdminStore`, for closed, stopped, game link and lobby.
  - Put a version in the Playtest paths (`/playtest/v1/…`) now, while one game uses them; let the pairing room accept the protocol versions still in use, or give Playtest Remote its own small message format that does not depend on `PROTOCOL`.

### API-3 (Medium): with a game link, a game on another origin loses its status check and notices

- **Where:** `src/client/room.js:224–235` sends the header `x-admin-pass` with `GET <basePath>/status`; `src/server/worker.js:106` allows only `content-type` in `access-control-allow-headers`.
- **What:** when the page and the game's Worker are on different origins (the guide's own example uses `https://badbagel47.github.io` as the page), the browser asks permission for the extra header, the server does not grant it, and the request fails. `status()` catches the failure and answers `open: true` with no notices. So in exactly the browsers that hold a game link, `NetworkRoom.status()` always says open and `watchNotices` shows nothing: no warning before a timer ends or before an emergency stop.
- **Scope:** only cross-origin games; Vättigt and the demo serve pages from the Worker and are not affected. Found by reading; not run in a browser.
- **Proposal:** add `x-admin-pass` to the allowed headers (or send the pass as a query value of a POST body like `create` does), and add the CORS test from S-3 that sends the client's real headers.

### API-4 (Medium): a change of the stored state's version deletes every live room

- **Where:** `room-core.js:174–182`: a room stored with another `STATE_VERSION` is deleted when it wakes.
- **What:** simple and safe against misreading old data, and fine while one game tests. With lobbies made up to seven days ahead (F-059) and games in progress, a deploy that raises the version closes every room of that game without a word to the players, and a lobby's links then point at nothing.
- **Proposal:** decide the rule now: either migrations (`v2 → v3` as a function, tested with a stored v2 room) or "a state version change is a MAJOR-like event": deployed with a timer on the admin page, announced by a notice, and listed in the upgrade guide. Add a test that a stored room of the previous release still loads.

### API-5 (Low): one entry point loads everything

- **Where:** `src/client/index.js` re-exports Playtest, notices, measurement and the QR generator (2,293 lines) together with `NetworkRoom`. There is no build step, so a game page that imports anything from `index.js` downloads and parses all of it, including Playtest's Swedish panel and styles, in every player's browser.
- **Why it matters:** load time on phones, and the project rule that every feature in the core is general: Playtest is the owner's tool in Swedish and is closer to the admin page than to the room client.
- **Proposal:** keep `index.js` to the room client, share links and protocol constants; document `client/notices.js`, `client/playtest.js` and `client/share.js` (QR) as separate imports; load Playtest with a dynamic `import()` only when a tester token is present.

### What will cause trouble at updates (collected)

1. A raised `PROTOCOL` and Playtest Remote (API-2).
2. A changed `GameApi` answer and games on older copies (API-2).
3. A raised `STATE_VERSION` and live rooms and lobbies (API-4).
4. Defaults that change meaning: `codeLength` changed twice (0.4, 0.8) and `limits` arrived as a new default (0.7). Each was reasonable; together they show that defaults are part of the interface. Proposal: a game's options file should state every value it depends on, and the smoke test could warn about options left to defaults that changed since the game's previous copy.
5. Pages open during a deploy: an old page against a new server gets 4009 and a reload text; a new page against an old room state gets API-4. Acceptable, but a deploy during play is felt by players; the admin page's timer is the tool, and the guide should say so.
6. Tester links, game links and owner keys live in each browser's storage under fixed key names (`network-kit:admin-pass`, `nk-playtest:*`, `network-kit:<server>:…`). Renaming one signs everybody out of that feature; treat the names as part of the interface.

## 4. Cost and operation on the Free plan

### The size of the budget, in play time

From the limits in `admin/limits.js`: 100,000 room requests a day with 20 incoming messages counted as one is 2 million incoming messages a day for the whole account; 13,000 GB-s is about 28 hours a day of rooms being awake, in total. A real-time room where the host sends 15 messages a second and three players 5 each (30 a second) uses about 5,400 room requests an hour, so **the whole account has room for about 18 room-hours of real-time play a day, shared by every game**. Turn-based games cost almost nothing. This is enough for the owner and friends; it is worth showing on the admin page as "hours of play left today", because that is the number the owner can reason about.

### COST-1 (High): a stranger can use up the account's day, and every game stops

- **Where:** `src/server/worker.js:221–238` (anyone may create rooms; 10 a minute per address per instance, see SEC-3), `room-core.js:73–75` (per connection 40 messages a second; per room 600,000 messages and 720 active minutes a day), `admin/control.js:208–218` (*Cloudflare limiting*), `room-core.js:656–665` (`checkStopped` acts only on a stop).
- **What:** every limit is per connection, per room or per address. Nothing limits a game as a whole, and the account's quota is shared by all games.
  - *Messages:* a script creates rooms and sends at the allowed pace in each. The creator is host and may send; a message with nobody to receive it still counts. 100 rooms at 40 messages a second is 200 room requests a second: the account's 100,000 are gone in under ten minutes. From one address this takes ten minutes of creating rooms; with rotating addresses, seconds.
  - *Awake time:* a room hibernates after some seconds without messages. One message every few seconds per room, far under every limit, keeps it awake. 100 such rooms use the day's 13,000 GB-s in about 17 minutes.
  - *Plain requests:* every request that reaches a Worker counts, also the ones answered 429. 100,000 requests is a short loop. This cannot be fixed in the Worker's code at all.
- **What does not help today:** *Cloudflare limiting* closes a game for **new** rooms, newcomers and rounds when it has passed its share, using figures that are minutes behind; rooms that already exist keep sending. Only the emergency stop closes rooms, and someone has to press it. The share per game is therefore a display and a courtesy between the owner's own games, not a protection.
- **Consequence:** on the Free plan, every game on the account answers with an error until 00:00 UTC. No bill. On the Paid plan the same script costs money up to whatever the caps allow, and the monthly cap on the admin page acts through the same slow, new-rooms-only path.
- **Why High:** it is the one way a stranger can take down all the owner's games at once, it needs no skill, and the project's own rule is that each game has its own share. It becomes more likely with every game that is published. It is rated on availability, not on money.
- **Proposal (in order of value for effort):**
  1. **Make the budget bite on running rooms.** A room already asks the admin page every 30 seconds while it is busy. Let the answer carry "over budget, hard", and let the room close (or pause) when it does, as it does for a stop, except rooms whose owner holds a valid game link. Then *Cloudflare limiting* really limits.
  2. **A count per game, not only per room.** One small registry object per game that the Worker asks when a room is created (one extra room request per creation, nothing per message): it refuses creation above N rooms created in the last hour or N live rooms, and above M per address prefix a day. This is the missing "per game" limit, and it survives across Worker instances, which the in-memory counters do not.
  3. **Lower the defaults** (COST-3) so that one room cannot take a third of the day.
  4. **Close rooms that are awake with nobody receiving.** A host alone in a room sends nothing when it is the kit's client; a room that receives messages for more than a few minutes with no other participant online is a script or a fault. Close it.
  5. **Outside the code:** serve published games from a domain of the owner's on Cloudflare instead of `workers.dev`. Then Cloudflare's own rate limiting and bot rules run before the Worker and before the request is counted. This is the only measure against the plain-request flood, and it is a one-time action for the owner (a domain costs about 10 USD a year; needs the owner's decision).
  6. Until then: a Cloudflare usage notification at 50 % and 80 % of the daily requests (already named as a guard in the 2026-11-14 decision; `docs/HANDOFF.md` does not say it is set up).

### COST-2 (High): Playtest pictures are read into memory all at once

- **Where:** `admin/playtest.js:172–184` stores each picture as base64 text under `img:<id>` in the admin store; `clean()` at 253–268 runs `storage.list({ prefix: 'img:' })`, which loads **every picture's data** into memory, on every report sent and every time the report list is read (at most once a minute); `check()` (162–170), `reports()`, `findReport()` and `setKeep()` each load every report. `admin/worker.js:150–163` (`/playtest/read`) builds one JSON text with all reports and all their pictures.
- **What:** a picture is up to 400 kB, about 530 kB as stored text. A Durable Object has 128 MB of memory. At roughly 200 stored pictures, `clean()` no longer fits. From then on sending a report and opening *Rapporter* fail, and they keep failing, because the clean-up that would remove old pictures is the call that fails. Pictures are kept 30 days (or for ever with *Behåll*), a report may carry four, and a tester link may send 100 a day, so one or two weeks of real testing of Critical's list reaches it.
- **Blast radius:** the object that fails is the store every game asks for its status. Status questions do not list pictures, so games should keep working, and they fail open if not; the admin page's settings share the object and may become slow or fail while it restarts.
- **Confidence:** from reading; not reproduced against Cloudflare. The arithmetic depends on Cloudflare's 128 MB limit for a Durable Object.
- **Proposal:** before Critical connects its test list:
  - Store a picture's small facts (`img:<id>`: tester, report, time, size) apart from its data (`imgdata:<id>`), so clean-up and lists never load data. Do the same for reports if they grow (an index entry and the body).
  - Give Playtest a Durable Object of its own (S-2).
  - Make `/playtest/read` return reports without pictures and let the workflow fetch each picture separately; cap the number per run.
  - Add a test with 300 stored pictures that fails if a list call returns picture data.

### COST-3 (Medium): default caps are sized for a room, not for the account

- **Where:** `room-core.js:74–75`: `maxMessagesPerDay: 600_000` and `maxActiveMinutesPerDay: 720`.
- **What:** 600,000 messages are 30,000 room requests, 30 % of the whole account's day; 720 minutes awake are about 43 % of the day's room time. A single forgotten or looping room in one game can thus take a third of every game's quota before its own cap stops it. The demo already sets 150,000.
- **Proposal:** default to what a long evening needs (for example 150,000 messages and 240 active minutes), and have the guide's "what a game should do" give the arithmetic for choosing them. A change of default, so a MINOR with an upgrade line.

### COST-4 (Medium): `watchNotices` asks once a minute per visible page, for ever

- **Where:** `src/client/notices.js:293–330`; the guide says to start it on every page of every game.
- **What:** each visible page costs one Worker request a minute: 1,440 a day for a screen left on (a quiz's big screen, a tablet on a stand), 1.4 % of the account's day each. About 70 pages left open use the whole day's 100,000. Each request that misses the 30-second cache also asks the admin Worker and its store.
- **Proposal:** while a page is in a room, deliver notices over the room's connection (outgoing messages are free) and stop polling; outside rooms, ask every minute for the first ten minutes and then every five, and stop after an hour without any touch or key until the next one. Let the status answer carry `nextCheckMs`, so the admin page can slow every game down at once on a tight day.

### COST-5 (Low): smaller points

- **Visibility changes write and broadcast:** `visibility` changes `p.hidden`, which is part of the command fingerprint (`room-core.js:1723`), so every switch of app or tab by any participant writes the room and sends the whole room to everyone, though nothing they can see changed. Keep `hidden` in the socket's attachment, or out of the fingerprint with a trailing save.
- **One stored value per game and day for measurements:** `m:<day>:<game>` grows to 3,000 summaries in one value (`store.js:408–413`), read and rewritten whole for each new summary, and near the platform's size limit for one value. Store them in pieces of 100.
- **Sealed reports in git:** each run of *Playtest reports* commits the sealed file, pictures included, to the branch `playtest-reports`. The history keeps every version, so the public repository grows by megabytes per run. Recreate the branch as a single commit each run (the workflow owns the branch), or keep pictures out of the default read.
- **The store's alarm:** with *Cloudflare limiting* on, the store asks Cloudflare for 31 days of usage every five minutes (`store.js:518–526`), 288 times a day, to learn about today. Ask for today only on the alarm.
- **`where()`** fetches Cloudflare's trace page once per room wake-up when room info is asked (`worker.js:440–450`): an outside request per look-up of a sleeping room. Store the answer in the room at creation.

### What can grow without anyone noticing

| What | Bounded by | Note |
| --- | --- | --- |
| Rooms | 24 h after the last participant, 1 h after closing | Fine; creation rate is the gap (COST-1) |
| Participants remembered per room | 100 | Fine |
| Bans per room | nothing | Owner only; harmless |
| Server-run `room.game` | nothing | Stored inside the one `room` value, written whole on every change; a rules author who keeps a growing log there will meet the size limit for one value. Say so in the guide's section 6 |
| Login guard objects | deleted a day after the last wrong password | One per address (SEC-4) |
| Playtest pictures | 100 a day per tester link, 30 days | COST-2 |
| Playtest reports | 200 a day per tester link, 30 days | Every list loads all of them |
| Admin log | 90 days, shows 2,000 | Every look loads all entries |
| Measurements | 3,000 a day per game, 7 days | One value per game and day |
| Sealed report branches | nothing | Git history |

## 5. What a stranger can do today

For the owner's question, in one place. "Stranger" means someone with no link and no password.

| A stranger can | Limit | Finding |
| --- | --- | --- |
| Create rooms in any game and send messages in them until the account's day is used up | 10 rooms a minute per address per instance; per-room caps | COST-1 |
| Keep rooms awake to use up the day's room time | none that applies | COST-1 |
| Look up whether a room code exists, its phase and how many are in it | 60 a minute per address per instance | by design; SEC-3 |
| Join an open room with its code, take a free place, send the host anything, pause the game | the room's seats | by design; SEC-6 |
| Guess codes | pointless at 6 characters; feasible at 4 with open rooms | SEC-3 |
| Open a Playtest room on the admin Worker | 10 a minute | SEC-2 |
| Try admin passwords | 5 per address, then a wait | SEC-4 |
| Send made-up measurement summaries | 60 a minute per address | SEC-8 |
| Post to the demo's `/diag` and `/invite` | none | SEC-5 |

| A stranger cannot | Because |
| --- | --- |
| Join a private room, or take a role that has its own link | 128-bit keys per role, checked in the room |
| Become owner or host of someone else's room | owner key; host rights checked in the room |
| Read a host's snapshot or a server-run game's hidden state | only sent to the host seat; never sent at all |
| Read or change admin settings, links, lobbies, reports | session cookie, origin check; the store is not reachable from the internet |
| Read Playtest reports | read key derived from the deploy token; sealed for the reader |
| Get past an emergency stop | checked before a room is woken and inside the room |

Someone **with a room's pairing code** for Playtest Remote can also take the tester link (SEC-1).

## 6. Recommended order

1. **Before Critical connects Playtest to its test list:** SEC-1, SEC-2, COST-2, and a version in the Playtest paths (API-2). Small, and each gets harder once reports and remotes exist.
2. **Before the next game is published to people outside the owner's circle:** COST-1 steps 1–4, SEC-3, COST-3, and the owner's decision on a domain of their own (COST-1 step 5).
3. **Before Bricks and Buzzy build on it:** the stability labels (API-1), API-3 (Bricks may be served from another origin), API-4, the `GameApi` compatibility test (API-2), and the settings save (S-2).
4. **When the code is next touched for a feature:** S-1, S-3, S-4, API-5, COST-4, COST-5 and the Low findings.
5. **Not recommended now:** a 1.0, or a larger rewrite of `room-core.js`. The structure carries; the three extractions in S-1 are enough.
