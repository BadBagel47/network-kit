// network-kit admin page (F-071, style "Kontrollrum", in Swedish). Draws
// /api/usage and saves every change at once. Names from the API are set with
// textContent, never as HTML; styles are set through the CSSOM, never as a
// style attribute (the page's Content-Security-Policy allows no inline styles).

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const SERIES = 8;
const el = (tag, attrs = {}, text) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  if (text !== undefined) node.textContent = text;
  return node;
};
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const nf = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('sv-SE', { notation: 'compact', maximumFractionDigits: 1 });
const clock = (t) => new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
const dayTime = (t) => new Date(t).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const left = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
function bytes(v) {
  const units = ['B', 'kB', 'MB', 'GB'];
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${i ? nf1.format(v) : nf.format(v)} ${units[i]}`;
}
const format = (metric, v) => (metric.unit === 'bytes' ? bytes(v) : metric.unit === 'GB-s' ? `${nf1.format(v)} GB-s` : nf.format(Math.round(v)));
const formatTick = (metric, v) => (metric.unit === 'bytes' ? bytes(v) : v >= 10_000 ? compact.format(v) : nf.format(v));

// The metrics in Swedish (the API names them in English).
const SV = {
  workerRequests: ['Förfrågningar', 'Förfrågningar som kör en Worker (statiska filer räknas inte). Över gränsen svarar Workern med fel 1027 till kl 01.'],
  doRequests: ['Rumsförfrågningar', 'Som Cloudflare räknar dem mot gränsen: anslutningar, väckningar och andra anrop räknas fullt, och 20 inkommande meddelanden räknas som ett.'],
  doDuration: ['Rumstid', 'Tid då ett rum är vaket, räknat på 128 MB. Sovande rum kostar inget.'],
  rowsRead: ['Lästa rader', 'Rader som läses ur rummens lagring.'],
  rowsWritten: ['Skrivna rader', 'Rader som skrivs i rummens lagring; radering och väckningar räknas som skrivningar.'],
  storedBytes: ['Lagrad data', 'Data som ligger sparad på kontot (5 GB totalt på gratisplanen).'],
};
const label = (m) => SV[m.key]?.[0] ?? m.label;

let data = null;
let tab = 'spel';
let period = 'today';
let level = 'info';
const ui = { cover: {}, openMeter: null };
let timers = []; // timer buttons to update every second

/* ---------- loading and signing in ---------- */

async function load() {
  const res = await fetch('/api/usage', { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({ error: 'bad-answer' }));
  if (res.status === 401) return showSignIn(body);
  $('logout').hidden = false;
  if (body.error === 'no-token') {
    $('message').textContent = 'Inloggad. Siffrorna kräver en Cloudflare-nyckel som bara kan läsa (CLOUDFLARE_ANALYTICS_TOKEN).';
    return;
  }
  if (body.error) {
    $('message').textContent = `Cloudflares siffror gick inte att läsa: ${body.message ?? body.error}`;
    return;
  }
  data = body;
  $('message').textContent = '';
  $('dashboard').hidden = false;
  render();
  loadQuality().catch(() => {});
  loadPasses().catch(() => {});
  loadMessages().catch(() => {});
  if (tab === 'logg') loadLog().catch(() => {});
}

function showSignIn(body) {
  $('signin').hidden = false;
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  $('signin-error').textContent = !body.passwordSet || error === 'notset'
    ? 'Inget lösenord är satt för sidan än (ADMIN_PASSWORD, minst 12 tecken).'
    : error === 'wrong' ? 'Fel lösenord.'
      : error === 'wait' ? `För många fel lösenord. Försök igen om ${Math.max(1, Math.ceil(Number(params.get('s')) / 60))} min.`
        : '';
  $('password').focus();
}

/* ---------- saving: every change at once ---------- */

const settings = () => structuredClone(data.control.settings);

async function save(change) {
  const next = settings();
  change(next);
  $('save-state').className = 'save-state';
  $('save-state').textContent = 'Sparar…';
  const res = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
  if (!res.ok) {
    $('save-state').className = 'save-state bad';
    $('save-state').textContent = `Sparades inte (${res.status}).`;
    return;
  }
  $('save-state').textContent = 'Sparat. Spelen ser ändringen inom 30 sekunder.';
  setTimeout(() => { $('save-state').textContent = ''; }, 4000);
  await load();
}

/* ---------- tabs ---------- */

for (const b of document.querySelectorAll('[data-tab]')) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab;
    for (const o of document.querySelectorAll('[data-tab]')) {
      if (o === b) o.setAttribute('aria-current', 'page');
      else o.removeAttribute('aria-current');
    }
    for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${tab}`;
    if (tab === 'logg') loadLog().catch(() => {});
  });
}

