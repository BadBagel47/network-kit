# network-kit

A shared multiplayer room server and browser client for small browser games, running on Cloudflare (Workers Free plan).

- Rooms with codes of 4 to 12 characters (each game chooses), share links with a key per role, and QR codes.
- Roles defined by each game (players, viewers, a quiz leader, a referee …), seats per role, places such as posts or teams, late join, kick and ban.
- Host-run rooms (one participant's browser runs the game) or server-run rooms (the game's rules run in the room).
- An owner who keeps the rights to the room, and a host who runs the game. A lost host is waited for, or replaced by another participant where the game allows it.
- Messages to everyone, chosen participants, a role or a place; a kept game state for a host that reloads or is replaced.
- Pause for everyone, a grace period before a lost participant counts as gone, automatic reconnection.
- Limits that keep one room from using up the free plan.
- Coming: one admin page for all games (on/off/until, private rooms only, emergency stop, a daily budget per game).

Each game keeps its own rules and its own copy of a fixed network-kit version.

**How to use it in a game:** [docs/INTEGRATION.md](docs/INTEGRATION.md). Changes per version: [CHANGELOG.md](CHANGELOG.md). Demo: https://network-kit-demo.l8p1.workers.dev

## Development

```sh
npm install
npm test                   # unit tests: the room logic and the real client, in Node
npm run test:integration   # the example games in local workerd with real WebSocket clients
npm run test:browser       # the demo page in Chromium (Playwright)
npm run test:compat        # the previous patch release's client against this version
npm run smoke              # the smoke test that ships with every copy
npm run dev                # demo at http://localhost:8787
```

Plain JavaScript (ES modules), no runtime dependencies. `src/client` runs in the browser, `src/server` in a Cloudflare Worker with Durable Objects (`room-core.js` is the room logic, free of Cloudflare; `worker.js` is the glue). `examples/demo` holds the three example games every release must pass: a crew game with takeover, a turn-based memory game and a quiz with a non-playing leader.
