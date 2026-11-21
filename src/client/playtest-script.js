// Scripted tests in Playtest (F-121): a test in the game's list may carry a
// script, `run: async (t) => { ... }`, that plays the game on the real device
// (the owner's computer, phone or iPad), checks and measures, and asks the
// tester only what needs eyes and ears. Playtest-rutan runs it with *Kör*
// (only with a tester link, owner Q28), also when Playtest Remote asks (Q27),
// and sends the outcome as an ordinary report with a `script` part.
//
//   { id: 'G-1', title: 'Start and steer', links: [['Open the game', './?test']],
//     run: async (t) => {
//       t.step('Start a match');
//       await t.click('Start');
//       await t.wait(() => game.mode === 'playing');
//       await t.key('ArrowRight', { hold: 500 });
//       t.check(game.ship.x > 100, 'the ship moved right');
//       const m = await t.measure('steering', 3000);   // fps, slowest frame, the game's own measures
//       t.check(m.fps >= 50, 'at least 50 frames a second');
//       await t.ask('Does the ship move smoothly?');    // Ja / Nej from the tester
//       await t.tap('Turn the sound on', () => game.audio.resume()); // a tap the browser needs
//     } }
//
// Gameplay rules stay in the game: the kit only drives the page as a player would.

const WAIT_MS = 10_000;
const LOG_MAX = 50;

/** The `code` a keyboard event has for a key name, as browsers give it. */
export function codeOf(key) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key === ' ') return 'Space';
  return key;
}

