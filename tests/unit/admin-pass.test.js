import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminPass, forgetAdminPass } from '../../src/client/admin-pass.js';

function fakeWindow(hash) {
  const store = new Map();
  const win = {
    location: { hash, pathname: '/play', search: '?x=1' },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    history: { state: null, replaceState: (s, t, url) => { win.replaced = url; win.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } },
  };
  return win;
}

test('F-058: the pass is taken from the address bar into storage, and the address bar is cleaned', () => {
  const token = 'Ab12Cd34.' + 'x'.repeat(43);
  const win = fakeWindow(`#room=ABCDEF&nk-admin=${token}`);
  assert.equal(adminPass(win), token);
  assert.equal(win.replaced, '/play?x=1#room=ABCDEF', 'the room code stays, the pass goes');
  assert.equal(adminPass(win), token, 'kept for later visits');
  forgetAdminPass(win);
  assert.equal(adminPass(win), null);
  assert.equal(adminPass(fakeWindow('#nk-admin=<script>')), null, 'nonsense is not kept');
  assert.equal(adminPass(null), null);
});
