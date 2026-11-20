// Playtest Recorder (F-092): records without disturbing the players, so a match
// with friends can be read afterwards to see what can be improved or what went
// wrong. It collects what the game hands over (`record(kind, data)`) and what
// the kit sees itself (errors, frames per second and slow frames, the room's
// connection and its participants), and sends it in batches about once a
// minute and when the page closes. Other players are to be told; the game
// shows RECORDER_NOTICE to them (owner, Q8).
//
// Who records (owner 2026-11-19, Q4): a browser with a tester link records from
// the start; with Open test on (F-118) a page with ?record records and one with
// ?report only shows Playtest-rutan. While not recording, the last two minutes
// are kept in the browser's memory only (F-120, Q12): *Spela in* in the panel
// starts recording with them, so the recording shows what led up to it.
//
//   import { startRecorder } from './vendor/network-kit/client/playtest-entry.js';
//   const recorder = await startRecorder({ admin, version, room });   // null when nothing may record
//   recorder?.record('level-start', { level: 3 });
//   recorder?.attach(room);   // a room joined later
//   recorder?.onStart(() => room.send({ type: 'recording' }));  // tell the others
//   recorder?.onStop(() => room.send({ type: 'recording', on: false }));

import { VERSION } from '../version.js';
import { describeDevice, confirmTap, openSession, openMode, NAME_KEY } from './playtest.js';
import { RECORDER_NOTICE } from './playtest-entry.js';

export { RECORDER_NOTICE };
const TOKEN_KEY = 'nk-playtest:tester';
const OFF_KEY = 'nk-playtest:recording-off'; // this tab stopped recording (sessionStorage)
const BATCH_MS = 60_000;
const EVENTS_MAX = 500; // per batch, as the admin page takes them
const CHUNKS_MAX = 240; // per session (four hours); then a new session starts
export const LOOKBACK_MS = 2 * 60_000; // owner Q12: the last two minutes

