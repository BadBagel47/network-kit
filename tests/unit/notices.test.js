// The warning sound after an iPad has slept (B-084).
import test from 'node:test';
import assert from 'node:assert/strict';
import { playWarningSound } from '../../src/client/notices.js';

// A browser's sound, enough to see which context plays and when.
function fakeWindow({ startState = 'suspended', resumes = false } = {}) {
  const made = [];
  const listeners = new Map();
  class Ctx {
    constructor() {
      this.state = made.length === 0 ? startState : 'running';
      this.currentTime = 0;
      this.destination = {};
      this.tones = 0;
      made.push(this);
    }
    resume() {
      if (resumes) this.state = 'running';
      return this.state === 'running' ? Promise.resolve() : new Promise(() => {}); // a paused iPad never answers
    }
    close() { this.state = 'closed'; }
    createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x) => x }; }
    createOscillator() {
      return { type: '', frequency: { value: 0 }, connect: (x) => x, start: () => { this.tones += 1; }, stop() {} };
    }
  }
  return {
    AudioContext: Ctx,
    made,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    fire: (type) => listeners.get(type)?.(),
    listening: () => [...listeners.keys()],
  };
}

test('B-084: a sound paused by sleep plays at the next lifted finger, in a new context', async () => {
  const win = fakeWindow({ startState: 'interrupted' });
  assert.equal(playWarningSound({ window: win }), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(win.made[0].tones, 0, 'silent while paused');
  assert.deepEqual(win.listening().sort(), ['click', 'keydown', 'touchend'], 'waits for a lifted finger, a click or a key');
  win.fire('touchend');
  assert.equal(win.made.length, 2, 'a new context, made inside the touch');
  assert.equal(win.made[0].state, 'closed');
  assert.equal(win.made[1].tones, 8, 'the warning plays: four tones, two voices each');
  assert.deepEqual(win.listening(), [], 'stops waiting');
  playWarningSound({ level: 'info', window: win });
  assert.equal(win.made[1].tones, 12, 'later sounds play at once');
});

test('B-084: a context that resumes by itself plays without a touch', async () => {
  const win = fakeWindow({ startState: 'suspended', resumes: true });
  playWarningSound({ level: 'info', window: win });
  await new Promise((r) => setTimeout(r, 5));
  const playing = win.made.at(-1);
  assert.ok(playing.tones >= 4, 'the message plays');
  assert.deepEqual(win.listening(), []);
});
