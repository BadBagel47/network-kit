// network-kit demo: a host-run room with takeover. The host's browser moves
// everyone's ship; the others send their keys only when they change; the
// host sends positions often and gives the room a full snapshot now and then.
import {
  NetworkRoom, shareLink, readShareLink, forgetShareKey, qrSvg, tabSession, VERSION,
} from './network-kit/client/index.js';
import * as diag from './diag.js';

const SERVER = location.origin;
const OPTIONS = { hostSilentMs: 4_000 }; // report a host that has gone quiet
const PLACES = ['captain', 'gunner', 'engineer'];
const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f778ba', '#a5d6ff', '#ff7b72', '#d2a8ff'];
const $ = (id) => document.getElementById(id);

let room = null;
let world = { ships: {}, tick: 0 };
let inputs = {}; // host only: latest keys per participant
let myKeys = { up: false, down: false, left: false, right: false };

// ------------------------------------------------------------ start screen

$('name').value = localStorage.getItem('demo:name') || '';
const link = readShareLink(location.hash);
if (link) $('code').value = link.code;

function nameValue() {
  const name = $('name').value.trim() || 'Player';
  localStorage.setItem('demo:name', name);
  return name;
}

async function enter(promise) {
  $('start-error').textContent = '';
  for (const b of document.querySelectorAll('#start button')) b.disabled = true;
  try {
    room = await promise;
    sessionStorage.setItem('demo:room', room.code);
    forgetShareKey();
    showGame();
  } catch (err) {
    $('start-error').textContent = err.message;
    sessionStorage.removeItem('demo:room');
  } finally {
    for (const b of document.querySelectorAll('#start button')) b.disabled = false;
  }
}

const joinOptions = (extra = {}) => ({ ...OPTIONS, code: $('code').value, name: nameValue(), key: link?.key, ...extra });
$('create').onclick = () => enter(NetworkRoom.create(SERVER, { ...OPTIONS, name: nameValue() }));
$('join').onclick = () => enter(NetworkRoom.join(SERVER, joinOptions()));
$('watch').onclick = () => enter(NetworkRoom.join(SERVER, joinOptions({ role: 'viewer' })));

// Coming back after a reload keeps the same seat (same tab, same identity).
// A tab the browser copied from another (a link opened in a new tab) is not
// that tab: it starts on this screen and asks for a name.
const { copied } = await tabSession();
if (copied) sessionStorage.removeItem('demo:room');
const saved = sessionStorage.getItem('demo:room');
if (saved && (!link || link.code === saved)) {
  enter(NetworkRoom.join(SERVER, { ...OPTIONS, code: saved, name: nameValue() }));
} else if (link) {
  // Arrived by an invitation: the name is the next thing to fill in.
  $('name').focus();
  $('name').select();
}

// ------------------------------------------------------------- game screen

