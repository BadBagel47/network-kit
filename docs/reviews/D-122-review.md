# D-122: review of network-kit 0.15–0.19

- **Date:** 2026-11-20
- **Reviewed:** everything between the tags `v0.14.0` and `v0.19.0` (`git diff v0.14.0 v0.19.0`, 61 files), read at `main` `55cb940` (the code is the same as `v0.19.0`). Weighed most: Open test (F-118), Playtest Recorder and its start, stop and look-back (F-092, F-120), the admin page, the deploy and preview workflows, and the GameApi compatibility promise.
- **How:** read only, by a session that did not build the kit. Nothing in the repository was changed except this file. Six findings were confirmed by running the real code in Node with an in-memory store (marked *confirmed by running*; the output is in the appendix). Nothing was tried against the deployed Workers. Cloudflare's limits are taken from `admin/limits.js` (checked there 2026-11-17), not re-checked; `developers.cloudflare.com` is not reachable from this session.
- **Tests:** see *Test run* at the end.
- **Finding labels** (OT, REC, PRIV, COST, ROOM, OPS, API) are local to this document. Findings of D-093 are not repeated unless they came back; where one did, it says so.

## Summary

The work since D-093 is good. Its three High findings are fixed and stay fixed: the tester link's token no longer reaches Playtest Remote (an upload key that only sends pictures does), a doubled slash no longer opens a room, pictures are stored apart from their facts, and Playtest has a store of its own. The quota work of 0.16 (running rooms close on the budget, IPv6 per /64, a count of new rooms per game) closes most of COST-1. Settings saves no longer undo each other. Nothing found here lets a stranger read reports, recordings, settings or another room's secrets, or reach the admin page.

The new weak points are almost all in the two newest features:

1. **Open test is open to the whole internet, not to "anyone with one of the game's three addresses".** The token is the game's name with a prefix, the `Origin` check is on one path only, and the caps are one shared pot per game. While a test is on, anyone who knows the game's name can send reports, pictures and recordings from anywhere, and one visitor can use up the whole day's allowance in seconds, which ends the test for everyone else.
2. **What strangers write is read by the games' agents.** Open test reports and recordings go through the same sealed workflow as the owner's friends' reports, into the session of an agent that can push code.
3. **The Recorder does not notice when it should stop.** It keeps sending once a minute after the test was switched off, after the link expired and after the day's cap was reached, with the badge still saying that it records.
4. **Privacy is left to each game.** Telling the other players is the game's job, the two minutes of look-back are from before anyone was told, and the person who opens a `?record` address gets a red badge and no explanation.

| # | Finding | Severity |
| --- | --- | --- |
| OT-1 | Open test needs no address and no secret; one visitor can end it for everyone | High |
| OT-2 | Text from strangers reaches the games' agents through the sealed reports | Medium |
| REC-1 | The Recorder never stops: after switch-off, expiry or the cap it keeps sending, and the badge keeps saying it records | Medium |
| PRIV-1 | Who is told what: other players (left to the game), the look-back, and the person who records | Medium |
| OT-3 | Open test follows the origin, not the game: other pages and games on the same origin take part | Medium |
| COST-1 | The Open test caps: 5 hours of recording per game and day for everybody together; every app switch costs a batch | Medium |
| ROOM-1 | The new count of rooms per game is also a switch a stranger can turn off (60 requests an hour) | Medium |
| COST-2 | Clean-up lists every report, picture fact and session up to once a minute; reports are still loaded whole (D-093 COST-2, the rest) | Medium |
| REC-2 | Recorded data: kept by reference, can throw, and large batches vanish without a trace | Low |
| REC-3 | A full batch loses its "dropped" and "perf" markers | Low |
| OT-4 | Switching off: a written report is thrown away with the wrong message; a refused one is kept and sent later under another name | Low |
| PRIV-2 | The whole address is stored with every report and recording; the guide's privacy section is out of date | Low |
| COST-3 | Recordings in the public repository's history, whole, on every reading | Low |
| OPS-1 | The preview Workers also answer on workers.dev, outside the country rule | Low |
| OPS-2 | Deploys are not held back by the tests; the checks pass silently when there is no workers.dev address | Low |
| API-1 | The GameApi compatibility test is thinner than its promise; the Playtest paths have none | Low |
| OPS-3 | Notices on an untouched screen arrive up to ten minutes late | Low |
| OPS-4 | Smaller points | Low |

