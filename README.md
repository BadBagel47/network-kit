# network-kit

A shared multiplayer room server and browser client for small browser games, running on Cloudflare.

- Rooms with short codes, secure share links and QR codes.
- Seats and roles (players, spectators, big screens), posts on a shared ship, late join, kick and ban.
- Host-run rooms (one player's browser runs the game, another player takes over if it drops) or server-run rooms.
- Messages to everyone, one player or a group; full-state snapshots for players who join or come back.
- Pause for everyone and a grace period before a lost player counts as gone.
- Automatic reconnection when a phone switches networks or a tab comes back.
- Coming: one admin page for all games (on/off/until, private rooms only, emergency stop, a daily budget per game).

Each game keeps its own rules and its own copy of a fixed network-kit version.

**How to use it in a game:** [docs/INTEGRATION.md](docs/INTEGRATION.md). Changes per version: [CHANGELOG.md](CHANGELOG.md).

## Development

```sh
npm install
npm test                   # unit tests
npm run test:integration   # demo Worker in local workerd + real WebSocket clients
npm run test:browser       # demo page in Chromium (needs Playwright)
npm run dev                # demo at http://localhost:8787
```

Plain JavaScript (ES modules), no runtime dependencies. `src/client` runs in the browser, `src/server` in a Cloudflare Worker with Durable Objects, `examples/demo` is the example game every release must pass.
