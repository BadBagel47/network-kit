// The admin Worker's entry for Cloudflare (wrangler's "main"): the page and
// its API (worker.js), the Durable Objects, and GameApi, the entrypoint games
// call over a service binding to learn whether they are open (F-003, F-004)
// and to hand in their anonymous measurements (F-052). GameApi is not
// reachable from the internet.
import { WorkerEntrypoint } from 'cloudflare:workers';
import worker, { AdminGuard } from './worker.js';
import { AdminStore } from './store.js';

export { AdminGuard, AdminStore };
export default worker;

export class GameApi extends WorkerEntrypoint {
  store() {
    return this.env.STORE.get(this.env.STORE.idFromName('main'));
  }

  /** { open, reason, until, stopped, notices } for the game (its Worker's name); the game tells its network-kit version (F-074). */
  async status(game, mode = null, version = null) {
    const q = new URLSearchParams({ game: String(game), ...(mode ? { mode: String(mode) } : {}), ...(version ? { version: String(version) } : {}) });
    const res = await this.store().fetch(`https://store/status?${q}`);
    return res.json();
  }

  /** Is this the owner's admin pass for the game (F-058)? */
  async checkPass(game, token) {
    const res = await this.store().fetch('https://store/check-pass', { method: 'POST', body: JSON.stringify({ game: String(game), token: String(token ?? '') }) });
    return (await res.json()).valid === true;
  }

  /** An anonymous connection-quality summary from one of the game's pages (F-052). */
  async measure(game, summary) {
    await this.store().fetch('https://store/measure', { method: 'POST', body: JSON.stringify({ game: String(game), summary }) });
  }
}