## 1. Open test (F-118)

### What is good

- Off by default, six hours at most, ends by itself, and the server refuses at once when it is off (`testerFor`, `admin/playtest.js:206–214`): there is no grace period and no cached "yes" on the server.
- An Open test token cannot open a Playtest Remote room or get an upload key (`admin/worker.js:131–133`, `admin/playtest.js:258`), so it reaches nothing but reports, pictures and recording batches.
- Everything from it is marked (`open: true`, *Öppet test*), sizes are capped per request (64 kB a report, 400 kB a picture, 128 kB a batch), and the caps are smaller than a tester link's.
- A page without `?record` or `?report` asks nothing and loads nothing (`src/client/playtest-entry.js:32–37, 48–53`).

### OT-1 (High): Open test needs no address and no secret — *confirmed by running*

- **Where:** `admin/playtest.js:199` (the token is `pto_<game>`), `:206–214` (`testerFor` accepts it from anyone while the test is on), `:29` and `:224–229` (one count per game and day: `ptn:open-<game>:<day>`), `admin/worker.js:206–211` (only `/playtest/v1/open` looks at `Origin`), `:53–58` (CORS `*` on all Playtest paths).
- **What:** the admin page says "Vem som helst med en av spelets tre adresser kan spela in eller rapportera". In the code the addresses are not needed:
  - The token is not a secret. It is the game's name, which is in the game's own page and Worker address. `/playtest/v1/report`, `/image` and `/record` take it without looking at `Origin` and without `/open` having been asked. Confirmed: a report posted with `pto_critical` and no `Origin` header was stored (200), and a recording batch from another origin was stored (200), while `/open` from that origin answered 404.
  - `/playtest/v1/check` with `pto_<game>` answers 200 or 401, so anyone can ask whether a game's Open test is on, as often as the per-address brake allows, and start the moment it is.
  - The `Origin` header only comes from honest browsers. A script sets it freely, so even a check on every path would not be a boundary.
  - The caps are per game, shared by everybody. Confirmed: one visitor sent 50 reports; the 51st from anyone is refused for the rest of the UTC day. The same goes for 300 batches and 100 pictures. The in-memory brake (60 requests a minute per address, `admin/worker.js:81–94`) lets one address do all of it in under ten minutes.
- **What a stranger gets while a test is on, per game and day:** 50 reports in the owner's list (any text, 64 kB each), 100 pictures the owner will open on their phone (any JPEG, PNG or WebP), 300 recording batches as up to 300 separate sessions under *Inspelningar* (each has to be removed one by one), about 95 MB of storage kept for 30 days (38 MB batches, 53 MB pictures, 3 MB reports), and the test itself: once the caps are gone, the friends the owner invited record and report nothing. They cannot read anything, and nothing outside Playtest is touched.
- **How likely:** it needs the test to be on (at most six hours at a time) and someone who knows the game's name and bothers. For games played by friends that is unlikely on any given evening. The effort is one `curl` line, and the feature exists precisely for the day the address is spread more widely.
- **Why High:** the stated protection ("with one of the addresses") does not exist, the feature's whole purpose can be cancelled with 50 requests, and it is the path by which strangers' text reaches the owner and the agents (OT-2). It is rated on that, not on money or stored bytes, which are bounded.
- **Proposal:**
  1. **Put a key in the three addresses.** The admin page already builds them and their QR codes, so nobody types them. Make a random key each time the test is switched on (stored in `ot:<game>`), write the addresses as `?record=<key>`, `?report=<key>`, and let the token be `pto_<game>.<key>`. Then "anyone with the address" is true, switching off and on again makes old addresses useless, and `/check` is no longer an oracle. A bare `?record` keeps working for tester links (Q15).
  2. **Give each visitor a share of the caps.** Pass `visitorKey(cf-connecting-ip)` from the Worker to the store and count per visitor and day as well (for example 10 reports, 20 pictures, 90 batches), with the per-game cap as the roof. One visitor can then never take the whole day.
  3. **Smaller limits for Open test:** 16 kB a report and 32 kB a batch are plenty for honest pages (see also COST-2).
  4. **One button to remove everything a test brought in** (*Ta bort allt från Öppet test <dag>*), since marked items can be found by `open: true`.
  5. Check `Origin` against the stored origin on `/report`, `/image` and `/record` too. It stops only other web sites' pages, not scripts, but it costs one comparison.