function log(text) {
  diag.event(`log: ${text}`);
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} ${text}`;
  $('log').prepend(li);
  while ($('log').children.length > 30) $('log').lastChild.remove();
}

function nameOf(id, name = null) {
  return room.player(id)?.name ?? name ?? world.ships[id]?.name ?? 'Someone';
}

function showGame() {
  $('start').hidden = true;
  $('game').hidden = false;
  $('room-code').textContent = room.code;

  room.on('status', renderStatus);
  room.on('room', render);
  room.on('room', watchRoom);
  room.on('closed', ({ text, code, reason }) => {
    diag.event(`room closed: ${code ?? ''} ${reason ?? ''} ${text ?? ''}`);
    sessionStorage.removeItem('demo:room');
    $('overlay').hidden = false;
    $('overlay').textContent = text;
  });
  room.on('error', ({ code }) => {
    diag.error();
    log(`Not possible: ${code}`);
  });

  // This browser runs the game now: from the room's kept state, or from scratch.
  room.on('host', ({ snapshot }) => {
    // How old the kept state was compared with what this browser last saw.
    diag.event(`took over the game: ${snapshot ? `from a state ${Math.max(0, world.tick - (snapshot.tick ?? 0))} steps behind what this page last saw` : 'from scratch'}`);
    // This page may have seen newer positions than the room's kept state (it is
    // stored every 3 seconds): continue from the newest, so ships do not jump back (B-049).
    const kept = snapshot ?? { ships: {}, tick: 0 };
    if (world.tick > (kept.tick ?? 0)) {
      for (const [id, s] of Object.entries(world.ships)) {
        const ship = (kept.ships[id] ??= { ...s, vx: 0, vy: 0 });
        const at = id === room.me && mine ? mine : s;
        Object.assign(ship, { x: at.x, y: at.y });
        delete ship.glideFrom;
      }
      kept.tick = world.tick;
    }
    world = kept;
    inputs = { [room.me]: myKeys };
    ensureShips();
    log(snapshot ? 'You run the game now, from the latest state.' : 'You run the game.');
  });
  room.on('role', ({ isHost }) => {
    diag.event(isHost ? 'this browser runs the game' : 'another browser runs the game');
    responseMs = null;
    mine = null;
    if (!isHost) inputs = {};
  });

  room.on('peer', ({ event, id, name, returning }) => {
    const words = { join: 'joined', back: 'is back', drop: 'lost the connection', gone: 'left', host: 'runs the game', waiting: 'is waiting', owner: 'owns the room' };
    log(`${nameOf(id, name)} ${returning ? 'is back' : words[event] ?? event}.`);
    diag.event(`${nameOf(id, name)} ${returning ? 'is back' : words[event] ?? event}`);
    if (room.isHost) {
      if (event === 'join' || event === 'back') {
        ensureShips();
        room.send({ type: 'full', world }, { to: [id] }); // what a newcomer needs to see
      }
      if (event === 'gone') {
        delete world.ships[id];
        delete inputs[id];
      }
    } else if ((event === 'host' || (event === 'back' && id === room.room.hostId)) && room.self?.role === 'player') {
      // A new host does not know which keys are held, and inputs sent while
      // the host was away were dropped.
      room.send({ type: 'input', keys: myKeys });
    }
  });

  room.on('message', ({ from, data }) => {
    diag.messageIn();
    if (data?.type === 'ping') {
      room.send({ type: 'pong', t: data.t }, { to: [from] }); // answered at once
      return;
    }
    if (data?.type === 'pong') {
      const ms = performance.now() - data.t;
      diag.rtt(ms);
      responseMs = responseMs === null ? ms : responseMs * 0.6 + ms * 0.4; // a little smoothed
      return;
    }
    if (room.isHost) {
      if (data?.type === 'input') inputs[from] = data.keys;
    } else if (data?.type === 'pos') {
      applyPositions(data.p, data.tick);
    } else if (data?.type === 'full') {
      world = data.world;
    }
  });

  renderStatus(room.status);
  render(room.room);
}

let lastStatus = null;
let offlineSince = null;
// Pauses, host changes and the own place, with times, for the report (F-047).
let seen = { hostId: undefined, paused: null, pausedAt: null, place: undefined, phase: undefined };
function watchRoom(r) {
  if (!r) return;
  const t = performance.now();
  if (r.hostId !== seen.hostId) {
    if (seen.hostId !== undefined) diag.hostChange();
    diag.event(`host is ${nameOf(r.hostId) ?? 'nobody'}`);
  }
  const reason = r.paused?.reason ?? null;
  if (reason !== seen.paused) {
    if (seen.paused && seen.pausedAt !== null) diag.pause(t - seen.pausedAt, seen.paused);
    if (reason) diag.event(`paused: ${reason}${r.paused.id ? ` (${nameOf(r.paused.id)})` : ''}`);
    seen.pausedAt = reason ? t : null;
  }
  const place = room.self?.place ?? null;
  if (place !== seen.place) diag.event(`own place: ${place ?? 'none'}`);
  if (r.phase !== seen.phase) diag.event(`phase: ${r.phase}`);
  seen = { ...seen, hostId: r.hostId, paused: reason, place, phase: r.phase };
}

function renderStatus(status) {
  if (status !== lastStatus) {
    diag.event(`status ${status}`);
    if (status === 'reconnecting') diag.reconnect();
    if (status !== 'online' && lastStatus === 'online') offlineSince = performance.now();
    if (status === 'online' && offlineSince !== null) {
      diag.offline(performance.now() - offlineSince);
      offlineSince = null;
    }
    lastStatus = status;
  }
  const words = { online: 'Online', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline', closed: 'Closed' };
  $('status').textContent = words[status] ?? status;
  $('status').dataset.status = status;
}

function render(r) {
  if (!r) return;
  const me = room.self;
  const tags = [room.isOwner && 'owner', room.isHost && 'host', me?.role === 'viewer' && 'viewer'].filter(Boolean);
  $('role').textContent = tags.length ? `(${tags.join(', ')})` : '';
  $('start-game').hidden = !(room.isHost || room.isOwner);
  $('start-game').textContent = r.phase === 'lobby' ? 'Start' : 'Restart';
  $('pause').textContent = r.paused ? 'Resume' : 'Pause';
  $('pause').hidden = me?.role !== 'player' || me.waiting;
  $('pad').hidden = me?.role !== 'player' || me.waiting;
  $('phase').textContent = me?.waiting ? 'Waiting for the next round…' : '';

  const places = $('posts');
  places.replaceChildren();
  if (me?.role === 'player' && !me.waiting) {
    for (const place of PLACES) {
      const holder = r.places[place][0];
      const b = document.createElement('button');
      b.textContent = holder ? `${place}: ${nameOf(holder)}` : place;
      b.setAttribute('aria-pressed', String(holder === room.me));
      b.disabled = Boolean(holder && holder !== room.me);
      b.onclick = () => (holder === room.me ? room.leavePlace() : room.takePlace(place));
      places.append(b);
    }
  }

  const list = $('players');
  list.replaceChildren();
  for (const p of r.players) {
    const li = document.createElement('li');
    const notes = [p.id === r.ownerId && 'owner', p.id === r.hostId && 'host', p.role === 'viewer' && 'viewer', p.status === 'away' && 'away', p.waiting && 'waiting', p.place]
      .filter(Boolean).join(', ');
    li.textContent = `${p.name}${p.id === room.me ? ' (you)' : ''}${notes ? ` – ${notes}` : ''} `;
    if (room.isOwner && p.id !== room.me) {
      const kick = document.createElement('button');
      kick.textContent = 'Remove';
      kick.onclick = () => room.kick(p.id);
      li.append(kick);
    }
    list.append(li);
  }
  if (room.isHost) ensureShips();
  if ($('share-dialog').open) fillShare();
}

$('start-game').onclick = () => room.start();
$('pause').onclick = () => (room.room.paused ? room.resume() : room.pause());
$('leave').onclick = () => {
  room.leave(room.isHost ? world : undefined);
  sessionStorage.removeItem('demo:room');
  setTimeout(() => location.assign(location.pathname), 300);
};

// ------------------------------------------------------------------- share

function fillShare() {
  const keys = room.inviteKeys; // only the owner has them
  const playerUrl = shareLink(location.href, room.code, keys?.player.k);
  const viewerUrl = keys ? shareLink(location.href, room.code, keys.viewer.k) : null;
  $('share-code').textContent = room.code;
  $('player-link').href = playerUrl;
  $('viewer-link').href = viewerUrl ?? playerUrl;
  $('viewer-link').hidden = !viewerUrl;
  $('qr').innerHTML = qrSvg(playerUrl, { title: 'QR code for joining this room' });
  $('renew-player').hidden = $('renew-viewer').hidden = !keys;
}
$('share').onclick = () => {
  fillShare();
  $('share-dialog').showModal();
};
$('close-share').onclick = () => $('share-dialog').close();
$('renew-player').onclick = () => room.renewKey('player');
$('renew-viewer').onclick = () => room.renewKey('viewer');

// ------------------------------------------------------------------- input

const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
/** A direction pressed or released, from the keyboard or the arrows on the screen. */
function press(k, down) {
  if (!room || room.self?.role !== 'player') return;
  if (myKeys[k] === down) return;
  myKeys = { ...myKeys, [k]: down };
  diag.keys(Object.values(myKeys).some(Boolean), now());
  document.querySelector(`#pad [data-key="${k}"]`)?.setAttribute('aria-pressed', String(down));
  if (room.isHost) inputs[room.me] = myKeys;
  else room.send({ type: 'input', keys: myKeys }); // only when the keys change
}
/** True while the player types in a field: then the keys are letters, not steering (B-041). */
function typing(target) {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}
function key(event, down) {
  const k = KEYMAP[event.code];
  if (!k) return;
  if (typing(event.target)) {
    if (!down) press(k, false); // a key held before the field got focus is still let go
    return;
  }
  event.preventDefault();
  press(k, down);
}
addEventListener('keydown', (e) => key(e, true));
addEventListener('keyup', (e) => key(e, false));

