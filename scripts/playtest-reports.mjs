#!/usr/bin/env node
// Fetches a game's Playtest reports (F-091) from the admin page and prints them
// sealed, as scripts/demo-reports.mjs does: gzip, AES-256-GCM with a fresh key,
// and that key wrapped with the reader's RSA public key. Pictures are included.
// Open with: node scripts/open-reports.mjs <private-key.pem> <file> [picture dir]
//   ADMIN_URL=… READ_KEY=… PUBLIC_KEY=<base64 SPKI DER> GAME=<game> [SINCE=<ms>] [KEEP=<ids>] [OUT=<file>] node scripts/playtest-reports.mjs
import { createPublicKey, publicEncrypt, randomBytes, createCipheriv, constants } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const { ADMIN_URL, READ_KEY, PUBLIC_KEY, GAME = '', SINCE = '0', KEEP = '' } = process.env;
if (!ADMIN_URL || !READ_KEY || !PUBLIC_KEY) {
  console.error('ADMIN_URL, READ_KEY and PUBLIC_KEY are needed');
  process.exit(1);
}
const headers = { 'x-playtest-key': READ_KEY };
// Behåll: reports the agent wants kept past 30 days.
const keep = KEEP.split(/[\s,]+/).filter(Boolean);
if (keep.length) {
  const res = await fetch(`${ADMIN_URL}/playtest/v1/keep`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ ids: keep }) });
  console.log(`Behåll: ${res.status} ${JSON.stringify(await res.json().catch(() => ({})))}`);
}
const q = new URLSearchParams({ game: GAME, since: SINCE });
const res = await fetch(`${ADMIN_URL}/playtest/v1/read?${q}`, { headers });
if (!res.ok) {
  console.error(`The admin page answered ${res.status}`);
  process.exit(1);
}
// Pictures one at a time (B-099), put into the sealed reports.
const reports = await res.json();
for (const r of reports) {
  r.pictures = [];
  for (const id of r.images ?? []) {
    const pic = await fetch(`${ADMIN_URL}/playtest/v1/read-image?id=${encodeURIComponent(id)}`, { headers });
    if (pic.ok) r.pictures.push({ id, type: pic.headers.get('content-type'), data: Buffer.from(await pic.arrayBuffer()).toString('base64') });
  }
}
const text = JSON.stringify(reports);
const count = reports.length;
const publicKey = createPublicKey({ key: Buffer.from(PUBLIC_KEY.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' });
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([cipher.update(gzipSync(text)), cipher.final()]);
const sealed = {
  k: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
  iv: iv.toString('base64'),
  tag: cipher.getAuthTag().toString('base64'),
  d: data.toString('base64'),
};
const blob = Buffer.from(JSON.stringify(sealed)).toString('base64');
const lines = ['-----BEGIN SEALED REPORTS-----'];
for (let i = 0; i < blob.length; i += 1000) lines.push(blob.slice(i, i + 1000));
lines.push('-----END SEALED REPORTS-----');
console.log(`${count} report(s), sealed for the reader.`);
if (process.env.OUT) writeFileSync(process.env.OUT, `${lines.join('\n')}\n`);
else console.log(lines.join('\n'));
