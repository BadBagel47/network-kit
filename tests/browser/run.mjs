#!/usr/bin/env node
// Plays the demo page in Chromium: create, share link, join, start, move,
// claim a post, then the host's tab closes and the other player takes over.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startWrangler } from '../support/wrangler.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shots = process.env.SCREENSHOTS_DIR || 'test-results';
mkdirSync(shots, { recursive: true });

const server = await startWrangler();
// A pinned Playwright may not match the Chromium already on this machine.
const local = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch(local && !process.env.CI ? { executablePath: local } : {});
const errors = [];
async function page(name) {
  const context = await browser.newContext({ viewport: { width: 720, height: 900 } });
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  p.on('response', (r) => { if (r.status() >= 400) errors.push(`${name}: ${r.status()} ${r.url()}`); });
  return { context, p };
}

try {
  const a = await page('Ada');
  await a.p.goto(`${server.base}/`);
  // B-116: no text on the page can be selected (the iPad's text menu), fields can.
  assert.deepEqual(await a.p.evaluate(() => [getComputedStyle(document.querySelector('h1')).userSelect, getComputedStyle(document.querySelector('#name')).userSelect]), ['none', 'text']);
  // The steering keys can be typed in the name field (B-041).
  await a.p.click('#name');
  await a.p.keyboard.type('Wasd ArrowKeys');
  await a.p.keyboard.press('ArrowLeft');
  await a.p.keyboard.type('x');
  assert.equal(await a.p.inputValue('#name'), 'Wasd ArrowKeyxs', 'letters and arrow keys work in the name field');
  await a.p.fill('#name', 'Ada');
  await a.p.click('#create');
  await a.p.waitForSelector('#game:not([hidden])');
  const code = await a.p.textContent('#room-code');
  assert.match(code, /^[A-Z2-9]{6}$/);

  await a.p.click('#share');
  await a.p.waitForSelector('#qr svg');
  const playerLink = await a.p.getAttribute('#player-link', 'href');
  assert.match(playerLink, new RegExp(`#room=${code}&key=`));
  await a.p.screenshot({ path: `${shots}/share.png` });
  await a.p.click('#close-share');

  const b = await page('Bo');
  await b.p.goto(playerLink);
  assert.equal(await b.p.inputValue('#code'), code);
  await b.p.fill('#name', 'Bo');
  await b.p.click('#join');
  await b.p.waitForSelector('#game:not([hidden])');
  assert.ok(!b.p.url().includes('key='), 'the key is removed from the address bar');
  await b.p.waitForFunction(() => document.querySelector('#players').textContent.includes('Ada'));

  // B-033: the invitation opened in a new tab of the owner's own browser (the
  // browser copies the tab's session storage) is a new participant: it asks
  // for a name, and the owner's tab keeps the room.
  const aId = await a.p.evaluate(() => window.demo.room.me);
  const [copy] = await Promise.all([a.context.waitForEvent('page'), a.p.evaluate((l) => window.open(l, '_blank'), playerLink)]);
  copy.on('pageerror', (e) => errors.push(`copy: ${e.message}`));
  await copy.waitForLoadState();
  await copy.waitForSelector('#start:not([hidden])');
  assert.equal(await copy.evaluate(() => document.activeElement?.id), 'name', 'the name field is ready to fill in');
  await copy.fill('#name', 'Cleo');
  await copy.click('#join');
  await copy.waitForSelector('#game:not([hidden])');
  const copyId = await copy.evaluate(() => window.demo.room.me);
  assert.notEqual(copyId, aId);
  assert.equal(await copy.evaluate(() => window.demo.room.isOwner || window.demo.room.isHost), false);
  await a.p.waitForFunction(() => document.querySelector('#players').textContent.includes('Cleo'));
  assert.equal(await a.p.textContent('#status'), 'Online', 'the owner\'s tab is still in the room');
  assert.equal(await a.p.evaluate(() => window.demo.room.isOwner && window.demo.room.isHost), true);
  await copy.click('#leave');
  await a.p.waitForFunction(() => !document.querySelector('#players').textContent.includes('Cleo'));
  await copy.close();

  await a.p.click('#start-game');
  await b.p.waitForFunction(() => document.querySelector('#overlay').hidden, null, { timeout: 8000 });

  const bId = await b.p.evaluate(() => window.demo.room.me);
  const x0 = await a.p.evaluate((id) => window.demo.world.ships[id].x, bId);
  await b.p.keyboard.down('ArrowRight');
  await b.p.waitForTimeout(600);
  await b.p.keyboard.up('ArrowRight');
  await a.p.waitForFunction(([id, x]) => window.demo.world.ships[id].x > x + 20, [bId, x0]);
  // Bo's screen follows the host's positions.
  await b.p.waitForFunction(([id, x]) => window.demo.world.ships[id].x > x + 20, [bId, x0]);
  // F-045: no inertia, the ship stops when the key is let go; Bo sees the response time.
  const stopped = await a.p.evaluate((id) => window.demo.world.ships[id].x, bId);
  await a.p.waitForTimeout(300);
  assert.equal(await a.p.evaluate((id) => window.demo.world.ships[id].x, bId), stopped, 'the ship stops at once');
  await b.p.waitForFunction(() => /^Response: \d+ ms$/.test(document.querySelector('#response').textContent), null, { timeout: 6000 });
  assert.equal(await a.p.textContent('#response'), 'You run the game: no delay');

  // F-048: Bo's own ship moves at once in Bo's browser, before the host's answer can arrive.
  const mine0 = await b.p.evaluate(() => window.demo.mine?.x);
  assert.equal(typeof mine0, 'number', 'Bo predicts the own ship');
  await b.p.keyboard.down('ArrowLeft');
  await b.p.waitForTimeout(80);
  assert.ok(await b.p.evaluate((x) => window.demo.mine.x < x, mine0), 'the own ship moved at once');
  await b.p.keyboard.up('ArrowLeft');
  // F-047: Bo sends a report; it is kept and can be read with the key.
  await b.p.waitForTimeout(800);
  await b.p.click('#report');
  await b.p.waitForFunction(() => /Report [A-Z0-9]{4} sent/.test(document.querySelector('#log').textContent));
  const reports = await (await fetch(`${server.base}/diag`, { headers: { 'x-diag-key': 'test-diag-key' } })).json();
  const mine = reports.find((r) => r.report.room?.name === 'Bo');
  assert.ok(mine, 'the report is kept');
  assert.ok(mine.report.measured.rttMs.n > 0, 'it has response times');
  assert.ok(mine.report.measured.keyToMoveMs.n > 0, 'it has key-to-move times');
  assert.equal((await fetch(`${server.base}/diag`)).status, 403, 'nobody reads them without the key');

  // F-038: the arrows on the screen steer too (held while pressed).
  assert.equal(await b.p.isVisible('#pad'), true);
  const y0 = await a.p.evaluate((id) => window.demo.world.ships[id].y, bId);
  await b.p.dispatchEvent('#pad-down', 'pointerdown', { pointerId: 1 });
  await b.p.waitForTimeout(600);
  await b.p.dispatchEvent('#pad-down', 'pointerup', { pointerId: 1 });
  await a.p.waitForFunction(([id, y]) => window.demo.world.ships[id].y > y + 20, [bId, y0]);

  await b.p.click('#posts button:nth-child(2)');
  await a.p.waitForFunction(() => document.querySelector('#posts').textContent.includes('gunner: Bo'));
  assert.equal(await b.p.locator('#players button').count(), 0, 'only the owner can remove people');
  assert.equal(await b.p.evaluate(() => window.demo.room.inviteKeys), null);
  await a.p.screenshot({ path: `${shots}/game.png` });

  // The host gives the room the full state every few seconds; wait for the next one.
  const tick = await a.p.evaluate(() => window.demo.world.tick);
  await a.p.waitForFunction((t) => window.demo.world.tick > t + 95, tick);

  // B-050: the game steps by the clock, 30 steps a second, whatever the timer does.
  const tick0 = await a.p.evaluate(() => window.demo.world.tick);
  await a.p.waitForTimeout(2000);
  const steps = (await a.p.evaluate(() => window.demo.world.tick)) - tick0;
  assert.ok(steps >= 54 && steps <= 66, `about 60 steps in 2 seconds (${steps})`);

  // B-049: Bo moves the ship just before the host goes, so the room's kept
  // state (stored every 3 seconds) is older than what Bo has seen.
  await b.p.keyboard.down('ArrowDown');
  await b.p.waitForTimeout(500);
  await b.p.keyboard.up('ArrowDown');
  await b.p.waitForTimeout(400);
  const seen = await b.p.evaluate((id) => window.demo.world.ships[id].y, bId);

  // The host's tab disappears: Bo takes over after the short wait.
  await a.context.close();
  await b.p.waitForFunction(() => window.demo.room.isHost, null, { timeout: 15000 });
  await b.p.waitForFunction(() => document.querySelector('#log').textContent.includes('You run the game now, from the latest state.'));
  await b.p.waitForFunction(() => !window.demo.room.room.paused);
  assert.equal(await b.p.evaluate(() => window.demo.room.isOwner), false, 'the stand-in runs the game but does not own the room');
  // Bo's ship is where it was: the game continued from the state the room kept.
  const after = await b.p.evaluate((id) => window.demo.world.ships[id].x, bId);
  assert.ok(after > x0 + 20, `the ship kept its position (${after})`);
  const afterY = await b.p.evaluate((id) => window.demo.world.ships[id].y, bId);
  assert.ok(Math.abs(afterY - seen) <= 8, `no jump back at the change of host (${seen} → ${afterY})`);

  // A reload in the same tab keeps the seat and the game.
  await b.p.reload();
  await b.p.waitForSelector('#game:not([hidden])');
  await b.p.waitForFunction(() => window.demo.room?.isHost && window.demo.world.ships[window.demo.room.me]);
  assert.equal(await b.p.evaluate(() => window.demo.room.me), bId);
  await b.p.screenshot({ path: `${shots}/takeover.png` });

  // F-066: a notice from the admin page shows in a box that cannot be missed,
  // under the demo's strict Content-Security-Policy, until OK; then never again.
  const c = await page('Notice');
  const until = new Date(Date.now() + 90 * 60_000).toISOString();
  const notice = { id: 'budget-soon-test', kind: 'budget-soon', level: 'warning', title: 'Closing soon for today', text: 'No new games after {until}.', until };
  await c.context.route('**/rooms/status*', (route) => route.fulfill({ json: { open: true, reason: null, until: null, notices: [notice] } }));
  await c.p.goto(`${server.base}/`);
  await c.p.waitForSelector('.nk-notice[data-level="warning"]');
  const shown = await c.p.evaluate(() => {
    const box = document.querySelector('.nk-notice');
    const style = getComputedStyle(box);
    return { text: box.textContent, background: style.backgroundColor, position: getComputedStyle(box.parentElement).position, role: box.getAttribute('role') };
  });
  const time = await c.p.evaluate((u) => new Date(u).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), until);
  assert.ok(shown.text.includes(`No new games after ${time}.`), shown.text);
  assert.equal(shown.background, 'rgb(255, 204, 51)', 'the style sheet works under the page\'s CSP');
  assert.equal(shown.position, 'fixed');
  assert.equal(shown.role, 'alert');
  await c.p.screenshot({ path: `${shots}/notice.png` });
  await c.p.click('.nk-notice button');
  assert.equal(await c.p.locator('.nk-notice').count(), 0);
  await c.p.reload();
  await c.p.waitForTimeout(500);
  assert.equal(await c.p.locator('.nk-notice').count(), 0, 'a notice is shown once per browser');
  // The preview page shows each kind.
  await c.p.goto(`${server.base}/notices.html`);
  const kinds = await c.p.locator('#kinds button').count();
  assert.equal(kinds, 7);
  for (let i = 0; i < kinds; i++) {
    await c.p.locator('#kinds button').nth(i).click({ position: { x: 5, y: 5 } });
    assert.equal(await c.p.locator('.nk-notice').count(), 1);
    await c.p.locator('.nk-notice').screenshot({ path: `${shots}/notice-${i}.png` });
    await c.p.click('.nk-notice button');
  }

  const relevant = errors.filter((e) => !/WebSocket connection .* failed/i.test(e));
  assert.deepEqual(relevant, [], 'no errors in the pages');
  console.log('browser test passed');
} catch (err) {
  console.error(err);
  console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.stop();
}