// Arrows on the screen for phones and tablets (F-038): held while the finger is down.
for (const button of document.querySelectorAll('#pad button')) {
  const k = button.dataset.key;
  const down = (e) => {
    e.preventDefault();
    button.setPointerCapture?.(e.pointerId);
    press(k, true);
  };
  const up = (e) => {
    e.preventDefault();
    press(k, false);
  };
  button.addEventListener('pointerdown', down);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, up);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
}
// Let go of everything when the page is left, so no direction stays held.
addEventListener('blur', () => { for (const k of Object.keys(myKeys)) press(k, false); });

// -------------------------------------------------------------- simulation

function ensureShips() {
  for (const [i, p] of room.players.entries()) {
    if (p.role !== 'player' || p.waiting) continue;
    world.ships[p.id] ??= { x: 80 + ((i * 140) % 440), y: 180, vx: 0, vy: 0, color: COLORS[i % COLORS.length], name: p.name };
    world.ships[p.id].name = p.name;
  }
}

// Positions arrive about 15 times a second, at uneven intervals. Drawing each
// one as it comes looks jerky, so the others' browsers glide from where a ship
// is drawn to its newest position over about one interval (B-042).
const GLIDE_MS = 1000 / 15;
const now = () => performance.now();
function applyPositions(p, tick) {
  const t = now();
  diag.posArrived(t);
  for (const [id, x, y] of p) {
    if (id === room.me) {
      diag.ownPosition(x, y, t);
      reconcile(world.ships[id], x, y);
    }
    const s = (world.ships[id] ??= { x, y, vx: 0, vy: 0, color: COLORS[Object.keys(world.ships).length % COLORS.length], name: '' });
    const at = drawnAt(s, t);
    // Between two updates a ship moves at most a few steps; more is a jump.
    const far = Math.hypot(x - s.x, y - s.y);
    if (s.glideFrom !== undefined && far > SPEED * 6) {
      diag.jump(far);
      diag.event(`${nameOf(id)}'s ship jumped ${Math.round(far)} px`);
    }
    Object.assign(s, { x, y, fromX: at.x, fromY: at.y, glideFrom: t });
  }
  world.tick = tick;
}
/** Where a ship is drawn at time t: the host draws the game itself, the others glide. */
function drawnAt(s, t) {
  if (room?.isHost || s.glideFrom === undefined) return { x: s.x, y: s.y };
  const k = Math.min(1, (t - s.glideFrom) / GLIDE_MS);
  return { x: s.fromX + (s.x - s.fromX) * k, y: s.fromY + (s.y - s.fromY) * k };
}