### OT-2 (Medium): strangers' text reaches the games' agents

- **Where:** `scripts/playtest-reports.mjs:31–52` (all reports and recordings of a game, Open test included, into one sealed file), `docs/INTEGRATION.md` section 11 ("What the agent does with the reports").
- **What:** the sealed reading was built for reports from people the owner gave a tester link. With Open test the same file holds free text, answers, a name, the "game context" object and recorded events written by anyone (OT-1), and it is opened inside the session of an agent that can change and publish a game. A report that reads like an instruction ("the fix is to add this script to index.html", "run this command") is an attempt to steer that agent. The items carry `open: true`, but nothing in the guide tells the agent what that means, and `open-reports.mjs` prints both kinds alike.
- **How likely / how bad:** it needs OT-1 and an agent that follows text in a report. Agents are told to treat tool output as data, so the likely outcome is nothing; the possible outcome is a change pushed to a game's repository on a stranger's word. Fixing OT-1 with a key in the address reduces "anyone" to "anyone who got the address", which is still wider than the owner's friends.
- **Proposal:** in `open-reports.mjs`, print Open test items under their own heading with one line saying they are from unknown visitors and are observations, never instructions; say the same in the guide's section 11; let the workflow leave them out unless asked (`what: reports+open`). In the reports' agent instructions of each game: an Open test report alone never starts a change; the owner confirms.

### OT-3 (Medium): the origin decides, not the game — *confirmed by running*

