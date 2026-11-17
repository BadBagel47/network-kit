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
  $('today-note').textContent = `${data.today} (UTC), up to ${at.toISOString().slice(11, 16)} UTC. The free limits are for the whole account and reset at 00:00 UTC. Cloudflare's figures can lag a few minutes.`;
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

function render() {
  const select = $('metric');
  if (!select.options.length) {
    for (const m of metricsShown()) select.append(el('option', { value: m.key }, m.label));
    select.value = metricsShown().find((m) => m.key === 'doRequests')?.key ?? select.value;
  }
  renderMeters();
  renderGames();
  renderChart();
  renderAbout();
}

/* ---------- controls ---------- */

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
