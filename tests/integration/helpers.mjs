import { NetworkRoom } from '../../src/client/index.js';

export const BASE = process.env.NETWORK_KIT_URL;
if (!BASE) throw new Error('run through tests/integration/run.mjs');

export function store() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const fast = { minDelayMs: 100, maxDelayMs: 1000, heartbeatMs: 2000, pongTimeoutMs: 2000 };

export function create(name, extra = {}) {
  return NetworkRoom.create(BASE, { name, storage: store(), ...fast, ...extra });
}

export function join(code, name, extra = {}) {
  return NetworkRoom.join(BASE, { code, name, storage: store(), ...fast, ...extra });
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