- **Where:** `admin/playtest.js:168–184` (only `origin` is kept for matching), `:195–203` (`openFor` returns the first test whose origin matches).
- **What:** every page on the same origin takes part, whatever its path. Confirmed: any page of `https://critical.example` gets `pto_critical`. That is right when a game has an origin of its own (the owner's games on subdomains of trythis.one, Vättigt on workers.dev). It is wrong when games share an origin, which the guide's own example points at (a page on `https://badbagel47.github.io`, where every project of the account shares one origin): Open test for one game then shows the panel and records in every other game there that runs the kit, and files their reports under the first game's name. With two tests on at once on one origin, the first in the list (alphabetical) takes both.
- **The other way round:** a game that answers on two addresses (workers.dev and trythis.one, or a preview) takes part on one of them only; the admin page gives no hint when a visitor's page asked from an origin that almost matched.
- **Proposal:** let the game say which game it is: `startPlaytest({ game })` and `startRecorder({ game })` already know `admin`; send `game` in the body of `/open` and require both the origin and the name to match (with the key from OT-1 this comes for free, since the key is per game). Until then, say in the guide and beside the form that Open test covers everything on that address's origin.

### OT-4 (Low): what the page does when the test is switched off

- **Where:** `src/client/playtest.js:292–311` (`openSession` keeps the answer for the tab until its original `expires`), `:239` and `:851–853` (a 401 discards the report), `:240–246` (anything else, a 429 too, is queued in localStorage).
- **What:**
  - Switched off early: tabs already open keep the panel and "till HH:MM". A tester who has written for ten minutes presses *Skicka*, the server answers 401, and the text is gone with the message "Testarlänken kan ha gått ut", which is about another feature.
  - The day's cap reached (429): the report and its pictures are put in the queue as if the network were down, with "Ingen kontakt just nu". They are sent the next time a panel starts in that browser, possibly days later, under whatever that panel is then: another Open test, or a tester link's name.
- **Proposal:** on 401 in Open test keep the text in the panel and say *Öppet test är avslutat*; treat 429 as "full for today" (tell the tester, do not queue); close the panel at `expires` and ask `/open` again then, so an extended test goes on and an ended one goes away.

## 2. Playtest Recorder (F-092, F-120)

### What is good

- Nothing is loaded or asked without a tester link or `?record`/`?report`; the look-back stays in memory and is trimmed every minute; a stopped tab stays stopped after a reload.
- The batches go as plain text without a preflight, the token in the body, never in an address; `sendBeacon` for the last one.
- The server cleans every event (`plain`, depth 3, short keys and texts), refuses another tester's session (`admin/playtest.js:380`), and deletes batches by name, never by listing them.
- The badge is a button the game never gets a tap from, and stopping needs two taps.

### REC-1 (Medium): the Recorder never stops — *confirmed by running*

- **Where:** `src/client/recorder.js:164–197` (`flush` clears the events, sends, and returns `false` on any failure), `:133–138` (`tick` every minute), `:112–118` (a batch on every `pagehide` and every time the page is hidden).
- **What:** the answer from the admin page is never looked at beyond `res.ok`. After Open test is switched off or runs out, after a tester link is revoked or expires, and after the day's cap is reached, the Recorder goes on exactly as before: one request a minute and one per app switch, each a Worker request and a store request that is refused. Confirmed: after five 401 answers it had sent five requests and was still `recording: true`.
  - **Cost:** a tab left open is 1,440 Worker requests a day, 1.4 % of the account's day, for nothing, for as long as it stays open. This is the same kind of leak as D-093 COST-4 (`watchNotices`), which 0.17 fixed for notices; the Recorder has no idle rule at all, also while it works.
  - **Honesty:** the red badge keeps saying *● Inspelning* while nothing is stored. After the cap this is the normal state for every player who joins later that day (COST-1).
- **Proposal:** on 401 stop for good (`close()`, badge away, `onStop` fires so the others are told); on 429 stop sending until the next UTC day or a reload and show it on the badge; stop at the Open test's `expires`; and like notices, send nothing while there are no new game or room events (a `perf` line alone is not worth a request).

### COST-1 (Medium): the Open test caps do not fit a test evening

- **Where:** `admin/playtest.js:29` (`chunk: 300` per game and UTC day), `src/client/recorder.js:115–118` (a batch per hide), `:31` (240 batches "four hours").
- **What:** a batch is about a minute, so 300 batches are five hours of recording for **all** visitors together. Four friends for an hour and a half is 360. On phones every switch to another app and back sends a batch of its own (the `visibility` event makes sure it is never empty), so the real figure is reached sooner. After that, see REC-1: no error anywhere, a badge that says it records, and under *Inspelningar* the evening simply ends early. The owner's Q9 chose 300; the consequence in hours was probably not visible when choosing.
- **Also:** the day is the UTC day, so the count starts over at 01:00 Swedish winter time, in the middle of a late evening; and a tester link's 1,500 batches a day meets the same arithmetic at 25 hours, which is fine.
- **Proposal:** count recorded minutes per visitor instead of batches per game (OT-1 proposal 2), with a roof per game sized in hours the owner picks ("at most 20 hours of recording per game and day"); do not send a batch on hide unless it holds more than the `visibility` event; show on the admin page how much of today's allowance is used while a test is on.

### REC-2 (Low): what the game hands to `record()` — *confirmed by running*

- **Where:** `src/client/recorder.js:79–89` (`d: data` kept as it is), `:188` (`JSON.stringify(chunk)`), `admin/worker.js:202–203` (128 kB a batch), `:190` (`sendBeacon`).
- **What:**
  - Data is kept by reference until the batch is sent, up to a minute later. A game that records its live state object gets the state at sending time. Confirmed: recorded `hp: 3`, sent `hp: 0`.
  - Data that cannot become JSON (a loop, a BigInt) makes `flush` throw. From the minute timer that is an unhandled rejection in the game's page, which the game's own error handling and Playtest's error list then report. The batch is lost. Confirmed for a loop. "Recording never disturbs the game" does not hold here.
  - A batch over 128 kB is refused (413), and a last batch over about 64 kB is refused by the browser's `sendBeacon`. In both cases the events are already cleared; nothing in the recording says a minute is missing. 500 events of 300 bytes each is enough.
- **Proposal:** in `record()`, turn the data into JSON at once inside `try`, cap it (for example 2 kB an event, replaced by `{ tooLarge: n }`), and keep the text. Count the batch's size and split it when it passes about 48 kB. Record a `lost` marker in the next batch when one was refused.

### REC-3 (Low): a full batch loses its markers — *confirmed by running*

- **Where:** `src/client/recorder.js:142, 167, 178` (the `perf` and `dropped` events are added after the 500 and sent as events 501 and 502), `admin/playtest.js:384` (`slice(0, RECORDING_EVENTS_MAX)`).
- **What:** exactly when a minute had more than 500 events, the server cuts the two lines that say so. Confirmed: 502 sent, 500 stored, no `dropped`, no `perf`. The reader sees a busy minute and cannot know events are missing.
- **Proposal:** let the server keep `RECORDING_EVENTS_MAX + 2`, or send the markers first.

## 3. Privacy

### PRIV-1 (Medium): who is told what

Under the shared rules (section 9) this is flagged for the owner's decision; it is not legal advice. The official source is IMY (GDPR, the duty to inform).

- **Other players, left to each game.** `src/client/recorder.js:6–7` and the guide say the others "are to be told", and the kit gives the text (`RECORDER_NOTICE`) and the hooks (`onStart`, `onStop`). The demo does it well. But nothing in the kit does it or checks it: a game that calls `startRecorder` and forgets the rest records silently, and with Open test (OT-1) the one recording can be anyone, not a friend of the owner's. Each game's session builds this by itself, in its own way.
- **The look-back.** *Spela in* sends the last two minutes (`recorder.js:245–259`), and the others are told when it starts. What they did in those two minutes was recorded before they were told. The owner approved the two minutes (Q12); the notice text does not mention them.
- **The person who records.** Someone who opens a `?record` address sees a small red badge with the Swedish word *Inspelning*, and nothing about what is recorded, for whom, or for how long. With `?report` the panel shows, but no such text either. What is stored for 30 days (longer with *Behåll*): the address, device, browser and user agent, window and screen size, language, the room's code, when each participant came and went (ids, not names), the game's own events, errors, the optional name. It is read by the owner and by the games' agents, and kept sealed on a branch of a public repository.
- **What is not recorded** (worth saying, because it is good): no names of other players, no chat or message contents, no keys, no IP addresses, no pictures unless the tester takes one.
- **Proposal:**
  1. Let the kit tell the others itself: `recorder.attach(room)` sends a small reserved message when recording starts and stops and to each newcomer, and the client shows a default one-line notice unless the game takes over the display. Then no game can forget it. (General: any game with rooms; default on.)
  2. Let the notice for a recording started with *Spela in* say "including the last two minutes".
  3. In Open test, show one line the first time in a tab, in the panel or beside the badge: what is recorded, that it is kept 30 days, and that closing the tab or the badge stops it. Text for the owner to approve.
  4. The owner decides whether the games' privacy notices need a line about recordings (the guide asks for one about rooms already).

### PRIV-2 (Low): the address, and the guide

- **Where:** `src/client/recorder.js:157` and `src/client/playtest.js:482` (`url: location.href`), `docs/INTEGRATION.md` section 10 (line 405).
- **What:** the whole address is stored, query and fragment included. Keys travel after `#` and are normally removed early, and the tester link is removed before the panel starts, but a report or a first batch made before a game has cleaned its address carries whatever is there (an invitation key, a lobby or game link). And the guide's privacy section still says Playtest stores things "only for browsers with a tester link"; with Open test and the Recorder that is no longer true, and recordings are not mentioned.
- **Also:** `admin/store.js:111` stores a hash of each room creator's address for two days (`ra:` keys). The hash has no secret in it, so for IPv4 it can be turned back into the address by trying them all. Add a random value kept in the store to the hash.
- **Proposal:** store origin and path only, plus the names (not values) of query parameters; update section 10.

## 4. Cost and quota

### ROOM-1 (Medium): the count of new rooms can be used to close a game

- **Where:** `admin/store.js:26–27` (`ROOMS_PER_HOUR = 60`, `ROOMS_PER_VISITOR_DAY = 40`), `:106–136`, `src/server/worker.js:252–257`.
- **What:** the count was D-093's proposal and does its job against a flood. But a visitor may make 40 rooms a day and the game 60 an hour, so two addresses (or one IPv4 and one IPv6) making 60 rooms at the top of each hour keep a game closed for new rooms all day, at 60 requests an hour, far under every other limit. Everyone else gets "Too many new rooms right now". The owner's game link gets past it; players do not. The log gets one line an hour.
- **Also:** 40 a day per IPv4 address is shared by everyone behind one school, office or mobile network address.
- **Proposal:** make the per-visitor limit bite per hour and far below the game's (for example 6 an hour and 20 a day per visitor, 60 an hour per game), so that closing a game takes ten addresses each hour instead of two; count only rooms somebody actually entered (a room nobody joined within a minute gives its place back); show "rooms refused this hour" on the game's card, since one log line is easy to miss.

### COST-2 (Medium): clean-up and lists read everything — D-093 COST-2, the part that was left

- **Where:** `admin/playtest.js:450–472` (`clean`, at most once a minute, called from every stored report and every stored batch), `:240–249` (`check` lists every report on every page load with a tester link), `:321–329`, `:338–341`.
- **What:** 0.15 moved the pictures' data out of the lists, which removed the fault that would have stopped Playtest. The reports themselves are still stored whole under `rep:` and loaded whole by every list, and `clean` now makes five lists (reports, picture facts, sessions, upload keys, counts).
  - **Rows read:** a Recorder that runs sends a batch a minute, so `clean` runs every minute: stored rows × minutes of recording. With 1,000 stored rows (a month of testing: reports, picture facts, one session per page visit) a single tab recording all day reads about 1.4 million rows, 29 % of the account's 5 million a day, shared with every game's rooms.
  - **Memory:** a report may be 64 kB. Tester links allow 200 a day and Open test 50 a day per game, kept 30 days. A few hundred large reports make every list tens of megabytes; about 2,000 at full size do not fit in the store's 128 MB, and then, as in D-093, sending and reading both fail and the clean-up that would help is the call that fails. Honest reports are 2–5 kB, so this needs either a very long time or someone filling them on purpose (OT-1 makes that possible on Open test days).
- **Proposal:** run `clean` from an alarm once an hour, not on the write path; keep a small index entry per report (id, game, time, test id, result, keep, open) apart from its body, as was done for pictures, and let `check`, `findReport` and `setKeep` read the index only; cap an Open test report at 16 kB.

### COST-3 (Low): recordings in the public repository's history — D-093 COST-5, now larger

- **Where:** `.github/workflows/playtest-reports.yml:63–75`, `scripts/playtest-reports.mjs:41–50`.
- **What:** `since` is 0 by default, so every reading with `what: recordings` or `both` fetches every session of the last 30 days whole and commits the sealed file to the branch `playtest-reports`. A session can be 30 MB (240 batches of 128 kB) and is typically a megabyte or two an hour. The branch keeps every earlier version, and GitHub refuses a single file over 100 MB, at which point the reading stops working.
- **Proposal:** let the workflow replace the branch with one commit each run (it owns the branch); make `since` default to the last reading for recordings, or list sessions first and fetch chosen ids (`recording: <id>`); refuse to write a file over 50 MB with a message that says to narrow it.

### Smaller cost points

- A `?record` or `?report` address asks `/playtest/v1/open` on every page load while the test is off, for ever; only a "yes" is kept (`src/client/playtest.js:303–305`). Keep the "no" for the tab for ten minutes.
- `recording(id)` (`admin/playtest.js:414–423`) builds a whole session in the store's memory: up to 30 MB of JSON, several times that as objects. Stream the batches, or cap a batch at 32 kB (OT-1).
- `ot:<game>` entries are never deleted, and a recording session is one per page visit, so a game with Playtest on every page (Critical) makes a session per page; both are small.

## 5. The admin page, deploys and the preview

### What is good

- The new paths follow the old pattern exactly: session cookie, same-origin check on every changing request, the Playtest store reached only through the Worker, bodies cut to 2 kB. The page still builds everything with `textContent`; stranger-written report text, names and addresses are shown as text, pictures are limited to three image types and served with `nosniff` under a policy that runs no script from them.
- The settings save with a revision (`admin/store.js`, `admin/public/app.js:169–184`) is right: an old copy is refused and the change is made again on the new settings.
- The sign-in brake for all addresses with a known-device mark is what D-093 asked for; the mark is signed and cannot be made up.
- The preview has Workers, storage, a password and a read key of its own; secrets go through the environment and are masked; the checks wait for the version just deployed.

### OPS-1 (Low): the preview also answers on workers.dev

- **Where:** `scripts/preview-config.mjs:13–20` copies `workers_dev: true` from the real configs.
- **What:** `network-kit-admin-preview` and `network-kit-demo-preview` therefore also answer at their workers.dev addresses, for the whole world, outside the country rule and the planned rate-limiting rule on trythis.one. They run unreleased code on the same account and the same daily quota as the games. The preview's own check only uses the trythis.one addresses, so nothing needs workers.dev there.
- **Proposal:** set `workers_dev: false` in the two preview configs.

### OPS-2 (Low): what holds a deploy back

- **Where:** `.github/workflows/preview.yml` (no tests), `deploy-admin.yml:58` (two unit test files), `:107–108` and `deploy-demo.yml` (`exit 0` when the output has no workers.dev address).
- **What:** the project rule says a push to `develop` "runs the tests and deploys a preview". Both happen, but apart: `test.yml` and `preview.yml` run side by side, and the preview deploys also when the tests fail. On `main` the admin page deploys after two unit test files; the full run is another workflow. And when the workers.dev addresses are retired (`docs/DEPRECATIONS.md`), both deploy checks will find no address in the output and end green without having checked anything, version wait included.
- **Proposal:** make the deploy jobs need the test job (one workflow with `needs`, or `workflow_run`); take the check's address from a variable (nk-admin.trythis.one with the bypass header) instead of from the deploy output, before workers.dev goes.

### API-1 (Low): the GameApi promise and its test

- **Where:** `tests/compat/gameapi.mjs`, `admin/gameapi.js`, `admin/entry.js:17–33`.
- **What:** `gameapi.js` is a clear, append-only home for the promise, and the test runs the newest release of every earlier minor from 0.13 against the current store. Gaps:
  - It checks status with notices, a closed game, a game link and a lobby's guest link. It says it checks "a measurement" and does not; `lobbyRoom` and a host link are not exercised; neither is the emergency stop, the one answer where a misread fails open (D-093 API-2).
  - It tests the object from `gameapi.js`, not the `GameApi` class in `entry.js` that games really call. A method left out of `entry.js` passes the test.
  - Without fetched tags it prints a line and passes (as it did in this session's first clone). In CI the tags are fetched; a changed checkout step would turn the test off silently.
  - The other interface games share live, the Playtest paths, has no such test. Critical's copy (0.15) talks to today's admin Worker with its own panel code; only the current client is tested against it.
- **Proposal:** add the stop, `measure`, `lobbyRoom` and the host link; assert that every method of `gameApi()` exists on `GameApi.prototype` and the other way round; fail when no earlier tag is found unless a variable says it is expected; run the earlier releases' `ReportSender` and Recorder against the current Playtest paths.

### OPS-3 (Low): notices on an untouched screen

- **Where:** `src/client/notices.js:17–18, 321–345`.
- **What:** after 30 minutes without a `pointerdown` or `keydown` a page asks every ten minutes instead of every minute. That fixes D-093 COST-4. The cost: a shared big screen, a player waiting through a long turn, or a game steered with a gamepad or by tilting counts as untouched, and "the game closes in 5 minutes" may arrive after it closed. The room still closes properly; only the warning is late.
- **Proposal:** count a room message or a gamepad as activity, or let the room's connection carry notices (D-093's proposal) so that polling is only for pages outside rooms.

### OPS-4 (Low): smaller points

- **A stranger can keep the owner out on a new device.** The brake for all addresses allows 30 wrong passwords, then waits up to an hour (`admin/worker.js:422`). Known devices are exempt, which is right, but a new phone or a cleared browser is not, for as long as someone keeps sending wrong passwords. Accepted in F-101; say in `docs/ADMIN.md` what to do then (use a known device).
- **The read key's paths are not braked.** `/playtest/v1/read*` with a wrong key answers 403 before the per-address count (`admin/worker.js:155–157`). The key is 256 bits, so only requests are at stake.
- **`sameOrigin` passes a request without an `Origin`** (`admin/worker.js:221–224`), as before; the Strict cookie is what protects. Fine; noted because the new paths rely on it too.
- **Open test accepts `http:` pages** (`admin/playtest.js:173`). Harmless; useful for local tries.
- **Recorded context says nothing when the first batch is lost:** the device and version come only with batch 0 (`recorder.js:181`, `admin/playtest.js:375–379`).
- **`?record` and `?report` are common words.** A game that uses either for something of its own gets the Recorder or the panel while Open test is on. A prefix (`?nk-record`) would avoid it; with the key from OT-1 the collision disappears anyway.

## 6. What a stranger can do now (changes since D-093)

| A stranger can | Limit | Finding |
| --- | --- | --- |
| While a game's Open test is on: send reports, pictures and recordings for it from anywhere, and use up its day | 50 reports, 100 pictures, 300 batches per game and day | OT-1 |
| Ask whether a game's Open test is on | 60 a minute per address | OT-1 |
| Put text in front of a game's agent | the caps above | OT-2 |
| Keep a game closed for new rooms | 60 rooms an hour from two addresses | ROOM-1 |
| Slow sign-in from a new device | 30 wrong passwords an hour | OPS-4 |

No longer possible: opening a Playtest room without a tester link (B-097), taking a tester link from a pairing code (B-094), using up the account with rooms that already run once Cloudflare limiting is on (F-098), getting a fresh allowance per IPv6 address (F-100).

Still cannot: read reports, recordings, pictures or settings; open Playtest Remote or get an upload key with an Open test token; reach anything outside Playtest through Open test; get past an emergency stop.

## 7. Recommended order

1. **Before Open test is used with more than the owner's own devices:** OT-1 (the key in the addresses and a share per visitor), REC-1 (stop on 401 and at the end), OT-2 (mark and separate strangers' reports for the agents), and the owner's decision on PRIV-1.
2. **Before a game is spread outside the owner's circle:** ROOM-1, COST-1, OT-3.
3. **Before recordings pile up (Critical's test list):** COST-2, COST-3, REC-2, REC-3.
4. **When the code is next touched:** OT-4, PRIV-2, OPS-1, OPS-2, API-1, OPS-3, OPS-4.

## Test run

`npm run test:all` in this session (Node 22, local workerd, Chromium; WebKit is not available): all passed. 228 unit tests, the compatibility checks (the game Workers of v0.13.4, v0.14.1, v0.15.1, v0.16.0, v0.17.0 and v0.18.0 against the 0.19.0 admin page; there is no earlier 0.19.x to compare the client with), 16 integration tests in local workerd, and the four browser runs in Chromium (demo, cross-origin status, admin page, Playtest). None of the findings above is caught by a test today; each proposal that changes behaviour should come with one.

## Appendix: output of the proof script

Run in Node against `admin/playtest.js`, `admin/worker.js` (`handle`) and `src/client/recorder.js` at `55cb940`, with an in-memory store. The script was kept outside the repository.

```
1a /open from another origin: 404
1b report with the guessed token pto_critical, no Origin: 200 {"id":"2fsHQGpz"}
1c recording batch from another origin: 200
1d 55 more reports from one visitor: 49 stored, 6 refused (cap is per game, shared by everyone)
1e any page of the same origin gets: critical pto_critical
2 stored events: 500 has dropped marker: false has perf: false
3 after five 401 answers: requests sent 5 · still recording: true · closed: false
3b circular data: flush throws TypeError
3c recorded hp 3, sent: {"hp":0}
```
