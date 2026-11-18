// network-kit admin page: draws /api/usage. Names from the API are set with
// textContent, never as HTML.

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const SERIES = 8; // colours in the palette; more games share the last one

const el = (tag, attrs = {}, text) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
};
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

function bytes(v) {
  const units = ['B', 'kB', 'MB', 'GB'];
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${i ? nf1.format(v) : nf.format(v)} ${units[i]}`;
}
const format = (metric, v) => (metric.unit === 'bytes' ? bytes(v) : metric.unit === 'GB-s' ? `${nf1.format(v)} GB-s` : nf.format(Math.round(v)));
const formatTick = (metric, v) => (metric.unit === 'bytes' ? bytes(v) : v >= 10_000 ? compact.format(v) : nf.format(v));

let data = null;
let period = 'today';

/* ---------- loading and signing in ---------- */

async function load() {
  const res = await fetch('/api/usage', { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({ error: 'bad-answer' }));
  if (res.status === 401) return showSignIn(body);
  $('logout').hidden = false;
  if (body.error === 'no-token') {
    $('message').textContent = 'Signed in. The usage figures need a read-only Cloudflare token (CLOUDFLARE_ANALYTICS_TOKEN) before they can be shown.';
    return;
  }
  if (body.error) {
    $('message').textContent = `Cloudflare's figures could not be read: ${body.message ?? body.error}`;
    return;
  }
  data = body;
  $('message').textContent = '';
  $('dashboard').hidden = false;
  render();
  loadQuality().catch(() => {});
  loadPasses().catch(() => {});
  loadMessages().catch(() => {});
}

function showSignIn(body) {
  $('signin').hidden = false;
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  const text = !body.passwordSet || error === 'notset'
    ? 'No password is set for this page yet (ADMIN_PASSWORD, at least 12 characters).'
    : error === 'wrong' ? 'Wrong password.'
      : error === 'wait' ? `Too many wrong passwords. Try again in ${Math.max(1, Math.ceil(Number(params.get('s')) / 60))} min.`
        : '';
  $('signin-error').textContent = text;
  $('password').focus();
}

/* ---------- figures ---------- */

const metricsShown = () => data.metrics.filter((m) => data.available.includes(m.key));

/** Dates in the chosen period. */
function periodDates() {
  const { dates, today } = data;
  if (period === 'today') return [today];
  if (period === 'yesterday') return [dates[dates.length - 2]];
  return dates.filter((d) => d.slice(0, 7) === today.slice(0, 7));
}

/** A game's figure for a metric over dates: a sum, or the latest level for storage. */
function value(game, metric, dates) {
  const series = game.daily[metric.key];
  if (metric.per === 'total') {
    for (let i = dates.length - 1; i >= 0; i--) if (series[dates[i]]) return series[dates[i]];
    return 0;
  }
  return dates.reduce((sum, d) => sum + (series[d] ?? 0), 0);
}

/** Share of the free limit; for a month, the average day against the daily limit. */
function share(metric, v, days) {
  return metric.per === 'total' ? v / metric.limit : v / days / metric.limit;
}

function bar(fraction, thin = false) {
  const level = fraction >= 1 ? 'critical' : fraction >= 0.8 ? 'warning' : '';
  const outer = el('div', { class: `bar${thin ? ' thin' : ''}${level ? ` ${level}` : ''}`, role: 'img', 'aria-label': `${nf.format(fraction * 100)} % of the free limit` });
  const fill = el('span');
  fill.style.width = `${Math.min(100, fraction * 100)}%`;
  outer.append(fill);
  return outer;
}

function statusLabel(fraction) {
  if (fraction >= 1) return el('span', { class: 'status critical' }, 'Over the free limit');
  if (fraction >= 0.8) return el('span', { class: 'status warning' }, 'Near the free limit');
  return null;
}

