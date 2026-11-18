// What the admin page decides for each game (F-003, F-004, F-008), kept
// independent of Cloudflare so it is tested in Node.
//
// Settings (stored by AdminStore):
//   account: { plan: 'free' | 'paid', capUsd: number | null, autoClose: boolean }   autoClose is "Cloudflare limiting"
//   games:   { [game]: { mode: 'on' | 'off' | 'timer', timer: { until: ISO, then: 'off' | 'stop' } | null,
//                        stopped: boolean, share: number | null,
//                        url: string | null,           the page players open (for game links)
//                        modes: { [name]: { mode, timer } } } }  e.g. Bricks' 1 Player / 2 Players (F-057)
//   'off' is shown as "No new players". A timer makes the game or mode work as On until
//   `until`, then as `then` (no new players, or an emergency stop for that game or mode) (F-067).
// A game is a Worker's script name (as the usage figures name it).

import { METRICS } from './limits.js';
import { NOTICE_TEXT } from '../src/shared/protocol.js';

export { NOTICE_TEXT };

export const MODES = ['on', 'off', 'timer'];
const THEN = ['off', 'stop'];

/** Players are warned this long before a timer ends (F-067). */
export const TIMER_WARN_MS = 10 * 60_000;
/** ... and told for this long after it ended. */
export const TIMER_ENDED_MS = 60 * 60_000;

/** Players are warned when a game has used this part of its share of the day (F-065). */
export const NEAR = 0.9;

