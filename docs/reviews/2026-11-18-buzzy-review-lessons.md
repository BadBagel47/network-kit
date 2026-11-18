# Lessons for network-kit from an external review of Buzzy (2026-11-18)

The owner had an external AI review of Buzzy's security (Firebase rules, code, workflows) on 2026-11-18. The report itself is kept out of this public repository, because it describes weaknesses in a published game; Buzzy's own session handles Buzzy's findings. This note only maps the findings onto network-kit, which Buzzy is to move to (Buzzy #408), and checks each against network-kit's code as of v0.6.0.

| Finding in the review (topic) | network-kit today | Action |
| --- | --- | --- |
| Short room codes as an access boundary (4 characters, about 1 million codes) | Codes are 4 characters by default (owner's decision, F-035). In an `open` room (the default) the code alone lets anyone join. Guessing is not stopped per visitor: every guess at an unknown code wakes a room object (a Durable Object request plus a Worker request), so mass guessing also spends the free quota of every game. | F-053 (limits per visitor at the Worker). Question for the owner: should games use invitation links with a key (`private`) by default? |
| Unlimited room creation | `POST /rooms` creates a room for anyone, without a limit per visitor. Empty rooms are deleted after 24 hours, but a flood of creations spends the quota. | F-053; the game-wide budget and on/off in F-003, F-004. |
| Seats that stay taken for ever | Not the case: seats and places are freed by the room after the grace period (60 s), on leaving and on kick; a returning participant gets the place back only if it is free (B-044). | None. |
| A banned person keeps reading | Not the case: a ban closes the connection at once, the room stops sending to them, every invitation key is renewed and the room becomes private (B-020). | None. |
| A banned person comes back in another role | Not the case: the ban is per browser identity, and all role keys are renewed, so no old link works. | None. |
| Anonymous identities weaken bans | The same limit applies: a ban is per browser identity, so a person with a new browser and a new link gets in. The kit has no accounts by design. | D-056: write the security model down (what codes, keys and bans protect, and what they do not). |
| No client attestation (App Check) | No equivalent; `allowedOrigins` only stops other web pages, not scripts. | Covered by F-053's per-visitor limits; nothing else planned. |
| API key in the browser | network-kit puts no keys in pages; the admin page's Cloudflare token stays in the Worker. | None. |
| No branch protection | network-kit's `main` is not protected either: agents push straight to `main` by the owner's decision (2026-11-15). Releases need the version check, the changelog and all tests to pass. | None now; noted for the owner. |
| Weak content security policy | The demo and the admin page send no content security policy. The pages set text with `textContent` and have no known injection, but a policy would limit the damage of one. | F-054 (security headers for the admin page and the demo). |
| External images | Not used by the kit. | None. |
| No clean-up of old data | Rooms are deleted 24 hours after the last participant left, closed rooms after an hour, demo reports after 7 days. One gap: the admin page's brake on wrong passwords keeps a small record per address with no end date. | B-055 (delete those records after a day). |

## What the review confirms

The kit's main choices hold up: authorization is enforced in the room (never only in the page), seats are freed by the server, bans renew every key, rooms and data are deleted on a schedule, and no secret ever reaches a page.