/* ---------- render ---------- */

const gameNames = () => Object.keys(data.control.status).sort();
const connected = (name) => Boolean(data.control.connected?.[name]);

function render() {
  const names = gameNames();
  const live = names.filter(connected);
  const open = live.filter((n) => data.control.status[n].open).length;
  $('summary').textContent = `${open} av ${live.length} spel öppna · Cloudflare limiting ${data.control.settings.account.autoClose ? 'på' : 'av'}`;
  renderCards();
  renderUsage();
  renderSettings();
  fillGameSelects();
}

/* ---------- Spel ---------- */

function statusOf(st) {
  if (st.stopped) return ['Nödstopp', 'bad'];
  if (!st.open) return [st.reason === 'budget' ? 'Stängt för i dag (Cloudflare limiting)' : 'Inga nya spelare', 'warn'];
  const modes = Object.values(st.modes ?? {});
  if (modes.some((m) => !m.open)) return ['Delvis öppet', 'warn'];
  return ['Öppet', 'ok'];
}

function renderCards() {
  const box = $('cards');
  box.replaceChildren();
  timers = [];
  const names = gameNames();
  const live = names.filter(connected);
  const off = names.filter((n) => !connected(n));
  $('no-games').hidden = live.length > 0;
  for (const name of live) box.append(card(name));
  $('unconnected-count').textContent = off.length ? ` (${off.length})` : '';
  $('unconnected').replaceChildren(...off.map((n) => el('span', {}, `${n} · inte kopplad`)));
  $('unconnected').hidden = !$('show-unconnected').checked || !off.length;
}
$('show-unconnected').addEventListener('change', () => { $('unconnected').hidden = !$('show-unconnected').checked; });

function card(name) {
  const st = data.control.status[name];
  const g = data.control.settings.games[name] ?? { mode: 'on', timer: null, stopped: false, share: null, modes: {} };
  const article = el('article', { class: 'panel' });
  const [text, cls] = statusOf(st);
  const head = el('div', { class: 'card-head' });
  head.append(el('span', { class: `lamp ${cls === 'ok' ? 'ok' : cls === 'bad' ? 'bad' : ''}`, 'aria-hidden': 'true' }));
  const titles = el('div');
  titles.append(el('h2', {}, name), el('span', { class: `status ${cls}` }, text));
  head.append(titles);
  article.append(head);

  // Rooms and players (F-072), version, deploy and errors (F-074).
  const facts = el('div', { class: 'facts' });
  const act = data.activity?.[name];
  const fact = (value, rest, bad = false) => {
    const span = el('span', bad ? { class: 'bad' } : {});
    span.append(el('strong', {}, value), document.createTextNode(` ${rest}`));
    return span;
  };
  if (act) facts.append(fact(nf.format(act.rooms), 'rum'), fact(nf.format(act.players), 'spelare nu'), fact(nf.format(act.peak), 'som mest i dag'));
  else facts.append(el('span', {}, 'Inga rum i dag'));
  const version = data.control.versions?.[name];
  if (version) facts.append(fact(`v${version}`, ''));
  const deployed = data.deployed?.[name];
  if (deployed) facts.append(el('span', {}, `driftsatt ${dayTime(deployed)}`));
  const errors = data.games.find((x) => x.name === name)?.daily.errors?.[data.today] ?? 0;
  facts.append(fact(nf.format(errors), 'fel i dag', errors > 0));
  article.append(facts);

  if (st.stopped) {
    const box = el('div', { class: 'stopped' });
    box.append(el('strong', {}, 'Nödstopp aktivt'), el('span', { class: 'muted small' }, 'Alla har kopplats bort. Inga spel kan startas, inte heller med spellänk.'));
    const lift = el('button', { type: 'button' }, 'Häv stoppet');
    lift.addEventListener('click', () => save((s) => { s.games[name].stopped = false; }));
    box.append(lift);
    article.append(box);
    return article;
  }

  const modeNames = Object.keys(g.modes ?? {});
  article.append(modeRow(name, null, modeNames.length ? 'Hela spelet' : 'Alla lägen', g));
  for (const m of modeNames) article.append(modeRow(name, m, m, g.modes[m]));

  // The emergency stop, under a cover.
  const area = el('div', { class: 'stop-area' });
  if (!ui.cover[name]) {
    const cover = el('button', { type: 'button', class: 'cover' });
    cover.append(el('span', {}, 'Lyft locket för nödstopp'));
    cover.addEventListener('click', () => { ui.cover[name] = true; renderCards(); });
    area.append(cover);
  } else {
    const row = el('div', { class: 'stop-row' });
    const stop = el('button', { type: 'button', class: 'stop-button' }, 'NÖDSTOPP');
    stop.addEventListener('click', () => {
      ui.cover[name] = false;
      save((s) => { s.games[name] ??= { mode: 'on', timer: null, stopped: false, share: null, modes: {} }; s.games[name].stopped = true; });
    });
    const close = el('button', { type: 'button' }, 'Stäng locket');
    close.addEventListener('click', () => { ui.cover[name] = false; renderCards(); });
    row.append(stop, close);
    area.append(row, el('p', { class: 'muted small' }, 'Alla som spelar kopplas bort direkt. Ingen spellänk går förbi.'));
  }
  article.append(area);
  return article;
}

