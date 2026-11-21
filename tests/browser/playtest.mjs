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

  // Without a tester link nothing shows, and nothing more is loaded or asked (F-096).
  const loaded = [];
  const listen = (r) => loaded.push(r.url());
  game.on('request', listen);
  await game.goto(url);
  await game.waitForFunction(() => window.ready);
  assert.equal(await game.locator('.nkp').count(), 0, 'no panel without a tester link');
  game.off('request', listen);
  assert.ok(!loaded.some((u) => u.includes('/client/playtest.js') || u.includes('/client/room.js') || u.startsWith(A)), `only the light entry: ${loaded.join(' ')}`);

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

  // F-117: folded it is a small round button with a flask; a drag moves it, a tap opens it.
  await game.locator('.nkp').getByRole('button', { name: 'Fäll ihop' }).click();
  const fab = game.locator('.nkp button.fab');
  const round = await fab.boundingBox();
  assert.ok(round.width <= 44 && round.height <= 44, `small when folded (${round.width}x${round.height})`);
  assert.equal(await fab.locator('svg').count(), 1, 'a drawn flask');
  await game.mouse.move(round.x + 20, round.y + 20);
  await game.mouse.down();
  await game.mouse.move(round.x + 80, round.y + 20, { steps: 5 });
  await game.mouse.up();
  assert.ok(Math.abs((await fab.boundingBox()).x - round.x - 60) < 3, 'the folded button is dragged');
  assert.equal(await fab.count(), 1, 'a drag does not open it');
  await fab.click();
  await game.locator('.nkp').getByRole('button', { name: 'Fjärr' }).waitFor();

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
  await game.locator('.nkp button.fab .linked').waitFor(); // the game screen keeps a small round button, marked as linked

  // Starting T-1 from the phone loads its start address on the game page, which pairs again.
  await phone.getByRole('button', { name: /T-1/ }).click();
  await game.waitForURL(/at=base/);
  await game.waitForURL(/playtest=T-1/);
  await phone.locator('#test-title').getByText('The base inside').waitFor();
  await phone.getByText(/Ansluten till spelet/).waitFor({ timeout: 15_000 });
  await phone.locator('#questions textarea').first().fill('Too dark in the cellar');
  await phone.getByRole('button', { name: 'Nästa steg' }).click();
  await phone.locator('#steps li.now').getByText('Look at the light').waitFor();
  // Folded while the remote leads: the running test's id in the badge, the linked dot (F-117).
  assert.equal(await game.locator('.nkp button.fab .tag').innerText(), 'T-1');
  assert.equal(await game.locator('.nkp button.fab .linked').count(), 1);
  assert.match(await game.locator('.nkp button.fab').getAttribute('aria-label'), /test T-1 pågår.*fjärrkontroll ansluten/);
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
  const read = await (await fetch(`${A}/playtest/v1/read?game=testgame`, { headers: { 'x-playtest-key': 'test-read' } })).json();
  assert.ok(read.some((r) => r.id === second.id && r.images.length === 2));

  // Playtest Recorder (F-092) in the browser that has the tester link: a batch
  // from another origin reaches the admin page, and the agent can read it.
  const before = Date.now() - 1000; // the local store may keep sessions from earlier runs
  const recorded = await game.evaluate(async (admin) => {
    const { startRecorder } = await import('/src/client/playtest-entry.js');
    const rec = await startRecorder({ admin, version: 'test-1' });
    if (!rec) return { started: false };
    rec.record('level-start', { level: 3 });
    const sent = await rec.flush();
    const badge = document.querySelector('button[aria-label^="Playtest Recorder spelar in"]');
    window.recorderStopped = false;
    rec.onStop(() => { window.recorderStopped = true; });
    return { started: true, sent, badge: badge?.textContent ?? null };
  }, A);
  assert.deepEqual(recorded, { started: true, sent: true, badge: '● Inspelning' });
  // Owner Q3: a tap on the badge asks, then stops recording in this tab, also after a reload.
  const badgeButton = game.locator('button[aria-label^="Playtest Recorder spelar in"]');
  await badgeButton.click();
  assert.equal(await badgeButton.innerText(), '● Tryck igen för att sluta spela in', 'the first tap asks (owner Q11)');
  await badgeButton.click();
  await game.waitForFunction(() => window.recorderStopped === true);
  assert.equal(await game.locator('button[aria-label^="Playtest Recorder spelar in"]').count(), 0, 'the badge goes');
  assert.equal(await game.evaluate(async (admin) => (await import('/src/client/playtest-entry.js')).startRecorder({ admin }).then((r) => r.recording), A), false, 'not again in this tab, until Spela in');
  const sessions = await (await fetch(`${A}/playtest/v1/read-recordings?game=testgame&since=${before}`, { headers: { 'x-playtest-key': 'test-read' } })).json();
  assert.equal(sessions.length, 1);
  const session = await (await fetch(`${A}/playtest/v1/read-recording?id=${sessions[0].id}`, { headers: { 'x-playtest-key': 'test-read' } })).json();
  assert.ok(session.events.some((e) => e.k === 'level-start' && e.d.level === 3), 'the game\'s event was recorded');
  assert.equal(session.context.version, 'test-1');

  // The admin page lists them under Rapporter, and the recording under Inspelningar.
  const owner = await ctx.newPage();
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: A }]);
  await owner.goto(A);
  await owner.getByRole('button', { name: 'Rapporter' }).click();
  await owner.locator('.report').filter({ hasText: 'T-1 · The base inside' }).first().waitFor();
  await owner.locator('#recordings .item').filter({ hasText: 'testgame' }).first().waitFor();
  if (process.env.SHOTS) {
    await owner.locator('.report summary').first().click();
    await owner.screenshot({ path: `${process.env.SHOTS}/rapporter.png`, fullPage: true });
    await owner.getByRole('button', { name: 'Länkar och meddelanden' }).click();
    await owner.locator('#new-tester').screenshot({ path: `${process.env.SHOTS}/testers.png` });
  }

  // Open test (F-118): the owner switches it on; the admin page shows the three ready addresses.
  const gamePage = `${pageBase}/tests/browser/playtest-page.html?admin=${encodeURIComponent(A)}`;
  assert.equal((await api('/api/open-tests', { method: 'POST', body: JSON.stringify({ game: 'testgame', page: gamePage, hours: 1 }) })).status, 200);
  await owner.reload();
  await owner.getByRole('button', { name: 'Länkar och meddelanden' }).click();
  await owner.locator('#open-tests .open-address').nth(2).waitFor();
  const addresses = await owner.locator('#open-tests .open-address code').allInnerTexts();
  // Each address carries this switch-on's key (B-123).
  assert.deepEqual(addresses.map((a) => new URL(a).searchParams.has('record') + '/' + new URL(a).searchParams.has('report')), ['true/false', 'false/true', 'true/true'], `the three addresses: ${addresses.join(' ')}`);
  assert.match(new URL(addresses[0]).searchParams.get('record'), /^[A-Za-z0-9_-]{12}$/);
  // Without the key nothing happens.
  const noKey = await browser.newContext();
  const noKeyPage = await noKey.newPage();
  await noKeyPage.goto(`${gamePage}&report&rec`);
  await noKeyPage.waitForFunction(() => window.ready);
  assert.equal(await noKeyPage.locator('.nkp').count(), 0, 'a bare ?report without a tester link shows nothing');
  await noKey.close();
  // A browser without a tester link, with ?report: the panel, a name, and Spela in (F-120).
  const openStart = Date.now() - 1000; // the local store may keep earlier runs
  const friendCtx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const friend = await friendCtx.newPage();
  friend.on('pageerror', (e) => errors.push(`friend: ${e.message}`));
  await friend.goto(`${addresses[1]}&rec`);
  await friend.waitForFunction(() => window.ready);
  await friend.locator('.nkp').getByText('Öppet test · testgame').waitFor();
  assert.equal(await friend.locator('.nkp').getByRole('button', { name: 'Fjärr' }).count(), 0, 'no Playtest Remote in Open test');
  assert.equal(await friend.locator('button[aria-label^="Playtest Recorder spelar in"]').count(), 0, '?report alone does not record');
  await friend.locator('.nkp').getByPlaceholder('Ditt namn (frivilligt)').fill('Kim');
  await friend.evaluate(() => window.recorder.record('odd-thing', { where: 'cellar' })); // before recording: kept in memory only
  await friend.locator('.nkp').getByRole('button', { name: 'Spela in' }).click();
  await friend.locator('button[aria-label^="Playtest Recorder spelar in"]').waitFor();
  await friend.locator('.nkp').getByRole('button', { name: 'Sluta spela in' }).waitFor();
  await friend.locator('.nkp').getByRole('button', { name: 'Skriv en anteckning utan test' }).click();
  await friend.locator('.nkp textarea').first().fill('The wall flickers');
  await friend.locator('.nkp').getByRole('button', { name: 'Fungerade inte' }).click();
  await friend.locator('.nkp').getByRole('button', { name: 'Skicka' }).click();
  await friend.locator('.nkp').getByText('Skickat. Tack!').waitFor({ timeout: 10_000 }).catch(async (e) => { console.log('panel says:', await friend.locator('.nkp').innerText()); throw e; });
  const openReports = await (await api('/api/reports?game=testgame')).json();
  const fromFriend = openReports.find((r) => r.answers?.[0]?.a === 'The wall flickers' && r.at >= openStart);
  assert.ok(fromFriend, 'the Open test report reached Rapporter');
  assert.equal(fromFriend.tester, 'Öppet test · Kim');
  assert.equal(fromFriend.open, true);
  const openRecordings = (await (await api(`/api/recordings?game=testgame&since=${openStart}`)).json()).filter((r) => r.open);
  assert.equal(openRecordings.length, 1, 'Spela in started a recording');
  assert.equal(openRecordings[0].tester, 'Öppet test · Kim');
  const whole = await (await api(`/api/recordings/${openRecordings[0].id}`)).json();
  const odd = whole.events.find((e) => e.k === 'odd-thing');
  assert.ok(odd && odd.t <= 0, 'the last two minutes came with it (F-120)');
  // ?record alone records from the start, without the panel.
  const recorderOnly = await friendCtx.newPage();
  await recorderOnly.goto(`${addresses[0]}&rec`);
  await recorderOnly.waitForFunction(() => window.ready);
  await recorderOnly.locator('button[aria-label^="Playtest Recorder spelar in"]').waitFor();
  assert.equal(await recorderOnly.locator('.nkp').count(), 0, '?record alone shows no panel');
  // Slå av asks first (owner Q26, F-156); a no keeps the test on.
  let asked = '';
  owner.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await owner.locator('#open-tests').getByRole('button', { name: 'Slå av' }).click();
  assert.match(asked, /ny nyckel/, `Slå av asks first: ${asked}`);
  assert.equal((await (await api('/api/open-tests')).json()).find((t) => t.game === 'testgame')?.state, 'on', 'a no keeps Open test on');
  // Switched off: the addresses do nothing.
  await api('/api/open-tests/testgame', { method: 'DELETE' });
  // A tab that had the panel loses it at its next load (B-155).
  await friend.reload();
  await friend.waitForFunction(() => window.ready);
  assert.equal(await friend.locator('.nkp').count(), 0, 'the panel is gone after a reload once Open test is off');
  const late = await browser.newContext();
  const latePage = await late.newPage();
  await latePage.goto(`${addresses[2]}&rec`);
  await latePage.waitForFunction(() => window.ready);
  assert.equal(await latePage.locator('.nkp').count(), 0, 'nothing after Open test is off');
  assert.equal(await latePage.evaluate(() => window.recorder), null);
  await late.close();
  await friendCtx.close();

  // Owner Q15: with a tester link the address decides what shows; the link says who it is.
  const withLinkReport = await ctx.newPage(); // a new tab: nothing stopped in it
  await withLinkReport.goto(`${url}&report&rec`);
  await withLinkReport.waitForFunction(() => window.ready);
  await withLinkReport.locator('.nkp').waitFor();
  assert.equal(await withLinkReport.evaluate(() => window.recorder.recording), false, '?report with a tester link: the panel, no recording');
  if (await withLinkReport.locator('.nkp button.fab').count()) await withLinkReport.locator('.nkp button.fab').click(); // folded earlier in this browser
  await withLinkReport.locator('.nkp').getByRole('button', { name: 'Spela in' }).waitFor();
  await withLinkReport.close();
  const withLinkRecord = await ctx.newPage();
  await withLinkRecord.goto(`${url}&record&rec`);
  await withLinkRecord.waitForFunction(() => window.ready);
  assert.equal(await withLinkRecord.evaluate(() => window.recorder.recording), true, '?record with a tester link records');
  assert.equal(await withLinkRecord.locator('.nkp').count(), 0, '?record with a tester link: no panel');
  await withLinkRecord.close();

  // Owner Q3: "Sluta testa på den här enheten" makes this browser forget the tester link.
  if (await game.locator('.nkp button.fab').count()) await game.locator('.nkp button.fab').click();
  await game.locator('.nkp').getByRole('button', { name: 'Sluta testa på den här enheten' }).click();
  await game.locator('.nkp').getByRole('button', { name: 'Tryck igen för att sluta testa här' }).click();
  await game.locator('.nkp').waitFor({ state: 'detached' });
  assert.equal(await game.evaluate(() => localStorage.getItem('nk-playtest:tester')), null, 'the link is forgotten here');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('playtest browser test passed');
} finally {
  await browser?.close();
  admin.stop();
  files.close();
}