function renderMeters() {
  const list = $('meters');
  list.replaceChildren();
  for (const metric of metricsShown()) {
    const total = data.games.reduce((sum, g) => sum + value(g, metric, [data.today]), 0);
    const fraction = total / metric.limit;
    const li = el('li', { class: 'meter' });
    const name = el('span', { class: 'name' }, metric.label);
    const figure = el('span', { class: 'figure' }, `${format(metric, total)} of ${format(metric, metric.limit)}${metric.per === 'day' ? ' a day' : ''} · ${nf.format(fraction * 100)} %`);
    const label = statusLabel(fraction);
    if (label) figure.append(label);
    li.append(name, bar(fraction), figure);
    list.append(li);
  }
  const at = new Date(data.generatedAt);
  // B-069: what the room requests are made of.
  const sumOf = (key) => data.games.reduce((sum, g) => sum + (g.daily[key]?.[data.today] ?? 0), 0);
  const messages = sumOf('doMessages');
  const rooms = data.available.includes('doRequests')
    ? ` Room requests: ${nf.format(sumOf('doRequestsAll') - messages)} connections and other calls, and ${nf.format(messages)} incoming messages, of which 20 count as one request.`
    : '';
  $('today-note').textContent = `${data.today} (UTC), up to ${at.toISOString().slice(11, 16)} UTC. The free limits are for the whole account and reset at 00:00 UTC. Cloudflare's figures can lag a few minutes.${rooms}`;
}

function renderGames() {
  const table = $('games');
  table.replaceChildren();
  const metrics = metricsShown();
  const dates = periodDates();
  const head = el('tr');
  head.append(el('th', { scope: 'col' }, 'Game'));
  for (const m of metrics) head.append(el('th', { scope: 'col' }, m.label));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  data.games.forEach((game, i) => {
    const tr = el('tr');
    const name = el('th', { scope: 'row' });
    const key = el('span', { class: 'key' });
    key.style.background = `var(--series-${Math.min(i, SERIES - 1) + 1})`;
    name.append(key, document.createTextNode(game.name));
    tr.append(name);
    for (const m of metrics) {
      const v = value(game, m, dates);
      const td = el('td', {}, format(m, v));
      td.append(bar(share(m, v, dates.length), true));
      tr.append(td);
    }
    body.append(tr);
  });
  table.append(body);
  $('period-note').textContent = period === 'month'
    ? `${dates[0]} to ${dates[dates.length - 1]}. The bars compare the average day with the daily free limit.`
    : `${dates[0]} (UTC). The bars compare each game with the account's daily free limit.`;
}

