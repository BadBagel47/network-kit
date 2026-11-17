// Sign-in for the admin page: one password chosen by the owner (kept as the
// Worker secret ADMIN_PASSWORD), a signed session cookie, and a brake on
// repeated wrong passwords per address.

export const COOKIE = 'nk_admin';
export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 12;

const enc = new TextEncoder();

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** Compare two strings without leaking where they differ. */
export function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passwordConfigured(env) {
  return typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length >= MIN_PASSWORD_LENGTH;
}

/** True when `given` is the configured password (compared as hashes, in constant time). */
export async function checkPassword(env, given) {
  if (!passwordConfigured(env) || typeof given !== 'string' || given.length > 1024) return false;
  return sameText(await sha256(given), await sha256(env.ADMIN_PASSWORD));
}

// The signing key comes from the password, so changing the password signs
// everybody out.
async function key(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`network-kit-admin-session\u0000${env.ADMIN_PASSWORD}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(env, text) {
  return hex(await crypto.subtle.sign('HMAC', await key(env), enc.encode(text)));
}

/** A cookie value that is valid until `expires` (ms). */
export async function newSession(env, now = Date.now()) {
  const expires = now + SESSION_DAYS * 86_400_000;
  return `${expires}.${await sign(env, `admin:${expires}`)}`;
}

export async function validSession(env, value, now = Date.now()) {
  if (!passwordConfigured(env) || typeof value !== 'string') return false;
  const [expires, sig] = value.split('.');
  if (!/^\d+$/.test(expires ?? '') || Number(expires) <= now) return false;
  return sameText(sig ?? '', await sign(env, `admin:${expires}`));
}

export function readCookie(request, name = COOKIE) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function sessionCookie(value) {
  return `${COOKIE}=${value}; Max-Age=${SESSION_DAYS * 86_400}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export const clearCookie = () => `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;

/**
 * The brake on wrong passwords, for one address. After `freeTries` wrong
 * passwords the address must wait, and the wait doubles with every further
 * wrong password (1 min, 2, 4 … at most a day). A right password clears it.
 * `storage` is a Durable Object's storage (get/put/delete).
 */
export class LoginGuard {
  constructor(storage, { freeTries = 5, firstWaitMs = 60_000, maxWaitMs = 86_400_000, forgetMs = 86_400_000 } = {}) {
    this.storage = storage;
    this.o = { freeTries, firstWaitMs, maxWaitMs, forgetMs };
  }

  async state(now) {
    const s = (await this.storage.get('guard')) ?? { fails: 0, last: 0, until: 0 };
    // An address that has been quiet for a day starts over.
    if (s.fails && now - s.last > this.o.forgetMs) return { fails: 0, last: 0, until: 0 };
    return s;
  }

  /** Milliseconds this address must still wait before it may try (0 = may try now). */
  async waitMs(now = Date.now()) {
    const s = await this.state(now);
    return Math.max(0, s.until - now);
  }

  async failed(now = Date.now()) {
    const s = await this.state(now);
    s.fails += 1;
    s.last = now;
    const over = s.fails - this.o.freeTries;
    if (over >= 0) s.until = now + Math.min(this.o.maxWaitMs, this.o.firstWaitMs * 2 ** over);
    await this.storage.put('guard', s);
    return Math.max(0, s.until - now);
  }

  async succeeded() {
    await this.storage.delete('guard');
  }
}
