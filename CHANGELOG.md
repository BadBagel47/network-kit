# Changelog

network-kit uses version numbers MAJOR.MINOR.PATCH (D-009):

- **PATCH**: bug fixes only, safe to take. Games get them as automatic update proposals.
- **MINOR**: new features; code written for the same MAJOR keeps working.
- **MAJOR**: games must adapt; each entry says how.

Each version says who is affected. Functions on their way out are marked *deprecated* for at least one MINOR version before they are removed.

## Unreleased

## 0.1.0 (2026-11-15)

First version (run A: F-001, F-002, F-005, F-006, F-007, D-009). Affects: nobody yet; Critical ST8 is the first game to take it in.

- Room server core on Cloudflare Durable Objects (Workers Free plan, SQLite-backed objects): short room codes, create, info, join, leave, close; rooms sleep between messages (WebSocket hibernation, heartbeats answered without waking the room); rooms are deleted 24 hours after the last player left.
- Seats with limits per role (players and viewers; a viewer never becomes a player), named posts on a shared ship that players claim and switch freely, kick and ban.
- Late join per room: now, at the next safe point (the host admits), or never.
- Host-run rooms (one player's browser runs the game, the server relays) and server-run rooms (the game's rules run in the room).
- Messages to everyone, to one player or a chosen group; full-state snapshots for players who join or come back.
- Host takeover: when the host's connection is lost, another player continues from the latest snapshot after a short wait; a host whose page reloads gets the snapshot back.
- Pause for everyone, a grace period before a dropped player counts as gone, optional automatic pause, drop/back/gone events.
- Browser client: reconnection on network change, tab return and coming back online, growing retry delay, heartbeat; duplicate protection for messages resent after a glitch.
- Share links with a key per role (player, viewer) after `#`, private rooms, renewable keys with optional expiry, QR codes (vendored qrcode-generator 1.4.4, MIT).
- Versions and updates: tagged releases, `scripts/vendor.mjs` for the game's own copy, and `templates/update-network-kit.yml` for automatic bug-fix update proposals in games.
- Example games and tests: a host-run demo page and a server-run memory game.
