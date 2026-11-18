#!/usr/bin/env node
// The admin page (F-071) in Chromium, phone-sized, with made-up figures and
// the page's real Content-Security-Policy: every tab draws without errors, a
// timer counts down in its button, the emergency stop sits under a cover, and
// a change is saved at once.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildUsage, lastDays } from '../../admin/analytics.js';
import { METRICS, LIMITS_CHECKED } from '../../admin/limits.js';
import { budgetState, gameStatus, normalizeSettings } from '../../admin/control.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shots = process.env.SCREENSHOTS_DIR || 'test-results';
mkdirSync(shots, { recursive: true });
const root = new URL('../../admin/public/', import.meta.url);
const csp = /Content-Security-Policy: (.*)/.exec(readFileSync(new URL('_headers', root), 'utf8'))[1];

const now = Date.now();
const dates = lastDays(now, 31);
const shapes = {
  workers: { day: 'date', owner: 'scriptName', values: { sum: ['requests', 'errors'] } },
  invocations: { day: 'date', owner: 'scriptName', split: 'type', values: { sum: ['requests', 'errors'] } },
};
const r = { workers: [], invocations: [] };
for (const d of dates) {
  for (const g of ['bricks', 'vattigt', 'network-kit-admin']) {
    r.workers.push({ sum: { requests: 500, errors: g === 'bricks' ? 1 : 0 }, dimensions: { date: d, scriptName: g } });
    r.invocations.push({ sum: { requests: 4000, errors: 0 }, dimensions: { date: d, scriptName: g, type: 'hibernation' } });
  }
}
const base = buildUsage({ now, dates, shapes, results: r });
const inM = (m) => new Date(now + m * 60_000).toISOString();
let settings = normalizeSettings({ account: { autoClose: true }, games: {
  bricks: { mode: 'on', modes: { solo: { mode: 'off' }, duo: { mode: 'timer', timer: { from: inM(-30), until: inM(30) } } } },
  vattigt: {},
} }, now);
const usage = () => {
  const budget = budgetState(settings, base);
  const one = (n, m) => gameStatus(settings, budget, n, now, m);
  const status = Object.fromEntries(['bricks', 'vattigt', 'network-kit-admin'].map((n) => [n, { ...one(n, null), modes: Object.fromEntries(Object.keys(settings.games[n]?.modes ?? {}).map((m) => [m, one(n, m)])) }]));
  return { ...base, metrics: METRICS, limitsChecked: LIMITS_CHECKED, deployed: { bricks: inM(-60) }, activity: { bricks: { rooms: 2, players: 5, peak: 8 } },
    control: { settings, budget, status, connected: { bricks: now, vattigt: now }, versions: { bricks: '0.12.0' } } };
};
const saved = [];

const local = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch(local && !process.env.CI ? { executablePath: local } : {});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.route('http://admin.test/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    // F-078: the cards come from the fast answer; Cloudflare's figures arrive later.
    if (u.pathname === '/api/control') return route.fulfill({ json: usage().control });
    if (u.pathname === '/api/usage') {
      await new Promise((r) => setTimeout(r, 600));
      return route.fulfill({ json: usage() });
    }
    if (u.pathname === '/api/settings' && req.method() === 'PUT') {
      settings = normalizeSettings(JSON.parse(req.postData()), Date.now());
      saved.push(settings);
      return route.fulfill({ json: { settings } });
    }
    if (u.pathname === '/api/passes') return route.fulfill({ json: [{ id: 'a', game: 'bricks', label: 'Pixel', created: now, expires: now + 86_400_000, state: 'active' }] });
    if (u.pathname === '/api/log') return route.fulfill({ json: [{ at: now, game: 'bricks', text: 'bricks lades till' }] });
    if (u.pathname === '/api/lobbies') return route.fulfill({ json: [{ id: 'l1', game: 'bricks', label: 'Fredagsmatch', page: 'https://bricks.example/', created: now, expires: now + 86_400_000, hostToken: 'lb_l1.h', guestToken: 'lb_l1.g', code: 'ABCDEF', state: 'active' }] });
    if (u.pathname === '/api/quality') return route.fulfill({ json: { days: 7, quality: {} } });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
    const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ body: readFileSync(new URL(file, root)), contentType: type, headers: { 'content-security-policy': csp } });
  });
  await page.goto('http://admin.test/');
  await page.waitForSelector('#dashboard:not([hidden])');
  assert.equal(await page.locator('#cards article').count(), 2, 'only connected games get a card');
  assert.ok(await page.locator('#cards .skeleton').count() > 0, 'the cards show before Cloudflare\'s figures, with placeholders');
  await page.waitForFunction(() => !document.querySelector('#cards .skeleton'));
  await page.waitForTimeout(1000); // the numbers count up
  assert.match(await page.textContent('#cards'), /2 rum.*5 spelare nu.*8 som mest i dag/s);
  assert.match(await page.textContent('#cards'), /v0\.12\.0/);
  // The timer counts down inside its button, and the button drains.
  await page.waitForFunction(() => /0:2\d:\d\d/.test(document.querySelector('#cards .segment.modes [aria-pressed="true"] .time')?.textContent ?? ''));
  const background = await page.locator('#cards .segment.modes button:has(.time)').evaluate((b) => b.style.background);
  assert.match(background, /linear-gradient/, 'the inline style is set through the CSSOM, allowed by the policy');
  await page.screenshot({ path: `${shots}/admin-spel.png`, fullPage: true });
  // A change is saved at once: Vättigt to No new players.
  await page.locator('#cards article').nth(1).getByRole('button', { name: 'Inga nya' }).click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent.startsWith('Sparat'));
  assert.equal(saved.at(-1).games.vattigt.mode, 'off');
  // The emergency stop needs the cover lifted first.
  await page.locator('#cards article').first().getByRole('button', { name: 'Lyft locket för nödstopp' }).click();
  await page.locator('#cards article').first().getByRole('button', { name: 'NÖDSTOPP' }).click();
  await page.waitForFunction(() => document.querySelector('#cards').textContent.includes('Nödstopp aktivt'));
  assert.equal(saved.at(-1).games.bricks.stopped, true);
  await page.click('[data-tab=lankar]');
  assert.match(await page.textContent('#lobbies'), /Fredagsmatch · bricks.*rum ABCDEF/s, 'a lobby with its room');
  assert.equal(await page.locator('#lobbies button', { hasText: 'Kopiera gästlänk' }).count(), 1);
  // QR codes move links to another device: a lobby's guest link.
  await page.locator('#lobbies button', { hasText: 'QR gäst' }).click();
  await page.waitForSelector('#qr-dialog[open] #qr-code svg');
  assert.match(await page.textContent('#qr-title'), /Gästlänk · Fredagsmatch/);
  await page.screenshot({ path: `${shots}/admin-qr.png` });
  await page.click('#qr-close');
  await page.screenshot({ path: `${shots}/admin-lankar.png`, fullPage: true });
  for (const tab of ['lankar', 'forbrukning', 'installningar', 'logg']) {
    await page.click(`[data-tab=${tab}]`);
    assert.equal(await page.locator(`#tab-${tab}`).isVisible(), true);
  }
  await page.click('[data-tab=forbrukning]');
  await page.locator('#meters .meter > button').first().click();
  assert.equal(await page.locator('#meters svg.ring').count(), 1, 'a meter opens to its ring and graph');
  await page.screenshot({ path: `${shots}/admin-forbrukning.png`, fullPage: true });
  assert.deepEqual(errors, [], 'no errors in the page');
  console.log('admin page test passed');
} catch (err) {
  console.error(err);
  console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
