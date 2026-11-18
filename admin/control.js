// What the admin page decides for each game (F-003, F-004, F-008), kept
// independent of Cloudflare so it is tested in Node.
//
// Settings (stored by AdminStore):
//   account: { plan: 'free' | 'paid', capUsd: number | null, autoClose: boolean }
//   games:   { [game]: { mode: 'on' | 'off' | 'until', until: ISO | null,
//                        privateOnly: boolean, stopped: boolean, share: number | null } }
// A game is a Worker's script name (as the usage figures name it).

import { METRICS } from './limits.js';

export const MODES = ['on', 'off', 'until'];

export function defaultGame() {
  return { mode: 'on', until: null, privateOnly: false, stopped: false, share: null };
}

export function normalizeSettings(raw = {}) {
  const a = raw.account ?? {};
  const account = {
    plan: a.plan === 'paid' ? 'paid' : 'free',
    capUsd: Number.isFinite(Number(a.capUsd)) && a.capUsd !== null && a.capUsd !== '' && Number(a.capUsd) >= 0 ? Number(a.capUsd) : null,
    // Closing games automatically when they pass their share is off until the owner turns it on.
    autoClose: a.autoClose === true,
  };
  const games = {};
  for (const [name, g] of Object.entries(raw.games ?? {})) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) continue;
    const until = g?.until && !Number.isNaN(Date.parse(g.until)) ? new Date(g.until).toISOString() : null;
    const share = g?.share === null || g?.share === '' || g?.share === undefined ? null : Math.max(0, Math.min(100, Number(g.share) || 0));
    games[name] = {
      mode: MODES.includes(g?.mode) ? g.mode : 'on',
      until,
      privateOnly: g?.privateOnly === true,
      stopped: g?.stopped === true,
      share,
    };
  }
  return { account, games };
}

/** Each game's share of the daily free limits, in percent: set ones first, the rest split equally (Q5). */
export function shares(settings, gameNames) {
  const names = [...new Set([...Object.keys(settings.games), ...gameNames])];
  const set = names.filter((n) => settings.games[n]?.share !== null && settings.games[n]?.share !== undefined);
  const taken = set.reduce((sum, n) => sum + settings.games[n].share, 0);
  const rest = names.filter((n) => !set.includes(n));
  const each = rest.length ? Math.max(0, 100 - taken) / rest.length : 0;
  return Object.fromEntries(names.map((n) => [n, set.includes(n) ? settings.games[n].share : each]));
}

// Cloudflare's Workers Paid plan (checked 2026-11-18 in Cloudflare's
// documentation): $5 a month, and these included amounts and prices.
export const PAID = {
  baseUsd: 5,
  items: [
    { key: 'workerRequests', included: 10_000_000, perMillionUsd: 0.30 },
    { key: 'doRequests', included: 1_000_000, perMillionUsd: 0.15, billedShare: 1 },
    { key: 'doDuration', included: 400_000, perMillionUsd: 12.50 },
    { key: 'rowsRead', included: 25_000_000_000, perMillionUsd: 0.001 },
    { key: 'rowsWritten', included: 50_000_000, perMillionUsd: 1.00 },
  ],
  storageIncludedGb: 5,
  storagePerGbMonthUsd: 0.20,
  note: 'Workers CPU time is not counted (it is not in the usage figures); Durable Object requests are counted as measured, while Cloudflare bills incoming WebSocket messages at 1 in 20, so the real figure is lower.',
};

/** What this month's use would cost on the Paid plan. `month`: totals per metric key. */
export function estimateCost(month) {
  const lines = PAID.items.map((it) => {
    const used = month[it.key] ?? 0;
    const over = Math.max(0, used - it.included);
    return { key: it.key, used, included: it.included, usd: (over / 1e6) * it.perMillionUsd };
  });
  const gb = (month.storedBytes ?? 0) / 1e9;
  lines.push({ key: 'storedBytes', used: month.storedBytes ?? 0, included: PAID.storageIncludedGb * 1e9, usd: Math.max(0, gb - PAID.storageIncludedGb) * PAID.storagePerGbMonthUsd });
  const usd = PAID.baseUsd + lines.reduce((sum, l) => sum + l.usd, 0);
  return { usd: Math.round(usd * 100) / 100, lines, note: PAID.note };
}

