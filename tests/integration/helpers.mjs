import { NetworkRoom } from '../../src/client/index.js';

export const BASE = process.env.NETWORK_KIT_URL;
if (!BASE) throw new Error('run through tests/integration/run.mjs');

export function store() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const fast = { minDelayMs: 100, maxDelayMs: 1000, heartbeatMs: 2000, pongTimeoutMs: 2000 };
const rooms = [];
const track = (room) => (rooms.push(room), room);

/** Disconnect every client made so far. */
export function cleanup() {
  for (const room of rooms.splice(0)) room.disconnect();
}

export async function create(name, extra = {}) {
  return track(await NetworkRoom.create(BASE, { name, storage: store(), ...fast, ...extra }));
}

export async function join(code, name, extra = {}) {
  return track(await NetworkRoom.join(BASE, { code, name, storage: store(), ...fast, ...extra }));
}

/** Resolve with the next `type` event matching `check`. */
export function next(room, type, check = () => true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timeout waiting for ${type}`));
    }, timeoutMs);
    const off = room.on(type, (detail) => {
      if (!check(detail)) return;
      clearTimeout(timer);
      off();
      resolve(detail);
    });
  });
}

/** Wait until `check()` is true (polling). */
export async function until(check, timeoutMs = 8000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A raw WebSocket into a room, for things a well-behaved client never does. */
export function raw(code, basePath = '/rooms') {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}${basePath}/${code}/ws`);
  const closed = new Promise((resolve) => {
    ws.addEventListener('close', (e) => resolve({ code: e.code, reason: e.reason }));
  });
  const opened = new Promise((resolve) => ws.addEventListener('open', resolve));
  return { ws, opened, closed };
}
