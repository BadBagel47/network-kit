#!/usr/bin/env node
// Playtest (F-091) in Chromium against the admin Worker in wrangler dev:
// a tester link opens Playtest-rutan on a game page; a report with answers and
// a screenshot reaches Rapporter; the game gets no keys while the tester
// types; Playtest Remote on a phone-sized page pairs by code, starts a test
// (the game page reloads and pairs again), takes a screenshot and sends.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startWrangler } from '../support/wrangler.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const PASSWORD = 'playtest test password';

// The game page and network-kit's client, served from the repository.
const root = resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const files = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => files.listen(0, '127.0.0.1', r));
const pageBase = `http://127.0.0.1:${files.address().port}`;

const admin = await startWrangler({
  config: 'admin/wrangler.jsonc', ready: '/remote/', vars: [`ADMIN_PASSWORD:${PASSWORD}`, 'ROOM_JURISDICTION:', 'PLAYTEST_READ_KEY:test-read'],
}).catch(async () => null);
if (!admin) throw new Error('the admin Worker did not start');
const A = admin.base;
let browser;
try {
  // Sign in and make a tester link, as the owner does on the admin page.
  const login = await fetch(`${A}/login`, { method: 'POST', body: new URLSearchParams({ password: PASSWORD }), redirect: 'manual', headers: { origin: A } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = (path, init = {}) => fetch(`${A}${path}`, { ...init, headers: { cookie, origin: A, 'content-type': 'application/json', ...init.headers } });
  const { token } = await (await api('/api/testers', { method: 'POST', body: JSON.stringify({ game: 'testgame', label: 'Browser test', hours: 1, page: `${pageBase}/tests/browser/playtest-page.html` }) })).json();
  assert.match(token, /^pt_/);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });
  const game = await ctx.newPage();
  const errors = [];
  game.on('pageerror', (e) => errors.push(e.message));
  if (process.env.DEBUG) game.on('console', (m) => console.log('page:', m.text()));
  if (process.env.DEBUG) game.on('requestfailed', (r) => console.log('failed:', r.url(), r.failure()?.errorText));
  const url = `${pageBase}/tests/browser/playtest-page.html?admin=${encodeURIComponent(A)}`;

  // Without a tester link nothing shows.
  await game.goto(url);
  await game.waitForFunction(() => window.ready);
  assert.equal(await game.locator('.nkp').count(), 0, 'no panel without a tester link');

  // With one, the panel shows, and the link leaves the address.
  await game.goto('about:blank'); // a hash change alone would not load the page again
  await game.goto(`${url}#nk-tester=${token}`);
  await game.waitForFunction(() => window.ready);
  if (process.env.DEBUG) console.log('panel:', await game.evaluate(() => [Boolean(window.playtest), document.querySelectorAll('.nkp').length, document.querySelector('.nkp')?.hidden, location.href]), errors);
  await game.locator('.nkp').waitFor();
  assert.ok(!game.url().includes('nk-tester'), 'the token is taken out of the address');
  assert.match(await game.locator('.nkp').innerText(), /Browser test · testgame/);

  // A test: answers typed in the panel never reach the game.
  await game.getByRole('button', { name: /T-2/ }).click();
  const area = game.locator('.nkp textarea').first();
  await area.click();
  await game.keyboard.type('Yes, at once');
  assert.equal(await game.locator('#keys').innerText(), '0', 'the game got no keys while the tester typed');
  await game.locator('.nkp').getByRole('button', { name: 'Ta skärmbild' }).click();
  await game.locator('.nkp .thumbs img').waitFor();
  if (process.env.SHOTS) await game.screenshot({ path: `${process.env.SHOTS}/panel.png` });
  await game.locator('.nkp').getByRole('button', { name: 'Skicka' }).click();
  await game.locator('.nkp').getByText('Välj Fungerade, Delvis eller Fungerade inte först.').waitFor();
  await game.locator('.nkp').getByRole('button', { name: 'Delvis' }).click();
  await game.locator('.nkp').getByRole('button', { name: 'Skicka' }).click();
  await game.locator('.nkp').getByText('Skickat. Tack!').waitFor();
  assert.match(await game.locator('.nkp').innerText(), /T-2 · rapporterad/);

  let reports = await (await api('/api/reports?game=testgame')).json();
  const first = reports.find((r) => r.testId === 'T-2');
  assert.ok(first, 'the report reached Rapporter');
  assert.equal(first.result, 'partly');
  assert.equal(first.tester, 'Browser test');
  assert.deepEqual(first.answers, [{ q: 'Does the music start?', a: 'Yes, at once' }]);
  assert.equal(first.images.length, 1, 'with the screenshot');
  assert.equal(first.context.version, 'test-1');
  assert.equal(first.context.game.mode, 'test');
  assert.ok(first.context.browser && first.context.window, 'device and window go with it');
  const picture = await api(`/api/reports/image/${first.images[0]}`);
  assert.equal(picture.headers.get('content-type'), 'image/jpeg');
  assert.ok((await picture.arrayBuffer()).byteLength < 300 * 1024 + 1);

  // The panel folds to a tab and stays where it was dragged, also after a reload.
  const bar = game.locator('.nkp .bar');
  const box = await bar.boundingBox();
  await game.mouse.move(box.x + 30, box.y + box.height / 2);
  await game.mouse.down();
  await game.mouse.move(box.x + 230, box.y + 80, { steps: 5 });
  await game.mouse.up();
  const moved = await bar.boundingBox();
  assert.ok(Math.abs(moved.x - box.x - 200) < 3, 'dragged');
  await game.reload();
  await game.locator('.nkp').waitFor();
  assert.ok(Math.abs((await game.locator('.nkp .bar').boundingBox()).x - moved.x) < 3, 'kept after a reload');

  // Playtest Remote on a phone.
  await game.locator('.nkp').getByRole('button', { name: 'Fjärr' }).click();
  const code = (await game.locator('.nkp .code').innerText({ timeout: 10_000 })).trim();
  assert.match(code, /^[A-Z0-9]{6}$/);
  const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', (e) => errors.push(`remote: ${e.message}`));
  await phone.goto(`${A}/remote/`);
  await phone.locator('#code').fill(code.toLowerCase());
  await phone.getByRole('button', { name: 'Koppla' }).click();
  await phone.getByRole('button', { name: /T-1/ }).waitFor();
  await game.locator('.nkp .bar').getByText('Playtest · fjärr').waitFor(); // the game screen keeps a small tab

  // Starting T-1 from the phone loads its start address on the game page, which pairs again.
  await phone.getByRole('button', { name: /T-1/ }).click();
  await game.waitForURL(/at=base/);
  await game.waitForURL(/playtest=T-1/);
  await phone.locator('#test-title').getByText('The base inside').waitFor();
  await phone.getByText(/Ansluten till spelet/).waitFor({ timeout: 15_000 });
  await phone.locator('#questions textarea').first().fill('Too dark in the cellar');
  await phone.getByRole('button', { name: 'Nästa steg' }).click();
  await phone.locator('#steps li.now').getByText('Look at the light').waitFor();
  assert.match(await game.locator('.nkp .bar').innerText(), /Playtest · T-1 · fjärr/);
  await phone.getByRole('button', { name: 'Skärmbild från spelet' }).click();
  await phone.locator('#thumbs img').waitFor();
  // A photo from the remote's own camera goes with its upload key, never the tester link (B-094).
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await phone.waitForFunction(() => document.querySelector('#test') && !document.querySelector('#test').hidden);
  await phone.locator('#photo-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await phone.waitForFunction(() => document.querySelectorAll('#thumbs img').length === 2, null, { timeout: 15_000 });
  await phone.getByRole('button', { name: 'Fungerade', exact: true }).click();
  if (process.env.SHOTS) {
    await phone.screenshot({ path: `${process.env.SHOTS}/remote.png`, fullPage: true });
    await game.screenshot({ path: `${process.env.SHOTS}/game-remote.png` });
  }
  await phone.getByRole('button', { name: 'Skicka' }).click();
  await phone.getByText('Skickat. Tack!').waitFor();

  reports = await (await api('/api/reports?game=testgame')).json();
  const second = reports.find((r) => r.testId === 'T-1');
  assert.ok(second, 'the remote\'s report reached Rapporter');
  assert.equal(second.via, 'remote');
  assert.equal(second.result, 'worked');
  assert.equal(second.answers[0].a, 'Too dark in the cellar');
  assert.equal(second.images.length, 2, 'the game page\'s screenshot and the remote\'s photo went with it');
  assert.equal(second.context.game.at, 'base');

  // The agent's reading.
  const read = await (await fetch(`${A}/playtest/read?game=testgame`, { headers: { 'x-playtest-key': 'test-read' } })).json();
  assert.ok(read.some((r) => r.id === second.id && r.pictures.length === 2));

  // The admin page lists them under Rapporter.
  const owner = await ctx.newPage();
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: A }]);
  await owner.goto(A);
  await owner.getByRole('button', { name: 'Rapporter' }).click();
  await owner.locator('.report').filter({ hasText: 'T-1 · The base inside' }).first().waitFor();
  if (process.env.SHOTS) {
    await owner.locator('.report summary').first().click();
    await owner.screenshot({ path: `${process.env.SHOTS}/rapporter.png`, fullPage: true });
    await owner.getByRole('button', { name: 'Länkar och meddelanden' }).click();
    await owner.locator('#new-tester').screenshot({ path: `${process.env.SHOTS}/testers.png` });
  }

  assert.deepEqual(errors, [], 'no page errors');
  console.log('playtest browser test passed');
} finally {
  await browser?.close();
  admin.stop();
  files.close();
}