export function defaultGame() {
  return { mode: 'on', timer: null, stopped: false, share: null, url: null, modes: {} };
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const cleanUntil = (u) => (u && !Number.isNaN(Date.parse(u)) ? new Date(u).toISOString() : null);

/** One game's or mode's mode and timer; the removed "off until" becomes No new players or On. */
function cleanMode(v, now) {
  let mode = MODES.includes(v?.mode) ? v.mode : v?.mode === 'until' ? 'until' : 'on';
  if (mode === 'until') mode = v.until && Date.parse(v.until) > now ? 'off' : 'on';
  const until = cleanUntil(v?.timer?.until);
  const timer = until ? { until, then: THEN.includes(v.timer.then) ? v.timer.then : 'off' } : null;
  if (mode === 'timer' && !timer) mode = 'off';
  return { mode, timer: mode === 'timer' ? timer : null };
}
const cleanUrl = (u) => {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' || url.hostname === 'localhost' ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
};

export function normalizeSettings(raw = {}, now = Date.now()) {
  const a = raw.account ?? {};
  const account = {
    plan: a.plan === 'paid' ? 'paid' : 'free',
    capUsd: Number.isFinite(Number(a.capUsd)) && a.capUsd !== null && a.capUsd !== '' && Number(a.capUsd) >= 0 ? Number(a.capUsd) : null,
    // Closing games automatically when they pass their share is off until the owner turns it on.
    autoClose: a.autoClose === true,
  };
  const games = {};
  for (const [name, g] of Object.entries(raw.games ?? {})) {
    if (!NAME.test(name)) continue;
    const modes = {};
    for (const [m, v] of Object.entries(g?.modes ?? {}).slice(0, 8)) {
      if (!NAME.test(m)) continue;
      modes[m] = cleanMode(v, now);
    }
    const share = g?.share === null || g?.share === '' || g?.share === undefined ? null : Math.max(0, Math.min(100, Number(g.share) || 0));
    games[name] = {
      ...cleanMode(g, now),
      stopped: g?.stopped === true,
      share,
      url: g?.url ? cleanUrl(g.url) : null,
      modes,
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
  note: 'Workers CPU time is not counted (it is not in the usage figures). Room requests count 20 incoming WebSocket messages as one, as Cloudflare bills them.',
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
  const near = {}; // past NEAR of the share: players are warned (F-065)
  const warnings = [];
  const daily = METRICS.filter((m) => m.per === 'day' && usage.available.includes(m.key));
  for (const game of usage.games) {
    for (const m of daily) {
      const used = game.daily[m.key][usage.today] ?? 0;
      const allowed = (m.limit * (share[game.name] ?? 0)) / 100;
      if (allowed > 0 && used > allowed) {
        over[game.name] ??= `${m.label}: ${Math.round(used)} of its ${Math.round(allowed)} today`;
      } else if (allowed > 0 && used > allowed * NEAR) {
        near[game.name] ??= `${m.label}: ${Math.round(used)} of its ${Math.round(allowed)} today`;
      }
      if (allowed > 0 && used <= allowed && used > allowed * 0.8) {
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
  const capNear = settings.account.plan === 'paid' && settings.account.capUsd !== null && !capPassed && cost.usd >= settings.account.capUsd * NEAR;
  const nearing = settings.account.plan === 'paid'
    ? (capNear ? Object.fromEntries(names.map((n) => [n, 'the monthly spending cap is near'])) : {})
    : Object.fromEntries(Object.entries(near).filter(([n]) => !over[n]));
  return { day: usage.today, share, over: closing, near: nearing, warnings, cost, at: usage.generatedAt };
}

/** What a game's or mode's setting means at `now`: 'on', 'off' or 'stop' (a timer, F-067). */
export function effectiveMode(entry, now = Date.now()) {
  if (entry?.mode === 'timer' && entry.timer) {
    if (now < Date.parse(entry.timer.until)) return 'on';
    return entry.timer.then === 'stop' ? 'stop' : 'off';
  }
  return entry?.mode === 'off' ? 'off' : 'on';
}

const STOPPED = { open: false, reason: 'stopped', stopped: true, until: null };
const NO_NEW = { open: false, reason: 'off', stopped: false, until: null };

/**
 * Is the game (or one of its modes, F-057) open for new rooms, new
 * participants and new rounds? The game's own settings come first; a mode can
 * only close more, never open what the game has closed. A stop wins over
 * everything, also over game links.
 */
export function gameStatus(settings, budget, game, now = Date.now(), mode = null) {
  const g = settings.games[game] ?? defaultGame();
  const status = gameOnly(settings, budget, game, g, now);
  const m = mode ? g.modes?.[mode] : null;
  if (status.stopped || !m) return status;
  const eff = effectiveMode(m, now);
  if (eff === 'stop') return { ...STOPPED };
  if (!status.open) return status;
  if (eff === 'off') return { ...NO_NEW };
  return status;
}

function gameOnly(settings, budget, game, g, now) {
  const eff = effectiveMode(g, now);
  if (g.stopped || eff === 'stop') return { ...STOPPED };
  if (eff === 'off') return { ...NO_NEW };
  const today = new Date(now).toISOString().slice(0, 10);
  if (settings.account.autoClose && budget?.day === today && budget.over?.[game]) {
    const midnight = `${new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString()}`;
    return { open: false, reason: 'budget', stopped: false, until: midnight };
  }
  return { open: true, reason: null, stopped: false, until: null };
}

// ---- notices to players (F-066)
//
// A notice is { id, kind, level, title, text, until }. Pages show it in a box
// that cannot be missed, with a warning sound, until the player presses OK; a
// page shows each id once. "{until}" in a text is replaced by the page with
// the local time of `until`. English only (owner's decision 2026-11-18).


function timerNotices(entry, scope, now) {
  if (entry.mode !== 'timer' || !entry.timer) return [];
  const end = Date.parse(entry.timer.until);
  const stop = entry.timer.then === 'stop';
  const key = `${scope}-${end}`;
  if (now < end) return end - now <= TIMER_WARN_MS ? [notice(`timer-soon-${key}`, stop ? 'timer-stop-soon' : 'timer-soon', entry.timer.until)] : [];
  if (now - end < TIMER_ENDED_MS) return [notice(`timer-ended-${key}`, stop ? 'timer-stopped' : 'timer-ended', entry.timer.until)];
  return [];
}

const notice = (id, kind, until, extra = {}) => ({ id, kind, level: NOTICE_TEXT[kind].level, title: NOTICE_TEXT[kind].title, text: NOTICE_TEXT[kind].text, until, ...extra });

/**
 * The notices a game's players should see now: Cloudflare limiting soon or
 * reached (only while automatic closing is on) and the owner's own messages
 * to this game or to every game. `messages` are the stored ones (AdminStore).
 */
export function gameNotices(settings, budget, game, now = Date.now(), messages = [], mode = null) {
  const list = [];
  // Timers (F-067): the game's, and the asked mode's (or every mode's, named, when no mode is asked).
  const g = settings.games[game];
  if (g) {
    list.push(...timerNotices(g, 'game', now));
    for (const [m, entry] of Object.entries(g.modes ?? {})) {
      if (mode && m !== mode) continue;
      list.push(...timerNotices(entry, m, now).map((n) => (mode ? n : { ...n, title: `${n.title} (${m})` })));
    }
  }
  const today = new Date(now).toISOString().slice(0, 10);
  if (settings.account.autoClose && budget?.day === today) {
    const midnight = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString();
    if (budget.over?.[game]) list.push(notice(`budget-closed-${today}`, 'budget-closed', midnight));
    else if (budget.near?.[game]) list.push(notice(`budget-soon-${today}`, 'budget-soon', midnight));
  }
  for (const m of messages) {
    if ((m.game === game || m.game === '*') && m.until > now) {
      list.push({ id: `msg-${m.id}`, kind: 'message', level: m.level === 'warning' ? 'warning' : 'info', title: m.level === 'warning' ? 'Warning' : NOTICE_TEXT.message.title, text: m.text, until: new Date(m.until).toISOString() });
    }
  }
  return list;
}
