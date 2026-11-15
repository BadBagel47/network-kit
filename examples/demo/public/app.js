// network-kit demo: a host-run room with takeover. The host's browser moves
// everyone's ship; the others send their keys only when they change; the
// host sends positions often and gives the room a full snapshot now and then.
import {
  NetworkRoom, shareLink, readShareLink, forgetShareKey, qrSvg, tabSession,
} from './network-kit/client/index.js';

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
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} ${text}`;
  $('log').prepend(li);
  while ($('log').children.length > 30) $('log').lastChild.remove();
}

function nameOf(id) {
  return room.player(id)?.name ?? world.ships[id]?.name ?? 'Someone';
}

function showGame() {
  $('start').hidden = true;
  $('game').hidden = false;
  $('room-code').textContent = room.code;

  room.on('status', renderStatus);
  room.on('room', render);
  room.on('closed', ({ text }) => {
    sessionStorage.removeItem('demo:room');
    $('overlay').hidden = false;
    $('overlay').textContent = text;
  });
  room.on('error', ({ code }) => log(`Not possible: ${code}`));

  // This browser runs the game now: from the room's kept state, or from scratch.
  room.on('host', ({ snapshot }) => {
    world = snapshot ?? { ships: {}, tick: 0 };
    inputs = { [room.me]: myKeys };
    ensureShips();
    log(snapshot ? 'You run the game now, from the latest state.' : 'You run the game.');
  });
  room.on('role', ({ isHost }) => {
    if (!isHost) inputs = {};
  });

  room.on('peer', ({ event, id }) => {
    const words = { join: 'joined', back: 'is back', drop: 'lost the connection', gone: 'left', host: 'runs the game', waiting: 'is waiting', owner: 'owns the room' };
    log(`${nameOf(id)} ${words[event] ?? event}.`);
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

function renderStatus(status) {
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
function key(event, down) {
  const k = KEYMAP[event.code];
  if (!k || !room || room.self?.role !== 'player') return;
  event.preventDefault();
  if (myKeys[k] === down) return;
  myKeys = { ...myKeys, [k]: down };
  if (room.isHost) inputs[room.me] = myKeys;
  else room.send({ type: 'input', keys: myKeys }); // only when the keys change
}
addEventListener('keydown', (e) => key(e, true));
addEventListener('keyup', (e) => key(e, false));

// -------------------------------------------------------------- simulation

function ensureShips() {
  for (const [i, p] of room.players.entries()) {
    if (p.role !== 'player' || p.waiting) continue;
    world.ships[p.id] ??= { x: 80 + ((i * 140) % 440), y: 180, vx: 0, vy: 0, color: COLORS[i % COLORS.length], name: p.name };
    world.ships[p.id].name = p.name;
  }
}

function applyPositions(p, tick) {
  for (const [id, x, y] of p) {
    world.ships[id] ??= { x, y, vx: 0, vy: 0, color: COLORS[Object.keys(world.ships).length % COLORS.length], name: '' };
    Object.assign(world.ships[id], { x, y });
  }
  world.tick = tick;
}

setInterval(() => {
  if (!room?.isHost || !room.running) return;
  world.tick += 1;
  for (const [id, ship] of Object.entries(world.ships)) {
    const k = inputs[id] ?? {};
    ship.vx = (ship.vx + ((k.right ? 1 : 0) - (k.left ? 1 : 0)) * 0.6) * 0.9;
    ship.vy = (ship.vy + ((k.down ? 1 : 0) - (k.up ? 1 : 0)) * 0.6) * 0.9;
    ship.x = Math.max(10, Math.min(590, ship.x + ship.vx));
    ship.y = Math.max(10, Math.min(350, ship.y + ship.vy));
  }
  // Positions 15 times a second; not worth resending, the next one replaces them.
  // (Nothing is sent while the host is alone in the room.)
  if (world.tick % 2 === 0) {
    const p = Object.entries(world.ships).map(([id, s]) => [id, Math.round(s.x), Math.round(s.y)]);
    room.send({ type: 'pos', tick: world.tick, p }, { reliable: false });
  }
  // The full state every 3 seconds, kept by the room for a reload or a takeover.
  if (world.tick % 90 === 1) room.sendSnapshot(world);
}, 1000 / 30);

// ------------------------------------------------------------------ render

const ctx = $('canvas').getContext('2d');
function draw() {
  requestAnimationFrame(draw);
  if (!room) return;
  const r = room.room;
  ctx.clearRect(0, 0, 600, 360);
  for (const [id, s] of Object.entries(world.ships)) {
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, id === room.me ? 10 : 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e6edf3';
    ctx.font = '12px system-ui';
    ctx.fillText(s.name || nameOf(id), s.x + 12, s.y - 10);
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
window.demo = { get room() { return room; }, get world() { return world; } };
