// Measurements for the demo (F-047): what one device experiences, collected
// in the background and sent as a report when the owner presses "Send report".
// The demo is only tested by the owner, so the report holds what the
// measurement needs: names used in the test, device, network and timings.

const MAX_SAMPLES = 600;
const t0 = performance.now();
let since = Date.now();

const samples = {
  rttMs: [], // to the host's browser and back
  startMs: [], // key pressed from standing still → the host's game shows the ship moving
  stopMs: [], // last key let go → the host's game shows the ship standing still
  posGapMs: [], // time between two position updates arriving (not on the host)
  frameMs: [], // time between two drawn frames
  sendGapMs: [], // host only: time between two position sends from this browser
  offlineMs: [], // connection lost → back online
  pauseMs: [], // the game paused (host away, switching host, a player away) → running again
  jumpPx: [], // a ship jumped further than it can move between two updates (not on the host)
  correctionPx: [], // how far the own ship's prediction was from the host's position (F-048)
};
const counts = { posUpdates: 0, messagesIn: 0, reconnects: 0, hidden: 0, keyPresses: 0, snaps: 0, jumps: 0, errors: 0, hostChanges: 0, pauses: 0 };
const events = [];

const push = (list, v) => {
  list.push(Math.round(v * 10) / 10);
  if (list.length > MAX_SAMPLES) list.shift();
};