/**
 * Which games are over their budget today (free plan: their share of each
 * daily free limit) or, on the paid plan, whether the month's estimated cost
 * has passed the cap. `usage` is the analytics result (buildUsage).
 */
export function budgetState(settings, usage) {
  const names = usage.games.map((g) => g.name);
  const share = shares(settings, names);
  const over = {};
  const warnings = [];
  const daily = METRICS.filter((m) => m.per === 'day' && usage.available.includes(m.key));
  for (const game of usage.games) {
    for (const m of daily) {
      const used = game.daily[m.key][usage.today] ?? 0;
      const allowed = (m.limit * (share[game.name] ?? 0)) / 100;
      if (allowed > 0 && used > allowed) {
        over[game.name] ??= `${m.label}: ${Math.round(used)} of its ${Math.round(allowed)} today`;
      } else if (allowed > 0 && used > allowed * 0.8) {
        warnings.push(`${game.name}: ${m.label} at ${Math.round((used / allowed) * 100)} % of its share`);
      }
    }
  }
  // The account as a whole, against the free daily limits.
  for (const m of daily) {
    const total = usage.games.reduce((sum, g) => sum + (g.daily[m.key][usage.today] ?? 0), 0);
    if (total > m.limit * 0.8) warnings.push(`whole account: ${m.label} at ${Math.round((total / m.limit) * 100)} % of the free limit`);
  }
  const monthDays = usage.dates.filter((d) => d.slice(0, 7) === usage.today.slice(0, 7));
  const month = {};
  for (const m of METRICS) {
    month[m.key] = m.per === 'total'
      ? usage.games.reduce((sum, g) => sum + (g.daily[m.key][usage.today] ?? 0), 0)
      : usage.games.reduce((sum, g) => sum + monthDays.reduce((s2, d) => s2 + (g.daily[m.key][d] ?? 0), 0), 0);
  }
  const cost = estimateCost(month);
  const capPassed = settings.account.plan === 'paid' && settings.account.capUsd !== null && cost.usd >= settings.account.capUsd;
  if (capPassed) warnings.push(`the month's estimated cost (${cost.usd} USD) has reached the cap (${settings.account.capUsd} USD)`);
  // On the paid plan the daily shares do not apply; only the cap does.
  const closing = settings.account.plan === 'paid'
    ? (capPassed ? Object.fromEntries(names.map((n) => [n, 'the monthly spending cap is reached'])) : {})
    : over;
  return { day: usage.today, share, over: closing, warnings, cost, at: usage.generatedAt };
}

/** Is the game open for new rooms, new participants and new rounds? */
export function gameStatus(settings, budget, game, now = Date.now()) {
  const g = settings.games[game] ?? defaultGame();
  if (g.stopped) return { open: false, reason: 'stopped', stopped: true, privateOnly: g.privateOnly, until: null };
  if (g.mode === 'off') return { open: false, reason: 'off', stopped: false, privateOnly: g.privateOnly, until: null };
  if (g.mode === 'until' && g.until && Date.parse(g.until) > now) {
    return { open: false, reason: 'until', stopped: false, privateOnly: g.privateOnly, until: g.until };
  }
  const today = new Date(now).toISOString().slice(0, 10);
  if (settings.account.autoClose && budget?.day === today && budget.over?.[game]) {
    const midnight = `${new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString()}`;
    return { open: false, reason: 'budget', stopped: false, privateOnly: g.privateOnly, until: midnight };
  }
  return { open: true, reason: null, stopped: false, privateOnly: g.privateOnly, until: null };
}
