// The admin Worker's entry for Cloudflare (wrangler's "main"): the page and
// its API (worker.js), the Durable Objects, and GameApi, the entrypoint games
// call over a service binding to learn whether they are open (F-003, F-004)
// and to hand in their anonymous measurements (F-052). GameApi is not
// reachable from the internet.
import { WorkerEntrypoint } from 'cloudflare:workers';
import worker, { AdminGuard, playtestRooms } from './worker.js';
import { AdminStore } from './store.js';
import { PlaytestStore } from './playtest.js';
import { gameApi } from './gameapi.js';

export { AdminGuard, AdminStore, PlaytestStore };
// Playtest Remote's rooms (F-091).
export const PlaytestRoom = playtestRooms.RoomObject;
export default worker;

/** The entrypoint games call; its methods live in gameapi.js, which only ever grows (F-103). */
export class GameApi extends WorkerEntrypoint {
  api() {
    return gameApi(this.env.STORE.get(this.env.STORE.idFromName('main')));
  }

  status(game, mode = null, version = null) { return this.api().status(game, mode, version); }

  checkPass(game, token) { return this.api().checkPass(game, token); }

  lobby(game, token) { return this.api().lobby(game, token); }

  lobbyRoom(game, id, room) { return this.api().lobbyRoom(game, id, room); }

  measure(game, summary) { return this.api().measure(game, summary); }
}
