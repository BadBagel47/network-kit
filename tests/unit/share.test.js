import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { shareLink, readShareLink, qrMatrix, qrSvg } from '../../src/client/share.js';
import { normalizeCode, isValidCode } from '../../src/shared/protocol.js';

test('share links keep the code and key after #, which browsers never send to servers', () => {
  const link = shareLink('https://example.github.io/critical/?lang=sv#old', 'ab-cde', 'k3y_-');
  assert.equal(link, 'https://example.github.io/critical/?lang=sv#room=ABCDE&key=k3y_-');
  assert.deepEqual(readShareLink(link), { code: 'ABCDE', key: 'k3y_-' });
  assert.deepEqual(readShareLink('#room=abcde'), { code: 'ABCDE', key: null });
  assert.equal(readShareLink('#room=ABC'), null);
  assert.equal(readShareLink('https://example.com/'), null);
});

test('room codes', () => {
  assert.equal(normalizeCode(' ab cd-e '), 'ABCDE');
  assert.ok(isValidCode('ABCDE'));
  assert.ok(!isValidCode('ABCD0'), 'no zero');
  assert.ok(!isValidCode('ABCDEF'));
});

test('QR codes decode back to the link', () => {
  const link = shareLink('https://badbagel47.github.io/critical/', 'QWE9J', 'BxF_tzB7i7oVBH63OIVY0g');
  const matrix = qrMatrix(link);
  const scale = 4;
  const margin = 4;
  const size = (matrix.length + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + margin) * scale + y) * size + (c + margin) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }));
  assert.equal(jsQR(data, size, size)?.data, link);
  const svg = qrSvg(link, { title: 'Join' });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<title[^>]*>Join<\/title>/);
});