// The game steps 30 times a second by the clock, not by how often the browser
// runs the timer: Safari on the iPad runs a 33 ms timer about every 36 ms,
// which made the game 8 % slower with the iPad as host (B-050).
const STEP_MS = 1000 / 30;
/** Calls step() once for every 33 ms that has passed since the last call (at most 5 at a time). */
function clock() {
  let last = null;
  return (running, step) => {
    const t = now();
    if (!running) return void (last = null);
    if (last === null) last = t - STEP_MS;
    let n = Math.floor((t - last) / STEP_MS);
    last += n * STEP_MS;
    if (n > 5) {
      n = 5; // the page was asleep: do not race to catch up
      last = t;
    }
    for (let i = 0; i < n; i++) step();
  };
}
const SPEED = 4; // pixels per step, 120 a second
const clampX = (x) => Math.max(10, Math.min(590, x));
const clampY = (y) => Math.max(10, Math.min(350, y));

// Instant own ship (F-048): a player who does not run the game moves their own
// ship at once in their own browser, with the same rules as the host, and
// corrects it towards the game's position. While the ship moves the game's
// position is a little behind (by the response time), so the correction waits
// until the player has let go and the game shows the ship standing still.
let predict = localStorage.getItem('demo:predict') !== 'off';
let mine = null; // where this browser draws its own ship while predicting
let lastServerOwn = null;
const SNAP_PX = 60;
function predicting() {
  return predict && room && !room.isHost && room.self?.role === 'player' && !room.self.waiting;
}
function reconcile(ship, x, y) {
  const stopped = lastServerOwn && lastServerOwn.x === x && lastServerOwn.y === y;
  lastServerOwn = { x, y };
  if (!predicting()) return void (mine = null);
  if (!mine) return void (mine = { x, y });
  const err = Math.hypot(mine.x - x, mine.y - y);
  if (err > SNAP_PX) {
    diag.correction(err, true);
    mine = { x, y };
  } else if (stopped && !Object.values(myKeys).some(Boolean)) {
    if (err > 0.5) diag.correction(err, false);
    mine = { x: mine.x + (x - mine.x) * 0.5, y: mine.y + (y - mine.y) * 0.5 };
  }
}
const ownClock = clock();
setInterval(() => ownClock(Boolean(predicting() && room.running && mine), () => {
  mine.x = clampX(mine.x + ((myKeys.right ? 1 : 0) - (myKeys.left ? 1 : 0)) * SPEED);
  mine.y = clampY(mine.y + ((myKeys.down ? 1 : 0) - (myKeys.up ? 1 : 0)) * SPEED);
}), 1000 / 60);
function showPredict() {
  $('predict').setAttribute('aria-pressed', String(predict));
  $('predict').textContent = `Instant own ship: ${predict ? 'on' : 'off'}`;
}
$('predict').onclick = () => {
  predict = !predict;
  localStorage.setItem('demo:predict', predict ? 'on' : 'off');
  mine = null;
  diag.event(`instant own ship ${predict ? 'on' : 'off'}`);
  showPredict();
};
showPredict();