/** A visible button or link whose text, aria-label or title is `name` (or matches a CSS selector starting with # or .). */
export function findControl(doc, name, outside = null) {
  const visible = (e) => !e.hidden && !e.disabled && !e.closest?.('[hidden]') && (e.getClientRects ? e.getClientRects().length > 0 : true);
  const mine = (e) => !(outside && outside.contains?.(e));
  if (/^[#.]/.test(name)) {
    const found = [...doc.querySelectorAll(name)].filter((e) => mine(e) && visible(e));
    return found[0] ?? null;
  }
  const wanted = name.trim().toLowerCase();
  const all = [...doc.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"], summary')];
  const named = (e) => [e.textContent, e.getAttribute?.('aria-label'), e.getAttribute?.('title'), e.value]
    .some((v) => typeof v === 'string' && v.trim().toLowerCase() === wanted);
  return all.find((e) => mine(e) && visible(e) && named(e)) ?? null;
}

export class ScriptStopped extends Error {
  constructor() {
    super('stopped');
    this.name = 'ScriptStopped';
  }
}

/**
 * One run of a test's script. `ui` is how the run talks to the tester:
 * { update(run), ask(question) → Promise<boolean>, tap(text, fn) → Promise, shot() → Promise<Blob|null> }.
 */
export class ScriptRun {
  constructor({ item, win, doc, ui, outside = null, now = () => Date.now() }) {
    this.item = item;
    this.win = win;
    this.doc = doc;
    this.ui = ui;
    this.outside = outside;
    this.now = now;
    this.controller = new AbortController();
    this.startedAt = now();
    this.state = 'running'; // running | done | failed | stopped
    this.current = '';
    this.steps = [];
    this.checks = [];
    this.asks = [];
    this.measures = {};
    this.notes = [];
    this.error = null;
    this.waiting = null; // { ask } or { tap } while the tester is needed
    this.held = new Set();
  }

  get signal() {
    return this.controller.signal;
  }

  get stopped() {
    return this.controller.signal.aborted;
  }

  stop() {
    if (this.state !== 'running') return;
    this.controller.abort();
  }

  at() {
    return this.now() - this.startedAt;
  }

  guard() {
    if (this.stopped) throw new ScriptStopped();
  }

  changed() {
    try {
      this.ui.update?.(this);
    } catch {
      // the panel is gone
    }
  }

  sleep(ms) {
    return new Promise((resolve, reject) => {
      if (this.stopped) return reject(new ScriptStopped());
      const timer = this.win.setTimeout(resolve, Math.max(0, ms));
      this.controller.signal.addEventListener('abort', () => {
        this.win.clearTimeout(timer);
        reject(new ScriptStopped());
      }, { once: true });
    });
  }

  /** What the script sees as `t`. */
  api() {
    const run = this;
    const key = (type, name, o = {}) => {
      run.guard();
      const target = o.target ?? run.doc.querySelector('canvas[tabindex]') ?? run.doc.body ?? run.doc.documentElement;
      const init = { key: name, code: o.code ?? codeOf(name), bubbles: true, cancelable: true, shiftKey: Boolean(o.shift), ctrlKey: Boolean(o.ctrl), altKey: Boolean(o.alt), metaKey: Boolean(o.meta) };
      target.dispatchEvent(new run.win.KeyboardEvent(type, init));
      if (type === 'keydown') run.held.add(JSON.stringify([name, init.code, o.target ? null : 1]));
      else run.held.delete(JSON.stringify([name, init.code, o.target ? null : 1]));
    };
    return {
      signal: run.controller.signal,
      /** Names the part the script is in; shown to the tester and kept in the report. */
      step(text) {
        run.guard();
        run.current = String(text);
        run.steps.push({ at: run.at(), text: run.current });
        run.changed();
      },
      /** Waits `ms`, or until `condition()` is true (at most `timeout`, then it throws). */
      async wait(condition, o = {}) {
        if (typeof condition === 'number') return run.sleep(condition);
        const timeout = o.timeout ?? WAIT_MS;
        const until = run.now() + timeout;
        for (;;) {
          run.guard();
          let value;
          try {
            value = await condition();
          } catch {
            value = false;
          }
          if (value) return value;
          if (run.now() >= until) throw new Error(`waited ${timeout} ms${o.what ? ` for ${o.what}` : ''}`);
          await run.sleep(o.every ?? 50);
        }
      },
      keyDown(name, o) {
        key('keydown', name, o);
      },
      keyUp(name, o) {
        key('keyup', name, o);
      },
      /** Presses a key and lets go after `hold` ms (default 100). */
      async key(name, o = {}) {
        key('keydown', name, o);
        try {
          await run.sleep(o.hold ?? 100);
        } finally {
          key('keyup', name, o);
        }
      },
      /** Clicks a button or link by its text, aria-label or title (or a CSS selector), waiting until it shows. */
      async click(name, o = {}) {
        const control = typeof name === 'string'
          ? await this.wait(() => findControl(run.doc, name, run.outside), { timeout: o.timeout ?? 5000, what: `"${name}"` })
          : name;
        run.guard();
        control.click();
        await run.sleep(o.after ?? 50);
        return control;
      },
      /** Records a check; the test fails if one is false, but the script goes on. */
      check(ok, text) {
        run.guard();
        const entry = { at: run.at(), text: String(text ?? 'check'), ok: Boolean(ok) };
        run.checks.push(entry);
        run.changed();
        return entry.ok;
      },
      /** Measures `ms` of frames, and the game's own performance.measure entries made meanwhile. */
      async measure(label, ms = 3000) {
        run.guard();
        const perf = run.win.performance;
        const from = perf?.now?.() ?? 0;
        const frames = [];
        let last = 0;
        let looping = true;
        const raf = run.win.requestAnimationFrame?.bind(run.win);
        const tick = (t) => {
          if (!looping) return;
          if (last) frames.push(t - last);
          last = t;
          raf(tick);
        };
        if (raf) raf(tick);
        try {
          await run.sleep(ms);
        } finally {
          looping = false;
        }
        const seconds = frames.reduce((a, b) => a + b, 0) / 1000;
        const marks = {};
        for (const m of perf?.getEntriesByType?.('measure') ?? []) {
          if (m.startTime < from) continue;
          const s = (marks[m.name] ??= { count: 0, totalMs: 0, maxMs: 0 });
          s.count += 1;
          s.totalMs += m.duration;
          s.maxMs = Math.max(s.maxMs, m.duration);
        }
        for (const s of Object.values(marks)) {
          s.totalMs = Math.round(s.totalMs * 10) / 10;
          s.maxMs = Math.round(s.maxMs * 10) / 10;
          s.avgMs = Math.round((s.totalMs / s.count) * 10) / 10;
        }
        const result = {
          ms,
          frames: frames.length,
          fps: seconds > 0 ? Math.round(frames.length / seconds) : 0,
          slowestFrameMs: Math.round(Math.max(0, ...frames)),
          longFrames: frames.filter((f) => f > 50).length,
          ...(Object.keys(marks).length ? { marks } : {}),
        };
        run.measures[String(label)] = result;
        run.changed();
        return result;
      },
      /** Asks the tester (Ja / Nej, on this device or the remote); a Nej fails the test. */
      async ask(question) {
        run.guard();
        const q = String(question);
        const entry = { at: run.at(), q, a: null };
        run.asks.push(entry);
        run.waiting = { ask: q };
        run.changed();
        try {
          entry.a = await run.ui.ask(q, run);
        } finally {
          run.waiting = null;
        }
        run.guard();
        run.changed();
        return entry.a;
      },
      /** Waits for a tap on this device (sound, fullscreen); `fn` runs inside the tap. */
      async tap(text, fn) {
        run.guard();
        run.waiting = { tap: String(text) };
        run.changed();
        try {
          await run.ui.tap(String(text), fn, run);
        } finally {
          run.waiting = null;
        }
        run.guard();
        run.changed();
      },
      /** A screenshot of the game to go with the report (at most four). */
      async shot() {
        run.guard();
        return run.ui.shot?.();
      },
      /** A line of its own in the report. */
      note(text) {
        run.notes.push({ at: run.at(), text: String(text) });
        run.changed();
      },
    };
  }

  /** Runs the script to its end; never throws. */
  async go() {
    try {
      await this.item.run(this.api());
      this.state = 'done';
    } catch (e) {
      if (e instanceof ScriptStopped || this.stopped) this.state = 'stopped';
      else {
        this.state = 'failed';
        this.error = String(e?.message ?? e).slice(0, 500);
      }
    }
    // Keys the script held are let go, so the game does not keep steering.
    for (const held of this.held) {
      const [name, code, own] = JSON.parse(held);
      if (!own) continue;
      try {
        (this.doc.querySelector('canvas[tabindex]') ?? this.doc.body).dispatchEvent(new this.win.KeyboardEvent('keyup', { key: name, code, bubbles: true }));
      } catch {
        // the page is gone
      }
    }
    this.held.clear();
    this.durationMs = this.at();
    this.changed();
    return this;
  }

  /** The report's result: everything passed and every answer was Ja → worked. */
  get result() {
    if (this.state === 'stopped') return 'cancelled';
    if (this.state !== 'done') return 'failed';
    if (this.checks.some((c) => !c.ok) || this.asks.some((a) => a.a === false)) return 'failed';
    return 'worked';
  }

  /** A short line for the tester and the report. */
  summary() {
    const passed = this.checks.filter((c) => c.ok).length;
    const parts = [];
    if (this.checks.length) parts.push(`${passed} av ${this.checks.length} kontroller gick igenom`);
    if (this.asks.length) parts.push(`${this.asks.filter((a) => a.a === true).length} av ${this.asks.length} svar Ja`);
    const fps = Object.values(this.measures).map((m) => m.fps).filter((f) => f > 0);
    if (fps.length) parts.push(`${Math.min(...fps)} bilder/s som lägst`);
    if (this.state === 'failed') parts.push(`stoppade: ${this.error}`);
    if (this.state === 'stopped') parts.push('avbrutet');
    return parts.join(' · ') || (this.state === 'done' ? 'klart' : this.state);
  }

  /** The `script` part of the report. */
  toReport(from = 'panel') {
    return {
      state: this.state,
      from,
      durationMs: this.durationMs ?? this.at(),
      summary: this.summary(),
      steps: this.steps.slice(-LOG_MAX),
      checks: this.checks.slice(-LOG_MAX),
      asks: this.asks.slice(-LOG_MAX).map((a) => ({ at: a.at, q: a.q, a: a.a === null ? null : a.a ? 'Ja' : 'Nej' })),
      measures: this.measures,
      notes: this.notes.slice(-LOG_MAX),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  /** What Playtest Remote shows while it runs. */
  toRemote() {
    return {
      state: this.state,
      current: this.current,
      checks: this.checks.slice(-12).map((c) => ({ text: c.text, ok: c.ok })),
      waiting: this.waiting ? { ask: this.waiting.ask ?? null, tap: this.waiting.tap ?? null } : null,
      summary: this.state === 'running' ? null : this.summary(),
    };
  }
}