/** One row of On / No new players / Timer for the game (mode null) or one of its modes. */
function modeRow(game, mode, title, entry) {
  const row = el('div', { class: 'mode' });
  row.append(el('span', { class: 'mode-name' }, title));
  const seg = el('div', { class: 'segment modes', role: 'group', 'aria-label': `${game} ${title}: läge` });
  const now = Date.now();
  const timerOn = entry.mode === 'timer' && entry.timer && Date.parse(entry.timer.until) > now;
  const pick = (value) => save((s) => {
    s.games[game] ??= { mode: 'on', timer: null, stopped: false, share: null, modes: {} };
    const target = mode ? s.games[game].modes[mode] : s.games[game];
    target.mode = value;
    target.timer = value === 'timer'
      ? { from: new Date().toISOString(), until: new Date(Date.now() + s.account.timerMinutes * 60_000).toISOString(), then: s.account.timerThen }
      : null;
  });
  const current = entry.mode === 'timer' && !timerOn ? (entry.timer?.then === 'stop' ? 'stop' : 'off') : entry.mode;
  for (const [value, text] of [['on', 'På'], ['off', 'Inga nya'], ['timer', 'Timer']]) {
    const b = el('button', { type: 'button', 'aria-pressed': String(current === value) }, undefined);
    b.append(el('span', {}, text));
    if (value === 'timer' && timerOn) {
      const t = el('span', { class: 'time' });
      b.append(t);
      timers.push({ button: b, time: t, from: Date.parse(entry.timer.from ?? entry.timer.until), until: Date.parse(entry.timer.until) });
    }
    b.addEventListener('click', () => { if (current !== value || value === 'timer') pick(value); });
    seg.append(b);
  }
  row.append(seg);
  if (timerOn) {
    const tr = el('div', { class: 'timer-row' });
    tr.append(el('span', { class: 'until' }, `Öppet till ${clock(entry.timer.until)}`));
    const then = el('button', { type: 'button' }, `Sedan: ${entry.timer.then === 'stop' ? 'Nödstopp' : 'Inga nya spelare'}`);
    then.addEventListener('click', () => save((s) => {
      const target = mode ? s.games[game].modes[mode] : s.games[game];
      target.timer.then = target.timer.then === 'stop' ? 'off' : 'stop';
    }));
    tr.append(then);
    row.append(tr);
  }
  return row;
}

// The timers count down every second; the button drains as time passes.
setInterval(() => {
  const now = Date.now();
  let ended = false;
  for (const t of timers) {
    const rest = t.until - now;
    if (rest <= 0) ended = true;
    t.time.textContent = left(rest);
    const total = t.until - t.from;
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((rest / total) * 100))) : 100;
    t.button.style.background = `linear-gradient(90deg, rgba(76, 194, 255, 0.42) ${pct}%, #243245 ${pct}%)`;
    t.button.setAttribute('aria-label', `Timer, ${left(rest)} kvar`);
  }
  if (ended && data) load().catch(() => {});
}, 1000);
setInterval(() => { if (data && !document.hidden) load().catch(() => {}); }, 60_000);