// Measurement report (F-047): sent to the demo's server, read by the agent.
$('report').onclick = async () => {
  const button = $('report');
  button.disabled = true;
  try {
    // Where the room runs (D-046): the data centre code, e.g. FRA or ARN.
    const info = await fetch(`/rooms/${room.code}`).then((r) => r.json()).catch(() => null);
    const body = diag.report(room, { instantOwnShip: predict, kit: VERSION, page: location.pathname, roomRunsIn: info?.where ?? null });
    const res = await fetch('/diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(answer.error ?? `HTTP ${res.status}`);
    log(`Report ${answer.id} sent (${body.period.seconds} s of measurements).`);
    diag.reset();
  } catch (err) {
    log(`The report could not be sent: ${err.message}`);
  } finally {
    button.disabled = false;
  }
};

// Response time: how long a message takes from this browser to the one running
// the game and back, measured every 2 seconds (F-045). The host has no delay.
let responseMs = null;
setInterval(() => {
  if (!room || room.status !== 'online' || room.isHost || !room.room?.hostId || room.self?.role !== 'player') return;
  room.send({ type: 'ping', t: performance.now() }, { to: [room.room.hostId] });
}, 2000);
function showResponse() {
  const el = $('response');
  if (!room || (!room.isHost && room.self?.role !== 'player')) return void (el.textContent = ''); // viewers send nothing
  el.textContent = room.isHost ? 'You run the game: no delay'
    : responseMs === null ? 'Response: measuring…' : `Response: ${Math.round(responseMs)} ms`;
}
setInterval(showResponse, 500);

const hostClock = clock();
setInterval(() => hostClock(Boolean(room?.isHost && room.running), hostStep), STEP_MS / 2);

function hostStep() {
  world.tick += 1;
  for (const [id, ship] of Object.entries(world.ships)) {
    // No inertia: a ship moves at an even speed while a key is held and stops
    // at once, so the response is easy to judge (F-045).
    const k = inputs[id] ?? {};
    ship.vx = ((k.right ? 1 : 0) - (k.left ? 1 : 0)) * SPEED;
    ship.vy = ((k.down ? 1 : 0) - (k.up ? 1 : 0)) * SPEED;
    ship.x = Math.max(10, Math.min(590, ship.x + ship.vx));
    ship.y = Math.max(10, Math.min(350, ship.y + ship.vy));
    if (id === room.me) diag.ownPosition(ship.x, ship.y, now());
  }
  // Positions 15 times a second; only the newest counts, so the kit sends the
  // latest one whenever the pace allows. (Nothing is sent while the host is alone.)
  if (world.tick % 2 === 0) {
    const p = Object.entries(world.ships).map(([id, s]) => [id, Math.round(s.x), Math.round(s.y)]);
    room.send({ type: 'pos', tick: world.tick, p }, { latest: 'pos' });
    diag.posSent(now());
  }
  // The full state every 3 seconds, kept by the room for a reload or a takeover.
  if (world.tick % 90 === 1) room.sendSnapshot(world);
}

// ------------------------------------------------------------------ render

const ctx = $('canvas').getContext('2d');
function draw() {
  requestAnimationFrame(draw);
  if (!room) return;
  const r = room.room;
  ctx.clearRect(0, 0, 600, 360);
  const t = now();
  diag.frame(t);
  for (const [id, s] of Object.entries(world.ships)) {
    const at = id === room.me && mine && predicting() ? mine : drawnAt(s, t);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(at.x, at.y, id === room.me ? 10 : 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e6edf3';
    ctx.font = '12px system-ui';
    ctx.fillText(s.name || nameOf(id), at.x + 12, at.y - 10);
  }
  if (room.status === 'closed') return;
  let text = '';
  if (r?.paused) {
    const why = { 'host-away': 'Waiting for the host…', 'host-change': 'Switching host…', 'player-away': `Waiting for ${nameOf(r.paused.id)}…` };
    text = why[r.paused.reason] ?? `Paused${r.paused.id ? ` (${nameOf(r.paused.id)})` : ''}`;
  } else if (r?.phase === 'lobby') {
    text = room.isHost || room.isOwner ? 'Press Start' : 'Waiting for the host to start';
  } else if (r?.phase === 'countdown') {
    text = String(Math.max(1, Math.ceil((r.startsAt - room.serverNow()) / 1000)));
  }
  $('overlay').hidden = !text;
  $('overlay').textContent = text;
}
draw();

// For the browser test and for poking around in the console.
window.demo = { get room() { return room; }, get world() { return world; }, get mine() { return mine; } };