const randomId = (win) => {
  const bytes = win.crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const session = (win) => {
  try {
    return win.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export class Recorder {
  constructor({ admin, token, version = '', window: win, document: doc, fetch: f, everyMs = BATCH_MS, badge = true, recording = true, open = false }) {
    this.admin = String(admin).replace(/\/$/, '');
    this.token = token;
    this.open = open;
    this.version = version;
    this.win = win;
    this.doc = doc;
    this.fetch = f ?? ((...a) => win.fetch(...a));
    this.everyMs = everyMs;
    this.badgeWanted = badge && !new URLSearchParams(win.location?.search ?? '').has('still');
    this.events = []; // { at, k, d }: times are absolute until sent
    this.dropped = 0;
    this.frames = { count: 0, slowest: 0, last: 0 };
    this.rooms = new Set();
    this.closed = false;
    this.recording = false;
    this.listeners = { start: [], stop: [] };
    this.watch();
    this.timer = win.setInterval?.(() => this.tick(), everyMs);
    win.__nkRecorder = this; // Playtest-rutan finds it for *Spela in* (F-120)
    if (recording) this.start({ quiet: true });
    else win.dispatchEvent?.(new win.CustomEvent('nk-playtest-recorder', { detail: { recording: false } })); // the panel shows *Spela in*
  }

  newSession() {
    this.session = randomId(this.win);
    this.seq = 0;
    this.startedAt = Date.now();
  }

  /** A game event worth seeing afterwards (a level start, a death, a choice …). */
  record(kind, data = null) {
    if (this.closed) return;
    if (this.events.length >= EVENTS_MAX) {
      if (this.recording) {
        this.dropped += 1;
        return;
      }
      this.events.shift(); // the look-back keeps the newest
    }
    this.events.push({ at: Date.now(), k: String(kind).slice(0, 40), d: data });
  }

  /** Also record what happens in a NetworkRoom: connection, participants, host, closing. */
  attach(room) {
    if (!room || this.rooms.has(room)) return;
    this.rooms.add(room);
    this.record('room', { code: room.code, me: room.me ?? null });
    room.on('status', (status) => this.record('room-status', { status }));
    room.on('peer', (p) => this.record('room-peer', { event: p?.event ?? p?.type ?? null, id: p?.id ?? p?.player?.id ?? null }));
    room.on('room', (r) => {
      const key = `${r?.phase}|${r?.hostId}|${r?.ownerId}|${r?.paused}`;
      if (key === this.lastRoomKey) return;
      this.lastRoomKey = key;
      this.record('room-state', { phase: r?.phase ?? null, host: r?.hostId ?? null, owner: r?.ownerId ?? null, paused: Boolean(r?.paused), players: r?.players?.length ?? null });
    });
    room.on('closed', (c) => this.record('room-closed', { code: c?.code ?? null, reason: c?.reason ?? null }));
    room.on('error', (e) => this.record('room-error', { code: e?.code ?? null, command: e?.command ?? null }));
  }

  watch() {
    const w = this.win;
    w.addEventListener?.('error', (e) => this.record('error', { message: String(e.message ?? 'error').slice(0, 300), at: e.filename ? `${String(e.filename).split('/').pop()}:${e.lineno}` : null }));
    w.addEventListener?.('unhandledrejection', (e) => this.record('error', { message: `Unhandled: ${String(e.reason?.message ?? e.reason).slice(0, 300)}` }));
    w.addEventListener?.('pagehide', () => this.flush(true));
    // Playtest-rutan's "Sluta testa på den här enheten" (F-117).
    w.addEventListener?.('nk-playtest-forget', () => this.close());
    this.doc?.addEventListener?.('visibilitychange', () => {
      this.record('visibility', { hidden: Boolean(this.doc.hidden) });
      if (this.doc.hidden) this.flush(true);
    });
    const raf = w.requestAnimationFrame?.bind(w);
    if (raf) {
      const tick = (t) => {
        const f = this.frames;
        if (f.last) f.slowest = Math.max(f.slowest, t - f.last);
        f.count += 1;
        f.last = t;
        if (!this.closed) raf(tick);
      };
      raf(tick);
    }
  }

  /** About once a minute: frames per second, then send (recording) or trim to the look-back (not). */
  tick() {
    if (this.closed) return;
    this.measure();
    if (this.recording) this.flush();
    else this.trim();
  }

  measure() {
    if (this.frames.count > 1) {
      this.events.push({ at: Date.now(), k: 'perf', d: { fps: Math.round(this.frames.count / (this.everyMs / 1000)), slowestFrameMs: Math.round(this.frames.slowest) } });
      this.frames = { count: 0, slowest: 0, last: 0 };
    }
  }

  trim(now = Date.now()) {
    const from = now - LOOKBACK_MS;
    const i = this.events.findIndex((e) => e.at >= from);
    this.events = i < 0 ? [] : this.events.slice(i);
  }

  context() {
    const w = this.win;
    const { device, browser, userAgent } = describeDevice(w.navigator);
    return {
      url: String(w.location?.href ?? ''), version: String(this.version ?? ''), kit: VERSION, device, browser, userAgent,
      window: `${w.innerWidth}x${w.innerHeight}`, screen: `${w.screen?.width ?? 0}x${w.screen?.height ?? 0}`,
      dpr: w.devicePixelRatio ?? 1, language: w.navigator?.language ?? '', startedAt: this.startedAt,
    };
  }

  /** Sends what has been gathered while recording; `leaving` uses sendBeacon, which outlives the page. */
  async flush(leaving = false) {
    if (!this.recording) return false;
    if (this.dropped) {
      this.events.push({ at: Date.now(), k: 'dropped', d: { events: this.dropped } });
      this.dropped = 0;
    }
    if (!this.events.length) return false;
    let name = '';
    try {
      name = this.open ? String(JSON.parse(session(this.win)?.getItem(NAME_KEY) ?? 'null') ?? '').slice(0, 40) : ''; // kept as JSON by the panel
    } catch {
      name = '';
    }
    // Times count from the session's start; the look-back's are negative (F-120).
    const events = this.events.slice(0, EVENTS_MAX + 2).map((e) => ({ t: e.at - this.startedAt, k: e.k, d: e.d }));
    const chunk = {
      token: this.token, session: this.session, seq: this.seq, events,
      ...(this.seq === 0 ? { context: this.context() } : {}),
      ...(name ? { name } : {}),
    };
    this.events = [];
    this.seq += 1;
    if (this.seq >= CHUNKS_MAX) this.newSession();
    const url = `${this.admin}/playtest/v1/record`;
    const body = JSON.stringify(chunk);
    // A plain-text beacon needs no preflight, so it still goes when the page closes.
    if (leaving && this.win.navigator?.sendBeacon) return this.win.navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
    try {
      const res = await this.fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body, keepalive: true });
      return res.ok;
    } catch {
      return false; // a lost batch is acceptable: recording never disturbs the game
    }
  }

  showBadge() {
    const doc = this.doc;
    if (!doc?.documentElement || this.badge) return;
    // A button (owner Q3): a tap asks, a second stops recording in this tab (Q11).
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = '● Inspelning';
    b.setAttribute('aria-label', 'Playtest Recorder spelar in. Tryck för att sluta.');
    // Styles through the CSSOM, so a strict Content-Security-Policy allows them.
    Object.assign(b.style, {
      position: 'fixed', right: '8px', bottom: '8px', zIndex: '2147481999', cursor: 'pointer', border: '0', margin: '0',
      font: '600 12px system-ui, sans-serif', color: '#fff', background: 'rgba(170, 20, 20, .85)', padding: '4px 9px', borderRadius: '999px',
      touchAction: 'manipulation', webkitTapHighlightColor: 'transparent',
    });
    // The game never gets the tap.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown']) b.addEventListener(type, (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirmTap(this.win, b, '● Tryck igen för att sluta spela in')) return;
      this.stop();
    });
    doc.documentElement.append(b);
    this.badge = b;
  }

  /** Called each time recording starts, for example so the game can tell the others. */
  onStart(fn) {
    this.listeners.start.push(fn);
  }

  /** Called each time recording stops. */
  onStop(fn) {
    this.listeners.stop.push(fn);
  }

  emit(kind) {
    for (const fn of this.listeners[kind]) {
      try {
        fn();
      } catch {
        // a game's listener never stops the Recorder
      }
    }
    this.win.dispatchEvent?.(new this.win.CustomEvent('nk-playtest-recorder', { detail: { recording: this.recording } }));
  }

  /** Starts recording (*Spela in*, F-120), with the last two minutes kept so far. */
  start({ quiet = false } = {}) {
    if (this.closed || this.recording) return;
    this.trim();
    this.newSession();
    this.recording = true;
    try {
      session(this.win)?.removeItem(OFF_KEY);
    } catch {
      // nothing kept
    }
    if (this.badgeWanted) this.showBadge();
    this.emit('start');
    if (!quiet) this.flush();
  }

  /** Stops recording in this tab, also after a reload; the look-back goes on in memory. */
  async stop() {
    if (!this.recording) return;
    this.measure();
    await this.flush();
    this.recording = false;
    this.events = [];
    try {
      session(this.win)?.setItem(OFF_KEY, '1');
    } catch {
      // stops for this page anyway
    }
    this.badge?.remove();
    this.badge = null;
    this.emit('stop');
  }

  /** Stops for good on this page (the browser forgot its tester link). */
  async close() {
    await this.stop();
    this.closed = true;
    this.win.clearInterval?.(this.timer);
    if (this.win.__nkRecorder === this) this.win.__nkRecorder = null;
  }
}

