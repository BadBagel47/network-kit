// B-033: a tab the browser copied from another is told apart from a reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabSession } from '../../src/client/tab.js';
import { start, client, cleanup, until } from './bridge.js';
import { CREW } from './setup.js';

test.afterEach(cleanup);

/** Browser locks shared by the tabs of one browser; a tab's locks go when it closes. */
class FakeLocks {
  constructor() { this.held = new Map(); }
  forTab(tab) {
    return {
      request: async (name, options, callback) => {
        if (this.held.has(name)) return callback(null);
        this.held.set(name, tab);
        return callback({ name });
      },
    };
  }
  close(tab) {
    for (const [name, owner] of this.held) if (owner === tab) this.held.delete(name);
  }
}

const memory = (from) => {
  const m = new Map(from ? from.map : []);
  return { map: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('with browser locks: a reload keeps the id, a copied tab gets a new one', async () => {
  const locks = new FakeLocks();
  const first = memory();
  const a = await tabSession({ fresh: true, storage: first, locks: locks.forTab('a') });
  assert.equal(a.copied, false);

  // A copy while the first tab is open: same storage contents, lock taken.
  const copy = memory(first);
  const b = await tabSession({ fresh: true, storage: copy, locks: locks.forTab('b') });
  assert.equal(b.copied, true);
  assert.notEqual(b.id, a.id);
  assert.equal(copy.getItem('network-kit:tab'), b.id);
  assert.equal(first.getItem('network-kit:tab'), a.id, 'the first tab keeps its id');

  // A reload of the first tab: its lock went with the old page.
  locks.close('a');
  const reloaded = await tabSession({ fresh: true, storage: first, locks: locks.forTab('a2') });
  assert.deepEqual(reloaded, { id: a.id, copied: false });
});

test('without locks: the other tabs are asked over a broadcast channel', async () => {
  const first = memory();
  const a = await tabSession({ fresh: true, storage: first, locks: null, waitMs: 50 });
  assert.equal(a.copied, false);
  const copy = memory(first);
  const b = await tabSession({ fresh: true, storage: copy, locks: null, waitMs: 200 });
  assert.equal(b.copied, true);
  assert.notEqual(b.id, a.id);
});

test('without locks and channels, or storage: every tab counts as the original', async () => {
  const first = memory();
  const a = await tabSession({ fresh: true, storage: first, locks: null, BroadcastChannel: null });
  const b = await tabSession({ fresh: true, storage: memory(first), locks: null, BroadcastChannel: null });
  assert.equal(a.copied, false);
  assert.equal(b.copied, false);
  assert.equal((await tabSession({ fresh: true, storage: null })).copied, false);
});

test('a copied tab joins as a new participant and leaves the first tab alone', async () => {
  const { world, created, owner } = await start(CREW);
  const shared = owner.keyStore.map; // the first tab's storage
  // The copy starts with the same stored identity (and owner key) as the first tab.
  const copyStore = memory({ map: shared });
  const copy = client(world, { name: 'Copy', storage: copyStore, tabSession: async () => ({ copied: true }) });
  assert.equal(copy.playerKey, owner.playerKey, 'before connecting it has the copied identity');
  await copy.connect();
  await world.settle();
  assert.notEqual(copy.playerKey, owner.playerKey);
  assert.notEqual(copy.me, owner.me);
  assert.equal(owner.status, 'online');
  assert.deepEqual(owner.events('closed'), []);
  assert.ok(owner.isOwner && owner.isHost);
  assert.ok(!copy.isOwner && !copy.isHost);
  await until(() => owner.players.length === 2);
  assert.ok(created.ownerKey);

  // The same copied page joining again keeps its new identity.
  const again = client(world, { name: 'Copy', storage: copyStore, tabSession: async () => ({ copied: true }) });
  assert.equal(again.playerKey, copy.playerKey);
});
