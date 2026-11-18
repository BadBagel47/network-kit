// The admin page's settings and the games' budget, in one Durable Object
// (SQLite, Free plan). Games ask it through the admin Worker's GameApi
// entrypoint (a service binding), never over the internet.

import { CloudflareAnalytics } from './analytics.js';
import { normalizeSettings, budgetState, gameStatus } from './control.js';

const BUDGET_EVERY_MS = 5 * 60_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export class AdminStore {
  constructor(state, env, deps = {}) {
    this.storage = state.storage;
    this.env = env;
    this.now = deps.now ?? Date.now;
    this.analytics = deps.analytics ?? null; // tests replace the Cloudflare API
  }

  async settings() {
    return normalizeSettings((await this.storage.get('settings')) ?? {});
  }

  async budget() {
    return (await this.storage.get('budget')) ?? null;
  }

  /** Read today's use and work out who is over budget; kept for the games' checks. */
  async refreshBudget() {
    const token = this.env.CF_ANALYTICS_TOKEN;
    if (!token && !this.analytics) return null;
    const analytics = this.analytics ?? new CloudflareAnalytics({ token, accountId: this.env.CF_ACCOUNT_ID || null });
    const usage = await analytics.usage({ days: 31 });
    const budget = budgetState(await this.settings(), usage);
    await this.storage.put('budget', budget);
    return budget;
  }

  async status(game) {
    return gameStatus(await this.settings(), await this.budget(), game, this.now());
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/settings' && request.method === 'GET') {
      return json({ settings: await this.settings(), budget: await this.budget() });
    }
    if (url.pathname === '/settings' && request.method === 'PUT') {
      const settings = normalizeSettings(await request.json());
      await this.storage.put('settings', settings);
      // Automatic closing reads the budget every 5 minutes while it is on.
      if (settings.account.autoClose) await this.storage.setAlarm(this.now() + 1_000);
      else await this.storage.deleteAlarm();
      return json({ settings, budget: await this.budget() });
    }
    if (url.pathname === '/status') {
      return json(await this.status(url.searchParams.get('game') ?? ''));
    }
    return json({ error: 'not-found' }, 404);
  }

  async alarm() {
    const settings = await this.settings();
    if (!settings.account.autoClose) return;
    try {
      await this.refreshBudget();
    } finally {
      await this.storage.setAlarm(this.now() + BUDGET_EVERY_MS);
    }
  }
}
