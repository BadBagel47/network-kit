// Playtest Recorder (F-092): records without disturbing the players, in a
// browser that has opened a tester link (owner 2026-11-19, Q7), so a match
// with friends can be read afterwards to see what can be improved or what
// went wrong. It collects what the game hands over (`record(kind, data)`) and
// what the kit sees itself (errors, frames per second and slow frames, the
// room's connection and its participants), and sends it in batches about once
// a minute and when the page closes. Other players are to be told; the game
// shows RECORDER_NOTICE to them (owner, Q8).
//
//   import { startRecorder } from './vendor/network-kit/client/playtest-entry.js';
//   const recorder = await startRecorder({ admin, version, room });   // null without a tester link
//   recorder?.record('level-start', { level: 3 });
//   recorder?.attach(room);   // a room joined later

import { VERSION } from '../version.js';
import { describeDevice } from './playtest.js';
import { RECORDER_NOTICE } from './playtest-entry.js';

export { RECORDER_NOTICE };
const TOKEN_KEY = 'nk-playtest:tester';
const OFF_KEY = 'nk-playtest:recording-off'; // this tab stopped recording (sessionStorage)
const BATCH_MS = 60_000;
const EVENTS_MAX = 500; // per batch, as the admin page takes them
const CHUNKS_MAX = 240; // per session (four hours); then a new session starts

const randomId = (win) => {
  const bytes = win.crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export class Recorder {
  constructor({ admin, token, version = '', window: win, document: doc, fetch: f, everyMs = BATCH_MS, badge = true }) {
    this.admin = String(admin).replace(/\/$/, '');
    this.token = token;
    this.version = version;
    this.win = win;
    this.doc = doc;
    this.fetch = f ?? ((...a) => win.fetch(...a));
    this.everyMs = everyMs;
    this.newSession();
    this.dropped = 0;
    this.frames = { count: 0, slowest: 0, last: 0 };
    this.rooms = new Set();
    this.stopped = false;
    this.stopListeners = [];
    this.watch();
    this.timer = win.setInterval?.(() => this.flush(), everyMs);
    if (badge && !new URLSearchParams(win.location?.search ?? '').has('still')) this.showBadge();
  }

  newSession() {
    this.session = randomId(this.win);
    this.seq = 0;
    this.startedAt = Date.now();
    this.events = [];
  }

  /** A game event worth seeing afterwards (a level start, a death, a choice …). */
  record(kind, data = null) {
    if (this.stopped) return;
    if (this.events.length >= EVENTS_MAX) {
      this.dropped += 1;
      return;
    }
    this.events.push({ t: Date.now() - this.startedAt, k: String(kind).slice(0, 40), d: data });
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
    w.addEventListener?.('nk-playtest-forget', () => this.stop());
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
        if (!this.stopped) raf(tick);
      };
      raf(tick);
    }
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

  /** Sends what has been gathered; `leaving` uses sendBeacon, which outlives the page. */
  async flush(leaving = false) {
    if (this.stopped && !leaving) return false;
    const seconds = this.everyMs / 1000;
    if (this.frames.count > 1) {
      this.events.push({ t: Date.now() - this.startedAt, k: 'perf', d: { fps: Math.round(this.frames.count / seconds), slowestFrameMs: Math.round(this.frames.slowest) } });
      this.frames = { count: 0, slowest: 0, last: 0 };
    }
    if (this.dropped) {
      this.events.push({ t: Date.now() - this.startedAt, k: 'dropped', d: { events: this.dropped } });
      this.dropped = 0;
    }
    if (!this.events.length) return false;
    const chunk = {
      token: this.token, session: this.session, seq: this.seq, events: this.events.slice(0, EVENTS_MAX + 2),
      ...(this.seq === 0 ? { context: this.context() } : {}),
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
    if (!doc?.documentElement) return;
    // A button (owner Q3): a tap asks, then stops recording in this tab.
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
      if (!this.win.confirm?.('Sluta spela in? Inspelningen stannar i den här fliken. Det som redan spelats in sparas.')) return;
      try {
        this.win.sessionStorage?.setItem(OFF_KEY, '1');
      } catch {
        // stops for this page anyway
      }
      this.stop();
    });
    doc.documentElement.append(b);
    this.badge = b;
  }

  /** Called once when recording stops, for example so the game can tell the others. */
  onStop(fn) {
    this.stopListeners.push(fn);
  }

  async stop() {
    if (this.stopped) return;
    await this.flush();
    this.stopped = true;
    this.win.clearInterval?.(this.timer);
    this.badge?.remove();
    for (const fn of this.stopListeners) {
      try {
        fn();
      } catch {
        // a game's listener never stops the stop
      }
    }
  }
}

/** Starts Playtest Recorder when this browser has a tester link; otherwise null. */
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
  if (!token) return null;
  try {
    if (win.sessionStorage?.getItem(OFF_KEY)) return null; // stopped in this tab (owner Q3)
  } catch {
    // no session storage: record
  }
  const recorder = new Recorder({ ...options, token, window: win, document: doc });
  if (options.room) recorder.attach(options.room);
  return recorder;
}