/* ---------- 30-day chart ---------- */

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function renderChart() {
  const metric = data.metrics.find((m) => m.key === $('metric').value) ?? metricsShown()[0];
  const box = $('chart');
  box.replaceChildren();
  const dates = data.dates.slice(-30);
  const games = data.games;
  const series = games.map((g, i) => ({ name: g.name, color: `var(--series-${Math.min(i, SERIES - 1) + 1})`, values: dates.map((d) => g.daily[metric.key][d] ?? 0) }));

  if (games.length > 1) {
    const legend = el('ul', { class: 'legend' });
    for (const s of series) {
      const li = el('li');
      const key = el('span', { class: 'key' });
      key.style.background = s.color;
      li.append(key, document.createTextNode(s.name));
      legend.append(li);
    }
    box.append(legend);
  }

  const W = 960, H = 280, L = 56, R = 16, T = 12, B = 28;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, dates.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${metric.label} per day, last 30 days` });

  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    root.append(svg('line', { class: k ? 'grid' : 'axis', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const t = svg('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = formatTick(metric, v);
    root.append(t);
  }
  dates.forEach((d, i) => {
    if (i % 7 !== (dates.length - 1) % 7) return;
    const t = svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' });
    t.textContent = d.slice(5);
    root.append(t);
  });

  for (const s of series) {
    const path = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    root.append(svg('path', { class: 'line', d: path, stroke: s.color }));
    const last = s.values.length - 1;
    root.append(svg('circle', { class: 'dot', cx: x(last), cy: y(s.values[last]), r: 4, fill: s.color }));
  }

  // Hover: a crosshair that snaps to the nearest day and lists every game.
  const cross = svg('line', { class: 'cross', y1: T, y2: H - B, visibility: 'hidden' });
  root.append(cross);
  const tip = el('div', { class: 'tooltip', hidden: '' });
  const hit = svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent', tabindex: '0' });
  const show = (i) => {
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(el('div', { class: 'date' }, dates[i]));
    for (const s of series) {
      const row = el('div', { class: 'row' });
      const key = el('span', { class: 'key' });
      key.style.background = s.color;
      row.append(key, document.createTextNode(s.name), el('strong', {}, format(metric, s.values[i])));
      tip.append(row);
    }
    tip.hidden = false;
    const rect = root.getBoundingClientRect();
    const px = (x(i) / W) * rect.width;
    tip.style.left = `${Math.min(rect.width - 160, px + 16)}px`;
    tip.style.top = '40px';
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  let focused = dates.length - 1;
  hit.addEventListener('pointermove', (e) => {
    const rect = root.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    focused = Math.max(0, Math.min(dates.length - 1, Math.round(((sx - L) / (W - L - R)) * (dates.length - 1))));
    show(focused);
  });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(focused));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') focused = Math.max(0, focused - 1);
    else if (e.key === 'ArrowRight') focused = Math.min(dates.length - 1, focused + 1);
    else return;
    e.preventDefault();
    show(focused);
  });
  root.append(hit);
  box.append(root, tip);

  // The same figures as a table.
  const table = el('table');
  const head = el('tr');
  head.append(el('th', { scope: 'col' }, 'Day'));
  for (const s of series) head.append(el('th', { scope: 'col' }, s.name));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  for (let i = dates.length - 1; i >= 0; i--) {
    const tr = el('tr');
    tr.append(el('th', { scope: 'row' }, dates[i]));
    for (const s of series) tr.append(el('td', {}, format(metric, s.values[i])));
    body.append(tr);
  }
  table.append(body);
  $('chart-table').replaceChildren(table);
}

function renderAbout() {
  const defs = $('definitions');
  defs.replaceChildren();
  for (const m of data.metrics) {
    const li = el('li');
    li.append(el('strong', {}, `${m.label}: `), document.createTextNode(`${m.note} Free: ${format(m, m.limit)}${m.per === 'day' ? ' a day' : ' in total'}.`));
    defs.append(li);
  }
  defs.append(el('li', {}, `Free plan limits checked ${data.limitsChecked}.`));
  const notes = $('notes');
  notes.replaceChildren(...data.notes.map((n) => el('li', {}, n)));
}

/* ---------- connection quality (F-052) ---------- */

async function loadQuality() {
  const res = await fetch('/api/quality');
  if (!res.ok) return;
  const { days, quality } = await res.json();
  const table = $('quality');
  table.replaceChildren();
  const games = Object.keys(quality).sort();
  $('quality-note').textContent = games.length
    ? `Anonymous summaries from the games' pages, the last ${days} days. Response time is to the room and back; position gaps are how evenly the host's messages arrive at the others.`
    : `No measurements yet. Games send them when they turn measuring on (the last ${days} days are kept).`;
  if (!games.length) return;
  const cols = [
    ['Game', null], ['Summaries', 'summaries'], ['Minutes', 'minutes'], ['Response p50', 'rttP50', 'ms'], ['Response p90', 'rttP90', 'ms'],
    ['Position gaps p90', 'hostGapP90', 'ms'], ['Frame p50', 'frameP50', 'ms'], ['Reconnects', 'reconnects'], ['Host changes', 'hostChanges'], ['Devices', 'devices'],
  ];
  const head = el('tr');
  for (const [h] of cols) head.append(el('th', { scope: 'col' }, h));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  for (const game of games) {
    const q = quality[game];
    const tr = el('tr');
    tr.append(el('th', { scope: 'row' }, game));
    for (const [, key, unit] of cols.slice(1)) {
      let v = q[key];
      if (key === 'devices') v = Object.entries(v).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(', ');
      else if (v === null || v === undefined) v = '–';
      else v = unit ? `${nf.format(v)} ${unit}` : nf.format(v);
      tr.append(el('td', {}, v));
    }
    body.append(tr);
  }
  table.append(body);
}

/* ---------- admin passes (F-058) ---------- */

async function loadPasses() {
  const res = await fetch('/api/passes');
  if (!res.ok) return;
  const list = await res.json();
  const table = $('passes');
  table.replaceChildren();
  if (!list.length) {
    $('passes-note').textContent = 'No game links yet.';
    return;
  }
  $('passes-note').textContent = '';
  const head = el('tr');
  for (const h of ['Game', 'For', 'Made', 'Valid until', '']) head.append(el('th', { scope: 'col' }, h));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  for (const p of list) {
    const tr = el('tr');
    tr.append(el('th', { scope: 'row' }, p.game), el('td', {}, p.label || '–'), el('td', {}, new Date(p.created).toLocaleDateString()), el('td', {}, new Date(p.expires).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })));
    const revoke = el('button', { type: 'button' }, 'Revoke');
    revoke.addEventListener('click', async () => {
      await fetch(`/api/passes/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      loadPasses();
    });
    tr.append(cell(revoke));
    body.append(tr);
  }
  table.append(body);
}