/**
 * Starts Playtest Recorder where it may run: a browser with a tester link
 * (recording, unless stopped in this tab), or Open test (F-118) on a page with
 * ?record (recording) or ?report (not yet; *Spela in* starts it). Otherwise null.
 */
export async function startRecorder(options = {}) {
  const win = options.window ?? globalThis.window;
  const doc = options.document ?? win?.document;
  if (!win || !options.admin) return null;
  let token = null;
  try {
    token = JSON.parse(win.localStorage?.getItem(TOKEN_KEY) ?? 'null');
  } catch {
    token = null;
  }
  // The address decides whether it records, the tester link only who it is (owner Q15):
  // a plain address records with a tester link, ?report alone does not, ?record does.
  const mode = openMode(win);
  let recording = Boolean(token) && (mode ? mode.record : true);
  let open = false;
  if (!token) {
    if (!mode) return null;
    const tester = await openSession({ win, admin: options.admin, fetch: options.fetch });
    if (!tester) return null;
    token = tester.token;
    open = true;
    recording = mode.record;
  }
  try {
    if (session(win)?.getItem(OFF_KEY)) recording = false; // stopped in this tab (owner Q3)
  } catch {
    // no session storage: as asked
  }
  const recorder = new Recorder({ ...options, token, open, recording, window: win, document: doc });
  if (options.room) recorder.attach(options.room);
  return recorder;
}
