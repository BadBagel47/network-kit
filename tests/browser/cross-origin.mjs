#!/usr/bin/env node
// B-104 in Chromium: a game page on another address than its room Worker asks
// the game's status with a game link (header x-admin-pass) and gets an answer,
// not a CORS failure that would read as open without notices.
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startWrangler } from '../support/wrangler.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startWrangler();
const page = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>other origin</title>'));
await new Promise((r) => page.listen(0, '127.0.0.1', r));
const pageUrl = `http://localhost:${page.address().port}/`; // another origin than 127.0.0.1:<wrangler>
let browser;
try {
  browser = await chromium.launch();
  const tab = await browser.newPage();
  await tab.goto(pageUrl);
  const result = await tab.evaluate(async (base) => {
    try {
      const res = await fetch(`${base}/rooms/status`, { headers: { 'x-admin-pass': 'not-a-real-link' } });
      return { ok: res.ok, status: res.status, body: await res.json() };
    } catch (e) {
      return { failed: String(e) };
    }
  }, server.base);
  assert.equal(result.failed, undefined, `the browser refused the request: ${result.failed}`);
  assert.equal(result.status, 200);
  assert.ok('notices' in result.body, 'the answer carries the notices');
  console.log('cross-origin status test passed');
} finally {
  await browser?.close();
  page.close();
  server.stop();
}