export function event(text) {
  events.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${text}`);
  if (events.length > 300) events.shift();
}

/** Statistics of a list of numbers. */
export function stats(list) {
  if (!list.length) return { n: 0 };
  const s = [...list].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, min: s[0], p50: q(0.5), p90: q(0.9), max: s[s.length - 1], mean: Math.round(mean * 10) / 10 };
}

// ---- what the page reports in

export const rtt = (ms) => push(samples.rttMs, ms);
export const offline = (ms) => push(samples.offlineMs, ms);
export const error = () => (counts.errors += 1);
export const hostChange = () => (counts.hostChanges += 1);
export function pause(ms, reason) {
  counts.pauses += 1;
  push(samples.pauseMs, ms);
  event(`paused ${Math.round(ms)} ms (${reason})`);
}
export function jump(px) {
  counts.jumps += 1;
  push(samples.jumpPx, px);
}
export const messageIn = () => (counts.messagesIn += 1);
export const reconnect = () => (counts.reconnects += 1);
export const correction = (px, snapped) => {
  push(samples.correctionPx, px);
  if (snapped) counts.snaps += 1;
};

let lastPos = null;
export function posArrived(t) {
  counts.posUpdates += 1;
  if (lastPos !== null) push(samples.posGapMs, t - lastPos);
  lastPos = t;
}

// Key to movement: measured against what the game (the host) says, so it is
// the same whether the own ship is predicted or not.
let pendingStart = null;
let pendingStop = null;
let lastOwn = null;
// Only the change from standing still to moving (and back) counts: a second
// key pressed while the ship already moves is not a start.
let held = false;
export function keys(anyHeld, t) {
  counts.keyPresses += 1;
  if (anyHeld === held) return;
  held = anyHeld;
  if (anyHeld && pendingStop === null) pendingStart = t;
  if (!anyHeld) {
    pendingStart = null;
    pendingStop = t;
  }
}

// On the host: how evenly this browser sends the positions. If these gaps are
// even but the others receive them unevenly, the delay is in the network or
// the device's radio, not in the page.
let lastSend = null;
export function posSent(t) {
  if (lastSend !== null) push(samples.sendGapMs, t - lastSend);
  lastSend = t;
}
/** The game's position of the own ship, as it arrives (or as the host steps it). */
export function ownPosition(x, y, t) {
  const moved = lastOwn && (lastOwn.x !== x || lastOwn.y !== y);
  if (pendingStart !== null && moved) {
    push(samples.startMs, t - pendingStart);
    pendingStart = null;
  }
  // A stop shows as two updates with the same position; the ship stood still
  // from the first of them, so that is when it stopped (not when the second came).
  if (pendingStop !== null && lastOwn && !moved) {
    push(samples.stopMs, Math.max(0, Math.max(lastOwn.t, pendingStop) - pendingStop));
    pendingStop = null;
  }
  lastOwn = moved || !lastOwn ? { x, y, t } : lastOwn;
}

let lastFrame = null;
export function frame(t) {
  if (lastFrame !== null && !document.hidden) push(samples.frameMs, t - lastFrame);
  lastFrame = t;
}
addEventListener('online', () => event('browser: network online'));
addEventListener('offline', () => event('browser: network offline'));
addEventListener('pagehide', (e) => event(`page hide${e.persisted ? ' (kept in memory)' : ''}`));
addEventListener('pageshow', (e) => e.persisted && event('page shown again from memory'));
document.addEventListener('freeze', () => event('page frozen by the browser'));
document.addEventListener('resume', () => event('page resumed by the browser'));
navigator.connection?.addEventListener?.('change', () => {
  const c = navigator.connection;
  event(`network changed: ${c.type ?? '?'} ${c.effectiveType ?? ''} rtt ${c.rtt ?? '?'} ms`);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) counts.hidden += 1;
  event(document.hidden ? 'page hidden' : 'page visible');
  lastFrame = null;
});

/** The report: the device, the room as this page sees it, and the measurements since the last report. */
export function report(room, extra = {}) {
  const c = navigator.connection;
  const r = room?.room;
  const frames = stats(samples.frameMs);
  return {
    kind: 'network-kit demo report',
    period: { from: new Date(since).toISOString(), to: new Date().toISOString(), seconds: Math.round((Date.now() - since) / 1000) },
    device: {
      userAgent: navigator.userAgent,
      platform: navigator.userAgentData?.platform ?? navigator.platform ?? null,
      mobile: navigator.userAgentData?.mobile ?? null,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
      viewport: `${innerWidth}x${innerHeight}`,
      touch: navigator.maxTouchPoints ?? 0,
      network: c ? { type: c.type ?? null, effectiveType: c.effectiveType ?? null, rtt: c.rtt ?? null, downlink: c.downlink ?? null } : null,
    },
    room: room ? {
      code: room.code, me: room.me, name: room.self?.name ?? null, role: room.self?.role ?? null, place: room.self?.place ?? null,
      isHost: room.isHost, isOwner: room.isOwner, status: room.status, phase: r?.phase ?? null, paused: r?.paused ?? null,
      host: r?.players?.find((p) => p.id === r.hostId)?.name ?? null,
      players: r?.players?.map((p) => ({ name: p.name, role: p.role, place: p.place, status: p.status, host: p.id === r.hostId })) ?? [],
    } : null,
    ...extra,
    measured: {
      rttMs: stats(samples.rttMs),
      keyToMoveMs: stats(samples.startMs),
      keyToStopMs: stats(samples.stopMs),
      positionGapMs: stats(samples.posGapMs),
      sendGapMs: stats(samples.sendGapMs),
      frameMs: frames,
      fps: frames.mean ? Math.round(10_000 / frames.mean) / 10 : null,
      predictionErrorPx: stats(samples.correctionPx),
      offlineMs: stats(samples.offlineMs),
      pauseMs: stats(samples.pauseMs),
      jumpPx: stats(samples.jumpPx),
      counts: { ...counts },
    },
    recent: { rttMs: samples.rttMs.slice(-30), keyToMoveMs: samples.startMs.slice(-30), keyToStopMs: samples.stopMs.slice(-30) },
    events: [...events],
  };
}

/** Start a new period after a report was sent. */
export function reset() {
  for (const list of Object.values(samples)) list.length = 0;
  for (const k of Object.keys(counts)) counts[k] = 0;
  events.length = 0;
  since = Date.now();
  lastPos = null;
  lastSend = null;
}