/* ---------- Förbrukning ---------- */

const metricsShown = () => data.metrics.filter((m) => data.available.includes(m.key));
function periodDates() {
  const { dates, today } = data;
  if (period === 'today') return [today];
  if (period === 'yesterday') return [dates[dates.length - 2]];
  return dates.filter((d) => d.slice(0, 7) === today.slice(0, 7));
}
function value(game, metric, dates) {
  const series = game.daily[metric.key];
  if (metric.per === 'total') {
    for (let i = dates.length - 1; i >= 0; i--) if (series[dates[i]]) return series[dates[i]];
    return 0;
  }
  return dates.reduce((sum, d) => sum + (series[d] ?? 0), 0);
}
const total = (metric, dates) => data.games.reduce((sum, g) => sum + value(g, metric, dates), 0);
const levelOf = (f) => (f >= 0.9 ? 'bad' : f >= 0.8 ? 'warn' : '');
function bar(fraction) {
  const outer = el('span', { class: `bar ${levelOf(fraction)}` });
  const fill = el('span');
  fill.style.width = `${Math.max(1, Math.min(100, fraction * 100))}%`;
  outer.append(fill);
  return outer;
}
const pctText = (f, used) => (f < 0.01 && used > 0 ? '<1 %' : `${Math.round(f * 100)} %`);

/** At this pace, does today's use last until midnight UTC? */
function pace(metric, used) {
  if (metric.per !== 'day') return 'Gräns för hela kontot, inte per dag';
  const start = Date.parse(`${data.today}T00:00:00Z`);
  const now = Date.parse(data.generatedAt);
  const elapsed = Math.max(60_000, now - start);
  if (used <= 0) return 'Räcker hela dagen';
  const end = start + (metric.limit / used) * elapsed;
  return end >= start + 86_400_000 ? 'Räcker hela dagen i nuvarande takt' : `Räcker till ca ${clock(end)} i nuvarande takt`;
}

