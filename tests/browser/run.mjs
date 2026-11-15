#!/usr/bin/env node
// Plays the demo page in Chromium: create, share link, join, start, move,
// claim a post, then the host's tab closes and the other player takes over.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startWrangler } from '../support/wrangler.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shots = process.env.SCREENSHOTS_DIR || 'test-results';
mkdirSync(shots, { recursive: true });

const server = await startWrangler();
const browser = await chromium.launch();
const errors = [];
async function page(name) {
  const context = await browser.newContext({ viewport: { width: 720, height: 900 } });
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  return { context, p };
}

try {
  const a = await page('Ada');
  await a.p.goto(`${server.base}/`);
  await a.p.fill('#name', 'Ada');
  await a.p.click('#create');
  await a.p.waitForSelector('#game:not([hidden])');
  const code = await a.p.textContent('#room-code');
  assert.match(code, /^[A-Z2-9]{5}$/);

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

  await b.p.click('#posts button:nth-child(2)');
  await a.p.waitForFunction(() => document.querySelector('#posts').textContent.includes('gunner: Bo'));
  await a.p.screenshot({ path: `${shots}/game.png` });

  // The host's tab disappears: Bo takes over after the short wait.
  await a.context.close();
  await b.p.waitForFunction(() => window.demo.room.isHost, null, { timeout: 15000 });
  await b.p.waitForFunction(() => document.querySelector('#log').textContent.includes('You run the game now.'));
  await b.p.waitForFunction(() => !window.demo.room.room.paused);
  await b.p.screenshot({ path: `${shots}/takeover.png` });

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