$('new-pass').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const game = form.game.value.trim().toLowerCase();
  const page = form.page.value.trim();
  const res = await fetch('/api/passes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, label: form.label.value.trim(), hours: Number(form.hours.value) }) });
  const out = $('pass-link');
  if (!res.ok) {
    out.textContent = `Not made (${res.status}).`;
    return;
  }
  const { token, pass } = await res.json();
  const link = page ? `${page.split('#')[0]}#nk-admin=${token}` : `#nk-admin=${token}`;
  const copy = el('button', { type: 'button' }, 'Copy');
  copy.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(link);
    copy.textContent = 'Copied';
  });
  out.replaceChildren(
    el('p', {}, `Open or send this link (it is shown only now; valid until ${new Date(pass.expires).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}):`),
    el('code', { class: 'pass' }, link),
    copy,
  );
  form.label.value = '';
  loadPasses();
});

/* ---------- messages to players (F-066) ---------- */

async function loadMessages() {
  const res = await fetch('/api/messages');
  if (!res.ok) return;
  const list = await res.json();
  const table = $('messages');
  table.replaceChildren();
  if (!list.length) {
    $('messages-note').textContent = 'No messages are being shown.';
    return;
  }
  $('messages-note').textContent = '';
  const head = el('tr');
  for (const h of ['Game', 'Message', 'Kind', 'Shown until', '']) head.append(el('th', { scope: 'col' }, h));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  for (const m of list) {
    const tr = el('tr');
    const text = el('td', { class: 'text' }, m.text);
    tr.append(el('th', { scope: 'row' }, m.game === '*' ? 'All games' : m.game), text, el('td', {}, m.level === 'warning' ? 'Warning' : 'Message'), el('td', {}, new Date(m.until).toLocaleString()));
    const remove = el('button', { type: 'button' }, 'Remove');
    remove.addEventListener('click', async () => {
      await fetch(`/api/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      loadMessages();
    });
    tr.append(cell(remove));
    body.append(tr);
  }
  table.append(body);
}

$('new-message').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const game = form.game.value.trim().toLowerCase();
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game, text: form.text.value, minutes: Number(form.minutes.value), level: form.level.value }),
  });
  if (!res.ok) {
    const answer = await res.json().catch(() => ({}));
    $('messages-note').textContent = answer.error === 'too-many' ? 'Not sent: 20 messages are already being shown.' : `Not sent (${answer.error ?? res.status}).`;
    return;
  }
  form.text.value = '';
  loadMessages();
});

/* ---------- controls (F-003, F-004, F-008) ---------- */

const cell = (child) => {
  const td = el('td');
  td.append(child);
  return td;
};
const REASONS = { off: 'No new players', until: 'No new players', budget: 'Closed for today (Cloudflare limiting)', stopped: 'Emergency stop' };
const MODE_CHOICES = [['on', 'On'], ['off', 'No new players'], ['timer', 'Timer: on until']];
const THEN_CHOICES = [['off', 'then No new players'], ['stop', 'then Emergency stop']];
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const select = (name, choices, value, label) => {
  const sel = el('select', { name, 'aria-label': label });
  for (const [v, t] of choices) {
    const o = el('option', { value: v }, t);
    if (value === v) o.selected = true;
    sel.append(o);
  }
  return sel;
};
const nowText = (st) => {
  if (!st) return ['', ''];
  if (st.open) return [st.timerUntil ? `Open until ${new Date(st.timerUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Open', 'state-open'];
  return [REASONS[st.reason] ?? 'Closed', 'state-closed'];
};

/** Mode, timer and what follows it, for a game's or a mode's row (F-067). */
function modeCells(entry, label) {
  const mode = select('mode', MODE_CHOICES, entry.mode === 'until' ? 'off' : entry.mode, `${label}: mode`);
  const until = el('input', { name: 'timerUntil', type: 'datetime-local', value: toLocalInput(entry.timer?.until), 'aria-label': `${label}: on until` });
  const then = select('timerThen', THEN_CHOICES, entry.timer?.then ?? 'off', `${label}: when the timer ends`);
  const show = () => {
    until.hidden = mode.value !== 'timer';
    then.hidden = mode.value !== 'timer';
    until.required = mode.value === 'timer';
  };
  mode.addEventListener('change', show);
  show();
  const box = el('div', { class: 'timer' });
  box.append(until, then);
  return [cell(mode), cell(box)];
}

function readMode(tr) {
  const get = (n) => tr.querySelector(`[name=${n}]`);
  const mode = get('mode').value;
  const untilValue = get('timerUntil').value;
  return {
    mode,
    timer: mode === 'timer' && untilValue ? { until: new Date(untilValue).toISOString(), then: get('timerThen').value } : null,
  };
}

function renderControls() {
  const control = data.control;
  if (!control) return;
  const { settings, budget, status, connected = {} } = control;
  const names = Object.keys(status).sort();
  // Games that have never asked this page are hidden unless asked for (F-070);
  // their rows stay in the form, so saving keeps their settings.
  const showAll = $('show-unconnected').checked;
  const isConnected = (name) => Boolean(connected[name]);
  const table = $('control-table');
  table.replaceChildren();
  const head = el('tr');
  for (const h of ['Game', 'Now', 'Mode', 'Timer', 'Emergency stop', 'Share %']) head.append(el('th', { scope: 'col' }, h));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  for (const name of names) {
    const g = settings.games[name] ?? { mode: 'on', timer: null, stopped: false, share: null, modes: {} };
    const st = status[name];
    const tr = el('tr', { 'data-game': name });
    tr.append(el('th', { scope: 'row' }, name));
    const [text, cls] = isConnected(name) ? nowText(st) : ['Not connected', 'muted'];
    tr.append(el('td', { class: cls }, text));
    if (!isConnected(name)) {
      tr.classList.add('unconnected');
      tr.hidden = !showAll;
    }
    tr.append(...modeCells(g, name));
    // The emergency stop is a button: it acts at once (F-067).
    const stopped = el('input', { name: 'stopped', type: 'hidden', value: g.stopped ? '1' : '' });
    const stop = el('button', { type: 'button', class: g.stopped ? 'lift' : 'stop' }, g.stopped ? 'Lift the stop' : 'Stop now');
    stop.addEventListener('click', () => {
      if (!g.stopped && !confirm(`Stop ${name} now? Everyone playing it is disconnected, and no game link gets past the stop.`)) return;
      stopped.value = g.stopped ? '' : '1';
      $('controls').requestSubmit();
    });
    const stopCell = cell(stop);
    stopCell.append(stopped);
    tr.append(stopCell);
    const share = el('input', { name: 'share', type: 'number', min: '0', max: '100', step: '1', placeholder: String(Math.round(budget.share[name] ?? 0)), 'aria-label': `${name}: share of the free quota in percent (empty: equal shares)` });
    if (g.share !== null && g.share !== undefined) share.value = String(g.share);
    tr.append(cell(share));
    body.append(tr);
    // Modes of the game (F-057): their own mode and timer, under the game.
    for (const [m, mv] of Object.entries(g.modes ?? {})) {
      const mr = el('tr', { 'data-mode-of': name, 'data-mode': m, class: isConnected(name) ? 'mode-row' : 'mode-row unconnected' });
      mr.hidden = !isConnected(name) && !showAll;
      mr.append(el('th', { scope: 'row' }, `· ${m}`));
      const [mt, mc] = nowText(st?.modes?.[m]);
      mr.append(el('td', { class: mc }, mt));
      mr.append(...modeCells(mv, `${name} ${m}`));
      const remove = el('button', { type: 'button', 'aria-label': `Remove the mode ${m} of ${name}` }, 'Remove');
      remove.addEventListener('click', () => mr.remove());
      mr.append(cell(remove), el('td'));
      body.append(mr);
    }
  }
  table.append(body);
  const hiddenCount = names.filter((n) => !isConnected(n)).length;
  $('unconnected-count').textContent = hiddenCount ? ` (${hiddenCount})` : '';
  const form = $('controls');
  form.plan.value = settings.account.plan;
  form.capUsd.value = settings.account.capUsd ?? '';
  form.autoClose.checked = settings.account.autoClose;
  $('warnings').replaceChildren(...budget.warnings.map((w) => el('li', {}, w)));
  $('cost').textContent = `This month on the Paid plan would cost about ${budget.cost.usd.toFixed(2)} USD (5 USD a month included). ${budget.cost.note}`;
  $('control-note').textContent = settings.account.autoClose
    ? 'Cloudflare limiting is on: a game closes for new players for the rest of the UTC day when it passes its share, and its players are warned at 90 %. Running games finish.'
    : 'Cloudflare limiting is off: shares and warnings are shown, nothing is closed by itself. No new players and timers act within 30 s; running games finish. Emergency stop disconnects everyone.';
}

$('controls').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const games = {};
  const old = data.control?.settings.games ?? {};
  for (const tr of form.querySelectorAll('tr[data-game]')) {
    const get = (n) => tr.querySelector(`[name=${n}]`);
    games[tr.dataset.game] = {
      ...readMode(tr),
      stopped: get('stopped').value === '1',
      share: get('share').value === '' ? null : Number(get('share').value),
      url: old[tr.dataset.game]?.url ?? null,
      modes: {},
    };
  }
  for (const tr of form.querySelectorAll('tr[data-mode-of]')) {
    games[tr.dataset.modeOf].modes[tr.dataset.mode] = readMode(tr);
  }
  // A new game or mode typed below the table (F-057).
  const newGame = form.newGame.value.trim().toLowerCase();
  const newMode = form.newMode.value.trim().toLowerCase();
  if (newGame) {
    games[newGame] ??= { mode: 'on', timer: null, stopped: false, share: null, url: null, modes: {} };
    if (newMode) games[newGame].modes[newMode] ??= { mode: 'on', timer: null };
  }
  form.newGame.value = '';
  form.newMode.value = '';
  const account = { plan: form.plan.value, capUsd: form.capUsd.value === '' ? null : Number(form.capUsd.value), autoClose: form.autoClose.checked };
  $('saved').textContent = 'Saving…';
  const res = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, games }) });
  $('saved').textContent = res.ok ? 'Saved. Games see the change within 30 seconds.' : `Not saved (${res.status}).`;
  if (res.ok) await load();
});

function render() {
  const select = $('metric');
  if (!select.options.length) {
    for (const m of metricsShown()) select.append(el('option', { value: m.key }, m.label));
    select.value = metricsShown().find((m) => m.key === 'doRequests')?.key ?? select.value;
  }
  renderMeters();
  renderControls();
  renderGames();
  renderChart();
  renderAbout();
}

/* ---------- controls ---------- */

$('show-unconnected').addEventListener('change', (e) => {
  // Show or hide without drawing the table again, so unsaved changes stay.
  for (const tr of document.querySelectorAll('#control-table tr.unconnected')) tr.hidden = !e.currentTarget.checked;
});

for (const b of document.querySelectorAll('[data-period]')) {
  b.addEventListener('click', () => {
    period = b.dataset.period;
    for (const o of document.querySelectorAll('[data-period]')) o.setAttribute('aria-pressed', String(o === b));
    renderGames();
  });
}
$('metric').addEventListener('change', renderChart);
$('as-table').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  $('chart-table').hidden = !on;
});

load().catch((e) => {
  $('message').textContent = `The page could not load: ${e.message}`;
});