function renderUsage() {
  const at = new Date(data.generatedAt);
  const sumOf = (key) => data.games.reduce((sum, g) => sum + (g.daily[key]?.[data.today] ?? 0), 0);
  const messages = sumOf('doMessages');
  $('today-note').textContent = `I dag, hela kontot, fram till ${clock(at)}. Gränserna nollställs kl 01 (00 UTC). Tryck på en rad för grafen.`
    + (data.available.includes('doRequests') ? ` Rumsförfrågningar i dag: ${nf.format(sumOf('doRequestsAll') - messages)} anrop och ${nf.format(messages)} inkommande meddelanden, där 20 räknas som ett.` : '');
  const box = $('meters');
  box.replaceChildren();
  const week = data.dates.slice(-7);
  for (const m of metricsShown()) {
    const used = total(m, [data.today]);
    const f = used / m.limit;
    const open = ui.openMeter === m.key;
    const item = el('div', { class: 'meter' });
    const b = el('button', { type: 'button', 'aria-expanded': String(open) });
    const top = el('span', { class: 'meter-top' });
    const nums = el('span', { class: 'nums' });
    nums.append(el('span', { class: 'short' }, format(m, used)), el('span', { class: `pct ${levelOf(f)}` }, pctText(f, used)), el('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▲' : '▼'));
    top.append(el('span', { class: 'name' }, label(m)), nums);
    b.append(top, bar(f));
    b.addEventListener('click', () => { ui.openMeter = open ? null : m.key; renderUsage(); });
    item.append(b);
    if (open) {
      const detail = el('div', { class: 'meter-detail' });
      const R = 34;
      const C = 2 * Math.PI * R;
      const ring = svg('svg', { class: 'ring', width: 84, height: 84, viewBox: '0 0 84 84', role: 'img', 'aria-label': `${label(m)}: ${pctText(f, used)} av gratisgränsen` });
      ring.append(svg('circle', { cx: 42, cy: 42, r: R, fill: 'none', stroke: '#1e2a37', 'stroke-width': 9 }));
      ring.append(svg('circle', { cx: 42, cy: 42, r: R, fill: 'none', stroke: f >= 0.9 ? '#ff4d4f' : f >= 0.8 ? '#ffb020' : '#4cc2ff', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-dasharray': `${(Math.min(1, Math.max(f, 0.012)) * C).toFixed(1)} ${C.toFixed(1)}`, transform: 'rotate(-90 42 42)' }));
      const t = svg('text', { x: 42, y: 47, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: '#e8eef4' });
      t.textContent = pctText(f, used);
      ring.append(t);
      const info = el('div', { class: 'info' });
      info.append(el('span', { class: 'figure' }, `${format(m, used)} av ${format(m, m.limit)}${m.per === 'day' ? ' per dag' : ''}`));
      const vals = week.map((d) => total(m, [d]));
      const max = Math.max(...vals) || 1;
      const spark = svg('svg', { class: 'spark', viewBox: '0 0 120 26', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      spark.append(svg('polyline', { points: vals.map((v, i) => `${(i * 20).toFixed(0)},${(24 - (v / max) * 21).toFixed(1)}`).join(' '), fill: 'none', stroke: '#4cc2ff', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      info.append(spark, el('span', { class: 'muted small' }, `Senaste 7 dagarna · ${pace(m, used)}`));
      detail.append(ring, info);
      item.append(detail);
    }
    box.append(item);
  }
  renderShares();
  renderGames();
  renderChartSelect();
  renderChart();
  renderAbout();
}

/** Each game's fullest daily metric against its share today. */
function renderShares() {
  const box = $('shares');
  box.replaceChildren();
  const share = data.control.budget.share ?? {};
  const daily = metricsShown().filter((m) => m.per === 'day');
  for (const g of data.games.filter((x) => connected(x.name))) {
    let best = null;
    for (const m of daily) {
      const allowed = (m.limit * (share[g.name] ?? 0)) / 100;
      if (!allowed) continue;
      const used = g.daily[m.key][data.today] ?? 0;
      if (!best || used / allowed > best.f) best = { f: used / allowed, m, used, allowed };
    }
    if (!best) continue;
    const row = el('div', { class: 'share-row' });
    const line = el('div', { class: 'line' });
    line.append(el('span', {}, g.name), el('span', {}, `${label(best.m)}: ${format(best.m, best.used)} av ${format(best.m, best.allowed)} (${pctText(best.f, best.used)})`));
    row.append(line, bar(best.f));
    box.append(row);
  }
  if (!box.children.length) box.append(el('p', { class: 'muted' }, 'Inga kopplade spel har använt något i dag.'));
}

function renderGames() {
  const table = $('games');
  table.replaceChildren();
  const metrics = metricsShown();
  const dates = periodDates();
  const head = el('tr');
  head.append(el('th', { scope: 'col' }, 'Spel'));
  for (const m of metrics) head.append(el('th', { scope: 'col' }, label(m)));
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
      td.append(bar(m.per === 'total' ? v / m.limit : v / dates.length / m.limit));
      tr.append(td);
    }
    body.append(tr);
  });
  table.append(body);
  $('period-note').textContent = period === 'month'
    ? `${dates[0]} till ${dates[dates.length - 1]}. Staplarna jämför en genomsnittlig dag med dagens gratisgräns.`
    : `${dates[0]} (UTC). Staplarna jämför varje spel med kontots gratisgräns per dag.`;
}
for (const b of document.querySelectorAll('[data-period]')) {
  b.addEventListener('click', () => {
    period = b.dataset.period;
    for (const o of document.querySelectorAll('[data-period]')) o.setAttribute('aria-pressed', String(o === b));
    renderGames();
  });
}

function renderChartSelect() {
  const select = $('metric');
  if (select.options.length) return;
  for (const m of metricsShown()) select.append(el('option', { value: m.key }, label(m)));
  select.value = metricsShown().find((m) => m.key === 'doRequests')?.key ?? select.value;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}
function renderChart() {
  const metric = data.metrics.find((m) => m.key === $('metric').value) ?? metricsShown()[0];
  if (!metric) return;
  const box = $('chart');
  box.replaceChildren();
  const dates = data.dates.slice(-30);
  const series = data.games.map((g, i) => ({ name: g.name, color: `var(--series-${Math.min(i, SERIES - 1) + 1})`, values: dates.map((d) => g.daily[metric.key][d] ?? 0) }));
  if (series.length > 1) {
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
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label(metric)} per dag, senaste 30 dagarna` });
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
    root.append(svg('path', { class: 'line', d: s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), stroke: s.color }));
    const last = s.values.length - 1;
    root.append(svg('circle', { class: 'dot', cx: x(last), cy: y(s.values[last]), r: 4, fill: s.color }));
  }
  const cross = svg('line', { class: 'cross', y1: T, y2: H - B, visibility: 'hidden' });
  root.append(cross);
  const tip = el('div', { class: 'tooltip', hidden: true });
  const hit = svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent', tabindex: '0' });
  const show = (i) => {
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(el('div', {}, dates[i]));
    for (const s of series) {
      const row = el('div', { class: 'row' });
      const key = el('span', { class: 'key' });
      key.style.background = s.color;
      row.append(key, document.createTextNode(s.name), el('strong', {}, format(metric, s.values[i])));
      tip.append(row);
    }
    tip.hidden = false;
    const rect = root.getBoundingClientRect();
    tip.style.left = `${Math.min(rect.width - 160, (x(i) / W) * rect.width + 16)}px`;
    tip.style.top = '40px';
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
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
  const table = el('table');
  const head = el('tr');
  head.append(el('th', { scope: 'col' }, 'Dag'));
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
$('metric').addEventListener('change', renderChart);
$('as-table').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  $('chart-table').hidden = !on;
});

function renderAbout() {
  const defs = $('definitions');
  defs.replaceChildren();
  for (const m of data.metrics) {
    const li = el('li');
    li.append(el('strong', {}, `${label(m)}: `), document.createTextNode(`${SV[m.key]?.[1] ?? m.note} Gratis: ${format(m, m.limit)}${m.per === 'day' ? ' per dag' : ' totalt'}.`));
    defs.append(li);
  }
  defs.append(el('li', {}, `Gratisplanens gränser kontrollerade ${data.limitsChecked}.`));
  $('notes').replaceChildren(...data.notes.map((n) => el('li', {}, n)));
}

async function loadQuality() {
  const res = await fetch('/api/quality');
  if (!res.ok) return;
  const { days, quality } = await res.json();
  const box = $('quality');
  box.replaceChildren();
  const games = Object.keys(quality).sort();
  $('quality-note').textContent = games.length
    ? `Anonyma sammanfattningar från spelens sidor, senaste ${days} dagarna.`
    : `Inga mätningar än. Spelen skickar dem när mätning är påslagen (de senaste ${days} dagarna sparas).`;
  for (const game of games) {
    const q = quality[game];
    const wrap = el('div', { class: 'game' });
    wrap.append(el('h3', {}, game));
    const figs = el('div', { class: 'figures' });
    const fig = (v, unit, text) => {
      const d = el('div');
      d.append(el('strong', {}, v === null || v === undefined ? '–' : `${nf.format(v)}${unit}`), el('span', {}, text));
      return d;
    };
    figs.append(fig(q.rttP50, ' ms', 'Svarstid, vanlig'), fig(q.rttP90, ' ms', 'Svarstid, långsam'), fig(q.hostGapP90, ' ms', 'Ojämnhet hos värden'),
      fig(q.reconnects, '', 'Återanslutningar'), fig(q.hostChanges, '', 'Byten av värd'), fig(q.minutes, ' min', 'Speltid mätt'));
    wrap.append(figs);
    const devices = Object.entries(q.devices).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(', ');
    if (devices) wrap.append(el('p', { class: 'muted small' }, `Enheter: ${devices}`));
    box.append(wrap);
  }
}

/* ---------- Länkar och meddelanden ---------- */

function fillGameSelects() {
  const names = gameNames();
  const fill = (select, extra) => {
    const keep = select.value;
    select.replaceChildren(...extra.map(([v, t]) => el('option', { value: v }, t)), ...names.map((n) => el('option', { value: n }, n)));
    if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  };
  fill($('new-pass').game, []);
  fill($('new-message').game, [['*', 'Alla spel']]);
  fill($('log-game'), [['', 'Alla spel']]);
}

function passItem(p, old) {
  const item = el('div', { class: `item${old ? ' old' : ''}` });
  const info = el('div');
  info.append(el('span', { class: 'title' }, `${p.game}${p.label ? ` · ${p.label}` : ''}`));
  const used = p.lastUsed ? ` · senast använd ${dayTime(p.lastUsed)}` : ' · inte använd än';
  const state = p.state === 'revoked' ? `Återkallad ${dayTime(p.revoked)}` : p.state === 'expired' ? `Gick ut ${dayTime(p.expires)}` : `Gäller till ${dayTime(p.expires)}`;
  info.append(el('span', { class: 'sub' }, state + used));
  item.append(info);
  if (!old) {
    const revoke = el('button', { type: 'button' }, 'Återkalla');
    revoke.addEventListener('click', async () => {
      if (!confirm(`Återkalla spellänken${p.label ? ` till ${p.label}` : ''}? Den slutar fungera inom en minut.`)) return;
      await fetch(`/api/passes/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      loadPasses();
    });
    item.append(revoke);
  }
  return item;
}

async function loadPasses() {
  const res = await fetch('/api/passes?all=1');
  if (!res.ok) return;
  const list = await res.json();
  const active = list.filter((p) => p.state === 'active');
  const old = list.filter((p) => p.state !== 'active');
  $('passes').replaceChildren(...(active.length ? active.map((p) => passItem(p, false)) : [el('p', { class: 'muted small' }, 'Inga aktiva spellänkar.')]));
  $('passes-old').replaceChildren(...old.map((p) => passItem(p, true)));
  $('old-count').textContent = `(${old.length}, visas i 14 dagar)`;
  $('old-passes').hidden = !old.length;
}

$('new-pass').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const game = form.game.value;
  const page = form.page.value.trim();
  const res = await fetch('/api/passes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, label: form.label.value.trim(), hours: Number(form.hours.value) }) });
  const out = $('pass-link');
  if (!res.ok) {
    out.textContent = `Länken skapades inte (${res.status}).`;
    return;
  }
  const { token, pass } = await res.json();
  const link = page ? `${page.split('#')[0]}#nk-admin=${token}` : `#nk-admin=${token}`;
  const copy = el('button', { type: 'button' }, 'Kopiera');
  copy.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(link);
    copy.textContent = 'Kopierad';
  });
  out.replaceChildren(el('p', { class: 'muted small' }, `Öppna eller skicka länken. Den visas bara nu och gäller till ${dayTime(pass.expires)}.`), el('code', {}, link), copy);
  form.label.value = '';
  loadPasses();
});

// Message to players: kind, preview, list.
for (const b of document.querySelectorAll('[data-level]')) {
  b.addEventListener('click', () => {
    level = b.dataset.level;
    for (const o of document.querySelectorAll('[data-level]')) o.setAttribute('aria-pressed', String(o === b));
    preview();
  });
}
function preview() {
  const box = $('notice-preview');
  box.className = `notice-preview ${level === 'warning' ? '' : 'info'}`;
  box.querySelector('.icon').textContent = level === 'warning' ? '⚠' : 'i';
  $('preview-title').textContent = level === 'warning' ? 'Warning' : 'Message';
  $('preview-text').textContent = $('new-message').text.value.trim() || '…';
}
$('new-message').text.addEventListener('input', preview);

async function loadMessages() {
  const res = await fetch('/api/messages');
  if (!res.ok) return;
  const list = await res.json();
  $('messages-note').textContent = list.length ? 'Visas nu:' : 'Inga meddelanden visas just nu.';
  $('messages').replaceChildren(...list.map((m) => {
    const item = el('div', { class: 'item' });
    const info = el('div');
    info.append(el('span', { class: 'title' }, m.text), el('span', { class: 'sub' }, `${m.game === '*' ? 'Alla spel' : m.game} · ${m.level === 'warning' ? 'Varning' : 'Meddelande'} · till ${dayTime(m.until)}`));
    const remove = el('button', { type: 'button' }, 'Ta bort');
    remove.addEventListener('click', async () => {
      await fetch(`/api/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      loadMessages();
    });
    item.append(info, remove);
    return item;
  }));
}

$('new-message').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game: form.game.value, text: form.text.value, minutes: Number(form.minutes.value), level }),
  });
  if (!res.ok) {
    const answer = await res.json().catch(() => ({}));
    $('messages-note').textContent = answer.error === 'too-many' ? 'Skickades inte: 20 meddelanden visas redan.' : `Skickades inte (${answer.error ?? res.status}).`;
    return;
  }
  form.text.value = '';
  preview();
  loadMessages();
});

/* ---------- Inställningar ---------- */

function renderSettings() {
  const s = data.control.settings;
  for (const b of document.querySelectorAll('[data-plan]')) b.setAttribute('aria-pressed', String(b.dataset.plan === s.account.plan));
  for (const b of document.querySelectorAll('[data-minutes]')) b.setAttribute('aria-pressed', String(Number(b.dataset.minutes) === s.account.timerMinutes));
  for (const b of document.querySelectorAll('[data-then]')) b.setAttribute('aria-pressed', String(b.dataset.then === s.account.timerThen));
  $('limiting').setAttribute('aria-checked', String(s.account.autoClose));
  if (document.activeElement !== $('cap')) $('cap').value = s.account.capUsd ?? '';
  $('cost').textContent = `Den här månaden skulle kosta ungefär ${new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(data.control.budget.cost.usd)} USD på betald plan (5 USD i månaden ingår).`;
  const share = data.control.budget.share ?? {};
  $('share-inputs').replaceChildren(...gameNames().filter(connected).map((name) => {
    const row = el('label', { class: 'share-input' }, name);
    const input = el('input', { type: 'number', min: '0', max: '100', step: '1', inputmode: 'numeric', placeholder: String(Math.round(share[name] ?? 0)), 'aria-label': `${name}: andel i procent` });
    const g = s.games[name];
    if (g?.share !== null && g?.share !== undefined) input.value = String(g.share);
    input.addEventListener('change', () => save((x) => {
      x.games[name] ??= { mode: 'on', timer: null, stopped: false, share: null, modes: {} };
      x.games[name].share = input.value === '' ? null : Number(input.value);
    }));
    row.append(input);
    return row;
  }));
  $('game-modes').replaceChildren(...Object.keys(s.games).sort().map((name) => {
    const item = el('div', { class: 'item' });
    const info = el('div');
    info.append(el('span', { class: 'title' }, name));
    const modes = el('div', { class: 'chips' });
    for (const m of Object.keys(s.games[name].modes ?? {})) {
      const chip = el('span', { class: 'mode-chip' }, m);
      const remove = el('button', { type: 'button', 'aria-label': `Ta bort läget ${m} från ${name}` }, '×');
      remove.addEventListener('click', () => {
        if (confirm(`Ta bort läget ${m} från ${name}?`)) save((x) => { delete x.games[name].modes[m]; });
      });
      chip.append(remove);
      modes.append(chip);
    }
    if (!modes.children.length) modes.append(el('span', { class: 'sub' }, 'Inga lägen'));
    info.append(modes);
    item.append(info);
    return item;
  }));
}
for (const b of document.querySelectorAll('[data-plan]')) b.addEventListener('click', () => save((s) => { s.account.plan = b.dataset.plan; }));
for (const b of document.querySelectorAll('[data-minutes]')) b.addEventListener('click', () => save((s) => { s.account.timerMinutes = Number(b.dataset.minutes); }));
for (const b of document.querySelectorAll('[data-then]')) b.addEventListener('click', () => save((s) => { s.account.timerThen = b.dataset.then; }));
$('limiting').addEventListener('click', () => save((s) => { s.account.autoClose = !s.account.autoClose; }));
$('cap').addEventListener('change', () => save((s) => { s.account.capUsd = $('cap').value === '' ? null : Number($('cap').value); }));
$('add-game').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const game = form.game.value.trim().toLowerCase();
  const mode = form.mode.value.trim().toLowerCase();
  if (!game) return;
  save((s) => {
    s.games[game] ??= { mode: 'on', timer: null, stopped: false, share: null, url: null, modes: {} };
    if (mode) s.games[game].modes[mode] ??= { mode: 'on', timer: null };
  });
  form.game.value = '';
  form.mode.value = '';
});

/* ---------- Logg ---------- */

async function loadLog() {
  const game = $('log-game').value;
  const res = await fetch(`/api/log${game ? `?game=${encodeURIComponent(game)}` : ''}`);
  if (!res.ok) return;
  const list = await res.json();
  $('log').replaceChildren(...(list.length ? list.map((e) => {
    const row = el('div', { class: 'entry' });
    row.append(el('span', { class: 'when' }, dayTime(e.at)), el('span', { class: 'text' }, e.text));
    return row;
  }) : [el('p', { class: 'muted' }, 'Inget i loggen än.')]));
}
$('log-game').addEventListener('change', () => loadLog().catch(() => {}));

load().catch((e) => {
  $('message').textContent = `Sidan kunde inte laddas: ${e.message}`;
});
